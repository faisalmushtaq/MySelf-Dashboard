import { useState } from "react";
import { niceTicks } from "./scale";
import { useWidth } from "./useWidth";

/** Vertical columns (histograms, distributions): one series, one colour. */
export function Columns({
  bins,
  ariaLabel,
  height = 200,
  color = "var(--viz-accent)",
  format = (v: number) => v.toLocaleString("en-GB"),
}: {
  bins: { label: string; value: number; title?: string }[];
  ariaLabel: string;
  height?: number;
  color?: string;
  format?: (v: number) => string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pad = { top: 18, right: 8, bottom: 30, left: 40 };
  const w = Math.max(260, width);
  const plotW = w - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const ticks = niceTicks(Math.max(1, ...bins.map((b) => b.value)));
  const top = ticks[ticks.length - 1]!;
  const band = plotW / Math.max(1, bins.length);
  const barW = Math.min(24, band - 2);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const every = Math.max(1, Math.ceil(bins.length / Math.max(2, Math.floor(plotW / 56))));
  return (
    <div className="chart" ref={ref}>
      <svg width="100%" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={ariaLabel} className="chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {bins.map((b, i) => {
          const cx = pad.left + band * i + band / 2;
          const bh = Math.max(0, (b.value / top) * plotH);
          const x0 = cx - barW / 2;
          const y0 = pad.top + plotH - bh;
          const r = Math.min(4, bh, barW / 2);
          const d = bh <= 0 ? "" : `M${x0},${pad.top + plotH}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + barW - r}Q${x0 + barW},${y0} ${x0 + barW},${y0 + r}V${pad.top + plotH}Z`;
          return (
            <g key={b.label}>
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${b.title ?? b.label}: ${format(b.value)}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="hit"
              />
              <path d={d} fill={color} opacity={active === null || active === i ? 1 : 0.55} pointerEvents="none" />
              {i % every === 0 ? (
                <text x={cx} y={height - 10} className="tick" textAnchor="middle">
                  {b.label}
                </text>
              ) : null}
              {active === i ? (
                <text x={cx} y={y0 - 5} className="end-label" textAnchor="middle">
                  {format(b.value)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
