import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CaudalSpec, FinMark, FinOcellus, FinPattern, FinShape, MedianFin, PairedFin } from './types';
import { clamp, curve, DEG, lerp, smooth } from './math';
import { finShell, mirrorZ, tubeAlong, type ShellSample } from './geom';
import { patchMaterial, type FinLook, type Joint } from './shader';
import type { Ctx } from './ctx';

// ── ichthyological fin outlines (normalised height along the base) ─────────
const SHAPES: Record<FinShape, [number, number][]> = {
  tri: [[0, 0.24], [0.16, 1], [0.52, 0.62], [0.86, 0.26], [1, 0.14]],
  falcate: [[0, 0.22], [0.11, 1], [0.28, 0.72], [0.56, 0.28], [0.86, 0.13], [1, 0.1]],
  round: [[0, 0.22], [0.22, 0.84], [0.56, 1], [0.85, 0.8], [1, 0.28]],
  even: [[0, 0.26], [0.07, 0.9], [0.5, 1], [0.93, 0.9], [1, 0.34]],
  spiny: [[0, 0.34], [0.15, 0.94], [0.38, 1], [0.7, 0.76], [0.92, 0.48], [1, 0.28]],
  sail: [[0, 0.35], [0.12, 1], [0.44, 0.96], [0.78, 0.56], [1, 0.14]],
  adipose: [[0, 0.08], [0.34, 0.78], [0.68, 1], [0.9, 0.78], [1, 0.2]],
  shark: [[0, 0.08], [0.14, 0.64], [0.28, 1], [0.5, 0.66], [0.74, 0.26], [0.88, 0.12], [1, 0.16]],
  lobe: [[0, 0.26], [0.26, 0.88], [0.56, 1], [0.82, 0.82], [1, 0.25]],
  flag: [[0, 0.3], [0.09, 1], [0.22, 0.76], [0.5, 0.36], [1, 0.2]],
  pennant: [[0, 0.3], [0.09, 0.8], [0.3, 0.94], [0.62, 1], [0.86, 0.9], [1, 0.62]],
  veil: [[0, 0.38], [0.28, 0.94], [0.68, 1.06], [0.92, 1.02], [1, 0.85]],
  fan: [[0, 0.42], [0.28, 0.95], [0.64, 1], [0.9, 0.82], [1, 0.55]],
  rect: [[0, 0.55], [0.12, 0.92], [0.5, 1], [0.9, 0.92], [1, 0.6]],
  low: [[0, 0.2], [0.1, 0.96], [0.9, 0.98], [1, 0.3]],
  leaf: [[0, 0.14], [0.35, 0.88], [0.6, 1], [0.88, 0.65], [1, 0.14]],
  squami: [[0, 0.22], [0.14, 0.6], [0.38, 0.8], [0.68, 0.98], [0.84, 1], [0.95, 0.78], [1, 0.26]],
  marlin: [[0, 0.28], [0.085, 1], [0.18, 0.46], [0.34, 0.19], [0.65, 0.11], [1, 0.06]],
  // filamentous feeler: a few fused rays drawn out into a thread (gourami & angelfish pelvics, oarfish oars)
  thread: [[0, 0.7], [0.5, 1], [1, 0.7]],
};
const shapeFns: Partial<Record<FinShape, (u: number) => number>> = {};
export const shapeH = (s: FinShape, u: number) => (shapeFns[s] ??= curve(SHAPES[s] ?? SHAPES.tri))(u);
const PATTERN: Record<FinPattern, number> = { none: 0, spots: 1, leopard: 2, bands: 3, reticulate: 4, rayspots: 5 };
const Z = new THREE.Vector3(0, 0, 1);

interface Look {
  color?: string; tip?: string; mid?: string; alpha?: number; rays?: number; incise?: number; edge?: string;
  spots?: number; spotCol?: string; pattern?: FinPattern; fray?: number; solid?: boolean; root?: number;
  edgeWidth?: number; marks?: FinMark[];
  ocellus?: FinOcellus;
}

/** Fin material: membrane colours/rays/patterns + the body skin texture for the fleshy root blend */
export function finMaterial(ctx: Ctx, o: Look, joint?: Joint, withSkin = true) {
  const fs = ctx.sp.fins;
  const c = (x: string) => new THREE.Color(x);
  const solid = o.solid ?? false;
  const base = c(o.color ?? fs.color);
  const tip = c(o.tip ?? o.color ?? fs.tip ?? fs.color);
  const oc = o.ocellus;
  const look: FinLook = {
    rays: o.rays ?? 14, incise: o.incise ?? 0, membrane: solid ? 1 : (o.alpha ?? fs.alpha),
    base, mid: o.mid ? c(o.mid) : base.clone().lerp(tip, 0.5), tip,
    edge: c(o.edge ?? '#000'), edgeW: o.edge ? (o.edgeWidth ?? 0.065) : 0,
    spots: o.spots ?? 0, spotCol: c(o.spotCol ?? '#111'),
    pattern: PATTERN[o.pattern ?? (o.spots ? 'spots' : 'none')], fray: o.fray ?? 0,
    root: withSkin ? (o.root ?? 0.16) : 0,
    marks: (o.marks ?? []).slice(0, 3).map((m) => ({
      range: new THREE.Vector4(m.v0, m.v1, m.u0 ?? 0, m.u1 ?? 1), color: c(m.c),
    })),
    ocel: oc ? new THREE.Vector4(oc.u, oc.v, oc.r, 1) : undefined,
    ocelCol: oc ? c(oc.col ?? '#0c0d10') : undefined,
    ocelRing: oc ? c(oc.ring ?? '#f8f6ec') : undefined,
  };
  const m = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', map: withSkin ? ctx.skinTex : null,
    roughness: solid ? 0.5 : 0.46, transparent: !solid, depthWrite: solid,
    clearcoat: solid ? 0.35 : 0.28, clearcoatRoughness: 0.32,
    side: withSkin ? THREE.FrontSide : THREE.DoubleSide,
  });
  // the fleshy fin root carries the body's own integument (scales, pigment, relief)
  patchMaterial(m, ctx.u, look, { joint, skin: withSkin ? ctx.skinLook : undefined });
  ctx.track(m);
  return m;
}

export function buildFins(ctx: Ctx) {
  const { sp, model, L, addMesh } = ctx;
  const fs = sp.fins;
  const labriform = sp.swim.mode === 'labriform';
  const finSpots = sp.color.layers?.some((l) => l.k === 'spots' && (l.h1 ?? 1) > 0.3 && l.n > 40) ? 3 : 0;
  const isSpiny = (f: MedianFin) => f.shape === 'spiny' || (f.incise ?? 0) >= 0.18;
  const hasSpinyDorsal = (fs.dorsal ?? []).some(isSpiny);
  const spineMat = (color: string | undefined, joint: Joint) => {
    const m = patchMaterial(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color ?? fs.color).lerp(new THREE.Color('#efe7d6'), 0.35), roughness: 0.34, clearcoat: 0.6 }), ctx.u, undefined, { joint });
    ctx.track(m);
    return m;
  };

  // ── 1. median fins: fillet welded to the dorsal/ventral skin, rays, pleats, 3D spines ──
  let finIdx = 0;
  const median = (f: MedianFin, side: 1 | -1, leadSpines = 0) => {
    const idx = finIdx++;
    const squami = f.shape === 'squami';
    const sw = (f.sweep ?? (f.shape === 'shark' ? 30 : f.shape === 'falcate' || f.shape === 'marlin' ? 32 : squami ? 18 : f.shape === 'spiny' ? 16 : 12)) * DEG;
    const bendBack = f.curve ?? (f.shape === 'falcate' || f.shape === 'marlin' || f.shape === 'veil' || f.shape === 'flag' || f.shape === 'pennant' ? 0.32 : f.shape === 'shark' || squami ? 0.2 : 0.14);
    const cart = f.shape === 'shark' || f.shape === 'adipose' || ((f.foil ?? 0) >= 1 && f.rays === 0);
    const lobe = f.shape === 'lobe';
    const spiny = isSpiny(f);
    const sheath = f.sheath ?? (cart ? 0.42 : lobe ? 0.38 : squami ? 0.56 : 0.18);
    const lenS = Math.max(0.004, f.s1 - f.s0);
    const rays = cart ? 0 : Math.round(f.spines ?? f.rays ?? clamp(Math.round(lenS * (spiny ? 50 : 62)), 3, 32));
    const mid = (uu: number, vv: number): ShellSample => {
      const s = lerp(f.s0, f.s1, uu);
      const B = model.local(s, side > 0 ? model.top(s) : -model.bot(s), 0);
      const fr = model.frame(s);
      const a = sw * (0.85 + 0.35 * uu);
      const dir = fr.N.clone().multiplyScalar(side * Math.cos(a)).addScaledVector(fr.T, Math.sin(a));
      const H = f.h * shapeH(f.shape, uu) * L;
      // squamipinniform soft rear lobe bulges gracefully backward to frame the caudal peduncle
      const rearCurtain = squami ? 0.34 * Math.pow(smooth(0.54, 1, uu), 1.35) * Math.sin(Math.PI * Math.pow(clamp(vv), 0.72)) * H : 0;
      return { p: B.addScaledVector(dir, vv * H).addScaledVector(fr.T, bendBack * vv * vv * H + rearCurtain), n: Z };
    };
    const rootPhiAt = (uu: number, tSL: number) => {
      const s = lerp(f.s0, f.s1, uu);
      return model.phiAtZ(s, Math.min(tSL, model.hw(s) * 0.92), side > 0);
    };
    const tRoot = (uu: number) => {
      const s = lerp(f.s0, f.s1, uu);
      const k = cart ? 0.58 : lobe ? 0.48 : lerp(0.28, 0.56, smooth(0.15, 0.62, sheath));
      return Math.min(model.hw(s) * k, f.h * (cart ? 0.22 : 0.34)) * L * Math.pow(Math.sin(Math.PI * clamp(uu)), cart ? 0.35 : 0.45);
    };
    const vFillet = lobe ? 0.62 : lerp(0.3, 0.56, smooth(0.15, 0.62, sheath));
    const thick = (uu: number, vv: number) => {
      const closeU = Math.sqrt(smooth(0, 0.035, uu) * smooth(1, 0.965, uu));
      const closeV = 1 - Math.pow(vv, 6);
      if (cart) {
        const chord = Math.sqrt(clamp(uu + 0.015)) * Math.pow(clamp(1 - uu * 0.92), 0.9);
        const span = Math.pow(clamp(1 - vv), 0.75) * (1 + 0.6 * Math.exp(-vv * 8));
        const foil = Math.min(model.hw(lerp(f.s0, f.s1, uu)) * 0.5, f.h * 0.16) * L * (f.foil ?? 1) * chord * span * 0.6;
        return Math.max(tRoot(uu) * Math.pow(1 - smooth(0, 0.34, vv), 2), foil) * closeV;
      }
      return (tRoot(uu) * Math.pow(1 - smooth(0, vFillet, vv), 1.85) + 0.0012 * L * closeU) * closeV;
    };
    const spacing = (lenS * L) / Math.max(1, rays);
    const g = finShell({
      nu: clamp((rays || 9) * 4, 20, 140), nv: 18, rays, vPow: 1.4, mid, thick,
      ridge: Math.min(0.3 * spacing, 0.006 * L) * (spiny ? 1.2 : 1),
      pleat: Math.min((spiny ? 0.3 : 0.2) * spacing, 0.012 * L),
      root: (uu, sgn) => {
        const t = thick(uu, 0) / L;
        if (t < 1e-5) return null;
        const s = lerp(f.s0, f.s1, uu);
        const ph = rootPhiAt(uu, t);
        const phi = sgn > 0 ? ph : 2 * Math.PI - ph;
        return { p: model.surface(s, phi), n: model.normalAt(s, phi) };
      },
      uv: (uu, vv, sgn, q) => {
        // exact world-space longitudinal station & bilateral flank angle → zero discontinuity on body bars & stripes
        const sW = model.bent ? lerp(f.s0, f.s1, uu) : clamp(0.5 - q.x / L, model.sMin, 0.999);
        const t0 = thick(uu, 0) / L;
        const ph0 = t0 > 1e-5 ? rootPhiAt(uu, t0) : (side > 0 ? 0.02 : Math.PI - 0.02);
        const phEdge = side > 0 ? 0.006 : Math.PI - 0.006;
        const ph = lerp(ph0, phEdge, smooth(0, Math.max(0.2, sheath), vv));
        const phi = sgn > 0 ? ph : 2 * Math.PI - ph;
        return [model.uOf(sW), phi / (2 * Math.PI)];
      },
      weight: (_u, vv) => Math.pow(clamp(vv), lerp(1.25, 1.65, smooth(0.2, 0.65, sheath))),
      kind: 1, side: 0,
    });
    const joint: Joint = { kind: 1, amp: f.h * (spiny ? 0.07 : cart ? 0.03 : squami ? 0.11 : 0.16), freq: 5.2, phase: idx * 1.37 };
    addMesh(g, finMaterial(ctx, { ...f, rays, solid: cart, spots: f.spots ?? finSpots, root: sheath }, joint), cart ? 2 : 4, true);

    const nSp = spiny ? rays : Math.min(leadSpines, rays);
    if (nSp > 0) {
      const parts: THREE.BufferGeometry[] = [];
      const r0 = clamp(0.32 * spacing, 0.0012 * L, 0.009 * L);
      const K = 12;
      for (let i = 0; i < nSp; i++) {
        const uI = (i + 0.5) / rays;
        const p1 = mid(uI, 1).p, p9 = mid(uI, 0.9).p;
        const pts = Array.from({ length: K + 1 }, (_, k) => {
          const vk = (k / K) * 1.1;
          return vk <= 1 ? mid(uI, vk).p : p1.clone().add(p1.clone().sub(p9).multiplyScalar((vk - 1) / 0.1));
        });
        const rr = r0 * (1.15 - 0.3 * (i / Math.max(1, nSp)));
        const sUV = model.uOf(lerp(f.s0, f.s1, uI));
        parts.push(tubeAlong(pts, (k) => rr * Math.pow(1 - k / K, 1.25) + 0.00025 * L, 7,
          (k) => ({ fin: [Math.pow(clamp((k / K) * 1.1), 1.25), uI, (k / K) * 1.1, 1], uv: [sUV, side > 0 ? 0.004 : 0.5] })));
      }
      addMesh(mergeGeometries(parts), spineMat(f.color, joint), 3, true);
      parts.forEach((p) => p.dispose());
    }
  };
  for (const f of fs.dorsal ?? []) median(f, 1);
  (fs.anal ?? []).forEach((f, i) => median(f, -1, i === 0 && hasSpinyDorsal && !isSpiny(f) ? 3 : 0));
  if (fs.finlets) {
    const fl = fs.finlets;
    for (let i = 0; i < fl.n; i++) {
      const s = lerp(fl.s0, fl.s1, i / Math.max(1, fl.n - 1));
      const w = ((fl.s1 - fl.s0) / fl.n) * 0.78;
      for (const sd of [1, -1] as const) median({ s0: s, s1: s + w, h: fl.h, shape: 'falcate', sweep: 38, rays: 3, color: fl.color, alpha: 0.96 }, sd);
    }
  }

  // ── 2. caudal fin: root continues the peduncle skin exactly, procurrent rays, flexible rays ──
  const caudal = (cs: CaudalSpec) => {
    if (cs.span <= 0.01 || cs.type === 'none') return;
    const len = cs.len ?? cs.span * 0.6;
    const up = cs.up ?? (cs.type === 'hetero' ? 0.68 : 0.5);
    const D: Record<string, { fork: number; p: number; lu: number; ld: number; tuft?: number }> = {
      forked: { fork: 0.38, p: 1.2, lu: 1, ld: 1 },
      lunate: { fork: 0.16, p: 0.82, lu: 1, ld: 1 },
      emarginate: { fork: 0.82, p: 1.65, lu: 1, ld: 1 },
      truncate: { fork: 0.96, p: 2.1, lu: 1, ld: 1 },
      rounded: { fork: 1, p: 2, lu: 0.52, ld: 0.52 },
      pointed: { fork: 1, p: 1, lu: 0.08, ld: 0.08 },
      hetero: { fork: 0.3, p: 1.12, lu: 1, ld: 0.48 },
      diphy: { fork: 0.8, p: 2, lu: 0.45, ld: 0.45, tuft: 0.45 },
      halfmoon: { fork: 1, p: 2.8, lu: 0.86, ld: 0.86 },
      lyre: { fork: 0.3, p: 2.6, lu: 1, ld: 1 },
      delta: { fork: 1, p: 1, lu: 1, ld: 1 },
    };
    const d = D[cs.type] ?? D.forked;
    const lu = cs.lenUp ?? d.lu * len, ld = cs.lenDn ?? d.ld * len, lc = (cs.fork ?? d.fork) * len;
    const cart = sp.skin.kind === 'placoid' || cs.type === 'hetero';
    const rays = cart ? 0 : (cs.rays ?? 22);
    const flowing = cs.type === 'delta' || cs.type === 'halfmoon' || (cs.fray ?? 0) > 0.3;
    const sbAt = (uu: number) => 1 - (cart ? 0 : 0.035) * Math.pow(Math.max(0, 1 - Math.min(uu, 1 - uu) / 0.14), 2);
    const NU = clamp((rays || 12) * 4, 48, 144), NV = 18;
    const cache = Array.from({ length: NU + 1 }, (_, i) => {
      const uu = i / NU, sb = sbAt(uu);
      const yb = lerp(model.top(sb), -model.bot(sb), uu) * 0.985;
      const ph = model.phiAtY(sb, yb);
      const [y, z] = model.sectionYZ(sb, ph);
      return { sb, yb, y, z: Math.abs(z), ph };
    });
    const rc = (uu: number) => cache[Math.round(clamp(uu) * NU)];
    const sample = (uu: number, vv: number) => {
      const r = rc(uu);
      let yE = lerp(cs.span * up, -cs.span * (1 - up), uu) + sp.body.pedY;
      let xE: number;
      if (cs.type === 'rounded' || cs.type === 'halfmoon') {
        const th = (uu - 0.5) * Math.PI;
        const rLobe = cs.type === 'halfmoon' ? len : len * 1.15;
        xE = rLobe * Math.pow(Math.max(0, Math.cos(th * 0.94)), cs.type === 'halfmoon' ? 0.32 : 0.55);
        yE = lerp(cs.span * up, -cs.span * (1 - up), 0.5 - 0.5 * Math.cos(uu * Math.PI)) + sp.body.pedY;
      } else if (cs.type === 'delta') {
        xE = len * (0.86 + 0.14 * Math.cos((uu - 0.5) * Math.PI * 0.9));
      } else if (uu < up) {
        const t = 1 - uu / up;
        xE = lc + (lu - lc) * Math.pow(t, d.p);
        if (cs.type === 'hetero') xE -= (lu - lc) * 0.17 * Math.exp(-Math.pow((t - 0.82) / 0.065, 2));
      } else {
        const t = (uu - up) / Math.max(1e-4, 1 - up);
        xE = lc + (ld - lc) * Math.pow(t, d.p);
      }
      if (d.tuft) xE += d.tuft * len * Math.exp(-Math.pow((uu - up) / 0.08, 2));
      const B = model.local(r.sb, r.yb, 0);
      const E = model.local(1 + xE, yE, 0);
      return new THREE.Vector3(lerp(B.x, E.x, Math.pow(vv, 1.12)), lerp(B.y, E.y, Math.pow(vv, 0.82)), 0);
    };
    const pedW = Math.max(0.006, model.hw(0.96)) * L;
    const thick = (uu: number, vv: number) => {
      const closeU = Math.sqrt(smooth(0, 0.03, uu) * smooth(1, 0.97, uu));
      const closeV = 1 - Math.pow(vv, 6);
      const tr = rc(uu).z * L;
      if (cart) {
        const axisBias = cs.type === 'hetero' ? 0.35 + 0.85 * Math.exp(-Math.pow((uu - 0.12) / 0.22, 2)) : 0.7;
        return Math.max(tr * Math.pow(1 - smooth(0, 0.3, vv), 2), pedW * axisBias * (1 - 0.75 * Math.pow(vv, 0.65)) * closeU) * closeV;
      }
      const core = cs.type === 'lunate' || (cs.foil ?? 0) > 0 ? pedW * 0.5 * (1 - smooth(0, 0.45, vv)) * Math.exp(-Math.pow((uu - 0.5) / 0.3, 2)) : 0;
      return (tr * Math.pow(1 - smooth(0, 0.22, vv), 2.2) + core + 0.0012 * L * closeU) * closeV;
    };
    const spacing = (cs.span * L) / Math.max(1, rays);
    const g = finShell({
      nu: NU, nv: NV, rays, vPow: 1.35,
      mid: (uu, vv) => ({ p: sample(uu, vv), n: Z }),
      thick, ridge: Math.min(0.28 * spacing, 0.005 * L), pleat: Math.min(0.2 * spacing, 0.01 * L) * (flowing ? 1.4 : 1),
      root: (uu, sgn) => {
        const r = rc(uu);
        return { p: model.local(r.sb, r.y, sgn * r.z), n: model.normalAt(r.sb, sgn > 0 ? r.ph : 2 * Math.PI - r.ph) };
      },
      uv: (uu, _vv, sgn) => {
        const r = rc(uu);
        const phi = sgn > 0 ? r.ph : 2 * Math.PI - r.ph;
        return [model.uOf(r.sb), phi / (2 * Math.PI)];
      },
      weight: (_u, vv) => Math.pow(clamp(vv), 1.2),
      kind: 3, side: 0,
    });
    const joint: Joint = { kind: 3, pivot: model.local(1, sp.body.pedY, 0), amp: cs.span * (cart ? 0.02 : flowing ? 0.09 : 0.05) };
    const mat = finMaterial(ctx, {
      color: cs.color, tip: cs.tip, mid: cs.mid, alpha: cart ? 1 : (cs.alpha ?? 0.92), rays, solid: cart, edge: cs.edge,
      spots: cs.spots ?? finSpots, spotCol: cs.spotCol, pattern: cs.pattern, fray: cs.fray, root: cart ? 0.3 : 0.14,
    }, joint);
    addMesh(g, mat, cart ? 2 : 4, true);
  };
  if (!sp.body.bend) caudal(fs.caudal);

  // ── 3. paired fins: ball-joint at the fin base (rowing + feathering), exact mirror symmetry ──
  const paired = (f: PairedFin, which: 'pec' | 'pel') => {
    // the pectoral fin hangs from the shoulder girdle, which forms the hind wall of the gill opening
    const fS = which === 'pec' ? model.pecStation : f.s;
    const at = model.attach(fS, f.y, 1);
    const fr = model.frame(fS);
    const el = f.elev * DEG, sp_ = f.splay * DEG;
    const swExtra = ((f.sweep ?? (f.shape === 'shark' ? 24 : f.shape === 'falcate' ? 16 : 6)) * DEG) * Math.sin(sp_);
    const dir = fr.T.clone()
      .multiplyScalar(Math.cos(sp_) * Math.cos(el) + Math.sin(swExtra) * 0.48)
      .addScaledVector(fr.N, Math.sin(el))
      .addScaledVector(Z, Math.sin(sp_) * Math.cos(el * 0.42))
      .normalize();
    const leadRef = fr.N.clone().multiplyScalar(Math.cos(sp_)).addScaledVector(fr.T, -Math.sin(sp_)).normalize();
    const bChord = leadRef.clone().negate().addScaledVector(dir, leadRef.dot(dir)).normalize();
    const rawN = Z.clone().multiplyScalar(Math.cos(sp_)).addScaledVector(fr.N, Math.sin(sp_));
    const finN = rawN.addScaledVector(dir, -rawN.dot(dir)).addScaledVector(bChord, -rawN.dot(bChord));
    if (finN.lengthSq() < 1e-6) finN.crossVectors(dir, bChord);
    finN.normalize();
    if (finN.z < -0.05 && sp_ < 65 * DEG) finN.negate();
    const spread = (f.shape === 'fan' ? 52 : f.shape === 'veil' ? 32 : f.shape === 'round' ? 24 : f.shape === 'thread' ? 0.7 : 15) * DEG;
    const baseOrigin = at.p.clone().addScaledVector(at.n, -0.004 * L);
    const cart = f.shape === 'shark' || ((f.foil ?? 0) > 0 && (f.rays ?? 12) === 0);
    const lobe = f.shape === 'lobe';
    const sweepBack = f.shape === 'shark' || f.shape === 'falcate' ? 0.18 : 0.08;
    const rays = cart ? 0 : (f.rays ?? 12);
    const mid = (uu: number, vv: number): ShellSample => {
      const vIn = vv * 1.07 - 0.07;
      const a = (uu - 0.42) * spread;
      const H = f.len * shapeH(f.shape, uu) * L;
      const ray = dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(bChord, Math.sin(a));
      const p = baseOrigin.clone()
        .addScaledVector(bChord, (uu - 0.35) * f.base * L)
        .addScaledVector(ray, vIn * H)
        .addScaledVector(bChord, sweepBack * vv * vv * H)
        .addScaledVector(finN, Math.sin(vv * Math.PI * 0.65) * H * 0.045);
      return { p, n: finN };
    };
    const tRoot = Math.max(0.003, Math.min(f.base * 0.3, f.len * 0.09)) * L * (cart || lobe ? (f.foil ?? 1) : 0.6);
    const thick = (uu: number, vv: number) => {
      const closeU = Math.sqrt(smooth(0, 0.04, uu) * smooth(1, 0.96, uu));
      const closeV = 1 - Math.pow(vv, 6);
      if (cart) {
        const chord = Math.sqrt(clamp(uu + 0.015)) * Math.pow(clamp(1 - uu * 0.92), 0.9);
        return tRoot * chord * Math.pow(clamp(1 - vv), 0.72) * (1 + 0.65 * Math.exp(-vv * 8)) * closeV;
      }
      return (tRoot * Math.pow(Math.sin(Math.PI * clamp(uu)), 0.5) * Math.pow(1 - smooth(0, lobe ? 0.55 : 0.28, vv), 2) + 0.0011 * L * closeU) * closeV;
    };
    const spacing = (f.base * L + f.len * L * spread) / Math.max(1, rays);
    const uvRoot: [number, number] = [model.uOf(fS), at.phi / (2 * Math.PI)];
    const weight = (_u: number, vv: number) => smooth(0.03, 0.24, vv);
    const rightG = finShell({
      nu: clamp((rays || 10) * 4, 24, 80), nv: 14, rays, vPow: 1.3, mid, thick,
      ridge: Math.min(0.28 * spacing, 0.004 * L), pleat: Math.min(0.2 * spacing, 0.008 * L),
      uv: () => uvRoot, weight, kind: 2, side: 1,
    });
    const isPec = which === 'pec';
    const joint: Joint = {
      kind: 2, pivot: baseOrigin.clone(), axis: bChord.clone(), axis2: dir.clone(),
      amp: (isPec ? (labriform ? 0.62 : cart ? 0.05 : 0.26) : (cart ? 0.03 : 0.13)) * (f.row ?? 1),
      amp2: isPec ? (labriform ? 0.55 : cart ? 0.04 : 0.32) : 0.14,
      freq: labriform ? 6.4 : 4.3, phase: isPec ? 0 : 1.7,
    };
    const mat = finMaterial(ctx, { ...f, rays, alpha: cart ? 1 : f.alpha, solid: cart, root: cart ? 0.35 : lobe ? 0.4 : 0.14 }, joint);
    addMesh(rightG, mat, cart ? 2 : 4, true);
    addMesh(mirrorZ(rightG, -1), mat, cart ? 2 : 4, true);
    if (!cart && (f.spine ?? (which === 'pel' && hasSpinyDorsal))) {
      const pts = Array.from({ length: 11 }, (_, k) => mid(0.03, (k / 10) * 1.02).p);
      const r0 = clamp(0.25 * spacing, 0.001 * L, 0.006 * L);
      const sg = tubeAlong(pts, (k) => r0 * Math.pow(1 - k / 10, 1.2) + 0.0002 * L, 7,
        (k) => ({ fin: [weight(0, k / 10), 0.03, k / 10, 2], side: 1, uv: uvRoot }));
      const sm = spineMat(f.color, joint);
      addMesh(sg, sm, 3, true);
      addMesh(mirrorZ(sg, -1), sm, 3, true);
    }
  };
  if (fs.pec) paired(fs.pec, 'pec');
  if (fs.pel) paired(fs.pel, 'pel');

  // ── 4. gonopodium (male livebearers): modified anal fin rod with a hooked tip ──
  if (fs.gono) {
    const go = fs.gono;
    const fr = model.frame(go.s);
    const base = model.local(go.s, -model.bot(go.s) * 0.92, 0);
    const K = 16;
    const pts = Array.from({ length: K + 1 }, (_, k) => {
      const t = k / K;
      return base.clone().addScaledVector(fr.T, t * go.len * L).addScaledVector(fr.N, (-0.22 * t + 0.16 * Math.pow(t, 5)) * go.len * L);
    });
    const r0 = 0.0085 * L;
    const g = tubeAlong(pts, (k) => r0 * (k === 0 ? 1.6 : 1) * (1 - 0.72 * (k / K)) * (k === K ? 0.25 : 1), 8,
      (k) => ({ fin: [Math.pow(k / K, 1.3), 0.5, k / K, 1], uv: [model.uOf(go.s), 0.5] }));
    const joint: Joint = { kind: 1, amp: 0.02, freq: 3.1, phase: 0.6 };
    const gm = patchMaterial(new THREE.MeshPhysicalMaterial({ color: go.color ?? fs.color, roughness: 0.4, clearcoat: 0.5 }), ctx.u, undefined, { joint });
    ctx.track(gm);
    addMesh(g, gm, 3, true);
  }
}
