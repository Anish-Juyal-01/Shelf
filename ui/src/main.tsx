import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { installPalettes } from "./lib/palettes";
import { applyCachedTheme } from "./lib/theme";

installPalettes();
applyCachedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
