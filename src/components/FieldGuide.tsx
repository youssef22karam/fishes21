// ─────────────────────────────────────────────────────────────────────────────
//  Field guide panel: the specimen's plate, prose, adaptation notes, genome
//  bars and the ecosystem census of its biome.
//  NOTE (salvage): this file's creation block did not survive the copied Arena
//  transcript. It is reconstructed to the contract App.tsx uses — default
//  export FieldGuide { fish, census, onPick, onRecensus } and the named
//  RefImg export (ported verbatim from the base App.tsx, where it lived).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import Profile from './Profile';
import Thumb from './Thumb';
import { HABITAT } from '../gen/habitats';
import { LINEAGES, NICHE_INFO } from '../gen/lineages';
import { STRATEGY_INFO } from '../gen/pigment';
import type { GenFish } from '../gen/generate';

/** Reference photographs live in the fish-images library (github.com/youssef22karam/fish-images) */
const REPO = 'youssef22karam/fish-images';
function photoUrls(id: string, thumb: boolean) {
  const path = `${id}/01_${id}.jpg`;
  const cdn = `https://cdn.jsdelivr.net/gh/${REPO}@main/${path}`;
  const raw = `https://raw.githubusercontent.com/${REPO}/main/${path}`;
  return thumb
    ? [`https://wsrv.nl/?url=${encodeURIComponent(cdn)}&w=120&h=84&fit=cover&output=webp`, cdn, raw]
    : [cdn, raw, `https://wsrv.nl/?url=${encodeURIComponent(raw)}&w=1000`];
}
export function RefImg({ id, thumb, className, alt }: { id: string; thumb?: boolean; className: string; alt?: string }) {
  const urls = photoUrls(id, !!thumb);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [id]);
  if (i >= urls.length) return <div className={`${className} grid place-items-center text-[10px] text-slate-500`}>{thumb ? '—' : 'photo unavailable'}</div>;
  return <img key={urls[i]} src={urls[i]} loading="lazy" alt={alt ?? ''} className={className} onError={() => setI((k) => k + 1)} />;
}

interface Props {
  fish: GenFish;
  census: GenFish[];
  onPick: (f: GenFish) => void;
  onRecensus: () => void;
}
export default function FieldGuide({ fish, census, onPick, onRecensus }: Props) {
  const sp = fish.species;
  const H = HABITAT[fish.habitat];
  const strat = fish.strategy !== 'inherited' ? STRATEGY_INFO[fish.strategy] : null;
  return (
    <div className="w-[380px] h-full overflow-y-auto px-4 py-4 space-y-4">
      <section>
        <h2 className="label">Field guide</h2>
        {fish.real && (
          <a href={`https://github.com/${REPO}/tree/main/${fish.anchor}`} target="_blank" rel="noreferrer" title="Open in the fish-images library">
            <RefImg id={fish.anchor} alt={fish.common} className="w-full max-h-60 min-h-24 object-contain rounded-lg bg-slate-800/50" />
          </a>
        )}
        <div className="mt-2 text-[17px] font-semibold text-white leading-tight">{fish.common}</div>
        <div className="text-xs italic text-cyan-200/75">{fish.latin}</div>
        <div className="flex flex-wrap gap-1 mt-2 text-[10px]">
          <span className="px-1.5 py-px rounded bg-white/[0.06] text-slate-300">{H.glyph} {H.name}</span>
          <span className="px-1.5 py-px rounded bg-white/[0.06] text-slate-300">{LINEAGES[fish.lineage].name}</span>
          <span className="px-1.5 py-px rounded bg-white/[0.06] text-slate-300">{NICHE_INFO[fish.niche].name}</span>
          {strat && <span className="px-1.5 py-px rounded bg-white/[0.06] text-slate-300">{strat.name}</span>}
        </div>
        <p className="text-[12px] text-slate-300 leading-relaxed mt-2">{fish.description}</p>
        <p className="text-[11px] text-slate-500 italic mt-1">{fish.epithetWhy}</p>
        {fish.parents.length > 0 && (
          <p className="text-[11px] text-slate-400 mt-1">
            Parentage: {fish.parents.map((p) => `${p.name} (${Math.round(p.share * 100)}%)`).join(' × ')}
          </p>
        )}
        {fish.motifs.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {fish.motifs.map((m) => <span key={m} className="text-[10px] px-1.5 py-px rounded-full border border-cyan-300/25 text-cyan-100/80">{m}</span>)}
          </div>
        )}
      </section>
      <section>
        <h2 className="label">Morphometrics</h2>
        <div className="rounded-lg overflow-hidden border border-white/[0.06]">
          <Profile sp={sp} />
        </div>
        <div className="flex justify-center mt-1">
          <Thumb sp={sp} w={220} h={96} />
        </div>
      </section>
      {fish.genome.length > 0 && (
        <section>
          <h2 className="label">Genome</h2>
          <div className="space-y-1.5">
            {fish.genome.map((g) => (
              <div key={g.k} className="flex items-center gap-2 text-[10.5px]">
                <span className="w-24 text-slate-400">{g.k}</span>
                <span className="text-slate-600 w-10 text-right">{g.lo}</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-400" style={{ width: `${Math.round(Math.min(1, Math.max(0, g.v)) * 100)}%` }} />
                </div>
                <span className="text-slate-600 w-10">{g.hi}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {fish.notes.length > 0 && (
        <section>
          <h2 className="label">Adaptations</h2>
          <div className="space-y-2">
            {fish.notes.map((n, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[14px] leading-none mt-0.5">{n.icon}</span>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-slate-100">{n.title}</div>
                  <div className="text-[11.5px] text-slate-400 leading-snug">{n.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="label">Ecosystem census · {H.name}</h2>
          <button onClick={onRecensus} className="text-[10.5px] text-cyan-200/80 hover:text-cyan-100">↻ New census</button>
        </div>
        <div className="space-y-1">
          {census.map((f) => (
            <button key={f.key} onClick={() => onPick(f)} className={`w-full flex items-center gap-2 rounded-lg px-1.5 py-1 text-left border transition ${f.key === fish.key ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-transparent hover:bg-white/[0.04]'}`}>
              <Thumb sp={f.species} w={64} h={34} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-slate-100 truncate">{f.common}</span>
                <span className="block text-[10px] text-slate-500 truncate">{NICHE_INFO[f.niche].name} · {f.real ? 'known' : `${Math.round(f.novelty * 100)}% novel`}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
