import { EDGE_KIND, type EdgeKind, type WalkFile } from './walkData.ts'

/**
 * 町の道の経路探索（townNav）。町の歩く道のグラフ（walk.json）の上で、2 点の間のいちばん早い道を A*（二分ヒープ）で探す。
 * 重さは時間（分。平地 80 m/分、坂は Tobler 型、石段は段の速さ。tools/town/walkgraph.mjs）。
 *
 * 誰が使ってもよい独立した部品（花音の動き・カメラには依存しない。入力は町の平面座標、出力は経路）。使い方は docs/design/town.md §18。
 * このファイルは bun（tools/check-walk.mjs）からも読むので、walkData.ts のほかは import しない。
 *
 * 座標は町の平面座標（m。x = 東、y = 北）。シーンの座標へは x はそのまま、z = −y。
 */

export type XY = readonly [number, number]

export interface RouteOptions {
  /** ケーブル（丘ノ上ケーブル）に乗る辺を使うか（既定 false = 歩くだけ） */
  cable?: boolean
  /** 街区の中の私道（自動の路地）の時間に掛ける倍率（既定 1 = 罰なし。設定の道順の計算と同じ） */
  privatePenalty?: number
  /** 道から離れた点を道へつなぐ最大の距離（m。既定 60） */
  maxSnap?: number
  /** 点からこの距離（m）より近い節点があれば、その節点から（既定 3。設定の道順の計算と同じ） */
  nodeSnap?: number
}

/** 道の上に置いた点（edge の a → b の向きに、始めから along m） */
export interface SnapPoint {
  edge: number
  along: number
  x: number
  y: number
  /** 元の点から道までの距離（m） */
  dist: number
}

/** 経路の 1 区間（辺の一部か全部。forward = a → b の向き。from・to は a からの距離） */
export interface RouteStep {
  edge: number
  forward: boolean
  from: number
  to: number
  minutes: number
  kind: EdgeKind
}

export interface TownRoute {
  minutes: number
  /** 道のりの長さ（m。ケーブルの区間は 0） */
  length: number
  steps: RouteStep[]
  /** 着いた所（目的地の候補が複数のとき、どれか） */
  endNode: number | null
}

/** 経路の線の点（町の平面座標）。s = 始めからの長さ。kind・edge・speed はこの点から次の点までの区間（speed = 名目の速さ m/分） */
export interface RoutePoint {
  x: number
  y: number
  s: number
  kind: EdgeKind
  edge: number
  speed: number
}

/** 目的地: 点（道へつなぐ）・点の列（どれか）・節点の列（どれか。広場の縁など） */
export type RouteTarget = XY | { points: XY[] } | { nodes: number[] }

const CELL = 25

/** 二分ヒープ（優先度が小さい順） */
class Heap {
  private keys: number[] = []
  private vals: number[] = []
  get size() {
    return this.keys.length
  }
  push(key: number, val: number) {
    const k = this.keys
    const v = this.vals
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop(): [number, number] {
    const k = this.keys
    const v = this.vals
    const topK = k[0]
    const topV = v[0]
    const lastK = k.pop()!
    const lastV = v.pop()!
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && k[r] < k[l] ? r : l
        if (k[c] >= lastK) break
        k[i] = k[c]
        v[i] = v[c]
        i = c
      }
      k[i] = lastK
      v[i] = lastV
    }
    return [topK, topV]
  }
}

export class TownNav {
  readonly data: WalkFile
  readonly nodeCount: number
  private nx: Float64Array
  private ny: Float64Array
  /** 隣接（節点ごとの辺の番号の列。辺の向きは辺の a・b で見る） */
  private adj: number[][]
  /** 辺の形（a → b の点の列）と長さの累計 */
  private geom: Float64Array[] = []
  private cum: Float64Array[] = []
  /** 道へつなぐための索引（升目ごとの辺の番号） */
  private grid = new Map<number, number[]>()
  /** 速さの上限（m/分。A* の見積もり） */
  private vmaxWalk = 96
  private vmaxCable = 96

  constructor(data: WalkFile) {
    this.data = data
    const n = data.nodes.length / 2
    this.nodeCount = n
    this.nx = new Float64Array(n)
    this.ny = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      this.nx[i] = data.nodes[i * 2]
      this.ny[i] = data.nodes[i * 2 + 1]
    }
    this.adj = Array.from({ length: n }, () => [])
    data.edges.forEach((e, i) => {
      this.adj[e.a].push(i)
      if (e.b !== e.a) this.adj[e.b].push(i)
      const pts = [this.nx[e.a], this.ny[e.a], ...e.p, this.nx[e.b], this.ny[e.b]]
      const g = new Float64Array(pts)
      const c = new Float64Array(pts.length / 2)
      for (let k = 1; k < c.length; k++) c[k] = c[k - 1] + Math.hypot(g[k * 2] - g[k * 2 - 2], g[k * 2 + 1] - g[k * 2 - 1])
      this.geom.push(g)
      this.cum.push(c)
      const t = Math.min(e.tf, e.tb)
      const straight = Math.hypot(this.nx[e.b] - this.nx[e.a], this.ny[e.b] - this.ny[e.a])
      if (t > 1e-6) {
        const v = Math.max(straight, e.l) / t
        if (e.k === EDGE_KIND.cable || e.k === EDGE_KIND.cableBoard) this.vmaxCable = Math.max(this.vmaxCable, v)
        else this.vmaxWalk = Math.max(this.vmaxWalk, v)
      }
      if (e.k === EDGE_KIND.plaza || e.k === EDGE_KIND.cable || e.k === EDGE_KIND.cableBoard || e.k === EDGE_KIND.underground) return
      for (let k = 1; k < c.length; k++) {
        const ax = g[k * 2 - 2]
        const ay = g[k * 2 - 1]
        const bx = g[k * 2]
        const by = g[k * 2 + 1]
        for (let gx = Math.floor(Math.min(ax, bx) / CELL); gx <= Math.floor(Math.max(ax, bx) / CELL); gx++)
          for (let gy = Math.floor(Math.min(ay, by) / CELL); gy <= Math.floor(Math.max(ay, by) / CELL); gy++) {
            const key = gx * 100003 + gy
            let l = this.grid.get(key)
            if (!l) this.grid.set(key, (l = []))
            if (l[l.length - 1] !== i) l.push(i)
          }
      }
    })
    this.vmaxCable = Math.max(this.vmaxCable, this.vmaxWalk)
  }

  /** 節点の位置 */
  node(i: number): [number, number] {
    return [this.nx[i], this.ny[i]]
  }

  /** 辺の長さ（形の長さ。m） */
  edgeLength(e: number) {
    const c = this.cum[e]
    return c[c.length - 1]
  }

  /** 辺の上の a から along m の点 */
  pointOnEdge(e: number, along: number): [number, number] {
    const g = this.geom[e]
    const c = this.cum[e]
    const d = Math.min(Math.max(along, 0), c[c.length - 1])
    let k = 1
    while (k < c.length - 1 && c[k] < d) k++
    const l = c[k] - c[k - 1]
    const t = l > 0 ? (d - c[k - 1]) / l : 0
    return [g[k * 2 - 2] + (g[k * 2] - g[k * 2 - 2]) * t, g[k * 2 - 1] + (g[k * 2 + 1] - g[k * 2 - 1]) * t]
  }

  /** 辺の a → b の点の列（along の from から to まで。to < from なら逆向き） */
  edgePoints(e: number, from = 0, to = Infinity): [number, number][] {
    const c = this.cum[e]
    const L = c[c.length - 1]
    const a = Math.min(Math.max(from, 0), L)
    const b = Math.min(Math.max(to, 0), L)
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const g = this.geom[e]
    const out: [number, number][] = [this.pointOnEdge(e, lo)]
    for (let k = 1; k < c.length - 1; k++) if (c[k] > lo + 1e-6 && c[k] < hi - 1e-6) out.push([g[k * 2], g[k * 2 + 1]])
    out.push(this.pointOnEdge(e, hi))
    return a <= b ? out : out.reverse()
  }

  /** 点にいちばん近い道（広場・ケーブル・地下の道は除く。accept があれば、それが true の辺だけ）。maxDist m より遠ければ null */
  snap(x: number, y: number, maxDist = 60, accept?: (edge: number) => boolean): SnapPoint | null {
    let best: SnapPoint | null = null
    const r = Math.ceil(maxDist / CELL)
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    const seen = new Set<number>()
    // 近い升から順に広げ、見つかった距離より遠い升はやめる
    for (let ring = 0; ring <= r; ring++) {
      if (best && (ring - 1) * CELL > best.dist) break
      for (let gx = cx - ring; gx <= cx + ring; gx++)
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue
          for (const e of this.grid.get(gx * 100003 + gy) ?? []) {
            if (seen.has(e)) continue
            seen.add(e)
            if (accept && !accept(e)) continue
            const g = this.geom[e]
            const c = this.cum[e]
            for (let k = 1; k < c.length; k++) {
              const ax = g[k * 2 - 2]
              const ay = g[k * 2 - 1]
              const dx = g[k * 2] - ax
              const dy = g[k * 2 + 1] - ay
              const l2 = dx * dx + dy * dy
              const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
              const px = ax + dx * t
              const py = ay + dy * t
              const d = Math.hypot(px - x, py - y)
              if (d <= maxDist && (!best || d < best.dist)) best = { edge: e, along: c[k - 1] + t * Math.sqrt(l2), x: px, y: py, dist: d }
            }
          }
        }
    }
    return best
  }

  /** いちばん近い節点（ケーブルの駅の節点は除く） */
  nearestNode(x: number, y: number) {
    const stations = new Set(this.data.cable.map((c) => c.node))
    let best = -1
    let bd = Infinity
    for (let i = 0; i < this.nodeCount; i++) {
      if (stations.has(i)) continue
      const d = (this.nx[i] - x) ** 2 + (this.ny[i] - y) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  /** 広場の縁の節点（id は plaza.funsui など） */
  plazaNodes(id: string) {
    return this.data.plazas.find((p) => p.id === id)?.nodes ?? []
  }

  /** ケーブルの駅（id は station.cable-fumoto など） */
  station(id: string) {
    return this.data.cable.find((c) => c.id === id) ?? null
  }

  private edgeAllowed(e: number, opts: RouteOptions) {
    const k = this.data.edges[e].k
    if (!opts.cable && (k === EDGE_KIND.cable || k === EDGE_KIND.cableBoard)) return false
    return true
  }

  private edgeTime(e: number, forward: boolean, opts: RouteOptions) {
    const ed = this.data.edges[e]
    let t = forward ? ed.tf : ed.tb
    const pen = opts.privatePenalty ?? 1
    if (pen !== 1 && ed.f >= 0 && this.data.feats[ed.f]?.private) t *= pen
    return t
  }

  /**
   * from から to まで、いちばん早い経路。from は点（いちばん近い道へつなぐ）か節点の番号。見つからなければ null。
   * 時間・長さに、点から道までのつなぎ（直線）は含めない
   */
  route(from: XY | number, to: RouteTarget | number, opts: RouteOptions = {}): TownRoute | null {
    const maxSnap = opts.maxSnap ?? 60
    const N = this.nodeCount
    const START = N
    const GOAL = N + 1
    // 出発: 節点か、道の上の点（辺の両端へ、その割合の時間で）
    let startSnap: SnapPoint | null = null
    const nodeSnap = opts.nodeSnap ?? 3
    if (typeof from !== 'number' && nodeSnap > 0) {
      const n = this.nearestNode(from[0], from[1])
      if (n >= 0 && Math.hypot(this.nx[n] - from[0], this.ny[n] - from[1]) <= nodeSnap) from = n
    }
    if (typeof from !== 'number') {
      startSnap = this.snap(from[0], from[1], maxSnap)
      if (!startSnap) return null
    }
    // 目的地
    const goalNodes = new Set<number>()
    const goalSnaps: SnapPoint[] = []
    if (typeof to === 'number') goalNodes.add(to)
    else if ('nodes' in to) for (const n of to.nodes) goalNodes.add(n)
    else {
      const pts = 'points' in to ? to.points : [to as XY]
      for (const p of pts) {
        const n = nodeSnap > 0 ? this.nearestNode(p[0], p[1]) : -1
        if (n >= 0 && Math.hypot(this.nx[n] - p[0], this.ny[n] - p[1]) <= nodeSnap) {
          goalNodes.add(n)
          continue
        }
        const s = this.snap(p[0], p[1], maxSnap)
        if (s) goalSnaps.push(s)
      }
      if (!goalSnaps.length && !goalNodes.size) return null
    }
    if (!goalNodes.size && !goalSnaps.length) return null
    // 見積もり（目的地の候補までのいちばん近い直線 ÷ 速さの上限）
    const targets: [number, number][] = [...[...goalNodes].map((n) => this.node(n)), ...goalSnaps.map((s) => [s.x, s.y] as [number, number])]
    const vmax = opts.cable ? this.vmaxCable : this.vmaxWalk
    const h = (x: number, y: number) => {
      let d = Infinity
      for (const t of targets) d = Math.min(d, Math.hypot(t[0] - x, t[1] - y))
      return d / vmax
    }
    const dist = new Map<number, number>()
    const prev = new Map<number, { u: number; step: RouteStep }>()
    const heap = new Heap()
    const relax = (u: number, v: number, t: number, step: RouteStep) => {
      const nd = (dist.get(u) ?? Infinity) + t
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd)
        prev.set(v, { u, step })
        const [x, y] = v === GOAL ? [0, 0] : this.node(v)
        heap.push(nd + (v === GOAL ? 0 : h(x, y)), v)
      }
    }
    const goalSnapOn = (e: number) => goalSnaps.filter((s) => s.edge === e)
    const stepOf = (e: number, forward: boolean, a: number, b: number, opts2: RouteOptions): RouteStep => {
      const L = this.edgeLength(e)
      const ed = this.data.edges[e]
      const frac = L > 0 ? Math.abs(b - a) / L : 1
      return { edge: e, forward, from: a, to: b, minutes: this.edgeTime(e, forward, opts2) * frac, kind: ed.k }
    }
    dist.set(START, 0)
    if (typeof from === 'number') {
      dist.set(from, 0)
      heap.push(h(...this.node(from)), from)
    } else {
      const s = startSnap!
      const L = this.edgeLength(s.edge)
      const ed = this.data.edges[s.edge]
      const toA = stepOf(s.edge, false, s.along, 0, opts)
      const toB = stepOf(s.edge, true, s.along, L, opts)
      relax(START, ed.a, toA.minutes, toA)
      relax(START, ed.b, toB.minutes, toB)
      // 同じ辺の上の目的地
      for (const g of goalSnapOn(s.edge)) {
        const st = stepOf(s.edge, g.along >= s.along, s.along, g.along, opts)
        relax(START, GOAL, st.minutes, st)
      }
    }
    const done = new Set<number>()
    let reached = -1
    while (heap.size) {
      const [, u] = heap.pop()
      if (done.has(u)) continue
      done.add(u)
      if (u === GOAL || goalNodes.has(u)) {
        reached = u
        break
      }
      for (const e of this.adj[u]) {
        if (!this.edgeAllowed(e, opts)) continue
        const ed = this.data.edges[e]
        const L = this.edgeLength(e)
        const forward = ed.a === u
        const v = forward ? ed.b : ed.a
        relax(u, v, this.edgeTime(e, forward, opts), stepOf(e, forward, forward ? 0 : L, forward ? L : 0, opts))
        if (ed.a === ed.b) relax(u, v, this.edgeTime(e, !forward, opts), stepOf(e, !forward, forward ? L : 0, forward ? 0 : L, opts))
        for (const g of goalSnapOn(e)) {
          const st = stepOf(e, forward, forward ? 0 : L, g.along, opts)
          relax(u, GOAL, st.minutes, st)
        }
      }
    }
    if (reached < 0) return null
    const steps: RouteStep[] = []
    let v = reached
    while (prev.has(v)) {
      const p = prev.get(v)!
      steps.push(p.step)
      v = p.u
      if (v === START || (typeof from === 'number' && v === from)) break
    }
    steps.reverse()
    const minutes = steps.reduce((s, st) => s + st.minutes, 0)
    const length = steps.reduce((s, st) => s + (this.data.edges[st.edge].l > 0 ? Math.abs(st.to - st.from) : 0), 0)
    return { minutes, length, steps, endNode: reached === GOAL ? null : reached }
  }

  /** 経路の線（点の列。s = 始めからの長さ） */
  polyline(route: TownRoute): RoutePoint[] {
    const out: RoutePoint[] = []
    for (const st of route.steps) {
      const pts = this.edgePoints(st.edge, st.from, st.to)
      const len = Math.abs(st.to - st.from)
      const ed = this.data.edges[st.edge]
      const speed = st.minutes > 1e-9 && len > 0 ? len / st.minutes : 80
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i]
        const last = out[out.length - 1]
        if (last && Math.hypot(last.x - x, last.y - y) < 1e-4) {
          // つなぎ目: 次の区間の種類と速さにする
          if (i === 0) {
            last.kind = ed.k
            last.edge = st.edge
            last.speed = speed
          }
          continue
        }
        const s = last ? last.s + Math.hypot(last.x - x, last.y - y) : 0
        out.push({ x, y, s, kind: ed.k, edge: st.edge, speed })
      }
    }
    return out
  }

  /** 経路が通る道の名前（続けて同じものはまとめる） */
  namesOn(route: TownRoute) {
    const out: string[] = []
    for (const st of route.steps) {
      const n = this.data.names[this.data.edges[st.edge].n]
      if (n && out[out.length - 1] !== n && !n.startsWith('（')) out.push(n)
    }
    return out
  }
}
