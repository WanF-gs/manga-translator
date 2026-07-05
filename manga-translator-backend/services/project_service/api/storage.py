from __future__ import annotations
"""
Storage file serving endpoint.
Serves uploaded files (images, archives) from local filesystem or MinIO.
"""
import io
import os
import mimetypes

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.config import settings

router = APIRouter()

# Base directory for uploaded files
UPLOAD_DIR = getattr(settings, "UPLOAD_DIR", "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/data/uploads")
STORAGE_BASE = os.path.join(UPLOAD_DIR, "uploads")


@router.get("/storage/{file_path:path}")
async def serve_storage_file(file_path: str):
    """
    Serve a file from the storage directory.
    
    Path format: /storage/{user_id_or_bucket}/{subdir}/{filename}
    Example: /storage/7bbe8a2f-.../originals/page_0001.png
    """
    # Security: prevent path traversal
    file_path = os.path.normpath(file_path)
    if file_path.startswith("..") or os.path.isabs(file_path):
        raise HTTPException(status_code=400, detail="Invalid file path")

    full_path = os.path.join(STORAGE_BASE, file_path)
    
    if os.path.isfile(full_path):
        mime_type, _ = mimetypes.guess_type(full_path)
        if mime_type is None:
            mime_type = "application/octet-stream"
        # 以 inline 提供，供 <img> 标签内联渲染；不设 filename 避免 FastAPI
        # 自动附加 Content-Disposition: attachment 导致浏览器下载而非显示。
        return FileResponse(
            full_path,
            media_type=mime_type,
            content_disposition_type="inline",
        )

    # Fallback: try MinIO (URL format: /storage/{bucket}/{object_name})
    try:
        from common.core.minio import minio_client
        bucket = settings.MINIO_BUCKET
        # If file_path starts with bucket name, strip it to get object_name
        obj_name = file_path
        if file_path.startswith(bucket + "/"):
            obj_name = file_path[len(bucket) + 1:]
        obj = minio_client.get_object(bucket, obj_name)
        data = obj.read()
        obj.close()
        obj.release_conn()
        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type is None:
            mime_type = "application/octet-stream"
        return Response(content=data, media_type=mime_type)
    except Exception:
        pass

    raise HTTPException(status_code=404, detail="File not found")
