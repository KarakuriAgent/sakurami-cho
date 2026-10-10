import * as THREE from 'three'
import { SITE } from '../../../core/town'
import { naturalHeight } from './heights'
import { gradeElevation } from '../site/siteModel'
import { namedGrade } from '../named/grade'
import { stairGrade } from '../../../core/walk/stairGrade'

/**
 * 地形の格子（ラボを中心にした放射状の格子。窓から見る町の地面は、ラボからの距離が遠いほど画面の上で縦に縮むので、
 * 半径の刻みは距離の 2 乗で広げ、方位の刻みは帯ごとに細かくする。帯の境は三角形でつなぐので、すき間はできない）。
 *
 * 標高は高さ画像（中心 1m/画素・全体 5m/画素）。全体の範囲の外は、端の標高を少しずつ下げながら伸ばす（陸は丘のまま遠くへ、海は海のまま）。
 * 北側（窓から見えない方角）はラボのまわりだけ。法線は高さ画像から（格子より細かい起伏の陰影）。
 * 段階 3 でラボの外を歩くときは、中心をカメラの近くに置き直して作り直せばよい（center）。
 */

export interface TerrainBand {
  /** この帯の外側の半径（m） */
  rMax: number
  /** 方位の刻み（度）。前の帯のちょうど半分か同じにする */
  step: number
  /** 方位の範囲（度、北から時計回り。終わりは 360 を越えてよい）。null は全周 */
  sector: [number, number] | null
  /** 半径の刻みの最小（m。無ければ TerrainOptions の minStep） */
  minStep?: number
}

export interface TerrainOptions {
  /** ラボのまわりの全周の帯（内から） */
  inner: TerrainBand[]
  /** その外を方角ごとに分けた帯の並び（それぞれ inner の最後の輪から続ける） */
  chains: TerrainBand[][]
  /** 半径の刻み = clamp(k × r², minStep, maxStep) */
  k: number
  minStep: number
  maxStep: number
  center?: [number, number]
}

/**
 * 画質ごとの帯（bearingStep = 遠くの帯の方位の刻み）。窓から見える南の方角（55°〜305°）は細かく、
 * 北の方角は粗く（窓からは見えない。撮影で外から撮るときに穴にならないように）
 */
export function terrainOptions(bearingStep: number, radius: number, center: [number, number] = [0, 0]): TerrainOptions {
  const s = bearingStep
  if (Math.hypot(center[0], center[1]) > 200) {
    // ラボから離れた所（撮影で窓の外から撮るとき）: 全周を同じ細かさで
    return {
      inner: [
        { rMax: 40, step: s * 8, sector: null },
        { rMax: 160, step: s * 4, sector: null },
      ],
      chains: [
        [
          { rMax: 900, step: s * 2, sector: null },
          { rMax: radius, step: s * 2, sector: null },
        ],
      ],
      k: 5e-5,
      minStep: 1.1,
      maxStep: 260,
      center,
    }
  }
  // ラボのまわり（ラボの前のセットと、歩いて行ける見晴らし台・大パラボラ）は細かく: 半径 0.4〜0.7m・方位 1°〜0.5°（high）。
  // 北の方角の帯は、ラボのまわりの帯と同じ刻みから続ける（粗い方へは扇形でつなげないため）
  return {
    inner: [
      { rMax: 12, step: s * 8, sector: null, minStep: 0.4 },
      { rMax: 60, step: s * 4, sector: null, minStep: 0.4 },
      { rMax: 125, step: s * 2, sector: null, minStep: 0.7 },
      { rMax: 160, step: s * 2, sector: null },
    ],
    chains: [
      [
        { rMax: 700, step: s * 2, sector: [55, 305] },
        { rMax: radius, step: s, sector: [55, 305] },
      ],
      [{ rMax: radius, step: s * 2, sector: [305, 415] }],
    ],
    k: 5e-5,
    minStep: 1.1,
    maxStep: 260,
  }
}

const LAB = SITE.labFloorElevation

/**
 * 地形の標高（m）。全体の範囲の外は端の値から、離れるほど下げる（陸は 8km で半分ほどに、海底はそのまま）。
 * ラボのまわりは、ラボの前のセット（テラス・石段・スロープ・小道・見晴らし台）に合わせて均す（site/siteModel.ts の gradeElevation）。
 * 名前のある建物の入口の前は、床より下まで均す（named/grade.ts）
 */
export function terrainHeight(x: number, y: number) {
  return stairGrade(x, y, terrainBaseHeight(x, y))
}

/** 町の石段の下を下げる前の標高（m。石段のわきの擁壁の高さ town/townStairsMesh.ts が使う） */
export function terrainBaseHeight(x: number, y: number) {
  return namedGrade(x, y, gradeElevation(x, y, naturalHeight(x, y)))
}

/** 格子を作る（頂点はシーンの座標。法線つき） */
export function buildTerrainGeometry(opt: TerrainOptions) {
  const g = terrainGeometrySteps(opt)
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
  }
}

/**
 * 格子を作る手順（輪を 1 つ作るごとに yield する。町の中を歩く間は、1 コマに数 ms ずつ進めて作る（landscape.ts）。§7 の 152）。
 * 最後に形を返す
 */
export function* terrainGeometrySteps(opt: TerrainOptions): Generator<void, THREE.BufferGeometry> {
  const [cx, cy] = opt.center ?? [0, 0]
  const pos: number[] = []
  const nrm: number[] = []
  const idx: number[] = []
  const add = (x: number, y: number, spacing: number) => {
    const h = terrainHeight(x, y)
    pos.push(x, h - LAB, -y)
    // 法線: 高さ画像の差分（格子の刻みと同じくらいの幅で）
    const e = Math.max(1, spacing * 0.5)
    const hx = (terrainHeight(x + e, y) - terrainHeight(x - e, y)) / (2 * e)
    const hy = (terrainHeight(x, y + e) - terrainHeight(x, y - e)) / (2 * e)
    const l = Math.hypot(hx, 1, hy)
    nrm.push(-hx / l, 1 / l, hy / l)
    return pos.length / 3 - 1
  }
  // 方位の範囲の端は、いちばん粗い帯の刻みの倍数にそろえる（帯の境で方位が重なるように）
  const coarse = opt.inner[0].step
  const bearingsOf = (band: TerrainBand) => {
    const out: number[] = []
    if (!band.sector) for (let i = 0; i * band.step < 360 - 1e-6; i++) out.push(i * band.step)
    else {
      const start = Math.ceil(band.sector[0] / coarse - 1e-9) * coarse
      const end = Math.floor(band.sector[1] / coarse + 1e-9) * coarse
      for (let i = 0; start + i * band.step <= end + 1e-6; i++) out.push(start + i * band.step)
    }
    return out
  }
  const key = (b: number) => (((b % 360) + 360) % 360).toFixed(4)
  const ring = (r: number, bearings: number[], spacing: number) =>
    bearings.map((b) => {
      const a = (b * Math.PI) / 180
      return add(cx + Math.sin(a) * r, cy + Math.cos(a) * r, spacing)
    })
  /** となりあう 2 つの輪（同じ方位の数）を四角形でつなぐ */
  const strip = (inner: number[], outer: number[], wrap: boolean) => {
    const n = inner.length
    for (let i = 0; i < (wrap ? n : n - 1); i++) {
      const j = (i + 1) % n
      // 方位は上から見て時計回りに増えるので、表が上を向くよう（上から見て反時計回り）内 i → 内 j → 外 i の順
      idx.push(inner[i], inner[j], outer[i], inner[j], outer[j], outer[i])
    }
  }
  const stepAt = (r: number, band?: TerrainBand) => Math.min(opt.maxStep, Math.max(band?.minStep ?? opt.minStep, opt.k * r * r))
  interface State {
    r: number
    ring: number[]
    band: TerrainBand
    bearings: number[]
  }
  /** 帯の並びを state の輪から外へ続ける */
  const run = function* (bands: TerrainBand[], start: State | null): Generator<void, State> {
    let st = start
    for (const band of bands) {
      const bearings = bearingsOf(band)
      const wrap = !band.sector
      let r: number
      let prev: number[]
      if (st) {
        // 帯の境: 前の帯の輪から、方位が 2 倍の輪へ扇形でつなぐ（同じ刻みなら共通の方位をそのまま）
        r = st.r + stepAt(st.r, band)
        const next = ring(r, bearings, stepAt(r, band))
        const map = new Map(st.bearings.map((b, i) => [key(b), st!.ring[i]]))
        if (Math.abs(st.band.step - band.step) < 1e-9) {
          const inner = bearings.map((b) => map.get(key(b)) ?? -1)
          for (let i = 0; i < bearings.length - (wrap ? 0 : 1); i++) {
            const j = (i + 1) % bearings.length
            if (inner[i] < 0 || inner[j] < 0) continue
            idx.push(inner[i], inner[j], next[i], inner[j], next[j], next[i])
          }
        } else {
          for (let i = 0; i + 2 < bearings.length || (wrap && i < bearings.length); i += 2) {
            const a = map.get(key(bearings[i]))
            const b = map.get(key(bearings[(i + 2) % bearings.length]))
            if (a === undefined || b === undefined) continue
            const o0 = next[i]
            const o1 = next[(i + 1) % bearings.length]
            const o2 = next[(i + 2) % bearings.length]
            idx.push(a, o1, o0, a, b, o1, b, o2, o1)
          }
        }
        prev = next
      } else {
        r = 0.6
        prev = ring(r, bearings, stepAt(r, band))
      }
      while (r < band.rMax) {
        r = Math.min(band.rMax, r + stepAt(r, band))
        const next = ring(r, bearings, stepAt(r, band))
        strip(prev, next, wrap)
        prev = next
        yield
      }
      st = { r, ring: prev, band, bearings }
    }
    return st!
  }
  const innerState = yield* run(opt.inner, null)
  for (const chain of opt.chains) yield* run(chain, innerState)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}
