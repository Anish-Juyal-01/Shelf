import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, initial, isOverdue, sourceName, spark, useIcon, useSample } from "./shared";

// 1 · MISSION CONTROL — a pro tool, not a toy. Dense, monospaced, dark; amber is the only colour that means
// "look here". Every row is a game: native icon, size as a meter, 14-day activity as a sparkline.

const M = { bg: "#0b0d10", panel: "#11151a", line: "#1f252d", text: "#c9d1d9", dim: "#6e7681", amber: "#ffb000", green: "#3fb950", red: "#f85149", cyan: "#39c5cf" };
const mono = { fontFamily: "'JetBrains Mono Variable', monospace" } as const;

export function MissionControl() {
  const { state, games, playing, total, idle, idleBytes, days14, week } = useSample();
  const maxSize = Math.max(...games.map((g) => g.sizeBytes));
  return (
    <div style={{ ...mono, background: M.bg, color: M.text, minHeight: "100vh", fontSize: 12.5 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 22px", borderBottom: `1px solid ${M.line}` }}>
        <span style={{ fontWeight: 800, letterSpacing: "0.3em", color: M.amber }}>SHELF</span>
        <span style={{ color: M.dim }}>//</span>
        {["LIBRARY", "ACTIVITY", "STORAGE", "REVIEW", "CONFIG"].map((t, i) => (
          <span key={t} style={{ color: i === 0 ? M.text : M.dim, borderBottom: i === 0 ? `1px solid ${M.amber}` : "none", paddingBottom: 2 }}>{t}</span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ color: M.green }}>● TRACKING</span>
        <span style={{ color: M.dim }}>CPU 0.06%</span>
        <span style={{ color: M.dim }}>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", minHeight: "calc(100vh - 45px)" }}>
        <aside style={{ borderRight: `1px solid ${M.line}`, padding: 18, display: "flex", flexDirection: "column", gap: 22 }}>
          <Block title="SUMMARY">
            <Kv k="titles" v={String(games.length)} />
            <Kv k="on disk" v={bytes(total)} />
            <Kv k="idle 90d+" v={`${idle.length} · ${bytes(idleBytes)}`} color={M.red} />
            <Kv k="played 7d" v={hours(week)} color={M.amber} />
          </Block>
          <Block title="DRIVES">
            {state.drives.map((d) => {
              const used = 1 - d.freeBytes / d.totalBytes;
              const cells = 20;
              const on = Math.round(used * cells);
              return (
                <div key={d.root} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", color: M.dim }}>
                    <span style={{ color: M.text }}>{d.root.replace("\\", "")} {d.label.toUpperCase()}</span>
                    <span style={{ color: used > 0.9 ? M.red : M.dim }}>{bytes(d.freeBytes)} free</span>
                  </div>
                  <div style={{ letterSpacing: 0, fontSize: 11, overflow: "hidden", whiteSpace: "nowrap", color: used > 0.9 ? M.red : M.amber, marginTop: 3 }}>
                    {"▮".repeat(on)}<span style={{ color: M.line }}>{"▮".repeat(cells - on)}</span>
                  </div>
                </div>
              );
            })}
          </Block>
          <Block title="NOW PLAYING">
            {state.playing.map((p) => {
              const g = games.find((x) => x.id === p.gameId)!;
              return (
                <div key={p.gameId} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Icon g={g} size={40} />
                  <div>
                    <div style={{ color: M.text, fontWeight: 700 }}>{g.title}</div>
                    <div style={{ color: M.green }}>● {Math.round((Date.now() - Date.parse(p.since)) / 60000)} min</div>
                  </div>
                </div>
              );
            })}
          </Block>
          <Block title="LAUNCHERS">
            {state.sources.slice(0, 8).map((s) => (
              <div key={s.name} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{s.name}</span>
                <span style={{ color: s.state === "ok" ? M.green : s.state === "notInstalled" ? M.dim : M.red }}>
                  {s.state === "ok" ? `OK ${s.count}` : s.state === "notInstalled" ? "—" : "ERR"}
                </span>
              </div>
            ))}
          </Block>
        </aside>

        <main style={{ padding: "16px 22px 80px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <span style={{ color: M.amber }}>&gt;</span>
            <span style={{ flex: 1, borderBottom: `1px solid ${M.line}`, color: M.dim, paddingBottom: 4 }}>filter titles, folders, sources…</span>
            <span style={{ color: M.dim }}>sort: <span style={{ color: M.text }}>last played ▾</span></span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: M.dim, textAlign: "left", fontSize: 11, letterSpacing: "0.08em" }}>
                {["", "TITLE", "SRC", "SIZE", "", "PLAYED", "14D", "LAST"].map((h, i) => (
                  <th key={i} style={{ padding: "6px 8px", borderBottom: `1px solid ${M.line}`, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const idleG = isOverdue(g);
                return (
                  <tr key={g.id} style={{ borderBottom: `1px solid ${M.line}`, opacity: idleG ? 0.62 : 1 }}>
                    <td style={{ padding: "7px 8px", width: 40 }}><Icon g={g} size={30} /></td>
                    <td style={{ padding: "7px 8px", fontWeight: 600, color: playing.has(g.id) ? M.green : M.text }}>
                      {g.title}
                      {playing.has(g.id) && <span style={{ color: M.green, marginLeft: 8 }}>● LIVE</span>}
                      {idleG && <span style={{ color: M.red, marginLeft: 8 }}>IDLE {idleDays(g)}D</span>}
                    </td>
                    <td style={{ padding: "7px 8px", color: M.dim }}>{sourceName[g.sources[0]].toUpperCase()}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", width: 80 }}>{bytes(g.sizeBytes)}</td>
                    <td style={{ padding: "7px 8px", width: 120 }}>
                      <div style={{ height: 6, background: M.line }}>
                        <div style={{ height: 6, width: `${(g.sizeBytes / maxSize) * 100}%`, background: idleG ? M.red : M.cyan }} />
                      </div>
                    </td>
                    <td style={{ padding: "7px 8px", textAlign: "right", color: M.amber }}>{hours(g.playSeconds)}</td>
                    <td style={{ padding: "7px 8px", width: 120 }}><Spark values={spark(days14, g.id)} /></td>
                    <td style={{ padding: "7px 8px", color: M.dim, whiteSpace: "nowrap" }}>{g.lastPlayed ? `${idleDays(g)}d ago` : "never"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </main>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ color: M.dim, fontSize: 11, letterSpacing: "0.16em", marginBottom: 8, borderBottom: `1px solid ${M.line}`, paddingBottom: 4 }}>{title}</div>
      <div style={{ display: "grid", gap: 5 }}>{children}</div>
    </section>
  );
}

function Kv({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: M.dim }}>{k}</span>
      <span style={{ color: color ?? M.text, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(3600, ...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 18 }}>
      {values.map((v, i) => (
        <span key={i} style={{ width: 5, height: v ? Math.max(2, (v / max) * 18) : 1, background: v ? M.amber : M.line }} />
      ))}
    </div>
  );
}

function Icon({ g, size }: { g: GameView; size: number }) {
  const [url, fail] = useIcon(g.title);
  if (url) return <img src={url} onError={fail} alt="" style={{ width: size, height: size, objectFit: "contain", display: "block" }} />;
  return (
    <div style={{ width: size, height: size, border: `1px solid ${M.amber}`, color: M.amber, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size * 0.45 }}>
      {initial(g.title)}
    </div>
  );
}
