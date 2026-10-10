import * as THREE from 'three'
import { SITE } from '../../core/town'
import { townData, type TownTile } from '../outdoor/town/townData'
import { townWalk } from './townWalk'
import { LANE_CORRIDOR_HALF_W, laneCorridor, type CorridorHit } from './laneCorridor'

const _hit: CorridorHit = { nx: 0, ny: 0, dist: 0, z0: 0, z1: 0 }

/**
 * 町の当たりの形（townSolids）: 町の建物（タイルの長方形の建物と形のある建物。名前のある建物も外形と高さ）を、
 * 平面の 8m の升に分けた箱と多角形の柱にしたもの。木は幹（半径 0.35m）と樹冠（樹冠の半径の 8 割の円柱。カメラの位置の確かめ（margin > 0）では
 * 樹冠の半径の 1.05 倍 + margin）。誰が使ってもよい（花音には依存しない）。
 * 木は町じゅう（ラボのまわりも）。描くときに置き直す・除く木（ラボの前のセットの上・中のある建物の敷地）は、描く側と同じ決まり（setTreeAdjust）で
 * 置き直す・除く（§7 の 175。前はラボから 320m の内の木を入れていなかった）。町の石段のわきの擁壁と植え込み（world/walk/townWalk.ts の stairSideAt）も当たりに入れる。
 * 自動カメラ・撮影の構図の確かめ（camera/spots.ts の outdoorSpotOk・outdoorSight・outdoorBlocker）が、カメラが建物の中に入らないか・
 * 花音が建物に隠れないかを見る。将来の見る人の歩き（段 5）の当たりにも使う。
 *
 * タイル（1km）ごとに、初めて聞かれたときに作る（町じゅうを一度に作らない）。座標はシーンの座標（x = 東、z = 南、y = 上）
 */

const LAB = SITE.labFloorElevation
const CELL = 8

interface Solid {
  /** 平面の外形（町の平面座標の点の列） */
  ring: [number, number][]
  /** 外接の箱（平面） */
  x0: number
  y0: number
  x1: number
  y1: number
  /** 下と上（シーンの y） */
  bottom: number
  top: number
  name: string | null
  /** 円の柱（木）。ring は空。pad = カメラの位置の確かめ（margin > 0）で足す半径（樹冠の葉の外側） */
  circle?: { x: number; y: number; r: number; pad: number }
}

/** 木の置き直し（平面座標 x, y と元の標高 z → 描く根元の標高。null なら描かない） */
export type TreeAdjust = (x: number, y: number, z: number) => number | null

interface TileSolids {
  solids: Solid[]
  grid: Map<number, number[]>
}

function inRing(ring: [number, number][], x: number, y: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function ringDist(ring: [number, number][], x: number, y: number) {
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]
    const dx = ring[i][0] - ax
    const dy = ring[i][1] - ay
    const k = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-9)))
    best = Math.min(best, Math.hypot(x - ax - dx * k, y - ay - dy * k))
  }
  return best
}

class TownSolids {
  private tiles = new Map<string, TileSolids>()
  private size = 1000
  /** 読んだタイルの索引（townData.tiles の数が変わったら作り直す） */
  private byKey = new Map<string, TownTile>()
  private indexed = -1
  /** 作った建物の数（?debug） */
  count = 0
  private adjust: TreeAdjust | null = null

  /** 木を描く側の置き直しの決まり（outdoor/landscape.ts の treeOnSite）。変えたら作り直す */
  setTreeAdjust(fn: TreeAdjust | null) {
    this.adjust = fn
    this.reset()
  }

  private tileOf(x: number, y: number): TileSolids | null {
    const m = townData.manifest
    if (!m) return null
    this.size = m.tiles.size
    const key = `${Math.floor(x / this.size)}_${Math.floor(y / this.size)}`
    let t = this.tiles.get(key)
    if (t) return t
    if (this.indexed !== townData.tiles.length) {
      this.byKey.clear()
      for (const q of townData.tiles) this.byKey.set(q.meta.key, q)
      this.indexed = townData.tiles.length
    }
    const tile = this.byKey.get(key) ?? townData.extraTile(key)
    // まだ読んでいないタイル（配信で北の丘の向こう）は、読み終えたら作る
    if (!tile && !townData.allTilesLoaded()) return null
    t = this.build(tile ?? null, Math.floor(x / this.size) * this.size, Math.floor(y / this.size) * this.size)
    this.tiles.set(key, t)
    return t
  }

  private build(tile: TownTile | null, tx: number, ty: number): TileSolids {
    const solids: Solid[] = []
    const grid = new Map<number, number[]>()
    // 港の桟橋（町の地図データの岸壁の、閉じた小さな多角形。面積 3000m² まで）: 中は水面から天端までの塊（岸壁の面だけ描いていて、中に入ると黒い）。
    // カメラが桟橋の中に入らない・桟橋越しに見通さない（§7 の 221）
    for (const w of townData.infra?.walls ?? []) {
      const pts = w.pts
      if (w.kind !== 'quay' || pts.length < 4 || pts.length > 12) continue
      const [fx, fy] = pts[0]
      const [lx, ly] = pts[pts.length - 1]
      if (Math.hypot(fx - lx, fy - ly) > 0.5) continue
      let area = 0
      for (let i = 1; i < pts.length; i++) area += pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1]
      if (Math.abs(area) / 2 > 3000) continue
      const ring = pts.slice(0, -1).map((p) => [p[0], p[1]] as [number, number])
      const b = this.solid(ring, (w.bottom ?? -2.5) - LAB, (w.top ?? 2) - LAB, '桟橋')
      if (b.x1 < tx || b.x0 > tx + this.size || b.y1 < ty || b.y0 > ty + this.size) continue
      solids.push(b)
    }
    if (tile) {
      const s = tile.sections
      const pos = s.b_pos.array
      const dim = s.b_dim.array
      const n = pos.length / 4
      for (let i = 0; i < n; i++) {
        const cx = pos[i * 4]
        const cy = pos[i * 4 + 1]
        const fz = pos[i * 4 + 2]
        const yaw = pos[i * 4 + 3]
        const w = dim[i * 4]
        const d = dim[i * 4 + 1]
        const ridge = dim[i * 4 + 3]
        const ux = [Math.cos(yaw), Math.sin(yaw)]
        const uy = [-Math.sin(yaw), Math.cos(yaw)]
        const ring = ([
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ] as const).map(([a, b]) => [cx + ux[0] * a * w + uy[0] * b * d, cy + ux[1] * a * w + uy[1] * b * d] as [number, number])
        solids.push(this.solid(ring, fz - 1.5 - LAB, fz + ridge - LAB, null))
      }
      for (const p of tile.meta.polys) solids.push(this.solid(p.ring as [number, number][], p.floorZ - 1.5 - LAB, p.floorZ + p.ridge - LAB, p.name))
      const tp = s.t_pos?.array
      const ta = s.t_attr?.array
      if (tp && ta)
        for (let i = 0; i < tp.length / 4; i++) {
          const x = tp[i * 4]
          const y = tp[i * 4 + 1]
          const z0 = this.adjust ? this.adjust(x, y, tp[i * 4 + 2]) : tp[i * 4 + 2]
          if (z0 === null) continue
          const z = z0 - LAB
          const h = tp[i * 4 + 3]
          const r = ta[i * 4] / 10
          solids.push(this.circleSolid(x, y, 0.35, z - 0.5, z + h * 0.5, '木の幹', 0))
          if (r > 0.6) this.leafSolids(solids, x, y, z, h, r)
        }
    }
    solids.forEach((b, i) => {
      for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++)
        for (let gy = Math.floor(b.y0 / CELL); gy <= Math.floor(b.y1 / CELL); gy++) {
          const k = gx * 100003 + gy
          let l = grid.get(k)
          if (!l) grid.set(k, (l = []))
          l.push(i)
        }
    })
    this.count += solids.length
    return { solids, grid }
  }

  /**
   * 木の葉（樹冠の円の柱）。浮遊レーンの通り道にかかる木は、通り道の箱の中を除く（枝を払ってある。world/walk/laneCorridor.ts・town/trees.ts と同じ箱）:
   * 通り道の上と下は円の柱のまま、通り道の高さの所は、円を通り道の両側の壁で切った形
   */
  private leafSolids(solids: Solid[], x: number, y: number, z: number, h: number, r: number) {
    const R = r * 0.8
    const lb = z + h * 0.32
    const lt = z + h
    const W = LANE_CORRIDOR_HALF_W
    const lane = laneCorridor.near(x, y, R + W + 0.5, _hit)
    const c0 = lane ? lane.z0 - LAB : 0
    const c1 = lane ? lane.z1 - LAB : 0
    if (!lane || c0 >= lt || c1 <= lb || lane.dist - R >= W) {
      solids.push(this.circleSolid(x, y, R, lb, lt, '木の葉', r * 0.25))
      return
    }
    if (lt > c1) solids.push(this.circleSolid(x, y, R, Math.max(lb, c1), lt, '木の葉', r * 0.25))
    if (lb < c0) solids.push(this.circleSolid(x, y, R, lb, Math.min(lt, c0), '木の葉', r * 0.25))
    const mb = Math.max(lb, c0)
    const mt = Math.min(lt, c1)
    // 円（24 角）を、通り道の片側（side × (線からの距離) ≥ W）だけ残して切る
    for (const side of [1, -1]) {
      const f = (px: number, py: number) => side * ((px - x) * lane.nx + (py - y) * lane.ny + lane.dist) - W
      const ring: [number, number][] = []
      const N = 24
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2
        const a1 = ((k + 1) / N) * Math.PI * 2
        const p0: [number, number] = [x + Math.cos(a0) * R, y + Math.sin(a0) * R]
        const p1: [number, number] = [x + Math.cos(a1) * R, y + Math.sin(a1) * R]
        const f0 = f(p0[0], p0[1])
        const f1 = f(p1[0], p1[1])
        if (f0 >= 0) ring.push(p0)
        if ((f0 >= 0) !== (f1 >= 0)) {
          const t = f0 / (f0 - f1)
          ring.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t])
        }
      }
      if (ring.length >= 3) solids.push(this.solid(ring, mb, mt, '木の葉'))
    }
  }

  private circleSolid(x: number, y: number, r: number, bottom: number, top: number, name: string, pad: number): Solid {
    const R = r + pad
    return { ring: [], x0: x - R, y0: y - R, x1: x + R, y1: y + R, bottom, top, name, circle: { x, y, r, pad } }
  }

  private solid(ring: [number, number][], bottom: number, top: number, name: string | null): Solid {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    return { ring, x0, y0, x1, y1, bottom, top, name }
  }

  /**
   * シーンの点 (x, y, z) が建物・木の中（外形から margin m 以内）なら、その名前（名前が無ければ '建物'）。違えば null。
   * treesOnly = true なら木だけ（中のある建物のゾーンで、建物は中の決まり interior/model.ts が見るとき）
   */
  blocker(x: number, y: number, z: number, margin = 0, treesOnly = false): string | null {
    const px = x
    const py = -z
    // 町の石段のわきの擁壁と植え込み（中のある建物のゾーンの中でも見る）
    const wall = townWalk.stairSideAt(px, py, y + LAB, margin)
    if (wall) return wall
    const t = this.tileOf(px, py)
    if (!t) return null
    const list = t.grid.get(Math.floor(px / CELL) * 100003 + Math.floor(py / CELL))
    if (!list) return null
    for (const i of list) {
      const b = t.solids[i]
      if (treesOnly && !b.circle) continue
      if (y < b.bottom - (b.circle && margin > 0 ? b.circle.pad : 0) || y > b.top + margin) continue
      if (px < b.x0 - margin || px > b.x1 + margin || py < b.y0 - margin || py > b.y1 + margin) continue
      if (b.circle) {
        if (Math.hypot(px - b.circle.x, py - b.circle.y) < b.circle.r + margin + (margin > 0 ? b.circle.pad : 0)) return b.name ?? '木'
        continue
      }
      if (inRing(b.ring, px, py) || (margin > 0 && ringDist(b.ring, px, py) < margin)) return b.name ?? '建物'
    }
    return null
  }

  /** 線分 from → to が建物・木にさえぎられないか（0.5m ごと。to のまわり skipNear m は見ない。treesOnly は blocker と同じ） */
  sight(from: THREE.Vector3, to: THREE.Vector3, skipNear = 0.5, treesOnly = false) {
    return this.sightBlocker(from, to, skipNear, treesOnly) === null
  }

  /** 線分 from → to をさえぎる建物・木の名前（さえぎらなければ null） */
  sightBlocker(from: THREE.Vector3, to: THREE.Vector3, skipNear = 0.5, treesOnly = false): string | null {
    const len = from.distanceTo(to)
    const n = Math.max(2, Math.ceil(len / 0.5))
    for (let i = 1; i < n; i++) {
      const k = i / n
      if ((1 - k) * len < skipNear) break
      const x = from.x + (to.x - from.x) * k
      const y = from.y + (to.y - from.y) * k
      const z = from.z + (to.z - from.z) * k
      const b = this.blocker(x, y, z, 0, treesOnly)
      if (b) return b
    }
    return null
  }

  /** シーンの x, z の建物の屋根のいちばん高い所（シーンの y。建物が無ければ null） */
  roofAt(x: number, z: number): number | null {
    const px = x
    const py = -z
    const t = this.tileOf(px, py)
    if (!t) return null
    const list = t.grid.get(Math.floor(px / CELL) * 100003 + Math.floor(py / CELL))
    if (!list) return null
    let best: number | null = null
    for (const i of list) {
      const b = t.solids[i]
      if (b.circle || px < b.x0 || px > b.x1 || py < b.y0 || py > b.y1 || !inRing(b.ring, px, py)) continue
      best = best === null ? b.top : Math.max(best, b.top)
    }
    return best
  }

  /** タイルを読み直したら（町のデータを読み直したとき） */
  reset() {
    this.tiles.clear()
    this.count = 0
  }
}

/** 町の当たりの形（1 つだけ） */
export const townSolids = new TownSolids()
