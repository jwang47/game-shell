"""Draws assets/icon.png and assets/icon.ico (16-256 px): a dark rounded
square with a blue play triangle. Run with the tools/.venv Python:
    tools/.venv/Scripts/python tools/make_icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024  # draw large, scale down for each icon size
root = Path(__file__).resolve().parent.parent / "assets"
root.mkdir(exist_ok=True)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((32, 32, SIZE - 32, SIZE - 32), radius=220, fill=(13, 15, 18, 255), outline=(43, 48, 54, 255), width=16)
# Play triangle, shifted right so it looks centered.
cx, cy, r = SIZE * 0.53, SIZE * 0.45, SIZE * 0.22
d.polygon([(cx - r * 0.8, cy - r), (cx - r * 0.8, cy + r), (cx + r, cy)], fill=(76, 141, 255, 255))
d.rounded_rectangle((SIZE * 0.2, SIZE * 0.78, SIZE * 0.8, SIZE * 0.8), radius=8, fill=(76, 141, 255, 110))

img.resize((512, 512), Image.LANCZOS).save(root / "icon.png")
img.save(root / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
print("wrote", root / "icon.png", root / "icon.ico")
