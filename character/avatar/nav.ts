import * as THREE from 'three'
import { townPlaces } from '../../core/places'
import { OUTDOOR_NAV_POINTS } from '../../core/site'
import { LAB_NAV_POINTS, labNavObstacles } from '../../core/lab/navData'
import { insideHall, type Obstacle } from '../../core/lab/plan'
import { site } from '../../world/outdoor/site/siteModel'

/**
 * 花音の通り道。
 * 手で置いた通り道の点と立ち寄り先（core/places.ts の townPlaces()）を「障害物に当たらずに直線で結べる点どうし」でつないだ
 * グラフを作り、A* で最短経路を求め、Catmull-Rom 曲線でなめらかにする。
 * 通り道の点と障害物は、使う側が configureNav で渡す（kanon-lab は kanon/index.ts で config/layout.ts の NAV_POINTS・OBSTACLES。5-1c）。
 * 渡さなければ地図の既定（ラボの通り道のデータ core/lab/navData.ts の LAB_NAV_POINTS と、地図の置き場所の表で並べた labNavObstacles()）。
 * ラボの外（町の段階 3）: 外の点（core/site.ts の OUTDOOR_NAV_POINTS）と、ラボのまわりの小道の中心線の点（site の navPoints）も足す。
 * 外の歩ける所はテラス・石段・スロープ・小道・見晴らし台（site.walkable）。中と外は見学エントランスの扉の所だけでつながる
 */

type P2 = [number, number]

/** 家具からの余白（花音の体の半径 + 少し） */
export const NAV_CLEARANCE = 0.3
/** 壁からの余白 */
const WALL_MARGIN = 0.45
/** これより長い直線ではつながない（部屋を斜めに横切る不自然な経路を避ける） */
const MAX_EDGE = 5.2

/** 点から障害物までの距離（中にいるときは負） */
export function distToObstacle(x: number, z: number, o: Obstacle): number {
  if (o.kind === 'circle') return Math.hypot(x - o.center[0], z - o.center[1]) - o.radius
  const dx = Math.max(o.min[0] - x, 0, x - o.max[0])
  const dz = Math.max(o.min[1] - z, 0, z - o.max[1])
  if (dx === 0 && dz === 0) return -Math.min(x - o.min[0], o.max[0] - x, z - o.min[1], o.max[1] - z)
  return Math.hypot(dx, dz)
}

/** 点が歩ける場所か（壁と家具から clearance 以上離れている）。部屋の外は、外の歩ける所（扉の所・テラス・小道など） */
export function isWalkable(x: number, z: number, clearance = NAV_CLEARANCE): boolean {
  if (!insideHall(x, z, -WALL_MARGIN)) return site.walkable(x, z, clearance)
  for (const o of obstacles()) if (distToObstacle(x, z, o) < clearance) return false
  return true
}

/** 線分が歩ける場所だけを通るか（5cm おきに調べる） */
export function segmentClear(a: P2, b: P2, clearance = NAV_CLEARANCE): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(2, Math.ceil(len / 0.05))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    if (!isWalkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, clearance)) return false
  }
  return true
}

export interface NavGraph {
  nodes: P2[]
  /** 隣接リスト（ノード番号） */
  edges: number[][]
}

let cached: NavGraph | null = null
let cachedVersion = -1

/** 使う側が渡す通り道の点と障害物（configureNav）。省いた物は地図の既定 */
export interface NavConfig {
  /** 手で置いた通り道の点（x, z。並びはグラフの点の順になる） */
  points?: readonly P2[]
  /** 通り道が避ける障害物（ラボの中の家具。並びは今の物のまま渡す） */
  obstacles?: readonly Obstacle[]
}

/** 渡された通り道の点（null なら地図の既定 LAB_NAV_POINTS） */
let navPoints: readonly P2[] | null = null
/** 渡された障害物（null なら地図の既定。初めて使うときに labNavObstacles() で作る） */
let navObstacles: readonly Obstacle[] | null = null

/**
 * 通り道の点と障害物を渡す（docs/design/map-split.md §7 の 5-1c）。省いた物は地図の既定。通り道を使う前（読み込みの時）に呼ぶ。
 * 何度呼んでもよく、最後に渡した物を使う（作ってあったグラフは捨てる）
 */
export function configureNav(c: NavConfig) {
  navPoints = c.points ?? null
  navObstacles = c.obstacles ?? null
  cached = null
}

/** 通り道が避ける障害物（渡した物か、地図の既定） */
function obstacles(): readonly Obstacle[] {
  return (navObstacles ??= labNavObstacles())
}

/** グラフを作る（外の小道の形が変わったとき = 町の地図データを読んだときに作り直す） */
export function navGraph(): NavGraph {
  if (cached && cachedVersion === site.version) return cached
  cachedVersion = site.version
  const nodes: P2[] = [
    ...Object.values(townPlaces()).map((s) => [s.position[0], s.position[2]] as P2),
    ...(navPoints ?? LAB_NAV_POINTS),
    ...OUTDOOR_NAV_POINTS.map((p) => [p[0], p[1]] as P2),
    ...site.navPoints().map((p) => [p[0], p[1]] as P2),
  ]
  const edges: number[][] = nodes.map(() => [])
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1])
      if (d > MAX_EDGE) continue
      if (!segmentClear(nodes[i], nodes[j])) continue
      edges[i].push(j)
      edges[j].push(i)
    }
  }
  cached = { nodes, edges }
  return cached
}

/**
 * start から goal までの経路（点の列）。start・goal はグラフの点でなくてもよい（見通せる点に一時的につなぐ）。
 * 見つからなければ null。
 */
export function findPath(start: P2, goal: P2): P2[] | null {
  const g = navGraph()
  if (segmentClear(start, goal, NAV_CLEARANCE * 0.8) && Math.hypot(goal[0] - start[0], goal[1] - start[1]) <= MAX_EDGE) return [start, goal]
  const nodes = [...g.nodes, start, goal]
  const S = nodes.length - 2
  const G = nodes.length - 1
  const adj: number[][] = [...g.edges.map((e) => [...e]), [], []]
  // 一時的なつなぎ（start・goal から見通せるノード）。start は家具にわずかに近くても出られるよう余白を小さくする
  // （外の小道の点は多いので、遠い点とはつながない）
  const near = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 16
  for (let i = 0; i < g.nodes.length; i++) {
    if (near(start, g.nodes[i]) && segmentClear(start, g.nodes[i], NAV_CLEARANCE * 0.6)) {
      adj[S].push(i)
      adj[i].push(S)
    }
    if (near(goal, g.nodes[i]) && segmentClear(g.nodes[i], goal, NAV_CLEARANCE * 0.6)) {
      adj[i].push(G)
      adj[G].push(i)
    }
  }
  // A*
  const dist = (a: number, b: number) => Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1])
  const gScore = new Map<number, number>([[S, 0]])
  const came = new Map<number, number>()
  const open = new Set<number>([S])
  const f = (n: number) => (gScore.get(n) ?? Infinity) + dist(n, G)
  while (open.size) {
    let cur = -1
    for (const n of open) if (cur < 0 || f(n) < f(cur)) cur = n
    if (cur === G) {
      const path: P2[] = [nodes[G]]
      let c = G
      while (came.has(c)) {
        c = came.get(c)!
        // ほぼ同じ点（立ち寄り先から出発するときのノードなど）は 1 つにまとめる
        if (Math.hypot(nodes[c][0] - path[0][0], nodes[c][1] - path[0][1]) > 0.02) path.unshift(nodes[c])
        else path[0] = nodes[c]
      }
      if (Math.hypot(path[0][0] - start[0], path[0][1] - start[1]) > 0.02) path.unshift(start)
      path[path.length - 1] = goal
      return path.length >= 2 ? path : [start, goal]
    }
    open.delete(cur)
    for (const nb of adj[cur]) {
      const tentative = (gScore.get(cur) ?? Infinity) + dist(cur, nb)
      if (tentative < (gScore.get(nb) ?? Infinity)) {
        came.set(nb, cur)
        gScore.set(nb, tentative)
        open.add(nb)
      }
    }
  }
  return null
}

/**
 * 経路の点列をなめらかな曲線にする。曲がり角の手前と先に点を足してから Catmull-Rom でつなぎ、
 * 角を丸めつつ家具の方へ膨らみすぎないようにする。startDir があれば、今の歩く向きから自然につながるようにする。
 */
export function smoothPath(points: P2[], startDir?: THREE.Vector3): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = []
  const v = (p: P2) => new THREE.Vector3(p[0], 0, p[1])
  pts.push(v(points[0]))
  if (startDir && startDir.lengthSq() > 0.01 && points.length > 1) {
    const first = v(points[0]).addScaledVector(startDir.clone().normalize(), 0.35)
    if (isWalkable(first.x, first.z, NAV_CLEARANCE * 0.5)) pts.push(first)
  }
  for (let i = 1; i < points.length - 1; i++) {
    const p = v(points[i])
    const prev = v(points[i - 1])
    const next = v(points[i + 1])
    const r = 0.45
    const a = p.clone().addScaledVector(prev.clone().sub(p).normalize(), Math.min(r, prev.distanceTo(p) * 0.4))
    const b = p.clone().addScaledVector(next.clone().sub(p).normalize(), Math.min(r, next.distanceTo(p) * 0.4))
    pts.push(a, b)
  }
  pts.push(v(points[points.length - 1]))
  if (pts.length === 2) pts.splice(1, 0, pts[0].clone().lerp(pts[1], 0.5))
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5)
}
