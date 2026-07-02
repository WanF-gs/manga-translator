from __future__ import annotations
"""认证相关 Pydantic Schema"""
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, model_validator


class RegisterRequest(BaseModel):
    """用户注册请求"""
    email: Optional[EmailStr] = Field(None, description="邮箱地址")
    phone: Optional[str] = Field(None, max_length=20, description="手机号")
    password: str = Field(..., min_length=6, max_length=128, description="密码")
    nickname: str = Field(default="User", min_length=1, max_length=100, description="昵称")

    @model_validator(mode="after")
    def check_email_or_phone(self):
        if not self.email and not self.phone:
            raise ValueError("邮箱和手机号至少填写一项")
        return self


class LoginRequest(BaseModel):
    """用户登录请求"""
    account: str = Field(default="", min_length=0, max_length=255, description="邮箱或手机号")
    email: str = Field(default="", min_length=0, max_length=255, description="邮箱地址（PRD兼容别名，需至少提供 account 或 email 之一）")
    password: str = Field(..., min_length=1, max_length=128, description="密码")
    remember_me: bool = Field(default=False, description="记住我（延长Token有效期）")

    @model_validator(mode="before")
    @classmethod
    def normalize_account(cls, data):
        """B9 FIX: Accept either 'account' or 'email' field; normalize to 'account'."""
        if isinstance(data, dict):
            if not data.get('account') and data.get('email'):
                data['account'] = data['email']
        return data


class RefreshRequest(BaseModel):
    """Token刷新请求"""
    refresh_token: str = Field(..., min_length=1, description="刷新令牌")


class UserInfo(BaseModel):
    """用户基本信息"""
    user_id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    nickname: str
    avatar_url: Optional[str] = None
    plan_type: str
    premium_expires: Optional[str] = None
    settings: Optional[dict] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    """令牌响应"""
    access_token: str
    refresh_token: str
    expires_in: int = 7200


class AuthResponse(BaseModel):
    """认证响应（注册/登录）"""
    user: UserInfo
    tokens: TokenResponse


class ProfileUpdateRequest(BaseModel):
    """资料更新请求"""
    nickname: Optional[str] = Field(None, min_length=1, max_length=100)
    avatar_url: Optional[str] = Field(None, max_length=500)


class SettingsUpdateRequest(BaseModel):
    """偏好设置更新请求
    
    P0-FIX-05: Accepts both nested format {"settings": {...}} and flat format {"language": "zh", ...}.
    """
    settings: Optional[dict] = Field(None, description="用户偏好设置 JSON (nested format)")

    @model_validator(mode="before")
    @classmethod
    def normalize_settings(cls, data):
        """Normalize: if 'settings' key is not present, treat all top-level fields as settings."""
        if isinstance(data, dict):
            if "settings" not in data:
                # Flat format: treat the entire dict as settings
                data = {"settings": data}
            elif data.get("settings") is None:
                # Explicit null settings → empty dict
                data["settings"] = {}
        return data
