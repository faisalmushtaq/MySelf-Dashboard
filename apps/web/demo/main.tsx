import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { App } from "../src/App";

/** The demo: the dashboard itself, with a note that says what the visitor is looking at. */
function DemoNote() {
  return (
    <aside className="demo-note" aria-label="About this demo">
      <strong>Demo</strong> · invented children, real survey versions · nothing you do here is saved
    </aside>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <DemoNote />
  </StrictMode>,
);

const style = document.createElement("style");
style.textContent = `.demo-note{position:fixed;left:12px;bottom:12px;z-index:50;max-width:min(200px,calc(100vw - 24px));padding:10px 12px;border-radius:12px;background:var(--ink,#1f2a24);color:#fff;font:500 13px/1.4 Inter,system-ui,sans-serif;box-shadow:0 4px 16px rgb(0 0 0/.18)}`;
document.head.appendChild(style);
