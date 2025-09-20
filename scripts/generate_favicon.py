import sys
import os
import subprocess
import shutil

LIGHT_BG = "#faf8f8"  # from quartz.config.ts lightMode.light
INK_COLOR = "#2b2b2b"  # from quartz.config.ts lightMode.dark

SRC_CANDIDATES = [
    os.path.join("Website", "RotatedB.png"),
    os.path.join("Website", "RotatedB_small.png"),
]

DEST_DIR = os.path.join("Website", "public", "static")
DEST_PATH = os.path.join(DEST_DIR, "icon.png")


def ensure_pillow():
    try:
        import PIL  # noqa: F401
        return
    except Exception:
        pass
    # Try installing Pillow via uv if available
    uv = shutil.which("uv")
    if uv is None:
        print("ERROR: Pillow not installed and 'uv' not found to install it.", file=sys.stderr)
        sys.exit(1)
    print("Installing Pillow via uv ...", file=sys.stderr)
    try:
        subprocess.check_call([uv, "pip", "install", "pillow"])  # may require network
    except subprocess.CalledProcessError as e:
        print(f"ERROR: failed to install pillow via uv: {e}", file=sys.stderr)
        sys.exit(1)


def pick_source():
    for p in SRC_CANDIDATES:
        if os.path.exists(p):
            return p
    print("ERROR: Source image not found. Expected one of: " + ", ".join(SRC_CANDIDATES), file=sys.stderr)
    sys.exit(1)


def hex_to_rgb(hex_str):
    hex_str = hex_str.strip().lstrip('#')
    if len(hex_str) == 3:
        hex_str = ''.join([c*2 for c in hex_str])
    if len(hex_str) != 6:
        raise ValueError(f"Invalid hex color: {hex_str}")
    r = int(hex_str[0:2], 16)
    g = int(hex_str[2:4], 16)
    b = int(hex_str[4:6], 16)
    return (r, g, b)


def main():
    ensure_pillow()
    from PIL import Image

    src_path = pick_source()
    ink_rgb = hex_to_rgb(INK_COLOR)
    bg_rgb = hex_to_rgb(LIGHT_BG)

    im = Image.open(src_path).convert("RGBA")

    # Create a binary mask from alpha (ink vs background)
    alpha = im.split()[3]
    # First, resize mask smoothly to target size, then threshold to 0/255 to avoid anti-aliasing shades
    target_size = (32, 32)
    mask_resized = alpha.resize(target_size, Image.LANCZOS)
    threshold = 128
    mask_binary = mask_resized.point(lambda a: 255 if a >= threshold else 0, mode="L")

    # Compose strict two-color image using the binary mask
    bg_img = Image.new("RGB", target_size, bg_rgb)
    ink_img = Image.new("RGB", target_size, ink_rgb)
    icon = Image.composite(ink_img, bg_img, mask_binary)

    os.makedirs(DEST_DIR, exist_ok=True)
    icon.save(DEST_PATH, format="PNG")
    print(f"Wrote {DEST_PATH}")


if __name__ == "__main__":
    main()
