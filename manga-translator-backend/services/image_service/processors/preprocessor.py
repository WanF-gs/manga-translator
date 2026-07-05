from __future__ import annotations
"""
图像智能预处理器 — PRD §2.1.3 真实算法实现

提供四项核心预处理能力（均为真实 CV 算法，非占位）：
  1. 倾斜校正   — Hough 直线 / 最小外接矩形估计倾斜角，≥3° 触发旋转
  2. 黑边/白边裁切 — 投影分析定位扫描件边框并裁掉
  3. 感知哈希去重 — dHash(差异哈希) 计算，汉明距离判定重复页
  4. 曝光优化   — 平均亮度过暗(<50)/过曝(>220) 时做 gamma / CLAHE 校正

以及基础的 normalize/resize/convert_format（读取真实图片信息）。
"""
import io
import logging
import os
import pathlib
import sys
from typing import Optional, Tuple

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from common.core.config import settings

logger = logging.getLogger(__name__)

LOCAL_STORAGE_ROOT = os.getenv("LOCAL_STORAGE_ROOT", os.path.join(settings.UPLOAD_DIR, "uploads"))
LOCAL_UPLOADS_DIR = os.getenv("LOCAL_UPLOADS_DIR", settings.UPLOAD_DIR)
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "http://localhost:8002")

# 阈值常量（与 PRD §2.1.3 验收标准对齐）
SKEW_TRIGGER_DEG = 3.0          # 倾斜角 ≥3° 才校正
DARK_BRIGHTNESS = 50           # 平均亮度 <50 判定过暗
BRIGHT_BRIGHTNESS = 220        # 平均亮度 >220 判定过曝
DEDUP_HAMMING_MAX = 5          # dHash 汉明距离 ≤5 判定重复


# ============================================================
# 图片读取（复用 inpaint_service 的 storage 解析约定）
# ============================================================

def _url_to_local_path(image_url: str) -> Optional[str]:
    """将 /storage/... 或 /uploads/... 转换为本地文件路径"""
    if not image_url:
        return None
    if image_url.startswith("/storage/"):
        p = os.path.join(LOCAL_STORAGE_ROOT, image_url[len("/storage/"):])
        if os.path.isfile(p):
            return p
    if image_url.startswith("/uploads/"):
        p = os.path.join(LOCAL_UPLOADS_DIR, image_url[len("/uploads/"):])
        if os.path.isfile(p):
            return p
    # 直接是本地路径
    if os.path.isfile(image_url):
        return image_url
    return None


def _read_bgr(image_url: str) -> Optional[np.ndarray]:
    """读取图片为 BGR numpy array（本地优先，其次 HTTP 下载）。失败返回 None。"""
    import cv2

    # 1) 本地磁盘
    local = _url_to_local_path(image_url)
    if local:
        img = cv2.imread(local, cv2.IMREAD_COLOR)
        if img is not None:
            return img

    # 2) MinIO
    try:
        if image_url.startswith("/storage/"):
            from common.core.minio import minio_client
            from common.core.config import settings
            # /storage/{bucket}/{object}
            rest = image_url[len("/storage/"):]
            bucket, _, object_name = rest.partition("/")
            resp = minio_client.get_object(bucket, object_name)
            data = resp.read()
            arr = np.frombuffer(data, dtype=np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception as e:
        logger.debug(f"MinIO read failed for {image_url}: {e}")

    # 3) HTTP
    try:
        import httpx
        url = image_url
        if url.startswith("/"):
            url = f"{STORAGE_BASE_URL}{url}"
        if url.startswith("http"):
            with httpx.Client(timeout=20.0) as client:
                r = client.get(url)
                r.raise_for_status()
                arr = np.frombuffer(r.content, dtype=np.uint8)
                return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception as e:
        logger.debug(f"HTTP read failed for {image_url}: {e}")

    return None


def _save_bgr(image: np.ndarray, page_id: str, prefix: str = "preprocessed") -> Optional[str]:
    """保存处理后的图片，优先 MinIO，回退本地磁盘。返回可访问 URL。"""
    import cv2
    import uuid

    ok, buf = cv2.imencode(".png", image)
    if not ok:
        return None
    data = buf.tobytes()
    task_id = uuid.uuid4().hex

    try:
        from common.core.minio import minio_client
        from common.core.config import settings
        bucket = settings.MINIO_BUCKET
        object_name = f"{prefix}/{page_id}/{task_id}.png"
        minio_client.put_object(
            bucket_name=bucket,
            object_name=object_name,
            data=io.BytesIO(data),
            length=len(data),
            content_type="image/png",
        )
        return f"/storage/{bucket}/{object_name}"
    except Exception as e:
        logger.warning(f"MinIO save failed: {e}, fallback to local")

    local_dir = pathlib.Path(LOCAL_UPLOADS_DIR) / "pages" / page_id
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / f"{prefix}_{task_id}.png"
    try:
        local_path.write_bytes(data)
        return f"/uploads/pages/{page_id}/{prefix}_{task_id}.png"
    except Exception as e:
        logger.error(f"Local save failed: {e}")
        return None


# ============================================================
# 1. 倾斜校正
# ============================================================

def estimate_skew_angle(gray: np.ndarray) -> float:
    """
    估计页面倾斜角度（度）。正值=顺时针倾斜。

    策略：Canny 边缘 + Hough 直线，统计接近水平的直线角度中位数。
    漫画分格线/文字基线通常提供稳定的水平参考。
    """
    import cv2

    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=100,
        minLineLength=max(50, gray.shape[1] // 5), maxLineGap=20,
    )
    if lines is None or len(lines) == 0:
        return 0.0

    angles = []
    for l in lines[:400]:
        x1, y1, x2, y2 = l[0]
        dx, dy = (x2 - x1), (y2 - y1)
        if dx == 0:
            continue
        ang = np.degrees(np.arctan2(dy, dx))
        # 只保留近水平的线（±20°），避免竖排文字/边框干扰
        if -20 <= ang <= 20:
            angles.append(ang)

    if len(angles) < 3:
        return 0.0
    return float(np.median(angles))


def deskew(image: np.ndarray) -> Tuple[np.ndarray, float, bool]:
    """
    倾斜校正。返回 (校正后图像, 检测角度, 是否已校正)。
    仅当 |角度| ≥ SKEW_TRIGGER_DEG 时旋转。
    """
    import cv2

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    angle = estimate_skew_angle(gray)

    if abs(angle) < SKEW_TRIGGER_DEG:
        return image, round(angle, 2), False

    h, w = image.shape[:2]
    center = (w / 2, h / 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    # 用白色填充旋转露出的角（漫画多为白底）
    rotated = cv2.warpAffine(
        image, M, (w, h),
        flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
    )
    return rotated, round(angle, 2), True


# ============================================================
# 2. 黑边 / 白边裁切
# ============================================================

def auto_crop_borders(image: np.ndarray) -> Tuple[np.ndarray, dict, bool]:
    """
    自动裁掉扫描件的纯色黑边/白边。

    策略：转灰度 → 计算每行/每列的方差，纯色边框方差极低。
    从四个方向向内收缩，直到遇到"有内容"的行/列。
    返回 (裁切后图像, 各边裁掉像素, 是否裁切)。
    """
    import cv2

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # 每行/列标准差：内容区标准差高，纯色边框标准差 ~0
    row_std = gray.std(axis=1)
    col_std = gray.std(axis=0)
    STD_THRESH = 8.0  # 低于此值视为纯色边

    def _first_content(arr, thresh):
        for i, v in enumerate(arr):
            if v > thresh:
                return i
        return 0

    top = _first_content(row_std, STD_THRESH)
    bottom = _first_content(row_std[::-1], STD_THRESH)
    left = _first_content(col_std, STD_THRESH)
    right = _first_content(col_std[::-1], STD_THRESH)

    # 安全限制：单边最多裁 25%，避免误裁内容
    top = min(top, h // 4)
    bottom = min(bottom, h // 4)
    left = min(left, w // 4)
    right = min(right, w // 4)

    edges = {"top": int(top), "bottom": int(bottom), "left": int(left), "right": int(right)}

    if top + bottom >= h or left + right >= w or (top + bottom + left + right) < 4:
        # 无有效裁切（<4px 视为无边）
        return image, edges, False

    cropped = image[top:h - bottom, left:w - right]
    if cropped.size == 0:
        return image, edges, False
    return cropped, edges, True


# ============================================================
# 3. 感知哈希去重
# ============================================================

def dhash(image: np.ndarray, hash_size: int = 8) -> int:
    """
    差异哈希 (dHash)：缩放到 (hash_size+1)×hash_size，比较相邻像素亮度。
    返回 64 位整数哈希。对轻微压缩/缩放鲁棒。
    """
    import cv2

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    diff = resized[:, 1:] > resized[:, :-1]
    bits = 0
    for v in diff.flatten():
        bits = (bits << 1) | int(v)
    return bits


def hamming_distance(a: int, b: int) -> int:
    """两个哈希整数的汉明距离（不同 bit 数）。"""
    return bin(a ^ b).count("1")


# ============================================================
# 4. 曝光优化
# ============================================================

def fix_exposure(image: np.ndarray) -> Tuple[np.ndarray, str, bool]:
    """
    曝光优化。过暗做 gamma 提亮 + CLAHE；过曝做 gamma 压暗。
    返回 (处理后图像, 亮度等级, 是否已校正)。
    """
    import cv2

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    mean_brightness = float(gray.mean())

    if mean_brightness < DARK_BRIGHTNESS:
        level = "dark"
        # gamma < 1 提亮
        gamma = 0.6
        lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], dtype=np.uint8)
        out = cv2.LUT(image, lut)
        # CLAHE 增强局部对比（在 LAB 的 L 通道）
        lab = cv2.cvtColor(out, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        out = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
        return out, level, True

    if mean_brightness > BRIGHT_BRIGHTNESS:
        level = "overexposed"
        gamma = 1.5  # gamma > 1 压暗
        lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], dtype=np.uint8)
        out = cv2.LUT(image, lut)
        return out, level, True

    return image, "normal", False


# ============================================================
# 编排：完整预处理流程
# ============================================================

class ImagePreprocessor:
    """图像预处理工具（真实 CV 实现）"""

    @staticmethod
    def _read_image_info(image_path: str) -> tuple:
        """读取图片真实尺寸和格式，返回 (width, height, format)"""
        with Image.open(image_path) as img:
            return img.size[0], img.size[1], img.format or "PNG"

    @staticmethod
    async def normalize(image_path: str) -> dict:
        """图像规范化处理（读取真实尺寸）"""
        try:
            width, height, fmt = ImagePreprocessor._read_image_info(image_path)
        except Exception:
            width, height, fmt = 0, 0, "PNG"
        return {
            "status": "ok",
            "original_size": f"{width}x{height}",
            "width": width,
            "height": height,
            "format": fmt,
        }

    @staticmethod
    def run(
        image_url: str,
        page_id: str,
        *,
        auto_rotate: bool = True,
        auto_crop: bool = True,
        exposure_fix: bool = True,
        compare_hash: Optional[int] = None,
    ) -> dict:
        """
        执行完整预处理管线（同步 CV 计算，供 API 在 threadpool 调用）。

        Args:
            image_url: 页面原图 URL
            page_id: 页面 ID（保存结果用）
            compare_hash: 可选，上一页的 dHash，用于重复检测

        Returns:
            {
              "results": {rotate/crop/dedup/exposure 各子结果},
              "processed_url": 若发生任何修改则为新图 URL，否则 None,
              "phash": 本页 dHash（供下一页去重比对）,
            }
        """
        results: dict = {}
        img = _read_bgr(image_url)
        if img is None:
            logger.warning(f"Preprocess: cannot read image {image_url}")
            return {
                "results": {"error": "图片读取失败，跳过预处理"},
                "processed_url": None,
                "phash": None,
            }

        modified = False

        # 3. 感知哈希（始终计算，用于当前页指纹 + 与上一页比对）
        try:
            page_hash = dhash(img)
            is_dup = False
            dist = None
            if compare_hash is not None:
                dist = hamming_distance(page_hash, compare_hash)
                is_dup = dist <= DEDUP_HAMMING_MAX
            results["duplicate_check"] = {
                "status": "ok",
                "is_duplicate": is_dup,
                "hamming_distance": dist,
                "phash": f"{page_hash:016x}",
                "message": "检测到重复页面" if is_dup else "未检测到重复页面",
            }
        except Exception as e:
            page_hash = None
            results["duplicate_check"] = {"status": "error", "message": str(e)}

        # 1. 倾斜校正
        if auto_rotate:
            try:
                img, angle, corrected = deskew(img)
                modified = modified or corrected
                results["auto_rotate"] = {
                    "status": "ok",
                    "angle_detected": angle,
                    "corrected": corrected,
                    "message": f"已校正 {angle}°" if corrected else f"倾斜 {angle}° 未达阈值(<{SKEW_TRIGGER_DEG}°)",
                }
            except Exception as e:
                results["auto_rotate"] = {"status": "error", "message": str(e)}

        # 2. 黑边/白边裁切
        if auto_crop:
            try:
                img, edges, cropped = auto_crop_borders(img)
                modified = modified or cropped
                results["auto_crop"] = {
                    "status": "ok",
                    "edges_removed": edges,
                    "cropped": cropped,
                    "message": f"裁掉边框 {edges}" if cropped else "未检测到明显黑边/白边",
                }
            except Exception as e:
                results["auto_crop"] = {"status": "error", "message": str(e)}

        # 4. 曝光优化
        if exposure_fix:
            try:
                img, level, corrected = fix_exposure(img)
                modified = modified or corrected
                results["exposure_fix"] = {
                    "status": "ok",
                    "brightness_level": level,
                    "corrected": corrected,
                    "message": {"dark": "已提亮过暗画面", "overexposed": "已压暗过曝画面", "normal": "画面亮度正常"}[level],
                }
            except Exception as e:
                results["exposure_fix"] = {"status": "error", "message": str(e)}

        processed_url = _save_bgr(img, page_id) if modified else None

        return {
            "results": results,
            "processed_url": processed_url,
            "phash": f"{page_hash:016x}" if page_hash is not None else None,
        }
