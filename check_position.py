import cv2, numpy as np

d = "/tmp/manga-uploads/pages/00a8055c-96fd-444f-9c90-650415feae8e"
inp = cv2.imread(f"{d}/inpainted_89240a1f-579c-4276-a0a5-051dfeb4b4d6.png")
rend = cv2.imread(f"{d}/rendered_f59dd289-d3db-4d71-a4d0-ed46574484a5.png")

print(f"Inpainted: {inp.shape}, mean={np.mean(inp):.0f}, size={inp.nbytes//1024}KB")
print(f"Rendered: {rend.shape}, mean={np.mean(rend):.0f}, size={rend.nbytes//1024}KB")

# Check if they're different (text was added)
diff = cv2.absdiff(inp, rend)
diff_pixels = np.sum(np.any(diff > 10, axis=2))
total = inp.shape[0] * inp.shape[1]
print(f"Different pixels: {diff_pixels} ({diff_pixels/total*100:.1f}%)")

# Check top-left area specifically (first 25% of image)
h, w = inp.shape[:2]
tl_inp = inp[:h//4, :w//4]
tl_rend = rend[:h//4, :w//4]
tl_diff = np.sum(np.any(cv2.absdiff(tl_inp, tl_rend) > 10, axis=2))
tl_total = tl_inp.shape[0] * tl_inp.shape[1]
print(f"Top-left diff: {tl_diff}/{tl_total} = {tl_diff/tl_total*100:.1f}%")

# Check bottom-right area
br_inp = inp[3*h//4:, 3*w//4:]
br_rend = rend[3*h//4:, 3*w//4:]
br_diff = np.sum(np.any(cv2.absdiff(br_inp, br_rend) > 10, axis=2))
br_total = br_inp.shape[0] * br_inp.shape[1]
print(f"Bottom-right diff: {br_diff}/{br_total} = {br_diff/br_total*100:.1f}%")

print(f"\nConclusion: {'Text clustered in top-left' if tl_diff > br_diff * 2 else 'Text distributed or no text added'}")
