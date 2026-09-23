# Fonts

Bundled, never fetched from a CDN (arc42 §8.3).

## Hymnal Sans

Google Sans ([google/fonts `ofl/googlesans`](https://github.com/google/fonts/tree/main/ofl/googlesans),
SIL OFL 1.1), subset and renamed. Google's trademark note
([`HymnalSans-TRADEMARKS.txt`](HymnalSans-TRADEMARKS.txt)) forbids the "Google
Sans" name on a modified version, and subsetting is one. Why this font:
[`docs/visual/DESIGN.md`](../../docs/visual/DESIGN.md) § Typography.

Rebuild (needs `pip install fonttools brotli`; the script lives in the
maintainer's `~/dev/artifacts/font-tools/`):

```sh
subset-rename-font.py 'GoogleSans[GRAD,opsz,wght].ttf' HymnalSans.woff2 \
  --from-name "Google Sans" --to-name "Hymnal Sans" \
  --axes GRAD=0 opsz=drop wght=400:700 \
  --unicodes "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212,U+2215,U+0D00-0D7F,U+200C-200D,U+25CC"
```
