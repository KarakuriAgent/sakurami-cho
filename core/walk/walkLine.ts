import type { RoutePoint } from './townNav.ts'

/**
 * 歩く線（経路の道の中心線から、人が実際に歩く線を作る）。誰が使ってもよい（花音の動きには依存しない）。
 *
 * - 歩道の側: 道の中心から横へ offset m ずらす（広い道は歩道の真ん中、狭い道は端寄り、石段・橋・広場・路地は真ん中）。
 *   ずらす側（左右）は、道ごとに「次に大きく曲がる側」（曲がる前に渡っておく）。側を変えるのは交差点（道のつなぎ目）だけ = 交差点で渡る
 * - 曲がり角は丸める（半径 1.5m まで）
 * - 小物よけ: 線から近い小物（街灯・木の幹・停留所など。avoid が返す）を、横へずらしてよける（道の縁から 0.3m 内側まで）
 * - 1m ごとの点に直し、始めからの長さ s と、名目の速さ（m/分。道のグラフの時間から。坂・石段で変わる）を持たせる
 *
 * 座標は町の平面座標（m。x = 東、y = 北）。このファイルは Node からも読むので、townNav.ts の型のほかは import しない。
 */

export interface LineOptions {
  /** 辺の道の、中心からずらす量（m。0 なら真ん中） */
  offsetOf: (edge: number) => number
  /** 辺の道の幅（m）。小物よけで縁を越えないように */
  widthOf: (edge: number) => number
  /** 近くの小物（中心と半径。m）。無ければ空 */
  avoid?: (x: number, y: number, r: number) => { x: number; y: number; r: number }[]
}

export interface LinePoint {
  x: number
  y: number
  s: number
  /** 名目の速さ（m/分） */
  speed: number
  kind: number
  edge: number
}

interface Piece {
  edge: number
  kind: number
  speed: number
  pts: [number, number][]
  off: number
  side: number
}

const turnAngle = (ax: number, ay: number, bx: number, by: number) => Math.atan2(ax * by - ay * bx, ax * bx + ay * by)

/** 経路の点の列（townNav の polyline）から歩く線を作る */
export function walkLine(route: RoutePoint[], opts: LineOptions): LinePoint[] {
  if (route.length < 2) return route.map((p) => ({ x: p.x, y: p.y, s: p.s, speed: p.speed, kind: p.kind, edge: p.edge }))
  // 1. 辺ごとの区間に分ける
  const pieces: Piece[] = []
  for (let i = 0; i < route.length - 1; i++) {
    const p = route[i]
    const last = pieces[pieces.length - 1]
    if (!last || last.edge !== p.edge) {
      const start: [number, number] = [p.x, p.y]
      pieces.push({ edge: p.edge, kind: p.kind, speed: p.speed, pts: last ? [last.pts[last.pts.length - 1], start].filter((q, k, a) => k === 0 || Math.hypot(q[0] - a[0][0], q[1] - a[0][1]) > 1e-6) : [start], off: opts.offsetOf(p.edge), side: -1 })
    }
    pieces[pieces.length - 1].pts.push([route[i + 1].x, route[i + 1].y])
  }
  // 区間の先頭は前の区間の最後の点（つなぎ目）
  for (let k = 1; k < pieces.length; k++) {
    const prevEnd = pieces[k - 1].pts[pieces[k - 1].pts.length - 1]
    const first = pieces[k].pts[0]
    if (Math.hypot(prevEnd[0] - first[0], prevEnd[1] - first[1]) > 1e-6) pieces[k].pts.unshift(prevEnd)
  }
  const dirAt = (pc: Piece, end: boolean): [number, number] => {
    const n = pc.pts.length
    const a = end ? pc.pts[n - 2] : pc.pts[0]
    const b = end ? pc.pts[n - 1] : pc.pts[1]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
  }
  // 2. 側を決める: 区間の先で最初に大きく（35° より）曲がる側。曲がらなければ前の側のまま（最初は右 = 日本の歩行者の右側）
  let side = -1
  const want: number[] = pieces.map(() => 0)
  for (let k = 0; k < pieces.length - 1; k++) {
    const a = dirAt(pieces[k], true)
    const b = dirAt(pieces[k + 1], false)
    const t = turnAngle(a[0], a[1], b[0], b[1])
    if (Math.abs(t) > (35 * Math.PI) / 180) want[k] = t > 0 ? 1 : -1
  }
  for (let k = 0; k < pieces.length; k++) {
    // この区間の終わりか、そのあとの近い（40m 以内の）大きな曲がり
    let w = 0
    let ahead = 0
    for (let j = k; j < pieces.length && ahead < 40; j++) {
      if (want[j]) {
        w = want[j]
        break
      }
      ahead += pathLength(pieces[j].pts)
    }
    if (w) side = w
    pieces[k].side = side
  }
  // 3. ずらした線（区間ごと。曲がり目は角の外へ伸ばす / 内で交わる所まで縮める）
  const out: [number, number, number, number, number][] = [] // x, y, speed, kind, edge
  const push = (x: number, y: number, pc: Piece) => {
    const last = out[out.length - 1]
    if (last && Math.hypot(last[0] - x, last[1] - y) < 0.05) return
    out.push([x, y, pc.speed, pc.kind, pc.edge])
  }
  pieces.forEach((pc, k) => {
    const n = pc.pts.length
    const o = pc.off * pc.side
    for (let i = 0; i < n; i++) {
      const p = pc.pts[i]
      // 点での左の法線（前後の線分の平均）
      const a = pc.pts[Math.max(0, i - 1)]
      const b = pc.pts[Math.min(n - 1, i + 1)]
      let dx = b[0] - a[0]
      let dy = b[1] - a[1]
      let l = Math.hypot(dx, dy) || 1
      dx /= l
      dy /= l
      let scale = 1
      if (i > 0 && i < n - 1) {
        const d0 = [p[0] - a[0], p[1] - a[1]]
        const l0 = Math.hypot(d0[0], d0[1]) || 1
        const cos = (d0[0] / l0) * dx + (d0[1] / l0) * dy
        scale = Math.min(2, 1 / Math.max(0.5, cos))
      }
      if (i === 0 && k > 0) {
        // つなぎ目: 前の区間の最後の点と同じ所（側・ずらす量が同じで、曲がりの内側なら、2 本の線の交わる所）
        const prev = pieces[k - 1]
        const op = prev.off * prev.side
        const pd = dirAt(prev, true)
        const nd = dirAt(pc, false)
        const A: [number, number] = [p[0] - pd[1] * op, p[1] + pd[0] * op]
        const B: [number, number] = [p[0] - nd[1] * o, p[1] + nd[0] * o]
        const X = lineCross(A, pd, B, nd)
        if (X && Math.hypot(X[0] - p[0], X[1] - p[1]) < Math.max(Math.abs(o), Math.abs(op)) * 2.2 + 0.5) {
          // 前の区間の最後の点を交わる所に置き直す
          out.pop()
          push(X[0], X[1], pc)
        } else push(B[0], B[1], pc)
        continue
      }
      l = o * scale
      push(p[0] - dy * l, p[1] + dx * l, pc)
    }
  })
  // 最初と最後は道の真ん中（経路の始めと終わりの点）
  if (out.length >= 2) {
    out[0][0] = route[0].x
    out[0][1] = route[0].y
    out[out.length - 1][0] = route[route.length - 1].x
    out[out.length - 1][1] = route[route.length - 1].y
  }
  // 4. 角を丸める（半径 1.5m まで）
  const rounded = roundCorners(out, 1.5)
  // 5. 1m ごとの点
  const dense = resample(rounded, 1.0)
  // 6. 小物よけ
  if (opts.avoid) avoidProps(dense, opts)
  // 長さ
  const res: LinePoint[] = []
  let s = 0
  for (let i = 0; i < dense.length; i++) {
    if (i > 0) s += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1])
    res.push({ x: dense[i][0], y: dense[i][1], s, speed: dense[i][2], kind: dense[i][3], edge: dense[i][4] })
  }
  return res
}

function pathLength(pts: [number, number][]) {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return s
}

/** 点 A から向き a の直線と、点 B から向き b の直線の交わり（ほぼ平行なら null） */
function lineCross(A: [number, number], a: [number, number], B: [number, number], b: [number, number]): [number, number] | null {
  const den = a[0] * b[1] - a[1] * b[0]
  if (Math.abs(den) < 0.08) return null
  const t = ((B[0] - A[0]) * b[1] - (B[1] - A[1]) * b[0]) / den
  return [A[0] + a[0] * t, A[1] + a[1] * t]
}

type P5 = [number, number, number, number, number]

/** 角を 2 次曲線で丸める（角の前後 r まで。隣の線分の 45% より長くしない） */
function roundCorners(pts: P5[], r: number): P5[] {
  if (pts.length < 3) return pts
  const out: P5[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const la = Math.hypot(b[0] - a[0], b[1] - a[1])
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1])
    const ang = Math.abs(turnAngle(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]))
    if (ang < 0.12 || la < 1e-6 || lc < 1e-6) {
      out.push(b)
      continue
    }
    const rr = Math.min(r, la * 0.45, lc * 0.45)
    const p0 = [b[0] + ((a[0] - b[0]) * rr) / la, b[1] + ((a[1] - b[1]) * rr) / la]
    const p1 = [b[0] + ((c[0] - b[0]) * rr) / lc, b[1] + ((c[1] - b[1]) * rr) / lc]
    const n = Math.max(2, Math.ceil(ang / 0.25))
    for (let k = 0; k <= n; k++) {
      const u = k / n
      const x = (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * b[0] + u * u * p1[0]
      const y = (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * b[1] + u * u * p1[1]
      const src = u < 0.5 ? a : b
      out.push([x, y, src === a ? b[2] : c[2], src === a ? b[3] : c[3], src === a ? b[4] : c[4]])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** step m ごとの点に（点の属性は区間の始めの点のもの） */
function resample(pts: P5[], step: number): P5[] {
  const out: P5[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.ceil(l / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, k === n ? b[2] : a[2], k === n ? b[3] : a[3], k === n ? b[4] : a[4]])
    }
  }
  return out
}

/** 小物よけ: 点ごとに、近い小物から離れる横のずれを求め、前後 ±3 点でならして足す（1.2m まで） */
function avoidProps(pts: P5[], opts: LineOptions) {
  const n = pts.length
  const shift = new Float64Array(n)
  const nx = new Float64Array(n)
  const ny = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    nx[i] = -(b[1] - a[1]) / l
    ny[i] = (b[0] - a[0]) / l
  }
  for (let i = 1; i < n - 1; i++) {
    const [x, y] = pts[i]
    let push = 0
    for (const o of opts.avoid!(x, y, 2.5)) {
      const dx = x - o.x
      const dy = y - o.y
      const need = o.r + 0.45
      const d = Math.hypot(dx, dy)
      if (d >= need) continue
      // 横の向き（小物から離れる側。真上を通るときは道の真ん中の側）
      const lat = dx * nx[i] + dy * ny[i]
      const sign = Math.abs(lat) > 0.05 ? Math.sign(lat) : 1
      const along = dx * -ny[i] + dy * nx[i]
      const want = sign * (Math.sqrt(Math.max(0, need * need - along * along)) - Math.abs(lat))
      if (Math.abs(want) > Math.abs(push)) push = want
    }
    shift[i] = push
  }
  // ならす（大きい方を残すため、絶対値の大きい値を広げてから平均）
  const wide = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let best = 0
    for (let k = -2; k <= 2; k++) {
      const v = shift[Math.min(n - 1, Math.max(0, i + k))]
      if (Math.abs(v) > Math.abs(best)) best = v
    }
    wide[i] = best
  }
  for (let i = 1; i < n - 1; i++) {
    let acc = 0
    let w = 0
    for (let k = -3; k <= 3; k++) {
      const wk = 4 - Math.abs(k)
      acc += wide[Math.min(n - 1, Math.max(0, i + k))] * wk
      w += wk
    }
    // 1.2m か、道の幅の半分 − 0.3m まで
    const lim = Math.min(1.2, Math.max(0.2, opts.widthOf(pts[i][4]) / 2 - 0.3))
    const v = Math.max(-lim, Math.min(lim, acc / w))
    pts[i][0] += nx[i] * v
    pts[i][1] += ny[i] * v
  }
}
