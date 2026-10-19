import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, initial, isOverdue, sourceName, useIcon, useSample } from "./shared";

// 3 · ARENA — a dark gallery with an athletic voice. Near-black, condensed all-caps display type, one electric
// accent. A big "up next" hero, then rows of icon tiles: keep playing, biggest on disk, gathering dust.

const A = { bg: "#060606", tile: "#111", tile2: "#181818", text: "#f4f4f2", dim: "#7c7c78", volt: "#d7ff3a", red: "#ff4d3d" };
const anton = { fontFamily: "Anton, Impact, sans-serif", letterSpacing: "0.01em", textTransform: "uppercase" } as const;
const ui = { fontFamily: "'Manrope Variable', sans-serif" } as const;

export function Arena() {
  const { games, playing, bySize, idle, total } = useSample();
  const hero = games.find((g) => playing.has(g.id)) ?? games[0];
  const keep = games.filter((g) => !isOverdue(g)).slice(0, 8);
  return (
    <div style={{ ...ui, background: A.bg, color: A.text, minHeight: "100vh", paddingBottom: 90 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 30, padding: "20px 40px" }}>
        <span style={{ ...anton, fontSize: 30 }}>Shelf</span>
        {["Library", "Activity", "Storage", "Review"].map((t, i) => (
          <span key={t} style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: i === 0 ? A.text : A.dim }}>{t}</span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: A.dim }}>{games.length} games · {bytes(total)}</span>
      </header>

      <Hero g={hero} live={playing.has(hero.id)} />

      <Row title="Keep playing" games={keep} />
      <Row title="Biggest on disk" games={bySize.slice(0, 8)} showSize />
      <Row title="Gathering dust" games={idle} dusty />
    </div>
  );
}

function Hero({ g, live }: { g: GameView; live: boolean }) {
  const [url, fail] = useIcon(g.title);
  return (
    <section style={{ margin: "6px 40px 40px", background: `linear-gradient(110deg, ${A.tile2}, ${A.bg} 70%)`, border: `1px solid #222`, display: "grid", gridTemplateColumns: "260px 1fr", gap: 40, padding: "36px 44px", alignItems: "center" }}>
      <div style={{ aspectRatio: "1", background: A.tile, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 80px -20px ${A.volt}55` }}>
        {url ? <img src={url} onError={fail} alt="" style={{ width: "70%" }} /> : <span style={{ ...anton, fontSize: 140, color: A.volt }}>{initial(g.title)}</span>}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.2em", color: live ? A.volt : A.dim }}>{live ? "● PLAYING NOW" : "UP NEXT"}</div>
        <h1 style={{ ...anton, fontSize: 110, lineHeight: 0.9, margin: "10px 0 16px" }}>{g.title}</h1>
        <div style={{ display: "flex", gap: 28, fontSize: 14, color: A.dim, marginBottom: 26 }}>
          <span><b style={{ color: A.text }}>{hours(g.playSeconds)}</b> played</span>
          <span><b style={{ color: A.text }}>{bytes(g.sizeBytes)}</b> on disk</span>
          <span>{sourceName[g.sources[0]]}</span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button style={{ ...anton, fontSize: 22, background: A.volt, color: "#000", border: 0, padding: "12px 34px", cursor: "pointer" }}>Play</button>
          <button style={{ ...anton, fontSize: 22, background: "transparent", color: A.text, border: `1px solid #333`, padding: "12px 26px", cursor: "pointer" }}>Details</button>
        </div>
      </div>
    </section>
  );
}

function Row({ title, games, showSize, dusty }: { title: string; games: GameView[]; showSize?: boolean; dusty?: boolean }) {
  if (games.length === 0) return null;
  return (
    <section style={{ padding: "0 40px", marginBottom: 38 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
        <h2 style={{ ...anton, fontSize: 30, margin: 0, color: dusty ? A.red : A.text }}>{title}</h2>
        <span style={{ fontSize: 12, color: A.dim }}>{games.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 14 }}>
        {games.slice(0, 8).map((g) => <Tile key={g.id} g={g} showSize={showSize} dusty={dusty} />)}
      </div>
    </section>
  );
}

function Tile({ g, showSize, dusty }: { g: GameView; showSize?: boolean; dusty?: boolean }) {
  const [url, fail] = useIcon(g.title);
  return (
    <div style={{ cursor: "pointer" }}>
      <div style={{ aspectRatio: "1", background: A.tile, display: "flex", alignItems: "center", justifyContent: "center", outline: "1px solid #1d1d1d", position: "relative", filter: dusty ? "grayscale(0.8)" : "none" }}>
        {url ? <img src={url} onError={fail} alt="" style={{ width: "62%" }} /> : <span style={{ ...anton, fontSize: 64, color: "#2a2a2a", WebkitTextStroke: `1px ${A.dim}` }}>{initial(g.title)}</span>}
        {showSize && <span style={{ position: "absolute", left: 8, bottom: 6, ...anton, fontSize: 20, color: A.volt }}>{bytes(g.sizeBytes)}</span>}
        {dusty && <span style={{ position: "absolute", left: 8, bottom: 6, fontSize: 11, fontWeight: 800, color: A.red }}>{idleDays(g)} DAYS</span>}
      </div>
      <div style={{ ...anton, fontSize: 17, marginTop: 8, lineHeight: 1.05 }}>{g.title}</div>
    </div>
  );
}
