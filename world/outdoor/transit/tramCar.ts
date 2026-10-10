import * as THREE from 'three'
import { GeoBuilder } from '../site/builder'
import { transitUniforms } from './transitMaterial'
import { TRAM_GAP, TRAM_SECTION, WIRE_HEIGHT } from './vehicles'
import { InstancedPart, VM, createDetailGlassMaterial, createDetailMaterial, endRect, flatRect, ring, sideRect, tube, type V3, type VehicleGlsl } from './vehicleDetail'

/**
 * 緑電 9100 形「ひらき」（3 両連接の低床車。vol3 4-3）の細かい形。花音が乗っている編成と、カメラから近い編成（2 本まで）だけ、この形で描く
 * （遠くは vehicles.ts の安い形のインスタンス。外の形・塗り分けは同じ）。docs/design/town.md §20・§7 の 191〜。
 *
 * 1 両の局所の座標: 原点 = 両の中心のレール面、+z = 前（運転台の両は運転台の向き）、+x = 前を向いて左、y = 上。
 * - 低床: 床はレール面から 0.36m（停留所のホーム 0.3m とほぼ段なし）。中の幅 2.24m・天井は 2.40〜2.52m
 * - 扉: 両開きのプラグドア（幅 1.3m。開くと外へ 5cm 出てから車体に沿って 0.62m 滑る）。前の両・後ろの両は 2 か所、中の両は真ん中に 1 か所
 * - 座席: 1 人がけの腰掛けを窓ぎわに、向かい合わせ（ボックス）と前向き。緑のモケットと樹脂の背、背の上にステンレスの握り。
 *   運転台のすぐ後ろは前向きの席（「ひらき窓」から運転の操作が見える。子どもに人気の席）
 * - 天井: 2 本の灯りの帯（電球色の LED）・吊り手の棒とつり革・冷房の吹き出し。扉のわきと席の間にステンレスの縦の握り棒と黄色い降車の押しボタン、
 *   扉の上に案内の表示（いまどこ表示。橙の点の字）。窓の下は木目の窓台
 * - 運転台: 仕切りの「ひらき窓」・運転の机（計器・主幹制御器）・運転士の椅子
 * - 両の間の幌（通り抜けの床の板・蛇腹の壁）
 */

export const TRAM_CAR = {
  len: TRAM_SECTION,
  half: TRAM_SECTION / 2,
  hw: 1.2,
  /** 中の壁の面の x */
  iw: 1.12,
  floor: 0.36,
  ceilSide: 2.4,
  ceilMid: 2.52,
  /** 窓の開口（中も外も同じ） */
  winY0: 1.05,
  winY1: 2.36,
  doorTop: 2.36,
  /** 扉の片側の板の幅と、開いたときに滑る長さ・外へ出る長さ */
  leafW: 0.65,
  leafSlide: 0.62,
  leafOut: 0.05,
  /** 運転台の仕切り（運転台の両の局所の z） */
  cabZ: TRAM_SECTION / 2 - 1.5,
  /** 両の端の通り抜け（幅の半分・高さ） */
  passHalf: 0.72,
  passTop: 2.22,
  /** 座席（座面の高さ・奥行き・幅・背の上） */
  seatH: 0.45,
  seatD: 0.45,
  seatW: 0.48,
  seatBack: 1.08,
} as const

const T = TRAM_CAR
const HL = T.half
const W = T.hw
const IW = T.iw
const F = T.floor

/** 扉（両の局所の z の範囲）。cab = 運転台のある両 */
export function tramDoors(cab: boolean): [number, number][] {
  const z0 = -HL
  const zf = T.cabZ
  return cab
    ? [
        [z0 + 1.2, z0 + 2.5],
        [zf - 2.4, zf - 1.1],
      ]
    : [[-0.65, 0.65]]
}

/** 座席: 背の z・向き（+1 = +z を向いて座る）・x の側（+1 = 左の窓ぎわ） */
export interface TramSeat {
  zBack: number
  face: 1 | -1
}

/** 両の座席の並び（両側に同じ並び）。中の両は扉の前後に向かい合わせのボックス 2 つずつ、運転台の両は運転台の後ろの前向きの席とボックス */
export function tramSeats(cab: boolean): TramSeat[] {
  if (!cab)
    return [
      // 扉から前へ: 扉の方を向く席・前を向く席（ボックス）、背中合わせで前を向く席・端の方を向く…（向かい合わせ 2 組）
      { zBack: 1.35, face: 1 },
      { zBack: 2.95, face: -1 },
      { zBack: 3.05, face: 1 },
      { zBack: 4.62, face: -1 },
      { zBack: -1.35, face: -1 },
      { zBack: -2.95, face: 1 },
      { zBack: -3.05, face: -1 },
      { zBack: -4.62, face: 1 },
    ]
  return [
    // 運転台の後ろ（ひらき窓の前）の前向きの席
    { zBack: 2.3, face: 1 },
    // 扉の間のボックス
    { zBack: 0.82, face: -1 },
    { zBack: -0.78, face: 1 },
    { zBack: -0.88, face: -1 },
    { zBack: -2.22, face: 1 },
    // 後ろの扉の後ろ（端の方を向く）
    { zBack: -4.62, face: 1 },
  ]
}

/** 座席の座面の真ん中（局所の z）と、座る人が立つ所（座面の前の縁の前 0.28m） */
export function tramSeatSpot(seat: TramSeat) {
  const cz = seat.zBack + seat.face * (0.05 + T.seatD / 2)
  return { cz, standZ: seat.zBack + seat.face * (0.05 + T.seatD + 0.28), x: IW - 0.27 }
}

/* -------------------------------------------------------------------------- */
/* 色                                                                          */
/* -------------------------------------------------------------------------- */

const GREEN = '#1f5a3e'
const GREEN_D = '#173f2d'
const CREAM = '#e9dfc4'
const ROOF = '#b9bab4'
const DARK = '#1b1c1e'
const PANEL = '#e4dfd3'
const PANEL_LO = '#d6cfbf'
const FLOOR = '#5b6570'
const CEIL = '#f0eee8'
const MOQ = '#2f6b4c'
const SHELL = '#cfcabd'
const STEEL = '#c4c9cc'
const YELLOW = '#e0b324'
const SILL = '#9a6a3e'
const FRAME = '#2b2f2c'

/* -------------------------------------------------------------------------- */
/* 外の形（vehicles.ts の安い形と同じ塗り分け）                                       */
/* -------------------------------------------------------------------------- */

/** 窓を等間隔に並べる（vehicles.ts の spacedWindows と同じ） */
function spacedWindows(z0: number, z1: number, w: number, pillar: number, skip: [number, number][] = []) {
  const out: [number, number][] = []
  const n = Math.max(1, Math.floor((z1 - z0 + pillar) / (w + pillar)))
  const ww = (z1 - z0 - pillar * (n - 1)) / n
  for (let i = 0; i < n; i++) {
    const a = z0 + i * (ww + pillar)
    const b = a + ww
    if (skip.some(([s0, s1]) => b > s0 && a < s1)) continue
    out.push([a, b])
  }
  return out
}

/** 外の断面（右半分、下から上）。窓の帯（1.05〜2.42）は側の壁が描く */
const LOWER = [
  { x: 1.12, y: 0.12, c: DARK, m: VM.dark, a: 0.1 },
  { x: 1.18, y: 0.32, c: GREEN, m: VM.paint, a: 0.7 },
  { x: 1.2, y: 0.72, c: CREAM, m: VM.paint, a: 0.7 },
  { x: 1.2, y: 1.05, c: GREEN, m: VM.paint, a: 0.7 },
]
const UPPER = [
  { x: 1.2, y: 2.42, c: CREAM, m: VM.paint, a: 0.7 },
  { x: 1.19, y: 2.86, c: ROOF, m: VM.roof, a: 0.3 },
  { x: 1.16, y: 2.96, c: ROOF, m: VM.roof, a: 0.3 },
  { x: 1.0, y: 3.18, c: ROOF, m: VM.roof, a: 0.3 },
  { x: 0.7, y: 3.27, c: ROOF, m: VM.roof, a: 0.3 },
  { x: 0, y: 3.3, c: ROOF, m: VM.roof, a: 0.3 },
]

/** 断面を z0〜z1 に押し出す（両側。from〜to の点の範囲） */
function extrude(g: GeoBuilder, prof: { x: number; y: number; c: string; m: number; a?: number }[], z0: number, z1: number, sides: number[] = [1, -1]) {
  for (const s of sides)
    for (let i = 0; i < prof.length - 1; i++) {
      const p = prof[i]
      const q = prof[i + 1]
      g.quad([p.x * s, p.y, z0], [p.x * s, p.y, z1], [q.x * s, q.y, z1], [q.x * s, q.y, z0], p.c, p.m, p.a ?? 0)
    }
}

/** 側の壁（外の面・中の面・開口の見込み・ガラス・窓台）。holes = 窓と扉の z の範囲 */
function sideWalls(g: GeoBuilder, gl: GeoBuilder, z0: number, z1: number, wins: [number, number][], doors: [number, number][]) {
  const ivals: { a: number; b: number; kind: 'solid' | 'win' | 'door' }[] = []
  const holes = [...wins.map(([a, b]) => ({ a, b, kind: 'win' as const })), ...doors.map(([a, b]) => ({ a, b, kind: 'door' as const }))].sort((p, q) => p.a - q.a)
  let z = z0
  for (const h of holes) {
    if (h.a > z + 1e-4) ivals.push({ a: z, b: h.a, kind: 'solid' })
    ivals.push(h)
    z = h.b
  }
  if (z1 > z + 1e-4) ivals.push({ a: z, b: z1, kind: 'solid' })
  for (const sx of [1, -1]) {
    const xo = sx * W
    const xi = sx * IW
    for (const iv of ivals) {
      const { a, b } = iv
      if (iv.kind !== 'door') extrude(g, LOWER, a, b, [sx])
      else {
        // 扉の下: ステップの縁（黄色）と暗い裾
        g.boxMinMax(Math.min(xo, sx * 1.12), 0.12, a, Math.max(xo, sx * 1.12), 0.34, b, DARK, VM.dark, 0.1)
      }
      extrude(g, UPPER, a, b, [sx])
      if (iv.kind === 'solid') sideRect(g, xo, sx, a, b, 1.05, 2.42, GREEN, VM.paint, 0.7)
      else sideRect(g, xo, sx, a, b, T.winY1, 2.42, GREEN, VM.paint, 0.7)
      // 中の面
      if (iv.kind === 'solid') {
        sideRect(g, xi, -sx, a, b, F, T.winY0, PANEL_LO, VM.panel, 0.3)
        sideRect(g, xi, -sx, a, b, T.winY0, T.ceilSide, PANEL, VM.panel, 0.6)
      } else if (iv.kind === 'win') {
        sideRect(g, xi, -sx, a, b, F, T.winY0, PANEL_LO, VM.panel, 0.3)
        sideRect(g, xi, -sx, a, b, T.winY1, T.ceilSide, PANEL, VM.panel, 0.6)
        // 見込み（上・左右は暗い枠、下は木目の窓台）
        g.quad([xo, T.winY1, a], [xo, T.winY1, b], [xi, T.winY1, b], [xi, T.winY1, a], FRAME, VM.dark, 0.3)
        g.quad([xo, T.winY0, a], [xi, T.winY0, a], [xi, T.winY0, b], [xo, T.winY0, b], SILL, VM.wood, 0)
        g.quad([xo, T.winY0, a], [xo, T.winY1, a], [xi, T.winY1, a], [xi, T.winY0, a], FRAME, VM.dark, 0.3)
        g.quad([xo, T.winY0, b], [xi, T.winY0, b], [xi, T.winY1, b], [xo, T.winY1, b], FRAME, VM.dark, 0.3)
        // 窓台（中へ少し張り出す木の板）
        g.boxMinMax(Math.min(xi, xi - sx * 0.07), T.winY0 - 0.03, a - 0.02, Math.max(xi, xi - sx * 0.07), T.winY0 + 0.01, b + 0.02, SILL, VM.wood, 0)
        // 上の小さな窓（すべり出し）の桟
        g.boxMinMax(Math.min(sx * 1.14, sx * 1.17), 1.98, a, Math.max(sx * 1.14, sx * 1.17), 2.01, b, FRAME, VM.dark, 0.4)
        // ガラス
        sideRect(gl, sx * 1.16, sx, a, b, T.winY0, T.winY1, '#ffffff', 0)
      } else {
        sideRect(g, xi, -sx, a, b, T.doorTop, T.ceilSide, PANEL, VM.panel, 0.6)
        // 見込み（左右と上）と敷居（ステンレスの縞板と黄色い縁）
        g.quad([xo, F, a], [xi, F, a], [xi, T.doorTop, a], [xo, T.doorTop, a], PANEL_LO, VM.panel, 0)
        g.quad([xo, F, b], [xo, T.doorTop, b], [xi, T.doorTop, b], [xi, F, b], PANEL_LO, VM.panel, 0)
        g.quad([xo, T.doorTop, a], [xo, T.doorTop, b], [xi, T.doorTop, b], [xi, T.doorTop, a], PANEL_LO, VM.panel, 0)
        g.boxMinMax(Math.min(xo, xi), F - 0.02, a, Math.max(xo, xi), F + 0.004, b, '#a9adb0', VM.metal, 0)
        g.boxMinMax(Math.min(xo - sx * 0.06, xo), F - 0.015, a + 0.02, Math.max(xo - sx * 0.06, xo), F + 0.006, b - 0.02, YELLOW, VM.paint, 0.3)
        // 扉の上の案内の表示（いまどこ表示）
        g.boxMinMax(Math.min(xi, xi - sx * 0.09), T.doorTop + 0.0, (a + b) / 2 - 0.36, Math.max(xi, xi - sx * 0.09), T.ceilSide - 0.01, (a + b) / 2 + 0.36, '#1a1b1d', VM.dark, 0.5)
        sideRect(g, xi - sx * 0.092, -sx, (a + b) / 2 - 0.32, (a + b) / 2 + 0.32, T.doorTop + 0.006, T.ceilSide - 0.018, '#000000', VM.display, (a + 7) * 0.3)
        // 扉のわきのステンレスの縦の握り棒と、降車の押しボタン（黄色）
        for (const zz of [a - 0.1, b + 0.1]) {
          tube(g, [sx * (IW - 0.08), F, zz], [sx * (IW - 0.08), T.ceilSide - 0.02, zz], 0.017, STEEL, VM.metal, 0)
          g.boxMinMax(sx * (IW - 0.08) - 0.03, 1.32, zz - 0.03, sx * (IW - 0.08) + 0.03, 1.4, zz + 0.03, YELLOW, VM.plastic, 0.6)
        }
      }
    }
    // 窓の下の細い帯（外。クリームと緑の境の見切り）
    g.boxMinMax(Math.min(sx * 1.19, sx * 1.215), 1.03, z0, Math.max(sx * 1.19, sx * 1.215), 1.055, z1, '#d6ccad', VM.paint, 0.6)
  }
}

/** 天井（曲面）と灯りの帯・冷房の吹き出し・吊り手の棒とつり革 */
function ceiling(g: GeoBuilder, z0: number, z1: number) {
  const N = 10
  const cy = (x: number) => T.ceilSide + (T.ceilMid - T.ceilSide) * (1 - (x / IW) ** 2)
  for (let k = 0; k < N; k++) {
    const x0 = -IW + (2 * IW * k) / N
    const x1 = -IW + (2 * IW * (k + 1)) / N
    g.quad([x0, cy(x0), z0], [x1, cy(x1), z0], [x1, cy(x1), z1], [x0, cy(x0), z1], CEIL, VM.ceiling, 0)
  }
  // 灯りの帯（2 本）と、真ん中の冷房の吹き出し
  for (const x of [-0.5, 0.5]) {
    const y = cy(x) - 0.012
    g.boxMinMax(x - 0.09, y - 0.018, z0 + 0.25, x + 0.09, y, z1 - 0.25, '#bfc2c3', VM.metal, 0)
    flatRect(g, y - 0.02, -1, x - 0.075, x + 0.075, z0 + 0.3, z1 - 0.3, '#fff3dc', VM.lamp, 0)
  }
  g.boxMinMax(-0.16, cy(0) - 0.03, z0 + 0.4, 0.16, cy(0), z1 - 0.4, '#d9dbdb', VM.ceiling, 0)
  for (let z = z0 + 0.6; z < z1 - 0.5; z += 0.16) g.boxMinMax(-0.14, cy(0) - 0.034, z, 0.14, cy(0) - 0.029, z + 0.05, '#9a9d9e', VM.dark, 0.2)
  // 吊り手の棒（窓ぎわの席の通路の側）とつり革
  for (const sx of [1, -1]) {
    const x = sx * 0.6
    tube(g, [x, 1.98, z0 + 0.15], [x, 1.98, z1 - 0.15], 0.016, STEEL, VM.metal, 0)
    for (let z = z0 + 0.6; z < z1 - 0.4; z += 1.4) tube(g, [x, 1.98, z], [x, cy(x), z], 0.011, STEEL, VM.metal, 0)
    for (let z = z0 + 0.35; z < z1 - 0.3; z += 0.42) {
      g.boxMinMax(x - 0.012, 1.74, z - 0.012, x + 0.012, 1.98, z + 0.012, '#f2efe6', VM.plastic, 0.3)
      ring(g, [x, 1.68, z], 'x', 0.06, 0.012, '#f2efe6', VM.plastic, 0.4)
    }
  }
}

/** 1 人がけの座席（x の側 sx・背の z・向き face） */
function seat(g: GeoBuilder, sx: number, s: TramSeat) {
  const xIn = sx * (IW - 0.02)
  const xOut = sx * (IW - 0.02 - T.seatW)
  const xa = Math.min(xIn, xOut)
  const xb = Math.max(xIn, xOut)
  const zAt = (d: number) => s.zBack + s.face * d
  const zr = (p: number, q: number): [number, number] => [Math.min(zAt(p), zAt(q)), Math.max(zAt(p), zAt(q))]
  // 台（壁から張り出す片持ちの脚と、床の上の暗い台）
  const [p0, p1] = zr(0.08, T.seatD - 0.05)
  g.boxMinMax(xa + 0.06, F, p0, xb - 0.04, F + T.seatH - 0.12, p1, '#3e4246', VM.dark, 0.3)
  // 座面（モケット）
  const [c0, c1] = zr(0.04, T.seatD + 0.04)
  g.boxMinMax(xa + 0.01, F + T.seatH - 0.12, c0, xb - 0.01, F + T.seatH, c1, MOQ, VM.fabric, 0)
  const [e0, e1] = zr(T.seatD + 0.0, T.seatD + 0.045)
  g.boxMinMax(xa + 0.02, F + T.seatH - 0.15, e0, xb - 0.02, F + T.seatH - 0.02, e1, MOQ, VM.fabric, 0)
  // 背（前はモケット、後ろは樹脂の殻）
  const [b0, b1] = zr(0.0, 0.07)
  g.boxMinMax(xa + 0.01, F + T.seatH - 0.05, b0, xb - 0.01, F + T.seatBack, b1, MOQ, VM.fabric, 0)
  const [s0, s1] = zr(-0.03, 0.0)
  g.boxMinMax(xa, F + T.seatH - 0.15, s0, xb, F + T.seatBack + 0.02, s1, SHELL, VM.plastic, 0.4)
  // 背の上の握り（通路の側）
  const zg = zAt(-0.01)
  const xg = sx * (IW - T.seatW + 0.04)
  tube(g, [xg, F + T.seatBack + 0.02, zg], [xg, F + T.seatBack + 0.14, zg], 0.012, STEEL, VM.metal, 0)
  tube(g, [xg, F + T.seatBack + 0.14, zg], [sx * (IW - 0.2), F + T.seatBack + 0.14, zg], 0.012, STEEL, VM.metal, 0)
}

/** 両の端の壁（通り抜けの開口つき）。z = 端の面、sz = 外向き */
function passEnd(g: GeoBuilder, z: number, sz: number) {
  const zi = z - sz * 0.06
  const P = T.passHalf
  // 外（幌の側）の面
  for (const [x0, x1] of [
    [-W, -P],
    [P, W],
  ])
    endRect(g, z, sz, x0, x1, 0.12, 3.0, GREEN_D, VM.paint, 0.5)
  endRect(g, z, sz, -P, P, T.passTop, 3.0, GREEN_D, VM.paint, 0.5)
  // 中の面と見込み
  for (const [x0, x1] of [
    [-IW, -P],
    [P, IW],
  ])
    endRect(g, zi, -sz, x0, x1, F, T.ceilSide, PANEL, VM.panel, 0.4)
  endRect(g, zi, -sz, -P, P, T.passTop, T.ceilSide + 0.12, PANEL, VM.panel, 0.4)
  for (const s of [1, -1]) {
    const x = s * P
    g.quad([x, F, z], [x, F, zi], [x, T.passTop, zi], [x, T.passTop, z], '#7d8285', VM.metal, 0)
  }
  g.quad([-P, T.passTop, z], [P, T.passTop, z], [P, T.passTop, zi], [-P, T.passTop, zi], '#7d8285', VM.metal, 0)
  // 通り抜けの床の縁（黄色い線）
  g.boxMinMax(-P, F - 0.01, Math.min(z, zi), P, F + 0.004, Math.max(z, zi), YELLOW, VM.paint, 0.2)
}

/** 屋根庭のパネル（vehicles.ts と同じ） */
function roofGarden(g: GeoBuilder, z0: number, z1: number) {
  const n = Math.max(1, Math.round((z1 - z0) / 1.6))
  const w = (z1 - z0) / n
  for (let i = 0; i < n; i++) {
    const a = z0 + i * w + 0.08
    const b = z0 + (i + 1) * w - 0.08
    g.boxMinMax(-0.92, 3.26, a, 0.92, 3.36, b, '#6d6e69', VM.metal, 0)
    g.box([0, 3.42, (a + b) / 2], [1.72, 0.12, b - a - 0.12], '#335a26', VM.garden)
    for (let k = 0; k < 3; k++) {
      const z = a + ((k + 0.5) / 3) * (b - a)
      g.box([(k % 2 ? -1 : 1) * 0.35, 3.5, z], [0.7, 0.1, (b - a) / 3.4], '#2f5a22', VM.garden)
    }
  }
}

/**
 * 台車（z の位置）。低床なので台車の枠は床の下（レール面から 0.34m まで）、車輪の上は床へ出るので、中は窓ぎわの車輪の覆い（座席の台と同じ色）で囲う
 */
function bogie(g: GeoBuilder, z: number, len = 2.2, housing = true) {
  g.boxMinMax(-0.92, 0.14, z - len / 2, 0.92, 0.34, z + len / 2, '#202123', VM.dark, 0.2)
  const wheel = new THREE.Matrix4()
  for (const s of [1, -1])
    for (const dz of [-len * 0.3, len * 0.3]) {
      // 車輪（縦の円板。x の向きの軸）
      wheel.makeRotationZ(Math.PI / 2).setPosition(s * 0.97, 0.3, z + dz)
      g.lathe(
        [
          [0.0, -0.05],
          [0.3, -0.05],
          [0.3, 0.05],
          [0.0, 0.05],
        ],
        14,
        wheel,
        '#2a2a2c',
        VM.dark,
        0.5,
      )
      // 中の車輪の覆い
      if (housing) g.boxMinMax(Math.min(s * (IW - 0.24), s * IW), F, z + dz - 0.42, Math.max(s * (IW - 0.24), s * IW), 0.66, z + dz + 0.42, '#3e4246', VM.dark, 0.3)
    }
}

/** 運転台の外（前へ丸く絞った下の帯・傾いた大きな前面の窓・行き先の表示・前照灯と尾灯）。vehicles.ts と同じ形 */
function cabNose(g: GeoBuilder, gl: GeoBuilder) {
  const zf = T.cabZ
  const zn = HL
  const k = 10
  const ring2 = (t: number) => {
    const ang = (t * Math.PI) / 2
    return { x: Math.cos(ang), z: Math.sin(ang) }
  }
  for (let i = 0; i < k; i++) {
    for (const s of [1, -1]) {
      const r0 = ring2(i / k)
      const r1 = ring2((i + 1) / k)
      const P = (r: { x: number; z: number }, y: number, hw: number, out: number): V3 => [s * hw * (0.55 + 0.45 * r.x), y, zf + out * r.z]
      const bands: [number, number, string, number, number, number][] = [
        [0.12, 0.32, DARK, VM.dark, 1.12, 1.35],
        [0.32, 0.72, GREEN, VM.paint, 1.18, 1.5],
        [0.72, 1.05, CREAM, VM.paint, 1.2, 1.5],
      ]
      for (const [y0, y1, c, m, hw, out] of bands) g.quad(P(r0, y0, hw, out), P(r1, y0, hw, out), P(r1, y1, hw, out), P(r0, y1, hw, out), c, m, m === VM.paint ? 0.7 : 0.1)
      const wy0 = 1.05
      const wy1 = 2.5
      const Wp = (r: { x: number; z: number }, y: number): V3 => {
        const t = (y - wy0) / (wy1 - wy0)
        return [s * 1.2 * (0.55 + 0.45 * r.x) * (1 - 0.04 * t), y, zf + 1.5 * r.z - 0.45 * t * r.z]
      }
      gl.quad(Wp(r0, wy0), Wp(r1, wy0), Wp(r1, wy1), Wp(r0, wy1), '#ffffff', 0)
      const Tp = (r: { x: number; z: number }, y: number, out: number, hw: number): V3 => [s * hw * (0.55 + 0.45 * r.x), y, zf + out * r.z]
      g.quad(Tp(r0, wy1, 1.05, 1.15), Tp(r1, wy1, 1.05, 1.15), Tp(r1, 2.96, 0.85, 1.16), Tp(r0, 2.96, 0.85, 1.16), GREEN, VM.paint, 0.7)
      g.quad(Tp(r0, 2.96, 0.85, 1.16), Tp(r1, 2.96, 0.85, 1.16), Tp(r1, 3.28, 0.3, 0.7), Tp(r0, 3.28, 0.3, 0.7), ROOF, VM.roof, 0.3)
      // 前面の窓の下の縁（中の机の高さの面）
      g.quad(P(r0, 1.05, 1.08, 1.42), P(r1, 1.05, 1.08, 1.42), P(r1, 1.05, 1.0, 1.0), P(r0, 1.05, 1.0, 1.0), '#2a2c2e', VM.dark, 0.2)
    }
  }
  g.box([0, 3.26, zf + 0.15], [1.38, 0.06, 0.6], ROOF, VM.roof, 0.3)
  // 行き先の表示（前。橙の点の字）
  g.boxMinMax(-0.66, 2.55, zn - 0.56, 0.66, 2.9, zn - 0.48, '#141414', VM.dark, 0.4)
  endRect(g, zn - 0.475, 1, -0.62, 0.62, 2.58, 2.87, '#000000', VM.display, 3.1)
  for (const s of [1, -1]) {
    g.cylinder([s * 0.78, 0.66, zn - 0.04], 0.11, 0.06, 12, '#dddddd', VM.lamp, 1, true)
    g.box([s * 0.93, 0.62, zn - 0.12], [0.16, 0.12, 0.05], '#330000', VM.lamp, 2)
  }
  g.box([0, 0.22, zn], [1.1, 0.14, 0.12], '#151515', VM.dark)
  // 横の行き先の表示
  for (const s of [1, -1]) sideRect(g, s * 1.205, s, zf - 0.95, zf - 0.05, 2.42, 2.62, '#000000', VM.display, 5.3)
}

/** 運転台の中（床・仕切りと「ひらき窓」・運転の机・椅子・天井） */
function cabInside(g: GeoBuilder, gl: GeoBuilder) {
  const zf = T.cabZ
  const zp = zf + 0.03
  // 床（前へ丸く絞った所まで）
  g.quad([-IW, F, zf + 1.2], [IW, F, zf + 1.2], [IW, F, zf], [-IW, F, zf], '#3a3e42', VM.floor, 0)
  // 天井
  g.quad([-IW, 2.36, zf], [IW, 2.36, zf], [IW, 2.36, zf + 1.05], [-IW, 2.36, zf + 1.05], '#d9dadb', VM.ceiling, 0)
  // 仕切り: 客室の側の面（ひらき窓 x -0.1〜0.95・y 1.0〜2.1、運転台への扉 x -0.95〜-0.25）
  const holeX0 = -0.1
  const holeX1 = 0.95
  const hy0 = 1.0
  const hy1 = 2.1
  for (const z of [zf - 0.03, zp]) {
    const sz = z < zf ? -1 : 1
    endRect(g, z, sz, -IW, holeX0, F, T.ceilSide, PANEL_LO, VM.panel, 0.2)
    endRect(g, z, sz, holeX1, IW, F, T.ceilSide, PANEL_LO, VM.panel, 0.2)
    endRect(g, z, sz, holeX0, holeX1, F, hy0, PANEL_LO, VM.panel, 0.2)
    endRect(g, z, sz, holeX0, holeX1, hy1, T.ceilSide, PANEL_LO, VM.panel, 0.2)
  }
  g.boxMinMax(holeX0, hy0 - 0.02, zf - 0.05, holeX1, hy0, zp + 0.02, FRAME, VM.dark, 0.3)
  g.boxMinMax(holeX0, hy1, zf - 0.05, holeX1, hy1 + 0.02, zp + 0.02, FRAME, VM.dark, 0.3)
  endRect(gl, zf, 1, holeX0, holeX1, hy0, hy1, '#ffffff', 0)
  // ひらき窓の札（小さな真鍮の板）と、運転台への扉の線
  g.boxMinMax(holeX0 + 0.35, hy1 + 0.04, zf - 0.045, holeX0 + 0.75, hy1 + 0.12, zf - 0.03, '#c9a24e', VM.metal, 1)
  g.boxMinMax(-0.97, F + 0.02, zf - 0.04, -0.94, 2.1, zf - 0.03, FRAME, VM.dark, 0.3)
  g.boxMinMax(-0.27, F + 0.02, zf - 0.04, -0.24, 2.1, zf - 0.03, FRAME, VM.dark, 0.3)
  g.boxMinMax(-0.94, 2.07, zf - 0.04, -0.27, 2.1, zf - 0.03, FRAME, VM.dark, 0.3)
  g.boxMinMax(-0.36, 1.1, zf - 0.06, -0.3, 1.16, zf - 0.03, STEEL, VM.metal, 0)
  // 運転の机（傾いた計器の面と主幹制御器）
  g.boxMinMax(-0.95, F, zf + 0.75, 0.95, 0.98, zf + 1.18, '#34383c', VM.dark, 0.3)
  g.quad([-0.9, 0.98, zf + 0.78], [0.9, 0.98, zf + 0.78], [0.9, 1.12, zf + 1.1], [-0.9, 1.12, zf + 1.1], '#22262a', VM.dark, 0.5)
  for (let i = 0; i < 4; i++) {
    const x = 0.18 + i * 0.16
    g.cylinder([x, 1.0 + 0.06, zf + 0.92], 0.05, 0.02, 12, '#101214', VM.dark, 0.8, true)
  }
  g.boxMinMax(-0.5, 1.0, zf + 0.86, -0.18, 1.06, zf + 1.0, '#000000', VM.display, 7.7)
  tube(g, [0.62, 0.98, zf + 0.82], [0.62, 1.14, zf + 0.78], 0.02, '#202224', VM.dark, 0.5)
  g.boxMinMax(0.57, 1.14, zf + 0.74, 0.67, 1.18, zf + 0.83, '#c03a2a', VM.plastic, 0.6)
  // 運転士の椅子
  g.boxMinMax(0.18, F, zf + 0.32, 0.62, F + 0.42, zf + 0.62, '#23324a', VM.fabric, 1)
  g.boxMinMax(0.18, F + 0.42, zf + 0.22, 0.62, F + 1.05, zf + 0.3, '#23324a', VM.fabric, 1)
  g.cylinder([0.4, F, zf + 0.47], 0.05, 0.12, 8, '#202224', VM.dark, 0.4, false)
  // 運転台の壁（側の中の面。前面の窓の下まで）
  for (const sx of [1, -1]) sideRect(g, sx * 1.1, -sx, zf, zf + 0.75, F, 1.05, '#4a4e52', VM.panel, 0)
}

/** 細かい 1 両の形（cab = 運転台の両） */
function sectionGeometry(cab: boolean) {
  const g = new GeoBuilder()
  const gl = new GeoBuilder()
  const z0 = -HL
  const zf = cab ? T.cabZ : HL
  const doors = tramDoors(cab)
  const wins = spacedWindows(z0 + 0.2, zf - 0.15, 1.15, 0.1, doors.map(([a, b]) => [a - 0.04, b + 0.04]))
  sideWalls(g, gl, z0, zf, wins, doors)
  // 床（扉の所は外の縁まで）
  g.quad([-IW, F, zf], [IW, F, zf], [IW, F, z0 + 0.06], [-IW, F, z0 + 0.06], FLOOR, VM.floor, 0)
  // 床の真ん中の通路の明るい帯と、扉の前の黄色い点字の帯
  for (const [a, b] of doors) for (const sx of [1, -1]) g.boxMinMax(Math.min(sx * (IW - 0.32), sx * (IW - 0.02)), F, a + 0.05, Math.max(sx * (IW - 0.32), sx * (IW - 0.02)), F + 0.006, b - 0.05, '#c9a43a', VM.floor, 0)
  ceiling(g, z0 + 0.06, zf)
  // 両の端（幌の側）
  passEnd(g, z0, -1)
  if (!cab) passEnd(g, HL, 1)
  // 座席
  for (const s of tramSeats(cab)) for (const sx of [1, -1]) seat(g, sx, s)
  // 席の間の縦の握り棒（背中合わせの所）
  for (const sx of [1, -1])
    for (const s of tramSeats(cab)) {
      const z = s.zBack - s.face * 0.06
      if (Math.abs(z) > HL - 0.3) continue
      tube(g, [sx * (IW - T.seatW - 0.03), F + T.seatH, z], [sx * (IW - T.seatW - 0.03), T.ceilSide - 0.05, z], 0.016, STEEL, VM.metal, 0)
    }
  // 屋根の上: 屋根庭（運転台の上は除く）・パンタグラフ（中の両）
  roofGarden(g, z0 + 0.4, zf - 0.2)
  if (!cab) {
    g.boxMinMax(-0.5, 3.3, -1.2, 0.5, 3.55, 1.2, '#4b4d4b', VM.metal, 0)
    for (const s of [1, -1]) {
      tubeBeam(g, [s * 0.35, 3.55, -0.6], [s * 0.3, 4.5, 0.25])
      tubeBeam(g, [s * 0.3, 4.5, 0.25], [s * 0.25, WIRE_HEIGHT - 0.06, -0.2])
    }
    g.box([0, WIRE_HEIGHT - 0.04, -0.2], [1.5, 0.06, 0.12], '#3a3b3c', VM.metal)
  }
  // 台車と床下
  g.boxMinMax(-1.05, 0.12, z0 + 0.3, 1.05, 0.32, zf - 0.3, '#141516', VM.dark)
  // 台車は扉を避けた所（運転台の下と扉の間・中の両は扉の前後に車輪）。安い形（vehicles.ts）とは少し違うが、外からは裾に隠れる
  if (cab) {
    bogie(g, zf + 0.7, 1.2, false)
    bogie(g, -1.0, 1.32)
  } else bogie(g, 0, 3.6)
  if (cab) {
    cabNose(g, gl)
    cabInside(g, gl)
  }
  return { body: g.build(), glass: gl.build() }
}

function tubeBeam(g: GeoBuilder, a: V3, b: V3) {
  g.beam(a, b, 0.06, '#2a2b2c', VM.dark, 0.4)
}

/** 両の間の幌（通り抜けの床の板・蛇腹の外と中の壁・天井）。z = 0 が真ん中、長さ TRAM_GAP */
function gangwayGeometry() {
  const g = new GeoBuilder()
  const L = TRAM_GAP / 2
  const P = T.passHalf + 0.05
  const n = 7
  for (let i = 0; i < n; i++) {
    const z = -L + ((i + 0.5) / n) * TRAM_GAP
    const c = i % 2 ? '#1c1c1c' : '#2a2a2a'
    const dz = (TRAM_GAP / n) * 0.85
    // 外の蛇腹（通り抜けのまわりの枠）
    g.boxMinMax(-1.05, 0.2, z - dz / 2, -P, 3.05, z + dz / 2, c, VM.dark, 0.1)
    g.boxMinMax(P, 0.2, z - dz / 2, 1.05, 3.05, z + dz / 2, c, VM.dark, 0.1)
    g.boxMinMax(-P, T.passTop + 0.02, z - dz / 2, P, 3.05, z + dz / 2, c, VM.dark, 0.1)
  }
  // 床の板（回る円の板）
  g.boxMinMax(-P, F - 0.03, -L - 0.05, P, F + 0.002, L + 0.05, '#8e9396', VM.metal, 0)
  g.cylinder([0, F + 0.002, 0], 0.5, 0.004, 24, '#7c8184', VM.metal, 0, true)
  return g.build()
}

/** 扉の板（プラグドア。閉じた位置で、扉の真ん中・左右の片側。sx = 車体の側、half = -1 / +1 の片側）。原点 = 扉の板の真ん中の z */
function leafGeometry(sx: number) {
  const g = new GeoBuilder()
  const gl = new GeoBuilder()
  const x0 = sx * (W + 0.004)
  const x1 = sx * (W + 0.04)
  const xa = Math.min(x0, x1)
  const xb = Math.max(x0, x1)
  const h = T.leafW / 2 - 0.006
  const y0 = F
  const y1 = T.doorTop + 0.04
  const g0 = 0.62
  const g1 = 2.24
  // 外は緑の枠、中は明るい灰色
  g.boxMinMax(xa, y0, -h, xb, g0, h, GREEN_D, VM.paint, 0.6)
  g.boxMinMax(xa, g1, -h, xb, y1, h, GREEN_D, VM.paint, 0.6)
  g.boxMinMax(xa, g0, -h, xb, g1, -h + 0.07, GREEN_D, VM.paint, 0.6)
  g.boxMinMax(xa, g0, h - 0.07, xb, g1, h, GREEN_D, VM.paint, 0.6)
  sideRect(g, sx * (W + 0.003), -sx, -h, h, y0, y1, '#b9bcbd', VM.panel, 0)
  // 戸先のゴム（真ん中の側。片側ごとに + か − の縁。両方に付けておく）
  for (const e of [-h, h]) g.boxMinMax(xa - 0.002, y0, e - 0.008, xb + 0.002, y1, e + 0.008, '#151515', VM.dark, 0.3)
  sideRect(gl, sx * (W + 0.022), sx, -h + 0.07, h - 0.07, g0, g1, '#ffffff', 0)
  return { body: g.build(), glass: gl.build() }
}

/* -------------------------------------------------------------------------- */
/* シェーダー（両の局所の中の決まり）                                                */
/* -------------------------------------------------------------------------- */

const f = (v: number) => v.toFixed(4)

const TRAM_GLSL: VehicleGlsl = {
  name: 'tram',
  glsl: /* glsl */ `
    bool vehInside(vec3 p) {
      return abs(p.x) < ${f(IW + 0.012)} && abs(p.z) < ${f(HL + 0.01)} && p.y > ${f(F - 0.03)} && p.y < ${f(T.ceilMid + 0.04)};
    }
    bool vehCamInside(vec3 c) { return abs(c.x) < ${f(IW)} && abs(c.z) < ${f(HL + 0.4)} && c.y > ${f(F)} && c.y < ${f(T.ceilMid)}; }
    float vehSunThrough(vec3 p, vec3 L) {
      if (abs(L.x) > 1e-3) {
        float t = (sign(L.x) * ${f(IW)} - p.x) / L.x;
        if (t > 0.0) {
          vec3 h = p + L * t;
          if (abs(h.z) < ${f(HL - 0.2)} && h.y > ${f(T.winY0)} && h.y < ${f(T.winY1)}) return 0.85;
        }
      }
      return 0.0;
    }
    vec3 vehLamp(vec3 p, vec3 n) {
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 2; i++) {
        float x = i == 0 ? -0.5 : 0.5;
        vec3 q = vec3(x, ${f(T.ceilSide + 0.08)}, clamp(p.z, ${f(-HL + 0.3)}, ${f(HL - 0.3)}));
        vec3 Lv = q - p;
        float d2 = dot(Lv, Lv);
        vec3 Ll = Lv * inversesqrt(max(d2, 1e-4));
        float ndl = max(dot(n, Ll), 0.0);
        acc += vec3(1.0, 0.86, 0.68) * (ndl * 0.75 + 0.25) / (d2 * 1.4 + 0.6);
      }
      return acc * 1.25 + vec3(1.0, 0.88, 0.72) * 0.08;
    }
  `,
}

/* -------------------------------------------------------------------------- */
/* 入れ物                                                                       */
/* -------------------------------------------------------------------------- */

const _m = new THREE.Matrix4()
const _t = new THREE.Matrix4()
const _info = [0, 0, 0, 0]

/** 細かい編成（最大 capacity 本）。毎コマ begin → add（3 両と幌 2 つの行列・iInfo）→ end */
export class TramDetail {
  readonly meshes: THREE.InstancedMesh[]
  private cab: InstancedPart
  private cabGlass: InstancedPart
  private mid: InstancedPart
  private midGlass: InstancedPart
  private gang: InstancedPart
  private leaves: InstancedPart[]
  private leafGlass: InstancedPart[]
  private readonly capacity: number
  private n = 0

  constructor(capacity = 3) {
    this.capacity = capacity
    const mat = createDetailMaterial(TRAM_GLSL, transitUniforms.uLineColors)
    const glassMat = createDetailGlassMaterial(TRAM_GLSL)
    const cab = sectionGeometry(true)
    const mid = sectionGeometry(false)
    this.cab = new InstancedPart(cab.body, mat, 'transit:tram:cab', capacity * 2)
    this.cabGlass = new InstancedPart(cab.glass, glassMat, 'transit:tram:cabGlass', capacity * 2)
    this.mid = new InstancedPart(mid.body, mat, 'transit:tram:mid', capacity)
    this.midGlass = new InstancedPart(mid.glass, glassMat, 'transit:tram:midGlass', capacity)
    this.gang = new InstancedPart(gangwayGeometry(), mat, 'transit:tram:gang', capacity * 2)
    // 扉の板: 1 編成に 5 か所 × 両側 × 2 枚 = 20 枚（側ごとの形）
    const leaves = [1, -1].map((sx) => leafGeometry(sx))
    this.leaves = leaves.map((l, k) => new InstancedPart(l.body, mat, `transit:tram:leaf${k}`, capacity * 10))
    this.leafGlass = leaves.map((l, k) => new InstancedPart(l.glass, glassMat, `transit:tram:leafGlass${k}`, capacity * 10))
    for (const p of [this.cabGlass, this.midGlass, ...this.leafGlass]) p.mesh.renderOrder = 22
    this.meshes = [this.cab, this.cabGlass, this.mid, this.midGlass, this.gang, ...this.leaves, ...this.leafGlass].map((p) => p.mesh)
  }

  private get parts() {
    return [this.cab, this.cabGlass, this.mid, this.midGlass, this.gang, ...this.leaves, ...this.leafGlass]
  }

  begin() {
    this.n = 0
    for (const p of this.parts) p.begin()
  }

  /**
   * 1 編成。sections = 3 両の行列（後ろの両は 180° 回したもの）、gangs = 幌 2 つ、
   * info = (中の灯り, 扉の開き具合, 扉の側（編成の前を向いて左 = +1）, 系統の番号 + 種)
   */
  add(sections: THREE.Matrix4[], gangs: THREE.Matrix4[], info: readonly number[]) {
    if (this.n >= this.capacity) return false
    this.n++
    for (let k = 0; k < 3; k++) {
      const m = sections[k]
      // 後ろの両は 180° 回してあるので、扉の側は逆
      const side = k === 2 ? -info[2] : info[2]
      _info[0] = info[0]
      _info[1] = info[1]
      _info[2] = side
      _info[3] = info[3]
      const body = k === 1 ? this.mid : this.cab
      const glass = k === 1 ? this.midGlass : this.cabGlass
      body.add(m, _info)
      glass.add(m, _info)
      // 扉の板（開く側だけ動かす。プラグドア: 外へ出てから滑る）
      const open = info[1]
      const e1 = smooth(open / 0.3)
      const e2 = smooth((open - 0.2) / 0.8)
      for (const [a, b] of tramDoors(k !== 1)) {
        const zc = (a + b) / 2
        for (let s = 0; s < 2; s++) {
          const sx = s === 0 ? 1 : -1
          const moving = sx === side ? 1 : 0
          for (const half of [-1, 1]) {
            const z = zc + half * (T.leafW / 2 + moving * e2 * T.leafSlide)
            _t.makeTranslation(sx * moving * e1 * T.leafOut, 0, z)
            _m.multiplyMatrices(m, _t)
            this.leaves[s].add(_m, _info)
            this.leafGlass[s].add(_m, _info)
          }
        }
      }
    }
    for (const m of gangs) this.gang.add(m, info)
    return true
  }

  end() {
    for (const p of this.parts) p.end()
  }
}

const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}
