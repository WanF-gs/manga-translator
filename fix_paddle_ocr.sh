#!/bin/bash
set -e

echo "=== Step 1: Uninstall broken PaddleOCR v3 ==="
python3 -m pip uninstall -y paddleocr paddlex 2>/dev/null || true

echo "=== Step 2: Force reinstall PaddleOCR 2.9.1 (stable, no PIR crash) ==="
python3 -m pip install --user --force-reinstall 'paddleocr==2.9.1' 2>&1 | tail -5

echo "=== Step 3: Verify ==="
python3 -c "
from paddleocr import PaddleOCR
import pkg_resources
v = pkg_resources.get_distribution('paddleocr').version
print(f'PaddleOCR version: {v}')
import cv2, numpy as np
img = cv2.imread('/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/测试项目/Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_001_图像_0001.jpg')
if img is not None:
    crop = img[800:900, 200:500]
    ocr = PaddleOCR(lang='ch', show_log=False)
    result = ocr.ocr(crop)
    if result and result[0]:
        for line in result[0][:3]:
            print(f'  \"{line[1][0]}\" conf={line[1][1]:.2f}')
    else:
        print('  No text detected')
else:
    print('  Image not found')
" 2>&1

echo "=== DONE ==="
