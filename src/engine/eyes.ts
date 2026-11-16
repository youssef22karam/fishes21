import * as THREE from 'three';
import { clamp, DEG, hashStr, lerp, smooth } from './math';
import { faceOut, grid, type C3, type Q4 } from './geom';
import { patchMaterial, type EyeTurn } from './shader';
import type { Ctx } from './ctx';
import type { PupilKind, Species } from './types';

const PUPIL: Record<PupilKind, number> = { round: 0, pear: 1, slitV: 2, slitH: 3, crescent: 4 };

/** How the eye of a species is built – derived from its taxon and proportions, overridable in EyeSpec. */
export interface EyeForm {
  /** protrusion 0…1: 0.1 flush under the skin (tunas) · 0.2 ordinary lateral eye · 0.5 goby · 1 periscope turret */
  p: number;
  pupil: number;
  /** pupil radius / iris radius */
  rp: number;
  shine: number;
  shineCol: string;
  adipose: number;
  /** reflectance of the argentea (guanine layer of the iris) */
  metal: number;
  /** how freely the globe turns (turret eyes swivel like a chameleon's) */
  mobile: number;
  /** iridescent cornea (gobies, flatfishes, puffers, triggerfishes) */
  irid: number;
  /** dorsal pigment cap of the iris */
  cap: number;
}

export function eyeForm(sp: Species): EyeForm {
  const e = sp.eye, c = sp.color;
  const is = (re: RegExp) => re.test(sp.id);
  const grp = (re: RegExp) => re.test(sp.group);
  const shark = sp.skin.kind === 'placoid' && sp.plan === 'fish' && !grp(/Rays/);
  const batoid = sp.plan === 'ray' || grp(/Rays/);
  // small fishes with big eyes: the globe is wider than the skull can hide
  const rel = clamp((e.d / Math.max(0.05, sp.HL) - 0.16) / 0.3);
  let p = 0.17 + 0.14 * rel;
  if (is(/mudskipper/)) p = 1;
  else if (grp(/Flatfish/)) p = 0.62;
  else if (is(/stingray|skate/)) p = 0.6;
  else if (is(/stonefish/)) p = 0.56;
  else if (is(/blenny/)) p = 0.55;
  else if (is(/goby|frogfish|seahorse|seadragon|pipefish/)) p = 0.5;
  else if (is(/porcupine|puffer/)) p = 0.42;
  else if (is(/cowfish|trigger|goldfish|lionfish|manta/)) p = 0.34;
  else if (is(/catfish|moray/)) p = 0.28;
  else if (shark) p = 0.08;
  else if (grp(/Tunas|Billfish|Jacks/)) p = 0.1;
  else if (grp(/Herring|Tarpon/)) p = 0.14;
  if (e.bulge !== undefined) p = e.bulge;

  let pupil: PupilKind = 'round';
  if ((batoid && !is(/manta/)) || grp(/Flatfish/)) pupil = 'crescent';
  else if (shark) pupil = is(/mako|white|whale|greenland|hammerhead/) ? 'round' : 'slitV';
  else if (is(/mudskipper|goby|stonefish|catfish/)) pupil = 'slitH';
  else if (grp(/Predators|Salmon|Sunfishes|Groupers|Cods|Tunas|Jacks|Billfish|Tarpons/)) pupil = 'pear';
  if (e.pupil) pupil = e.pupil;

  const deep = grp(/Deep sea/);
  const turret = p > 0.45;
  return {
    p,
    pupil: PUPIL[pupil],
    rp: pupil === 'crescent' ? 0.5 : deep ? 0.56 : shark ? 0.46 : turret ? 0.37 : 0.41,
    shine: e.shine ?? (is(/walleye/) ? 0.24 : shark ? 0.45 : deep ? 0.5 : is(/catfish|bowfin|gar/) ? 0.3 : grp(/Tarpon/) ? 0.22 : 0.05),
    shineCol: is(/walleye/) ? '#f4f1d2' : shark ? '#42d6a4' : deep ? '#5cc8ea' : '#86bcc4',
    adipose: e.adipose ?? (is(/herring|sardine/) ? 0.55 : is(/mackerel/) ? 0.5 : is(/bonefish/) ? 0.6 : is(/tarpon/) ? 0.3 : is(/trevally/) ? 0.25 : 0),
    metal: shark ? 0.12 : clamp(0.2 + 0.9 * (c.metal ?? 0.08) + 0.3 * (c.iri ?? 0), 0.2, 0.8),
    mobile: turret || is(/trigger|puffer|porcupine|cowfish/) ? 1 : 0.45,
    irid: is(/goby|mudskipper|blenny|trigger|puffer|porcupine|cowfish/) || grp(/Flatfish/) ? 0.8 : 0,
    cap: shark ? 0.1 : turret ? 0.25 : 0.42,
  };
}

/**
 * Eyes built as the organ is built:
 *  - a GLOBE that really turns in its socket (vertex shader, about the globe centre): spherical where it is
 *    exposed, oblate behind the lids. Its front carries the recessed iris dish with the spherical lens
 *    standing in the pupil, under a clear corneal dome – so the eye has depth, parallax and two highlights;
 *  - the protrusion is a species character: flush under the skin in tunas, a low dome in ordinary fishes,
 *    half a ball in gobies and flatfishes, a periscope turret looking sideways in mudskippers;
 *  - the ORBIT is head skin shrink-wrapped from the lid margin over the ball down onto the skull (same
 *    texture, same integument, welded normals), so every eye sits in its own socket or on its own stalk;
 *  - every part is anchored to the skin, so the eye rides on the cheek when the head inflates in a strike.
 */
export function buildEyes(ctx: Ctx) {
  const { sp, model, L, u, addMesh } = ctx;
  const e = sp.eye;
  if (e.d <= 0) return;
  const F = eyeForm(sp);
  const r = (e.d / 2) * L; // radius of the visible eye (world)
  const p = clamp(F.p, 0.02, 1);
  const tau = smooth(0.55, 1, p); // turret-ness
  const TAU = Math.PI * 2;
  const flat = sp.plan === 'flatR' || sp.plan === 'flatL';
  // Curvature of the skull at the orbit: a globe flatter than the head it sits in would push the skin around
  // it into a goggle. The exposed globe therefore curves at least as much as the head does (big-eyed small
  // fishes get a strongly domed eye, a tuna a nearly flat one).
  let sag = 0;
  const yn0 = flat ? e.y : model.eyeYn;
  const a0 = model.attach(e.s, yn0, sp.plan === 'flatL' ? -1 : 1);
  {
    const T0 = model.frame(e.s).T;
    const x0 = T0.clone().addScaledVector(a0.n, -T0.dot(a0.n));
    if (x0.lengthSq() > 1e-8) {
      x0.normalize();
      const y0 = new THREE.Vector3().crossVectors(a0.n, x0);
      for (let k = 0; k < 8; k++) {
        const al = (k / 8) * TAU;
        const q = model.drop(a0.p.clone().addScaledVector(x0, Math.cos(al) * r).addScaledVector(y0, Math.sin(al) * r), a0.n, 0.5 * r + 0.002 * L);
        sag += clamp(-q.p.sub(a0.p).dot(a0.n), 0, r) / 8;
      }
    }
  }
  // Skull clearance bound: an eyeball can never exceed the neurocranium half-width or dorsal/ventral skull height
  const hd0 = ((model.top(e.s) + model.bot(e.s)) / 2) * L;
  const yEye0 = model.normY(e.s, yn0) * L;
  const zClear = flat ? hd0 * 0.9 : Math.max(0.45 * r, Math.abs(a0.p.z) * 0.95);
  const dorsClear = Math.max(0.5 * r, (model.top(e.s) * L - yEye0) * 1.15);
  const ventClear = Math.max(0.5 * r, (yEye0 + model.bot(e.s) * L) * 1.15);
  const maxRg = tau > 0.25 ? 1.65 * r : Math.max(1.06 * r, Math.min(zClear * 1.26, dorsClear * 1.24, ventClear * 1.24, 1.56 * r));
  const thSkull = Math.asin(clamp(r / maxRg, 0.56, 0.95));
  const thHead = Math.asin(clamp((1.7 * sag) / r, 0, 0.8));
  const thAp = Math.max(lerp(38, 66, Math.pow(p, 0.78)) * DEG, thHead, thSkull); // half-angle of the lid aperture seen from the globe centre
  const Rg = (r / Math.sin(thAp)) * lerp(1, 0.84, tau); // radius of curvature of the exposed globe
  const gain = clamp((Math.asin(0.22 * Math.sin(thAp)) / 0.5) * (0.7 + 0.8 * F.mobile), 0.12, 0.85);
  const rotMax = 0.5 * gain;
  const thI = thAp * 1.035; // limbus: the iris just fills the aperture
  const thEnd = Math.min(Math.PI * 0.78, thAp + rotMax + (4.5 + 22 * tau) * DEG); // compact pure-spherical socket skirt
  const rI = Rg * Math.sin(thI);
  const capH = Rg * (1 - Math.cos(thI));
  const dome = lerp(0.24, 0.36, smooth(0.05, 0.35, p)); // height of the cornea over the limbus plane / iris radius
  const extra = rI * Math.max(0.04, dome - Math.tan(thI / 2));
  const xp = F.rp * 0.96;
  const hIris = 0.3 * capH;
  const hLens = F.pupil < 1.5 ? Math.max(0, Math.min(0.42 * xp * rI, 0.7 * capH + extra - 0.05 * rI)) : 0;

  const sides: { side: 1 | -1; s: number; y: number }[] = [];
  if (flat) {
    const sd = sp.plan === 'flatR' ? 1 : -1;
    sides.push({ side: sd, s: e.s, y: e.y }, { side: sd, s: e.s + e.d * 0.95, y: e.y - 0.4 });
  } else sides.push({ side: 1, s: e.s, y: model.eyeYn }, { side: -1, s: e.s, y: model.eyeYn });

  const iris = new THREE.Color(e.iris);
  const iris2 = e.iris2 ? new THREE.Color(e.iris2) : iris.clone().lerp(new THREE.Color('#ffe9b0'), 0.3);
  const globeCol = new THREE.Color(e.ring ?? e.iris).multiplyScalar(0.16);
  const seed = (hashStr(sp.id) % 97) / 9.7 + (ctx.seed % 13) * 0.71;
  const Z4: Q4 = [0, 0, 0, 0];

  sides.forEach(({ side, s, y }, eyeIdx) => {
    const at = model.attach(s, y, side);
    const fr = model.frame(s);
    const n = at.n.clone();
    const up = fr.N, fwd = fr.T.clone().negate();
    const zs = new THREE.Vector3(0, 0, flat ? 0 : side);
    // optical axis: the skin normal for eyes set in the flank; turret eyes on top of the head look sideways
    const upness = n.dot(up);
    const wT = flat ? 0 : clamp(tau + smooth(0.45, 0.7, p) * smooth(0.6, 0.95, upness) * 0.65, 0, 0.9);
    const aLat = zs.clone().multiplyScalar(Math.cos(26 * DEG)).addScaledVector(up, Math.sin(26 * DEG)).addScaledVector(fwd, 0.18 + 0.2 * tau).normalize();
    const a = n.clone().lerp(aLat, wT).normalize();
    // orbit frames around the skin normal (footprint) and around the optical axis (aperture, globe)
    const ref = up.clone().addScaledVector(zs, -0.3);
    const frameOf = (z: THREE.Vector3) => {
      const ex = fwd.clone().addScaledVector(z, -fwd.dot(z));
      if (ex.lengthSq() < 1e-8) ex.copy(up);
      ex.normalize();
      const ey = new THREE.Vector3().crossVectors(z, ex);
      if (ey.dot(ref) < 0) ey.negate();
      return { ex, ey };
    };
    const { ex: exN, ey: eyN } = frameOf(n);
    const { ex: exA, ey: eyA } = frameOf(a);
    // globe centre: sunk so the aperture lies in the skin – or raised on the head for a turret
    // (a periscope rises straight up from the skull roof, so the two balls stand side by side)
    const C = at.p.clone().addScaledVector(a, -Rg * Math.cos(thAp) * (1 - tau)).addScaledVector(n.clone().lerp(up, flat ? 0 : 0.75).normalize(), 0.66 * Rg * tau);
    // … close enough to touch at the midline, as in a living mudskipper
    if (!flat && tau > 0) C.z = lerp(C.z, side * Math.max(1.03 * Rg, Math.min(Math.abs(C.z), 1.1 * Rg)), tau);
    const polar = (th: number, al: number, rad: number, o = C) =>
      o.clone().addScaledVector(a, Math.cos(th) * rad).addScaledVector(exA, Math.sin(th) * Math.cos(al) * rad).addScaledVector(eyA, Math.sin(th) * Math.sin(al) * rad);

    // skin-anchor: the whole eye translates with the skin at the orbit centre
    const ancJ = ctx.seamJawUpper(s, at.phi);
    const ancPl = model.plasticAt(s, at.phi, false);
    const anchor = (g: THREE.BufferGeometry, w: (i: number) => number) => {
      const cnt = g.getAttribute('position').count;
      const A = new Float32Array(cnt * 4), Pl = new Float32Array(cnt * 4), W = new Float32Array(cnt);
      for (let i = 0; i < cnt; i++) {
        A.set([at.p.x, at.p.y, at.p.z, ancJ], i * 4);
        Pl.set(ancPl, i * 4);
        W[i] = w(i);
      }
      g.setAttribute('aAnc', new THREE.BufferAttribute(A, 4));
      g.setAttribute('aAncPl', new THREE.BufferAttribute(Pl, 4));
      g.setAttribute('aAncW', new THREE.BufferAttribute(W, 1));
      return g;
    };

    const turn: EyeTurn = { c: C, ax: exA, ay: eyA, az: a, gain };
    const eyeMat = patchMaterial(
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.3, envMapIntensity: 0.38 }),
      u, undefined, {
        turn,
        eye: {
          iris, iris2, pupil: new THREE.Color('#010203'), globe: globeCol,
          parm: new THREE.Vector4(F.pupil, F.rp, F.shine, F.metal * 0.7),
          geo: new THREE.Vector4(thAp, F.adipose, seed + eyeIdx * 3.3, F.cap),
          shine: new THREE.Color(F.shineCol),
        },
      },
    );
    // cornea: a clear coat only. It adds its reflections on top of the iris (ONE, 1-a) and turns opaque
    // only where a highlight is bright enough to hide what lies beneath. Under water a cornea barely mirrors
    // its surroundings (same refractive index as the sea), so it carries the glints of the lights, not the sky.
    const corneaMat = patchMaterial(
      new THREE.MeshPhysicalMaterial({
        color: '#000000', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.02,
        clearcoat: 0.75, clearcoatRoughness: 0.02, ior: 1.376, specularIntensity: 0.45, depthWrite: false, envMapIntensity: 0.16,
        iridescence: F.irid * 0.28, iridescenceIOR: 1.6,
        iridescenceThicknessMinimum: 260, iridescenceThicknessMaximum: 480,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
      }),
      u, undefined, { glass: true, glassAp: thAp, turn },
    );
    ctx.track(eyeMat); ctx.track(corneaMat);

    // ── 1. globe: lens dome → iris dish → limbus → pure compact sphere about C (never pokes through skin)
    const prof: { rad: number; z: number; rho: number }[] = [];
    const NIR = 22, NSP = 8;
    for (let k = 0; k <= NIR; k++) {
      const x = k / NIR, th = x * thI;
      const lens = x < xp ? hLens * Math.pow(1 - (x / xp) * (x / xp), 0.7) : 0;
      prof.push({ rad: Rg * Math.sin(th), z: Rg * Math.cos(thI) + hIris * (1 - x * x) + lens, rho: x });
    }
    for (let k = 1; k <= NSP; k++) {
      const th = lerp(thI, thEnd, k / NSP);
      prof.push({ rad: Rg * Math.sin(th), z: Rg * Math.cos(th), rho: th / thI });
    }
    const NA = 64, NR = prof.length - 1;
    const globeG = grid(NA, NR, (uu, vv) => {
      const q = prof[Math.round(vv * NR)], al = uu * TAU;
      const ca = Math.cos(al), sa = Math.sin(al);
      return {
        p: C.clone().addScaledVector(a, q.z).addScaledVector(exA, q.rad * ca).addScaledVector(eyA, q.rad * sa),
        plastic: Z4, eye: [q.rho * ca, q.rho * sa, 0, side],
      };
    });
    faceOut(globeG, (NIR + 2) * (NA + 1) + 3, a);
    addMesh(anchor(globeG, () => 1), eyeMat, 2);

    // ── 2. cornea: clear dome over iris and lens, running flush into the globe at the limbus
    const thC = thI * 1.03, NC = 14, eps = 0.006 * r;
    const corneaG = grid(NA, NC, (uu, vv) => {
      const th = vv * thC, al = uu * TAU;
      const k = 1 - vv * vv;
      return { p: polar(th, al, Rg + eps).addScaledVector(a, extra * k * k), plastic: Z4, eye: [0, 0, 0, side] };
    });
    faceOut(corneaG, 6 * (NA + 1) + 3, a);
    addMesh(anchor(corneaG, () => 1), corneaMat, 3);

    // ── 3. orbit: head skin stretched from the lid margin over the ball and down onto the skull
    const hd = ((model.top(s) + model.bot(s)) / 2) * L;
    const rhoOut = Math.max(clamp(0.6 + 0.45 * (hd / r), 1.12, 1.5) * r, 1.32 * Rg * tau);
    const reach = 0.35 * r + 0.002 * L + 2 * Rg * tau;
    const lidT = 0.028 * r;
    // keep every orbit skin row strictly outside the spherical globe
    const pushOut = (q: THREE.Vector3, m: number) => {
      const d = q.clone().sub(C), dist = d.length();
      const th = Math.acos(clamp(d.dot(a) / Math.max(dist, 1e-9), -1, 1));
      if (th <= thEnd + 0.08 && dist < Rg + m) q.copy(C).addScaledVector(d, (Rg + m) / Math.max(dist, 1e-9));
      return q;
    };
    // row parameter (−1 = lip tucked under the globe surface, 0 = lid margin … 1 = welded to the head), shade, anchor weight
    const rows: [number, number, number][] = [
      [-1, 0.24, 1], [0, 0.6, 1], [0.07, 0.85, 1], [0.17, 0.96, 1], [0.3, 1, 0.92], [0.45, 1, 0.72], [0.62, 1, 0.45], [0.8, 1, 0.2], [1, 1, 0],
    ];
    const NU = 72, NW = rows.length - 1;
    const outerN: THREE.Vector3[] = [];
    const rimG = grid(NU, NW, (uu, vv) => {
      const k = Math.round(vv * NW), i = Math.round(uu * NU);
      const al = uu * TAU, ca = Math.cos(al), sa = Math.sin(al);
      const [w, sh] = rows[k];
      const clampFlank = (d: { p: THREE.Vector3; s: number; phi: number }) => {
        if (flat) return d;
        const sameSide = side > 0 ? d.phi <= Math.PI : d.phi >= Math.PI;
        const pf = d.phi <= Math.PI ? d.phi : TAU - d.phi;
        if (sameSide && pf >= 0.04 && pf <= Math.PI - 0.04) return d;
        const pc = sameSide ? clamp(pf, 0.04, Math.PI - 0.04) : (pf < Math.PI * 0.5 ? 0.04 : Math.PI - 0.04);
        const phi = side > 0 ? pc : TAU - pc;
        return { p: model.surface(d.s, phi), s: d.s, phi };
      };
      const softZ = (v: number, minZ: number, k: number) => {
        const sv = side * v;
        const h = Math.max(k - Math.abs(sv - minZ), 0) / k;
        return side * (Math.max(sv, minZ) + h * h * k * 0.25);
      };
      const rimP = polar(thAp, al, Rg + lidT);
      const foot = clampFlank(model.drop(at.p.clone().addScaledVector(exN, ca * rhoOut).addScaledVector(eyN, sa * rhoOut), n, reach));
      let pos: THREE.Vector3, q = foot;
      if (w >= 1) {
        pos = foot.p;
        outerN[i] = model.normalAt(foot.s, foot.phi);
      } else {
        const ww = Math.max(0, w);
        const lin = rimP.clone().lerp(foot.p, ww);
        q = clampFlank(model.drop(lin, n, reach));
        // S-profile: the skin leaves the skull tangentially and rolls over into the lid margin (no bezel), never below the skin
        const hgt = Math.max(lin.clone().sub(q.p).dot(n) * (1 + ww - 2 * ww * ww), 0.03 * r * Math.pow(1 - ww, 1.5));
        pos = pushOut(q.p.clone().addScaledVector(n, hgt), lidT * Math.pow(1 - ww, 0.7) + 0.002 * r);
        if (w < 0) {
          // inner lip: from the margin down through the surface of the globe
          const mTh = Math.acos(clamp(pos.clone().sub(C).normalize().dot(a), -1, 1));
          pos = polar(Math.min(mTh, thAp) * 0.955, al, Rg - 0.06 * r);
        }
        if (!flat) pos.z = softZ(pos.z, 0.0012 * L, 0.006 * L);
      }
      const col: C3 = [sh, sh * 0.985, sh * 0.97];
      // skin weights of the body loft at this point (the orbit of a big eye can reach across the mouth seam)
      const pm = model.seamPhi(q.s), pf = q.phi <= Math.PI ? q.phi : TAU - q.phi;
      const lower = model.hasJaw() && pf > pm;
      const jaw = lower ? model.jawWeight(q.s, (pf - pm) / Math.max(1e-4, Math.PI - pm)) : ctx.seamJawUpper(q.s, q.phi);
      return { p: pos, uv: [model.uOf(q.s), q.phi / TAU], jaw, plastic: model.plasticAt(q.s, q.phi, lower), col };
    }, false, true);
    {
      const P = rimG.getAttribute('position') as THREE.BufferAttribute;
      const vi = 2 * (NU + 1) + 5;
      faceOut(rimG, vi, new THREE.Vector3(P.getX(vi), P.getY(vi), P.getZ(vi)).sub(C).normalize().lerp(n, 0.35));
    }
    // the outermost ring is welded to the head: same position, same shading normal
    const RN = rimG.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i <= NU; i++) {
      const nn = outerN[i];
      if (nn) RN.setXYZ(NW * (NU + 1) + i, nn.x, nn.y, nn.z);
    }
    // inner rows ride rigidly with the eye, the outer row deforms exactly like the head skin
    addMesh(anchor(rimG, (i) => rows[Math.floor(i / (NU + 1))]?.[2] ?? 0), ctx.tintMat, 1, true);
  });
}
