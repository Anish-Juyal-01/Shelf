import clsx from "clsx";
import { PALETTES, type Palette, type PaletteId, type Tokens } from "../lib/palettes";

/**
 * Colour and black themes as little rooms: each swatch shows its own light, three cards floating in it, and its
 * button, in the current mode — what the app looks like when a game without art is in focus.
 */
export function ThemePicker({ value, dark, onChange }: { value: PaletteId; dark: boolean; onChange(id: PaletteId): void }) {
  return (
    <div role="radiogroup" aria-label="Colour theme" className="space-y-6">
      <Group label="Colour" palettes={PALETTES.filter((p) => !p.black)} value={value} dark={dark} onChange={onChange} />
      <Group label="Black" palettes={PALETTES.filter((p) => p.black)} value={value} dark={dark} onChange={onChange} />
    </div>
  );
}

function Group({ label, palettes, value, dark, onChange }: { label: string; palettes: Palette[]; value: PaletteId; dark: boolean; onChange(id: PaletteId): void }) {
  return (
    <div>
      <p className="caps mb-2.5 px-1 text-ink-3">{label}</p>
      <div className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-2">
        {palettes.map((p) => {
          const night = dark || !!p.black;
          const t = dark ? p.dark : p.light;
          const on = p.id === value;
          return (
            <button
              key={p.id}
              role="radio"
              aria-checked={on}
              onClick={() => onChange(p.id)}
              className={clsx(
                "group relative cursor-pointer overflow-hidden rounded-[20px] text-left transition-[box-shadow,transform] hover:-translate-y-0.5",
                on ? "ring-2 ring-accent ring-offset-2 ring-offset-transparent" : "ring-1 ring-[var(--edge)] hover:ring-[var(--edge-hi)]",
              )}
            >
              <MiniRoom t={t} night={night} />
              <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2 rounded-[14px] px-3 py-2.5" style={{ background: night ? "rgb(255 255 255 / 0.08)" : "rgb(255 255 255 / 0.6)", border: `1px solid ${night ? "rgb(255 255 255 / 0.12)" : "rgb(255 255 255 / 0.8)"}`, backdropFilter: "blur(14px)" }}>
                <div className="min-w-0">
                  <p className="text-[15px] leading-none font-semibold tracking-[-0.02em]" style={{ color: t.ink }}>{p.name}</p>
                  <p className="mt-1 truncate text-[11px]" style={{ color: t["ink-3"] }}>{p.blurb}</p>
                </div>
                <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold" style={{ background: t.accent, color: t["accent-ink"] }}>
                  Play
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniRoom({ t, night }: { t: Tokens; night: boolean }) {
  const base = night ? (t.bg === "#000000" ? "#000000" : t.bg) : t.bg;
  const [a, b] = night ? [t["sky-glow"], t["sky-mid"]] : [t["sky-low"], t["sky-top"]];
  return (
    <div className="relative h-[132px] overflow-hidden" style={{ background: base }}>
      <div
        className="absolute -inset-6"
        style={{ background: `radial-gradient(55% 60% at 25% 30%, ${a}, transparent 70%), radial-gradient(55% 65% at 80% 70%, ${b}, transparent 72%)`, filter: "blur(18px)", opacity: night ? 0.8 : 0.75 }}
      />
      {/* three cards hanging in depth */}
      <div className="absolute inset-x-0 top-4 flex justify-center" style={{ perspective: 400 }}>
        {[-1, 0, 1].map((d) => (
          <div
            key={d}
            className="h-[64px] w-[44px] rounded-[7px] shadow-[0_10px_18px_-8px_rgb(0_0_0/0.6)]"
            style={{
              background: `linear-gradient(150deg, ${[t["u-blue"], t.accent, t["u-red"]][d + 1]}, ${night ? "#00000088" : "#ffffff55"})`,
              transform: `translateX(${d * -6}px) translateZ(${d === 0 ? 20 : -20}px) rotateY(${d * -28}deg)`,
              zIndex: d === 0 ? 2 : 1,
              boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.25)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
