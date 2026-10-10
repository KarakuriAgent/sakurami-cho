// 平面の幾何と、多角形・線を画像に塗る道具（pnpm sync:town 用。座標は町の平面座標 m: x = 東、y = 北）

/** 多角形の輪の符号付き面積（反時計回りが +） */
export function ringArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  return a / 2
}

/** 閉じた輪の最後の点（始点と同じ）を外す */
export function openRing(ring) {
  const n = ring.length
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, n - 1)
  return ring
}

/** 多角形の重心（面積の重み） */
export function centroid(ring) {
  const r = openRing(ring)
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]
    a += f
    cx += (r[j][0] + r[i][0]) * f
    cy += (r[j][1] + r[i][1]) * f
  }
  if (Math.abs(a) < 1e-9) {
    const n = r.length
    return [r.reduce((s, p) => s + p[0], 0) / n, r.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/** 点が多角形（外周と穴の輪の配列）の中か（偶奇則） */
export function insidePolygon(x, y, rings) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

export function bboxOf(rings) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const ring of rings)
    for (const p of ring) {
      if (p[0] < x0) x0 = p[0]
      if (p[0] > x1) x1 = p[0]
      if (p[1] < y0) y0 = p[1]
      if (p[1] > y1) y1 = p[1]
    }
  return [x0, y0, x1, y1]
}

/** 点と線分の距離 */
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const x = ax + dx * t - px
  const y = ay + dy * t - py
  return Math.sqrt(x * x + y * y)
}

/** 点と多角形の輪の辺までのいちばん近い距離 */
export function ringDist(px, py, ring) {
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, segDist(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]))
  return best
}

export function polylineLength(points) {
  let s = 0
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return s
}

/** 折れ線に沿って step m ごとの点（[x, y, 向きの角度, 線の上の距離]）。offset から始める */
export function samplePolyline(points, step, offset = step / 2) {
  const out = []
  let acc = 0
  let next = offset
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len <= 0) continue
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    while (next <= acc + len) {
      const t = (next - acc) / len
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ang, next, i - 1, t])
      next += step
    }
    acc += len
  }
  return out
}

/** 円を多角形で */
export function circleRing(cx, cy, r, n = 12) {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

/**
 * 4 つの角の多角形を長方形として読む（中心・幅・奥行き・向き）。axisA は 0→1 の辺の向き（ラジアン、東から反時計回り）。
 * 角が直角から大きく外れるものは null
 */
export function rectOf(ring) {
  const r = openRing(ring)
  if (r.length !== 4) return null
  const e = (i) => [r[(i + 1) % 4][0] - r[i][0], r[(i + 1) % 4][1] - r[i][1]]
  const lens = [0, 1, 2, 3].map((i) => Math.hypot(...e(i)))
  for (let i = 0; i < 4; i++) {
    const a = e(i)
    const b = e((i + 1) % 4)
    const cos = (a[0] * b[0] + a[1] * b[1]) / (lens[i] * lens[(i + 1) % 4] || 1)
    if (Math.abs(cos) > 0.12) return null
  }
  const [cx, cy] = [(r[0][0] + r[1][0] + r[2][0] + r[3][0]) / 4, (r[0][1] + r[1][1] + r[2][1] + r[3][1]) / 4]
  const a = e(0)
  return { cx, cy, w: (lens[0] + lens[2]) / 2, d: (lens[1] + lens[3]) / 2, axis: Math.atan2(a[1], a[0]) }
}

/** 点の集まりの、面積がいちばん小さい外接長方形（凸包の辺の向きで調べる） */
export function minAreaRect(points) {
  const hull = convexHull(points)
  let best = null
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (const p of hull) {
      const u = p[0] * c + p[1] * s
      const v = -p[0] * s + p[1] * c
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    const area = (u1 - u0) * (v1 - v0)
    if (!best || area < best.area) {
      const uc = (u0 + u1) / 2
      const vc = (v0 + v1) / 2
      best = { area, cx: uc * c - vc * s, cy: uc * s + vc * c, w: u1 - u0, d: v1 - v0, axis: ang }
    }
  }
  return best
}

export function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

/* -------------------------------------------------------------------------- */
/* 画像の格子（町の平面座標 ⇔ 画素）と、多角形の塗り（縁はなめらかな被覆率）       */
/* -------------------------------------------------------------------------- */

/**
 * 画像の格子。extent は {xmin, ymax, pixel_m, width, height}（out/heightmap/*.json の extent_lab と同じ形）。
 * 画素 (col, row) の中心 = (xmin + (col + 0.5) * px, ymax - (row + 0.5) * px)
 */
export class Grid {
  constructor(extent) {
    this.xmin = extent.xmin
    this.ymax = extent.ymax
    this.px = extent.pixel_m
    this.width = extent.width
    this.height = extent.height
  }
  col(x) {
    return (x - this.xmin) / this.px
  }
  row(y) {
    return (this.ymax - y) / this.px
  }
  x(col) {
    return this.xmin + (col + 0.5) * this.px
  }
  y(row) {
    return this.ymax - (row + 0.5) * this.px
  }

  /**
   * 多角形（輪の配列。穴は偶奇則）を塗る。cb(index, coverage 0〜1) を被覆のある画素ごとに呼ぶ。
   * 1 画素を縦 4 本の走査線で調べ、横は区間の端の割合まで数える
   */
  fill(rings, cb) {
    const SUB = 4
    let [x0, y0, x1, y1] = bboxOf(rings)
    const c0 = Math.max(0, Math.floor(this.col(x0)))
    const c1 = Math.min(this.width - 1, Math.floor(this.col(x1)))
    const r0 = Math.max(0, Math.floor(this.row(y1)))
    const r1 = Math.min(this.height - 1, Math.floor(this.row(y0)))
    if (c0 > c1 || r0 > r1) return
    const w = c1 - c0 + 1
    const cov = new Float32Array(w + 1)
    // 辺（画素の単位）
    const edges = []
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = this.col(ring[j][0])
        const ay = this.row(ring[j][1])
        const bx = this.col(ring[i][0])
        const by = this.row(ring[i][1])
        if (ay === by) continue
        edges.push(ay < by ? [ay, by, ax, (bx - ax) / (by - ay)] : [by, ay, bx, (ax - bx) / (ay - by)])
      }
    }
    const xs = []
    for (let r = r0; r <= r1; r++) {
      cov.fill(0)
      let any = false
      for (let s = 0; s < SUB; s++) {
        const yy = r + (s + 0.5) / SUB
        xs.length = 0
        for (const e of edges) if (yy >= e[0] && yy < e[1]) xs.push(e[2] + (yy - e[0]) * e[3])
        if (xs.length < 2) continue
        xs.sort((a, b) => a - b)
        for (let k = 0; k + 1 < xs.length; k += 2) {
          let xa = Math.max(xs[k], c0) - c0
          let xb = Math.min(xs[k + 1], c1 + 1) - c0
          if (xb <= xa) continue
          any = true
          const ia = Math.floor(xa)
          const ib = Math.floor(xb)
          if (ia === ib) cov[ia] += (xb - xa) / SUB
          else {
            cov[ia] += (ia + 1 - xa) / SUB
            for (let i = ia + 1; i < ib; i++) cov[i] += 1 / SUB
            if (ib < w) cov[ib] += (xb - ib) / SUB
          }
        }
      }
      if (!any) continue
      const base = r * this.width + c0
      for (let i = 0; i < w; i++) if (cov[i] > 0.001) cb(base + i, cov[i] > 1 ? 1 : cov[i])
    }
  }

  /** 太さのある折れ線を塗る（区間ごとの長方形と、折れ目の丸）。cb は fill と同じ */
  stroke(points, width, cb, caps = true) {
    const hw = width / 2
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 1e-6) continue
      const nx = (-(b[1] - a[1]) / len) * hw
      const ny = ((b[0] - a[0]) / len) * hw
      this.fill(
        [
          [
            [a[0] + nx, a[1] + ny],
            [b[0] + nx, b[1] + ny],
            [b[0] - nx, b[1] - ny],
            [a[0] - nx, a[1] - ny],
          ],
        ],
        cb,
      )
    }
    const n = Math.max(8, Math.min(20, Math.round(hw * 2)))
    for (let i = caps ? 0 : 1; i < (caps ? points.length : points.length - 1); i++) this.fill([circleRing(points[i][0], points[i][1], hw, n)], cb)
  }

  /** 双一次補間で読む（値の配列 data。範囲の外は端の値） */
  sample(data, x, y) {
    const fc = Math.min(this.width - 1.001, Math.max(0, this.col(x) - 0.5))
    const fr = Math.min(this.height - 1.001, Math.max(0, this.row(y) - 0.5))
    const c = Math.floor(fc)
    const r = Math.floor(fr)
    const tx = fc - c
    const ty = fr - r
    const i = r * this.width + c
    const a = data[i]
    const b = data[i + 1]
    const cc = data[i + this.width]
    const d = data[i + this.width + 1]
    return a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty
  }

  contains(x, y, margin = 0) {
    const c = this.col(x)
    const r = this.row(y)
    return c >= margin && r >= margin && c <= this.width - margin && r <= this.height - margin
  }
}

/** 文字列から 32 bit の乱数の種（FNV-1a） */
export function seedOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** 決まった乱数（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 重みつきで選ぶ（[値, 重み] の配列） */
export function pickWeighted(rnd, entries) {
  const total = entries.reduce((s, e) => s + e[1], 0)
  let x = rnd() * total
  for (const e of entries) {
    x -= e[1]
    if (x <= 0) return e[0]
  }
  return entries[entries.length - 1][0]
}

/** 「名前 #rrggbb」の文字列から最初の色（[r, g, b] 0〜255）。無ければ null */
export function hexIn(text) {
  if (typeof text !== 'string') return null
  const m = text.match(/#([0-9a-fA-F]{6})/)
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
