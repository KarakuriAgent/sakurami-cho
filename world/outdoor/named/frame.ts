import { SITE } from '../../../core/town'
import type { P2 } from '../town/townData'

/**
 * 建物の面ごとの局所の座標（s = 面に沿って外から見て右へ、t = 面から建物の奥へ、h = 床からの高さ [m]）。
 * 平面: 点 = 原点 + a × s − n × t（a = 面に沿った向き、n = 外向き = (a.y, −a.x)）、標高 = z0 + h。シーンへは townToScene と同じ
 * （three.x = x、three.y = 標高 − 116、three.z = −y）。
 * 反時計回りの外形の辺 p → q の面は Frame.edge(p, q, z0)（外から見て p が左）。
 */

const LAB = SITE.labFloorElevation

export type V3 = [number, number, number]

export class Frame {
  readonly ox: number
  readonly oy: number
  readonly ax: number
  readonly ay: number
  readonly z0: number
  readonly nx: number
  readonly ny: number
  constructor(ox: number, oy: number, ax: number, ay: number, z0: number) {
    this.ox = ox
    this.oy = oy
    this.ax = ax
    this.ay = ay
    this.z0 = z0
    this.nx = ay
    this.ny = -ax
  }

  /** 反時計回りの外形の辺 p → q（外から見て p が左。外向きは右手） */
  static edge(p: P2, q: P2, z0: number) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    return new Frame(p[0], p[1], (q[0] - p[0]) / len, (q[1] - p[1]) / len, z0)
  }

  /** 外向き（方位の度）の面。原点は (x, y) */
  static facing(x: number, y: number, bearingDeg: number, z0: number) {
    const b = (bearingDeg * Math.PI) / 180
    const nx = Math.sin(b)
    const ny = Math.cos(b)
    return new Frame(x, y, -ny, nx, z0)
  }

  /** 平面の点 */
  plan(s: number, t: number): P2 {
    return [this.ox + this.ax * s - this.nx * t, this.oy + this.ay * s - this.ny * t]
  }

  /** シーンの点 */
  p(s: number, t: number, h: number): V3 {
    const x = this.ox + this.ax * s - this.nx * t
    const y = this.oy + this.ay * s - this.ny * t
    return [x, this.z0 + h - LAB, -y]
  }

  /** シーンの向き（局所の向きの成分から） */
  dir(ds: number, dt: number, dh: number): V3 {
    return [this.ax * ds - this.nx * dt, dh, -(this.ay * ds - this.ny * dt)]
  }

  /** 外向き（シーン） */
  get out(): V3 {
    return [this.nx, 0, -this.ny]
  }

  /** 箱の回転（KitBuilder.box の Y 軸の角度。箱の x = s、y = h、z = −t（外向き）） */
  get yaw() {
    return Math.atan2(this.ay, this.ax)
  }

  /** 局所の (s, t) へ原点を動かし、z0 を dz だけ上げた面 */
  shift(s: number, t: number, dz = 0) {
    const [x, y] = this.plan(s, t)
    return new Frame(x, y, this.ax, this.ay, this.z0 + dz)
  }

  /** 右へ 90° 回した面（いまの面の右の角から、右の側面を見る）。原点は (s, 0) */
  turnRight(s: number) {
    const [x, y] = this.plan(s, 0)
    // 右の側面: 向き a' = −n（奥へ）、外向き n' = a
    return new Frame(x, y, -this.nx, -this.ny, this.z0)
  }

  /** 平面の点を局所の (s, t) に */
  local(x: number, y: number): [number, number] {
    const dx = x - this.ox
    const dy = y - this.oy
    return [dx * this.ax + dy * this.ay, -(dx * this.nx + dy * this.ny)]
  }

  /** 高さを変えた面 */
  at(z0: number) {
    return new Frame(this.ox, this.oy, this.ax, this.ay, z0)
  }
}

/** 長方形の建物の正面の面と大きさ（W = 正面の幅、D = 奥行き）。ring は反時計回りの 4 点、front = 正面の方位（度） */
export function rectFrame(ring: P2[], frontDeg: number | null, z0: number) {
  let best = 0
  let bestDot = -Infinity
  const f = frontDeg === null ? null : [Math.sin((frontDeg * Math.PI) / 180), Math.cos((frontDeg * Math.PI) / 180)]
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    const ox = (q[1] - p[1]) / (len || 1)
    const oy = -(q[0] - p[0]) / (len || 1)
    // 正面の向きが無ければ長い辺
    const score = f ? ox * f[0] + oy * f[1] + len * 1e-4 : len
    if (score > bestDot) {
      bestDot = score
      best = i
    }
  }
  const p = ring[best]
  const q = ring[(best + 1) % n]
  const frame = Frame.edge(p, q, z0)
  const W = Math.hypot(q[0] - p[0], q[1] - p[1])
  // 奥行き: ほかの点のいちばん奥
  let D = 0
  for (const r of ring) D = Math.max(D, frame.local(r[0], r[1])[1])
  return { frame, W, D, edge: best }
}

/** 外形が長方形に近いか（4 点で、角がほぼ直角） */
export function isRect(ring: P2[]) {
  if (ring.length !== 4) return false
  for (let i = 0; i < 4; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    const c = ring[(i + 2) % 4]
    const d1 = [b[0] - a[0], b[1] - a[1]]
    const d2 = [c[0] - b[0], c[1] - b[1]]
    const cos = (d1[0] * d2[0] + d1[1] * d2[1]) / (Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]) || 1)
    if (Math.abs(cos) > 0.12) return false
  }
  return true
}

/** 重心 */
export function ringCenter(ring: P2[]): P2 {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    const c = p[0] * q[1] - q[0] * p[1]
    a += c
    cx += (p[0] + q[0]) * c
    cy += (p[1] + q[1]) * c
  }
  if (Math.abs(a) < 1e-9) return [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length]
  return [cx / (3 * a), cy / (3 * a)]
}

/** 決まった乱数（種から） */
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

/** 文字列の種 */
export function seedOf(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 1000003
}
