#!/usr/bin/env python3
"""Convert a PDF page into simple raster-scan pen-plotter G-code.

The output uses generic Marlin-style G-code. It deliberately does not home,
probe, or start a print: position the machine safely before running it.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Convert dark pixels in a PDF page to pen-plotter G-code.")
    p.add_argument("pdf", type=Path, help="Input PDF file")
    p.add_argument("-o", "--output", type=Path, default=Path("Gcode.txt"))
    p.add_argument("--page", type=int, default=1, help="1-based PDF page number (default: 1)")
    p.add_argument("--dpi", type=int, default=150, help="Rasterization resolution (default: 150)")
    p.add_argument("--threshold", type=int, default=200, help="Pixels at or below this gray value are drawn (0-255)")
    p.add_argument("--invert", action="store_true", help="Draw light pixels instead of dark pixels")
    p.add_argument("--bed-width", type=float, default=220.0, help="Available drawing width in mm")
    p.add_argument("--bed-height", type=float, default=220.0, help="Available drawing height in mm")
    p.add_argument("--margin", type=float, default=5.0, help="Margin inside the drawing area in mm")
    p.add_argument("--line-spacing", type=float, default=0.35, help="Distance between horizontal scan lines in mm")
    p.add_argument("--origin-x", type=float, default=0.0, help="Drawing area's lower-left X coordinate in mm")
    p.add_argument("--origin-y", type=float, default=0.0, help="Drawing area's lower-left Y coordinate in mm")
    p.add_argument("--pen-offset-x", type=float, default=0.0, help="Pen tip X offset from carriage in mm")
    p.add_argument("--pen-offset-y", type=float, default=0.0, help="Pen tip Y offset from carriage in mm")
    p.add_argument("--pen-up", type=float, default=5.0, help="Z height with pen lifted, in mm")
    p.add_argument("--pen-down", type=float, default=0.0, help="Z height with pen touching paper, in mm")
    p.add_argument("--travel-feed", type=int, default=3000, help="XY travel speed in mm/min")
    p.add_argument("--draw-feed", type=int, default=1200, help="Drawing speed in mm/min")
    p.add_argument("--z-feed", type=int, default=300, help="Pen lift/lower speed in mm/min")
    p.add_argument("--max-pixels", type=int, default=20_000_000, help="Maximum rendered pixels (safety limit)")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    if not a.pdf.is_file():
        raise SystemExit(f"Input PDF not found: {a.pdf}")
    if not 0 <= a.threshold <= 255:
        raise SystemExit("--threshold must be between 0 and 255")
    if a.page < 1 or a.dpi < 30 or a.line_spacing <= 0:
        raise SystemExit("--page, --dpi, and --line-spacing must be positive (dpi >= 30)")
    if min(a.bed_width, a.bed_height) <= 0 or a.margin < 0:
        raise SystemExit("Bed dimensions must be positive and margin cannot be negative")
    draw_w = a.bed_width - 2 * a.margin
    draw_h = a.bed_height - 2 * a.margin
    if draw_w <= 0 or draw_h <= 0:
        raise SystemExit("Margin leaves no usable drawing area")

    doc = fitz.open(a.pdf)
    if a.page > len(doc):
        raise SystemExit(f"PDF has {len(doc)} page(s); requested page {a.page}")
    page = doc[a.page - 1]
    pix = page.get_pixmap(matrix=fitz.Matrix(a.dpi / 72, a.dpi / 72), colorspace=fitz.csGRAY, alpha=False)
    if pix.width * pix.height > a.max_pixels:
        raise SystemExit(f"Rendered page is {pix.width * pix.height:,} pixels; reduce --dpi or raise --max-pixels")
    image = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    image.thumbnail((max(1, round(draw_w * a.dpi / 25.4)), max(1, round(draw_h * a.dpi / 25.4))), Image.Resampling.LANCZOS)
    width, height = image.size
    pixels = image.load()

    # Convert physical line spacing into rows in the resized image.
    row_step = max(1, round(a.line_spacing * height / draw_h))
    x0 = a.origin_x + a.margin + a.pen_offset_x
    y0 = a.origin_y + a.margin + a.pen_offset_y
    mm_per_px_x = draw_w / width
    mm_per_px_y = draw_h / height

    lines = [
        "; PDF raster pen plotter output",
        f"; Source: {a.pdf.name}, page {a.page}",
        f"; Render: {width} x {height}px, threshold: {a.threshold}, invert: {a.invert}",
        "; Check machine limits and pen mount offsets before running.",
        "G21 ; millimeters",
        "G90 ; absolute positioning",
        f"G0 Z{a.pen_up:.3f} F{a.z_feed}",
    ]
    segments = 0
    for row_index, y in enumerate(range(0, height, row_step)):
        runs = []
        x = 0
        while x < width:
            value = pixels[x, y]
            ink = value > a.threshold if a.invert else value <= a.threshold
            if not ink:
                x += 1
                continue
            start = x
            while x + 1 < width:
                next_value = pixels[x + 1, y]
                next_ink = next_value > a.threshold if a.invert else next_value <= a.threshold
                if not next_ink:
                    break
                x += 1
            runs.append((start, x))
            x += 1

        # Alternate scan direction to reduce unnecessary long travel moves.
        if row_index % 2:
            runs.reverse()
        y_mm = y0 + (height - 1 - y) * mm_per_px_y
        for start, end in runs:
            if row_index % 2:
                start, end = width - 1 - end, width - 1 - start
            xa = x0 + start * mm_per_px_x
            xb = x0 + end * mm_per_px_x
            lines.append(f"G0 Z{a.pen_up:.3f} F{a.z_feed}")
            lines.append(f"G0 X{xa:.3f} Y{y_mm:.3f} F{a.travel_feed}")
            lines.append(f"G1 Z{a.pen_down:.3f} F{a.z_feed}")
            lines.append(f"G1 X{xb:.3f} Y{y_mm:.3f} F{a.draw_feed}")
            segments += 1

    lines.extend([f"G0 Z{a.pen_up:.3f} F{a.z_feed}", "M5", "M400", "; End"])
    a.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Created {a.output} with {segments:,} pen strokes.")


if __name__ == "__main__":
    main()
