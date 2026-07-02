import cv2, numpy as np
from paddleocr import PaddleOCR
import pkg_resources

v = pkg_resources.get_distribution('paddleocr').version
print(f"PaddleOCR: {v}")

img = cv2.imread("/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/测试项目/Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_001_图像_0001.jpg")
print(f"Image: {img.shape}")

# Test Chinese recognition
crop = img[800:900, 200:500]
ocr = PaddleOCR(lang='ch', show_log=False)
result = ocr.ocr(crop)
success = False
if result and result[0]:
    for line in result[0][:3]:
        t = line[1][0]
        c = line[1][1]
        print(f"  [zh] '{t}' conf={c:.2f}")
        success = True

# Test Japanese recognition
crop_ja = img[100:300, 100:500]
ocr_ja = PaddleOCR(lang='japan', show_log=False)
result_ja = ocr_ja.ocr(crop_ja)
if result_ja and result_ja[0]:
    for line in result_ja[0][:3]:
        t = line[1][0]
        c = line[1][1]
        print(f"  [ja] '{t}' conf={c:.2f}")
        success = True

print(f"\n{'SUCCESS' if success else 'FAILED'} - PaddleOCR 2.9.1 working")
