// 町全体の歩く道のグラフ（アセットの根の town/walk.json）を作る。pnpm sync:town から呼ぶ。
// 決まりは町の地図データの tools/routegraph.py（D-005・D-037）をそのまま JS にしたもの:
//   - 辺: road（緑電の専用軌道 tram_only は除く）・stairs・bridge を、交わる所・触れる所で切ったもの（座標は 0.2m の格子にそろえる）。
//     重なる所は stairs → bridge → road の順に優先する。道の上に重なる橋（道の 0.6m の帯の中に収まる橋）は辺にせず、その区間の道の高さを橋の路面にする
//   - 地下の道（no_junction）は端でだけつながる（1.5m 以内のいちばん近い節点）
//   - 広場（plaza）は中を自由に歩ける: 広場から 3m 以内の節点どうしを、広場の 3.5m の帯の中に収まる直線で結ぶ
//   - 時間（分）: 平地 80 m/分、坂は Tobler 型。石段は 上り 0.55 秒/段・下り 0.45 秒/段 ＋ 踏面ぶんの歩行。橋・地下は平ら
//   - ケーブル: 麓駅―楓坂駅―頂上駅を、全線 4 分の比例の時間で結ぶ。乗り降りに各 0.5 分
// 形の版は core/town.ts の TOWN_DATA.format（9 = walk.json を足した）。読み方は core/walk/・world/walk/（docs/design/town.md §18）
import { insidePolygon, openRing, segDist } from './geo.mjs'

export const WALK = 80.0
const STAIR_UP = 0.55
const STAIR_DOWN = 0.45
const CABLE_TOTAL_MIN = 4.0
const CABLE_BOARD_MIN = 0.5
const PRIORITY = { stairs: 3, bridge: 2, road: 1 }
/** 辺の種類（walk.json の k） */
export const EDGE_KIND = { road: 0, stairs: 1, bridge: 2, underground: 3, plaza: 4, cableBoard: 5, cable: 6 }

const tobler = (g) => (WALK * Math.exp(-3.5 * Math.abs(g + 0.05))) / Math.exp(-3.5 * 0.05)
const snap = (v) => Math.round(v * 5) / 5
const keyOf = (x, y) => `${Math.round(x * 10)}_${Math.round(y * 10)}`
const r1 = (v) => Math.round(v * 10) / 10
const r3 = (v) => Math.round(v * 1000) / 1000

const lineParts = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])

/** 線分の索引（升目 cell m） */
class SegIndex {
  constructor(cell) {
    this.cell = cell
    this.map = new Map()
  }
  add(item, ax, ay, bx, by, pad = 0) {
    const c = this.cell
    const x0 = Math.floor((Math.min(ax, bx) - pad) / c)
    const x1 = Math.floor((Math.max(ax, bx) + pad) / c)
    const y0 = Math.floor((Math.min(ay, by) - pad) / c)
    const y1 = Math.floor((Math.max(ay, by) + pad) / c)
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const k = gx * 1000003 + gy
        let l = this.map.get(k)
        if (!l) this.map.set(k, (l = []))
        l.push(item)
      }
  }
  near(x, y, r) {
    const c = this.cell
    const out = new Set()
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
      for (let gy = Math.floor((y - r) / c); gy <= Math.floor((y + r) / c); gy++) for (const it of this.map.get(gx * 1000003 + gy) ?? []) out.add(it)
    return out
  }
}

/** 点から折れ線までの距離 */
function polyDist(px, py, pts) {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]))
  return best
}

/** 折れ線の長さ */
function lengthOf(pts) {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return s
}

/** 折れ線の上の距離 d の点 */
function pointAt(pts, d) {
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (acc + l >= d || i === pts.length - 1) {
      const t = l > 0 ? Math.min(1, Math.max(0, (d - acc) / l)) : 0
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]
    }
    acc += l
  }
  return pts[pts.length - 1]
}

/** 点を折れ線に投影した、始めからの距離 */
function projectOn(pts, x, y) {
  let best = Infinity
  let at = 0
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0]
    const ay = pts[i - 1][1]
    const dx = pts[i][0] - ax
    const dy = pts[i][1] - ay
    const l2 = dx * dx + dy * dy
    const l = Math.sqrt(l2)
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y)
    if (d < best) {
      best = d
      at = acc + t * l
    }
    acc += l
  }
  return at
}

/** 点から多角形（輪の配列）までの距離（中なら 0） */
function polygonDist(x, y, rings) {
  if (insidePolygon(x, y, rings)) return 0
  let best = Infinity
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) best = Math.min(best, segDist(x, y, r[j][0], r[j][1], r[i][0], r[i][1]))
  return best
}

/** 2 つの線分の交わり（端が触れる・重なるも）。線分 1 の上の割合 t の列 */
function intersections(ax, ay, bx, by, cx, cy, dx, dy) {
  const out = []
  const rx = bx - ax
  const ry = by - ay
  const sx = dx - cx
  const sy = dy - cy
  const den = rx * sy - ry * sx
  const l1 = Math.hypot(rx, ry)
  const eps = 1e-6
  if (l1 < eps) return out
  if (Math.abs(den) > 1e-9 * l1 * Math.hypot(sx, sy)) {
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den
    const u = ((cx - ax) * ry - (cy - ay) * rx) / den
    const tt = 1e-7
    if (t >= -tt && t <= 1 + tt && u >= -tt && u <= 1 + tt) out.push(Math.min(1, Math.max(0, t)))
    return out
  }
  // 平行: 同じ直線の上で重なるなら、相手の端を割合に
  const dist = Math.abs((cx - ax) * ry - (cy - ay) * rx) / l1
  if (dist > 1e-4) return out
  for (const [px, py] of [
    [cx, cy],
    [dx, dy],
  ]) {
    const t = ((px - ax) * rx + (py - ay) * ry) / (l1 * l1)
    if (t > -1e-7 && t < 1 + 1e-7) out.push(Math.min(1, Math.max(0, t)))
  }
  return out
}

/**
 * 歩く道のグラフを作る。L: 層ごとに分けた地図データ（roads・railway・transit）。heightAt(x, y): 地形の標高（水面を下げる前の高さ画像）
 */
export function buildWalkGraph(L, heightAt) {
  const roads = L.roads
  const feats = []
  for (const layer of ['road', 'stairs', 'bridge'])
    for (const f of roads[layer] ?? []) {
      const p = f.properties
      if (p.tram_only) continue
      for (const part of lineParts(f.geometry)) if (part.length >= 2) feats.push({ f, p, layer, pts: part.map((c) => [c[0], c[1]]), pts3: part })
    }
  // 道の帯（道の上に重なる橋を見分ける）
  const roadIndex = new SegIndex(25)
  const roadLines = feats.filter((e) => e.layer === 'road' && !e.p.no_junction)
  roadLines.forEach((e, i) => {
    for (let k = 1; k < e.pts.length; k++) roadIndex.add([i, k], e.pts[k - 1][0], e.pts[k - 1][1], e.pts[k][0], e.pts[k][1], 1)
  })
  const nearRoad = (x, y, r) => {
    for (const [i, k] of roadIndex.near(x, y, r)) {
      const q = roadLines[i].pts
      if (segDist(x, y, q[k - 1][0], q[k - 1][1], q[k][0], q[k][1]) <= r) return true
    }
    return false
  }
  const decks = []
  const normal = []
  const special = []
  for (const e of feats) {
    if (e.layer === 'bridge') {
      const L0 = lengthOf(e.pts)
      const n = Math.max(2, Math.ceil(L0 / 0.5))
      let inside = true
      for (let i = 0; i <= n && inside; i++) {
        const [x, y] = pointAt(e.pts, (L0 * i) / n)
        if (!nearRoad(x, y, 0.6)) inside = false
      }
      if (inside) {
        decks.push({ pts: e.pts, deck: e.p.deck_z_m ?? null, width: e.p.width_m ?? 6, id: e.p.id })
        continue
      }
    }
    if (e.p.no_junction) special.push(e)
    else normal.push(e)
  }

  // --- 交わる所で切る（座標は 0.2m の格子にそろえる。shapely の union_all(grid_size=0.2) と同じ考え） ---
  for (const e of normal) {
    const out = []
    for (const p of e.pts) {
      const q = [snap(p[0]), snap(p[1])]
      if (!out.length || out[out.length - 1][0] !== q[0] || out[out.length - 1][1] !== q[1]) out.push(q)
    }
    e.pts = out
  }
  const segIndex = new SegIndex(20)
  const segs = []
  normal.forEach((e, fi) => {
    for (let k = 1; k < e.pts.length; k++) {
      const s = { fi, k, ax: e.pts[k - 1][0], ay: e.pts[k - 1][1], bx: e.pts[k][0], by: e.pts[k][1], cuts: [] }
      segs.push(s)
      segIndex.add(s, s.ax, s.ay, s.bx, s.by, 0.01)
    }
  })
  for (const s of segs) {
    const cand = new Set()
    const c = segIndex.cell
    for (let gx = Math.floor((Math.min(s.ax, s.bx) - 0.01) / c); gx <= Math.floor((Math.max(s.ax, s.bx) + 0.01) / c); gx++)
      for (let gy = Math.floor((Math.min(s.ay, s.by) - 0.01) / c); gy <= Math.floor((Math.max(s.ay, s.by) + 0.01) / c); gy++) for (const o of segIndex.map.get(gx * 1000003 + gy) ?? []) cand.add(o)
    for (const o of cand) {
      if (o === s) continue
      // 同じ線の隣どうしの線分は、つなぎ目で触れているだけ
      if (o.fi === s.fi && Math.abs(o.k - s.k) === 1) continue
      for (const t of intersections(s.ax, s.ay, s.bx, s.by, o.ax, o.ay, o.bx, o.by)) s.cuts.push({ t, p: [snap(s.ax + (s.bx - s.ax) * t), snap(s.ay + (s.by - s.ay) * t)] })
      // 相手の端が 0.15m 以内に触れている（格子にそろえた丸めで、ちょうど線の上に乗らない T 字）: 相手の端の点で切る
      const sl2 = (s.bx - s.ax) ** 2 + (s.by - s.ay) ** 2
      if (sl2 <= 0) continue
      for (const [px, py] of [
        [o.ax, o.ay],
        [o.bx, o.by],
      ]) {
        if (segDist(px, py, s.ax, s.ay, s.bx, s.by) > 0.15) continue
        const t = ((px - s.ax) * (s.bx - s.ax) + (py - s.ay) * (s.by - s.ay)) / sl2
        // 線分の端（折れ線の途中の頂点）に触れるときも切る
        s.cuts.push({ t: Math.min(1, Math.max(0, t)), p: [px, py] })
      }
    }
  }
  // 線ごとに、切る点で分けた折れ線（端は 0.2m の格子）
  const pieces = []
  const segsOf = normal.map(() => [])
  for (const s of segs) segsOf[s.fi].push(s)
  normal.forEach((e, fi) => {
    let cur = [e.pts[0]]
    const mySegs = segsOf[fi]
    for (const s of mySegs) {
      const cuts = [...s.cuts].sort((a, b) => a.t - b.t)
      for (const { p } of cuts) {
        const last = cur[cur.length - 1]
        if (p[0] === last[0] && p[1] === last[1]) {
          if (cur.length >= 2) {
            pieces.push({ fi, pts: cur })
            cur = [p]
          }
          continue
        }
        cur.push(p)
        pieces.push({ fi, pts: cur })
        cur = [p]
      }
      const b = [s.bx, s.by]
      const last = cur[cur.length - 1]
      if (b[0] !== last[0] || b[1] !== last[1]) cur.push(b)
    }
    if (cur.length >= 2) pieces.push({ fi, pts: cur })
  })
  // 重なる区間（同じ両端・ほぼ同じ長さ）は、優先の高い線の 1 本にする
  const byEnds = new Map()
  for (const pc of pieces) {
    const a = pc.pts[0]
    const b = pc.pts[pc.pts.length - 1]
    const len = lengthOf(pc.pts)
    if (len < 0.01) continue
    pc.len = len
    const ka = keyOf(a[0], a[1])
    const kb = keyOf(b[0], b[1])
    const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    const list = byEnds.get(k) ?? []
    const dup = list.find((o) => Math.abs(o.len - len) < Math.max(0.05, len * 0.01) && polyDist(...pointAt(pc.pts, len / 2), o.pts) < 0.3)
    if (dup) {
      if (PRIORITY[normal[pc.fi].layer] > PRIORITY[normal[dup.fi].layer]) Object.assign(dup, pc)
      continue
    }
    list.push(pc)
    byEnds.set(k, list)
  }
  const kept = [...byEnds.values()].flat()

  // --- 節点と辺 ---
  const nodes = []
  const nodeOf = new Map()
  const node = (x, y) => {
    const k = keyOf(x, y)
    let i = nodeOf.get(k)
    if (i === undefined) {
      i = nodes.length
      nodes.push([x, y])
      nodeOf.set(k, i)
    }
    return i
  }
  const edges = []
  const names = []
  const nameIndex = new Map()
  const nameOf = (n) => {
    if (!n) return -1
    let i = nameIndex.get(n)
    if (i === undefined) {
      i = names.length
      names.push(n)
      nameIndex.set(n, i)
    }
    return i
  }
  const featList = []
  const featIndex = new Map()
  const featOf = (p, layer) => {
    let i = featIndex.get(p.id)
    if (i === undefined) {
      i = featList.length
      featList.push({ id: p.id, layer, cls: p.class ?? null, width: p.width_m ?? (layer === 'stairs' ? 3 : 4), private: !!p.private, surface: p.surface ?? null })
      featIndex.set(p.id, i)
    }
    return i
  }
  // 橋の路面（道の上に重なる橋）: 1m の帯の中の点の高さ
  const deckIndex = new SegIndex(20)
  decks.forEach((d, i) => {
    for (let k = 1; k < d.pts.length; k++) deckIndex.add([i, k], d.pts[k - 1][0], d.pts[k - 1][1], d.pts[k][0], d.pts[k][1], 1.2)
  })
  const deckAt = (x, y) => {
    for (const [i, k] of deckIndex.near(x, y, 1.0)) {
      const d = decks[i]
      if (d.deck === null) continue
      const q = d.pts
      if (segDist(x, y, q[k - 1][0], q[k - 1][1], q[k][0], q[k][1]) <= 1.0) return d.deck
    }
    return null
  }
  const addEdge = (e, pts) => {
    const p = e.p
    const len = lengthOf(pts)
    const a = node(pts[0][0], pts[0][1])
    const b = node(pts[pts.length - 1][0], pts[pts.length - 1][1])
    let kind = EDGE_KIND.road
    let tf
    let tb
    if (e.layer === 'stairs') {
      kind = EDGE_KIND.stairs
      const full = e.full ?? e.pts
      const fullLen = lengthOf(full)
      const steps = p.steps * (len / Math.max(fullLen, 1e-6))
      const walk = len / WALK
      const upDir = projectOn(full, pts[pts.length - 1][0], pts[pts.length - 1][1]) > projectOn(full, pts[0][0], pts[0][1])
      const tUp = (steps * STAIR_UP) / 60 + walk
      const tDn = (steps * STAIR_DOWN) / 60 + walk
      tf = upDir ? tUp : tDn
      tb = upDir ? tDn : tUp
    } else if (e.layer === 'bridge' || p.underground) {
      kind = p.underground ? EDGE_KIND.underground : EDGE_KIND.bridge
      tf = tb = len / WALK
    } else {
      const n = Math.max(2, Math.ceil(len / 5.0) + 1)
      const xs = []
      const ys = []
      const zs = []
      for (let i = 0; i < n; i++) {
        const [x, y] = pointAt(pts, (len * i) / (n - 1))
        xs.push(x)
        ys.push(y)
        zs.push(deckAt(x, y) ?? heightAt(x, y))
      }
      tf = 0
      tb = 0
      for (let i = 1; i < n; i++) {
        const dxy = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
        if (dxy <= 0) continue
        const g = (zs[i] - zs[i - 1]) / Math.max(dxy, 1e-6)
        tf += dxy / tobler(g)
        tb += dxy / tobler(-g)
      }
    }
    edges.push({ a, b, k: kind, l: r3(len), tf: r3(tf * 1000) / 1000, tb: r3(tb * 1000) / 1000, f: featOf(p, e.layer), n: nameOf(p.name), p: pts.slice(1, -1).flatMap((q) => [r1(q[0]), r1(q[1])]) })
  }
  // 石段の全体の形（段の数の割合）
  for (const e of normal) if (e.layer === 'stairs') e.full = e.pts
  for (const pc of kept) {
    // 区間の真ん中から 0.3m 以内の線のうち、優先の高いもの（routegraph.py と同じ）
    const mid = pointAt(pc.pts, pc.len / 2)
    let best = normal[pc.fi]
    for (const s of segIndex.near(mid[0], mid[1], 0.3)) {
      const o = normal[s.fi]
      if (segDist(mid[0], mid[1], s.ax, s.ay, s.bx, s.by) < 0.3 && PRIORITY[o.layer] > PRIORITY[best.layer]) best = o
    }
    addEdge(best, pc.pts)
  }
  // 地下の道: 端だけ、1.5m 以内のいちばん近い節点へ
  const nearestNode = (x, y, maxd = Infinity) => {
    let best = -1
    let bd = Infinity
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - y) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return Math.sqrt(bd) <= maxd ? best : -1
  }
  for (const e of special) {
    const pts = e.pts.map((q) => [q[0], q[1]])
    for (const end of [0, pts.length - 1]) {
      const k = nearestNode(pts[end][0], pts[end][1], 1.5)
      if (k >= 0) pts[end] = [...nodes[k]]
    }
    addEdge(e, pts)
  }

  // --- 広場 ---
  const plazas = []
  for (const f of roads.plaza ?? []) {
    if (f.geometry.type !== 'Polygon') continue
    const rings = f.geometry.coordinates.map(openRing)
    plazas.push({ id: f.properties.id, name: f.properties.name ?? null, ring: rings[0].map((q) => [r1(q[0]), r1(q[1])]), nodes: [] })
    const pl = plazas[plazas.length - 1]
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const q of rings[0]) {
      x0 = Math.min(x0, q[0])
      x1 = Math.max(x1, q[0])
      y0 = Math.min(y0, q[1])
      y1 = Math.max(y1, q[1])
    }
    const ks = []
    for (let i = 0; i < nodes.length; i++) {
      const [x, y] = nodes[i]
      if (x < x0 - 3 || x > x1 + 3 || y < y0 - 3 || y > y1 + 3) continue
      if (polygonDist(x, y, rings) <= 3.0) ks.push(i)
    }
    pl.nodes = ks
    const inBody = (x, y) => polygonDist(x, y, rings) <= 3.5
    for (let i = 0; i < ks.length; i++)
      for (let j = i + 1; j < ks.length; j++) {
        const a = nodes[ks[i]]
        const b = nodes[ks[j]]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const n = Math.max(2, Math.ceil(len / 0.5))
        let ok = true
        for (let s = 0; s <= n && ok; s++) if (!inBody(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n)) ok = false
        if (!ok) continue
        const t = len / WALK
        edges.push({ a: ks[i], b: ks[j], k: EDGE_KIND.plaza, l: r3(len), tf: r3(t * 1000) / 1000, tb: r3(t * 1000) / 1000, f: -1, n: nameOf(f.properties.name), p: [] })
      }
  }

  // --- ケーブル ---
  const stations = (L.railway.station ?? []).filter((f) => f.properties.line === '丘ノ上ケーブル').sort((a, b) => a.properties.chainage_m - b.properties.chainage_m)
  const cableLine = L.railway.cable_railway?.[0]
  const cable = []
  if (cableLine && stations.length >= 2) {
    const total = lengthOf(cableLine.geometry.coordinates.map((c) => [c[0], c[1]]))
    const cableName = nameOf('丘ノ上ケーブル')
    const boardName = nameOf('ケーブルの乗り降り')
    for (const f of stations) {
      const [x, y] = f.geometry.coordinates
      const k = nearestNode(x, y)
      const pk = nodes.length
      nodes.push([x, y])
      cable.push({ id: f.properties.id, name: f.properties.name, node: pk, street: k, x: r1(x), y: r1(y), z: f.geometry.coordinates[2] ?? null, chainage: f.properties.chainage_m })
      edges.push({ a: k, b: pk, k: EDGE_KIND.cableBoard, l: 0, tf: CABLE_BOARD_MIN, tb: CABLE_BOARD_MIN, f: -1, n: boardName, p: [] })
    }
    for (let i = 1; i < cable.length; i++) {
      const t = (CABLE_TOTAL_MIN * (cable[i].chainage - cable[i - 1].chainage)) / total
      edges.push({ a: cable[i - 1].node, b: cable[i].node, k: EDGE_KIND.cable, l: 0, tf: r3(t * 1000) / 1000, tb: r3(t * 1000) / 1000, f: -1, n: cableName, p: [] })
    }
  }

  // --- 石段の形（足の高さ・形） ---
  const stairs = (roads.stairs ?? []).map((f) => {
    const p = f.properties
    return {
      id: p.id,
      name: p.name ?? null,
      pts: f.geometry.coordinates.map((c) => [r1(c[0]), r1(c[1]), Math.round((c[2] ?? 0) * 100) / 100]),
      steps: p.steps,
      riser: p.step_rise_m ?? p.riser_m ?? 0.16,
      tread: p.tread_m ?? 0.3,
      width: p.width_m ?? 2,
      landings: p.landings ?? 0,
      landingLen: p.landing_length_m ?? 0,
      rise: p.rise_m ?? null,
      surface: p.surface ?? null,
    }
  })
  // 踏切
  const crossings = (roads.rail_crossing ?? []).map((f) => ({ id: f.properties.id, kind: f.properties.kind ?? null, road: f.properties.road_id ?? null, rail: f.properties.rail_id ?? null, x: r1(f.geometry.coordinates[0]), y: r1(f.geometry.coordinates[1]) }))

  return {
    nodes,
    edges,
    names,
    feats: featList,
    decks: decks.map((d) => ({ id: d.id, pts: d.pts.map((q) => [r1(q[0]), r1(q[1])]), deck: d.deck, width: d.width })),
    plazas: plazas.map((p) => ({ id: p.id, name: p.name, ring: p.ring, nodes: p.nodes })),
    stairs,
    crossings,
    cable,
  }
}

/** walk.json に書く形（節点は平らな配列） */
export function walkFile(g, extra = {}) {
  return {
    nodes: g.nodes.flatMap((p) => [r1(p[0]), r1(p[1])]),
    edges: g.edges,
    names: g.names,
    feats: g.feats,
    decks: g.decks,
    plazas: g.plazas,
    stairs: g.stairs,
    crossings: g.crossings,
    cable: g.cable,
    ...extra,
  }
}

/** 辺の点の列（両端の節点と途中の点） */
function edgePoints(g, e) {
  return [g.nodes[e.a], ...Array.from({ length: e.p.length / 2 }, (_, i) => [e.p[i * 2], e.p[i * 2 + 1]]), g.nodes[e.b]]
}

/** 2 つの線分の距離（交われば 0） */
function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(segDist(ax, ay, cx, cy, dx, dy), segDist(bx, by, cx, cy, dx, dy), segDist(cx, cy, ax, ay, bx, by), segDist(dx, dy, ax, ay, bx, by))
}

/**
 * 道の面（歩く道のグラフの道・石段・橋の中心線と幅。広場・ケーブル・地下の道は除く）の索引。
 * 街区の自動の建物を道にかけない（autofill.mjs）・道にかかる建物の検算（sync-town.mjs）が使う。
 * 町の地図データの道は中心線と幅だけなので、道の面 = 中心線から幅の半分の帯
 */
export class RoadStrips {
  constructor(g) {
    this.index = new SegIndex(20)
    this.count = 0
    for (const e of g.edges) {
      if (e.k === EDGE_KIND.plaza || e.k === EDGE_KIND.cable || e.k === EDGE_KIND.cableBoard || e.k === EDGE_KIND.underground) continue
      const feat = g.feats[e.f]
      if (!feat) continue
      const half = feat.width / 2
      const pts = edgePoints(g, e)
      for (let i = 1; i < pts.length; i++) {
        const s = { ax: pts[i - 1][0], ay: pts[i - 1][1], bx: pts[i][0], by: pts[i][1], half, feat: feat.id, name: g.names[e.n] ?? null }
        this.index.add(s, s.ax, s.ay, s.bx, s.by, half + 1)
        this.count++
      }
    }
  }

  /**
   * 多角形（輪 ring。平面座標）が道の面（幅の半分 + margin m）にかかるか。かからなければ null。
   * かかるなら、いちばん深くかかった道（feat・name）と、そこから離すのに要る動き push（平面のベクトル。道の線から多角形の中心へ向かう向き）
   */
  hit(ring, margin = 0) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let cx = 0
    let cy = 0
    for (const q of ring) {
      x0 = Math.min(x0, q[0])
      x1 = Math.max(x1, q[0])
      y0 = Math.min(y0, q[1])
      y1 = Math.max(y1, q[1])
      cx += q[0] / ring.length
      cy += q[1] / ring.length
    }
    const r = Math.hypot(x1 - x0, y1 - y0) / 2
    let worst = null
    for (const s of this.index.near((x0 + x1) / 2, (y0 + y1) / 2, r + 1)) {
      const need = s.half + margin
      // 道の線分の端が多角形の中なら 0、そうでなければ辺どうしのいちばん近い距離
      let d = insidePolygon(s.ax, s.ay, [ring]) || insidePolygon(s.bx, s.by, [ring]) ? 0 : Infinity
      for (let i = 0, j = ring.length - 1; i < ring.length && d > 0; j = i++) d = Math.min(d, segSegDist(ring[j][0], ring[j][1], ring[i][0], ring[i][1], s.ax, s.ay, s.bx, s.by))
      if (d >= need) continue
      // 離す向き: 道の線分の法線のうち、多角形の中心の側。離す長さ: 多角形の頂点のうち、道の線にいちばん近い（向こう側へ越えた）頂点を need の外へ
      const dx = s.bx - s.ax
      const dy = s.by - s.ay
      const l = Math.hypot(dx, dy) || 1
      let nx = -dy / l
      let ny = dx / l
      const side = (cx - s.ax) * nx + (cy - s.ay) * ny
      if (side < 0) {
        nx = -nx
        ny = -ny
      }
      let minOff = Infinity
      for (const q of ring) minOff = Math.min(minOff, (q[0] - s.ax) * nx + (q[1] - s.ay) * ny)
      const move = need - minOff + 0.05
      if (!worst || move > worst.move) worst = { feat: s.feat, name: s.name, move, push: [nx * move, ny * move] }
    }
    return worst
  }
}

/**
 * 検算: 歩く道の中心線（石段・橋・道。広場とケーブルは除く）に、建物の足元（footprints: 輪の配列）がかかる所。
 * 2m ごとの点で見る。戻り値: かかった辺の数と、例（いくつか）
 */
export function roadBuildingCheck(g, footprints) {
  const index = new SegIndex(30)
  footprints.forEach((ring, i) => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const q of ring) {
      x0 = Math.min(x0, q[0])
      x1 = Math.max(x1, q[0])
      y0 = Math.min(y0, q[1])
      y1 = Math.max(y1, q[1])
    }
    index.add({ i, x0, y0, x1, y1 }, x0, y0, x1, y1)
  })
  const hits = []
  for (const e of g.edges) {
    if (e.k === EDGE_KIND.plaza || e.k === EDGE_KIND.cable || e.k === EDGE_KIND.cableBoard || e.k === EDGE_KIND.underground) continue
    const pts = [g.nodes[e.a], ...Array.from({ length: e.p.length / 2 }, (_, i) => [e.p[i * 2], e.p[i * 2 + 1]]), g.nodes[e.b]]
    const len = lengthOf(pts)
    const n = Math.max(1, Math.ceil(len / 2))
    let hit = null
    for (let s = 0; s <= n && !hit; s++) {
      const [x, y] = pointAt(pts, (len * s) / n)
      for (const b of index.near(x, y, 0)) {
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue
        if (insidePolygon(x, y, [footprints[b.i]])) {
          hit = [r1(x), r1(y), b.i]
          break
        }
      }
    }
    if (hit) hits.push({ feat: g.feats[e.f]?.id ?? null, name: g.names[e.n] ?? null, at: hit.slice(0, 2), building: hit[2] })
  }
  return hits
}
