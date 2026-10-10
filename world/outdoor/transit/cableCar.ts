import * as THREE from 'three'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { GeoBuilder } from '../site/builder'
import { TOWN_LIGHT } from '../town/facades'
import { TOWN_LAMPS, lampUniforms } from '../town/lamps'
import { TOWN_SHADOW, townShadowUniforms } from '../town/shadows'

/**
 * 丘ノ上ケーブルの細かい車両（さくら号・かえで号。1996 年製の二代目・内装は木張り。vol3 4-4。docs/design/town.md §19・§7 の 176〜）。
 * カメラから 90m 以内の車両と、花音が乗っている車両だけ、この形で描く（遠くは vehicles.ts の安い形のインスタンス）。
 *
 * 車両の局所の座標: 原点 = 車両の中心のレール面、+z = 山の側、+x = 山を向いて左（北西）、y = 上。レールの線は局所で勾配 0.12（slope）。
 * - 4 つの段（区画。長さ 2.875m）の段々の床（となりの段と 0.345m 違う）。区画ごとに両側に扉（外吊りの引き戸。開くと谷の側へ滑る）、
 *   扉の前後に窓（木の窓枠・下の窓を上げる二段の窓）、両端に向かい合う長いす（車両の幅いっぱい。臙脂のモケットと木の台・背もたれの上の真鍮の握り）
 * - 区画の間は腰まで木の仕切りと、上はガラス。天井は生成りの塗装で、区画ごとに丸い灯り・真ん中に横の握り棒とつり革 4 つ・扉のわきに真鍮の縦の握り棒
 * - 外: 赤い腰・クリームの窓の帯・赤の幕板・灰色の屋根（区画ごとの段）・前後の大きな窓と前照灯と尾灯・扉のレール・台車と車輪・綱の留め金
 * - シェーダー: 町と同じ光（太陽・空・町の影・夜の灯りの表）。中の面は空の光が窓の分だけ入り、太陽は窓を通る分だけ（日なたの形）。
 *   区画ごとの天井の灯り（車両の局所で計算）。ガラスは透けて、空と（中から見ると夜は）中の灯りを映す
 * - インスタンスの iInfo = (中の灯り 0〜1, 車両（0 = さくら号・1 = かえで号）, +x の側の扉の開き具合, −x の側の扉の開き具合)
 */

/** 車両の寸法（局所の座標。乗り物の形 cableVehicle.ts・乗る仕組み character/ride/cableRide.ts も使う） */
export const CABLE_CAR = {
  length: 11.5,
  halfL: 5.75,
  halfW: 1.3,
  innerW: 1.17,
  /** 端の壁の中の面（z の半分） */
  innerL: 5.63,
  /** 形の段々の床の勾配（線路の勾配との差だけ車体を傾ける） */
  slope: 0.12,
  comps: 4,
  compL: 2.875,
  /** 区画の真ん中のレールの線から床までの高さ */
  floorAbove: 0.82,
  /** 床から天井（両わき・真ん中） */
  ceilSide: 2.0,
  ceilMid: 2.12,
  /** 扉（区画の真ん中。幅・高さ）と、開いたときに滑る長さ */
  doorW: 0.8,
  doorH: 1.9,
  doorSlide: 0.86,
  /** 窓（床からの下端・上端）と、区画の真ん中から窓までの間 */
  winY0: 0.95,
  winY1: 1.88,
  /** 長いす（奥行き・座面の高さ・背もたれの上）と仕切りの厚み */
  benchDepth: 0.47,
  seatH: 0.42,
  backH: 0.93,
  partition: 0.06,
} as const

const C = CABLE_CAR
const HL = C.halfL
const W = C.halfW
const IW = C.innerW
const IL = C.innerL

/** 区画 i の z（谷の側の端・山の側の端・真ん中） */
export function compZ(i: number) {
  const za = -HL + i * C.compL
  return { za, zb: za + C.compL, zc: za + C.compL / 2 }
}

/** 区画 i の床の高さ（局所の y） */
export function compFloor(i: number) {
  return C.slope * compZ(i).zc + C.floorAbove
}

/** 局所の z の区画の番号 */
export function compAt(z: number) {
  return Math.max(0, Math.min(C.comps - 1, Math.floor((z + HL) / C.compL)))
}

/** 材質の番号（aMat.x） */
export const KM = {
  /** 外の塗装（赤・クリーム）。aux = つや */
  paint: 0,
  /** 木の板（壁の腰板・仕切り・窓枠・長いすの台）。aux = 木目の向き（0 = 横・1 = 縦） */
  wood: 1,
  /** 長いすのモケット（臙脂） */
  fabric: 2,
  /** 真鍮・ステンレス（握り棒・つり革の輪の金具）。aux = 0 真鍮・1 ステンレス */
  metal: 3,
  /** 床（木の板張り） */
  floor: 4,
  /** 天井（生成りの塗装） */
  ceiling: 5,
  /** 灯り（中の灯りの点き具合で光る）。aux = 0 中の灯り・1 前照灯・2 尾灯 */
  lamp: 6,
  /** 黒いゴム・台車・床下。aux = つや */
  dark: 7,
  /** 灰色の屋根 */
  roof: 8,
  /** つり革の帯（白い樹脂） */
  strap: 9,
  /** 名前の板（さくら号・かえで号の字。aux = 1 なら字を左右に反転して読む向きに） */
  plate: 10,
} as const

const RED = '#a82b23'
const CREAM = '#efe3c4'
const WOOD = '#8a5a34'
const WOOD_D = '#5e3a20'
const WOOD_L = '#b07a48'
const MOQ = '#7a1f24'
const BRASS = '#c9a24e'
const STEEL = '#c4c9cc'
const ROOF = '#5b5e60'
const CEIL = '#efe6d2'

type V3 = [number, number, number]

/** 2 点を結ぶ管（8 角） */
function tube(g: GeoBuilder, a: V3, b: V3, r: number, color: string, m: number, aux = 0, seg = 8) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = d.length()
  if (len < 1e-4) return
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  const mtx = new THREE.Matrix4().compose(new THREE.Vector3(...a), q, new THREE.Vector3(1, 1, 1))
  g.lathe(
    [
      [r, 0],
      [r, len],
    ],
    seg,
    mtx,
    color,
    m,
    aux,
  )
}

/** 輪（中心・輪の面の法線の向き（x か z）・半径・太さ） */
function ring(g: GeoBuilder, c: V3, axis: 'x' | 'z', R: number, r: number, color: string, m: number, aux = 0) {
  const prof: [number, number][] = []
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2
    prof.push([R + Math.cos(a) * r, Math.sin(a) * r])
  }
  const mtx = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  if (axis === 'x') mtx.premultiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
  mtx.setPosition(c[0], c[1], c[2])
  g.lathe(prof, 14, mtx, color, m, aux)
}

/** z0〜z1・y0〜y1 の縦の面（x の位置、外向き sx） */
function sideRect(g: GeoBuilder, x: number, sx: number, z0: number, z1: number, y0: number, y1: number, color: string, m: number, aux = 0) {
  if (z1 - z0 < 1e-4 || y1 - y0 < 1e-4) return
  if (sx > 0) g.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], color, m, aux)
  else g.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], color, m, aux)
}

/** x0〜x1・y0〜y1 の z の面（向き sz） */
function endRect(g: GeoBuilder, z: number, sz: number, x0: number, x1: number, y0: number, y1: number, color: string, m: number, aux = 0) {
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return
  if (sz > 0) g.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], color, m, aux)
  else g.quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], color, m, aux)
}

/** 屋根の断面の高さ（床から。x = 横の位置） */
const roofY = (x: number) => 2.22 + 0.23 * (1 - (x / W) ** 2)
/** 天井の高さ（床から） */
const ceilY = (x: number) => C.ceilSide + (C.ceilMid - C.ceilSide) * (1 - (x / IW) ** 2)

/** 区画の側の開口（z の範囲）: 谷の側の窓・扉・山の側の窓 */
function openings(zc: number) {
  const half = C.doorW / 2
  return { a0: zc - C.compL / 2 + 0.15, a1: zc - half - 0.13, d0: zc - half, d1: zc + half, b0: zc + half + 0.13, b1: zc + C.compL / 2 - 0.15 }
}

export interface CableCarGeometry {
  body: THREE.BufferGeometry
  glass: THREE.BufferGeometry
  /** 扉（+x の側・−x の側。区画の真ん中・床の高さを原点にした形） */
  doorL: THREE.BufferGeometry
  doorR: THREE.BufferGeometry
  doorGlassL: THREE.BufferGeometry
  doorGlassR: THREE.BufferGeometry
}

/** 細かい車両の形（車両の局所） */
export function cableCarGeometry(): CableCarGeometry {
  const g = new GeoBuilder()
  const gl = new GeoBuilder()
  for (let i = 0; i < C.comps; i++) compartment(g, gl, i)
  for (const sz of [-1, 1]) carEnd(g, gl, sz)
  underframe(g)
  const doors = [1, -1].map((sx) => doorLeaf(sx))
  return { body: g.build(), glass: gl.build(), doorL: doors[0].g.build(), doorR: doors[1].g.build(), doorGlassL: doors[0].gl.build(), doorGlassR: doors[1].gl.build() }
}

/** 区画 i: 外の殻（側・屋根・段の立ち上がり）・中（床・腰板・窓枠・天井・仕切り・長いす・握り棒・つり革・灯り） */
function compartment(g: GeoBuilder, gl: GeoBuilder, i: number) {
  const { za, zb, zc } = compZ(i)
  const F = compFloor(i)
  const o = openings(zc)
  const yb = F - 0.45
  const yWaist = F + 0.92
  const yLetter = F + 1.98
  const yTop = F + 2.22
  const w0 = F + C.winY0
  const w1 = F + C.winY1
  const dTop = F + C.doorH
  const color = (y0: number, y1: number): string => (y1 <= yWaist + 1e-4 ? RED : y0 >= yLetter - 1e-4 ? RED : CREAM)
  // 塗り分けの高さで切って、外の面を貼る
  const paintRect = (sx: number, z0: number, z1: number, y0: number, y1: number) => {
    const cuts = [y0, ...[yWaist, yLetter].filter((y) => y > y0 + 1e-4 && y < y1 - 1e-4), y1]
    for (let k = 0; k < cuts.length - 1; k++) sideRect(g, sx * W, sx, z0, z1, cuts[k], cuts[k + 1], color(cuts[k], cuts[k + 1]), KM.paint, 0.6)
  }
  for (const sx of [1, -1]) {
    // --- 外の側面（窓・扉の開口を除く） ---
    const segs: [number, number, [number, number][]][] = [
      [za, o.a0, []],
      [o.a0, o.a1, [[w0, w1]]],
      [o.a1, o.d0, []],
      [o.d0, o.d1, [[F, dTop]]],
      [o.d1, o.b0, []],
      [o.b0, o.b1, [[w0, w1]]],
      [o.b1, zb, []],
    ]
    for (const [z0, z1, holes] of segs) {
      let y = yb
      for (const [h0, h1] of holes) {
        paintRect(sx, z0, z1, y, h0)
        y = h1
      }
      paintRect(sx, z0, z1, y, yTop)
    }
    // 雨どい（幕板の上）と窓の下の細い帯
    g.boxMinMax(sx > 0 ? W - 0.01 : -W - 0.045, yTop - 0.03, za, sx > 0 ? W + 0.045 : -W + 0.01, yTop + 0.015, zb, '#6a2019', KM.paint, 0.5)
    g.boxMinMax(sx > 0 ? W - 0.01 : -W - 0.02, yWaist - 0.02, za, sx > 0 ? W + 0.02 : -W + 0.01, yWaist + 0.012, zb, '#d8cba8', KM.paint, 0.6)
    // --- 開口の見込み（外の面から中の面まで）。窓は木の枠、扉は塗装 ---
    const xo = sx * W
    const xi = sx * IW
    const jambZ = (z: number, y0: number, y1: number, col: string, m: number, toward: number) => {
      // z の位置の見込み（x の向きに外から中へ。開口の内側を向く）
      if (toward > 0) g.quad([xo, y0, z], [xi, y0, z], [xi, y1, z], [xo, y1, z], col, m, 1)
      else g.quad([xi, y0, z], [xo, y0, z], [xo, y1, z], [xi, y1, z], col, m, 1)
    }
    const jambY = (y: number, z0: number, z1: number, col: string, m: number, up: boolean) => {
      if (up) g.quad([xo, y, z0], [xo, y, z1], [xi, y, z1], [xi, y, z0], col, m, 0)
      else g.quad([xi, y, z0], [xi, y, z1], [xo, y, z1], [xo, y, z0], col, m, 0)
    }
    for (const [z0, z1] of [
      [o.a0, o.a1],
      [o.b0, o.b1],
    ]) {
      jambZ(z0, w0, w1, WOOD, KM.wood, 1)
      jambZ(z1, w0, w1, WOOD, KM.wood, -1)
      jambY(w0, z0, z1, WOOD_D, KM.wood, true)
      jambY(w1, z0, z1, WOOD, KM.wood, false)
      // 木の窓枠（中の面の縁取り）・窓台・真ん中の桟（下の窓の上の框）と、ガラス（上と下の 2 枚）
      const x1 = xi - sx * 0.035
      const fr = (za0: number, za1: number, y0: number, y1: number) => g.boxMinMax(Math.min(xi, x1), y0, za0, Math.max(xi, x1), y1, za1, WOOD_L, KM.wood, 1)
      fr(z0 - 0.06, z0, w0 - 0.06, w1 + 0.06)
      fr(z1, z1 + 0.06, w0 - 0.06, w1 + 0.06)
      fr(z0 - 0.06, z1 + 0.06, w1, w1 + 0.06)
      g.boxMinMax(Math.min(xi, xi - sx * 0.08), w0 - 0.045, z0 - 0.06, Math.max(xi, xi - sx * 0.08), w0, z1 + 0.06, WOOD_L, KM.wood, 0)
      const ym = w0 + (w1 - w0) * 0.47
      const xm = sx * (IW + 0.045)
      g.boxMinMax(Math.min(xm - sx * 0.03, xm + sx * 0.03), ym - 0.025, z0, Math.max(xm - sx * 0.03, xm + sx * 0.03), ym + 0.035, z1, WOOD_L, KM.wood, 0)
      // 外の窓枠（クリームの塗装の細い縁）
      for (const zz of [z0, z1]) g.boxMinMax(Math.min(xo, xo + sx * 0.012), w0, zz - 0.02, Math.max(xo, xo + sx * 0.012), w1, zz + 0.02, '#e9dcbb', KM.paint, 0.7)
      // ガラス（下の窓は少し外、上の窓は少し中。下の窓を上げる二段の窓）
      const gxLo = sx * (W - 0.03)
      const gxHi = sx * (W - 0.06)
      sideRect(gl, gxLo, sx, z0, z1, w0, ym, '#ffffff', 0)
      sideRect(gl, gxHi, sx, z0, z1, ym, w1, '#ffffff', 0)
    }
    // 扉の開口の見込み（左右と上）と敷居
    jambZ(o.d0, F, dTop, '#d8cba8', KM.paint, 1)
    jambZ(o.d1, F, dTop, '#d8cba8', KM.paint, -1)
    jambY(dTop, o.d0, o.d1, '#d8cba8', KM.paint, false)
    g.boxMinMax(Math.min(xo + sx * 0.02, xi), F - 0.012, o.d0, Math.max(xo + sx * 0.02, xi), F + 0.008, o.d1, '#b8bcbe', KM.metal, 1)
    // 乗り口のステップの縁（黄色い線）
    g.boxMinMax(Math.min(xo + sx * 0.025, xo - sx * 0.05), F - 0.015, o.d0 + 0.02, Math.max(xo + sx * 0.025, xo - sx * 0.05), F + 0.004, o.d1 - 0.02, '#d9b23a', KM.paint, 0.3)
    // --- 中の側面（腰板 = 木、窓の上 = 生成り）---
    const inner = (z0: number, z1: number, y0: number, y1: number) => {
      const cut = F + 0.98
      if (y0 < cut) sideRect(g, xi, -sx, z0, z1, y0, Math.min(cut, y1), WOOD, KM.wood, 1)
      if (y1 > cut) sideRect(g, xi, -sx, z0, z1, Math.max(cut, y0), y1, y0 >= w1 - 1e-4 ? CEIL : WOOD, y0 >= w1 - 1e-4 ? KM.ceiling : KM.wood, 1)
    }
    for (const [z0, z1, holes] of segs) {
      let y = F
      for (const [h0, h1] of holes) {
        inner(z0, z1, y, Math.max(y, h0))
        y = h1
      }
      inner(z0, z1, y, F + C.ceilSide)
    }
    // 腰板の上の見切り（木の細い帯）
    for (const [z0, z1] of [
      [za + C.partition / 2, o.d0],
      [o.d1, zb - C.partition / 2],
    ])
      g.boxMinMax(Math.min(xi, xi - sx * 0.025), F + 0.9, z0, Math.max(xi, xi - sx * 0.025), F + 0.93, z1, WOOD_D, KM.wood, 0)
    // --- 扉のわきの真鍮の縦の握り棒（中）と、外の握り（扉の山の側） ---
    for (const z of [o.d0 - 0.07, o.d1 + 0.07]) {
      tube(g, [sx * (IW - 0.07), F + 0.55, z], [sx * (IW - 0.07), F + 1.75, z], 0.016, BRASS, KM.metal, 0)
      for (const y of [F + 0.55, F + 1.75]) tube(g, [sx * IW, y, z], [sx * (IW - 0.075), y, z], 0.011, BRASS, KM.metal, 0)
    }
    tube(g, [sx * (W + 0.06), F + 0.75, o.d1 + 0.09], [sx * (W + 0.06), F + 1.4, o.d1 + 0.09], 0.014, STEEL, KM.metal, 1)
    for (const y of [F + 0.75, F + 1.4]) tube(g, [sx * W, y, o.d1 + 0.09], [sx * (W + 0.065), y, o.d1 + 0.09], 0.01, STEEL, KM.metal, 1)
    // 扉のレール（外。扉の上と下。開くと谷の側へ）
    g.boxMinMax(Math.min(sx * (W + 0.005), sx * (W + 0.075)), dTop + 0.02, o.d0 - C.doorSlide - 0.05, Math.max(sx * (W + 0.005), sx * (W + 0.075)), dTop + 0.075, o.d1 + 0.04, '#8c8f90', KM.metal, 1)
    g.boxMinMax(Math.min(sx * (W + 0.005), sx * (W + 0.06)), F - 0.06, o.d0 - C.doorSlide - 0.05, Math.max(sx * (W + 0.005), sx * (W + 0.06)), F - 0.025, o.d1 + 0.04, '#3a3b3c', KM.dark, 0.3)
  }
  // --- 屋根（区画ごと。断面を z へ押し出す）と、段の立ち上がり ---
  const N = 8
  const rx = (k: number) => -W + (2 * W * k) / N
  for (let k = 0; k < N; k++) {
    const x0 = rx(k)
    const x1 = rx(k + 1)
    g.quad([x0, F + roofY(x0), zb], [x1, F + roofY(x1), zb], [x1, F + roofY(x1), za], [x0, F + roofY(x0), za], ROOF, KM.roof, 0)
  }
  // 屋根の上の歩み板（真ん中）
  g.boxMinMax(-0.2, F + roofY(0) - 0.01, za + 0.1, 0.2, F + roofY(0) + 0.025, zb - 0.1, '#46494b', KM.dark, 0.1)
  // 屋根の縁（幕板の上の水切り）
  for (const sx of [1, -1]) g.boxMinMax(Math.min(sx * (W - 0.02), sx * (W + 0.03)), F + 2.2, za, Math.max(sx * (W - 0.02), sx * (W + 0.03)), F + 2.24, zb, '#4a4c4e', KM.roof, 0)
  // 山の側の区画との境: 上は屋根の段（谷を向く立ち上がり）、下は床下の段（山を向く）
  if (i < C.comps - 1) {
    const F2 = compFloor(i + 1)
    for (let k = 0; k < N; k++) {
      const x0 = rx(k)
      const x1 = rx(k + 1)
      g.quad([x1, F + roofY(x1), zb], [x0, F + roofY(x0), zb], [x0, F2 + roofY(x0), zb], [x1, F2 + roofY(x1), zb], RED, KM.paint, 0.6)
    }
    endRect(g, zb, 1, -W, W, yb, F2 - 0.45, '#2a2a2a', KM.dark, 0.2)
  }
  // --- 中: 床（木の板）・天井（生成り）・天井の段 ---
  const zf0 = i === 0 ? -IL : za + C.partition / 2
  const zf1 = i === C.comps - 1 ? IL : zb - C.partition / 2
  g.quad([-IW, F, zf1], [IW, F, zf1], [IW, F, zf0], [-IW, F, zf0], '#6b4a30', KM.floor, 0)
  for (let k = 0; k < N; k++) {
    const x0 = -IW + (2 * IW * k) / N
    const x1 = -IW + (2 * IW * (k + 1)) / N
    g.quad([x0, F + ceilY(x0), zf0], [x1, F + ceilY(x1), zf0], [x1, F + ceilY(x1), zf1], [x0, F + ceilY(x0), zf1], CEIL, KM.ceiling, 0)
  }
  // 天井の縁の木の回り縁
  for (const sx of [1, -1]) g.boxMinMax(Math.min(sx * IW, sx * (IW - 0.05)), F + C.ceilSide - 0.05, zf0, Math.max(sx * IW, sx * (IW - 0.05)), F + C.ceilSide, zf1, WOOD, KM.wood, 0)
  // --- 仕切り（山の側の区画との境）: 腰まで木・上はガラス・天井の段 ---
  if (i < C.comps - 1) {
    const F2 = compFloor(i + 1)
    const z0 = zb - C.partition / 2
    const z1 = zb + C.partition / 2
    const top = F2 + C.backH
    // 谷の側から見た面（床から、山の区画の背もたれの上まで）と、山の側から見た面
    endRect(g, z0, -1, -IW, IW, F, top, WOOD, KM.wood, 1)
    endRect(g, z1, 1, -IW, IW, F2, top, WOOD, KM.wood, 1)
    g.boxMinMax(-IW, top, z0 - 0.02, IW, top + 0.04, z1 + 0.02, WOOD_D, KM.wood, 0)
    // ガラス（真ん中の木の縦の桟で 2 枚）と枠
    const gTop = F + C.ceilSide - 0.05
    for (const [x0, x1] of [
      [-IW + 0.04, -0.03],
      [0.03, IW - 0.04],
    ])
      endRect(gl, zb, 1, x0, x1, top + 0.04, gTop, '#ffffff', 0)
    g.boxMinMax(-0.03, top + 0.04, z0, 0.03, gTop, z1, WOOD_L, KM.wood, 1)
    g.boxMinMax(-IW, gTop, z0, IW, F + C.ceilSide, z1, WOOD_L, KM.wood, 0)
    // 天井の段（山の側から見て、下の区画の天井から上の区画の天井まで）
    for (let k = 0; k < N; k++) {
      const x0 = -IW + (2 * IW * k) / N
      const x1 = -IW + (2 * IW * (k + 1)) / N
      g.quad([x0, F + ceilY(x0), z1], [x1, F + ceilY(x1), z1], [x1, F2 + ceilY(x1), z1], [x0, F2 + ceilY(x0), z1], CEIL, KM.ceiling, 0)
    }
    // 谷の側の天井と仕切りの上の間（谷の区画の天井の縁まで）
    g.boxMinMax(-IW, F + C.ceilSide - 0.02, z0 - 0.03, IW, F + ceilY(0) + 0.01, z0, CEIL, KM.ceiling, 0)
  }
  // --- 長いす（両端。谷の側は山を向き、山の側は谷を向く） ---
  for (const end of [-1, 1]) bench(g, i, end)
  // --- 天井: 丸い灯り・横の握り棒とつり革 4 つ ---
  const lc: V3 = [0, F + ceilY(0) - 0.02, zc]
  g.cylinder([0, lc[1] - 0.025, zc], 0.2, 0.025, 24, '#c9b88a', KM.metal, 0, false)
  g.cylinder([0, lc[1] - 0.045, zc], 0.17, 0.02, 24, '#fff1d6', KM.lamp, 0, true)
  const barY = F + 1.93
  tube(g, [-IW + 0.02, barY, zc + 0.32], [IW - 0.02, barY, zc + 0.32], 0.015, BRASS, KM.metal, 0)
  for (const x of [-0.8, 0.8]) tube(g, [x, barY, zc + 0.32], [x, F + ceilY(x), zc + 0.32], 0.01, BRASS, KM.metal, 0)
  for (const x of [-0.72, -0.24, 0.24, 0.72]) {
    g.boxMinMax(x - 0.013, barY - 0.2, zc + 0.315, x + 0.013, barY, zc + 0.325, '#f2efe6', KM.strap, 0)
    ring(g, [x, barY - 0.27, zc + 0.32], 'z', 0.065, 0.011, '#f2efe6', KM.strap, 0)
  }
}

/** 長いす（区画 i の、end = -1 谷の側（山を向く）・+1 山の側（谷を向く）） */
function bench(g: GeoBuilder, i: number, end: number) {
  const { za, zb } = compZ(i)
  const F = compFloor(i)
  const back = end < 0 ? (i === 0 ? -IL : za + C.partition / 2) : i === C.comps - 1 ? IL : zb - C.partition / 2
  const dir = -end
  const zAt = (d: number) => back + dir * d
  const zr = (a: number, b: number): [number, number] => [Math.min(zAt(a), zAt(b)), Math.max(zAt(a), zAt(b))]
  const x0 = -IW + 0.01
  const x1 = IW - 0.01
  // 木の台（前の板と、座面の下の暗い奥）
  const [b0, b1] = zr(0.04, C.benchDepth - 0.02)
  g.boxMinMax(x0 + 0.02, F, b0, x1 - 0.02, F + C.seatH - 0.1, b1, WOOD_D, KM.wood, 0)
  const [f0, f1] = zr(C.benchDepth - 0.05, C.benchDepth - 0.02)
  g.boxMinMax(x0, F + 0.04, f0, x1, F + C.seatH - 0.09, f1, WOOD, KM.wood, 0)
  // 座面（モケット。前の縁を少し丸く）
  const [s0, s1] = zr(0.08, C.benchDepth)
  g.boxMinMax(x0, F + C.seatH - 0.1, s0, x1, F + C.seatH - 0.015, s1, MOQ, KM.fabric, 0)
  const [e0, e1] = zr(C.benchDepth - 0.04, C.benchDepth + 0.01)
  g.boxMinMax(x0, F + C.seatH - 0.08, e0, x1, F + C.seatH - 0.03, e1, MOQ, KM.fabric, 0)
  // 背もたれ（モケットの当て物・木の枠・上の木の笠木と真鍮の握り 2 つ）
  const [r0, r1] = zr(0.03, 0.12)
  g.boxMinMax(x0 + 0.03, F + C.seatH + 0.02, r0, x1 - 0.03, F + C.backH - 0.08, r1, MOQ, KM.fabric, 0)
  const [w0, w1] = zr(0, 0.05)
  g.boxMinMax(x0, F + C.seatH - 0.02, w0, x1, F + C.backH, w1, WOOD, KM.wood, 0)
  const [c0, c1] = zr(-0.005, 0.1)
  g.boxMinMax(x0, F + C.backH - 0.03, c0, x1, F + C.backH + 0.015, c1, WOOD_L, KM.wood, 0)
  for (const x of [-0.75, 0, 0.75]) {
    const z = zAt(0.11)
    tube(g, [x - 0.08, F + C.backH + 0.015, z], [x + 0.08, F + C.backH + 0.015, z], 0.012, BRASS, KM.metal, 0)
  }
  // 座面の下の暖房の格子（黒）
  const [h0, h1] = zr(C.benchDepth - 0.06, C.benchDepth - 0.045)
  g.boxMinMax(-0.5, F + 0.08, h0, 0.5, F + 0.18, h1, '#2a2622', KM.dark, 0.2)
}

/** 車両の端（sz = -1 谷・+1 山）: 外の妻面（大きな窓 2 つ・前照灯・尾灯・名前の板の地）・中の端の壁 */
function carEnd(g: GeoBuilder, gl: GeoBuilder, sz: number) {
  const i = sz < 0 ? 0 : C.comps - 1
  const F = compFloor(i)
  const z = sz * HL
  const zi = sz * IL
  const yb = F - 0.45
  const w0 = F + C.winY0
  const w1 = F + C.winY1
  const yWaist = F + 0.92
  const yLetter = F + 1.98
  // 窓: x = ±(0.12〜1.02)
  const xs: [number, number][] = [
    [-1.02, -0.12],
    [0.12, 1.02],
  ]
  // 外の妻面
  endRect(g, z, sz, -W, W, yb, yWaist, RED, KM.paint, 0.6)
  endRect(g, z, sz, -W, W, yWaist, w0, CREAM, KM.paint, 0.6)
  endRect(g, z, sz, -W, -1.02, w0, w1, CREAM, KM.paint, 0.6)
  endRect(g, z, sz, -0.12, 0.12, w0, w1, CREAM, KM.paint, 0.6)
  endRect(g, z, sz, 1.02, W, w0, w1, CREAM, KM.paint, 0.6)
  endRect(g, z, sz, -W, W, w1, yLetter, CREAM, KM.paint, 0.6)
  endRect(g, z, sz, -W, W, yLetter, F + 2.22, RED, KM.paint, 0.6)
  // 屋根の端のふた
  const N = 8
  for (let k = 0; k < N; k++) {
    const x0 = -W + (2 * W * k) / N
    const x1 = -W + (2 * W * (k + 1)) / N
    if (sz > 0) g.quad([x0, F + 2.22, z], [x1, F + 2.22, z], [x1, F + roofY(x1), z], [x0, F + roofY(x0), z], RED, KM.paint, 0.6)
    else g.quad([x1, F + 2.22, z], [x0, F + 2.22, z], [x0, F + roofY(x0), z], [x1, F + roofY(x1), z], RED, KM.paint, 0.6)
  }
  // 窓の見込み・木の枠・ガラス
  for (const [x0, x1] of xs) {
    g.boxMinMax(x0, w0 - 0.03, Math.min(z, zi), x1, w0, Math.max(z, zi), WOOD_D, KM.wood, 0)
    g.boxMinMax(x0, w1, Math.min(z, zi), x1, w1 + 0.03, Math.max(z, zi), WOOD, KM.wood, 0)
    for (const x of [x0, x1]) g.boxMinMax(x - 0.02, w0, Math.min(z, zi), x + 0.02, w1, Math.max(z, zi), WOOD, KM.wood, 1)
    endRect(gl, z - sz * 0.04, sz, x0, x1, w0, w1, '#ffffff', 0)
    // 中の木の窓枠
    g.boxMinMax(x0 - 0.05, w0 - 0.05, Math.min(zi, zi - sz * 0.03), x1 + 0.05, w0, Math.max(zi, zi - sz * 0.03), WOOD_L, KM.wood, 0)
    g.boxMinMax(x0 - 0.05, w1, Math.min(zi, zi - sz * 0.03), x1 + 0.05, w1 + 0.05, Math.max(zi, zi - sz * 0.03), WOOD_L, KM.wood, 0)
  }
  // 外の窓の上のひさし（幕板の帯）・前照灯（真ん中の下）・尾灯（両わき）・名前の板の地（窓の下の真ん中）
  g.boxMinMax(-1.1, w1 + 0.02, Math.min(z, z + sz * 0.06), 1.1, w1 + 0.05, Math.max(z, z + sz * 0.06), '#6a2019', KM.paint, 0.5)
  const hl = new THREE.Matrix4().makeRotationX((sz * Math.PI) / 2).setPosition(0, F + 0.3, z)
  g.lathe(
    [
      [0.0, 0.06],
      [0.13, 0.05],
      [0.14, 0.0],
    ],
    16,
    hl,
    '#fff6e0',
    KM.lamp,
    1,
  )
  for (const x of [-0.95, 0.95]) g.boxMinMax(x - 0.08, F + 0.22, Math.min(z, z + sz * 0.03), x + 0.08, F + 0.32, Math.max(z, z + sz * 0.03), '#400808', KM.lamp, 2)
  g.boxMinMax(-0.44, F + 0.53, Math.min(z, z + sz * 0.01), 0.44, F + 0.82, Math.max(z, z + sz * 0.01), '#6a2019', KM.paint, 0.5)
  // 名前の板（クリームの地に赤い字。車両ごとの字は シェーダーが名前の絵から引く）
  endRect(g, z + sz * 0.016, sz, -0.42, 0.42, F + 0.55, F + 0.8, '#efe3c4', KM.plate, sz > 0 ? 1 : 0)
  // 中の端の壁（腰板・窓の上は生成り）
  endRect(g, zi, -sz, -IW, IW, F, F + 0.98, WOOD, KM.wood, 1)
  endRect(g, zi, -sz, -IW, -1.02, F + 0.98, w1, WOOD, KM.wood, 1)
  endRect(g, zi, -sz, -0.12, 0.12, F + 0.98, w1, WOOD, KM.wood, 1)
  endRect(g, zi, -sz, 1.02, IW, F + 0.98, w1, WOOD, KM.wood, 1)
  endRect(g, zi, -sz, -IW, IW, w1, F + C.ceilMid, CEIL, KM.ceiling, 0)
  // 車掌の小さな操作盤（窓の下の右。運転の合図のボタン）
  g.boxMinMax(-0.95, F + 0.98, Math.min(zi, zi - sz * 0.12), -0.55, F + 1.08, Math.max(zi, zi - sz * 0.12), '#3a3532', KM.dark, 0.4)
  for (const x of [-0.88, -0.78, -0.68]) g.boxMinMax(x - 0.02, F + 1.08, zi - sz * 0.08, x + 0.02, F + 1.1, zi - sz * 0.05, x < -0.8 ? '#3c9a4a' : '#c43a2a', KM.lamp, 2)
  // 綱の留め金（車両の端のレールの高さ）
  g.boxMinMax(-0.18, sz * HL * C.slope + 0.05, Math.min(z, z + sz * 0.35), 0.18, sz * HL * C.slope + 0.35, Math.max(z, z + sz * 0.35), '#2a2a2a', KM.dark, 0.3)
}

/** 床下・台車・車輪 */
function underframe(g: GeoBuilder) {
  for (let i = 0; i < C.comps; i++) {
    const { za, zb } = compZ(i)
    const F = compFloor(i)
    g.boxMinMax(-W + 0.08, F - 0.62, za, W - 0.08, F - 0.45, zb, '#2a2a2a', KM.dark, 0.2)
  }
  for (const zc of [-3.9, 3.9]) {
    const ry = zc * C.slope
    g.boxMinMax(-1.0, ry + 0.2, zc - 1.1, 1.0, ry + 0.55, zc + 1.1, '#1f1f20', KM.dark, 0.25)
    for (const sx of [1, -1])
      for (const dz of [-0.7, 0.7]) {
        const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx * 0.62, ry + 0.32 + dz * C.slope, zc + dz)
        g.lathe(
          [
            [0.0, -0.06],
            [0.32, -0.06],
            [0.32, 0.06],
            [0.0, 0.06],
          ],
          14,
          m,
          '#2c2c2e',
          KM.dark,
          0.5,
        )
      }
  }
}

/** 扉の板（外吊りの引き戸。区画の真ん中・床を原点に、sx の側。閉じた位置） */
function doorLeaf(sx: number) {
  const g = new GeoBuilder()
  const gl = new GeoBuilder()
  const x0 = sx * (W + 0.012)
  const x1 = sx * (W + 0.052)
  const xa = Math.min(x0, x1)
  const xb = Math.max(x0, x1)
  const h = C.doorW / 2 + 0.03
  const top = C.doorH + 0.04
  const gw0 = 0.98
  const gw1 = 1.8
  g.boxMinMax(xa, 0.02, -h, xb, 0.92, h, RED, KM.paint, 0.6)
  g.boxMinMax(xa, 0.92, -h, xb, gw0, h, CREAM, KM.paint, 0.6)
  g.boxMinMax(xa, gw1, -h, xb, top, h, CREAM, KM.paint, 0.6)
  g.boxMinMax(xa, gw0, -h, xb, gw1, -h + 0.08, CREAM, KM.paint, 0.6)
  g.boxMinMax(xa, gw0, h - 0.08, xb, gw1, h, CREAM, KM.paint, 0.6)
  // 戸先の黒いゴムと、外と中の取っ手
  g.boxMinMax(xa - 0.004, 0.02, h - 0.012, xb + 0.004, top, h + 0.01, '#1c1c1c', KM.dark, 0.3)
  g.boxMinMax(sx > 0 ? xb : xa - 0.02, 0.95, h - 0.11, sx > 0 ? xb + 0.02 : xa, 1.25, h - 0.09, STEEL, KM.metal, 1)
  g.boxMinMax(sx > 0 ? xa - 0.02 : xb, 0.95, h - 0.11, sx > 0 ? xa : xb + 0.02, 1.25, h - 0.09, BRASS, KM.metal, 0)
  sideRect(gl, sx * (W + 0.032), sx, -h + 0.08, h - 0.08, gw0, gw1, '#ffffff', 0)
  return { g, gl }
}

/* -------------------------------------------------------------------------- */
/* シェーダー                                                                     */
/* -------------------------------------------------------------------------- */

const f = (v: number) => v.toFixed(4)

const CAR_GLSL = /* glsl */ `
  const float CAR_HL = ${f(HL)};
  const float CAR_IL = ${f(IL)};
  const float CAR_W = ${f(W)};
  const float CAR_IW = ${f(IW)};
  const float CAR_SLOPE = ${f(C.slope)};
  const float CAR_COMP = ${f(C.compL)};
  const float CAR_FLOOR = ${f(C.floorAbove)};
  float carComp(float z) { return clamp(floor((z + CAR_HL) / CAR_COMP), 0.0, 3.0); }
  float carF(float i) { return CAR_SLOPE * (-CAR_HL + (i + 0.5) * CAR_COMP) + CAR_FLOOR; }
  float carZc(float i) { return -CAR_HL + (i + 0.5) * CAR_COMP; }
  bool carInside(vec3 p) {
    if (abs(p.x) > CAR_IW + 0.012 || abs(p.z) > CAR_IL + 0.012) return false;
    float F = carF(carComp(p.z));
    return p.y > F - 0.03 && p.y < F + ${f(C.ceilMid + 0.04)};
  }
  // 側の壁の面（x = ±CAR_IW）の点が窓の開口か（窓 2 つと扉の窓）
  bool carWindow(float z, float y) {
    float i = carComp(z);
    float F = carF(i);
    float zc = carZc(i);
    float d = abs(z - zc);
    if (y > F + ${f(C.winY0)} && y < F + ${f(C.winY1)} && d > ${f(C.doorW / 2 + 0.13)} && d < ${f(C.compL / 2 - 0.15)}) return true;
    return y > F + 0.98 && y < F + 1.8 && d < ${f(C.doorW / 2 - 0.05)};
  }
  // 中の点 p から光の向き L（局所）へ、窓を通って外へ出るか（側の窓・端の窓）
  float carSunThrough(vec3 p, vec3 L) {
    if (abs(L.x) > 1e-3) {
      float t = (sign(L.x) * CAR_IW - p.x) / L.x;
      if (t > 0.0) {
        vec3 h = p + L * t;
        if (abs(h.z) < CAR_IL && carWindow(h.z, h.y)) return 1.0;
      }
    }
    if (abs(L.z) > 1e-3) {
      float t = (sign(L.z) * CAR_IL - p.z) / L.z;
      if (t > 0.0) {
        vec3 h = p + L * t;
        float F = carF(carComp(h.z));
        if (abs(h.x) < CAR_IW && abs(h.x) > 0.12 && abs(h.x) < 1.02 && h.y > F + ${f(C.winY0)} && h.y < F + ${f(C.winY1)}) return 1.0;
      }
    }
    return 0.0;
  }
`

export const cableCarUniforms = {
  /** 夜の駅・線路の灯りの照り返し（0〜1） */
  uCarNight: { value: 0 },
  /** 名前の板の字（上半分 = さくら号、下半分 = かえで号） */
  uPlate: { value: plateTexture() },
}

/** 名前の板の字の絵（canvas。上半分にさくら号、下半分にかえで号。字だけで、地は透明） */
function plateTexture() {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const g = c.getContext('2d')
  if (!g) return null
  g.clearRect(0, 0, 512, 256)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 88px "Noto Serif CJK JP", "Noto Serif JP", serif'
  // canvas は上が 0。テクスチャは下が 0（flipY）なので、上半分（v 0.5〜1）がさくら号
  g.fillText('さくら号', 256, 64)
  g.fillText('かえで号', 256, 192)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 4
  return t
}

const VERTEX = /* glsl */ `
  attribute vec2 aMat;
  attribute vec4 iInfo;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec4 vInfo;
  varying vec3 vSunLocal;
  varying vec3 vCamLocal;
  uniform vec3 uSunDir;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vWorld = wp.xyz;
    mat3 r = mat3(m);
    vNormal = normalize(r * normal);
    vColor = color;
    vMat = aMat;
    vInfo = iInfo;
    mat3 rt = transpose(r);
    vSunLocal = normalize(rt * uSunDir);
    // 車両の局所（扉の板は区画の真ん中・床が原点。x は車両と同じなので、いつも外の面の扱いになる）
    vLocal = position;
    vLocalN = normal;
    vCamLocal = rt * (cameraPosition - m[3].xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAGMENT = /* glsl */ `
  ${COMMON}
  ${SKY}
  ${TOWN_LIGHT}
  ${TOWN_SHADOW}
  ${TOWN_LAMPS}
  ${CAR_GLSL}
  uniform float uCarNight;
  uniform sampler2D uPlate;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec4 vInfo;
  varying vec3 vSunLocal;
  varying vec3 vCamLocal;
  vec3 envRefl(vec3 R) {
    return R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.22 + uSunLight * 0.03, smoothstep(0.0, -0.25, R.y));
  }
  float woodGrain(vec2 uv) {
    float n = oNoise(vec2(uv.x * 2.0, uv.y * 30.0));
    float rings = 0.5 + 0.5 * sin((uv.y * 70.0 + n * 6.0 + oNoise(uv * vec2(0.6, 4.0)) * 9.0));
    return 0.84 + 0.12 * rings + 0.1 * n;
  }
  void main() {
    vec3 N = normalize(vNormal);
    vec3 Nl = normalize(vLocalN);
    if (!gl_FrontFacing) { N = -N; Nl = -Nl; }
    float id = floor(vMat.x + 0.5);
    float aux = vMat.y;
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);
    vec3 albedo = vColor;
    float gloss = 0.12;
    float metal = 0.0;
    vec3 emit = vec3(0.0);
    bool inside = carInside(vLocal);
    float lampOn = vInfo.x;
    vec3 an = abs(Nl);
    vec2 uv = an.y > 0.7 ? vLocal.xz : an.x > an.z ? vLocal.zy : vLocal.xy;
    if (id < 0.5) {
      // 塗装（つやのある赤とクリーム。下ほど少し汚れる）
      gloss = 0.35 + 0.5 * aux;
      albedo *= 0.96 + 0.06 * oNoise(uv * 3.0 + vInfo.y * 9.0);
      albedo *= 1.0 - 0.1 * (1.0 - smoothstep(-0.6, 0.6, vLocal.y - CAR_SLOPE * vLocal.z));
    } else if (id < 1.5) {
      // 木（ニスを塗った板。aux = 1 なら木目は縦）
      vec2 wuv = aux > 0.5 ? uv.yx : uv;
      albedo *= woodGrain(wuv);
      // 腰板の縦の目地
      if (aux > 0.5 && an.y < 0.5) albedo *= 0.9 + 0.1 * smoothstep(0.0, 0.012, abs(fract((an.x > an.z ? vLocal.z : vLocal.x) * 6.0) - 0.5) * 0.17);
      gloss = 0.32;
    } else if (id < 2.5) {
      // モケット（細かい織りの目）
      float weave = 0.5 + 0.5 * sin(uv.x * 900.0) * sin(uv.y * 900.0);
      albedo *= 0.8 + 0.22 * weave + 0.12 * oNoise(uv * 40.0);
      gloss = 0.02;
    } else if (id < 3.5) {
      metal = 1.0;
      gloss = aux > 0.5 ? 0.75 : 0.62;
      albedo *= 0.92 + 0.08 * oNoise(vec2(uv.x * 3.0, uv.y * 50.0));
    } else if (id < 4.5) {
      // 床（幅 11cm の木の板。目地と色のばらつき・人の通る所のすり減り）
      float row = floor(vLocal.x / 0.11);
      float seam = smoothstep(0.0, 0.008, abs(fract(vLocal.x / 0.11) - 0.5) * 0.11 - 0.05 + 0.008);
      albedo *= (0.82 + 0.25 * oHash(vec2(row, floor(vLocal.z / 1.4 + oHash(vec2(row, 3.0)))))) * woodGrain(vec2(vLocal.x * 3.0, vLocal.z));
      albedo *= 0.6 + 0.4 * seam;
      gloss = 0.22 + 0.15 * (1.0 - smoothstep(0.2, 0.8, abs(vLocal.x)));
    } else if (id < 5.5) {
      albedo *= 0.96 + 0.04 * oNoise(uv * 5.0);
      gloss = 0.08;
    } else if (id < 6.5) {
      // 灯り: 中の灯り・前照灯（運転の間）・尾灯
      albedo = vColor * 0.5;
      if (aux < 0.5) emit = vColor * (0.12 + 3.4 * lampOn);
      else if (aux < 1.5) emit = vColor * (0.2 + 2.6 * lampOn);
      else emit = vColor * (0.4 + 6.0 * lampOn);
      gloss = 0.6;
    } else if (id < 7.5) {
      gloss = 0.05 + 0.4 * aux;
      albedo *= 0.9 + 0.1 * oNoise(uv * 20.0);
    } else if (id < 8.5) {
      gloss = 0.12;
      albedo *= 0.9 + 0.12 * oNoise(uv * vec2(2.0, 12.0));
    } else if (id < 9.5) {
      gloss = 0.15;
    } else {
      // 名前の板: 上半分がさくら号、下半分がかえで号の字（局所の x と、区画の床からの高さで引く）
      float F = carF(carComp(vLocal.z));
      float u = (vLocal.x + 0.42) / 0.84;
      if (aux > 0.5) u = 1.0 - u;
      float v = clamp((vLocal.y - F - 0.55) / 0.25, 0.0, 1.0);
      vec4 tx = texture2D(uPlate, vec2(clamp(u, 0.0, 1.0), (vInfo.y > 0.5 ? 0.0 : 0.5) + v * 0.5));
      albedo = mix(vColor, vec3(0.5, 0.06, 0.05), tx.a);
      gloss = 0.4;
    }
    float sh = townShadow(vWorld, N);
    vec3 col;
    if (inside) {
      // 中: 空の光は窓から（上を向く面ほど少なく、窓に近い面ほど多い）・太陽は窓を通る分だけ・床の照り返し
      float nearWin = 1.0 - smoothstep(0.1, 1.1, CAR_IW - abs(vLocal.x));
      float ao = (Nl.y < -0.5 ? 0.22 : Nl.y > 0.5 ? 0.3 : 0.34) * (0.7 + 0.45 * nearWin);
      float sun = carSunThrough(vLocal, vSunLocal) * max(dot(Nl, vSunLocal), 0.0) * sh;
      col = albedo * (uSunLight * sun + (uSkyLight * 0.9 + uSunLight * 0.05) * ao);
    } else {
      col = townLight(albedo * (1.0 - metal * 0.6), N, 1.0, sh);
    }
    vec3 H = normalize(V + uSunDir);
    float pw = mix(10.0, 260.0, gloss);
    float fres = mix(0.04, 0.9, metal) + (1.0 - mix(0.04, 0.9, metal)) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
    if (!inside) col += uSunLight * pow(max(dot(N, H), 0.0), pw) * (pw + 2.0) / 8.0 * fres * sh * max(dot(N, uSunDir), 0.0) * gloss;
    vec3 R = reflect(-V, N);
    vec3 env = envRefl(R);
    if (inside) env = mix(vec3(0.5, 0.42, 0.32) * (uSkyLight * 0.25 + vec3(0.06, 0.045, 0.03) * lampOn), env, 0.25);
    col += env * fres * mix(gloss * 0.5, 0.9, metal) * mix(vec3(1.0), albedo * 2.0, metal);
    // 区画の天井の灯り（車両の局所。自分の区画の灯りと、仕切りのガラス越しのとなりの灯り少し）
    if (inside) {
      float ci = carComp(vLocal.z);
      vec3 lamp = vec3(0.0, carF(ci) + ${f(C.ceilMid - 0.1)}, carZc(ci));
      vec3 Lv = lamp - vLocal;
      float d2 = dot(Lv, Lv);
      vec3 Ll = Lv * inversesqrt(max(d2, 1e-4));
      float ndl = max(dot(Nl, Ll), 0.0);
      vec3 LC = vec3(1.0, 0.8, 0.58) * 1.7;
      col += albedo * LC * lampOn * (ndl * 0.8 + 0.2) / (d2 * 0.9 + 0.45);
      // 木の壁と天井の照り返し（暖かい色）
      col += albedo * LC * lampOn * 0.09;
      // 夜の駅の灯り・線路の灯りが窓から入る分（少し）
      col += albedo * townLamps(vWorld, N) * 0.25;
    } else {
      col += albedo * townLamps(vWorld, N) * 0.6;
      // 窓のまわりの外の面に、中の灯りが少し漏れる
      col += albedo * vec3(1.0, 0.8, 0.58) * lampOn * 0.08 * smoothstep(CAR_W + 0.15, CAR_W - 0.05, abs(vLocal.x)) * (1.0 - smoothstep(0.0, 0.2, abs(Nl.y)));
    }
    col = outdoorHaze(col, vWorld);
    col += emit * exp(-dist / (uHazeDist * 1.5));
    gl_FragColor = vec4(col, 1.0);
    ${TONE}
  }
`

/** 細かい車両の不透明な面のシェーダー（インスタンス）。door = 扉の板（局所が区画ごとなので、いつも外の面の扱い） */
export function createCableCarMaterial(door = false) {
  return new THREE.ShaderMaterial({
    name: door ? 'cableCarDoor' : 'cableCar',
    vertexColors: true,
    side: THREE.DoubleSide,
    defines: door ? { CAR_DOOR: 1 } : {},
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...lampUniforms, ...cableCarUniforms },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
}

/** 細かい車両のガラス（透ける。空と、中から見ると夜は中の灯りを映す。外から夜は中の灯りの色） */
export function createCableCarGlassMaterial(door = false) {
  return new THREE.ShaderMaterial({
    name: door ? 'cableCarDoorGlass' : 'cableCarGlass',
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    defines: door ? { CAR_DOOR: 1 } : {},
    uniforms: { ...outdoorUniforms },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      ${CAR_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec2 vMat;
      varying vec3 vLocal;
      varying vec3 vLocalN;
      varying vec4 vInfo;
      varying vec3 vSunLocal;
      varying vec3 vCamLocal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float cosv = max(dot(N, V), 0.0);
        float fres = 0.04 + 0.96 * pow(clamp(1.0 - cosv, 0.0, 1.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 refl = R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.22, smoothstep(0.0, -0.25, R.y));
        refl += uSunLight * pow(max(dot(R, uSunDir), 0.0), 900.0) * 30.0 * smoothstep(-0.02, 0.05, uSunDir.y);
        #ifdef CAR_DOOR
        bool camIn = abs(vCamLocal.x) < CAR_IW;
        #else
        bool camIn = carInside(vCamLocal);
        #endif
        float lampOn = vInfo.x;
        vec3 room = vec3(0.9, 0.72, 0.5) * lampOn * 0.3;
        float a = clamp(0.06 + fres * 0.85, 0.0, 0.92);
        vec3 col = refl;
        if (camIn) {
          // 中から: 夜は中の灯りに照らされた中が映る
          col = mix(refl, room + refl * 0.4, clamp(lampOn * 0.7 * (1.0 - uDaylight), 0.0, 0.7));
          a = clamp(a + lampOn * 0.1 * (1.0 - uDaylight), 0.0, 0.92);
        } else {
          // 外から: 夜は中の灯りが見える（暖かい色が少し）
          col += room * 0.6 * (1.0 - uDaylight);
        }
        col = mix(vec3(0.03, 0.035, 0.03), col, 0.92);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, a);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* 細かい車両の入れ物                                                            */
/* -------------------------------------------------------------------------- */

const _dm = new THREE.Matrix4()
const _tm = new THREE.Matrix4()

/** 細かい車両（最大 capacity 両）。毎コマ begin → add（車両の局所 → シーンの行列・iInfo）→ end */
export class CableCarDetail {
  readonly meshes: THREE.InstancedMesh[]
  private body: THREE.InstancedMesh
  private glass: THREE.InstancedMesh
  private doors: THREE.InstancedMesh[]
  private doorGlass: THREE.InstancedMesh[]
  private infos: THREE.InstancedBufferAttribute[] = []
  private doorInfos: THREE.InstancedBufferAttribute[] = []
  private count = 0
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    const geo = cableCarGeometry()
    const mat = createCableCarMaterial()
    const glassMat = createCableCarGlassMaterial()
    const doorMat = createCableCarMaterial(true)
    const doorGlassMat = createCableCarGlassMaterial(true)
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, name: string, n: number, infos: THREE.InstancedBufferAttribute[]) => {
      const info = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)
      info.setUsage(THREE.DynamicDrawUsage)
      g.setAttribute('iInfo', info)
      const mesh = new THREE.InstancedMesh(g, m, n)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.name = `transit:cableCar:${name}`
      infos.push(info)
      return mesh
    }
    this.body = mk(geo.body, mat, 'body', capacity, this.infos)
    this.glass = mk(geo.glass, glassMat, 'glass', capacity, this.infos)
    const nd = capacity * C.comps
    this.doors = [mk(geo.doorL, doorMat, 'doorL', nd, this.doorInfos), mk(geo.doorR, doorMat, 'doorR', nd, this.doorInfos)]
    this.doorGlass = [mk(geo.doorGlassL, doorGlassMat, 'doorGlassL', nd, this.doorInfos), mk(geo.doorGlassR, doorGlassMat, 'doorGlassR', nd, this.doorInfos)]
    this.glass.renderOrder = 22
    for (const m of this.doorGlass) m.renderOrder = 22
    this.meshes = [this.body, this.glass, ...this.doors, ...this.doorGlass]
  }

  begin() {
    this.count = 0
  }

  /** 1 両（m = 車両の局所 → シーンの行列、info = (中の灯り, 車両, +x の扉の開き具合, −x の扉の開き具合)） */
  add(m: THREE.Matrix4, info: readonly [number, number, number, number]) {
    const i = this.count
    if (i >= this.capacity) return false
    this.body.setMatrixAt(i, m)
    this.glass.setMatrixAt(i, m)
    for (const a of this.infos) a.setXYZW(i, info[0], info[1], info[2], info[3])
    for (let s = 0; s < 2; s++) {
      const open = s === 0 ? info[2] : info[3]
      const e = open * open * (3 - 2 * open)
      for (let c = 0; c < C.comps; c++) {
        const { zc } = compZ(c)
        _tm.makeTranslation(0, compFloor(c), zc - e * C.doorSlide)
        _dm.multiplyMatrices(m, _tm)
        const k = i * C.comps + c
        this.doors[s].setMatrixAt(k, _dm)
        this.doorGlass[s].setMatrixAt(k, _dm)
      }
    }
    for (const a of this.doorInfos) for (let c = 0; c < C.comps; c++) a.setXYZW(i * C.comps + c, info[0], info[1], info[2], info[3])
    this.count++
    return true
  }

  end() {
    const n = this.count
    for (const mesh of [this.body, this.glass]) this.finish(mesh, n)
    for (const mesh of [...this.doors, ...this.doorGlass]) this.finish(mesh, n * C.comps)
    for (const a of this.infos) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, n * 4)
      a.needsUpdate = true
    }
    for (const a of this.doorInfos) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, n * C.comps * 4)
      a.needsUpdate = true
    }
  }

  private finish(mesh: THREE.InstancedMesh, count: number) {
    mesh.count = count
    mesh.visible = count > 0
    if (count) {
      mesh.instanceMatrix.clearUpdateRanges()
      mesh.instanceMatrix.addUpdateRange(0, count * 16)
      mesh.instanceMatrix.needsUpdate = true
    }
  }
}
