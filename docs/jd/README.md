# JEWELRY DUNGEON — faithful rebuild

Static landing page. Published via GitHub Pages from `docs/`:
<https://maco23plas.github.io/zmk-config/jd/>

## Run locally

Open `index.html` directly, or serve the folder with any static server:

```sh
python3 -m http.server -d docs/jd 8000
```

## Editing principle

1. Keep the reference design as master.
2. Replace only text/data without moving major visual blocks.
3. Use generated assets from `/assets` as layers (see `ASSET-MAP.md`).
4. Add animations only after static layout is approved.

## Notes for editors

- **Image sizing.** Every `<img>` carries intrinsic `width`/`height` attributes so the
  browser reserves space before the image arrives (no layout shift). Those attributes
  also act as presentational size hints, so the base rule in `styles.css` is
  `img{max-width:100%;width:auto;height:auto;display:block}` — the `auto` pair
  neutralises the hints and lets the real CSS rules size each image. If you add an
  image, keep the attributes *and* leave that base rule alone, otherwise images
  render at their full intrinsic size.
- **Reveal animation.** `.reveal` is only hidden under `html.js`, so the page is fully
  readable with JavaScript disabled. `script.js` also shows everything immediately
  when the visitor prefers reduced motion.
- **Lazy loading.** Below-the-fold images use `loading="lazy"`. Hero art is eager and
  the hero background carries `fetchpriority="high"`.
- `assets/` also holds the wider layer library documented in `ASSET-MAP.md`; not all of
  it is referenced by `index.html` today.
