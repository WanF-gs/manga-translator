import onnxruntime as ort
import cv2, numpy as np, os

p = "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/models/lama_fp32.onnx"
s = ort.InferenceSession(p, providers=['CPUExecutionProvider'])

# Check first output shape
out_info = s.get_outputs()
for o in out_info:
    print(f"Output: {o.name}, type={o.type}, shape={o.shape}")

# Load test image
img = cv2.imread("/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/测试项目/Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_001_图像_0001.jpg")
h, w = img.shape[:2]
print(f"\nImage: {w}x{h}")

# Create simple mask - just a small rectangle in center
mask = np.zeros((h, w), dtype=np.uint8)
mask[500:700, 600:900] = 255  # white rectangle = erase area
print(f"Mask sum: {mask.sum()}")

# LaMa test directly
img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
mask_norm = mask.astype(np.float32) / 255.0

img_512 = cv2.resize(img_rgb, (512, 512), interpolation=cv2.INTER_LINEAR)
mask_512 = cv2.resize(mask_norm, (512, 512), interpolation=cv2.INTER_LINEAR)

img_blob = img_512.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)  # (1,3,512,512)
mask_blob = mask_512[np.newaxis, np.newaxis, ...].astype(np.float32)  # (1,1,512,512)

output = s.run(None, {'image': img_blob, 'mask': mask_blob})
o = output[0]
print(f"\nOutput shape: {o.shape}")
print(f"Output min={o.min():.3f}, max={o.max():.3f}, mean={o.mean():.3f}")

# Try both transpose conventions
r1 = o[0].transpose(1, 2, 0).astype(np.float32)  # (3,512,512) → (512,512,3)
r2 = o[0].astype(np.float32)  # (512,512,3) as-is
print(f"r1 shape: {r1.shape}, mean={r1.mean():.3f}")
print(f"r2 shape: {r2.shape}, mean={r2.mean():.3f}")

# Save results for visual check
cv2.imwrite("/tmp/lama_test_input.jpg", img)
cv2.imwrite("/tmp/lama_test_mask.png", mask)
cv2.imwrite("/tmp/lama_test_output_r1.jpg", (np.clip(r1, 0, 1) * 255).astype(np.uint8))
if len(r2.shape) == 3 and r2.shape[2] == 3:
    cv2.imwrite("/tmp/lama_test_output_r2.jpg", (np.clip(r2, 0, 1) * 255).astype(np.uint8))
print("\nSaved test images to /tmp/lama_test_*.jpg")
