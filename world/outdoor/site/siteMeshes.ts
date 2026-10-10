import * as THREE from 'three'
import {
  DOOR,
  ENTRY_STAIR,
  LOOKOUT,
  LOOKOUT_BENCHES,
  LOOKOUT_SCOPE,
  PARABOLA,
  PARABOLA_PAD,
  RAMP,
  SHELL,
  STAIR_BOTTOM,
  TERRACE,
  TERRACE_BENCHES,
  TERRACE_PLANTERS,
  WEST_LANDING,
  type SurfaceKind,
} from '../../../core/site'
import { GeoBuilder, MAT } from './builder'
import { designedY, lookoutPoint, naturalY, rampY, site, type LivePath } from './siteModel'
import { buildParabola } from './parabola'
import { townData } from '../town/townData'

/**
 * ラボの前のセットの形: テラス（土間・擁壁・ガラスの手すり）・石段（踏み石・袖壁・手すり・足元灯）・スロープ・小道（舗装と縁石）・
 * 見晴らし台（石畳・擁壁・手すり・ベンチ・望遠鏡）・大パラボラの前の広場・街灯・ベンチ・植え込みの箱。
 * 形は site（siteModel.ts）の高さに合わせる（地図データを読んだあとに作る）
 */

const SLAB = '#8d8a83'
const WALLC = '#8f8c85'
const GRANITE = '#b3b0aa'
const GRANITE_D = '#8f8c86'
const RAIL = '#2c3034'
const STEEL = '#c3c7ca'
const WOOD = '#6e5a48'
const POLE = '#33383d'

export interface SiteParts {
  solid: GeoBuilder
  /** ガラスの手すりの板 */
  glass: GeoBuilder
  /** 夜に灯る電球色の物（街灯の灯具・足元灯・手すりの下の灯り） */
  warm: GeoBuilder
  /** 植え込みの低木（平面座標・根元の標高・高さ・幅の半分）。trees.ts の shrubMesh で描く */
  shrubs: { x: number; y: number; z: number; h: number; r: number; seed: number }[]
}

const SURFACE: Record<SurfaceKind, { mat: number; color: string; curb: 'granite' | 'wood' | 'tall' }> = {
  slab: { mat: MAT.slab, color: '#9d988e', curb: 'granite' },
  stone: { mat: MAT.slab, color: '#9d988e', curb: 'granite' },
  cobble: { mat: MAT.cobble, color: '#958d80', curb: 'granite' },
  gravel: { mat: MAT.gravel, color: '#a39a8a', curb: 'wood' },
  asphalt: { mat: MAT.asphalt, color: '#3c3d3f', curb: 'tall' },
}

const hash = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/**
 * 折れ線に沿った壁（縁石・袖壁・擁壁）。pts = 中心線（x, z）、thick = 厚み、top・bottom = 点ごとの上端・下端の高さ。
 * 上の面・左右の面・両端の面を作る
 */
function wallAlong(b: GeoBuilder, pts: [number, number][], thick: number, top: number[], bottom: number[], color: string, mat: number, aux = 0, caps = true) {
  const n = pts.length
  if (n < 2) return
  const side = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]
    const c = pts[Math.min(n - 1, i + 1)]
    const dx = c[0] - a[0]
    const dz = c[1] - a[1]
    const l = Math.hypot(dx, dz) || 1
    return [-dz / l, dx / l] as [number, number]
  })
  const h = thick / 2
  const L = (i: number, y: number) => [pts[i][0] + side[i][0] * h, y, pts[i][1] + side[i][1] * h] as const
  const R = (i: number, y: number) => [pts[i][0] - side[i][0] * h, y, pts[i][1] - side[i][1] * h] as const
  for (let i = 1; i < n; i++) {
    b.quad(L(i - 1, top[i - 1]), L(i, top[i]), R(i, top[i]), R(i - 1, top[i - 1]), color, mat, aux)
    b.quad(L(i, bottom[i]), L(i, top[i]), L(i - 1, top[i - 1]), L(i - 1, bottom[i - 1]), color, mat, aux)
    b.quad(R(i - 1, bottom[i - 1]), R(i - 1, top[i - 1]), R(i, top[i]), R(i, bottom[i]), color, mat, aux)
  }
  if (caps) {
    b.quad(R(0, bottom[0]), L(0, bottom[0]), L(0, top[0]), R(0, top[0]), color, mat, aux)
    b.quad(L(n - 1, bottom[n - 1]), R(n - 1, bottom[n - 1]), R(n - 1, top[n - 1]), L(n - 1, top[n - 1]), color, mat, aux)
  }
}

/** 手すり（柱 spacing m ごとと、上の笠木）。pts = 柱の並ぶ線、base = 点ごとの床の高さ */
function railing(b: GeoBuilder, glass: GeoBuilder | null, warm: GeoBuilder | null, pts: [number, number][], base: (x: number, z: number) => number, height: number, spacing = 1.5) {
  // 折れ線を柱の間隔で区切る
  const posts: [number, number, number][] = []
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1]
    const [bx, bz] = pts[i]
    const len = Math.hypot(bx - ax, bz - az)
    const k = Math.max(1, Math.round(len / spacing))
    for (let j = i === 1 ? 0 : 1; j <= k; j++) {
      const x = ax + ((bx - ax) * j) / k
      const z = az + ((bz - az) * j) / k
      posts.push([x, base(x, z), z])
    }
  }
  for (const [x, y, z] of posts) b.box([x, y + height / 2, z], [0.05, height, 0.05], RAIL, MAT.paint, 0.5)
  for (let i = 1; i < posts.length; i++) {
    const a = posts[i - 1]
    const c = posts[i]
    b.beam([a[0], a[1] + height, a[2]], [c[0], c[1] + height, c[2]], 0.055, STEEL, MAT.steel, 0, 0.04)
    if (glass) {
      // ガラスの板（柱の間。下は床から 0.06m 上）
      const dx = c[0] - a[0]
      const dz = c[2] - a[2]
      const l = Math.hypot(dx, dz) || 1
      const ux = (dx / l) * 0.03
      const uz = (dz / l) * 0.03
      glass.quad([a[0] + ux, a[1] + 0.06, a[2] + uz], [c[0] - ux, c[1] + 0.06, c[2] - uz], [c[0] - ux, c[1] + height - 0.05, c[2] - uz], [a[0] + ux, a[1] + height - 0.05, a[2] + uz], '#ffffff', 0)
      glass.quad([c[0] - ux, c[1] + 0.06, c[2] - uz], [a[0] + ux, a[1] + 0.06, a[2] + uz], [a[0] + ux, a[1] + height - 0.05, a[2] + uz], [c[0] - ux, c[1] + height - 0.05, c[2] - uz], '#ffffff', 0)
    } else {
      // 中桟 2 本
      for (const f of [0.38, 0.7]) b.beam([a[0], a[1] + height * f, a[2]], [c[0], c[1] + height * f, c[2]], 0.025, RAIL, MAT.paint, 0.4)
    }
    // 笠木の下の灯り（夜）
    if (warm) warm.beam([a[0], a[1] + height - 0.035, a[2]], [c[0], c[1] + height - 0.035, c[2]], 0.012, '#000', 0, 0, 0.008)
  }
}

/** ベンチ（打ち放しの台 2 つに木の座面）。中心・長さ・向き（座面の長い向きが x 軸のとき yaw = 0）・床の高さ */
function bench(b: GeoBuilder, x: number, z: number, y: number, length: number, yaw: number) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const at = (u: number, v: number) => [x + u * c + v * s, z - u * s + v * c] as const
  for (const u of [-length / 2 + 0.3, length / 2 - 0.3]) {
    const [px, pz] = at(u, 0)
    b.box([px, y + 0.19, pz], [0.18, 0.38, 0.46], WALLC, MAT.concrete, 0, yaw)
  }
  for (let k = 0; k < 5; k++) {
    const [px, pz] = at(0, -0.2 + k * 0.1)
    b.box([px, y + 0.415, pz], [length, 0.05, 0.085], WOOD, MAT.wood, 0, yaw)
  }
}

/** 街灯（台座・柱・腕・灯具。灯具の下の光る面は warm） */
function lamp(b: GeoBuilder, warm: GeoBuilder, x: number, y: number, z: number, h: number, yaw: number) {
  b.cylinder([x, y - 0.1, z], 0.13, 0.42, 12, POLE, MAT.paint, 0.4, true, 0.1)
  b.cylinder([x, y + 0.3, z], 0.055, h - 0.3, 10, POLE, MAT.paint, 0.45, true, 0.04)
  const ax = x + Math.sin(yaw) * 0.42
  const az = z + Math.cos(yaw) * 0.42
  b.beam([x, y + h - 0.05, z], [ax, y + h - 0.02, az], 0.04, POLE, MAT.paint, 0.45)
  b.box([ax, y + h - 0.06, az], [0.26, 0.09, 0.2], POLE, MAT.paint, 0.5, yaw)
  warm.box([ax, y + h - 0.108, az], [0.2, 0.01, 0.15], '#000', 0, 0, yaw)
}

/** 小道の舗装と縁石 */
function addPath(parts: SiteParts, p: LivePath, order: number) {
  const b = parts.solid
  const S = SURFACE[p.surface]
  const n = p.sx.length
  const hw = p.width / 2
  const lift = 0.002 * (order % 5)
  // 区間ごとに、決めた面の中・ほかの小道の中（先に作った小道に重なる所）は舗装を作らない
  const covered = (x: number, z: number) => designedY(x, z) !== null
  const side = Array.from({ length: n }, (_, i) => {
    const a = Math.max(0, i - 1)
    const c = Math.min(n - 1, i + 1)
    const dx = p.sx[c] - p.sx[a]
    const dz = p.sz[c] - p.sz[a]
    const l = Math.hypot(dx, dz) || 1
    return [-dz / l, dx / l] as [number, number]
  })
  for (let i = 1; i < n; i++) {
    const mx = (p.sx[i] + p.sx[i - 1]) / 2
    const mz = (p.sz[i] + p.sz[i - 1]) / 2
    if (covered(mx, mz)) continue
    const ya = p.sy[i - 1] + lift
    const yb = p.sy[i] + lift
    const l0: [number, number, number] = [p.sx[i - 1] + side[i - 1][0] * hw, ya, p.sz[i - 1] + side[i - 1][1] * hw]
    const r0: [number, number, number] = [p.sx[i - 1] - side[i - 1][0] * hw, ya, p.sz[i - 1] - side[i - 1][1] * hw]
    const l1: [number, number, number] = [p.sx[i] + side[i][0] * hw, yb, p.sz[i] + side[i][1] * hw]
    const r1: [number, number, number] = [p.sx[i] - side[i][0] * hw, yb, p.sz[i] - side[i][1] * hw]
    b.quad(l0, l1, r1, r0, S.color, S.mat)
  }
  if (!p.curb) return
  // 縁石（左右）。ほかの小道・決めた面に入る所は切る
  for (const sgn of [1, -1]) {
    let run: { pts: [number, number][]; top: number[]; bottom: number[] } = { pts: [], top: [], bottom: [] }
    const flush = () => {
      if (run.pts.length >= 2) {
        if (S.curb === 'wood') wallAlong(b, run.pts, 0.06, run.top, run.bottom, WOOD, MAT.wood)
        else wallAlong(b, run.pts, 0.12, run.top, run.bottom, S.curb === 'tall' ? GRANITE_D : GRANITE, MAT.granite)
      }
      run = { pts: [], top: [], bottom: [] }
    }
    const up = S.curb === 'wood' ? 0.05 : S.curb === 'tall' ? 0.14 : 0.08
    for (let i = 0; i < n; i++) {
      const off = hw + (S.curb === 'wood' ? 0.03 : 0.06)
      const x = p.sx[i] + side[i][0] * off * sgn
      const z = p.sz[i] + side[i][1] * off * sgn
      const other = site.pathAt(x, z, -0.05)
      const blocked = covered(x, z) || (other !== null && other.path !== p && other.d < other.path.width / 2 + 0.1) || Math.hypot(x - DOOR.x, z - STAIR_BOTTOM.z) < 2.2
      if (blocked) {
        flush()
        continue
      }
      run.pts.push([x, z])
      run.top.push(p.sy[i] + up + lift)
      run.bottom.push(p.sy[i] - 0.35)
    }
    flush()
  }
}

/** ラボの前のセットを作る（地図データを読んだあと。読めないときは決めた面と作り直した小道だけ） */
export function buildSite(): SiteParts {
  const b = new GeoBuilder()
  const glass = new GeoBuilder()
  const warm = new GeoBuilder()
  const parts: SiteParts = { solid: b, glass, warm, shrubs: [] }
  const ty = TERRACE.y

  // --- テラス: 土間（1.2m の目地）・擁壁・笠石。西は通用口の前の踊り場（WEST_LANDING）へつながる ---
  b.quad([TERRACE.x0, ty, TERRACE.z1], [TERRACE.x1, ty, TERRACE.z1], [TERRACE.x1, ty, TERRACE.z0], [TERRACE.x0, ty, TERRACE.z0], SLAB, MAT.concrete, 1.2)
  {
    const L = WEST_LANDING
    b.quad([L.x0, ty, TERRACE.z0], [L.x1, ty, TERRACE.z0], [L.x1, ty, L.z0], [L.x0, ty, L.z0], SLAB, MAT.concrete, 1.2)
  }
  const wb = -2.4
  // 南の擁壁（石段の所は開ける）・西の擁壁・東の擁壁（スロープの口は開ける）
  const coping = (x0: number, x1: number, z0: number, z1: number) => b.boxMinMax(x0, ty - 0.12, z0, x1, ty + 0.012, z1, GRANITE, MAT.granite)
  for (const [x0, x1] of [
    [TERRACE.x0, ENTRY_STAIR.x0],
    [ENTRY_STAIR.x1, TERRACE.x1],
  ]) {
    b.boxMinMax(x0, wb, TERRACE.z1 - 0.25, x1, ty - 0.12, TERRACE.z1, WALLC, MAT.concrete, 0, [true, true, false, false, true, false])
    coping(x0, x1, TERRACE.z1 - 0.28, TERRACE.z1 + 0.03)
  }
  // 西の擁壁（踊り場の北の端からテラスの南の端まで）と、踊り場の北の擁壁（建物の西の面まで）
  b.boxMinMax(TERRACE.x0 - 0.0, wb, WEST_LANDING.z0, TERRACE.x0 + 0.25, ty - 0.12, TERRACE.z1, WALLC, MAT.concrete, 0, [false, true, false, false, true, false])
  coping(TERRACE.x0 - 0.03, TERRACE.x0 + 0.28, WEST_LANDING.z0 - 0.03, TERRACE.z1 + 0.03)
  b.boxMinMax(TERRACE.x0, wb, WEST_LANDING.z0, WEST_LANDING.x1, ty - 0.12, WEST_LANDING.z0 + 0.25, WALLC, MAT.concrete, 0, [true, false, false, false, false, true])
  coping(TERRACE.x0 + 0.28, WEST_LANDING.x1, WEST_LANDING.z0 - 0.03, WEST_LANDING.z0 + 0.28)
  for (const [z0, z1] of [
    [SHELL.portalZ, RAMP.z0],
    [RAMP.z1, TERRACE.z1],
  ]) {
    b.boxMinMax(TERRACE.x1 - 0.25, wb, z0, TERRACE.x1, ty - 0.12, z1, WALLC, MAT.concrete, 0, [true, false, false, false, false, false])
    coping(TERRACE.x1 - 0.28, TERRACE.x1 + 0.03, z0, z1)
  }
  // 扉の外の敷居（ステンレス）と玄関マット
  b.boxMinMax(DOOR.x - DOOR.width / 2, ty, SHELL.glassZ, DOOR.x + DOOR.width / 2, 0.004, SHELL.glassZ + 0.12, STEEL, MAT.steel)
  b.boxMinMax(DOOR.x - 0.62, ty, SHELL.portalZ + 0.1, DOOR.x + 0.62, ty + 0.012, SHELL.portalZ + 1.0, '#2c2722', MAT.soil)
  // ガラスの手すり（南の縁は石段の左右、西の縁、東の縁のスロープ以外）
  const rz = TERRACE.z1 - 0.14
  const flat = () => ty
  railing(b, glass, warm, [
    [WEST_LANDING.x1 - 0.05, WEST_LANDING.z0 + 0.14],
    [TERRACE.x0 + 0.14, WEST_LANDING.z0 + 0.14],
    [TERRACE.x0 + 0.14, rz],
    [ENTRY_STAIR.x0, rz],
  ], flat, TERRACE.railHeight)
  railing(b, glass, warm, [
    [ENTRY_STAIR.x1, rz],
    [TERRACE.x1 - 0.14, rz],
    [TERRACE.x1 - 0.14, RAMP.z1 + 0.02],
  ], flat, TERRACE.railHeight)
  railing(b, glass, warm, [
    [TERRACE.x1 - 0.14, RAMP.z0 - 0.02],
    [TERRACE.x1 - 0.14, SHELL.portalZ + 0.15],
  ], flat, TERRACE.railHeight)
  // ベンチと植え込みの箱（低い打ち放しの箱と土と低木）
  for (const t of TERRACE_BENCHES) bench(b, t.x, t.z, ty, t.length, t.yaw)
  for (const p of TERRACE_PLANTERS) {
    b.boxMinMax(p.x0, ty, p.z0, p.x1, ty + 0.45, p.z1, WALLC, MAT.concrete, 0, [true, true, false, false, true, true])
    b.boxMinMax(p.x0, ty + 0.38, p.z0, p.x1, ty + 0.45, p.z0 + 0.06, WALLC, MAT.concrete)
    b.boxMinMax(p.x0, ty + 0.38, p.z1 - 0.06, p.x1, ty + 0.45, p.z1, WALLC, MAT.concrete)
    b.boxMinMax(p.x0, ty + 0.38, p.z0, p.x0 + 0.06, ty + 0.45, p.z1, WALLC, MAT.concrete)
    b.boxMinMax(p.x1 - 0.06, ty + 0.38, p.z0, p.x1, ty + 0.45, p.z1, WALLC, MAT.concrete)
    b.quad([p.x0 + 0.06, ty + 0.4, p.z1 - 0.06], [p.x1 - 0.06, ty + 0.4, p.z1 - 0.06], [p.x1 - 0.06, ty + 0.4, p.z0 + 0.06], [p.x0 + 0.06, ty + 0.4, p.z0 + 0.06], '#3b3027', MAT.soil)
    const n = Math.max(2, Math.round(((p.x1 - p.x0) * (p.z1 - p.z0)) / 0.35))
    for (let k = 0; k < n; k++) {
      const x = p.x0 + 0.2 + hash(k, p.x0) * (p.x1 - p.x0 - 0.4)
      const z = p.z0 + 0.15 + hash(p.z0, k) * (p.z1 - p.z0 - 0.3)
      parts.shrubs.push({ x, y: -z, z: 116 + ty + 0.38, h: 0.35 + 0.25 * hash(x, z), r: 0.22 + 0.12 * hash(z, x), seed: hash(x * 3, z) })
    }
  }

  // --- 石段（御影石の踏み石と蹴上げ・袖壁・手すり・足元灯） ---
  {
    const { x0, x1, z0, tread, rise, risers, cheek } = ENTRY_STAIR
    const xa = x0 + cheek
    const xb = x1 - cheek
    // テラスの縁の 1 段目の蹴上げ
    b.boxMinMax(xa, ty - rise - 0.3, z0 - 0.05, xb, ty, z0, GRANITE_D, MAT.granite, 0, [false, false, false, false, true, false])
    for (let k = 1; k <= risers; k++) {
      const y = ty - k * rise
      const za = z0 + (k - 1) * tread
      // いちばん下の踏み石は道に少しかかる
      const zb = z0 + k * tread + (k === risers ? 0.28 : 0)
      b.boxMinMax(xa, y - rise - 0.25, za, xb, y, zb, GRANITE, MAT.granite, 0, [false, false, true, false, true, false])
      // 踏み石の先の滑り止めの溝（濃い線）
      b.boxMinMax(xa, y, zb - 0.05, xb, y + 0.002, zb - 0.035, GRANITE_D, MAT.granite)
    }
    const zEnd = STAIR_BOTTOM.z + 0.28
    for (const [cx0, cx1] of [
      [x0, xa],
      [xb, x1],
    ]) {
      const cx = (cx0 + cx1) / 2
      const pts: [number, number][] = []
      const top: number[] = []
      const bot: number[] = []
      for (let k = 0; k <= 8; k++) {
        const z = z0 - 0.1 + ((zEnd - z0 + 0.1) * k) / 8
        pts.push([cx, z])
        top.push(ty + 0.18 + (STAIR_BOTTOM.y - ty) * Math.min(1, Math.max(0, (z - z0 + 0.1) / (zEnd - z0))))
        bot.push(-2.4)
      }
      wallAlong(b, pts, cheek, top, bot, WALLC, MAT.concrete)
      // 袖壁の上の手すり（柱 3 本と、なめらかな坂の笠木）
      const base = (_x: number, z: number) => ty + 0.18 + (STAIR_BOTTOM.y - ty) * Math.min(1, Math.max(0, (z - z0 + 0.1) / (zEnd - z0)))
      railing(b, null, null, [
        [cx, z0 - 0.05],
        [cx, zEnd - 0.1],
      ], base, 0.78, 1.45)
      // 足元灯（2 段おき。内側の面）
      for (let k = 2; k <= risers; k += 2) {
        const z = z0 + (k - 0.5) * tread
        const y = ty - k * rise + 0.28
        const xin = cx0 === x0 ? xa + 0.004 : xb - 0.004
        b.box([xin, y, z], [0.012, 0.07, 0.16], '#1d2023', MAT.paint, 0.6)
        warm.box([xin + (cx0 === x0 ? 0.004 : -0.004), y - 0.01, z], [0.006, 0.025, 0.12], '#000', 0, 0)
      }
    }
  }

  // --- スロープ（なめらかなコンクリート・両側の袖壁・手すり） ---
  {
    const { x0, x1, z0, z1, cheek } = RAMP
    b.quad([x0, rampY(x0), z1 - cheek], [x1, rampY(x1), z1 - cheek], [x1, rampY(x1), z0 + cheek], [x0, rampY(x0), z0 + cheek], SLAB, MAT.concrete, 1.5)
    for (const zc of [z0 + cheek / 2, z1 - cheek / 2]) {
      const pts: [number, number][] = []
      const top: number[] = []
      const bot: number[] = []
      for (let k = 0; k <= 24; k++) {
        const x = x0 + ((x1 - x0) * k) / 24
        pts.push([x, zc])
        const nat = naturalY(x, zc + (zc < (z0 + z1) / 2 ? -0.5 : 0.5))
        top.push(Math.max(rampY(x) + 0.16, nat + 0.08))
        bot.push(Math.min(rampY(x), nat) - 0.6)
      }
      wallAlong(b, pts, cheek, top, bot, WALLC, MAT.concrete)
      const base = (x: number) => Math.max(rampY(x) + 0.16, naturalY(x, zc + (zc < (z0 + z1) / 2 ? -0.5 : 0.5)) + 0.08)
      railing(b, null, null, [
        [x0 + 0.3, zc],
        [x1 - 0.2, zc],
      ], base, 0.84, 1.65)
    }
  }

  // --- 小道（舗装・縁石）。作り直した小道を先に（交わる所で後の小道の縁石を切る） ---
  site.paths.forEach((p, i) => addPath(parts, p, i))

  // --- 見晴らし台: 石畳の円・まわりの擁壁と笠石・南の手すり・ベンチ・望遠鏡 ---
  {
    const [cx, cz] = LOOKOUT.center
    const R = LOOKOUT.radius
    const y = LOOKOUT.y
    const rings = 12
    const seg = 96
    for (let i = 0; i < rings; i++) {
      const r0 = (R * i) / rings
      const r1 = (R * (i + 1)) / rings
      for (let j = 0; j < seg; j++) {
        const a0 = (j / seg) * Math.PI * 2
        const a1 = ((j + 1) / seg) * Math.PI * 2
        const p = (r: number, a: number) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r] as [number, number, number]
        b.quad(p(r0, a1), p(r0, a0), p(r1, a0), p(r1, a1), '#9b958a', MAT.cobble)
      }
    }
    // まわりの壁: 谷側は地面まで下ろした擁壁、南の弧は胸壁（0.55m）と手すり
    const ptsW: [number, number][] = []
    const topW: number[] = []
    const botW: number[] = []
    const [arc0, arc1] = LOOKOUT.parapetArc
    const railPts: [number, number][] = []
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2 - Math.PI
      const x = cx + Math.sin(a) * (R + 0.22)
      const z = cz + Math.cos(a) * (R + 0.22)
      // 小道が来る所（北西）は開ける
      const entry = Math.abs(Math.atan2(Math.sin(a - -2.35), Math.cos(a - -2.35))) < 0.18
      const parapet = a > arc0 && a < arc1
      if (entry) {
        if (ptsW.length >= 2) wallAlong(b, ptsW.splice(0), 0.45, topW.splice(0), botW.splice(0), '#8c877d', MAT.granite)
        ptsW.length = 0
        topW.length = 0
        botW.length = 0
        continue
      }
      const nat = naturalY(cx + Math.sin(a) * (R + 0.9), cz + Math.cos(a) * (R + 0.9))
      ptsW.push([x, z])
      topW.push(y + (parapet ? 0.55 : 0.12))
      botW.push(Math.min(nat, y) - 0.5)
    }
    for (let a = arc0 + 0.05; a <= arc1 - 0.05 + 1e-6; a += (arc1 - arc0 - 0.1) / Math.round(((arc1 - arc0) * R) / 1.6)) railPts.push([cx + Math.sin(a) * (R + 0.1), cz + Math.cos(a) * (R + 0.1)])
    if (ptsW.length >= 2) wallAlong(b, ptsW, 0.45, topW, botW, '#8c877d', MAT.granite)
    railing(b, null, null, railPts, () => y + 0.55, 0.55, 1.6)
    for (const bn of LOOKOUT_BENCHES) {
      const [x, z] = lookoutPoint(bn.angle, bn.dist)
      bench(b, x, z, y, 2.0, bn.angle)
    }
    // 硬貨式の望遠鏡（緑の柱と、南を向いた筒）
    {
      const [x, z] = lookoutPoint(LOOKOUT_SCOPE.angle, LOOKOUT_SCOPE.dist)
      b.cylinder([x, y, z], 0.16, 0.08, 14, '#3d4a44', MAT.paint, 0.4)
      b.cylinder([x, y + 0.08, z], 0.06, 1.0, 10, '#2f6b4f', MAT.paint, 0.5)
      b.box([x, y + 1.12, z], [0.22, 0.24, 0.22], '#2f6b4f', MAT.paint, 0.5)
      const a = LOOKOUT_SCOPE.angle
      b.beam([x - Math.sin(a) * 0.25, y + 1.16, z - Math.cos(a) * 0.25], [x + Math.sin(a) * 0.32, y + 1.26, z + Math.cos(a) * 0.32], 0.14, '#2f6b4f', MAT.paint, 0.5)
    }
    // 山側の植え込み
    for (let k = 0; k < 40; k++) {
      const a = 2.6 + hash(k, 2) * 2.0 - Math.PI
      const r = R + 1.2 + hash(k, 3) * 3.5
      const x = cx + Math.sin(a) * r
      const z = cz + Math.cos(a) * r
      if (site.pathAt(x, z, 0.4)) continue
      parts.shrubs.push({ x, y: -z, z: 116 + site.groundY(x, z), h: 0.6 + 0.6 * hash(k, 4), r: 0.5 + 0.4 * hash(k, 5), seed: hash(k, 6) })
    }
  }

  // --- 大パラボラの前の砂利の広場（木の縁） ---
  {
    const [cx, cz] = PARABOLA_PAD.center
    const R = PARABOLA_PAD.radius
    const y = site.padY
    const seg = 36
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2
      const a1 = ((j + 1) / seg) * Math.PI * 2
      b.tri([cx, y, cz], [cx + Math.sin(a0) * R, y, cz + Math.cos(a0) * R], [cx + Math.sin(a1) * R, y, cz + Math.cos(a1) * R], '#a39a8a', MAT.gravel)
    }
    const pts: [number, number][] = []
    const top: number[] = []
    const bot: number[] = []
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2 + 0.6
      if (Math.abs(Math.atan2(Math.sin(a - 4.4), Math.cos(a - 4.4))) < 0.35) continue
      pts.push([cx + Math.sin(a) * (R + 0.03), cz + Math.cos(a) * (R + 0.03)])
      top.push(y + 0.05)
      bot.push(y - 0.3)
    }
    wallAlong(b, pts, 0.06, top, bot, WOOD, MAT.wood)
  }

  // --- テラスの擁壁の前の植え込み（低い生け垣。窓から町を見る線より低い） ---
  for (let x = TERRACE.x0 + 0.4; x < TERRACE.x1 - 0.2; x += 0.75) {
    if (x > ENTRY_STAIR.x0 - 0.3 && x < ENTRY_STAIR.x1 + 0.3) continue
    const z = TERRACE.z1 + 0.55 + hash(x, 1) * 0.35
    if (site.pathAt(x, z, 0.15)) continue
    parts.shrubs.push({ x, y: -z, z: 116 + site.groundY(x, z), h: 0.65 + 0.35 * hash(x, 2), r: 0.45 + 0.2 * hash(x, 3), seed: hash(x, 4) })
  }
  // スロープの南の植え込み
  for (let x = RAMP.x0 + 0.8; x < RAMP.x1 - 0.5; x += 1.1) {
    const z = RAMP.z1 + 0.7 + hash(x, 5) * 0.4
    if (site.pathAt(x, z, 0.15)) continue
    parts.shrubs.push({ x, y: -z, z: 116 + site.groundY(x, z), h: 0.55 + 0.4 * hash(x, 6), r: 0.45 + 0.25 * hash(x, 7), seed: hash(x, 8) })
  }

  // --- 大パラボラ（地図データの形の決まった構造物。無ければ地図の値） ---
  {
    const st = townData.infra?.structures.find((x) => x.type === 'parabola')
    const spec = st && st.type === 'parabola' ? { x: st.x, z: -st.y, dish: st.dish, center: st.center, azimuth: st.azimuth, elevation: st.elevation } : { x: PARABOLA.center[0], z: PARABOLA.center[1], dish: 12, center: 9, azimuth: 250, elevation: 30 }
    buildParabola(b, spec)
  }

  // --- 街灯 ---
  for (const l of site.lamps) lamp(b, warm, l.x, l.y, l.z, l.h, l.yaw)
  return parts
}

/** 街灯の灯具の位置（シーンの座標。夜の光の uniform と、町の灯りの点） */
export function lampHeads(): THREE.Vector3[] {
  return site.lamps.map((l) => new THREE.Vector3(l.x + Math.sin(l.yaw) * 0.42, l.y + l.h - 0.12, l.z + Math.cos(l.yaw) * 0.42))
}
