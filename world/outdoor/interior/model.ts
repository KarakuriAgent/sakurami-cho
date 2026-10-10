import * as THREE from 'three'
import { INTERIOR_ZONES, localOf, planOf, type InteriorZoneId, type LocalFrame, type ZoneDef } from '../../../core/interiors'
import { SITE } from '../../../core/town'
import type { NamedRecord } from '../named/namedData'
import type { OpeningRecord } from '../named/kit'
import type { DoorDef, InteriorBrief, L2, RoomDef, StairDef } from './types'

/**
 * 中のある建物の「形の決まり」（部屋・歩ける所・地面の高さ・障害物・通り道のグラフ・カメラの確かめ）。シーンの座標（x, z と y）で持つ。
 * 町のデータ（named.json の部屋と、外観の開口の記録）を読んだら、ゾーンごとに 1 つ作る（形を作る前から、花音の通り道と高さに使う）。
 *
 * - 歩ける所は「面」（patch）の集まり: 部屋（床の多角形を壁の厚みの半分だけ縮めたもの）・扉の通り抜け（扉の幅 × 壁の両側へ 0.7m）・
 *   外の歩ける所（ポーチ・家の前・踊り場）・段（外の石段は同じ階の中の坂、階をまたぐ階段は通り道の決まった線だけ）
 * - 地面の高さ: 点を含む面の高さのうち、今の高さ（refY）にいちばん近いもの。段の中では段を優先する（上り下りを続けるため）
 * - 通り道: 階ごとに「見通しのきく点どうし」を結び、階段は下と上の点を決まった線で結ぶ（character/avatar/nav.ts の考えと同じ）
 */

export type XZ = [number, number]

const LAB = SITE.labFloorElevation

export interface RoomM {
  def: RoomDef
  id: string
  level: number
  /** 平面（シーンの x, z。反時計回り） */
  poly: XZ[]
  /** 局所の多角形 */
  local: L2[]
  /** 床・天井の高さ（シーンの y。勾配の天井は棟の高さ） */
  floorY: number
  ceilY: number
  /** 灯りと窓の光の組の番号 */
  group: number
  walk: boolean
}

export interface PatchM {
  kind: 'room' | 'door' | 'stair' | 'outdoor'
  id: string
  level: number
  poly: XZ[]
  /** 平らな高さ（シーンの y）。null なら地形か段 */
  y: number | null
  terrain: boolean
  ramp: { ox: number; oz: number; dx: number; dz: number; len: number; y0: number; y1: number; risers: number } | null
  /** 弧の段・スロープ（局所の中心と角度 a0 → a1。高さは角度の割合） */
  arc?: { c: L2; a0: number; a1: number; y0: number; y1: number; risers: number } | null
  /** 平面の外接の箱（x0, z0, x1, z1。早く外す） */
  box?: [number, number, number, number]
  /** 階をまたぐ階段（ふつうの見通しの線では通らない） */
  link: boolean
  walk: boolean
  /** 扉: 通り抜けの高さ（シーンの y の上端）。カメラの見通しに使う */
  top: number
}

export interface ObstacleM {
  level: number
  /** 凸の多角形（シーンの x, z）か円 */
  poly: XZ[] | null
  center: XZ | null
  radius: number
  /** 高さの範囲（シーンの y） */
  y0: number
  y1: number
  name: string
  /** 花音の通り道が避けるか（小さな物・椅子の下は false でもよい） */
  nav: boolean
  /** カメラが避けるか */
  cam: boolean
  /** 平面の外接の箱（x0, z0, x1, z1。早く外す） */
  box?: [number, number, number, number]
}

export interface StairM {
  def: StairDef
  /** 下の点・上の点（通り道。シーンの x, z） */
  bottom: XZ
  top: XZ
  /** 段の範囲（シーンの多角形）と、下・上の高さ（シーンの y） */
  poly: XZ[]
  y0: number
  y1: number
}

export interface DoorM {
  def: DoorDef
  /** 中心（シーンの x, z）・壁に沿った向き・法線（+ の側） */
  center: XZ
  along: XZ
  normal: XZ
  /** 床（シーンの y。両側で違えば低い方）と上端 */
  floorY: number
  topY: number
  thickness: number
}

export interface NavNode {
  x: number
  z: number
  level: number
  /** 弧のスロープの途中の点（決まった線だけで結ぶ。見通しの線・行き先からは結ばない） */
  link?: boolean
}

/** 窓（外観の開口）の通り抜けの範囲（カメラの見通し）。シーンの多角形と高さ */
interface WindowVolume {
  poly: XZ[]
  y0: number
  y1: number
}

const NAV_CLEARANCE = 0.28
const NO_OBSTACLES: ObstacleM[] = []
const MAX_EDGE = 6.5
/** 歩ける所の確かめの格子の大きさ（m） */
const GRID = 4

/** 多角形の外接の箱 */
function boxOf(poly: XZ[]): [number, number, number, number] {
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x)
    z0 = Math.min(z0, z)
    x1 = Math.max(x1, x)
    z1 = Math.max(z1, z)
  }
  return [x0, z0, x1, z1]
}

/** 点が箱から m より外か */
function outsideBox(b: [number, number, number, number] | undefined, x: number, z: number, m: number) {
  return !!b && (x < b[0] - m || x > b[2] + m || z < b[1] - m || z > b[3] + m)
}

/** 点が多角形の中か */
export function inPoly(poly: XZ[], x: number, z: number) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** 点から多角形の辺までのいちばん近い距離 */
function edgeDist(poly: XZ[], x: number, z: number) {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]
    const [bx, bz] = poly[i]
    const dx = bx - ax
    const dz = bz - az
    const l2 = dx * dx + dz * dz || 1e-9
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2))
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
  }
  return best
}

/** 多角形の中なら辺までの距離（正）、外なら負 */
export function polyMargin(poly: XZ[], x: number, z: number) {
  const d = edgeDist(poly, x, z)
  return inPoly(poly, x, z) ? d : -d
}

/** 局所の多角形を、各辺から d だけ内へ縮める（辺ごとの縮め幅 ds を渡せば、辺ごとに） */
export function insetPoly(poly: L2[], d: number | number[]) {
  const n = poly.length
  const off = (i: number) => (typeof d === 'number' ? d : d[i])
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const l = Math.hypot(dx, dy) || 1
    // 反時計回りなので、内向きは左（-dy, dx）
    const nx = -dy / l
    const ny = dx / l
    return { p: [p[0] + nx * off(i), p[1] + ny * off(i)] as L2, d: [dx / l, dy / l] as L2 }
  })
  const out: L2[] = []
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n]
    const b = lines[i]
    const den = a.d[0] * b.d[1] - a.d[1] * b.d[0]
    if (Math.abs(den) < 1e-6) {
      out.push(b.p)
      continue
    }
    const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den
    out.push([a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t])
  }
  return out
}

/** 局所の長方形（中心・向き・幅・奥行き）の 4 隅 */
export function rectCorners(c: L2, along: L2, w: number, d: number): L2[] {
  const n: L2 = [-along[1], along[0]]
  const hw = w / 2
  const hd = d / 2
  return [
    [c[0] - along[0] * hw - n[0] * hd, c[1] - along[1] * hw - n[1] * hd],
    [c[0] + along[0] * hw - n[0] * hd, c[1] + along[1] * hw - n[1] * hd],
    [c[0] + along[0] * hw + n[0] * hd, c[1] + along[1] * hw + n[1] * hd],
    [c[0] - along[0] * hw + n[0] * hd, c[1] - along[1] * hw + n[1] * hd],
  ]
}

export class InteriorModel {
  readonly zone: ZoneDef
  readonly frame: LocalFrame
  readonly brief: InteriorBrief
  readonly rec: NamedRecord
  rooms: RoomM[] = []
  patches: PatchM[] = []
  obstacles: ObstacleM[] = []
  stairs: StairM[] = []
  doors: DoorM[] = []
  nodes: NavNode[] = []
  edges: number[][] = []
  /** 灯りの組の名前（番号の順） */
  groups: string[] = []
  /** 建物の外形（シーンの x, z） */
  footprint: XZ[]
  private windows: WindowVolume[] = []
  private terrainY: (x: number, z: number, step?: boolean) => number
  /** 作り直すたびに増える */
  version = 0

  constructor(id: InteriorZoneId, brief: InteriorBrief, rec: NamedRecord, openings: OpeningRecord[], terrainY: (x: number, z: number, step?: boolean) => number) {
    this.zone = INTERIOR_ZONES[id]
    this.frame = this.zone.frame
    this.brief = brief
    this.rec = rec
    this.terrainY = terrainY
    this.footprint = rec.ring.map((p) => [p[0], -p[1]] as XZ)
    this.build(openings)
  }

  /** 局所の (s, t) → シーンの x, z */
  xz(s: number, t: number): XZ {
    const [x, y] = planOf(this.frame, s, t)
    return [x, -y]
  }

  /** 局所の高さ → シーンの y */
  y(h: number) {
    return this.frame.z + h - LAB
  }

  /** シーンの x, z → 局所の (s, t) */
  local(x: number, z: number): L2 {
    return localOf(this.frame, x, z)
  }

  /** 局所の向き → シーンの向き（x, z の単位ベクトル） */
  dirOf(ds: number, dt: number): XZ {
    const f = this.frame
    const x = f.ax * ds + f.bx * dt
    const y = f.ay * ds + f.by * dt
    const l = Math.hypot(x, y) || 1
    return [x / l, -y / l]
  }

  /** 階の床（シーンの y） */
  levelFloorY(level: number) {
    const lv = this.zone.levels[Math.max(0, Math.min(this.zone.levels.length - 1, level))]
    return this.y(lv.floor)
  }

  /** 部屋の多角形（局所）: 決めた多角形か、地図データの部屋 */
  private roomLocal(def: RoomDef): L2[] {
    if (def.poly) return def.poly
    const r = this.rec.rooms.find((q) => q.name === (def.dataName ?? def.name))
    if (!r) throw new Error(`部屋「${def.dataName ?? def.name}」が地図データにありません（${this.rec.id}）`)
    const loc = r.ring.map((p) => localOf(this.frame, p[0], -p[1]))
    return loc
  }

  private build(openings: OpeningRecord[]) {
    const b = this.brief
    const lv = this.zone.levels
    // 部屋（ドームの天井の部屋（ガラスの温室の大きな空間）の組を先に。組 0 がガラスの温室の光になる）
    for (const def of b.rooms) {
      if (!def.domeCeil) continue
      const groupName = def.group ?? def.id
      if (!this.groups.includes(groupName)) this.groups.push(groupName)
    }
    for (const def of b.rooms) {
      const local = this.roomLocal(def)
      const floor = def.floor ?? lv[def.level].floor
      const ceil = def.sloped ? def.sloped.ridge : (def.ceiling ?? lv[def.level].ceiling)
      const groupName = def.group ?? def.id
      let g = this.groups.indexOf(groupName)
      if (g < 0) g = this.groups.push(groupName) - 1
      this.rooms.push({ def, id: def.id, level: def.level, poly: local.map((p) => this.xz(p[0], p[1])), local, floorY: this.y(floor), ceilY: this.y(ceil), group: g, walk: !def.noWalk && !def.noFloor })
    }
    // 部屋の歩ける面（仕切りの厚みの半分だけ縮める。外壁の辺はデータの多角形がすでに中の面）
    for (const r of this.rooms) {
      if (!r.walk) continue
      const ds = r.local.map((p, i) => {
        const q = r.local[(i + 1) % r.local.length]
        if (this.isExteriorEdge(p, q)) return 0
        const nb = this.neighborsOf(r, p, q)
        // となりの部屋が無い（データの部屋は壁の中の面まで）→ そのまま、ひと続きの部屋だけ → 少し広げて重ねる
        if (!nb.length) return 0
        // ひと続きの部屋へは深く重ねる（歩ける所は「どれか 1 つの面の中で縁から離れている」ので、境をまたいで続くように）
        if (nb.every((o) => this.isOpen(r, o))) return -0.6
        return b.wallT / 2
      })
      const inner = insetPoly(r.local, ds)
      this.patches.push({ kind: 'room', id: r.id, level: r.level, poly: inner.map((p) => this.xz(p[0], p[1])), y: r.floorY, terrain: false, ramp: null, link: false, walk: true, top: r.ceilY })
    }
    // 扉
    for (const d of b.doors) {
      const along: L2 = d.axis === 's' ? [1, 0] : [0, 1]
      const nrm: L2 = [-along[1], along[0]]
      const th = d.thickness ?? b.wallT
      const fl = d.floor ?? lv[d.level].floor
      const floorLo = Array.isArray(fl) ? Math.min(fl[0], fl[1]) : fl
      const sc = this.xz(d.at[0], d.at[1])
      const sa = this.dirOf(along[0], along[1])
      const sn = this.dirOf(nrm[0], nrm[1])
      this.doors.push({ def: d, center: sc, along: sa, normal: sn, floorY: this.y(floorLo), topY: this.y(floorLo + d.height), thickness: th })
      if (d.kind === 'void') continue
      // 通り抜けの面（幅は扉の幅、壁の両側へ 0.7m。段のある扉は坂にする）
      const depth = th + 1.4
      const corners = rectCorners(d.at, along, d.width, depth).map((p) => this.xz(p[0], p[1]))
      let ramp: PatchM['ramp'] = null
      let y: number | null = this.y(floorLo)
      if (Array.isArray(fl) && Math.abs(fl[0] - fl[1]) > 0.01) {
        // 負の側 → 正の側へ、壁の厚みの所で段を上り下りする
        const o = this.xz(d.at[0] - nrm[0] * (th / 2 + 0.12), d.at[1] - nrm[1] * (th / 2 + 0.12))
        ramp = { ox: o[0], oz: o[1], dx: sn[0], dz: sn[1], len: th + 0.24, y0: this.y(fl[0]), y1: this.y(fl[1]), risers: 1 }
        y = null
      }
      this.patches.push({ kind: 'door', id: d.id, level: d.level, poly: corners, y, terrain: false, ramp, link: false, walk: true, top: this.y(floorLo + d.height) })
    }
    // 階段
    for (const s of b.stairs) {
      if (s.arc) {
        this.arcStair(s)
        continue
      }
      const l = Math.hypot(s.dir[0], s.dir[1]) || 1
      const dir: L2 = [s.dir[0] / l, s.dir[1] / l]
      const len = s.run * (s.risers - 1)
      const mid: L2 = [s.start[0] + dir[0] * len * 0.5, s.start[1] + dir[1] * len * 0.5]
      // 同じ階の中の段（外の石段）は、前後の面と重なるように 1 段ずつ長く
      const corners = rectCorners(mid, dir, len + (s.from === s.to ? s.run * 2 + 1.4 : 0), s.width).map((p) => this.xz(p[0], p[1]))
      const sd = this.dirOf(dir[0], dir[1])
      const o = this.xz(s.start[0], s.start[1])
      const link = s.from !== s.to
      // 体の高さ用のなめらかな坂（1 段目の蹴上げの手前の半段から、最後の段の先の半段まで）
      const ramp = { ox: o[0] - sd[0] * s.run * 0.5, oz: o[1] - sd[1] * s.run * 0.5, dx: sd[0], dz: sd[1], len: len + s.run, y0: this.y(s.y0), y1: this.y(s.y1), risers: s.risers }
      const [offB, offT] = s.landing ?? [0.42, 0.45]
      const bottomL: L2 = [s.start[0] - dir[0] * offB, s.start[1] - dir[1] * offB]
      const topL: L2 = [s.start[0] + dir[0] * (len + offT), s.start[1] + dir[1] * (len + offT)]
      const st: StairM = { def: s, bottom: this.xz(bottomL[0], bottomL[1]), top: this.xz(topL[0], topL[1]), poly: corners, y0: this.y(s.y0), y1: this.y(s.y1) }
      this.stairs.push(st)
      // 坂の面（段より少し広く、前後に半段ずつ）
      const rampPoly = rectCorners(mid, dir, len + s.run * 1.2, s.width).map((p) => this.xz(p[0], p[1]))
      this.patches.push({ kind: 'stair', id: s.id, level: s.from, poly: link ? rampPoly : corners, y: null, terrain: false, ramp, link, walk: true, top: Math.max(st.y0, st.y1) + 2.2 })
      if (link) {
        // 下の階では段の下、上の階では吹き抜け（手すり）。どちらも通らない
        const span = rectCorners(mid, dir, len, s.width + 0.04).map((p) => this.xz(p[0], p[1]))
        if (s.blockUnder !== false) {
          this.obstacles.push({ level: s.from, poly: span, center: null, radius: 0, y0: st.y0, y1: st.y1, name: `${s.id}（段）`, nav: true, cam: false })
          // カメラ: 段の板と、その下（階段の下の壁・物入れ）。段の勾配に沿って 8 つに分け、それぞれ真ん中の段の上の面まで
          // （追うカメラが階段の下に入り、段の裏の面で画面がふさがっていた。§7 の 148）
          const parts = 8
          for (let k = 0; k < parts; k++) {
            const c: L2 = [s.start[0] + dir[0] * len * ((k + 0.5) / parts), s.start[1] + dir[1] * len * ((k + 0.5) / parts)]
            const poly = rectCorners(c, dir, len / parts + 0.02, s.width).map((p) => this.xz(p[0], p[1]))
            this.obstacles.push({ level: s.from, poly, center: null, radius: 0, y0: st.y0 - 0.05, y1: this.y(s.y0 + ((s.y1 - s.y0) * (k + 0.5)) / parts) + 0.04, name: `${s.id}（段の下）`, nav: false, cam: true })
          }
        }
        this.obstacles.push({ level: s.to, poly: span, center: null, radius: 0, y0: st.y1 - 0.3, y1: st.y1 + 0.95, name: `${s.id}（吹き抜け）`, nav: true, cam: false })
      }
    }
    // 外の歩ける所
    for (const a of b.outdoor) {
      const poly = a.poly.map((p) => this.xz(p[0], p[1]))
      this.patches.push({ kind: 'outdoor', id: a.id, level: a.level ?? 0, poly, y: a.h === 'terrain' ? null : this.y(a.h), terrain: a.h === 'terrain', ramp: null, link: false, walk: true, top: Infinity })
      // 上の階の床（回廊・つり橋・踊り場・テラス・バルコニー）は、床の板の厚みの分をカメラが避け、見通しもさえぎる
      // （ドームで、構図の移りのカメラが回廊の床の下を通り、床を下から突き抜けていた。§7 の 148）
      if (a.h !== 'terrain' && (a.level ?? 0) > 0) this.obstacles.push({ level: a.level ?? 0, poly, center: null, radius: 0, y0: this.y(a.h) - 0.45, y1: this.y(a.h) - 0.03, name: `${a.id}（床）`, nav: false, cam: true })
    }
    // 窓の通り抜け（カメラの見通し）: 外観の開口の、外壁の厚みの分
    for (const r of openings) {
      const o = r.o
      if ((o.fill ?? 'glass') === 'door' && o.door?.kind === 'shutter') continue
      const p0 = r.f.plan(o.s, -0.05)
      const p1 = r.f.plan(o.s + o.w, -0.05)
      const p2 = r.f.plan(o.s + o.w, b.inset + 0.08)
      const p3 = r.f.plan(o.s, b.inset + 0.08)
      this.windows.push({ poly: [p0, p1, p2, p3].map((p) => [p[0], -p[1]] as XZ), y0: r.f.z0 + o.h - LAB, y1: r.f.z0 + o.h + o.ht - LAB })
    }
    for (const p of this.patches) p.box = boxOf(p.poly)
    for (const o of this.obstacles) if (o.poly) o.box = boxOf(o.poly)
  }

  /** 弧の上の点（局所。角度 a・中心からの距離 r） */
  private arcPoint(c: L2, r: number, a: number): L2 {
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]
  }

  /** 弧の段・スロープ: 面（扇形の帯）・坂の高さ・通り道の決まった点の列 */
  private arcStair(s: StairDef) {
    const arc = s.arc!
    const { center: c, radius: R, a0, a1 } = arc
    const span = a1 - a0
    const len = Math.abs(span) * R
    const [offB, offT] = s.landing ?? [0.6, 0.6]
    // 帯の多角形（両端を半段ずつ延ばして、前後の床と重ねる）。局所で反時計回りにする
    const ext = (s.run * 0.6) / R
    const aa = Math.min(a0, a1) - ext
    const ab = Math.max(a0, a1) + ext
    const n = Math.max(4, Math.ceil(((ab - aa) * R) / 1.2))
    const outer: L2[] = []
    const inner: L2[] = []
    for (let i = 0; i <= n; i++) {
      const a = aa + ((ab - aa) * i) / n
      outer.push(this.arcPoint(c, R + s.width / 2, a))
      inner.push(this.arcPoint(c, R - s.width / 2, a))
    }
    const local = [...outer, ...inner.reverse()]
    const poly = local.map((p) => this.xz(p[0], p[1]))
    const link = s.from !== s.to
    const dirA = Math.sign(span) || 1
    const bottomL = this.arcPoint(c, R, a0 - (dirA * offB) / R)
    const topL = this.arcPoint(c, R, a1 + (dirA * offT) / R)
    const st: StairM = { def: s, bottom: this.xz(bottomL[0], bottomL[1]), top: this.xz(topL[0], topL[1]), poly, y0: this.y(s.y0), y1: this.y(s.y1) }
    this.stairs.push(st)
    this.patches.push({
      kind: 'stair',
      id: s.id,
      level: s.from,
      poly,
      y: null,
      terrain: false,
      ramp: null,
      arc: { c, a0, a1, y0: this.y(s.y0), y1: this.y(s.y1), risers: s.risers },
      link,
      walk: true,
      top: Math.max(st.y0, st.y1) + 2.4,
    })
    void len
    if (link && s.blockUnder !== false) {
      // 下の階では帯の下を通らない（低い所だけ。弧を区切った四角形の障害物）
      const m = Math.max(2, Math.ceil(Math.abs(span) * R / 3))
      for (let i = 0; i < m; i++) {
        const q0 = a0 + (span * i) / m
        const q1 = a0 + (span * (i + 1)) / m
        const ring = [this.arcPoint(c, R - s.width / 2 - 0.05, q0), this.arcPoint(c, R + s.width / 2 + 0.05, q0), this.arcPoint(c, R + s.width / 2 + 0.05, q1), this.arcPoint(c, R - s.width / 2 - 0.05, q1)]
        const pl = (span > 0 ? ring : [...ring].reverse()).map((p) => this.xz(p[0], p[1]))
        this.obstacles.push({ level: s.from, poly: pl, center: null, radius: 0, y0: st.y0, y1: Math.max(st.y0, st.y1), name: `${s.id}（段の下）`, nav: true, cam: false })
      }
    }
  }

  /** 弧の段の通り道の点（下の点・途中の点・上の点。シーンの x, z） */
  private arcNavPoints(st: StairM): XZ[] {
    const arc = st.def.arc!
    const R = arc.radius
    const span = arc.a1 - arc.a0
    const n = Math.max(2, Math.ceil((Math.abs(span) * R) / 4))
    const pts: XZ[] = [st.bottom]
    for (let i = 1; i < n; i++) {
      const q = this.arcPoint(arc.center, R, arc.a0 + (span * i) / n)
      pts.push(this.xz(q[0], q[1]))
    }
    pts.push(st.top)
    return pts
  }

  /** 部屋の辺（局所）が外壁の中の面か（建物の外形から inset だけ内側の線の上） */
  isExteriorEdge(p: L2, q: L2) {
    const m: L2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const l = Math.hypot(dx, dy) || 1
    // 辺の外側（右）へ inset + 0.08 の点が、建物の外形の外なら外壁
    const off = this.brief.inset + 0.08
    const ox = m[0] + (dy / l) * off
    const oy = m[1] - (dx / l) * off
    const [x, z] = this.xz(ox, oy)
    return !inPoly(this.footprint, x, z)
  }

  /** 部屋の辺（局所 p → q）の外側にある、ほかの部屋（どの階でも） */
  neighborsOf(r: RoomM, p: L2, q: L2) {
    const m: L2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const l = Math.hypot(dx, dy) || 1
    const off = this.brief.wallT / 2 + 0.06
    const [x, z] = this.xz(m[0] + (dy / l) * off, m[1] - (dx / l) * off)
    return this.rooms.filter((o) => o !== r && o.level === r.level && polyMargin(o.poly, x, z) > -0.01)
  }

  /** 2 つの部屋がひと続きか */
  isOpen(a: RoomM, b: RoomM) {
    return (a.def.open ?? []).includes(b.id) || (b.def.open ?? []).includes(a.id)
  }

  /** 家具などの障害物を足す（builder.ts が家具を置くときに呼ぶ） */
  addObstacle(o: ObstacleM) {
    if (o.poly) o.box = boxOf(o.poly)
    this.obstacles.push(o)
  }

  /** 部屋の天井の高さ（シーンの y。勾配の天井はその点の高さ） */
  ceilAt(r: RoomM, x: number, z: number) {
    const dc = r.def.domeCeil
    if (dc) {
      const [s, t] = this.local(x, z)
      const d = Math.hypot(s - dc.center[0], t - dc.center[1]) / dc.radius
      return this.y(dc.base + dc.height * Math.sqrt(Math.max(0, 1 - d * d)))
    }
    const sl = r.def.sloped
    if (!sl) return r.ceilY
    const [s, t] = this.local(x, z)
    const d = Math.abs((sl.axis === 's' ? t : s) - sl.at)
    return this.y(sl.ridge - sl.slope * d)
  }

  /* ---------------------------------------------------------------------- */
  /* 地面の高さ・歩ける所                                                      */
  /* ---------------------------------------------------------------------- */

  private patchY(p: PatchM, x: number, z: number, step: boolean) {
    if (p.terrain) return this.terrainY(x, z, step)
    if (p.y !== null) return p.y
    if (p.arc) {
      const ac = p.arc
      const [s, t] = this.local(x, z)
      let a = Math.atan2(t - ac.c[1], s - ac.c[0])
      // 角度を a0〜a1 のまわりにそろえる
      const mid = (ac.a0 + ac.a1) / 2
      while (a < mid - Math.PI) a += Math.PI * 2
      while (a > mid + Math.PI) a -= Math.PI * 2
      const k = Math.min(1, Math.max(0, (a - ac.a0) / (ac.a1 - ac.a0)))
      if (!step || ac.risers > 60) return ac.y0 + (ac.y1 - ac.y0) * k
      const idx = Math.min(ac.risers, Math.max(0, Math.floor(k * ac.risers + 0.5)))
      return ac.y0 + ((ac.y1 - ac.y0) * idx) / ac.risers
    }
    const r = p.ramp!
    const along = (x - r.ox) * r.dx + (z - r.oz) * r.dz
    const k = Math.min(1, Math.max(0, along / r.len))
    if (!step) return r.y0 + (r.y1 - r.y0) * k
    // 段そのもの（足の高さ）: 半段の所から段が始まる
    const n = r.risers
    const idx = Math.min(n, Math.max(0, Math.floor(k * (n + 0) + 0.5 / Math.max(1, n))))
    return r.y0 + ((r.y1 - r.y0) * idx) / n
  }

  /** 点（x, z）の地面の高さ（シーンの y）。refY = 今の高さ（階を選ぶ）。どの面にも入らなければ null */
  groundAt(x: number, z: number, refY: number, step = false): number | null {
    let best: number | null = null
    let bestD = Infinity
    let stairBest: number | null = null
    let stairD = Infinity
    for (const p of this.patches) {
      if (outsideBox(p.box, x, z, 0.02) || polyMargin(p.poly, x, z) < -0.02) continue
      const y = this.patchY(p, x, z, step)
      const d = Math.abs(y - refY)
      if (p.kind === 'stair' && (p.ramp || p.arc) && d < 0.5 && d < stairD) {
        stairD = d
        stairBest = y
      }
      if (d < bestD) {
        bestD = d
        best = y
      }
    }
    // 段の中では段を続ける（床と同じ高さのところで床へ乗り移らないように）。足の高さ（step）は段の上の床の段差も見る
    if (stairBest !== null && !step) return stairBest
    return best
  }

  /** 点の階（今の高さ refY にいちばん近い面の階）。どこでもなければ 0 */
  levelAt(x: number, z: number, refY: number) {
    let best = 0
    let bestD = Infinity
    for (const p of this.patches) {
      if (outsideBox(p.box, x, z, 0.02) || polyMargin(p.poly, x, z) < -0.02) continue
      const y = this.patchY(p, x, z, false)
      const d = Math.abs(y - refY)
      if (d < bestD) {
        bestD = d
        const rp = p.ramp ?? p.arc
        best = p.link && rp ? (Math.abs(y - rp.y1) < Math.abs(y - rp.y0) ? this.stairTo(p.id) : p.level) : p.level
      }
    }
    return best
  }

  private stairTo(id: string) {
    return this.stairs.find((s) => s.def.id === id)?.def.to ?? 0
  }

  /** 歩ける所の確かめを速くする格子（GRID m ごとに、かかる面と障害物の番号）。buildNav のはじめに作る */
  private grid: Map<number, { patches: PatchM[]; obstacles: ObstacleM[] }> | null = null
  /** カメラが避ける障害物の格子（GRID m ごと。見通し・カメラを置ける所の確かめを速くする。植物・つるも入るので数が多い） */
  private camGrid: Map<number, ObstacleM[]> | null = null

  private cellKey(x: number, z: number) {
    return (Math.floor(x / GRID) + 2048) * 4096 + (Math.floor(z / GRID) + 2048)
  }

  private buildGrid() {
    const g = new Map<number, { patches: PatchM[]; obstacles: ObstacleM[] }>()
    const add = (box: [number, number, number, number], fn: (c: { patches: PatchM[]; obstacles: ObstacleM[] }) => void) => {
      const m = 0.6
      for (let i = Math.floor((box[0] - m) / GRID); i <= Math.floor((box[2] + m) / GRID); i++)
        for (let j = Math.floor((box[1] - m) / GRID); j <= Math.floor((box[3] + m) / GRID); j++) {
          const k = (i + 2048) * 4096 + (j + 2048)
          let c = g.get(k)
          if (!c) g.set(k, (c = { patches: [], obstacles: [] }))
          fn(c)
        }
    }
    for (const p of this.patches) if (p.walk && !p.link) add(p.box ?? boxOf(p.poly), (c) => c.patches.push(p))
    const cg = new Map<number, ObstacleM[]>()
    for (const o of this.obstacles) {
      const box: [number, number, number, number] = o.poly ? (o.box ?? boxOf(o.poly)) : [o.center![0] - o.radius, o.center![1] - o.radius, o.center![0] + o.radius, o.center![1] + o.radius]
      if (o.nav) add(box, (c) => c.obstacles.push(o))
      if (o.cam)
        for (let i = Math.floor((box[0] - 0.2) / GRID); i <= Math.floor((box[2] + 0.2) / GRID); i++)
          for (let j = Math.floor((box[1] - 0.2) / GRID); j <= Math.floor((box[3] + 0.2) / GRID); j++) {
            const k = (i + 2048) * 4096 + (j + 2048)
            const list = cg.get(k)
            if (list) list.push(o)
            else cg.set(k, [o])
          }
    }
    this.grid = g
    this.camGrid = cg
  }

  /** 点のまわりのカメラが避ける障害物（格子があれば、その升の分だけ） */
  private camObstacles(x: number, z: number): ObstacleM[] {
    if (!this.camGrid) return this.obstacles
    return this.camGrid.get(this.cellKey(x, z)) ?? NO_OBSTACLES
  }

  /** 点が歩ける所か（階 level の面の中で、縁と障害物から clearance 以上離れている） */
  walkable(x: number, z: number, level: number, clearance = NAV_CLEARANCE) {
    if (this.grid && clearance <= 0.6) {
      const c = this.grid.get(this.cellKey(x, z))
      if (!c) return false
      let ok = false
      for (const p of c.patches) {
        if (p.level !== level || outsideBox(p.box, x, z, 0)) continue
        if (polyMargin(p.poly, x, z) >= clearance) {
          ok = true
          break
        }
      }
      if (!ok) return false
      for (const o of c.obstacles) if (o.level === level && obstacleDist(o, x, z) < clearance) return false
      return true
    }
    let ok = false
    for (const p of this.patches) {
      if (!p.walk || p.link || p.level !== level || outsideBox(p.box, x, z, 0)) continue
      if (polyMargin(p.poly, x, z) >= clearance) {
        ok = true
        break
      }
    }
    if (!ok) return false
    for (const o of this.obstacles) {
      if (!o.nav || o.level !== level) continue
      if (obstacleDist(o, x, z) < clearance) return false
    }
    return true
  }

  /** 線分が歩ける所だけを通るか（5cm ごと） */
  segmentClear(a: XZ, b: XZ, level: number, clearance = NAV_CLEARANCE) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    // 5cm ごと（長い線は 8cm ごと。縁からの余裕の方が大きいので、すき間を飛び越えない）
    const n = Math.max(2, Math.ceil(len / (len > 7 ? 0.08 : 0.05)))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      if (!this.walkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, level, clearance)) return false
    }
    return true
  }

  /**
   * KB-001 が浮かんでよい所か: 歩ける面（階段・スロープも）の縁から margin m 以上内側の上、面から 0.3〜2.6m の高さで、
   * 通り道の障害物（家具・植物）の中でない。歩ける面の縁には手すり・壁があるので、画面の外へずらすときにそこを越えないように
   */
  hoverOk(x: number, y: number, z: number, margin = 0.2) {
    let over = false
    for (const p of this.patches) {
      if (!p.walk || outsideBox(p.box, x, z, 0) || polyMargin(p.poly, x, z) < margin) continue
      const g = this.patchY(p, x, z, false)
      if (y - g > 0.3 && y - g < 2.6) {
        over = true
        break
      }
    }
    if (!over) return false
    for (const o of this.obstacles) {
      if (!o.nav || y < o.y0 - 0.15 || y > o.y1 + 0.15) continue
      if (obstacleDist(o, x, z) < 0.15) return false
    }
    return true
  }

  /** ゾーンの中か（建物と外の歩ける所のまわり） */
  contains(x: number, z: number) {
    return Math.hypot(x - this.zone.center[0], z - this.zone.center[1]) < this.zone.radius
  }

  /** 建物の外形の中か（margin だけ外へ広げて） */
  inBuilding(x: number, z: number, margin = 0) {
    return polyMargin(this.footprint, x, z) > -margin
  }

  /* ---------------------------------------------------------------------- */
  /* 通り道                                                                  */
  /* ---------------------------------------------------------------------- */

  /** 通り道のグラフを作る（家具の障害物を足したあとに 1 回）。stops = このゾーンの立ち寄り先（x, z と階） */
  buildNav(stops: NavNode[]) {
    this.buildGrid()
    const nodes: NavNode[] = [...stops]
    const b = this.brief
    for (const d of this.doors) {
      if (d.def.kind === 'void') continue
      const off = d.thickness / 2 + 0.42
      const lv = d.def.level
      nodes.push({ x: d.center[0] + d.normal[0] * off, z: d.center[1] + d.normal[1] * off, level: lv }, { x: d.center[0] - d.normal[0] * off, z: d.center[1] - d.normal[1] * off, level: lv })
    }
    const stairLinks: [number, number][] = []
    for (const s of this.stairs) {
      if (s.def.from === s.def.to && !s.def.arc) {
        nodes.push({ x: s.bottom[0], z: s.bottom[1], level: s.def.from }, { x: s.top[0], z: s.top[1], level: s.def.from })
        continue
      }
      if (s.def.arc) {
        // 弧の段: 下の点 → 途中の点（決まった線だけ）→ 上の点
        const pts = this.arcNavPoints(s)
        let prev = -1
        pts.forEach((p, i) => {
          const end = i === 0 || i === pts.length - 1
          const idx = nodes.push({ x: p[0], z: p[1], level: i === pts.length - 1 ? s.def.to : s.def.from, link: !end }) - 1
          if (prev >= 0) stairLinks.push([prev, idx])
          prev = idx
        })
        continue
      }
      const i0 = nodes.push({ x: s.bottom[0], z: s.bottom[1], level: s.def.from }) - 1
      const i1 = nodes.push({ x: s.top[0], z: s.top[1], level: s.def.to }) - 1
      stairLinks.push([i0, i1])
    }
    for (const p of b.navPoints) {
      const [x, z] = this.xz(p.at[0], p.at[1])
      nodes.push({ x, z, level: p.level })
    }
    // 部屋の中ほど
    for (const r of this.rooms) {
      if (!r.walk) continue
      const c = r.poly.reduce((a, q) => [a[0] + q[0] / r.poly.length, a[1] + q[1] / r.poly.length], [0, 0])
      if (this.walkable(c[0], c[1], r.level)) nodes.push({ x: c[0], z: c[1], level: r.level })
    }
    const edges: number[][] = nodes.map(() => [])
    const maxEdge = b.maxEdge ?? MAX_EDGE
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const c = nodes[j]
        if (a.level !== c.level || a.link || c.link) continue
        if (Math.hypot(a.x - c.x, a.z - c.z) > maxEdge) continue
        if (!this.segmentClear([a.x, a.z], [c.x, c.z], a.level)) continue
        edges[i].push(j)
        edges[j].push(i)
      }
    for (const [i, j] of stairLinks) {
      edges[i].push(j)
      edges[j].push(i)
    }
    this.nodes = nodes
    this.edges = edges
    this.version++
  }

  /** start（x, z, 階）から goal までの経路（点の列）。見つからなければ null */
  findPath(start: XZ, startLevel: number, goal: XZ, goalLevel: number): XZ[] | null {
    const maxEdge = this.brief.maxEdge ?? MAX_EDGE
    if (startLevel === goalLevel && this.segmentClear(start, goal, startLevel, NAV_CLEARANCE * 0.7) && Math.hypot(goal[0] - start[0], goal[1] - start[1]) <= maxEdge) return [start, goal]
    const nodes = [...this.nodes, { x: start[0], z: start[1], level: startLevel }, { x: goal[0], z: goal[1], level: goalLevel }]
    const S = nodes.length - 2
    const G = nodes.length - 1
    const adj = [...this.edges.map((e) => [...e]), [] as number[], [] as number[]]
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]
      if (n.link) continue
      const near = (p: XZ) => Math.hypot(p[0] - n.x, p[1] - n.z) <= Math.max(12, maxEdge * 1.5)
      if (n.level === startLevel && near(start) && this.segmentClear(start, [n.x, n.z], startLevel, NAV_CLEARANCE * 0.55)) {
        adj[S].push(i)
        adj[i].push(S)
      }
      if (n.level === goalLevel && near(goal) && this.segmentClear([n.x, n.z], goal, goalLevel, NAV_CLEARANCE * 0.55)) {
        adj[i].push(G)
        adj[G].push(i)
      }
    }
    const dist = (a: number, c: number) => Math.hypot(nodes[a].x - nodes[c].x, nodes[a].z - nodes[c].z) + Math.abs(nodes[a].level - nodes[c].level) * 3
    const gScore = new Map<number, number>([[S, 0]])
    const came = new Map<number, number>()
    const open = new Set<number>([S])
    const f = (n: number) => (gScore.get(n) ?? Infinity) + dist(n, G)
    while (open.size) {
      let cur = -1
      for (const n of open) if (cur < 0 || f(n) < f(cur)) cur = n
      if (cur === G) {
        const path: XZ[] = [[nodes[G].x, nodes[G].z]]
        let c = G
        while (came.has(c)) {
          c = came.get(c)!
          const p: XZ = [nodes[c].x, nodes[c].z]
          if (Math.hypot(p[0] - path[0][0], p[1] - path[0][1]) > 0.02) path.unshift(p)
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

  /* ---------------------------------------------------------------------- */
  /* カメラ                                                                  */
  /* ---------------------------------------------------------------------- */

  /** 点（シーン）がある部屋（床と天井の間で、壁から margin 以上内側）。無ければ null */
  roomAt(x: number, y: number, z: number, margin = 0.06) {
    for (const r of this.rooms) {
      if (y < r.floorY + 0.02 || y > this.ceilAt(r, x, z) - 0.02) continue
      if (polyMargin(r.poly, x, z) >= margin) return r
    }
    return null
  }

  /** 点が通り抜けられる空き（部屋・扉の通り抜け・窓の穴・段の上）か */
  private open(x: number, y: number, z: number) {
    if (this.roomAt(x, y, z, 0.03)) return true
    for (const p of this.patches) {
      if (p.kind !== 'door' && p.kind !== 'stair') continue
      const fy = this.patchY(p, x, z, false)
      if (y < fy - 0.05 || y > p.top) continue
      if (polyMargin(p.poly, x, z) >= 0.02) return true
    }
    for (const w of this.windows) if (y > w.y0 && y < w.y1 && polyMargin(w.poly, x, z) >= 0.01) return true
    return false
  }

  /** カメラを置ける所か（建物の中なら部屋の中で家具の外、外なら地面より上） */
  cameraOk(p: THREE.Vector3, margin = 0.12) {
    // 部屋の無いゾーン（楓坂駅の上屋とホーム）は、建物の外と同じに地面の上・障害物（上屋の柱と屋根も）の外ならよい
    if (this.rooms.length && this.inBuilding(p.x, p.z, 0.05)) {
      if (!this.roomAt(p.x, p.y, p.z, margin)) return false
    } else {
      const g = this.groundAt(p.x, p.z, p.y) ?? this.terrainY(p.x, p.z)
      if (p.y < g + 0.3) return false
    }
    for (const o of this.camObstacles(p.x, p.z)) {
      if (!o.cam || p.y < o.y0 || p.y > o.y1 + 0.05) continue
      if (obstacleDist(o, p.x, p.z) < margin) return false
    }
    return true
  }

  /** カメラ（from）から点（to）まで、壁・床・天井・家具にさえぎられないか（to のまわり skip m は見ない） */
  sight(from: THREE.Vector3, to: THREE.Vector3, skip = 0.4) {
    const len = from.distanceTo(to)
    const n = Math.max(6, Math.ceil(len / 0.045))
    for (let i = 1; i < n; i++) {
      const t = i / n
      const x = from.x + (to.x - from.x) * t
      const y = from.y + (to.y - from.y) * t
      const z = from.z + (to.z - from.z) * t
      if ((1 - t) * len < skip) break
      if (this.rooms.length && this.inBuilding(x, z, 0.02)) {
        if (!this.open(x, y, z)) return false
      } else {
        const g = this.groundAt(x, z, y) ?? this.terrainY(x, z)
        if (y < g + 0.05) return false
      }
      for (const o of this.camObstacles(x, z)) {
        if (!o.cam || y < o.y0 || y > o.y1) continue
        if (obstacleDist(o, x, z) < 0) return false
      }
    }
    return true
  }
}

export function obstacleDist(o: ObstacleM, x: number, z: number) {
  if (o.poly) {
    // 箱から遠ければ、箱までの距離（それより近くはない）
    const b = o.box
    if (b) {
      const dx = Math.max(b[0] - x, 0, x - b[2])
      const dz = Math.max(b[1] - z, 0, z - b[3])
      if (dx > 0.5 || dz > 0.5) return Math.hypot(dx, dz)
    }
    return -polyMargin(o.poly, x, z)
  }
  return Math.hypot(x - o.center![0], z - o.center![1]) - o.radius
}
