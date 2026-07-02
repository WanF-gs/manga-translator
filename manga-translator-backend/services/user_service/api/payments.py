from __future__ import annotations
"""Freemium/Payment API - Plan management, quotas, order-based payment (v3.0)."""
from fastapi import APIRouter, Depends, Query, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from datetime import datetime, timedelta
import json, sys, os, uuid

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response, created_response
from common.core.config import settings
from common.models.user import User
from common.models.project import Project
from common.models.page import Page
from common.models.payment_order import PaymentOrder
from common.clients.payment_gateway import payment_gateway

router = APIRouter()

PLANS = {
    "free": {"name": "免费版", "price": 0, "daily_pages": 10, "max_projects": 10, "features": ["基础翻译引擎", "单页导出", "10个作品限额", "日处理10页"]},
    "premium": {"name": "专业版", "price": 29, "daily_pages": -1, "max_projects": -1, "features": ["多模态翻译引擎", "批量导出", "无限作品", "无限处理", "角色语气引擎", "画质增强", "有声剧场", "字体管理", "API开放平台", "无水印导出"]},
}


async def _grant_premium(db: AsyncSession, order: PaymentOrder) -> None:
    """幂等授予专业版权益（仅供已验证支付的订单调用）。"""
    if order.status == "paid":
        return
    user = (await db.execute(select(User).where(User.user_id == order.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    now = datetime.utcnow()
    base = user.premium_expires if (user.premium_expires and user.premium_expires > now) else now
    user.premium_expires = base + timedelta(days=30 * order.months)
    user.plan_type = "premium"
    order.status = "paid"
    order.paid_at = now
    await db.flush()

@router.get("/plans")
async def get_plans(current_user: dict = Depends(get_current_user)):
    """Get available subscription plans."""
    return success_response(data={
        "plans": [
            {"id": k, **v, "is_current": k == current_user.get("plan_type", "free")}
            for k, v in PLANS.items()
        ],
        "current_plan": current_user.get("plan_type", "free"),
    })

@router.get("/quota")
async def get_quota(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get current user's daily quota status."""
    plan_type = current_user.get("plan_type", "free")
    plan = PLANS.get(plan_type, PLANS["free"])

    today_pages = (await db.execute(
        select(func.count(Page.page_id))
        .join(Page.chapter).join(Page.chapter.project)
        .where(
            Project.user_id == current_user["sub"],
            func.date(Page.created_at) == func.current_date(),
        )
    )).scalar() or 0

    active_projects = (await db.execute(
        select(func.count(Project.project_id))
        .where(Project.user_id == current_user["sub"], Project.status == "active")
    )).scalar() or 0

    daily_limit = plan["daily_pages"] if plan["daily_pages"] > 0 else 999999
    project_limit = plan["max_projects"] if plan["max_projects"] > 0 else 999999

    return success_response(data={
        "plan": plan_type,
        "daily_pages_used": today_pages,
        "daily_pages_limit": daily_limit if daily_limit < 999999 else "unlimited",
        "daily_pages_remaining": max(0, daily_limit - today_pages) if daily_limit < 999999 else "unlimited",
        "active_projects": active_projects,
        "projects_limit": project_limit if project_limit < 999999 else "unlimited",
        "can_create_project": active_projects < project_limit if project_limit < 999999 else True,
        "can_upload": today_pages < daily_limit if daily_limit < 999999 else True,
    })

@router.post("/upgrade")
async def create_upgrade_order(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    创建专业版升级订单并返回支付跳转链接。

    ⚠️ 权益不在此授予——仅在支付网关异步通知(/notify)验签通过后授予。
    Returns: {order_id, out_trade_no, amount, pay_url, mode}
    """
    user = (await db.execute(select(User).where(User.user_id == current_user["sub"]))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    months = int(body.get("months", 1))
    if months < 1 or months > 36:
        raise HTTPException(400, "months 必须在 1-36 之间")

    unit_price = PLANS["premium"]["price"]  # ¥29/月
    # 年付优惠：≥12 个月按 ¥199/年 折算
    if months >= 12:
        years = months // 12
        rest = months % 12
        amount = years * 199 + rest * unit_price
    else:
        amount = months * unit_price

    out_trade_no = f"MT{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:8]}"
    order = PaymentOrder(
        order_id=uuid.uuid4(),
        out_trade_no=out_trade_no,
        user_id=user.user_id,
        plan_type="premium",
        months=months,
        amount=amount,
        currency="CNY",
        provider=payment_gateway.provider,
        status="created",
    )
    db.add(order)
    await db.flush()

    base = settings.ALIPAY_RETURN_URL or ""
    notify_url = settings.ALIPAY_NOTIFY_URL or "/api/v1/payments/notify"
    pay = payment_gateway.create_page_pay_url(
        out_trade_no=out_trade_no,
        amount=float(amount),
        subject=f"漫画翻译专业版 {months} 个月",
        notify_url=notify_url,
        return_url=base,
    )
    await db.commit()

    return created_response(data={
        "order_id": str(order.order_id),
        "out_trade_no": out_trade_no,
        "amount": float(amount),
        "months": months,
        "pay_url": pay["pay_url"],
        "mode": pay["mode"],
        "message": "订单已创建，请前往支付" if pay["mode"] == "alipay" else "沙箱模式：请在模拟支付页确认",
    })


@router.get("/orders/{order_id}")
async def get_order(
    order_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """查询订单状态（前端轮询支付结果）。"""
    order = (await db.execute(
        select(PaymentOrder).where(
            PaymentOrder.order_id == order_id,
            PaymentOrder.user_id == current_user["sub"],
        )
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "订单不存在")
    return success_response(data={
        "order_id": str(order.order_id),
        "out_trade_no": order.out_trade_no,
        "status": order.status,
        "amount": float(order.amount),
        "months": order.months,
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
    })


@router.post("/notify")
async def payment_notify(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    支付网关异步通知回调（支付宝 notify_url）。
    验签通过且交易成功 → 授予专业版权益。返回 'success' 告知网关不再重试。
    """
    form = dict((await request.form()))
    if not payment_gateway.verify_notify(form):
        raise HTTPException(400, "签名验证失败")

    out_trade_no = form.get("out_trade_no")
    trade_status = form.get("trade_status", "")
    trade_no = form.get("trade_no")
    if not out_trade_no:
        raise HTTPException(400, "缺少订单号")

    order = (await db.execute(
        select(PaymentOrder).where(PaymentOrder.out_trade_no == out_trade_no)
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "订单不存在")

    # 金额校验：防止篡改
    total_amount = form.get("total_amount")
    if total_amount and abs(float(total_amount) - float(order.amount)) > 0.01:
        raise HTTPException(400, "金额不匹配")

    if trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        order.trade_no = trade_no
        await _grant_premium(db, order)
        await db.commit()

    # 支付宝要求返回纯文本 success
    return HTMLResponse(content="success")


@router.get("/sandbox/pay", response_class=HTMLResponse)
async def sandbox_pay_page(out_trade_no: str):
    """沙箱模拟支付页（仅在未配置真实网关时使用）。点击"确认支付"触发本地 notify。"""
    if payment_gateway.is_live:
        raise HTTPException(404, "Not found")
    html = f"""
    <!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
    <title>模拟支付</title><style>
    body{{font-family:system-ui;background:#f5f5f7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
    .card{{background:#fff;border-radius:16px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center;max-width:360px}}
    .tag{{background:#fef3c7;color:#b45309;font-size:12px;padding:4px 10px;border-radius:999px;display:inline-block;margin-bottom:16px}}
    button{{background:#1677ff;color:#fff;border:0;border-radius:10px;padding:12px 28px;font-size:15px;cursor:pointer;margin-top:16px}}
    </style></head><body><div class="card">
    <div class="tag">⚠ 沙箱模拟支付（未配置真实支付网关）</div>
    <h2>确认支付订单</h2>
    <p style="color:#666">订单号：{out_trade_no}</p>
    <form method="post" action="/api/v1/payments/sandbox/confirm">
      <input type="hidden" name="out_trade_no" value="{out_trade_no}">
      <button type="submit">确认支付</button>
    </form></div></body></html>
    """
    return HTMLResponse(content=html)


@router.post("/sandbox/confirm", response_class=HTMLResponse)
async def sandbox_confirm(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """沙箱支付确认 → 授予权益（等价于真实网关的 notify 成功）。"""
    if payment_gateway.is_live:
        raise HTTPException(404, "Not found")
    form = dict((await request.form()))
    out_trade_no = form.get("out_trade_no")
    order = (await db.execute(
        select(PaymentOrder).where(PaymentOrder.out_trade_no == out_trade_no)
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "订单不存在")
    order.trade_no = f"SANDBOX{uuid.uuid4().hex[:12]}"
    await _grant_premium(db, order)
    await db.commit()
    return HTMLResponse(content=(
        "<html><body style='font-family:system-ui;text-align:center;padding-top:80px'>"
        "<h2>✅ 支付成功（沙箱）</h2><p>专业版权益已开通，请返回应用。</p>"
        "<script>setTimeout(()=>{if(window.opener){window.close()}},1500)</script>"
        "</body></html>"
    ))

@router.post("/downgrade")
async def downgrade_to_free(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Downgrade to free plan."""
    user = (await db.execute(select(User).where(User.user_id == current_user["sub"]))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    user.plan_type = "free"
    user.premium_expires = None
    await db.flush()
    return success_response(data={"plan_type": "free", "message": "已降级为免费版"})


# ── API-15: POST /payments/check-quota ──
@router.post("/check-quota")
async def check_quota(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Check if the user has quota for a specific operation (e.g., upload, export)."""
    plan_type = current_user.get("plan_type", "free")
    plan = PLANS.get(plan_type, PLANS["free"])

    today_pages = (await db.execute(
        select(func.count(Page.page_id))
        .select_from(Page)
        .join(Page.chapter).join(Page.chapter.project)
        .where(
            Project.user_id == current_user["sub"],
            func.date(Page.created_at) == func.current_date(),
        )
    )).scalar() or 0

    daily_limit = plan["daily_pages"] if plan["daily_pages"] > 0 else 999999
    operation = body.get("operation", "upload")
    requested = body.get("count", 1)

    if operation == "upload":
        remaining = max(0, daily_limit - today_pages) if daily_limit < 999999 else -1
        allowed = remaining >= requested if remaining >= 0 else True
        return success_response(data={
            "allowed": allowed,
            "plan": plan_type,
            "operation": operation,
            "daily_used": today_pages,
            "daily_limit": daily_limit if daily_limit < 999999 else "unlimited",
            "daily_remaining": remaining if remaining >= 0 else "unlimited",
            "requested_count": requested,
            "message": None if allowed else f"已达每日限额（{daily_limit}页），请升级专业版继续使用",
        })
    elif operation == "export":
        # Premium-only for batch export
        allowed = plan_type == "premium"
        return success_response(data={
            "allowed": allowed,
            "plan": plan_type,
            "operation": operation,
            "message": None if allowed else "批量导出需要专业版，请升级后继续",
        })
    else:
        return success_response(data={
            "allowed": True,
            "plan": plan_type,
            "operation": operation,
            "message": None,
        })
