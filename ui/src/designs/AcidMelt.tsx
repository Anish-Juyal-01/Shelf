import "@fontsource-variable/climate-crisis/full.css";
import "@fontsource-variable/space-grotesk";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, isOverdue, pick, rand, sourceName, useSample } from "./shared";

// 4 · ACID MELT — a Y2K rave flyer. Climate Crisis has a "YEAR" axis that melts its letters (1979 solid → 2050
// dripping); every title melts by how long it's sat unplayed. Fresh games stand tall, forgotten ones puddle.

const A = { paper: "#ECEBE4", ink: "#0B0B0B", lime: "#C8FF00", pink: "#FF3EA5", blue: "#2E4BFF", chrome: "linear-gradient(180deg,#fff 0%,#B8BCC6 38%,#5E6370 52%,#E8EAF0 70%,#9AA0AD 100%)" };
const melt = { fontFamily: "'Climate Crisis Variable', sans-serif" } as const;
const grot = { fontFamily: "'Space Grotesk Variable', sans-serif" } as const;
const mono = { fontFamily: "'Space Mono', monospace" } as const;

/** 0 days idle → 1979 (solid); a year or more → 2050 (melted). */
const yearFor = (days: number) => Math.round(1979 + Math.min(1, days / 365) * (2050 - 1979));

const blobs = [
  "62% 38% 46% 54% / 60% 44% 56% 40%",
  "40% 60% 70% 30% / 40% 50% 50% 60%",
  "30% 70% 50% 50% / 50% 30% 70% 50%",
  "55% 45% 35% 65% / 45% 60% 40% 55%",
];
const fills = [A.lime, A.pink, A.blue, "#FF7A00", "#9B5CFF", A.ink];

export function AcidMelt() {
  const { games, playing, total, overdue } = useSample();
  const ticker = `${games.length} GAMES ✺ ${bytes(total)} ON DISK ✺ ${overdue.length} MELTING (90+ DAYS UNPLAYED) ✺ NOTHING EVER LEAVES THIS PC ✺ `;
  return (
    <div style={{ ...grot, background: A.paper, color: A.ink, minHeight: "100vh", overflow: "hidden" }}>
      <style>{`
        @keyframes am-tick { to { transform: translateX(-50%) } }
        @keyframes am-spin { to { transform: rotate(360deg) } }
        .am-title { transition: font-variation-settings .6s cubic-bezier(.2,.8,.2,1); }
        .am-card:hover .am-title { font-variation-settings: "YEAR" 1979 !important; }
      `}</style>

      {/* Ticker */}
      <div style={{ background: A.ink, color: A.lime, ...mono, fontWeight: 700, fontSize: 13, letterSpacing: "0.12em", whiteSpace: "nowrap", overflow: "hidden", padding: "8px 0" }}>
        <div style={{ display: "inline-block", animation: "am-tick 30s linear infinite" }}>{ticker.repeat(6)}</div>
      </div>

      <header style={{ position: "relative", padding: "26px 40px 10px", display: "flex", alignItems: "flex-end", gap: 24 }}>
        <h1 style={{ ...melt, fontSize: 132, lineHeight: 0.82, margin: 0, letterSpacing: "-0.03em", fontVariationSettings: '"YEAR" 2010' }}>
          SHELF
        </h1>
        <div style={{ paddingBottom: 14, maxWidth: 300 }}>
          <div style={{ ...mono, fontSize: 12, lineHeight: 1.5 }}>
            every game on this PC ✺ the longer you ignore one, the more its name melts.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* starburst sticker */}
        <div style={{ position: "relative", width: 132, height: 132, marginBottom: 6 }}>
          <div style={{ position: "absolute", inset: 0, background: A.pink, clipPath: "polygon(50% 0,61% 18%,82% 8%,80% 30%,100% 38%,85% 54%,98% 72%,76% 76%,72% 98%,54% 86%,38% 100%,32% 78%,10% 84%,16% 62%,0 48%,18% 36%,8% 14%,30% 18%)", animation: "am-spin 18s linear infinite" }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", ...melt, fontSize: 15, lineHeight: 1, color: A.paper, transform: "rotate(-12deg)" }}>
            {overdue.length}<br />MELTING
          </div>
        </div>
      </header>

      <nav style={{ display: "flex", gap: 10, padding: "8px 40px 22px", flexWrap: "wrap" }}>
        {["ALL", "PLAYING", "MELTING", "STEAM", "LOOSE", "XBOX"].map((t, i) => (
          <span key={t} style={{
            ...mono, fontWeight: 700, fontSize: 13, padding: "7px 16px", borderRadius: 999, border: `2px solid ${A.ink}`,
            background: i === 0 ? A.ink : i === 2 ? A.lime : "transparent", color: i === 0 ? A.lime : A.ink,
          }}>{t}</span>
        ))}
        <span style={{ ...mono, fontWeight: 700, fontSize: 13, padding: "7px 16px", borderRadius: 999, background: A.chrome, border: `2px solid ${A.ink}` }}>+ DROP AN .EXE</span>
      </nav>

      <main style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "34px 26px", padding: "0 40px 100px" }}>
        {games.map((g) => <Flyer key={g.id} g={g} playing={playing.has(g.id)} />)}
      </main>
    </div>
  );
}

function Flyer({ g, playing }: { g: GameView; playing: boolean }) {
  const days = idleDays(g);
  const fill = pick(g.title, fills);
  const textOnFill = fill === A.lime ? A.ink : A.paper;
  const year = g.lastPlayed ? yearFor(days) : 2050;
  // Size to the longest word so nothing breaks mid-word.
  const longest = Math.max(...g.title.split(" ").map((w) => w.length));
  const size = Math.max(14, Math.min(30, Math.floor(150 / (longest * 0.86))));
  return (
    <div className="am-card" style={{ position: "relative" }}>
      <div style={{
        aspectRatio: "1", background: fill, borderRadius: pick(g.title, blobs, 1), padding: 18, display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `6px 6px 0 ${A.ink}`, border: `2.5px solid ${A.ink}`, transform: `rotate(${(rand(g.title) - 0.5) * 6}deg)`, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,.35), transparent 45%)" }} />
        <span className="am-title" title={`${days} days since played`} style={{
          ...melt, color: textOnFill, fontSize: size, lineHeight: 0.95, textAlign: "center",
          fontVariationSettings: `"YEAR" ${year}`, position: "relative",
        }}>
          {g.title.toUpperCase()}
        </span>
      </div>
      {playing && (
        <span style={{ position: "absolute", top: -10, right: -6, background: A.lime, border: `2.5px solid ${A.ink}`, ...mono, fontWeight: 700, fontSize: 12, padding: "4px 10px", borderRadius: 999, transform: "rotate(8deg)" }}>
          ✺ PLAYING NOW
        </span>
      )}
      {isOverdue(g) && (
        <span style={{ position: "absolute", top: -8, left: -8, background: A.chrome, border: `2.5px solid ${A.ink}`, ...mono, fontWeight: 700, fontSize: 11, padding: "3px 9px", borderRadius: 4, transform: "rotate(-10deg)" }}>
          {days}D ASLEEP
        </span>
      )}
      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.15 }}>{g.title}</span>
        <span style={{ ...mono, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{bytes(g.sizeBytes)}</span>
      </div>
      <div style={{ ...mono, fontSize: 11, opacity: 0.7 }}>
        {sourceName[g.sources[0]]} · {hours(g.playSeconds)} · {g.lastPlayed ? `${days}d ago` : "never played"}
      </div>
    </div>
  );
}
