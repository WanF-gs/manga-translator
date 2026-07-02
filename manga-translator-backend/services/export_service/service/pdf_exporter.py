from __future__ import annotations
"""
PDF export service for manga pages.
Uses reportlab for professional PDF generation.
"""
import io
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

import httpx
from PIL import Image
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.units import inch, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
    PageBreak, Table, TableStyle, KeepTogether,
)
from reportlab.platypus.flowables import Flowable

logger = logging.getLogger(__name__)


class MangaPageImage(Flowable):
    """Custom flowable for manga page images with captions."""
    
    def __init__(self, image_data: bytes, page_num: int, caption: str = "", width: float = None):
        Flowable.__init__(self)
        self._img_data = image_data
        self._page_num = page_num
        self._caption = caption
        self._width = width
        self._img = None
        self._load_image()
    
    def _load_image(self):
        """Load image from bytes."""
        try:
            self._img = Image.open(io.BytesIO(self._img_data))
        except Exception as e:
            logger.warning(f"Failed to load image: {e}")
    
    def wrap(self, availWidth, availHeight):
        if self._img is None:
            return (availWidth, 100)
        
        target_width = self._width or (availWidth * 0.85)
        ratio = target_width / self._img.width
        target_height = self._img.height * ratio
        
        # Add space for caption
        if self._caption:
            target_height += 20
        
        return (availWidth, min(target_height, availHeight - 10))
    
    def draw(self):
        if self._img is None:
            return
        
        canvas = self.canv
        availWidth = self.width
        target_width = self._width or (availWidth * 0.85)
        ratio = target_width / self._img.width
        target_height = self._img.height * ratio
        
        # Center horizontally
        x = (availWidth - target_width) / 2
        y = self.height - target_height
        
        # Draw page number
        if self._caption:
            canvas.setFont("Helvetica", 10)
            canvas.setFillColor(HexColor("#666666"))
            canvas.drawCentredString(availWidth / 2, self.height - 12, self._caption)
            y = self.height - target_height - 20
        
        # Convert PIL image to reportlab compatible format
        try:
            img_buffer = io.BytesIO()
            self._img.convert("RGB").save(img_buffer, format="PNG")
            img_buffer.seek(0)
            
            canvas.drawImage(
                img_buffer,
                x, y,
                width=target_width,
                height=target_height,
                preserveAspectRatio=True,
            )
        except Exception as e:
            logger.warning(f"Failed to draw image: {e}")


class PDFExporter:
    """Export manga pages as PDF documents."""

    COVER_TITLE_STYLE = ParagraphStyle(
        "CoverTitle",
        parent=getSampleStyleSheet()["Title"],
        fontSize=24,
        leading=30,
        alignment=TA_CENTER,
        spaceAfter=20,
        textColor=HexColor("#2c3e50"),
    )
    
    COVER_SUBTITLE_STYLE = ParagraphStyle(
        "CoverSubtitle",
        parent=getSampleStyleSheet()["Normal"],
        fontSize=14,
        leading=20,
        alignment=TA_CENTER,
        textColor=HexColor("#7f8c8d"),
    )

    async def export_single_page(
        self,
        image_data: bytes,
        output_buffer: io.BytesIO,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> io.BytesIO:
        """Export a single page as PDF."""
        metadata = metadata or {}
        
        doc = SimpleDocTemplate(
            output_buffer,
            pagesize=A4,
            topMargin=20 * mm,
            bottomMargin=20 * mm,
            leftMargin=15 * mm,
            rightMargin=15 * mm,
            title=metadata.get("title", "Manga Page"),
            author=metadata.get("author", "Manga Translator"),
        )
        
        story = []
        story.append(MangaPageImage(image_data, 1))
        doc.build(story)
        
        output_buffer.seek(0)
        return output_buffer

    async def export_chapter_pdf(
        self,
        pages: List[Dict[str, Any]],
        output_buffer: io.BytesIO,
        metadata: Optional[Dict[str, Any]] = None,
        right_to_left: bool = True,
    ) -> io.BytesIO:
        """
        Export a chapter as PDF.
        
        Args:
            pages: List of {image_data, page_number, caption} dicts
            output_buffer: BytesIO buffer
            metadata: {title, author, chapter_name, chapter_number}
            right_to_left: Manga reading direction
        """
        metadata = metadata or {}
        chapter_name = metadata.get("chapter_name", "Chapter")
        title = metadata.get("title", "Manga Chapter")
        author = metadata.get("author", "Manga Translator")
        
        full_title = f"{title} - {chapter_name}"
        
        doc = SimpleDocTemplate(
            output_buffer,
            pagesize=A4,
            topMargin=15 * mm,
            bottomMargin=15 * mm,
            leftMargin=12 * mm,
            rightMargin=12 * mm,
            title=full_title,
            author=author,
        )
        
        story = []
        
        # Cover page
        story.append(Spacer(1, 80 * mm))
        story.append(Paragraph(title, self.COVER_TITLE_STYLE))
        story.append(Spacer(1, 8 * mm))
        story.append(Paragraph(chapter_name, self.COVER_SUBTITLE_STYLE))
        story.append(Spacer(1, 5 * mm))
        story.append(Paragraph(f"作者: {author}", self.COVER_SUBTITLE_STYLE))
        story.append(Spacer(1, 5 * mm))
        story.append(Paragraph(
            f"导出日期: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            self.COVER_SUBTITLE_STYLE,
        ))
        story.append(Spacer(1, 5 * mm))
        story.append(Paragraph(f"共 {len(pages)} 页", self.COVER_SUBTITLE_STYLE))
        story.append(PageBreak())
        
        # Page images
        for i, page in enumerate(pages):
            image_data = page.get("image_data")
            if not image_data:
                continue
            
            page_num = page.get("page_number", i + 1)
            caption = page.get("caption", f"Page {page_num}")
            
            story.append(MangaPageImage(image_data, page_num, caption))
            story.append(Spacer(1, 5 * mm))
            
            # Add page break between pages (except last)
            if i < len(pages) - 1:
                story.append(PageBreak())
        
        doc.build(story)
        output_buffer.seek(0)
        return output_buffer

    async def export_project_pdf(
        self,
        chapters: List[Dict[str, Any]],
        output_buffer: io.BytesIO,
        metadata: Optional[Dict[str, Any]] = None,
        include_toc: bool = True,
    ) -> io.BytesIO:
        """
        Export entire project as PDF with table of contents.
        
        Args:
            chapters: List of {chapter_name, pages: [{image_data, page_number, caption}]}
            output_buffer: BytesIO buffer  
            metadata: {title, author, description}
            include_toc: Include table of contents page
        """
        metadata = metadata or {}
        title = metadata.get("title", "Manga")
        author = metadata.get("author", "Manga Translator")
        description = metadata.get("description", "")
        
        doc = SimpleDocTemplate(
            output_buffer,
            pagesize=A4,
            topMargin=15 * mm,
            bottomMargin=15 * mm,
            leftMargin=12 * mm,
            rightMargin=12 * mm,
            title=title,
            author=author,
        )
        
        story = []
        
        # Title page
        story.append(Spacer(1, 60 * mm))
        story.append(Paragraph(title, self.COVER_TITLE_STYLE))
        story.append(Spacer(1, 10 * mm))
        
        if description:
            desc_style = ParagraphStyle(
                "Description",
                parent=getSampleStyleSheet()["Normal"],
                fontSize=12,
                leading=18,
                alignment=TA_CENTER,
                textColor=HexColor("#555555"),
            )
            story.append(Paragraph(description, desc_style))
            story.append(Spacer(1, 5 * mm))
        
        story.append(Paragraph(f"作者: {author}", self.COVER_SUBTITLE_STYLE))
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(
            f"导出日期: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            self.COVER_SUBTITLE_STYLE,
        ))
        story.append(Spacer(1, 3 * mm))
        
        total_pages = sum(len(ch.get("pages", [])) for ch in chapters)
        story.append(Paragraph(f"共 {len(chapters)} 章 · {total_pages} 页", self.COVER_SUBTITLE_STYLE))
        story.append(PageBreak())
        
        # Table of contents
        if include_toc and chapters:
            toc_style = ParagraphStyle(
                "TOC",
                parent=getSampleStyleSheet()["Normal"],
                fontSize=12,
                leading=22,
                leftIndent=20,
            )
            story.append(Paragraph("目录", self.COVER_TITLE_STYLE))
            story.append(Spacer(1, 10 * mm))
            
            for i, ch in enumerate(chapters):
                ch_name = ch.get("chapter_name", f"第{i+1}章")
                ch_pages = len(ch.get("pages", []))
                story.append(Paragraph(
                    f"{i + 1}. {ch_name} ({ch_pages}页)",
                    toc_style,
                ))
            
            story.append(PageBreak())
        
        # Chapter pages
        for ch in chapters:
            ch_name = ch.get("chapter_name", "")
            pages = ch.get("pages", [])
            
            if ch_name:
                story.append(Paragraph(ch_name, self.COVER_TITLE_STYLE))
                story.append(Spacer(1, 8 * mm))
            
            for j, page in enumerate(pages):
                image_data = page.get("image_data")
                if not image_data:
                    continue
                
                page_num = page.get("page_number", j + 1)
                caption = page.get("caption", f"{ch_name} - Page {page_num}" if ch_name else f"Page {page_num}")
                
                story.append(MangaPageImage(image_data, page_num, caption))
                story.append(Spacer(1, 3 * mm))
                
                if j < len(pages) - 1:
                    story.append(PageBreak())
            
            # Page break between chapters
            story.append(PageBreak())
        
        doc.build(story)
        output_buffer.seek(0)
        return output_buffer
