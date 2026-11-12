"""Generate the app icon: rounded blue tile + open book + orange check.

Outputs:
  build/icon.ico      multi-size Windows icon (16..256)
  build/icon.png      1024x1024 master
  resources/icon.png  256x256 for BrowserWindow
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SIZE = 1024
ROOT = Path(__file__).resolve().parent.parent

# palette
BLUE_TOP_LEFT = (43, 87, 208)
BLUE_BOTTOM_RIGHT = (96, 146, 255)
WHITE = (255, 255, 255, 255)
PAPER_LINE = (205, 223, 255, 255)
ORANGE = (255, 155, 48, 255)


def diagonal_gradient(size: int, c1: tuple[int, int, int], c2: tuple[int, int, int]) -> Image.Image:
    x = np.linspace(0.0, 1.0, size)[None, :]
    y = np.linspace(0.0, 1.0, size)[:, None]
    t = (x + y) / 2.0
    arr = np.zeros((size, size, 3), dtype=np.float64)
    for i in range(3):
        arr[:, :, i] = c1[i] * (1.0 - t) + c2[i] * t
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def rounded(canvas: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, canvas.size[0] - 1, canvas.size[1] - 1], radius=radius, fill=255
    )
    out = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    out.paste(canvas, (0, 0), mask)
    return out


def draw_icon() -> Image.Image:
    bg = rounded(diagonal_gradient(SIZE, BLUE_TOP_LEFT, BLUE_BOTTOM_RIGHT).convert("RGBA"), 228)
    draw = ImageDraw.Draw(bg)

    # open book: two pages with a slight perspective, gap in the middle acts as the spine
    draw.polygon([(220, 336), (478, 292), (478, 690), (220, 734)], fill=WHITE)
    draw.polygon([(546, 292), (804, 336), (804, 734), (546, 690)], fill=WHITE)

    # ruled lines on the left page
    for y, x_end in ((440, 420), (512, 420), (584, 368)):
        draw.line([(282, y), (x_end, y)], fill=PAPER_LINE, width=20)
        for cx in (282, x_end):
            draw.ellipse([cx - 10, y - 10, cx + 10, y + 10], fill=PAPER_LINE)

    # check mark on the right page
    points = [(598, 512), (670, 584), (778, 450)]
    draw.line(points, fill=ORANGE, width=62, joint="curve")
    for cx, cy in (points[0], points[-1]):
        draw.ellipse([cx - 31, cy - 31, cx + 31, cy + 31], fill=ORANGE)

    return bg


def main() -> None:
    icon = draw_icon()

    (ROOT / "build").mkdir(parents=True, exist_ok=True)
    (ROOT / "resources").mkdir(parents=True, exist_ok=True)

    icon.save(ROOT / "build" / "icon.png")
    icon.resize((512, 512), Image.LANCZOS).save(ROOT / "build" / "icon-512.png")
    icon.resize((256, 256), Image.LANCZOS).save(ROOT / "resources" / "icon.png")

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.save(ROOT / "build" / "icon.ico", sizes=sizes)

    # preview sheet at 1:1 pixel sizes, for eyeballing small variants
    preview = Image.new("RGBA", (16 + 32 + 48 + 64 + 128 + 60, 132), (245, 246, 248, 255))
    x = 10
    for s in (16, 32, 48, 64, 128):
        small = icon.resize((s, s), Image.LANCZOS)
        preview.paste(small, (x, 2), small)
        x += s + 10
    preview.save(ROOT / "build" / "icon-preview.png")

    print("written:", ROOT / "build" / "icon.ico")
    print("written:", ROOT / "build" / "icon.png")
    print("written:", ROOT / "resources" / "icon.png")


if __name__ == "__main__":
    main()
