import * as THREE from 'three'
import { GLSL_HASH, sharedTime } from './shared'

/*
 * ラボの効果のシェーダーの素材（流れ・光の筋・ほこり）。three だけの物。
 * どれも three の形の部品（world/lab/parts/flowPipe.ts・world/lab/atmosphere.ts）が直接作る（R3F の JSX の登録は 4-13 で外した）
 */

/* -------------------------------------------------------------------------- */
/* エネルギーの流れ（パイプの中を光のパルスが流れる）                           */
/* -------------------------------------------------------------------------- */

/**
 * TubeGeometry の uv.x（パイプの長さ方向）に沿って光のパルスを流す。
 * 不透明・toneMapped=false で、輝度 1 超えの部分だけ Bloom でにじむ。
 */
export class FlowMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        uTime: sharedTime,
        uColor: { value: new THREE.Color('#3de0ff') },
        uIntensity: { value: 3 },
        uBase: { value: 0.22 },
        /** パルスの個数（パイプ全長あたり） */
        uDensity: { value: 6 },
        /** 流れる速さ（パイプ全長 / 秒 × uDensity） */
        uSpeed: { value: 0.8 },
        uOffset: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uBase;
        uniform float uDensity;
        uniform float uSpeed;
        uniform float uOffset;
        varying vec2 vUv;
        void main() {
          float s = fract(vUv.x * uDensity - uTime * uSpeed + uOffset);
          float pulse = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.12, 0.45, s));
          float v = uBase + pulse * 1.4;
          gl_FragColor = vec4(uColor * uIntensity * v, 1.0);
          #include <colorspace_fragment>
        }
      `,
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

/**
 * 天井照明などから伸びる光の筋。開いた円錐（CylinderGeometry の側面）に貼る。
 * 視線と面の角度で中心ほど濃く、根元（uv.y=1）から先端に向かって薄くなる。加算合成。
 */
export class LightShaftMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        uTime: sharedTime,
        uColor: { value: new THREE.Color('#9fd8ff') },
        uIntensity: { value: 0.12 },
        uFalloff: { value: 1.6 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uFalloff;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        ${GLSL_HASH}
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float facing = abs(dot(normalize(vWorldNormal), viewDir));
          // MSAA では辺のピクセルで varying が範囲外に外挿されることがあるため、pow の底は必ず clamp する
          // （負の底の pow は NaN になり、Bloom で大きな黒いブロックに広がる）
          float core = pow(clamp(facing, 0.0, 1.0), 2.5);
          float along = pow(clamp(vUv.y, 0.0, 1.0), uFalloff);
          // 漂うほこりで光がゆらぐ感じ
          float drift = 0.85 + 0.15 * sin(vWorldPos.y * 3.0 + vWorldPos.x * 2.0 + uTime * 0.6);
          float a = core * along * drift * uIntensity;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }
      `,
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

/**
 * Points 用。頂点属性 aSeed（0〜1）で個体差を付け、時間でゆっくり漂わせる。
 */
export class DustMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        uTime: sharedTime,
        uColor: { value: new THREE.Color('#bfe9ff') },
        uSize: { value: 13 },
        uOpacity: { value: 0.5 },
        uPixelRatio: { value: 1 },
        uBoundsMin: { value: new THREE.Vector3(-8, 0, -6) },
        uBoundsMax: { value: new THREE.Vector3(8, 5, 6) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uSize;
        uniform float uPixelRatio;
        uniform vec3 uBoundsMin;
        uniform vec3 uBoundsMax;
        attribute float aSeed;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float t = uTime * (0.03 + aSeed * 0.05);
          // ゆっくり上昇しながら横に揺れる。範囲外に出たら反対側へ回り込む
          p.y += t * 0.6;
          p.x += sin(uTime * 0.11 + aSeed * 40.0) * 0.35;
          p.z += cos(uTime * 0.09 + aSeed * 23.0) * 0.35;
          vec3 size = uBoundsMax - uBoundsMin;
          p = uBoundsMin + mod(p - uBoundsMin, size);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = uSize * uPixelRatio * (0.35 + aSeed * 0.65) / max(dist, 0.3);
          // 近すぎる粒と遠すぎる粒は薄く
          vAlpha = smoothstep(0.25, 1.2, dist) * (1.0 - smoothstep(9.0, 16.0, dist));
          vAlpha *= 0.55 + 0.45 * sin(uTime * (0.6 + aSeed) + aSeed * 60.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  }
}
