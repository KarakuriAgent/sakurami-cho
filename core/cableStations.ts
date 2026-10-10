import { SITE } from './town'

/**
 * 丘ノ上ケーブルの 3 駅（麓駅・楓坂駅・頂上駅）の決まった値（docs/design/town.md §19・§7 の 176〜）。
 * 駅の建物の外観（named/kits/station.ts の cableStation）・中の決まり（interior/briefs/cable.ts）・ゾーン（core/interiors.ts）・
 * 乗る仕組み（character/ride/cableRide.ts）・町の中の移動（character/avatar/travel.ts）が使う。
 *
 * 駅の局所の座標（LocalFrame と同じ形）: 原点 = 線路の中心の線の上の点（麓の線路の端から水平に u0 m）、s = 線路に沿って山の側へ、
 * t = 山を向いて左へ（北西。車両の局所の +x と同じ側）、h = 駅の床の標高 z からの高さ。線路は直線（D-009。方位 45°）
 *
 * ホームの段（landing）の高さは、止まった車両の 4 つの区画の床の高さ（区画の真ん中。町のデータの線路の形と車両の形
 * transit/cableCar.ts から計算した値。町のデータの形の版 10）。transit/cable.ts が読んだ線路と食い違えばコンソールに注意を出す
 *
 * このファイルは町の SITE だけを読む（core/interiors.ts・layout.ts からも読む）
 */

const LAB = SITE.labFloorElevation

/** 麓の線路の端（平面座標）と、線路の向き（麓 → 頂上の単位ベクトル。方位 45°） */
export const CABLE_FOOT: [number, number] = [-800, -645]
export const CABLE_DIR: [number, number] = [Math.SQRT1_2, Math.SQRT1_2]

/**
 * 線路を描く麓の端（麓からの水平の長さ。麓駅の車止め）。データの線路の下端から 12.9m は ふもとの道と駅前の上にあるので描かない（D-055）
 */
export const CABLE_TRACK_FROM = 12.6

export type CableStationZone = 'cable-summit' | 'cable-kaedezaka' | 'cable-fumoto'
export type CableStationKey = 'station.cable-summit' | 'station.cable-kaedezaka' | 'station.cable-fumoto'

/** 駅の局所の座標の決まり（core/interiors.ts の LocalFrame と同じ形） */
export interface StationFrame {
  ox: number
  oy: number
  ax: number
  ay: number
  bx: number
  by: number
  z: number
}

const frameAt = (u0: number, z: number): StationFrame => ({
  ox: CABLE_FOOT[0] + CABLE_DIR[0] * u0,
  oy: CABLE_FOOT[1] + CABLE_DIR[1] * u0,
  ax: CABLE_DIR[0],
  ay: CABLE_DIR[1],
  bx: -CABLE_DIR[1],
  by: CABLE_DIR[0],
  z,
})

/** 線路の上の点（麓からの水平の長さ u・南東への横のずらし lat）→ 平面座標 */
export function cablePlan(u: number, lat = 0): [number, number] {
  return [CABLE_FOOT[0] + CABLE_DIR[0] * u + CABLE_DIR[1] * lat, CABLE_FOOT[1] + CABLE_DIR[1] * u - CABLE_DIR[0] * lat]
}

/** 平面座標 → 線路の座標（麓からの水平の長さ u・南東への横のずらし lat） */
export function cableUL(x: number, y: number): [number, number] {
  const dx = x - CABLE_FOOT[0]
  const dy = y - CABLE_FOOT[1]
  return [dx * CABLE_DIR[0] + dy * CABLE_DIR[1], dx * CABLE_DIR[1] - dy * CABLE_DIR[0]]
}

/** ホームの段: 区画 comp の床の高さ（局所の h）と、s の範囲（区画の両端の間の境で段を変える） */
export interface Landing {
  comp: number
  h: number
  s0: number
  s1: number
  /** 扉の真ん中（s） */
  door: number
}

export interface CableStationDef {
  zone: CableStationZone
  station: CableStationKey
  label: string
  buildingId: string
  /** 局所の座標の原点（麓からの水平の長さ u0）と床の標高 */
  u0: number
  frame: StationFrame
  /** 止まった車両の中心（s）と、区画ごとの床（局所の h）・扉（s） */
  carS: number
  comps: { h: number; door: number; s0: number; s1: number }[]
  /** 車両の外の面とホームの縁のすき間・ホームの縁（|t|）・ホームの外の縁（|t|。壁・柵） */
  edgeT: number
  outerT: number
  /** ホームのある側（t の符号。+1 = 北西・−1 = 南東）。楓坂駅は両側 */
  sides: (1 | -1)[]
  /** 行き違い線の横のずらし（|t|。楓坂駅だけ） */
  loopT: number
  /** 改札・入口の近く（どの区画の扉から乗るかを決める。s。ホームの側ごと） */
  access: Partial<Record<'1' | '-1', number>>
  /** 入口（扉の外の町の道の点・扉の中の点。局所の s, t）と、町の地図データの入口の向き */
  portalOut: [number, number]
  portalIn: [number, number]
}

/** 区画の床の高さ（標高。区画の真ん中）と扉の位置（u）。transit/cable.ts の車両の行列から計算した値 */
const STOP_FLOORS = {
  summit: { u: 833.54, floors: [112.443, 112.724, 113.005, 113.287], doors: [829.24, 832.12, 835.0, 837.88] },
  kaedezaka: { u: 426.95, floors: [56.2, 56.559, 56.917, 57.276], doors: [422.64, 425.51, 428.38, 431.26] },
  fumoto: { u: 20.36, floors: [14.034, 14.22, 14.406, 14.592], doors: [16.07, 18.96, 21.85, 24.74] },
} as const

const COMP_L = 2.875

function defOf(zone: CableStationZone, station: CableStationKey, label: string, buildingId: string, u0: number, z: number, key: keyof typeof STOP_FLOORS, rest: Omit<CableStationDef, 'zone' | 'station' | 'label' | 'buildingId' | 'u0' | 'frame' | 'carS' | 'comps'>): CableStationDef {
  const f = STOP_FLOORS[key]
  const carS = f.u - u0
  const comps = f.floors.map((e, i) => {
    const s0 = carS - (2 * COMP_L) + i * COMP_L
    return { h: Math.round((e - z) * 1000) / 1000, door: f.doors[i] - u0, s0, s1: s0 + COMP_L }
  })
  return { zone, station, label, buildingId, u0, frame: frameAt(u0, z), carS, comps, ...rest }
}

export const CABLE_STATIONS: Record<CableStationZone, CableStationDef> = {
  // 頂上駅（天文台のすぐ下）: 駅舎は線路に沿って u 820〜857・左右 6m。北東の面の真ん中が出口（天文台の擁壁沿いの小径・つづら道へ）。
  // 床（コンコース）は出口の外の地面（112.81m）に合わせ 112.85m。ホームは南東の側（山を向いて右）で、湾と町を見下ろす大きな窓
  'cable-summit': defOf('cable-summit', 'station.cable-summit', '丘ノ上ケーブル 頂上駅', 'building.sakuragioka.cable-summit', 820, 112.85, 'summit', {
    edgeT: 1.45,
    outerT: 5.8,
    sides: [-1],
    loopT: 0,
    access: { '-1': 21 },
    portalOut: [37.9, 0],
    portalIn: [36.0, 0],
  }),
  // 楓坂駅（楓坂四丁目。中間駅）: 行き違い線を覆う段々の上屋（u 415〜439・左右 7m）。両側に段々のホーム（さくら号は南東、かえで号は北西の線）。
  // 西口（楓坂四丁目の横道）は北西のホームの谷の端。南東のホームへは山の端の構内踏切を渡る
  'cable-kaedezaka': defOf('cable-kaedezaka', 'station.cable-kaedezaka', '丘ノ上ケーブル 楓坂駅', 'building.kaedezaka.cable-kaedezaka', 415, 56.0, 'kaedezaka', {
    edgeT: 2.19 + 1.45,
    outerT: 6.75,
    sides: [1, -1],
    loopT: 2.19,
    access: { '1': 5, '-1': 20 },
    portalOut: [3.4, 8.6],
    portalIn: [5.2, 5.6],
  }),
  // 麓駅（まるの森の北端）: 駅舎は u 4.8〜48。正面（南西）は ふもとの道に沿う斜めの面で、入口はその北西の寄り。
  // ホームは北西の側（山を向いて左）で、改札からの階段（8 段）で上がる。線路の上は車庫の上屋（緑の切妻）
  'cable-fumoto': defOf('cable-fumoto', 'station.cable-fumoto', '丘ノ上ケーブル 麓駅', 'building.chuo.cable-fumoto', 0, 12.85, 'fumoto', {
    edgeT: 1.45,
    outerT: 5.8,
    sides: [1],
    loopT: 0,
    access: { '1': 15 },
    portalOut: [7.5, 1.4],
    portalIn: [9.7, 4.2],
  }),
}

export const CABLE_STATION_ZONES = Object.keys(CABLE_STATIONS) as CableStationZone[]

/** 町の地図データの駅の id → 駅のゾーン */
export const STATION_ZONE: Record<CableStationKey, CableStationZone> = {
  'station.cable-summit': 'cable-summit',
  'station.cable-kaedezaka': 'cable-kaedezaka',
  'station.cable-fumoto': 'cable-fumoto',
}

/** 駅の局所 (s, t) → 平面座標 */
export function stationPlan(d: CableStationDef, s: number, t: number): [number, number] {
  const f = d.frame
  return [f.ox + f.ax * s + f.bx * t, f.oy + f.ay * s + f.by * t]
}

/** 駅の局所 (s, t, h) → シーンの座標 */
export function stationScene(d: CableStationDef, s: number, t: number, h = 0): [number, number, number] {
  const [x, y] = stationPlan(d, s, t)
  return [x, d.frame.z + h - LAB, -y]
}

/** シーンの x, z → 駅の局所 (s, t) */
export function stationLocal(d: CableStationDef, x: number, z: number): [number, number] {
  const f = d.frame
  const dx = x - f.ox
  const dy = -z - f.oy
  return [dx * f.ax + dy * f.ay, dx * f.bx + dy * f.by]
}

/** 駅の局所の向き（s, t の成分）→ シーンの向き（heading） */
export function stationHeading(d: CableStationDef, ds: number, dt: number) {
  const f = d.frame
  return Math.atan2(f.ax * ds + f.bx * dt, -(f.ay * ds + f.by * dt))
}

/** 区画 comp の、ホームの段（ホームの側 side の）。扉の前で花音が待つ点（局所） */
export function waitSpot(d: CableStationDef, comp: number, side: 1 | -1): [number, number] {
  return [d.comps[comp].door, side * (d.edgeT + 0.62)]
}

/**
 * 駅のまわりの線路のレール面の標高（麓からの水平の長さ u0 から 2m ごと。町のデータの線路（transit/cable.ts の Path）から読んだ値）。
 * 駅の中の線路の床・車止め・行き違い線の所の床の高さに使う
 */
const RAIL_TABLES: Record<CableStationZone, { u0: number; z: number[] }> = {
  'cable-summit': { u0: 812, z: [107.03, 107.67, 108.31, 108.95, 109.59, 110.22, 110.86, 111.3, 111.5, 111.7, 111.9, 112.09, 112.28, 112.48, 112.68, 112.88, 113.1, 113.32, 113.55, 113.8, 113.89, 114.0, 114.0, 114.0, 114.0] },
  'cable-kaedezaka': { u0: 408, z: [53.33, 53.61, 53.89, 54.17, 54.45, 54.73, 55.0, 55.28, 55.56, 55.82, 56.06, 56.3, 56.54, 56.78, 57.02, 57.26, 57.5, 57.74, 57.98, 58.22] },
  'cable-fumoto': { u0: 0, z: [12.0, 12.23, 12.41, 12.56, 12.71, 12.84, 12.97, 13.09, 13.21, 13.34, 13.46, 13.59, 13.73, 13.87, 14.03, 14.18, 14.33, 14.48, 14.63, 14.78, 14.94, 15.09, 15.24, 15.39, 15.54, 15.7] },
}

/** 駅のまわりの、麓からの水平の長さ u のレール面の標高 */
export function railElev(zone: CableStationZone, u: number) {
  const t = RAIL_TABLES[zone]
  const f = (u - t.u0) / 2
  const i = Math.max(0, Math.min(t.z.length - 2, Math.floor(f)))
  const k = Math.max(0, Math.min(1, f - i))
  return t.z[i] + (t.z[i + 1] - t.z[i]) * k
}

/** 駅の局所の s のレール面の高さ（駅の床からの h） */
export function railH(d: CableStationDef, s: number) {
  return railElev(d.zone, d.u0 + s) - d.frame.z
}
