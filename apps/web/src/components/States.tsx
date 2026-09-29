import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton" aria-hidden="true" style={height ? { height } : undefined}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ icon = "info", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <Icon name="alert" size={24} />
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
        {onRetry ? (
          <button type="button" className="btn" onClick={onRetry}>
            <Icon name="refresh" size={16} /> Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "warn" ? "note" : undefined}>
      <Icon name={tone === "warn" ? "alert" : "info"} size={16} />
      <div>{children}</div>
    </div>
  );
}
