import * as THREE from 'three'
import { SITE } from '../../../core/town'
import { COMMON, TONE, outdoorUniforms } from '../materials'
import { TOWN_LIGHT } from './facades'
import { TOWN_SHADOW, townShadowUniforms } from './shadows'
import { TOWN_LAMPS, lampUniforms } from './lamps'
import { GROUND, groundUniforms } from './townMaterials'

/**
 * 草むら（地面の近くの草の葉。インスタンス、風で揺れる、カメラの近くだけ）。
 *
 * - 草の株（葉 5〜7 枚の形）を、カメラのまわりの世界の格子（近く 0.32m・遠く 0.75m ごと）に 1 株ずつ置く。格子の升ごとの乱数で
 *   位置・向き・大きさを決めるので、カメラが動いても株は動かない（ちらつかない）。株の位置は頂点のシェーダーが決める（CPU は毎コマ何もしない）
 * - 生える所: 地面の補助の画像（植生が多い・舗装でない・水でない）と、CPU で作る小さな高さの画像（1m ごと・96m 四方。高さと、
 *   ラボのセット・小道・中のある建物の中など草を置かない所の印）。カメラが 16m 動いたら作り直す
 * - 色は地面の画像の色（芝の色と合う）に、根元を暗く・先を明るく黄色く。逆光で透ける。町の影と夜の灯りを受ける
 * - 遠い株ほど間引き、半径の縁で小さくして消す
 */

const LAB = SITE.labFloorElevation
/** 高さの画像の升の数（一辺）と升の大きさ（m） */
const HN = 96
const HCELL = 1

interface Ring {
  spacing: number
  radius: number
  blades: number
  scale: number
}

/** 草の株の形（葉の枚数・高さの目安。原点は根元、y が上（0〜1 の割合を aH に）） */
function tuftGeometry(blades: number, seed: number) {
  let s = seed
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  const pos: number[] = []
  const nrm: number[] = []
  const hh: number[] = []
  const idx: number[] = []
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2
    const r = rnd() * 0.12
    const bx = Math.cos(a) * r
    const bz = Math.sin(a) * r
    const yaw = rnd() * Math.PI * 2
    const lean = 0.15 + rnd() * 0.45
    const h = 0.12 + rnd() * 0.2
    const w = 0.012 + rnd() * 0.01
    const ux = Math.cos(yaw)
    const uz = Math.sin(yaw)
    // 葉は横の向き (ux, uz)、前へ倒れる向きは (-uz, ux)
    const fx = -uz
    const fz = ux
    const base = pos.length / 3
    const seg = 3
    for (let k = 0; k <= seg; k++) {
      const t = k / seg
      const wk = w * (1 - t * 0.92)
      const bend = lean * t * t * h
      const cx = bx + fx * bend
      const cz = bz + fz * bend
      const y = h * t * (1 - 0.15 * lean * t)
      for (const sd of [-1, 1]) {
        pos.push(cx + ux * wk * sd, y, cz + uz * wk * sd)
        // 法線: 葉の面の向き（倒れる向き）と上をまぜる
        nrm.push(fx * 0.6, 0.8, fz * 0.6)
        hh.push(t)
      }
      if (k > 0) {
        const i = base + (k - 1) * 2
        idx.push(i, i + 1, i + 3, i, i + 3, i + 2)
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1))
  g.setIndex(idx)
  return g
}

const VERTEX = /* glsl */ `
  ${GROUND}
  attribute float aH;
  uniform vec3 uGrassCam;
  uniform float uSpacing;
  uniform float uRadius;
  uniform float uScale;
  uniform float uGridN;
  uniform float uThin;
  uniform sampler2D uHeight;
  uniform vec4 uHInfo;
  uniform float uTime;
  uniform float uWind;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vH;
  float gHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    // 格子の升（カメラの近くの升から順に、インスタンスの番号で）
    float n = uGridN;
    float id = float(gl_InstanceID);
    vec2 cellBase = floor(uGrassCam.xz / uSpacing);
    vec2 cell = cellBase + vec2(mod(id, n), floor(id / n)) - floor(n * 0.5);
    float h1 = gHash(cell);
    float h2 = gHash(cell + 17.31);
    float h3 = gHash(cell + 51.7);
    vec2 xz = (cell + vec2(h1, h2) * 0.9 + 0.05) * uSpacing;
    float dist = length(xz - uGrassCam.xz);
    // 遠いほど間引く・縁で小さく
    float keep = step(h3, 1.0 - uThin * smoothstep(uRadius * 0.35, uRadius, dist));
    float edge = 1.0 - smoothstep(uRadius * 0.8, uRadius, dist);
    // 地面の補助の画像: 植生・舗装・水
    vec2 plan = vec2(xz.x, -xz.y);
    vec4 g;
    vec4 aux;
    sampleGround(plan, g, aux);
    float grassy = smoothstep(0.38, 0.6, aux.g) * (1.0 - smoothstep(0.3, 0.5, aux.b)) * step(0.5, aux.a) * step(0.5, g.a);
    // 高さの画像（CPU）: r = 高さ（シーンの y）、g = 置いてよいか
    vec2 huv = (xz - uHInfo.xy) / (uHInfo.z * ${HN}.0);
    vec4 hv = texture2D(uHeight, huv);
    float inside = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
    float s = keep * edge * grassy * inside * smoothstep(0.5, 0.9, hv.g) * uScale * (0.65 + 0.7 * gHash(cell + 3.3));
    if (s < 0.05) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      return;
    }
    float yaw = h1 * 6.2831853;
    float c = cos(yaw);
    float sn = sin(yaw);
    vec3 p = position * s;
    p.xz = vec2(c * p.x - sn * p.z, sn * p.x + c * p.z);
    // 風: 上ほど大きく、株ごとに位相をずらし、ゆっくりした大きな波と小刻みな震え
    float wave = sin(dot(xz, vec2(0.21, 0.17)) - uTime * 1.6) * 0.6 + sin(uTime * 4.3 + h2 * 20.0) * 0.18;
    float bendAmt = aH * aH * s * 0.22 * uWind * (0.6 + 0.4 * wave);
    p.x += bendAmt * 0.8;
    p.z += bendAmt * 0.45;
    vec3 wp = vec3(xz.x, hv.r + uHInfo.w - 0.03, xz.y) + p;
    vWorld = wp;
    vec3 nn = normal;
    nn.xz = vec2(c * nn.x - sn * nn.z, sn * nn.x + c * nn.z);
    vNormal = normalize(nn);
    // 地面の画像の色（テクスチャは sRGB なので読んだ値はリニア）を株ごとにばらつかせる
    vec3 base = g.rgb;
    vColor = base * (0.85 + 0.35 * h3) * mix(vec3(1.0), vec3(1.08, 1.05, 0.8), gHash(cell + 9.1) * 0.6);
    vH = aH;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  ${COMMON}
  ${TOWN_LIGHT}
  ${TOWN_SHADOW}
  ${TOWN_LAMPS}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vH;
  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = vec3(-N.x, N.y, -N.z);
    vec3 V = normalize(cameraPosition - vWorld);
    // 根元は暗く（株の中の陰）、先は明るく少し黄色く
    vec3 albedo = vColor * mix(0.45, 1.25, vH) * mix(vec3(1.0), vec3(1.15, 1.08, 0.75), vH * vH * 0.5);
    float sh = mix(0.25, 1.0, townShadow(vWorld, vec3(0.0, 1.0, 0.0)));
    float ao = mix(0.5, 1.0, vH);
    vec3 col = townLight(albedo, N, ao, sh) + albedo * uSkyLight * 0.25 * ao;
    // 逆光で透ける
    col += albedo * uSunLight * pow(max(dot(-V, uSunDir), 0.0), 4.0) * 0.8 * sh * vH;
    col += albedo * townLampsEx(vWorld, N, 0.0, 0.5) * ao;
    col = outdoorHaze(col, vWorld);
    gl_FragColor = vec4(col, 1.0);
    ${TONE}
  }
`

export interface GrassOptions {
  radius: number
  /** その点に草を置いてよいか（平面座標）・地面の高さ */
  allowed: (x: number, y: number) => boolean
  heightAt: (x: number, y: number) => number
}

export class Grass {
  readonly group = new THREE.Group()
  private tex: THREE.DataTexture
  private data: Uint16Array
  private info = new THREE.Vector4(0, 0, HCELL, 0)
  private last = new THREE.Vector2(1e9, 1e9)
  private mats: THREE.ShaderMaterial[] = []
  private opt: GrassOptions

  constructor(opt: GrassOptions, layer: number) {
    this.opt = opt
    this.data = new Uint16Array(HN * HN * 4)
    this.tex = new THREE.DataTexture(this.data, HN, HN, THREE.RGBAFormat, THREE.HalfFloatType)
    this.tex.minFilter = THREE.LinearFilter
    this.tex.magFilter = THREE.LinearFilter
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping
    this.tex.needsUpdate = true
    this.group.name = 'grass'
    if (opt.radius <= 0) return
    const r = opt.radius
    const rings: Ring[] = [
      { spacing: 0.26, radius: Math.min(12, r), blades: 7, scale: 1 },
      { spacing: 0.6, radius: r, blades: 6, scale: 1.25 },
    ]
    rings.forEach((ring, i) => {
      const n = Math.ceil((ring.radius * 2) / ring.spacing)
      const geo = tuftGeometry(ring.blades, 1234 + i * 77)
      geo.instanceCount = n * n
      const mat = new THREE.ShaderMaterial({
        name: `townGrass${i}`,
        side: THREE.DoubleSide,
        uniforms: {
          ...outdoorUniforms,
          ...groundUniforms,
          ...townShadowUniforms,
          ...lampUniforms,
          uGrassCam: { value: new THREE.Vector3() },
          uSpacing: { value: ring.spacing },
          uRadius: { value: ring.radius },
          uScale: { value: ring.scale },
          uGridN: { value: n },
          uThin: { value: i === 0 ? 0.35 : 0.7 },
          uHeight: { value: this.tex },
          uHInfo: { value: this.info },
          uWind: { value: 1 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.frustumCulled = false
      mesh.layers.set(layer)
      mesh.renderOrder = 11
      mesh.name = `grass:${i}`
      this.mats.push(mat)
      this.group.add(mesh)
    })
  }

  /** 作り直しの途中（行ごとに進める。終わったら画像を差し替える） */
  private job: Generator<void> | null = null
  private staging = new Uint16Array(HN * HN * 4)

  /** 高さの画像を作り直す（中心 = シーンの x, z）。16 行ごとに yield し、最後に差し替える */
  private *rebuildSteps(cx: number, cz: number): Generator<void> {
    const ox = Math.round(cx - (HN * HCELL) / 2)
    const oz = Math.round(cz - (HN * HCELL) / 2)
    // 高さは画像の中心の地面からの差（半精度の浮動小数でも cm まで）
    const base = this.opt.heightAt(cx, -cz) - LAB
    const d = this.staging
    for (let j = 0; j < HN; j++) {
      for (let i = 0; i < HN; i++) {
        const x = ox + (i + 0.5) * HCELL
        const z = oz + (j + 0.5) * HCELL
        const h = this.opt.heightAt(x, -z) - LAB
        const ok = this.opt.allowed(x, -z) ? 1 : 0
        const k = (j * HN + i) * 4
        d[k] = THREE.DataUtils.toHalfFloat(h - base)
        d[k + 1] = THREE.DataUtils.toHalfFloat(ok)
        d[k + 2] = 0
        d[k + 3] = THREE.DataUtils.toHalfFloat(1)
      }
      if (j % 16 === 15) yield
    }
    this.data.set(d)
    this.tex.needsUpdate = true
    this.info.set(ox, oz, HCELL, base)
    this.last.set(cx, cz)
  }

  update(camera: THREE.Camera, wind: number) {
    if (!this.mats.length) return
    const p = camera.position
    // カメラが高い（地面から 40m 以上）ときは描かない
    const ground = this.opt.heightAt(p.x, -p.z) - LAB
    // ラボの中のカメラ（配信の画）では描かない（窓の外の斜面の草は窓から見えるほど近くない）
    const inLab = Math.abs(p.x) < 9 && p.z > -10.6 && p.z < 6.5 && p.y < 7
    this.group.visible = p.y - ground < 40 && !inLab
    if (!this.group.visible) return
    // カメラが 12m 動いたら作り直し始め、1 コマに 16 行ずつ進める（町の中を歩く間、1 コマに作り直すと 50ms ほどかかった。§7 の 152）。
    // 遠くへ跳んだ（24m より。カット）ときは同じコマで全部
    const moved = Math.hypot(p.x - this.last.x, p.z - this.last.y)
    if (moved > 24) {
      this.job = this.rebuildSteps(p.x, p.z)
      while (!this.job.next().done);
      this.job = null
    } else if (!this.job && moved > 12) this.job = this.rebuildSteps(p.x, p.z)
    if (this.job && this.job.next().done) this.job = null
    for (const m of this.mats) {
      m.uniforms.uGrassCam.value.set(p.x, p.y, p.z)
      m.uniforms.uWind.value = wind
    }
  }
}
