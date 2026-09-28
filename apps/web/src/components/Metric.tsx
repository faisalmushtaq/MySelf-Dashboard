import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { InfoTip } from "./InfoTip";
import { Icon } from "./Icon";

/**
 * A stat tile: label, value, definition, and — where it means something — a link
 * to the sessions it counts. Values use proportional figures (style: dataviz).
 */
export function Metric({
  label,
  value,
  definition,
  href,
  sub,
  hero = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  definition: ReactNode;
  href?: string;
  sub?: ReactNode;
  hero?: boolean;
  tone?: "warn";
}) {
  return (
    <div className={`metric ${hero ? "metric-hero" : ""} ${tone ? `metric-${tone}` : ""}`}>
      <div className="metric-label">
        <span>{label}</span>
        <InfoTip label={label}>{definition}</InfoTip>
      </div>
      <div className="metric-value">{value}</div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
      {href ? (
        <Link to={href} className="metric-link" aria-label={`Open the sessions counted in ${label}`}>
          View sessions <Icon name="chevronRight" size={14} />
        </Link>
      ) : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
