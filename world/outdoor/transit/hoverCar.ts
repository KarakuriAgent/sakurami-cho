import * as THREE from 'three'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { GeoBuilder } from '../site/builder'
import { TOWN_LIGHT } from '../town/facades'
import { TOWN_LAMPS, lampUniforms } from '../town/lamps'
import { TOWN_SHADOW, townShadowUniforms } from '../town/shadows'

/**
 * 花音のホバーの一人乗り（私物。docs/design/town.md §21・§7 の 211〜）の形と描き方。
 *
 * スクーターの形（腰掛ける）: 低い床板（両わきから足を入れて立ち、後ろの鞍に腰掛ける）・前の足よけ（脚を風から守る盾）とハンドル・
 * 後ろの鞍の台。床の下の前後に 2 つの囲いのあるファン（ダクトファン。回っている間は内側の縁がやわらかく光る）。
 * 色は ひらき緑（下）とクリーム（上）、鞍は茶の革、金物は真鍮とステンレス。灯りは電球色の前照灯・暖色の車幅灯・赤い尾灯
 * （シアンはラボだけの決まり。§7 の 199）。後ろに登録番号の板（白地に緑の字「桜-F-26-1103」。浮遊レーン条例 1）。
 *
 * 局所の座標: 原点 = 置いたときの足（ゴムの脚）の下の真ん中、+z = 前、+x = 前を向いて左、y = 上。
 */

export const HOVER = {
  /** 床板の上の高さ・前後（z）・幅の半分 */
  deckY: 0.345,
  deckZ0: -0.12,
  deckZ1: 0.4,
  deckHW: 0.235,
  /** 鞍の上の高さ・真ん中の z */
  seatY: 0.765,
  seatZ: -0.36,
  /** ハンドルの握りの高さ・z・握りの真ん中の x */
  gripY: 1.1,
  gripZ: 0.17,
  gripX: 0.26,
  /** 全体の長さの半分・幅の半分（当たり・カメラ） */
  halfL: 0.88,
  halfW: 0.33,
  /** 足よけの上の高さ */
  shieldTop: 1.05,
  /** 前後のファンの z と半径 */
  fanZ: [0.47, -0.52] as const,
  fanR: 0.205,
  /** 登録番号（浮遊機器登録番号の書式。番号は花音の誕生日 11 月 3 日から。KB-001 は 0115。§7 の 211） */
  plate: '桜-F-26-1103',
} as const

const H = HOVER

/** 材質の番号（aMat.x） */
const HM = {
  /** 塗装（aux = つや） */
  paint: 0,
  /** ゴム・樹脂の黒（aux = つや。1 の近くは床板の筋） */
  dark: 1,
  /** 金物（aux = 0 ステンレス・1 真鍮） */
  metal: 2,
  /** 鞍の革 */
  leather: 3,
  /** 灯り（aux = 0 前照灯・1 尾灯・2 車幅灯） */
  lamp: 4,
  /** ファンの内側の縁の光 */
  glow: 5,
  /** 登録番号の板 */
  plate: 6,
  /** 計器の表示 */
  display: 7,
  /** ファンの羽根（回る） */
  fan: 8,
} as const

const CREAM = '#efe6cd'
const GREEN = '#2e6a4c'
const GREEN_D = '#214e38'
const LEATHER = '#5a3b27'
const DARK = '#1d1e1f'
const STEEL = '#c3c7c9'
const BRASS = '#b48a45'

type Sec = { z: number; yc: number; hw: number; hh: number; p?: number }

/**
 * 断面（超楕円。z ごとに中心の高さ yc・幅の半分 hw・高さの半分 hh・角の丸さ p）をつないだ胴。colorAt(y, x) で面ごとの色、
 * 両端はふたをする
 */
function loft(g: GeoBuilder, secs: Sec[], colorAt: (y: number, x: number) => string, m: number, aux: number | ((y: number) => number), seg = 28) {
  const ring = (s: Sec): [number, number, number][] => {
    const p = s.p ?? 2.6
    const out: [number, number, number][] = []
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2
      const c = Math.cos(a)
      const sn = Math.sin(a)
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / p) * s.hw
      const y = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / p) * s.hh
      out.push([x, s.yc + y, s.z])
    }
    return out
  }
  const rings = secs.map(ring)
  const ax = (y: number) => (typeof aux === 'number' ? aux : aux(y))
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1]
    const b = rings[i]
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg
      const ym = (a[j][1] + a[k][1] + b[j][1] + b[k][1]) / 4
      const xm = (a[j][0] + a[k][0]) / 2
      // 前（+z）へ向かって輪を重ねるので、外から見て反時計回り
      g.quad(a[j], a[k], b[k], b[j], colorAt(ym, xm), m, ax(ym))
    }
  }
  // 両端のふた
  for (const [r, back] of [
    [rings[0], true],
    [rings[rings.length - 1], false],
  ] as const) {
    const c: [number, number, number] = [0, r.reduce((s, p) => s + p[1], 0) / seg, r[0][2]]
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg
      if (back) g.tri(c, r[k], r[j], colorAt(r[j][1], r[j][0]), m, ax(r[j][1]))
      else g.tri(c, r[j], r[k], colorAt(r[j][1], r[j][0]), m, ax(r[j][1]))
    }
  }
}

/** 2 点を結ぶ管 */
function tube(g: GeoBuilder, a: [number, number, number], b: [number, number, number], r: number, color: string, m: number, aux = 0, seg = 10) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = d.length()
  if (len < 1e-4) return
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  const mtx = new THREE.Matrix4().compose(new THREE.Vector3(...a), q, new THREE.Vector3(1, 1, 1))
  g.lathe(
    [
      [r * 0.6, -0.002],
      [r, 0],
      [r, len],
      [r * 0.6, len + 0.002],
    ],
    seg,
    mtx,
    color,
    m,
    aux,
  )
}

/** 胴の塗り分け: 下はひらき緑、上はクリーム、境に細い濃い緑の筋 */
const twoTone = (split: number) => (y: number) => (y < split - 0.012 ? GREEN : y < split + 0.004 ? GREEN_D : CREAM)

/** ホバーの形（不透明な面） */
export function hoverGeometry() {
  const g = new GeoBuilder()
  // --- 下の胴（前から後ろまで。平たい長円の筒） ---
  loft(
    g,
    [
      { z: -0.86, yc: 0.36, hw: 0.08, hh: 0.05 },
      { z: -0.83, yc: 0.33, hw: 0.2, hh: 0.12 },
      { z: -0.7, yc: 0.29, hw: 0.28, hh: 0.15 },
      { z: -0.45, yc: 0.255, hw: 0.31, hh: 0.125 },
      { z: 0.1, yc: 0.24, hw: 0.31, hh: 0.1 },
      { z: 0.5, yc: 0.255, hw: 0.3, hh: 0.115 },
      { z: 0.72, yc: 0.29, hw: 0.24, hh: 0.13 },
      { z: 0.83, yc: 0.33, hw: 0.13, hh: 0.1 },
      { z: 0.87, yc: 0.35, hw: 0.04, hh: 0.04 },
    ],
    twoTone(0.235),
    HM.paint,
    0.75,
  )
  // --- 床板（ゴムの筋の敷物）と、縁のステンレスの見切り ---
  g.boxMinMax(-H.deckHW, H.deckY - 0.03, H.deckZ0, H.deckHW, H.deckY, H.deckZ1, DARK, HM.dark, 0.95)
  for (const sx of [1, -1]) g.boxMinMax(sx > 0 ? H.deckHW : -H.deckHW - 0.018, H.deckY - 0.04, H.deckZ0, sx > 0 ? H.deckHW + 0.018 : -H.deckHW, H.deckY + 0.008, H.deckZ1, STEEL, HM.metal, 0)
  // --- 後ろの鞍の台（クリーム。下は緑の帯） ---
  loft(
    g,
    [
      { z: -0.85, yc: 0.47, hw: 0.12, hh: 0.1, p: 3 },
      { z: -0.8, yc: 0.48, hw: 0.19, hh: 0.16, p: 3 },
      { z: -0.6, yc: 0.49, hw: 0.225, hh: 0.19, p: 3.2 },
      { z: -0.3, yc: 0.49, hw: 0.215, hh: 0.19, p: 3.2 },
      { z: -0.16, yc: 0.48, hw: 0.19, hh: 0.17, p: 3 },
      { z: -0.115, yc: 0.47, hw: 0.15, hh: 0.13, p: 3 },
    ],
    twoTone(0.36),
    HM.paint,
    0.75,
  )
  // --- 鞍（茶の革。前が少し細い）と、後ろの真鍮の握り ---
  loft(
    g,
    [
      { z: -0.72, yc: 0.7, hw: 0.11, hh: 0.035, p: 2.4 },
      { z: -0.68, yc: 0.715, hw: 0.155, hh: 0.05, p: 2.6 },
      { z: -0.45, yc: 0.725, hw: 0.165, hh: 0.045, p: 2.8 },
      { z: -0.2, yc: 0.715, hw: 0.13, hh: 0.042, p: 2.6 },
      { z: -0.12, yc: 0.7, hw: 0.08, hh: 0.03, p: 2.4 },
    ],
    () => LEATHER,
    HM.leather,
    0,
  )
  tube(g, [0.17, 0.69, -0.74], [0.17, 0.72, -0.82], 0.012, BRASS, HM.metal, 1)
  tube(g, [-0.17, 0.69, -0.74], [-0.17, 0.72, -0.82], 0.012, BRASS, HM.metal, 1)
  tube(g, [0.17, 0.72, -0.82], [-0.17, 0.72, -0.82], 0.012, BRASS, HM.metal, 1)
  // --- 前の足よけ（前へふくらむ曲面の盾。表はクリーム、内は緑。上の縁はステンレス） ---
  shield(g)
  // --- ハンドル（足よけの上の柄・横の棒・黒い握り）と、柄の上の計器 ---
  // 柄（足よけの上から、乗る人の方へ倒して握りの真ん中へ）
  tube(g, [0, H.shieldTop - 0.06, 0.39], [0, H.shieldTop + 0.02, 0.35], 0.026, STEEL, HM.metal, 0)
  tube(g, [0, H.shieldTop + 0.02, 0.35], [0, H.gripY + 0.01, H.gripZ + 0.05], 0.024, STEEL, HM.metal, 0)
  const bar: [number, number, number][] = [
    [-0.31, H.gripY, H.gripZ - 0.02],
    [-0.2, H.gripY, H.gripZ],
    [-0.09, H.gripY + 0.01, H.gripZ + 0.05],
    [0.09, H.gripY + 0.01, H.gripZ + 0.05],
    [0.2, H.gripY, H.gripZ],
    [0.31, H.gripY, H.gripZ - 0.02],
  ]
  for (let i = 1; i < bar.length; i++) tube(g, bar[i - 1], bar[i], 0.014, STEEL, HM.metal, 0)
  for (const sx of [1, -1]) tube(g, [sx * 0.2, H.gripY, H.gripZ], [sx * 0.315, H.gripY, H.gripZ - 0.022], 0.019, DARK, HM.dark, 0.2)
  // 柄の上の覆い（クリーム）と、花音の方を向く小さな計器（電球色の字）
  g.box([0, H.gripY + 0.035, H.gripZ + 0.07], [0.15, 0.05, 0.1], CREAM, HM.paint, 0.75, [-0.35, 0, 0])
  g.quad([0.055, H.gripY + 0.058, H.gripZ + 0.035], [-0.055, H.gripY + 0.058, H.gripZ + 0.035], [-0.055, H.gripY + 0.072, H.gripZ + 0.105], [0.055, H.gripY + 0.072, H.gripZ + 0.105], '#000000', HM.display, 0)
  // --- 前照灯（足よけの上の前。真鍮の縁）と車幅灯・尾灯 ---
  const headM = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, H.shieldTop - 0.1, 0.505)
  g.lathe(
    [
      [0.0, 0.012],
      [0.05, 0.012],
      [0.062, 0.0],
      [0.064, -0.03],
    ],
    18,
    headM,
    BRASS,
    HM.metal,
    1,
  )
  g.lathe(
    [
      [0.0, 0.016],
      [0.048, 0.013],
    ],
    18,
    headM,
    '#fff1d6',
    HM.lamp,
    0,
  )
  for (const sx of [1, -1]) {
    g.box([sx * 0.3, 0.27, 0.6], [0.03, 0.035, 0.07], '#ffc88a', HM.lamp, 2, -sx * 0.5)
    g.box([sx * 0.22, 0.45, -0.81], [0.035, 0.03, 0.05], '#ffc88a', HM.lamp, 2, sx * 0.4)
  }
  g.box([0, 0.585, -0.85], [0.14, 0.035, 0.03], '#ff3a2a', HM.lamp, 1)
  // --- 登録番号の板（後ろ。白地・緑の縁）と、板を留める真鍮のねじ ---
  g.quad([0.12, 0.37, -0.873], [-0.12, 0.37, -0.873], [-0.12, 0.47, -0.873], [0.12, 0.47, -0.873], '#ffffff', HM.plate, 0)
  g.boxMinMax(-0.128, 0.362, -0.872, 0.128, 0.478, -0.86, GREEN_D, HM.paint, 0.4)
  // --- 前後のファンの囲い（ダクト）・羽根・内側の光る縁・脚 ---
  for (const fz of H.fanZ) fan(g, fz)
  // 置くときの脚: 左右 2 本の低いそり（ステンレスの板と、黒いゴムの当たり。前と後ろは少し上がる）。ファンの囲いの外
  for (const sx of [1, -1]) {
    const x = sx * 0.27
    const rail: [number, number, number][] = [
      [x, 0.08, 0.74],
      [x, 0.022, 0.6],
      [x, 0.022, -0.62],
      [x, 0.08, -0.76],
    ]
    for (let i = 1; i < rail.length; i++) tube(g, rail[i - 1], rail[i], 0.02, STEEL, HM.metal, 0)
    g.boxMinMax(x - 0.022, 0.0, -0.58, x + 0.022, 0.012, 0.56, DARK, HM.dark, 0.1)
    // 胴へ上がる支え
    for (const z of [0.36, -0.4]) tube(g, [x, 0.022, z], [sx * 0.24, 0.17, z], 0.016, STEEL, HM.metal, 0)
  }
  return g.build()
}

/** 前の足よけ（床板の前の縁から立ち上がる、前へふくらんだ盾） */
function shield(g: GeoBuilder) {
  const NU = 12
  const NV = 10
  const T = 0.03
  const pt = (u: number, v: number, back: boolean): [number, number, number] => {
    // u: −1〜1（左右）、v: 0〜1（下から上）
    const hw = 0.27 - 0.08 * v * v
    const x = u * hw
    const y = H.deckY - 0.03 + v * (H.shieldTop - H.deckY + 0.03)
    // 上ほど花音の方へ少し倒れ、真ん中ほど前へふくらむ
    const z = 0.43 - 0.07 * v + 0.07 * (1 - u * u) * (1 - 0.3 * v) + (back ? -T : 0)
    return [x, y, z]
  }
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const u0 = -1 + (2 * i) / NU
      const u1 = -1 + (2 * (i + 1)) / NU
      const v0 = j / NV
      const v1 = (j + 1) / NV
      // 表（前向き）: クリームに、下の緑
      const front = v0 < 0.18 ? GREEN : v0 < 0.2 ? GREEN_D : CREAM
      g.quad(pt(u0, v0, false), pt(u1, v0, false), pt(u1, v1, false), pt(u0, v1, false), front, HM.paint, 0.75)
      // 裏（花音の方）: 緑
      g.quad(pt(u1, v0, true), pt(u0, v0, true), pt(u0, v1, true), pt(u1, v1, true), GREEN, HM.paint, 0.55)
    }
  }
  // 両わきと上の縁（ステンレスの見切り）
  for (let j = 0; j < NV; j++) {
    const v0 = j / NV
    const v1 = (j + 1) / NV
    for (const u of [-1, 1]) {
      const a = pt(u, v0, false)
      const b = pt(u, v1, false)
      const c = pt(u, v1, true)
      const d = pt(u, v0, true)
      if (u > 0) g.quad(d, c, b, a, STEEL, HM.metal, 0)
      else g.quad(a, b, c, d, STEEL, HM.metal, 0)
    }
  }
  for (let i = 0; i < NU; i++) {
    const u0 = -1 + (2 * i) / NU
    const u1 = -1 + (2 * (i + 1)) / NU
    g.quad(pt(u1, 1, false), pt(u1, 1, true), pt(u0, 1, true), pt(u0, 1, false), STEEL, HM.metal, 0)
  }
}

/** 床の下のダクトファン（囲いの輪・羽根の円盤・内側の光る縁・十字の支え） */
function fan(g: GeoBuilder, fz: number) {
  const R = H.fanR
  const m = new THREE.Matrix4().setPosition(0, 0.055, fz)
  // 囲い（外と内の壁・下の縁）
  g.lathe(
    [
      [R + 0.03, 0.09],
      [R + 0.04, 0.05],
      [R + 0.03, 0.0],
      [R + 0.005, -0.005],
    ],
    28,
    m,
    GREEN_D,
    HM.paint,
    0.5,
  )
  g.lathe(
    [
      [R, 0.1],
      [R, 0.0],
    ],
    28,
    m,
    '#2b2c2d',
    HM.dark,
    0.3,
    false,
  )
  // 内側の下の縁の光（回っている間だけ光る）
  g.lathe(
    [
      [R - 0.002, 0.012],
      [R - 0.002, 0.0],
    ],
    28,
    m,
    '#ffd9a8',
    HM.glow,
    0,
    false,
  )
  // 羽根の円盤（下から見える。羽根の模様はシェーダーで回す）と真ん中の軸
  g.cylinder([0, 0.095, fz], R - 0.004, 0.006, 24, '#3a3c3e', HM.fan, 0, true)
  g.cylinder([0, 0.088, fz], 0.045, 0.03, 14, STEEL, HM.metal, 0)
  // 十字の支え
  g.boxMinMax(-R, 0.115, fz - 0.008, R, 0.125, fz + 0.008, '#2b2c2d', HM.dark, 0.2)
  g.boxMinMax(-0.008, 0.115, fz - R, 0.008, 0.125, fz + R, '#2b2c2d', HM.dark, 0.2)
}

/* -------------------------------------------------------------------------- */
/* 置き場の台（ラボの外。H の字の代わりに、緑の輪と小さな充電の柱）                           */
/* -------------------------------------------------------------------------- */

/** 置き場・乗り場の台（局所: 原点 = 台の上の真ん中。+z = ホバーの前）。private = 花音の私物の置き場（充電の柱と名前の札） */
export function padGeometry(privatePad: boolean, depth = 0.06) {
  const g = new GeoBuilder()
  const R = 1.25
  // 台（御影石の円盤。斜面では下を地面にめり込ませる）と、縁の緑の輪・前の向きの矢じり
  g.cylinder([0, -depth, 0], R, depth + 0.01, 40, '#a9a59b', HM.paint, 0.15, true)
  g.lathe(
    [
      [R - 0.11, 0.0125],
      [R - 0.04, 0.0125],
    ],
    48,
    new THREE.Matrix4(),
    GREEN,
    HM.paint,
    0.3,
    false,
  )
  g.tri([0, 0.0127, R - 0.18], [0.09, 0.0127, R - 0.34], [-0.09, 0.0127, R - 0.34], CREAM, HM.paint, 0.3)
  if (privatePad) {
    // 充電の柱（右後ろ。クリームの柱・緑の帽子・暖色の小さな灯り）
    g.cylinder([-0.95, 0.0, -0.75], 0.07, 0.95, 14, CREAM, HM.paint, 0.6, false, 0.06)
    g.cylinder([-0.95, 0.95, -0.75], 0.085, 0.05, 14, GREEN, HM.paint, 0.6)
    g.box([-0.95, 0.78, -0.69], [0.05, 0.05, 0.02], '#ffc88a', HM.lamp, 2)
  }
  return g.build()
}

/* -------------------------------------------------------------------------- */
/* シェーダー                                                                     */
/* -------------------------------------------------------------------------- */

const VERTEX = /* glsl */ `
  attribute vec2 aMat;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vColor = color;
    vMat = aMat;
    vLocal = position;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAGMENT = /* glsl */ `
  ${COMMON}
  ${SKY}
  ${TOWN_LIGHT}
  ${TOWN_SHADOW}
  ${TOWN_LAMPS}
  uniform sampler2D uPlate;
  uniform float uPower;
  uniform float uLamp;
  uniform float uSpin;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    float id = floor(vMat.x + 0.5);
    float aux = vMat.y;
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);
    vec3 albedo = vColor;
    float gloss = 0.3;
    float metal = 0.0;
    vec3 emit = vec3(0.0);
    if (id < 0.5) {
      gloss = 0.25 + 0.6 * aux;
      albedo *= 0.97 + 0.04 * oNoise(vLocal.xz * 9.0 + vLocal.y * 3.0);
    } else if (id < 1.5) {
      gloss = 0.06 + 0.3 * aux;
      // 床板の筋（前後の向きの細い溝）
      if (aux > 0.9) albedo *= 0.75 + 0.35 * step(0.5, fract(vLocal.x * 38.0));
    } else if (id < 2.5) {
      metal = 1.0;
      gloss = aux > 0.5 ? 0.6 : 0.78;
      albedo *= 0.92 + 0.08 * oNoise(vLocal.xz * 40.0);
    } else if (id < 3.5) {
      gloss = 0.32;
      albedo *= 0.9 + 0.1 * oNoise(vLocal.xz * 60.0) + 0.05 * sin(vLocal.z * 90.0);
    } else if (id < 4.5) {
      albedo = vColor * 0.45;
      // 前照灯と尾灯は回っている間の夜、車幅灯は回っている間（昼も小さく）
      float on = aux < 0.5 ? uLamp : aux < 1.5 ? max(uLamp, uPower * 0.35) : uPower * (0.25 + 0.75 * uLamp);
      emit = vColor * (aux < 0.5 ? 0.05 + 3.2 * on : 0.08 + 2.6 * on);
      gloss = 0.7;
    } else if (id < 5.5) {
      albedo = vec3(0.12);
      emit = vColor * uPower * (0.6 + 1.6 * uLamp) * (0.9 + 0.1 * sin(uTime * 23.0));
    } else if (id < 6.5) {
      // 登録番号の板（白地に緑の字）
      float u = clamp((0.12 - vLocal.x) / 0.24, 0.0, 1.0);
      float v = clamp((vLocal.y - 0.37) / 0.1, 0.0, 1.0);
      float a = texture2D(uPlate, vec2(u, v)).a;
      albedo = mix(vec3(0.92, 0.91, 0.86), vec3(0.08, 0.27, 0.17), a);
      gloss = 0.35;
    } else if (id < 7.5) {
      // 計器（暗い地に電球色の速さの字と、残りの電池の帯）
      float bar = step(vLocal.x, -0.045 + 0.08 * (0.55 + 0.1 * sin(uTime * 0.05))) * step(-0.05, vLocal.x);
      albedo = vec3(0.02);
      emit = vec3(1.0, 0.62, 0.25) * uPower * (0.6 + 0.4 * bar) * 0.8;
      gloss = 0.6;
    } else {
      // 羽根（6 枚）の模様を回す
      vec2 q = vLocal.xz - vec2(0.0, vLocal.z > 0.0 ? ${H.fanZ[0].toFixed(3)} : ${H.fanZ[1].toFixed(3)});
      float ang = atan(q.y, q.x) + uSpin;
      float blade = smoothstep(0.35, 0.6, abs(sin(ang * 3.0)));
      float blur = clamp(uPower * 1.2, 0.0, 1.0);
      albedo *= mix(0.55 + 0.6 * blade, 0.85, blur);
      gloss = 0.3;
    }
    float sh = townShadow(vWorld, N);
    vec3 col = townLight(albedo * (1.0 - metal * 0.6), N, 1.0, sh);
    vec3 Hh = normalize(V + uSunDir);
    float pw = mix(10.0, 260.0, gloss);
    float f0 = mix(0.04, 0.9, metal);
    float fres = f0 + (1.0 - f0) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
    col += uSunLight * pow(max(dot(N, Hh), 0.0), pw) * (pw + 2.0) / 8.0 * fres * sh * max(dot(N, uSunDir), 0.0) * gloss;
    vec3 R = reflect(-V, N);
    vec3 env = R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.22 + uSunLight * 0.03, smoothstep(0.0, -0.25, R.y));
    col += env * fres * mix(gloss * 0.5, 0.9, metal) * mix(vec3(1.0), albedo * 2.0, metal);
    col += albedo * townLamps(vWorld, N) * 0.7;
    col = outdoorHaze(col, vWorld);
    col += emit * exp(-dist / (uHazeDist * 1.5));
    gl_FragColor = vec4(col, 1.0);
    ${TONE}
  }
`

/** 登録番号の板の絵（白地は透明、字だけ。1 行） */
function plateTexture(text: string) {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 212
  const g = c.getContext('2d')
  if (!g) return null
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 96px "Noto Sans CJK JP", "Noto Sans JP", sans-serif'
  g.fillText(text, 256, 112, 488)
  // 細い縁取り
  g.strokeStyle = '#ffffff'
  g.lineWidth = 6
  g.strokeRect(10, 10, c.width - 20, c.height - 20)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 4
  t.flipY = true
  return t
}

/** ホバーの描き方（1 台・乗り場の台）。uniforms を毎コマ書く */
export function createHoverMaterial() {
  return new THREE.ShaderMaterial({
    name: 'hover',
    vertexColors: true,
    side: THREE.DoubleSide,
    uniforms: {
      ...outdoorUniforms,
      ...townShadowUniforms,
      ...lampUniforms,
      uPlate: { value: plateTexture(H.plate) },
      uPower: { value: 0 },
      uLamp: { value: 0 },
      uSpin: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
}
