from __future__ import annotations
"""
Core configuration management for all microservices.
"""
import os
from typing import List


class Settings:
    """Application settings loaded from environment variables."""

    # Application
    APP_NAME: str = os.getenv("APP_NAME", "manga-translator")
    APP_ENV: str = os.getenv("APP_ENV", "development")
    APP_VERSION: str = os.getenv("APP_VERSION", "0.1.0")
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/manga_translator",
    )
    DATABASE_POOL_SIZE: int = int(os.getenv("DATABASE_POOL_SIZE", "20"))
    DATABASE_MAX_OVERFLOW: int = int(os.getenv("DATABASE_MAX_OVERFLOW", "10"))

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    REDIS_CACHE_DB: int = int(os.getenv("REDIS_CACHE_DB", "1"))
    REDIS_SESSION_DB: int = int(os.getenv("REDIS_SESSION_DB", "2"))

    # MinIO Object Storage
    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY: str = os.getenv("MINIO_ACCESS_KEY", "manga_admin")
    MINIO_SECRET_KEY: str = os.getenv("MINIO_SECRET_KEY", "Manga@MinIO2025!")
    MINIO_BUCKET: str = os.getenv("MINIO_BUCKET", "manga-translator")
    MINIO_SECURE: bool = os.getenv("MINIO_SECURE", "false").lower() == "true"

    # JWT
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "dev-secret-key-change-in-production")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRE: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE", "7200"))
    JWT_REFRESH_TOKEN_EXPIRE: int = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE", "604800"))

    # RabbitMQ / Celery
    RABBITMQ_URL: str = os.getenv("RABBITMQ_URL", "amqp://manga:manga123@localhost:5672//")
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL", "amqp://manga:manga123@localhost:5672//")
    CELERY_RESULT_BACKEND: str = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/3")

    # AI Model Services (gRPC)
    AI_DETECTOR_GRPC: str = os.getenv("AI_DETECTOR_GRPC", "detector-service:9101")
    AI_OCR_GRPC: str = os.getenv("AI_OCR_GRPC", "ocr-service:9102")
    AI_LLM_GRPC: str = os.getenv("AI_LLM_GRPC", "llm-service:9103")
    AI_INPAINT_GRPC: str = os.getenv("AI_INPAINT_GRPC", "inpaint-service:9104")

    # AI Service HTTP Base URL (for REST fallback)
    AI_SERVICE_BASE_URL: str = os.getenv("AI_SERVICE_BASE_URL", "http://localhost:8100")

    # Translation API Keys
    DEEPL_API_KEY: str = os.getenv("DEEPL_API_KEY", "")
    DEEPL_API_URL: str = os.getenv("DEEPL_API_URL", "https://api-free.deepl.com/v2/translate")
    GOOGLE_TRANSLATE_API_KEY: str = os.getenv("GOOGLE_TRANSLATE_API_KEY", "")
    TENCENT_SECRET_ID: str = os.getenv("TENCENT_SECRET_ID", "")
    TENCENT_SECRET_KEY: str = os.getenv("TENCENT_SECRET_KEY", "")
    TENCENT_TMT_REGION: str = os.getenv("TENCENT_TMT_REGION", "ap-guangzhou")

    # Payment gateway (Alipay). 未配置时降级为沙箱模拟（明确标注 sandbox）。
    PAYMENT_PROVIDER: str = os.getenv("PAYMENT_PROVIDER", "sandbox")  # alipay | sandbox
    ALIPAY_APP_ID: str = os.getenv("ALIPAY_APP_ID", "")
    ALIPAY_APP_PRIVATE_KEY: str = os.getenv("ALIPAY_APP_PRIVATE_KEY", "")   # 应用私钥(PEM)
    ALIPAY_PUBLIC_KEY: str = os.getenv("ALIPAY_PUBLIC_KEY", "")             # 支付宝公钥(PEM)
    ALIPAY_GATEWAY: str = os.getenv("ALIPAY_GATEWAY", "https://openapi.alipay.com/gateway.do")
    ALIPAY_NOTIFY_URL: str = os.getenv("ALIPAY_NOTIFY_URL", "")             # 异步通知回调
    ALIPAY_RETURN_URL: str = os.getenv("ALIPAY_RETURN_URL", "")            # 同步跳转
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_API_BASE: str = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")

    # OCR / Detection fallback
    TESSERACT_CMD: str = os.getenv("TESSERACT_CMD", "tesseract")
    TESSERACT_LANG: str = os.getenv("TESSERACT_LANG", "jpn+chi_sim+eng+kor")

    # P0: PaddleOCR v4 引擎配置
    PADDLEOCR_ENABLED: str = os.getenv("PADDLEOCR_ENABLED", "true")
    OCR_ENGINE_ORDER: str = os.getenv("OCR_ENGINE_ORDER", "mangaocr,paddleocr")
    OCR_CONFIDENCE_RETRY_THRESHOLD: str = os.getenv("OCR_CONFIDENCE_RETRY_THRESHOLD", "0.65")
    PADDLEOCR_MODEL_DIR: str = os.getenv("PADDLEOCR_MODEL_DIR", "")

    # Font directory for rendering
    FONT_DIR: str = os.getenv("FONT_DIR", "/app/fonts")

    # File Limits
    MAX_IMAGE_SIZE_MB: int = int(os.getenv("MAX_IMAGE_SIZE_MB", "50"))
    MAX_ARCHIVE_SIZE_MB: int = int(os.getenv("MAX_ARCHIVE_SIZE_MB", "500"))
    MAX_FONT_SIZE_MB: int = int(os.getenv("MAX_FONT_SIZE_MB", "20"))
    FREE_MAX_PROJECTS: int = int(os.getenv("FREE_MAX_PROJECTS", "10"))
    FREE_MAX_PAGES_PER_BATCH: int = int(os.getenv("FREE_MAX_PAGES_PER_BATCH", "50"))
    PREMIUM_MAX_PAGES_PER_BATCH: int = int(os.getenv("PREMIUM_MAX_PAGES_PER_BATCH", "200"))

    # Cleanup
    TEMP_FILE_RETENTION_DAYS: int = int(os.getenv("TEMP_FILE_RETENTION_DAYS", "7"))
    TRASH_RETENTION_DAYS: int = int(os.getenv("TRASH_RETENTION_DAYS", "30"))

    # CORS
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:5173")

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]


settings = Settings()
