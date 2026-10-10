import * as THREE from 'three'
import type { Vec3 } from '../../../core/lab/plan'

/**
 * three の物を作る小さな作り手（docs/design/map-split.md §6 の「段 4」・4-2。案の §4.1）。R3F の JSX の
 * `<mesh position rotation scale material castShadow receiveShadow renderOrder>` と同じ値の入れ方をする:
 * 位置・大きさは配列から（fromArray）、回転は XYZ のオイラー角（fromArray）、大きさが数なら 3 つとも同じ（setScalar）。
 * 省いた値は入れない（R3F も undefined の値は入れない）。入れ子と子の順は、使う側が JSX と同じにする（行列と光の並びを変えないため）
 */

export interface PlaceOptions {
  /** 位置（position） */
  p?: Vec3
  /** 回転（rotation。XYZ のオイラー角） */
  r?: Vec3
  /** Y 軸まわりの回転だけ（rotation-y）。r と一緒に使わない */
  ry?: number
  /** 大きさ（scale） */
  s?: Vec3 | number
  name?: string
}

export interface MeshOptions extends PlaceOptions {
  /** castShadow（既定 false。three と R3F の既定） */
  cast?: boolean
  /** receiveShadow（既定 false） */
  receive?: boolean
  /** renderOrder（既定 0） */
  order?: number
}

/** 位置・回転・大きさを入れる */
export function place<T extends THREE.Object3D>(obj: T, o: PlaceOptions): T {
  if (o.name !== undefined) obj.name = o.name
  if (o.p) obj.position.fromArray(o.p)
  if (o.r) obj.rotation.fromArray(o.r)
  if (o.ry !== undefined) obj.rotation.y = o.ry
  if (typeof o.s === 'number') obj.scale.setScalar(o.s)
  else if (o.s) obj.scale.fromArray(o.s)
  return obj
}

/** 形と素材から mesh を作る */
export function mesh<G extends THREE.BufferGeometry, M extends THREE.Material | THREE.Material[]>(
  geometry: G,
  material: M,
  o: MeshOptions = {},
): THREE.Mesh<G, M> {
  const m = place(new THREE.Mesh(geometry, material), o)
  if (o.cast !== undefined) m.castShadow = o.cast
  if (o.receive !== undefined) m.receiveShadow = o.receive
  if (o.order !== undefined) m.renderOrder = o.order
  return m
}

/** 子を順に足した群を作る */
export function group(children: readonly THREE.Object3D[], o: PlaceOptions = {}): THREE.Group {
  const g = place(new THREE.Group(), o)
  for (const c of children) g.add(c)
  return g
}
