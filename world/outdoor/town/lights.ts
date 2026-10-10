import * as THREE from 'three'
import { SITE } from '../../../core/town'
import type { TownTile } from './townData'

/**
 * 夜の灯り（光の点）。街灯・広場・石段の足元灯・港の作業灯・町の外の集落は `pnpm sync:town` が置き（タイルの l_pos・l_col・l_kind）、
 * ケーブルの線路沿い・クレーン・灯台・灯柱の灯りは構造物を組み立てるときに足す（infraMeshes.ts）。
 * 点いている割合は種類ごとに時刻で変わる（world/environment/daylight.ts の表 → Landscape が uOn に入れる）
 */

/** 灯りの種類（tools/town/scatter.mjs の LIGHT と同じ番号。materials.ts の LIGHT_KINDS）。10 浮遊レーンのレーン灯・11 停留所の灯りはアプリが足す（transit/） */
export const LIGHT_KIND = { window: 0, street: 1, port: 2, path: 3, far: 4, cable: 5, aviation: 6, clock: 7, lighthouse: 8, beacon: 9, lane: 10, stop: 11 } as const
export type LightKind = (typeof LIGHT_KIND)[keyof typeof LIGHT_KIND]

export interface LightItem {
  /** 平面座標と標高 */
  x: number
  y: number
  z: number
  kind: LightKind
  color: string
  /** 光の大きさ（m。遠くでは画面の最小の大きさで描く） */
  size: number
  power: number
  /** 点く順番（0〜1。点いている割合がこれより大きいと点く） */
  seed: number
}

/** 灯りの点の形（シーンの座標） */
export function lightsGeometry(tiles: TownTile[], extra: LightItem[], skip?: (x: number, y: number, kind: number) => boolean) {
  let n = extra.length
  for (const t of tiles) n += t.sections.l_pos.array.length / 4
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const size = new Float32Array(n)
  const power = new Float32Array(n)
  const seed = new Float32Array(n)
  const kind = new Float32Array(n)
  const c = new THREE.Color()
  const lab = SITE.labFloorElevation
  let i = 0
  for (const t of tiles) {
    const lp = t.sections.l_pos.array as Float32Array
    const lc = t.sections.l_col.array as Uint8Array
    const lk = t.sections.l_kind.array as Uint8Array
    for (let k = 0; k < lp.length / 4; k++) {
      // 形のある街灯に置き換えた灯り（ラボのまわりの小道）は外す
      if (skip?.(lp[k * 4], lp[k * 4 + 1], lk[k * 2])) continue
      pos.set([lp[k * 4], lp[k * 4 + 2] - lab, -lp[k * 4 + 1]], i * 3)
      // 色は sRGB → リニア
      c.setRGB(lc[k * 4] / 255, lc[k * 4 + 1] / 255, lc[k * 4 + 2] / 255, THREE.SRGBColorSpace)
      col.set([c.r, c.g, c.b], i * 3)
      size[i] = lp[k * 4 + 3]
      power[i] = lc[k * 4 + 3] / 50
      kind[i] = lk[k * 2]
      seed[i] = lk[k * 2 + 1] / 255
      i++
    }
  }
  for (const l of extra) {
    pos.set([l.x, l.z - lab, -l.y], i * 3)
    c.set(l.color)
    col.set([c.r, c.g, c.b], i * 3)
    size[i] = l.size
    power[i] = l.power
    kind[i] = l.kind
    seed[i] = l.seed
    i++
  }
  const g = new THREE.BufferGeometry()
  g.setDrawRange(0, i)
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  g.setAttribute('aPower', new THREE.BufferAttribute(power, 1))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1))
  return g
}
