import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import "./styles/app.css";
import { installPalettes } from "./lib/palettes";
import { installSpace } from "./lib/space";
import { applyCachedTheme } from "./lib/theme";

installPalettes();
installSpace();
applyCachedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
