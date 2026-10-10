import * as THREE from 'three'
import type { Vec3 } from '../../../core/lab/plan'
import { mesh } from './object'

/**
 * 通過点を指定して引き回すケーブル・パイプを three で作る（docs/design/map-split.md §6 の「段 4」・4-2）。
 * 前の R3F の Cable（scene/parts/Cable.tsx。最後の使う所の KB-001 のドックがキットになったので 4-11 で消した）と同じ形
 */

export interface CableOptions {
  /** 通過点（CatmullRom でなめらかにつなぐ） */
  points: readonly Vec3[]
  radius?: number
  material: THREE.Material
  /** 長さ方向の分割数（省略時は通過点の数から決める） */
  segments?: number
  radialSegments?: number
  /** 既定 false（影は受ける） */
  castShadow?: boolean
}

/** ケーブルの形（通過点を張り 0.35 の CatmullRom でつないだ管） */
export function cableGeometry(points: readonly Vec3[], radius = 0.02, segments?: number, radialSegments = 10): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.35,
  )
  return new THREE.TubeGeometry(curve, segments ?? points.length * 14, radius, radialSegments, false)
}

/** 通過点を指定して引き回すケーブル・パイプ（影を受ける） */
export function cable(o: CableOptions): THREE.Mesh {
  return mesh(cableGeometry(o.points, o.radius, o.segments, o.radialSegments), o.material, { cast: o.castShadow ?? false, receive: true })
}
