import * as THREE from 'three'
import { RectAreaLightNode } from 'three/webgpu'
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js'
import { labLight } from '../../labLight'
import type { Vec3 } from '../../../core/lab/plan'

/**
 * ラボの光の作り手（docs/design/map-split.md §6 の「段 4」・4-3）。前の Lighting.tsx の Spot・Point・AreaLight・Hemi と同じ値の入れ方。
 * 使う側の差し込み口の光（kanon-lab の配信の立ち位置のキー・フィル・リム）も、これで作る。
 */

// 面光源（RectAreaLight）を WebGPU（RectAreaLightNode）で使うための初期化（1 回だけ。前は WebGL の RectAreaLightUniformsLib.init()）
RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init())

/**
 * 部屋の照明の明るさ（labLight.value）から、光の倍率を求める。dim は配信中に部屋の照明と一緒に落とす割合
 * （明るさ = intensity × dim くらい）。省略すると落とさない（1）
 */
export function lightFactor(dim: number | undefined) {
  const room = labLight.value
  const k = dim === undefined ? 1 : dim + (1 - dim) * room
  return k
}

export interface LabSpotOptions {
  at: Vec3 | readonly [number, number, number]
  to: Vec3 | readonly [number, number, number]
  color: THREE.ColorRepresentation
  intensity: number
  angle: number
  /** 既定 0.7 */
  penumbra?: number
  /** 既定 12 */
  distance?: number
  /** 影を落とす（quality が high のときだけ） */
  castShadow?: boolean
  /** 影の地図の大きさ（既定 1024） */
  shadowMapSize?: number
}

/** 照らす先付きのスポット（target は光の後に、同じ親へ足すこと。場面の木に無いと target の行列が更新されない） */
export function labSpot(o: LabSpotOptions, quality: 'high' | 'low'): THREE.SpotLight {
  const { penumbra = 0.7, distance = 12, castShadow = false, shadowMapSize = 1024 } = o
  const l = new THREE.SpotLight(o.color, o.intensity, distance, o.angle, penumbra, 2)
  l.position.set(...(o.at as Vec3))
  l.target.position.set(...(o.to as Vec3))
  l.castShadow = castShadow && quality === 'high'
  l.shadow.mapSize.set(shadowMapSize, shadowMapSize)
  l.shadow.bias = -0.0004
  l.shadow.normalBias = 0.02
  l.shadow.camera.near = 0.5
  l.shadow.camera.far = distance
  return l
}

/** 点光源 */
export function labPoint(o: { at: Vec3 | readonly [number, number, number]; color: THREE.ColorRepresentation; intensity: number; distance: number }): THREE.PointLight {
  const l = new THREE.PointLight(o.color, o.intensity, o.distance, 2)
  l.position.set(...(o.at as Vec3))
  return l
}

/** 面光源（to の方を向ける） */
export function labArea(o: { at: Vec3; to: Vec3; width: number; height: number; color: THREE.ColorRepresentation; intensity: number }): THREE.RectAreaLight {
  const l = new THREE.RectAreaLight(o.color, o.intensity, o.width, o.height)
  l.position.set(...o.at)
  l.lookAt(...o.to)
  return l
}
