import * as THREE from 'three'
import { GeoBuilder } from '../site/builder'
import { transitUniforms } from './transitMaterial'
import { InstancedPart, VM, createDetailGlassMaterial, createDetailMaterial, endRect, flatRect, sideRect, tube, type VehicleGlsl } from './vehicleDetail'

/**
 * 運河バスの細かい形（町営の電動水上バス。船体はクリーム・屋根はひらき緑・定員 40 名。vol3 4-5）。花音が乗っている舟と、カメラから近い 2 隻だけ
 * この形で描く（遠くは vehicles.ts の安い形。外の形・塗り分けは同じ）。docs/design/town.md §20・§7 の 196〜。
 *
 * 舟の局所の座標: 原点 = 舟の真ん中の水面、+z = 舳先、+x = 舳先を向いて左、y = 上。波の揺れは行列に入る（boats.ts の sway）。
 * - 客室（z −6.3〜4.5）: 床は水面から 0.2m（甲板の 0.35m 下に沈めた床。天井まで 2.0〜2.35m）。前向きの 2 人がけの腰掛けが両側に 10 列（真ん中の通路 0.7m。
 *   紺の縞のモケット・木の肘掛けと背の上の握り）、木の窓枠の窓（下 1.05m〜上 2.15m）、木の腰板、天井に 2 本の灯りの帯と握り棒
 * - 乗り降りの扉: 客室の前の両舷（真ん中 z 3.4・幅 0.8m）の引き戸（外を艫の方へ 0.85m 滑る）。中は甲板の高さから一段（0.18m）下りて床
 * - 前: 操舵の台（舵輪・計器・無線）と前の窓、舳先の甲板と手すり・ランタン。艫: 船尾の灯
 */

export const WATERBUS = {
  length: 15,
  beam: 3.6,
  draft: 0.5,
  /** 甲板（舷の上）の高さ */
  deck: 0.55,
  /** 客室の前後・外の壁と中の壁の x */
  z0: -15 / 2 + 1.2,
  z1: 15 / 2 - 3.0,
  hw: 1.55,
  iw: 1.47,
  floor: 0.2,
  winY0: 1.05,
  winY1: 2.15,
  ceilSide: 2.2,
  ceilMid: 2.55,
  /** 扉の真ん中の z・幅・上の高さ、開いたときに滑る長さ */
  doorZ: 3.4,
  doorW: 0.8,
  doorTop: 2.08,
  doorSlide: 0.85,
  /** 扉の中の一段 */
  stepY: 0.38,
  /** 腰掛け（座面の高さ・奥行き・2 人がけの幅・背の上） */
  seatH: 0.42,
  seatD: 0.44,
  benchW: 1.05,
  seatBack: 0.95,
  aisle: 0.37,
} as const

const C = WATERBUS
const IW = C.iw
const F = C.floor

/** 腰掛けの列（背の z）。前向き */
export function waterbusRows(): number[] {
  const out: number[] = []
  for (let k = 0; k < 10; k++) out.push(C.z0 + 0.45 + k * 0.84)
  return out
}

/** 列の窓ぎわの席の座る人が立つ所（局所の z）と x */
export function waterbusSeatSpot(zBack: number) {
  return { standZ: zBack + 0.05 + C.seatD + 0.28, cz: zBack + 0.05 + C.seatD / 2, x: C.aisle + C.benchW - 0.27, xInner: C.aisle + 0.27 }
}

const CREAM = '#e8dcc0'
const HULL_D = '#3f2a22'
const GREEN = '#23533d'
const ROOFG = '#1d4a36'
const WOOD = '#6b4528'
const WOOD_L = '#9a6a3e'
const PANEL = '#ece4d2'
const MOQ = '#2c3f66'
const BRASS = '#c9a24e'
const IRON = '#2b2b2b'

/** 船体の平面の輪郭（右舷、船尾 → 船首。vehicles.ts の hull と同じ） */
function hullOutline(L: number, B: number, bowSharp: number) {
  const n = 14
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const z = -L / 2 + t * L
    const bow = t > 1 - bowSharp ? Math.cos((((t - (1 - bowSharp)) / bowSharp) * Math.PI) / 2) : 1
    const stern = t < 0.08 ? 0.86 + 0.14 * (t / 0.08) : 1
    pts.push([Math.max(0.02, (B / 2) * bow * stern), z])
  }
  return pts
}

/** 船体の外（水の下は暗い色・上はクリーム）と甲板（客室の外の所） */
function hull(g: GeoBuilder) {
  const pts = hullOutline(C.length, C.beam, 0.22)
  const yb = -C.draft
  const yw = 0.05
  const yt = C.deck
  for (const s of [1, -1]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i]
      const [x1, z1] = pts[i + 1]
      g.quad([s * x0 * 0.82, yb, z0], [s * x1 * 0.82, yb, z1], [s * x1, yw, z1], [s * x0, yw, z0], HULL_D, VM.paint, 0.4)
      g.quad([s * x0, yw, z0], [s * x1, yw, z1], [s * x1, yt, z1], [s * x0, yt, z0], CREAM, VM.paint, 0.7)
      // 舷の内の面（甲板の縁から下へ少し）
      g.quad([s * x0 * 0.97, yt - 0.25, z0], [s * x1 * 0.97, yt - 0.25, z1], [s * x1 * 0.97, yt, z1], [s * x0 * 0.97, yt, z0], CREAM, VM.paint, 0.4)
    }
  }
  // 甲板（板張り。客室の外の所: 前の甲板・後ろの甲板・両舷の細い通り）。輪郭の区間を客室の前後の端で切る
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i]
    const [x1, z1] = pts[i + 1]
    const xAt = (z: number) => x0 + ((x1 - x0) * (z - z0)) / (z1 - z0)
    const cuts = [z0, ...[C.z0, C.z1].filter((z) => z > z0 + 1e-4 && z < z1 - 1e-4), z1]
    for (let k = 0; k < cuts.length - 1; k++) {
      const za = cuts[k]
      const zb = cuts[k + 1]
      const xa = xAt(za) * 0.97
      const xb = xAt(zb) * 0.97
      const inCabin = (za + zb) / 2 > C.z0 && (za + zb) / 2 < C.z1
      if (!inCabin) g.quad([-xa, yt, za], [xa, yt, za], [xb, yt, zb], [-xb, yt, zb], '#8b7d68', VM.floor, 1)
      else for (const s of [1, -1]) g.quad([s * C.hw, yt, za], [s * xa, yt, za], [s * xb, yt, zb], [s * C.hw, yt, zb], '#8b7d68', VM.floor, 1)
    }
    g.quad([-x0 * 0.82, yb, z0], [x0 * 0.82, yb, z0], [x1 * 0.82, yb, z1], [-x1 * 0.82, yb, z1], HULL_D, VM.paint, 0.4)
  }
  const [xs, zs] = pts[0]
  g.quad([-xs * 0.82, yb, zs], [xs * 0.82, yb, zs], [xs, yt, zs], [-xs, yt, zs], CREAM, VM.paint, 0.7)
  // 緑の舷の帯と、防舷材（舷の黒いゴム）
  g.boxMinMax(-C.beam / 2 - 0.01, 0.42, -C.length / 2 + 0.4, C.beam / 2 + 0.01, 0.56, C.length / 2 - 3.2, GREEN, VM.paint, 0.6)
  for (const s of [1, -1]) g.boxMinMax(Math.min(s * (C.beam / 2 - 0.02), s * (C.beam / 2 + 0.07)), 0.2, -C.length / 2 + 1.2, Math.max(s * (C.beam / 2 - 0.02), s * (C.beam / 2 + 0.07)), 0.32, C.length / 2 - 3.6, '#1c1d1e', VM.dark, 0.3)
}

/** 客室の外の壁・窓・中の腰板・窓台（両舷）。扉の開口あり */
function cabinWalls(g: GeoBuilder, gl: GeoBuilder) {
  const wins = spaced(C.z0 + 0.15, C.z1 - 0.15, 0.95, 0.12, [[C.doorZ - C.doorW / 2 - 0.08, C.doorZ + C.doorW / 2 + 0.08]])
  const d0 = C.doorZ - C.doorW / 2
  const d1 = C.doorZ + C.doorW / 2
  const holes = [...wins.map(([a, b]) => ({ a, b, door: false })), { a: d0, b: d1, door: true }].sort((p, q) => p.a - q.a)
  for (const sx of [1, -1]) {
    const xo = sx * C.hw
    const xi = sx * IW
    let z = C.z0
    const solid = (a: number, b: number) => {
      sideRect(g, xo, sx, a, b, C.deck, C.winY0, GREEN, VM.paint, 0.6)
      sideRect(g, xo, sx, a, b, C.winY0, C.winY1, WOOD, VM.wood, 1)
      sideRect(g, xo, sx, a, b, C.winY1, 2.25, WOOD, VM.wood, 0)
      sideRect(g, xi, -sx, a, b, F, C.winY0, WOOD, VM.wood, 1)
      sideRect(g, xi, -sx, a, b, C.winY0, C.ceilSide, PANEL, VM.panel, 0.4)
    }
    for (const h of holes) {
      if (h.a > z + 1e-4) solid(z, h.a)
      if (!h.door) {
        sideRect(g, xo, sx, h.a, h.b, C.deck, C.winY0, GREEN, VM.paint, 0.6)
        sideRect(g, xo, sx, h.a, h.b, C.winY1, 2.25, WOOD, VM.wood, 0)
        sideRect(g, xi, -sx, h.a, h.b, F, C.winY0, WOOD, VM.wood, 1)
        sideRect(g, xi, -sx, h.a, h.b, C.winY1, C.ceilSide, PANEL, VM.panel, 0.4)
        // 見込み（木）・窓台
        g.quad([xo, C.winY0, h.a], [xi, C.winY0, h.a], [xi, C.winY0, h.b], [xo, C.winY0, h.b], WOOD_L, VM.wood, 0)
        g.quad([xo, C.winY1, h.a], [xo, C.winY1, h.b], [xi, C.winY1, h.b], [xi, C.winY1, h.a], WOOD, VM.wood, 0)
        g.quad([xo, C.winY0, h.a], [xo, C.winY1, h.a], [xi, C.winY1, h.a], [xi, C.winY0, h.a], WOOD, VM.wood, 1)
        g.quad([xo, C.winY0, h.b], [xi, C.winY0, h.b], [xi, C.winY1, h.b], [xo, C.winY1, h.b], WOOD, VM.wood, 1)
        g.boxMinMax(Math.min(xi, xi - sx * 0.08), C.winY0 - 0.03, h.a - 0.02, Math.max(xi, xi - sx * 0.08), C.winY0 + 0.01, h.b + 0.02, WOOD_L, VM.wood, 0)
        sideRect(gl, sx * (C.hw - 0.03), sx, h.a, h.b, C.winY0, C.winY1, '#ffffff', 0)
      } else {
        sideRect(g, xo, sx, h.a, h.b, C.doorTop, 2.25, WOOD, VM.wood, 0)
        sideRect(g, xi, -sx, h.a, h.b, C.doorTop, C.ceilSide, PANEL, VM.panel, 0.4)
        g.quad([xo, C.deck, h.a], [xi, C.deck, h.a], [xi, C.doorTop, h.a], [xo, C.doorTop, h.a], WOOD, VM.wood, 1)
        g.quad([xo, C.deck, h.b], [xo, C.doorTop, h.b], [xi, C.doorTop, h.b], [xi, C.deck, h.b], WOOD, VM.wood, 1)
        g.quad([xo, C.doorTop, h.a], [xo, C.doorTop, h.b], [xi, C.doorTop, h.b], [xi, C.doorTop, h.a], WOOD, VM.wood, 0)
        // 敷居（甲板の高さ）と、中の一段（甲板から床へ）
        g.boxMinMax(Math.min(xo + sx * 0.02, xi), C.stepY + 0.17 - 0.03, h.a, Math.max(xo + sx * 0.02, xi), C.deck, h.b, '#a9adb0', VM.metal, 0)
        g.boxMinMax(Math.min(xi, xi - sx * 0.34), F, h.a, Math.max(xi, xi - sx * 0.34), C.stepY, h.b, WOOD_L, VM.wood, 0)
        g.boxMinMax(Math.min(xi - sx * 0.3, xi - sx * 0.34), C.stepY - 0.004, h.a, Math.max(xi - sx * 0.3, xi - sx * 0.34), C.stepY + 0.003, h.b, '#d8b41e', VM.paint, 0.3)
        // 扉のわきの真鍮の縦の握り棒（中）
        for (const zz of [h.a - 0.06, h.b + 0.06]) tube(g, [sx * (IW - 0.06), F + 0.5, zz], [sx * (IW - 0.06), F + 1.75, zz], 0.016, BRASS, VM.metal, 1)
        // 扉の上のレール（外）
        g.boxMinMax(Math.min(sx * (C.hw + 0.005), sx * (C.hw + 0.07)), C.doorTop + 0.02, h.a - C.doorSlide - 0.05, Math.max(sx * (C.hw + 0.005), sx * (C.hw + 0.07)), C.doorTop + 0.07, h.b + 0.04, '#8c8f90', VM.metal, 0)
      }
      z = h.b
    }
    if (C.z1 > z + 1e-4) solid(z, C.z1)
    // 窓の上の木の帯と、屋根との境の緑
    g.boxMinMax(Math.min(xo, xo + sx * 0.02), 2.15, C.z0, Math.max(xo, xo + sx * 0.02), 2.25, C.z1, '#1f4f39', VM.paint, 0.6)
  }
  // 前の面（窓）と後ろの面（窓）
  for (const dir of [1, -1]) {
    const z = dir > 0 ? C.z1 : C.z0
    const zi = z - dir * 0.08
    endRect(g, z, dir, -C.hw, C.hw, C.deck, C.winY0, GREEN, VM.paint, 0.6)
    endRect(g, z, dir, -C.hw, C.hw, C.winY1, 2.25, WOOD, VM.wood, 0)
    endRect(g, zi, -dir, -IW, IW, F, C.winY0, WOOD, VM.wood, 1)
    endRect(g, zi, -dir, -IW, IW, C.winY1, C.ceilSide, PANEL, VM.panel, 0.4)
    for (const [x0, x1] of [
      [-C.hw, -0.62],
      [-0.5, 0.5],
      [0.62, C.hw],
    ]) endRect(gl, z - dir * 0.03, dir, x0 + 0.03, x1 - 0.03, C.winY0, C.winY1, '#ffffff', 0)
    for (const x of [-0.56, 0.56]) g.boxMinMax(x - 0.06, C.winY0, Math.min(z, zi), x + 0.06, C.winY1, Math.max(z, zi), WOOD, VM.wood, 1)
    for (const s of [1, -1]) g.boxMinMax(Math.min(s * C.hw, s * (C.hw - 0.06)), C.winY0, Math.min(z, zi), Math.max(s * C.hw, s * (C.hw - 0.06)), C.winY1, Math.max(z, zi), WOOD, VM.wood, 1)
    g.boxMinMax(-C.hw, C.winY0 - 0.03, Math.min(z, zi) - 0.02, C.hw, C.winY0, Math.max(z, zi) + 0.02, WOOD_L, VM.wood, 0)
  }
}

/** 窓を等間隔に並べる（skip の範囲は除く） */
function spaced(z0: number, z1: number, w: number, pillar: number, skip: [number, number][]) {
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

/** 屋根（張り出す弓なりの緑の屋根）と、中の天井（弓なり）・灯りの帯・握り棒 */
function roof(g: GeoBuilder) {
  const rp: { x: number; y: number }[] = []
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2)
    rp.push({ x: (C.hw + 0.25) * Math.cos(a), y: 2.25 + 0.45 * Math.sin(a) })
  }
  const za = C.z0 - 0.4
  const zb = C.z1 + 0.5
  for (const s of [1, -1])
    for (let i = 0; i < rp.length - 1; i++) {
      const p = rp[i]
      const q = rp[i + 1]
      g.quad([s * p.x, p.y, za], [s * p.x, p.y, zb], [s * q.x, q.y, zb], [s * q.x, q.y, za], ROOFG, VM.paint, 0.6)
      // 屋根の裏（張り出しの下）
      g.quad([s * p.x, p.y - 0.04, za], [s * q.x, q.y - 0.04, za], [s * q.x, q.y - 0.04, zb], [s * p.x, p.y - 0.04, zb], '#e8e2d2', VM.ceiling, 0)
    }
  for (const z of [za, zb]) {
    for (const s of [1, -1])
      for (let i = 0; i < rp.length - 1; i++) {
        const p = rp[i]
        const q = rp[i + 1]
        g.tri([0, 2.25, z], [s * p.x, p.y, z], [s * q.x, q.y, z], ROOFG, VM.paint, 0.6)
      }
    g.quad([-C.hw - 0.25, 2.21, z], [C.hw + 0.25, 2.21, z], [C.hw + 0.25, 2.25, z], [-C.hw - 0.25, 2.25, z], ROOFG, VM.paint, 0.6)
  }
  // 中の天井（弓なり）
  const N = 10
  const cy = (x: number) => C.ceilSide + (C.ceilMid - C.ceilSide) * Math.sqrt(Math.max(0, 1 - (x / IW) ** 2))
  for (let k = 0; k < N; k++) {
    const x0 = -IW + (2 * IW * k) / N
    const x1 = -IW + (2 * IW * (k + 1)) / N
    g.quad([x0, cy(x0), C.z0 + 0.08], [x1, cy(x1), C.z0 + 0.08], [x1, cy(x1), C.z1 - 0.08], [x0, cy(x0), C.z1 - 0.08], '#f0ebdd', VM.ceiling, 0)
  }
  // 木の梁（1.68m ごと）と灯りの帯 2 本
  for (let z = C.z0 + 0.6; z < C.z1 - 0.3; z += 1.68) for (let k = 0; k < N; k++) {
    const x0 = -IW + (2 * IW * k) / N
    const x1 = -IW + (2 * IW * (k + 1)) / N
    g.quad([x0, cy(x0) - 0.05, z - 0.05], [x1, cy(x1) - 0.05, z - 0.05], [x1, cy(x1) - 0.05, z + 0.05], [x0, cy(x0) - 0.05, z + 0.05], WOOD_L, VM.wood, 0)
  }
  for (const x of [-0.6, 0.6]) {
    const y = cy(x) - 0.06
    g.boxMinMax(x - 0.08, y - 0.02, C.z0 + 0.4, x + 0.08, y, C.z1 - 0.4, '#c9b88a', VM.metal, 1)
    flatRect(g, y - 0.022, -1, x - 0.065, x + 0.065, C.z0 + 0.45, C.z1 - 0.45, '#fff0d4', VM.lamp, 0)
  }
  // 握り棒（窓ぎわの席の上）
  for (const s of [1, -1]) {
    const x = s * (C.aisle + 0.05)
    tube(g, [x, 1.95, C.z0 + 0.3], [x, 1.95, C.z1 - 0.9], 0.015, BRASS, VM.metal, 1)
    for (let z = C.z0 + 0.6; z < C.z1 - 0.9; z += 1.68) tube(g, [x, 1.95, z], [x, cy(x), z], 0.01, BRASS, VM.metal, 1)
  }
}

/** 2 人がけの腰掛け（舷の側 sx・背の z）。紺の縞のモケット・木の肘掛け・背の上の握り */
function bench(g: GeoBuilder, sx: number, zBack: number) {
  const xa = Math.min(sx * C.aisle, sx * (C.aisle + C.benchW))
  const xb = Math.max(sx * C.aisle, sx * (C.aisle + C.benchW))
  const z = (d: number) => zBack + d
  // 脚と台
  g.boxMinMax(xa + 0.08, F, z(0.1), xb - 0.08, F + C.seatH - 0.1, z(C.seatD - 0.06), '#3a2c22', VM.dark, 0.3)
  // 座面
  g.boxMinMax(xa, F + C.seatH - 0.1, z(0.04), xb, F + C.seatH, z(C.seatD + 0.04), MOQ, VM.fabric, 1)
  // 背（前はモケット・後ろは木）
  g.boxMinMax(xa, F + C.seatH - 0.04, z(0), xb, F + C.seatBack, z(0.07), MOQ, VM.fabric, 1)
  g.boxMinMax(xa - 0.005, F + C.seatH - 0.1, z(-0.03), xb + 0.005, F + C.seatBack + 0.03, z(0), WOOD, VM.wood, 1)
  // 通路の側の木の肘掛けと、背の上の握り
  const xg = sx * (C.aisle + 0.02)
  g.boxMinMax(Math.min(xg, xg + sx * 0.06), F + C.seatH, z(0.05), Math.max(xg, xg + sx * 0.06), F + C.seatH + 0.22, z(C.seatD), WOOD_L, VM.wood, 0)
  tube(g, [xg + sx * 0.04, F + C.seatBack + 0.03, z(-0.02)], [xg + sx * 0.04, F + C.seatBack + 0.13, z(-0.02)], 0.012, BRASS, VM.metal, 1)
  tube(g, [xg + sx * 0.04, F + C.seatBack + 0.13, z(-0.02)], [sx * (C.aisle + 0.3), F + C.seatBack + 0.13, z(-0.02)], 0.012, BRASS, VM.metal, 1)
}

/** 操舵の台（前の右舷。舵輪・計器・無線） */
function helm(g: GeoBuilder) {
  const z0 = C.z1 - 0.62
  const z1 = C.z1 - 0.1
  g.boxMinMax(-IW + 0.05, F, z0, -0.42, F + 0.95, z1, '#4a3a2c', VM.wood, 1)
  g.quad([-IW + 0.05, F + 0.95, z0], [-0.42, F + 0.95, z0], [-0.42, F + 1.05, z1], [-IW + 0.05, F + 1.05, z1], '#1d1f21', VM.dark, 0.5)
  g.boxMinMax(-1.15, F + 1.0, z0 + 0.18, -0.72, F + 1.12, z0 + 0.32, '#000000', VM.display, 2.2)
  // 舵輪（小さな木の輪）
  const m = new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.5).setPosition(-0.95, F + 1.12, z0 - 0.05)
  const prof: [number, number][] = []
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2
    prof.push([0.2 + Math.cos(a) * 0.018, Math.sin(a) * 0.018])
  }
  g.lathe(prof, 16, m, WOOD_L, VM.wood, 0)
  // 操舵の椅子
  g.boxMinMax(-1.12, F, z0 - 0.75, -0.72, F + 0.55, z0 - 0.4, '#24324a', VM.fabric, 1)
  g.boxMinMax(-1.12, F + 0.55, z0 - 0.82, -0.72, F + 1.05, z0 - 0.74, '#24324a', VM.fabric, 1)
}

/** 舳先の甲板の手すりとランタン・船尾の灯・前の行き先の表示（vehicles.ts と同じ） */
function bowAndStern(g: GeoBuilder) {
  const L = C.length
  tube(g, [0, C.deck, L / 2 - 1.2], [0, 1.75, L / 2 - 1.2], 0.04, IRON, VM.dark, 0.4)
  g.box([0, 1.85, L / 2 - 1.2], [0.24, 0.32, 0.24], '#ffcf8a', VM.lamp, 3)
  for (const s of [1, -1]) {
    tube(g, [s * 1.6, 1.25, L / 2 - 3.0], [s * 0.4, 1.25, L / 2 - 0.6], 0.03, IRON, VM.dark, 0.5)
    for (const k of [0, 0.5, 1]) {
      const x = s * (1.6 + (0.4 - 1.6) * k)
      const z = L / 2 - 3.0 + 2.4 * k
      tube(g, [x, C.deck, z], [x, 1.25, z], 0.02, IRON, VM.dark, 0.5)
    }
  }
  g.box([0, 2.4, C.z0 - 0.38], [0.12, 0.12, 0.08], '#ffffff', VM.lamp, 1)
  endRect(g, C.z1 + 0.505, 1, -0.6, 0.6, 2.3, 2.5, '#000000', VM.display, 4.4)
}

/** 細かい舟の形 */
function waterbusGeometry() {
  const g = new GeoBuilder()
  const gl = new GeoBuilder()
  hull(g)
  // 客室の床（板張り。甲板の 0.35m 下）と、床の下の暗い所（甲板の高さまでの舷の内）
  g.quad([-IW, F, C.z1 - 0.08], [IW, F, C.z1 - 0.08], [IW, F, C.z0 + 0.08], [-IW, F, C.z0 + 0.08], '#7d6750', VM.floor, 1)
  // 通路の床の滑り止めのゴムの帯
  g.boxMinMax(-0.3, F, C.z0 + 0.2, 0.3, F + 0.005, C.z1 - 0.7, '#3c4248', VM.floor, 0)
  cabinWalls(g, gl)
  roof(g)
  for (const zb of waterbusRows()) for (const sx of [1, -1]) bench(g, sx, zb)
  helm(g)
  bowAndStern(g)
  return { body: g.build(), glass: gl.build() }
}

/** 扉の板（引き戸。扉の真ん中・閉じた位置。sx の舷） */
function leafGeometry(sx: number) {
  const g = new GeoBuilder()
  const gl = new GeoBuilder()
  const x0 = sx * (C.hw + 0.012)
  const x1 = sx * (C.hw + 0.05)
  const xa = Math.min(x0, x1)
  const xb = Math.max(x0, x1)
  const h = C.doorW / 2 + 0.03
  const y0 = C.deck + 0.01
  const y1 = C.doorTop + 0.03
  const g0 = 1.05
  const g1 = 1.95
  g.boxMinMax(xa, y0, -h, xb, g0, h, GREEN, VM.paint, 0.6)
  g.boxMinMax(xa, g1, -h, xb, y1, h, WOOD, VM.wood, 1)
  g.boxMinMax(xa, g0, -h, xb, g1, -h + 0.07, WOOD, VM.wood, 1)
  g.boxMinMax(xa, g0, h - 0.07, xb, g1, h, WOOD, VM.wood, 1)
  g.boxMinMax(sx > 0 ? xb : xa - 0.02, 1.2, h - 0.12, sx > 0 ? xb + 0.02 : xa, 1.5, h - 0.09, BRASS, VM.metal, 1)
  sideRect(gl, sx * (C.hw + 0.03), sx, -h + 0.07, h - 0.07, g0, g1, '#ffffff', 0)
  return { body: g.build(), glass: gl.build() }
}

/* -------------------------------------------------------------------------- */
/* シェーダー（舟の局所の中の決まり）                                                 */
/* -------------------------------------------------------------------------- */

const f = (v: number) => v.toFixed(4)

const BOAT_GLSL: VehicleGlsl = {
  name: 'waterbus',
  glsl: /* glsl */ `
    bool vehInside(vec3 p) {
      return abs(p.x) < ${f(IW + 0.012)} && p.z > ${f(C.z0 - 0.01)} && p.z < ${f(C.z1 + 0.01)} && p.y > ${f(F - 0.03)} && p.y < ${f(C.ceilMid + 0.04)};
    }
    bool vehCamInside(vec3 c) { return abs(c.x) < ${f(IW)} && c.z > ${f(C.z0)} && c.z < ${f(C.z1)} && c.y > ${f(F)} && c.y < ${f(C.ceilMid)}; }
    float vehSunThrough(vec3 p, vec3 L) {
      if (abs(L.x) > 1e-3) {
        float t = (sign(L.x) * ${f(IW)} - p.x) / L.x;
        if (t > 0.0) {
          vec3 h = p + L * t;
          if (h.z > ${f(C.z0 + 0.2)} && h.z < ${f(C.z1 - 0.2)} && h.y > ${f(C.winY0)} && h.y < ${f(C.winY1)}) return 0.85;
        }
      }
      if (abs(L.z) > 1e-3) {
        float zw = L.z > 0.0 ? ${f(C.z1)} : ${f(C.z0)};
        float t = (zw - p.z) / L.z;
        if (t > 0.0) {
          vec3 h = p + L * t;
          if (abs(h.x) < ${f(IW)} && h.y > ${f(C.winY0)} && h.y < ${f(C.winY1)}) return 0.8;
        }
      }
      return 0.0;
    }
    vec3 vehLamp(vec3 p, vec3 n) {
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 2; i++) {
        float x = i == 0 ? -0.6 : 0.6;
        vec3 q = vec3(x, ${f(C.ceilSide + 0.2)}, clamp(p.z, ${f(C.z0 + 0.5)}, ${f(C.z1 - 0.5)}));
        vec3 Lv = q - p;
        float d2 = dot(Lv, Lv);
        vec3 Ll = Lv * inversesqrt(max(d2, 1e-4));
        float ndl = max(dot(n, Ll), 0.0);
        acc += vec3(1.0, 0.82, 0.6) * (ndl * 0.75 + 0.25) / (d2 * 1.3 + 0.7);
      }
      return acc * 1.15 + vec3(1.0, 0.85, 0.66) * 0.07;
    }
  `,
}

/* -------------------------------------------------------------------------- */
/* 入れ物                                                                       */
/* -------------------------------------------------------------------------- */

const _m = new THREE.Matrix4()
const _t = new THREE.Matrix4()
const _info = [0, 0, 0, 0]

/** 細かい舟（最大 capacity 隻）。毎コマ begin → add（舟の局所 → シーンの行列・iInfo）→ end */
export class WaterbusDetail {
  readonly meshes: THREE.InstancedMesh[]
  private body: InstancedPart
  private glass: InstancedPart
  private leaves: InstancedPart[]
  private leafGlass: InstancedPart[]
  private readonly capacity: number
  private n = 0

  constructor(capacity = 3) {
    this.capacity = capacity
    const mat = createDetailMaterial(BOAT_GLSL, transitUniforms.uLineColors)
    const glassMat = createDetailGlassMaterial(BOAT_GLSL)
    const geo = waterbusGeometry()
    this.body = new InstancedPart(geo.body, mat, 'transit:waterbus:body', capacity)
    this.glass = new InstancedPart(geo.glass, glassMat, 'transit:waterbus:glass', capacity)
    const leaves = [1, -1].map((sx) => leafGeometry(sx))
    this.leaves = leaves.map((l, k) => new InstancedPart(l.body, mat, `transit:waterbus:leaf${k}`, capacity))
    this.leafGlass = leaves.map((l, k) => new InstancedPart(l.glass, glassMat, `transit:waterbus:leafGlass${k}`, capacity))
    for (const p of [this.glass, ...this.leafGlass]) p.mesh.renderOrder = 22
    this.meshes = [this.body, this.glass, ...this.leaves, ...this.leafGlass].map((p) => p.mesh)
  }

  private get parts() {
    return [this.body, this.glass, ...this.leaves, ...this.leafGlass]
  }

  begin() {
    this.n = 0
    for (const p of this.parts) p.begin()
  }

  /** 1 隻（m = 舟の局所 → シーン、info = (中の灯り, 扉の開き具合, 扉の側, 色の番号 + 種)、speed = 速さ（未使用）） */
  add(m: THREE.Matrix4, info: readonly number[], speed = 0) {
    void speed
    if (this.n >= this.capacity) return false
    this.n++
    for (let k = 0; k < 4; k++) _info[k] = info[k]
    this.body.add(m, _info)
    this.glass.add(m, _info)
    const open = info[1]
    const e = open * open * (3 - 2 * open)
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? 1 : -1
      const z = C.doorZ - (sx === info[2] ? e * C.doorSlide : 0)
      _t.makeTranslation(0, 0, z)
      _m.multiplyMatrices(m, _t)
      this.leaves[s].add(_m, _info)
      this.leafGlass[s].add(_m, _info)
    }
    return true
  }

  end() {
    for (const p of this.parts) p.end()
  }
}

