import type { P2, P3 } from '../town/townData'

/**
 * 交通の地図データ（sync-town が infra.json の transit に書く。形の版 7。tools/town/transit.mjs）と、線の上の位置を求める道具。
 * 座標は町の平面座標（x = 東、y = 北、z = 標高）のまま。
 */

/** 線路の構造（tools/town/transit.mjs の RAIL_STRUCT と同じ番号） */
export const RAIL_STRUCT = { atGrade: 0, embankment: 1, concreteViaduct: 2, stoneArch: 3, bridge: 4, cutting: 5, tunnel: 6 } as const

export interface TransitTramLine {
  id: string
  /** 系統の番号（1〜4） */
  no: number
  name: string
  /** 系統の色（行き先表示の色の帯） */
  color: string
  /** 環状（1 系統） */
  loop: boolean
  /** 起点から終点（環状は一周）の分 */
  minutes: number
  length: number
  pts: P3[]
  stops: { name: string; d: number; min: number }[]
}

export interface TransitTramStop {
  id: string
  name: string
  lines: number[]
  x: number
  y: number
  z: number
}

export interface TransitRail {
  /** 浜ノ宮の側のトンネルの口 → 桜見 → 鐘ヶ丘の側のトンネルの口。点の 4 番目はその点から次の点までの構造（RAIL_STRUCT） */
  pts: [number, number, number, number][]
  length: number
  stations: { id: string; name: string; d: number; platform: [number, number]; local: boolean; rapid: boolean }[]
}

export interface TransitBoatRoute {
  id: string
  route: string
  name: string
  loop: boolean
  minutes: number
  speed: number
  color: string
  length: number
  /** z = 水面の標高 */
  pts: P3[]
  stops: { id: string; name: string; d: number }[]
}

export interface TransitFerry {
  id: string
  name: string
  minutes: number
  ships: string[]
  length: number
  pts: P3[]
  stops: { id: string; name: string; d: number }[]
}

export interface TownTransit {
  trams: TransitTramLine[]
  tramStops: TransitTramStop[]
  rail: TransitRail | null
  waterbus: TransitBoatRoute[]
  ferry: TransitFerry | null
  basins: { id: string; name: string; use: string; ring: P2[] }[]
  landings: { id: string; x: number; y: number; bearing: number; bus: boolean }[]
  lanes: { id: string; name: string; color: string; alt: number; spacing: number; pts: P3[] }[]
  /** 信号のある交差点（中心・出ていく道の向き（平面の atan2(y, x)）・幅） */
  signals: { x: number; y: number; z: number; dirs: { a: number; w: number; major: boolean }[] }[]
}

/* -------------------------------------------------------------------------- */
/* 線の上の位置                                                                  */
/* -------------------------------------------------------------------------- */

/** 線の上の点（平面座標と標高、進む向きの単位ベクトル、勾配 dz/ds） */
export interface PathPoint {
  x: number
  y: number
  z: number
  dx: number
  dy: number
  grade: number
}

export const pathPoint = (): PathPoint => ({ x: 0, y: 0, z: 0, dx: 1, dy: 0, grade: 0 })

/**
 * 折れ線を、角をなめらかにした細かい点（step m ごと。Catmull-Rom）に直して、長さで引けるようにしたもの。
 * 車両の位置・向き・線路の形はどれもこれを使う（データの点は 8〜50m おきで、曲がりで折れて見えるため）
 */
export class Path {
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly s: Float64Array
  readonly length: number
  readonly loop: boolean
  /** 元の点ごとの値（線路の構造など）を、細かい点の番号で */
  readonly tag: Uint8Array

  constructor(pts: readonly (readonly number[])[], step = 2, loop = false, tagOf?: (p: readonly number[]) => number) {
    this.loop = loop
    const src = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.05)
    const n = src.length
    const at = (i: number) => (loop ? src[((i % n) + n) % n] : src[Math.max(0, Math.min(n - 1, i))])
    const xs: number[] = []
    const ys: number[] = []
    const zs: number[] = []
    const tags: number[] = []
    const segs = loop ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1)
      const p1 = at(i)
      const p2 = at(i + 1)
      const p3 = at(i + 2)
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
      const k = Math.max(1, Math.ceil(len / step))
      // 長い直線の両端の短い区間で曲がりすぎないよう、接線は前後の区間の長さで抑える（centripetal に近い）
      const l0 = Math.max(1e-3, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]))
      const l2 = Math.max(1e-3, Math.hypot(p3[0] - p2[0], p3[1] - p2[1]))
      const t1 = [0, 1].map((j) => ((p2[j] - p0[j]) / (l0 + len)) * len * Math.min(1, (2 * l0) / (l0 + len) + 0.5))
      const t2 = [0, 1].map((j) => ((p3[j] - p1[j]) / (len + l2)) * len * Math.min(1, (2 * l2) / (len + l2) + 0.5))
      for (let j = 0; j < k; j++) {
        const t = j / k
        const h00 = 2 * t * t * t - 3 * t * t + 1
        const h10 = t * t * t - 2 * t * t + t
        const h01 = -2 * t * t * t + 3 * t * t
        const h11 = t * t * t - t * t
        xs.push(h00 * p1[0] + h10 * t1[0] + h01 * p2[0] + h11 * t2[0])
        ys.push(h00 * p1[1] + h10 * t1[1] + h01 * p2[1] + h11 * t2[1])
        zs.push(p1[2] + (p2[2] - p1[2]) * t)
        tags.push(tagOf ? tagOf(p1) : 0)
      }
    }
    const last = loop ? at(0) : at(n - 1)
    xs.push(last[0])
    ys.push(last[1])
    zs.push(last[2])
    tags.push(tagOf ? tagOf(last) : 0)
    this.x = Float64Array.from(xs)
    this.y = Float64Array.from(ys)
    this.z = Float64Array.from(zs)
    this.tag = Uint8Array.from(tags)
    const s = new Float64Array(xs.length)
    for (let i = 1; i < xs.length; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
    this.s = s
    this.length = s[s.length - 1]
  }

  /** 長さ d の所の細かい点の番号（その点から次の点までの区間に d が入る） */
  index(d: number) {
    const s = this.s
    let lo = 0
    let hi = s.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (s[mid] <= d) lo = mid
      else hi = mid
    }
    return lo
  }

  /** 長さ d の所の点（環状の線は一周で折り返す。線の外は端で止める） */
  at(d: number, out: PathPoint): PathPoint {
    const L = this.length
    if (this.loop) d = ((d % L) + L) % L
    else d = Math.max(0, Math.min(L, d))
    const i = Math.min(this.index(d), this.s.length - 2)
    const seg = this.s[i + 1] - this.s[i]
    const t = seg > 0 ? (d - this.s[i]) / seg : 0
    const dx = this.x[i + 1] - this.x[i]
    const dy = this.y[i + 1] - this.y[i]
    out.x = this.x[i] + dx * t
    out.y = this.y[i] + dy * t
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t
    const l = Math.hypot(dx, dy) || 1
    out.dx = dx / l
    out.dy = dy / l
    out.grade = (this.z[i + 1] - this.z[i]) / l
    return out
  }

  /** 線の z を、関数で直す（地面に沿わせるなど。細かい点ごと） */
  mapZ(f: (x: number, y: number, z: number, i: number) => number) {
    for (let i = 0; i < this.z.length; i++) this.z[i] = f(this.x[i], this.y[i], this.z[i], i)
  }

  /** 点 (x, y) を線へ投げた長さと距離 */
  project(x: number, y: number) {
    let best = { d: 0, dist: Infinity }
    for (let i = 1; i < this.x.length; i++) {
      const ax = this.x[i - 1]
      const ay = this.y[i - 1]
      const dx = this.x[i] - ax
      const dy = this.y[i] - ay
      const l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
      const dist = Math.hypot(ax + dx * t - x, ay + dy * t - y)
      if (dist < best.dist) best = { d: this.s[i - 1] + Math.sqrt(l2) * t, dist }
    }
    return best
  }
}
