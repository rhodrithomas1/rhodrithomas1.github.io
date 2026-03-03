# Rhodri Thomas – Website (DeepSkyScout)

This repository contains the source for a **static GitHub Pages** site (HTML/CSS/JS) featuring:

- A personal homepage
- An astrophotography gallery
- **DeepSkyScout**: a browser-based deep-sky planner for “what’s best to image tonight” using your location + rig

Everything runs client-side in the browser.

---

## Pages

- `index.html` – homepage + links
- `astro.html` – astrophotography gallery
- `deepskyscout-web.html` – the DeepSkyScout planner UI
- `how-it-works.html` – documentation explaining the planner and calculations


---

## Nightmode (red-on-black)

Nightmode is a site-wide toggle in the top navigation bar (eye icon + “Nightmode”).

- Persists between pages using `localStorage` key: `site_nightmode`
- When enabled:
  - default UI text switches from white → **red**
  - blue “night sky” surfaces switch to **black/dark grey**
  - DeepSkyScout canvases (grid + labels) follow the theme

Implementation notes:
- Global theme overrides live in `css/styles.css` under **“Site-wide Nightmode”**
- DeepSkyScout-specific night styling (charts, sliders, etc.) is in `css/deepskyscout.css`
- Each page includes:
  - a small preload snippet in `<head>` so the theme applies before render
  - the nav toggle button
  - a small inline script to toggle + persist the setting

---

## DeepSkyScout overview

DeepSkyScout answers:

> “Given my location, horizon, and imaging setup, which deep-sky objects are best tonight?”

### What it does

1. Loads data (client-side JSON)
2. Computes sunset → sunrise for the chosen location
3. For each object in the catalog:
   - converts RA/Dec → Alt/Az through the night
   - checks if it is above the chosen horizon limit/profile
   - computes visibility duration + max altitude
4. Filters and sorts objects (visibility, type, size, search query, etc.)
5. Displays:
   - **Tonight’s visibility** chart (canvas)
   - **Sky image** viewer (Aladin Lite)
   - **Monthly visibility** chart

### Advanced mode: Magnitude / Size / SNR estimate

Advanced mode enables extra columns and an approximate SNR ranking.
This is an **estimate** intended for relative ordering, not an exact exposure calculator.

Typical inputs include:
- integration time available (time above horizon)
- object magnitude or Hα flux (when provided in the dataset)
- telescope aperture / focal length
- camera sensor geometry
- sky brightness (Bortle → SQM conversion)
- moonlight contribution (adds to background)

---

## Data files

DeepSkyScout reads:

- `assets/deepsky_objects.json` – object catalog (RA/Dec, size, type, mags, optional line fluxes)
- `assets/locations.json` – observing locations (lat/lon/timezone label)
- `assets/telescopes.json` – telescope definitions (+ reducer/barlow options)
- `assets/cameras.json` – camera sensor specs
- `assets/horizon.hrz` – example horizon profile

### Horizon file format

Horizon profiles can be loaded from `.hrz`, `.csv`, or `.txt` containing azimuth/altitude pairs.
DeepSkyScout interpolates between points to form a continuous horizon limit.

---

## Folder structure (typical)

```
.
├── index.html
├── astro.html
├── deepskyscout-web.html
├── how-it-works.html
├── css/
│   ├── styles.css
│   └── deepskyscout.css
├── js/
│   └── deepskyscout.js
└── assets/
    ├── deepsky_objects.json
    ├── locations.json
    ├── telescopes.json
    ├── cameras.json
    ├── horizon.hrz
    └── astro/   (gallery images)
```

---

## External dependencies

DeepSkyScout uses a few libraries loaded in the browser (via `<script>` tags), including:

- **Aladin Lite** (for the Sky Image viewer)
- **MathJax** (used on `how-it-works.html` for equations)

No build tooling is required.
