import * as THREE from 'three'
import { GLOW } from '../../palette'
import { FlowMaterial } from '../../materials/effects'
import type { LabMaterials } from '../../materials/labMaterials'
import type { Vec3 } from '../../../core/lab/plan'
import { mesh } from './object'
import { instancedMesh } from '../../instancing'

/**
 * エネルギーが流れるパイプを three で作る（docs/design/map-split.md §6 の「段 4」・4-2。案の §3.2）。半透明のガラス管の中を、光のパルスが流れていく。
 * 一定間隔で金属の継ぎ手が付く。前の R3F の FlowPipe（scene/parts/FlowPipe.tsx。使う所が基地局だけだったので 4-6 で消した）と同じ形・素材・
 * 入れ子（群 → 管 → 光の芯 → 継ぎ手）。
 * 入力の値（通信のリンク・明滅・脈）は配信の側を読まず、持ち主の什器の channels を読む（linkColor を付けた時だけ毎コマ効かせる）
 */

/** パイプが読む入力の値（基地局の channels。kanon-lab は streamFx・showFx を読む getter で渡す） */
export interface FlowPipeChannels {
  /** 通信のリンク（0〜1。色を linkColor へ・流れを速く） */
  readonly link: number
  /** 明滅（0〜1） */
  readonly flash: number
  /** 脈（0〜1） */
  readonly pulse: number
  /** リングの加速（0〜1） */
  readonly ringBoost: number
}

export interface FlowPipeOptions {
  points: readonly Vec3[]
  radius?: number
  color: THREE.ColorRepresentation
  /** パルスの間隔（m） */
  spacing?: number
  /** 流れる速さ（m/秒） */
  speed?: number
  intensity?: number
  /** 金属のカラー（継ぎ手）を付ける間隔（m）。0 で付けない */
  collarSpacing?: number
  /**
   * 配信中（通信リンクが確立したとき）に変わる色。指定すると、channels.link に合わせて
   * color からこの色へ変わり、流れも速くなる
   */
  linkColor?: THREE.ColorRepresentation
}

export interface FlowPipe {
  readonly object: THREE.Group
  /** 入力の値を光の芯に効かせる（linkColor が無ければ何もしない） */
  update(): void
  /** 作った形と光の芯の素材・継ぎ手を捨てる（共有の素材（管のガラス・継ぎ手の金属）は捨てない） */
  dispose(): void
}

/** 入力の値が全部 0（channels を渡さないとき） */
const NO_CHANNELS: FlowPipeChannels = { link: 0, flash: 0, pulse: 0, ringBoost: 0 }

/** 管の形（外のガラスの管と、光の芯）。通過点を張り 0.3 の CatmullRom でつなぎ、長さ 1m あたり 30（最低 24）に分ける */
export function flowPipeShape(points: readonly Vec3[], radius: number) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.3,
  )
  const length = curve.getLength()
  const segs = Math.max(24, Math.round(length * 30))
  return {
    curve,
    length,
    sleeve: new THREE.TubeGeometry(curve, segs, radius, 14, false),
    core: new THREE.TubeGeometry(curve, segs, radius * 0.38, 8, false),
  }
}

/** 継ぎ手の数（間隔 0 なら 0、そうでなければ両端を含めて最低 2） */
export function flowCollarCount(length: number, collarSpacing: number): number {
  return collarSpacing > 0 ? Math.max(2, Math.floor(length / collarSpacing) + 1) : 0
}

/** 継ぎ手の形 */
export function flowCollarGeometry(radius: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, radius * 1.1, 16)
}

const _pos = new THREE.Vector3()
const _tan = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _s = new THREE.Vector3(1, 1, 1)

/** 継ぎ手を曲線に沿って等間隔に並べる（管の向きに立てる） */
export function placeFlowCollars(mesh: THREE.InstancedMesh, curve: THREE.Curve<THREE.Vector3>, count: number) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    curve.getPointAt(t, _pos)
    curve.getTangentAt(t, _tan)
    _q.setFromUnitVectors(_up, _tan)
    _m.compose(_pos, _q, _s)
    mesh.setMatrixAt(i, _m)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

/** 入力の値を光の芯に効かせる（色をリンクの色へ寄せ、強さと流れの速さを上げる） */
export function applyFlowChannels(
  flow: FlowMaterial,
  colors: { base: THREE.Color; link: THREE.Color },
  o: { intensity: number; speed: number; spacing: number },
  ch: FlowPipeChannels,
) {
  const k = ch.link
  flow.color.copy(colors.base).lerp(colors.link, k)
  flow.intensity = o.intensity * (1 + k * 0.3 + ch.flash * 1.5 + ch.pulse * 1.2)
  flow.speed = (o.speed / o.spacing) * (1 + k * 1.4 + ch.ringBoost * 2.5)
}

/** エネルギーが流れるパイプ。update を毎コマ呼ぶ（channels は読むたびに見る。写さない） */
export function flowPipe(o: FlowPipeOptions, mats: LabMaterials, channels: FlowPipeChannels = NO_CHANNELS): FlowPipe {
  const radius = o.radius ?? 0.05
  const spacing = o.spacing ?? 0.6
  const speed = o.speed ?? 0.8
  const intensity = o.intensity ?? GLOW.strip
  const collarSpacing = o.collarSpacing ?? 0.5
  const colors = { base: new THREE.Color(o.color), link: new THREE.Color(o.linkColor ?? o.color) }
  const reactive = o.linkColor !== undefined

  const { curve, sleeve, core, length } = flowPipeShape(o.points, radius)
  const flow = new FlowMaterial()
  flow.color.set(o.color)
  flow.intensity = intensity
  flow.density = length / spacing
  flow.speed = speed / spacing

  const object = new THREE.Group()
  object.add(mesh(sleeve, mats.tintedGlass, { order: 2 }))
  object.add(mesh(core, flow))
  const collarCount = flowCollarCount(length, collarSpacing)
  let collars: THREE.InstancedMesh | null = null
  if (collarCount > 0) {
    collars = instancedMesh(flowCollarGeometry(radius), mats.steel, collarCount)
    collars.castShadow = false
    collars.receiveShadow = true
    placeFlowCollars(collars, curve, collarCount)
    object.add(collars)
  }

  return {
    object,
    update() {
      if (!reactive) return
      applyFlowChannels(flow, colors, { intensity, speed, spacing }, channels)
    },
    dispose() {
      sleeve.dispose()
      core.dispose()
      flow.dispose()
      if (collars) {
        collars.geometry.dispose()
        collars.dispose()
      }
    },
  }
}
