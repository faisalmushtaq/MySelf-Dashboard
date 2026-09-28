import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Horizontal bars with the label on the left and the value at the tip. Each row
 * that has a destination is a link — a click on "Skipped: 12" opens those 12
 * sessions — so the chart doubles as navigation, and every value is text.
 */
export interface BarItem {
  key: string;
  label: ReactNode;
  /** Plain-text label for the accessible name and tooltip. */
  text: string;
  value: number;
  display: string;
  sub?: ReactNode;
  href?: string;
  /** CSS colour for the bar; default the accent. */
  color?: string;
  icon?: ReactNode;
}

export function BarList({ items, max, ariaLabel, empty = "No data for these filters." }: { items: BarItem[]; max?: number; ariaLabel: string; empty?: string }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="muted-note">{empty}</p>;
  return (
    <ul className="barlist" aria-label={ariaLabel}>
      {items.map((i) => {
        const pct = Math.max(0, Math.min(100, (i.value / top) * 100));
        const body = (
          <>
            <span className="bar-label">
              {i.icon}
              <span className="bar-text">{i.label}</span>
              {i.sub ? <span className="bar-sub">{i.sub}</span> : null}
            </span>
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${pct}%`, background: i.color ?? "var(--viz-accent)" }} />
            </span>
            <span className="bar-value">{i.display}</span>
          </>
        );
        return (
          <li key={i.key}>
            {i.href ? (
              <Link to={i.href} className="bar-row bar-link" aria-label={`${i.text}: ${i.display}. Open these sessions`} title={`${i.text}: ${i.display} — open these sessions`}>
                {body}
              </Link>
            ) : (
              <div className="bar-row" title={`${i.text}: ${i.display}`}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
