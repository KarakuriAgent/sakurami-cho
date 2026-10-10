import * as THREE from 'three'
import { NM } from '../../named/namedMaterial'
import type { Faces } from '../../named/kitBuilder'
import type { InteriorBuilder, V3 } from '../builder'
import { at, chair, frame, stool, table } from '../furniture'
import { IM } from '../interiorMaterial'
import type { L2 } from '../types'
import { angDiff, chunkAt, CORE_LEDGES, coreRadius, DEG, DOME, glassHeight, P, pathDistance, pnoise, polar, RADIAL_PATHS, RAMP_A_FOOT, rampFootDistance, rng, rockRadius } from './layout'

/**
 * ガーデンドームの中の形（根の階の地面と道・池・核の岩の塔・梢のテラスとロタンダ・枝の踊り場・らせん階段・幹と枝の回廊（石の床・白い手すり・
 * 金の光の帯・アーケード）・弧のスロープ・つり橋・中の店（喫茶 こもれび・葉っぱ屋・光脈管制室）・種の間・入口の張り出しの中）。
 * 形は所ごとの組（chunkAt）に分けて書き（視野の外の組は描かない）、通り道とカメラの障害物も記録する（dry のときは障害物だけ）。
 * 高さはすべて局所の h（建物の床から。ib.floorH = 0 で書く）
 */

const SIDES: Faces = [true, true, false, false, true, true]

/** 白い石（手すり・柱・アーチ）・石の床・金の光の帯の色 */
export const C = {
  stone: '#ece6da',
  stoneShade: '#d8d0c0',
  floor: '#cfc6b4',
  paving: '#b9b0a0',
  curb: '#a8a092',
  rock: '#8f8676',
  soil: '#3d2e22',
  steel: '#f2f2ee',
  gold: '#e8c070',
}

/** 灯りの番号（briefs/dome.ts の LAMPS の順）。構造の形が光る物に使う */
export interface DomeLampIx {
  gallery: number
  branch: number
  terrace: number
  landing: number
  komorebi: number
  happaya: number
  control: number
  screen: number
  path: number
  seeds: number
  vault: number
  seedsStair: number
}

type B = InteriorBuilder

/** 書き先の組を、局所の点の所の組にする */
function here(ib: B, s: number, t: number) {
  ib.chunk(chunkAt(s, t))
}

/** 障害物を記録する階（形の高さは局所の h のまま） */
function level(ib: B, lv: number) {
  ib.level = lv
  ib.floorH = 0
}

/** 扇形の板（r0〜r1・角度 a0〜a1・高さ h0〜h1）。top / bottom / 内と外の側面。segLen ごとに区切る */
function ringSlab(ib: B, r0: number, r1: number, a0: number, a1: number, h0: number, h1: number, color: string, mat: number, aux = 0, opt: { top?: string; topMat?: number; topAux?: number; sides?: boolean; bottomColor?: string; seg?: number } = {}) {
  if (ib.dry) return
  const n = Math.max(1, Math.ceil(((a1 - a0) * (r0 + r1)) / 2 / (opt.seg ?? 2.4)))
  for (let i = 0; i < n; i++) {
    const q0 = a0 + ((a1 - a0) * i) / n
    const q1 = a0 + ((a1 - a0) * (i + 1)) / n
    const m = P((r0 + r1) / 2, (q0 + q1) / 2)
    here(ib, m[0], m[1])
    const A = P(r0, q0)
    const Bp = P(r1, q0)
    const Cp = P(r1, q1)
    const D = P(r0, q1)
    ib.quad([A[0], A[1], h1], [Bp[0], Bp[1], h1], [Cp[0], Cp[1], h1], [D[0], D[1], h1], opt.top ?? color, opt.topMat ?? mat, opt.topAux ?? aux, 0.95)
    ib.quad([D[0], D[1], h0], [Cp[0], Cp[1], h0], [Bp[0], Bp[1], h0], [A[0], A[1], h0], opt.bottomColor ?? color, mat, aux, 0.8)
    if (opt.sides !== false) {
      ib.quad([Bp[0], Bp[1], h0], [Cp[0], Cp[1], h0], [Cp[0], Cp[1], h1], [Bp[0], Bp[1], h1], color, mat, aux, 0.9)
      ib.quad([D[0], D[1], h0], [A[0], A[1], h0], [A[0], A[1], h1], [D[0], D[1], h1], color, mat, aux, 0.9)
    }
  }
}

/**
 * 白い石の手すり（折れ線に沿って）: 親柱（every m ごと）・笠木・下の台・手すり子（0.3m ごと）・内側の金の光の帯（glow = 灯りの番号、-1 なら無し）。
 * 通り道とカメラの障害物（lv の階）も
 */
function balustrade(ib: B, pts: L2[], h0: number, lv: number, glow = -1, glowSide = 1, every = 2.6) {
  level(ib, lv)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const L = Math.hypot(dx, dy)
    if (L < 0.05) continue
    const yaw = Math.atan2(dy, dx)
    const c: L2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    ib.block('手すり', c, L + 0.1, 0.26, h0 - 0.6, h0 + 1.12, yaw, true, true)
    if (ib.dry) continue
    here(ib, c[0], c[1])
    // 下の台と笠木
    ib.box(c, h0, [L + 0.02, 0.24, 0.14], C.stoneShade, NM.stone, 0, yaw, 0.85)
    ib.box(c, h0 + 0.95, [L + 0.04, 0.26, 0.1], C.stone, NM.stone, 0, yaw)
    // 手すり子（壺の形の代わりに、下が太い角の柱）
    const nb = Math.max(1, Math.floor(L / 0.3))
    for (let k = 0; k < nb; k++) {
      const u = (k + 0.5) / nb
      const p: L2 = [a[0] + dx * u, a[1] + dy * u]
      ib.box(p, h0 + 0.14, [0.08, 0.08, 0.24], C.stone, NM.stone, 0, yaw, 0.9, SIDES)
      ib.box(p, h0 + 0.38, [0.055, 0.055, 0.57], C.stone, NM.stone, 0, yaw, 0.95, SIDES)
    }
    // 金の光の帯（笠木の下の内側）
    if (glow >= 0) {
      const nx = -dy / L
      const ny = dx / L
      ib.glowBox([c[0] + nx * 0.14 * glowSide, c[1] + ny * 0.14 * glowSide], h0 + 0.9, [L, 0.02, 0.025], C.gold, glow, 2.6, yaw)
    }
  }
  if (ib.dry) return
  // 親柱
  let acc = 0
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (i === 0 || i === pts.length - 1 || acc >= every) {
      acc = 0
      const p = pts[i]
      here(ib, p[0], p[1])
      const yaw = i > 0 ? Math.atan2(p[1] - pts[i - 1][1], p[0] - pts[i - 1][0]) : Math.atan2(pts[1][1] - p[1], pts[1][0] - p[0])
      ib.box(p, h0, [0.3, 0.3, 1.12], C.stone, NM.stone, 0, yaw)
      ib.box(p, h0 + 1.12, [0.36, 0.36, 0.06], C.stoneShade, NM.stone, 0, yaw)
    }
  }
}

/** 円弧の点の列（r・a0〜a1・segLen ごと） */
function arcPts(r: number, a0: number, a1: number, segLen = 2.2): L2[] {
  const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / segLen))
  return Array.from({ length: n + 1 }, (_, i) => P(r, a0 + ((a1 - a0) * i) / n))
}

/** 角度 a が区間（a0〜a1。度でなくラジアン）の中か */
function inSpan(a: number, a0: number, a1: number) {
  const m = (a0 + a1) / 2
  return Math.abs(angDiff(a, m)) <= (a1 - a0) / 2
}

/** 円弧の手すりを、開口（[a0, a1] の区間の並び）を除いて作る */
function ringBalustrade(ib: B, r: number, h0: number, lv: number, gaps: [number, number][], glow: number, glowSide: number) {
  const n = 120
  let run: L2[] = []
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI + (i / n) * Math.PI * 2
    const inGap = gaps.some(([g0, g1]) => inSpan(a, g0, g1))
    if (!inGap) run.push(P(r, a))
    if ((inGap || i === n) && run.length > 1) {
      balustrade(ib, run, h0, lv, glow, glowSide)
      run = []
    } else if (inGap) run = []
  }
}

/* -------------------------------------------------------------------------- */
/* 根の階: 地面（植え込みの土）・道（石畳と縁石）・池・広場                                  */
/* -------------------------------------------------------------------------- */

/** 植え込みの土の高さ（道から離れるほど少し盛り上がる） */
export function bedHeight(s: number, t: number) {
  const pd = Math.min(pathDistance(s, t), rampFootDistance(s, t))
  if (pd <= 0) return -0.06
  const k = Math.min(1, Math.max(0, (pd - 0.2) / 2.4))
  const n = 0.5 + 0.5 * Math.sin(s * 0.37 + t * 0.21) * Math.cos(s * 0.13 - t * 0.31)
  return 0.02 + k * k * (3 - 2 * k) * (0.12 + 0.36 * n)
}

function soilColor(a: number, r: number, s: number, t: number) {
  const w = { south: Math.max(0, Math.cos(angDiff(a, -Math.PI / 2))), east: Math.max(0, Math.cos(a)), north: Math.max(0, Math.cos(angDiff(a, Math.PI / 2))), west: Math.max(0, Math.cos(angDiff(a, Math.PI))) }
  const sum = w.south + w.east + w.north + w.west || 1
  const cols: Record<string, [number, number, number]> = { south: [0.2, 0.14, 0.09], east: [0.27, 0.19, 0.12], north: [0.17, 0.22, 0.1], west: [0.45, 0.39, 0.28] }
  const out = [0, 0, 0]
  for (const k of Object.keys(w) as (keyof typeof w)[]) for (let i = 0; i < 3; i++) out[i] += (cols[k][i] * w[k]) / sum
  const v = 0.82 + 0.3 * (0.5 + 0.5 * Math.sin(s * 1.7 + t * 0.9) * Math.sin(s * 0.6 - t * 1.3))
  void r
  return `#${out.map((c) => Math.round(Math.min(1, c * v) * 255).toString(16).padStart(2, '0')).join('')}`
}

/** 植え込みの土の面（r 19〜59.7。池と広場・入口の張り出し・吹き抜けの所は作らない） */
function ground(ib: B) {
  if (ib.dry) return
  const r0 = DOME.plaza.r1 - 0.4
  const r1 = DOME.R - 0.25
  const nr = 34
  const na = 180
  const radii = Array.from({ length: nr + 1 }, (_, i) => r0 + ((r1 - r0) * i) / nr)
  const skip = (s: number, t: number) => {
    for (const g of Object.values(DOME.gates)) if (s > g.s0 + 0.2 && s < g.s1 - 0.2 && t > g.t0 + 0.2 && t < g.t1 - 0.2) return true
    const st = DOME.b1.stair
    if (s > st.s0 && s < st.s1 && t > st.t0 && t < st.t1) return true
    return false
  }
  for (let i = 0; i < nr; i++)
    for (let j = 0; j < na; j++) {
      const q0 = -Math.PI + (j / na) * Math.PI * 2
      const q1 = -Math.PI + ((j + 1) / na) * Math.PI * 2
      const A = P(radii[i], q0)
      const Bp = P(radii[i + 1], q0)
      const Cp = P(radii[i + 1], q1)
      const D = P(radii[i], q1)
      const mid: L2 = [(A[0] + Cp[0]) / 2, (A[1] + Cp[1]) / 2]
      if (skip(mid[0], mid[1])) continue
      here(ib, mid[0], mid[1])
      const pts = [A, Bp, Cp, D].map((p) => [p[0], p[1], bedHeight(p[0], p[1])] as V3)
      const [rm, am] = polar(mid[0], mid[1])
      ib.solid.ao = 0.9
      ib.quad(pts[0], pts[1], pts[2], pts[3], soilColor(am, rm, mid[0], mid[1]), NM.soil, 0, 0.88)
    }
}

/** 道の石畳（放射の道・広場とアーケードの環の道）と縁石 */
function paths(ib: B) {
  level(ib, 0)
  if (ib.dry) return
  const top = 0.0
  for (const p of RADIAL_PATHS) {
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1]
      const b = p.pts[i]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n = Math.ceil(L / 3)
      const yaw = Math.atan2(b[1] - a[1], b[0] - a[0])
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n
        const c: L2 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
        here(ib, c[0], c[1])
        ib.box(c, top - 0.12, [L / n + 0.01, p.w, 0.12], C.paving, NM.paving, 0, yaw, 0.95, [true, true, true, false, true, true])
        for (const side of [-1, 1]) ib.box(at(c, yaw, 0, side * (p.w / 2 + 0.07)), -0.1, [L / n + 0.01, 0.14, 0.22], C.curb, NM.granite, 0, yaw, 0.9)
      }
    }
  }
  // 広場（池のまわり）とアーケードの下の環の道
  ringSlab(ib, DOME.plaza.r0 + 0.45, DOME.plaza.r1, -Math.PI, Math.PI, -0.12, top, C.paving, NM.paving, 0, { sides: false, seg: 2 })
  ringSlab(ib, DOME.plaza.r1, DOME.plaza.r1 + 0.16, -Math.PI, Math.PI, -0.1, 0.12, C.curb, NM.granite, 0, { seg: 2 })
  ringSlab(ib, DOME.arcade.r0 - 0.35, DOME.arcade.r1 + 0.35, -Math.PI, Math.PI, -0.12, top, C.floor, NM.paving, 0, { sides: false, seg: 2.4 })
  for (const r of [DOME.arcade.r0 - 0.5, DOME.arcade.r1 + 0.35]) ringSlab(ib, r, r + 0.16, -Math.PI, Math.PI, -0.1, 0.12, C.curb, NM.granite, 0, { seg: 2.4 })
  // 南の入口の前の広がり（スロープ A の下の口へ）と、種の間への階段の口
  ringSlab(ib, RAMP_A_FOOT.r0, RAMP_A_FOOT.r1, RAMP_A_FOOT.a0, RAMP_A_FOOT.a1, -0.12, top, C.paving, NM.paving, 0, { sides: false })
  const st = DOME.b1.stair
  here(ib, (st.s0 + st.s1) / 2, 19)
  ib.box([(st.s0 + st.s1) / 2, 19.3], -0.12, [st.s1 - st.s0 + 0.8, 1.6, 0.12], C.paving, NM.paving, 0, 0, 0.95)
}

/** 池（底・内の縁の壁・縁石の腰掛け） */
function pool(ib: B) {
  level(ib, 0)
  const p = DOME.pool
  // 縁の腰掛け（広場の内の縁）。通り道の障害物
  const n = 48
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    const m = P(p.r1 + 0.2, (a0 + a1) / 2)
    ib.block('池の縁', m, (Math.PI * 2 * (p.r1 + 0.2)) / n + 0.05, 0.5, -1, 0.45, (a0 + a1) / 2 + Math.PI / 2, true, false)
  }
  if (ib.dry) return
  ringSlab(ib, p.r1 - 0.05, p.r1 + 0.45, -Math.PI, Math.PI, p.floor, 0.42, C.stoneShade, NM.stone, 0.4, { top: C.stone, seg: 1.6 })
  ringSlab(ib, p.r0 - 0.4, p.r1, -Math.PI, Math.PI, p.floor - 0.1, p.floor, '#2c3330', NM.stone, 0, { sides: false, seg: 2 })
  // 底の小石のまだら（少し明るい石を散らす）
  const r = rng(77)
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2
    const rr = p.r0 + 0.3 + r() * (p.r1 - p.r0 - 0.6)
    const c = P(rr, a)
    here(ib, c[0], c[1])
    ib.cyl(c, p.floor, 0.15 + r() * 0.35, 0.08 + r() * 0.12, ['#4a4a42', '#5a5446', '#3a3e38'][i % 3], NM.stone, 0, 7, 0.1 + r() * 0.2)
  }
}

/** 基壇の内の面（ガラスの足元の石の壁。外観の基壇の円筒は外向きの面だけなので、中から見ると透ける）。入口の張り出しの所は開ける */
function plinth(ib: B) {
  if (ib.dry) return
  const gaps: [number, number][] = [
    [-95.4 * DEG, -84.6 * DEG],
    [176.8 * DEG, 183.2 * DEG],
    [86.8 * DEG, 93.2 * DEG],
  ]
  const n = 96
  for (let i = 0; i < n; i++) {
    const q0 = -Math.PI + (i / n) * Math.PI * 2
    const q1 = -Math.PI + ((i + 1) / n) * Math.PI * 2
    const qm = (q0 + q1) / 2
    if (gaps.some(([a, b]) => qm > a - 0.01 && qm < b + 0.01)) continue
    const A = P(DOME.R - 0.3, q0)
    const Bp = P(DOME.R - 0.3, q1)
    here(ib, (A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2)
    // 内向きの面（石）と、上のガラスの受けの段
    ib.quad([Bp[0], Bp[1], -0.3], [A[0], A[1], -0.3], [A[0], A[1], 3.0], [Bp[0], Bp[1], 3.0], '#b9b1a2', NM.stone, 0.5, 0.85)
    const A2 = P(DOME.R + 0.2, q0)
    const B2 = P(DOME.R + 0.2, q1)
    ib.quad([A[0], A[1], 3.0], [A2[0], A2[1], 3.0], [B2[0], B2[1], 3.0], [Bp[0], Bp[1], 3.0], '#c9c2b4', NM.stone, 0.5, 0.9)
  }
}

/* -------------------------------------------------------------------------- */
/* 核の岩の塔（大滝「天の水」）・枝の踊り場・梢のテラスとロタンダ・らせん階段                      */
/* -------------------------------------------------------------------------- */

function core(ib: B) {
  level(ib, 0)
  const top = DOME.core.top
  // 通り道の障害物（池の中の塔。根の階では池の縁で止まるので、枝の踊り場と梢のテラスの階で）
  for (const lv of [2, 3]) {
    level(ib, lv)
    ib.disc('核の岩', [0, 0], lv === 2 ? coreRadius(13) + 1.05 : 4.0, -2, 30, true, true)
  }
  level(ib, 0)
  ib.disc('核の岩', [0, 0], DOME.core.r0 + 0.6, -2, top, false, true)
  if (ib.dry) return
  ib.chunk('core')
  // 岩の面（なめらかな法線の格子。角度 nA × 高さ）
  const nA = 84
  const hs: number[] = []
  for (let h = DOME.pool.floor; h < top; h += 0.55) hs.push(h)
  hs.push(top)
  const pt = (a: number, h: number): V3 => {
    const r = rockRadius(a, h)
    return [Math.cos(a) * r, Math.sin(a) * r, h]
  }
  const b0 = ib.solid
  const base = b0.vertexCount
  const c = new THREE.Color()
  for (let i = 0; i < hs.length; i++)
    for (let j = 0; j <= nA; j++) {
      const a = (j / nA) * Math.PI * 2
      const h = hs[i]
      const p = pt(a, h)
      const da = 0.02
      const dh = 0.15
      const pa = pt(a + da, h)
      const pa2 = pt(a - da, h)
      const ph = pt(a, h + dh)
      const ph2 = pt(a, h - dh)
      const ta = new THREE.Vector3(pa[0] - pa2[0], pa[1] - pa2[1], pa[2] - pa2[2])
      const th = new THREE.Vector3(ph[0] - ph2[0], ph[1] - ph2[1], ph[2] - ph2[2])
      const nl = ta.clone().cross(th).normalize()
      // 局所の法線 → シーン（s, t, h → x, y, z = s, h, -t）
      const ns: V3 = [nl.x, nl.z, -nl.y]
      // 色: 岩の 2 つの色のまだら・上を向いた所と北の側は苔・南の滝の面は濡れて暗い・水ぎわは黒い
      const n3 = pnoise(a + 2.1, h * 0.9, 23)
      const n4 = pnoise(a + 0.4, h * 2.3, 41)
      const north = Math.max(0, Math.sin(a))
      const up = Math.max(0, nl.z)
      const fall = Math.exp(-((angDiff(a, -Math.PI / 2) / 0.3) ** 2))
      const mossK = Math.min(1, Math.max(0, up * 1.6 + north * 0.35 * n3 + (n4 - 0.6) * 0.8)) * (1 - fall * 0.8)
      const n5 = pnoise(a + 3.3, h * 0.45, 11)
      const rock = new THREE.Color().setRGB(0.27 + 0.1 * n3, 0.25 + 0.08 * n3, 0.22 + 0.06 * n5).multiplyScalar(0.62 + 0.55 * n4 * n5 + 0.2 * n5)
      rock.lerp(new THREE.Color(0.12, 0.19, 0.07), mossK * 0.9)
      rock.multiplyScalar(1 - 0.45 * fall * (h < 18.5 ? 1 : 0))
      if (h < 0.3) rock.multiplyScalar(0.55 + 0.45 * Math.min(1, Math.max(0, (h + 0.95) / 1.2)))
      c.copy(rock)
      b0.ao = 0.75 + 0.25 * Math.min(1, (h + 1) / 3) - (1 - up) * 0.05
      b0.vertex(ib.p(...p), ns, c, NM.stone, 0)
    }
  for (let i = 0; i + 1 < hs.length; i++)
    for (let j = 0; j < nA; j++) {
      const a = base + i * (nA + 1) + j
      const bq = a + 1
      const d = a + nA + 1
      b0.idx.push(a, bq, d + 1, a, d + 1, d)
    }
  b0.ao = 1
  // 段の植え込みの土（棚の上）
  for (const lh of CORE_LEDGES) {
    const n = 56
    for (let j = 0; j < n; j++) {
      const q0 = (j / n) * Math.PI * 2
      const q1 = ((j + 1) / n) * Math.PI * 2
      const qm = (q0 + q1) / 2
      if (Math.abs(angDiff(qm, -Math.PI / 2)) < 0.3) continue
      const ri0 = rockRadius(q0, lh + 0.7) - 0.15
      const ri1 = rockRadius(q1, lh + 0.7) - 0.15
      const ro0 = rockRadius(q0, lh) + 0.05
      const ro1 = rockRadius(q1, lh) + 0.05
      if (ro0 - ri0 < 0.15) continue
      const A = P(ri0, q0)
      const Bp = P(ro0, q0)
      const Cp = P(ro1, q1)
      const D = P(ri1, q1)
      ib.quad([A[0], A[1], lh + 0.15], [Bp[0], Bp[1], lh + 0.1], [Cp[0], Cp[1], lh + 0.1], [D[0], D[1], lh + 0.15], '#33281e', NM.soil, 0, 0.8)
    }
  }
  // 大滝の口・岩棚は、岩の面（南はなめらかな滝の面）のまま。滝の幕が前を落ちる
}

/** 白い鋼管の「枝」（核の岩から床の縁へ弧を描いて支える。先で二つに分かれる） */
function branchStrut(ib: B, a: number, r0: number, h0: number, r1: number, h1: number, rad: number) {
  const ctrl: [number, number] = [r0 + (r1 - r0) * 0.25, h1 - (h1 - h0) * 0.15]
  const pts: V3[] = []
  const n = 9
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const r = (1 - u) * (1 - u) * r0 + 2 * (1 - u) * u * ctrl[0] + u * u * r1
    const h = (1 - u) * (1 - u) * h0 + 2 * (1 - u) * u * ctrl[1] + u * u * h1
    const p = P(r, a)
    pts.push([p[0], p[1], h])
  }
  for (let i = 1; i < pts.length; i++) ib.tube(pts[i - 1], pts[i], rad * (1 - (i / n) * 0.4), C.steel, NM.paint, 0.55, 10)
  // 先の二股（床の縁の下へ）
  const fork = pts[Math.floor(n * 0.62)]
  for (const side of [-1, 1]) {
    const tip = P(r1 - 0.2, a + (side * 1.1) / r1)
    ib.tube(fork, [tip[0], tip[1], h1], rad * 0.55, C.steel, NM.paint, 0.55, 8)
  }
}

/** 枝の層の核のまわりの踊り場（つり橋の口とらせん階段の口のほかに手すり） */
function landing(ib: B, lamps: DomeLampIx) {
  const L = DOME.landing
  ib.chunk('core')
  ringSlab(ib, L.r0, L.r1, -Math.PI, Math.PI, L.h - 0.4, L.h, C.stoneShade, NM.stone, 0.4, { top: C.floor, topMat: NM.paving, bottomColor: '#e6e0d4', seg: 1.6 })
  ringSlab(ib, L.r1 - 0.02, L.r1 + 0.1, -Math.PI, Math.PI, L.h - 0.5, L.h - 0.22, C.stone, NM.stone, 0, { seg: 1.6 })
  // 白い鋼管の枝（岩から弧を描いて床の縁を支える）
  if (!ib.dry)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2
      if (DOME.bridges.some((b) => Math.abs(angDiff(a, b)) < 0.2)) continue
      branchStrut(ib, a, rockRadius(a, L.h - 4.5) - 0.2, L.h - 4.5, L.r1 - 0.35, L.h - 0.4, 0.18)
    }
  const gaps: [number, number][] = DOME.bridges.map((b) => [b - 7.5 * DEG, b + 7.5 * DEG] as [number, number])
  gaps.push([Math.min(DOME.stairC.a0, DOME.stairC.a1) - 2 * DEG, Math.max(DOME.stairC.a0, DOME.stairC.a1) + 6 * DEG])
  ringBalustrade(ib, L.r1 - 0.13, L.h, 2, gaps, lamps.landing, -1)
  // 踊り場の下の灯り（核の岩を照らす）
  if (!ib.dry) {
    const lp = P(L.r1 - 0.3, -100 * DEG)
    ib.glowBulb(lp, L.h - 0.75, 0.12, '#ffd9a0', lamps.landing, 6)
  }
}


/** 梢のテラス（核の上の円いテラス。らせん階段の上がる口・手すり・持ち送り）とロタンダ（8 本の柱・梁の環・小さなドーム・頂の明かり取り） */
function terrace(ib: B, lamps: DomeLampIx) {
  const T = DOME.L3
  const C3 = DOME.stairC
  ib.chunk('core')
  // 階段の口（らせん階段の上の端 a1 から、段がテラスの床の下に入る所まで）。a1 の側が出口（手すりなし）
  const cut0 = Math.min(C3.a1, C3.a0) - 1.5 * DEG
  const cut1 = 72 * DEG
  // テラスの床（階段の口は穴）: 中心の円板と、口の外の環
  const inner = 8.2
  const outer = 10.8
  ringSlab(ib, 0.01, inner, -Math.PI, Math.PI, T.h - 0.45, T.h, C.stoneShade, NM.stone, 0.4, { top: C.floor, topMat: NM.paving, bottomColor: '#e6e0d4', sides: false, seg: 1.4 })
  ringSlab(ib, inner, outer, cut1, cut0 + Math.PI * 2, T.h - 0.45, T.h, C.stoneShade, NM.stone, 0.4, { top: C.floor, topMat: NM.paving, bottomColor: '#e6e0d4', sides: false, seg: 1.4 })
  ringSlab(ib, outer, T.r, -Math.PI, Math.PI, T.h - 0.45, T.h, C.stoneShade, NM.stone, 0.4, { top: C.floor, topMat: NM.paving, bottomColor: '#e6e0d4', seg: 1.4 })
  ringSlab(ib, T.r - 0.02, T.r + 0.12, -Math.PI, Math.PI, T.h - 0.58, T.h - 0.25, C.stone, NM.stone, 0, { seg: 1.4 })
  // 口の縁の小口（床の厚み）
  if (!ib.dry) {
    for (const r of [inner, outer]) {
      const pts = arcPts(r, cut0, cut1, 0.8)
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        const out = r === inner ? 1 : -1
        if (out > 0) ib.quad([b[0], b[1], T.h - 0.45], [a[0], a[1], T.h - 0.45], [a[0], a[1], T.h], [b[0], b[1], T.h], C.stoneShade, NM.stone, 0.4)
        else ib.quad([a[0], a[1], T.h - 0.45], [b[0], b[1], T.h - 0.45], [b[0], b[1], T.h], [a[0], a[1], T.h], C.stoneShade, NM.stone, 0.4)
      }
    }
    for (const a of [cut0, cut1]) {
      const p0 = P(inner, a)
      const p1 = P(outer, a)
      ib.quad([p0[0], p0[1], T.h - 0.45], [p1[0], p1[1], T.h - 0.45], [p1[0], p1[1], T.h], [p0[0], p0[1], T.h], C.stoneShade, NM.stone, 0.4)
    }
  }
  // 階段の口の障害物（梢の階）と手すり
  level(ib, 3)
  const nCut = 6
  for (let i = 0; i < nCut; i++) {
    const q0 = cut0 + ((cut1 - cut0) * i) / nCut
    const q1 = cut0 + ((cut1 - cut0) * (i + 1)) / nCut
    const m = P((inner + outer) / 2, (q0 + q1) / 2)
    ib.block('階段の口', m, ((q1 - q0) * (inner + outer)) / 2 + 0.1, outer - inner + 0.2, T.h - 1, T.h + 1.1, (q0 + q1) / 2 + Math.PI / 2)
  }
  balustrade(ib, arcPts(inner + 0.1, cut0, cut1, 1), T.h, 3, -1)
  balustrade(ib, arcPts(outer - 0.1, cut0, cut1, 1), T.h, 3, -1)
  balustrade(ib, [P(inner, cut1), P(outer, cut1)], T.h, 3, -1)
  // 外の縁の手すり（金の光の帯）
  ringBalustrade(ib, T.r - 0.13, T.h, 3, [], lamps.terrace, -1)
  // 白い鋼管の枝（核の岩から弧を描いてテラスの縁を支える。らせん階段の上は避ける）
  if (!ib.dry)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.15
      if (inSpan(a, Math.min(DOME.stairC.a0, DOME.stairC.a1) - 0.15, Math.max(DOME.stairC.a0, DOME.stairC.a1) + 0.15)) continue
      branchStrut(ib, a, rockRadius(a, T.h - 6) - 0.2, T.h - 6, T.r - 0.45, T.h - 0.45, 0.22)
    }
  // ロタンダ（8 本の柱・梁の環・小さなドーム・頂の明かり取り）
  level(ib, 3)
  const rr = 4.2
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const c = P(rr, a)
    ib.disc('ロタンダの柱', c, 0.32, T.h, T.h + 4.5)
    if (ib.dry) continue
    ib.box(c, T.h, [0.62, 0.62, 0.3], C.stone, NM.stone, 0, a)
    ib.cyl(c, T.h + 0.3, 0.24, 3.9, C.stone, NM.stone, 0, 14, 0.21)
    ib.box(c, T.h + 4.2, [0.56, 0.56, 0.24], C.stone, NM.stone, 0, a)
  }
  if (!ib.dry) {
    ringSlab(ib, rr - 0.45, rr + 0.45, -Math.PI, Math.PI, T.h + 4.44, T.h + 5.1, C.stone, NM.stone, 0, { seg: 1 })
    ib.lathe([0, 0], T.h + 5.1, [
      [rr + 0.3, 0],
      [rr + 0.15, 0.9],
      [rr - 0.6, 1.9],
      [rr - 1.8, 2.6],
      [1.3, 2.95],
      [0.9, 3.0],
    ], 32, '#e8e4dc', NM.paint, 0.5)
    ib.cyl([0, 0], T.h + 8.1, 0.9, 0.9, C.stone, NM.stone, 0, 16, 0.75)
    ib.glowCyl([0, 0], T.h + 8.2, 0.7, 0.6, '#fff0cc', lamps.terrace, 2.2, 0.62)
    // 床の星形の象嵌（ロタンダの中）
    ib.cyl([0, 0], T.h, 3.4, 0.012, '#bdb29c', NM.stone, 0, 32)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const p = P(1.7, a)
      ib.box(p, T.h + 0.012, [3.2, 0.06, 0.005], i % 2 ? '#8a7a5a' : '#c9a046', i % 2 ? NM.stone : NM.gold, 0, a)
    }
    // ロタンダの灯り（中から吊る）
    ib.tube([0, 0, T.h + 4.4], [0, 0, T.h + 7.6], 0.01, '#2a2a28', NM.iron, 0.3, 6)
    ib.glowBulb([0, 0], T.h + 4.1, 0.28, '#ffe0b0', lamps.terrace, 5)
  }
  // テラスのベンチ（夕焼けの見える西の側に 2 つ）
  level(ib, 3)
  for (const a of [168 * DEG, 212 * DEG]) {
    const c = P(9.6, a)
    ib.block('ベンチ', c, 1.8, 0.5, T.h, T.h + 0.5, a + Math.PI / 2)
    if (ib.dry) continue
    ib.box(c, T.h, [1.8, 0.48, 0.42], C.stone, NM.stone, 0, a + Math.PI / 2)
    ib.box(c, T.h + 0.42, [1.86, 0.52, 0.06], '#8a6a48', NM.wood, 0, a + Math.PI / 2)
  }
}

/** 4 点の面を、表が want（局所の向き）の側を向く順で足す */
function quadFacing(ib: B, a: V3, b: V3, c: V3, d: V3, want: V3, color: string, mat: number, aux = 0, ao = 1) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0) ib.quad(a, b, c, d, color, mat, aux, ao)
  else ib.quad(d, c, b, a, color, mat, aux, ao)
}

/** らせん階段 C（枝の踊り場 → 梢のテラス）: 扇の踏み板・蹴込み・外の側桁と手すり（白い石と金の帯）・内の側は核の岩 */
function spiralStair(ib: B, lamps: DomeLampIx) {
  const S = DOME.stairC
  const N = S.risers
  const h0 = DOME.landing.h
  const h1 = DOME.L3.h
  const rise = (h1 - h0) / N
  const span = S.a1 - S.a0
  const dir = Math.sign(span)
  const ri = S.r - S.w / 2
  const ro = S.r + S.w / 2
  if (ib.dry) return
  ib.chunk('core')
  // 上る向き（接線）の局所の向き
  const tangent = (q: number): V3 => [-Math.sin(q) * dir, Math.cos(q) * dir, 0]
  for (let i = 0; i < N; i++) {
    const q0 = S.a0 + (span * i) / N
    const q1 = S.a0 + (span * (i + 1)) / N
    const h = h0 + rise * (i + 1)
    // 踏み板（上の面）
    ringSlab(ib, ri, ro, Math.min(q0, q1), Math.max(q0, q1), h - 0.06, h, C.stoneShade, NM.stone, 0.3, { top: C.floor, topMat: NM.paving, sides: false, seg: 3 })
    // 蹴込み（上る人の方を向く）
    const A = P(ri, q0)
    const Bp = P(ro, q0)
    const t = tangent(q0)
    quadFacing(ib, [A[0], A[1], h - rise], [Bp[0], Bp[1], h - rise], [Bp[0], Bp[1], h], [A[0], A[1], h], [-t[0], -t[1], 0], C.stoneShade, NM.stone, 0.3)
  }
  // 段の下の斜めの面（白い漆喰。下向き）と外の側桁（外向き）
  const nU = 24
  for (let i = 0; i < nU; i++) {
    const q0 = S.a0 + (span * i) / nU
    const q1 = S.a0 + (span * (i + 1)) / nU
    const hA = h0 + ((h1 - h0) * i) / nU - 0.32
    const hB = h0 + ((h1 - h0) * (i + 1)) / nU - 0.32
    const A = P(ri, q0)
    const Bp = P(ro, q0)
    const Cp = P(ro, q1)
    const D = P(ri, q1)
    quadFacing(ib, [A[0], A[1], hA], [Bp[0], Bp[1], hA], [Cp[0], Cp[1], hB], [D[0], D[1], hB], [0, 0, -1], '#e2dccf', IM.paintWall, 0, 0.85)
    const E = P(ro + 0.12, q0)
    const F = P(ro + 0.12, q1)
    const qm = (q0 + q1) / 2
    quadFacing(ib, [E[0], E[1], hA - 0.1], [F[0], F[1], hB - 0.1], [F[0], F[1], hB + 0.5], [E[0], E[1], hA + 0.5], [Math.cos(qm), Math.sin(qm), 0], C.stone, NM.stone, 0)
  }
  // 外の手すり（らせんに沿う笠木・手すり子・金の帯）
  const nR = 40
  let prev: V3 | null = null
  for (let i = 0; i <= nR; i++) {
    const q = S.a0 + (span * i) / nR
    const h = h0 + ((h1 - h0) * i) / nR
    const p = P(ro + 0.05, q)
    const cur: V3 = [p[0], p[1], h + 1.0]
    if (prev) {
      ib.beam(prev, cur, 0.12, C.stone, NM.stone, 0, 0.1)
      const mid: V3 = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2, (prev[2] + cur[2]) / 2]
      ib.box([mid[0], mid[1]], mid[2] - 0.92, [0.05, 0.05, 0.86], C.stone, NM.stone, 0, q, 0.95, SIDES)
      ib.glowBox([mid[0] * (1 - 0.1 / S.r), mid[1] * (1 - 0.1 / S.r)], mid[2] - 0.1, [0.02, 0.02, 0.02], C.gold, lamps.terrace, 1.5)
    }
    prev = cur
  }
}

/* -------------------------------------------------------------------------- */
/* 幹の回廊（1 層）・枝の回廊（2 層）・スロープ・つり橋                                      */
/* -------------------------------------------------------------------------- */

/** 回廊の灯りの柱（手すりの親柱の上の、灯りの球） */
function lampPost(ib: B, c: L2, h: number, lamp: number) {
  if (ib.dry) return
  here(ib, c[0], c[1])
  ib.cyl(c, h + 1.12, 0.06, 1.5, '#2a2a28', NM.iron, 0.3, 8)
  ib.cyl(c, h + 2.6, 0.13, 0.08, '#2a2a28', NM.iron, 0.3, 10)
  ib.glowBulb(c, h + 2.86, 0.2, '#ffe2b0', lamp, 5)
  ib.cyl(c, h + 3.06, 0.16, 0.06, '#2a2a28', NM.iron, 0.3, 10, 0.04)
}

function galleryL1(ib: B, lamps: DomeLampIx) {
  const G = DOME.L1
  // 床（石。下は漆喰の天井）と縁の蛇腹
  ringSlab(ib, G.r0, G.r1, -Math.PI, Math.PI, G.h - 0.6, G.h, C.stoneShade, NM.stone, 0.45, { top: C.floor, topMat: NM.paving, bottomColor: '#e6e0d4', seg: 2.2 })
  for (const r of [G.r0 - 0.12, G.r1]) ringSlab(ib, r, r + 0.12, -Math.PI, Math.PI, G.h - 0.75, G.h - 0.45, C.stone, NM.stone, 0, { seg: 2.2 })
  // こもれびの張り出しと光脈管制室の張り出し（外へ）
  const K = DOME.komorebi
  const Cc = DOME.control
  ringSlab(ib, G.r1, K.r1, K.a0, K.a1, G.h - 0.6, G.h, C.stoneShade, NM.stone, 0.45, { top: '#bba78c', topMat: IM.woodFloor, topAux: 0.14, bottomColor: '#e6e0d4', seg: 1.6 })
  ringSlab(ib, G.r1, Cc.r1, Cc.a0, Cc.a1, G.h - 0.6, G.h, C.stoneShade, NM.stone, 0.45, { top: '#9aa0a4', topMat: NM.tileClad, topAux: 0.6, bottomColor: '#e6e0d4', seg: 1.6 })
  // スロープ A の上の口・B の下の口（内へ）
  ringSlab(ib, DOME.rampA.r - 1.5, G.r0, 2 * DEG, 9 * DEG, G.h - 0.6, G.h, C.stoneShade, NM.stone, 0.45, { top: C.floor, topMat: NM.paving, seg: 1.6 })
  ringSlab(ib, DOME.rampB.r - 1.5, G.r0, 13 * DEG, 19.5 * DEG, G.h - 0.6, G.h, C.stoneShade, NM.stone, 0.45, { top: C.floor, topMat: NM.paving, seg: 1.6 })
  // 手すり: 内の縁（スロープの口を開ける。金の帯は内向き）・外の縁（こもれび・管制室の張り出しを開ける）
  ringBalustrade(ib, G.r0 - 0.06, G.h, 1, [[1.5 * DEG, 9.5 * DEG], [12.5 * DEG, 20 * DEG]], lamps.gallery, -1)
  ringBalustrade(ib, G.r1 + 0.06, G.h, 1, [[K.a0 + 0.5 * DEG, K.a1 - 0.5 * DEG], [Cc.a0, Cc.a1]], lamps.gallery, 1)
  // 張り出しの縁の手すり
  balustrade(ib, arcPts(K.r1 - 0.12, K.a0, K.a1, 1.4), G.h, 1, lamps.komorebi, 1)
  balustrade(ib, [P(G.r1, K.a0), P(K.r1, K.a0)], G.h, 1)
  balustrade(ib, [P(G.r1, K.a1), P(K.r1, K.a1)], G.h, 1)
  // スロープの口の横の手すり（A の上の口: 内の弧・奥の端・スロープの外の手すりの先。B の下の口: 内の弧・手前の端・スロープの外の手すりの先）
  balustrade(ib, arcPts(DOME.rampA.r - 1.62, 2 * DEG, 9 * DEG, 1), G.h, 1)
  balustrade(ib, [P(DOME.rampA.r - 1.62, 9 * DEG), P(G.r0, 9 * DEG)], G.h, 1)
  balustrade(ib, [P(DOME.rampA.r + 1.42, 2 * DEG), P(G.r0, 2 * DEG)], G.h, 1)
  balustrade(ib, arcPts(DOME.rampB.r - 1.62, 13 * DEG, DOME.rampB.a0, 1), G.h, 1)
  balustrade(ib, [P(DOME.rampB.r - 1.62, 13 * DEG), P(G.r0, 13 * DEG)], G.h, 1)
  balustrade(ib, [P(DOME.rampB.r + 1.42, 19.5 * DEG), P(G.r0, 19.5 * DEG)], G.h, 1)
  // アーケード（内と外の柱の環・内の環の半円のアーチ・柱の頭の帯）。入口の道の上は広いアーチ
  level(ib, 0)
  const n = 48
  const colAngle = (i: number) => (i / n) * Math.PI * 2 + (3.75 * DEG) - Math.PI
  const skip = (a: number) => Math.abs(angDiff(a, -Math.PI / 2)) < 5 * DEG
  for (let i = 0; i < n; i++) {
    const a = colAngle(i)
    if (skip(a)) continue
    for (const r of [DOME.arcade.r0, DOME.arcade.r1]) {
      const c = P(r, a)
      ib.disc('アーケードの柱', c, 0.36, 0, G.h - 0.6)
      if (ib.dry) continue
      here(ib, c[0], c[1])
      ib.box(c, -0.05, [0.72, 0.72, 0.5], C.stoneShade, NM.stone, 0, a)
      ib.cyl(c, 0.45, 0.27, G.h - 1.65, C.stone, NM.stone, 0, 14, 0.24)
      ib.box(c, G.h - 1.2, [0.66, 0.66, 0.3], C.stone, NM.stone, 0, a)
    }
  }
  if (!ib.dry)
    for (let i = 0; i < n; i++) {
      const a0 = colAngle(i)
      let j = i + 1
      while (skip(colAngle(j % n))) j++
      const a1 = colAngle(j % n) + (j >= n ? Math.PI * 2 : 0)
      if (skip(a0)) continue
      for (const r of [DOME.arcade.r0, DOME.arcade.r1]) {
        const A = P(r, a0)
        const Bp = P(r, a1)
        const span = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]) - 0.5
        const rad = span / 2
        const spring = G.h - 0.9 - rad
        const mid: L2 = [(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2]
        here(ib, mid[0], mid[1])
        const yaw = Math.atan2(Bp[1] - A[1], Bp[0] - A[0])
        const seg = 8
        let prev: V3 | null = null
        for (let k = 0; k <= seg; k++) {
          const th = Math.PI - (k / seg) * Math.PI
          const x = Math.cos(th) * rad
          const y = Math.sin(th) * rad
          const p = at(mid, yaw, x, 0)
          const cur: V3 = [p[0], p[1], Math.max(spring, spring + y)]
          if (prev) ib.beam(prev, cur, 0.34, C.stone, NM.stone, 0, 0.3)
          prev = cur
        }
        // アーチの上のスパンドレル（床の下の帯まで、平らな面）
        ib.box(mid, spring + rad, [span + 0.5, 0.3, G.h - 0.6 - (spring + rad)], C.stone, NM.stone, 0, yaw, 0.95)
      }
    }
  // 灯りの柱（内の手すりに 6 本）
  for (let i = 0; i < 6; i++) {
    const a = (30 + i * 60) * DEG
    const c = P(G.r0 - 0.06, a)
    lampPost(ib, c, G.h, lamps.gallery)
  }
  // 回廊のベンチ（外の縁に沿って）
  level(ib, 1)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 11 * DEG
    if (inSpan(a, K.a0 - 0.05, K.a1 + 0.05) || inSpan(a, Cc.a0 - 0.05, Cc.a1 + 0.05) || inSpan(a, -95 * DEG, -85 * DEG)) continue
    const c = P(G.r1 - 0.55, a)
    ib.block('ベンチ', c, 1.6, 0.5, G.h, G.h + 0.5, a + Math.PI / 2)
    if (ib.dry) continue
    here(ib, c[0], c[1])
    ib.box(c, G.h, [1.6, 0.46, 0.42], C.stoneShade, NM.stone, 0, a + Math.PI / 2)
    ib.box(c, G.h + 0.42, [1.66, 0.5, 0.06], '#8a6a48', NM.wood, 0, a + Math.PI / 2)
  }
}

function galleryL2(ib: B, lamps: DomeLampIx) {
  const G = DOME.L2
  ringSlab(ib, G.r0, G.r1, -Math.PI, Math.PI, G.h - 0.5, G.h, C.stoneShade, NM.stone, 0.45, { top: C.floor, topMat: NM.paving, bottomColor: '#e6e0d4', seg: 2 })
  for (const r of [G.r0 - 0.1, G.r1]) ringSlab(ib, r, r + 0.1, -Math.PI, Math.PI, G.h - 0.62, G.h - 0.38, C.stone, NM.stone, 0, { seg: 2 })
  // スロープ B の上の口（外へ）
  ringSlab(ib, G.r1, DOME.rampB.r + 1.5, 113 * DEG, 120.5 * DEG, G.h - 0.5, G.h, C.stoneShade, NM.stone, 0.45, { top: C.floor, topMat: NM.paving, seg: 1.4 })
  const bridgeGaps: [number, number][] = DOME.bridges.map((b) => [b - (DOME.bridgeW / 2 + 0.2) / G.r0, b + (DOME.bridgeW / 2 + 0.2) / G.r0] as [number, number])
  ringBalustrade(ib, G.r0 + 0.06, G.h, 2, bridgeGaps, lamps.branch, 1)
  ringBalustrade(ib, G.r1 - 0.06, G.h, 2, [[112.5 * DEG, 121 * DEG]], lamps.branch, -1)
  balustrade(ib, [P(G.r1, 113 * DEG), P(DOME.rampB.r - 1.42, 113 * DEG)], G.h, 2)
  balustrade(ib, arcPts(DOME.rampB.r + 1.6, 113 * DEG, 120.5 * DEG, 1), G.h, 2)
  balustrade(ib, [P(G.r1, 120.5 * DEG), P(DOME.rampB.r + 1.6, 120.5 * DEG)], G.h, 2)
  // 細い柱（白い鋼管）と持ち送り
  level(ib, 0)
  const n = 24
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 7.5 * DEG
    if (DOME.bridges.some((b) => Math.abs(angDiff(a, b)) < 4 * DEG)) continue
    for (const r of [33.5, 37.5]) {
      const c = P(r, a)
      ib.disc('回廊の柱', c, 0.28, 0, G.h - 0.5, true, true)
      if (ib.dry) continue
      here(ib, c[0], c[1])
      ib.cyl(c, -0.1, 0.32, 0.5, C.stoneShade, NM.stone, 0, 12)
      ib.cyl(c, 0.4, 0.2, G.h - 1.4, C.steel, NM.paint, 0.55, 12, 0.18)
      // 頭の持ち送り（Y 字に広がる鋼管。木の枝のように）
      for (const da of [-1, 1]) {
        const tip = P(r, a + (da * 2.2) / r)
        ib.beam([c[0], c[1], G.h - 2.6], [tip[0], tip[1], G.h - 0.5], 0.12, C.steel, NM.paint, 0.55)
      }
      ib.cyl(c, G.h - 1.0, 0.26, 0.5, C.steel, NM.paint, 0.55, 12, 0.2)
    }
  }
  for (let i = 0; i < 3; i++) {
    const a = (60 + i * 120) * DEG
    lampPost(ib, P(G.r0 + 0.06, a), G.h, lamps.branch)
  }
}

/** 弧のスロープ（床の板・両側の手すりと金の帯・下の柱）。sector の外の口の板は回廊の側で作る */
function arcRamp(ib: B, rp: { r: number; w: number; a0: number; a1: number }, h0: number, h1: number, lamps: DomeLampIx) {
  const n = Math.ceil((Math.abs(rp.a1 - rp.a0) * rp.r) / 1.6)
  const ri = rp.r - rp.w / 2
  const ro = rp.r + rp.w / 2
  const H = (k: number) => h0 + (h1 - h0) * k
  if (!ib.dry)
    for (let i = 0; i < n; i++) {
      const k0 = i / n
      const k1 = (i + 1) / n
      const q0 = rp.a0 + (rp.a1 - rp.a0) * k0
      const q1 = rp.a0 + (rp.a1 - rp.a0) * k1
      const m = P(rp.r, (q0 + q1) / 2)
      here(ib, m[0], m[1])
      const A = P(ri, q0)
      const Bp = P(ro, q0)
      const Cp = P(ro, q1)
      const D = P(ri, q1)
      const t0 = H(k0)
      const t1 = H(k1)
      const th = 0.45
      ib.quad([A[0], A[1], t0], [Bp[0], Bp[1], t0], [Cp[0], Cp[1], t1], [D[0], D[1], t1], C.floor, NM.paving, 0, 0.95)
      ib.quad([D[0], D[1], t1 - th], [Cp[0], Cp[1], t1 - th], [Bp[0], Bp[1], t0 - th], [A[0], A[1], t0 - th], '#e6e0d4', NM.plaster, 0, 0.8)
      ib.quad([Bp[0], Bp[1], t0 - th], [Cp[0], Cp[1], t1 - th], [Cp[0], Cp[1], t1], [Bp[0], Bp[1], t0], C.stone, NM.stone, 0, 0.9)
      ib.quad([D[0], D[1], t1 - th], [A[0], A[1], t0 - th], [A[0], A[1], t0], [D[0], D[1], t1], C.stone, NM.stone, 0, 0.9)
    }
  // 手すり（両側。坂に沿う笠木と手すり子・金の帯）と障害物（その階）
  for (const side of [-1, 1]) {
    const r = rp.r + side * (rp.w / 2 - 0.08)
    const m = Math.ceil((Math.abs(rp.a1 - rp.a0) * r) / 1.2)
    let prev: V3 | null = null
    for (let i = 0; i <= m; i++) {
      const k = i / m
      const q = rp.a0 + (rp.a1 - rp.a0) * k
      const p = P(r, q)
      const cur: V3 = [p[0], p[1], H(k) + 1.0]
      if (prev && !ib.dry) {
        here(ib, p[0], p[1])
        ib.beam(prev, cur, 0.14, C.stone, NM.stone, 0, 0.1)
        ib.beam([prev[0], prev[1], prev[2] - 0.9], [cur[0], cur[1], cur[2] - 0.9], 0.18, C.stoneShade, NM.stone, 0, 0.14)
        const mid: L2 = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2]
        const mh = (prev[2] + cur[2]) / 2
        for (const u of [-0.25, 0.25]) {
          const bp: L2 = [mid[0] + (cur[0] - prev[0]) * u, mid[1] + (cur[1] - prev[1]) * u]
          ib.box(bp, mh - 0.86, [0.055, 0.055, 0.8], C.stone, NM.stone, 0, q, 0.95, SIDES)
        }
        ib.glowBox([mid[0] * (1 - (side * 0.12) / r), mid[1] * (1 - (side * 0.12) / r)], mh - 0.12, [0.02, 0.02, 0.02], C.gold, lamps.gallery, 1.2)
      }
      prev = cur
    }
  }
  // 下の柱（白い鋼管。高い所だけ）
  level(ib, 0)
  const nc = Math.floor((Math.abs(rp.a1 - rp.a0) * rp.r) / 7)
  for (let i = 1; i <= nc; i++) {
    const k = i / (nc + 1)
    const hh = H(k)
    if (hh < 2.4) continue
    const q = rp.a0 + (rp.a1 - rp.a0) * k
    const c = P(rp.r, q)
    if (pathDistance(c[0], c[1]) < 0.6) continue
    ib.disc('スロープの柱', c, 0.3, 0, hh, true, true)
    if (ib.dry) continue
    here(ib, c[0], c[1])
    ib.cyl(c, -0.1, 0.24, hh - 0.35, C.steel, NM.paint, 0.55, 10, 0.2)
    for (const side of [-1, 1]) {
      const tip = P(rp.r + side * (rp.w / 2 - 0.3), q)
      ib.beam([c[0], c[1], hh - 1.8], [tip[0], tip[1], hh - 0.45], 0.1, C.steel, NM.paint, 0.55)
    }
  }
}

/** つり橋（枝の回廊 → 核の踊り場）: 床の板・両端の塔・弧のケーブル・吊り材・手すりとガラスの板 */
function bridge(ib: B, b: number, lamps: DomeLampIx) {
  const r0 = DOME.landing.r1 - 0.1
  const r1 = DOME.L2.r0 + 0.1
  const h = DOME.L2.h
  const w = DOME.bridgeW
  const A = P(r0, b)
  const Bp = P(r1, b)
  const L = r1 - r0
  const c: L2 = [(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2]
  const yaw = b
  level(ib, 2)
  // 両側の手すり（障害物）
  for (const side of [-1, 1]) ib.block('橋の手すり', at(c, yaw, 0, side * (w / 2 - 0.05)), L, 0.14, h - 0.4, h + 1.1, yaw, true, true)
  // 両端の塔（カメラが避け、見通しもさえぎる。らせん階段を追うカメラの前に塔が立っていた。town.md の §7 の 148）
  for (const end of [0, 1]) for (const side of [-1, 1]) ib.disc('橋の塔', at(end ? Bp : A, yaw, end ? -0.25 : 0.25, side * (w / 2 + 0.12)), 0.16, h, h + 5.45, false, true)
  if (ib.dry) return
  const nseg = Math.ceil(L / 2)
  for (let i = 0; i < nseg; i++) {
    const u = (i + 0.5) / nseg
    const p: L2 = [A[0] + (Bp[0] - A[0]) * u, A[1] + (Bp[1] - A[1]) * u]
    here(ib, p[0], p[1])
    ib.box(p, h - 0.32, [L / nseg + 0.01, w, 0.32], '#d8d2c4', NM.stone, 0, yaw, 0.95)
    ib.box(p, h - 0.02, [L / nseg + 0.01, w - 0.2, 0.025], '#8a6a48', IM.woodFloor, 0.12, yaw)
  }
  // 塔（両端・両側）とケーブル・吊り材・手すり
  const towerH = 5.2
  for (const end of [0, 1]) {
    for (const side of [-1, 1]) {
      const p = at(end ? Bp : A, yaw, end ? -0.25 : 0.25, side * (w / 2 + 0.12))
      here(ib, p[0], p[1])
      ib.box(p, h, [0.22, 0.22, towerH], C.steel, NM.paint, 0.55, yaw)
      ib.cyl(p, h + towerH, 0.15, 0.25, C.steel, NM.paint, 0.55, 10)
    }
    const top = at(end ? Bp : A, yaw, end ? -0.25 : 0.25, 0)
    ib.box(top, h + towerH - 0.3, [0.2, w + 0.5, 0.25], C.steel, NM.paint, 0.55, yaw)
  }
  for (const side of [-1, 1]) {
    const m = 16
    let prev: V3 | null = null
    for (let k = 0; k <= m; k++) {
      const u = k / m
      const sag = 4 * u * (1 - u)
      const p = at(A, yaw, 0.25 + (L - 0.5) * u, side * (w / 2 + 0.12))
      const cur: V3 = [p[0], p[1], h + towerH - sag * (towerH - 1.25)]
      if (prev) {
        here(ib, p[0], p[1])
        ib.beam(prev, cur, 0.05, '#c8ccd0', NM.steel, 0.3)
      }
      if (k > 0 && k < m) ib.beam([p[0], p[1], h + 0.95], cur, 0.018, '#c8ccd0', NM.steel, 0.3)
      prev = cur
    }
    // 手すり（鋼管）とガラスの板・足元の金の帯
    const rl = at(c, yaw, 0, side * (w / 2 - 0.05))
    ib.box(rl, h + 1.0, [L, 0.06, 0.06], C.steel, NM.paint, 0.6, yaw)
    ib.box(rl, h, [L, 0.08, 0.12], '#d8d2c4', NM.stone, 0, yaw)
    for (let k = 0; k < Math.floor(L / 1.5); k++) {
      const u = (k + 0.5) / Math.floor(L / 1.5)
      const p = at(A, yaw, L * u, side * (w / 2 - 0.05))
      ib.box(p, h + 0.12, [0.04, 0.04, 0.88], C.steel, NM.paint, 0.6, yaw, 0.95, SIDES)
    }
    const g0 = at(A, yaw, 0.2, side * (w / 2 - 0.06))
    const g1 = at(Bp, yaw, -0.2, side * (w / 2 - 0.06))
    ib.glass([g0[0], g0[1], h + 0.12], [g1[0], g1[1], h + 0.12], [g1[0], g1[1], h + 0.96], [g0[0], g0[1], h + 0.96])
    ib.glowBox(at(c, yaw, 0, side * (w / 2 - 0.16)), h + 0.03, [L - 0.4, 0.03, 0.02], C.gold, lamps.branch, 2)
  }
}

/* -------------------------------------------------------------------------- */
/* 中の店: 喫茶 こもれび（1 層の張り出し）・売店「葉っぱ屋」（根の階のアーケード）・光脈管制室        */
/* -------------------------------------------------------------------------- */

function komorebi(ib: B, lamps: DomeLampIx) {
  const K = DOME.komorebi
  const h = DOME.L1.h
  level(ib, 1)
  // 店のカウンターと屋台（張り出しの外の縁。木の屋根と植木の棚）
  const kc = P(K.r1 - 1.2, K.a)
  const yaw = K.a + Math.PI / 2
  ib.block('こもれびのカウンター', kc, 4.2, 0.8, h, h + 1.1, yaw)
  if (!ib.dry) {
    here(ib, kc[0], kc[1])
    ib.box(kc, h, [4.2, 0.75, 1.0], '#6a4a30', NM.boardV, 0.12, yaw)
    ib.box(kc, h + 1.0, [4.3, 0.85, 0.06], '#8a6a48', NM.wood, 0, yaw)
    // 奥の棚とエスプレッソの機械・葉っぱラテの看板
    const back = at(kc, yaw, 0, 0.9)
    ib.box(back, h, [4.0, 0.5, 0.9], '#4a3424', NM.wood, 0, yaw)
    ib.box(at(back, yaw, -0.8, 0), h + 0.9, [0.7, 0.45, 0.42], '#c9ccd0', NM.steel, 0, yaw)
    ib.box(at(back, yaw, -0.8, 0), h + 1.32, [0.72, 0.46, 0.05], '#2f6a46', NM.paint, 0.5, yaw)
    for (let i = 0; i < 5; i++) ib.cyl(at(back, yaw, 0.2 + i * 0.3, 0), h + 0.9, 0.05, 0.1, '#e8f0dc', IM.ceramic, 0, 10, 0.055)
    // 屋根（木の格子のパーゴラと葉）
    for (const dx of [-2.0, 2.0]) for (const dy of [-0.3, 1.2]) ib.box(at(kc, yaw, dx, dy), h, [0.12, 0.12, 2.7], '#5a3e28', NM.wood, 0, yaw)
    ib.box(at(kc, yaw, 0, 0.45), h + 2.7, [4.4, 1.9, 0.08], '#5a3e28', NM.lattice, 0.2, yaw)
    for (let i = 0; i < 9; i++) ib.box(at(kc, yaw, -2 + i * 0.5, 0.45 + (i % 2 ? 0.3 : -0.3)), h + 2.72, [0.6, 0.7, 0.32], i % 3 ? '#3f6a32' : '#4e7a3a', NM.leaf, 0, yaw + i)
    // 看板（小さな木の札）
    frame(ib, 'komorebi-menu', at(kc, yaw, 1.5, -0.42), h + 1.55, 0.6, 0.8, yaw - Math.PI / 2, '#3a2a1a')
    // 吊り下げの灯り
    for (const dx of [-1.2, 1.2]) {
      const p = at(kc, yaw, dx, 0.2)
      ib.tube([p[0], p[1], h + 2.2], [p[0], p[1], h + 2.68], 0.006, '#2a2a28', NM.iron, 0.3, 6)
      ib.glowBulb(p, h + 2.12, 0.07, '#ffd9a0', lamps.komorebi, 6)
    }
  }
  // 内の手すりに沿った「眺めのカウンター」（核と大滝が見える。丸椅子 5。真ん中が花音の席）
  const nS = 5
  ib.floorH = h
  for (let i = 0; i < nS; i++) {
    const a = K.a + ((i - (nS - 1) / 2) * 1.05) / DOME.L1.r0
    const sp = P(DOME.L1.r0 + 0.55, a)
    stool(ib, sp, 0.72, '#6a4a30', '#2a2a28', 0.26, i !== 2)
  }
  ib.floorH = 0
  if (!ib.dry) {
    const pts = arcPts(DOME.L1.r0 + 0.17, K.a - 3.4 / DOME.L1.r0, K.a + 3.4 / DOME.L1.r0, 0.7)
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const c: L2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      here(ib, c[0], c[1])
      ib.box(c, h + 1.02, [Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.02, 0.36, 0.05], '#8a6a48', NM.wood, 0, Math.atan2(b[1] - a[1], b[0] - a[0]))
    }
    // 花音の席の前の葉っぱラテ（葉の形のラテアート）
    const lc = P(DOME.L1.r0 + 0.2, K.a)
    ib.cyl(lc, h + 1.07, 0.07, 0.012, '#f4f0e8', IM.ceramic, 0, 16)
    ib.cyl(lc, h + 1.082, 0.046, 0.08, '#f4f0e8', IM.ceramic, 0, 14, 0.053)
    ib.cyl(lc, h + 1.162, 0.048, 0.003, '#c8925a', IM.ceramic, 0.3, 14)
    ib.box(lc, h + 1.165, [0.05, 0.022, 0.002], '#f4ecd8', IM.ceramic, 0.3, K.a)
  }
  ib.block('眺めのカウンター', P(DOME.L1.r0 + 0.17, K.a), 7, 0.36, h, h + 1.1, K.a + Math.PI / 2, false, true)
  // テーブル 3 卓（張り出しの上）
  ib.floorH = h
  for (const [dr, da] of [
    [2.6, -0.075],
    [2.6, 0.075],
    [3.3, 0],
  ] as [number, number][]) {
    const c = P(DOME.L1.r1 + dr - 0.6, K.a + da)
    table(ib, 'こもれびのテーブル', c, 0.7, 0.7, 0.72, K.a, '#7a5a3a')
    chair(ib, at(c, K.a, 0, -0.6), K.a + Math.PI / 2, '#5a3e28', 0.46)
    chair(ib, at(c, K.a, 0, 0.6), K.a - Math.PI / 2, '#5a3e28', 0.46)
  }
  ib.floorH = 0
}

function happaya(ib: B, lamps: DomeLampIx) {
  const a = DOME.happaya.a
  level(ib, 0)
  // アーケードの外の柱の間（r 51〜53）に棚とカウンター。客はアーケードの道に立つ
  const c = P(DOME.arcade.r1 + 0.9, a)
  const yaw = a + Math.PI / 2
  ib.block('葉っぱ屋のカウンター', P(DOME.arcade.r1 + 0.45, a), 3.6, 0.7, 0, 1.0, yaw)
  if (ib.dry) return
  here(ib, c[0], c[1])
  const front = P(DOME.arcade.r1 + 0.45, a)
  ib.box(front, 0, [3.6, 0.6, 0.95], '#5a7a4a', NM.boardV, 0.12, yaw)
  ib.box(front, 0.95, [3.7, 0.68, 0.06], '#8a6a48', NM.wood, 0, yaw)
  // ドームはちみつの瓶（カウンターの上）・葉っぱの栞・絵はがきの回転台
  for (let i = 0; i < 12; i++) {
    const p = at(front, yaw, -1.4 + (i % 6) * 0.22, -0.12 + Math.floor(i / 6) * 0.18)
    ib.cyl(p, 1.01, 0.05, 0.12, '#d8a030', IM.plastic, 0.85, 10)
    ib.cyl(p, 1.13, 0.052, 0.03, '#f2efe6', IM.fabric, 0, 10)
  }
  const rack = at(front, yaw, 1.2, -0.05)
  ib.cyl(rack, 1.01, 0.02, 0.5, '#2a2a28', NM.iron, 0.3, 6)
  for (let i = 0; i < 6; i++) ib.box(rack, 1.15 + (i % 3) * 0.12, [0.16, 0.012, 0.1], ['#e8d8b0', '#c8e0c0', '#f0c8b8'][i % 3], NM.paint, 0, (i * Math.PI) / 3)
  // 奥の棚（鉢植え・種の袋・はちみつ）
  const back = P(DOME.arcade.r1 + 1.75, a)
  ib.box(back, 0, [3.6, 0.4, 2.2], '#6a4a30', NM.wood, 0, yaw)
  for (const hh of [0.7, 1.25, 1.8]) {
    ib.box(at(back, yaw, 0, -0.22), hh, [3.5, 0.3, 0.03], '#8a6a48', NM.wood, 0, yaw)
    for (let i = 0; i < 9; i++) {
      const p = at(back, yaw, -1.6 + i * 0.4, -0.24)
      if ((i + hh * 10) % 3 < 1) ib.cyl(p, hh + 0.03, 0.08, 0.12, '#b8653a', NM.plaster, 0, 10, 0.1)
      else ib.box(p, hh + 0.03, [0.14, 0.04, 0.2], ['#d8a030', '#7aa04a', '#e8d8b0'][i % 3], NM.paint, 0.2, yaw)
    }
  }
  // 看板（アーケードのアーチの下）
  frame(ib, 'happaya-sign', at(front, yaw, 0, -0.1), 3.6, 2.2, 0.55, a + Math.PI, '#3a2a1a')
  ib.glowBulb(at(front, yaw, 0, 0.3), 3.0, 0.1, '#ffe2b0', lamps.happaya, 6)
}

function control(ib: B, lamps: DomeLampIx) {
  const Cc = DOME.control
  const h = DOME.L1.h
  const r0 = DOME.L1.r1 + 0.05
  const r1 = Cc.r1 - 0.15
  const door = [14.5 * DEG, 17.5 * DEG]
  level(ib, 1)
  // ガラスの壁（障害物。扉の所は開ける）: 内の辺（回廊の側）・外の辺・両の端
  const wallSeg = (a: L2, b: L2, name: string) => {
    const c: L2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const yaw = Math.atan2(b[1] - a[1], b[0] - a[0])
    ib.block(name, c, L, 0.14, h, h + 3.0, yaw, true, true)
    if (ib.dry) return
    here(ib, c[0], c[1])
    ib.glass([a[0], a[1], h + 0.1], [b[0], b[1], h + 0.1], [b[0], b[1], h + 2.9], [a[0], a[1], h + 2.9])
    ib.box(c, h, [L, 0.08, 0.1], '#3a3e42', NM.paint, 0.5, yaw)
    ib.box(c, h + 2.9, [L, 0.1, 0.12], '#3a3e42', NM.paint, 0.5, yaw)
    ib.box(a, h, [0.08, 0.08, 3.0], '#3a3e42', NM.paint, 0.5, yaw)
  }
  const ring = (r: number, q0: number, q1: number) => arcPts(r, q0, q1, 1.6)
  for (const [q0, q1] of [
    [Cc.a0, door[0]],
    [door[1], Cc.a1],
  ]) {
    const pts = ring(r0, q0, q1)
    for (let i = 1; i < pts.length; i++) wallSeg(pts[i - 1], pts[i], '管制室のガラスの壁')
  }
  const outer = ring(r1, Cc.a0, Cc.a1)
  for (let i = 1; i < outer.length; i++) wallSeg(outer[i - 1], outer[i], '管制室のガラスの壁')
  wallSeg(P(r0, Cc.a0), P(r1, Cc.a0), '管制室のガラスの壁')
  wallSeg(P(r0, Cc.a1), P(r1, Cc.a1), '管制室のガラスの壁')
  // 屋根（薄い板）
  ringSlab(ib, r0, r1, Cc.a0, Cc.a1, h + 3.0, h + 3.12, '#3a3e42', NM.paint, 0.5, { seg: 1.6 })
  // 大きな曲面のモニタ（外の壁の前）・操作卓 2・椅子・ドームの光のホロの模型
  const myaw = (Cc.a0 + Cc.a1) / 2 + Math.PI / 2
  ib.block('操作卓', P(r1 - 1.1, (Cc.a0 + Cc.a1) / 2), 3.2, 0.7, h, h + 0.9, myaw)
  ib.disc('ホロの模型', P(r0 + 1.4, 20 * DEG), 0.6, h, h + 1.4)
  if (ib.dry) return
  const nM = 5
  for (let i = 0; i < nM; i++) {
    const q = Cc.a0 + 2 * DEG + ((Cc.a1 - Cc.a0 - 4 * DEG) * (i + 0.5)) / nM
    const p = P(r1 - 0.3, q)
    here(ib, p[0], p[1])
    ib.box(p, h + 1.1, [1.25, 0.06, 0.82], '#141416', IM.screen, 0, q + Math.PI / 2)
    ib.picture(i % 2 ? 'bain-graph' : 'bain-screen', P(r1 - 0.34, q), h + 1.51, 1.18, 0.76, q + Math.PI, 1, 0.002)
  }
  const desk = P(r1 - 1.1, (Cc.a0 + Cc.a1) / 2)
  here(ib, desk[0], desk[1])
  ib.box(desk, h, [3.2, 0.7, 0.74], '#2a2e32', NM.paint, 0.4, myaw)
  ib.box(desk, h + 0.74, [3.3, 0.78, 0.04], '#3a4046', IM.plastic, 0.4, myaw)
  for (const dx of [-0.9, 0.6]) {
    ib.box(at(desk, myaw, dx, -0.1), h + 0.78, [0.42, 0.14, 0.02], '#2a2a2c', IM.plastic, 0.3, myaw)
    ib.picture('bain-graph', at(desk, myaw, dx, 0.18), h + 1.0, 0.5, 0.32, myaw - Math.PI / 2 + Math.PI, 1, 0.002, -0.2)
  }
  // ドームのホロの模型（光る網の半球）
  const hc = P(r0 + 1.4, 20 * DEG)
  ib.cyl(hc, h, 0.45, 0.8, '#2a2e32', NM.paint, 0.4, 16)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI
    for (let k = 0; k < 6; k++) {
      const t0 = (k / 6) * (Math.PI / 2)
      const t1 = ((k + 1) / 6) * (Math.PI / 2)
      const p0: V3 = [hc[0] + Math.cos(a) * Math.cos(t0) * 0.5, hc[1] + Math.sin(a) * Math.cos(t0) * 0.5, h + 0.85 + Math.sin(t0) * 0.42]
      const p1: V3 = [hc[0] + Math.cos(a) * Math.cos(t1) * 0.5, hc[1] + Math.sin(a) * Math.cos(t1) * 0.5, h + 0.85 + Math.sin(t1) * 0.42]
      const q0: V3 = [hc[0] - Math.cos(a) * Math.cos(t0) * 0.5, hc[1] - Math.sin(a) * Math.cos(t0) * 0.5, p0[2]]
      const q1: V3 = [hc[0] - Math.cos(a) * Math.cos(t1) * 0.5, hc[1] - Math.sin(a) * Math.cos(t1) * 0.5, p1[2]]
      for (const [u, v] of [
        [p0, p1],
        [q0, q1],
      ]) {
        const mid: L2 = [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2]
        ib.glowBox(mid, (u[2] + v[2]) / 2 - 0.035, [0.012, 0.012, 0.07], '#7dffb0', lamps.screen, 3)
      }
    }
  }
  ib.glowCyl(hc, h + 0.8, 0.5, 0.02, '#7dffb0', lamps.screen, 2)
  // 椅子（丸椅子でなく、事務の椅子）と天井の灯り
  for (const dx of [-0.9, 0.6]) {
    const p = at(desk, myaw, dx, -0.75)
    ib.cyl(p, h, 0.25, 0.05, '#2a2a2c', IM.plastic, 0.3, 10)
    ib.cyl(p, h + 0.05, 0.03, 0.4, '#2a2a2c', NM.steel, 0, 8)
    ib.box(p, h + 0.45, [0.48, 0.48, 0.08], '#1e2a3a', IM.fabric, 0, myaw)
    ib.box(at(p, myaw, 0, -0.22), h + 0.53, [0.46, 0.06, 0.5], '#1e2a3a', IM.fabric, 0, myaw)
  }
  ib.glowBox(P((r0 + r1) / 2, (Cc.a0 + Cc.a1) / 2), h + 2.95, [2.6, 0.3, 0.03], '#eef6ff', lamps.control, 2.2, myaw)
  // 回廊の側の札「光脈管制室」
  frame(ib, 'bain-sign', P(r0 - 0.02, door[0] - 2.2 * DEG), h + 2.2, 0.9, 0.3, (Cc.a0 + Cc.a1) / 2 + Math.PI, '#2a2e32')
}

/* -------------------------------------------------------------------------- */
/* 種の間（地下）・吹き抜けの手すり                                                 */
/* -------------------------------------------------------------------------- */

function seeds(ib: B, lamps: DomeLampIx) {
  const b1 = DOME.b1
  const st = b1.stair
  // 根の階の吹き抜けの手すり（三方）
  balustrade(ib, [[st.s0 - 0.12, st.t0 + 0.6], [st.s0 - 0.12, st.t1 + 0.12], [st.s1 + 0.12, st.t1 + 0.12], [st.s1 + 0.12, st.t0 + 0.6]], 0, 0, -1)
  if (!ib.dry) {
    here(ib, (st.s0 + st.s1) / 2, st.t0)
    // 吹き抜けの縁の小口
    ib.box([(st.s0 + st.s1) / 2, st.t1 + 0.06], -0.6, [st.s1 - st.s0 + 0.3, 0.12, 0.6], C.stoneShade, NM.stone, 0)
    for (const s of [st.s0 - 0.06, st.s1 + 0.06]) ib.box([s, (st.t0 + st.t1) / 2], -0.6, [0.12, st.t1 - st.t0, 0.6], C.stoneShade, NM.stone, 0)
    frame(ib, 'seed-sign', [st.s1 + 0.5, st.t0 + 0.3], 1.6, 0.9, 0.36, -Math.PI / 2, '#2a3a2e')
    ib.box([st.s1 + 0.5, st.t0 + 0.32], 0, [0.08, 0.08, 1.42], '#2a2a28', NM.iron, 0.3)
  }
  ib.room('seeds')
  const H = b1.hall
  const vt = H.t1
  // ガラスの壁（見学の通路 → 保存庫）。方立てと腰の石・障害物
  ib.block('ガラスの壁', [0, vt], H.s1 - H.s0, 0.16, 0, 3.4)
  if (ib.dry) return
  ib.chunk('core')
  ib.box([0, vt], 0, [H.s1 - H.s0, 0.18, 0.4], '#3a3e3a', NM.granite, 0)
  for (let i = 0; i <= 7; i++) {
    const s = H.s0 + ((H.s1 - H.s0) * i) / 7
    ib.box([s, vt], 0.4, [0.08, 0.12, 3.5], '#2a2e30', NM.paint, 0.5)
  }
  ib.glass([H.s0, vt, 0.4], [H.s1, vt, 0.4], [H.s1, vt, 3.86], [H.s0, vt, 3.86])
  // 保存庫（奥）: 種子の瓶の棚・冷凍保存の扉（霜）・増殖室の LED の棚（紫）
  ib.room('vault')
  for (let row = 0; row < 3; row++) {
    const t = vt + 1.6 + row * 2.2
    for (const sgn of [-1, 1]) {
      const c: L2 = [sgn * 3.6, t]
      ib.box(c, 0, [5.6, 0.5, 2.6], '#d8dcde', NM.steel, 0)
      for (let k = 0; k < 4; k++) {
        const hh = 0.35 + k * 0.58
        ib.box([c[0], t - 0.26], hh, [5.5, 0.03, 0.02], '#9aa0a4', NM.steel, 0)
        for (let j = 0; j < 18; j++) {
          const s = c[0] - 2.6 + j * 0.305
          const col = row === 2 ? '#d8b0f0' : ['#c8a060', '#8a6a3a', '#e0d0a0', '#6a8a4a'][(j + k) % 4]
          if (row === 2) ib.glowBox([s, t - 0.3], hh + 0.03, [0.2, 0.06, 0.12], col, lamps.vault, 1.6)
          else ib.cyl([s, t - 0.29], hh + 0.02, 0.05, 0.16, col, IM.plastic, 0.85, 8)
        }
      }
    }
  }
  // 冷凍保存の扉（いちばん奥の壁）
  for (let i = 0; i < 4; i++) {
    const s = -4.5 + i * 3
    ib.box([s, b1.vault.t1 - 0.1], 0, [2.4, 0.12, 2.9], '#e8eef2', NM.steel, 0)
    ib.box([s, b1.vault.t1 - 0.17], 1.2, [0.06, 0.04, 0.6], '#8a9094', NM.steel, 0)
    ib.box([s, b1.vault.t1 - 0.17], 2.3, [1.2, 0.012, 0.3], '#2a6aaa', NM.paint, 0.4)
  }
  ib.glowBox([0, (vt + b1.vault.t1) / 2], -b1.h + b1.ceil - 0.05 - 0.02, [12, 6, 0.02], '#e8f4ff', lamps.vault, 0.6)
  // 見学の通路: ベンチ・説明の札・天井の灯り
  ib.room('seeds')
  for (const s of [-4.2, 4.2]) {
    ib.box([s, H.t0 + 1.0], 0, [2.0, 0.5, 0.42], '#4a5048', NM.stone, 0)
    ib.box([s, H.t0 + 1.0], 0.42, [2.04, 0.54, 0.05], '#8a6a48', NM.wood, 0)
  }
  frame(ib, 'seed-panel', [-1.6, vt - 0.1], 1.55, 1.2, 0.8, -Math.PI / 2, '#2a2e30')
  for (const s of [-3.5, 0, 3.5]) {
    ib.box([s, (H.t0 + H.t1) / 2], -b1.h + b1.ceil - 0.06, [2.4, 0.3, 0.05], '#e8e8e4', NM.paint, 0.4)
    ib.glowBox([s, (H.t0 + H.t1) / 2], -b1.h + b1.ceil - 0.08, [2.3, 0.24, 0.02], '#eef4ff', lamps.seeds, 2.2)
  }
  ib.room('seeds-stair')
  ib.glowBox([(st.s0 + st.s1) / 2, st.t1 - 0.4], 2.6, [1.6, 0.08, 0.04], '#eef4ff', lamps.seedsStair, 2)
}

/* -------------------------------------------------------------------------- */
/* 入口の張り出しの中（案内図・ベンチ）と、ドームの側の開口の縁                           */
/* -------------------------------------------------------------------------- */

function gates(ib: B) {
  const S = DOME.gates.south
  ib.room('gate-s')
  if (!ib.dry) {
    ib.chunk(chunkAt(0, -60))
    // 案内図（館内の 4 層）と案内のカウンター
    frame(ib, 'dome-map', [S.s0 + 0.62, -60.5], 1.9, 1.6, 1.1, 0, '#2a3a2e')
    ib.box([S.s1 - 1.2, -61.5], 0, [0.6, 2.0, 1.0], '#6a4a30', NM.boardV, 0.12)
    ib.box([S.s1 - 1.2, -61.5], 1.0, [0.7, 2.1, 0.05], '#8a6a48', NM.wood, 0)
    // 床の模様（白と灰の石の帯）
    ib.box([0, -60.7], 0.005, [S.innerW, 7.6, 0.008], '#bdb4a2', NM.paving, 0)
  }
  ib.block('案内のカウンター', [S.s1 - 1.2, -61.5], 0.7, 2.1, 0, 1.05)
  // ドームの側の開口の縁（アーチの額縁）
  ib.room('hall')
  level(ib, 0)
  if (ib.dry) return
  for (const g of [
    { c: [0, S.t1] as L2, yaw: 0, w: S.innerW, h: S.innerH },
    { c: [DOME.gates.west.s1, 0] as L2, yaw: Math.PI / 2, w: DOME.gates.west.innerW, h: DOME.gates.west.innerH },
    { c: [0, DOME.gates.north.t0] as L2, yaw: 0, w: DOME.gates.north.innerW, h: DOME.gates.north.innerH },
  ]) {
    ib.chunk(chunkAt(g.c[0], g.c[1]))
    for (const side of [-1, 1]) ib.box(at(g.c, g.yaw, side * (g.w / 2 + 0.18), 0), 0, [0.36, 0.42, g.h + 0.3], C.stone, NM.stone, 0, g.yaw)
    ib.box(g.c, g.h, [g.w + 0.72, 0.44, 0.4], C.stone, NM.stone, 0, g.yaw)
  }
}

/* -------------------------------------------------------------------------- */
/* まとめ                                                                       */
/* -------------------------------------------------------------------------- */

/** ドームの中の形（furnish から呼ぶ） */
export function domeStructure(ib: B, lamps: DomeLampIx) {
  ib.room('hall')
  ground(ib)
  plinth(ib)
  paths(ib)
  pool(ib)
  core(ib)
  landing(ib, lamps)
  terrace(ib, lamps)
  spiralStair(ib, lamps)
  galleryL1(ib, lamps)
  galleryL2(ib, lamps)
  arcRamp(ib, DOME.rampA, 0, DOME.L1.h, lamps)
  arcRamp(ib, DOME.rampB, DOME.L1.h, DOME.L2.h, lamps)
  for (const b of DOME.bridges) bridge(ib, b, lamps)
  komorebi(ib, lamps)
  happaya(ib, lamps)
  control(ib, lamps)
  seeds(ib, lamps)
  gates(ib)
  // 道の灯り（南の入口の道の両側の行灯）
  ib.room('hall')
  level(ib, 0)
  for (const t of [-48, -30]) {
    for (const side of [-1, 1]) {
      const c: L2 = [side * (DOME.southPathW / 2 + 0.55), t]
      ib.disc('行灯', c, 0.25, 0, 1.2, true, false)
      if (ib.dry) continue
      here(ib, c[0], c[1])
      ib.box(c, 0, [0.3, 0.3, 0.9], '#2a2a28', NM.iron, 0.3)
      ib.glowBox(c, 0.55, [0.22, 0.22, 0.3], '#ffe2b0', lamps.path, 3)
    }
  }
  ib.chunk(null)
  void glassHeight
}
