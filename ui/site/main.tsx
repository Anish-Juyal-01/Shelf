import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installPalettes } from "../src/lib/palettes";
import { applySiteTheme, savedSiteTheme } from "../src/site/siteTheme";
import { Site } from "../src/site/Site";
import "../src/site/site.css";

installPalettes();
applySiteTheme(savedSiteTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
