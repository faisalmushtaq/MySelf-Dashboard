# 7. Publication figures

The **Figures** page turns the dashboard's numbers into figures you can put in a
paper, a report or a talk: sized to journal columns, typeset the way journals
typeset figures, in colours that survive colour-blindness and greyscale printing,
with a draft figure legend and the source data for every panel.

Figures use the same filters as the rest of the dashboard (date range, survey
version, status, site, data source…), so the figure always matches what the
Overview and Completeness pages show for those filters.

## 7.1 Using it

1. Set the filters at the top (for example, *All time*, *Production only*).
2. Choose the **width**: single column (89 mm), 1.5 columns (120 mm) or double
   column (183 mm). The height follows from the panels.
3. Choose **colour-blind safe** colour or **greyscale**.
4. Add up to six **panels** (a–f), reorder or remove them, and set each one's
   options. The preview redraws as you go; *Actual size* shows it at print size.
5. Read the **warnings** under the preview (small groups, a figure deeper than a
   page, identifying site codes) and the draft **figure legend**.
6. **Download** the figure as vector PDF or SVG, or as a PNG/TIFF image at 300,
   600 or 1200 dpi, and the **source data** as CSV.

The figure settings (not the data) are remembered in your browser.

## 7.2 The panels

| Panel | What it shows | Drawn from |
|---|---|---|
| Participation over time | Sessions started and completed per day/week, or cumulatively | Overview series: starts by start date, completions by completion date (device clock, study time zone) |
| Session status | Number and percentage of sessions complete, incomplete, abandoned, in progress, not started | Overview metrics; percentages of all sessions |
| Completion rate with 95% CI | Proportion of finished sessions that were complete, per survey version or per site, with Wilson score 95% intervals and *n* | Finished = complete + incomplete + abandoned; invalid sessions excluded; dashed line = all finished sessions |
| Reach or completion by section | % of sessions reaching each section (among those it applied to), or % of required answers given per section | Completeness summaries, questionnaire order |
| Item outcomes | For each question: answered / declined / not answered / not reached, as % of sessions it applied to | One survey version's question analysis; hidden-by-branching excluded |
| Answers to one question | Option percentages (or a histogram with the median for numeric scales) | One survey version, one question; identifying and free-text questions are never offered |
| Completion time | Histogram of completion time for complete, never-resumed sessions, with the median; bins of 1–2–5 minutes up to the 95th percentile, longer sessions reported in the legend | Device-measured duration; withheld below five sessions |

Definitions follow [03-completeness.md](03-completeness.md); the legend says
which rules version (`completeness@1`) produced the figure.

## 7.3 House style

The renderer (`packages/core/src/figures`) follows the figure guidance published
by *Nature* and most society journals. **Check your target journal's current
author guide** before submission; widths and type sizes are settings in
`theme.ts`.

- **Size:** 89, 120 or 183 mm wide; a warning appears when a figure is deeper
  than a journal page (247 mm).
- **Type:** Arial/Helvetica; tick labels 6 pt, axis titles 7 pt, panel letters
  8 pt bold lowercase (a, b, c…), no titles inside the figure (the title belongs
  in the legend). Numbers use a true minus sign and thousands separators; *n*
  is set in italics.
- **Lines:** 0.5 pt axes with outward ticks, 1 pt data lines, open axes (no
  box, no background, no gridlines).
- **Colour:** single series in Okabe–Ito blue (#0072B2); categories in
  blue, reddish purple (#CC79A7) and vermillion (#D55E00), with grey for "not
  reached". The categorical set passes the colour-vision checks against white
  (worst adjacent-pair ΔE 9.6 under simulated protanopia, 16.4 in normal vision;
  every colour ≥ 3:1 contrast). Greyscale mode uses four lightness steps and a
  dashed comparison line, so nothing depends on colour.
- **Layout:** panels share a grid with aligned tops; row-based charts keep
  their natural height instead of stretching; long question wording wraps to two
  lines before it is shortened.

Text is measured with Helvetica's published metrics, so a label that fits in
the preview fits in the PDF; a unit test checks that no text in any panel, at
any width, runs outside the figure.

## 7.4 Files

| Format | Use it for | Notes |
|---|---|---|
| PDF | Journal submission, Illustrator/Inkscape, LaTeX | Vector; text is live, set in Helvetica (a PDF standard font, not embedded — embed fonts in Acrobat/Illustrator if a journal's checker asks) |
| SVG | Editing, web | Vector; font stack Arial → Helvetica → Arimo |
| PNG | Word, PowerPoint, previews | Arimo embedded; resolution written into the file, so it places at print size |
| TIFF | Journals that ask for TIFF | Baseline RGB, Deflate-compressed, resolution in the file |
| Source data (CSV) | The "Source data" file journals ask for | A block per panel with exactly the numbers drawn (plus CIs, denominators); formula-safe like every export |

File names say what they are, e.g.
`myself_fig1_double-column_2026-09-28_600dpi.png`.

## 7.5 Privacy and audit

- Figures are drawn in the browser **from aggregates only** — the same numbers
  the server already sends to the Overview and Questions pages. No participant
  row is fetched to make a figure.
- Identifying and free-text questions cannot be charted (their values are never
  aggregated).
- Site comparisons use **anonymised labels** (Site 1, 2… by size) unless you
  choose site codes, which triggers a warning not to publish them.
- Small groups are flagged (fewer than 10 finished sessions per group,
  fewer than 10 applicable sessions per question, fewer than 20 timed sessions).
- **Every file is recorded in the audit log before it is released**
  (`figure.exported`: panels, format, width, resolution). If the record cannot
  be written, the download does not start.
- All roles may make figures (they are aggregate exports, like chart CSVs).

## 7.6 Limitations

- The legend is a draft: add your statistical tests and check it against your
  journal's style.
- Figures describe the dashboard's data; they do not fit models or test
  hypotheses. Use the session export for analysis.
- PDF text uses the standard Helvetica font without embedding it (see 7.4).
- Browsers without `CompressionStream` write uncompressed TIFFs (larger files).
- Source data is one CSV with a block per panel rather than a workbook with a
  sheet per panel.

## 7.7 Adding a panel type

1. Add its spec to `panelSpecSchema` in `packages/core/src/figures/types.ts`.
2. Add a `PanelBuilder` in `panels.ts`: `preferredHeight`, and `render` returning
   the SVG elements, its legend sentence, definitions, source table and
   warnings. Draw with the helpers in `draw.ts` so type and strokes stay
   consistent.
3. Add its options to `PanelOptions` in `apps/web/src/pages/Figures.tsx`.
4. Add it to `everyPanel` in `figures.test.ts`: the layout test will then check
   that its labels stay inside the figure at every width.
