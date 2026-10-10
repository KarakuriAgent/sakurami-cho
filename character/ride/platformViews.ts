import * as THREE from 'three'
import type { Car } from '../../world/outdoor/transit/vehicle'

/**
 * 乗り場で待つ間・乗り降りの途中の、配信の自動カメラの画の候補（src/camera/CameraDirector.tsx の 'platform'。docs/design/town.md §7 の 201）。
 * 前寄りの候補から順に、カメラを置ける・花音が柱・車体・壁に隠れないものを使う（確かめは CameraDirector が camera/spots.ts で）。
 */
export interface PlatformView {
  pos: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

const pool: PlatformView[] = Array.from({ length: 12 }, () => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 }))

/**
 * 待つ間: 花音（足元 feet・向き heading = 線路・水の方）の、乗り場に沿った横（少し線路の側）・斜め後ろ・前（線路・水の上。車両が来れば使えない）
 */
export function waitViews(feet: THREE.Vector3, heading: number, out: PlatformView[]) {
  out.length = 0
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  // 乗り場に沿う向き（花音の右）
  const ax = -fz
  const az = fx
  const head = feet.y + 1.42
  const cands: [number, number, number, number][] = [
    // [沿う向き, 前, 高さ, 画角]
    [3.1, 0.55, 1.5, 44],
    [-3.1, 0.55, 1.5, 44],
    [2.3, -1.3, 1.62, 46],
    [-2.3, -1.3, 1.62, 46],
    [1.2, 2.3, 1.45, 48],
    [-1.2, 2.3, 1.45, 48],
    // 乗り場が狭い・車両が来て止まっている（運河バスの下の段など）: 乗り場の上の近い横と、石段・ホームの上から見下ろす
    [1.9, -0.25, 1.65, 50],
    [-1.9, -0.25, 1.65, 50],
    [1.6, -0.6, 2.5, 52],
    [-1.6, -0.6, 2.5, 52],
  ]
  for (let i = 0; i < cands.length; i++) {
    const [a, f, h, fov] = cands[i]
    const v = pool[i]
    v.pos.set(feet.x + ax * a + fx * f, feet.y + h, feet.z + az * a + fz * f)
    v.target.set(feet.x + fx * 0.15, head - 0.12, feet.z + fz * 0.15)
    v.fov = fov
    out.push(v)
  }
  return out
}

/**
 * 乗り降りの途中: 扉の外（便 car の車室の局所。扉の側 side・扉の真ん中 doorZ・床 floor）の乗り場から、扉を斜めに見る（扉の前後 3m・外へ 1.3m）と、
 * 扉の正面の少し離れた所
 */
export function doorViews(car: Car, side: number, doorZ: number, outX: number, floor: number, out: PlatformView[]) {
  out.length = 0
  const cands: [number, number, number, number][] = [
    // [外への x, 扉からの z, 高さ, 画角]
    [outX + 1.3, 3.0, 1.55, 46],
    [outX + 1.3, -3.0, 1.55, 46],
    [outX + 2.3, 1.6, 1.6, 48],
    [outX + 2.3, -1.6, 1.6, 48],
    [outX + 3.2, 0, 1.6, 44],
    // 乗り場が狭い（運河バスの下の段）: 乗り場の上の近い所と、石段の上から見下ろす
    [outX + 0.55, 2.2, 1.6, 52],
    [outX + 0.55, -2.2, 1.6, 52],
    [outX + 0.8, 2.7, 2.6, 54],
    [outX + 0.8, -2.7, 2.6, 54],
  ]
  for (let i = 0; i < cands.length; i++) {
    const [x, z, h, fov] = cands[i]
    const v = pool[i]
    car.toWorld(side * x, floor + h, doorZ + z, v.pos)
    car.toWorld(side * (outX - 0.9), floor + 1.15, doorZ, v.target)
    v.fov = fov
    out.push(v)
  }
  return out
}
