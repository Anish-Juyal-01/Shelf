import "@fontsource/bungee";
import "@fontsource/bungee-shade";
import "@fontsource/vt323";
import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, isOverdue, rand, sourceName, useSample } from "./shared";

// 2 · INSERT COIN — an arcade cabinet. Black glass, neon tubes, CRT scanlines, a chasing-lights marquee, a
// high-score table ranked by playtime, "1UP" blinking on whatever you're playing, GAME OVER? for idle games.

const N = { black: "#07060B", pink: "#FF2BD6", cyan: "#20F0FF", yellow: "#FFE600", green: "#39FF6A", dim: "#2A2340" };
const shade = { fontFamily: "'Bungee Shade', cursive" } as const;
const bungee = { fontFamily: "Bungee, cursive" } as const;
const vt = { fontFamily: "VT323, monospace" } as const;
const glow = (c: string) => `0 0 4px ${c}, 0 0 12px ${c}, 0 0 28px ${c}88`;

export function InsertCoin() {
  const { games, playing, total, byPlay } = useSample();
  return (
    <div style={{ ...vt, background: N.black, color: "#E8E6FF", minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes ic-blink { 50% { opacity: 0 } }
        @keyframes ic-chase { to { background-position: 28px 0 } }
        .ic-card:hover { transform: translateY(-4px) scale(1.02); }
      `}</style>
      {/* scanlines + vignette */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 50, background: "repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px)" }} />
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 49, background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.7))" }} />

      {/* Marquee */}
      <header style={{ margin: "22px 32px 0", border: `3px solid ${N.pink}`, borderRadius: 14, boxShadow: `${glow(N.pink)}, inset ${glow(N.pink)}`, padding: "18px 28px", position: "relative" }}>
        <div style={{
          position: "absolute", left: 10, right: 10, top: 6, height: 6,
          backgroundImage: `radial-gradient(circle, ${N.yellow} 2px, transparent 2.5px)`, backgroundSize: "14px 6px", animation: "ic-chase .6s linear infinite",
        }} />
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <span style={{ ...shade, fontSize: 70, lineHeight: 1, color: N.yellow, textShadow: glow("#FF9900") }}>SHELF</span>
          <div style={{ fontSize: 26, lineHeight: 1.05, color: N.cyan, textShadow: glow(N.cyan) }}>
            {games.length} CARTRIDGES LOADED<br />{bytes(total)} OF MEMORY USED
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ ...bungee, fontSize: 22, color: N.green, textShadow: glow(N.green), animation: "ic-blink 1.1s steps(1) infinite" }}>INSERT COIN</div>
        </div>
      </header>

      <nav style={{ display: "flex", gap: 14, padding: "22px 32px 0", ...bungee, fontSize: 15 }}>
        {["SELECT GAME", "HIGH SCORES", "MEMORY", "CONTINUE?", "OPTIONS"].map((t, i) => (
          <span key={t} style={{
            padding: "8px 16px", borderRadius: 8, border: `2px solid ${i === 0 ? N.cyan : N.dim}`, color: i === 0 ? N.cyan : "#8E87B8",
            boxShadow: i === 0 ? glow(N.cyan) : "none", textShadow: i === 0 ? glow(N.cyan) : "none",
          }}>
            {i === 0 && "▶ "}{t}
          </span>
        ))}
      </nav>

      <main style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 28, padding: "24px 32px 90px" }}>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 20 }}>
          {games.map((g) => <Cabinet key={g.id} g={g} playing={playing.has(g.id)} />)}
        </section>
        <aside style={{ border: `2px solid ${N.cyan}`, borderRadius: 12, padding: "18px 18px 22px", boxShadow: glow(N.cyan), alignSelf: "start" }}>
          <div style={{ ...bungee, fontSize: 22, color: N.yellow, textShadow: glow("#FF9900"), textAlign: "center" }}>HIGH SCORES</div>
          <div style={{ fontSize: 16, textAlign: "center", color: "#8E87B8", marginBottom: 12 }}>RANK · GAME · TIME</div>
          {byPlay.slice(0, 10).map((g, i) => (
            <div key={g.id} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", fontSize: 22, lineHeight: 1.25, color: [N.yellow, N.cyan, N.pink][i] ?? "#E8E6FF" }}>
              <span>{["1ST", "2ND", "3RD"][i] ?? `${i + 1}TH`}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title.toUpperCase()}</span>
              <span>{hours(g.playSeconds)}</span>
            </div>
          ))}
        </aside>
      </main>
    </div>
  );
}

function Cabinet({ g, playing }: { g: GameView; playing: boolean }) {
  const hue = Math.round(rand(g.title) * 360);
  const idle = isOverdue(g);
  const tube = playing ? N.green : idle ? "#5A5470" : `hsl(${hue} 100% 62%)`;
  return (
    <div className="ic-card" style={{ transition: "transform .15s", border: `2px solid ${tube}`, borderRadius: 10, padding: 8, boxShadow: idle ? "none" : glow(tube), background: "#0D0B16", opacity: idle ? 0.75 : 1 }}>
      {/* screen */}
      <div style={{
        aspectRatio: "4/3", borderRadius: 18, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: 10, textAlign: "center",
        background: `radial-gradient(ellipse at 50% 40%, hsl(${hue} 90% 30%), #05040A 75%)`, boxShadow: "inset 0 0 22px rgba(0,0,0,.9)",
      }}>
        <span style={{ ...bungee, fontSize: g.title.length > 18 ? 14 : 18, lineHeight: 1.05, color: idle ? "#6E6888" : `hsl(${hue} 100% 80%)`, textShadow: idle ? "none" : glow(`hsl(${hue} 100% 60%)`) }}>
          {g.title.toUpperCase()}
        </span>
        {playing && <span style={{ position: "absolute", top: 6, left: 10, fontSize: 20, color: N.green, textShadow: glow(N.green), animation: "ic-blink .9s steps(1) infinite" }}>1UP</span>}
        {idle && (
          <span style={{ position: "absolute", left: 0, right: 0, bottom: 6, textAlign: "center", fontSize: 22, color: N.pink, textShadow: glow(N.pink), animation: "ic-blink 1.6s steps(1) infinite" }}>
            GAME OVER?
          </span>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, marginTop: 6, color: "#B9B3E0" }}>
        <span>{sourceName[g.sources[0]].toUpperCase()}</span>
        <span style={{ color: N.yellow }}>{bytes(g.sizeBytes)}</span>
      </div>
      <div style={{ fontSize: 17, color: idle ? N.pink : "#7F79A8" }}>
        {g.lastPlayed ? (idle ? `IDLE ${idleDays(g)} DAYS` : `SCORE ${hours(g.playSeconds)}`) : "NEVER PLAYED"}
      </div>
    </div>
  );
}
