import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, initial, isOverdue, sourceName, useIcon, useSample } from "./shared";

// GARAGE — racing telemetry. Carbon black, one signal red, italic expanded numerals. Drives are gauge rings,
// every game is a car in the garage with its playtime as a "lap" bar; idle ones are parked.

const G = { bg: "#0b0b0c", panel: "#141416", line: "#232327", text: "#efefef", dim: "#7d7d82", red: "#ff2d2d", amber: "#ffb020" };
const wide = { fontFamily: "'Archivo Variable', sans-serif", fontStretch: "125%", fontStyle: "italic", fontWeight: 800 } as const;
const ui = { fontFamily: "'Archivo Variable', sans-serif" } as const;

const CARBON = "repeating-linear-gradient(45deg, rgba(255,255,255,.025) 0 2px, transparent 2px 6px), repeating-linear-gradient(-45deg, rgba(255,255,255,.02) 0 2px, transparent 2px 6px)";

export function Garage() {
  const { games, playing, total, idle, idleBytes, week, byPlay, state } = useSample();
  const maxPlay = byPlay[0].playSeconds;
  return (
    <div style={{ ...ui, background: G.bg, backgroundImage: CARBON, color: G.text, minHeight: "100vh", padding: "22px 40px 90px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <span style={{ ...wide, fontSize: 30, letterSpacing: "-0.02em" }}>SHELF<span style={{ color: G.red }}>/</span></span>
        {["Garage", "Telemetry", "Storage", "Pit"].map((t, i) => (
          <span key={t} style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: i === 0 ? G.text : G.dim }}>{t}</span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: G.dim, letterSpacing: "0.1em" }}>SESSION LIVE <span style={{ color: G.red }}>●</span></span>
      </header>

      {/* gauges */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 28 }}>
        {state.drives.map((d) => <Gauge key={d.root} label={`${d.root.replace("\\", "")} ${d.label}`} value={1 - d.freeBytes / d.totalBytes} caption={`${bytes(d.freeBytes)} free`} />)}
        <Stat label="This week" value={hours(week)} />
        <Stat label="Parked 90d+" value={bytes(idleBytes)} red sub={`${idle.length} titles · of ${bytes(total)}`} />
      </section>

      <h2 style={{ ...wide, fontSize: 26, margin: "36px 0 14px", letterSpacing: "-0.01em" }}>THE GARAGE <span style={{ ...ui, fontStyle: "normal", fontSize: 12, color: G.dim, fontWeight: 600 }}>{games.length} · sorted by laps</span></h2>
      <div style={{ display: "grid", gap: 8 }}>
        {byPlay.map((g, i) => <Car key={g.id} g={g} pos={i + 1} max={maxPlay} live={playing.has(g.id)} />)}
      </div>
    </div>
  );
}

function Gauge({ label, value, caption }: { label: string; value: number; caption: string }) {
  const r = 52;
  const arc = Math.PI * 1.5 * r;
  const hot = value > 0.9;
  return (
    <div style={{ background: G.panel, border: `1px solid ${G.line}`, padding: "16px 18px", display: "flex", alignItems: "center", gap: 16 }}>
      <svg width="130" height="110" viewBox="0 0 130 110">
        <circle cx="65" cy="62" r={r} fill="none" stroke={G.line} strokeWidth="10" strokeDasharray={`${arc} 999`} transform="rotate(135 65 62)" strokeLinecap="butt" />
        <circle cx="65" cy="62" r={r} fill="none" stroke={hot ? G.red : G.text} strokeWidth="10" strokeDasharray={`${arc * value} 999`} transform="rotate(135 65 62)" />
        <text x="65" y="70" textAnchor="middle" style={{ ...wide, fontSize: 28, fill: hot ? G.red : G.text }}>{Math.round(value * 100)}</text>
        <text x="65" y="88" textAnchor="middle" style={{ fontSize: 10, fill: G.dim, letterSpacing: "0.15em" }}>% FULL</text>
      </svg>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 12, color: hot ? G.red : G.dim, marginTop: 4 }}>{caption}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, red }: { label: string; value: string; sub?: string; red?: boolean }) {
  return (
    <div style={{ background: G.panel, border: `1px solid ${G.line}`, padding: "18px 20px", borderTop: `3px solid ${red ? G.red : G.text}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: G.dim }}>{label}</div>
      <div style={{ ...wide, fontSize: 46, lineHeight: 1, marginTop: 10, color: red ? G.red : G.text }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: G.dim, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Car({ g, pos, max, live }: { g: GameView; pos: number; max: number; live: boolean }) {
  const [url, fail] = useIcon(g.title);
  const parked = isOverdue(g);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "44px 52px 1.3fr 2fr 110px 120px", alignItems: "center", gap: 16, background: G.panel, border: `1px solid ${G.line}`, borderLeft: `4px solid ${live ? G.red : parked ? G.line : G.text}`, padding: "8px 16px", opacity: parked ? 0.6 : 1 }}>
      <span style={{ ...wide, fontSize: 22, color: pos <= 3 ? G.red : G.dim }}>P{pos}</span>
      <div style={{ width: 44, height: 44, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {url ? <img src={url} onError={fail} alt="" style={{ width: 34 }} /> : <span style={{ ...wide, fontSize: 20, color: G.dim }}>{initial(g.title)}</span>}
      </div>
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, textTransform: "uppercase", letterSpacing: "0.02em" }}>{g.title}</div>
        <div style={{ fontSize: 11.5, color: G.dim }}>{sourceName[g.sources[0]]}{live && <span style={{ color: G.red }}> · ON TRACK</span>}{parked && ` · PARKED ${idleDays(g)}D`}</div>
      </div>
      <div style={{ height: 8, background: G.line, transform: "skewX(-20deg)" }}>
        <div style={{ height: 8, width: `${(g.playSeconds / max) * 100}%`, background: live ? G.red : G.text }} />
      </div>
      <span style={{ ...wide, fontSize: 20, textAlign: "right" }}>{hours(g.playSeconds)}</span>
      <span style={{ fontSize: 13, color: G.dim, textAlign: "right", fontWeight: 600 }}>{bytes(g.sizeBytes)}</span>
    </div>
  );
}
