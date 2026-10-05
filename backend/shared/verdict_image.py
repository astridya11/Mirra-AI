"""Render a verdict image with stain boxes + APPROVED/REJECTED stamp + caption.

Pillow-only.  No external services, no network.

``render_verdict_image`` takes a source image, draws red rectangles around
each stain region, overlays a stamp (APPROVED / REJECTED / UNDER_REVIEW)
and a caption bar (title + up to 3 short lines), and saves the result as
a JPEG.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_STAMP_COLOURS = {
    "APPROVED": (0, 160, 0),
    "REJECTED": (200, 0, 0),
    "UNDER_REVIEW": (200, 140, 0),
}

_CAPTION_BG = (245, 245, 245)
_CAPTION_TEXT = (40, 40, 40)
_REGION_COLOUR = (255, 0, 0)
_STAMP_BG = (255, 255, 255)


def _get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Try common system fonts, fall back to default."""
    for name in (
        "DejaVuSans.ttf",
        "DejaVuSans-Bold.ttf",
        "Arial.ttf",
        "arial.ttf",
        "arialbd.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _text_width(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    """Return text width in pixels (handles old/new Pillow)."""
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0]
    except Exception:
        try:
            return draw.textlength(text, font=font)
        except Exception:
            return len(text) * (font.size if hasattr(font, "size") else 10)


def _text_height(font) -> int:
    """Approximate font height."""
    if hasattr(font, "size") and font.size:
        return font.size + 4
    return 20


def render_verdict_image(
    source_path: str | Path,
    output_path: str | Path,
    *,
    stamp: str | None = None,
    stamp_sub: str | None = None,
    regions: list[dict[str, float]] | None = None,
    region_label: str | None = None,
    title: str = "",
    lines: list[str] | None = None,
) -> None:
    """Render a verdict JPEG.

    Args:
        source_path: Input image (JPEG/PNG on disk).
        output_path: Output JPEG path.
        stamp: One of APPROVED, REJECTED, UNDER_REVIEW (or None).
        stamp_sub: Small text under the stamp (e.g. date).
        regions: List of ``{"x1","y1","x2","y2"}`` fractions (0..1).
        region_label: Short label near the first box (e.g. "VOMIT · SEVERE").
        title: Bold title in the caption bar.
        lines: Up to 3 short lines in the caption bar.
    """
    src = Image.open(str(source_path))
    img = src.convert("RGB")
    w, h = img.size

    # --- 1. Draw stain regions ---
    if regions:
        draw = ImageDraw.Draw(img)
        line_w = max(1, int(w * 0.01))
        for i, box in enumerate(regions):
            coords = (
                int(box["x1"] * w),
                int(box["y1"] * h),
                int(box["x2"] * w),
                int(box["y2"] * h),
            )
            draw.rectangle(coords, outline=_REGION_COLOUR, width=line_w)
        if region_label:
            label_font = _get_font(max(14, int(h * 0.035)))
            lx = int(regions[0]["x1"] * w) + line_w + 4
            ly = max(0, int(regions[0]["y1"] * h) - _text_height(label_font))
            # White background for readability
            tw = _text_width(draw, region_label, label_font)
            th = _text_height(label_font)
            draw.rectangle([lx - 2, ly, lx + tw + 2, ly + th], fill=(255, 255, 255))
            draw.text((lx, ly), region_label, fill=_REGION_COLOUR, font=label_font)

    # --- 2. Draw stamp (top-right) ---
    if stamp:
        stamp_colour = _STAMP_COLOURS.get(stamp, (200, 200, 0))
        stamp_font = _get_font(max(20, int(h * 0.06)))
        sw = _text_width(ImageDraw.Draw(img), stamp, stamp_font)
        sh = _text_height(stamp_font)
        margin = max(8, int(w * 0.02))
        sx = w - sw - margin * 2 - line_w if regions else w - sw - margin
        sy = margin
        draw = ImageDraw.Draw(img)
        # White rounded-rect behind the stamp
        draw.rectangle(
            [sx - margin, sy - 4, sx + sw + margin, sy + sh + 4],
            fill=_STAMP_BG,
            outline=stamp_colour,
            width=2,
        )
        draw.text((sx, sy), stamp, fill=stamp_colour, font=stamp_font)
        if stamp_sub:
            sub_font = _get_font(max(10, int(h * 0.022)))
            sub_w = _text_width(draw, stamp_sub, sub_font)
            sub_h = _text_height(sub_font)
            sub_x = sx + (sw - sub_w) // 2 if sub_w < sw else sx
            sub_y = sy + sh + 6
            draw.text((sub_x, sub_y), stamp_sub, fill=(100, 100, 100), font=sub_font)
            sh += sub_h + 6

    # --- 3. Caption bar ---
    caption_lines = []
    if title:
        caption_lines.append(("title", title))
    if lines:
        for line in lines[:3]:
            if line:
                caption_lines.append(("line", line))

    if caption_lines:
        title_font = _get_font(max(14, int(h * 0.035)))
        body_font = _get_font(max(12, int(h * 0.028)))
        # Compute total caption height
        total_h = 0
        for kind, text in caption_lines:
            total_h += _text_height(title_font if kind == "title" else body_font)
        total_h += 8 + len(caption_lines) * 4  # padding + spacing

        new_img = Image.new("RGB", (w, h + total_h), _CAPTION_BG)
        new_img.paste(img, (0, 0))
        draw = ImageDraw.Draw(new_img)

        y = h + 6
        for kind, text in caption_lines:
            font = title_font if kind == "title" else body_font
            draw.text((8, y), text, fill=_CAPTION_TEXT, font=font)
            y += _text_height(font) + 4
        img = new_img

    img.save(str(output_path), format="JPEG", quality=90)
