from __future__ import annotations
"""
PaymentOrder ORM model — 订阅支付订单（PRD §7.3 商业化）。

订单驱动的支付流程，替代此前"直接改 plan_type"的模拟实现：
  created → (跳转支付) → paid（网关回调验签通过后授予权益） / cancelled / failed
"""
import uuid

from sqlalchemy import String, Integer, Numeric, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseModel


class PaymentOrder(BaseModel):
    __tablename__ = "payment_orders"

    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name="order_id",
    )
    # 商户订单号（对外/对账用，唯一）
    out_trade_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    plan_type: Mapped[str] = mapped_column(String(20), nullable=False, default="premium")
    months: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)  # 应付金额(元)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="CNY")

    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="sandbox")
    # created / paid / cancelled / failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="created")
    # 网关流水号（支付宝 trade_no）
    trade_no: Mapped[str] = mapped_column(String(64), nullable=True)
    paid_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
