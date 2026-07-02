from __future__ import annotations
"""
支付网关客户端 — 支付宝(Alipay) 电脑网站支付，含 RSA2 真实验签。

设计：
  · 配置了 ALIPAY_APP_ID + 私钥/公钥 → 走真实支付宝网关（alipay.trade.page.pay）。
  · 未配置 → 降级 sandbox 模式：生成一个本地"沙箱支付页"URL，明确标注为模拟，
    便于开发/演示，但绝不在无凭证时静默授予权益（沙箱支付仍需显式回调确认）。

安全要点（PRD §6.3）：
  · 权益仅在支付网关异步通知(notify)验签通过后授予，前端 return_url 不授予权益。
  · 使用 RSA2 (SHA256withRSA) 对请求签名、对回调验签。
"""
import base64
import logging
from collections import OrderedDict
from typing import Dict, Optional
from urllib.parse import quote_plus

from common.core.config import settings

logger = logging.getLogger(__name__)


def _rsa2_sign(unsigned: str, private_key_pem: str) -> str:
    """RSA2 (SHA256withRSA) 签名，返回 base64 字符串。"""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    key = serialization.load_pem_private_key(private_key_pem.encode("utf-8"), password=None)
    signature = key.sign(unsigned.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode("utf-8")


def _rsa2_verify(unsigned: str, signature_b64: str, public_key_pem: str) -> bool:
    """RSA2 验签。"""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.exceptions import InvalidSignature

    try:
        pub = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
        pub.verify(
            base64.b64decode(signature_b64),
            unsigned.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except (InvalidSignature, Exception) as e:
        logger.warning(f"Alipay signature verify failed: {e}")
        return False


def _build_sign_content(params: Dict[str, str]) -> str:
    """按支付宝规则：过滤空值/sign，按 key 字典序，用 & 连接 k=v。"""
    items = sorted((k, v) for k, v in params.items() if v not in (None, "") and k not in ("sign", "sign_type"))
    return "&".join(f"{k}={v}" for k, v in items)


class PaymentGateway:
    """支付宝电脑网站支付封装。"""

    def __init__(self):
        self.provider = settings.PAYMENT_PROVIDER
        self.app_id = settings.ALIPAY_APP_ID
        self.private_key = settings.ALIPAY_APP_PRIVATE_KEY
        self.public_key = settings.ALIPAY_PUBLIC_KEY
        self.gateway = settings.ALIPAY_GATEWAY

    @property
    def is_live(self) -> bool:
        """是否具备真实支付宝凭证。"""
        return bool(
            self.provider == "alipay" and self.app_id and self.private_key and self.public_key
        )

    def create_page_pay_url(
        self,
        *,
        out_trade_no: str,
        amount: float,
        subject: str,
        notify_url: str,
        return_url: str,
    ) -> Dict[str, str]:
        """
        生成支付跳转 URL。

        Returns: {"pay_url": ..., "mode": "alipay"|"sandbox"}
        """
        if not self.is_live:
            # 沙箱：返回本地模拟支付页（前端展示"模拟支付"，需点击确认触发 notify）
            logger.info("Payment provider not configured — using sandbox pay page")
            sandbox_url = f"/api/v1/payments/sandbox/pay?out_trade_no={quote_plus(out_trade_no)}"
            return {"pay_url": sandbox_url, "mode": "sandbox"}

        import json
        import time

        biz_content = json.dumps({
            "out_trade_no": out_trade_no,
            "total_amount": f"{amount:.2f}",
            "subject": subject,
            "product_code": "FAST_INSTANT_TRADE_PAY",
        }, ensure_ascii=False)

        params = OrderedDict({
            "app_id": self.app_id,
            "method": "alipay.trade.page.pay",
            "format": "JSON",
            "charset": "utf-8",
            "sign_type": "RSA2",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "version": "1.0",
            "notify_url": notify_url,
            "return_url": return_url,
            "biz_content": biz_content,
        })

        unsigned = _build_sign_content(params)
        params["sign"] = _rsa2_sign(unsigned, self.private_key)

        query = "&".join(f"{k}={quote_plus(str(v))}" for k, v in params.items())
        return {"pay_url": f"{self.gateway}?{query}", "mode": "alipay"}

    def verify_notify(self, form: Dict[str, str]) -> bool:
        """验证支付宝异步通知签名。沙箱模式下跳过验签（由本地可信端点触发）。"""
        if not self.is_live:
            return True  # sandbox notify 来自本服务内部可信端点
        sign = form.get("sign", "")
        params = {k: v for k, v in form.items() if k not in ("sign", "sign_type")}
        unsigned = _build_sign_content(params)
        return _rsa2_verify(unsigned, sign, self.public_key)


payment_gateway = PaymentGateway()
