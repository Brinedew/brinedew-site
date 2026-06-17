import shutil
import subprocess
import sys
from pathlib import Path

# Match the dark-mode front-page brand mark:
# - background brown: `--light` => oklch(16% 0.01 45) => #110c0a
# - logo beige: page-title `--darkgray` => oklch(80% 0.02 60) => #c8bbb1
LIGHT_BG = "#110c0a"
INK_COLOR = "#c8bbb1"
MARK_PADDING = 0.14
MASK_ALPHA_THRESHOLD = 32

ROOT_DIR = Path(__file__).resolve().parents[1]
SOURCE_MASK = ROOT_DIR / "quartz" / "static" / "logo-mask.png"
OUTPUT_DIR = ROOT_DIR / "quartz" / "static"

PNG_OUTPUTS = {
    "icon.png": 192,
    "icon-48.png": 48,
    "apple-touch-icon.png": 180,
}
ICO_OUTPUT = "favicon.ico"
ICO_SIZES = [(48, 48), (32, 32), (16, 16)]


def ensure_pillow():
    try:
        import PIL  # noqa: F401

        return
    except Exception:
        pass

    uv = shutil.which("uv")
    if uv is None:
        print("ERROR: Pillow is not installed and 'uv' was not found.", file=sys.stderr)
        sys.exit(1)

    print("Installing Pillow via uv...", file=sys.stderr)
    try:
        subprocess.check_call([uv, "pip", "install", "pillow"])
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: failed to install Pillow via uv: {exc}", file=sys.stderr)
        sys.exit(1)


def hex_to_rgb(hex_str):
    hex_str = hex_str.strip().lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join(char * 2 for char in hex_str)
    if len(hex_str) != 6:
        raise ValueError(f"Invalid hex color: {hex_str}")
    return tuple(int(hex_str[index : index + 2], 16) for index in range(0, 6, 2))


def load_master_mark():
    if not SOURCE_MASK.exists():
        print(f"ERROR: Missing brand mask: {SOURCE_MASK}", file=sys.stderr)
        sys.exit(1)

    from PIL import Image

    source = Image.open(SOURCE_MASK).convert("RGBA")
    alpha = source.getchannel("A").point(
        lambda value: 255 if value >= MASK_ALPHA_THRESHOLD else 0,
        mode="L",
    )
    bbox = alpha.getbbox()
    if bbox is None:
        print(f"ERROR: No visible mark found in {SOURCE_MASK}", file=sys.stderr)
        sys.exit(1)

    return source.crop(bbox).getchannel("A")


def render_icon(alpha_mark, size, bg_rgb, ink_rgb):
    from PIL import Image, ImageOps

    canvas = Image.new("RGB", (size, size), bg_rgb)
    inner_size = max(1, round(size * (1 - 2 * MARK_PADDING)))
    fitted_alpha = ImageOps.contain(alpha_mark, (inner_size, inner_size), Image.Resampling.LANCZOS)

    # A slight upward nudge keeps the mark optically centered in browser tabs.
    offset_x = (size - fitted_alpha.width) // 2
    offset_y = max(0, (size - fitted_alpha.height) // 2 - max(1, round(size * 0.01)))

    icon_layer = Image.new("RGB", fitted_alpha.size, ink_rgb)
    canvas.paste(icon_layer, (offset_x, offset_y), fitted_alpha)
    return canvas


def write_outputs(alpha_mark):
    bg_rgb = hex_to_rgb(LIGHT_BG)
    ink_rgb = hex_to_rgb(INK_COLOR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    rendered_icons = {}
    for filename, size in PNG_OUTPUTS.items():
        rendered = render_icon(alpha_mark, size, bg_rgb, ink_rgb)
        rendered.save(OUTPUT_DIR / filename, format="PNG")
        rendered_icons[size] = rendered
        print(f"Wrote {OUTPUT_DIR / filename}")

    ico_path = OUTPUT_DIR / ICO_OUTPUT
    largest = rendered_icons[max(rendered_icons)]
    largest.save(ico_path, format="ICO", sizes=ICO_SIZES)
    print(f"Wrote {ico_path}")


def main():
    ensure_pillow()
    alpha_mark = load_master_mark()
    write_outputs(alpha_mark)


if __name__ == "__main__":
    main()
