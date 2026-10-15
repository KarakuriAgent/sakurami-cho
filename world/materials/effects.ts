import * as THREE from 'three/webgpu'
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  cos,
  dot,
  fract,
  instancedBufferAttribute,
  length,
  max,
  mod,
  modelViewMatrix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from 'three/tsl'
import { sharedTime } from './shared'

/*
 * ラボの効果の素材（流れ・光の筋・ほこり）。three だけの物。
 * どれも three の形の部品（world/lab/parts/flowPipe.ts・world/lab/atmosphere.ts）が直接作る（R3F の JSX の登録は 4-13 で外した）
 *
 * WebGPU への移行（第 2 段）: GLSL の ShaderMaterial から NodeMaterial（fragmentNode に前の gl_FragColor と同じ式）へ。
 * 値は前と同じく uniforms.<名前>.value と getter / setter で読み書きする。ほこりは 1px を超える点なので、Points ではなく
 * Sprite（PointsNodeMaterial）を粒の数だけ並べる（createDust。WebGPU の点は 1px だけ）
 */

/** 色の uniform（値は THREE.Color。シェーダーの中では vec3） */
const colorUniform = (c: THREE.ColorRepresentation) => uniform(new THREE.Color(c)) as unknown as THREE.UniformNode<'vec3', THREE.Color>

/* -------------------------------------------------------------------------- */
/* エネルギーの流れ（パイプの中を光のパルスが流れる）                           */
/* -------------------------------------------------------------------------- */

function flowUniforms() {
  return {
    uTime: sharedTime,
    uColor: colorUniform('#3de0ff'),
    uIntensity: uniform(3),
    uBase: uniform(0.22),
    /** パルスの個数（パイプ全長あたり） */
    uDensity: uniform(6),
    /** 流れる速さ（パイプ全長 / 秒 × uDensity） */
    uSpeed: uniform(0.8),
    uOffset: uniform(0),
  }
}

/**
 * TubeGeometry の uv.x（パイプの長さ方向）に沿って光のパルスを流す。
 * 不透明・toneMapped=false で、輝度 1 超えの部分だけ Bloom でにじむ。
 */
export class FlowMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'FlowMaterial'
  }

  readonly uniforms: ReturnType<typeof flowUniforms>

  constructor() {
    super()
    const u = flowUniforms()
    this.uniforms = u
    this.toneMapped = false
    this.fog = false
    this.lights = false
    this.fragmentNode = Fn(() => {
      const s = fract(uv().x.mul(u.uDensity).sub(u.uTime.mul(u.uSpeed)).add(u.uOffset)).toVar()
      const pulse = smoothstep(0.0, 0.08, s).mul(smoothstep(0.12, 0.45, s).oneMinus())
      const v = u.uBase.add(pulse.mul(1.4))
      return vec4(u.uColor.mul(u.uIntensity).mul(v), 1.0)
    })()
    this.name = 'flow'
  }
  get color(): THREE.Color {
    return this.uniforms.uColor.value
  }
  set color(v: THREE.Color) {
    this.uniforms.uColor.value.copy(v)
  }
  get intensity(): number {
    return this.uniforms.uIntensity.value
  }
  set intensity(v: number) {
    this.uniforms.uIntensity.value = v
  }
  get density(): number {
    return this.uniforms.uDensity.value
  }
  set density(v: number) {
    this.uniforms.uDensity.value = v
  }
  get speed(): number {
    return this.uniforms.uSpeed.value
  }
  set speed(v: number) {
    this.uniforms.uSpeed.value = v
  }
  get offset(): number {
    return this.uniforms.uOffset.value
  }
  set offset(v: number) {
    this.uniforms.uOffset.value = v
  }
  get base(): number {
    return this.uniforms.uBase.value
  }
  set base(v: number) {
    this.uniforms.uBase.value = v
  }
}

/* -------------------------------------------------------------------------- */
/* 光の筋（ボリュメトリック風のコーン）                                        */
/* -------------------------------------------------------------------------- */

function shaftUniforms() {
  return {
    uTime: sharedTime,
    uColor: colorUniform('#9fd8ff'),
    uIntensity: uniform(0.12),
    uFalloff: uniform(1.6),
  }
}

/**
 * 天井照明などから伸びる光の筋。開いた円錐（CylinderGeometry の側面）に貼る。
 * 視線と面の角度で中心ほど濃く、根元（uv.y=1）から先端に向かって薄くなる。加算合成。
 */
export class LightShaftMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'LightShaftMaterial'
  }

  readonly uniforms: ReturnType<typeof shaftUniforms>

  constructor() {
    super()
    const u = shaftUniforms()
    this.uniforms = u
    this.transparent = true
    this.depthWrite = false
    this.blending = THREE.AdditiveBlending
    this.side = THREE.DoubleSide
    this.toneMapped = false
    this.fog = false
    this.lights = false
    this.fragmentNode = Fn(() => {
      const wp = positionWorld.toVar()
      const viewDir = normalize(cameraPosition.sub(wp))
      const facing = abs(dot(normalize(normalWorld), viewDir))
      // 辺の画素で補間した値が範囲の外へ出ることがあるため、pow の底は必ず clamp する（負の底の pow は NaN になり、Bloom で大きな黒いブロックに広がる）
      const core = pow(clamp(facing, 0.0, 1.0), 2.5)
      const along = pow(clamp(uv().y, 0.0, 1.0), u.uFalloff)
      // 漂うほこりで光がゆらぐ感じ
      const drift = sin(wp.y.mul(3.0).add(wp.x.mul(2.0)).add(u.uTime.mul(0.6))).mul(0.15).add(0.85)
      const a = core.mul(along).mul(drift).mul(u.uIntensity)
      return vec4(u.uColor, a)
    })()
    this.name = 'lightShaft'
  }
  get color(): THREE.Color {
    return this.uniforms.uColor.value
  }
  set color(v: THREE.Color) {
    this.uniforms.uColor.value.copy(v)
  }
  get intensity(): number {
    return this.uniforms.uIntensity.value
  }
  set intensity(v: number) {
    this.uniforms.uIntensity.value = v
  }
  get falloff(): number {
    return this.uniforms.uFalloff.value
  }
  set falloff(v: number) {
    this.uniforms.uFalloff.value = v
  }
}

/* -------------------------------------------------------------------------- */
/* 空中を舞うほこり                                                             */
/* -------------------------------------------------------------------------- */

function dustUniforms() {
  return {
    uTime: sharedTime,
    uColor: colorUniform('#bfe9ff'),
    uSize: uniform(13),
    uOpacity: uniform(0.5),
    uPixelRatio: uniform(1),
    uBoundsMin: uniform(new THREE.Vector3(-8, 0, -6)),
    uBoundsMax: uniform(new THREE.Vector3(8, 5, 6)),
  }
}

/** ほこりの粒ごとの値（位置と 0〜1 の種）。ほこりの Sprite（count 個）が読む */
export interface DustAttributes {
  position: THREE.InstancedBufferAttribute
  seed: THREE.InstancedBufferAttribute
}

/**
 * ほこりの粒（Sprite を粒の数だけ並べる。createDust）。粒ごとの種 aSeed（0〜1）で個体差を付け、時間でゆっくり漂わせる。
 * 大きさは前の gl_PointSize と同じ（前は uSize × uPixelRatio × … の描画の画素。sizeNode は CSS の px で、three が描画の画素の比を掛けるので
 * uPixelRatio は掛けない。uPixelRatio は前の書き方のために残すが、式では使わない）
 */
export class DustMaterial extends THREE.PointsNodeMaterial {
  static get type() {
    return 'DustMaterial'
  }

  readonly uniforms: ReturnType<typeof dustUniforms>

  constructor(a: DustAttributes) {
    super()
    const u = dustUniforms()
    this.uniforms = u
    this.transparent = true
    this.depthWrite = false
    this.blending = THREE.AdditiveBlending
    this.toneMapped = false
    this.fog = false
    this.sizeAttenuation = false
    const position = instancedBufferAttribute(a.position, 'vec3' as const)
    const aSeed = instancedBufferAttribute(a.seed, 'float' as const)
    const t = u.uTime.mul(aSeed.mul(0.05).add(0.03))
    // ゆっくり上昇しながら横に揺れる。範囲外に出たら反対側へ回り込む
    const moved = position.add(vec3(sin(u.uTime.mul(0.11).add(aSeed.mul(40.0))).mul(0.35), t.mul(0.6), cos(u.uTime.mul(0.09).add(aSeed.mul(23.0))).mul(0.35)))
    const size = u.uBoundsMax.sub(u.uBoundsMin)
    const p = u.uBoundsMin.add(mod(moved.sub(u.uBoundsMin), size)).toVar()
    this.positionNode = p
    const mv = modelViewMatrix.mul(vec4(p, 1.0))
    const dist = mv.z.negate().toVar()
    // 前の gl_PointSize を CSS の px で（three が描画の画素の比を掛ける）
    this.sizeNode = u.uSize.mul(aSeed.mul(0.65).add(0.35)).div(max(dist, 0.3))
    // 近すぎる粒と遠すぎる粒は薄く
    const alpha = smoothstep(0.25, 1.2, dist)
      .mul(smoothstep(9.0, 16.0, dist).oneMinus())
      .mul(sin(u.uTime.mul(aSeed.add(0.6)).add(aSeed.mul(60.0))).mul(0.45).add(0.55))
    const vAlpha = varying(alpha)
    this.colorNode = Fn(() => {
      const c = uv().sub(0.5)
      const d = length(c)
      const a0 = smoothstep(0.0, 0.5, d).oneMinus()
      return vec4(u.uColor, a0.mul(a0).mul(vAlpha).mul(u.uOpacity))
    })()
    this.name = 'dust'
  }
}

/**
 * ほこり（Sprite を粒の数だけ並べた物）。position（vec3）と seed（float）は粒ごとの値。
 * Sprite の形（板 1 枚）は three の Sprite が共有する物なので、捨てない（材質だけ捨てる）
 */
export function createDust(position: Float32Array, seed: Float32Array) {
  const material = new DustMaterial({ position: new THREE.InstancedBufferAttribute(position, 3), seed: new THREE.InstancedBufferAttribute(seed, 1) })
  const sprite = new THREE.Sprite(material)
  sprite.count = seed.length
  return sprite as THREE.Sprite & { material: DustMaterial }
}
