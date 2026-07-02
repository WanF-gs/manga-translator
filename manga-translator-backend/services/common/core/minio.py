from __future__ import annotations
"""
MinIO object storage client.
"""
from minio import Minio

from .config import settings

minio_client = Minio(
    settings.MINIO_ENDPOINT,
    access_key=settings.MINIO_ACCESS_KEY,
    secret_key=settings.MINIO_SECRET_KEY,
    secure=settings.MINIO_SECURE,
)


def ensure_bucket():
    """Ensure the configured bucket exists."""
    bucket_name = settings.MINIO_BUCKET
    found = minio_client.bucket_exists(bucket_name)
    if not found:
        minio_client.make_bucket(bucket_name)


def get_minio():
    """Dependency: get MinIO client."""
    return minio_client
