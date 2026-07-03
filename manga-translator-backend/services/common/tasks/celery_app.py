from __future__ import annotations
"""
Celery application configuration.
"""
from celery import Celery
from common.core.config import settings

celery_app = Celery(
    "manga_translator",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "common.tasks.image_tasks",
        "common.tasks.translation",
        "common.tasks.export",
        "common.tasks.notification",
        "common.tasks.pipeline_tasks",
        "common.tasks.moderation_tasks",
        "common.tasks.cleanup",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,
    task_soft_time_limit=25 * 60,
    worker_max_tasks_per_child=200,
    worker_prefetch_multiplier=1,
    # Celery Beat 定时任务调度
    beat_schedule={
        "cleanup-expired-trash": {
            "task": "common.tasks.cleanup.cleanup_expired_trash",
            "schedule": 86400.0,  # 每天执行一次 (24小时 = 凌晨3:00效果由启动时间决定)
            "options": {"expires": 3600},
        },
        "cleanup-old-notifications": {
            "task": "common.tasks.cleanup.cleanup_old_notifications",
            "schedule": 86400.0,  # 每天执行一次
            "options": {"expires": 1800},
        },
        "cleanup-expired-premium": {
            "task": "common.tasks.cleanup.cleanup_expired_premium",
            "schedule": 86400.0,  # 每天执行一次
            "options": {"expires": 1800},
        },
    },
)
