import "@fontsource-variable/unbounded";
import "./big-shoulders.css";
import "@fontsource-variable/space-grotesk";
import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, isOverdue, pick, rand, sourceName, useSample } from "./shared";

// 5 · CRATE DIGGER — a record shop. Games are square sleeves filed in crates by where they came from, behind
// big divider tabs; the one you're playing has its vinyl out and spinning; overdue games end up in the BARGAIN BIN.

const K = { paper: "#F3EFE6", ink: "#111", orange: "#FF5A1F", cobalt: "#1F3BFF", yellow: "#FFD400", grid: "#E2DCCF" };
const wide = { fontFamily: "'Unbounded Variable', sans-serif" } as const;
const tall = { fontFamily: "'Big Shoulders Display Variable', sans-serif" } as const;
const grot = { fontFamily: "'Space Grotesk Variable', sans-serif" } as const;

const sleeves = ["#FF5A1F", "#1F3BFF", "#FFD400", "#111111", "#00A36C", "#F2A2C0", "#7B2FF7", "#E8E1D0"];

export function CrateDigger() {
  const { games, playing, total, overdue } = useSample();
  const live = games.filter((g) => !isOverdue(g));
  const crates = new Map<string, GameView[]>();
  for (const g of live) {
    const k = sourceName[g.sources[0]];
    crates.set(k, [...(crates.get(k) ?? []), g]);
  }
  // One-record crates go together, like a real shop's "misc" bin.
  const misc: GameView[] = [];
  for (const [k, list] of [...crates]) if (list.length < 2) { misc.push(...list); crates.delete(k); }
  if (misc.length) crates.set("Odds & ends", misc);
  return (
    <div style={{
      ...grot, background: K.paper, color: K.ink, minHeight: "100vh",
      backgroundImage: `linear-gradient(${K.grid} 1px, transparent 1px), linear-gradient(90deg, ${K.grid} 1px, transparent 1px)`, backgroundSize: "48px 48px",
    }}>
      <style>{`@keyframes cd-spin { to { transform: rotate(360deg) } } .cd-sleeve:hover .cd-disc { transform: translateX(46%) }`}</style>

      <header style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", alignItems: "end", gap: 28, padding: "30px 40px 22px", borderBottom: `4px solid ${K.ink}` }}>
        <h1 style={{ ...wide, fontWeight: 900, fontSize: 96, lineHeight: 0.8, margin: 0, letterSpacing: "-0.04em" }}>
          SHE<span style={{ color: K.orange }}>LF</span>
        </h1>
        <div style={{ ...grot, fontSize: 13, lineHeight: 1.4, maxWidth: 280, paddingBottom: 4 }}>
          Every game on this PC, filed by where it came from. Est. today, open late, nothing leaves the shop.
        </div>
        <Big n={String(games.length)} label="records in stock" />
        <Big n={bytes(total).split(" ")[0]} unit={bytes(total).split(" ")[1]} label="shelf space used" color={K.orange} />
      </header>

      <main style={{ padding: "8px 40px 100px" }}>
        {[...crates.entries()].map(([name, list]) => (
          <Crate key={name} name={name} games={list} playing={playing} />
        ))}
        <Crate name="Bargain bin" games={overdue} playing={playing} bargain />
      </main>
    </div>
  );
}

function Big({ n, unit, label, color = K.ink }: { n: string; unit?: string; label: string; color?: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ ...tall, fontWeight: 900, fontSize: 92, lineHeight: 0.8, color }}>
        {n}<span style={{ fontSize: 34 }}>{unit}</span>
      </div>
      <div style={{ ...wide, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 6 }}>{label}</div>
    </div>
  );
}

function Crate({ name, games, playing, bargain }: { name: string; games: GameView[]; playing: Set<number>; bargain?: boolean }) {
  if (games.length === 0) return null;
  return (
    <section style={{ marginTop: 34 }}>
      {/* divider tab */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
        <div style={{
          ...wide, fontWeight: 800, fontSize: 26, textTransform: "uppercase", padding: "10px 22px 8px", borderRadius: "10px 10px 0 0",
          background: bargain ? K.yellow : K.ink, color: bargain ? K.ink : K.paper, letterSpacing: "-0.02em",
        }}>
          {name}
        </div>
        <span style={{ ...tall, fontWeight: 800, fontSize: 24, paddingBottom: 6 }}>{games.length}</span>
        {bargain && <span style={{ ...grot, fontSize: 13, paddingBottom: 9 }}>Not played in 90+ days — {bytes(games.reduce((a, g) => a + g.sizeBytes, 0))} you could clear out.</span>}
      </div>
      <div style={{
        borderTop: `4px solid ${bargain ? K.yellow : K.ink}`, padding: "22px 0 4px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "26px 22px",
        background: bargain ? "repeating-linear-gradient(-45deg, transparent 0 14px, rgba(255,212,0,.18) 14px 28px)" : "transparent",
      }}>
        {games.map((g) => <Sleeve key={g.id} g={g} playing={playing.has(g.id)} bargain={bargain} />)}
      </div>
    </section>
  );
}

function Sleeve({ g, playing, bargain }: { g: GameView; playing: boolean; bargain?: boolean }) {
  const bg = pick(g.title, sleeves);
  const dark = ["#111111", "#1F3BFF", "#7B2FF7", "#00A36C"].includes(bg);
  const shape = Math.floor(rand(g.title, 4) * 3);
  return (
    <div className="cd-sleeve" style={{ position: "relative" }}>
      <div style={{ position: "relative", aspectRatio: "1" }}>
        {/* vinyl */}
        <div className="cd-disc" style={{
          position: "absolute", inset: "4%", borderRadius: "50%", transition: "transform .35s cubic-bezier(.2,.8,.2,1)",
          transform: playing ? "translateX(46%)" : "translateX(0)",
          background: `radial-gradient(circle, ${bg} 0 15%, #111 15.5% 17%, #222 17.5% 30%, #111 30.5% 31%, #1c1c1c 31.5% 45%, #0a0a0a 45.5% 100%)`,
          animation: playing ? "cd-spin 1.8s linear infinite" : undefined,
        }} />
        {/* sleeve */}
        <div style={{
          position: "absolute", inset: 0, background: bg, color: dark ? K.paper : K.ink, padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between",
          boxShadow: `5px 5px 0 ${K.ink}`, border: `2px solid ${K.ink}`, overflow: "hidden",
        }}>
          {shape === 0 && <div style={{ position: "absolute", right: -34, bottom: -34, width: 110, height: 110, borderRadius: "50%", border: `14px solid ${dark ? K.paper : K.ink}`, opacity: 0.9 }} />}
          {shape === 1 && <div style={{ position: "absolute", left: 0, right: 0, top: "52%", height: 18, background: dark ? K.paper : K.ink }} />}
          {shape === 2 && <div style={{ position: "absolute", right: 10, bottom: 10, width: 0, height: 0, borderLeft: "48px solid transparent", borderBottom: `48px solid ${dark ? K.paper : K.ink}` }} />}
          <span style={{ ...wide, fontWeight: 800, fontSize: g.title.length > 20 ? 15 : 19, lineHeight: 1, textTransform: "uppercase", letterSpacing: "-0.03em", position: "relative" }}>
            {g.title}
          </span>
          <span style={{ ...tall, fontWeight: 800, fontSize: 30, lineHeight: 0.9, position: "relative" }}>{bytes(g.sizeBytes)}</span>
        </div>
        {bargain && (
          <div style={{ position: "absolute", top: -12, right: -12, width: 64, height: 64, borderRadius: "50%", background: K.yellow, border: `2px solid ${K.ink}`, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", ...wide, fontWeight: 800, fontSize: 10, lineHeight: 1.05, transform: "rotate(12deg)" }}>
            {idleDays(g)}<br />DAYS
          </div>
        )}
        {playing && (
          <div style={{ position: "absolute", bottom: 54, left: -8, background: K.orange, color: K.paper, ...wide, fontWeight: 800, fontSize: 11, padding: "4px 10px", transform: "rotate(-5deg)", boxShadow: `2px 2px 0 ${K.ink}` }}>
            NOW SPINNING
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13 }}>
        <span style={{ fontWeight: 700 }}>{hours(g.playSeconds)} played</span>
        <span style={{ opacity: 0.65 }}>{g.lastPlayed ? `${idleDays(g)}d ago` : "sealed"}</span>
      </div>
    </div>
  );
}
