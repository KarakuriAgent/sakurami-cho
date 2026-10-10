import type { L2 } from '../types'

/**
 * ガーデンドームの中の決まった値と、平面の道具（町の段階 4 の後半。docs/design/town.md §7・§13）。
 * 局所の座標 s = 東・t = 北（原点はドームの中心）、h = 床（データの ground_z_m 7.75m）からの高さ。角度は局所の角度（0 = 東、反時計回り。90° = 北）
 *
 * - 層（データの rooms）: 根の階（地上 h 0）・幹の回廊（1 層 h 6。ドームを一周する回廊 r 45.5〜51.5）・枝の回廊（2 層 h 13。r 33〜38 と、
 *   核へ渡るつり橋 3 本）・梢のテラス（3 層 h 22。核の上の円いテラス r 12.4）・種の間（地下 h -4.5）
 * - 中央の核: 大滝「天の水」の岩の塔（池の中に立つ。上に梢のテラスとロタンダ）。池は r 8.4〜14.4、まわりの石畳の広場は r 14.4〜19.4
 * - 層の間: 根の階 → 幹の回廊は弧のスロープ A（南東。9.6%）、幹 → 枝は弧のスロープ B（東〜北）、枝の核の踊り場 → 梢のテラスは核をまわるらせん階段 C
 *   （北西のつり橋の口の横から時計回りに上り、北東でテラスに出る）、
 *   根の階 → 種の間は直階段 D（池の北東の広場から）
 * - 方角ごとの植生: 南 熱帯雨林・東 温帯の森・北 雲霧林（霧の噴霧装置）・西 海辺の植物
 */

export const DEG = Math.PI / 180

/** 極座標 → 局所の点（r m・角度 a ラジアン） */
export const P = (r: number, a: number): L2 => [Math.cos(a) * r, Math.sin(a) * r]

/** 局所の点の中心からの距離と角度 */
export const polar = (s: number, t: number): [number, number] => [Math.hypot(s, t), Math.atan2(t, s)]

/** 角度の差（-π〜π） */
export const angDiff = (a: number, b: number) => {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

export const DOME = {
  /** ガラスの半球（平面の半径・高さ・中心の高さ） */
  R: 60,
  H: 48,
  base: -0.5,
  /** 幹の回廊（1 層）の床・内と外の縁・手すりの柱の半径 */
  L1: { h: 6.0, r0: 45.5, r1: 51.5 },
  /** 枝の回廊（2 層） */
  L2: { h: 13.0, r0: 33.0, r1: 38.0 },
  /** 梢のテラス（3 層。核の上） */
  L3: { h: 22.0, r: 12.4 },
  /** 枝の層の核のまわりの踊り場 */
  landing: { h: 13.0, r0: 7.4, r1: 10.6 },
  /** 核の岩の塔（池の底 h -0.9 で r 8.4、梢のテラスの下 h 21.4 で r 6.4） */
  core: { r0: 8.4, r1: 6.4, top: 21.4 },
  /** 池（水面と底）と、まわりの石畳の広場 */
  pool: { r0: 8.4, r1: 14.4, water: -0.14, floor: -0.95 },
  plaza: { r0: 14.4, r1: 19.4 },
  /** 回廊の下のアーケード（柱の半径） */
  arcade: { r0: 46.0, r1: 51.0 },
  /** 弧のスロープ A（根の階 → 幹の回廊）・B（幹 → 枝）と、核のらせん階段 C（枝の踊り場 → 梢のテラス） */
  rampA: { r: 42.3, w: 3.0, a0: -82 * DEG, a1: 3 * DEG },
  rampB: { r: 41.8, w: 3.0, a0: 18 * DEG, a1: 114 * DEG },
  stairC: { r: 9.5, w: 1.9, a0: 135 * DEG, a1: 44.5 * DEG, risers: 50 },
  /** 枝の回廊から核へ渡るつり橋の角度（南の橋は大滝の前を渡る） */
  bridges: [30 * DEG, 150 * DEG, 270 * DEG],
  bridgeW: 2.4,
  /** 種の間（地下）: 階段の吹き抜け・見学の通路・ガラスの向こうの種子保存庫 */
  b1: { h: -4.5, ceil: -0.6, stair: { s0: 2.4, s1: 5.0, t0: 19.6, t1: 27.2 }, hall: { s0: -7, s1: 7, t0: 27.2, t1: 33.2 }, vault: { t1: 41.0 } },
  /** 張り出しの入口（外観の型 kits/observatory.ts の gardenDome と同じ）。奥の壁の開口（ドームの中へ）の大きさ */
  gates: {
    south: { s0: -5.3, s1: 5.3, t0: -65.5, t1: -56.5, door: 9, doorH: 7.5, innerW: 7.0, innerH: 6.0, ceil: 8.6 },
    west: { s0: -62.5, s1: -56.5, t0: -3.05, t1: 3.05, door: 4.5, doorH: 3.6, innerW: 3.4, innerH: 3.2, ceil: 4.7 },
    north: { s0: -3.05, s1: 3.05, t0: 56.5, t1: 62.5, door: 4.5, doorH: 3.6, innerW: 3.4, innerH: 3.2, ceil: 4.7 },
  },
  /** 中の店（データの tenant の位置の角度）: 喫茶 こもれび（1 層・南東）・売店「葉っぱ屋」（根の階・南西）・光脈管制室（1 層・東） */
  komorebi: { a: -45 * DEG, a0: -53 * DEG, a1: -37 * DEG, r1: 56.0 },
  happaya: { a: -127.5 * DEG },
  control: { a0: 9 * DEG, a1: 23 * DEG, r1: 56.4 },
  /** 南の入口からの道（根の階）の幅と、そのほかの放射の道の幅 */
  southPathW: 6.0,
  pathW: 3.6,
} as const

/** ガラスの内側の高さ（平面の距離 r の所。h） */
export function glassHeight(r: number) {
  const k = r / DOME.R
  return DOME.base + DOME.H * Math.sqrt(Math.max(0, 1 - k * k))
}

/** 核の岩の塔の半径（高さ h の所。h -0.9〜21.4） */
export function coreRadius(h: number) {
  const k = Math.min(1, Math.max(0, (h + 0.9) / (DOME.core.top + 0.9)))
  return DOME.core.r0 + (DOME.core.r1 - DOME.core.r0) * Math.pow(k, 0.85)
}

function hash2(x: number, y: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** 角度の向きに周期のある値のノイズ（0〜1。a ラジアン・y・周期の数） */
export function pnoise(a: number, y: number, period: number) {
  const x = ((a / (Math.PI * 2)) % 1 + 1) % 1 * period
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const x0 = xi % period
  const x1 = (xi + 1) % period
  const A = hash2(x0, yi)
  const B = hash2(x1, yi)
  const Cc = hash2(x0, yi + 1)
  const D = hash2(x1, yi + 1)
  return A + (B - A) * u + (Cc - A) * v + (A - B - Cc + D) * u * v
}

/** 核の岩の段（植え込みの棚）の高さ */
export const CORE_LEDGES = [4.2, 9.2, 17.2]

/** 核の岩の面の距離（角度 a・高さ h）: 先細りの塔に、岩の凹凸・縦の割れ目・植え込みの棚の張り出し。南の滝の面はなめらか */
export function rockRadius(a: number, h: number) {
  const base = coreRadius(h)
  const n1 = pnoise(a, h * 0.26, 7)
  const n2 = pnoise(a + 1.3, h * 0.7, 19)
  let r = base + (n1 - 0.5) * 1.9 + (n2 - 0.5) * 0.65
  const bump = (c: number, w: number) => Math.exp(-(((h - c) / w) ** 2))
  r += 1.0 * bump(CORE_LEDGES[0], 0.55) + 0.9 * bump(CORE_LEDGES[1], 0.5) + 0.8 * bump(CORE_LEDGES[2], 0.45)
  const fall = Math.exp(-((angDiff(a, -Math.PI / 2) / 0.32) ** 2))
  return r * (1 - fall * 0.7) + (base + 0.35) * fall * 0.7
}

/** 形の組（所ごとに分けて、視野の外を描かない）: 核のまわり（r < 20）と、外の 12 の扇 */
export function chunkAt(s: number, t: number) {
  const [r, a] = polar(s, t)
  if (r < 20) return 'core'
  const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12) % 12
  return `a${k}`
}

/** 方角の植生（局所の角度から。境目はなめらかに。重みの合計 1） */
export function biomeWeights(a: number) {
  // 南 = -90°・東 = 0°・北 = 90°・西 = 180°
  const w = (c: number) => Math.max(0, Math.cos(angDiff(a, c)))
  const south = Math.pow(w(-90 * DEG), 2)
  const east = Math.pow(w(0), 2)
  const north = Math.pow(w(90 * DEG), 2)
  const west = Math.pow(w(180 * DEG), 2)
  const sum = south + east + north + west || 1
  return { south: south / sum, east: east / sum, north: north / sum, west: west / sum }
}

export type Biome = 'south' | 'east' | 'north' | 'west'

/** その角度でいちばん強い植生 */
export function biomeAt(a: number): Biome {
  const w = biomeWeights(a)
  return (Object.keys(w) as Biome[]).reduce((m, k) => (w[k] > w[m] ? k : m), 'south')
}

/** 決まった乱数 */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/* -------------------------------------------------------------------------- */
/* 根の階の道（石畳）                                                             */
/* -------------------------------------------------------------------------- */

/** 根の階の道の中心線（局所の点の列）と幅 */
export interface PathDef {
  id: string
  pts: L2[]
  w: number
}

/** 放射の道（南の入口 → 広場・西・北・東）。広場の環とアーケードの環は別に（環の道） */
export const RADIAL_PATHS: PathDef[] = [
  { id: 'south', pts: [[0, -56.42], [0, DOME.plaza.r1 * -1 + 0.6]], w: DOME.southPathW },
  { id: 'west', pts: [[-56.42, 0], [-DOME.plaza.r1 + 0.6, 0]], w: DOME.pathW },
  { id: 'north', pts: [[0, 56.42], [0, DOME.plaza.r1 - 0.6]], w: DOME.pathW },
  { id: 'east', pts: [[DOME.arcade.r1 + 0.4, 0], [DOME.plaza.r1 - 0.6, 0]], w: DOME.pathW },
]

/** 環の道（広場・アーケードの下の道）の内と外の半径 */
export const RING_PATHS = [
  { id: 'plaza', r0: DOME.plaza.r0 + 0.35, r1: DOME.plaza.r1 },
  { id: 'arcade', r0: DOME.arcade.r0 - 0.35, r1: DOME.arcade.r1 + 0.35 },
]

/**
 * スロープ A の下の口の石畳（南の道の東の脇から、スロープの帯の始まりまで。歩ける所 rampA-foot と同じ扇形）。
 * 前は石畳の板だけで道（pathDistance）に入れていなかったので、植え込みの土が板の上に盛り上がり、花音がすねまで土に沈んでいた（§7 の 146）
 */
export const RAMP_A_FOOT = { r0: DOME.rampA.r - 1.9, r1: DOME.rampA.r + 1.9, a0: -91 * DEG, a1: -80.5 * DEG }

/** 点からスロープ A の下の口の石畳までの距離（負 = 中）。植え込みの土の高さ（bedHeight）と、植物を置かない所に使う */
export function rampFootDistance(s: number, t: number) {
  const f = RAMP_A_FOOT
  const r = Math.hypot(s, t)
  const a = Math.atan2(t, s)
  return Math.max(f.r0 - r, r - f.r1, (f.a0 - a) * r, (a - f.a1) * r)
}

/** 点から根の階の道までの距離（負 = 道の中）。植え込み・地面の高さ・植物を置く所に使う */
export function pathDistance(s: number, t: number) {
  let d = Infinity
  for (const p of RADIAL_PATHS) {
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1]
      const b = p.pts[i]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const l2 = dx * dx + dy * dy
      const k = Math.min(1, Math.max(0, ((s - a[0]) * dx + (t - a[1]) * dy) / l2))
      d = Math.min(d, Math.hypot(s - (a[0] + dx * k), t - (a[1] + dy * k)) - p.w / 2)
    }
  }
  const r = Math.hypot(s, t)
  for (const rp of RING_PATHS) d = Math.min(d, Math.max(rp.r0 - r, r - rp.r1))
  // 種の間への階段の口と、こもれびの下・葉っぱ屋の前の広がり
  const st = DOME.b1.stair
  d = Math.min(d, Math.max(st.s0 - 0.6 - s, s - st.s1 - 0.6, 18.4 - t, t - st.t1))
  return d
}

/** 池と広場の中か（植物を置かない） */
export function inPoolOrPlaza(r: number) {
  return r < DOME.plaza.r1 + 0.4
}

/* -------------------------------------------------------------------------- */
/* 植物の置き方（形を作る decorate と、通り道の障害物を記録する furnish の両方が使う）              */
/* -------------------------------------------------------------------------- */

export type PlantKind = 'palm' | 'treeFern' | 'fern' | 'nestFern' | 'alocasia' | 'lily' | 'mangrove' | 'moss' | 'mum' | 'vine' | 'reed'
export type TreeKind = 'broad' | 'broadDark' | 'camphor' | 'maple' | 'ginkgo' | 'sakura' | 'conifer' | 'shrub' | 'camellia' | 'azalea' | 'pittosporum'

export interface PlantItem {
  kind: PlantKind
  s: number
  t: number
  /** 根元の高さ（局所の h） */
  h: number
  /** 大きさ（高さ m）と向き・色のばらつき */
  size: number
  rot: number
  tint: number
  /** つる: 垂れる長さ */
  len?: number
}

export interface TreeItem {
  kind: TreeKind
  s: number
  t: number
  h: number
  height: number
  radius: number
  tint: number
}

export interface DomePlanting {
  plants: PlantItem[]
  trees: TreeItem[]
}

/** 構造物（回廊の柱・スロープ・橋）の近くか（木を置かない） */
function nearStructure(s: number, t: number, r: number, a: number, clear: number) {
  // アーケードの柱の環と回廊の床の下（1 層の床の下は木を置かない）
  if (r > DOME.L1.r0 - 0.6 && r < DOME.L1.r1 + 0.6) return true
  // 2 層の回廊の柱の環
  if (Math.abs(r - 33.5) < clear || Math.abs(r - 37.5) < clear) return true
  // スロープ A・B（の帯の下は低い木だけ。木は外す）
  for (const rp of [DOME.rampA, DOME.rampB]) {
    const lo = Math.min(rp.a0, rp.a1) - 3 * DEG
    const hi = Math.max(rp.a0, rp.a1) + 3 * DEG
    let aa = a
    while (aa < lo - Math.PI) aa += Math.PI * 2
    while (aa > hi + Math.PI) aa -= Math.PI * 2
    if (aa > lo && aa < hi && Math.abs(r - rp.r) < rp.w / 2 + clear) return true
  }
  // 橋の下（枝の層の橋は高いので、低い木なら下に置ける。ここでは大きな木を外す）
  for (const b of DOME.bridges) if (r > 9 && r < 34 && Math.abs(angDiff(a, b)) * r < DOME.bridgeW / 2 + clear) return true
  // 入口の張り出し
  for (const g of Object.values(DOME.gates)) if (s > g.s0 - 1 && s < g.s1 + 1 && t > g.t0 - 1 && t < g.t1 + 1) return true
  // 種の間の吹き抜け
  const st = DOME.b1.stair
  if (s > st.s0 - 1 && s < st.s1 + 1 && t > st.t0 - 1.5 && t < st.t1 + 1) return true
  return false
}

/** 構造物の「空けておく空間」（回廊の床と歩く高さ・張り出し・スロープ・橋・踊り場・テラス）。木の樹冠がめり込まないように */
interface Clear {
  r0: number
  r1: number
  /** 角度の範囲（ラジアン。無ければ全周） */
  a?: [number, number]
  h0: number
  h1: number | ((a: number) => number)
  /** 高さが角度で変わる（スロープ） */
  hAt?: (a: number) => number
}

const rampH = (rp: { a0: number; a1: number }, y0: number, y1: number) => (a: number) => {
  const k = Math.min(1, Math.max(0, angDiff(a, rp.a0) / (rp.a1 - rp.a0)))
  return y0 + (y1 - y0) * k
}

const CLEARS: Clear[] = [
  { r0: DOME.L1.r0 - 0.8, r1: DOME.L1.r1 + 0.8, h0: DOME.L1.h - 0.9, h1: DOME.L1.h + 3.4 },
  { r0: DOME.L1.r1, r1: DOME.komorebi.r1 + 0.8, a: [DOME.komorebi.a0 - 0.05, DOME.komorebi.a1 + 0.05], h0: DOME.L1.h - 0.9, h1: DOME.L1.h + 3.8 },
  { r0: DOME.L1.r1, r1: DOME.control.r1 + 0.8, a: [DOME.control.a0 - 0.05, DOME.control.a1 + 0.05], h0: DOME.L1.h - 0.9, h1: DOME.L1.h + 4.0 },
  { r0: DOME.rampA.r - 2.2, r1: DOME.L1.r0, a: [2 * DEG - 0.05, 9 * DEG + 0.05], h0: DOME.L1.h - 0.9, h1: DOME.L1.h + 3.4 },
  { r0: DOME.rampB.r - 2.2, r1: DOME.L1.r0, a: [13 * DEG - 0.05, 19.5 * DEG + 0.05], h0: DOME.L1.h - 0.9, h1: DOME.L1.h + 3.4 },
  { r0: DOME.L2.r0 - 0.8, r1: DOME.L2.r1 + 0.8, h0: DOME.L2.h - 0.8, h1: DOME.L2.h + 3.4 },
  { r0: DOME.L2.r1, r1: DOME.rampB.r + 2.2, a: [113 * DEG - 0.05, 120.5 * DEG + 0.05], h0: DOME.L2.h - 0.8, h1: DOME.L2.h + 3.4 },
  { r0: DOME.rampA.r - 2.2, r1: DOME.rampA.r + 2.2, a: [DOME.rampA.a0 - 0.06, DOME.rampA.a1 + 0.06], h0: 0, h1: 0, hAt: rampH(DOME.rampA, 0, DOME.L1.h) },
  { r0: DOME.rampB.r - 2.2, r1: DOME.rampB.r + 2.2, a: [DOME.rampB.a0 - 0.06, DOME.rampB.a1 + 0.06], h0: 0, h1: 0, hAt: rampH(DOME.rampB, DOME.L1.h, DOME.L2.h) },
  { r0: 6.5, r1: 12, h0: DOME.landing.h - 1.0, h1: DOME.landing.h + 3.4 },
  { r0: 0, r1: DOME.L3.r + 1.0, h0: DOME.L3.h - 5, h1: 60 },
]

/** 樹冠（中心 s, t・半径 rad・高さ hb〜ht の円柱）が、構造物の空けておく空間にめり込むか */
export function crownBlocked(s: number, t: number, rad: number, hb: number, ht: number) {
  const [r, a] = polar(s, t)
  for (const c of CLEARS) {
    if (r + rad < c.r0 || r - rad > c.r1) continue
    const da = r > 0.5 ? Math.min(Math.PI, rad / r) : Math.PI
    if (c.a) {
      const lo = c.a[0]
      const hi = c.a[1]
      const mid = (lo + hi) / 2
      if (Math.abs(angDiff(a, mid)) > (hi - lo) / 2 + da) continue
    }
    let h0 = c.h0
    let h1 = typeof c.h1 === 'number' ? c.h1 : c.h1(a)
    if (c.hAt) {
      const hh = c.hAt(a)
      h0 = hh - 0.9
      h1 = hh + 3.0
    }
    if (ht < h0 || hb > h1) continue
    return true
  }
  // 橋（枝の層の高さの帯）
  for (const b of DOME.bridges) {
    if (r - rad > 34 || r + rad < 9) continue
    if (Math.abs(angDiff(a, b)) * Math.max(r, 1) > DOME.bridgeW / 2 + 0.8 + rad) continue
    if (ht < DOME.L2.h - 0.8 || hb > DOME.L2.h + 6) continue
    return true
  }
  return false
}

/** 立ち寄り先と例の脚本のカメラのまわり（木の幹・ヤシ・木生シダを置かない。根の階のカメラの前を幹がふさがないように） */
const KEEP_CLEAR: [number, number, number][] = [
  [4.6, -22.2, 3.2],
  [2.3, -19.0, 2.6],
  [17.1, -32.2, 3.0],
  [24, -32, 3.0],
  [-3.6, -30, 2.0],
]
export function keepClear(s: number, t: number, extra = 0) {
  return KEEP_CLEAR.some(([x, y, r]) => Math.hypot(s - x, t - y) < r + extra)
}

/** 樹冠が道の上に張り出すなら、張り出す所の下の高さ（hb）が人の背より高いか */
function crownOverPath(s: number, t: number, rad: number, hb: number) {
  const pd = pathDistance(s, t)
  return pd < rad + 0.3 && hb < 2.6
}

/**
 * 植物を置く（決まった乱数）。木（町の木の仕組み）と、新しい形の植物（ヤシ・木生シダ・シダ・オオタニワタリ・アロカシア・ハマユウ・マングローブ・苔・菊・つる）
 */
export function domePlanting(): DomePlanting {
  const rnd = rng(20020)
  const plants: PlantItem[] = []
  const trees: TreeItem[] = []
  const treeAt: L2[] = []
  const free = (s: number, t: number, d: number) => treeAt.every((q) => Math.hypot(q[0] - s, q[1] - t) > d)
  const R = DOME.R
  // --- 木（植え込みの中。ガラスの下に収まる高さ） ---
  for (let i = 0; i < 2600 && trees.length < 150; i++) {
    const r = 20.5 + Math.sqrt(rnd()) * (R - 22.5)
    const a = rnd() * Math.PI * 2
    const [s, t] = [Math.cos(a) * r, Math.sin(a) * r]
    if (pathDistance(s, t) < 2.2 || keepClear(s, t, 1.5)) continue
    if (nearStructure(s, t, r, a, 1.6)) continue
    const room = glassHeight(r + 3) - 1.5
    if (room < 5) continue
    const b = biomeAt(a)
    let kind: TreeKind
    let height: number
    let radius: number
    const under2 = r > DOME.L2.r0 - 2 && r < DOME.L2.r1 + 2
    if (b === 'south') {
      kind = rnd() < 0.55 ? 'broadDark' : 'broad'
      height = 11 + rnd() * 9
      radius = 3.2 + rnd() * 2.2
    } else if (b === 'east') {
      const k = rnd()
      kind = k < 0.34 ? 'maple' : k < 0.58 ? 'camphor' : k < 0.78 ? 'sakura' : 'ginkgo'
      height = kind === 'camphor' ? 13 + rnd() * 6 : 8 + rnd() * 6
      radius = kind === 'camphor' ? 4 + rnd() * 2 : 2.8 + rnd() * 1.6
    } else if (b === 'north') {
      kind = rnd() < 0.5 ? 'conifer' : 'broadDark'
      height = 9 + rnd() * 8
      radius = kind === 'conifer' ? 2.2 + rnd() : 3 + rnd() * 1.5
    } else {
      kind = rnd() < 0.6 ? 'broad' : 'pittosporum'
      height = kind === 'pittosporum' ? 3 + rnd() * 2 : 7 + rnd() * 5
      radius = kind === 'pittosporum' ? 1.6 + rnd() : 3 + rnd() * 1.5
    }
    if (under2) height = Math.min(height, DOME.L2.h - 1.6)
    height = Math.min(height, room)
    if (height < 3) continue
    radius = Math.min(radius, height * 0.5)
    // 樹冠（下 0.3 × 高さ〜上）が回廊・スロープ・橋・テラスにめり込むなら、低くするか小さくする。だめなら置かない
    let ok = false
    for (let k = 0; k < 4 && !ok; k++) {
      if (!crownBlocked(s, t, radius, height * 0.3, height) && !crownOverPath(s, t, radius, height * 0.3)) ok = true
      else {
        height *= 0.8
        radius *= 0.85
      }
    }
    if (!ok || height < 3) continue
    if (!free(s, t, radius * 1.15 + 1.5)) continue
    treeAt.push([s, t])
    trees.push({ kind, s, t, h: 0, height, radius: Math.min(radius, height * 0.5), tint: rnd() })
  }
  // --- 低木（ツツジ・椿・トベラ・植え込み） ---
  for (let i = 0; i < 3000 && trees.filter((q) => q.kind === 'shrub' || q.kind === 'azalea' || q.kind === 'camellia').length < 170; i++) {
    const r = 19.8 + rnd() * (R - 20.4)
    const a = rnd() * Math.PI * 2
    const [s, t] = [Math.cos(a) * r, Math.sin(a) * r]
    const pd = pathDistance(s, t)
    if (pd < 0.6 || pd > 9) continue
    if (glassHeight(r) < 3) continue
    const b = biomeAt(a)
    const kind: TreeKind = b === 'north' ? 'azalea' : b === 'east' ? (rnd() < 0.6 ? 'camellia' : 'shrub') : b === 'west' ? 'pittosporum' : 'shrub'
    if (!free(s, t, 1.4)) continue
    const hh = 0.9 + rnd() * 1.1
    trees.push({ kind, s, t, h: 0, height: hh, radius: 0.7 + rnd() * 0.5, tint: rnd() })
  }
  // --- ヤシ（南）とマングローブ（西の汽水の池のまわり） ---
  for (let i = 0; i < 1500 && plants.filter((p) => p.kind === 'palm').length < 34; i++) {
    const r = 21 + rnd() * 32
    const a = -90 * DEG + (rnd() - 0.5) * 120 * DEG
    const [s, t] = [Math.cos(a) * r, Math.sin(a) * r]
    if (pathDistance(s, t) < 1.6 || nearStructure(s, t, r, a, 1.2) || keepClear(s, t, 1)) continue
    const room = glassHeight(r + 2) - 2
    let size = Math.min(room, 7 + rnd() * 8)
    // 葉の冠（頂の下 2.6m・半径 4m）が構造物にめり込まない高さ
    while (size >= 5 && (crownBlocked(s, t, 4.0, size - 2.6, size + 0.6) || crownOverPath(s, t, 3.5, size - 2.6))) size -= 0.8
    if (size < 5 || !free(s, t, 2.6)) continue
    treeAt.push([s, t])
    plants.push({ kind: 'palm', s, t, h: 0, size, rot: rnd() * Math.PI * 2, tint: rnd() })
  }
  for (let i = 0; i < 900 && plants.filter((p) => p.kind === 'mangrove').length < 12; i++) {
    const r = 24 + rnd() * 18
    const a = 180 * DEG + (rnd() - 0.5) * 50 * DEG
    const [s, t] = [Math.cos(a) * r, Math.sin(a) * r]
    if (pathDistance(s, t) < 2 || nearStructure(s, t, r, a, 1.2) || !free(s, t, 3) || crownBlocked(s, t, 2.2, 2, 7)) continue
    treeAt.push([s, t])
    plants.push({ kind: 'mangrove', s, t, h: -0.2, size: 4 + rnd() * 2.5, rot: rnd() * Math.PI * 2, tint: rnd() })
  }
  // --- 木生シダ（北・南の湿った所） ---
  for (let i = 0; i < 1500 && plants.filter((p) => p.kind === 'treeFern').length < 46; i++) {
    const r = 20.5 + rnd() * 36
    const north = rnd() < 0.72
    const a = (north ? 90 : -90) * DEG + (rnd() - 0.5) * (north ? 110 : 80) * DEG
    const [s, t] = [Math.cos(a) * r, Math.sin(a) * r]
    if (pathDistance(s, t) < 1.2 || nearStructure(s, t, r, a, 0.9) || keepClear(s, t)) continue
    let size = Math.min(glassHeight(r + 2) - 1.5, 3 + rnd() * 3.5)
    while (size >= 2.5 && (crownBlocked(s, t, 2.4, size - 1.4, size + 0.5) || crownOverPath(s, t, 2.2, size - 1.4))) size -= 0.5
    if (size < 2.5 || !free(s, t, 1.8)) continue
    treeAt.push([s, t])
    plants.push({ kind: 'treeFern', s, t, h: 0, size, rot: rnd() * Math.PI * 2, tint: rnd() })
  }
  // --- 下草: シダ・オオタニワタリ・アロカシア（南）・ハマユウ（西）・苔（北）・アシ（池の縁） ---
  const ground = (kind: PlantKind, n: number, pick: () => [number, number] | null, size: () => number, minGap: number) => {
    const placed: L2[] = []
    for (let i = 0; i < n * 8 && placed.length < n; i++) {
      const p = pick()
      if (!p) continue
      const [s, t] = p
      if (placed.some((q) => Math.hypot(q[0] - s, q[1] - t) < minGap)) continue
      placed.push([s, t])
      plants.push({ kind, s, t, h: 0, size: size(), rot: rnd() * Math.PI * 2, tint: rnd() })
    }
  }
  const pickIn = (aC: number, aW: number, r0: number, r1: number, pd0: number, pd1: number) => (): [number, number] | null => {
    const r = r0 + rnd() * (r1 - r0)
    const a = aC + (rnd() - 0.5) * aW
    const s = Math.cos(a) * r
    const t = Math.sin(a) * r
    const pd = pathDistance(s, t)
    if (pd < pd0 || pd > pd1) return null
    if (r > DOME.L1.r0 - 0.4 && r < DOME.L1.r1 + 0.4) return null
    if (nearStructure(s, t, r, a, 0.5) && !(r > DOME.L2.r0 - 2 && r < DOME.L2.r1 + 2)) return null
    if (glassHeight(r) < 1.5) return null
    return [s, t]
  }
  ground('alocasia', 90, pickIn(-90 * DEG, 150 * DEG, 20, 57, 1.0, 7), () => 1.3 + rnd() * 1.3, 1.5)
  ground('fern', 320, pickIn(0, Math.PI * 2, 20, 58, 0.6, 10), () => 0.8 + rnd() * 0.8, 1.1)
  ground('nestFern', 60, pickIn(-60 * DEG, 160 * DEG, 20, 56, 0.3, 6), () => 0.7 + rnd() * 0.5, 1.4)
  ground('lily', 110, pickIn(180 * DEG, 120 * DEG, 20, 58, 0.25, 8), () => 0.9 + rnd() * 0.5, 1.0)
  ground('moss', 140, pickIn(90 * DEG, 130 * DEG, 20, 58, 0.2, 9), () => 0.5 + rnd() * 0.9, 1.0)
  ground('reed', 40, () => {
    const a = rnd() * Math.PI * 2
    const r = DOME.pool.r0 + 0.4 + rnd() * 1.2
    return [Math.cos(a) * r, Math.sin(a) * r]
  }, () => 0.9 + rnd() * 0.6, 0.7)
  // 秋のレイアウト（秋分〜冬至）: 回廊と広場の縁の菊の鉢
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + 0.05
    const r = DOME.plaza.r1 + 0.75
    const [s, t] = [Math.cos(a) * r, Math.sin(a) * r]
    if (pathDistance(s, t) < 0.2) continue
    plants.push({ kind: 'mum', s, t, h: 0, size: 0.55 + rnd() * 0.25, rot: rnd() * 6, tint: rnd() })
  }
  // つる（回廊の手すりから垂れる）: 幹の回廊の内と外の縁・枝の回廊の内の縁
  const vines = (r: number, hTop: number, n: number, len0: number, len1: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.04
      if (rnd() < 0.3) continue
      const [s, t] = [Math.cos(a) * r, Math.sin(a) * r]
      plants.push({ kind: 'vine', s, t, h: hTop, size: 1, rot: a, tint: rnd(), len: len0 + rnd() * (len1 - len0) })
    }
  }
  // 核の岩の棚の植え込み（シダ・苔・オオタニワタリ）と、踊り場・テラスの縁から垂れる長いつる
  for (const lh of CORE_LEDGES) {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rnd() * 0.15
      if (Math.abs(angDiff(a, -Math.PI / 2)) < 0.35) continue
      const rr = rockRadius(a, lh + 0.1) - 0.1
      const k = rnd()
      const kind: PlantKind = k < 0.5 ? 'fern' : k < 0.75 ? 'nestFern' : 'moss'
      plants.push({ kind, s: Math.cos(a) * rr, t: Math.sin(a) * rr, h: lh + 0.12, size: kind === 'moss' ? 0.6 + rnd() * 0.4 : 0.7 + rnd() * 0.6, rot: rnd() * 6, tint: rnd() })
      if (rnd() < 0.45) plants.push({ kind: 'vine', s: Math.cos(a) * (rr + 0.25), t: Math.sin(a) * (rr + 0.25), h: lh + 0.1, size: 1, rot: a, tint: rnd(), len: 1.5 + rnd() * 3 })
    }
  }
  vines(DOME.landing.r1 + 0.08, DOME.landing.h - 0.42, 46, 2.5, 7.5)
  vines(DOME.L3.r + 0.1, DOME.L3.h - 0.45, 56, 3.5, 9.5)
  vines(DOME.L1.r0 - 0.15, DOME.L1.h - 0.1, 150, 1.5, 4.8)
  vines(DOME.L1.r1 + 0.15, DOME.L1.h - 0.1, 130, 1.2, 4.2)
  vines(DOME.L2.r0 - 0.15, DOME.L2.h - 0.1, 110, 2.0, 7.5)
  vines(DOME.L2.r1 + 0.15, DOME.L2.h - 0.1, 90, 1.5, 5.0)
  // スロープ A の下の口の石畳の上と縁には置かない（乱数の並びを変えないよう、置いたあとで外す）
  const offFoot = (p: { s: number; t: number; h: number }) => p.h > 0.5 || rampFootDistance(p.s, p.t) > 0.5
  return { plants: plants.filter(offFoot), trees: trees.filter(offFoot) }
}

/** 一度だけ作って使い回す */
let cache: DomePlanting | null = null
export function planting() {
  return (cache ??= domePlanting())
}
