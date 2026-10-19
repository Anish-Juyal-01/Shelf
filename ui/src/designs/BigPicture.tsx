import { useState } from "react";
import type { GameView } from "../bridge/protocol";
import { bytes, hours, iconFor, idleDays, initial, isOverdue, relative, sourceName, spark, useIcon, useSample } from "./shared";

// BIG PICTURE — a couch-mode library. Dark navy, a big grid of icon tiles with a soft focus glow, and a side panel
// tinted by the focused game's own icon, with monospaced stats underneath.

const B = { bg: "#0d1420", tile: "#16202f", line: "#223047", text: "#eaf1fb", dim: "#7f8ea5", focus: "#6ea8ff", red: "#ff7a7a" };
const ui = { fontFamily: "'Manrope Variable', sans-serif" } as const;
const mono = { fontFamily: "'JetBrains Mono Variable', monospace" } as const;

export function BigPicture() {
  const { games, playing, total, idle, days14 } = useSample();
  const [focus, setFocus] = useState<GameView>(games[0]);
  const tint = iconFor(focus.title);
  const s = spark(days14, focus.id);
  return (
    <div style={{ ...ui, background: B.bg, color: B.text, minHeight: "100vh", display: "grid", gridTemplateColumns: "1fr 400px" }}>
      <main style={{ padding: "24px 36px 90px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26 }}>
          <span style={{ fontWeight: 800, fontSize: 22, marginRight: 18 }}>Shelf</span>
          {["All games", "Recent", "Installed", "Idle"].map((t, i) => (
            <span key={t} style={{ fontSize: 14, fontWeight: 700, padding: "8px 16px", borderRadius: 999, background: i === 0 ? B.focus : B.tile, color: i === 0 ? "#06122a" : B.dim }}>{t}{t === "Idle" && ` ${idle.length}`}</span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ ...mono, fontSize: 12, color: B.dim }}>{games.length} · {bytes(total)}</span>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 20 }}>
          {games.map((g) => <Tile key={g.id} g={g} on={g.id === focus.id} live={playing.has(g.id)} onFocus={() => setFocus(g)} />)}
        </div>
      </main>

      <aside style={{ position: "relative", overflow: "hidden", borderLeft: `1px solid ${B.line}` }}>
        {tint && <img key={tint} src={tint} alt="" style={{ position: "absolute", inset: "-30%", width: "160%", height: "160%", objectFit: "cover", filter: "blur(70px) saturate(1.5) brightness(.55)" }} />}
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, rgba(13,20,32,.2), ${B.bg} 75%)` }} />
        <div style={{ position: "relative", padding: "60px 32px" }}>
          <FocusIcon g={focus} />
          <div style={{ fontSize: 13, color: B.dim, fontWeight: 700, marginTop: 22, textTransform: "uppercase", letterSpacing: "0.08em" }}>{sourceName[focus.sources[0]]}</div>
          <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, margin: "6px 0 20px" }}>{focus.title}</h1>
          <button style={{ ...ui, width: "100%", fontSize: 17, fontWeight: 800, padding: "14px 0", borderRadius: 12, border: 0, background: B.focus, color: "#06122a", cursor: "pointer" }}>
            {playing.has(focus.id) ? "Playing now" : "Play"}
          </button>
          <div style={{ ...mono, fontSize: 13, marginTop: 26, display: "grid", gap: 8 }}>
            <Kv k="played" v={hours(focus.playSeconds)} />
            <Kv k="on disk" v={bytes(focus.sizeBytes)} />
            <Kv k="last played" v={focus.lastPlayed ? relative(focus.lastPlayed) : "never"} c={isOverdue(focus) ? B.red : undefined} />
            <Kv k="copies" v={String(focus.copies)} />
          </div>
          <div style={{ ...mono, fontSize: 11, color: B.dim, margin: "22px 0 8px", letterSpacing: "0.12em" }}>LAST 14 DAYS</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 44 }}>
            {s.map((v, i) => <span key={i} style={{ flex: 1, borderRadius: 3, height: v ? Math.max(4, (v / Math.max(3600, ...s)) * 44) : 3, background: v ? B.focus : B.line }} />)}
          </div>
          {isOverdue(focus) && <div style={{ marginTop: 22, fontSize: 14, color: B.red }}>Not played for {idleDays(focus)} days — uninstalling frees {bytes(focus.sizeBytes)}.</div>}
        </div>
      </aside>
    </div>
  );
}

function Kv({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${B.line}`, paddingBottom: 6 }}>
      <span style={{ color: B.dim }}>{k}</span>
      <span style={{ color: c ?? B.text, fontWeight: 700 }}>{v}</span>
    </div>
  );
}

function FocusIcon({ g }: { g: GameView }) {
  const [url, fail] = useIcon(g.title);
  return (
    <div style={{ width: 140, height: 140, borderRadius: 28, background: "rgba(255,255,255,.08)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 20px 50px rgba(0,0,0,.4)" }}>
      {url ? <img src={url} onError={fail} alt="" style={{ width: "66%" }} /> : <span style={{ fontWeight: 800, fontSize: 64, color: B.dim }}>{initial(g.title)}</span>}
    </div>
  );
}

function Tile({ g, on, live, onFocus }: { g: GameView; on: boolean; live: boolean; onFocus(): void }) {
  const [url, fail] = useIcon(g.title);
  return (
    <button onMouseEnter={onFocus} onFocus={onFocus} style={{ ...ui, alignSelf: "start", background: "none", border: 0, padding: 0, textAlign: "left", color: B.text, cursor: "pointer" }}>
      <div style={{
        aspectRatio: "1", borderRadius: 18, background: B.tile, display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
        transform: on ? "scale(1.06)" : "none", transition: "transform .2s, box-shadow .2s",
        boxShadow: on ? `0 0 0 3px ${B.focus}, 0 0 40px ${B.focus}66` : `inset 0 0 0 1px ${B.line}`, opacity: isOverdue(g) && !on ? 0.55 : 1,
      }}>
        {url ? <img src={url} onError={fail} alt="" style={{ width: "58%" }} /> : <span style={{ fontWeight: 800, fontSize: 52, color: B.dim }}>{initial(g.title)}</span>}
        {live && <span style={{ position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: 9, background: "#4ade80", boxShadow: "0 0 10px #4ade80" }} />}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10, color: on ? B.text : B.dim }}>{g.title}</div>
    </button>
  );
}
