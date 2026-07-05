from __future__ import annotations
"""
文件上传/解析服务
负责：上传、分片上传、多格式解析（CBZ/ZIP/RAR/7Z/PDF）、预处理管线
"""
import hashlib
import logging
import mimetypes
import os
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, BinaryIO

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.core.config import settings
from common.core.exceptions import AppException

logger = logging.getLogger(__name__)

# 支持的图片格式
SUPPORTED_IMAGE_MIME = {
    "image/png", "image/jpeg", "image/webp", "image/bmp",
    "image/tiff", "image/gif",
}
SUPPORTED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}

# 支持的压缩包格式
SUPPORTED_ARCHIVE_MIME = {
    "application/zip",
    "application/x-cbz",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
    "application/vnd.comicbook+zip",
    "application/vnd.rar",
    "application/x-tar",
}
SUPPORTED_ARCHIVE_EXT = {".zip", ".cbz", ".rar", ".cbr", ".7z", ".cb7", ".tar", ".pdf"}

# 上传限制
MAX_IMAGE_SIZE = 50 * 1024 * 1024      # 50MB
MAX_ARCHIVE_SIZE = 500 * 1024 * 1024    # 500MB
CHUNK_SIZE = 5 * 1024 * 1024            # 5MB 分片大小


@dataclass
class PageInfo:
    """解析出的页面信息"""
    file_name: str
    sort_order: int
    width: int = 0
    height: int = 0
    file_size: int = 0
    mime_type: str = "image/png"
    thumbnail_file_name: Optional[str] = None  # 缩略图文件名（若已生成）


@dataclass
class UploadResult:
    """上传结果"""
    file_url: str
    file_name: str
    file_size: int
    mime_type: str
    checksum: str
    pages: Optional[List[PageInfo]] = None
    source_archive_path: Optional[str] = None  # 源归档文件路径（用于 PDF 按需渲染）


class FileService:
    """文件上传与解析服务"""

    def __init__(self, storage_path: Optional[str] = None):
        self.storage_path = storage_path or os.path.join(
            settings.UPLOAD_DIR if hasattr(settings, "UPLOAD_DIR") else "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/data/uploads",
            "uploads",
        )
        os.makedirs(self.storage_path, exist_ok=True)

    def validate_upload(self, file_name: str, file_size: int, file_content_type: str) -> Tuple[str, bool]:
        """
        验证上传文件。
        返回: (类别: "image"|"archive"|None, 是否合法)
        """
        ext = os.path.splitext(file_name)[1].lower()

        # 判断是否为图片
        if ext in SUPPORTED_IMAGE_EXT or file_content_type in SUPPORTED_IMAGE_MIME:
            if file_size > MAX_IMAGE_SIZE:
                raise AppException(
                    code=4001,
                    message=f"Image file too large (max {MAX_IMAGE_SIZE // (1024*1024)}MB)",
                    status_code=413,
                )
            return ("image", True)

        # 判断是否为压缩包/PDF
        if ext in SUPPORTED_ARCHIVE_EXT or file_content_type in SUPPORTED_ARCHIVE_MIME:
            if file_size > MAX_ARCHIVE_SIZE:
                raise AppException(
                    code=4002,
                    message=f"Archive file too large (max {MAX_ARCHIVE_SIZE // (1024*1024)}MB)",
                    status_code=413,
                )
            return ("archive", True)

        raise AppException(
            code=4003,
            message=f"Unsupported file type: {ext or file_content_type}",
            status_code=415,
        )

    async def upload_single_image(
        self, file_content: bytes, file_name: str, file_size: int, user_id: str
    ) -> UploadResult:
        """上传单张图片"""
        ext = os.path.splitext(file_name)[1].lower()
        mime_type = mimetypes.guess_type(file_name)[0] or "image/png"

        # 保存文件
        checksum = hashlib.sha256(file_content).hexdigest()
        stored_name = f"{uuid.uuid4().hex}{ext}"
        user_dir = os.path.join(self.storage_path, user_id, "originals")
        os.makedirs(user_dir, exist_ok=True)

        file_path = os.path.join(user_dir, stored_name)
        with open(file_path, "wb") as f:
            f.write(file_content)

        # 估算图片尺寸
        width, height = self._estimate_image_size(file_content, ext)

        return UploadResult(
            file_url=f"/storage/{user_id}/originals/{stored_name}",
            file_name=file_name,
            file_size=file_size,
            mime_type=mime_type,
            checksum=checksum,
        )

    async def upload_and_parse_archive(
        self, file_content: bytes, file_name: str, file_size: int, user_id: str
    ) -> UploadResult:
        """
        上传并解析压缩包（CBZ/ZIP/RAR/7Z/PDF）。
        返回解析出的页面列表。
        """
        ext = os.path.splitext(file_name)[1].lower()
        mime_type = mimetypes.guess_type(file_name)[0] or "application/zip"

        # 保存原始文件
        checksum = hashlib.sha256(file_content).hexdigest()
        user_dir = os.path.join(self.storage_path, user_id, "archives")
        os.makedirs(user_dir, exist_ok=True)

        archive_path = os.path.join(user_dir, f"{uuid.uuid4().hex}{ext}")
        with open(archive_path, "wb") as f:
            f.write(file_content)

        logger.info(f"Archive saved: {archive_path} ({file_size} bytes, format: {ext})")

        # 解析提取页面
        pages = await self._parse_archive_pages(archive_path, user_id, ext)
        logger.info(f"Archive parsed: {len(pages)} pages extracted from {file_name}")

        return UploadResult(
            file_url=f"/storage/{user_id}/archives/{os.path.basename(archive_path)}",
            file_name=file_name,
            file_size=file_size,
            mime_type=mime_type,
            checksum=checksum,
            pages=pages,
            source_archive_path=archive_path if ext == ".pdf" else None,
        )

    async def upload_chunk(
        self, chunk_data: bytes, upload_id: str, chunk_index: int, total_chunks: int,
        file_name: str, user_id: str,
    ) -> Dict[str, object]:
        """
        处理分片上传。
        返回: {"chunk_index": int, "received": bool, "complete": bool, "upload_id": str}
        """
        chunk_dir = os.path.join(self.storage_path, user_id, "chunks", upload_id)
        os.makedirs(chunk_dir, exist_ok=True)

        # 保存分片
        chunk_path = os.path.join(chunk_dir, f"chunk_{chunk_index:06d}")
        with open(chunk_path, "wb") as f:
            f.write(chunk_data)

        # 检查是否所有分片已到齐
        received_chunks = len([
            f for f in os.listdir(chunk_dir) if f.startswith("chunk_")
        ])

        complete = received_chunks >= total_chunks

        return {
            "chunk_index": chunk_index,
            "received": True,
            "complete": complete,
            "upload_id": upload_id,
            "received_count": received_chunks,
            "total_chunks": total_chunks,
        }

    async def merge_chunks(self, upload_id: str, file_name: str, user_id: str) -> UploadResult:
        """合并分片并解析"""
        chunk_dir = os.path.join(self.storage_path, user_id, "chunks", upload_id)
        merged_dir = os.path.join(self.storage_path, user_id, "merged")
        os.makedirs(merged_dir, exist_ok=True)

        ext = os.path.splitext(file_name)[1].lower()
        merged_path = os.path.join(merged_dir, f"{upload_id}{ext}")

        # 按序号合并
        chunk_files = sorted(
            [f for f in os.listdir(chunk_dir) if f.startswith("chunk_")],
            key=lambda x: int(x.split("_")[1]),
        )

        total_size = 0
        with open(merged_path, "wb") as out_f:
            for cf in chunk_files:
                chunk_path = os.path.join(chunk_dir, cf)
                with open(chunk_path, "rb") as in_f:
                    data = in_f.read()
                    out_f.write(data)
                    total_size += len(data)

        # 清理分片目录
        for cf in chunk_files:
            os.remove(os.path.join(chunk_dir, cf))
        os.rmdir(chunk_dir)

        # 根据文件类型决定是单图上传还是压缩包解析
        if ext in SUPPORTED_IMAGE_EXT:
            with open(merged_path, "rb") as f:
                content = f.read()
            os.remove(merged_path)
            return await self.upload_single_image(content, file_name, total_size, user_id)
        else:
            return await self.upload_and_parse_archive(
                open(merged_path, "rb").read(), file_name, total_size, user_id
            )

    async def _parse_archive_pages(
        self, archive_path: str, user_id: str, ext: str
    ) -> List[PageInfo]:
        """
        解析压缩包，提取页面列表。
        支持 ZIP/CBZ、RAR/CBR、7Z/CB7、PDF 格式。
        """
        pages: List[PageInfo] = []

        logger.info(f"Parsing archive: ext={ext}, path={os.path.basename(archive_path)}")

        if ext in (".zip", ".cbz"):
            pages = await self._parse_zip(archive_path, user_id)
        elif ext in (".rar", ".cbr"):
            pages = await self._parse_rar(archive_path, user_id)
        elif ext in (".7z", ".cb7"):
            pages = await self._parse_7z(archive_path, user_id)
        elif ext == ".pdf":
            pages = await self._parse_pdf(archive_path, user_id)
        else:
            # 最后尝试 ZIP 回退
            try:
                pages = await self._parse_zip(archive_path, user_id)
            except Exception:
                raise AppException(
                    code=4004,
                    message=f"Archive format '{ext}' is not supported. Supported: ZIP/CBZ, RAR/CBR, 7Z/CB7, PDF",
                    status_code=415,
                )

        return pages

    async def _parse_zip(self, archive_path: str, user_id: str) -> List[PageInfo]:
        """解析 ZIP/CBZ 文件"""
        import zipfile
        import shutil

        extract_dir = os.path.join(self.storage_path, user_id, "extracted", uuid.uuid4().hex)
        os.makedirs(extract_dir, exist_ok=True)

        # 确保永久存储目录存在
        originals_dir = os.path.join(self.storage_path, user_id, "originals")
        os.makedirs(originals_dir, exist_ok=True)

        pages: List[PageInfo] = []
        try:
            with zipfile.ZipFile(archive_path, "r") as zf:
                # 过滤出图片文件并按文件名排序
                image_entries = sorted(
                    [e for e in zf.infolist()
                     if not e.is_dir() and os.path.splitext(e.filename)[1].lower() in SUPPORTED_IMAGE_EXT],
                    key=lambda e: e.filename.lower(),
                )

                for idx, entry in enumerate(image_entries):
                    zf.extract(entry, extract_dir)
                    extracted_path = os.path.join(extract_dir, entry.filename)

                    # 保存到永久存储目录（UUID 命名避免冲突）
                    ext = os.path.splitext(entry.filename)[1].lower()
                    stored_name = f"{uuid.uuid4().hex}{ext}"
                    permanent_path = os.path.join(originals_dir, stored_name)
                    shutil.copy2(extracted_path, permanent_path)

                    width, height = self._estimate_image_size(
                        open(extracted_path, "rb").read(),
                        ext,
                    )

                    pages.append(PageInfo(
                        file_name=stored_name,
                        sort_order=idx,
                        width=width,
                        height=height,
                        file_size=entry.file_size,
                        mime_type=mimetypes.guess_type(entry.filename)[0] or "image/png",
                    ))

        finally:
            # 清理提取目录
            shutil.rmtree(extract_dir, ignore_errors=True)

        return pages

    async def _parse_rar(self, archive_path: str, user_id: str) -> List[PageInfo]:
        """解析 RAR/CBR 文件，提取图片页面"""
        import shutil

        pages: List[PageInfo] = []

        # 确保永久存储目录存在
        originals_dir = os.path.join(self.storage_path, user_id, "originals")
        os.makedirs(originals_dir, exist_ok=True)

        try:
            import rarfile
            logger.info(f"_parse_rar: opening {archive_path}, rarfile tool={rarfile.UNRAR_TOOL}, "
                       f"tool_setup={rarfile.tool_setup()}")

            with rarfile.RarFile(archive_path, "r") as rf:
                # List ALL entries in the archive for debugging
                all_names = rf.namelist()
                logger.info(f"_parse_rar: total entries={len(all_names)}")

                # Filter image files using namelist() for reliability
                # Normalize Windows-style backslashes to forward slashes
                image_names = sorted([
                    name for name in all_names
                    if os.path.splitext(name.replace("\\", "/"))[1].lower() in SUPPORTED_IMAGE_EXT
                ], key=lambda n: n.lower())

                logger.info(f"_parse_rar: image entries={len(image_names)}, "
                           f"first 5={image_names[:5] if image_names else 'NONE'}")

                if not image_names:
                    # Debug: show what extensions ARE in the archive
                    all_exts = set(
                        os.path.splitext(n.replace("\\", "/"))[1].lower() for n in all_names
                    )
                    # Check if RAR contains PDF or nested archives
                    has_pdf = ".pdf" in all_exts
                    has_nested_rar = any(ext in (".rar", ".cbr") for ext in all_exts)
                    has_zip = any(ext in (".zip", ".cbz") for ext in all_exts)
                    
                    logger.warning(f"_parse_rar: no image files found. "
                                  f"Extensions in archive: {all_exts}. "
                                  f"Supported image extensions: {SUPPORTED_IMAGE_EXT}")
                    
                    detail_parts = []
                    if has_pdf:
                        detail_parts.append("PDF文件（请直接上传PDF格式）")
                    if has_nested_rar:
                        detail_parts.append("嵌套RAR压缩包（请解压后上传内部图片）")
                    if has_zip:
                        detail_parts.append("嵌套ZIP压缩包（请解压后上传内部图片）")
                    
                    detail = "；".join(detail_parts) if detail_parts else \
                             f"压缩包内仅含 {', '.join(sorted(all_exts))} 格式文件"
                    
                    raise AppException(
                        code=4005,
                        message=f"RAR文件中未找到图片文件。{detail}",
                        status_code=415,
                    )

                for idx, name in enumerate(image_names):
                    try:
                        # Normalize path separator (Windows → Unix)
                        safe_name = name.replace("\\", "/")
                        base_name = os.path.basename(safe_name)
                        ext = os.path.splitext(base_name)[1].lower()

                        # Read file content directly (avoids extract path issues)
                        img_bytes = rf.read(name)
                        file_size = len(img_bytes)

                        # Save to permanent storage
                        stored_name = f"{uuid.uuid4().hex}{ext}"
                        permanent_path = os.path.join(originals_dir, stored_name)
                        with open(permanent_path, "wb") as f:
                            f.write(img_bytes)

                        width, height = self._estimate_image_size(img_bytes, ext)

                        pages.append(PageInfo(
                            file_name=stored_name,
                            sort_order=idx,
                            width=width,
                            height=height,
                            file_size=file_size,
                            mime_type=mimetypes.guess_type(base_name)[0] or "image/png",
                        ))
                    except Exception as entry_err:
                        logger.warning(f"_parse_rar: failed to extract '{name}': {entry_err}")
                        continue

        except ImportError:
            raise AppException(
                code=4004,
                message="RAR support requires 'rarfile' package. Install: pip install rarfile",
                status_code=415,
            )
        except rarfile.Error as e:
            logger.error(f"_parse_rar: rarfile error for {archive_path}: {e}", exc_info=True)
            raise AppException(
                code=4005,
                message=f"Failed to parse RAR file: {str(e)}",
                status_code=415,
            )

        logger.info(f"_parse_rar: extracted {len(pages)} pages from RAR")
        return pages

    async def _parse_7z(self, archive_path: str, user_id: str) -> List[PageInfo]:
        """解析 7Z/CB7 文件，提取图片页面"""
        import shutil

        pages: List[PageInfo] = []

        # 确保永久存储目录存在
        originals_dir = os.path.join(self.storage_path, user_id, "originals")
        os.makedirs(originals_dir, exist_ok=True)

        try:
            import py7zr
            extract_dir = os.path.join(self.storage_path, user_id, "extracted", uuid.uuid4().hex)
            os.makedirs(extract_dir, exist_ok=True)

            try:
                with py7zr.SevenZipFile(archive_path, "r") as szf:
                    # 获取所有文件名并过滤图片
                    all_files = szf.getnames()
                    image_files = sorted(
                        [f for f in all_files
                         if os.path.splitext(f)[1].lower() in SUPPORTED_IMAGE_EXT],
                        key=lambda f: f.lower(),
                    )

                    if image_files:
                        szf.extract(extract_dir, targets=image_files)

                    for idx, file_name in enumerate(image_files):
                        extracted_path = os.path.join(extract_dir, file_name)
                        if not os.path.isfile(extracted_path):
                            continue

                        # 保存到永久存储目录
                        ext = os.path.splitext(file_name)[1].lower()
                        stored_name = f"{uuid.uuid4().hex}{ext}"
                        permanent_path = os.path.join(originals_dir, stored_name)
                        shutil.copy2(extracted_path, permanent_path)

                        file_size = os.path.getsize(extracted_path)
                        with open(extracted_path, "rb") as f:
                            img_bytes = f.read()
                        width, height = self._estimate_image_size(img_bytes, ext)

                        pages.append(PageInfo(
                            file_name=stored_name,
                            sort_order=idx,
                            width=width,
                            height=height,
                            file_size=file_size,
                            mime_type=mimetypes.guess_type(file_name)[0] or "image/png",
                        ))
            finally:
                shutil.rmtree(extract_dir, ignore_errors=True)

        except ImportError:
            raise AppException(
                code=4004,
                message="7Z support requires 'py7zr' package. Install: pip install py7zr",
                status_code=415,
            )
        except Exception as e:
            raise AppException(
                code=4005,
                message=f"Failed to parse 7Z file: {str(e)}",
                status_code=415,
            )

        return pages

    async def _parse_pdf(self, archive_path: str, user_id: str) -> List[PageInfo]:
        """
        解析 PDF 文件 - 快速获取页面元数据（页数、尺寸）。
        不在此阶段渲染图片，避免上传时阻塞过久。
        页面图片将在需要时按需渲染（lazy rendering）。
        """
        pages: List[PageInfo] = []

        try:
            import fitz  # PyMuPDF
        except ImportError:
            logger.warning("PyMuPDF (fitz) not installed — falling back to single-page placeholder")
            pages.append(PageInfo(
                file_name="page_0001.png",
                sort_order=0,
                width=0,
                height=0,
                file_size=0,
                mime_type="image/png",
            ))
            return pages

        try:
            doc = fitz.open(archive_path)
        except Exception as e:
            logger.error(f"Failed to open PDF with PyMuPDF: {archive_path}, error: {e}")
            raise AppException(
                code=4005,
                message=f"Failed to open PDF file: {str(e)}. File may be corrupted or password-protected.",
                status_code=415,
            )

        try:
            total_pages = len(doc)
            logger.info(f"PDF parsing: {total_pages} pages found in {os.path.basename(archive_path)}")

            if total_pages == 0:
                doc.close()
                logger.warning(f"PDF has 0 pages: {archive_path}")
                raise AppException(
                    code=4005,
                    message="PDF file contains no pages",
                    status_code=415,
                )

            for idx in range(total_pages):
                page = doc[idx]
                rect = page.rect

                # 快速计算渲染后尺寸（不实际渲染，极快）
                pix_width = int(rect.width * 2.0)
                pix_height = int(rect.height * 2.0)

                pages.append(PageInfo(
                    file_name=f"page_{idx + 1:04d}.png",
                    sort_order=idx,
                    width=pix_width,
                    height=pix_height,
                    file_size=0,  # 按需渲染时才确定
                    mime_type="image/png",
                ))

            logger.info(f"PDF parsed successfully: {len(pages)} pages extracted")
        finally:
            if not doc.is_closed:
                doc.close()

        return pages

    def render_single_pdf_page(self, pdf_path: str, page_index: int, user_id: str, zoom: float = 2.0) -> Tuple[bytes, int, int]:
        """
        按需渲染 PDF 的单个页面为 PNG。
        
        参数:
            pdf_path: PDF 文件路径
            page_index: 页面索引（从 0 开始）
            user_id: 用户 ID
            zoom: 缩放倍率（默认 2.0 用于原图，0.3 用于缩略图）
        
        返回:
            (png_bytes, width, height)
        """
        try:
            import fitz  # PyMuPDF

            doc = fitz.open(pdf_path)
            try:
                if page_index < 0 or page_index >= len(doc):
                    raise ValueError(f"Page index {page_index} out of range (0-{len(doc)-1})")

                page = doc[page_index]
                mat = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=mat)
                png_bytes = pix.tobytes("png")

                return (png_bytes, pix.width, pix.height)
            finally:
                doc.close()

        except ImportError:
            raise AppException(
                code=4004,
                message="PDF rendering requires PyMuPDF. Install: pip install PyMuPDF",
                status_code=500,
            )

    def render_pdf_page_thumbnail(self, pdf_path: str, page_index: int, user_id: str, thumb_width: int = 200) -> Tuple[bytes, int, int]:
        """
        渲染 PDF 单页的缩略图（低分辨率 PNG）。
        根据目标宽度自动计算 zoom 倍率。
        
        返回:
            (png_bytes, width, height) — JPEG 字节流
        """
        try:
            import fitz
            from PIL import Image
            import io as io_module

            doc = fitz.open(pdf_path)
            try:
                page = doc[page_index]
                rect = page.rect
                # 计算 zoom 使渲染宽度约为 thumb_width*2（保证缩略图清晰度）
                zoom = (thumb_width * 2) / rect.width
                mat = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=mat)
                png_bytes = pix.tobytes("png")

                # 用 PIL 缩放到目标尺寸并转为 JPEG
                img = Image.open(io_module.BytesIO(png_bytes)).convert("RGB")
                w, h = img.size
                ratio = thumb_width / w
                new_h = int(h * ratio)
                img = img.resize((thumb_width, new_h), Image.LANCZOS)

                thumb_buffer = io_module.BytesIO()
                img.save(thumb_buffer, format="JPEG", quality=70)
                return (thumb_buffer.getvalue(), thumb_width, new_h)
            finally:
                doc.close()
        except ImportError:
            # 回退：渲染小尺寸 PNG
            return self.render_single_pdf_page(pdf_path, page_index, user_id, zoom=0.2)

    # ===== 预处理管线 =====

    def preprocess(self, image_bytes: bytes, operations: Optional[List[str]] = None) -> bytes:
        """
        图像预处理管线。
        支持: deskew(倾斜校正), crop_black(黑边裁剪), dedup(重复检测),
              enhance(曝光优化), resize(缩放)
        当前 MVP 阶段返回原始图像，后续接入真实处理。
        """
        if not operations:
            return image_bytes  # MVP: 直通模式

        # 预留预处理管线
        processed = image_bytes
        for op in operations:
            if op == "deskew":
                processed = self._deskew(processed)
            elif op == "crop_black":
                processed = self._crop_black_border(processed)
            elif op == "enhance":
                processed = self._auto_enhance(processed)
            # dedup 需要与已有页面比较，由上层调用

        return processed

    def _deskew(self, image_bytes: bytes) -> bytes:
        """倾斜校正（MVP: 直通）"""
        return image_bytes

    def _crop_black_border(self, image_bytes: bytes) -> bytes:
        """黑边裁剪（MVP: 直通）"""
        return image_bytes

    def _auto_enhance(self, image_bytes: bytes) -> bytes:
        """自动曝光优化（MVP: 直通）"""
        return image_bytes

    def _estimate_image_size(self, image_bytes: bytes, ext: str) -> Tuple[int, int]:
        """估算图片宽度和高度"""
        try:
            import struct

            if ext in (".png",):
                if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
                    w, h = struct.unpack(">II", image_bytes[16:24])
                    return (w, h)
            elif ext in (".jpg", ".jpeg"):
                data = image_bytes
                idx = 2
                while idx < len(data) - 9:
                    if data[idx] != 0xFF:
                        break
                    marker = data[idx + 1]
                    if marker in (0xC0, 0xC1, 0xC2):
                        h, w = struct.unpack(">HH", data[idx + 5:idx + 9])
                        return (w, h)
                    length = struct.unpack(">H", data[idx + 2:idx + 4])[0]
                    idx += 2 + length
            elif ext == ".gif":
                w, h = struct.unpack("<HH", image_bytes[6:10])
                return (w, h)
            elif ext == ".webp":
                if len(image_bytes) >= 30 and image_bytes[:4] == b"RIFF":
                    chunk_header = image_bytes[12:16]
                    if chunk_header == b"VP8 " and len(image_bytes) >= 28:
                        w = struct.unpack("<H", image_bytes[24:26])[0] & 0x3FFF
                        h = struct.unpack("<H", image_bytes[26:28])[0] & 0x3FFF
                        return (w, h)
                    elif chunk_header == b"VP8L" and len(image_bytes) >= 25:
                        bits = struct.unpack("<I", image_bytes[21:25])[0]
                        w = (bits & 0x3FFF) + 1
                        h = ((bits >> 14) & 0x3FFF) + 1
                        return (w, h)
            elif ext in (".bmp",):
                if len(image_bytes) >= 26:
                    w, h = struct.unpack("<ii", image_bytes[18:26])
                    if w > 0 and h > 0:
                        return (w, abs(h))
            elif ext in (".tiff", ".tif"):
                if len(image_bytes) >= 8:
                    le = image_bytes[:2] == b"II"
                    ifle = not le
                    if ifle:
                        w = struct.unpack("<H", image_bytes[18:20])[0]
                        h = struct.unpack("<H", image_bytes[22:24])[0]
                    else:
                        w = struct.unpack(">H", image_bytes[18:20])[0]
                        h = struct.unpack(">H", image_bytes[22:24])[0]
                    if w > 0 and h > 0:
                        return (w, h)
        except Exception:
            pass

        return (0, 0)

    def cleanup_temp_files(self, user_id: str, upload_id: Optional[str] = None):
        """清理临时上传文件"""
        if upload_id:
            chunk_dir = os.path.join(self.storage_path, user_id, "chunks", upload_id)
            import shutil
            shutil.rmtree(chunk_dir, ignore_errors=True)
