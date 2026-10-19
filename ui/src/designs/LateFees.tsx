import "@fontsource/shrikhand";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, isOverdue, pick, rand, sourceName, useSample } from "./shared";

// 1 · LATE FEES — the 90s video rental store. Navy carpet, ticket-yellow signage, games as VHS clamshells on
// metal shelving, price-tag stickers for size, and a red LATE FEES sticker when a game hasn't been out in 90 days.

const C = {
  carpet: "#0F1B4C",
  carpet2: "#13235F",
  ticket: "#FFC72C",
  red: "#E4002B",
  cream: "#FFF4D6",
  ink: "#0A1033",
  shelf: "#9AA6C8",
};

const display = { fontFamily: "Shrikhand, cursive", fontWeight: 400 } as const;
const mono = { fontFamily: "'Space Mono', monospace" } as const;
const ui = { fontFamily: "'Bricolage Grotesque Variable', sans-serif", fontVariationSettings: '"wdth" 80' } as const;

const caseColors = ["#E4002B", "#1E5EFF", "#00A86B", "#FF6B00", "#7A1FA2", "#111111", "#F2C200", "#00A6C8"];

export function LateFees() {
  const { games, playing, total, overdue, byPlay } = useSample();
  const rows = [games.slice(0, 6), games.slice(6, 12), games.slice(12)];
  return (
    <div style={{ ...ui, background: C.carpet, color: C.cream, minHeight: "100vh" }}>
      {/* carpet speckle */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.35,
        backgroundImage: `radial-gradient(${C.carpet2} 2px, transparent 2.5px), radial-gradient(#2A3B8F 1.5px, transparent 2px)`,
        backgroundSize: "22px 22px, 31px 31px", backgroundPosition: "0 0, 11px 7px",
      }} />

      <header style={{ position: "relative", padding: "28px 40px 0", display: "flex", alignItems: "flex-end", gap: 28 }}>
        {/* Ticket sign */}
        <div style={{
          background: C.ticket, color: C.ink, padding: "8px 26px 14px", transform: "rotate(-3deg)", boxShadow: `6px 6px 0 ${C.red}`,
          clipPath: "polygon(0 0,100% 0,100% 30%,97% 50%,100% 70%,100% 100%,0 100%,0 70%,3% 50%,0 30%)",
        }}>
          <div style={{ ...display, fontSize: 64, lineHeight: 1, letterSpacing: "-0.01em" }}>Shelf</div>
          <div style={{ ...mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.35em", textAlign: "center" }}>VIDEO · GAMES · RENTALS</div>
        </div>
        <div style={{ ...mono, fontSize: 12, lineHeight: 1.7, color: C.ticket, paddingBottom: 8 }}>
          MEMBER #0042 · {games.length} TAPES ON THE SHELF · {bytes(total)}
          <br />
          <span style={{ color: C.cream, opacity: 0.7 }}>PLEASE BE KIND — REWIND YOUR SAVES</span>
        </div>
        <div style={{ flex: 1 }} />
        <button style={{ ...display, fontSize: 20, background: C.red, color: C.cream, border: 0, padding: "10px 22px", borderRadius: 999, boxShadow: `0 4px 0 #8A0019`, cursor: "pointer" }}>
          + New tape
        </button>
      </header>

      {/* Aisle signs */}
      <nav style={{ position: "relative", display: "flex", gap: 10, padding: "26px 40px 6px" }}>
        {[["New releases", true], ["Staff picks", false], ["Late fees", false], ["Storage room", false], ["Returns desk", false]].map(([label, on], i) => (
          <span key={String(label)} style={{
            ...display, fontSize: 18, padding: "6px 16px 8px", borderRadius: 6, transform: `rotate(${i % 2 ? 1.2 : -1}deg)`,
            background: on ? C.cream : "transparent", color: on ? C.ink : C.cream, border: `2px solid ${C.cream}`,
          }}>
            {String(label)}
            {label === "Late fees" && <span style={{ ...mono, marginLeft: 8, fontSize: 12, background: C.red, color: C.cream, borderRadius: 999, padding: "1px 7px" }}>{overdue.length}</span>}
          </span>
        ))}
      </nav>

      <main style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 260px", gap: 36, padding: "20px 40px 90px" }}>
        <section>
          {rows.map((row, r) => (
            <div key={r} style={{ marginBottom: 34 }}>
              <div style={{ display: "flex", gap: 18, alignItems: "flex-end", padding: "0 10px" }}>
                {row.map((g) => <Tape key={g.id} g={g} playing={playing.has(g.id)} />)}
              </div>
              {/* metal shelf */}
              <div style={{ height: 12, background: `linear-gradient(${C.shelf}, #59658A)`, borderRadius: 2, boxShadow: "0 8px 14px rgba(0,0,0,.45)" }} />
            </div>
          ))}
        </section>

        <aside>
          <div style={{ background: C.cream, color: C.ink, padding: "18px 18px 20px", transform: "rotate(1.5deg)", boxShadow: `5px 5px 0 ${C.ticket}` }}>
            <div style={{ ...display, fontSize: 26, lineHeight: 1, color: C.red }}>Staff picks</div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: "0.2em", margin: "4px 0 12px" }}>MOST RENTED · ALL TIME</div>
            {byPlay.slice(0, 6).map((g, i) => (
              <div key={g.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px dashed #0A103355", padding: "7px 0", fontSize: 15 }}>
                <span style={{ fontWeight: 700 }}>{i + 1}. {g.title}</span>
                <span style={{ ...mono, fontSize: 12 }}>{hours(g.playSeconds)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 34, border: `3px dashed ${C.ticket}`, padding: 16, color: C.ticket }}>
            <div style={{ ...display, fontSize: 22 }}>Late fees due</div>
            <div style={{ ...mono, fontSize: 12, lineHeight: 1.6, marginTop: 6, color: C.cream }}>
              {overdue.length} tapes untouched 90+ days are hogging {bytes(overdue.reduce((a, g) => a + g.sizeBytes, 0))} of shelf.
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Tape({ g, playing }: { g: GameView; playing: boolean }) {
  const color = pick(g.title, caseColors);
  const overdue = isOverdue(g);
  const tilt = (rand(g.title) - 0.5) * 3;
  return (
    <div style={{ position: "relative", width: 150, flexShrink: 0, transform: `rotate(${tilt}deg)`, transformOrigin: "bottom center" }}>
      {/* clamshell */}
      <div style={{
        height: 228, borderRadius: "4px 4px 2px 2px", background: color, position: "relative", overflow: "hidden",
        boxShadow: "inset -10px 0 0 rgba(0,0,0,.25), inset 0 0 0 3px rgba(255,255,255,.12), 0 2px 0 rgba(0,0,0,.4)",
      }}>
        {/* cover art band */}
        <div style={{
          position: "absolute", left: 10, right: 18, top: 14, bottom: 46, borderRadius: 2,
          background: `linear-gradient(${150 + rand(g.title, 2) * 60}deg, rgba(255,255,255,.22), rgba(0,0,0,.35)), repeating-linear-gradient(${rand(g.title, 3) * 180}deg, rgba(255,255,255,.08) 0 6px, transparent 6px 14px)`,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 10, textAlign: "center",
        }}>
          <span style={{ ...display, fontSize: g.title.length > 20 ? 17 : 22, lineHeight: 1.05, color: "#fff", textShadow: "3px 3px 0 rgba(0,0,0,.45)" }}>{g.title}</span>
        </div>
        <div style={{ position: "absolute", left: 10, right: 18, bottom: 12, ...mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "#fff", opacity: 0.85 }}>
          {sourceName[g.sources[0]].toUpperCase()} · {hours(g.playSeconds)}
        </div>
      </div>
      {/* price tag = size */}
      <div style={{
        position: "absolute", top: -10, right: -8, background: C.ticket, color: C.ink, ...mono, fontWeight: 700, fontSize: 12,
        padding: "3px 8px", borderRadius: "3px 10px 10px 3px", transform: "rotate(8deg)", boxShadow: "1px 2px 0 rgba(0,0,0,.4)",
      }}>
        {bytes(g.sizeBytes)}
      </div>
      {overdue && (
        <div style={{
          position: "absolute", bottom: 62, left: -10, background: C.red, color: C.cream, ...display, fontSize: 17,
          padding: "2px 12px 4px", transform: "rotate(-12deg)", border: `2px solid ${C.cream}`, borderRadius: 4,
        }}>
          Late fees! <span style={{ ...mono, fontSize: 10 }}>{idleDays(g)}d</span>
        </div>
      )}
      {playing && (
        <div style={{
          position: "absolute", top: 162, left: -6, right: -6, background: C.cream, color: C.red, ...mono, fontWeight: 700, fontSize: 13,
          textAlign: "center", letterSpacing: "0.3em", padding: "4px 0", transform: "rotate(-4deg)", boxShadow: "0 2px 0 rgba(0,0,0,.4)",
        }}>
          ● RENTED
        </div>
      )}
    </div>
  );
}
