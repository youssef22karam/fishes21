import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Viewer, { type ViewName } from './components/Viewer';
import FieldGuide, { RefImg } from './components/FieldGuide';
import Thumb from './components/Thumb';
import { GROUPS, SPECIES } from './data/species';
import type { Species } from './engine/types';
import { HABITAT, HABITATS, type HabitatId } from './gen/habitats';
import { LINEAGES, NICHE_INFO } from './gen/lineages';
import { blind, census as makeCensus, cross, fromSpecies, generate, migrate, offspring, SPECIES_BY_ID, type GenFish } from './gen/generate';
const QS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const qn = (k: string, d: number) => (QS.has(k) ? +QS.get(k)! : d);
/** ?ui=0 shows the bare viewport (clean captures) */
const UI = qn('ui', 1) > 0;
const randSeed = () => Math.floor(Math.random() * 1e9) + 2;
const NOVELTY_STOPS: [number, string, string][] = [
  [0, 'Real species', 'Exact living species native to this biome, with natural individual variation.'],
  [0.25, 'Sister species', 'Hybrids within a lineage, gently adapted, inheriting their parents’ patterns.'],
  [0.55, 'New species', 'Colonists from other lineages reshaped by convergent evolution, with newly evolved liveries and organs.'],
  [0.85, 'Chimera', 'Cross-lineage introgression under maximal selection — strange, yet every organ stays anatomically coherent.'],
];
const stopOf = (v: number) => [...NOVELTY_STOPS].reverse().find((s) => v >= s[0] - 1e-9) ?? NOVELTY_STOPS[0];
function initialFish(): GenFish {
  const id = QS.get('sp');
  if (id && SPECIES_BY_ID[id]) return fromSpecies(SPECIES_BY_ID[id]);
  if (QS.has('blind')) return blind(+QS.get('blind')!);
  const h = QS.get('hab') as HabitatId | null;
  return generate(h && HABITAT[h] ? h : 'reef', qn('seed', 7), { novelty: qn('nov', 0.65) });
}
const VIEWS: [ViewName, string][] = [['side', 'Lateral'], ['three', '¾'], ['front', 'Mouth'], ['top', 'Dorsal'], ['below', 'Ventral']];
export default function App() {
  const [fish, setFish] = useState<GenFish>(initialFish);
  const [hab, setHab] = useState<HabitatId>(fish.habitat);
  const [novelty, setNovelty] = useState(qn('nov', 0.65));
  const [log, setLog] = useState<GenFish[]>(() => [fish]);
  const [tab, setTab] = useState<'gen' | 'atlas'>(QS.has('sp') ? 'atlas' : 'gen');
  const [pending, setPending] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [crossing, setCrossing] = useState(false);
  const [censusSeed, setCensusSeed] = useState(1);
  const novRef = useRef(novelty);
  novRef.current = novelty;
  const census = useMemo(() => makeCensus(fish.habitat, censusSeed * 7919 + fish.habitat.length, 9, novRef.current), [fish.habitat, censusSeed]);
  // atlas
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('All');
  // viewer
  const [gape, setGape] = useState(qn('gape', 0));
  const [autoFeed, setAutoFeed] = useState(qn('feed', 1) > 0);
  const [swim, setSwim] = useState(qn('swim', 1) > 0);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<ViewName>((QS.get('view') as ViewName) ?? 'three');
  const [viewNonce, setViewNonce] = useState(0);
  const [wire, setWire] = useState(qn('wire', 0) > 0);
  const [panel, setPanel] = useState(UI && qn('panel', 1) > 0 && (typeof window === 'undefined' || window.innerWidth > 1180));
  const [list, setList] = useState(UI && qn('list', 1) > 0 && (typeof window === 'undefined' || window.innerWidth > 760));
  const [fins, setFins] = useState(qn('fins', 1) > 0);
  const [eyes, setEyes] = useState(qn('eyes', 1) > 0);
  const [breathe, setBreathe] = useState(qn('breathe', 1) > 0);
  const [flash, setFlash] = useState(0);
  const sp = fish.species;
  const H = HABITAT[fish.habitat];
  const sel = HABITAT[hab];
  const run = useCallback((fn: () => GenFish, url?: string) => {
    setPending(true);
    setTimeout(() => {
      let f: GenFish;
      try { f = fn(); } catch (e) { console.error(e); setPending(false); return; }
      setFish(f);
      setHab(f.habitat);
      setFlash((n) => n + 1);
      setLog((l) => [f, ...l.filter((x) => x.key !== f.key)].slice(0, 40));
      if (url !== undefined) history.replaceState(null, '', url);
      setTimeout(() => setPending(false), 4000);
    }, 40);
  }, []);
  const doGenerate = (h: HabitatId = hab) => { const seed = randSeed(); run(() => generate(h, seed, { novelty }), `?hab=${h}&seed=${seed}&nov=${novelty.toFixed(2)}`); };
  const doBlind = () => { const seed = randSeed(); run(() => blind(seed), `?blind=${seed}`); };
  const doOffspring = () => { const seed = randSeed(); run(() => offspring(fish, seed)); };
  const doMigrate = (h: HabitatId) => { const seed = randSeed(); setMigrating(false); run(() => migrate(fish, h, seed, novelty)); };
  const doAtlas = (s: Species) => run(() => fromSpecies(s), `?sp=${s.id}`);
  const pickFish = (f: GenFish) => {
    if (crossing) { if (f.key !== fish.key) { const seed = randSeed(); setCrossing(false); run(() => cross(fish, f, seed, 0.4)); } return; }
    if (f.key !== fish.key) run(() => f);
  };
  const act = useRef({ doGenerate, doBlind, doOffspring });
  act.current = { doGenerate, doBlind, doOffspring };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'g') act.current.doGenerate();
      if (k === 'b') act.current.doBlind();
      if (k === 'o') act.current.doOffspring();
      if (e.key === ' ') { e.preventDefault(); setAutoFeed((v) => !v); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const filtered = SPECIES.filter((s) => (group === 'All' || s.group === group) && (s.name + s.sci).toLowerCase().includes(q.toLowerCase()));
  const stop = stopOf(novelty);
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#050d14] text-slate-200 flex font-sans select-none">
      {/* ── left: generator / atlas ── */}
      <aside className={`${list ? 'w-[324px]' : 'w-0'} transition-all duration-300 shrink-0 border-r border-white/[0.06] bg-[#071520]/95 flex flex-col overflow-hidden z-20`}>
        <div className="w-[324px] px-4 pt-4 pb-2">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[19px] font-semibold tracking-tight text-white">Ichthyo<span className="bg-gradient-to-r from-cyan-300 to-fuchsia-300 bg-clip-text text-transparent">Genesis</span></h1>
            <span className="text-[10px] text-cyan-200/40">v18</span>
          </div>
          <p className="text-[10.5px] text-cyan-100/45 leading-snug">Procedural evolution of fishes · {SPECIES.length} measured genomes · {Object.keys(LINEAGES).length} lineages · {HABITATS.length} biomes</p>
          <div className="mt-3 grid grid-cols-2 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[12px]">
            <button onClick={() => setTab('gen')} className={`py-1.5 rounded-md ${tab === 'gen' ? 'bg-gradient-to-r from-cyan-500/30 to-fuchsia-500/25 text-white' : 'text-slate-400 hover:text-white'}`}>✦ Generator</button>
            <button onClick={() => setTab('atlas')} className={`py-1.5 rounded-md ${tab === 'atlas' ? 'bg-cyan-500/25 text-white' : 'text-slate-400 hover:text-white'}`}>Atlas · {SPECIES.length}</button>
          </div>
        </div>
        {tab === 'gen' ? (
          <div className="w-[324px] flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            <section>
              <h2 className="label">Environment</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {HABITATS.map((h) => (
                  <button key={h.id} onClick={() => { setHab(h.id); doGenerate(h.id); }} title={h.blurb}
                    className={`biome relative overflow-hidden rounded-lg h-[46px] text-left px-2 py-1 border transition ${hab === h.id ? 'border-cyan-200/80 ring-1 ring-cyan-200/50 shadow-[0_0_18px_rgba(80,220,255,0.25)]' : 'border-white/[0.07] hover:border-white/25'}`}
                    style={{ background: h.swatch }}>
                    <span className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/35 to-transparent" />
                    <span className="relative flex items-center gap-1.5">
                      <span className="text-[17px] leading-none">{h.glyph}</span>
                      <span className="min-w-0">
                        <span className="block text-[11.5px] font-medium text-white leading-tight truncate">{h.name}</span>
                        <span className="block text-[9px] text-white/60 leading-tight">{h.realm} · {h.depth[1] >= 1000 ? `${(h.depth[1] / 1000).toFixed(h.depth[1] % 1000 ? 1 : 0)} km` : `${h.depth[1]} m`}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 leading-snug mt-2">{sel.blurb}</p>
              <div className="grid grid-cols-5 gap-1.5 mt-2">
                {([['Light', sel.light], ['Warmth', sel.temp], ['Current', sel.flow], ['Murk', sel.turb], ['Cover', sel.struct]] as [string, number][]).map(([k, v]) => (
                  <div key={k}><div className="h-1 rounded-full bg-white/[0.07] overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-400 to-sky-300" style={{ width: `${Math.max(4, v * 100)}%` }} /></div><div className="text-[9px] text-slate-500 mt-0.5 text-center">{k}</div></div>
                ))}
              </div>
            </section>
            <section>
              <div className="flex items-baseline justify-between">
                <h2 className="label">Novelty</h2>
                <span className="text-[11px] font-medium bg-gradient-to-r from-cyan-200 to-fuchsia-200 bg-clip-text text-transparent">{stop[1]} · {Math.round(novelty * 100)}%</span>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={novelty} onChange={(e) => setNovelty(+e.target.value)} className="nov w-full" />
              <div className="flex justify-between text-[9px] text-slate-500 -mt-0.5">{NOVELTY_STOPS.map((s) => <button key={s[1]} onClick={() => setNovelty(s[0] + (s[0] ? 0.05 : 0))} className="hover:text-cyan-200">{s[1]}</button>)}</div>
              <p className="text-[10.5px] text-slate-400 leading-snug mt-1.5 min-h-[28px]">{stop[2]}</p>
            </section>
            <section className="space-y-1.5">
              <button onClick={() => doGenerate()} className="gen-btn w-full rounded-xl py-2.5 text-[14px] font-semibold text-white">✦ Generate in {sel.name} <kbd>G</kbd></button>
              <button onClick={doBlind} className="w-full rounded-xl py-2 text-[12.5px] text-cyan-50 border border-cyan-300/30 bg-cyan-300/[0.07] hover:bg-cyan-300/15">🎲 Blind generation — any biome, any novelty <kbd>B</kbd></button>
              <div className="grid grid-cols-3 gap-1.5">
                <button onClick={doOffspring} className="sbtn" title="Heritable variation of the current specimen (O)">❦ Offspring</button>
                <button onClick={() => { setMigrating((v) => !v); setCrossing(false); }} className={`sbtn ${migrating ? 'on' : ''}`} title="Move this lineage to another biome and let selection reshape it">➜ Migrate</button>
                <button onClick={() => { setCrossing((v) => !v); setMigrating(false); }} className={`sbtn ${crossing ? 'on' : ''}`} title="Cross-breed with a specimen from the log or census">⚭ Cross</button>
              </div>
              {migrating && (
                <div className="rounded-lg border border-cyan-300/25 bg-cyan-300/[0.05] p-2">
                  <div className="text-[10.5px] text-cyan-100/80 mb-1.5">Colonise which biome? Selection will reshape <b>{fish.common}</b>.</div>
                  <div className="grid grid-cols-9 gap-1">{HABITATS.map((h) => <button key={h.id} disabled={h.id === fish.habitat} onClick={() => doMigrate(h.id)} title={h.name} className="h-7 rounded-md text-[15px] bg-white/[0.04] hover:bg-white/15 disabled:opacity-25" style={{ background: h.id === fish.habitat ? undefined : h.swatch }}>{h.glyph}</button>)}</div>
                </div>
              )}
              {crossing && <div className="rounded-lg border border-fuchsia-300/30 bg-fuchsia-300/[0.06] p-2 text-[10.5px] text-fuchsia-100/90">Pick a partner for <b>{fish.common}</b> from the specimen log below or the ecosystem census →</div>}
            </section>
            <section>
              <h2 className="label">Specimen log · {log.length}</h2>
              <div className="space-y-1">
                {log.map((f) => (
                  <button key={f.key} onClick={() => pickFish(f)} className={`w-full flex items-center gap-2 rounded-lg px-1.5 py-1 text-left border transition ${f.key === fish.key ? 'border-cyan-400/40 bg-cyan-400/10' : crossing ? 'border-fuchsia-300/25 hover:bg-fuchsia-300/10' : 'border-transparent hover:bg-white/[0.04]'}`}>
                    <Thumb sp={f.species} w={64} h={34} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-slate-100 truncate">{f.common}</span>
                      <span className="block text-[10px] text-slate-500 truncate">{HABITAT[f.habitat].glyph} {HABITAT[f.habitat].name} · {f.real ? 'known' : `${Math.round(f.novelty * 100)}%`}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="w-[324px] flex-1 flex flex-col overflow-hidden">
            <div className="px-4 pb-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 106 measured species…" className="w-full rounded-lg bg-[#0d2433] border border-cyan-900/50 px-3 py-1.5 text-sm outline-none focus:border-cyan-500/70 placeholder:text-slate-500" />
              <div className="flex flex-wrap gap-1 mt-2 max-h-24 overflow-y-auto">
                {['All', ...GROUPS].map((g) => <button key={g} onClick={() => setGroup(g)} className={`text-[10px] px-2 py-0.5 rounded-full border ${group === g ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-100' : 'border-cyan-900/50 text-slate-400 hover:text-slate-200'}`}>{g}</button>)}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {filtered.map((s) => (
                <button key={s.id} onClick={() => doAtlas(s)} className={`w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded-lg mb-0.5 ${s.id === sp.id ? 'bg-cyan-500/15 ring-1 ring-cyan-400/40' : 'hover:bg-white/5'}`}>
                  <RefImg id={s.id} thumb className="w-11 h-8 rounded object-cover bg-slate-800 shrink-0" />
                  <span className="min-w-0"><span className="block text-[13px] truncate text-slate-100">{s.name}</span><span className="block text-[10.5px] italic truncate text-slate-400">{s.sci}</span></span>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-xs text-slate-500 px-2 py-4">No species match.</p>}
            </div>
          </div>
        )}
      </aside>
      {/* ── viewport ── */}
      <main className="relative flex-1 min-w-0">
        <Viewer species={sp} seed={fish.seed} gape={gape} autoFeed={autoFeed} swim={swim} speed={speed} view={view} viewNonce={viewNonce} wire={wire} fins={fins} eyes={eyes} breathe={breathe} amb={H.amb} onBuilt={() => setPending(false)} />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(1,6,12,0.55)_100%)]" />
        <div key={flash} className="flash absolute inset-0 pointer-events-none" />
        {pending && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="evolving flex flex-col items-center gap-3">
              <div className="rings"><span /><span /><span /></div>
              <div className="text-[11px] tracking-[0.3em] uppercase text-cyan-100/80">Evolving</div>
            </div>
          </div>
        )}
        {UI && (
          <>
            <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-3 pointer-events-none">
              <div className="pointer-events-auto flex gap-2 min-w-0">
                <button onClick={() => setList((v) => !v)} className="btn h-fit">{list ? '⟨' : '☰'}</button>
                <div key={fish.key} className="glass title-card px-4 py-2.5 min-w-0 max-w-[560px]">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/70">
                    <span>{H.glyph} {H.name}</span><span className="opacity-40">•</span><span>{NICHE_INFO[fish.niche].name}</span>
                    <span className={`ml-1 px-1.5 py-px rounded ${fish.real ? 'bg-emerald-400/20 text-emerald-100' : 'bg-fuchsia-400/20 text-fuchsia-100'}`}>{fish.real ? 'known' : 'new species'}</span>
                  </div>
                  <div className="text-[22px] font-semibold text-white leading-tight truncate">{fish.common}</div>
                  <div className="text-xs italic text-cyan-200/75 truncate">{fish.latin} · {LINEAGES[fish.lineage].name}</div>
                </div>
              </div>
              <div className="pointer-events-auto flex gap-1 glass p-1 shrink-0">
                {VIEWS.map(([v, l]) => <button key={v} onClick={() => { setView(v); setViewNonce((n) => n + 1); }} className={`text-xs px-2.5 py-1 rounded-md ${view === v ? 'bg-cyan-400/25 text-white' : 'text-slate-300 hover:bg-white/10'}`}>{l}</button>)}
                <button onClick={() => setPanel((v) => !v)} className="text-xs px-2.5 py-1 rounded-md text-slate-300 hover:bg-white/10">{panel ? 'Hide guide ⟩' : '⟨ Field guide'}</button>
              </div>
            </div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 glass px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 justify-center max-w-[96%]">
              <label className="flex items-center gap-2 text-xs">
                <span className="text-slate-300">Jaw</span>
                <input type="range" min={0} max={1} step={0.01} value={gape} onChange={(e) => setGape(+e.target.value)} className="w-24 accent-rose-400" />
                <span className="w-8 tabular-nums text-rose-200">{Math.round(gape * sp.mouth.open)}°</span>
              </label>
              <Toggle on={autoFeed} set={setAutoFeed} label="Feeding strike" />
              <Toggle on={breathe} set={setBreathe} label="Breathing" />
              <Toggle on={swim} set={setSwim} label="Swim" />
              <Toggle on={fins} set={setFins} label="Fins" />
              <Toggle on={eyes} set={setEyes} label="Eyes" />
              <label className="flex items-center gap-2 text-xs"><span className="text-slate-300">Speed</span><input type="range" min={0.1} max={2.5} step={0.05} value={speed} onChange={(e) => setSpeed(+e.target.value)} className="w-16 accent-cyan-400" /></label>
              <Toggle on={wire} set={setWire} label="Mesh" />
              <button onClick={() => doGenerate()} className="text-xs px-3 py-1 rounded-md gen-btn text-white font-medium">✦ Generate</button>
            </div>
            <div className="absolute bottom-16 left-3 text-[10px] text-slate-400/70 hidden md:block">G generate · B blind · O offspring · space strike · drag to orbit · scroll to zoom</div>
          </>
        )}
      </main>
      {/* ── right: field guide ── */}
      <aside className={`${panel ? 'w-[380px]' : 'w-0'} transition-all duration-300 shrink-0 border-l border-white/[0.06] bg-[#071520]/95 overflow-hidden z-20`}>
        <FieldGuide fish={fish} census={census} onPick={pickFish} onRecensus={() => setCensusSeed((n) => n + 1)} />
      </aside>
    </div>
  );
}
function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => set(!on)} className="flex items-center gap-1.5 text-xs text-slate-300">
      <span className={`w-7 h-4 rounded-full relative transition ${on ? 'bg-cyan-500/70' : 'bg-slate-600'}`}><span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} /></span>
      {label}
    </button>
  );
}
