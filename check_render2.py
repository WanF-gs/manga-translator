import cv2, numpy as np, os

for fn in os.listdir("/tmp/manga-uploads/pages/6c2077aa-7347-4519-9350-e871c77ab645"):
    fp = os.path.join("/tmp/manga-uploads/pages/6c2077aa-7347-4519-9350-e871c77ab645", fn)
    if fn.endswith('.png'):
        sz = os.path.getsize(fp)
        img = cv2.imread(fp)
        if img is not None:
            h, w = img.shape[:2]
            mean = np.mean(img)
            # Check color distribution
            unique_colors = len(np.unique(img.reshape(-1, 3), axis=0))
            white = np.sum(np.all(img > 250, axis=2)) / (h*w) * 100
            print(f"{fn}: {sz//1024}KB, {w}x{h}, mean={mean:.0f}, unique_colors={unique_colors}, white={white:.1f}%")
        else:
            print(f"{fn}: {sz//1024}KB, FAILED")
