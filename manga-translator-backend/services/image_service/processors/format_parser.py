from __future__ import annotations
"""文件格式解析器"""
from typing import Dict, Optional, List
import os
import zipfile


class FormatParser:
    """图像/压缩包格式解析器（真实实现）"""

    SUPPORTED_IMAGE = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"}
    SUPPORTED_ARCHIVE = {".zip", ".rar", ".cbz", ".cbr", ".7z"}

    @staticmethod
    def _count_images_in_archive(archive_path: str) -> int:
        """统计压缩包中的图片文件数量"""
        count = 0
        try:
            with zipfile.ZipFile(archive_path, "r") as zf:
                for name in zf.namelist():
                    ext = os.path.splitext(name)[1].lower()
                    if ext in FormatParser.SUPPORTED_IMAGE:
                        count += 1
        except Exception:
            count = 0
        return count

    @staticmethod
    def _list_images_in_archive(archive_path: str) -> List[str]:
        """列出压缩包中的图片文件名"""
        files = []
        try:
            with zipfile.ZipFile(archive_path, "r") as zf:
                for name in zf.namelist():
                    ext = os.path.splitext(name)[1].lower()
                    if ext in FormatParser.SUPPORTED_IMAGE:
                        files.append(name)
        except Exception:
            pass
        return files

    @staticmethod
    async def parse(file_path: str) -> Dict:
        """解析文件格式信息"""
        ext = os.path.splitext(file_path)[1].lower()

        if ext in FormatParser.SUPPORTED_IMAGE:
            return {
                "type": "image",
                "format": ext[1:].upper(),
                "mime": f"image/{'jpeg' if ext in ['.jpg','.jpeg'] else ext[1:]}",
                "pages": 1,
            }
        elif ext in FormatParser.SUPPORTED_ARCHIVE:
            real_pages = FormatParser._count_images_in_archive(file_path)
            file_list = FormatParser._list_images_in_archive(file_path)
            return {
                "type": "archive",
                "format": ext[1:].upper(),
                "pages": real_pages,
                "file_list": file_list,
            }
        else:
            return {
                "type": "unknown",
                "format": ext,
                "supported": False,
            }

    @staticmethod
    async def extract_pages(archive_path: str, output_dir: str) -> Dict:
        """解压压缩包中的页面"""
        import shutil
        extracted = []
        total = 0
        try:
            os.makedirs(output_dir, exist_ok=True)
            with zipfile.ZipFile(archive_path, "r") as zf:
                for name in zf.namelist():
                    ext = os.path.splitext(name)[1].lower()
                    if ext in FormatParser.SUPPORTED_IMAGE:
                        zf.extract(name, output_dir)
                        extracted.append(name)
                        total += 1
        except Exception:
            pass
        return {
            "status": "ok" if total > 0 else "failed",
            "total_pages": total,
            "extracted_pages": len(extracted),
            "output_dir": output_dir,
            "page_files": extracted,
        }
