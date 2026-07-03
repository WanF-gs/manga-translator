from __future__ import annotations
"""
字体解析与缺字回退引擎 — 打通 PRD §2.25 字体系统链路。

职责：
1. 按优先级把一个文字区域解析为具体的字体文件路径：
   区域显式 font_id → 区域绑定角色的 font_id → style_config.font_family 名称 → 系统默认
2. Font 行的 file_url 若指向 MinIO(用户上传字体)，下载到本地缓存并复用
3. 缺字回退（§2.25）：主字体缺字符时，沿脚本回退链找到能覆盖的备用字体
4. 返回缺字列表供前端红色标记

被 render_service 调用，替代原先只认 style_config.font_family 的单一逻辑。
"""
import os
import logging
from typing import Optional, List, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# 复用 image_service.processors.text_layout 的脚本检测 + 回退链（原为死代码，现接线）
try:
    from processors.text_layout import (
        detect_text_script,
        check_glyph_coverage,
        FALLBACK_CHAINS,
    )
except Exception:  # pragma: no cover - 兼容不同运行目录
    try:
        from image_service.processors.text_layout import (
            detect_text_script, check_glyph_coverage, FALLBACK_CHAINS,
        )
    except Exception:
        detect_text_script = None
        check_glyph_coverage = None
        FALLBACK_CHAINS = {}

# 字体文件本地缓存目录（下载的 MinIO 字体）
FONT_CACHE_DIR = os.getenv("FONT_CACHE_DIR", "/tmp/manga-font-cache")

# 系统/内置字体搜索路径（与 render_service 保持一致 + 追加后端根 fonts 目录）
_SVC_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# _SVC_ROOT = services/，但 fonts/ 在 mang-translator-backend/fonts/（services 的父目录）
_BACKEND_ROOT = os.path.dirname(_SVC_ROOT)  # manga-translator-backend/
FONT_SEARCH_PATHS = [
    os.getenv("FONT_DIR", "/app/fonts"),
    os.path.join(_BACKEND_ROOT, "fonts"),       # manga-translator-backend/fonts
    os.path.join(_SVC_ROOT, "fonts"),           # services/fonts (兜底)
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "/usr/share/fonts/truetype/noto",
    "/usr/share/fonts/opentype/noto",
    "C:/Windows/Fonts",
]

# 内置字体逻辑名 → 实际文件名候选（seed 数据里用逻辑名，这里做落地映射）
BUILTIN_FONT_FILES = {
    # 标准对话（无衬线，高可读性）
    "系统默认对话字体": ["NotoSansSC-Regular.otf", "NotoSansSC-VF.ttf", "msyh.ttc", "simsun.ttc"],
    # 热血/力量风格
    "热血漫风格字体": ["NotoSansSC-Bold.otf", "msyhbd.ttc", "NotoSansSC-Regular.otf"],
    # 少女/温馨/柔软风格（霞鹜文楷）
    "少女漫风格字体": ["LXGWWenKai-Regular.ttf", "NotoSansSC-Regular.otf"],
    # 旁白（清晰正文/楷体）
    "旁白标准字体": ["LXGWWenKai-Regular.ttf", "NotoSansSC-Regular.otf", "simsun.ttc"],
    # 拟声词/效果字（粗体冲击）
    "拟声词特效字体": ["NotoSansSC-Bold.otf", "msyhbd.ttc", "NotoSansSC-Regular.otf"],
    # 手写/随性风格
    "手写风格字体": ["LXGWWenKai-Regular.ttf", "NotoSansSC-Regular.otf"],
    # 恐怖/悬疑（粗体压抑）
    "恐怖漫氛围字体": ["NotoSansSC-Bold.otf", "simhei.ttf", "NotoSansSC-Regular.otf"],
    # 标题装饰（粗体/display）
    "标题装饰字体": ["NotoSansSC-Bold.otf", "msyhbd.ttc", "NotoSansSC-VF.ttf"],
    # 日语专用
    "日语默认字体": ["NotoSansJP-Regular.otf", "NotoSansSC-Regular.otf", "NotoSansCJK-Regular.ttc"],
    "日语粗体": ["NotoSansJP-Bold.otf", "NotoSansSC-Bold.otf", "NotoSansCJK-Bold.ttc"],
    # 韩语专用
    "韩语默认字体": ["NotoSansKR-Regular.otf", "NotoSansCJK-Regular.ttc", "NotoSansSC-Regular.otf"],
    "韩语粗体": ["NotoSansKR-Bold.otf", "NotoSansCJK-Bold.ttc", "NotoSansSC-Bold.otf"],
    # 前端属性面板/样式预设使用的别名（与 FONT_OPTIONS value 对齐）
    "内置漫画对话体": ["NotoSansSC-Regular.otf", "NotoSansSC-VF.ttf", "msyh.ttc", "simsun.ttc"],
    "内置漫画旁白体": ["LXGWWenKai-Regular.ttf", "NotoSansSC-Regular.otf", "simsun.ttc"],
    "内置拟声词样式": ["NotoSansSC-Bold.otf", "msyhbd.ttc", "NotoSansSC-Regular.otf"],
    "Noto Sans SC": ["NotoSansSC-Regular.otf", "NotoSansSC-VF.ttf"],
    "LXGW WenKai": ["LXGWWenKai-Regular.ttf", "LXGW WenKai.ttf", "LXGWWenKai.ttf"],
    "Noto Sans JP": ["NotoSansJP-Regular.otf", "NotoSansSC-Regular.otf"],
    "Noto Sans KR": ["NotoSansKR-Regular.otf", "NotoSansCJK-Regular.ttc", "NotoSansSC-Regular.otf"],
    "Malgun Gothic": ["malgun.ttf", "malgunbd.ttf", "NotoSansKR-Regular.otf"],
    # 漫画专用字体（对标 manga-translator-ui）
    "Anime Ace": ["anime_ace.ttf", "anime_ace_3.ttf"],
    "Anime Ace v3": ["anime_ace_3.ttf", "anime_ace.ttf"],
    "Comic Shanns 2": ["comic shanns 2.ttf"],
    "MS Gothic": ["msgothic.ttc", "msgothic.ttf", "NotoSansJP-Regular.otf"],
    # 种子数据逻辑名映射
    "动漫英文粗体": ["anime_ace.ttf", "anime_ace_3.ttf", "NotoSansSC-Bold.otf"],
    "漫画手写英文": ["comic shanns 2.ttf", "LXGWWenKai-Regular.ttf"],
    "日文哥特体": ["msgothic.ttc", "NotoSansJP-Bold.otf", "NotoSansJP-Regular.otf"],
}

_path_cache: dict = {}


def _find_file_in_paths(candidates: List[str]) -> Optional[str]:
    """在搜索路径中查找第一个存在的字体文件。"""
    for name in candidates:
        if not name:
            continue
        # 绝对路径直接用
        if os.path.isabs(name) and os.path.isfile(name):
            return name
        for base in FONT_SEARCH_PATHS:
            if not base or not os.path.isdir(base):
                continue
            p = os.path.join(base, name)
            if os.path.isfile(p):
                return p
            # 允许无扩展名匹配
            for ext in (".otf", ".ttf", ".ttc"):
                if os.path.isfile(p + ext):
                    return p + ext
    return None


def _resolve_builtin(name: str) -> Optional[str]:
    """内置字体逻辑名 → 本地文件路径。"""
    if name in BUILTIN_FONT_FILES:
        return _find_file_in_paths(BUILTIN_FONT_FILES[name])
    return None


def _download_minio_font(file_url: str) -> Optional[str]:
    """
    用户上传字体存于 MinIO(fonts 桶)，file_url 形如 /api/v1/fonts/file/{font_id}.ttf。
    下载到本地缓存并返回路径。
    """
    try:
        base = os.path.basename(file_url)  # {font_id}.ttf
        if not base:
            return None
        os.makedirs(FONT_CACHE_DIR, exist_ok=True)
        local = os.path.join(FONT_CACHE_DIR, base)
        if os.path.isfile(local) and os.path.getsize(local) > 0:
            return local
        from common.core.minio import get_minio
        client = get_minio()
        object_name = None
        # 允许 file_url 自身就是 object key
        for key in (f"fonts/{base}", base):
            try:
                client.fget_object("fonts", key, local)
                object_name = key
                break
            except Exception:
                continue
        if object_name is None:
            # 遍历桶找同名对象（用户目录前缀未知时）
            try:
                for obj in client.list_objects("fonts", recursive=True):
                    if obj.object_name.endswith(base):
                        client.fget_object("fonts", obj.object_name, local)
                        object_name = obj.object_name
                        break
            except Exception:
                pass
        if object_name and os.path.isfile(local) and os.path.getsize(local) > 0:
            return local
    except Exception as e:
        logger.debug(f"[FontResolver] MinIO 字体下载失败 {file_url}: {e}")
    return None


async def _font_row_to_path(db: AsyncSession, font_id) -> Optional[str]:
    """Font 行 → 本地字体文件路径。"""
    if not font_id:
        return None
    key = f"fid:{font_id}"
    if key in _path_cache:
        return _path_cache[key]
    try:
        from common.models.font import Font
        row = (await db.execute(select(Font).where(Font.font_id == font_id))).scalar_one_or_none()
    except Exception as e:
        logger.debug(f"[FontResolver] 查询 Font 失败 {font_id}: {e}")
        row = None
    if not row:
        return None
    path = None
    # 系统内置字体：优先按逻辑名落地
    if row.user_id is None:
        path = _resolve_builtin(row.name) or _find_file_in_paths([row.name])
    else:
        # 用户上传：从 MinIO 下载
        path = _download_minio_font(row.file_url)
    if path:
        _path_cache[key] = path
    return path


async def _character_font_path(db: AsyncSession, character_id) -> Optional[str]:
    """区域绑定角色 → 角色 font_id → 字体路径（§2.25 字体-角色绑定）。"""
    if not character_id:
        return None
    try:
        from common.models.character import Character
        ch = (await db.execute(
            select(Character).where(Character.character_id == character_id)
        )).scalar_one_or_none()
        if ch and ch.font_id:
            return await _font_row_to_path(db, ch.font_id)
    except Exception as e:
        logger.debug(f"[FontResolver] 角色字体解析失败 {character_id}: {e}")
    return None


async def resolve_region_font_path(
    db: AsyncSession,
    *,
    font_id=None,
    character_id=None,
    font_family: Optional[str] = None,
) -> Tuple[Optional[str], str]:
    """
    解析文字区域应使用的字体文件路径。

    优先级（§2.25）：显式 font_id > 角色绑定字体 > style_config.font_family 名称 > None(交给默认)

    Returns: (font_path 或 None, source 说明)
    """
    # 1. 显式 font_id
    p = await _font_row_to_path(db, font_id) if font_id else None
    if p:
        return p, "region_font_id"
    # 2. 角色绑定字体
    p = await _character_font_path(db, character_id)
    if p:
        return p, "character_font"
    # 3. font_family 名称（可能是内置逻辑名，也可能是文件名）
    if font_family:
        p = _resolve_builtin(font_family) or _find_file_in_paths([font_family])
        if p:
            return p, "font_family"
    return None, "default"


def glyph_fallback_path(text: str, primary_path: Optional[str]) -> Tuple[Optional[str], List[str]]:
    """
    缺字回退（§2.25）：若主字体不能覆盖 text 中的字符，沿脚本回退链找可覆盖的备用字体。

    Returns: (最终字体路径 或 primary_path, 仍缺失的字符列表)
    """
    if not text or check_glyph_coverage is None:
        return primary_path, []

    # 检查主字体覆盖
    if primary_path:
        cov = check_glyph_coverage(text, font_path=primary_path)
        if not cov.get("needs_fallback"):
            return primary_path, []
        missing_after = cov.get("missing_chars", [])
    else:
        missing_after = list(text)

    # 沿脚本回退链尝试
    script = detect_text_script(text) if detect_text_script else "CJK"
    chain = FALLBACK_CHAINS.get(script, []) + FALLBACK_CHAINS.get("CJK", [])
    for fam in chain:
        cand = _find_file_in_paths(BUILTIN_FONT_FILES.get(fam, [fam]))
        if not cand:
            continue
        cov = check_glyph_coverage(text, font_path=cand)
        if not cov.get("needs_fallback"):
            logger.info(f"[FontResolver] 缺字回退命中: {fam} -> {cand}")
            return cand, []
        # 记录覆盖更好的候选
        if len(cov.get("missing_chars", [])) < len(missing_after):
            primary_path = cand
            missing_after = cov.get("missing_chars", [])

    return primary_path, missing_after
