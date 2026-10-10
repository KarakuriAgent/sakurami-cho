import * as THREE from 'three'
import { GeoBuilder } from '../site/builder'
import { TM } from './transitMaterial'

/**
 * 車両と船の形（局所の座標: x = 右、y = 上（レール面・水面 = 0）、z = 前）。どれも GeoBuilder（位置・法線・色・aMat）で作り、
 * 交通のシェーダー（transitMaterial.ts）のインスタンスで描く。近くの形（細かい）と遠くの形（箱に近い）を作る。
 *
 * - 緑電 9100 形「ひらき」（3 両連接の低床車）: 前の車両（運転台・大きな前面の窓・前照灯と尾灯・行き先の表示）と、中の車両（パンタグラフ）。
 *   車体は緑（ひらき緑）とクリーム、屋根に屋根庭パネル（多肉植物と苔）。vol3 4-3
 * - ヒノテツ東海岸線の電車（20m の銀の車体に橙と緑の帯。先頭車と中間車）
 * - 丘ノ上ケーブルの車両（赤とクリーム。急な線路に合わせた段々の床・木の内装）。vol3 4-4
 * - 運河バス（クリームの船体と緑の屋根・木の窓枠・舳先のランタン）・汐見島連絡船・港の小舟・ヨット・貨物船
 * - 浮遊機器（配送の浮遊機。小さな丸い体と灯）
 */

type V3 = [number, number, number]
const v = (x: number, y: number, z: number): V3 => [x, y, z]

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

/** 外向きの向き hint に表を向けた四角形 */
function oq(g: GeoBuilder, a: V3, b: V3, c: V3, d: V3, hint: V3, color: THREE.ColorRepresentation, mat: number, aux = 0) {
  _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
  const n = _a.cross(_b)
  if (n.x * hint[0] + n.y * hint[1] + n.z * hint[2] < 0) g.quad(d, c, b, a, color, mat, aux)
  else g.quad(a, b, c, d, color, mat, aux)
}

/** 外向きの三角形 */
function ot(g: GeoBuilder, a: V3, b: V3, c: V3, hint: V3, color: THREE.ColorRepresentation, mat: number, aux = 0) {
  _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
  const n = _a.cross(_b)
  if (n.x * hint[0] + n.y * hint[1] + n.z * hint[2] < 0) g.tri(c, b, a, color, mat, aux)
  else g.tri(a, b, c, color, mat, aux)
}

/**
 * 断面（x, y の列。右半分を下から上へ）を、z0〜z1 に押し出した外の面。断面の点ごとに色と質感（その点から次の点までの帯）
 */
function extrude(g: GeoBuilder, prof: { x: number; y: number; c: string; m: number; a?: number }[], z0: number, z1: number, both = true) {
  for (const s of both ? [1, -1] : [1]) {
    for (let i = 0; i < prof.length - 1; i++) {
      const p = prof[i]
      const q = prof[i + 1]
      // 右半分の辺の外向き（dy, -dx）を、左半分は x を反転
      const hint: V3 = [s * (q.y - p.y), -(q.x - p.x), 0]
      oq(g, v(p.x * s, p.y, z0), v(p.x * s, p.y, z1), v(q.x * s, q.y, z1), v(q.x * s, q.y, z0), hint, p.c, p.m, p.a ?? 0)
    }
  }
}

/** 断面の端のふた（z の位置、向き dir = ±1）。断面は左右対称で凸に近い */
function cap(g: GeoBuilder, prof: { x: number; y: number }[], z: number, dir: number, color: string, mat: number, aux = 0) {
  const cy = prof.reduce((s, p) => s + p.y, 0) / prof.length
  for (let i = 0; i < prof.length - 1; i++) {
    const p = prof[i]
    const q = prof[i + 1]
    for (const s of [1, -1]) ot(g, v(0, cy, z), v(p.x * s, p.y, z), v(q.x * s, q.y, z), [0, 0, dir], color, mat, aux)
  }
  ot(g, v(0, cy, z), v(prof[0].x, prof[0].y, z), v(-prof[0].x, prof[0].y, z), [0, 0, dir], color, mat, aux)
  const l = prof[prof.length - 1]
  ot(g, v(0, cy, z), v(l.x, l.y, z), v(-l.x, l.y, z), [0, 0, dir], color, mat, aux)
}

/**
 * 横の窓の帯（x = ±hw の面。y0〜y1）。窓の範囲 wins = [z0, z1][]（その外は柱 = 塗装）。窓は reveal m 引っ込め、額縁の見込みをつける
 */
function windowBand(g: GeoBuilder, hw: number, y0: number, y1: number, z0: number, z1: number, wins: [number, number][], paint: string, frame: string, reveal = 0.04, glassAux = 0) {
  for (const s of [1, -1]) {
    const x = hw * s
    const xi = (hw - reveal) * s
    const hint: V3 = [s, 0, 0]
    let z = z0
    const sorted = [...wins].sort((a, b) => a[0] - b[0])
    for (const [a, b] of sorted) {
      if (a > z + 1e-3) oq(g, v(x, y0, z), v(x, y0, a), v(x, y1, a), v(x, y1, z), hint, paint, TM.paint, 0.7)
      // 額縁の見込み（上下左右）とガラス
      const m = 0.04
      oq(g, v(x, y0 + m, a), v(xi, y0 + m, a), v(xi, y1 - m, a), v(x, y1 - m, a), [0, 0, 1], frame, TM.metal)
      oq(g, v(x, y0 + m, b), v(xi, y0 + m, b), v(xi, y1 - m, b), v(x, y1 - m, b), [0, 0, -1], frame, TM.metal)
      oq(g, v(x, y1 - m, a), v(xi, y1 - m, a), v(xi, y1 - m, b), v(x, y1 - m, b), [0, -1, 0], frame, TM.metal)
      oq(g, v(x, y0 + m, a), v(xi, y0 + m, a), v(xi, y0 + m, b), v(x, y0 + m, b), [0, 1, 0], frame, TM.metal)
      oq(g, v(x, y0, a), v(x, y0, b), v(x, y0 + m, b), v(x, y0 + m, a), hint, frame, TM.metal)
      oq(g, v(x, y1 - m, a), v(x, y1 - m, b), v(x, y1, b), v(x, y1, a), hint, frame, TM.metal)
      oq(g, v(xi, y0 + m, a), v(xi, y0 + m, b), v(xi, y1 - m, b), v(xi, y1 - m, a), hint, '#ffffff', TM.glass, glassAux)
      z = b
    }
    if (z1 > z + 1e-3) oq(g, v(x, y0, z), v(x, y0, z1), v(x, y1, z1), v(x, y1, z), hint, paint, TM.paint, 0.7)
  }
}

/** 窓を等間隔に並べる（z0〜z1 に、幅 w の窓を、柱 pillar を挟んで。skip の範囲（扉）は除く） */
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

/* -------------------------------------------------------------------------- */
/* 緑電 9100 形                                                                */
/* -------------------------------------------------------------------------- */

const TRAM = {
  green: '#1f5a3e',
  greenDark: '#173f2d',
  cream: '#e9dfc4',
  roof: '#b9bab4',
  dark: '#1b1c1e',
  hw: 1.2,
  /** 1 両の長さ（連接の幌を除く） */
  len: 9.6,
}
export const TRAM_SECTION = TRAM.len
/** 連接の幌の長さ */
export const TRAM_GAP = 0.7
/** パンタグラフの架線の高さ（レール面から） */
export const WIRE_HEIGHT = 5.4

/** 緑電の車体の断面（右半分、下から上） */
function tramProfile() {
  const { green, cream, roof, dark } = TRAM
  return [
    { x: 1.12, y: 0.12, c: dark, m: TM.dark },
    { x: 1.18, y: 0.32, c: green, m: TM.paint, a: 0.7 },
    { x: 1.2, y: 0.72, c: cream, m: TM.paint, a: 0.7 },
    { x: 1.2, y: 1.05, c: green, m: TM.paint, a: 0.7 },
    // 窓の帯は windowBand が描く（ここは飛ばす）
    { x: 1.2, y: 2.42, c: green, m: TM.paint, a: 0.7 },
    { x: 1.19, y: 2.86, c: cream, m: TM.paint, a: 0.7 },
    { x: 1.16, y: 2.96, c: roof, m: TM.paint, a: 0.3 },
    { x: 1.0, y: 3.18, c: roof, m: TM.paint, a: 0.3 },
    { x: 0.7, y: 3.27, c: roof, m: TM.paint, a: 0.3 },
    { x: 0, y: 3.3, c: roof, m: TM.paint, a: 0.3 },
  ]
}

/** 屋根庭のパネル（z0〜z1） */
function roofGarden(g: GeoBuilder, z0: number, z1: number) {
  const n = Math.max(1, Math.round((z1 - z0) / 1.6))
  const w = (z1 - z0) / n
  for (let i = 0; i < n; i++) {
    const a = z0 + i * w + 0.08
    const b = z0 + (i + 1) * w - 0.08
    // 枠（灰色）と植物の面（少し盛り上がる）
    g.boxMinMax(-0.92, 3.26, a, 0.92, 3.36, b, '#6d6e69', TM.metal)
    g.box([0, 3.42, (a + b) / 2], [1.72, 0.12, b - a - 0.12], '#335a26', TM.garden)
    // ふくらみ（多肉のかたまり）
    for (let k = 0; k < 3; k++) {
      const z = a + ((k + 0.5) / 3) * (b - a)
      g.box([(k % 2 ? -1 : 1) * 0.35, 3.5, z], [0.7, 0.1, (b - a) / 3.4], '#2f5a22', TM.garden)
    }
  }
}

/** 台車（z の位置） */
function bogie(g: GeoBuilder, z: number, hw = 0.95, len = 2.2) {
  g.box([0, 0.36, z], [hw * 2, 0.32, len], '#202123', TM.dark, 0.2)
  for (const s of [1, -1]) for (const dz of [-len * 0.3, len * 0.3]) g.cylinder([s * (hw - 0.05), 0.33, z + dz], 0.33, 0.1, 10, '#2a2a2c', TM.dark, 0.5, true)
}

/** 緑電の 1 両。cab = 前に運転台（前 = +z）。middle = パンタグラフ */
function tramSection(cab: boolean, middle: boolean) {
  const g = new GeoBuilder()
  const L = TRAM.len
  const z0 = -L / 2
  const zf = L / 2 - (cab ? 1.5 : 0)
  const prof = tramProfile()
  // 下の帯と上の帯（窓の帯で分ける）
  const lower = prof.slice(0, 4)
  const upper = prof.slice(4)
  extrude(g, lower, z0, zf)
  extrude(g, upper, z0, zf)
  // 扉（両側。両開き 1.3m）と窓
  const doors: [number, number][] = cab ? [[z0 + 1.2, z0 + 2.5], [zf - 2.4, zf - 1.1]] : [[-0.65, 0.65]]
  const wins = spacedWindows(z0 + 0.2, zf - 0.15, 1.15, 0.1, doors.map(([a, b]) => [a - 0.04, b + 0.04]))
  windowBand(g, TRAM.hw, 1.05, 2.42, z0, zf, wins, TRAM.green, '#2b2f2c', 0.04, 0.035)
  for (const [a, b] of doors) {
    for (const s of [1, -1]) {
      const x = (TRAM.hw + 0.005) * s
      // 扉の板（緑の枠と大きなガラス）
      oq(g, v(x, 0.34, a), v(x, 0.34, b), v(x, 2.42, b), v(x, 2.42, a), [s, 0, 0], TRAM.greenDark, TM.paint, 0.7)
      const xi = (TRAM.hw + 0.01) * s
      for (const [p, q] of [
        [a + 0.08, (a + b) / 2 - 0.03],
        [(a + b) / 2 + 0.03, b - 0.08],
      ]) oq(g, v(xi, 0.55, p), v(xi, 0.55, q), v(xi, 2.3, q), v(xi, 2.3, p), [s, 0, 0], '#ffffff', TM.glass, 0.035)
    }
  }
  // 後ろの端（幌につながる面）
  cap(g, prof, z0, -1, TRAM.greenDark, TM.paint, 0.5)
  if (cab) {
    // 運転台: 下の帯を前へ丸く絞り、大きな前面の窓を傾ける
    const zn = L / 2
    const k = 10
    const ring = (t: number) => {
      // t = 0（側面の終わり）→ 1（先端）。横幅と前への出
      const ang = (t * Math.PI) / 2
      return { x: Math.cos(ang), z: Math.sin(ang) }
    }
    for (let i = 0; i < k; i++) {
      for (const s of [1, -1]) {
        const r0 = ring(i / k)
        const r1 = ring((i + 1) / k)
        const P = (r: { x: number; z: number }, y: number, hw: number, out: number) => v(s * hw * (0.55 + 0.45 * r.x), y, zf + out * r.z)
        // 下の帯（緑・クリームの帯・スカート）
        const bands: [number, number, string, number, number, number][] = [
          [0.12, 0.32, TRAM.dark, TM.dark, 1.12, 1.35],
          [0.32, 0.72, TRAM.green, TM.paint, 1.18, 1.5],
          [0.72, 1.05, TRAM.cream, TM.paint, 1.2, 1.5],
        ]
        for (const [y0, y1, c, m, hw, out] of bands) {
          oq(g, P(r0, y0, hw, out), P(r1, y0, hw, out), P(r1, y1, hw, out), P(r0, y1, hw, out), [s * r0.x, 0, r0.z + 0.1], c, m, m === TM.paint ? 0.7 : 0.1)
        }
        // 前面の窓（下 1.12 → 上 2.55。上ほど後ろへ）
        const wy0 = 1.05
        const wy1 = 2.5
        const W = (r: { x: number; z: number }, y: number) => {
          const t = (y - wy0) / (wy1 - wy0)
          return v(s * 1.2 * (0.55 + 0.45 * r.x) * (1 - 0.04 * t), y, zf + 1.5 * r.z - 0.45 * t * r.z)
        }
        oq(g, W(r0, wy0), W(r1, wy0), W(r1, wy1), W(r0, wy1), [s * r0.x, 0.2, r0.z + 0.1], '#ffffff', TM.glass, i < 3 ? 0.035 : 2)
        // 窓の上（行き先の表示の帯と屋根へ）
        const T = (r: { x: number; z: number }, y: number, out: number, hw: number) => v(s * hw * (0.55 + 0.45 * r.x), y, zf + out * r.z)
        oq(g, T(r0, wy1, 1.05, 1.15), T(r1, wy1, 1.05, 1.15), T(r1, 2.96, 0.85, 1.16), T(r0, 2.96, 0.85, 1.16), [s * r0.x, 0.3, r0.z], TRAM.green, TM.paint, 0.7)
        oq(g, T(r0, 2.96, 0.85, 1.16), T(r1, 2.96, 0.85, 1.16), T(r1, 3.28, 0.3, 0.7), T(r0, 3.28, 0.3, 0.7), [s * r0.x * 0.5, 0.8, r0.z], TRAM.roof, TM.paint, 0.3)
      }
    }
    // 前面の窓の下の縁と屋根の先のふた
    g.box([0, 3.26, zf + 0.15], [1.38, 0.06, 0.6], TRAM.roof, TM.paint, 0.3)
    // 行き先の表示（前）
    oq(g, v(-0.62, 2.58, zn - 0.47), v(0.62, 2.58, zn - 0.47), v(0.62, 2.86, zn - 0.5), v(-0.62, 2.86, zn - 0.5), [0, 0.1, 1], '#111111', TM.sign, -0.62)
    // 前照灯・尾灯（左右）
    for (const s of [1, -1]) {
      g.cylinder([s * 0.78, 0.66, zn - 0.04], 0.11, 0.06, 12, '#dddddd', TM.head, 0, true)
      g.box([s * 0.93, 0.62, zn - 0.12], [0.16, 0.12, 0.05], '#330000', TM.tail)
    }
    // ワイパーと連結器のふた
    g.box([0, 0.22, zn + 0.0], [1.1, 0.14, 0.12], '#151515', TM.dark)
    // 横の行き先の表示
    for (const s of [1, -1]) oq(g, v(s * 1.205, 2.42, zf - 0.95), v(s * 1.205, 2.42, zf - 0.05), v(s * 1.205, 2.62, zf - 0.05), v(s * 1.205, 2.62, zf - 0.95), [s, 0, 0], '#111', TM.sign, zf - 0.95)
  }
  // 屋根庭（運転台の上は除く）と、パンタグラフ
  roofGarden(g, z0 + 0.4, zf - 0.2)
  if (middle) {
    g.boxMinMax(-0.5, 3.3, -1.2, 0.5, 3.55, 1.2, '#4b4d4b', TM.metal)
    // 菱形の腕（下の腕 → 上の腕 → 集電の舟）
    for (const s of [1, -1]) {
      g.beam([s * 0.35, 3.55, -0.6], [s * 0.3, 4.5, 0.25], 0.06, '#2a2b2c', TM.dark, 0.4)
      g.beam([s * 0.3, 4.5, 0.25], [s * 0.25, WIRE_HEIGHT - 0.06, -0.2], 0.05, '#2a2b2c', TM.dark, 0.4)
    }
    g.box([0, WIRE_HEIGHT - 0.04, -0.2], [1.5, 0.06, 0.12], '#3a3b3c', TM.metal)
  }
  // 台車と床下
  g.boxMinMax(-1.05, 0.12, z0 + 0.3, 1.05, 0.32, zf - 0.3, '#141516', TM.dark)
  bogie(g, cab ? zf - 1.2 : 0)
  if (!middle) bogie(g, z0 + 1.8)
  return g.build()
}

/** 連接の幌（2 つの車両の間。z = 0 が中心、長さ TRAM_GAP） */
function tramGangway() {
  const g = new GeoBuilder()
  const n = 5
  for (let i = 0; i < n; i++) {
    const z = -TRAM_GAP / 2 + ((i + 0.5) / n) * TRAM_GAP
    g.box([0, 1.75, z], [2.1, 2.9, (TRAM_GAP / n) * 0.8], i % 2 ? '#1c1c1c' : '#2a2a2a', TM.dark, 0.1)
  }
  return g.build()
}

/** 遠くの緑電の 1 両（箱と帯） */
function tramFar(cab: boolean) {
  const g = new GeoBuilder()
  const L = TRAM.len + TRAM_GAP
  g.boxMinMax(-1.2, 0.15, -L / 2, 1.2, 1.1, L / 2, TRAM.green, TM.paint, 0.6)
  g.boxMinMax(-1.21, 1.1, -L / 2, 1.21, 2.38, L / 2, '#ffffff', TM.glass, 1)
  g.boxMinMax(-1.2, 2.38, -L / 2, 1.2, 3.3, L / 2, TRAM.green, TM.paint, 0.6)
  g.boxMinMax(-0.9, 3.3, -L / 2 + 0.4, 0.9, 3.45, L / 2 - 0.4, '#335a26', TM.garden)
  if (cab) g.box([0, 0.66, L / 2 + 0.01], [1.7, 0.14, 0.04], '#dddddd', TM.head)
  return g.build()
}

/* -------------------------------------------------------------------------- */
/* ヒノテツの電車                                                               */
/* -------------------------------------------------------------------------- */

export const TRAIN_CAR = 20
export const TRAIN_GAP = 0.5

/** 20m の銀の車体（cab = 前に運転台） */
function trainCar(cab: boolean) {
  const g = new GeoBuilder()
  const L = TRAIN_CAR
  const z0 = -L / 2
  const z1 = L / 2
  const silver = '#b9bcbe'
  const orange = '#d9692a'
  const green = '#2f7a4a'
  const prof = [
    { x: 1.32, y: 1.1, c: '#3a3b3d', m: TM.dark },
    { x: 1.4, y: 1.25, c: silver, m: TM.metal },
    { x: 1.45, y: 1.85, c: green, m: TM.paint, a: 0.6 },
    { x: 1.45, y: 2.0, c: orange, m: TM.paint, a: 0.6 },
    { x: 1.45, y: 2.12, c: silver, m: TM.metal },
  ]
  const top = [
    { x: 1.45, y: 3.1, c: silver, m: TM.metal },
    { x: 1.43, y: 3.55, c: silver, m: TM.metal },
    { x: 1.3, y: 3.8, c: '#8f9294', m: TM.metal },
    { x: 0.8, y: 3.95, c: '#8f9294', m: TM.metal },
    { x: 0, y: 4.0, c: '#8f9294', m: TM.metal },
  ]
  const zc = cab ? z1 - 2.2 : z1
  extrude(g, prof, z0, zc)
  extrude(g, top, z0, zc)
  // 扉 4 つ（両開き 1.3m）
  const doorsAt = [-7.0, -2.4, 2.4, 7.0].filter((z) => z < zc - 1)
  const doors: [number, number][] = doorsAt.map((z) => [z - 0.65, z + 0.65])
  const wins = spacedWindows(z0 + 0.4, zc - 0.3, 1.4, 0.18, doors.map(([a, b]) => [a - 0.25, b + 0.25]))
  windowBand(g, 1.45, 2.12, 3.1, z0, zc, wins, silver, '#3b3d3f', 0.04, 0.115)
  for (const [a, b] of doors) {
    for (const s of [1, -1]) {
      const x = (1.455) * s
      oq(g, v(x, 1.25, a), v(x, 1.25, b), v(x, 3.15, b), v(x, 3.15, a), [s, 0, 0], '#a9acae', TM.metal)
      for (const [p, q] of [
        [a + 0.1, (a + b) / 2 - 0.04],
        [(a + b) / 2 + 0.04, b - 0.1],
      ]) oq(g, v(x * 1.003, 2.2, p), v(x * 1.003, 2.2, q), v(x * 1.003, 3.0, q), v(x * 1.003, 3.0, p), [s, 0, 0], '#ffffff', TM.glass, 0.115)
    }
  }
  const all = [...prof, { x: 1.45, y: 3.1 }, ...top.slice(1)]
  cap(g, all as { x: number; y: number }[], z0, -1, '#6a6d70', TM.metal)
  if (cab) {
    // 運転台: 少し傾いた前面（黒い窓まわり・帯・前照灯）
    const zt = z1
    const P = (x: number, y: number, back: number) => v(x, y, zt - back)
    for (const s of [1, -1]) {
      oq(g, P(s * 1.32, 1.1, 2.2), P(s * 1.4, 1.1, 0), P(s * 1.4, 2.12, 0.05), P(s * 1.45, 2.12, 2.2), [s, 0, 0.2], silver, TM.metal)
      oq(g, P(s * 1.45, 2.12, 2.2), P(s * 1.4, 2.12, 0.05), P(s * 1.35, 3.6, 0.45), P(s * 1.43, 3.55, 2.2), [s, 0, 0.2], '#1c1d1f', TM.paint, 0.9)
      oq(g, P(s * 1.43, 3.55, 2.2), P(s * 1.35, 3.6, 0.45), P(s * 0.8, 3.95, 0.6), P(s * 0.8, 3.95, 2.2), [s * 0.4, 1, 0.1], '#8f9294', TM.metal)
    }
    oq(g, P(-1.4, 1.1, 0), P(1.4, 1.1, 0), P(1.4, 2.12, 0.05), P(-1.4, 2.12, 0.05), [0, 0, 1], silver, TM.metal)
    oq(g, P(-1.4, 1.75, -0.01), P(1.4, 1.75, -0.01), P(1.4, 1.95, -0.01), P(-1.4, 1.95, -0.01), [0, 0, 1], orange, TM.paint, 0.6)
    oq(g, P(-1.4, 2.12, 0.05), P(1.4, 2.12, 0.05), P(1.35, 3.6, 0.45), P(-1.35, 3.6, 0.45), [0, 0.3, 1], '#ffffff', TM.glass, 2)
    oq(g, P(-1.35, 3.6, 0.45), P(1.35, 3.6, 0.45), P(0.8, 3.95, 0.6), P(-0.8, 3.95, 0.6), [0, 1, 0.3], '#8f9294', TM.metal)
    oq(g, P(-0.7, 3.25, 0.37), P(0.7, 3.25, 0.37), P(0.7, 3.48, 0.42), P(-0.7, 3.48, 0.42), [0, 0.3, 1], '#111', TM.sign, -0.7)
    for (const s of [1, -1]) {
      g.box([s * 0.95, 1.55, zt + 0.02], [0.32, 0.16, 0.06], '#dddddd', TM.head)
      g.box([s * 0.95, 1.36, zt + 0.02], [0.24, 0.1, 0.06], '#330000', TM.tail)
    }
    g.box([0, 0.85, zt - 0.3], [2.4, 0.5, 0.6], '#252628', TM.dark)
  } else {
    cap(g, all as { x: number; y: number }[], z1, 1, '#6a6d70', TM.metal)
  }
  // 屋根の空調とパンタグラフ（偶数の中間車）
  g.boxMinMax(-0.8, 3.95, -3, 0.8, 4.3, 3, '#9a9da0', TM.metal)
  // 床下の機器と台車
  g.boxMinMax(-1.2, 0.55, z0 + 3.5, 1.2, 1.1, z1 - 3.5, '#1d1e20', TM.dark, 0.2)
  bogie(g, z0 + 2.5, 1.0, 2.6)
  bogie(g, z1 - 2.5, 1.0, 2.6)
  return g.build()
}

function trainFar() {
  const g = new GeoBuilder()
  const L = TRAIN_CAR + TRAIN_GAP
  g.boxMinMax(-1.45, 0.6, -L / 2, 1.45, 2.12, L / 2, '#b9bcbe', TM.metal)
  g.boxMinMax(-1.46, 1.85, -L / 2, 1.46, 2.0, L / 2, '#d9692a', TM.paint, 0.5)
  g.boxMinMax(-1.46, 2.12, -L / 2, 1.46, 3.1, L / 2, '#ffffff', TM.glass, 1)
  g.boxMinMax(-1.45, 3.1, -L / 2, 1.45, 4.0, L / 2, '#a3a6a8', TM.metal)
  return g.build()
}

/* -------------------------------------------------------------------------- */
/* 丘ノ上ケーブルの車両                                                          */
/* -------------------------------------------------------------------------- */

/**
 * ケーブルカー（さくら号・かえで号。赤とクリーム、木の窓枠）の遠くの形。近く（90m まで）と乗っている車両は cableCar.ts の細かい形。
 * 床は 4 段の段々（区画ごとに 2.875m。勾配 slope）で、区画ごとに窓 2 つと扉（窓つき）、屋根と幕板も区画ごとの段。原点 = 車両の中心のレール面、+z = 山側
 */
function cableCar(slope: number) {
  const g = new GeoBuilder()
  const L = 11.5
  const red = '#a82b23'
  const cream = '#efe3c4'
  const wood = '#6b4325'
  const hw = 1.3
  const steps = 4
  const segL = L / steps
  for (let i = 0; i < steps; i++) {
    const za = -L / 2 + i * segL
    const zb = za + segL
    const zc = (za + zb) / 2
    // この区画の床の高さ（区画の真ん中のレールの線から 0.82m 上。cableCar.ts の compFloor と同じ）
    const floor = slope * zc + 0.82
    const prof = [
      { x: hw - 0.12, y: floor - 0.62, c: '#2a2a2a', m: TM.dark },
      { x: hw, y: floor - 0.45, c: red, m: TM.paint, a: 0.6 },
      { x: hw, y: floor + 0.92, c: cream, m: TM.paint, a: 0.6 },
      { x: hw, y: floor + 0.95, c: red, m: TM.paint, a: 0.6 },
    ]
    extrude(g, prof, za, zb)
    const wins: [number, number][] = [
      [za + 0.15, zc - 0.53],
      [zc - 0.35, zc + 0.35],
      [zc + 0.53, zb - 0.15],
    ]
    windowBand(g, hw, floor + 0.95, floor + 1.88, za, zb, wins, cream, wood, 0.05, Math.max(0.001, floor / 10))
    const top = [
      { x: hw, y: floor + 1.88, c: cream, m: TM.paint, a: 0.6 },
      { x: hw, y: floor + 1.98, c: red, m: TM.paint, a: 0.6 },
      { x: hw, y: floor + 2.22, c: '#5b5e60', m: TM.paint, a: 0.2 },
      { x: hw * 0.6, y: floor + 2.38, c: '#5b5e60', m: TM.paint, a: 0.2 },
      { x: 0, y: floor + 2.45, c: '#5b5e60', m: TM.paint, a: 0.2 },
    ]
    extrude(g, top, za, zb)
    // 区画の両端のふた（段の間の立ち上がりと、前後の妻面。中の面は窓の奥の絵で見えない）
    cap(g, [...prof, ...top], za, -1, red, TM.paint, 0.6)
    cap(g, [...prof, ...top], zb, 1, red, TM.paint, 0.6)
    // 扉の縁（窓の帯の下の扉の形の線）
    for (const sx of [1, -1]) g.boxMinMax(sx > 0 ? hw - 0.01 : -hw - 0.03, floor, zc - 0.42, sx > 0 ? hw + 0.03 : -hw + 0.01, floor + 0.92, zc + 0.42, '#97261f', TM.paint, 0.6)
  }
  // 前後の妻面の窓・灯り・名前の板（山側 +z と谷側 -z）
  for (const dir of [1, -1]) {
    const z = (dir * L) / 2 + dir * 0.005
    const floor = slope * ((dir * (L - segL)) / 2) + 0.82
    for (const s of [-0.57, 0.57]) oq(g, v(s - 0.45, floor + 0.95, z), v(s + 0.45, floor + 0.95, z), v(s + 0.45, floor + 1.88, z), v(s - 0.45, floor + 1.88, z), [0, 0, dir], '#ffffff', TM.glass, 0)
    g.cylinder([0, floor + 0.24, z], 0.13, 0.05, 12, '#dddddd', TM.head, 0, true)
    g.box([0.95, floor + 0.27, z], [0.16, 0.1, 0.05], '#330000', TM.tail)
    g.box([-0.95, floor + 0.27, z], [0.16, 0.1, 0.05], '#330000', TM.tail)
    oq(g, v(-0.42, floor + 0.55, z), v(0.42, floor + 0.55, z), v(0.42, floor + 0.8, z), v(-0.42, floor + 0.8, z), [0, 0, dir], '#efe3c4', TM.paint, 0.4)
  }
  // 台車（線路に沿って）と床下
  for (const z of [-3.9, 3.9]) {
    g.box([0, slope * z + 0.37, z], [2.0, 0.35, 2.2], '#1f1f20', TM.dark, 0.2)
    for (const s of [1, -1]) for (const dz of [-0.7, 0.7]) g.cylinder([s * 0.62, slope * (z + dz) + 0.32, z + dz], 0.3, 0.12, 10, '#2a2a2c', TM.dark, 0.4, true)
  }
  return g.build()
}

/* -------------------------------------------------------------------------- */
/* 船                                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 船体（平面の形 = 前が尖った輪郭を、喫水 draft から舷 free の高さまで）。L = 長さ、B = 幅。原点 = 船の中心の水面
 */
function hull(g: GeoBuilder, L: number, B: number, draft: number, free: number, colorTop: string, colorBot: string, bowSharp = 0.3) {
  const n = 14
  // 平面の輪郭（右舷、船尾 → 船首）
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const z = -L / 2 + t * L
    const bow = t > 1 - bowSharp ? Math.cos((((t - (1 - bowSharp)) / bowSharp) * Math.PI) / 2) : 1
    const stern = t < 0.08 ? 0.86 + 0.14 * (t / 0.08) : 1
    pts.push([Math.max(0.02, (B / 2) * bow * stern), z])
  }
  const yb = -draft
  const yw = 0.05
  const yt = free
  for (const s of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i]
      const [x1, z1] = pts[i + 1]
      // 平面の外向き（右舷 (dz, -dx)、左舷は x を反転）
      const hx = s * (z1 - z0)
      const hz = -(x1 - x0)
      // 水の下（暗い色）・上の舷
      oq(g, v(s * x0 * 0.82, yb, z0), v(s * x1 * 0.82, yb, z1), v(s * x1, yw, z1), v(s * x0, yw, z0), [hx, -0.3, hz], colorBot, TM.paint, 0.4)
      oq(g, v(s * x0, yw, z0), v(s * x1, yw, z1), v(s * x1, yt, z1), v(s * x0, yt, z0), [hx, 0, hz], colorTop, TM.paint, 0.7)
    }
  }
  // 甲板（上）と船底
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i]
    const [x1, z1] = pts[i + 1]
    oq(g, v(-x0, yt, z0), v(x0, yt, z0), v(x1, yt, z1), v(-x1, yt, z1), [0, 1, 0], '#8b7d68', TM.wood, 0.5)
    oq(g, v(-x0 * 0.82, yb, z0), v(x0 * 0.82, yb, z0), v(x1 * 0.82, yb, z1), v(-x1 * 0.82, yb, z1), [0, -1, 0], colorBot, TM.paint, 0.4)
  }
  // 船尾の板
  const [xs, zs] = pts[0]
  oq(g, v(-xs * 0.82, yb, zs), v(xs * 0.82, yb, zs), v(xs, yt, zs), v(-xs, yt, zs), [0, 0, -1], colorTop, TM.paint, 0.7)
  return pts
}

/** 運河バス（クリームの船体・緑の屋根・木の窓枠・舳先のランタン。定員 40。長さ 15m） */
function waterbus() {
  const g = new GeoBuilder()
  const L = 15
  const B = 3.6
  hull(g, L, B, 0.5, 0.55, '#e8dcc0', '#3f2a22', 0.22)
  // 緑の舷の帯
  g.boxMinMax(-B / 2 - 0.01, 0.42, -L / 2 + 0.4, B / 2 + 0.01, 0.56, L / 2 - 3.2, '#23533d', TM.paint, 0.6)
  // 客室（窓の帯と木の柱）
  const z0 = -L / 2 + 1.2
  const z1 = L / 2 - 3.0
  const hw = 1.55
  const prof = [{ x: hw, y: 0.55, c: '#23533d', m: TM.paint, a: 0.6 }, { x: hw, y: 1.05, c: '#23533d', m: TM.paint, a: 0.6 }]
  extrude(g, prof, z0, z1)
  windowBand(g, hw, 1.05, 2.15, z0, z1, spacedWindows(z0 + 0.15, z1 - 0.15, 0.95, 0.12), '#5c3b22', '#5c3b22', 0.03, 0.03)
  const top = [{ x: hw, y: 2.15, c: '#5c3b22', m: TM.wood, a: 0.5 }, { x: hw, y: 2.25, c: '#1f4f39', m: TM.paint, a: 0.6 }]
  extrude(g, top, z0, z1)
  // 前後の妻面（前は窓）
  for (const dir of [1, -1]) {
    const z = dir > 0 ? z1 : z0
    oq(g, v(-hw, 0.55, z), v(hw, 0.55, z), v(hw, 1.05, z), v(-hw, 1.05, z), [0, 0, dir], '#23533d', TM.paint, 0.6)
    oq(g, v(-hw, 1.05, z), v(hw, 1.05, z), v(hw, 2.25, z), v(-hw, 2.25, z), [0, 0, dir], '#ffffff', TM.glass, dir > 0 ? 2 : 0)
  }
  // 弓なりの緑の屋根（張り出す）
  const rp: { x: number; y: number }[] = []
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2)
    rp.push({ x: (hw + 0.25) * Math.cos(a), y: 2.25 + 0.45 * Math.sin(a) })
  }
  extrude(g, rp.map((p) => ({ ...p, c: '#1d4a36', m: TM.paint, a: 0.6 })), z0 - 0.4, z1 + 0.5)
  cap(g, [{ x: hw + 0.25, y: 2.25 }, ...rp.slice(1)], z1 + 0.5, 1, '#1d4a36', TM.paint, 0.6)
  cap(g, [{ x: hw + 0.25, y: 2.25 }, ...rp.slice(1)], z0 - 0.4, -1, '#1d4a36', TM.paint, 0.6)
  // 舳先のランタン（柱と灯）と、手すり
  g.cylinder([0, 0.55, L / 2 - 1.2], 0.04, 1.2, 6, '#2b2b2b', TM.dark, 0.4, false)
  g.box([0, 1.85, L / 2 - 1.2], [0.24, 0.32, 0.24], '#ffcf8a', TM.lamp, 4)
  for (const s of [1, -1]) g.beam([s * 1.6, 1.25, L / 2 - 3.0], [s * 0.4, 1.25, L / 2 - 0.6], 0.04, '#2b2b2b', TM.dark, 0.5)
  // 船尾の灯（白）と、操舵の小屋の前の行き先
  g.box([0, 2.4, z0 - 0.38], [0.12, 0.12, 0.08], '#ffffff', TM.head)
  oq(g, v(-0.6, 2.3, z1 + 0.505), v(0.6, 2.3, z1 + 0.505), v(0.6, 2.5, z1 + 0.505), v(-0.6, 2.5, z1 + 0.505), [0, 0, 1], '#111', TM.sign, -0.6)
  return g.build()
}

/** 汐見島連絡船（あかり丸・ともしび丸。長さ 32m の白い客船、紺と朱の帯、2 層の客室、マストの灯） */
function ferry() {
  const g = new GeoBuilder()
  const L = 32
  const B = 8
  hull(g, L, B, 1.6, 2.2, '#f1efe8', '#5a2420', 0.3)
  g.boxMinMax(-B / 2 - 0.02, 1.2, -L / 2 + 0.6, B / 2 + 0.02, 1.55, L / 2 - 8, '#22325a', TM.paint, 0.6)
  g.boxMinMax(-B / 2 - 0.02, 1.55, -L / 2 + 0.6, B / 2 + 0.02, 1.7, L / 2 - 8, '#c4402c', TM.paint, 0.6)
  // 1 層目の客室
  const deck = 2.2
  const z0 = -L / 2 + 3
  const z1 = L / 2 - 7
  const hw = 3.4
  extrude(g, [{ x: hw, y: deck, c: '#f4f2ec', m: TM.paint, a: 0.6 }, { x: hw, y: deck + 0.9, c: '#f4f2ec', m: TM.paint, a: 0.6 }], z0, z1)
  windowBand(g, hw, deck + 0.9, deck + 2.1, z0, z1, spacedWindows(z0 + 0.3, z1 - 0.3, 1.5, 0.3), '#f4f2ec', '#2f3436', 0.04, deck / 10)
  extrude(g, [{ x: hw, y: deck + 2.1, c: '#f4f2ec', m: TM.paint, a: 0.6 }, { x: hw, y: deck + 2.6, c: '#f4f2ec', m: TM.paint, a: 0.6 }], z0, z1)
  g.boxMinMax(-hw - 0.3, deck + 2.6, z0 - 1, hw + 0.3, deck + 2.75, z1 + 0.5, '#e4e2dc', TM.paint, 0.5)
  for (const dir of [1, -1]) {
    const z = dir > 0 ? z1 : z0
    oq(g, v(-hw, deck, z), v(hw, deck, z), v(hw, deck + 2.6, z), v(-hw, deck + 2.6, z), [0, 0, dir], '#f4f2ec', TM.paint, 0.6)
    oq(g, v(-hw + 0.4, deck + 0.95, z + dir * 0.01), v(hw - 0.4, deck + 0.95, z + dir * 0.01), v(hw - 0.4, deck + 2.0, z + dir * 0.01), v(-hw + 0.4, deck + 2.0, z + dir * 0.01), [0, 0, dir], '#ffffff', TM.glass, 0)
  }
  // 2 層目（操舵室）
  const d2 = deck + 2.75
  const y0 = z1 - 6
  g.boxMinMax(-2.6, d2, y0, 2.6, d2 + 0.8, z1 - 0.5, '#f4f2ec', TM.paint, 0.6)
  for (const [x0, x1, z, dir] of [
    [-2.6, 2.6, z1 - 0.5, 1],
    [-2.6, 2.6, y0, -1],
  ] as const) oq(g, v(x0 + 0.2, d2 + 0.8, z + dir * 0.01), v(x1 - 0.2, d2 + 0.8, z + dir * 0.01), v(x1 - 0.2, d2 + 1.9, z + dir * 0.01), v(x0 + 0.2, d2 + 1.9, z + dir * 0.01), [0, 0, dir], '#ffffff', TM.glass, 2)
  windowBand(g, 2.6, d2 + 0.8, d2 + 1.9, y0, z1 - 0.5, spacedWindows(y0 + 0.2, z1 - 0.7, 1.1, 0.2), '#f4f2ec', '#2f3436', 0.04, 2)
  g.boxMinMax(-2.9, d2 + 1.9, y0 - 0.3, 2.9, d2 + 2.1, z1 - 0.2, '#e4e2dc', TM.paint, 0.5)
  // 上の甲板の手すりと煙突・マスト
  for (const s of [1, -1]) g.beam([s * (hw + 0.2), deck + 3.7, z0 - 0.8], [s * (hw + 0.2), deck + 3.7, y0 - 0.3], 0.05, '#ffffff', TM.paint, 0.5)
  g.box([0, d2 + 1.4, z0 + 2.0], [1.2, 2.8, 1.8], '#c4402c', TM.paint, 0.6)
  g.box([0, d2 + 2.7, z0 + 2.0], [1.25, 0.25, 1.85], '#1d1e20', TM.dark)
  g.cylinder([0, d2 + 2.1, z1 - 2.5], 0.08, 4.2, 6, '#ffffff', TM.paint, 0.5, true)
  g.box([0, d2 + 6.2, z1 - 2.5], [0.2, 0.2, 0.2], '#ffffff', TM.head)
  // 舷灯（右 緑・左 赤）
  g.box([2.75, d2 + 1.6, z1 - 0.7], [0.12, 0.16, 0.2], '#22ff88', TM.lamp, 5)
  g.box([-2.75, d2 + 1.6, z1 - 0.7], [0.12, 0.16, 0.2], '#ff3322', TM.lamp, 5)
  // 前の甲板の手すり
  for (const s of [1, -1]) g.beam([s * (B / 2 - 0.3), 3.1, z1 + 0.5], [s * 0.6, 3.1, L / 2 - 0.8], 0.05, '#ffffff', TM.paint, 0.5)
  return g.build()
}

/** 港の小舟（kind 0 漁船・1 小さなボート・2 ヨット（マスト）） */
function smallBoat(kind: number) {
  const g = new GeoBuilder()
  if (kind === 0) {
    hull(g, 9, 2.6, 0.5, 0.8, '#f2f0ea', '#2a4c7a', 0.35)
    g.boxMinMax(-0.9, 0.8, -1.8, 0.9, 2.4, 0.2, '#f2f0ea', TM.paint, 0.5)
    oq(g, v(-0.8, 1.6, 0.21), v(0.8, 1.6, 0.21), v(0.8, 2.2, 0.21), v(-0.8, 2.2, 0.21), [0, 0, 1], '#ffffff', TM.glass, 2)
    g.boxMinMax(-1.0, 2.4, -1.9, 1.0, 2.5, 0.3, '#3b5d8a', TM.paint, 0.5)
    g.cylinder([0, 2.5, -0.8], 0.05, 2.6, 6, '#dddddd', TM.metal, 0, true)
    g.box([0, 5.1, -0.8], [0.15, 0.15, 0.15], '#ffffff', TM.head)
  } else if (kind === 1) {
    hull(g, 5.5, 2.0, 0.3, 0.55, '#e9e6dc', '#6a1f1a', 0.4)
    g.boxMinMax(-0.5, 0.55, -1.6, 0.5, 0.9, -1.0, '#3a3a3a', TM.dark, 0.3)
  } else {
    hull(g, 10, 3.2, 0.7, 0.9, '#fbfaf6', '#1d2b45', 0.4)
    g.boxMinMax(-1.0, 0.9, -1.5, 1.0, 1.5, 1.8, '#fbfaf6', TM.paint, 0.6)
    oq(g, v(-0.9, 1.15, 1.81), v(0.9, 1.15, 1.81), v(0.9, 1.4, 1.81), v(-0.9, 1.4, 1.81), [0, 0, 1], '#ffffff', TM.glass, 2)
    g.cylinder([0, 0.9, 1.2], 0.07, 13, 6, '#d8d8d8', TM.metal, 0, true)
    g.beam([0, 2.2, 1.2], [0, 1.9, -3.8], 0.08, '#d8d8d8', TM.metal)
    // たたんだ帆（紺のカバー）
    g.box([0, 2.2, -1.3], [0.35, 0.3, 4.6], '#1d3557', TM.cloth)
    g.box([0, 13.9, 1.2], [0.12, 0.12, 0.12], '#ffffff', TM.head)
  }
  return g.build()
}

/** 北埠頭の貨物船（長さ 90m。動かない） */
function cargoShip() {
  const g = new GeoBuilder()
  const L = 90
  const B = 15
  hull(g, L, B, 4, 6, '#2c4a6e', '#7a2a22', 0.2)
  // コンテナの列
  const cols = ['#b03a2e', '#2f6b9a', '#d9a33a', '#3f7f4f', '#8a8d90', '#c46a2a']
  for (let i = 0; i < 9; i++) {
    for (let k = 0; k < 2; k++) {
      const z = -L / 2 + 22 + i * 6.4
      g.boxMinMax(-6.2, 6 + k * 2.6, z, 6.2, 8.6 + k * 2.6, z + 6.0, cols[(i * 2 + k) % cols.length], TM.paint, 0.3)
    }
  }
  // 船橋（後ろ）
  g.boxMinMax(-6.5, 6, -L / 2 + 4, 6.5, 18, -L / 2 + 14, '#eeeeea', TM.paint, 0.5)
  windowBand(g, 6.5, 15.5, 17.2, -L / 2 + 4, -L / 2 + 14, spacedWindows(-L / 2 + 4.3, -L / 2 + 13.7, 1.6, 0.4), '#eeeeea', '#333', 0.04, 1)
  oq(g, v(-6.2, 15.5, -L / 2 + 14.01), v(6.2, 15.5, -L / 2 + 14.01), v(6.2, 17.2, -L / 2 + 14.01), v(-6.2, 17.2, -L / 2 + 14.01), [0, 0, 1], '#ffffff', TM.glass, 1)
  g.box([0, 21, -L / 2 + 8], [3, 6, 3], '#b03a2e', TM.paint, 0.4)
  g.box([0, 19, -L / 2 + 13], [0.15, 0.15, 0.15], '#ffffff', TM.head)
  return g.build()
}

/** 浮遊機器（配送の浮遊機。直径 0.6m の丸い体と、下の灯） */
function drone() {
  const g = new GeoBuilder()
  const m = new THREE.Matrix4()
  g.lathe(
    [
      [0, -0.18],
      [0.22, -0.15],
      [0.3, -0.02],
      [0.28, 0.1],
      [0.15, 0.2],
      [0, 0.22],
    ],
    12,
    m,
    '#e8ecee',
    TM.paint,
    0.8,
  )
  g.box([0, -0.17, 0], [0.18, 0.04, 0.18], '#bfffe8', TM.lamp, 2)
  g.box([0, 0.05, 0.28], [0.2, 0.06, 0.04], '#ffffff', TM.head)
  return g.build()
}

/* -------------------------------------------------------------------------- */
/* まとめ                                                                       */
/* -------------------------------------------------------------------------- */

export interface VehicleShapes {
  tramCab: THREE.BufferGeometry
  tramMid: THREE.BufferGeometry
  tramGangway: THREE.BufferGeometry
  tramFarCab: THREE.BufferGeometry
  tramFarMid: THREE.BufferGeometry
  trainCab: THREE.BufferGeometry
  trainMid: THREE.BufferGeometry
  trainFar: THREE.BufferGeometry
  cableCar: THREE.BufferGeometry
  waterbus: THREE.BufferGeometry
  ferry: THREE.BufferGeometry
  boats: THREE.BufferGeometry[]
  cargo: THREE.BufferGeometry
  drone: THREE.BufferGeometry
}

let cache: VehicleShapes | null = null

/** 車両と船の形（1 回だけ作る）。cableSlope = ケーブルの線路の勾配（段々の床の傾き） */
export function vehicleShapes(cableSlope = 0.24): VehicleShapes {
  if (cache) return cache
  cache = {
    tramCab: tramSection(true, false),
    tramMid: tramSection(false, true),
    tramGangway: tramGangway(),
    tramFarCab: tramFar(true),
    tramFarMid: tramFar(false),
    trainCab: trainCar(true),
    trainMid: trainCar(false),
    trainFar: trainFar(),
    cableCar: cableCar(cableSlope),
    waterbus: waterbus(),
    ferry: ferry(),
    boats: [0, 1, 2].map(smallBoat),
    cargo: cargoShip(),
    drone: drone(),
  }
  return cache
}
