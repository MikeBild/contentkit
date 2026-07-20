# Contentkit examples

This directory owns authored examples and locally generated review artifacts.
Runtime code and trusted Pattern Packages do not live here. Generated gallery
output and the registry snapshot are intentionally ignored by Git because they
are reproducible and currently exceed 100 MB.

| Path | Purpose | Authored or generated |
|---|---|---|
| `compositions/` | one real Markdown document for every visual pattern | authored |
| `pattern-gallery/` | complete publishing review, responsive HTML/SVG/PNG gallery, validation reports, and screenshots | generated |
| `composition-patterns.json` | machine-readable snapshot of the runtime registry | generated |
| `reports/` | complete report compositions | authored |
| `docs/`, `wiki/`, `knowledge/`, `landing/`, `changelog/` | controlled-layout examples | authored |

Run `npm run review:patterns` to create the gallery and registry snapshot. Run
`npm run validate:visuals` to regenerate them, recompile every case, and compare the generated
bytes, geometry, typography, accessibility metadata and responsive pattern
resolution. The same command measures all 972 SVGs and 1,097 visual HTML cases
in Chromium, verifies the complete gallery at six widths in light and dark, and
captures 390 px and 1440 px review screenshots. Clipping, text collisions,
truncation, container overflow, separator crossings, broken navigation, and
missing code, diagram, server-rendered chart, report output, narrative question,
or machine-readable selection guide fail validation. Pattern previews expose
layout-equivalent HTML, canonical SVG and its derived PNG export.

The executable trust boundary remains separate:

- `patterns/` contains validated runtime Pattern Packages;
- `src/` contains semantic parsing, selection, layout and rendering code;
- `examples/` contains input documents and review output only.
