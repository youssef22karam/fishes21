import * as THREE from 'three';
import { lerp, rng } from './math';
import { Batch, grid, mirrorZ, orient, type Q4 } from './geom';
import { patchMaterial } from './shader';
import { finMaterial } from './fins';
import type { Ctx } from './ctx';

/** Sawfish rostral denticles, lamprey disc, barbels / lures / cirri, spikes & spines, seadragon fronds.
 *  (Bills, swords, paddles, saws and forceps/pipette snouts are lofted directly as part of BodyModel.) */
export function buildExtras(ctx: Ctx) {
  const { sp, model, L, u, seed, addMesh, seamJawUpper } = ctx;
  const disposables = { push: (d: { dispose: () => void }) => ctx.track(d) };
  const m = sp.mouth;
  const rc = model.rictus;
  const R = rng(seed);
  // ── SAWFISH ROSTRAL TEETH (socketed along the body-lofted saw margin) ──────
  if (sp.rostrum?.kind === 'saw') {
    const ro = sp.rostrum;
    const batch = new Batch();
    const cone = new THREE.ConeGeometry(0.28, 1, 6); cone.translate(0, 0.5, 0);
    const n = 24;
    for (let i = 0; i < n; i++) {
      const s = lerp(-ro.len * 0.94, -ro.len * 0.06, i / (n - 1));
      const w = model.hw(s);
      for (const sd of [1, -1] as const) {
        const p = model.local(s, 0, sd * w * 0.92);
        batch.add(cone, orient(p, new THREE.Vector3(0.18, 0, sd).normalize(), 0.0065 * L, 0.028 * L, 0.004 * L));
      }
    }
    addMesh(batch.build(), patchMaterial(new THREE.MeshPhysicalMaterial({ color: '#f1ead9', roughness: 0.28, clearcoat: 0.45 }), u), 2);
  }

  // ── MOBULID CEPHALIC FINS ─────────────────────────────────────────────────
  // Not horns and not tentacles: a pair of flat, flexible blades flanking the terminal mouth (the free front ends of
  // the pectoral fins). Each is rolled lengthwise into a scoop – gentle at the root, curling tightly inward at the
  // tip – so the two form a funnel in front of the mouth. Black on the outer face, pale grey-white on the oral face.
  if (sp.plan === 'ray' && /manta|mobula/.test(sp.id)) {
    const headW = sp.body.disc?.head ?? 0.08;
    const s0 = 0.014, len = 0.172 * L, wid = 0.064 * L, thick = 0.0045 * L;
    const fr = model.frame(s0);
    const fwd = fr.T.clone().negate(), up = fr.N.clone(), out = new THREE.Vector3(0, 0, 1);
    const root = model.local(s0, -model.bot(s0) * 0.15, headW * 0.9);
    const lobe = (sgn: 1 | -1) => grid(12, 30, (b, a) => {
      const C = root.clone()
        .addScaledVector(fwd, len * (a - 0.08 * a * a))
        .addScaledVector(up, -len * 0.26 * Math.pow(a, 1.6))
        .addScaledVector(out, len * (0.1 * a - 0.34 * Math.pow(a, 2.2)));
      const W = wid * (0.58 + 0.42 * Math.sin(Math.PI * 0.5 * Math.min(1, a / 0.62))) * Math.sqrt(Math.max(0.03, 1 - Math.pow(a, 5)));
      const th = 0.9 + 2.5 * Math.pow(a, 1.35), tw = 0.38 * a; // roll of the blade (scoop → curl) and its twist
      const e1 = up.clone().multiplyScalar(Math.cos(tw)).addScaledVector(out, -Math.sin(tw)); // blade axis
      const e2 = out.clone().multiplyScalar(-Math.cos(tw)).addScaledVector(up, -Math.sin(tw)); // toward the roll centre
      const t = (b - 0.4) * th, rho = W / th;
      const nO = e1.clone().multiplyScalar(Math.sin(t)).addScaledVector(e2, -Math.cos(t));
      const tk = thick * Math.sqrt(Math.max(0, Math.sin(Math.PI * b))) * (1 - Math.pow(a, 4)) * 0.5;
      const p = C.addScaledVector(e1, rho * Math.sin(t)).addScaledVector(e2, rho * (1 - Math.cos(t))).addScaledVector(nO, sgn * tk);
      return { p, flap: a * 0.9, side: 1 };
    });
    const outerMat = patchMaterial(new THREE.MeshPhysicalMaterial({ color: sp.color.top, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, side: THREE.DoubleSide }), u);
    const innerMat = patchMaterial(new THREE.MeshPhysicalMaterial({ color: '#d3d6d7', roughness: 0.55, clearcoat: 0.25, side: THREE.DoubleSide }), u);
    disposables.push(outerMat);
    disposables.push(innerMat);
    const gOut = lobe(1), gIn = lobe(-1);
    addMesh(gOut, outerMat, 2, true);
    addMesh(mirrorZ(gOut, -1), outerMat, 2, true);
    addMesh(gIn, innerMat, 2, true);
    addMesh(mirrorZ(gIn, -1), innerMat, 2, true);
  }

  // ── lamprey oral disc ─────────────────────────────────────────────────────
  if (m.kind === 'disc') {
    const fr0 = model.frame(0.02);
    const fwd = fr0.T.clone().negate();
    const dn = fr0.N.clone().negate();
    const face = fwd.clone().multiplyScalar(0.55).addScaledVector(dn, 0.85).normalize();
    const ctr = model.local(0.035, -model.bot(0.035) * 0.55, 0).addScaledVector(face, 0.01 * L);
    const r = model.bot(0.04) * 1.15 * L;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), face);
    const b1 = new Batch(), b2 = new Batch(), b3 = new Batch();
    b1.add(new THREE.TorusGeometry(r, r * 0.22, 10, 40), new THREE.Matrix4().compose(ctr, q, new THREE.Vector3(1, 1, 1)));
    b2.add(new THREE.CircleGeometry(r, 40), new THREE.Matrix4().compose(ctr.clone().addScaledVector(face, -r * 0.1), q, new THREE.Vector3(1, 1, 1)));
    const cone = new THREE.ConeGeometry(0.3, 1, 5); cone.translate(0, 0.5, 0); cone.rotateX(Math.PI / 2);
    for (let ringI = 0; ringI < 3; ringI++)
      for (let i = 0; i < 14 + ringI * 6; i++) {
        const a = (i / (14 + ringI * 6)) * Math.PI * 2;
        const rr = r * (0.25 + ringI * 0.25);
        const p = new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0).applyQuaternion(q).add(ctr);
        b3.add(cone, new THREE.Matrix4().compose(p, q, new THREE.Vector3(r * 0.12, r * 0.12, r * 0.2)));
      }
    addMesh(b1.build(), patchMaterial(new THREE.MeshPhysicalMaterial({ color: sp.color.belly, roughness: 0.5 }), u), 2);
    addMesh(b2.build(), patchMaterial(new THREE.MeshStandardMaterial({ color: '#6a2c2c', side: THREE.DoubleSide }), u), 2);
    addMesh(b3.build(), patchMaterial(new THREE.MeshPhysicalMaterial({ color: '#f0d890', roughness: 0.3 }), u), 3);
  }

  // ── BARBELS, LURES, CIRRI ─────────────────────────────────────────────────
  const tube = (pts: THREE.Vector3[], r0: number, r1: number, jawW: number, pl: Q4) => {
    const crv = new THREE.CatmullRomCurve3(pts);
    const nS = 24, nR = 7;
    const frames = crv.computeFrenetFrames(nS, false);
    return grid(nR, nS, (uu, vv) => {
      const i = Math.round(vv * nS);
      const p = crv.getPointAt(vv);
      const a = uu * Math.PI * 2;
      const r = lerp(r0, r1, vv);
      p.addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r);
      return { p, jaw: jawW, flap: vv * 0.6, side: 0, plastic: pl };
    });
  };
  const barbelMat = patchMaterial(new THREE.MeshPhysicalMaterial({ color: sp.color.side, roughness: 0.5, clearcoat: 0.3 }), u);
  disposables.push(barbelMat);
  const bulbBatch = new Batch();
  let bulbColor = '#9ff';
  const barbelList = [...(sp.barbels ?? [])];
  if (sp.cirri) barbelList.push({ s: sp.eye.s, y: sp.eye.y + 0.25, len: 0.05, dir: [0.1, 1, 0.15], droop: -0.2, r: 0.004, pairs: true });
  for (const bb of barbelList) {
    for (const side of (bb.pairs === false ? [1] : [1, -1]) as (1 | -1)[]) {
      const at = model.attach(bb.s, bb.y, side);
      const fr = model.frame(bb.s);
      const d = fr.T.clone().multiplyScalar(-bb.dir[0]).addScaledVector(fr.N, bb.dir[1]).add(new THREE.Vector3(0, 0, side * bb.dir[2])).normalize();
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        pts.push(at.p.clone().addScaledVector(d, t * bb.len * L).addScaledVector(fr.N, -bb.droop * t * t * bb.len * L).addScaledVector(fr.T, 0.15 * t * t * bb.len * L));
      }
      if (bb.pairs === false) pts.forEach((p) => (p.z = 0));
      const yAbs = model.normY(bb.s, bb.y);
      const isLowerB = bb.s < rc.s + 0.01 && yAbs < model.mouthY(bb.s);
      const jw = isLowerB ? model.jawWeight(bb.s, 0.4) : seamJawUpper(bb.s, at.phi);
      const pl = model.plasticAt(bb.s, at.phi, isLowerB);
      addMesh(tube(pts, bb.r * L, bb.r * L * 0.25, jw, [pl[0] * 0.9, pl[1] * 0.5, pl[2] * 0.6, 0]), barbelMat, 2, true);
      if (bb.bulb) {
        bulbColor = bb.bulb;
        bulbBatch.add(new THREE.SphereGeometry(1, 16, 12), new THREE.Matrix4().compose(pts[5], new THREE.Quaternion(), new THREE.Vector3(1, 1, 1).multiplyScalar(bb.r * L * 2.6)), jw);
      }
      if (bb.pairs === false) break;
    }
  }
  if (!bulbBatch.empty) addMesh(bulbBatch.build(), patchMaterial(new THREE.MeshStandardMaterial({ color: bulbColor, emissive: bulbColor, emissiveIntensity: 1.6 }), u), 3);

  // ── SPIKES / HORNS / SCUTES / SPINES (symmetrically paired) ───────────────
  const spikeB = new Batch();
  const spikeCone = new THREE.ConeGeometry(0.35, 1, 6); spikeCone.translate(0, 0.5, 0);
  for (const k of sp.spikes ?? []) {
    for (const side of (k.mirror === false ? [1] : [1, -1]) as (1 | -1)[]) {
      const at = model.attach(k.s, k.y, side);
      if (k.mirror === false) at.p.z = 0;
      const fr = model.frame(k.s);
      const d = (k.dir[0] || k.dir[1] || k.dir[2])
        ? fr.T.clone().multiplyScalar(-k.dir[0]).addScaledVector(fr.N, k.dir[1]).add(new THREE.Vector3(0, 0, side * k.dir[2])).normalize()
        : at.n;
      const h = k.len * L, r = (k.r ?? 0.3) * h;
      spikeB.add(spikeCone, orient(at.p.clone().addScaledVector(at.n, -h * 0.1), d, r, h, r));
      if (k.mirror === false) break;
    }
  }
  if (sp.spines) {
    const pairsN = Math.ceil(sp.spines.n / 2);
    for (let i = 0; i < pairsN; i++) {
      const s = 0.08 + R() * 0.8;
      const yn = (R() * 2 - 1) * 0.94;
      const h = sp.spines.len * L * (0.65 + R() * 0.55);
      for (const side of [1, -1] as const) {
        const at = model.attach(s, yn, side);
        const fr = model.frame(s);
        const d = at.n.clone().multiplyScalar(0.55).addScaledVector(fr.T, 0.8).normalize();
        spikeB.add(spikeCone, orient(at.p, d, h * 0.16, h, h * 0.16));
      }
    }
  }
  if (!spikeB.empty) addMesh(spikeB.build(), patchMaterial(new THREE.MeshPhysicalMaterial({ color: sp.spines?.c ?? sp.color.side, roughness: 0.4, clearcoat: 0.3 }), u), 2);

  // ── FRONDS (seadragons) ───────────────────────────────────────────────────
  if (sp.fronds) {
    for (const [s, y, len] of sp.fronds.at) {
      const midline = Math.abs(y) > 0.92;
      const at = model.attach(s, y, 1);
      if (midline) at.p.z = 0;
      const out = midline ? model.frame(s).N.clone().multiplyScalar(Math.sign(y)) : at.n.clone();
      const nf = midline ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3().crossVectors(out, new THREE.Vector3(1, 0, 0)).normalize();
      const b = new THREE.Vector3().crossVectors(nf, out).normalize();
      const frondMat = finMaterial(ctx, { color: sp.fronds.c, tip: sp.fronds.c, alpha: 0.9, rays: 3 }, undefined, false);
      disposables.push(frondMat);
      // 'paddle': one leaf-shaped blade on a thin stalk, leaning back (weedy seadragon); 'leaf': three-lobed frond
      const paddle = sp.fronds.style === 'paddle';
      for (let l = paddle ? 1 : 0; l < (paddle ? 2 : 3); l++) {
        const a = (l - 1) * 0.52;
        const d = out.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
        if (paddle) d.addScaledVector(model.frame(s).T, 0.45).normalize();
        const gR = grid(10, 8, (uu, vv) => {
          const H = len * L * (l === 1 ? 1 : 0.75);
          const w = paddle
            ? L * (0.0022 + 0.2 * len * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (vv - 0.4) / 0.6))), 0.7))
            : 0.022 * L * Math.sin(Math.PI * vv) * (0.6 + 0.4 * Math.sin(vv * 9));
          const p = at.p.clone().addScaledVector(d, vv * H).addScaledVector(b, (uu - 0.5) * w * 2);
          return { p, flap: vv * 0.8, side: 0 };
        });
        addMesh(gR, frondMat, 4, true);
        if (!midline) addMesh(mirrorZ(gR, 0), frondMat, 4, true);
      }
    }
  }

}
