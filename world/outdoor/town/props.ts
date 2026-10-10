import * as THREE from 'three'
import { SITE } from '../../../core/town'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { ROOF } from './buildingKit'
import { TOWN_LIGHT } from './facades'
import { TOWN_SHADOW, depthMaterial, townShadowUniforms } from './shadows'
import { TEXTURE_DECL, townTextureUniforms } from './townTextures'
import { TOWN_LAMPS, lampUniforms, LAMP, type Lamp } from './lamps'
import type { TownTile } from './townData'

/**
 * 建物の小物（形で描く）。外壁のシェーダーの模様だけでは平らに見える所に、厚みのある物を足す。
 *
 * - 細かさの中心から detailRadius まで: 集合住宅・学校の正面のベランダ（床の板・手すり・隣との仕切り・室外機）、
 *   1 階の店のひさし（布の縞）と袖看板、家の壁の室外機・2 階の小さなベランダ・玄関の庇
 * - roofPropsRadius まで: 陸屋根の塔屋（階段室）・給水塔・室外機の列・アンテナ・屋上の手すり、瓦屋根の家のテレビのアンテナ
 *
 * どれも「箱」（と給水塔の円柱）のインスタンス。インスタンスの値: pA = (中心 x, y, z（シーン）, 向き)、pB = (大きさ x, 高さ, 奥行き, 傾き)、
 * pC = (色 r, g, b, 種類)。種類で質感を変える（PROP）。並びは建物のインスタンスの値と外壁の型（facades.ts の facadeType と同じ決め方）から、
 * 建物の種で決める（同じデータなら同じ町）。外壁のシェーダーは、この範囲の建物のベランダの手すりを描かない（propsCenter）
 */

export const PROP = { slab: 0, railBars: 1, railPanel: 2, awning: 3, sign: 4, acUnit: 5, tank: 6, mast: 7, penthouse: 8, roofRail: 9, partition: 10 } as const

const LAB = SITE.labFloorElevation

/* -------------------------------------------------------------------------- */
/* 外壁の型（GLSL の facadeType と同じ）                                           */
/* -------------------------------------------------------------------------- */

const has = (flags: number, bit: number) => (flags & bit) !== 0
const fract = (v: number) => v - Math.floor(v)

/** facades.ts の facadeType と同じ答え */
export function facadeTypeOf(facade: number, use: number, flags: number, floors: number, style: number, seed: number) {
  if (facade === 4) return 7
  if (has(flags, 32) || facade === 6) return 8
  if (use === 8 && floors > 1.5) return 9
  const oldTown = style === 2 || style === 7 || style === 1
  if ((facade === 3 || facade === 7) && (oldTown || floors < 4.5 || fract(seed * 5.7) < 0.5)) return 3
  if (facade === 2 && (oldTown || floors < 2.5 || use === 6 || use === 9)) return 4
  const officeUse = use === 3 || use === 6 || use === 7 || (use === 2 && floors > 4.5)
  if (officeUse && floors > 2.5) return 6
  if (use < 2.5 && floors > 2.5 && (floors > 3.5 || fract(seed * 7.31) < 0.6 || style === 3 || style === 4)) return 5
  if (facade === 2 || facade === 3) return facade === 3 ? 3 : 1
  if (facade === 0) return 0
  return 1
}

/** GLSL の bayTarget と同じ */
function bayTargetOf(type: number) {
  return type === 7 ? 1.5 : type === 8 ? 6 : type === 9 ? 3.6 : type === 6 ? 3 : type === 5 ? 3.3 : type === 3 ? 3.1 : type === 4 ? 3 : 2.9
}

/* -------------------------------------------------------------------------- */
/* 並べる                                                                        */
/* -------------------------------------------------------------------------- */

class PropWriter {
  a: number[] = []
  b: number[] = []
  c: number[] = []
  /** 建物の局所の座標（lx = 局所の x、ly = 局所の y、h = 床からの高さ）で箱を置く */
  cx = 0
  cy = 0
  floorZ = 0
  cos = 1
  sin = 0
  yaw = 0
  begin(cx: number, cy: number, floorZ: number, yaw: number) {
    this.cx = cx
    this.cy = cy
    this.floorZ = floorZ
    this.yaw = yaw
    this.cos = Math.cos(yaw)
    this.sin = Math.sin(yaw)
  }
  /** 箱: 中心（局所 lx, ly, 下端の高さ h）・大きさ（局所 x 方向 sx、高さ sy、局所 y 方向 sz）・傾き（局所 x の軸まわり）・向きの追加（yawAdd） */
  box(lx: number, ly: number, h: number, sx: number, sy: number, sz: number, kind: number, color: [number, number, number], tilt = 0, yawAdd = 0) {
    const px = this.cx + this.cos * lx - this.sin * ly
    const py = this.cy + this.sin * lx + this.cos * ly
    this.a.push(px, this.floorZ + h + sy / 2 - LAB, -py, this.yaw + yawAdd)
    this.b.push(sx, sy, sz, tilt)
    this.c.push(color[0], color[1], color[2], kind)
  }
  get count() {
    return this.a.length / 4
  }
}

const GREY: [number, number, number] = [0.5, 0.5, 0.5]
const AC: [number, number, number] = [0.62, 0.62, 0.6]

interface Bld {
  cx: number
  cy: number
  floorZ: number
  yaw: number
  w: number
  d: number
  eave: number
  ridge: number
  floors: number
  front: number
  roof: number
  wall: [number, number, number]
  facade: number
  use: number
  flags: number
  seed: number
  style: number
}

/** 0〜1 の乱数（建物の種と番号から） */
function rand(seed: number, k: number) {
  return fract(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453)
}

/** 正面の壁の局所の情報: 壁に沿った軸の長さ・外向き */
function frontInfo(b: Bld, side: number) {
  // side: 0 = +y、1 = -y、2 = +x、3 = -x
  const span = side < 2 ? b.w : b.d
  const out = side < 2 ? b.d / 2 : b.w / 2
  const sign = side % 2 === 0 ? 1 : -1
  return { span, out, sign, alongX: side < 2 }
}

function srgb(c: [number, number, number]): [number, number, number] {
  return [Math.pow(c[0] / 255, 2.2), Math.pow(c[1] / 255, 2.2), Math.pow(c[2] / 255, 2.2)]
}

/** 壁に沿った位置 t（-span/2〜span/2）・外への距離 o の局所の座標 */
function wallPoint(side: number, t: number, o: number): [number, number] {
  const sign = side % 2 === 0 ? 1 : -1
  return side < 2 ? [t, sign * o] : [sign * o, t]
}

function addFacadeProps(w: PropWriter, b: Bld) {
  const type = facadeTypeOf(b.facade, b.use, b.flags, b.floors, b.style, b.seed)
  const eaveEff = b.roof === ROOF.flat ? Math.max(b.eave - 0.9, 2.2) : b.eave
  const floorH = Math.max(eaveEff / Math.max(1, b.floors), 0.6)
  const wallC = srgb(b.wall)
  const side = b.front
  const f = frontInfo(b, side)
  const nb = Math.max(1, Math.floor(f.span / bayTargetOf(type) + 0.5))
  const bayW = f.span / nb
  const yawSide = side < 2 ? 0 : Math.PI / 2
  // 集合住宅・学校の正面のベランダ
  if ((type === 5 || type === 9) && b.floors > 1) {
    const kind = fract(b.seed * 23)
    const railKind = type === 9 ? PROP.railPanel : kind < 0.4 ? PROP.railPanel : kind < 0.75 ? PROP.railPanel : PROP.railBars
    const railC: [number, number, number] = type === 9 ? [0.62, 0.62, 0.6] : kind < 0.4 ? [0.42, 0.47, 0.5] : kind < 0.75 ? [wallC[0] * 1.1, wallC[1] * 1.1, wallC[2] * 1.1] : [0.06, 0.065, 0.07]
    const depth = type === 9 ? 1.8 : 1.15
    for (let fi = 1; fi < b.floors; fi++) {
      const h = 0.15 + fi * floorH
      const [sx, sy] = wallPoint(side, 0, f.out + depth / 2)
      // 床の板（壁の幅いっぱい）
      w.box(sx, sy, h - 0.18, f.span, 0.18, depth, PROP.slab, [0.55, 0.55, 0.53], 0, yawSide)
      // 手すり
      const [rx, ry] = wallPoint(side, 0, f.out + depth - 0.04)
      w.box(rx, ry, h, f.span, 1.1, 0.07, railKind, railC, 0, yawSide)
      // 隣との仕切り（2 間ごと）と、室外機
      for (let k = 0; k <= nb; k += 2) {
        const t = -f.span / 2 + k * bayW
        const [px, py] = wallPoint(side, t, f.out + depth / 2)
        if (k > 0 && k < nb) w.box(px, py, h, 0.06, floorH - 0.25, depth, PROP.partition, [0.68, 0.68, 0.66], 0, yawSide)
      }
      for (let k = 0; k < nb; k++) {
        if (rand(b.seed, fi * 31 + k) > 0.55 || type === 9) continue
        const t = -f.span / 2 + (k + 0.25 + 0.5 * rand(b.seed, k + 7)) * bayW
        const [ax, ay] = wallPoint(side, t, f.out + 0.32)
        w.box(ax, ay, h, 0.8, 0.62, 0.3, PROP.acUnit, AC, 0, yawSide)
      }
    }
  }
  // 1 階の店: ひさしと袖看板
  if (has(b.flags, 16) && type < 7.5) {
    const roofH = Math.min(floorH * 0.8, 3.4)
    for (let k = 0; k < nb; k++) {
      const r = rand(b.seed, 100 + k)
      if (r < 0.62) {
        const depth = 1.0 + 0.5 * rand(b.seed, 140 + k)
        const t = -f.span / 2 + (k + 0.5) * bayW
        const [ax, ay] = wallPoint(side, t, f.out + depth / 2 - 0.05)
        const pal = rand(b.seed, 200 + k)
        const col: [number, number, number] = pal < 0.25 ? [0.42, 0.06, 0.05] : pal < 0.45 ? [0.05, 0.2, 0.1] : pal < 0.6 ? [0.06, 0.1, 0.26] : pal < 0.8 ? [0.6, 0.55, 0.45] : [0.35, 0.18, 0.06]
        // ひさしは外へ向かって下がる（壁の向きに応じて傾きの向きを変える）
        const tiltSign = side === 0 || side === 3 ? 1 : -1
        w.box(ax, ay, roofH - 0.35, bayW * 0.92, 0.05, depth, PROP.awning, col, tiltSign * 0.35, yawSide)
      }
    }
    if (rand(b.seed, 300) < 0.45 && b.floors > 1) {
      const t = (rand(b.seed, 301) - 0.5) * f.span * 0.8
      const [sx, sy] = wallPoint(side, t, f.out + 0.45)
      const pal = rand(b.seed, 302)
      const col: [number, number, number] = pal < 0.3 ? [0.55, 0.08, 0.05] : pal < 0.55 ? [0.7, 0.66, 0.55] : pal < 0.8 ? [0.05, 0.12, 0.3] : [0.08, 0.3, 0.12]
      w.box(sx, sy, floorH + 0.3, 0.12, Math.min(2.4, floorH * (b.floors - 1) * 0.8), 0.7, PROP.sign, col, 0, yawSide)
    }
  }
  // 家: 室外機（横か裏の壁の足元）・2 階の小さなベランダ・玄関の庇
  if (type <= 1) {
    const n = 1 + Math.floor(rand(b.seed, 400) * 2)
    for (let i = 0; i < n; i++) {
      const s = (side + 1 + Math.floor(rand(b.seed, 401 + i) * 3)) % 4
      const fi2 = frontInfo(b, s)
      const t = (rand(b.seed, 410 + i) - 0.5) * fi2.span * 0.7
      const [ax, ay] = wallPoint(s, t, fi2.out + 0.2)
      w.box(ax, ay, 0.05, 0.8, 0.6, 0.3, PROP.acUnit, AC, 0, s < 2 ? 0 : Math.PI / 2)
    }
    if (b.floors >= 2 && rand(b.seed, 420) < 0.42) {
      const bw = Math.min(f.span * 0.6, 3.6)
      const t = (rand(b.seed, 421) - 0.5) * (f.span - bw)
      const [sx, sy] = wallPoint(side, t, f.out + 0.45)
      const h = 0.15 + floorH
      w.box(sx, sy, h - 0.12, bw, 0.12, 0.9, PROP.slab, [0.5, 0.5, 0.48], 0, yawSide)
      const [rx, ry] = wallPoint(side, t, f.out + 0.87)
      w.box(rx, ry, h, bw, 0.95, 0.05, PROP.railBars, rand(b.seed, 422) < 0.5 ? [0.08, 0.08, 0.08] : [0.5, 0.5, 0.48], 0, yawSide)
    }
    if (rand(b.seed, 430) < 0.35) {
      const t = (rand(b.seed, 431) - 0.5) * f.span * 0.6
      const [cx, cy] = wallPoint(side, t, f.out + 0.45)
      w.box(cx, cy, 2.3, 1.6, 0.06, 0.9, PROP.slab, [0.3, 0.3, 0.3], (side === 0 || side === 3 ? 1 : -1) * 0.12, yawSide)
    }
  }
}

function addRoofProps(w: PropWriter, b: Bld, far: boolean, tanks: PropWriter) {
  const wallC = srgb(b.wall)
  if (b.roof === ROOF.flat) {
    const top = b.eave - 0.75
    const big = b.floors >= 3
    const ix = b.w / 2 - 1.2
    const iy = b.d / 2 - 1.2
    if (ix < 0.6 || iy < 0.6) return
    const r = (k: number) => rand(b.seed, 500 + k)
    // 塔屋（階段室・機械室）
    if (big && r(0) < 0.75) {
      const sx = Math.min(4.2, b.w * 0.3)
      const sz = Math.min(3.6, b.d * 0.3)
      const px = (r(1) - 0.5) * (b.w - sx - 2)
      const py = (r(2) - 0.5) * (b.d - sz - 2)
      w.box(px, py, top, sx, 2.8, sz, PROP.penthouse, [wallC[0] * 0.9, wallC[1] * 0.9, wallC[2] * 0.9])
    }
    // 給水塔（台の上の円柱）
    if (r(3) < (big ? 0.4 : 0.15) && b.floors <= 9) {
      const px = (r(4) - 0.5) * ix * 1.4
      const py = (r(5) - 0.5) * iy * 1.4
      tanks.begin(b.cx, b.cy, b.floorZ, b.yaw)
      tanks.box(px, py, top + 1.2, 2.0, 1.8, 2.0, PROP.tank, [0.62, 0.64, 0.62])
      w.box(px, py, top, 1.8, 1.2, 1.8, PROP.mast, [0.3, 0.3, 0.3])
    }
    if (far) return
    // 室外機の列
    const n = big ? 2 + Math.floor(r(6) * 5) : Math.floor(r(6) * 2.5)
    for (let i = 0; i < n; i++) {
      const px = (r(10 + i) - 0.5) * ix * 1.6
      const py = (r(20 + i) - 0.5) * iy * 1.6
      w.box(px, py, top, 1.0, 0.75, 0.75, PROP.acUnit, AC, 0, Math.floor(r(30 + i) * 4) * (Math.PI / 2))
    }
    // アンテナ
    if (r(40) < 0.3) {
      const px = (r(41) - 0.5) * ix
      const py = (r(42) - 0.5) * iy
      w.box(px, py, top, 0.08, 4.5, 0.08, PROP.mast, GREY)
      w.box(px, py, top + 3.4, 1.6, 0.05, 0.05, PROP.mast, GREY)
      w.box(px, py, top + 4.0, 1.1, 0.05, 0.05, PROP.mast, GREY)
    }
    // 屋上の手すり
    if (big && r(50) < 0.3) {
      const h = b.eave
      w.box(0, b.d / 2 - 0.15, h, b.w - 0.3, 1.1, 0.05, PROP.roofRail, GREY)
      w.box(0, -b.d / 2 + 0.15, h, b.w - 0.3, 1.1, 0.05, PROP.roofRail, GREY)
      w.box(b.w / 2 - 0.15, 0, h, 0.05, 1.1, b.d - 0.3, PROP.roofRail, GREY)
      w.box(-b.w / 2 + 0.15, 0, h, 0.05, 1.1, b.d - 0.3, PROP.roofRail, GREY)
    }
  } else if (!far && (b.style === 1 || b.style === 5) && rand(b.seed, 600) < 0.35 && b.roof !== ROOF.sawtooth) {
    // 瓦屋根の家のテレビのアンテナ（棟の上）
    const px = (rand(b.seed, 601) - 0.5) * b.w * 0.5
    w.box(px, 0, b.ridge - 0.2, 0.05, 2.6, 0.05, PROP.mast, GREY)
    w.box(px, 0, b.ridge + 1.6, 1.4, 0.04, 0.04, PROP.mast, GREY)
    w.box(px, 0, b.ridge + 2.1, 0.9, 0.04, 0.04, PROP.mast, GREY)
  }
}

/** タイルの建物から小物を並べる。center = 細かさの中心（平面座標） */
export function collectProps(tiles: TownTile[], center: [number, number], detailRadius: number, roofRadius: number, skip: (namedIndex: number, eave: number) => boolean) {
  const w = new PropWriter()
  const tanks = new PropWriter()
  for (const t of tiles) {
    const s = t.sections
    const n = s.b_pos.array.length / 4
    const P = s.b_pos.array as Float32Array
    const D = s.b_dim.array as Float32Array
    const E = s.b_ext.array as Float32Array
    const Wc = s.b_wall.array as Uint8Array
    const R = s.b_roof.array as Uint8Array
    const M = s.b_meta.array as Uint8Array
    for (let i = 0; i < n; i++) {
      const dist = Math.hypot(P[i * 4] - center[0], P[i * 4 + 1] - center[1])
      if (dist > roofRadius) continue
      const roof = R[i * 4 + 3]
      if (roof === ROOF.arch) continue
      const named = (s.b_named.array as Int32Array)[i]
      if (named >= 0 && skip(named, D[i * 4 + 2])) continue
      let yaw = P[i * 4 + 3]
      let front = E[i * 4 + 2]
      // 片流れは低い側（正面）を局所 +y に（collectInstances と同じ）
      if (roof === ROOF.shed && front === 1) {
        yaw += Math.PI
        front = 0
      }
      const seedInt = M[i * 4 + 2] + M[i * 4 + 3] * 256
      const b: Bld = {
        cx: P[i * 4],
        cy: P[i * 4 + 1],
        floorZ: P[i * 4 + 2],
        yaw,
        w: D[i * 4],
        d: D[i * 4 + 1],
        eave: D[i * 4 + 2],
        ridge: Math.max(D[i * 4 + 3], D[i * 4 + 2]),
        floors: Math.max(1, E[i * 4 + 1]),
        front,
        roof,
        wall: [Wc[i * 4], Wc[i * 4 + 1], Wc[i * 4 + 2]],
        facade: Wc[i * 4 + 3],
        use: M[i * 4],
        flags: M[i * 4 + 1],
        seed: seedInt / 65536,
        style: E[i * 4 + 3],
      }
      w.begin(b.cx, b.cy, b.floorZ, b.yaw)
      if (dist < detailRadius) addFacadeProps(w, b)
      w.begin(b.cx, b.cy, b.floorZ, b.yaw)
      addRoofProps(w, b, dist > roofRadius * 0.45, tanks)
    }
  }
  return { boxes: w, tanks }
}

/**
 * 1 階の店の店先の灯り（灯りの表に入れる。夜、店の前の歩道と向かいの壁を照らす）。ひさしのある間口ごとに、
 * 正面の壁から 1.2m 外・高さ 2.6m に 1 つ（ひさしの無い店は正面の中ほどに 1 つ）。町じゅう（灯りの表が使うのは近くだけ）
 */
export function shopFrontLamps(tiles: TownTile[], skip: (namedIndex: number, eave: number) => boolean): Lamp[] {
  const out: Lamp[] = []
  for (const t of tiles) {
    const s = t.sections
    const n = s.b_pos.array.length / 4
    const P = s.b_pos.array as Float32Array
    const D = s.b_dim.array as Float32Array
    const E = s.b_ext.array as Float32Array
    const Wc = s.b_wall.array as Uint8Array
    const R = s.b_roof.array as Uint8Array
    const M = s.b_meta.array as Uint8Array
    for (let i = 0; i < n; i++) {
      if (!has(M[i * 4 + 1], 16)) continue
      const roof = R[i * 4 + 3]
      if (roof === ROOF.arch) continue
      const named = (s.b_named.array as Int32Array)[i]
      if (named >= 0 && skip(named, D[i * 4 + 2])) continue
      let yaw = P[i * 4 + 3]
      let front = E[i * 4 + 2]
      if (roof === ROOF.shed && front === 1) {
        yaw += Math.PI
        front = 0
      }
      const seed = (M[i * 4 + 2] + M[i * 4 + 3] * 256) / 65536
      const floors = Math.max(1, E[i * 4 + 1])
      const type = facadeTypeOf(Wc[i * 4 + 3], M[i * 4], M[i * 4 + 1], floors, E[i * 4 + 3], seed)
      if (type >= 7.5) continue
      const b = { w: D[i * 4], d: D[i * 4 + 1] } as Bld
      const f = frontInfo(b, front)
      const nb = Math.max(1, Math.floor(f.span / bayTargetOf(type) + 0.5))
      const bayW = f.span / nb
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      const push = (tt: number, power: number) => {
        const [lx, ly] = wallPoint(front, tt, f.out + 1.2)
        out.push({ x: P[i * 4] + cos * lx - sin * ly, y: P[i * 4 + 1] + sin * lx + cos * ly, z: P[i * 4 + 2] + 2.6, kind: LAMP.shop, power })
      }
      let any = false
      for (let k = 0; k < nb; k++) {
        if (rand(seed, 100 + k) >= 0.62) continue
        push(-f.span / 2 + (k + 0.5) * bayW, 1.6)
        any = true
      }
      if (!any) push(0, 1.4)
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* 形とシェーダー                                                                */
/* -------------------------------------------------------------------------- */

function instancedGeometry(base: THREE.BufferGeometry, wr: PropWriter) {
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.attributes.position)
  g.setAttribute('normal', base.attributes.normal)
  const n = Math.max(1, wr.count)
  const pad = (arr: number[]) => {
    const f = new Float32Array(n * 4)
    f.set(arr)
    return f
  }
  g.setAttribute('pA', new THREE.InstancedBufferAttribute(pad(wr.a), 4))
  g.setAttribute('pB', new THREE.InstancedBufferAttribute(pad(wr.b), 4))
  g.setAttribute('pC', new THREE.InstancedBufferAttribute(pad(wr.c), 4))
  g.instanceCount = wr.count
  return g
}

const PROP_VERTEX = /* glsl */ `
attribute vec4 pA;
attribute vec4 pB;
attribute vec4 pC;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec4 vColor;
varying vec3 vSize;
varying vec3 vLN;
void main() {
  vec3 p = position * pB.xyz;
  vLN = normal;
  vec3 n = normal;
  // 傾き（局所の x の軸まわり）と向き（縦の軸まわり。建物の局所 x = 平面の (cos, sin)、シーンでは (cos, 0, -sin)）
  float ct = cos(pB.w);
  float st = sin(pB.w);
  p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
  n = vec3(n.x, ct * n.y - st * n.z, st * n.y + ct * n.z);
  float c = cos(pA.w);
  float s = sin(pA.w);
  // 局所の (x, 上, y) → シーン（x = 東、z = -北）
  vec3 wp = pA.xyz + vec3(c * p.x - s * p.z, p.y, -(s * p.x + c * p.z));
  vNormal = vec3(c * n.x - s * n.z, n.y, -(s * n.x + c * n.z));
  vLocal = position;
  vSize = pB.xyz;
  vColor = pC;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

const PROP_FRAGMENT = /* glsl */ `
${TOWN_LAMPS}
${COMMON}
${SKY}
${TOWN_LIGHT}
${TOWN_SHADOW}
${TEXTURE_DECL}
uniform float uShop;
uniform float uLightGain;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec4 vColor;
varying vec3 vSize;
varying vec3 vLN;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float kind = vColor.a;
  vec3 albedo = vColor.rgb;
  vec3 m = (vLocal + 0.5) * vSize;
  float ao = 1.0;
  vec3 emit = vec3(0.0);
  float dist = length(cameraPosition - vWorld);
  float fine = 1.0 - smoothstep(30.0, 120.0, dist);
  if (kind < 0.5 || (kind > 9.5)) {
    // コンクリートの床の板・仕切り: コンクリートの質感
    vec3 t = texture(uBldAlb, vec3(vec2(m.x + m.z, m.y) / 3.2, 4.0)).rgb * 2.0;
    albedo *= pow(max(t, 0.0), vec3(2.2));
    if (N.y < -0.5) ao = 0.6;
  } else if (kind < 1.5) {
    // 金属の手すり（縦の格子。近くは格子の間を抜く）
    float along = abs(vLN.x) > 0.5 ? m.z : m.x;
    float bar = smoothstep(0.32, 0.45, abs(fract(along / 0.11) - 0.5));
    float top = step(vSize.y - 0.06, m.y) + step(m.y, 0.05);
    if (fine > 0.5 && bar < 0.5 && top < 0.5 && abs(vLN.y) < 0.5) discard;
  } else if (kind < 2.5) {
    // 手すりの板（すりガラス・金属の板）: 少し光る
    albedo *= 0.9 + 0.1 * step(0.5, fract(m.x / 1.8));
  } else if (kind < 3.5) {
    // ひさしの布（縞）
    float stripe = step(0.5, fract((m.x) / 0.45));
    if (fract(vColor.r * 13.0 + vColor.g * 7.0) > 0.5) albedo = mix(albedo, vec3(0.75, 0.72, 0.66), stripe * 0.85);
    if (N.y < 0.0) ao = 0.55;
  } else if (kind < 4.5) {
    // 袖看板（文字と、夜は光る）
    float letters = step(0.5, fract(sin(dot(floor(vec2(m.z, m.y) / vec2(0.18, 0.22)), vec2(12.9, 78.2))) * 43758.5)) * step(0.1, m.z) * step(m.z, vSize.z - 0.1) * step(0.12, m.y) * step(m.y, vSize.y - 0.12);
    vec3 lc = dot(albedo, vec3(0.33)) > 0.4 ? vec3(0.08) : vec3(0.85, 0.82, 0.72);
    if (abs(vLN.x) > 0.5) albedo = mix(albedo, lc, letters * fine);
    emit = (vColor.rgb * 1.8 + lc * letters * 1.2) * uShop;
  } else if (kind < 5.5) {
    // 室外機（前の面にファンの丸）
    if (abs(vLN.z) > 0.5) {
      vec2 q = vec2(m.x - vSize.x * 0.62, m.y - vSize.y * 0.5);
      float fan = 1.0 - smoothstep(0.2, 0.24, length(q));
      albedo = mix(albedo, vec3(0.12), fan * 0.8);
    }
  } else if (kind < 6.5) {
    // 給水塔（パネルの継ぎ目）
    albedo *= 0.9 + 0.1 * step(0.08, fract(m.y / 0.6));
  } else if (kind > 7.5 && kind < 8.5) {
    // 塔屋: 外壁の質感（漆喰）と扉
    vec3 t = texture(uBldAlb, vec3(vec2(m.x + m.z, m.y) / 3.0, 1.0)).rgb * 2.0;
    albedo *= pow(max(t, 0.0), vec3(2.2));
    if (vLN.z > 0.5 && abs(m.x - vSize.x * 0.5) < 0.45 && m.y < 2.1) albedo = vec3(0.18, 0.19, 0.2);
    ao = mix(0.7, 1.0, smoothstep(0.0, 1.0, m.y));
  }
  float sh = townShadow(vWorld, N);
  vec3 col = townLight(albedo, N, ao, sh);
  col += albedo * townLamps(vWorld, N) * ao;
  // 金属の照り返し
  if (kind > 0.5 && kind < 2.5 || kind > 4.5 && kind < 7.5) col += uSunLight * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 30.0) * 0.15 * sh;
  col = outdoorHaze(col, vWorld);
  col += emit * uLightGain * exp(-dist / (uHazeDist * 1.5));
  gl_FragColor = vec4(col, 1.0);
  ${TONE}
}
`

export function createPropMaterials() {
  const uniforms = { ...outdoorUniforms, ...townShadowUniforms, ...townTextureUniforms, ...lampUniforms, uShop: { value: 0 }, uLightGain: { value: 1 } }
  const material = new THREE.ShaderMaterial({ name: 'townProps', uniforms, vertexShader: PROP_VERTEX, fragmentShader: PROP_FRAGMENT, side: THREE.DoubleSide })
  const depth = depthMaterial(PROP_VERTEX)
  return { material, depth }
}

export type PropMaterials = ReturnType<typeof createPropMaterials>

const BOX_GEO = new THREE.BoxGeometry(1, 1, 1)
const TANK_GEO = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1)

/** 小物のメッシュ（箱と給水塔）。center = 細かさの中心 */
export function propMeshes(tiles: TownTile[], mats: PropMaterials, center: [number, number], detailRadius: number, roofRadius: number, skip: (namedIndex: number, eave: number) => boolean = () => false) {
  const { boxes, tanks } = collectProps(tiles, center, detailRadius, roofRadius, skip)
  return [
    [boxes, BOX_GEO, 'boxes'],
    [tanks, TANK_GEO, 'tanks'],
  ].map(([wr, geo, name]) => {
    const mesh = new THREE.Mesh(instancedGeometry(geo as THREE.BufferGeometry, wr as PropWriter), mats.material)
    mesh.frustumCulled = false
    mesh.visible = (wr as PropWriter).count > 0
    mesh.name = `townProps:${name}`
    mesh.userData.shadowMaterial = mats.depth
    return mesh
  })
}
