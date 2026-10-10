import { CABLE_STATIONS, railH, type CableStationDef } from '../../../../core/cableStations'
import { KAEDE } from '../../named/kits/cableStation'
import { NM } from '../../named/namedMaterial'
import type { InteriorBuilder } from '../builder'
import { plant } from '../furniture'
import { IM } from '../interiorMaterial'
import { insetPoly, type InteriorModel } from '../model'
import type { Finish, InteriorBrief, L2, LampDef, OutdoorArea, StairDef } from '../types'

/**
 * 丘ノ上ケーブルの 3 駅の中（docs/design/town.md §19・§7 の 179〜）。駅の局所の座標（core/cableStations.ts。s = 線路に沿って山の側へ、
 * t = 北西へ、h = 駅の床から）。ホームの段（landing）は止まった車両の 4 つの区画の床の高さで、段の間は 2 段（頂上駅・楓坂駅）か 1 段（麓駅）。
 *
 * - 頂上駅: 北東の出口 → コンコース（床 = 出口の外の地面）→ 南東の側の改札（自動改札 2 通路と窓口）→ 3 段上ってホームの山の端 →
 *   段々のホーム（湾と町を見下ろす大きな窓）。北西の側は待合室（ベンチと自動販売機コーナー。vol2 2章⑥）。線路の終わりは車止め、
 *   車両の北西の横は保線の床（歩かない。かえで号の KB-001 が並走して待つ所）
 * - 麓駅: 正面の開いた入口 → コンコース（窓口と改札）→ 8 段の階段でホームの谷の端 → 北西の側の段々のホーム。線路の谷の端は車止め、
 *   南東の側は保線の床
 * - 楓坂駅（上屋の下。形は外観の型 named/kits/cableStation.ts）: 西口の 2 段 → 改札 → 北西のホーム（かえで号）。南東のホーム（さくら号）へは
 *   山の端の構内踏切を渡る。ここでは歩ける所・段・障害物だけ（形は作らない）
 */

const F = (color: string, mat: number, aux = 0): Finish => ({ color, mat, aux })

const CREAM = '#efe8d6'
const GREEN = '#2f6b3a'
const RED = '#b71c1c'
const YELLOW = '#d9b23a'
const FLOOR_TILE = '#c9c2b4'
const CONCRETE = '#b4afa5'

/** 長方形の多角形（局所。反時計回り） */
const rect = (s0: number, s1: number, t0: number, t1: number): L2[] => [
  [s0, t0],
  [s1, t0],
  [s1, t1],
  [s0, t1],
]

/** ホームの段の歩ける所（side = +1 北西・−1 南東）と、段の間の段（同じ階の中の段） */
function landings(d: CableStationDef, side: 1 | -1, sLow: number, sHigh: number, tIn: number, tOut: number, risers: number, prefix: string) {
  const areas: OutdoorArea[] = []
  const stairs: StairDef[] = []
  const t0 = Math.min(side * tIn, side * tOut)
  const t1 = Math.max(side * tIn, side * tOut)
  const tc = (t0 + t1) / 2
  // 段の蹴上げは区画の境を真ん中に 0.3m ごと（2 段なら境の前後 0.15m）。下の段は最初の蹴上げまで、上の段は最後の蹴上げから
  const half = ((risers - 1) * 0.3) / 2
  for (let i = 0; i < 4; i++) {
    const c = d.comps[i]
    const s0 = i === 0 ? sLow : c.s0 + half
    const s1 = i === 3 ? sHigh : c.s1 - half
    areas.push({ id: `${prefix}-${i}`, poly: rect(s0, s1, t0, t1), h: c.h })
    if (i < 3) {
      const b = c.s1
      stairs.push({ id: `${prefix}-step-${i}`, from: 0, to: 0, start: [b - half, tc], dir: [1, 0], width: t1 - t0 - 0.1, risers, run: 0.3, y0: c.h, y1: d.comps[i + 1].h, build: false, landing: [0.3, 0.3] })
    }
  }
  return { areas, stairs }
}

/** 灯り（部屋 room の床 floor からの高さに直す） */
const lampAt = (id: string, room: string, floor: number, s: number, t: number, h: number, power = 0.55, range = 7.5, kind: LampDef['kind'] = 'ceiling'): LampDef => ({
  id,
  room,
  at: [s, t, h - floor],
  color: '#fff1dc',
  power,
  range,
  kind,
  schedule: 'shop',
  hours: [5.4, 24.2],
})

/* -------------------------------------------------------------------------- */
/* 形の道具（駅舎の中。高さは駅の床からの h で渡す）                                */
/* -------------------------------------------------------------------------- */

/** 部屋の床（ib.room の floorH）からの高さに直した箱 */
function hbox(ib: InteriorBuilder, s0: number, s1: number, t0: number, t1: number, h0: number, h1: number, color: string, mat: number, aux = 0) {
  if (h1 - h0 < 1e-3 || s1 - s0 < 1e-3 || t1 - t0 < 1e-3) return
  ib.box([(s0 + s1) / 2, (t0 + t1) / 2], h0 - ib.floorH, [s1 - s0, t1 - t0, h1 - h0], color, mat, aux)
}

/** 障害物（駅の床からの高さ） */
function hblock(ib: InteriorBuilder, name: string, s0: number, s1: number, t0: number, t1: number, h0: number, h1: number, nav = true, cam = true) {
  ib.block(name, [(s0 + s1) / 2, (t0 + t1) / 2], s1 - s0, t1 - t0, h0 - ib.floorH, h1 - ib.floorH, 0, nav, cam)
}

/** 手すりの柵（s か t に沿って。下の棒と上の棒・柱）。障害物も */
function fence(ib: InteriorBuilder, a: L2, b: L2, h: number, name = '柵') {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(1, Math.round(len / 1.2))
  for (let i = 0; i <= n; i++) {
    const s = a[0] + ((b[0] - a[0]) * i) / n
    const t = a[1] + ((b[1] - a[1]) * i) / n
    ib.cyl([s, t], h - ib.floorH, 0.025, 1.05, '#3f4a44', NM.iron, 0.3, 8)
  }
  for (const y of [0.45, 1.02]) ib.beam([a[0], a[1], h + y - ib.floorH], [b[0], b[1], h + y - ib.floorH], 0.04, '#3f4a44', NM.iron, 0.3)
  const along = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])
  if (along) hblock(ib, name, Math.min(a[0], b[0]), Math.max(a[0], b[0]), a[1] - 0.06, a[1] + 0.06, h, h + 1.1)
  else hblock(ib, name, a[0] - 0.06, a[0] + 0.06, Math.min(a[1], b[1]), Math.max(a[1], b[1]), h, h + 1.1)
}

/** ホームの段（床の板の上面・線路の側の縁の面・点字の帯と白い線）。tEdge = 線路の側の縁（|t|）、tWall = 壁の側 */
function platform(ib: InteriorBuilder, d: CableStationDef, side: 1 | -1, s0: number, s1: number, h: number, tEdge: number, tWall: number) {
  const t0 = Math.min(side * tEdge, side * tWall)
  const t1 = Math.max(side * tEdge, side * tWall)
  const low = Math.min(railH(d, s0), railH(d, s1)) - 0.35
  hbox(ib, s0, s1, t0, t1, low, h, CONCRETE, NM.concrete)
  // 縁の白い線と黄色い点字の帯
  const e = side * tEdge
  hbox(ib, s0, s1, Math.min(e, e + side * 0.12), Math.max(e, e + side * 0.12), h, h + 0.004, '#f2f0ea', NM.paint, 0.2)
  hbox(ib, s0, s1, Math.min(e + side * 0.45, e + side * 0.75), Math.max(e + side * 0.45, e + side * 0.75), h, h + 0.006, YELLOW, NM.tileClad, 0.05)
}

/** 段（s に沿って上る。s0 = 1 段目の蹴上げ、dir = ±1）。踏み面の先に黄色い滑り止め */
function stepsAlong(ib: InteriorBuilder, s0: number, dir: number, t0: number, t1: number, h0: number, h1: number, risers: number, run: number, low: number) {
  const rise = (h1 - h0) / risers
  for (let i = 0; i < risers; i++) {
    const a = s0 + dir * i * run
    const b = s0 + dir * (i + 1) * run
    const top = h0 + rise * (i + 1)
    // 最後の段は上の床まで（同じ高さ）
    hbox(ib, Math.min(a, b), Math.max(a, b), t0, t1, low, top, CONCRETE, NM.concrete)
    hbox(ib, Math.min(a, a + dir * 0.05), Math.max(a, a + dir * 0.05), t0, t1, top, top + 0.004, YELLOW, NM.tileClad, 0.05)
  }
}

/** 線路の床（レールの面の 0.25m 下。s0〜s1・t0〜t1。区切って坂にする） */
function trackFloor(ib: InteriorBuilder, d: CableStationDef, s0: number, s1: number, t0: number, t1: number, color = '#6a6660') {
  const n = Math.max(1, Math.ceil((s1 - s0) / 2))
  for (let i = 0; i < n; i++) {
    const a = s0 + ((s1 - s0) * i) / n
    const b = s0 + ((s1 - s0) * (i + 1)) / n
    const ha = railH(d, a) - 0.25 - ib.floorH
    const hb = railH(d, b) - 0.25 - ib.floorH
    ib.quad([a, t0, ha], [b, t0, hb], [b, t1, hb], [a, t1, ha], color, NM.concrete, 0)
  }
}

/** 車止め（赤と白の縞の箱） */
function buffer(ib: InteriorBuilder, d: CableStationDef, s: number, dir: number) {
  const r = railH(d, s)
  for (let i = 0; i < 4; i++) hbox(ib, Math.min(s, s + dir * 0.45), Math.max(s, s + dir * 0.45), -1.05 + i * 0.525, -1.05 + (i + 1) * 0.525, r - 0.25, r + 0.95, i % 2 ? '#f2f0ea' : RED, NM.paint, 0.4)
  hbox(ib, Math.min(s - dir * 0.1, s), Math.max(s - dir * 0.1, s), -0.5, 0.5, r + 0.25, r + 0.6, '#2a2a2a', NM.dark, 0.3)
}

/** 自動改札（通路の間と両端の機械。s の向きに通る）と、IC の読み取りの光 */
function gateMachines(ib: InteriorBuilder, s: number, ts: number[], h: number, dirS: number) {
  for (const t of ts) {
    hbox(ib, s - 0.5, s + 0.5, t - 0.1, t + 0.1, h, h + 0.92, '#d9dcde', NM.paint, 0.6)
    hbox(ib, s - 0.51, s + 0.51, t - 0.11, t + 0.11, h + 0.92, h + 1.0, '#2a2e33', NM.paint, 0.7)
    ib.glowBox([s - dirS * 0.3, t], h + 1.0 - ib.floorH, [0.16, 0.16, 0.012], '#3ab0ff', -1, 1.6)
    ib.glowBox([s - dirS * 0.5, t], h + 0.74 - ib.floorH, [0.012, 0.12, 0.1], '#3dff8a', -1, 1.2)
    hblock(ib, '改札機', s - 0.5, s + 0.5, t - 0.12, t + 0.12, h, h + 1.05)
  }
}

/** ベンチ（木の座面と鉄の脚。背もたれは壁の側）。s の範囲・t の位置・向き（+1 = +t を向いて座る） */
function bench(ib: InteriorBuilder, s0: number, s1: number, t: number, h: number, face: number) {
  hbox(ib, s0, s1, t - 0.22, t + 0.22, h + 0.4, h + 0.45, '#8a5a34', NM.wood, 0)
  hbox(ib, s0, s1, Math.min(t - face * 0.24, t - face * 0.2), Math.max(t - face * 0.24, t - face * 0.2), h + 0.45, h + 0.85, '#8a5a34', NM.wood, 0)
  for (const s of [s0 + 0.1, s1 - 0.1]) hbox(ib, s - 0.03, s + 0.03, t - 0.2, t + 0.2, h, h + 0.4, '#3f4a44', NM.iron, 0.3)
  hblock(ib, 'ベンチ', s0, s1, t - 0.25, t + 0.25, h, h + 0.5)
}

/** 自動販売機（t の壁を背に、face の向きを向く） */
function vending(ib: InteriorBuilder, s: number, t: number, h: number, face: number, color: string) {
  hbox(ib, s - 0.48, s + 0.48, t - 0.38, t + 0.38, h, h + 1.83, color, NM.paint, 0.6)
  ib.glowBox([s, t + face * 0.385], h + 0.95 - ib.floorH, [0.82, 0.012, 0.75], '#f4f8ff', -1, 1.2)
  hbox(ib, s - 0.4, s + 0.4, Math.min(t + face * 0.38, t + face * 0.4), Math.max(t + face * 0.38, t + face * 0.4), h + 0.25, h + 0.5, '#1e1e1e', NM.dark, 0.3)
  hblock(ib, '自動販売機', s - 0.5, s + 0.5, t - 0.4, t + 0.4, h, h + 1.85)
}

/** 天井の灯り（細長い光る板） */
function ceilingLamp(ib: InteriorBuilder, s: number, t: number, h: number, lamp: number) {
  ib.box([s, t], h - 0.06 - ib.floorH, [1.5, 0.3, 0.06], '#e6e8e8', NM.paint, 0.5)
  ib.glowBox([s, t], h - 0.075 - ib.floorH, [1.4, 0.22, 0.02], '#fff6ea', lamp, 1.6)
}

/* -------------------------------------------------------------------------- */
/* 頂上駅                                                                        */
/* -------------------------------------------------------------------------- */

const SD = CABLE_STATIONS['cable-summit']
/** 頂上駅の寸法（局所） */
const SU = {
  /** 部屋の床（壁の下の端）と天井 */
  floor: -3.6,
  ceil: 4.5,
  /** 中の面 */
  wall: 5.75,
  /**
   * 南西の中の面（線路の口のある面）。外形（町の地図データ）の南西の面は s = −0.11 なので、そこから inset（0.25m）の所。
   * 前は 0.25（外形の面を s = 0 と見ていた）で、外観の線路の口が中の壁に写らず、中の壁が線路をふさいでいた（issue #12）
   */
  sw: -0.11 + 0.25,
  /** コンコースの谷の端・改札・線路の終わりの車止め・コンコースの北東の帯 */
  hall: 21.2,
  gate: 27.4,
  buffer: 33.9,
  strip: 34.6,
  /** ホームの谷の端・山の端（コンコースからの 3 段の上） */
  low: 7.0,
  high: 20.3,
  /** 線路の側の柵（コンコースの中） */
  fenceT: 1.6,
}
const SL = (id: string, s: number, t: number, power?: number, range?: number) => lampAt(id, 'hall', SU.floor, s, t, SU.ceil - 0.04, power, range)
const SUMMIT_LAMPS: LampDef[] = [
  SL('pf-0', 9.4, -3.6),
  SL('pf-1', 14.4, -3.6),
  SL('pf-2', 19.2, -3.6),
  SL('se-0', 24.4, -3.6),
  SL('se-1', 31.0, -3.6),
  SL('nw-0', 24.4, 3.7),
  SL('nw-1', 31.0, 3.7),
  SL('ne', 35.7, 0, 0.5, 6),
]
const sl = (id: string) => SUMMIT_LAMPS.findIndex((l) => l.id === id)

const summitLand = landings(SD, -1, SU.low, SU.high, SD.edgeT, SU.wall, 2, 'pf')

export const CABLE_SUMMIT_BRIEF: InteriorBrief = {
  zone: 'cable-summit',
  wallT: 0.12,
  inset: 0.25,
  rooms: [
    {
      id: 'hall',
      name: '頂上駅の駅舎（コンコース・待合室・ホーム）',
      level: 0,
      poly: rect(SU.sw, 36.75, -SU.wall, SU.wall),
      floor: SU.floor,
      ceiling: SU.ceil,
      noFloor: true,
      floorFinish: F(FLOOR_TILE, NM.tileClad, 0.3),
      wallFinish: F(CREAM, NM.plaster),
      ceilingFinish: F('#f3efe6', IM.paintWall),
    },
  ],
  doors: [
    // 北東の出口（自動のガラスの両開き。外観の開く扉）
    { id: 'exit', level: 0, at: [37 - 0.125, 0], axis: 't', width: 2.4, height: 2.6, kind: 'named', entrance: 0, thickness: 0.25, floor: 0 },
  ],
  stairs: [
    // コンコースからホームの山の端へ 3 段
    { id: 'hall-stair', from: 0, to: 0, start: [SU.hall, -3.6], dir: [-1, 0], width: SU.wall - SD.edgeT - 0.1, risers: 3, run: 0.3, y0: 0, y1: SD.comps[3].h, build: false, landing: [0.35, 0.35] },
    ...summitLand.stairs,
  ],
  outdoor: [
    // 歩ける所は境で 0.6m 以上重ねる（縁から通り道の余裕の分だけ離れた所しか歩けないので）
    { id: 'hall-ne', poly: rect(SU.strip - 0.1, 36.75, -SU.wall, SU.wall), h: 0 },
    { id: 'hall-se', poly: rect(SU.hall, SU.strip + 0.7, -SU.wall, -SU.fenceT - 0.06), h: 0 },
    { id: 'hall-nw', poly: rect(SU.hall, SU.strip + 0.7, SU.fenceT + 0.06, SU.wall), h: 0 },
    ...summitLand.areas,
    // 出口の外（天文台の擁壁沿いの小径・つづら道へ）
    { id: 'out', poly: rect(36.9, 41.0, -3.2, 3.2), h: 'terrain' },
  ],
  lamps: SUMMIT_LAMPS,
  navPoints: [
    { at: [35.7, 0], level: 0 },
    { at: [35.6, -3.7], level: 0 },
    { at: [35.6, 3.7], level: 0 },
    { at: [32.0, -3.4], level: 0 },
    { at: [32.0, 3.4], level: 0 },
    // 改札の 2 通路の前後
    { at: [29.0, -2.25], level: 0 },
    { at: [29.0, -3.25], level: 0 },
    { at: [25.6, -2.25], level: 0 },
    { at: [25.6, -3.25], level: 0 },
    { at: [24.0, -3.7], level: 0 },
    { at: [21.7, -3.6], level: 0 },
    { at: [19.7, -3.6], level: 0 },
    { at: [16.4, -3.4], level: 0 },
    { at: [13.5, -3.4], level: 0 },
    { at: [10.7, -3.4], level: 0 },
    { at: [8.6, -3.4], level: 0 },
    { at: [24.0, 3.6], level: 0 },
    { at: [31.0, 3.4], level: 0 },
    { at: [39.0, 0], level: 0 },
  ],
  maxEdge: 9,
  furnish: summitFurnish,
}

function summitFurnish(ib: InteriorBuilder, m: InteriorModel) {
  void m
  ib.room('hall')
  const d = SD
  // --- コンコースの床（タイル）・北東の帯・待合室・改札の側 ---
  hbox(ib, SU.strip, 36.75, -SU.wall, SU.wall, -0.6, 0, FLOOR_TILE, NM.tileClad, 0.3)
  hbox(ib, SU.hall, SU.strip, -SU.wall, -SU.fenceT, -0.6, 0, FLOOR_TILE, NM.tileClad, 0.3)
  hbox(ib, SU.hall, SU.strip, SU.fenceT, SU.wall, -0.6, 0, FLOOR_TILE, NM.tileClad, 0.3)
  // 入口の敷物と、出口から改札・のりばへの点字の誘導
  hbox(ib, 35.4, 36.7, -1.3, 1.3, 0, 0.008, '#3a3d40', IM.rug, 0)
  hbox(ib, 35.15, 35.45, -3.0, 0.2, 0, 0.004, YELLOW, NM.tileClad, 0.05)
  hbox(ib, 22.0, 35.45, -3.1, -2.8, 0, 0.004, YELLOW, NM.tileClad, 0.05)
  // --- 線路（床・コンコースの中の線路の床の両わきの立ち上がり・車止め）と、車両の北西の保線の床 ---
  trackFloor(ib, d, 0, SU.buffer + 0.6, -SD.edgeT, SU.fenceT)
  trackFloor(ib, d, 0, SU.hall, SU.fenceT, SU.wall, '#7a766e')
  for (const t of [-SU.fenceT, SU.fenceT]) {
    const n = 8
    for (let i = 0; i < n; i++) {
      const a = SU.hall + ((SU.buffer + 0.6 - SU.hall) * i) / n
      const b = SU.hall + ((SU.buffer + 0.6 - SU.hall) * (i + 1)) / n
      hbox(ib, a, b, t - 0.05, t + 0.05, -0.6, Math.max(0.02, railH(d, (a + b) / 2) - 0.2), CONCRETE, NM.concrete)
    }
  }
  hbox(ib, SU.buffer + 0.6, SU.strip, -SU.fenceT, SU.fenceT, -0.6, railH(d, SU.buffer) - 0.2, CONCRETE, NM.concrete)
  buffer(ib, d, SU.buffer, 1)
  // --- ホームの段・段の間の段・コンコースからの 3 段 ---
  for (let i = 0; i < 4; i++) {
    const c = d.comps[i]
    const s0 = i === 0 ? SU.low : c.s0 + 0.15
    const s1 = i === 3 ? SU.high : c.s1 - 0.15
    platform(ib, d, -1, s0, s1, c.h, d.edgeT, SU.wall)
    if (i < 3) stepsAlong(ib, c.s1 - 0.15, 1, -SU.wall, -d.edgeT, c.h, d.comps[i + 1].h, 2, 0.3, railH(d, c.s1) - 0.35)
  }
  stepsAlong(ib, SU.hall, -1, -SU.wall, -d.edgeT, 0, d.comps[3].h, 3, 0.3, -0.6)
  // ホームの谷の端の柵・コンコースの線路の側の柵・待合室と保線の床の間の柵
  fence(ib, [SU.low, -SU.wall], [SU.low, -d.edgeT - 0.05], d.comps[0].h, 'ホームの端の柵')
  fence(ib, [SU.hall + 0.3, -SU.fenceT], [SU.strip - 0.1, -SU.fenceT], 0, '線路の柵')
  fence(ib, [SU.hall + 0.3, SU.fenceT], [SU.strip - 0.1, SU.fenceT], 0, '線路の柵')
  fence(ib, [SU.hall, SU.fenceT + 0.05], [SU.hall, SU.wall], 0, '保線の床の柵')
  fence(ib, [SU.strip - 0.1, -SU.fenceT], [SU.strip - 0.1, SU.fenceT], 0, '車止めの柵')
  // --- 改札（自動改札 2 通路・窓口）と、のりばの札 ---
  gateMachines(ib, SU.gate, [-1.75, -2.75, -3.75], 0, -1)
  hbox(ib, SU.gate - 1.6, SU.gate + 1.4, -SU.wall, -4.35, 0, 1.05, '#e9ecee', NM.paint, 0.5)
  hbox(ib, SU.gate - 1.65, SU.gate + 1.45, -SU.wall, -4.3, 1.05, 1.1, '#7a5a3c', NM.wood, 0)
  ib.glass([SU.gate - 1.6, -4.33, 1.1 - SU.floor], [SU.gate + 1.4, -4.33, 1.1 - SU.floor], [SU.gate + 1.4, -4.33, 2.35 - SU.floor], [SU.gate - 1.6, -4.33, 2.35 - SU.floor])
  hbox(ib, SU.gate - 1.6, SU.gate + 1.4, -SU.wall, -4.3, 2.35, 2.65, GREEN, NM.paint, 0.5)
  hblock(ib, '窓口', SU.gate - 1.6, SU.gate + 1.4, -SU.wall, -4.3, 0, 2.6)
  ib.picture('cable-gate', [SU.gate + 0.02, -2.75], 2.25 - SU.floor, 1.5, 0.45, 0, 2)
  hbox(ib, SU.gate - 0.03, SU.gate + 0.01, -3.55, -1.95, 2.0, 2.5, GREEN, NM.paint, 0.5)
  ib.beam([SU.gate, -2.75, 2.5 - SU.floor], [SU.gate, -2.75, SU.ceil - SU.floor], 0.025, '#9aa0a4', NM.steel, 0.5)
  // 時刻表と路線の案内（改札の外の北東の壁）
  ib.picture('cable-timetable', [36.73, -3.4], 1.55 - SU.floor, 0.72, 0.84, Math.PI, 2)
  ib.picture('cable-guide', [36.73, 3.4], 1.6 - SU.floor, 1.3, 0.5, Math.PI, 2)
  // --- 待合室（ベンチ・自動販売機コーナー・植木） ---
  bench(ib, 23.2, 26.4, SU.wall - 0.4, 0, -1)
  bench(ib, 27.2, 30.4, SU.wall - 0.4, 0, -1)
  vending(ib, 32.0, SU.wall - 0.45, 0, -1, '#c8323a')
  vending(ib, 33.05, SU.wall - 0.45, 0, -1, '#2a6ab0')
  plant(ib, [34.1, SU.wall - 0.45], 0 - SU.floor, 0.8)
  plant(ib, [22.0, SU.wall - 0.45], 0 - SU.floor, 0.8)
  // --- ホーム（窓の下のベンチ・駅名標） ---
  bench(ib, d.comps[1].door - 0.9, d.comps[1].door + 0.9, -SU.wall + 0.4, d.comps[1].h, 1)
  bench(ib, d.comps[2].door - 0.9, d.comps[2].door + 0.9, -SU.wall + 0.4, d.comps[2].h, 1)
  const ns = (d.comps[2].s1 + d.comps[3].door) / 2
  for (const s of [ns - 0.8, ns + 0.8]) ib.beam([s, -SU.wall + 0.35, d.comps[3].h + 2.2 - SU.floor], [s, -SU.wall + 0.35, SU.ceil - SU.floor], 0.025, '#9aa0a4', NM.steel, 0.5)
  hbox(ib, ns - 0.82, ns + 0.82, -SU.wall + 0.32, -SU.wall + 0.38, d.comps[3].h + 1.75, d.comps[3].h + 2.27, '#f8f6ee', NM.paint, 0.3)
  ib.picture('cable-name-summit', [ns, -SU.wall + 0.39], d.comps[3].h + 2.01 - SU.floor, 1.6, 0.5, Math.PI / 2, 0)
  ib.block('駅名標', [ns, -SU.wall + 0.35], 1.7, 0.1, d.comps[3].h + 1.7 - SU.floor, d.comps[3].h + 2.3 - SU.floor, 0, false, true)
  // --- 天井の灯り ---
  for (const l of SUMMIT_LAMPS) ceilingLamp(ib, l.at[0], l.at[1], SU.ceil, sl(l.id))
}

/* -------------------------------------------------------------------------- */
/* 麓駅                                                                          */
/* -------------------------------------------------------------------------- */

const FD = CABLE_STATIONS['cable-fumoto']
const FU = {
  floor: -0.8,
  ceil: 6.0,
  wall: 5.75,
  /** 改札（s）・階段の 1 段目（s）・ホームの山の端・線路の谷の端の車止め */
  gate: 11.6,
  stair: 12.95,
  high: 27.0,
  buffer: 12.8,
  /** 入口（正面の斜めの面。局所の点）と、面に沿う向き・中への向き */
  door: [8.74, 3.0] as L2,
  along: [0.8, -0.6] as L2,
  inward: [0.6, 0.8] as L2,
}
const FL = (id: string, s: number, t: number, power?: number, range?: number) => lampAt(id, 'hall', FU.floor, s, t, FU.ceil - 0.04, power, range)
const FUMOTO_LAMPS: LampDef[] = [FL('cc-0', 8.6, 4.4), FL('gate', 12.0, 3.6), FL('pf-0', 16.4, 3.6), FL('pf-1', 20.8, 3.6), FL('pf-2', 25.0, 3.6), FL('bay', 22.0, -3.6, 0.35, 6)]
const fl = (id: string) => FUMOTO_LAMPS.findIndex((l) => l.id === id)

/** 麓駅の外形（局所。反時計回り）: 北西の谷の角 → 正面の右（南東）の角 → 南東の角 → 北東の南東 → 北東の北西 */
const FUMOTO_RING: L2[] = [
  [4.8, 5.94],
  [15.3, -1.9],
  [21.6, -6.0],
  [48.0, -6.0],
  [48.0, 6.0],
]
const fumotoLand = landings(FD, 1, FU.stair + 7 * 0.3 + 0.05, FU.high, FD.edgeT, FU.wall, 1, 'pf')
const doorPt = (a: number, n: number): L2 => [FU.door[0] + FU.along[0] * a + FU.inward[0] * n, FU.door[1] + FU.along[1] * a + FU.inward[1] * n]

export const CABLE_FUMOTO_BRIEF: InteriorBrief = {
  zone: 'cable-fumoto',
  wallT: 0.12,
  inset: 0.25,
  rooms: [
    {
      id: 'hall',
      name: '麓駅の駅舎（コンコース・改札・ホーム）',
      level: 0,
      poly: insetPoly(FUMOTO_RING, 0.25),
      floor: FU.floor,
      ceiling: FU.ceil,
      noFloor: true,
      floorFinish: F(FLOOR_TILE, NM.tileClad, 0.3),
      wallFinish: F(CREAM, NM.plaster),
      ceilingFinish: F('#f3efe6', IM.paintWall),
    },
  ],
  doors: [],
  stairs: [
    // 改札の先から、ホームの谷の端へ 8 段
    { id: 'gate-stair', from: 0, to: 0, start: [FU.stair, 3.6], dir: [1, 0], width: FU.wall - FD.edgeT - 0.1, risers: 8, run: 0.3, y0: 0, y1: FD.comps[0].h, build: false, landing: [0.4, 0.35] },
    ...fumotoLand.stairs,
  ],
  outdoor: [
    // コンコース（正面の斜めの面の内から改札・階段の下まで）と、入口の通り抜け・入口の外の歩道
    { id: 'concourse', poly: [[5.55, 5.72], [10.95, 1.6], [FU.stair + 0.2, 1.6], [FU.stair + 0.2, 5.72]], h: 0 },
    { id: 'doorway', poly: [doorPt(-1.15, -1.3), doorPt(1.15, -1.3), doorPt(1.15, 1.4), doorPt(-1.15, 1.4)], h: 0 },
    { id: 'front', poly: [doorPt(-3.2, -4.2), doorPt(3.2, -4.2), doorPt(3.2, -0.9), doorPt(-3.2, -0.9)], h: 'terrain' },
    ...fumotoLand.areas,
  ],
  lamps: FUMOTO_LAMPS,
  navPoints: [
    { at: doorPt(0, -2.0), level: 0 },
    { at: doorPt(0, 1.0), level: 0 },
    { at: [10.4, 3.4], level: 0 },
    // 改札の 2 通路の前後
    { at: [FU.gate - 0.9, 2.5], level: 0 },
    { at: [FU.gate - 0.9, 3.5], level: 0 },
    { at: [FU.gate + 0.9, 2.5], level: 0 },
    { at: [FU.gate + 0.9, 3.5], level: 0 },
    { at: [16.0, 3.4], level: 0 },
    { at: [19.0, 3.4], level: 0 },
    { at: [21.9, 3.4], level: 0 },
    { at: [24.8, 3.4], level: 0 },
  ],
  maxEdge: 9,
  furnish: fumotoFurnish,
}

function fumotoFurnish(ib: InteriorBuilder, m: InteriorModel) {
  void m
  ib.room('hall')
  const d = FD
  // --- コンコースの床（タイル。正面の斜めの面に沿って区切る） ---
  ib.quad([5.55, 5.75, -FU.floor], [10.95, 1.55, -FU.floor], [FU.stair + 0.02, 1.55, -FU.floor], [FU.stair + 0.02, 5.75, -FU.floor], FLOOR_TILE, NM.tileClad, 0.3)
  // 入口の敷物と、入口から改札への点字の誘導
  const dp = doorPt(0, 0.9)
  hbox(ib, dp[0] - 0.9, dp[0] + 0.9, dp[1] - 0.7, dp[1] + 0.7, 0, 0.008, '#3a3d40', IM.rug, 0)
  hbox(ib, 9.2, FU.gate - 0.5, 3.35, 3.65, 0, 0.004, YELLOW, NM.tileClad, 0.05)
  // --- 線路（車止めの先の床・車両の南東の保線の床）と車止め ---
  trackFloor(ib, d, FU.buffer - 0.6, 47.75, -FU.wall, d.edgeT)
  buffer(ib, d, FU.buffer, -1)
  // 線路の側の立ち上がり（コンコース・階段の横）
  hbox(ib, 10.9, FU.stair + 2.1, 1.48, 1.55, -0.6, railH(d, FU.stair) + 0.1, CONCRETE, NM.concrete)
  // --- 改札（3 台・2 通路）と窓口（北西の壁ぎわ） ---
  gateMachines(ib, FU.gate, [2.0, 3.0, 4.0], 0, 1)
  hbox(ib, FU.gate - 1.4, FU.gate + 0.6, 4.55, FU.wall, 0, 1.05, '#e9ecee', NM.paint, 0.5)
  hbox(ib, FU.gate - 1.45, FU.gate + 0.65, 4.5, FU.wall, 1.05, 1.1, '#7a5a3c', NM.wood, 0)
  ib.glass([FU.gate - 1.4, 4.53, 1.1 - FU.floor], [FU.gate + 0.6, 4.53, 1.1 - FU.floor], [FU.gate + 0.6, 4.53, 2.35 - FU.floor], [FU.gate - 1.4, 4.53, 2.35 - FU.floor])
  hbox(ib, FU.gate - 1.4, FU.gate + 0.6, 4.5, FU.wall, 2.35, 2.65, GREEN, NM.paint, 0.5)
  hblock(ib, '窓口', FU.gate - 1.4, FU.gate + 0.6, 4.5, FU.wall, 0, 2.6)
  ib.picture('cable-gate', [FU.gate - 0.02, 3.0], 2.25 - FU.floor, 1.5, 0.45, Math.PI, 2)
  hbox(ib, FU.gate - 0.01, FU.gate + 0.03, 2.2, 3.8, 2.0, 2.5, GREEN, NM.paint, 0.5)
  // 時刻表と路線の案内（コンコースの北西の壁）
  ib.picture('cable-timetable', [7.0, FU.wall - 0.02], 1.55 - FU.floor, 0.72, 0.84, -Math.PI / 2, 2)
  ib.picture('cable-guide', [9.3, FU.wall - 0.02], 1.6 - FU.floor, 1.3, 0.5, -Math.PI / 2, 2)
  bench(ib, 6.2, 8.4, FU.wall - 0.4, 0, -1)
  // --- 階段・ホームの段・段の間の 1 段 ---
  stepsAlong(ib, FU.stair, 1, d.edgeT, FU.wall, 0, d.comps[0].h, 8, 0.3, -0.6)
  hbox(ib, FU.stair - 0.02, FU.stair + 2.1, FU.wall - 0.06, FU.wall, 0, d.comps[0].h + 1.0, '#7a5a3c', NM.wood, 0)
  for (let i = 0; i < 4; i++) {
    const c = d.comps[i]
    const s0 = i === 0 ? FU.stair + 7 * 0.3 : c.s0
    const s1 = i === 3 ? FU.high : c.s1
    platform(ib, d, 1, s0, s1, c.h, d.edgeT, FU.wall)
    if (i < 3) stepsAlong(ib, c.s1, 1, d.edgeT, FU.wall, c.h, d.comps[i + 1].h, 1, 0.3, railH(d, c.s1) - 0.35)
  }
  // 階段の線路の側の手すり・ホームの山の端の柵
  fence(ib, [10.95, 1.62], [FU.stair + 2.1, 1.62], 0, '線路の柵')
  fence(ib, [FU.high, d.edgeT + 0.05], [FU.high, FU.wall], d.comps[3].h, 'ホームの端の柵')
  // --- ホーム（壁ぎわのベンチ・駅名標） ---
  bench(ib, d.comps[1].door - 0.9, d.comps[1].door + 0.9, FU.wall - 0.4, d.comps[1].h, -1)
  bench(ib, d.comps[2].door - 0.9, d.comps[2].door + 0.9, FU.wall - 0.4, d.comps[2].h, -1)
  const ns = (d.comps[2].s1 + d.comps[3].door) / 2
  for (const s of [ns - 0.8, ns + 0.8]) ib.beam([s, FU.wall - 0.35, d.comps[3].h + 2.2 - FU.floor], [s, FU.wall - 0.35, FU.ceil - FU.floor], 0.025, '#9aa0a4', NM.steel, 0.5)
  hbox(ib, ns - 0.82, ns + 0.82, FU.wall - 0.38, FU.wall - 0.32, d.comps[3].h + 1.75, d.comps[3].h + 2.27, '#f8f6ee', NM.paint, 0.3)
  ib.picture('cable-name-fumoto', [ns, FU.wall - 0.39], d.comps[3].h + 2.01 - FU.floor, 1.6, 0.5, -Math.PI / 2, 0)
  ib.block('駅名標', [ns, FU.wall - 0.35], 1.7, 0.1, d.comps[3].h + 1.7 - FU.floor, d.comps[3].h + 2.3 - FU.floor, 0, false, true)
  // --- 天井の灯り ---
  for (const l of FUMOTO_LAMPS) ceilingLamp(ib, l.at[0], l.at[1], FU.ceil, fl(l.id))
}

/* -------------------------------------------------------------------------- */
/* 楓坂駅（上屋の下。形は外観の型）                                                 */
/* -------------------------------------------------------------------------- */

const KD = CABLE_STATIONS['cable-kaedezaka']
const kaeNW = landings(KD, 1, KAEDE.sLow['1'], KAEDE.sHigh, KD.edgeT, KAEDE.outer, 2, 'nw')
const kaeSE = landings(KD, -1, KAEDE.sLow['-1'], KAEDE.sHigh, KD.edgeT, KAEDE.outer, 2, 'se')

export const CABLE_KAEDEZAKA_BRIEF: InteriorBrief = {
  zone: 'cable-kaedezaka',
  wallT: 0.12,
  inset: 0.25,
  rooms: [],
  doors: [],
  stairs: [
    ...kaeNW.stairs,
    ...kaeSE.stairs,
    // ホームの山の端から構内踏切へ下りる 2 段（両側）
    ...([1, -1] as const).map((side): StairDef => ({ id: `cross-${side}`, from: 0, to: 0, start: [KAEDE.sHigh + 0.25, side * (KD.edgeT + KAEDE.outer) / 2], dir: [-1, 0], width: KAEDE.outer - KD.edgeT - 0.1, risers: 2, run: 0.25, y0: KAEDE.cross.h, y1: KD.comps[3].h, build: false, landing: [0.3, 0.3] })),
    // 西口の 2 段（外の地面から北西のホームの谷の端へ）
    { id: 'west', from: 0, to: 0, start: [(KAEDE.gate.s0 + KAEDE.gate.s1) / 2, KAEDE.outer + 0.48], dir: [0, -1], width: KAEDE.gate.s1 - KAEDE.gate.s0 - 0.2, risers: 2, run: 0.32, y0: KAEDE.gate.h, y1: KD.comps[0].h, build: false, landing: [0.4, 0.35] },
  ],
  outdoor: [
    ...kaeNW.areas,
    ...kaeSE.areas,
    { id: 'crossing', poly: rect(KAEDE.cross.s0 - 0.02, KAEDE.cross.s1, -KAEDE.outer, KAEDE.outer), h: KAEDE.cross.h },
    { id: 'west', poly: rect(KAEDE.gate.s0 - 1.5, KAEDE.gate.s1 + 1.5, KAEDE.outer + 0.9, KAEDE.outer + 4.0), h: 'terrain' },
  ],
  lamps: [],
  navPoints: [
    { at: [4.6, KAEDE.outer + 1.6], level: 0 },
    { at: [4.6, 5.9], level: 0 },
    // 改札の 2 通路の前後
    { at: [4.9, 4.475], level: 0 },
    { at: [4.9, 5.425], level: 0 },
    { at: [6.9, 4.475], level: 0 },
    { at: [6.9, 5.425], level: 0 },
    { at: [7.6, 4.95], level: 0 },
    { at: [12.0, 4.8], level: 0 },
    { at: [16.5, 4.8], level: 0 },
    { at: [18.9, 5.1], level: 0 },
    { at: [20.6, 5.1], level: 0 },
    { at: [20.6, 0], level: 0 },
    { at: [20.6, -5.1], level: 0 },
    { at: [18.9, -5.1], level: 0 },
    { at: [16.5, -4.8], level: 0 },
    { at: [12.0, -4.8], level: 0 },
    { at: [7.6, -4.8], level: 0 },
  ],
  furnish: (ib) => {
    // 形は外観の型（named/kits/cableStation.ts）。ここは障害物だけ（改札・詰所・ベンチ・駅名標の柱）
    for (const t of [4.0, 4.95, 5.9]) ib.block('改札機', [5.9, t], 0.95, 0.24, KD.comps[0].h, KD.comps[0].h + 1.05)
    ib.block('詰所', [2.2, 5.2], 2.2, 2.6, KD.comps[0].h, KD.comps[0].h + 2.6)
    for (const side of [1, -1]) {
      for (const i of [1, 2]) ib.block('ベンチ', [KD.comps[i].door, side * (KAEDE.outer - 0.55)], 1.7, 0.5, KD.comps[i].h, KD.comps[i].h + 0.9)
      const ns = KD.comps[3].door + 1.2
      for (const s of [ns - 1.0, ns + 1.0]) ib.disc('駅名標の柱', [s, side * (KAEDE.outer - 0.4)], 0.08, KD.comps[3].h, KD.comps[3].h + 2.3)
    }
    // 上屋の鉄の柱と屋根（カメラだけの障害物。形は外観の型と同じ位置・高さ）
    for (const [s0, s1] of [
      [-0.2, 8.0],
      [8.0, 16.0],
      [16.0, 24.2],
    ] as const) {
      const hc = KD.comps[0].h - 0.98 + ((s0 + s1) / 2 - 7.5) * 0.12 + 3.9
      for (const t of [-6.75, 0, 6.75]) for (const s of [s0 + 0.35, s1 - 0.35]) ib.disc('上屋の柱', [s, t], 0.16, KD.comps[0].h - 4, hc, false, true)
      ib.block('上屋の屋根', [(s0 + s1) / 2, 0], s1 - s0 + 0.5, 15, hc - 0.35, hc + 0.45, 0, false, true)
    }
  },
}
