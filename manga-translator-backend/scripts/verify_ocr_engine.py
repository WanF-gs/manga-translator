#!/usr/bin/env python3
"""
P0: OCR 引擎升级验证脚本
验证 PaddleOCR v4 → RapidOCR → Tesseract 多级引擎是否正常工作。
"""
import sys
import os
import time

# 添加路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services"))

def check_engine(name, import_path, test_fn=None):
    """检查某个 OCR 引擎是否可用"""
    try:
        mod = __import__(import_path, fromlist=[""])
        print(f"  ✓ {name}: 已安装 (版本: {getattr(mod, '__version__', 'unknown')})")
        return True
    except ImportError:
        print(f"  ✗ {name}: 未安装")
        return False


def test_paddleocr():
    """测试 PaddleOCR 能否正常创建实例"""
    try:
        from paddleocr import PaddleOCR
        t0 = time.time()
        ocr = PaddleOCR(lang='japan', use_angle_cls=True, show_log=False, use_gpu=False)
        elapsed = time.time() - t0
        print(f"    PaddleOCR 初始化耗时: {elapsed:.1f}s")
        return True
    except Exception as e:
        print(f"    PaddleOCR 初始化失败: {e}")
        return False


def test_rapidocr():
    """测试 RapidOCR 能否正常创建实例"""
    try:
        from rapidocr_onnxruntime import RapidOCR
        t0 = time.time()
        ocr = RapidOCR()
        elapsed = time.time() - t0
        print(f"    RapidOCR 初始化耗时: {elapsed:.1f}s")
        return True
    except Exception as e:
        print(f"    RapidOCR 初始化失败: {e}")
        return False


def test_ocr_on_sample():
    """用一段日文测试图片验证 OCR"""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    
    # 创建测试图片 (白底黑字日文)
    img = Image.new('RGB', (400, 60), color='white')
    draw = ImageDraw.Draw(img)
    
    # 尝试使用系统字体
    test_text = "こんにちは世界"
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", 24)
    except Exception:
        try:
            font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 24)
        except Exception:
            font = ImageFont.load_default()
    
    draw.text((10, 10), test_text, fill='black', font=font)
    
    img_np = np.array(img)
    
    # 测试 PaddleOCR
    print("\n  用 PaddleOCR 测试日文识别...")
    try:
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(lang='japan', use_angle_cls=True, show_log=False, use_gpu=False)
        result = ocr.ocr(img_np, cls=True)
        if result and result[0]:
            for line in result[0]:
                print(f"    识别: '{line[1][0]}' (置信度: {line[1][1]:.2f})")
        else:
            print("    PaddleOCR 未检测到文字")
    except Exception as e:
        print(f"    PaddleOCR 识别失败: {e}")
    
    # 测试 RapidOCR
    print("\n  用 RapidOCR 测试日文识别...")
    try:
        from rapidocr_onnxruntime import RapidOCR
        ocr = RapidOCR()
        result, _ = ocr(img_np)
        if result:
            for r in result:
                print(f"    识别: '{r[1]}' (置信度: {r[2]:.2f})")
        else:
            print("    RapidOCR 未检测到文字")
    except Exception as e:
        print(f"    RapidOCR 识别失败: {e}")


def main():
    print("=" * 50)
    print("  OCR 引擎升级验证 — P0 检查")
    print("=" * 50)
    print()
    
    # 1. 检查 Python 依赖
    print("[1] Python 依赖检查:")
    has_mangaocr = check_engine("manga-ocr", "manga_ocr")
    has_paddle = check_engine("PaddlePaddle", "paddle")
    has_paddleocr = check_engine("PaddleOCR", "paddleocr")
    has_rapidocr = check_engine("RapidOCR", "rapidocr_onnxruntime")
    has_tesseract = check_engine("pytesseract", "pytesseract")
    has_cv2 = check_engine("OpenCV", "cv2")
    
    # 2. 环境变量检查
    print("\n[2] 环境变量:")
    for var in ["PADDLEOCR_ENABLED", "OCR_ENGINE_ORDER", "OCR_CONFIDENCE_RETRY_THRESHOLD", "PADDLEOCR_MODEL_DIR"]:
        val = os.getenv(var, "(未设置)")
        print(f"  {var} = {val}")
    
    # 3. Tesseract 系统命令检查
    print("\n[3] Tesseract 系统命令:")
    import subprocess
    try:
        result = subprocess.run(["tesseract", "--version"], capture_output=True, text=True, timeout=5)
        print(f"  ✓ tesseract: {result.stdout.split(chr(10))[0]}")
    except Exception:
        print("  ✗ tesseract 命令不可用")
    
    try:
        result = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True, timeout=5)
        langs = [l.strip() for l in result.stdout.split("\n")[1:] if l.strip()]
        print(f"  已安装语言包: {', '.join(langs)}")
    except Exception:
        pass
    
    # 4. 引擎初始化测试
    print("\n[4] OCR 引擎初始化测试:")
    if has_paddle and has_paddleocr:
        test_paddleocr()
    else:
        print("  跳过 PaddleOCR (未安装完整依赖)")
    
    if has_rapidocr:
        test_rapidocr()
    else:
        print("  跳过 RapidOCR (未安装)")
    
    # 5. 实际识别测试
    print("\n[5] 实际识别测试 (日文 'こんにちは世界'):")
    if has_paddleocr or has_rapidocr:
        test_ocr_on_sample()
    else:
        print("  跳过 (无可用的 OCR 引擎)")
    
    # 6. 引擎优先级总结
    print("\n[6] 引擎优先级 (按 OCR_ENGINE_ORDER):")
    order = os.getenv("OCR_ENGINE_ORDER", "mangaocr,paddleocr,rapidocr,tesseract")
    engines = [e.strip() for e in order.split(",")]
    for i, eng in enumerate(engines, 1):
        available = "✓" if (
            (eng == "mangaocr" and has_mangaocr) or
            (eng == "paddleocr" and has_paddleocr) or
            (eng == "rapidocr" and has_rapidocr) or
            (eng == "tesseract" and has_tesseract)
        ) else "✗"
        info = {
            "mangaocr": "日语漫画专用 Transformer",
            "paddleocr": "PP-OCRv4 通用多语言",
            "rapidocr": "轻量 ONNX 模型",
            "tesseract": "传统 OCR 终极回退",
        }.get(eng, "")
        print(f"  {i}. {eng} [{available}] — {info}")
    
    print()
    print("=" * 50)
    print("  验证完成")
    print("=" * 50)


if __name__ == "__main__":
    main()
