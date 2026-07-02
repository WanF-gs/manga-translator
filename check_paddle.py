import cv2, numpy as np
from paddleocr import PaddleOCR

img = cv2.imread("/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/测试项目/Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_001_图像_0001.jpg")
print(f"Image: {img.shape}")

# Test crop with visible Chinese text
crop = img[800:900, 200:500]
print(f"Crop: {crop.shape}")

ocr = PaddleOCR(lang="ch")
result = ocr.ocr(crop)
print(f"Result type: {type(result)}")
if result and result[0]:
    for i, line in enumerate(result[0][:5]):
        text = line[1][0] if len(line) > 1 else "?"
        conf = line[1][1] if len(line) > 1 else 0
        print(f"  [{i}] '{text}' conf={conf:.2f}")
else:
    print(f"Empty result: {repr(result)[:200]}")

# Also test with the actual PaddleOCR init params used in service
print("\n--- Testing with service params ---")
ocr2 = PaddleOCR(lang="ch", det_db_thresh=0.2, det_db_box_thresh=0.1, rec_batch_num=6)
result2 = ocr2.ocr(crop)
print(f"Service-style result: {type(result2)}")
if result2 and result2[0]:
    for i, line in enumerate(result2[0][:5]):
        text = line[1][0] if len(line) > 1 else "?"
        conf = line[1][1] if len(line) > 1 else 0
        print(f"  [{i}] '{text}' conf={conf:.2f}")
else:
    print(f"Empty: {repr(result2)[:200]}")
