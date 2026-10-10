import * as THREE from 'three'
import { KitBuilder, newell } from '../named/kitBuilder'
import { openingOutline, type Kit, type Opening } from '../named/kit'
import type { Frame } from '../named/frame'
import { NM } from '../named/namedMaterial'
import type { InteriorBuilder, V3 } from './builder'
import { IM } from './interiorMaterial'
import { polyMargin, type DoorM, type RoomM, type StairM } from './model'
import type { DoorDef, Finish, L2 } from './types'

/**
 * 部屋の殻（床・天井・壁・巾木・腰板）と、開口（中の扉の枠と板・外の窓の見込みと額縁と窓台・透けるガラスと桟）と、階段を作る。
 *
 * 壁の作り方: 部屋の多角形の辺ごとに、となりに何があるかを調べる（外 = 外壁の中の面、ほかの部屋 = 仕切り（厚みの半分だけ内へ）、
 * ひと続きの部屋 = 壁なし）。となりのひと続きの部屋の高さの範囲は壁を作らない（吹き抜けの階段の下の段など）。扉と外観の開口の所は穴。
 * 面は 0.35m ごとに区切り、床・天井・部屋の隅に近いほど暗くする（頂点の環境光の遮り）
 */

const CELL = 0.35
const FLOOR_CELL = 0.3

/** 中の扉の板（蝶番の軸の下端が原点。局所: x = 蝶番 → 戸先、y = 上、z = 開く側） */
export interface DoorLeaf {
  door: DoorM
  /** 形（局所の座標） */
  leaf: KitBuilder
  /** 蝶番（シーン）・扉の幅の向き（シーン）・開く側の向き（シーン） */
  hinge: V3
  across: V3
  out: V3
  width: number
}

/** 壁の面の記録（床・天井の環境光の遮り） */
interface WallSeg {
  a: L2
  b: L2
  level: number
  y0: number
  y1: number
}

interface Hole {
  s0: number
  s1: number
  y0: number
  y1: number
  /** アーチの外形（面の s, y）。長方形なら null */
  arch: THREE.Vector2[] | null
}

const lerp2 = (a: L2, b: L2, t: number): L2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** 区間の引き算（[a, b] から cuts を除いた残り） */
function subtract(a: number, b: number, cuts: [number, number][]): [number, number][] {
  let out: [number, number][] = [[a, b]]
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = []
    for (const [x0, x1] of out) {
      if (c1 <= x0 || c0 >= x1) next.push([x0, x1])
      else {
        if (c0 > x0) next.push([x0, c0])
        if (c1 < x1) next.push([c1, x1])
      }
    }
    out = next
  }
  return out.filter(([x0, x1]) => x1 - x0 > 0.004)
}

export class ShellBuilder {
  private ib: InteriorBuilder
  private kit: Kit
  leaves: DoorLeaf[] = []
  private walls: WallSeg[] = []

  constructor(ib: InteriorBuilder, kit: Kit) {
    this.ib = ib
    this.kit = kit
  }

  private get m() {
    return this.ib.m
  }

  build() {
    const m = this.m
    for (const r of m.rooms) if (!r.def.noWalls) this.roomWalls(r)
    for (const r of m.rooms) {
      this.ib.room(r.id)
      if (!r.def.noFloor) this.floor(r)
      if (!r.def.noCeiling) this.ceiling(r)
    }
    for (const d of m.doors) this.door(d)
    this.exteriorOpenings()
    this.panes()
    for (const s of m.stairs) if (s.def.build !== false && s.def.from !== s.def.to) this.stair(s)
  }

  /* ---------------------------------------------------------------------- */
  /* 壁                                                                      */
  /* ---------------------------------------------------------------------- */

  private roomWalls(r: RoomM) {
    const m = this.m
    const ib = this.ib
    ib.room(r.id)
    const wallT = m.brief.wallT
    const loc = r.local
    const n = loc.length
    for (let i = 0; i < n; i++) {
      const p = loc[i]
      const q = loc[(i + 1) % n]
      const L = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (L < 0.02) continue
      const d: L2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L]
      const nIn: L2 = [-d[1], d[0]]
      // 辺を、ほかの部屋の頂点の所で区切る
      const cuts = new Set<number>([0, L])
      const addCut = (v: L2, maxLat: number) => {
        const ax = (v[0] - p[0]) * d[0] + (v[1] - p[1]) * d[1]
        const lat = (v[0] - p[0]) * nIn[0] + (v[1] - p[1]) * nIn[1]
        if (Math.abs(lat) < maxLat && ax > 0.02 && ax < L - 0.02) cuts.add(ax)
      }
      for (const o of m.rooms) if (o !== r) for (const v of o.local) addCut(v, wallT * 0.75)
      // 建物の外形の角（ガレージの付け根など。外壁の中の面の辺が、外と中の境で分かれる）
      for (const v of m.rec.ring) addCut(m.local(v[0], -v[1]), m.brief.inset + 0.12)
      const marks = [...cuts].sort((x, y) => x - y)
      for (let k = 0; k + 1 < marks.length; k++) {
        const a = marks[k]
        const b = marks[k + 1]
        if (b - a < 0.01) continue
        this.wallSeg(r, p, d, nIn, a, b)
      }
    }
  }

  /** 辺の一部（a〜b）の壁 */
  private wallSeg(r: RoomM, p: L2, d: L2, nIn: L2, a: number, b: number) {
    const m = this.m
    const wallT = m.brief.wallT
    const pa = lerp2(p, [p[0] + d[0], p[1] + d[1]], a)
    const pb = lerp2(p, [p[0] + d[0], p[1] + d[1]], b)
    const mid = lerp2(pa, pb, 0.5)
    const exterior = m.isExteriorEdge(pa, pb)
    // となり（外側の点を含む部屋）
    const probe: L2 = [mid[0] - nIn[0] * (wallT / 2 + 0.06), mid[1] - nIn[1] * (wallT / 2 + 0.06)]
    const [px, pz] = m.xz(probe[0], probe[1])
    const neighbors = exterior ? [] : m.rooms.filter((o) => o !== r && polyMargin(o.poly, px, pz) > -0.01)
    // 仕切りは厚みの半分だけ内へ。外壁・となりの部屋の無い壁・ひと続きの部屋だけの所は、データの線のまま
    const allOpen = neighbors.length > 0 && neighbors.every((o) => (r.def.open ?? []).includes(o.id) || (o.def.open ?? []).includes(r.id))
    const off = exterior || !neighbors.length || allOpen ? 0 : wallT / 2
    // 面の高さの範囲（勾配の天井は辺の両端と棟で変わる）
    const y0 = r.floorY
    const topAt = (s: number) => {
      const pt = lerp2(p, [p[0] + d[0], p[1] + d[1]], s)
      const [x, z] = m.xz(pt[0], pt[1])
      return m.ceilAt(r, x, z)
    }
    // ひと続きの部屋の高さの範囲は壁を作らない
    const openCuts: [number, number][] = []
    for (const o of neighbors) {
      const isOpen = (r.def.open ?? []).includes(o.id) || (o.def.open ?? []).includes(r.id)
      if (isOpen) openCuts.push([o.floorY, o.def.sloped ? o.ceilY : o.ceilY])
    }
    // 穴: 扉と、外観の開口（外壁のとき）
    const holes: Hole[] = []
    for (const dm of m.doors) {
      const h = this.doorHole(dm, p, d, nIn, a, b)
      if (h) holes.push(h)
    }
    if (exterior) holes.push(...this.exteriorHoles(p, d, nIn, a, b))
    const sloped = !!r.def.sloped
    const top0 = topAt(a)
    const top1 = topAt(b)
    const flatTop = Math.abs(top0 - top1) < 0.01 && !sloped
    const fin = r.def.wallFinish
    const wain = r.def.wainscot
    // 平面の点 → シーン（s = 辺に沿って、y = 高さ）
    const P = (s: number, y: number): V3 => {
      const pt = lerp2(p, [p[0] + d[0], p[1] + d[1]], s)
      const [x, z] = m.xz(pt[0] + nIn[0] * off, pt[1] + nIn[1] * off)
      return [x, y, z]
    }
    if (flatTop) {
      const top = top0
      // 縦の帯（穴・ひと続きの範囲の切れ目ごと）
      const xs = new Set<number>([a, b])
      for (const h of holes) {
        xs.add(Math.max(a, Math.min(b, h.s0)))
        xs.add(Math.max(a, Math.min(b, h.s1)))
      }
      const xl = [...xs].sort((u, v) => u - v)
      for (let k = 0; k + 1 < xl.length; k++) {
        const s0 = xl[k]
        const s1 = xl[k + 1]
        if (s1 - s0 < 0.004) continue
        const cutsY: [number, number][] = [...openCuts]
        for (const h of holes) if (h.s0 < s1 - 0.002 && h.s1 > s0 + 0.002) cutsY.push([h.y0, h.y1])
        for (const [ya, yb] of subtract(y0, top, cutsY)) {
          if (wain && ya < y0 + wain.h && yb > y0 + wain.h) {
            this.wallRect(P, s0, s1, ya, y0 + wain.h, r, a, b, wain.finish)
            this.wallRect(P, s0, s1, y0 + wain.h, yb, r, a, b, fin)
          } else this.wallRect(P, s0, s1, ya, yb, r, a, b, wain && yb <= y0 + wain.h + 0.001 ? wain.finish : fin)
        }
      }
      // アーチの開口の上の隅（長方形の穴の上の、アーチの外の所）
      for (const h of holes) if (h.arch) this.spandrel(P, h, r, fin)
      // ひと続きの範囲の上と下の小口（梁の下・床の縁）
      for (const [ca, cb] of openCuts) {
        if (cb < top - 0.01 && cb > y0 + 0.01) this.ledge(p, d, nIn, a, b, cb, off, -1, fin)
        if (ca > y0 + 0.01 && ca < top - 0.01) this.ledge(p, d, nIn, a, b, ca, off, 1, fin)
      }
    } else {
      // 勾配の天井の下の壁（屋根裏の妻壁・低い壁）: 上の縁が折れ線の多角形に穴
      const pts: THREE.Vector2[] = [new THREE.Vector2(a, y0), new THREE.Vector2(b, y0), new THREE.Vector2(b, top1)]
      const sl = r.def.sloped!
      // 棟を横切るなら頂点を足す
      const along = sl.axis === 's' ? d[1] : d[0]
      if (Math.abs(along) > 0.5) {
        const start = sl.axis === 's' ? p[1] : p[0]
        const sr = (sl.at - start) / along
        if (sr > a + 0.02 && sr < b - 0.02) pts.push(new THREE.Vector2(sr, topAt(sr)))
      }
      pts.push(new THREE.Vector2(a, top0))
      const inner = holes.filter((h) => h.y0 > y0 + 0.01 && !h.arch).map((h) => [new THREE.Vector2(h.s0, h.y0), new THREE.Vector2(h.s1, h.y0), new THREE.Vector2(h.s1, h.y1), new THREE.Vector2(h.s0, h.y1)])
      if (!this.ib.dry) {
        const nScene = this.ib.dir(nIn[0], nIn[1], 0)
        this.ib.solid.ao = 0.92
        this.ib.solid.groundY = r.group
        // 2D の反時計回り = 中から見て反時計回り になるよう、s を反転した座標で
        const flip = (v: THREE.Vector2) => new THREE.Vector2(-v.x, v.y)
        this.ib.solid.polygonWithHoles(pts.map(flip).reverse(), inner.map((h) => h.map(flip).reverse()), (v) => P(-v.x, v.y), nScene, fin.color, fin.mat, fin.aux ?? 0)
      }
    }
    // 巾木（床に接する所。扉の穴は除く）
    if (r.def.baseboard && !this.ib.dry) {
      const doorCuts: [number, number][] = holes.filter((h) => h.y0 < y0 + 0.05).map((h) => [h.s0, h.s1])
      for (const oc of openCuts) if (oc[0] <= y0 + 0.02) doorCuts.push([a, b])
      for (const [s0, s1] of subtract(a, b, doorCuts)) this.baseboard(p, d, nIn, s0, s1, y0, off, r.def.baseboard)
    }
    // 床・天井の環境光の遮りに使う壁の線
    const wa = lerp2(pa, pa, 0)
    this.walls.push({ a: [wa[0] + nIn[0] * off, wa[1] + nIn[1] * off], b: [pb[0] + nIn[0] * off, pb[1] + nIn[1] * off], level: r.level, y0, y1: Math.max(top0, top1) })
    for (const [ca, cb] of openCuts) if (ca <= y0 + 0.02 && cb >= top0 - 0.02) this.walls.pop()
  }

  /** 壁の長方形の面（s0〜s1・y0〜y1）を区切って足す。環境光の遮り: 床・天井・部屋の隅（辺の端 a・b）に近いほど暗く */
  private wallRect(P: (s: number, y: number) => V3, s0: number, s1: number, y0: number, y1: number, r: RoomM, a: number, b: number, fin: Finish) {
    if (this.ib.dry) return
    const ib = this.ib
    const nx = Math.max(1, Math.ceil((s1 - s0) / CELL))
    const ny = Math.max(1, Math.ceil((y1 - y0) / CELL))
    const floor = r.floorY
    const ceil = r.ceilY
    const ao = (s: number, y: number) => {
      const df = y - floor
      const dc = ceil - y
      const dk = Math.min(s - a, b - s)
      return (1 - 0.32 * Math.exp(-df / 0.22)) * (1 - 0.18 * Math.exp(-dc / 0.18)) * (1 - 0.22 * Math.exp(-dk / 0.25))
    }
    const b0 = ib.solid
    b0.groundY = r.group
    const c = new THREE.Color(fin.color)
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const sa = s0 + ((s1 - s0) * i) / nx
        const sb = s0 + ((s1 - s0) * (i + 1)) / nx
        const ya = y0 + ((y1 - y0) * j) / ny
        const yb = y0 + ((y1 - y0) * (j + 1)) / ny
        // s は部屋の中から見て左へ増えるので、中から見て反時計回りの順は sb → sa
        const pts = [P(sb, ya), P(sa, ya), P(sa, yb), P(sb, yb)]
        const aos = [ao(sb, ya), ao(sa, ya), ao(sa, yb), ao(sb, yb)]
        // 法線は面の向き（4 点から）
        const e1 = new THREE.Vector3(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2])
        const e2 = new THREE.Vector3(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2])
        const nrm = e1.cross(e2)
        // つぶれた升目は足さない（法線が 0 だとシェーダーで NaN になり、ぼかしで画面じゅうが黒くなる）
        if (nrm.lengthSq() < 1e-12) continue
        nrm.normalize()
        const i0 = b0.vertexCount
        for (let k = 0; k < 4; k++) {
          b0.ao = aos[k]
          b0.vertex(pts[k], nrm, c, fin.mat, fin.aux ?? 0)
        }
        b0.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
      }
    b0.ao = 1
  }

  /** アーチの穴の上の隅を埋める（長方形の穴の上の、アーチの外形の外） */
  private spandrel(P: (s: number, y: number) => V3, h: Hole, r: RoomM, fin: Finish) {
    if (this.ib.dry || !h.arch) return
    const spring = h.arch.reduce((mn, v) => Math.min(mn, v.y), Infinity)
    const top = h.y1
    // アーチの上の弧の点（左から右）
    const arc = h.arch.filter((v) => v.y > spring + 0.001 || Math.abs(v.x - h.s0) < 0.001 || Math.abs(v.x - h.s1) < 0.001).sort((u, v) => u.x - v.x)
    const poly: THREE.Vector2[] = [new THREE.Vector2(h.s0, spring), ...arc.filter((v) => v.y > spring + 0.001), new THREE.Vector2(h.s1, spring), new THREE.Vector2(h.s1, top), new THREE.Vector2(h.s0, top)]
    const pts = poly.map((v) => P(v.x, v.y))
    // 面の向きは壁と同じ（部屋の側）。点の順が逆なら反転
    const ib = this.ib
    ib.solid.ao = 0.95
    ib.solid.groundY = r.group
    const tris = THREE.ShapeUtils.triangulateShape(poly, [])
    const c = new THREE.Color(fin.color)
    const ref = new THREE.Vector3()
    {
      const a = P(h.s0, spring)
      const b = P(h.s1, spring)
      const t2 = P(h.s0, top)
      ref.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(t2[0] - a[0], t2[1] - a[1], t2[2] - a[2])).normalize()
    }
    // 部屋の側を向く（s は中から見て左へ増える → ref は外向きになるので反転）
    ref.negate()
    const i0 = ib.solid.vertexCount
    for (const p of pts) ib.solid.vertex(p, ref, c, fin.mat, fin.aux ?? 0)
    for (const t of tris) pushToward(ib.solid.idx, i0, t, pts, ref)
    ib.solid.ao = 1
  }

  /** 壁の小口（ひと続きの範囲の上の梁の下（dir = -1、下向き）・下の床の縁（dir = 1、上向き））。壁の面から仕切りの中心線まで */
  private ledge(p: L2, d: L2, nIn: L2, a: number, b: number, y: number, off: number, dir: 1 | -1, fin: Finish) {
    if (this.ib.dry) return
    const m = this.m
    const pt = (s: number, o: number): V3 => {
      const q = lerp2(p, [p[0] + d[0], p[1] + d[1]], s)
      const [x, z] = m.xz(q[0] + nIn[0] * o, q[1] + nIn[1] * o)
      return [x, y, z]
    }
    const A = pt(a, off)
    const B = pt(b, off)
    const C = pt(b, -0.001)
    const D = pt(a, -0.001)
    const want: V3 = [0, dir, 0]
    const e1 = new THREE.Vector3(B[0] - A[0], 0, B[2] - A[2])
    const e2 = new THREE.Vector3(D[0] - A[0], 0, D[2] - A[2])
    const nrm = e1.cross(e2)
    this.ib.solid.ao = 0.85
    if (nrm.y * want[1] >= 0) this.ib.quadScene(A, B, C, D, fin.color, fin.mat, fin.aux ?? 0, 0.85)
    else this.ib.quadScene(D, C, B, A, fin.color, fin.mat, fin.aux ?? 0, 0.85)
  }

  /** 巾木 */
  private baseboard(p: L2, d: L2, nIn: L2, s0: number, s1: number, y0: number, off: number, color: string) {
    const ib = this.ib
    const cs = lerp2(p, [p[0] + d[0], p[1] + d[1]], (s0 + s1) / 2)
    const c: L2 = [cs[0] + nIn[0] * (off + 0.006), cs[1] + nIn[1] * (off + 0.006)]
    const yaw = Math.atan2(d[1], d[0])
    const h0 = y0 - this.m.y(0)
    ib.box(c, h0 - ib.floorH, [s1 - s0, 0.014, 0.075], color, NM.paint, 0.3, yaw, 0.85)
  }

  /** 扉の穴（この辺の上にあれば） */
  private doorHole(dm: DoorM, p: L2, d: L2, nIn: L2, a: number, b: number): Hole | null {
    const def = dm.def
    const ax = (def.at[0] - p[0]) * d[0] + (def.at[1] - p[1]) * d[1]
    const lat = (def.at[0] - p[0]) * nIn[0] + (def.at[1] - p[1]) * nIn[1]
    const th = dm.thickness
    if (Math.abs(lat) > th / 2 + 0.2) return null
    // 扉の壁の向きと、この辺の向きが同じ
    const along: L2 = def.axis === 's' ? [1, 0] : [0, 1]
    if (Math.abs(along[0] * d[0] + along[1] * d[1]) < 0.9) return null
    const s0 = ax - def.width / 2
    const s1 = ax + def.width / 2
    if (s1 < a + 0.01 || s0 > b - 0.01) return null
    return { s0: Math.max(a, s0), s1: Math.min(b, s1), y0: dm.floorY, y1: dm.topY, arch: null }
  }

  /** 外観の開口のうち、この外壁の辺（a〜b）にかかるもの */
  private exteriorHoles(p: L2, d: L2, nIn: L2, a: number, b: number): Hole[] {
    const m = this.m
    const out: Hole[] = []
    const inset = m.brief.inset
    for (const rec of this.kit.openings) {
      const f = rec.f
      // 面の向きが辺と同じで、面の線から inset の所に辺がある
      const fa = m.local(...scenePlan(f, 0, 0))
      const fb = m.local(...scenePlan(f, 1, 0))
      const fd: L2 = [fb[0] - fa[0], fb[1] - fa[1]]
      if (fd[0] * d[0] + fd[1] * d[1] < 0.9) continue
      const o = rec.o
      const c0 = m.local(...scenePlan(f, o.s, inset))
      const c1 = m.local(...scenePlan(f, o.s + o.w, inset))
      const lat = (c0[0] - p[0]) * nIn[0] + (c0[1] - p[1]) * nIn[1]
      if (Math.abs(lat) > 0.06) continue
      const s0 = (c0[0] - p[0]) * d[0] + (c0[1] - p[1]) * d[1]
      const s1 = (c1[0] - p[0]) * d[0] + (c1[1] - p[1]) * d[1]
      if (s1 < a + 0.01 || s0 > b - 0.01) continue
      const y0 = m.y(o.h)
      const y1 = m.y(o.h + o.ht)
      const shape = o.shape ?? 'rect'
      let arch: THREE.Vector2[] | null = null
      if (shape !== 'rect') arch = openingOutline(o).map((v) => new THREE.Vector2(s0 + (v.x - o.s), m.y(v.y)))
      out.push({ s0: Math.max(a, s0), s1: Math.min(b, s1), y0, y1, arch })
    }
    return out
  }

  /* ---------------------------------------------------------------------- */
  /* 床・天井                                                                */
  /* ---------------------------------------------------------------------- */

  /** 環境光の遮り（床・天井の点）: 壁と家具からの距離 */
  private planeAO(s: number, t: number, level: number, y: number, isFloor: boolean) {
    let dw = Infinity
    for (const w of this.walls) {
      if (w.level !== level || y < w.y0 - 0.05 || y > w.y1 + 0.05) continue
      const dx = w.b[0] - w.a[0]
      const dy = w.b[1] - w.a[1]
      const l2 = dx * dx + dy * dy || 1e-9
      const k = Math.min(1, Math.max(0, ((s - w.a[0]) * dx + (t - w.a[1]) * dy) / l2))
      dw = Math.min(dw, Math.hypot(s - (w.a[0] + dx * k), t - (w.a[1] + dy * k)))
    }
    let ao = 1 - (isFloor ? 0.36 : 0.22) * Math.exp(-dw / (isFloor ? 0.3 : 0.25))
    if (isFloor) {
      const [x, z] = this.m.xz(s, t)
      for (const o of this.m.obstacles) {
        if (o.level !== level || o.y0 > y + 0.12 || o.y1 < y + 0.02) continue
        const dd = o.poly ? -polyMargin(o.poly, x, z) : Math.hypot(x - o.center![0], z - o.center![1]) - o.radius
        ao *= 1 - 0.45 * Math.exp(-Math.max(0, dd) / 0.14)
      }
    }
    return ao
  }

  /** 多角形（局所）を格子で区切って面を足す（y = 高さの関数、up = 上向きの面か） */
  private gridPlane(poly: L2[], heightAt: (s: number, t: number) => number, up: boolean, level: number, fin: Finish, group: number, isFloor: boolean) {
    if (this.ib.dry) return
    const ib = this.ib
    let s0 = Infinity
    let s1 = -Infinity
    let t0 = Infinity
    let t1 = -Infinity
    for (const [s, t] of poly) {
      s0 = Math.min(s0, s)
      s1 = Math.max(s1, s)
      t0 = Math.min(t0, t)
      t1 = Math.max(t1, t)
    }
    const nx = Math.max(1, Math.ceil((s1 - s0) / FLOOR_CELL))
    const ny = Math.max(1, Math.ceil((t1 - t0) / FLOOR_CELL))
    const c = new THREE.Color(fin.color)
    const b0 = ib.solid
    b0.groundY = group
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const cell = clipPoly(poly, s0 + ((s1 - s0) * i) / nx, s0 + ((s1 - s0) * (i + 1)) / nx, t0 + ((t1 - t0) * j) / ny, t0 + ((t1 - t0) * (j + 1)) / ny)
        if (cell.length < 3) continue
        const pts = cell.map(([s, t]) => {
          const [x, z] = this.m.xz(s, t)
          return [x, heightAt(s, t), z] as V3
        })
        if (!up) pts.reverse()
        const cellL = up ? cell : [...cell].reverse()
        // 面積のほとんど無い切れ端は足さない（法線が決まらない）
        let area2 = 0
        for (let k = 0; k < cell.length; k++) {
          const a = cell[k]
          const b = cell[(k + 1) % cell.length]
          area2 += a[0] * b[1] - b[0] * a[1]
        }
        if (Math.abs(area2) < 1e-6) continue
        const nrm = newell(pts).clone()
        if ((nrm.y > 0) !== up) nrm.negate()
        const i0 = b0.vertexCount
        cellL.forEach(([s, t], k) => {
          b0.ao = this.planeAO(s, t, level, pts[k][1], isFloor)
          b0.vertex(pts[k], nrm, c, fin.mat, fin.aux ?? 0)
        })
        for (let k = 1; k + 1 < pts.length; k++) b0.idx.push(i0, i0 + k, i0 + k + 1)
      }
    b0.ao = 1
  }

  private floor(r: RoomM) {
    this.gridPlane(r.local, () => r.floorY, true, r.level, r.def.floorFinish, r.group, true)
  }

  private ceiling(r: RoomM) {
    const m = this.m
    if (!r.def.sloped) {
      this.gridPlane(r.local, () => r.ceilY - 0.0, false, r.level, r.def.ceilingFinish, r.group, false)
      return
    }
    // 勾配の天井: 棟の線で 2 つに分けて、それぞれ傾いた面
    const sl = r.def.sloped
    const hAt = (s: number, t: number) => m.y(sl.ridge - sl.slope * Math.abs((sl.axis === 's' ? t : s) - sl.at))
    const halves = sl.axis === 's' ? [clipHalf(r.local, 't', sl.at, -1), clipHalf(r.local, 't', sl.at, 1)] : [clipHalf(r.local, 's', sl.at, -1), clipHalf(r.local, 's', sl.at, 1)]
    for (const h of halves) if (h.length >= 3) this.gridPlane(h, hAt, false, r.level, r.def.ceilingFinish, r.group, false)
  }

  /* ---------------------------------------------------------------------- */
  /* 扉                                                                      */
  /* ---------------------------------------------------------------------- */

  private door(dm: DoorM) {
    const def = dm.def
    if (def.kind === 'void') return
    const ib = this.ib
    const r = this.m.rooms.find((q) => q.level === def.level && polyMargin(q.poly, dm.center[0] + dm.normal[0] * 0.5, dm.center[1] + dm.normal[1] * 0.5) > -0.2) ?? this.m.rooms.find((q) => q.level === def.level)
    if (r) ib.room(r.id)
    const along: L2 = def.axis === 's' ? [1, 0] : [0, 1]
    const nrm: L2 = [-along[1], along[0]]
    const th = dm.thickness
    const frame = def.frame ?? '#f4f2ec'
    const fl = def.floor ?? this.m.zone.levels[def.level].floor
    const floorH = Array.isArray(fl) ? Math.min(fl[0], fl[1]) : fl
    const w = def.width
    const h = def.height
    const L = (s: number, o: number): L2 => [def.at[0] + along[0] * s + nrm[0] * o, def.at[1] + along[1] * s + nrm[1] * o]
    const yaw = Math.atan2(along[1], along[0])
    const absH = (y: number) => y - ib.floorH
    const exterior = def.kind === 'named'
    // 枠（中の扉は壁の厚みの見込み。外の扉は外観の見込みがあるので、中の面の額縁だけ）
    if (!exterior && def.jambs !== false) {
      ib.box(L(-w / 2 - 0.02, 0), absH(floorH), [0.04, th + 0.02, h + 0.02], frame, NM.paint, 0.4, yaw, 0.9)
      ib.box(L(w / 2 + 0.02, 0), absH(floorH), [0.04, th + 0.02, h + 0.02], frame, NM.paint, 0.4, yaw, 0.9)
      ib.box(L(0, 0), absH(floorH + h), [w + 0.08, th + 0.02, 0.04], frame, NM.paint, 0.4, yaw, 0.9)
    }
    // 額縁（両側の面。外の扉は中の側だけ。開口だけの所は付けない）
    const sides = def.kind === 'open' && def.jambs === false ? [] : exterior ? [this.innerSide(dm)] : [1, -1]
    for (const sd of sides) {
      const o = sd * (th / 2 + 0.008)
      ib.box(L(-w / 2 - 0.055, o), absH(floorH), [0.07, 0.016, h + 0.07], frame, NM.paint, 0.4, yaw, 0.95)
      ib.box(L(w / 2 + 0.055, o), absH(floorH), [0.07, 0.016, h + 0.07], frame, NM.paint, 0.4, yaw, 0.95)
      ib.box(L(0, o), absH(floorH + h), [w + 0.18, 0.016, 0.07], frame, NM.paint, 0.4, yaw, 0.95)
    }
    if (def.kind !== 'swing') return
    // 扉の板（局所: x = 蝶番 → 戸先、y = 上、z = 開く側）
    const hingeSide = def.hinge ?? -1
    const side = def.side ?? 1
    const leafW = w - 0.01
    const leafH = h - 0.015
    const leaf = new KitBuilder()
    // 板の光の組は、開いて入る側の部屋
    const sideRoom = this.m.rooms.find((q) => q.level === def.level && polyMargin(q.poly, dm.center[0] + dm.normal[0] * (def.side ?? 1) * 0.5, dm.center[1] + dm.normal[1] * (def.side ?? 1) * 0.5) > -0.2)
    leaf.groundY = (sideRoom ?? r)?.group ?? 0
    const c = def.color ?? '#f2efe8'
    const style = def.style ?? 'panel'
    const T = 0.04
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: string, mat: number, aux = 0) => leaf.box([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [x1 - x0, y1 - y0, z1 - z0], col, mat, aux)
    box(0.005, leafW, 0, leafH, -T / 2, T / 2, c, style === 'flush' ? IM.plastic : NM.paint, style === 'flush' ? 0.15 : 0.35)
    if (style === 'panel') {
      for (const z of [T / 2, -T / 2 - 0.006]) {
        for (const [y0, y1] of [
          [0.15, leafH * 0.45],
          [leafH * 0.52, leafH - 0.15],
        ]) {
          box(0.12, leafW - 0.11, y0, y1, z, z + 0.006, c, NM.paint, 0.35)
        }
      }
    } else if (style === 'glass') {
      // 上の半分にすりガラス（板の中の明るい面）
      for (const z of [T / 2, -T / 2 - 0.004]) box(0.14, leafW - 0.13, leafH * 0.5, leafH - 0.14, z, z + 0.004, '#dfe6ea', IM.plastic, 0.7)
    }
    // 取っ手（両側）
    for (const z of [T / 2 + 0.03, -T / 2 - 0.03]) {
      box(leafW - 0.09, leafW - 0.065, leafH * 0.47, leafH * 0.53, z - 0.012, z + 0.012, '#c9b98a', NM.gold)
      box(leafW - 0.17, leafW - 0.065, leafH * 0.49, leafH * 0.51, z - 0.01, z + 0.01, '#c9b98a', NM.gold)
    }
    const hs = hingeSide * (w / 2)
    const hingeL = L(hs, side * (th / 2 - 0.02))
    const hinge = this.ib.p(hingeL[0], hingeL[1], floorH + 0.005, true)
    const across = this.ib.dir(-along[0] * hingeSide, -along[1] * hingeSide, 0)
    const out = this.ib.dir(nrm[0] * side, nrm[1] * side, 0)
    this.leaves.push({ door: dm, leaf, hinge, across, out, width: leafW })
  }

  /** 外の扉の、中の側（法線の + / -） */
  private innerSide(dm: DoorM): 1 | -1 {
    const p = [dm.center[0] + dm.normal[0] * 0.6, dm.center[1] + dm.normal[1] * 0.6] as [number, number]
    return this.m.inBuilding(p[0], p[1]) ? 1 : -1
  }

  /* ---------------------------------------------------------------------- */
  /* 外観の開口の中の側（見込み・額縁・窓台）と、透けるガラスと桟                     */
  /* ---------------------------------------------------------------------- */

  private exteriorOpenings() {
    const ib = this.ib
    if (ib.dry) return
    const inset = this.m.brief.inset
    for (const rec of this.kit.openings) {
      const { f, o } = rec
      const depth = o.depth ?? 0.18
      if (depth >= inset - 0.005) continue
      const fill = o.fill ?? 'glass'
      // 開口がどの部屋にあるか（灯りの組）
      const inner = scenePlan(f, o.s + o.w / 2, inset + 0.3)
      const ry = this.m.y(o.h + Math.min(1, o.ht / 2))
      const room = this.m.roomAt(inner[0], ry, -inner[1], 0) ?? this.m.rooms.find((q) => polyMargin(q.poly, inner[0], -inner[1]) > -0.3)
      if (!room) continue
      ib.room(room.id)
      const fin = room.def.wallFinish
      const pts = openingOutline(o)
      const n = pts.length
      const cx = pts.reduce((s, p) => s + p.x, 0) / n
      const cy = pts.reduce((s, p) => s + p.y, 0) / n
      // 見込み（外観の見込みの奥から、中の壁の面まで）
      for (let i = 0; i < n; i++) {
        const p = pts[i]
        const q = pts[(i + 1) % n]
        if (fill !== 'glass' && Math.abs(p.y - o.h) < 0.001 && Math.abs(q.y - o.h) < 0.001) continue
        const a = fp(f, p.x, depth - 0.003, p.y)
        const b = fp(f, q.x, depth - 0.003, q.y)
        const c = fp(f, q.x, inset + 0.002, q.y)
        const d = fp(f, p.x, inset + 0.002, p.y)
        const mx = (p.x + q.x) / 2
        const my = (p.y + q.y) / 2
        const want = f.dir(cx - mx, 0, cy - my)
        const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
        const e2 = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2])
        const nn = e1.cross(e2)
        const ok = nn.x * want[0] + nn.y * want[1] + nn.z * want[2] >= 0
        if (ok) ib.quadScene(a, b, c, d, fin.color, fin.mat, fin.aux ?? 0, 0.8)
        else ib.quadScene(d, c, b, a, fin.color, fin.mat, fin.aux ?? 0, 0.8)
      }
      if ((o.shape ?? 'rect') !== 'rect') continue
      const trim = room.def.baseboard ?? '#f4f2ec'
      const tIn = inset - 0.004
      const yaw = Math.atan2(f.ay, f.ax)
      const B = (s0: number, s1: number, t0: number, t1: number, h0: number, h1: number, col: string, mat: number, aux = 0) => {
        const c = fp(f, (s0 + s1) / 2, (t0 + t1) / 2, (h0 + h1) / 2)
        ib.solid.ao = 0.95
        ib.solid.groundY = room.group
        ib.solid.box(c, [s1 - s0, h1 - h0, t1 - t0], col, mat, aux, yaw)
      }
      // 額縁（左・右・上）
      B(o.s - 0.07, o.s, tIn, tIn + 0.016, o.h - (fill === 'glass' ? 0.06 : 0), o.h + o.ht + 0.07, trim, NM.paint, 0.4)
      B(o.s + o.w, o.s + o.w + 0.07, tIn, tIn + 0.016, o.h - (fill === 'glass' ? 0.06 : 0), o.h + o.ht + 0.07, trim, NM.paint, 0.4)
      B(o.s - 0.07, o.s + o.w + 0.07, tIn, tIn + 0.016, o.h + o.ht, o.h + o.ht + 0.07, trim, NM.paint, 0.4)
      if (fill === 'glass') {
        // 窓台（中へ少し出る板）と、その下の小さな幕板
        B(o.s - 0.09, o.s + o.w + 0.09, depth - 0.01, inset + 0.05, o.h - 0.03, o.h, trim, NM.wood, 0)
        B(o.s - 0.05, o.s + o.w + 0.05, tIn, tIn + 0.014, o.h - 0.12, o.h - 0.03, trim, NM.paint, 0.4)
      }
    }
  }

  /** 透けるガラス（外観の不透明なガラスの代わり）と、桟と枠（外観のシェーダーで描いていた格子を形で） */
  private panes() {
    const ib = this.ib
    if (ib.dry) return
    for (const pr of this.kit.panes) {
      const { f, o, pts, t, g } = pr
      const tg = t + 0.004
      // ガラス（外から見て反時計回り = 外向きの面）
      const poly = pts.map((p) => fp(f, p.x, tg, p.y))
      const loc = pts.map((p) => new THREE.Vector2(p.x, p.y))
      const tris = THREE.ShapeUtils.triangulateShape(loc, [])
      const i0 = ib.clear.vertexCount
      const nOut = new THREE.Vector3(...f.out)
      const white = new THREE.Color('#ffffff')
      for (const p of poly) ib.clear.vertex(p, nOut, white, 0, 0)
      for (const tr of tris) {
        const A = loc[tr[0]]
        const Bv = loc[tr[1]]
        const C = loc[tr[2]]
        const cr = (Bv.x - A.x) * (C.y - A.y) - (Bv.y - A.y) * (C.x - A.x)
        if (cr >= 0) ib.clear.idx.push(i0 + tr[0], i0 + tr[1], i0 + tr[2])
        else ib.clear.idx.push(i0 + tr[0], i0 + tr[2], i0 + tr[1])
      }
      // 桟と枠
      const frame = g.frame ?? '#3a3d40'
      const bar = Math.max(0.025, g.bar ?? 0.035)
      const yaw = Math.atan2(f.ay, f.ax)
      const s0 = Math.min(...pts.map((p) => p.x))
      const s1 = Math.max(...pts.map((p) => p.x))
      const h0 = Math.min(...pts.map((p) => p.y))
      const h1 = Math.max(...pts.map((p) => p.y))
      const rect = (o.shape ?? 'rect') === 'rect' || pts.length <= 5
      const B = (sa: number, sb: number, ha: number, hb: number, th = 0.04) => {
        const c = fp(f, (sa + sb) / 2, tg, (ha + hb) / 2)
        ib.solid.ao = 0.9
        ib.solid.box(c, [Math.max(0.001, sb - sa), Math.max(0.001, hb - ha), th], frame, NM.paint, 0.5, yaw)
      }
      const fw = bar * 1.3
      const archTop = rect ? h1 : h0 + (o.shape === 'arch' ? Math.max(0.01, o.ht - o.w / 2) : o.shape === 'segment' ? o.ht - o.w / 6 : o.ht * 0.6)
      // 枠（長方形の部分の左右と下、長方形なら上も）
      B(s0, s0 + fw, h0, archTop, 0.05)
      B(s1 - fw, s1, h0, archTop, 0.05)
      B(s0, s1, h0, h0 + fw, 0.05)
      B(s0, s1, archTop - (rect ? fw : fw * 0.5), archTop + (rect ? 0 : fw * 0.5), 0.05)
      const cols = Math.max(1, Math.round(g.cols ?? 2))
      const rows = Math.max(1, Math.round(g.rows ?? 1))
      if ((g.bar ?? 0.035) > 0) {
        for (let i = 1; i < cols; i++) {
          const s = s0 + ((s1 - s0) * i) / cols
          B(s - bar / 2, s + bar / 2, h0, archTop, 0.035)
        }
        for (let j = 1; j < rows; j++) {
          const h = h0 + ((archTop - h0) * j) / rows
          B(s0, s1, h - bar / 2, h + bar / 2, 0.035)
        }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 階段                                                                    */
  /* ---------------------------------------------------------------------- */

  private stair(st: StairM) {
    const ib = this.ib
    if (ib.dry) return
    const s = st.def
    const l = Math.hypot(s.dir[0], s.dir[1]) || 1
    const dir: L2 = [s.dir[0] / l, s.dir[1] / l]
    const side: L2 = [-dir[1], dir[0]]
    const N = s.risers
    const rise = (s.y1 - s.y0) / N
    const run = s.run
    const len = run * (N - 1)
    const w = s.width
    const yaw = Math.atan2(dir[1], dir[0])
    const fin = s.finish ?? { color: '#a8784a', mat: NM.wood }
    const room = this.m.rooms.find((r) => r.level === s.from && polyMargin(r.poly, ...this.m.xz(s.start[0] + dir[0] * len * 0.5, s.start[1] + dir[1] * len * 0.5)) > -0.3)
    if (room) ib.room(room.id)
    const base = ib.floorH
    const at = (a: number, o: number): L2 => [s.start[0] + dir[0] * a + side[0] * o, s.start[1] + dir[1] * a + side[1] * o]
    const white = '#f2efe8'
    // 段（踏み板と蹴込み）
    for (let i = 0; i < N; i++) {
      const y = s.y0 + rise * i
      const a = i * run
      // 蹴込み（白）
      ib.box(at(a + 0.012, 0), y - base, [0.024, w, rise], white, NM.paint, 0.3, yaw, 0.85)
      if (i < N - 1) {
        // 踏み板（少し前へ出す）
        ib.box(at(a + run / 2 - 0.012, 0), y + rise - 0.035 - base, [run + 0.03, w, 0.035], fin.color, fin.mat, 0, yaw, 0.95)
      }
    }
    // 側桁（両側）と、段の下の斜めの天井（白）
    const slope = Math.atan2(s.y1 - s.y0, len + run)
    for (const sd of [-1, 1]) {
      const o = sd * (w / 2 + 0.02)
      const a0 = at(-0.05, o)
      const a1 = at(len + 0.05, o)
      ib.beam([a0[0], a0[1], s.y0 - base + 0.08], [a1[0], a1[1], s.y1 - base + 0.08], 0.04, white, NM.paint, 0.35, 0.26)
    }
    // 段の下（斜めの面）
    const thick = 0.22
    const u0 = at(0, -w / 2 - 0.04)
    const u1 = at(0, w / 2 + 0.04)
    const u2 = at(len + run * 0.5, w / 2 + 0.04)
    const u3 = at(len + run * 0.5, -w / 2 - 0.04)
    const yb0 = s.y0 - base - 0.02
    const yb1 = s.y1 - base - thick
    // 下向きの面
    {
      const a = ib.p(u0[0], u0[1], yb0)
      const b = ib.p(u1[0], u1[1], yb0)
      const c = ib.p(u2[0], u2[1], yb1)
      const d = ib.p(u3[0], u3[1], yb1)
      quadToward(ib, a, b, c, d, [0, -1, 0], white, IM.paintWall, 0, 0.8)
    }
    void slope
    // 手すり（rail の側）: 斜めの手すりと、細い手すり子（開いた側）・壁の側は持ち送りの金物
    const rails = s.rail === 2 ? [-1, 1] : s.rail === -1 ? [1] : s.rail === 1 ? [-1] : []
    for (const sd of rails) {
      const o = sd * (w / 2 - 0.03)
      const r0 = at(-0.1, o)
      const r1 = at(len + 0.1, o)
      const wallSide = s.wall === 2 || (s.wall !== undefined && s.wall === (sd > 0 ? -1 : 1))
      const hh = 0.86
      ib.beam([r0[0], r0[1], s.y0 - base + hh], [r1[0], r1[1], s.y1 - base + hh], 0.045, '#8a5a34', NM.wood, 0, 0.055)
      if (wallSide) {
        for (let k = 0; k <= 3; k++) {
          const a = (k / 3) * len
          const pp = at(a, o + sd * 0.05)
          const y = s.y0 + (s.y1 - s.y0) * (a / (len + run)) - base + hh - 0.06
          ib.box(pp, y, [0.02, 0.06, 0.06], '#c9b98a', NM.gold, 0, yaw)
        }
        continue
      }
      // 親柱（下と上）と手すり子
      for (const a of [-0.1, len + 0.1]) {
        const pp = at(a, o)
        const y = a < 0 ? s.y0 : s.y1
        ib.box(pp, y - base, [0.09, 0.09, hh + 0.1], '#8a5a34', NM.wood, 0, yaw)
      }
      for (let i = 0; i < N - 1; i++) {
        for (const k of [0.25, 0.75]) {
          const a = i * run + run * k
          const pp = at(a, o)
          const y = s.y0 + rise * (i + 1) - base
          const top = s.y0 + (s.y1 - s.y0) * ((a + run * 0.5) / (len + run)) - base + hh
          ib.box(pp, y, [0.022, 0.022, Math.max(0.1, top - y)], white, NM.paint, 0.4, yaw)
        }
      }
    }
  }
}

/** 三角形を、法線が want の側を向く順で足す */
function pushToward(idx: number[], i0: number, t: number[], pts: V3[], want: THREE.Vector3) {
  const a = pts[t[0]]
  const b = pts[t[1]]
  const c = pts[t[2]]
  const n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]))
  if (n.dot(want) >= 0) idx.push(i0 + t[0], i0 + t[1], i0 + t[2])
  else idx.push(i0 + t[0], i0 + t[2], i0 + t[1])
}

/** 4 点の面を、表が want の側を向く順で足す */
function quadToward(ib: InteriorBuilder, a: V3, b: V3, c: V3, d: V3, want: V3, color: string, mat: number, aux = 0, ao = 1) {
  const n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]))
  if (n.x * want[0] + n.y * want[1] + n.z * want[2] >= 0) ib.quadScene(a, b, c, d, color, mat, aux, ao)
  else ib.quadScene(d, c, b, a, color, mat, aux, ao)
}

/** 面の (s, t, h) → シーンの点 */
function fp(f: Frame, s: number, t: number, h: number): V3 {
  return f.p(s, t, h)
}

/** 面の (s, t) → 町の平面座標 [x, y] */
function scenePlan(f: Frame, s: number, t: number): [number, number] {
  const [x, y] = f.plan(s, t)
  return [x, -y]
}

/** 多角形を長方形の升目で切り取る（Sutherland–Hodgman） */
function clipPoly(poly: L2[], s0: number, s1: number, t0: number, t1: number): L2[] {
  let out = poly
  const clip = (inside: (p: L2) => boolean, cross: (a: L2, b: L2) => L2) => {
    const res: L2[] = []
    for (let i = 0; i < out.length; i++) {
      const a = out[i]
      const b = out[(i + 1) % out.length]
      const ia = inside(a)
      const ib = inside(b)
      if (ia) res.push(a)
      if (ia !== ib) res.push(cross(a, b))
    }
    out = res
  }
  const xs = (x: number) => (a: L2, b: L2): L2 => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1e-9)]
  const ys = (y: number) => (a: L2, b: L2): L2 => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-9), y]
  clip((p) => p[0] >= s0, xs(s0))
  if (out.length) clip((p) => p[0] <= s1, xs(s1))
  if (out.length) clip((p) => p[1] >= t0, ys(t0))
  if (out.length) clip((p) => p[1] <= t1, ys(t1))
  return out
}

/** 多角形を直線（axis の座標 = at）で切った片側（sign = -1 で小さい側） */
function clipHalf(poly: L2[], axis: 's' | 't', at: number, sign: -1 | 1): L2[] {
  const big = 1e4
  return axis === 's' ? (sign < 0 ? clipPoly(poly, -big, at, -big, big) : clipPoly(poly, at, big, -big, big)) : sign < 0 ? clipPoly(poly, -big, big, -big, at) : clipPoly(poly, -big, big, at, big)
}

export type { DoorDef, Opening }
