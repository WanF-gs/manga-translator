from __future__ import annotations
"""格式转换服务 - 真实实现（基于 Pillow）"""
import io
import os
import logging
from typing import List

from PIL import Image

logger = logging.getLogger(__name__)


class FormatConverter:
    """格式转换器（基于 Pillow）"""

    SUPPORTED_CONVERSIONS = {
        "png": ["jpg", "webp", "pdf"],
        "jpg": ["png", "webp", "pdf"],
        "jpeg": ["png", "webp", "pdf"],
        "webp": ["png", "jpg", "jpeg", "pdf"],
        "pdf": ["png", "jpg", "jpeg"],
    }

    PILLOW_FORMATS = {
        "png": "PNG", "jpg": "JPEG", "jpeg": "JPEG", "webp": "WEBP",
    }

    @staticmethod
    async def convert(
        source_path: str,
        target_format: str,
        quality: int = 90,
    ) -> dict:
        """转换单个文件格式"""
        target_format = target_format.lower()
        source_ext = source_path.rsplit(".", 1)[-1].lower() if "." in source_path else "png"

        try:
            img = Image.open(source_path)

            output_path = source_path.rsplit(".", 1)[0] + f".{target_format}"
            pillow_format = FormatConverter.PILLOW_FORMATS.get(
                target_format, "PNG"
            )

            save_kwargs = {"format": pillow_format}
            if pillow_format in ("JPEG", "WEBP"):
                save_kwargs["quality"] = quality
                save_kwargs["optimize"] = True

            img.convert("RGB").save(output_path, **save_kwargs)
            file_size_mb = os.path.getsize(output_path) / (1024 * 1024)

            return {
                "status": "ok",
                "source_format": source_ext,
                "target_format": target_format,
                "output_path": output_path,
                "quality": quality,
                "file_size": f"{file_size_mb:.1f}MB",
            }
        except Exception as e:
            logger.error(f"Format conversion failed: {e}")
            return {
                "status": "error",
                "source_format": source_ext,
                "target_format": target_format,
                "error": str(e),
            }

    @staticmethod
    async def batch_convert(
        file_paths: list,
        target_format: str,
        quality: int = 90,
    ) -> dict:
        """批量格式转换"""
        import tempfile
        import shutil

        output_dir = os.path.join(tempfile.gettempdir(), "manga_export_batch")
        os.makedirs(output_dir, exist_ok=True)

        converted = 0
        errors = []

        for fp in file_paths:
            try:
                img = Image.open(fp) if os.path.isfile(fp) else None
                if img is None:
                    errors.append(f"Cannot open: {fp}")
                    continue

                basename = os.path.basename(fp).rsplit(".", 1)[0]
                output_path = os.path.join(
                    output_dir, f"{basename}.{target_format}"
                )
                pillow_format = FormatConverter.PILLOW_FORMATS.get(
                    target_format, "PNG"
                )
                save_kwargs = {"format": pillow_format}
                if pillow_format in ("JPEG", "WEBP"):
                    save_kwargs["quality"] = quality
                    save_kwargs["optimize"] = True

                img.convert("RGB").save(output_path, **save_kwargs)
                converted += 1
            except Exception as e:
                errors.append(f"{fp}: {str(e)}")

        return {
            "status": "ok",
            "total": len(file_paths),
            "converted": converted,
            "errors": errors,
            "target_format": target_format,
            "output_dir": output_dir,
        }

    @staticmethod
    async def create_archive(
        file_paths: list,
        archive_format: str = "zip",
        base_name: str = "export",
    ) -> dict:
        """创建压缩包"""
        import zipfile
        import tempfile

        archive_format = archive_format.lower()
        if archive_format not in ("zip", "cbz"):
            archive_format = "zip"

        output_dir = os.path.join(tempfile.gettempdir(), "manga_exports")
        os.makedirs(output_dir, exist_ok=True)
        archive_path = os.path.join(output_dir, f"{base_name}.{archive_format}")

        valid_files = [f for f in file_paths if os.path.isfile(f)]

        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for fp in valid_files:
                zf.write(fp, os.path.basename(fp))

        file_size_mb = os.path.getsize(archive_path) / (1024 * 1024)

        return {
            "status": "ok",
            "archive_path": archive_path,
            "file_count": len(valid_files),
            "file_size": f"{file_size_mb:.1f}MB",
            "format": archive_format,
        }
