import * as THREE from 'three'
import { CABIN, CABIN_SPOTS } from '../../../core/soranowa'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { GeoBuilder } from '../site/builder'
import { TOWN_LIGHT } from './facades'
import { TOWN_LAMPS, lampUniforms } from './lamps'
import { TOWN_SHADOW, townShadowUniforms } from './shadows'

/**
 * 観覧車ソラノワの細かいゴンドラ（花音が乗る 1 基と、カメラの近くの数基。docs/design/town.md §17）。
 * 外の 60 基はふだん town/soranowa.ts の安い形（インスタンス）で描き、カメラから近い所と乗っている 1 基だけ、この形に替える。
 *
 * - 形（ゴンドラの局所。原点 = 吊る軸、扉は −z の面）: 丸みのある箱（角を丸めた断面を z へ押し出す）。白い腰・ぐるりのガラスの窓・
 *   5 色の屋根（安い形と同じ色）・窓の柱と桟・吊り金具と軸の筒・床の下の皿。中は床（黒いゴムの床）・長いす 2 列（x の両端。向かい合う）・
 *   手すり（ステンレス）・天井の丸い灯り・スピーカー・換気口。−z の面に引き戸（外へ出てから +x へ滑る）
 * - シェーダー: 町と同じ光（太陽・空・町の影・夜の灯りの表）に、中の天井の灯り（ゴンドラの局所で計算）と、夜のホイールの LED の光（ハブの向きから）を足す。
 *   ガラスは透けて、空と夜の LED と（中から見ると）中の灯りを映す
 * - インスタンスの iInfo = (中の灯り 0〜1, 色の種, ハブへの向き cos, ハブへの向き sin)
 */

/** 材質の番号（aMat.x） */
export const CM = {
  /** 外の塗装（白い腰・枠）。aux = つや */
  paint: 0,
  /** 中の FRP の壁・天井（明るい灰色のつや消し） */
  frp: 1,
  /** 長いすの布（紺のモケット） */
  fabric: 2,
  /** ステンレス（手すり・金具） */
  steel: 3,
  /** 床（黒いゴムの床。小さな丸い滑り止め） */
  floor: 4,
  /** 屋根の色（インスタンスの色の種で 5 色。安い形と同じ） */
  tint: 5,
  /** 灯り（中の灯りの点き具合で光る） */
  lamp: 6,
  /** 黒いゴム・樹脂。aux = つや */
  dark: 7,
  /** アルミの縞板（扉の敷居） */
  alum: 8,
} as const

const W = CABIN.halfW
const D = CABIN.halfD
const Y0 = CABIN.bottom
const Y1 = CABIN.top
const FLOOR = CABIN.floor
const CEIL = CABIN.ceiling
const IW = CABIN.innerW
const ID = CABIN.innerD
/** 窓の帯（外形の下から） */
const WIN0 = Y0 + CABIN.waist
const WIN1 = Y1 - 0.5
/** 扉の開口（−z の面） */
const DOOR_X = CABIN.doorW / 2
const DOOR_TOP = FLOOR + CABIN.doorH
/** 扉が開くときの動き（外へ出てから +x へ） */
export const DOOR_OPEN = { out: 0.05, slide: CABIN.doorW + 0.08 }

const WHITE = '#f2f0ea'
const FRP = '#dcdcd6'
const NAVY = '#24324a'
const STEEL = '#c4c9cc'

type V3 = [number, number, number]
type P2 = [number, number]

/** 断面（x, y。反時計回り）: 角を丸めた箱 */
function profile(): P2[] {
  const rb = 0.36
  const rt = 0.44
  const pts: P2[] = []
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 6) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  }
  arc(W - rb, Y0 + rb, rb, -Math.PI / 2, 0)
  arc(W - rt, Y1 - rt, rt, 0, Math.PI / 2)
  arc(-W + rt, Y1 - rt, rt, Math.PI / 2, Math.PI)
  arc(-W + rb, Y0 + rb, rb, Math.PI, Math.PI * 1.5)
  return pts
}

/** 凸の多角形を軸に平行な長方形で切る（Sutherland–Hodgman） */
function clipRect(poly: P2[], x0: number, x1: number, y0: number, y1: number): P2[] {
  const edges: [(p: P2) => boolean, (a: P2, b: P2) => P2][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ]
  let out = poly
  for (const [inside, cut] of edges) {
    const src = out
    out = []
    for (let i = 0; i < src.length; i++) {
      const a = src[i]
      const b = src[(i + 1) % src.length]
      const ia = inside(a)
      const ib = inside(b)
      if (ia) out.push(a)
      if (ia !== ib) out.push(cut(a, b))
    }
    if (out.length < 3) return []
  }
  return out
}

/** 断面の一部を z の面に貼る（front = +z を向く面） */
function capFace(g: GeoBuilder, poly: P2[], z: number, front: boolean, color: string, m: number, aux = 0) {
  if (poly.length < 3) return
  const c: P2 = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length]
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (front) g.tri([c[0], c[1], z], [a[0], a[1], z], [b[0], b[1], z], color, m, aux)
    else g.tri([c[0], c[1], z], [b[0], b[1], z], [a[0], a[1], z], color, m, aux)
  }
}

/** 管（2 点を結ぶ 8 角の筒） */
function tube(g: GeoBuilder, a: V3, b: V3, r: number, color: string, m: number, aux = 0, seg = 8) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = d.length()
  if (len < 1e-4) return
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  const mtx = new THREE.Matrix4().compose(new THREE.Vector3(...a), q, new THREE.Vector3(1, 1, 1))
  g.lathe(
    [
      [r, 0],
      [r, len],
    ],
    seg,
    mtx,
    color,
    m,
    aux,
  )
}

/** 縦の面（内向き・外向きの四角。a → b を下の辺、h0〜h1） */
function wallQuad(g: GeoBuilder, a: P2, b: P2, h0: number, h1: number, color: string, m: number, aux = 0) {
  // a, b は (x, z)。表（a → b を左から右に見る側）を向く面
  g.quad([b[0], h0, b[1]], [a[0], h0, a[1]], [a[0], h1, a[1]], [b[0], h1, b[1]], color, m, aux)
}

export interface CabinGeometry {
  body: THREE.BufferGeometry
  glass: THREE.BufferGeometry
  door: THREE.BufferGeometry
  doorGlass: THREE.BufferGeometry
}

/** 細かいゴンドラの形（ゴンドラの局所） */
export function cabinGeometry(): CabinGeometry {
  const g = new GeoBuilder()
  const gl = new GeoBuilder()
  const prof = profile()
  const n = prof.length
  // --- 外の殻（断面を z へ押し出した側面。腰 = 白、窓の帯 = ガラス（別の形）、上 = 屋根の色） ---
  const bands: [number, number, string, number, number][] = [
    [Y0 - 1, WIN0, WHITE, CM.paint, 0.75],
    [WIN1, Y1 + 1, '#ffffff', CM.tint, 0.7],
  ]
  for (let i = 0; i < n; i++) {
    const [ax, ay] = prof[i]
    const [bx, by] = prof[(i + 1) % n]
    for (const [b0, b1, c, m, aux] of bands) {
      const lo = Math.max(Math.min(ay, by), b0)
      const hi = Math.min(Math.max(ay, by), b1)
      if (hi - lo < 1e-4 && ay !== by) continue
      if (ay === by && (ay < b0 || ay > b1)) continue
      let pa: P2 = [ax, ay]
      let pb: P2 = [bx, by]
      if (ay !== by) {
        const ta = (lo - ay) / (by - ay)
        const tb = (hi - ay) / (by - ay)
        const p0: P2 = [ax + (bx - ax) * ta, lo]
        const p1: P2 = [ax + (bx - ax) * tb, hi]
        // 断面の向き（反時計回り）を保つ
        pa = by > ay ? p0 : p1
        pb = by > ay ? p1 : p0
      }
      g.quad([pa[0], pa[1], D], [pb[0], pb[1], D], [pb[0], pb[1], -D], [pa[0], pa[1], -D], c, m, aux)
    }
  }
  // --- 前後の面（+z: 腰・窓・上。−z: 扉の開口を切る） ---
  for (const z of [D, -D]) {
    const front = z > 0
    if (front) {
      capFace(g, clipRect(prof, -W, W, Y0 - 1, WIN0), z, true, WHITE, CM.paint, 0.75)
    } else {
      capFace(g, clipRect(prof, -W, -DOOR_X, Y0 - 1, WIN0), z, false, WHITE, CM.paint, 0.75)
      capFace(g, clipRect(prof, DOOR_X, W, Y0 - 1, WIN0), z, false, WHITE, CM.paint, 0.75)
      capFace(g, clipRect(prof, -DOOR_X, DOOR_X, Y0 - 1, FLOOR), z, false, WHITE, CM.paint, 0.75)
      // 扉の上の帯（窓の帯の高さ）
      capFace(g, clipRect(prof, -DOOR_X, DOOR_X, DOOR_TOP, WIN1), z, false, WHITE, CM.paint, 0.75)
    }
    capFace(g, clipRect(prof, -W, W, WIN1, Y1 + 1), z, front, '#ffffff', CM.tint, 0.7)
  }
  // --- 窓のガラス（外の面。ぐるり） ---
  const gx = W - 0.004
  gl.quad([gx, WIN0, D - 0.05], [gx, WIN0, -D + 0.05], [gx, WIN1, -D + 0.05], [gx, WIN1, D - 0.05], '#ffffff', 0)
  gl.quad([-gx, WIN0, -D + 0.05], [-gx, WIN0, D - 0.05], [-gx, WIN1, D - 0.05], [-gx, WIN1, -D + 0.05], '#ffffff', 0)
  const gz = D - 0.004
  gl.quad([-W + 0.05, WIN0, gz], [W - 0.05, WIN0, gz], [W - 0.05, WIN1, gz], [-W + 0.05, WIN1, gz], '#ffffff', 0)
  gl.quad([W - 0.05, WIN0, -gz], [DOOR_X + 0.05, WIN0, -gz], [DOOR_X + 0.05, WIN1, -gz], [W - 0.05, WIN1, -gz], '#ffffff', 0)
  gl.quad([-DOOR_X - 0.05, WIN0, -gz], [-W + 0.05, WIN0, -gz], [-W + 0.05, WIN1, -gz], [-DOOR_X - 0.05, WIN1, -gz], '#ffffff', 0)
  // --- 窓の枠: 四隅の柱・横の真ん中の桟・前後の桟・窓台と窓の上の縁（外） ---
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.boxMinMax(sx > 0 ? W - 0.1 : -W, WIN0, sz > 0 ? D - 0.1 : -D, sx > 0 ? W : -W + 0.1, WIN1, sz > 0 ? D : -D + 0.1, WHITE, CM.paint, 0.75)
  for (const sx of [-1, 1]) g.boxMinMax(sx * W - 0.03, WIN0, -0.025, sx * W + 0.03, WIN1, 0.025, WHITE, CM.paint, 0.75)
  for (const x of [-0.42, 0.42]) g.boxMinMax(x - 0.025, WIN0, D - 0.03, x + 0.025, WIN1, D + 0.01, WHITE, CM.paint, 0.75)
  for (const x of [-DOOR_X - 0.05, DOOR_X]) g.boxMinMax(x, FLOOR, -D - 0.01, x + 0.05, WIN1, -D + 0.04, WHITE, CM.paint, 0.75)
  // 窓台（外へ少し出る縁）と窓の上の縁（外まわりの細い帯。扉の所は切る）
  const rim = (y0: number, y1: number, o: number) => {
    g.boxMinMax(W - 0.02, y0, -D - o, W + o, y1, D + o, '#e6e4de', CM.paint, 0.8)
    g.boxMinMax(-W - o, y0, -D - o, -W + 0.02, y1, D + o, '#e6e4de', CM.paint, 0.8)
    g.boxMinMax(-W, y0, D - 0.02, W, y1, D + o, '#e6e4de', CM.paint, 0.8)
    g.boxMinMax(-W, y0, -D - o, -DOOR_X - 0.05, y1, -D + 0.02, '#e6e4de', CM.paint, 0.8)
    g.boxMinMax(DOOR_X + 0.05, y0, -D - o, W, y1, -D + 0.02, '#e6e4de', CM.paint, 0.8)
  }
  rim(WIN0 - 0.03, WIN0, 0.014)
  rim(WIN1, WIN1 + 0.035, 0.01)
  // --- 中: 床・腰の壁・窓台・窓の上・天井 ---
  g.quad([-IW, FLOOR, ID], [IW, FLOOR, ID], [IW, FLOOR, -ID], [-IW, FLOOR, -ID], '#3a3d40', CM.floor, 0)
  // 腰の壁（内向き）。−z は扉の開口で切る
  wallQuad(g, [-IW, -ID], [-IW, ID], FLOOR, WIN0, FRP, CM.frp)
  wallQuad(g, [IW, ID], [IW, -ID], FLOOR, WIN0, FRP, CM.frp)
  wallQuad(g, [-IW, ID], [IW, ID], FLOOR, WIN0, FRP, CM.frp)
  wallQuad(g, [IW, -ID], [DOOR_X, -ID], FLOOR, WIN0, FRP, CM.frp)
  wallQuad(g, [-DOOR_X, -ID], [-IW, -ID], FLOOR, WIN0, FRP, CM.frp)
  // 窓台（中。上向き）と窓の上（下向き）
  const ledge = (inner: [P2, P2], outer: [P2, P2], y: number, up: boolean, color: string) => {
    const [a, b] = inner
    const [c, d] = outer
    if (up) g.quad([a[0], y, a[1]], [b[0], y, b[1]], [d[0], y, d[1]], [c[0], y, c[1]], color, CM.frp)
    else g.quad([c[0], y, c[1]], [d[0], y, d[1]], [b[0], y, b[1]], [a[0], y, a[1]], color, CM.frp)
  }
  for (const [y, up] of [
    [WIN0, true],
    [WIN1, false],
  ] as const) {
    const col = up ? '#e8e6e0' : '#d2d2cc'
    ledge([[IW, ID], [IW, -ID]], [[W - 0.01, D - 0.01], [W - 0.01, -D + 0.01]], y, up, col)
    ledge([[-IW, -ID], [-IW, ID]], [[-W + 0.01, -D + 0.01], [-W + 0.01, D - 0.01]], y, up, col)
    ledge([[-IW, ID], [IW, ID]], [[-W + 0.01, D - 0.01], [W - 0.01, D - 0.01]], y, up, col)
    if (up) {
      ledge([[IW, -ID], [DOOR_X, -ID]], [[W - 0.01, -D + 0.01], [DOOR_X, -D + 0.01]], y, up, col)
      ledge([[-DOOR_X, -ID], [-IW, -ID]], [[-DOOR_X, -D + 0.01], [-W + 0.01, -D + 0.01]], y, up, col)
    } else ledge([[IW, -ID], [-IW, -ID]], [[W - 0.01, -D + 0.01], [-W + 0.01, -D + 0.01]], y, up, col)
  }
  // 窓の上から天井までの壁と天井
  wallQuad(g, [-IW, -ID], [-IW, ID], WIN1, CEIL, FRP, CM.frp)
  wallQuad(g, [IW, ID], [IW, -ID], WIN1, CEIL, FRP, CM.frp)
  wallQuad(g, [-IW, ID], [IW, ID], WIN1, CEIL, FRP, CM.frp)
  wallQuad(g, [IW, -ID], [-IW, -ID], WIN1, CEIL, FRP, CM.frp)
  g.quad([-IW, CEIL, -ID], [IW, CEIL, -ID], [IW, CEIL, ID], [-IW, CEIL, ID], '#eeeeea', CM.frp)
  // 扉の開口の見込み（左右と上）と、扉の上の中の壁
  wallQuad(g, [-DOOR_X, -D], [-DOOR_X, -ID], FLOOR, DOOR_TOP, '#e6e4de', CM.paint, 0.5)
  wallQuad(g, [DOOR_X, -ID], [DOOR_X, -D], FLOOR, DOOR_TOP, '#e6e4de', CM.paint, 0.5)
  g.quad([-DOOR_X, DOOR_TOP, -D], [DOOR_X, DOOR_TOP, -D], [DOOR_X, DOOR_TOP, -ID], [-DOOR_X, DOOR_TOP, -ID], '#e6e4de', CM.paint, 0.5)
  wallQuad(g, [DOOR_X, -ID], [-DOOR_X, -ID], DOOR_TOP, WIN1, FRP, CM.frp)
  // 敷居（アルミの縞板）
  g.boxMinMax(-DOOR_X, FLOOR - 0.01, -D, DOOR_X, FLOOR + 0.006, -ID + 0.04, '#b8bcbe', CM.alum, 0)
  // --- 長いす（x の両端で向かい合う）: 白い台・紺の座面と背もたれ・座面の前の縁 ---
  for (const sx of [1, -1]) {
    const xa = (v: number) => sx * v
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string, m: number, aux = 0) => g.boxMinMax(Math.min(xa(x0), xa(x1)), y0, z0, Math.max(xa(x0), xa(x1)), y1, z1, c, m, aux)
    box(CABIN.benchX + 0.02, IW, FLOOR, FLOOR + 0.35, -0.99, 0.99, '#e2e2dc', CM.frp)
    box(CABIN.benchX, IW - 0.01, FLOOR + 0.35, FLOOR + 0.42, -0.97, 0.97, NAVY, CM.fabric, 0)
    box(CABIN.benchX - 0.012, CABIN.benchX + 0.05, FLOOR + 0.34, FLOOR + 0.415, -0.96, 0.96, NAVY, CM.fabric, 0)
    box(IW - 0.1, IW - 0.01, FLOOR + 0.46, FLOOR + 0.82, -0.95, 0.95, NAVY, CM.fabric, 0)
    box(IW - 0.07, IW, FLOOR + 0.42, FLOOR + 0.46, -0.95, 0.95, '#d0d0ca', CM.frp)
    // 座面の下の換気の口
    box(CABIN.benchX + 0.015, CABIN.benchX + 0.03, FLOOR + 0.08, FLOOR + 0.16, -0.5, 0.5, '#2a2c2e', CM.dark, 0.2)
    // 手すり（窓の下。背もたれの上）
    tube(g, [xa(IW - 0.07), FLOOR + 0.98, -0.85], [xa(IW - 0.07), FLOOR + 0.98, 0.85], 0.017, STEEL, CM.steel, 0.9)
    for (const z of [-0.85, 0.85]) tube(g, [xa(IW), FLOOR + 0.98, z], [xa(IW - 0.075), FLOOR + 0.98, z], 0.012, STEEL, CM.steel, 0.9)
  }
  // 前後の壁の手すり（+z は窓の下を横に、−z は扉の両わきの縦の握り棒）
  tube(g, [-0.62, FLOOR + 0.98, ID - 0.07], [0.62, FLOOR + 0.98, ID - 0.07], 0.017, STEEL, CM.steel, 0.9)
  for (const x of [-0.62, 0.62]) tube(g, [x, FLOOR + 0.98, ID], [x, FLOOR + 0.98, ID - 0.075], 0.012, STEEL, CM.steel, 0.9)
  for (const x of [-DOOR_X - 0.11, DOOR_X + 0.11]) {
    tube(g, [x, FLOOR + 0.62, -ID + 0.07], [x, FLOOR + 1.78, -ID + 0.07], 0.017, STEEL, CM.steel, 0.9)
    for (const y of [FLOOR + 0.62, FLOOR + 1.78]) tube(g, [x, y, -ID], [x, y, -ID + 0.075], 0.012, STEEL, CM.steel, 0.9)
  }
  // --- 天井: 丸い灯り（光る板と縁）・スピーカー・換気口 ---
  const lp = CABIN_SPOTS.lamp
  const lampY = FLOOR + lp[1]
  g.cylinder([0, CEIL - 0.03, 0], 0.25, 0.03, 28, '#d8dadb', CM.steel, 0.7, false)
  g.cylinder([0, CEIL - 0.035, 0], 0.215, 0.012, 28, '#fff3de', CM.lamp, 1, true)
  void lampY
  g.cylinder([0.62, CEIL - 0.008, 0.62], 0.075, 0.008, 16, '#3a3c3e', CM.dark, 0.3, true)
  for (const sx of [-1, 1]) g.boxMinMax(sx * 0.95 - 0.12, CEIL - 0.008, -0.55, sx * 0.95 + 0.12, CEIL, 0.55, '#3a3c3e', CM.dark, 0.2)
  // --- 外: 吊り金具（二つの板と軸の筒）・屋根の台・換気のふた・床の下の皿・扉の上のレール ---
  g.boxMinMax(-0.36, Y1 - 0.02, -0.3, 0.36, Y1 + 0.05, 0.3, '#d6d8d8', CM.steel, 0.6)
  for (const sx of [-1, 1]) g.boxMinMax(sx * 0.13 - 0.025, Y1, -0.17, sx * 0.13 + 0.025, 0.08, 0.17, '#cfd2d4', CM.steel, 0.65)
  tube(g, [0, 0, -0.32], [0, 0, 0.32], 0.11, '#b8bcbe', CM.steel, 0.7, 12)
  g.boxMinMax(-0.18, Y1 + 0.05, 0.35, 0.18, Y1 + 0.16, 0.62, '#e6e4de', CM.paint, 0.6)
  g.boxMinMax(-W + 0.3, Y0 - 0.05, -D + 0.25, W - 0.3, Y0 + 0.01, D - 0.25, '#2a2c2e', CM.dark, 0.2)
  g.boxMinMax(-DOOR_X - 0.08, DOOR_TOP + 0.03, -D - 0.075, DOOR_X + DOOR_OPEN.slide + 0.06, DOOR_TOP + 0.085, -D - 0.02, STEEL, CM.steel, 0.8)
  // 前の面の下の換気の口と、小さな番号の板の地
  for (let i = 0; i < 5; i++) g.boxMinMax(-0.3 + i * 0.15 - 0.05, Y0 + 0.55, D - 0.003, -0.3 + i * 0.15 + 0.05, Y0 + 0.58, D + 0.006, '#3a3c3e', CM.dark, 0.2)

  // --- 扉（引き戸。閉じた位置。外の面の少し外。腰は白い板、上はガラス、戸先の黒いゴムと縦の取っ手） ---
  const dg = new GeoBuilder()
  const dgl = new GeoBuilder()
  const dz0 = -D - 0.055
  const dz1 = -D - 0.012
  const x0 = -DOOR_X - 0.02
  const x1 = DOOR_X + 0.02
  dg.boxMinMax(x0, FLOOR + 0.01, dz0, x1, WIN0, dz1, WHITE, CM.paint, 0.75)
  dg.boxMinMax(x0, WIN0, dz0, x0 + 0.06, DOOR_TOP, dz1, WHITE, CM.paint, 0.75)
  dg.boxMinMax(x1 - 0.06, WIN0, dz0, x1, DOOR_TOP, dz1, WHITE, CM.paint, 0.75)
  dg.boxMinMax(x0, DOOR_TOP - 0.08, dz0, x1, DOOR_TOP, dz1, WHITE, CM.paint, 0.75)
  dg.boxMinMax(x0 - 0.012, FLOOR + 0.01, dz0 + 0.005, x0, DOOR_TOP, dz1 - 0.005, '#1c1c1c', CM.dark, 0.3)
  dg.boxMinMax(x0 + 0.05, FLOOR + 0.9, dz0 - 0.03, x0 + 0.075, FLOOR + 1.3, dz0, STEEL, CM.steel, 0.9)
  dg.boxMinMax(x0 + 0.05, FLOOR + 0.9, dz1, x0 + 0.075, FLOOR + 1.3, dz1 + 0.03, STEEL, CM.steel, 0.9)
  const dgz = (dz0 + dz1) / 2
  dgl.quad([x1 - 0.06, WIN0, dgz], [x0 + 0.06, WIN0, dgz], [x0 + 0.06, DOOR_TOP - 0.08, dgz], [x1 - 0.06, DOOR_TOP - 0.08, dgz], '#ffffff', 0)
  return { body: g.build(), glass: gl.build(), door: dg.build(), doorGlass: dgl.build() }
}

/* -------------------------------------------------------------------------- */
/* シェーダー                                                                     */
/* -------------------------------------------------------------------------- */

export const cabinUniforms = {
  /** 夜のホイールの LED の明るさ（outdoor.soranowa） */
  uLed: { value: 0 },
}

const CABIN_GLSL = /* glsl */ `
  const vec3 CAB_LAMP = vec3(0.0, ${(CEIL - 0.06).toFixed(3)}, 0.0);
  const vec3 CAB_LAMP_C = vec3(1.0, 0.88, 0.7) * 1.9;
  const vec3 LED_C = vec3(1.0, 0.86, 0.64);
  bool cabInside(vec3 p) {
    return abs(p.x) < ${(IW + 0.015).toFixed(3)} && abs(p.z) < ${(ID + 0.015).toFixed(3)} && p.y > ${(FLOOR - 0.02).toFixed(3)} && p.y < ${(CEIL + 0.02).toFixed(3)};
  }
`

const VERTEX = /* glsl */ `
  attribute vec2 aMat;
  attribute vec4 iInfo;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec4 vInfo;
  varying vec3 vHub;
  varying vec3 vCamLocal;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vWorld = wp.xyz;
    mat3 r = mat3(m);
    vNormal = normalize(r * normal);
    vColor = color;
    vMat = aMat;
    vLocal = position;
    vLocalN = normal;
    vInfo = iInfo;
    vHub = normalize(r * vec3(iInfo.z, iInfo.w, 0.0));
    // カメラの位置（ゴンドラの局所。回転と平行移動だけ）
    vCamLocal = transpose(r) * (cameraPosition - m[3].xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAGMENT = /* glsl */ `
  ${COMMON}
  ${SKY}
  ${TOWN_LIGHT}
  ${TOWN_SHADOW}
  ${TOWN_LAMPS}
  ${CABIN_GLSL}
  uniform float uLed;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec4 vInfo;
  varying vec3 vHub;
  varying vec3 vCamLocal;
  vec3 envRefl(vec3 R) {
    return R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.22 + uSunLight * 0.03, smoothstep(0.0, -0.25, R.y));
  }
  void main() {
    vec3 N = normalize(vNormal);
    vec3 Nl = normalize(vLocalN);
    if (!gl_FrontFacing) { N = -N; Nl = -Nl; }
    float id = floor(vMat.x + 0.5);
    float aux = vMat.y;
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);
    vec3 albedo = vColor;
    float gloss = 0.1;
    float metal = 0.0;
    vec3 emit = vec3(0.0);
    bool inside = cabInside(vLocal);
    float lampOn = vInfo.x;
    vec3 an = abs(vLocalN);
    vec2 uv = an.y > 0.7 ? vLocal.xz : an.x > an.z ? vLocal.zy : vLocal.xy;
    if (id < 0.5) {
      gloss = 0.35 + 0.55 * aux;
      // 外の塗装のわずかなむら・下ほどの汚れ
      albedo *= 0.97 + 0.05 * oNoise(uv * 3.0 + vInfo.y * 9.0);
      albedo *= 1.0 - 0.12 * (1.0 - smoothstep(${Y0.toFixed(2)}, ${(Y0 + 0.6).toFixed(2)}, vLocal.y));
    } else if (id < 1.5) {
      gloss = 0.18;
      albedo *= 0.96 + 0.04 * oNoise(uv * 6.0);
    } else if (id < 2.5) {
      // モケット（細かい織りの目と、すこし明るい糸）
      float weave = 0.5 + 0.5 * sin(uv.x * 900.0) * sin(uv.y * 900.0);
      albedo *= 0.82 + 0.22 * weave + 0.1 * oNoise(uv * 40.0);
      gloss = 0.02;
    } else if (id < 3.5) {
      metal = 1.0;
      gloss = 0.75;
      albedo *= 0.92 + 0.08 * oNoise(vec2(uv.x * 2.0, uv.y * 60.0));
    } else if (id < 4.5) {
      // ゴムの床（丸い滑り止めの点）
      vec2 q = fract(vLocal.xz * 9.0) - 0.5;
      float dotm = 1.0 - smoothstep(0.17, 0.22, length(q));
      albedo *= 0.85 + 0.25 * dotm + 0.1 * oNoise(vLocal.xz * 7.0);
      gloss = 0.08 + 0.25 * dotm;
    } else if (id < 5.5) {
      // 屋根の色（安い形のゴンドラと同じ 5 色）
      float k = floor(fract(vInfo.y * 5.0 + 0.01) * 5.0);
      albedo = k < 0.5 ? vec3(0.62, 0.16, 0.14) : k < 1.5 ? vec3(0.14, 0.3, 0.52) : k < 2.5 ? vec3(0.62, 0.5, 0.12) : k < 3.5 ? vec3(0.16, 0.42, 0.26) : vec3(0.55, 0.3, 0.42);
      gloss = 0.3 + 0.6 * aux;
    } else if (id < 6.5) {
      albedo = vColor * 0.55;
      emit = vColor * (0.15 + 3.2 * lampOn);
      gloss = 0.5;
    } else if (id < 7.5) {
      gloss = 0.05 + 0.4 * aux;
      albedo *= 0.9 + 0.1 * oNoise(uv * 20.0);
    } else {
      // アルミの縞板
      metal = 1.0;
      gloss = 0.45;
      float st = step(0.5, fract((vLocal.x + vLocal.z) * 14.0));
      albedo *= 0.8 + 0.2 * st;
    }
    // 中は天井と壁に囲まれて空の光が少ない（ガラスの窓は四方にある）
    float ao = inside ? (Nl.y < -0.5 ? 0.35 : Nl.y > 0.5 ? 0.6 : 0.68) : 1.0;
    // 中の隅・床の近くは暗く
    if (inside) ao *= 0.8 + 0.2 * smoothstep(0.0, 0.25, min(${IW.toFixed(3)} - abs(vLocal.x), ${ID.toFixed(3)} - abs(vLocal.z)));
    float sh = townShadow(vWorld, N);
    vec3 col = townLight(albedo * (1.0 - metal * 0.6), N, ao, sh);
    vec3 H = normalize(V + uSunDir);
    float pw = mix(10.0, 260.0, gloss);
    float fres = mix(0.04, 0.9, metal) + (1.0 - mix(0.04, 0.9, metal)) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
    col += uSunLight * pow(max(dot(N, H), 0.0), pw) * (pw + 2.0) / 8.0 * fres * sh * max(dot(N, uSunDir), 0.0) * gloss;
    vec3 R = reflect(-V, N);
    vec3 env = envRefl(R);
    // 中の面に映るのは、ほとんど中の壁と天井（窓の外の空は一部）
    if (inside) env *= 0.45;
    col += env * fres * mix(gloss * 0.5, 0.9, metal) * mix(vec3(1.0), albedo * 2.0, metal) * ao;
    // 中の天井の灯り（ゴンドラの局所で。中と、窓の枠のまわり）
    vec3 Lv = CAB_LAMP - vLocal;
    float d2 = dot(Lv, Lv);
    vec3 Ll = Lv * inversesqrt(max(d2, 1e-4));
    float ndl = max(dot(Nl, Ll), 0.0);
    float lampK = (inside ? 1.0 : 0.1 * smoothstep(${(W + 0.2).toFixed(2)}, ${(W - 0.2).toFixed(2)}, max(abs(vLocal.x), abs(vLocal.z))));
    col += albedo * CAB_LAMP_C * lampOn * (ndl * 0.75 + 0.25) / (d2 * 1.4 + 0.35) * lampK;
    // 照り返し（中の白い壁から）
    col += albedo * CAB_LAMP_C * lampOn * 0.06 * (inside ? 1.0 : 0.0);
    // 夜のホイールの LED（外周とスポークの光。ハブの向きから。中は窓から入る分）
    float ledFace = 0.3 + 0.7 * max(dot(N, vHub), 0.0);
    col += albedo * LED_C * uLed * ledFace * (inside ? 0.05 : 0.12);
    // 夜: 町の灯り（外の面）。白いつやのある塗装は灯りの表のままだと白く飛ぶ（乗り場の屋根の灯りのすぐ下を通る）ので弱める
    if (!inside) col += albedo * townLamps(vWorld, N) * 0.45;
    col = outdoorHaze(col, vWorld);
    col += emit * exp(-dist / (uHazeDist * 1.5));
    gl_FragColor = vec4(col, 1.0);
    ${TONE}
  }
`

/** 細かいゴンドラの不透明な面のシェーダー（インスタンス） */
export function createCabinMaterial() {
  return new THREE.ShaderMaterial({
    name: 'soranowaCabin',
    vertexColors: true,
    // 中の面と外の面の向きを取り違えても欠けないように両面（裏から見た面は法線を返す）
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...lampUniforms, ...cabinUniforms },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
}

/** 細かいゴンドラのガラス（透ける。空・夜の LED・中の灯りを映す） */
export function createCabinGlassMaterial() {
  return new THREE.ShaderMaterial({
    name: 'soranowaCabinGlass',
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, ...cabinUniforms },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      ${CABIN_GLSL}
      uniform float uLed;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec2 vMat;
      varying vec3 vLocal;
      varying vec3 vLocalN;
      varying vec4 vInfo;
      varying vec3 vHub;
      varying vec3 vCamLocal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float cosv = max(dot(N, V), 0.0);
        float fres = 0.04 + 0.96 * pow(clamp(1.0 - cosv, 0.0, 1.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 refl = R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.22, smoothstep(0.0, -0.25, R.y));
        refl += uSunLight * pow(max(dot(R, uSunDir), 0.0), 900.0) * 30.0 * smoothstep(-0.02, 0.05, uSunDir.y);
        // 夜の LED（外周の光の帯とスポークの光の筋が、ハブの側のガラスに映る）
        float toward = dot(R, vHub);
        float band = smoothstep(0.55, 0.95, toward) * (0.6 + 0.4 * sin(R.y * 60.0 + R.x * 23.0));
        refl += LED_C * uLed * (0.5 * smoothstep(0.0, 0.9, toward) + 1.6 * band);
        bool camIn = cabInside(vCamLocal);
        // 中から見ると、夜は中の灯りに照らされた中が映る
        vec3 room = vec3(0.86, 0.84, 0.8) * vInfo.x * 0.32;
        float a = clamp(0.05 + fres * 0.85, 0.0, 0.92);
        vec3 col = refl;
        if (camIn) {
          col = mix(refl, room + refl * 0.4, clamp(vInfo.x * 0.75, 0.0, 0.75));
          a = clamp(a + vInfo.x * 0.08 * (1.0 - uSkyLight.g * 2.0), 0.0, 0.92);
        }
        // うすい灰青の色（合わせガラスの縁の色）
        col = mix(vec3(0.03, 0.04, 0.045), col, 0.92);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, a);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* 細かいゴンドラの入れ物                                                           */
/* -------------------------------------------------------------------------- */

const _dm = new THREE.Matrix4()

/** 細かいゴンドラ（最大 capacity 基）。毎コマ begin → add（ホイールの局所の行列・iInfo・扉の開き具合）→ end */
export class DetailedCabins {
  readonly meshes: THREE.InstancedMesh[]
  private body: THREE.InstancedMesh
  private glass: THREE.InstancedMesh
  private door: THREE.InstancedMesh
  private doorGlass: THREE.InstancedMesh
  private infos: THREE.InstancedBufferAttribute[] = []
  private count = 0
  readonly material: THREE.ShaderMaterial
  readonly glassMaterial: THREE.ShaderMaterial

  constructor(capacity: number) {
    const geo = cabinGeometry()
    this.material = createCabinMaterial()
    this.glassMaterial = createCabinGlassMaterial()
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
      const info = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
      info.setUsage(THREE.DynamicDrawUsage)
      g.setAttribute('iInfo', info)
      if (!g.getAttribute('color')) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3))
      if (!g.getAttribute('aMat')) g.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
      const mesh = new THREE.InstancedMesh(g, m, capacity)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.name = `soranowa:cabin:${name}`
      this.infos.push(info)
      return mesh
    }
    this.body = mk(geo.body, this.material, 'body')
    this.door = mk(geo.door, this.material, 'door')
    this.glass = mk(geo.glass, this.glassMaterial, 'glass')
    this.doorGlass = mk(geo.doorGlass, this.glassMaterial, 'doorGlass')
    this.glass.renderOrder = 22
    this.doorGlass.renderOrder = 22
    this.meshes = [this.body, this.door, this.glass, this.doorGlass]
  }

  begin() {
    this.count = 0
  }

  /** 1 基（m = ゴンドラの局所 → ホイールの局所の行列、door = 扉の開き具合 0〜1） */
  add(m: THREE.Matrix4, info: readonly [number, number, number, number], door: number) {
    const i = this.count
    if (i >= this.infos[0].count) return false
    this.body.setMatrixAt(i, m)
    this.glass.setMatrixAt(i, m)
    // 扉: 外へ出てから +x へ滑る（開き具合の前の 2 割で外へ、あとの 8 割で滑る）
    const e = door * door * (3 - 2 * door)
    const out = Math.min(1, e / 0.2) * DOOR_OPEN.out
    const slide = Math.max(0, (e - 0.2) / 0.8) * DOOR_OPEN.slide
    _dm.makeTranslation(slide, 0, -out).premultiply(m)
    this.door.setMatrixAt(i, _dm)
    this.doorGlass.setMatrixAt(i, _dm)
    for (const a of this.infos) a.setXYZW(i, info[0], info[1], info[2], info[3])
    this.count++
    return true
  }

  end() {
    for (const mesh of this.meshes) {
      mesh.count = this.count
      mesh.visible = this.count > 0
      if (this.count) {
        mesh.instanceMatrix.clearUpdateRanges()
        mesh.instanceMatrix.addUpdateRange(0, this.count * 16)
        mesh.instanceMatrix.needsUpdate = true
      }
    }
    for (const a of this.infos) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, this.count * 4)
      a.needsUpdate = true
    }
  }
}
