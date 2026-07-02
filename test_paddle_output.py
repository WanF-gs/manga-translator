"""Test PaddleOCR v6 output format with manga crop."""
import cv2, numpy as np, sys
from paddleocr import PaddleOCR

img_path = sys.argv[1] if len(sys.argv) > 1 else "测试项目/Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_001_图像_0001.jpg"
img = cv2.imread(img_path)
if img is None:
    print(f"FAILED to load: {img_path}")
    sys.exit(1)

print(f"Image: {img.shape[1]}x{img.shape[0]}")
crop = img[800:900, 200:500]
print(f"Crop: {crop.shape[1]}x{crop.shape[0]}")

ocr = PaddleOCR(lang='ch', show_log=False)
result = ocr.ocr(crop)
print(f"Result type: {type(result)}")
if result and result[0]:
    first = result[0]
    print(f"result[0] type: {type(first)}, len: {len(first)}")
    if len(first) > 0:
        item0 = first[0]
        print(f"item[0] type: {type(item0)}, repr: {repr(item0)[:200]}")
        if hasattr(item0, '__iter__') and not isinstance(item0, str):
            for i, x in enumerate(item0):
                print(f"  item[0][{i}]: type={type(x)}, value={repr(x)[:150]}")
else:
    print("No text detected")
    print(f"raw result: {repr(result)[:300]}")
