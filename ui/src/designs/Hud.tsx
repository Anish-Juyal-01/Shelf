import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, initial, isOverdue, sourceName, spark, useIcon, useSample } from "./shared";

// HUD — a tactical shooter's menu. Angled panels, corner brackets, hairlines, cyan readouts with orange alerts,
// Chakra Petch in caps. Your loadout: the active game big, the rest as a squad of icon slots.

const H = { bg: "#0a0e12", panel: "rgba(16,24,30,.85)", line: "#1d2a33", cyan: "#4fe3ff", orange: "#ff8a1f", red: "#ff4757", text: "#dbe7ee", dim: "#6b7f8c" };
const petch = { fontFamily: "'Chakra Petch', sans-serif" } as const;
const cut = (s = 14) => `polygon(${s}px 0, 100% 0, 100% calc(100% - ${s}px), calc(100% - ${s}px) 100%, 0 100%, 0 ${s}px)`;

export function Hud() {
  const { games, playing, total, idle, idleBytes, week, days14, state } = useSample();
  const main = games.find((g) => playing.has(g.id)) ?? games[0];
  const s = spark(days14, main.id);
  return (
    <div style={{ ...petch, background: H.bg, color: H.text, minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      {/* scan grid */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: `linear-gradient(${H.line} 1px, transparent 1px), linear-gradient(90deg, ${H.line} 1px, transparent 1px)`, backgroundSize: "56px 56px", opacity: 0.35 }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(70% 60% at 30% 30%, rgba(79,227,255,.08), transparent)" }} />

      <div style={{ position: "relative", padding: "22px 40px 90px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 26, textTransform: "uppercase", letterSpacing: "0.16em", fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.3em", color: H.cyan }}>SHELF</span>
          {["Loadout", "Activity", "Storage", "Intel"].map((t, i) => (
            <span key={t} style={{ color: i === 0 ? H.text : H.dim, borderBottom: i === 0 ? `2px solid ${H.cyan}` : "2px solid transparent", paddingBottom: 4 }}>{t}</span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ color: H.dim }}>Storage <b style={{ color: H.text }}>{bytes(total)}</b></span>
          <span style={{ color: H.orange }}>⚠ {idle.length} idle</span>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 26, marginTop: 34 }}>
          {/* main card */}
          <Bracket>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 30, padding: 30, background: H.panel, clipPath: cut(22) }}>
              <Slot g={main} size={220} glow />
              <div>
                <div style={{ fontSize: 12, letterSpacing: "0.3em", color: playing.has(main.id) ? H.cyan : H.dim }}>{playing.has(main.id) ? "▶ ACTIVE DEPLOYMENT" : "READY"}</div>
                <h1 style={{ fontSize: 68, fontWeight: 700, textTransform: "uppercase", lineHeight: 0.95, margin: "10px 0 18px", letterSpacing: "0.02em" }}>{main.title}</h1>
                <div style={{ display: "flex", gap: 24, marginBottom: 22 }}>
                  <Readout k="Time in game" v={hours(main.playSeconds)} />
                  <Readout k="Footprint" v={bytes(main.sizeBytes)} />
                  <Readout k="Platform" v={sourceName[main.sources[0]]} />
                </div>
                <button style={{ ...petch, fontSize: 18, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", background: H.cyan, color: "#001218", border: 0, padding: "12px 40px", clipPath: cut(10), cursor: "pointer" }}>Deploy</button>
              </div>
            </div>
          </Bracket>

          {/* side intel */}
          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <Panel title="Activity · 14d">
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 50 }}>
                {s.map((v, i) => <span key={i} style={{ flex: 1, height: v ? Math.max(3, (v / Math.max(3600, ...s)) * 50) : 2, background: v ? H.cyan : H.line }} />)}
              </div>
              <div style={{ fontSize: 12, color: H.dim, marginTop: 8 }}>All games this week: <b style={{ color: H.text }}>{hours(week)}</b></div>
            </Panel>
            <Panel title="Drives">
              {state.drives.map((d) => {
                const used = 1 - d.freeBytes / d.totalBytes;
                return (
                  <div key={d.root} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{d.root.replace("\\", "")} {d.label}</span><span style={{ color: used > 0.9 ? H.red : H.dim }}>{Math.round(used * 100)}%</span></div>
                    <div style={{ height: 6, background: H.line, marginTop: 4, clipPath: cut(3) }}><div style={{ height: 6, width: `${used * 100}%`, background: used > 0.9 ? H.red : H.cyan }} /></div>
                  </div>
                );
              })}
            </Panel>
            <Panel title="Alert" accent={H.orange}>
              <div style={{ fontSize: 14, lineHeight: 1.45 }}>{idle.length} titles idle 90+ days holding <b style={{ color: H.orange }}>{bytes(idleBytes)}</b>.</div>
            </Panel>
          </div>
        </div>

        <h2 style={{ fontSize: 13, letterSpacing: "0.3em", textTransform: "uppercase", color: H.dim, margin: "36px 0 12px" }}>Squad · {games.length}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 14 }}>
          {games.map((g) => (
            <div key={g.id}>
              <Slot g={g} size={0} />
              <div style={{ fontSize: 12.5, fontWeight: 600, textTransform: "uppercase", marginTop: 7, letterSpacing: "0.04em", lineHeight: 1.15 }}>{g.title}</div>
              <div style={{ fontSize: 11.5, color: isOverdue(g) ? H.orange : H.dim }}>{isOverdue(g) ? `IDLE ${idleDays(g)}D` : `${hours(g.playSeconds)} · ${bytes(g.sizeBytes)}`}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bracket({ children }: { children: React.ReactNode }) {
  const c = (pos: React.CSSProperties) => <span style={{ position: "absolute", width: 18, height: 18, borderColor: H.cyan, borderStyle: "solid", ...pos }} />;
  return (
    <div style={{ position: "relative", padding: 6 }}>
      {c({ top: 0, left: 0, borderWidth: "2px 0 0 2px" })}
      {c({ top: 0, right: 0, borderWidth: "2px 2px 0 0" })}
      {c({ bottom: 0, left: 0, borderWidth: "0 0 2px 2px" })}
      {c({ bottom: 0, right: 0, borderWidth: "0 2px 2px 0" })}
      {children}
    </div>
  );
}

function Panel({ title, accent = H.cyan, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: H.panel, clipPath: cut(12), padding: "14px 16px", borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 11.5, letterSpacing: "0.28em", textTransform: "uppercase", color: accent, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Readout({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: H.dim }}>{k}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: H.cyan }}>{v}</div>
    </div>
  );
}

function Slot({ g, size, glow }: { g: GameView; size: number; glow?: boolean }) {
  const [url, fail] = useIcon(g.title);
  return (
    <div style={{
      width: size || "100%", aspectRatio: "1", background: "rgba(79,227,255,.05)", border: `1px solid ${H.line}`, clipPath: cut(size ? 18 : 12),
      display: "flex", alignItems: "center", justifyContent: "center", boxShadow: glow ? `inset 0 0 60px rgba(79,227,255,.18)` : "none", filter: isOverdue(g) ? "grayscale(.75) brightness(.8)" : "none",
    }}>
      {url ? <img src={url} onError={fail} alt="" style={{ width: "58%" }} /> : <span style={{ fontSize: size ? 90 : 42, fontWeight: 700, color: H.dim }}>{initial(g.title)}</span>}
    </div>
  );
}
