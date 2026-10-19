import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import { LateFees } from "./LateFees";
import { InsertCoin } from "./InsertCoin";
import { Inventory } from "./Inventory";
import { AcidMelt } from "./AcidMelt";
import { CrateDigger } from "./CrateDigger";

const designs = [
  { key: "late-fees", name: "Late Fees", note: "90s video rental store", C: LateFees },
  { key: "insert-coin", name: "Insert Coin", note: "arcade cabinet", C: InsertCoin },
  { key: "inventory", name: "Inventory", note: "pixel RPG bag", C: Inventory },
  { key: "acid-melt", name: "Acid Melt", note: "Y2K rave flyer — titles melt when idle", C: AcidMelt },
  { key: "crate-digger", name: "Crate Digger", note: "record store crates", C: CrateDigger },
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
      if (/^[1-5]$/.test(e.key)) setI(Number(e.key) - 1);
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
        <a href="./index.html" style={{ color: "#888", padding: "7px 14px", textDecoration: "none" }} title="The current lending-library design">current ↗</a>
      </nav>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Explorer />
  </StrictMode>,
);
