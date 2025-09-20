from PIL import Image
from collections import Counter
from math import sqrt

ICON_PATH = "Website/public/static/icon.png"
EXPECTED_BG = (0xFA, 0xF8, 0xF8)   # #faf8f8
EXPECTED_INK = (0x2B, 0x2B, 0x2B)  # #2b2b2b

def rgb_to_hex(c):
    return f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"

def dist(a,b):
    return sqrt(sum((a[i]-b[i])**2 for i in range(3)))

im = Image.open(ICON_PATH).convert("RGBA")
pixels = list(im.getdata())

# Reduce to RGB (ignore alpha since we composited to solid bg)
rgb_pixels = [ (r,g,b) for (r,g,b,a) in pixels ]
counts = Counter(rgb_pixels)

total = im.width * im.height
top = counts.most_common(10)

print(f"Icon size: {im.width}x{im.height}, total pixels: {total}")
print("Top colors (hex,count,percent):")
for (c, n) in top:
    pct = 100.0 * n / total
    print(f"  {rgb_to_hex(c)} {n} {pct:.1f}%")

# Find closest to expected colors
def closest_to(expected):
    best_clr, best_count = None, None
    best_dist = 1e9
    for clr, n in counts.items():
        d = dist(clr, expected)
        if d < best_dist:
            best_dist, best_clr, best_count = d, clr, n
    return best_clr, best_count, best_dist

bg_clr, bg_count, bg_dist = closest_to(EXPECTED_BG)
ink_clr, ink_count, ink_dist = closest_to(EXPECTED_INK)

def fmt(label, expected, clr, count, d):
    pct = 100.0 * count / total
    # Avoid non-ASCII characters for Windows consoles
    print(f"Closest to {label} {rgb_to_hex(expected)}: {rgb_to_hex(clr)} (d={d:.2f}), count={count}, {pct:.1f}%")

fmt("BG", EXPECTED_BG, bg_clr, bg_count, bg_dist)
fmt("INK", EXPECTED_INK, ink_clr, ink_count, ink_dist)
