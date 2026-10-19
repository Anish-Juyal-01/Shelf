import clsx from "clsx";
import { memo } from "react";
import { palette, unit } from "../lib/art";

/**
 * Game art. Real box art when Shelf has it; otherwise a generated plate in the spirit of a good album cover:
 * a soft mesh gradient (three blurred colour fields over a deep base, picked per title), fine grain, a huge cropped
 * italic initial as a graphic element, and the title set in the app's editorial serif. The game's own icon, when
 * there is one, always wins (IconPlate). Same title → same plate, always.
 */

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

export const Cover = memo(function Cover({ title, url, iconUrl, meta, className, large, bare }: {
  title: string;
  url: string | null;
  iconUrl?: string | null;
  /** Small label above the title (e.g. where the game came from). */
  meta?: string;
  className?: string;
  large?: boolean;
  /** Art only, no text (when the title is shown next to it anyway). */
  bare?: boolean;
}) {
  // The game's own icon comes first: it's the face people recognise.
  if (iconUrl) return <IconPlate title={title} iconUrl={iconUrl} meta={meta} className={className} large={large} bare={bare} />;

  if (url) {
    return (
      <div className={clsx("relative aspect-[2/3] overflow-hidden bg-[#111] shadow-cover", className)}>
        <img src={url} alt="" draggable={false} loading="lazy" className="size-full object-cover" />
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-white/10 ring-inset" />
      </div>
    );
  }

  const [base, a, b, c] = palette(title);
  const u = (s: number) => unit(title, s);
  const field = (color: string, x: number, y: number, size: number) =>
    `radial-gradient(${size}% ${size * 0.8}% at ${x}% ${y}%, ${color} 0%, ${color}cc 22%, transparent 70%)`;
  const mesh = [
    field(a, 15 + u(1) * 70, 8 + u(2) * 40, 70 + u(3) * 30),
    field(b, 10 + u(4) * 80, 45 + u(5) * 45, 65 + u(6) * 35),
    field(c, u(7) * 100, u(8) * 100, 55 + u(9) * 30),
  ].join(",");
  const initial = (title.trim()[0] ?? "?").toUpperCase();
  const words = title.trim().split(/\s+/);
  const longest = Math.max(...words.map((w) => w.length));
  // Title size relative to the plate's width (cqi), so it fits at every size from hero cards to the game page.
  const titleCqi = Math.min(large ? 20 : 19, Math.floor(150 / Math.max(6, longest)));

  return (
    <div aria-hidden className={clsx("relative aspect-[2/3] overflow-hidden shadow-cover [container-type:inline-size]", className)} style={{ background: base }}>
      <div className="absolute inset-0" style={{ backgroundImage: mesh, filter: "blur(10px) saturate(1.1)", transform: "scale(1.15)" }} />

      {/* the initial: huge, italic, cropped off the edge */}
      <span
        className="font-display absolute leading-none text-white italic select-none"
        style={{ fontSize: "150cqi", right: `${-24 + u(10) * 14}%`, top: `${-32 + u(11) * 16}%`, opacity: 0.18, mixBlendMode: "overlay" }}
      >
        {initial}
      </span>


      {/* grain + sheen */}
      <div className="absolute inset-0 opacity-[0.22] mix-blend-overlay" style={{ backgroundImage: GRAIN, backgroundSize: "160px 160px" }} />
      <div className="absolute inset-0 bg-[linear-gradient(155deg,rgb(255_255_255/0.16),transparent_38%)]" />

      {!bare && (
        <>
          <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/50 via-black/12 to-transparent" />
          <div className="absolute right-[9%] bottom-[7%] left-[9%] text-white">
            {meta && <p className="mb-[0.5em] font-mono tracking-[0.18em] uppercase opacity-80" style={{ fontSize: "max(7px, 4.6cqi)" }}>{meta}</p>}
            <p className="font-display leading-[0.92] text-balance" style={{ fontSize: `${titleCqi}cqi`, textShadow: "0 2px 16px rgb(0 0 0 / 0.35)" }}>
              {title}
            </p>
          </div>
        </>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-white/10 ring-inset" />
    </div>
  );
});

/**
 * The game's native icon as its plate: the icon big and crisp in the middle, and behind it the same icon blown up
 * and blurred, so every plate takes its colours from the game itself.
 */
function IconPlate({ title, iconUrl, meta, className, large, bare }: {
  title: string;
  iconUrl: string;
  meta?: string;
  className?: string;
  large?: boolean;
  bare?: boolean;
}) {
  const words = title.trim().split(/\s+/);
  const longest = Math.max(...words.map((w) => w.length));
  const titleCqi = Math.min(large ? 18 : 17, Math.floor(140 / Math.max(6, longest)));
  return (
    <div aria-hidden className={clsx("relative aspect-[2/3] overflow-hidden bg-[#141414] shadow-cover [container-type:inline-size]", className)}>
      {/* the icon's own colours, as a soft backdrop */}
      <img src={iconUrl} alt="" draggable={false} className="absolute inset-0 size-full scale-[2.2] object-cover opacity-90 blur-[34px] saturate-[1.5]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_30%,transparent_0%,rgb(0_0_0/0.35)_70%,rgb(0_0_0/0.6)_100%)]" />
      <div className="absolute inset-0 opacity-[0.18] mix-blend-overlay" style={{ backgroundImage: GRAIN, backgroundSize: "160px 160px" }} />

      {/* the icon itself */}
      <img
        src={iconUrl}
        alt=""
        draggable={false}
        className="absolute left-1/2 w-[60%] drop-shadow-[0_14px_24px_rgb(0_0_0/0.45)]"
        style={{ top: bare ? "50%" : "40%", transform: "translate(-50%, -50%)", imageRendering: "auto" }}
      />

      {!bare && (
        <div className="absolute right-[9%] bottom-[7%] left-[9%] text-white">
          {meta && <p className="mb-[0.5em] font-mono tracking-[0.18em] uppercase opacity-75" style={{ fontSize: "max(7px, 4.6cqi)" }}>{meta}</p>}
          <p className="font-display leading-[0.92] text-balance" style={{ fontSize: `${titleCqi}cqi`, textShadow: "0 2px 14px rgb(0 0 0 / 0.45)" }}>
            {title}
          </p>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-white/10 ring-inset" />
    </div>
  );
}
