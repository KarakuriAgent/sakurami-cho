import * as THREE from 'three/webgpu'
import { Fn, If, abs, cameraPosition, clamp, dot, float, floor, fract, normalWorld, normalize, positionWorld, pow, sin, smoothstep, step, texture, uniform, uv, vec3, vec4 } from 'three/tsl'
import { PALETTE } from '../palette'
import { hash11, sharedTime } from './shared'

/**
 * ホログラム用の自作の材質（TSL）。
 * フレネル（輪郭が明るい）+ 走査線 + 流れる光の帯 + ちらつき を加算合成で描く。
 * depthWrite=false なので奥の物体を隠さない。ホロテーブル・浮遊 UI パネル・ガイドなどで使い回す。
 *
 * mapTexture を渡すと Canvas などで描いた UI をホログラムとして表示できる（テクスチャの rgb × color、alpha が不透明度）。
 * three だけの物。R3F の JSX（<hologramMaterial>）で使う登録（extend）は react/labElements.ts（段 4 の 4-2）。
 *
 * WebGPU への移行（第 2 段）: GLSL の ShaderMaterial から NodeMaterial（fragmentNode に前の gl_FragColor と同じ式）へ。
 * インスタンスの行列は three が positionWorld・normalWorld に入れる。値は前と同じく uniforms.<名前>.value と getter / setter で読み書きする
 */

/** mapTexture が無いときに読む 1 画素の白（uUseMap = 0 なので色には効かない） */
const BLANK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
BLANK.needsUpdate = true

export interface HologramParameters {
  color?: THREE.ColorRepresentation
  intensity?: number
  opacity?: number
  fresnelPower?: number
  fresnelStrength?: number
  base?: number
  scanDensity?: number
  scanSpeed?: number
  flicker?: number
  sweep?: number
  mapTexture?: THREE.Texture | null
}

function hologramUniforms(params: HologramParameters) {
  return {
    uTime: sharedTime,
    uColor: uniform(new THREE.Color(params.color ?? PALETTE.cyan)) as unknown as THREE.UniformNode<'vec3', THREE.Color>,
    uIntensity: uniform(params.intensity ?? 2.2),
    uOpacity: uniform(params.opacity ?? 1),
    uFresnelPower: uniform(params.fresnelPower ?? 2.2),
    uFresnelStrength: uniform(params.fresnelStrength ?? 0.9),
    uBase: uniform(params.base ?? 0.08),
    uScanDensity: uniform(params.scanDensity ?? 160),
    uScanSpeed: uniform(params.scanSpeed ?? 6),
    uFlicker: uniform(params.flicker ?? 0.25),
    uSweep: uniform(params.sweep ?? 0.35),
    uMap: texture(params.mapTexture ?? BLANK),
    uUseMap: uniform(params.mapTexture ? 1 : 0),
  }
}

export class HologramMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'HologramMaterial'
  }

  readonly uniforms: ReturnType<typeof hologramUniforms>
  /** 線で描く（WebGPURenderer は NodeMaterial の wireframe を読む。前の ShaderMaterial と同じ口。KB-001 の分解図の内部構造） */
  declare wireframe: boolean

  constructor(params: HologramParameters = {}) {
    super()
    const u = hologramUniforms(params)
    this.uniforms = u
    this.wireframe = false
    this.transparent = true
    this.depthWrite = false
    this.blending = THREE.AdditiveBlending
    this.side = THREE.DoubleSide
    // 両面を 1 回で描く（加算で深さを書かないので、裏と表を描く順で画は変わらない）。WebGPURenderer は両面の透明な物を「全部の裏 → 全部の表」の 2 回に
    // 分けて描き（描く回数が 2 倍）、ほかの透明な物との順も前の WebGL（物ごとに裏 → 表）と違っていた。1 回なら前と同じ順（WebGPU への移行の第 3 段）
    this.forceSinglePass = true
    this.toneMapped = false
    this.fog = false
    this.lights = false
    this.fragmentNode = Fn(() => {
      const viewDir = normalize(cameraPosition.sub(positionWorld))
      const n = normalize(normalWorld)
      const ndv = clamp(abs(dot(n, viewDir)), 0.0, 1.0)
      const fresnel = pow(clamp(ndv.oneMinus(), 0.0, 1.0), u.uFresnelPower)
      const wy = positionWorld.y.toVar()
      // 細かい走査線（ワールド Y 基準なので、パーツ同士で線がそろう）
      const scan = sin(wy.mul(u.uScanDensity).sub(u.uTime.mul(u.uScanSpeed))).mul(0.28).add(0.72).toVar()
      // ゆっくり上へ流れる明るい帯
      const sweep = smoothstep(0.9, 1.0, fract(wy.mul(0.55).sub(u.uTime.mul(0.22)))).mul(u.uSweep).toVar()
      // ときどき入るちらつき
      const h = hash11(floor(u.uTime.mul(18.0))).toVar()
      const flicker = float(1.0).sub(u.uFlicker.mul(step(0.93, h).mul(0.55).add(h.mul(0.2))))
      const color = vec3(u.uColor).toVar()
      const alpha = float(0).toVar()
      If(u.uUseMap.greaterThan(0.5), () => {
        const tex = u.uMap.sample(uv()).toVar()
        color.mulAssign(tex.rgb)
        alpha.assign(tex.a.mul(scan.mul(0.2).add(0.8)).add(u.uBase.mul(scan)).add(sweep.mul(tex.a)))
      }).Else(() => {
        alpha.assign(u.uBase.add(u.uFresnelStrength.mul(fresnel)).mul(scan).add(sweep))
      })
      alpha.mulAssign(flicker.mul(u.uOpacity))
      return vec4(color.mul(u.uIntensity), clamp(alpha, 0.0, 1.0))
    })()
    this.name = 'hologram'
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
  get strength(): number {
    return this.uniforms.uOpacity.value
  }
  /** 全体の濃さ（Material.opacity とは別。フェードイン・アウトに使う） */
  set strength(v: number) {
    this.uniforms.uOpacity.value = v
  }
  get fresnelPower(): number {
    return this.uniforms.uFresnelPower.value
  }
  set fresnelPower(v: number) {
    this.uniforms.uFresnelPower.value = v
  }
  get fresnelStrength(): number {
    return this.uniforms.uFresnelStrength.value
  }
  set fresnelStrength(v: number) {
    this.uniforms.uFresnelStrength.value = v
  }
  get base(): number {
    return this.uniforms.uBase.value
  }
  set base(v: number) {
    this.uniforms.uBase.value = v
  }
  get scanDensity(): number {
    return this.uniforms.uScanDensity.value
  }
  set scanDensity(v: number) {
    this.uniforms.uScanDensity.value = v
  }
  get scanSpeed(): number {
    return this.uniforms.uScanSpeed.value
  }
  set scanSpeed(v: number) {
    this.uniforms.uScanSpeed.value = v
  }
  get flicker(): number {
    return this.uniforms.uFlicker.value
  }
  set flicker(v: number) {
    this.uniforms.uFlicker.value = v
  }
  get sweep(): number {
    return this.uniforms.uSweep.value
  }
  set sweep(v: number) {
    this.uniforms.uSweep.value = v
  }
  /**
   * UI などを描いたテクスチャ。three.js 標準の `map` と名前が衝突すると
   * 余計な処理が付くため別名にしている。無いときは uUseMap = 0（読むのは 1 画素の白）
   */
  get mapTexture(): THREE.Texture | null {
    return this.uniforms.uUseMap.value > 0.5 ? this.uniforms.uMap.value : null
  }
  set mapTexture(v: THREE.Texture | null) {
    this.uniforms.uMap.value = v ?? BLANK
    this.uniforms.uUseMap.value = v ? 1 : 0
  }
}
