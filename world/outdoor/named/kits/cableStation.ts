import * as THREE from 'three'
import { CABLE_STATIONS, type CableStationDef, stationPlan } from '../../../../core/cableStations'
import { ROOF } from '../../town/buildingKit'
import { Frame } from '../frame'
import { canopy, fbox, flatRoof, gableRoof, type Kit, type Opening, wallLamp } from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import { railing } from '../parts'
import { buildBody, type FaceSpec } from '../shell'
import type { KitContext } from './index'

/**
 * 丘ノ上ケーブルの 3 駅の外観（docs/design/town.md §19・§7 の 179〜）。駅の局所の座標（core/cableStations.ts。s = 線路に沿って山の側へ、
 * t = 北西へ）の Frame（named/frame.ts と同じ向き）で書く。
 *
 * - 頂上駅・麓駅: クリームの壁・腰のタイル・赤の帯・緑の陸屋根と深い庇。床（コンコース）は入口の外の地面に合わせた高さ。
 *   中（コンコース・改札・待合室・段々のホーム）は中のある建物の仕組み（interior/briefs/cable.ts）が作る。
 *   線路が駅舎の壁を抜ける所（頂上駅は南西の面、麓駅は北東の面）は車両が通る口をあける。
 *   頂上駅: 出口は北東の面の真ん中（自動のガラスの両開き）。南東の面（ホームの側）は湾と町を見下ろす大きな窓。
 *   麓駅: 入口は正面（ふもとの道に沿う斜めの面）の北西の寄りの開いた口（扉なし。ひさしと駅名）。線路の上に車庫の上屋（緑の切妻）
 * - 楓坂駅: 行き違い線を覆う 3 段の上屋（緑の屋根・鉄の柱）の下に、両側の段々のホーム（車両の 4 つの区画の床の高さ）・山の端の構内踏切・
 *   西口の段と改札・詰所・ベンチ・駅名標・灯り。歩ける所と障害物は interior/briefs/cable.ts
 */

const RED = '#b71c1c'
const CREAM = '#f3e9d2'
const GREEN = '#2f6b3a'
const YELLOW = '#d9b23a'
const CONCRETE = '#b9b4aa'

/** 駅の Frame（駅の局所の座標。h は駅の床から） */
const frameOf = (d: CableStationDef) => new Frame(d.frame.ox, d.frame.oy, d.frame.ax, d.frame.ay, d.frame.z)

/** 外形の辺 i の、駅の局所の端の点 */
function edgeLocal(d: CableStationDef, p: readonly [number, number]) {
  const f = d.frame
  const dx = p[0] - f.ox
  const dy = p[1] - f.oy
  return [dx * f.ax + dy * f.ay, dx * f.bx + dy * f.by] as [number, number]
}

/** 辺 p → q の上で、駅の局所の点 (s, t) に近い所の辺の上の長さ */
function alongEdge(d: CableStationDef, p: readonly [number, number], q: readonly [number, number], s: number, t: number) {
  const [x, y] = stationPlan(d, s, t)
  const ex = q[0] - p[0]
  const ey = q[1] - p[1]
  const l = Math.hypot(ex, ey) || 1
  return ((x - p[0]) * ex + (y - p[1]) * ey) / l
}

export function cableStation(k: Kit, ctx: KitContext) {
  const d = Object.values(CABLE_STATIONS).find((s) => s.buildingId === k.rec.id)
  if (!d) return
  if (d.zone === 'cable-kaedezaka') kaedezaka(k, ctx, d)
  else stationHall(k, ctx, d)
}

/* -------------------------------------------------------------------------- */
/* 頂上駅・麓駅（駅舎）                                                           */
/* -------------------------------------------------------------------------- */

function stationHall(k: Kit, ctx: KitContext, d: CableStationDef) {
  const rec = k.rec
  const summit = d.zone === 'cable-summit'
  const z = d.frame.z
  const top = summit ? 4.6 : 6.2
  const ring = rec.ring
  const n = ring.length
  const bottom = Math.min(rec.gLow, z) - z - 0.6
  // 線路が壁を抜ける口（車両が通る。レールの高さ − 0.5m から + 3.6m、幅 3.6m）
  const railAt = (s: number) => {
    const c = ctx.infra.cable
    if (!c) return z
    const [x, y] = stationPlan(d, s, 0)
    let best = Infinity
    let zb = z
    for (let i = 1; i < c.pts.length; i++) {
      const a = c.pts[i - 1]
      const b = c.pts[i]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const l2 = dx * dx + dy * dy || 1
      const u = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
      const dd = Math.hypot(a[0] + dx * u - x, a[1] + dy * u - y)
      if (dd < best) {
        best = dd
        zb = a[2] + (b[2] - a[2]) * u
      }
    }
    return zb
  }
  const faces: (FaceSpec | null)[] = []
  let frontEdge = 0
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    const a = edgeLocal(d, p)
    const b = edgeLocal(d, q)
    const along = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])
    const midS = (a[0] + b[0]) / 2
    const midT = (a[1] + b[1]) / 2
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    const plain = { w: 2.0, ht: 1.8, sill: 1.0, glass: { kind: GLASS.office, cls: LIGHT_CLASS.night, cols: 2, rows: 1, bar: 0.05, frame: '#e8e2d2' }, depth: 0.14 }
    if (summit) {
      if (!along && midS > 20) {
        // 北東の面（出口）: 真ん中に自動のガラスの両開き
        frontEdge = i
        const ds = alongEdge(d, p, q, 37, 0)
        faces.push({ win: plain, bay: 3.0, minLen: 2, doors: [{ s: ds, w: 2.4, ht: 2.6, style: { kind: 'doubleGlass', color: GREEN, transom: 0.6, operable: 0, glass: { kind: GLASS.office, cls: LIGHT_CLASS.night } } }] })
      } else if (!along) {
        // 南西の面: 線路の口
        const ds = alongEdge(d, p, q, 0, 0)
        const r = railAt(0.3) - z
        faces.push({ win: null, bay: 3.0, openings: [{ s: ds - 1.8, h: r - 0.55, w: 3.6, ht: Math.min(top - 0.3, r + 3.6) - (r - 0.55), fill: 'void', revealColor: CONCRETE, revealMat: NM.concrete }] })
      } else if (midT < 0) {
        // 南東の面（ホームの側）: 湾と町を見下ろす大きな窓
        faces.push({ win: { w: 2.3, ht: 2.75, sill: 0.85, glass: { kind: GLASS.office, cls: LIGHT_CLASS.night, cols: 2, rows: 2, bar: 0.05, frame: '#e8e2d2' }, depth: 0.12 }, bay: 2.6, minLen: 3 })
      } else {
        // 北西の面: 待合室の窓
        faces.push({ win: plain, bay: 3.4, minLen: 3 })
      }
    } else {
      const front = rec.frontEdge && Math.hypot(p[0] - rec.frontEdge[1][0], p[1] - rec.frontEdge[1][1]) < 0.5 && Math.hypot(q[0] - rec.frontEdge[0][0], q[1] - rec.frontEdge[0][1]) < 0.5
      if (front) {
        // 正面（ふもとの道に沿う斜めの面）: 北西の寄りに開いた入口（扉なし）
        frontEdge = i
        const ds = alongEdge(d, p, q, 8.74, 3.0)
        const door: Opening = { s: ds - 1.3, h: 0, w: 2.6, ht: 2.9, fill: 'void', revealColor: '#d8cdb4', revealMat: NM.tileClad }
        faces.push({ win: plain, bay: 3.2, minLen: 2, openings: [door] })
      } else if (!along && midS > 40) {
        // 北東の面: 線路の口
        const ds = alongEdge(d, p, q, 48, 0)
        const r = railAt(47.6) - z
        faces.push({ win: null, bay: 3.0, openings: [{ s: ds - 1.8, h: r - 0.55, w: 3.6, ht: top - 0.25 - (r - 0.55), fill: 'void', revealColor: CONCRETE, revealMat: NM.concrete }] })
      } else if (along && midT > 0) {
        // 北西の面（ホームの側）: ホームの床の高さに合わせた窓
        faces.push({ win: { w: 2.2, ht: 2.0, sill: 2.55, glass: { kind: GLASS.office, cls: LIGHT_CLASS.night, cols: 2, rows: 1, bar: 0.05, frame: '#e8e2d2' }, depth: 0.12 }, bay: 3.2, minLen: 3 })
      } else faces.push({ win: { ...plain, sill: 2.4 }, bay: 3.4, minLen: 3 })
    }
    void L
  }
  k.mass.st = { wall: [243, 233, 210], facade: 1, roof: [46, 125, 50], roofKind: ROOF.flat, use: 6, flags: 1, seed: k.seed, style: 0, floors: 1 }
  const built = buildBody(k, {
    ring,
    z,
    bottom,
    floors: 1,
    floorH: top,
    top,
    wall: { color: CREAM, mat: NM.plaster },
    wallLower: { color: '#d8cdb4', mat: NM.tileClad, aux: 0.1, h: 0.85 },
    bands: { hs: [0.85], ht: 0.25, proj: 0.04, color: RED, mat: NM.paint },
    faces,
    frontEdge,
  })
  // 陸屋根（緑の深い庇と、帯の縁）
  flatRoof(k, ring, z, top + 0.45, 0.45, CREAM, NM.plaster, '#7d7b76', GREEN)
  for (const fc of built) fbox(k.solid, fc.f, -0.9, fc.L + 0.9, -1.1, 0.0, top + 0.45, top + 0.75, GREEN, NM.paint, 0.4)
  // 入口のひさしと駅名・壁の灯り
  const ff = built[frontEdge]
  const F = frameOf(d)
  if (summit) {
    const ds = alongEdge(d, ring[frontEdge], ring[(frontEdge + 1) % n], 37, 0)
    canopy(k, ff.f, ds - 2.6, ds + 2.6, 2.95, 1.7, GREEN, NM.metalRoof)
    k.sign(ff.f, ds - 2.7, 3.25, 5.4, 0.85, -0.1, { text: '丘ノ上ケーブル 頂上駅', sub: 'OKANOUE CABLE  SUMMIT', fg: '#f8f3e6', bg: GREEN, border: '#f3e9d2', font: 'sans', bold: true }, 1)
    wallLamp(k, ff.f, ds - 1.75, 2.6, 'bulb')
    wallLamp(k, ff.f, ds + 1.75, 2.6, 'bulb')
    // 出口の前の段（地面へ）と、線路の口の上の庇
    fbox(k.solid, F, 37.0, 38.2, -1.8, 1.8, -0.6, 0.0, '#a8a296', NM.granite)
  } else {
    const ds = alongEdge(d, ring[frontEdge], ring[(frontEdge + 1) % n], 8.74, 3.0)
    canopy(k, ff.f, ds - 2.4, ds + 2.4, 3.15, 1.8, GREEN, NM.metalRoof)
    k.sign(ff.f, ds - 2.6, 3.45, 5.2, 0.85, -0.1, { text: '丘ノ上ケーブル 麓駅', sub: 'OKANOUE CABLE  FUMOTO', fg: '#f8f3e6', bg: GREEN, border: '#f3e9d2', font: 'sans', bold: true }, 1)
    wallLamp(k, ff.f, ds - 1.75, 2.7, 'bulb')
    wallLamp(k, ff.f, ds + 1.75, 2.7, 'bulb')
    // 車庫の上屋（線路の上の緑の切妻。陸屋根の上に）
    for (const p of rec.parts) {
      const pr = p.ring
      const pf = Frame.edge(pr[0], pr[1], z)
      const W = Math.hypot(pr[1][0] - pr[0][0], pr[1][1] - pr[0][1])
      const D = Math.hypot(pr[2][0] - pr[1][0], pr[2][1] - pr[1][1])
      fbox(k.solid, pf, 0.2, W - 0.2, 0.2, D - 0.2, top + 0.45, top + 0.95, CREAM, NM.plaster)
      gableRoof(k, pf, W, D, top + 0.95, top + 2.1, { color: GREEN, mat: NM.metalRoof, aux: 0.12, eave: 0.6, soffit: '#e8e2d2', fascia: GREEN, gable: { color: CREAM, mat: NM.plaster } })
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 楓坂駅（上屋の下の段々のホーム）                                                  */
/* -------------------------------------------------------------------------- */

/** 楓坂駅の歩ける所の寸法（interior/briefs/cable.ts と同じ値） */
export const KAEDE = {
  /** ホームの段の s の範囲（谷の端・山の端）。谷の端は北西（西口の側）が長い */
  sLow: { '1': 1.0, '-1': 5.6 },
  sHigh: 19.4,
  /** 構内踏切（s の範囲・高さ） */
  cross: { s0: 19.9, s1: 21.3, h: 0.98 },
  /** ホームの外の縁（|t|） */
  outer: 6.6,
  /** 西口（北西の縁の s の範囲・外の地面の高さ） */
  gate: { s0: 3.5, s1: 5.7, h: -0.06 },
} as const

function kaedezaka(k: Kit, ctx: KitContext, d: CableStationDef) {
  const F = frameOf(d)
  const b = k.solid
  const z = d.frame.z
  const ground = (s: number, t: number) => ctx.heightAt(...stationPlan(d, s, t)) - z
  k.mass.st = { wall: [243, 233, 210], facade: 1, roof: [46, 125, 50], roofKind: ROOF.shed, use: 6, flags: 1, seed: k.seed, style: 0, floors: 1 }
  // --- 上屋（3 段。鉄の柱と緑の屋根。高さは段ごとの線路から 3.9m） ---
  const sections: [number, number][] = [
    [-0.2, 8.0],
    [8.0, 16.0],
    [16.0, 24.2],
  ]
  for (const [s0, s1] of sections) {
    const hc = d.comps[0].h - 0.98 + ((s0 + s1) / 2 - 7.5) * 0.12 + 3.9
    for (const t of [-6.75, 0, 6.75])
      for (const s of [s0 + 0.35, s1 - 0.35]) {
        const g = Math.min(ground(s, t), 0)
        fbox(b, F, s - 0.11, s + 0.11, t - 0.11, t + 0.11, g - 0.3, hc, GREEN, NM.paint, 0.4)
      }
    // 梁（横と縦）
    for (const s of [s0 + 0.35, s1 - 0.35]) fbox(b, F, s - 0.09, s + 0.09, -7.0, 7.0, hc - 0.32, hc, GREEN, NM.paint, 0.4)
    for (const t of [-6.75, 0, 6.75]) fbox(b, F, s0, s1, t - 0.08, t + 0.08, hc - 0.28, hc, GREEN, NM.paint, 0.4)
    // 屋根（裏は白い板）
    fbox(b, F, s0 - 0.25, s1 + 0.25, -7.5, 7.5, hc + 0.15, hc + 0.4, GREEN, NM.metalRoof, 0.12)
    fbox(b, F, s0 - 0.25, s1 + 0.25, -7.5, 7.5, hc, hc + 0.15, '#e8e2d2', NM.paint, 0.3)
    k.mass.prism(
      [
        [s0, -7.5],
        [s1, -7.5],
        [s1, 7.5],
        [s0, 7.5],
      ].map(([s, t]) => stationPlan(d, s, t)),
      z + hc,
      z + hc + 0.4,
      z + hc - 3,
      0,
    )
    // 灯り（屋根の下に 2 つずつ。両側のホームの上）
    for (const t of [-5.0, 5.0]) {
      const p = F.p((s0 + s1) / 2, t, hc - 0.05)
      k.glow.box(p, [1.4, 0.08, 0.22], '#fff4e0', 0, 2.4, F.yaw)
      k.lamp([p[0], p[1] - 0.1, p[2]], 9, '#ffe2b8', 1.7, 0.6, 1)
    }
  }
  // --- 段々のホーム（両側。区画ごとの段・段の間の 2 段・縁の黄色い点字の帯と白い線・外の縁の柵） ---
  const edge = d.edgeT
  const outer = KAEDE.outer
  for (const side of [1, -1] as const) {
    const tIn = side * edge
    const tOut = side * outer
    const lo = KAEDE.sLow[side > 0 ? '1' : '-1']
    for (let i = 0; i < 4; i++) {
      const c = d.comps[i]
      const s0 = i === 0 ? lo : d.comps[i].s0 + 0.15
      const s1 = i === 3 ? KAEDE.sHigh : d.comps[i].s1 - 0.15
      const gl = Math.min(ground(s0, tOut), ground(s1, tOut), ground(s0, tIn), ground(s1, tIn)) - 0.4
      fbox(b, F, s0, s1, tIn, tOut, gl, c.h, '#b4afa5', NM.concrete)
      // 縁の黄色い点字の帯と白い線
      fbox(b, F, s0, s1, tIn + side * 0.42, tIn + side * 0.72, c.h, c.h + 0.006, YELLOW, NM.tileClad, 0.05)
      fbox(b, F, s0, s1, tIn + side * 0.08, tIn + side * 0.16, c.h, c.h + 0.004, '#f2f0ea', NM.paint, 0.2)
      if (i < 3) {
        // 段の間の 2 段（区画の境の前後 0.15m）
        const n = d.comps[i + 1]
        const bnd = c.s1
        const rise = (n.h - c.h) / 2
        fbox(b, F, bnd - 0.15, bnd + 0.15, tIn, tOut, gl, c.h + rise, '#b4afa5', NM.concrete)
        fbox(b, F, bnd - 0.15, bnd - 0.11, tIn, tOut, c.h + rise - 0.004, c.h + rise + 0.002, YELLOW, NM.tileClad, 0.05)
        fbox(b, F, bnd + 0.15, bnd + 0.19, tIn, tOut, n.h - 0.004, n.h + 0.002, YELLOW, NM.tileClad, 0.05)
      }
    }
    // 山の端: 構内踏切へ下りる 2 段
    const h3 = d.comps[3].h
    const hc = KAEDE.cross.h
    const r = (h3 - hc) / 2
    fbox(b, F, KAEDE.sHigh, KAEDE.sHigh + 0.25, tIn, tOut, ground(KAEDE.sHigh, tOut) - 0.4, h3 - r, '#b4afa5', NM.concrete)
    fbox(b, F, KAEDE.sHigh + 0.25, KAEDE.cross.s0, tIn, tOut, ground(KAEDE.cross.s0, tOut) - 0.4, hc - 0.02, '#b4afa5', NM.concrete)
    // 外の縁の柵（西口を除く）。南東は地面が低いので腰壁の上に
    const fence = (a: number, c2: number) => {
      fbox(b, F, a, c2, tOut - side * 0.05, tOut + side * 0.1, -4, d.comps[0].h + 0.3, CONCRETE, NM.concrete)
      railing(k, F, a, c2, tOut + side * 0.02, d.comps[3].h, 1.0, '#3f4a44', NM.iron, 1.0, 0.11)
    }
    if (side > 0) {
      fence(lo, KAEDE.gate.s0)
      fence(KAEDE.gate.s1, KAEDE.cross.s0)
    } else fence(lo, KAEDE.cross.s0)
    // 谷の端の柵（柱と 2 本の横の棒）
    const h0e = d.comps[0].h
    for (const t of [tIn + side * 0.3, (tIn + tOut) / 2, tOut]) fbox(b, F, lo - 0.05, lo + 0.03, t - 0.04, t + 0.04, h0e, h0e + 1.05, '#3f4a44', NM.iron, 0.3)
    for (const hh of [0.45, 1.0]) fbox(b, F, lo - 0.04, lo + 0.02, Math.min(tIn, tOut) + 0.3 * (side > 0 ? 1 : 0), Math.max(tIn, tOut) - 0.3 * (side < 0 ? 1 : 0), h0e + hh, h0e + hh + 0.05, '#3f4a44', NM.iron, 0.3)
    // ベンチ（外の縁を背に、線路を向く）と駅名標
    for (const i of [1, 2]) {
      const c = d.comps[i]
      const tb = side * (outer - 0.55)
      fbox(b, F, c.door - 0.8, c.door + 0.8, tb - 0.22, tb + 0.22, c.h + 0.4, c.h + 0.45, '#8a5a34', NM.wood, 0)
      for (const s of [c.door - 0.7, c.door + 0.7]) fbox(b, F, s - 0.04, s + 0.04, tb - 0.18, tb + 0.18, c.h, c.h + 0.4, '#3f4a44', NM.iron, 0.3)
      fbox(b, F, c.door - 0.8, c.door + 0.8, side * (outer - 0.32), side * (outer - 0.28), c.h + 0.45, c.h + 0.85, '#8a5a34', NM.wood, 0)
    }
    const cn = d.comps[3]
    const ns = cn.door + 1.2
    const nt = side * (outer - 0.4)
    for (const s of [ns - 1.0, ns + 1.0]) fbox(b, F, s - 0.04, s + 0.04, nt - 0.04, nt + 0.04, cn.h, cn.h + 2.3, '#3f4a44', NM.iron, 0.3)
    // 駅名標の板（裏は白い板）
    fbox(b, F, ns - 1.12, ns + 1.12, nt - 0.03, nt + 0.03, cn.h + 1.56, cn.h + 2.24, '#e8e4d8', NM.paint, 0.3)
    // 線路の側を向く（北西のホームは南東を、南東のホームは北西を）
    const sf = side > 0 ? new Frame(...stationPlan(d, ns - 1.1, nt), d.frame.ax, d.frame.ay, z) : new Frame(...stationPlan(d, ns + 1.1, nt), -d.frame.ax, -d.frame.ay, z)
    k.sign(sf, 0, cn.h + 1.6, 2.2, 0.6, -0.04, { text: 'かえでざか 楓坂', sub: side > 0 ? '← ふもと　　ちょうじょう →' : '← ちょうじょう　　ふもと →', fg: '#1f2a24', bg: '#f8f6ee', border: GREEN, font: 'sans', bold: true }, 0)
  }
  // --- 構内踏切（両側のホームの間。木の板と、レールの間のゴムの板）・警報の札 ---
  const cr = KAEDE.cross
  fbox(b, F, cr.s0, cr.s1, -outer, outer, cr.h - 0.12, cr.h, '#7a5a3c', NM.wood, 0)
  for (const s of [cr.s0 - 0.05, cr.s1 + 0.05]) for (const t of [-d.loopT - 1.0, d.loopT + 1.0]) fbox(b, F, s - 0.02, s + 0.02, t - 0.02, t + 0.02, cr.h, cr.h + 0.9, '#f2f0ea', NM.paint, 0.4)
  // --- 西口（段 2 つ・改札 2 通路・詰所） ---
  const g = KAEDE.gate
  const h0 = d.comps[0].h
  fbox(b, F, g.s0, g.s1, outer, outer + 0.32, g.h - 0.4, (g.h + h0) / 2, '#a8a296', NM.granite)
  fbox(b, F, g.s0, g.s1, outer + 0.32, outer + 0.64, g.h - 0.6, g.h, '#a8a296', NM.granite)
  for (const t of [4.0, 4.95, 5.9]) {
    fbox(b, F, 5.45, 6.35, t - 0.1, t + 0.1, h0, h0 + 0.95, '#d9dcde', NM.paint, 0.6)
    fbox(b, F, 5.45, 6.35, t - 0.11, t + 0.11, h0 + 0.95, h0 + 1.02, '#2a2e33', NM.paint, 0.7)
    k.glow.box(F.p(5.6, t, h0 + 1.03), [0.14, 0.01, 0.14], '#3ab0ff', 0, 1.6, F.yaw)
  }
  // 詰所（クリームの小屋と赤の腰・窓）
  fbox(b, F, 1.2, 3.2, 4.0, 6.4, h0, h0 + 2.5, CREAM, NM.plaster)
  fbox(b, F, 1.18, 3.22, 3.98, 6.42, h0, h0 + 0.9, RED, NM.paint, 0.4)
  fbox(b, F, 1.0, 3.4, 3.8, 6.6, h0 + 2.5, h0 + 2.65, GREEN, NM.metalRoof, 0.12)
  // 詰所の窓（ゲートの側を向く）
  const gp = [F.p(3.21, 4.3, h0 + 1.0), F.p(3.21, 6.1, h0 + 1.0), F.p(3.21, 6.1, h0 + 2.1), F.p(3.21, 4.3, h0 + 2.1)]
  k.glass.add(gp, [new THREE.Vector2(0, 0), new THREE.Vector2(1.8, 0), new THREE.Vector2(1.8, 1.1), new THREE.Vector2(0, 1.1)], [[0, 1, 2], [0, 2, 3]], 1.8, 1.1, F.dir(1, 0, 0), { kind: GLASS.office, cls: LIGHT_CLASS.night, cols: 2, rows: 1, bar: 0.04, frame: GREEN })
  // 西口の上の駅名（外の北西を向く）
  const wf = new Frame(...stationPlan(d, g.s1 + 0.6, outer + 0.4), -d.frame.ax, -d.frame.ay, z)
  k.sign(wf, 0, h0 + 2.55, 3.4, 0.6, -0.02, { text: '丘ノ上ケーブル 楓坂駅', sub: 'KAEDEZAKA  西口', fg: '#f8f6ee', bg: GREEN, font: 'sans', bold: true }, 1)
  for (const s of [g.s0 - 0.05, g.s1 + 0.05]) fbox(b, F, s - 0.06, s + 0.06, outer + 0.3, outer + 0.42, h0, h0 + 3.2, GREEN, NM.paint, 0.4)
  fbox(b, F, g.s0 - 0.12, g.s1 + 0.12, outer + 0.28, outer + 0.44, h0 + 2.45, h0 + 3.25, GREEN, NM.paint, 0.4)
  wallLamp(k, wf, 1.7, h0 + 2.3, 'bulb')
}
