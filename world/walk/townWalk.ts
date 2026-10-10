import { SITE } from '../../core/town'
import { site } from '../outdoor/site/siteModel'
import type { TownInfra } from '../outdoor/town/townData'
import { STAIR_SIDE, StairIndex, stairPoint, stairSmoothZ, stairStepZ, stairRiseAt, stairTreadAt, type StairAnchor, type StairProfile } from '../../core/walk/townStairs'
import { setStairIndex } from '../../core/walk/stairGrade'
import { TownNav, type RouteOptions, type RoutePoint, type RouteTarget, type TownRoute, type XY } from '../../core/walk/townNav'
import { EDGE_KIND, type WalkFile } from '../../core/walk/walkData'

/**
 * 町を歩く共通の仕組み（花音にも、将来の見る人の歩き（段 5）にも使う。花音の動き・カメラには依存しない）。docs/design/town.md §18。
 *
 * - 経路: route（町の道のグラフの上のいちばん早い道。townNav.ts）
 * - 足元の高さ: groundY（橋の路面・町の石段・ラボのまわりのセット・均した地形。建物の中は扱わない（interior/model.ts））
 * - 歩ける所: onWalkway（道・石段・橋の幅の中か、広場の中）
 * - 当たりの形: townSolids.ts（建物・構造物・木の幹の箱。カメラの確かめと、見る人の当たり）
 *
 * 座標: 足元の高さ・歩ける所はシーンの座標（x = 東、z = 南、y = 上。ラボの床が 0）。経路は町の平面座標（x = 東、y = 北）。
 * 町のデータ（walk.json・infra.json）を読んだら init が呼ばれる（townData.ts）。それまでは ready = false で、高さは site.groundY のまま
 */

const LAB = SITE.labFloorElevation

/** 町のデータの石段のうち、名前のある建物の外観の型が自分で作るもの（形と高さは型と建物の中の決まり。星図珈琲の星見石段） */
const STAIRS_BUILT_BY_KITS = new Set(['stairs.hoshimi'])

/** 道の橋の路面（infra.bridges。橋の形 town/infraMeshes.ts の addBridges と同じ高さ = 路面 + 5cm） */
interface BridgeSeg {
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  half: number
}

/** 足元の面の種類（歩幅・足の高さの決まりに使う） */
export interface SurfaceInfo {
  /** シーンの y */
  y: number
  kind: 'ground' | 'bridge' | 'stairs'
  /** 石段のとき: 1 段の高さ・踏面（m）と、上る向き（平面の単位ベクトル） */
  stairs?: { rise: number; tread: number; dx: number; dy: number }
}

const BRIDGE_CELL = 20

/**
 * 町のデータの道・石段・橋のほかの歩ける面（交通が足す: 緑電の停留所のホーム・運河バスの乗り場の石段と下の段。docs/design/town.md §20）。
 * 平面座標の長方形（真ん中・沿う向き u の単位ベクトル・沿う向きの長さの半分・横の幅の半分）の上で、沿う向きの位置 a（−halfL〜halfL）から標高を決める
 */
export interface ExtraSurface {
  x: number
  y: number
  ux: number
  uy: number
  halfL: number
  halfW: number
  /** 沿う向きの位置 a の標高（m。step = 段のまま、false は体の高さのなめらかな坂） */
  z(a: number, step: boolean): number
  /** 石段なら、その所の 1 段の高さ・踏面（歩幅に使う）。上る向きは +u なら 1、−u なら −1 */
  stairs?: { rise: number; tread: number; up: 1 | -1; from: number; to: number }
}

const EXTRA_CELL = 16

class TownWalk {
  ready = false
  /** init のたびに増える */
  version = 0
  nav: TownNav | null = null
  stairs: StairIndex | null = null
  private bridgeGrid = new Map<number, BridgeSeg[]>()
  /** ほかの歩ける面（group ごと。交通が足す） */
  private extraGroups = new Map<string, ExtraSurface[]>()
  private extraGrid = new Map<number, ExtraSurface[]>()
  /** 道の幅（feats）。onWalkway が使う */
  private data: WalkFile | null = null

  /**
   * 町のデータを読んだら（townData.ts）。anchors = 町の石段の段を合わせる所（設定の本文の「下から n 段目」の家の前など。core/interiors.ts の townStairAnchors）、
   * keepOut = 石段のわきに縁石・擁壁を付けない所（名前のある建物の外形と敷地。平面座標の輪）
   */
  init(walk: WalkFile | null, infra: TownInfra | null, anchors: readonly StairAnchor[] = [], keepOut: readonly (readonly [number, number][])[] = []) {
    this.data = walk
    this.nav = walk ? new TownNav(walk) : null
    this.stairs = walk ? new StairIndex(walk.stairs, STAIRS_BUILT_BY_KITS, anchors) : null
    if (this.stairs && this.nav && walk) for (const p of this.stairs.profiles) p.sides = stairSides(p, this.nav, walk, keepOut)
    setStairIndex(this.stairs)
    this.bridgeGrid.clear()
    for (const br of infra?.bridges ?? []) {
      for (let i = 1; i < br.pts.length; i++) {
        const a = br.pts[i - 1]
        const b = br.pts[i]
        const seg: BridgeSeg = { ax: a[0], ay: a[1], az: (br.deck ?? a[2]) + 0.05, bx: b[0], by: b[1], bz: (br.deck ?? b[2]) + 0.05, half: br.width / 2 }
        const pad = seg.half + 1
        for (let gx = Math.floor((Math.min(a[0], b[0]) - pad) / BRIDGE_CELL); gx <= Math.floor((Math.max(a[0], b[0]) + pad) / BRIDGE_CELL); gx++)
          for (let gy = Math.floor((Math.min(a[1], b[1]) - pad) / BRIDGE_CELL); gy <= Math.floor((Math.max(a[1], b[1]) + pad) / BRIDGE_CELL); gy++) {
            const k = gx * 100003 + gy
            let l = this.bridgeGrid.get(k)
            if (!l) this.bridgeGrid.set(k, (l = []))
            l.push(seg)
          }
      }
    }
    this.ready = !!walk
    this.version++
  }

  /** ほかの歩ける面を入れる（group ごとに入れ替え。空の列で消す） */
  setExtraSurfaces(group: string, list: ExtraSurface[]) {
    this.extraGroups.set(group, list)
    this.extraGrid.clear()
    for (const l of this.extraGroups.values())
      for (const e of l) {
        const r = Math.hypot(e.halfL, e.halfW) + 1
        for (let gx = Math.floor((e.x - r) / EXTRA_CELL); gx <= Math.floor((e.x + r) / EXTRA_CELL); gx++)
          for (let gy = Math.floor((e.y - r) / EXTRA_CELL); gy <= Math.floor((e.y + r) / EXTRA_CELL); gy++) {
            const k = gx * 100003 + gy
            let c = this.extraGrid.get(k)
            if (!c) this.extraGrid.set(k, (c = []))
            c.push(e)
          }
      }
    this.version++
  }

  /** ほかの歩ける面の上の点（平面座標）。無ければ null */
  extraAt(x: number, y: number) {
    const list = this.extraGrid.get(Math.floor(x / EXTRA_CELL) * 100003 + Math.floor(y / EXTRA_CELL))
    if (!list) return null
    for (const e of list) {
      const dx = x - e.x
      const dy = y - e.y
      const a = dx * e.ux + dy * e.uy
      const b = -dx * e.uy + dy * e.ux
      if (Math.abs(a) <= e.halfL && Math.abs(b) <= e.halfW) return { surface: e, a, b }
    }
    return null
  }

  /** 橋の路面の標高（平面座標。橋の幅の中でなければ null。重なる橋は refZ に近い方） */
  bridgeZ(x: number, y: number, refZ: number): number | null {
    const list = this.bridgeGrid.get(Math.floor(x / BRIDGE_CELL) * 100003 + Math.floor(y / BRIDGE_CELL))
    if (!list) return null
    let best: number | null = null
    for (const s of list) {
      const dx = s.bx - s.ax
      const dy = s.by - s.ay
      const l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (y - s.ay) * dy) / l2)) : 0
      if (Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) > s.half) continue
      const z = s.az + (s.bz - s.az) * t
      if (best === null || Math.abs(z - refZ) < Math.abs(best - refZ)) best = z
    }
    return best
  }

  /**
   * 町の石段のわきの擁壁と植え込みの中か（平面座標 x, y と標高 elev。margin m の余白。§7 の 175）。中なら名前、違えば null。
   * 擁壁の高さは石段の形を作ったとき（town/townStairsMesh.ts）に入る（それまでは null）
   */
  stairSideAt(x: number, y: number, elev: number, margin = 0): string | null {
    const hit = this.stairs?.at(x, y, STAIR_SIDE.planting + margin)
    if (!hit) return null
    const p = hit.profile
    const tops = p.sideTop?.[hit.side >= 0 ? 0 : 1]
    if (!tops || hit.d < p.halfWidth - margin) return null
    const top = tops[Math.floor(hit.s / STAIR_SIDE.step)]
    if (top === undefined || !(top > -Infinity) || elev > top + margin) return null
    return '石段のわきの擁壁'
  }

  /** 石段の上の点（平面座標。幅の中でなければ null） */
  stairsAt(x: number, y: number): { profile: StairProfile; s: number; dx: number; dy: number } | null {
    const hit = this.stairs?.at(x, y, 0)
    return hit ?? null
  }

  /**
   * 足元の面（シーンの x, z と今の高さ refY）。建物の中のゾーン・ラボの中は扱わない（character/avatar/locomotion.ts の groundHeight がその前に見る）。
   * step = true なら石段は段のまま（足の高さ）、false なら体の高さ用のなめらかな坂
   */
  surface(x: number, z: number, refY = 0, step = false): SurfaceInfo {
    const y = -z
    const base = site.groundY(x, z, step)
    if (this.ready) {
      const ex = this.extraGrid.size ? this.extraAt(x, y) : null
      if (ex) {
        const e = ex.surface
        const sy = e.z(ex.a, step) - LAB
        const st = e.stairs
        if (st && ex.a >= Math.min(st.from, st.to) && ex.a <= Math.max(st.from, st.to)) return { y: sy, kind: 'stairs', stairs: { rise: st.rise, tread: st.tread, dx: e.ux * st.up, dy: e.uy * st.up } }
        return { y: sy, kind: 'ground' }
      }
      const st = this.stairs?.at(x, y, 0)
      if (st) {
        const p = st.profile
        const sy = (step ? stairStepZ(p, st.s) : stairSmoothZ(p, st.s)) - LAB
        return { y: sy, kind: 'stairs', stairs: { rise: stairRiseAt(p, st.s), tread: stairTreadAt(p, st.s), dx: st.dx, dy: st.dy } }
      }
      const bz = this.bridgeZ(x, y, refY + LAB)
      if (bz !== null) {
        const by = bz - LAB
        // 橋の下を通る道（地面の方が今の高さに近い）は地面
        if (Math.abs(by - refY) <= Math.abs(base - refY) + 0.6) return { y: by, kind: 'bridge' }
      }
    }
    return { y: base, kind: 'ground' }
  }

  /** 足元の高さ（シーンの y）。surface の y だけ */
  groundY(x: number, z: number, refY = 0, step = false) {
    return this.surface(x, z, refY, step).y
  }

  /**
   * 経路（町の平面座標）。from・to は平面座標の点か、節点・広場など（townNav.ts の RouteTarget）。見つからなければ null
   */
  route(from: XY | number, to: RouteTarget | number, opts?: RouteOptions): TownRoute | null {
    return this.nav?.route(from, to, opts) ?? null
  }

  /** 経路の線（平面座標の点の列） */
  polyline(route: TownRoute): RoutePoint[] {
    return this.nav?.polyline(route) ?? []
  }

  /**
   * 道の上か（シーンの x, z。道・石段・橋の幅の中で、縁から margin m 以上内側。広場の中も）。町のデータが無ければ false
   */
  onWalkway(x: number, z: number, margin = 0) {
    const nav = this.nav
    const data = this.data
    if (!nav || !data) return false
    const y = -z
    const hit = nav.snap(x, y, 30)
    if (hit) {
      const e = data.edges[hit.edge]
      const w = e.f >= 0 ? data.feats[e.f].width : 4
      if (hit.dist <= w / 2 - margin) return true
    }
    for (const p of data.plazas) if (inRing(p.ring, x, y)) return true
    return false
  }

  /** 道の幅（m。辺の元の線の幅。広場・ケーブルは 6） */
  edgeWidth(edge: number) {
    const d = this.data
    if (!d) return 4
    const e = d.edges[edge]
    if (e.k === EDGE_KIND.plaza || e.f < 0) return 6
    return d.feats[e.f].width
  }

  /** 道の種類（trunk / arterial / local / alley / pedestrian / path / tram_row など。広場・ケーブルは null） */
  edgeClass(edge: number) {
    const d = this.data
    if (!d) return null
    const e = d.edges[edge]
    return e.f >= 0 ? d.feats[e.f].cls : null
  }

  /** 辺の名前 */
  edgeName(edge: number) {
    const d = this.data
    if (!d) return null
    return d.names[d.edges[edge].n] ?? null
  }

  /** ケーブルの駅 */
  station(id: string) {
    return this.nav?.station(id) ?? null
  }
}

/**
 * 石段のわきに縁石・擁壁を付ける所（§7 の 172）: 石段の縁の外（縁石・擁壁・植え込みの所）に、ほかの道（石段に入る・横切る道。幅の半分 + 0.5m）や
 * 名前のある建物の外形・敷地（keepOut。0.6m の余白）がかからない所。かかる所の前後 0.5m も空け、1m より短い所は付けない
 */
function stairSides(p: StairProfile, nav: TownNav, walk: WalkFile, keepOut: readonly (readonly [number, number][])[]): [Uint8Array, Uint8Array] {
  const n = Math.max(1, Math.ceil(p.length / STAIR_SIDE.step))
  const own = (e: number) => {
    const f = walk.edges[e].f
    return f >= 0 && walk.feats[f].id === p.def.id
  }
  const rings = keepOut.filter((r) => {
    for (const q of r) if (q[0] > p.box[0] - 3 && q[0] < p.box[2] + 3 && q[1] > p.box[1] - 3 && q[1] < p.box[3] + 3) return true
    return false
  })
  const out: [Uint8Array, Uint8Array] = [new Uint8Array(n), new Uint8Array(n)]
  for (const [k, side] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const ok = out[k]
    for (let i = 0; i < n; i++) {
      const q = stairPoint(p, (i + 0.5) * STAIR_SIDE.step)
      let free = true
      for (const off of [0.1, STAIR_SIDE.wall, 1.0, STAIR_SIDE.planting]) {
        const d = p.halfWidth + off
        const x = q.x - q.dy * d * side
        const y = q.y + q.dx * d * side
        const hit = nav.snap(x, y, 12, (e) => !own(e))
        if (hit) {
          const e = walk.edges[hit.edge]
          const w = e.f >= 0 ? walk.feats[e.f].width : 4
          if (hit.dist <= w / 2 + 0.5) free = false
        }
        for (const r of rings) if (free && (inRing(r as [number, number][], x, y) || ringDistance(r, x, y) < 0.6)) free = false
        if (!free) break
      }
      ok[i] = free ? 1 : 0
    }
    // かかる所の前後 1 つも空け、短い所（2 つ以下）は付けない
    const near = ok.slice()
    for (let i = 0; i < n; i++) if (!near[i]) for (const j of [i - 1, i + 1]) if (j >= 0 && j < n) ok[j] = 0
    for (let i = 0; i < n; ) {
      if (!ok[i]) {
        i++
        continue
      }
      let j = i
      while (j < n && ok[j]) j++
      if (j - i <= 2) ok.fill(0, i, j)
      i = j
    }
  }
  return out
}

function ringDistance(ring: readonly [number, number][], x: number, y: number) {
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]
    const dx = ring[i][0] - ax
    const dy = ring[i][1] - ay
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-9)))
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t))
  }
  return best
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

/** 町を歩く共通の仕組み（1 つだけ） */
export const townWalk = new TownWalk()
