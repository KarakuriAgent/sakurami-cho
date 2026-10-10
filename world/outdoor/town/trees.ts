import * as THREE from 'three'
import { SITE } from '../../../core/town'
import { COMMON, TONE, outdoorUniforms } from '../materials'
import { TOWN_LIGHT } from './facades'
import { TOWN_SHADOW, depthMaterial, townShadowUniforms } from './shadows'
import { TEXTURE_DECL, townTextureUniforms } from './townTextures'
import { TOWN_LAMPS, lampUniforms } from './lamps'
import type { TownTile } from './townData'
import { LANE_CORRIDOR_HALF_W, laneCorridor, type CorridorHit } from '../../walk/laneCorridor'

const _hit: CorridorHit = { nx: 0, ny: 0, dist: 0, z0: 0, z1: 0 }

/**
 * 木（`pnpm sync:town` が置いた木。タイルの t_pos = 平面座標・根元の標高・高さ、t_attr = 樹冠の半径 × 10・種類・色のばらつき・印）。
 *
 * - **近くの木**（細かさの中心から nearTreeDistance まで）: 幹と枝（先細りの円柱）と、葉のかたまりの板（葉の写真を並べた絵。アルファで抜く）を
 *   樹冠の形に 40 枚ほど並べた形。種類ごとの形（広葉樹 2 つ・楓・針葉樹）をインスタンスで描く。板の法線は樹冠の球の向きとまぜて、
 *   ふんわりした陰影にする。風で揺れる（幹は根元から、葉の板は細かく震える）
 * - **遠くの木**: 樹冠の絵の板 1 枚（カメラの方を向く。インポスター）。陰影は樹冠を球とみなした法線で、下ほど暗く。遠いほどアルファの縁を太らせて、
 *   ミップマップで木が消えないようにする
 * - どちらも町の影を受け、影を落とす（深さだけのシェーダーで葉の形に抜く）。楓は秋に紅葉、桜は春に花
 */

/** 木の種類（tools/town/scatter.mjs の TREE と同じ番号） */
export const TREE = { broadleaf: 0, maple: 1, sakura: 2, conifer: 3 } as const

/** 葉の絵（foliage.webp の 2×2 の絵の番号） */
const CELL = { dense: 0, sparse: 1, maple: 2, conifer: 3 }

const LAB = SITE.labFloorElevation

/* -------------------------------------------------------------------------- */
/* 近くの木の形（底の中心が原点。高さ 1、樹冠の幅 1）                                    */
/* -------------------------------------------------------------------------- */

class TreeWriter {
  pos: number[] = []
  nrm: number[] = []
  crown: number[] = []
  uv: number[] = []
  /** 葉の板の真ん中（幹・枝は頂点そのもの）。浮遊レーンの通り道の剪定で、板をどちらの壁へ寄せるかを決める */
  cardC: number[] = []
  idx: number[] = []
  private rnd: () => number
  constructor(seed: number) {
    let s = seed >>> 0
    this.rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 4294967296
    }
  }
  r() {
    return this.rnd()
  }
  /** 頂点: 位置・板の法線・(樹冠の法線 xyz, 樹冠の中の深さ ao)・(u, v, 絵の番号（-1 は幹）, 揺れの重み) */
  vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Vector3, ao: number, u: number, v: number, cell: number, sway: number, card: THREE.Vector3 = p) {
    this.pos.push(p.x, p.y, p.z)
    this.cardC.push(card.x, card.y, card.z)
    this.nrm.push(n.x, n.y, n.z)
    this.crown.push(c.x, c.y, c.z, ao)
    this.uv.push(u, v, cell, sway)
    return this.pos.length / 3 - 1
  }
  /** 先細りの円柱（幹・枝）。a → b、半径 ra → rb */
  limb(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, sides: number, swayA: number, swayB: number) {
    const dir = b.clone().sub(a)
    const len = dir.length()
    dir.normalize()
    const side = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const u = new THREE.Vector3().crossVectors(dir, side).normalize()
    const w = new THREE.Vector3().crossVectors(dir, u)
    const base = this.pos.length / 3
    for (let i = 0; i <= sides; i++) {
      const t = (i / sides) * Math.PI * 2
      const n = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(w, Math.sin(t))
      this.vert(a.clone().addScaledVector(n, ra), n, n, 0.7, i / sides, 0, -1, swayA)
      this.vert(b.clone().addScaledVector(n, rb), n, n, 0.75, i / sides, len * 6, -1, swayB)
    }
    for (let i = 0; i < sides; i++) {
      const k = base + i * 2
      this.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
    }
  }
  /** 葉の板（中心 c・法線 n・大きさ s・回転 rot）。center = 樹冠の中心（樹冠の法線を作る） */
  card(c: THREE.Vector3, n: THREE.Vector3, s: number, rot: number, cell: number, center: THREE.Vector3, radii: THREE.Vector3) {
    const up = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const ax = new THREE.Vector3().crossVectors(up, n).normalize()
    const ay = new THREE.Vector3().crossVectors(n, ax)
    const cr = Math.cos(rot)
    const sr = Math.sin(rot)
    const X = ax.clone().multiplyScalar(cr).addScaledVector(ay, sr)
    const Y = ay.clone().multiplyScalar(cr).addScaledVector(ax, -sr)
    const base = this.pos.length / 3
    const corners: [number, number][] = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ]
    for (const [x, y] of corners) {
      const p = c.clone().addScaledVector(X, x * s).addScaledVector(Y, y * s)
      // 樹冠の法線（楕円体の中心からの向き）と、中ほどほど暗い（葉の重なり）
      const q = p.clone().sub(center).divide(radii)
      const depth = Math.min(1, q.length())
      const cn = new THREE.Vector3(q.x / radii.x, q.y / radii.y, q.z / radii.z).normalize()
      this.vert(p, n, cn, 0.6 + 0.4 * depth, x + 0.5, y + 0.5, cell, 1, c)
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  build() {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3))
    g.setAttribute('aCrown', new THREE.Float32BufferAttribute(this.crown, 4))
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 4))
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(this.cardC, 3))
    g.setIndex(this.idx)
    return g
  }
}

/**
 * 広葉樹（variant 0 = 丸い樹冠・密な葉、1 = 少し縦長で疎な葉、2 = 楓）。large = 大きな木（葉の板を小さく多くして、葉の大きさをそろえる）
 */
function broadleafGeometry(variant: number, large = false) {
  const w = new TreeWriter(17 + variant * 101)
  // 楓も近くは密な葉の絵（楓の葉の絵は、下から見上げると細かい点の列になるため。遠くの板は楓の絵）
  const cell = variant === 1 ? CELL.sparse : CELL.dense
  const center = new THREE.Vector3(0, variant === 1 ? 0.62 : 0.6, 0)
  const radii = new THREE.Vector3(0.5, variant === 1 ? 0.42 : 0.38, 0.5)
  const trunkTop = new THREE.Vector3(0, 0.55, 0)
  // 幹と、樹冠の中へ伸びる枝
  w.limb(new THREE.Vector3(0, -0.05, 0), trunkTop, 0.045, 0.028, 7, 0, 0.3)
  const branches = 5
  const tips: THREE.Vector3[] = []
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + w.r() * 0.8
    const y0 = 0.36 + w.r() * 0.16
    const tip = new THREE.Vector3(Math.cos(a) * radii.x * 0.62, center.y + (w.r() - 0.2) * radii.y * 0.7, Math.sin(a) * radii.z * 0.62)
    w.limb(new THREE.Vector3(0, y0, 0), tip, 0.02, 0.008, 5, 0.25, 0.8)
    tips.push(tip)
  }
  // 葉の板: 外側ほど多く（樹冠の殻）、枝の先のまわりにかたまりも
  const cards = Math.round((variant === 1 ? 38 : 46) * (large ? 2.6 : 1))
  const cardScale = large ? 0.6 : 1
  for (let i = 0; i < cards; i++) {
    const u = w.r() * 2 - 1
    const t = w.r() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const dir = new THREE.Vector3(s * Math.cos(t), u * 0.85 + 0.1, s * Math.sin(t)).normalize()
    const rr = 0.55 + 0.45 * Math.cbrt(w.r())
    const c = center.clone().add(new THREE.Vector3(dir.x * radii.x, dir.y * radii.y, dir.z * radii.z).multiplyScalar(rr))
    if (i % 6 === 0) c.lerp(tips[i % tips.length], 0.4)
    // 板の向き: 外向きとまぜて、少しばらつかせる
    const n = dir.clone().add(new THREE.Vector3(w.r() - 0.5, w.r() - 0.3, w.r() - 0.5).multiplyScalar(1.2)).normalize()
    const size = (variant === 1 ? 0.4 : 0.42) * (0.8 + 0.45 * w.r()) * cardScale
    // 樹冠の下端より下へ葉を垂らさない（通りの上の並木の下を歩けるように）
    c.y = Math.max(c.y, 0.3 + size * 0.5)
    w.card(c, n, size, w.r() * Math.PI * 2, cell, center, radii)
  }
  return w.build()
}

/** 植え込み・低い木（幹なし。地面から半球の葉のかたまり） */
function shrubGeometry() {
  const w = new TreeWriter(4242)
  const center = new THREE.Vector3(0, 0.35, 0)
  const radii = new THREE.Vector3(0.5, 0.55, 0.5)
  for (let i = 0; i < 26; i++) {
    const u = w.r()
    const t = w.r() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const dir = new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t)).normalize()
    const rr = 0.45 + 0.55 * Math.cbrt(w.r())
    const c = center.clone().add(new THREE.Vector3(dir.x * radii.x, dir.y * radii.y, dir.z * radii.z).multiplyScalar(rr))
    const n = dir.clone().add(new THREE.Vector3(w.r() - 0.5, w.r() - 0.2, w.r() - 0.5)).normalize()
    w.card(c, n, 0.55 * (0.8 + 0.4 * w.r()), w.r() * Math.PI * 2, CELL.dense, center, radii)
  }
  return w.build()
}

/** 針葉樹（杉・檜・松。円錐の樹冠を、下に垂れた葉の枝の板で作る） */
function coniferGeometry() {
  const w = new TreeWriter(907)
  w.limb(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.98, 0), 0.04, 0.008, 6, 0, 0.6)
  const center = new THREE.Vector3(0, 0.55, 0)
  const radii = new THREE.Vector3(0.5, 0.48, 0.5)
  const tiers = 9
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1)
    const y = 0.18 + t * 0.76
    const rad = 0.5 * (1 - t) + 0.05
    const n = 5 - Math.floor(t * 3)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.9 + w.r() * 0.5
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      const c = new THREE.Vector3(dir.x * rad * 0.55, y, dir.z * rad * 0.55)
      // 板は外へ向けて少し上を向ける（枝の葉の面）
      const nn = dir.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, 0.7, 0)).normalize()
      w.card(c, nn, rad * 1.5 + 0.12, (w.r() - 0.5) * 0.4, CELL.conifer, center, radii)
    }
  }
  return w.build()
}

/** 遠くの木の板（底の中心が原点、幅 1・高さ 1） */
function impostorGeometry() {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

/* -------------------------------------------------------------------------- */
/* シェーダー                                                                    */
/* -------------------------------------------------------------------------- */

/** 頂点のシェーダーの共通部分: インスタンスの値（iA = 位置・高さ、iB = 樹冠の半径・種類・色のばらつき・種）と風 */
const TREE_COMMON = /* glsl */ `
attribute vec4 iA;
attribute vec4 iB;
uniform float uWind;
varying vec3 vWorld;
varying vec3 vLeaf;
varying float vSeed;
float treeHash(float n) {
  return fract(sin(n * 91.345) * 47453.5453);
}
/** 風（木ごとに位相をずらす。高い所ほど大きく） */
vec3 windOffset(vec3 base, float h01, float scaleH, float seed) {
  float t = uTime;
  float ph = seed * 6.2831 + base.x * 0.05 + base.z * 0.04;
  float sway = sin(t * 1.1 + ph) * 0.6 + sin(t * 2.3 + ph * 1.7) * 0.25 + sin(t * 0.37 + ph * 0.3) * 0.5;
  float k = uWind * h01 * h01 * scaleH * 0.018;
  return vec3(sway * k, 0.0, sway * k * 0.6);
}
/** 葉の色（種類・季節・ばらつき） */
vec3 leafTint(float kind, float tint) {
  vec3 leaf = mix(vec3(0.62, 0.75, 0.5), vec3(0.85, 0.9, 0.62), tint);
  if (kind > 2.5) leaf = mix(vec3(0.38, 0.5, 0.42), vec3(0.5, 0.6, 0.45), tint);
  if (kind > 0.5 && kind < 1.5) leaf = mix(leaf, mix(vec3(1.6, 0.35, 0.12), vec3(1.5, 0.75, 0.15), tint), uAutumn);
  if (kind > 1.5 && kind < 2.5) leaf = mix(leaf, vec3(1.45, 1.05, 1.15), uSpring);
  return leaf;
}
`

/** 近くの木の頂点のシェーダー */
const NEAR_VERTEX = /* glsl */ `
${COMMON}
uniform float uAutumn;
uniform float uSpring;
${TREE_COMMON}
attribute vec4 aCrown;
attribute vec4 aUv;
attribute vec3 aCard;
/** 浮遊レーンの通り道（iC = 通り道の真ん中の線への法線 xz（幹の側を向く）・幹から線までの距離・幅の半分、iD = 下と上の高さ（シーン）。幅 0 なら無し） */
attribute vec4 iC;
attribute vec2 iD;
varying vec3 vNormal;
varying vec3 vCardN;
varying vec4 vUv;
varying float vAo;
void main() {
  float c = cos(iB.w * 6.2831);
  float s = sin(iB.w * 6.2831);
  vec3 scale = vec3(iB.x * 2.0, iA.w, iB.x * 2.0);
  vec3 p = position;
  p.xz = mat2(c, s, -s, c) * p.xz;
  vec3 base = vec3(iA.x, iA.z - 0.3 - LAB_FLOOR, -iA.y);
  vec3 wp = base + p * scale;
  // 風: 幹は根元から曲がり、葉の板は小刻みに震える
  wp += windOffset(base, clamp(position.y, 0.0, 1.2), iA.w, iB.w) * mix(0.3, 1.0, aUv.w);
  float flutter = sin(uTime * 7.0 + dot(position, vec3(31.0, 17.0, 23.0)) + iB.w * 40.0) * 0.012 * uWind * aUv.w * iA.w;
  wp.y += flutter;
  // 浮遊レーンの通り道の剪定: 通り道の箱の中の葉・枝の頂点を、板の真ん中のある側の壁まで寄せる（幹は寄せない。town.md §7 の 214）
  if (iC.w > 0.0 && !(aUv.z < -0.5 && aUv.w < 0.31) && wp.y > iD.x && wp.y < iD.y) {
    vec2 nn = iC.xy;
    vec3 cc = aCard;
    cc.xz = mat2(c, s, -s, c) * cc.xz;
    float sideC = dot(cc.xz * scale.xz, nn) + iC.z;
    float sv = dot(wp.xz - base.xz, nn) + iC.z;
    float sg = sideC >= 0.0 ? 1.0 : -1.0;
    if (sg * sv < iC.w) wp.xz += nn * (sg * iC.w - sv);
  }
  vec3 n = normal;
  n.xz = mat2(c, s, -s, c) * n.xz;
  vec3 cn = aCrown.xyz;
  cn.xz = mat2(c, s, -s, c) * cn.xz;
  // 葉は樹冠の丸みの法線を多めに（ふんわりした陰影）、幹はそのまま
  vNormal = aUv.z < -0.5 ? n : normalize(mix(cn, n, 0.3));
  vCardN = n;
  vUv = aUv;
  vAo = aCrown.w;
  vLeaf = leafTint(iB.y, iB.z);
  vSeed = iB.w;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

/** 遠くの木の頂点のシェーダー（カメラの方を向く板。縦の軸のまわりに回す） */
const FAR_VERTEX = /* glsl */ `
${COMMON}
uniform float uAutumn;
uniform float uSpring;
${TREE_COMMON}
varying vec2 vQuad;
varying vec3 vRight;
varying vec3 vToCam;
varying float vCell;
void main() {
  vec3 base = vec3(iA.x, iA.z - 0.3 - LAB_FLOOR, -iA.y);
  vec3 toCam = cameraPosition - base;
  toCam.y = 0.0;
  float l = length(toCam);
  vec3 f = l > 1e-3 ? toCam / l : vec3(0.0, 0.0, 1.0);
  vec3 right = vec3(f.z, 0.0, -f.x);
  float wdt = iB.x * 2.25;
  vec3 wp = base + right * position.x * wdt + vec3(0.0, position.y * iA.w * 1.05, 0.0);
  wp += windOffset(base, position.y, iA.w, iB.w) * 0.6;
  vQuad = vec2(position.x + 0.5, position.y);
  vRight = right;
  vToCam = f;
  // 絵: 針葉樹・楓・広葉樹（2 つから木ごとに）
  float kind = iB.y;
  vCell = kind > 2.5 ? 3.0 : kind > 0.5 && kind < 1.5 ? 2.0 : (fract(iB.w * 7.7) < 0.5 ? 0.0 : 1.0);
  vLeaf = leafTint(kind, iB.z);
  vSeed = iB.w;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

/** 葉の絵の読み方（2×2 の絵の番号と、その中の uv） */
const FOLIAGE = /* glsl */ `
uniform sampler2D uFoliage;
vec4 foliage(vec2 uv, float cell) {
  vec2 o = vec2(mod(cell, 2.0), floor(cell / 2.0)) * 0.5;
  return texture(uFoliage, o + clamp(uv, 0.002, 0.998) * 0.5);
}
/** 遠いほど（ミップマップが進むほど）アルファを太らせる（遠くの木がミップマップで消えないように） */
float foliageAlpha(float a, vec2 uv) {
  vec2 d = fwidth(uv) * 512.0;
  float lod = max(0.0, log2(max(max(d.x, d.y), 1.0)));
  return a * (1.0 + 0.32 * lod);
}
/**
 * 近くの木の葉の板の太らせ方（段階 5 の植物の仕上げ）。遠くの木と同じだけ太らせると、20〜60m の木の板が葉の形の無い四角に埋まり、
 * 夕日で明るい四角の板に見えた。近くの木は少しだけ太らせ、残りは alphaToCoverage のやわらかい縁にまかせる
 */
float foliageAlphaNear(float a, vec2 uv) {
  vec2 d = fwidth(uv) * 512.0;
  float lod = max(0.0, log2(max(max(d.x, d.y), 1.0)));
  return a * (1.0 + 0.12 * lod);
}
`

/**
 * GLSL: 葉の影の受け方。葉は光を通して散らすので影の中でも真っ暗にしない。太陽が低い（朝夕）ほど、影の地図の 1 画素が太陽の向きに長く伸びて
 * 樹冠に明るい平行四辺形の縞が出るので、影をならして中くらいの明るさに寄せる（段階 5 の植物の仕上げ）
 */
export const LEAF_SHADOW = /* glsl */ `
float leafShadow(float sh) {
  float lowSun = 1.0 - smoothstep(0.04, 0.24, uSunDir.y);
  return mix(mix(0.3, 1.0, sh), 0.55, lowSun * 0.85);
}
`
/** GLSL: ガラスの温室（ガーデンドーム）の中の木だけが使う光（夜の中の灯りの照り返し・葉脈ライティングの光の点）。町の木は 0 */
const DOME_GLOW = /* glsl */ `
uniform vec3 uExtraAmb;
uniform float uVein;
vec3 domeGlow(vec3 albedo, float ao, vec3 wp, float seed, float leaf) {
  vec3 c = albedo * uExtraAmb * (0.6 + 0.4 * ao) * 1.6;
  if (uVein > 0.0 && leaf > 0.5) {
    float breath = 0.62 + 0.38 * sin(uTime * 0.55);
    // 光の点: 3 次元の升（0.45m）ごとに 1 つ、升の中の決まった所に小さな丸い光（前は升の面がそのまま光って、明るい四角の板に見えた）
    vec3 g = wp * 2.2;
    vec3 cell = floor(g);
    float hsh = oHash(cell.xz + cell.y * 17.31 + seed * 31.0);
    vec3 ctr = vec3(oHash(cell.xz + 3.7 + cell.y), oHash(cell.zx + 9.1 + cell.y), oHash(cell.xz * 1.3 + 5.3 + cell.y)) * 0.6 + 0.2;
    float r = length(g - cell - ctr);
    float sp = step(0.8, hsh) * (1.0 - smoothstep(0.06, 0.2, r));
    float flow = 0.55 + 0.45 * sin(wp.y * 1.4 - uTime * 1.1 + seed * 12.0);
    c += vec3(0.55, 1.0, 0.32) * (0.008 + sp * 1.2 * flow) * uVein * breath;
  }
  return c;
}
`

const NEAR_FRAGMENT = /* glsl */ `
${TOWN_LAMPS}
${COMMON}
${TOWN_LIGHT}
${TOWN_SHADOW}
${LEAF_SHADOW}
${TEXTURE_DECL}
${FOLIAGE}
${DOME_GLOW}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vCardN;
varying vec4 vUv;
varying float vAo;
varying vec3 vLeaf;
varying float vSeed;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 albedo;
  float ao = vAo;
  if (vUv.z < -0.5) {
    // 幹と枝: 樹皮の質感
    vec3 bark = texture(uGndAlb, vec3(vUv.x * 2.0, vUv.y, 6.0)).rgb * 2.0;
    albedo = vec3(0.075, 0.06, 0.05) * pow(max(bark, 0.0), vec3(2.2));
  } else {
    vec4 f = foliage(vec2(vUv.x, 1.0 - vUv.y), vUv.z);
    // 横から見た板（葉が点の列に見える）は消す
    float facing = abs(dot(normalize(vCardN), V));
    if (foliageAlphaNear(f.a, vUv.xy) * smoothstep(0.12, 0.4, facing) < 0.5) discard;
    albedo = pow(f.rgb, vec3(2.2)) * vLeaf * 1.1;
    // 葉のかたまりごとの明るさのばらつき（板ごとに一様な色に見えないように）
    albedo *= 0.78 + 0.44 * oNoise(vWorld.xz * 0.9 + vWorld.y * 0.7 + vSeed * 13.0);
  }
  // 葉は光を通して散らすので、影の中でも真っ暗にならない（影は浅く、空の光をよく受ける）
  float sh = townShadow(vWorld, N);
  if (vUv.z > -0.5) sh = leafShadow(sh);
  vec3 col = townLight(albedo, N, ao, sh) + albedo * uSkyLight * 0.45 * ao;
  // 逆光の葉が透ける
  if (vUv.z > -0.5) {
    col += albedo * uSunLight * pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.6 * sh;
    // 下から見上げた樹冠（段階 5 の植物の仕上げ）: 葉は空と太陽の光を通して黄緑に明るい（前は下を向いた面の暗さだけで、見上げると黒い塊だった）
    float under = smoothstep(0.05, 0.7, -V.y);
    vec3 thru = albedo * vec3(1.1, 1.25, 0.6);
    col += thru * (uSkyLight * 0.55 + uSunLight * 0.3 * sh * max(uSunDir.y, 0.0)) * under * (0.45 + 0.55 * ao);
  }
  col += domeGlow(albedo, ao, vWorld, vSeed, vUv.z > -0.5 ? 1.0 : 0.0);
  // 夜: 街灯の下の葉（下から照らされる。葉は光を通すので回り込みを大きく）
  col += albedo * townLampsEx(vWorld, N, 0.0, 0.45) * 0.8 * ao;
  col = outdoorHaze(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
  ${TONE}
}
`

const FAR_FRAGMENT = /* glsl */ `
${COMMON}
${TOWN_LIGHT}
${TOWN_SHADOW}
${LEAF_SHADOW}
${FOLIAGE}
${DOME_GLOW}
varying vec3 vWorld;
varying vec2 vQuad;
varying vec3 vRight;
varying vec3 vToCam;
varying float vCell;
varying vec3 vLeaf;
varying float vSeed;
void main() {
  // 樹冠は板の上 82%、下は幹
  vec2 cuv = vec2(vQuad.x, (vQuad.y - 0.18) / 0.82);
  if (fract(vSeed * 3.1) < 0.5) cuv.x = 1.0 - cuv.x;
  vec4 f = foliage(vec2(cuv.x, 1.0 - cuv.y), vCell);
  float a = cuv.y > 0.0 ? foliageAlpha(f.a, cuv) : 0.0;
  float trunk = step(abs(vQuad.x - 0.5), 0.035) * step(vQuad.y, 0.3) * (vCell > 2.5 ? 1.0 : 1.0);
  if (a < 0.5 && trunk < 0.5) discard;
  vec3 albedo;
  vec3 N;
  float ao;
  if (a >= 0.5) {
    albedo = pow(f.rgb, vec3(2.2)) * vLeaf * 0.95;
    // 樹冠を球とみなした法線（板の位置から）
    vec2 q = vec2(cuv.x - 0.5, cuv.y - 0.5) * 2.0;
    float z = sqrt(max(0.0, 1.0 - min(1.0, dot(q, q))));
    N = normalize(vRight * q.x + vec3(0.0, 1.0, 0.0) * (q.y * 0.8 + 0.25) + vToCam * (z + 0.2));
    ao = 0.45 + 0.55 * smoothstep(-0.1, 0.9, cuv.y);
  } else {
    albedo = vec3(0.05, 0.04, 0.035);
    N = vToCam;
    ao = 0.6;
  }
  float sh = leafShadow(townShadow(vWorld, N));
  vec3 col = townLight(albedo, N, ao, sh) + albedo * uSkyLight * 0.45 * ao;
  vec3 V = normalize(cameraPosition - vWorld);
  col += albedo * uSunLight * pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.5 * sh;
  col += domeGlow(albedo, ao, vWorld, vSeed, a >= 0.5 ? 1.0 : 0.0);
  col = outdoorHaze(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
  ${TONE}
}
`

const DEFINES = { LAB_FLOOR: LAB.toFixed(2) }

/** 木のシェーダー（近く・遠く）と影の深さだけのシェーダー。uniform は共有 */
export function createTreeMaterials() {
  const uniforms = {
    ...outdoorUniforms,
    ...townShadowUniforms,
    ...townTextureUniforms,
    ...lampUniforms,
    uAutumn: { value: 0 },
    uSpring: { value: 0 },
    uWind: { value: 0.6 },
    /** ガラスの温室の中の木だけ（町の木は 0） */
    uExtraAmb: { value: new THREE.Vector3() },
    uVein: { value: 0 },
  }
  const near = new THREE.ShaderMaterial({ name: 'townTreesNear', defines: DEFINES, uniforms, vertexShader: NEAR_VERTEX, fragmentShader: NEAR_FRAGMENT, side: THREE.DoubleSide, alphaToCoverage: true })
  const far = new THREE.ShaderMaterial({ name: 'townTreesFar', defines: DEFINES, uniforms, vertexShader: FAR_VERTEX, fragmentShader: FAR_FRAGMENT, side: THREE.DoubleSide, alphaToCoverage: true })
  // 影の葉は、ぼかした葉の形（ミップマップを進めた値）で抜く（影の地図の画素より細かい葉が、ざらざらの点の影にならないように）
  const depthFrag = (kind: 'near' | 'far') => /* glsl */ `
    uniform sampler2D uFoliage;
    vec4 foliage(vec2 uv, float cell) {
      vec2 o = vec2(mod(cell, 2.0), floor(cell / 2.0)) * 0.5;
      return texture(uFoliage, o + clamp(uv, 0.002, 0.998) * 0.5, 3.5);
    }
    varying vec3 vWorld;
    ${kind === 'near' ? 'varying vec4 vUv;' : 'varying vec2 vQuad; varying float vCell; varying float vSeed;'}
    void main() {
      ${
        kind === 'near'
          ? 'if (vUv.z > -0.5 && foliage(vec2(vUv.x, 1.0 - vUv.y), vUv.z).a < 0.42) discard;'
          : 'vec2 cuv = vec2(vQuad.x, (vQuad.y - 0.18) / 0.82); float a = cuv.y > 0.0 ? foliage(vec2(cuv.x, 1.0 - cuv.y), vCell).a : 0.0; if (a < 0.5 && !(abs(vQuad.x - 0.5) < 0.035 && vQuad.y < 0.3)) discard;'
      }
      gl_FragColor = vec4(1.0);
    }
  `
  const nearDepth = depthMaterial(NEAR_VERTEX, { defines: DEFINES, uniforms, fragment: depthFrag('near') })
  const farDepth = depthMaterial(FAR_VERTEX, { defines: DEFINES, uniforms, fragment: depthFrag('far') })
  return { near, far, nearDepth, farDepth, uniforms }
}

export type TreeMaterials = ReturnType<typeof createTreeMaterials>

/* -------------------------------------------------------------------------- */
/* 木を置く                                                                      */
/* -------------------------------------------------------------------------- */

interface TreeItem {
  x: number
  y: number
  z: number
  h: number
  r: number
  kind: number
  tint: number
  seed: number
  /** 浮遊レーンの通り道（近くの木。world/walk/laneCorridor.ts）: シーンの法線 xz・幹から線まで・幅の半分・下と上の高さ（シーン） */
  lane?: [number, number, number, number, number, number]
}

function instanced(geo: THREE.InstancedBufferGeometry, list: TreeItem[], material: THREE.Material, depth: THREE.Material, name: string) {
  const a = new Float32Array(Math.max(1, list.length) * 4)
  const b = new Float32Array(Math.max(1, list.length) * 4)
  const lc = new Float32Array(Math.max(1, list.length) * 4)
  const ld = new Float32Array(Math.max(1, list.length) * 2)
  list.forEach((t, i) => {
    a.set([t.x, t.y, t.z, t.h], i * 4)
    b.set([t.r, t.kind, t.tint, t.seed], i * 4)
    if (t.lane) {
      lc.set([t.lane[0], t.lane[1], t.lane[2], t.lane[3]], i * 4)
      ld.set([t.lane[4], t.lane[5]], i * 2)
    }
  })
  geo.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4))
  geo.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 4))
  if (geo.getAttribute('aCard')) {
    geo.setAttribute('iC', new THREE.InstancedBufferAttribute(lc, 4))
    geo.setAttribute('iD', new THREE.InstancedBufferAttribute(ld, 2))
  }
  geo.instanceCount = list.length
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.visible = list.length > 0
  mesh.name = `townTrees:${name}`
  mesh.userData.shadowMaterial = depth
  return mesh
}

/**
 * タイルの木を、近くの木（種類ごとの形 4 つ）と遠くの木（板 1 枚）に分けて描く。center = 細かさの中心（平面座標）
 */
export function treeMeshes(tiles: TownTile[], mats: TreeMaterials, nearDistance: number, share: number, center: [number, number] = [0, 0], adjust?: (x: number, y: number, z: number) => number | null) {
  const near: TreeItem[][] = [[], [], [], [], [], [], []]
  const far: TreeItem[] = []
  let k = 0
  for (const t of tiles) {
    const p = t.sections.t_pos.array as Float32Array
    const a = t.sections.t_attr.array as Uint8Array
    for (let i = 0; i < p.length / 4; i++) {
      // 画質の低いときは間引く（名前のある大木と並木は残す）
      k = (k + 0.618034) % 1
      if (k > share && a[i * 4 + 3] === 0) continue
      const x = p[i * 4]
      const y = p[i * 4 + 1]
      const seed = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1
      // ラボの前のセット: 小道・テラスの上の木は除き、均した地面の高さに置き直す（adjust が null なら置かない）
      const z0 = p[i * 4 + 2]
      const z = adjust ? adjust(x, y, z0) : z0
      if (z === null) continue
      const tree: TreeItem = { x, y, z, h: p[i * 4 + 3], r: a[i * 4] / 10, kind: a[i * 4 + 1], tint: a[i * 4 + 2] / 255, seed }
      const d = Math.hypot(x - center[0], y - center[1])
      if (d < nearDistance) {
        // 浮遊レーンの通り道にかかる樹冠（枝を払う。world/walk/laneCorridor.ts）
        const lane = laneCorridor.near(x, y, tree.r * 1.15 + LANE_CORRIDOR_HALF_W + 0.5, _hit)
        if (lane && lane.z0 < z + tree.h && lane.z1 > z + tree.h * 0.25) tree.lane = [lane.nx, -lane.ny, lane.dist, LANE_CORRIDOR_HALF_W, lane.z0 - LAB, lane.z1 - LAB]
        // 大きな木（樹冠の半径 3m 以上）は葉の板を小さく多くした形
        const big = tree.r >= 3 && tree.kind !== TREE.conifer ? 4 : 0
        const shape = tree.kind === TREE.conifer ? 3 : (tree.kind === TREE.maple ? 2 : seed < 0.5 ? 0 : 1) + big
        near[shape].push(tree)
      } else far.push(tree)
    }
  }
  const geos = [broadleafGeometry(0), broadleafGeometry(1), broadleafGeometry(2), coniferGeometry(), broadleafGeometry(0, true), broadleafGeometry(1, true), broadleafGeometry(2, true)]
  const names = ['near:broad', 'near:broad2', 'near:maple', 'near:conifer', 'near:broadL', 'near:broad2L', 'near:mapleL']
  const meshes = near.map((list, i) => instanced(geos[i], list, mats.near, mats.nearDepth, names[i]))
  // 遠くの木は近い順に（手前を先に描く）
  far.sort((p, q) => Math.hypot(p.x - center[0], p.y - center[1]) - Math.hypot(q.x - center[0], q.y - center[1]))
  meshes.push(instanced(impostorGeometry(), far, mats.far, mats.farDepth, 'far'))
  return meshes
}

/**
 * 決めた木の並び（ガーデンドームの中の木など）を、近くの木の形（種類ごと）で描く。list の kind は TREE（0 広葉樹・1 楓・2 桜・3 針葉樹）、
 * shrub = true の物は植え込みの形
 */
export function treeMeshesFromList(list: (TreeItem & { shrub?: boolean })[], mats: TreeMaterials) {
  const near: TreeItem[][] = [[], [], [], [], [], [], []]
  const shrubs: TreeItem[] = []
  for (const t of list) {
    if (t.shrub) {
      shrubs.push(t)
      continue
    }
    const big = t.r >= 3 && t.kind !== TREE.conifer ? 4 : 0
    const shape = t.kind === TREE.conifer ? 3 : (t.kind === TREE.maple ? 2 : t.seed < 0.5 ? 0 : 1) + big
    near[shape].push(t)
  }
  const geos = [broadleafGeometry(0), broadleafGeometry(1), broadleafGeometry(2), coniferGeometry(), broadleafGeometry(0, true), broadleafGeometry(1, true), broadleafGeometry(2, true)]
  const names = ['near:broad', 'near:broad2', 'near:maple', 'near:conifer', 'near:broadL', 'near:broad2L', 'near:mapleL']
  const meshes = near.map((l, i) => instanced(geos[i], l, mats.near, mats.nearDepth, names[i])).filter((m) => m.visible)
  if (shrubs.length) meshes.push(instanced(shrubGeometry(), shrubs, mats.near, mats.nearDepth, 'shrubs'))
  return meshes
}

export type { TreeItem }

/** 植え込み（ラボの前の斜面など）。list = 平面座標・根元の標高・高さ・幅の半分 */
export function shrubMesh(list: { x: number; y: number; z: number; h: number; r: number; seed: number }[], mats: TreeMaterials) {
  return instanced(shrubGeometry(), list.map((t) => ({ ...t, kind: TREE.broadleaf, tint: t.seed })), mats.near, mats.nearDepth, 'shrubs')
}
