import cv2, numpy as np, os

# Latest inpainted
d = "/tmp/manga-uploads/pages/000105bc-c82f-4804-bdee-cacc478b7e65"
for fn in sorted(os.listdir(d)):
    fp = os.path.join(d, fn)
    if fn.endswith('.png'):
        sz = os.path.getsize(fp) // 1024
        img = cv2.imread(fp)
        if img is not None:
            h, w = img.shape[:2]
            mean = np.mean(img)
            dark = np.sum(np.all(img < 50, axis=2)) / (h*w) * 100
            mid = np.sum(np.all((img >= 50) & (img <= 200), axis=2)) / (h*w) * 100
            bright = np.sum(np.all(img > 200, axis=2)) / (h*w) * 100
            print(f"{fn}: {sz}KB, {w}x{h}, mean={mean:.0f}")
            print(f"  dark(<50):{dark:.1f}% mid(50-200):{mid:.1f}% bright(>200):{bright:.1f}%")
            # Check channel means
            b, g, r = img[:,:,0].mean(), img[:,:,1].mean(), img[:,:,2].mean()
            print(f"  B:{b:.0f} G:{g:.0f} R:{r:.0f}")
        else:
            print(f"{fn}: {sz}KB, FAILED")
