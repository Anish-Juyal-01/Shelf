import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, initial, isOverdue, sourceName, useIcon, useSample } from "./shared";

// 5 · LEDGER — the sober annual-report view. Your library as a statement: each game a line item, disk space its
// cost, idle games itemised in oxblood with a subtotal and a plain recommendation. Serif for the voice, a quiet
// sans with tabular figures for the numbers.

const L = { paper: "#f7f5f0", ink: "#1b1b1b", dim: "#6f6a62", rule: "#d9d4ca", green: "#0f5132", ox: "#8b1e1e" };
const serif = { fontFamily: "'Newsreader Variable', Georgia, serif" } as const;
const sans = { fontFamily: "'IBM Plex Sans', sans-serif", fontVariantNumeric: "tabular-nums" } as const;

export function Ledger() {
  const { games, total, idle, idleBytes, week, playing } = useSample();
  const active = games.filter((g) => !isOverdue(g)).sort((a, b) => b.sizeBytes - a.sizeBytes);
  const idleSorted = [...idle].sort((a, b) => b.sizeBytes - a.sizeBytes);
  const activeBytes = active.reduce((a, g) => a + g.sizeBytes, 0);
  const month = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return (
    <div style={{ ...sans, background: L.paper, color: L.ink, minHeight: "100vh", padding: "40px 0 90px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 40px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `2px solid ${L.ink}`, paddingBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: L.dim }}>Shelf · Statement of games</div>
            <h1 style={{ ...serif, fontSize: 54, fontWeight: 500, margin: "6px 0 0", letterSpacing: "-0.02em" }}>{month}</h1>
          </div>
          <nav style={{ display: "flex", gap: 22, fontSize: 13, color: L.dim }}>
            <span style={{ color: L.ink, fontWeight: 600 }}>Statement</span><span>Activity</span><span>Storage</span><span>Settings</span>
          </nav>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: `1px solid ${L.rule}` }}>
          <Kpi label="Space used by games" value={bytes(total)} />
          <Kpi label="Titles held" value={String(games.length)} />
          <Kpi label="Played, last 7 days" value={hours(week)} />
          <Kpi label="Held but idle (90+ days)" value={bytes(idleBytes)} note={`${Math.round((idleBytes / total) * 100)}% of total`} red />
        </section>

        <p style={{ ...serif, fontSize: 21, lineHeight: 1.45, margin: "26px 0 30px", maxWidth: 780 }}>
          {idle.length} of your {games.length} games haven't been opened in three months and hold <b>{bytes(idleBytes)}</b> between them.
          Uninstalling them through their own launchers would free that space; everything stays listed here with its play history.
        </p>

        <Table title="Active" games={active} subtotal={activeBytes} total={total} playing={playing} />
        <Table title="Idle — not played in 90 days or more" games={idleSorted} subtotal={idleBytes} total={total} playing={playing} idle />

        <div style={{ display: "flex", justifyContent: "space-between", borderTop: `3px double ${L.ink}`, padding: "10px 8px", fontWeight: 600, fontSize: 15 }}>
          <span style={serif}>Total held</span>
          <span>{bytes(total)}</span>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, note, red }: { label: string; value: string; note?: string; red?: boolean }) {
  return (
    <div style={{ padding: "18px 18px 18px 0", borderRight: `1px solid ${L.rule}` }}>
      <div style={{ fontSize: 12, color: L.dim }}>{label}</div>
      <div style={{ ...serif, fontSize: 40, fontWeight: 500, color: red ? L.ox : L.ink, marginTop: 4 }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: red ? L.ox : L.dim }}>{note}</div>}
    </div>
  );
}

function Table({ title, games, subtotal, total, playing, idle }: { title: string; games: GameView[]; subtotal: number; total: number; playing: Set<number>; idle?: boolean }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2 style={{ ...serif, fontSize: 22, fontWeight: 600, margin: "0 0 6px", color: idle ? L.ox : L.ink }}>{title}</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead>
          <tr style={{ color: L.dim, fontSize: 11.5, textAlign: "left", borderBottom: `1px solid ${L.ink}` }}>
            <th style={{ padding: "6px 8px", width: 30 }}>#</th>
            <th style={{ padding: "6px 8px" }} colSpan={2}>Game</th>
            <th style={{ padding: "6px 8px" }}>Source</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Space</th>
            <th style={{ padding: "6px 8px", width: 160 }}>Share</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Hours</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Last played</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g, i) => (
            <tr key={g.id} style={{ borderBottom: `1px solid ${L.rule}` }}>
              <td style={{ padding: "8px", color: L.dim }}>{String(i + 1).padStart(2, "0")}</td>
              <td style={{ padding: "8px", width: 34 }}><Icon g={g} /></td>
              <td style={{ padding: "8px", ...serif, fontSize: 17 }}>
                {g.title}
                {playing.has(g.id) && <span style={{ ...sans, fontSize: 11, color: L.green, marginLeft: 8, fontWeight: 600 }}>playing</span>}
              </td>
              <td style={{ padding: "8px", color: L.dim }}>{sourceName[g.sources[0]]}</td>
              <td style={{ padding: "8px", textAlign: "right", fontWeight: 600 }}>{bytes(g.sizeBytes)}</td>
              <td style={{ padding: "8px" }}>
                <div style={{ height: 4, background: L.rule }}>
                  <div style={{ height: 4, width: `${(g.sizeBytes / total) * 100}%`, background: idle ? L.ox : L.green }} />
                </div>
              </td>
              <td style={{ padding: "8px", textAlign: "right" }}>{hours(g.playSeconds)}</td>
              <td style={{ padding: "8px", textAlign: "right", color: idle ? L.ox : L.dim }}>{!g.lastPlayed ? "never" : idleDays(g) === 0 ? "today" : idleDays(g) === 1 ? "yesterday" : `${idleDays(g)} days ago`}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={4} style={{ padding: "8px", ...serif, fontStyle: "italic", color: L.dim }}>Subtotal</td>
            <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, borderTop: `1px solid ${L.ink}` }}>{bytes(subtotal)}</td>
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Icon({ g }: { g: GameView }) {
  const [url, fail] = useIcon(g.title);
  if (url) return <img src={url} onError={fail} alt="" style={{ width: 26, height: 26, objectFit: "contain", display: "block" }} />;
  return (
    <div style={{ width: 26, height: 26, borderRadius: 99, border: `1px solid ${L.dim}`, display: "flex", alignItems: "center", justifyContent: "center", ...serif, fontSize: 14, color: L.dim }}>
      {initial(g.title)}
    </div>
  );
}
