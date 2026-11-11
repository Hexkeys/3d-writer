# 3d-writer

PDF-to-G-code generator for a 3D printer fitted with a pen holder. It rasterizes one PDF page, treats pixels darker than a configurable grayscale threshold as ink, and writes horizontal XY strokes with Z pen-up/pen-down moves to `Gcode.txt`.

## Setup

```bash
python -m pip install -r requirements.txt
```

## Generate G-code

```bash
python pdf_to_gcode.py artwork.pdf
```

The default output is `Gcode.txt`. Example with custom dimensions and pen settings:

```bash
python pdf_to_gcode.py artwork.pdf -o Gcode.txt \
  --page 1 --threshold 190 --dpi 150 \
  --bed-width 220 --bed-height 220 --margin 8 \
  --line-spacing 0.35 --origin-x 0 --origin-y 0 \
  --pen-offset-x 0 --pen-offset-y 0 \
  --pen-up 5 --pen-down 0 \
  --travel-feed 3000 --draw-feed 1000 --z-feed 300
```

## Main settings

| Option | Meaning |
|---|---|
| `--threshold` | Gray level 0-255; pixels at or below it are drawn. Lower values draw only darker pixels. |
| `--invert` | Draw light pixels instead of dark pixels. |
| `--bed-width`, `--bed-height` | Usable machine drawing dimensions in mm. |
| `--margin` | Keep drawing inside the bed edges. |
| `--line-spacing` | Vertical gap between raster scan lines in mm. Smaller values give denser drawings and longer G-code. |
| `--origin-x`, `--origin-y` | Lower-left drawing origin in machine coordinates. |
| `--pen-offset-x`, `--pen-offset-y` | Pen tip offset relative to the carriage, in mm. |
| `--pen-up`, `--pen-down` | Z coordinates for lifted and touching pen positions. Calibrate these for your holder and paper. |
| `--travel-feed`, `--draw-feed`, `--z-feed` | XY travel, drawing, and Z movement speeds in mm/min. |
| `--dpi` | PDF rasterization resolution. Higher values preserve detail but create larger files. |

## Important machine notes

- The generator does **not** issue homing, auto-leveling, or print-start commands. Home and position the machine using your normal, known-safe procedure.
- Confirm your printer's firmware accepts standard `G0`/`G1` moves and that the configured bed coordinates, offsets, and Z heights are within its limits.
- Test first with the pen lifted and verify the path stays inside the bed. Then calibrate pen-up and pen-down heights on scrap paper.
- `--pen-down` is a machine Z coordinate, not a force setting. Use a compliant pen holder/spring so the pen does not press hard into the paper.
- The output is raster-scan plotting, not font tracing or vector path extraction. Very small text may need a higher DPI and smaller line spacing.


## GitHub Pages web app

A browser-based version is available at the repository root:

- `index.html` — upload and preview a PDF
- `app.js` — render PDF pages and generate G-code in the browser
- `style.css` — interface styling
- `.github/workflows/pages.yml` — deploy on every push to `main`

### Enable deployment

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Open the **Actions** tab and wait for **Deploy 3D Writer to GitHub Pages** to finish.
5. The published site will be at **https://hexkeys.github.io/3d-writer/**.

The web app uses PDF.js from jsDelivr to read PDF pages. PDF content is processed in the browser; it is not sent to this repository or an application server. The Python command-line tool remains available separately.
