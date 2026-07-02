import cv2, numpy as np, os

d = "/tmp/manga-uploads/pages/58777a96-3fdc-440e-9bae-883d41dd44e2"
for fn in sorted(os.listdir(d)):
    fp = os.path.join(d, fn)
    sz = os.path.getsize(fp)
    img = cv2.imread(fp)
    if img is not None:
        h, w = img.shape[:2]
        mean = np.mean(img)
        white = np.sum(np.all(img > 250, axis=2)) / (h*w) * 100
        print(f"{fn}: {sz//1024}KB, {w}x{h}, mean={mean:.0f}, white={white:.1f}%")
    else:
        print(f"{fn}: {sz//1024}KB, FAILED to read")
