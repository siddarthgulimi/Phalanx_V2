"""Draws the Phalanx shield icon for each edition (PNG sizes + Windows .ico)."""
from PIL import Image, ImageDraw
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
EDITIONS = {
    "original": dict(bg=(10, 13, 11), ring=(43, 68, 52), shield=(61, 220, 132), spear=(240, 166, 58), inner=(15, 21, 17)),
    "pink":     dict(bg=(35, 23, 31), ring=(87, 58, 75), shield=(255, 140, 192), spear=(201, 167, 255), inner=(42, 28, 37)),
}
def draw(c, S=1024):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=c["bg"] + (255,), outline=c["ring"] + (255,), width=int(S * 0.02))
    # shield
    cx = S / 2
    top, bot, w = S * 0.16, S * 0.86, S * 0.62
    pts = [(cx - w / 2, top + S * 0.06), (cx, top), (cx + w / 2, top + S * 0.06), (cx + w / 2, S * 0.5), (cx, bot), (cx - w / 2, S * 0.5)]
    d.polygon(pts, fill=c["shield"] + (255,))
    k = 0.8
    inner = [(cx + (x - cx) * k, S * 0.5 + (y - S * 0.5) * k + S * 0.01) for x, y in pts]
    d.polygon(inner, fill=c["inner"] + (255,))
    # three spears (the phalanx)
    for i, dx in enumerate((-0.13, 0, 0.13)):
        x = cx + dx * S
        h_top = S * (0.30 if i == 1 else 0.34)
        d.rectangle([x - S * 0.022, h_top + S * 0.06, x + S * 0.022, S * 0.70 - abs(dx) * S * 0.4], fill=c["spear"] + (255,))
        d.polygon([(x, h_top), (x - S * 0.05, h_top + S * 0.09), (x + S * 0.05, h_top + S * 0.09)], fill=c["spear"] + (255,))
    return im
for ed, c in EDITIONS.items():
    out = ROOT / "themes" / ed / "icons"
    big = draw(c)
    for s in (16, 32, 48, 128, 256):
        big.resize((s, s), Image.LANCZOS).save(out / f"icon{s}.png")
    big.resize((256, 256), Image.LANCZOS).save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icons", ed)
