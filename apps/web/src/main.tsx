import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Inter (400–700) is imported at the top of styles.css, as in the survey.
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
