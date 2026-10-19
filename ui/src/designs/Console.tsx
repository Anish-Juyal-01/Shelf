import { useState } from "react";
import type { GameView } from "../bridge/protocol";
import { bytes, hours, iconFor, idleDays, initial, isOverdue, relative, sourceName, useIcon, useSample } from "./shared";

// 4 · CONSOLE — a grown-up console home screen. The selected game's own icon, blown up and blurred, becomes the
// whole background, so the room changes colour with what you point at. A row of icon tiles, a big title, one
// white Play button. Hover a tile to select it.

const ui = { fontFamily: "'Manrope Variable', sans-serif" } as const;

export function Console() {
  const { games, playing, total, idle } = useSample();
  const [sel, setSel] = useState<GameView>(games.find((g) => iconFor(g.title)) ?? games[0]);
  const bg = iconFor(sel.title);
  return (
    <div style={{ ...ui, minHeight: "100vh", color: "#fff", position: "relative", overflow: "hidden", background: "#0c0d12" }}>
      {/* the room takes the selected game's colours */}
      {bg && <img key={bg} src={bg} alt="" style={{ position: "absolute", inset: "-20%", width: "140%", height: "140%", objectFit: "cover", filter: "blur(90px) saturate(1.6) brightness(0.55)", transition: "opacity .5s" }} />}
      {!bg && <div style={{ position: "absolute", inset: 0, background: "radial-gradient(80% 60% at 30% 20%, #2b3350, #0c0d12)" }} />}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.65) 85%)" }} />

      <div style={{ position: "relative", padding: "26px 56px 80px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 26, fontSize: 15, fontWeight: 600 }}>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>Shelf</span>
          <span>Games</span>
          <span style={{ opacity: 0.55 }}>Activity</span>
          <span style={{ opacity: 0.55 }}>Storage</span>
          <span style={{ flex: 1 }} />
          <span style={{ opacity: 0.7, fontSize: 13 }}>{games.length} games · {bytes(total)} · {idle.length} idle</span>
          <span style={{ opacity: 0.85 }}>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </header>

        {/* icon row */}
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginTop: 54, overflowX: "auto", paddingBottom: 10 }}>
          {games.map((g) => (
            <TileBtn key={g.id} g={g} on={g.id === sel.id} onHover={() => setSel(g)} live={playing.has(g.id)} />
          ))}
        </div>

        <section style={{ marginTop: 42, maxWidth: 760 }}>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {sourceName[sel.sources[0]]}{playing.has(sel.id) ? " · Playing now" : sel.lastPlayed ? ` · Last played ${relative(sel.lastPlayed)}` : ""}
          </div>
          <h1 style={{ fontSize: 64, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, margin: "10px 0 22px" }}>{sel.title}</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button style={{ ...ui, fontWeight: 800, fontSize: 17, background: "#fff", color: "#000", border: 0, borderRadius: 999, padding: "14px 44px", cursor: "pointer" }}>Play</button>
            <button style={{ ...ui, fontWeight: 700, fontSize: 20, background: "rgba(255,255,255,.14)", color: "#fff", border: 0, borderRadius: 999, width: 50, height: 50, cursor: "pointer", backdropFilter: "blur(10px)" }}>⋯</button>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 34 }}>
            <Stat k="Played" v={hours(sel.playSeconds)} />
            <Stat k="On disk" v={bytes(sel.sizeBytes)} />
            <Stat k={isOverdue(sel) ? "Idle" : "Last played"} v={sel.lastPlayed ? `${idleDays(sel)} days` : "Never"} warn={isOverdue(sel)} />
          </div>
        </section>
      </div>
    </div>
  );
}

function TileBtn({ g, on, onHover, live }: { g: GameView; on: boolean; onHover(): void; live: boolean }) {
  const [url, fail] = useIcon(g.title);
  const size = on ? 150 : 104;
  return (
    <button
      onMouseEnter={onHover}
      onFocus={onHover}
      style={{
        flexShrink: 0, width: size, height: size, borderRadius: 22, border: 0, cursor: "pointer", position: "relative",
        background: "rgba(255,255,255,.1)", backdropFilter: "blur(14px)", transition: "all .25s cubic-bezier(.2,.8,.2,1)",
        boxShadow: on ? "0 0 0 3px #fff, 0 20px 40px rgba(0,0,0,.4)" : "0 10px 24px rgba(0,0,0,.25)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {url ? <img src={url} onError={fail} alt="" style={{ width: "66%" }} /> : <span style={{ fontWeight: 800, fontSize: size * 0.38, color: "rgba(255,255,255,.85)" }}>{initial(g.title)}</span>}
      {live && <span style={{ position: "absolute", top: 8, right: 8, width: 10, height: 10, borderRadius: 99, background: "#4ade80", boxShadow: "0 0 10px #4ade80" }} />}
    </button>
  );
}

function Stat({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ background: "rgba(255,255,255,.1)", backdropFilter: "blur(14px)", borderRadius: 16, padding: "14px 20px", minWidth: 150 }}>
      <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 600 }}>{k}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 2, color: warn ? "#ffb4a8" : "#fff" }}>{v}</div>
    </div>
  );
}
