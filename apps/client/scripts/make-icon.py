#!/usr/bin/env python3
"""Genera el ícono y splash de BMO (cara + play)."""
import os
from PIL import Image, ImageDraw

SS = 4  # supersample para anti-aliasing
S = 1024
N = S * SS

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets", "images")

# Paleta BMO
TEAL_TOP = (95, 205, 184)
TEAL_BOT = (58, 168, 148)
SCREEN = (210, 236, 226)
DARK = (28, 49, 45)
RED = (224, 90, 78)
BLUE = (74, 144, 210)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def make_face(bg_top, bg_bot):
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Fondo degradado teal
    for y in range(N):
        d.line([(0, y), (N, y)], fill=lerp(bg_top, bg_bot, y / N))

    u = N / S  # factor de escala desde coords de 1024

    # Pantalla (cara)
    rounded(d, [210 * u, 250 * u, 814 * u, 628 * u], 60 * u, SCREEN)

    # Ojo izquierdo
    eye_r = 34 * u
    ex, ey = 388 * u, 408 * u
    d.ellipse([ex - eye_r, ey - eye_r, ex + eye_r, ey + eye_r], fill=DARK)

    # Play (ojo derecho)
    px, py, ph = 600 * u, 408 * u, 56 * u
    d.polygon(
        [(px, py - ph), (px, py + ph), (px + ph * 1.05, py)],
        fill=DARK,
    )

    # Sonrisa
    d.arc(
        [400 * u, 430 * u, 624 * u, 560 * u],
        start=20, end=160, fill=DARK, width=int(16 * u),
    )

    # Controles (look de consola BMO)
    # D-pad (cruz)
    cx, cy, arm, th = 360 * u, 745 * u, 46 * u, 30 * u
    d.rounded_rectangle([cx - arm, cy - th, cx + arm, cy + th], radius=8 * u, fill=DARK)
    d.rounded_rectangle([cx - th, cy - arm, cx + th, cy + arm], radius=8 * u, fill=DARK)
    # Botones
    d.polygon([(600 * u, 770 * u), (600 * u, 720 * u), (645 * u, 745 * u)], fill=RED)
    d.ellipse([670 * u, 722 * u, 716 * u, 768 * u], fill=BLUE)

    return img.resize((S, S), Image.LANCZOS)


def add_rounded_alpha(img, radius):
    """Devuelve copia con esquinas redondeadas transparentes (para splash)."""
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S, S], radius=radius, fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def flatten(img):
    bg = Image.new("RGB", img.size, (0, 0, 0))
    bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
    return bg


light = make_face(TEAL_TOP, TEAL_BOT)
dark = make_face((52, 120, 108), (30, 78, 70))

os.makedirs(os.path.join(ASSETS, "ios"), exist_ok=True)

flatten(light).save(os.path.join(ASSETS, "icon.png"))
flatten(light).save(os.path.join(ASSETS, "adaptive-icon.png"))
flatten(light).save(os.path.join(ASSETS, "ios", "icon-light.png"))
flatten(dark).save(os.path.join(ASSETS, "ios", "icon-dark.png"))
flatten(light).resize((48, 48), Image.LANCZOS).save(os.path.join(ASSETS, "favicon.png"))

# Splash: ícono redondeado sobre transparente (se centra en fondo negro)
add_rounded_alpha(light, 200).save(os.path.join(ASSETS, "splash-icon.png"))

print("Ícono y splash generados ✓")
