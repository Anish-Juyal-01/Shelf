import clsx from "clsx";
import { PALETTES, type PaletteId, type Tokens } from "../lib/palettes";

/** Six colour themes as little skies: each swatch shows its own sky, clouds, accents and button in the current mode. */
export function ThemePicker({ value, dark, onChange }: { value: PaletteId; dark: boolean; onChange(id: PaletteId): void }) {
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-2">
      {PALETTES.map((p) => {
        const t = dark ? p.dark : p.light;
        const on = p.id === value;
        return (
          <button
            key={p.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(p.id)}
            className={clsx(
              "group cursor-pointer overflow-hidden rounded-[14px] text-left transition-[box-shadow,transform] hover:-translate-y-0.5",
              on ? "ring-2 ring-ink ring-offset-2 ring-offset-[var(--bg)]" : "ring-1 ring-rule-strong hover:ring-ink-3",
            )}
            style={{ background: t.bg }}
          >
            <MiniSky t={t} />
            <div className="flex items-end justify-between gap-2 px-3.5 pt-2.5 pb-3">
              <div className="min-w-0">
                <p className="font-display text-[22px] leading-none" style={{ color: t.ink }}>{p.name}</p>
                <p className="mt-1 truncate text-[11.5px]" style={{ color: t["ink-3"] }}>{p.blurb}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {(["u-blue", "u-red", "u-yellow"] as const).map((k) => (
                  <span key={k} className="size-3 rounded-full" style={{ background: t[k] }} />
                ))}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MiniSky({ t }: { t: Tokens }) {
  return (
    <div className="relative h-[88px] overflow-hidden" style={{ background: `linear-gradient(180deg, ${t["sky-top"]} 0%, ${t["sky-mid"]} 45%, ${t["sky-low"]} 80%, ${t["sky-glow"]} 100%)` }}>
      <div className="absolute top-3 right-6 size-9 rounded-full opacity-80" style={{ background: `radial-gradient(circle, ${t["sky-glow"]}, transparent 70%)` }} />
      {/* three tiny cards on an arc */}
      {[-14, 0, 14].map((r, i) => (
        <div
          key={r}
          className="absolute bottom-3 left-1/2 h-11 w-8 rounded-[4px] shadow-sm"
          style={{
            transform: `translateX(-50%) rotate(${r}deg) translateY(${i === 1 ? -6 : 0}px)`,
            transformOrigin: "50% 160%",
            background: `linear-gradient(160deg, ${[t["u-blue"], t.accent, t["u-red"]][i]}, ${t["sky-top"]})`,
          }}
        />
      ))}
      {/* cloud bank */}
      {[0, 22, 46, 70, 90].map((x, i) => (
        <div
          key={x}
          className="absolute rounded-full"
          style={{
            left: `${x - 8}%`,
            bottom: -14 + (i % 2) * 4,
            width: 70,
            height: 34,
            background: `radial-gradient(ellipse at 45% 35%, ${t.cloud} 45%, ${t["cloud-shade"]} 90%, transparent 92%)`,
          }}
        />
      ))}
      <span className="absolute top-2.5 left-3 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: t.accent, color: t["accent-ink"] }}>
        Play
      </span>
    </div>
  );
}
