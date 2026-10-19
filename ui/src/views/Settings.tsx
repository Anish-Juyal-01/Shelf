import clsx from "clsx";
import { FolderPlus, HardDrive, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { bridge } from "../bridge/bridge";
import type { SettingsPatch, SourceState } from "../bridge/protocol";
import { ThemePicker } from "../components/ThemePicker";
import { Button, IconButton, PageHead, SectionTitle, Segmented, Toggle } from "../components/ui";
import { useApp } from "../store/store";

export function Settings() {
  const state = useApp((s) => s.state)!;
  const version = useApp((s) => s.version);
  const s = state.settings;
  const update = (patch: SettingsPatch) => bridge.send({ type: "updateSettings", patch });

  return (
    <div className="mx-auto max-w-[860px] px-8 pt-7 pb-16">
      <PageHead title="Settings" />

      <Section title="Appearance">
        <ThemePicker value={s.palette} dark={document.documentElement.dataset.theme === "dark"} onChange={(v) => update({ palette: v })} />
        <div className="h-3" />
        <Row label="Library hero" hint="Your games on a turning wheel over the clouds, or a ring you stand inside (drag to spin).">
          <Segmented label="Library hero" value={s.heroStyle} onChange={(v) => update({ heroStyle: v })}
            options={[{ value: "wheel", label: "Wheel" }, { value: "ring", label: "Ring" }]} />
        </Row>
        <Row label="Day or night" hint="System follows Windows' light or dark setting. Every colour theme has both.">
          <Segmented label="Day or night" value={s.theme} onChange={(v) => update({ theme: v })}
            options={[{ value: "system", label: "System" }, { value: "light", label: "Day" }, { value: "dark", label: "Night" }]} />
        </Row>
      </Section>


      <Section title="Scan folders" aside="loose games, zips, repacks">
        <p className="mb-3 text-[13px] text-ink-2">
          Shelf reads your launchers automatically. Add folders where you keep games that didn't come from one — Shelf
          watches them and notices new downloads by itself.
        </p>
        <ul className="divide-y divide-rule rounded-[4px] border border-rule bg-surface">
          {s.scanRoots.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-3">No folders yet.</li>}
          {s.scanRoots.map((r) => (
            <li key={r.path} className="flex items-center gap-3 px-4 py-2">
              <span className={clsx("typed flex-1 truncate text-[12.5px]", r.reachable ? "text-ink" : "text-ink-3 line-through")} title={r.path}>{r.path}</span>
              {!r.reachable && <span className="text-[12px] text-warn">not reachable</span>}
              <IconButton label={`Stop scanning ${r.path}`} onClick={() => bridge.send({ type: "removeRoot", path: r.path })}>
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button icon={<FolderPlus size={15} />} onClick={() => bridge.send({ type: "addRoot" })}>Add folder…</Button>
          {s.suggestedRoots.map((p) => (
            <Button key={p} tone="quiet" small icon={<Plus size={13} />} onClick={() => bridge.send({ type: "addRootPath", path: p })}>
              <span className="typed text-[12px]">{p}</span>
            </Button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-dashed border-rule pt-4">
          <span className="mr-1 text-[13px] text-ink-2">Search a whole drive once:</span>
          {s.drives.map((d) => (
            <Button key={d} small icon={<HardDrive size={13} />} disabled={state.scan.running} onClick={() => bridge.send({ type: "scanDrive", root: d })}>
              {d.replace("\\", "")}
            </Button>
          ))}
          <span className="text-[12px] text-ink-3">Finds games anywhere on it; system folders are skipped.</span>
        </div>
      </Section>

      <Section title="Tracking">
        <Row label="Spot unknown games" hint="Asks “Looks like you're playing X — add it?” when a program Shelf doesn't know runs fullscreen or keeps the GPU busy for a minute.">
          <Toggle checked={s.runtimeDetection} onChange={(v) => update({ runtimeDetection: v })} label="Spot unknown games" />
        </Row>
        <Row label="Watch scan folders for new downloads" hint="New games appear on their own once a download or extraction has been quiet for a minute.">
          <Toggle checked={s.watchFolders} onChange={(v) => update({ watchFolders: v })} label="Watch scan folders" />
        </Row>
        <p className="typed mt-2 text-[11.5px] text-ink-3">
          {state.watch.running ? "Tracking is on" : "Tracking is off"}
          {state.watch.running && !state.watch.gpuCounters && " · GPU counters aren't available on this PC, so only fullscreen programs are spotted"}
        </p>
      </Section>

      <Section title="Launchers" aside="read from local files only — no sign-ins">
        <ul className="divide-y divide-rule rounded-[4px] border border-rule bg-surface">
          {state.sources.map((src) => (
            <li key={src.source} className="flex items-start gap-3 px-4 py-2.5">
              <StateDot state={src.state} />
              <span className="w-[104px] shrink-0 text-[13px] font-medium text-ink">{src.name}</span>
              <span className={clsx("min-w-0 flex-1 text-[12.5px] break-words", src.state === "unreadable" ? "text-stamp-red" : src.state === "partial" ? "text-warn" : "text-ink-3")}>
                {src.message}
              </span>
            </li>
          ))}
        </ul>
      </Section>


      <Section title="Art" aside="for covers and icons Shelf can't find on disk">
        <Row label="Look up missing art online" hint="Sends only game titles — to Steam's store search, and to SteamGridDB if you add a key. Art already on your PC is never replaced.">
          <Toggle checked={s.webArt} onChange={(v) => update({ webArt: v })} label="Look up missing art online" />
        </Row>
        <Row
          label="SteamGridDB key"
          hint={<>Optional and free. Adds icons, and art for games that aren't on Steam. Get one at steamgriddb.com → Preferences → API.</>}
        >
          <KeyField has={s.hasSteamGridDbKey} onSave={(k) => update({ steamGridDbKey: k })} />
        </Row>
      </Section>

      <Section title="App">
        <Row label="Start with Windows" hint="Starts in the tray at sign-in, so play time is counted even when you never open Shelf.">
          <Toggle checked={s.startWithWindows} onChange={(v) => update({ startWithWindows: v })} label="Start with Windows" />
        </Row>
        <Row label="Closing the window keeps Shelf in the tray" hint="Turn off to quit when the window closes (tracking stops).">
          <Toggle checked={s.closeToTray} onChange={(v) => update({ closeToTray: v })} label="Close to tray" />
        </Row>
        <Row label="Data folder" hint={<span className="typed">{s.dataDir}</span>}>
          <Button small onClick={() => bridge.send({ type: "openDataFolder" })}>Open</Button>
        </Row>
        <Row label="Quit Shelf" hint="Stops tracking until you start it again.">
          <Button small tone="danger" onClick={() => bridge.send({ type: "window", action: "quit" })}>Quit</Button>
        </Row>
      </Section>

      <p className="typed mt-10 text-center text-[11px] text-ink-4">
        Shelf {version} · your library stays on this PC · Shelf never changes, moves or deletes files in game folders
      </p>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <SectionTitle aside={aside}>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** A write-only field: the key is never sent back to the page, only whether one is saved. */
function KeyField({ has, onSave }: { has: boolean; onSave(key: string): void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex shrink-0 items-center gap-2">
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={has ? "Saved — paste to replace" : "Paste key"}
        aria-label="SteamGridDB key"
        className="h-7 w-[190px] rounded-[6px] border border-rule-strong bg-surface px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-4 focus:border-ink-3"
      />
      <Button small tone="primary" disabled={value.trim() === ""} onClick={() => { onSave(value.trim()); setValue(""); }}>Save</Button>
      {has && <Button small tone="quiet" onClick={() => onSave("")}>Remove</Button>}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <p className="text-[13.5px] text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function StateDot({ state }: { state: SourceState }) {
  const cls = { ok: "bg-ok", partial: "bg-warn", unreadable: "bg-stamp-red", notInstalled: "border border-ink-4 bg-transparent" }[state];
  const label = { ok: "Read", partial: "Partly read", unreadable: "Couldn't read", notInstalled: "Not installed" }[state];
  return <span className={clsx("mt-[6px] size-2 shrink-0 rounded-full", cls)} title={label} aria-label={label} />;
}
