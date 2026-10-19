import { useState } from "react";
import type { GameView } from "../bridge/protocol";
import { bytes, hours, iconFor, idleDays, initial, isOverdue, sourceName, spark, useIcon, useSample } from "./shared";

// FUSION — the three you liked, in one. Console's room that takes the selected game's colours; Arena's huge
// condensed title, volt Play button and tile rows; Mission Control's monospaced data strip with sparklines.

const F = { text: "#f4f4f2", dim: "rgba(244,244,242,.55)", volt: "#d7ff3a", red: "#ff5a4a", line: "rgba(255,255,255,.12)", tile: "rgba(255,255,255,.07)" };
const anton = { fontFamily: "Anton, Impact, sans-serif", textTransform: "uppercase", letterSpacing: "0.01em" } as const;
const ui = { fontFamily: "'Manrope Variable', sans-serif" } as const;
const mono = { fontFamily: "'JetBrains Mono Variable', monospace" } as const;

export function Fusion() {
  const { games, playing, total, idle, idleBytes, days14, week, bySize } = useSample();
  const [sel, setSel] = useState<GameView>(games.find((g) => playing.has(g.id)) ?? games[0]);
  const bg = iconFor(sel.title);
  const s = spark(days14, sel.id);
  return (
    <div style={{ ...ui, minHeight: "100vh", color: F.text, background: "#07080a", position: "relative", overflow: "hidden" }}>
      {bg && <img key={bg} src={bg} alt="" style={{ position: "absolute", left: "-10%", top: "-30%", width: "120%", height: "110%", objectFit: "cover", filter: "blur(110px) saturate(1.7) brightness(0.5)" }} />}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(7,8,10,.2) 0%, rgba(7,8,10,.75) 55%, #07080a 78%)" }} />

      <div style={{ position: "relative", padding: "20px 44px 90px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <span style={{ ...anton, fontSize: 28 }}>Shelf</span>
          {["Library", "Activity", "Storage", "Review"].map((t, i) => (
            <span key={t} style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: i === 0 ? F.text : F.dim }}>{t}</span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ ...mono, fontSize: 12, color: F.dim }}>{games.length} TITLES · {bytes(total)} · <span style={{ color: F.red }}>{idle.length} IDLE</span></span>
          <span style={{ ...mono, fontSize: 12, color: F.volt }}>● TRACKING</span>
        </header>

        {/* hero */}
        <section style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 40, alignItems: "end", marginTop: 60 }}>
          <div>
            <div style={{ ...mono, fontSize: 12, color: playing.has(sel.id) ? F.volt : F.dim, letterSpacing: "0.12em" }}>
              {playing.has(sel.id) ? "● PLAYING NOW" : sel.lastPlayed ? `LAST PLAYED ${idleDays(sel)}D AGO` : "NEVER PLAYED"} · {sourceName[sel.sources[0]].toUpperCase()}
            </div>
            <h1 style={{ ...anton, fontSize: 124, lineHeight: 0.88, margin: "12px 0 26px", maxWidth: 900 }}>{sel.title}</h1>
            <div style={{ display: "flex", gap: 12 }}>
              <button style={{ ...anton, fontSize: 24, background: F.volt, color: "#000", border: 0, padding: "12px 40px", cursor: "pointer" }}>Play</button>
              <button style={{ ...anton, fontSize: 24, background: "rgba(255,255,255,.08)", color: F.text, border: `1px solid ${F.line}`, padding: "12px 26px", cursor: "pointer", backdropFilter: "blur(8px)" }}>Details</button>
            </div>
          </div>
          {/* data strip */}
          <div style={{ ...mono, fontSize: 12.5, background: "rgba(0,0,0,.35)", border: `1px solid ${F.line}`, backdropFilter: "blur(12px)", padding: 18 }}>
            <Row k="played" v={hours(sel.playSeconds)} c={F.volt} />
            <Row k="on disk" v={bytes(sel.sizeBytes)} />
            <Row k="copies" v={String(sel.copies)} />
            <Row k="status" v={isOverdue(sel) ? `IDLE ${idleDays(sel)}D` : "ACTIVE"} c={isOverdue(sel) ? F.red : F.text} />
            <div style={{ color: F.dim, marginTop: 12, marginBottom: 6, letterSpacing: "0.12em", fontSize: 11 }}>LAST 14 DAYS</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 36 }}>
              {s.map((v, i) => {
                const max = Math.max(3600, ...s);
                return <span key={i} style={{ flex: 1, height: v ? Math.max(3, (v / max) * 36) : 2, background: v ? F.volt : F.line }} />;
              })}
            </div>
          </div>
        </section>

        {/* rows */}
        <TileRow title="Library" games={games} sel={sel} onSel={setSel} playing={playing} />
        <TileRow title="Biggest on disk" games={bySize.slice(0, 9)} sel={sel} onSel={setSel} playing={playing} size />
        <div style={{ ...mono, fontSize: 12, color: F.dim, marginTop: 8 }}>
          played this week <span style={{ color: F.volt }}>{hours(week)}</span> · idle space <span style={{ color: F.red }}>{bytes(idleBytes)}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${F.line}` }}>
      <span style={{ color: F.dim }}>{k}</span>
      <span style={{ color: c ?? F.text, fontWeight: 700 }}>{v}</span>
    </div>
  );
}

function TileRow({ title, games, sel, onSel, playing, size }: { title: string; games: GameView[]; sel: GameView; onSel(g: GameView): void; playing: Set<number>; size?: boolean }) {
  return (
    <section style={{ marginTop: 44 }}>
      <h2 style={{ ...anton, fontSize: 26, margin: "0 0 12px" }}>{title} <span style={{ ...mono, fontSize: 12, color: F.dim }}>{games.length}</span></h2>
      <div style={{ display: "flex", gap: 12, overflowX: "auto", padding: "5px 5px 6px", margin: "0 -5px" }}>
        {games.map((g) => <Tile key={g.id} g={g} on={g.id === sel.id} onSel={() => onSel(g)} live={playing.has(g.id)} size={size} />)}
      </div>
    </section>
  );
}

function Tile({ g, on, onSel, live, size }: { g: GameView; on: boolean; onSel(): void; live: boolean; size?: boolean }) {
  const [url, fail] = useIcon(g.title);
  const idle = isOverdue(g);
  return (
    <button onMouseEnter={onSel} onFocus={onSel} style={{ alignSelf: "flex-start", flexShrink: 0, width: 128, textAlign: "left", background: "none", border: 0, padding: 0, cursor: "pointer", color: F.text }}>
      <div style={{
        width: 128, height: 128, background: F.tile, backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
        outline: on ? `2px solid ${F.volt}` : `1px solid ${F.line}`, outlineOffset: on ? 3 : 0, transition: "outline-offset .15s", filter: idle ? "grayscale(.7)" : "none",
      }}>
        {url ? <img src={url} onError={fail} alt="" style={{ width: "60%" }} /> : <span style={{ ...anton, fontSize: 56, color: "transparent", WebkitTextStroke: `1px ${F.dim}` }}>{initial(g.title)}</span>}
        {live && <span style={{ position: "absolute", top: 7, right: 7, width: 8, height: 8, borderRadius: 9, background: F.volt, boxShadow: `0 0 8px ${F.volt}` }} />}
        {size && <span style={{ position: "absolute", left: 7, bottom: 5, ...mono, fontSize: 11, color: F.volt }}>{bytes(g.sizeBytes)}</span>}
        {!size && idle && <span style={{ position: "absolute", left: 7, bottom: 5, ...mono, fontSize: 10.5, color: F.red }}>IDLE {idleDays(g)}D</span>}
      </div>
      <div style={{ ...anton, fontSize: 15, marginTop: 7, lineHeight: 1.05 }}>{g.title}</div>
    </button>
  );
}
