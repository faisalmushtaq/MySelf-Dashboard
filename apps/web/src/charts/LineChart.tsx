import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { niceTicks } from "./scale";
import { useWidth } from "./useWidth";

/**
 * A time series of one or two series on ONE axis (never two). Crosshair snaps to
 * the nearest bucket; the tooltip lists every series there. Keyboard: focus the
 * chart and use ← → (Home/End) to move the crosshair.
 */
export interface Series {
  key: string;
  label: string;
  /** CSS colour token, e.g. var(--viz-accent). */
  color: string;
}

export interface LinePoint {
  x: string;
  label: string;
  values: Record<string, number | null>;
}

export function LineChart({
  points,
  series,
  format = (v: number) => v.toLocaleString("en-GB"),
  yMax,
  height = 220,
  ariaLabel,
}: {
  points: LinePoint[];
  series: Series[];
  format?: (v: number) => string;
  yMax?: number;
  height?: number;
  ariaLabel: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pad = { top: 12, right: 64, bottom: 28, left: 44 };
  const w = Math.max(280, width);
  const h = height;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const maxVal = yMax ?? Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
  const ticks = niceTicks(maxVal);
  const top = yMax ?? ticks[ticks.length - 1]!;
  const x = (i: number) => pad.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / (top || 1)) * plotH;

  const path = (key: string) => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = p.values[key];
      if (v === null || v === undefined) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    if (points.length === 0) return;
    const i = Math.round(((px - pad.left) / plotW) * (points.length - 1));
    setActive(Math.min(points.length - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const cur = active ?? points.length - 1;
    if (e.key === "ArrowLeft") setActive(Math.max(0, cur - 1));
    else if (e.key === "ArrowRight") setActive(Math.min(points.length - 1, cur + 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(points.length - 1);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  // Label every nth bucket so x labels never collide.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 70))));
  const last = points.length - 1;
  const tip = active !== null ? points[active] : null;

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 ? (
        <ul className="legend" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className="legend-line" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="chart-svg"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          (i % every === 0 && (i === last || last - i >= Math.ceil(every * 0.75))) || i === last ? (
            <text key={p.x} x={x(i)} y={h - 8} className="tick" textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>
              {p.label}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* End labels: value at the end of each line. */}
        {series.map((s, k) => {
          let i = last;
          while (i >= 0 && (points[i]?.values[s.key] ?? null) === null) i -= 1;
          if (i < 0) return null;
          const v = points[i]!.values[s.key]!;
          return (
            <g key={s.key}>
              <circle cx={x(i)} cy={y(v)} r={4} fill={s.color} className="ring" />
              <text x={x(i) + 8} y={y(v) + (series.length > 1 ? (k === 0 ? -6 : 10) : 0)} className="end-label" dominantBaseline="middle">
                {format(v)}
              </text>
            </g>
          );
        })}
        {tip ? (
          <g className="crosshair" pointerEvents="none">
            <line x1={x(active!)} x2={x(active!)} y1={pad.top} y2={pad.top + plotH} />
            {series.map((s) => {
              const v = tip.values[s.key];
              return v === null || v === undefined ? null : <circle key={s.key} cx={x(active!)} cy={y(v)} r={4} fill={s.color} className="ring" />;
            })}
          </g>
        ) : null}
      </svg>
      {tip ? (
        <div
          className="chart-tip"
          role="status"
          style={{ left: `${Math.min(80, Math.max(5, (x(active!) / w) * 100))}%` }}
        >
          <div className="tip-title">{tip.label}</div>
          {series.map((s) => (
            <div key={s.key} className="tip-row">
              <span className="tip-key" style={{ background: s.color }} aria-hidden="true" />
              <strong>{tip.values[s.key] === null || tip.values[s.key] === undefined ? "—" : format(tip.values[s.key]!)}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
