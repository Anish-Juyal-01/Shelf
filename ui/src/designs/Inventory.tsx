import "@fontsource-variable/pixelify-sans";
import "@fontsource/silkscreen";
import "@fontsource/vt323";
import { useState } from "react";
import type { GameView } from "../bridge/protocol";
import { bytes, hours, idleDays, isOverdue, rarity, sourceName, sprite, useSample, type Rarity } from "./shared";

// 3 · INVENTORY — your games as items in an RPG bag. Each gets a generated pixel sprite; playtime sets its rarity
// (common → legendary). Disk use is carry weight, overdue games are "Dusty", the one you're playing is equipped.

const P = { bg: "#1A1B2E", panel: "#E9D9AF", panelDark: "#C9B27D", ink: "#2A1E10", slot: "#3A2E1C", slotIn: "#4A3B24", gold: "#FFD54A" };
const R: Record<Rarity, string> = { common: "#9E9E9E", uncommon: "#4CC85A", rare: "#3D8BFF", epic: "#B455FF", legendary: "#FF9A1F" };
const pix = { fontFamily: "'Pixelify Sans Variable', monospace" } as const;
const silk = { fontFamily: "Silkscreen, monospace" } as const;
const vt = { fontFamily: "VT323, monospace" } as const;

/** Stepped pixel border, like an SNES dialog box. */
const pixelBox = (fill: string, edge: string) => ({
  background: fill,
  boxShadow: `0 -4px 0 0 ${edge}, 0 4px 0 0 ${edge}, -4px 0 0 0 ${edge}, 4px 0 0 0 ${edge}, 0 0 0 4px ${edge} inset, 8px 8px 0 0 rgba(0,0,0,.35)`,
});

export function Inventory() {
  const { games, playing, total, state, byPlay } = useSample();
  const [sel, setSel] = useState<GameView>(games[0]);
  const drive = state.drives[0];
  const used = drive.totalBytes - drive.freeBytes;
  const pct = used / drive.totalBytes;
  return (
    <div style={{ ...pix, minHeight: "100vh", color: P.ink, background: P.bg, backgroundImage: "radial-gradient(#2A2B48 1px, transparent 1px)", backgroundSize: "8px 8px", padding: "30px 36px 90px", imageRendering: "pixelated" }}>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 300px", gap: 30, alignItems: "start" }}>
        {/* Character sheet */}
        <section style={{ ...pixelBox(P.panel, P.ink), padding: 18 }}>
          <div style={{ ...silk, fontSize: 26, lineHeight: 1 }}>SHELF</div>
          <div style={{ ...vt, fontSize: 20, color: "#6B5634" }}>Lv. {games.length} Collector</div>
          <div style={{ margin: "16px 0 6px", ...silk, fontSize: 11 }}>HOURS PLAYED</div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{Math.round(games.reduce((a, g) => a + g.playSeconds, 0) / 3600).toLocaleString()}h</div>
          <div style={{ margin: "16px 0 6px", ...silk, fontSize: 11 }}>CARRY WEIGHT (DRIVE C:)</div>
          <Bar pct={pct} color={pct > 0.9 ? "#E53935" : "#43A047"} />
          <div style={{ ...vt, fontSize: 20, marginTop: 4, color: pct > 0.9 ? "#B71C1C" : P.ink }}>
            {bytes(used)} / {bytes(drive.totalBytes)} {pct > 0.9 && "— OVERBURDENED!"}
          </div>
          <div style={{ margin: "16px 0 6px", ...silk, fontSize: 11 }}>GAMES IN BAG</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{games.length} · {bytes(total)}</div>
          <div style={{ marginTop: 18, ...silk, fontSize: 11 }}>RARITY</div>
          {(Object.keys(R) as Rarity[]).map((r) => (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 8, ...vt, fontSize: 19 }}>
              <span style={{ width: 12, height: 12, background: R[r], boxShadow: `0 0 0 2px ${P.ink}` }} /> {r} <span style={{ opacity: 0.6 }}>{r === "common" ? "<5h" : r === "uncommon" ? "5h+" : r === "rare" ? "30h+" : r === "epic" ? "80h+" : "200h+"}</span>
            </div>
          ))}
        </section>

        {/* Bag */}
        <section style={{ ...pixelBox(P.panelDark, P.ink), padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <span style={{ ...silk, fontSize: 24 }}>INVENTORY</span>
            <span style={{ ...vt, fontSize: 20 }}>[A] equip · [X] drop · [?] review</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 92px)", gap: 12 }}>
            {games.map((g) => (
              <Slot key={g.id} g={g} on={sel.id === g.id} playing={playing.has(g.id)} onClick={() => setSel(g)} />
            ))}
            {Array.from({ length: Math.max(0, 24 - games.length) }, (_, i) => (
              <div key={`e${i}`} style={{ width: 92, height: 92, background: P.slot, boxShadow: `inset 4px 4px 0 rgba(0,0,0,.35), 0 0 0 3px ${P.ink}` }} />
            ))}
          </div>
        </section>

        {/* Item card */}
        <section style={{ ...pixelBox("#FFF6DC", P.ink), padding: 18 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Sprite title={sel.title} size={72} color={R[rarity(sel)]} />
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.05 }}>{sel.title}</div>
              <div style={{ ...silk, fontSize: 12, color: R[rarity(sel)], textShadow: `1px 1px 0 ${P.ink}` }}>{rarity(sel).toUpperCase()} {sourceName[sel.sources[0]].toUpperCase()} GAME</div>
            </div>
          </div>
          <div style={{ ...vt, fontSize: 22, lineHeight: 1.25, marginTop: 14 }}>
            <Stat k="Weight" v={bytes(sel.sizeBytes)} />
            <Stat k="XP (played)" v={hours(sel.playSeconds)} />
            <Stat k="Last used" v={sel.lastPlayed ? `${idleDays(sel)} days ago` : "never"} />
            <Stat k="Copies" v={String(sel.copies)} />
            <Stat k="Status" v={playing.has(sel.id) ? "EQUIPPED ⚔" : isOverdue(sel) ? "DUSTY 🕸" : "ready"} />
          </div>
          <div style={{ ...vt, fontSize: 19, color: "#6B5634", marginTop: 10, fontStyle: "italic" }}>
            “{isOverdue(sel) ? "Gathering dust. Dropping it frees " + bytes(sel.sizeBytes) + "." : "A trusty companion."}”
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <PixelButton bg="#43A047">▶ PLAY</PixelButton>
            <PixelButton bg="#8D6E63">OPEN</PixelButton>
            <PixelButton bg="#E53935">DROP</PixelButton>
          </div>
          <div style={{ marginTop: 22, ...silk, fontSize: 11 }}>TOP XP</div>
          {byPlay.slice(0, 4).map((g) => (
            <div key={g.id} style={{ display: "flex", justifyContent: "space-between", ...vt, fontSize: 20 }}>
              <span>{g.title}</span>
              <span style={{ color: R[rarity(g)], textShadow: `1px 1px 0 ${P.ink}` }}>{hours(g.playSeconds)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function Slot({ g, on, playing, onClick }: { g: GameView; on: boolean; playing: boolean; onClick(): void }) {
  const r = rarity(g);
  const dusty = isOverdue(g);
  return (
    <button onClick={onClick} title={g.title} style={{
      width: 92, height: 92, position: "relative", cursor: "pointer", border: 0, padding: 0,
      background: on ? "#6B5634" : P.slotIn,
      boxShadow: `inset 4px 4px 0 rgba(0,0,0,.35), 0 0 0 3px ${P.ink}, 0 0 0 6px ${R[r]}${on ? "" : "AA"}`,
      filter: dusty ? "grayscale(.65) brightness(.85)" : "none",
    }}>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 10 }}>
        <Sprite title={g.title} size={48} color={R[r]} />
      </div>
      <span style={{ position: "absolute", left: 4, right: 4, bottom: 3, ...vt, fontSize: 16, color: "#F4E6C0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.title}</span>
      <span style={{ position: "absolute", top: 3, right: 5, ...vt, fontSize: 15, color: P.gold }}>{bytes(g.sizeBytes).replace(" ", "")}</span>
      {playing && <span style={{ position: "absolute", top: 2, left: 4, fontSize: 16 }}>⚔</span>}
      {dusty && <span style={{ position: "absolute", top: 0, left: 0, width: 26, height: 26, background: "linear-gradient(135deg, rgba(255,255,255,.55) 0 2px, transparent 2px), repeating-conic-gradient(from 0deg at 0 0, rgba(255,255,255,.45) 0 2deg, transparent 2deg 15deg)" }} />}
    </button>
  );
}

function Sprite({ title, size, color }: { title: string; size: number; color: string }) {
  const grid = sprite(title);
  const c = size / 8;
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      {grid.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={(x + y) % 3 === 0 ? "#2A1E10" : color} /> : null)))}
      <rect x={0} y={0} width={8} height={8} fill="none" stroke="transparent" strokeWidth={1 / c} />
    </svg>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 16, background: P.slot, boxShadow: `0 0 0 3px ${P.ink}`, position: "relative" }}>
      <div style={{ height: "100%", width: `${pct * 100}%`, background: color, boxShadow: "inset 0 -4px 0 rgba(0,0,0,.25)" }} />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px dotted #C9B27D" }}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

function PixelButton({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <button style={{ ...silk, fontSize: 13, color: "#fff", background: bg, border: 0, padding: "8px 12px", cursor: "pointer", boxShadow: `0 0 0 3px ${P.ink}, inset -3px -3px 0 rgba(0,0,0,.3), inset 3px 3px 0 rgba(255,255,255,.25)` }}>
      {children}
    </button>
  );
}
