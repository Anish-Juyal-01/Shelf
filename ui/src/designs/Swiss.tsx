import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, initial, isOverdue, sourceName, useIcon, useSample } from "./shared";

// 2 · SWISS — International Typographic Style. White, black and one red; a strict 12-column grid; enormous
// numbers; every game is a square with its native icon, title and figures set in columns underneath.

const S = { paper: "#f2f2ef", ink: "#0a0a0a", red: "#e30613", grey: "#8a8a85", line: "#0a0a0a" };
const grot = { fontFamily: "'Archivo Variable', 'Helvetica Neue', Arial, sans-serif" } as const;

export function Swiss() {
  const { games, total, idle, idleBytes, week, playing } = useSample();
  return (
    <div style={{ ...grot, background: S.paper, color: S.ink, minHeight: "100vh", padding: "28px 40px 90px" }}>
      <header style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", columnGap: 20, alignItems: "end", borderBottom: `3px solid ${S.ink}`, paddingBottom: 14 }}>
        <h1 style={{ gridColumn: "span 5", margin: 0, fontSize: 132, lineHeight: 0.8, fontWeight: 800, fontStretch: "112%", letterSpacing: "-0.055em" }}>
          Shelf<span style={{ color: S.red }}>.</span>
        </h1>
        <nav style={{ gridColumn: "span 7", display: "flex", gap: 26, justifyContent: "flex-end", fontSize: 14, fontWeight: 600 }}>
          {["Library", "Activity", "Storage", "Review", "Settings"].map((t, i) => (
            <span key={t} style={{ color: i === 0 ? S.ink : S.grey }}>
              <span style={{ fontSize: 11, verticalAlign: "top", marginRight: 4, color: i === 0 ? S.red : S.grey }}>0{i + 1}</span>
              {t}
            </span>
          ))}
        </nav>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", columnGap: 20, padding: "22px 0 30px", borderBottom: `1px solid ${S.line}` }}>
        <Figure span={3} n={String(games.length)} label="Games installed" />
        <Figure span={3} n={bytes(total).split(" ")[0]} unit={bytes(total).split(" ")[1]} label="On disk" />
        <Figure span={3} n={String(idle.length)} label={`Untouched 90+ days — ${bytes(idleBytes)}`} red />
        <Figure span={3} n={hours(week)} label="Played, last 7 days" />
      </section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "26px 0 18px" }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Library</h2>
        <span style={{ fontSize: 13, color: S.grey }}>Sorted by last played · <span style={{ color: S.ink, fontWeight: 600 }}>Search ⌘F</span></span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "34px 20px" }}>
        {games.map((g) => <Tile key={g.id} g={g} playing={playing.has(g.id)} />)}
      </div>
    </div>
  );
}

function Figure({ span, n, unit, label, red }: { span: number; n: string; unit?: string; label: string; red?: boolean }) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 0.85, letterSpacing: "-0.05em", fontStretch: "105%", color: red ? S.red : S.ink }}>
        {n}<span style={{ fontSize: 36, letterSpacing: "-0.02em" }}>{unit}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 10, borderTop: `1px solid ${S.line}`, paddingTop: 6 }}>{label}</div>
    </div>
  );
}

function Tile({ g, playing }: { g: GameView; playing: boolean }) {
  const [url, fail] = useIcon(g.title);
  const idle = isOverdue(g);
  return (
    <div>
      <div style={{ aspectRatio: "1", background: "#fff", border: `1px solid ${S.line}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        {url ? (
          <img src={url} onError={fail} alt="" style={{ width: "58%", height: "58%", objectFit: "contain" }} />
        ) : (
          <span style={{ fontSize: 96, fontWeight: 800, fontStretch: "125%", letterSpacing: "-0.04em" }}>{initial(g.title)}</span>
        )}
        {idle && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, background: S.red }} />}
        {playing && <span style={{ position: "absolute", top: 8, left: 8, fontSize: 11, fontWeight: 700, background: S.ink, color: "#fff", padding: "2px 6px" }}>Playing</span>}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 10, lineHeight: 1.15, letterSpacing: "-0.01em" }}>{g.title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", fontSize: 11.5, marginTop: 6, borderTop: `1px solid ${S.line}`, paddingTop: 5 }}>
        <span>{sourceName[g.sources[0]]}</span>
        <span style={{ textAlign: "center" }}>{bytes(g.sizeBytes)}</span>
        <span style={{ textAlign: "right", color: idle ? S.red : S.ink, fontWeight: idle ? 700 : 400 }}>{g.lastPlayed ? `${idleDays(g)}d` : "—"}</span>
      </div>
    </div>
  );
}
