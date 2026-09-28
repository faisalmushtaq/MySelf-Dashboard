/**
 * Inline SVG icons (no icon font, no CDN). Decorative by default — every icon
 * sits beside text that says the same thing, so colour and shape are never the
 * only carrier of meaning.
 */
const PATHS: Record<string, string> = {
  overview: "M4 13h6V4H4zm0 7h6v-5H4zm10 0h6v-9h-6zm0-16v5h6V4z",
  sessions: "M4 6h16M4 12h16M4 18h16",
  completeness: "M12 3a9 9 0 1 0 9 9h-9z M14 3.3V10h6.7A9 9 0 0 0 14 3.3z",
  questions: "M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.2-1.3 2.1V15m0 3.5v.5",
  reports: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  views: "M6 3h12v18l-6-4-6 4z",
  audit: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.9 7.9 0 0 0 0-2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15 3.5h-4l-.3 2.5a8 8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.9 7.9 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.3 2.5h4l.3-2.5a8 8 0 0 0 1.7-1l2.4 1 2-3.4z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4.4-4.4",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1 1-1.1 1.8v.5M12 17v.4",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  alert: "M12 4l9 16H3zM12 10v4m0 3v.4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2",
  pause: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 9v6m4-6v6",
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  half: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  beaker: "M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5-10V3",
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14",
  figure: "M4 4v16h16M8 16v-4M12 16V8M16 16v-6",
  up: "M12 19V5m0 0l-6 6m6-6l6 6",
  down: "M12 5v14m0 0l-6-6m6 6l6-6",
  filter: "M4 5h16l-6 8v5l-4 2v-7z",
  columns: "M4 5h16v14H4zM10 5v14M15 5v14",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  plus: "M12 5v14M5 12h14",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  split: "M4 5h16v14H4zM12 5v14",
  signout: "M15 17l5-5-5-5M20 12H9M12 20H5V4h7",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6m0-9.5v.5",
  wifiOff: "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M12 20h.01M16.7 10.4A10 10 0 0 1 19 12.5",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  arrowUp: "M12 19V5m0 0l-6 6m6-6l6 6",
  arrowDown: "M12 5v14m0 0l-6-6m6 6l6-6",
  menu: "M4 7h16M4 12h16M4 17h16",
  skipNext: "M5 5l9 7-9 7zM18 5v14",
  note: "M5 4h14v12l-4 4H5zM15 20v-4h4",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
