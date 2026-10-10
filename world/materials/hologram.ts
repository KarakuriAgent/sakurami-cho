import * as THREE from 'three'
import { PALETTE } from '../palette'
import { GLSL_HASH, sharedTime } from './shared'

/**
 * ホログラム用の自作シェーダー。
 * フレネル（輪郭が明るい）+ 走査線 + 流れる光の帯 + ちらつき を加算合成で描く。
 * depthWrite=false なので奥の物体を隠さない。ホロテーブル・浮遊 UI パネル・ガイドなどで使い回す。
 *
 * mapTexture を渡すと Canvas などで描いた UI をホログラムとして表示できる（テクスチャの rgb × color、alpha が不透明度）。
 * three だけの物。R3F の JSX（<hologramMaterial>）で使う登録（extend）は react/labElements.ts（段 4 の 4-2）。
 */

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 localPos = vec4(position, 1.0);
  vec3 localNormal = normal;
  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
    localNormal = mat3(instanceMatrix) * localNormal;
  #endif
  vec4 worldPos = modelMatrix * localPos;
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uOpacity;
uniform float uFresnelPower;
uniform float uFresnelStrength;
uniform float uBase;
uniform float uScanDensity;
uniform float uScanSpeed;
uniform float uFlicker;
uniform float uSweep;
uniform sampler2D uMap;
uniform float uUseMap;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

${GLSL_HASH}

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 n = normalize(vWorldNormal);
  float ndv = clamp(abs(dot(n, viewDir)), 0.0, 1.0);
  float fresnel = pow(clamp(1.0 - ndv, 0.0, 1.0), uFresnelPower);

  // 細かい走査線（ワールド Y 基準なので、パーツ同士で線がそろう）
  float scan = 0.72 + 0.28 * sin(vWorldPos.y * uScanDensity - uTime * uScanSpeed);
  // ゆっくり上へ流れる明るい帯
  float sweep = smoothstep(0.9, 1.0, fract(vWorldPos.y * 0.55 - uTime * 0.22)) * uSweep;
  // ときどき入るちらつき
  float h = hash11(floor(uTime * 18.0));
  float flicker = 1.0 - uFlicker * (0.55 * step(0.93, h) + 0.2 * h);

  vec3 color = uColor;
  float alpha;
  if (uUseMap > 0.5) {
    vec4 tex = texture2D(uMap, vUv);
    color *= tex.rgb;
    alpha = tex.a * (0.8 + 0.2 * scan) + uBase * scan + sweep * tex.a;
  } else {
    alpha = (uBase + uFresnelStrength * fresnel) * scan + sweep;
  }
  alpha *= flicker * uOpacity;

  gl_FragColor = vec4(color * uIntensity, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`

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

export class HologramMaterial extends THREE.ShaderMaterial {
  constructor(params: HologramParameters = {}) {
    super({
      uniforms: {
        uTime: sharedTime,
        uColor: { value: new THREE.Color(params.color ?? PALETTE.cyan) },
        uIntensity: { value: params.intensity ?? 2.2 },
        uOpacity: { value: params.opacity ?? 1 },
        uFresnelPower: { value: params.fresnelPower ?? 2.2 },
        uFresnelStrength: { value: params.fresnelStrength ?? 0.9 },
        uBase: { value: params.base ?? 0.08 },
        uScanDensity: { value: params.scanDensity ?? 160 },
        uScanSpeed: { value: params.scanSpeed ?? 6 },
        uFlicker: { value: params.flicker ?? 0.25 },
        uSweep: { value: params.sweep ?? 0.35 },
        uMap: { value: params.mapTexture ?? null },
        uUseMap: { value: params.mapTexture ? 1 : 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
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
   * 余計な define が付くため別名にしている。
   */
  get mapTexture(): THREE.Texture | null {
    return this.uniforms.uMap.value
  }
  set mapTexture(v: THREE.Texture | null) {
    this.uniforms.uMap.value = v
    this.uniforms.uUseMap.value = v ? 1 : 0
  }
}
