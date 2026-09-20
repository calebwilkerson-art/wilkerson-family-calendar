"""Builds the app icons: a gold W on the dark slate, with the three family colour lanes.
Run: python tools/make_icons.py [path/to/Poppins-Bold.ttf]
"""
import os, sys, urllib.request
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

S = 1024
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf'


def font_path():
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        return sys.argv[1]
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Poppins-Bold.ttf')
    if not os.path.exists(local):
        urllib.request.urlretrieve(FONT_URL, local)
    return local


def make(font, maskable=False):
    yy, xx = np.mgrid[0:S, 0:S]
    t = ((xx + yy) / (2 * S)) ** 0.9
    c0 = np.array([0x33, 0x42, 0x4b]); c1 = np.array([0x1a, 0x1d, 0x21])
    img = Image.fromarray((c0 * (1 - t[..., None]) + c1 * t[..., None]).astype('uint8'), 'RGB')
    d = ImageDraw.Draw(img)
    ghost = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(ghost).text((600, 560), '19', font=ImageFont.truetype(font, 520), fill=(255, 255, 255, 14))
    img.paste(ghost, (0, 0), ghost); d = ImageDraw.Draw(img)
    size = 500 if maskable else 600
    f = ImageFont.truetype(font, size)
    bb = d.textbbox((0, 0), 'W', font=f); w = bb[2] - bb[0]; h = bb[3] - bb[1]
    x = (S - w) // 2 - bb[0]; y = (S - h) // 2 - bb[1] - (60 if maskable else 80)
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((x, y + 22), 'W', font=f, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(24)); img.paste(sh, (0, 0), sh); d = ImageDraw.Draw(img)
    d.text((x, y), 'W', font=f, fill='#fdb715')
    real = d.textbbox((x, y), 'W', font=f)
    cy = real[3] + (56 if maskable else 70)
    bw = 126 if maskable else 150; gap = 32; bh = 24 if maskable else 28
    sx = (S - (bw * 3 + gap * 2)) // 2
    for i, c in enumerate(['#fdb715', '#a1d184', '#589db5']):
        d.rounded_rectangle([sx + i * (bw + gap), cy, sx + i * (bw + gap) + bw, cy + bh], radius=bh // 2, fill=c)
    return img


def save(img, name, size):
    im = img.resize((size, size), Image.LANCZOS).convert('RGB')
    im = im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
    im.save(os.path.join(OUT, name), optimize=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    fp = font_path()
    base = make(fp)
    save(base, 'icon-512.png', 512)
    save(base, 'icon-192.png', 192)
    save(base, 'apple-touch-icon.png', 180)
    print('icons written to', OUT)
