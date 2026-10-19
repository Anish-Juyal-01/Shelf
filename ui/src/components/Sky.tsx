import { memo, useEffect, useState } from "react";
import { paletteById, type Tokens } from "../lib/palettes";

/**
 * The sky behind the library hero, drawn procedurally — no images.
 *
 * Clouds are painted the way illustrators paint cumulus: every cloud is a cluster of puffs, each puff a sphere lit by
 * its own gradient from the sun's side, painted top-down so the bright tops of the lower puffs sit against the
 * shaded undersides of the ones above — that separation is what reads as volume. Each cloud sits on a flat, shaded
 * base. A whisper of noise softens the outlines without crinkling them. Three depths (high wisps, a hazy back bank,
 * a crisp front bank) drift slowly; everything is static SVG moved by compositor transforms.
 */

const W = 1600;
const H = 520;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Puff {
  cx: number;
  cy: number;
  r: number;
}

interface Cloud {
  puffs: Puff[];
  base: { cx: number; cy: number; rx: number; ry: number };
}

/** A cumulus cloud: a flat base, a row of puffs tallest in the middle, a smaller crown. */
function cumulus(cx: number, baseY: number, width: number, height: number, r: () => number): Cloud {
  const puffs: Puff[] = [];
  const n = 5 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const env = Math.pow(Math.sin(Math.PI * (0.1 + t * 0.8)), 0.9);
    const rad = (0.38 + 0.62 * env) * height * (0.8 + r() * 0.35);
    puffs.push({ cx: cx - width / 2 + t * width + (r() - 0.5) * 20, cy: baseY - rad * 0.62, r: rad });
  }
  const crown = 1 + Math.floor(r() * 3);
  for (let i = 0; i < crown; i++) {
    const rad = height * (0.42 + r() * 0.2);
    puffs.push({ cx: cx + (r() - 0.5) * width * 0.36, cy: baseY - height * (0.98 + r() * 0.22), r: rad });
  }
  // Paint top-down: higher puffs first, so lower puffs overlap them.
  puffs.sort((a, b) => a.cy - a.r - (b.cy - b.r));
  return { puffs, base: { cx, cy: baseY - height * 0.08, rx: width * 0.56, ry: height * 0.22 } };
}

function bank(seed: number, baseY: number, minW: number, maxW: number, minH: number, maxH: number, step: number): Cloud[] {
  const r = rng(seed);
  const clouds: Cloud[] = [];
  for (let x = -140; x < W + 180; x += step * (0.8 + r() * 0.45)) {
    clouds.push(cumulus(x, baseY + (r() - 0.5) * 22, minW + r() * (maxW - minW), minH + r() * (maxH - minH), r));
  }
  return clouds;
}

const FRONT = bank(11, H + 26, 300, 460, 70, 128, 270);
const BACK = bank(29, H - 84, 210, 330, 42, 82, 225);
const WISPS = (() => {
  const r = rng(53);
  return Array.from({ length: 5 }, (_, i) => ({ cx: 120 + i * 330 + r() * 120, cy: 64 + r() * 140, rx: 150 + r() * 170, ry: 7 + r() * 9 }));
})();

/** Current theme tokens, following palette and day/night changes on <html>. */
function useTokens(): Tokens {
  const read = () => {
    const el = document.documentElement;
    const p = paletteById(el.dataset.palette);
    return el.dataset.theme === "dark" ? p.dark : p.light;
  };
  const [t, setT] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setT(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return t;
}

/** Mix two hex colours (0 = a, 1 = b). */
function mix(a: string, b: string, k: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const c = [1, 3, 5].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function Defs({ t }: { t: Tokens }) {
  const light = mix(t.cloud, "#ffffff", 0.55);
  const mid = t.cloud;
  const shade = t["cloud-shade"];
  const deep = mix(shade, t["sky-top"], 0.25);
  // Back layer: lower contrast, pulled toward the sky (aerial perspective).
  const bLight = mix(light, t["sky-low"], 0.3);
  const bMid = mix(mid, t["sky-low"], 0.35);
  const bShade = mix(shade, t["sky-mid"], 0.4);
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        {/* Each puff is a sphere lit from the upper right. */}
        {/* Broad soft highlight toward the sun; no dark rim (that's what makes puffs look like bubbles). */}
        <radialGradient id="shelf-puff" cx="0.58" cy="0.36" r="0.72" fx="0.66" fy="0.24">
          <stop offset="0" stopColor={light} />
          <stop offset="0.5" stopColor={mix(light, mid, 0.6)} />
          <stop offset="1" stopColor={mid} />
        </radialGradient>
        {/* Shadow falls only on each puff's underside. */}
        <linearGradient id="shelf-under" x1="0" y1="0" x2="0.15" y2="1">
          <stop offset="0" stopColor={shade} stopOpacity="0" />
          <stop offset="0.55" stopColor={shade} stopOpacity="0" />
          <stop offset="1" stopColor={shade} stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="shelf-under-back" x1="0" y1="0" x2="0.15" y2="1">
          <stop offset="0" stopColor={bShade} stopOpacity="0" />
          <stop offset="0.6" stopColor={bShade} stopOpacity="0" />
          <stop offset="1" stopColor={bShade} stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="shelf-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(mid, shade, 0.5)} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
        <radialGradient id="shelf-puff-back" cx="0.58" cy="0.36" r="0.72" fx="0.66" fy="0.26">
          <stop offset="0" stopColor={bLight} />
          <stop offset="1" stopColor={bMid} />
        </radialGradient>
        <linearGradient id="shelf-base-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={bMid} />
          <stop offset="1" stopColor={bShade} />
        </linearGradient>
        {/* Just enough noise to make outlines organic. */}
        <filter id="shelf-soft" x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="5" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <filter id="shelf-soft-back" x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="8" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <filter id="shelf-wisp" x="-30%" y="-300%" width="160%" height="700%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.05" numOctaves="3" seed="21" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
    </svg>
  );
}

function Clouds({ clouds, back }: { clouds: Cloud[]; back?: boolean }) {
  const puff = back ? "url(#shelf-puff-back)" : "url(#shelf-puff)";
  const under = back ? "url(#shelf-under-back)" : "url(#shelf-under)";
  const base = back ? "url(#shelf-base-back)" : "url(#shelf-base)";
  return (
    <g filter={back ? "url(#shelf-soft-back)" : "url(#shelf-soft)"}>
      {clouds.map((c, i) => (
        <g key={i}>
          {c.puffs.map((p, j) => (
            <g key={j}>
              <circle cx={p.cx} cy={p.cy} r={p.r} fill={puff} />
              <circle cx={p.cx} cy={p.cy} r={p.r} fill={under} />
            </g>
          ))}
          <ellipse cx={c.base.cx} cy={c.base.cy} rx={c.base.rx} ry={c.base.ry} fill={base} />
        </g>
      ))}
    </g>
  );
}

function Layer({ children, drift, opacity = 1 }: { children: React.ReactNode; drift: number; opacity?: number }) {
  return (
    <div className="absolute inset-0 will-change-transform" style={{ opacity, animation: `shelf-drift ${drift}s ease-in-out infinite alternate` }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-[-3%] h-[106%] w-[106%]">
        {children}
      </svg>
    </div>
  );
}

export const SkyBackdrop = memo(function SkyBackdrop() {
  const t = useTokens();
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <style>{`@keyframes shelf-drift { from { transform: translateX(-1.2%) } to { transform: translateX(1.2%) } }`}</style>
      <Defs t={t} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 46%, var(--sky-low) 82%, var(--sky-glow) 100%)" }} />
      {/* sun or moon with a soft bloom */}
      <div className="absolute" style={{ right: "13%", top: "26%", width: 760, height: 760, transform: "translate(50%,-50%)", background: "radial-gradient(circle, color-mix(in oklab, var(--sky-glow) 70%, white) 0%, color-mix(in oklab, var(--sky-glow) 40%, transparent) 18%, transparent 55%)" }} />
      <div className="absolute rounded-full" style={{ right: "13%", top: "26%", width: 46, height: 46, transform: "translate(50%,-50%)", background: "color-mix(in oklab, var(--sky-glow) 45%, white)", boxShadow: "0 0 40px 12px color-mix(in oklab, var(--sky-glow) 60%, white)" }} />
      <Stars />
      <Layer drift={90} opacity={0.5}>
        <g filter="url(#shelf-wisp)" fill={t.cloud}>
          {WISPS.map((w, i) => <ellipse key={i} cx={w.cx} cy={w.cy} rx={w.rx} ry={w.ry} />)}
        </g>
      </Layer>
      <Layer drift={70} opacity={0.9}>
        <Clouds clouds={BACK} back />
      </Layer>
    </div>
  );
});

/** The front cloud bank, drawn above whatever floats in the sky (the wheel rises out of it). */
export const SkyFront = memo(function SkyFront() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <Layer drift={55}>
        <Clouds clouds={FRONT} />
      </Layer>
      <Petals />
    </div>
  );
});

const STAR_POINTS = Array.from({ length: 80 }, (_, i) => {
  const x = (i * 73.13) % 100;
  const y = (i * 37.71) % 58;
  const s = i % 9 === 0 ? 2 : 1;
  return `radial-gradient(${s}px ${s}px at ${x}% ${y}%, rgba(255,255,255,${i % 5 === 0 ? 0.9 : 0.5}), transparent)`;
}).join(",");

function Stars() {
  return <div className="absolute inset-0 hidden [:root[data-theme=dark]_&]:block" style={{ backgroundImage: STAR_POINTS }} />;
}

const PETAL_COLORS = ["var(--u-red)", "var(--u-yellow)", "var(--u-blue)", "#ffffff"];

function Petals() {
  return (
    <>
      <style>{`
        @keyframes shelf-petal {
          0% { transform: translate3d(0,0,0) rotate(0deg) rotateX(0deg); opacity: 0 }
          12% { opacity: .85 }
          88% { opacity: .8 }
          100% { transform: translate3d(var(--dx), var(--dy), 0) rotate(420deg) rotateX(640deg); opacity: 0 }
        }
      `}</style>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="absolute block"
          style={{
            left: `${(i * 67 + 8) % 100}%`,
            top: `${(i * 23 + 6) % 45}%`,
            width: 6 + (i % 3),
            height: 3 + (i % 2),
            borderRadius: "60% 40%",
            background: PETAL_COLORS[i % PETAL_COLORS.length],
            ["--dx" as string]: `${-110 - (i % 4) * 50}px`,
            ["--dy" as string]: `${120 + (i % 5) * 36}px`,
            animation: `shelf-petal ${11 + (i % 5) * 2.5}s linear ${-(i * 2.1)}s infinite`,
          }}
        />
      ))}
    </>
  );
}
