/**
 * The house style for publication figures, following the figure guidance that
 * Nature and most society journals publish: sans-serif type at 5–7 pt (8 pt bold
 * lowercase panel letters), hairline-to-1-pt strokes, open axes with outward
 * ticks, no titles or frames inside the figure, and colours a reader with any
 * common colour-vision deficiency can separate.
 */

/** Points per millimetre. */
export const PT_PER_MM = 72 / 25.4;

export type FigureWidth = "single" | "onehalf" | "double";
export type ColourMode = "colour" | "greyscale";

export const FIGURE_WIDTHS: Record<FigureWidth, { mm: number; label: string }> = {
  single: { mm: 89, label: "Single column (89 mm)" },
  onehalf: { mm: 120, label: "1.5 columns (120 mm)" },
  double: { mm: 183, label: "Double column (183 mm)" },
};

/** Deepest figure a journal page takes, legend excluded. */
export const MAX_HEIGHT_MM = 247;

export const FONT_FAMILY = "Arial, Helvetica, Arimo, Liberation Sans, sans-serif";

export interface Palette {
  /** Single-series marks. */
  primary: string;
  /** A de-emphasised comparison series (a line the eye should read second). */
  context: string;
  contextDash: string | null;
  ink: string;
  answered: string;
  declined: string;
  unanswered: string;
  notReached: string;
}

/**
 * Colour: slots from the Okabe–Ito set (Wong, Nature Methods 8, 441; 2011).
 * Blue, reddish purple and vermillion pass the adjacent-pair colour-vision
 * checks against white (worst CVD ΔE 9.6, normal-vision ΔE 16.4, all ≥ 3:1
 * contrast); grey marks absence (not reached), never a category of its own.
 */
const COLOUR: Palette = {
  primary: "#0072B2",
  context: "#8C8C8C",
  contextDash: null,
  ink: "#000000",
  answered: "#0072B2",
  declined: "#CC79A7",
  unanswered: "#D55E00",
  notReached: "#BDBDBD",
};

/** Greyscale for print: lightness steps, and a dash on the comparison line. */
const GREYSCALE: Palette = {
  primary: "#4D4D4D",
  context: "#8C8C8C",
  contextDash: "2.4 1.4",
  ink: "#000000",
  answered: "#262626",
  declined: "#6E6E6E",
  unanswered: "#A6A6A6",
  notReached: "#D9D9D9",
};

export interface Theme {
  font: string;
  size: { tick: number; label: number; legend: number; note: number; panel: number };
  stroke: { axis: number; tick: number; tickLength: number; line: number; error: number; cap: number; reference: number };
  pointRadius: number;
  /** White gap between stacked segments. */
  gap: number;
  palette: Palette;
}

export function themeFor(mode: ColourMode): Theme {
  return {
    font: FONT_FAMILY,
    size: { tick: 6, label: 7, legend: 6, note: 6, panel: 8 },
    stroke: { axis: 0.5, tick: 0.5, tickLength: 2.5, line: 1, error: 0.6, cap: 2.4, reference: 0.5 },
    pointRadius: 1.8,
    gap: 0.5,
    palette: mode === "greyscale" ? GREYSCALE : COLOUR,
  };
}
