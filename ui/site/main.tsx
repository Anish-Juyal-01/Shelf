import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installPalettes } from "../src/lib/palettes";
import { applyCachedTheme } from "../src/lib/theme";
import { Site } from "../src/site/Site";
import "../src/site/site.css";

installPalettes();
applyCachedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
