import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import "./fonts.css";
import { MissionControl } from "./MissionControl";
import { Arena } from "./Arena";
import { Console } from "./Console";
import { Fusion } from "./Fusion";
import { Hud } from "./Hud";
import { Garage } from "./Garage";
import { BigPicture } from "./BigPicture";

const designs = [
  { key: "fusion", name: "Fusion", note: "Console + Arena + Mission Control", C: Fusion },
  { key: "mission-control", name: "Mission Control", note: "dense monospaced pro dashboard", C: MissionControl },
  { key: "arena", name: "Arena", note: "dark gallery, condensed athletic type", C: Arena },
  { key: "console", name: "Console", note: "background takes the selected game's colours", C: Console },
  { key: "hud", name: "HUD", note: "tactical shooter menu", C: Hud },
  { key: "garage", name: "Garage", note: "racing telemetry", C: Garage },
  { key: "big-picture", name: "Big Picture", note: "couch-mode icon grid with tinted side panel", C: BigPicture },
];

function Explorer() {
  const initial = Math.max(0, designs.findIndex((d) => d.key === location.hash.slice(1)));
  const [i, setI] = useState(initial);
  useEffect(() => {
    history.replaceState(null, "", `#${designs[i].key}`);
    window.scrollTo({ top: 0 });
  }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[1-7]$/.test(e.key)) setI(Number(e.key) - 1);
      if (e.key === "ArrowRight") setI((x) => (x + 1) % designs.length);
      if (e.key === "ArrowLeft") setI((x) => (x + designs.length - 1) % designs.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const D = designs[i].C;
  return (
    <>
      <div style={{ height: "100vh", overflow: "auto" }}>
        <D />
      </div>
      <nav
        style={{
          position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 100, display: "flex", gap: 4, padding: 4,
          background: "rgba(20,20,20,.86)", backdropFilter: "blur(8px)", borderRadius: 999, font: "500 12px system-ui", color: "#eee",
          boxShadow: "0 8px 30px rgba(0,0,0,.35)",
        }}
      >
        {designs.map((d, n) => (
          <button
            key={d.key}
            onClick={() => setI(n)}
            title={d.note}
            style={{
              border: 0, cursor: "pointer", borderRadius: 999, padding: "7px 14px", font: "inherit",
              background: n === i ? "#fff" : "transparent", color: n === i ? "#111" : "#ccc",
            }}
          >
            {n + 1} · {d.name}
          </button>
        ))}
        <a href="./index.html" style={{ color: "#888", padding: "7px 14px", textDecoration: "none" }} title="The current design">current ↗</a>
      </nav>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Explorer />
  </StrictMode>,
);
