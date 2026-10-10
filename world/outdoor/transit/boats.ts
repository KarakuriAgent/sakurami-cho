import * as THREE from 'three'
import { townOptions } from '../../townHost'
import { townData } from '../town/townData'
import { Fleet, placeMatrix } from './fleet'
import { LANDING, landingPoint, type BoatLanding } from './landings'
import { H, RunProfile, activeRuns, departures, type Headways } from '../../../core/transit/schedule'
import { Path, pathPoint, type TownTransit, type TransitBoatRoute } from './transitData'
import type { VehicleShapes } from './vehicles'
import { WATERBUS, type WaterbusDetail } from './waterbusCar'

/**
 * 船（運河バス 3 航路・汐見島連絡船・港の小舟と貨物船）。どれも波で揺れる（運河は小さく、海は大きく）。
 *
 * - 運河バス（vol3 4-5。A 港めぐり 約 30 分・反時計回りの輪、B 運河縦断 約 25 分、C 桜見川のぼり 約 20 分）: データに本数が無いので、
 *   A は 15 分・B は 20 分・C は 25 分おき、A 7:00〜21:00・B 7:00〜20:00・C 7:30〜19:30 の発車とした（§15）。乗り場で 40 秒止まる
 * - 汐見島連絡船（vol3 4-6。15 分、1 時間に 2 便。あかり丸・ともしび丸）: 2 隻が 30 分ずらして往復（ターミナルを毎時 0 分・30 分に出る）。6:00〜21:30。
 *   運転の後はターミナルに 2 隻並んで泊まる
 * - 港の小舟: 新汐見の船だまり（プレジャーボート・ヨット）・汐見島の漁港（漁船）・運河の石段の船着き場（小さなボート）・舟溜町の運河バスの車庫（予備の運河バス）・
 *   北埠頭の船だまり（貨物船）。泊まったまま揺れる
 */

const DWELL = 40
const ORIGIN_DWELL = 180
const PRE = 90

interface RouteSpec {
  headway: number
  first: number
  last: number
  phase: number
}

const ROUTE_SPEC: Record<string, RouteSpec> = {
  A: { headway: 15 * 60, first: H(7), last: H(21), phase: 0 },
  B: { headway: 20 * 60, first: H(7), last: H(20), phase: 300 },
  C: { headway: 25 * 60, first: H(7, 30), last: H(19, 30), phase: 0 },
}

export interface BoatRoute {
  data: TransitBoatRoute
  path: Path
  out: RunProfile
  back: RunProfile | null
  deps: number[]
  farDwell: number
  span: number
  s0: number
  s1: number
  /** 乗り場ごとの着く・出る秒（起点の発車からの秒。行きの並びと帰りの並び） */
  outStops: BoatStopTime[]
  backStops: BoatStopTime[]
}

/** 乗り場の着く・出る秒（起点の発車からの秒） */
export interface BoatStopTime {
  /** 乗り場の id（waterbus_pier.*）と名前 */
  id: string
  name: string
  d: number
  arrive: number
  depart: number
}

/** 乗り場の扉: 着いて openAfter 秒で開き始め（move 秒で開く）、発車の closeBefore 秒前に閉め始める */
export const BOAT_DOOR = { openAfter: 4, closeBefore: 6, move: 1.6 } as const
export const BOAT_DWELL = DWELL

/** 走っている 1 隻の運河バスの今のコマ */
export interface BoatRun {
  route: BoatRoute
  run: number
  d: number
  dir: number
  speed: number
  /** 舟の局所（+z = 舳先・+x = 舳先を向いて左・y = 上（水面 = 0））→ シーン（波の揺れ込み） */
  matrix: THREE.Matrix4
  center: THREE.Vector3
  dist: number
  /** 扉の開き具合（0〜1）と開く側（局所の x の向き）。止まっている乗り場（向きの並びの番号。無ければ -1）と向き */
  door: number
  doorSide: number
  stop: number
  stopDir: number
}

interface Moored {
  x: number
  y: number
  z: number
  dx: number
  dy: number
  kind: 'boat0' | 'boat1' | 'boat2' | 'bus' | 'cargo' | 'ferry'
  seed: number
  sea: boolean
}

const _p = pathPoint()
const _q = pathPoint()
const _door = { open: 0, stop: -1, dir: 1 }
const _dinfo: [number, number, number, number] = [0, 0, 0, 0]
/** 細かい形で描く距離（カメラから m） */
const BOAT_DETAIL_DISTANCE = 70
const _m = new THREE.Matrix4()
const _cam = new THREE.Vector3()
const _runs: number[] = []
const _info: [number, number, number, number] = [0, 1, 6, 0]

/** 波の揺れ（上下 m・横揺れ・縦揺れ ラジアン） */
function sway(t: number, seed: number, sea: boolean, moving: number) {
  const a = sea ? 1 : 0.25
  const p = seed * 40
  const bob = (0.12 * Math.sin(t * 0.9 + p) + 0.05 * Math.sin(t * 2.1 + p * 1.7)) * a
  const roll = (0.035 * Math.sin(t * 0.7 + p * 1.3) + 0.012 * Math.sin(t * 1.9 + p)) * a
  const pitch = (0.015 * Math.sin(t * 0.8 + p * 0.7) - 0.01 * moving) * a + 0.004 * moving
  return { bob, roll, pitch }
}

const isSea = (x: number, y: number) => townData.waterAt(x, y) === 1

const smooth01 = (x: number) => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

/**
 * 乗り場へ寄せる・離れる舟の動き（乗り場ごと・向きごと）。止まる所の前後 L m で、航路の線から下の段の横（berth）へ寄せ、
 * 途中で岸から bulge m 沖へふくらませ、舳先の向きは近い方の hk の割合の間に岸の向きへ回す。
 * 既定（45m・ふくらみ無し）で船体が岸・地形・岸壁にかかる所は、候補の中から一番かからないものを選ぶ（初めて寄せるときに決めて覚える。§7 の 205）
 */
interface DockPlan {
  L: number
  bulge: number
  hk: number
  /** ふくらみが一番大きい所: false = 寄せる道の真ん中、true = 乗り場のすぐ近く（岸の角から離れてから回る） */
  early: boolean
  /** 選んだ形で、それでも船体がかかる試しの点の数（0 が良い） */
  score: number
  /** 寄せる道の水面の高さ（止まる所からの道のり −L〜+L を 1m ごと。舟の舳先・真ん中・艫の下の一番高い水面をならしたもの） */
  z?: Float32Array
}
const DOCK_CANDIDATES: readonly (readonly [number, number, number, boolean])[] = (() => {
  const out: [number, number, number, boolean][] = []
  for (const early of [false, true])
    for (const L of [45, 60, 32, 80]) for (const bulge of [0, 2, 4, 6, -2, 9, 12, 16]) for (const hk of [1, 0.55, 0.3]) if (!early || bulge > 0) out.push([L, bulge, hk, early])
  return out
})()
const _pose = { x: 0, y: 0, fx: 0, fy: 0 }

export class BoatFleet {
  readonly bus: Fleet
  readonly ferryFleet: Fleet
  readonly small: Fleet[]
  readonly cargo: Fleet
  readonly routes: BoatRoute[] = []
  /** 今のコマに走っている運河バス（updateState が書く） */
  readonly runs: BoatRun[] = []
  private pool: BoatRun[] = []
  readonly detail: WaterbusDetail | null
  /** 花音が乗っている便（細かい形でいつも描き、中の灯りを点ける） */
  ridden: { route: string; run: number } | null = null
  /** 乗り場へ寄せる動き（航路・止まる所の道のり・向きごと。初めて寄せるときに決める） */
  private dockPlans = new Map<string, DockPlan>()
  private wallGrid: Map<string, number[][]> | null = null
  private waterGrid: Map<string, number[]> | null = null
  /** 航路の線の 2m ごとの水面の高さ（町の水面の形から。ならしたもの） */
  private surface = new Map<BoatRoute, Float32Array>()
  /** 乗り場（横付けの所） */
  private landings = new Map<string, BoatLanding>()
  private ferry: { path: Path; profile: RunProfile; ships: string[] } | null = null
  private moored: Moored[] = []

  constructor(transit: TownTransit, shapes: VehicleShapes, material: THREE.Material, detail: WaterbusDetail | null = null, landings: BoatLanding[] = []) {
    this.detail = detail
    for (const l of landings) this.landings.set(l.id, l)
    for (const data of transit.waterbus) {
      const spec = ROUTE_SPEC[data.route]
      if (!spec) continue
      // 航路の線を岸・岸壁・桟橋から離す（町の地図データの線は書き換えず、ここで作る線を横へずらす。§7 の 215）
      const raw = new Path(data.pts, 3, false)
      const stopPts = data.stops.map((st) => {
        raw.at(st.d, _p)
        return [_p.x, _p.y] as [number, number]
      })
      const path = this.relaxRoute(raw, stopPts)
      const L = path.length
      const s0 = 8
      const s1 = L - 8
      // 止まる所の道のりは、ずらした線の上へ投げ直す（同じ所を 2 度通る航路があるので、元の道のりの割合の前後 250m の内で）
      const remapped = data.stops.map((st) => {
        raw.at(st.d, _p)
        const guess = (st.d / raw.length) * path.length
        let best = guess
        let bd = Infinity
        for (let i = 1; i < path.x.length; i++) {
          if (Math.abs(path.s[i] - guess) > 250) continue
          const ax = path.x[i - 1]
          const ay = path.y[i - 1]
          const dx = path.x[i] - ax
          const dy = path.y[i] - ay
          const l2 = dx * dx + dy * dy || 1
          const t = Math.max(0, Math.min(1, ((_p.x - ax) * dx + (_p.y - ay) * dy) / l2))
          const dd = Math.hypot(ax + dx * t - _p.x, ay + dy * t - _p.y)
          if (dd < bd) {
            bd = dd
            best = path.s[i - 1] + Math.sqrt(l2) * t
          }
        }
        return best
      })
      const clamped = remapped.map((d) => Math.min(Math.max(d, s0), s1))
      const kept = clamped.map((d, i) => ({ d, id: data.stops[i].id, name: data.stops[i].name })).filter((_, i) => i === 0 || clamped[i] - clamped[i - 1] > 5)
      const stops = kept.map((k) => k.d)
      stops[0] = s0
      stops[stops.length - 1] = s1
      const target = data.minutes * 60
      const out = RunProfile.fit({ stops, dwell: DWELL, accel: 0.25, decel: 0.3 }, data.loop ? target - ORIGIN_DWELL : target, 1.5, 9)
      const back = data.loop ? null : RunProfile.fit({ stops: stops.map((d) => s0 + s1 - d).reverse(), dwell: DWELL, accel: 0.25, decel: 0.3 }, target, 1.5, 9)
      const h = spec.headway
      const run = out.duration + (back?.duration ?? 0)
      let n = Math.ceil((run + ORIGIN_DWELL + (back ? 60 : 0)) / h)
      let farDwell = back ? n * h - run - ORIGIN_DWELL : 0
      if (back && farDwell < 60) {
        n++
        farDwell += h
      }
      const bands: Headways = [[spec.first, h]]
      const deps = departures(spec.first, spec.last, bands, spec.phase)
      // 乗り場ごとの着く・出る秒（起点は発車の PRE 秒前から見えて止まっている。輪の航路の終点 = 起点）
      const nk = kept.length
      const outStops: BoatStopTime[] = kept.map((k, j) => ({
        id: k.id,
        name: k.name,
        d: stops[j],
        arrive: j === 0 ? -PRE : out.arrivals[j],
        depart: j === 0 ? 0 : j < nk - 1 ? out.arrivals[j] + DWELL : out.duration + (back ? farDwell : ORIGIN_DWELL - PRE),
      }))
      const base = out.duration + farDwell
      const backStops: BoatStopTime[] = back
        ? [...kept].reverse().map((k, j) => ({
            id: k.id,
            name: k.name,
            d: stops[nk - 1 - j],
            arrive: j === 0 ? out.duration : base + back.arrivals[j],
            depart: j === 0 ? base : j < nk - 1 ? base + back.arrivals[j] + DWELL : base + back.duration + ORIGIN_DWELL - PRE,
          }))
        : []
      this.routes.push({ data, path, out, back, deps, farDwell, span: run + farDwell + ORIGIN_DWELL, s0, s1, outStops, backStops })
    }
    if (transit.ferry) {
      const path = new Path(transit.ferry.pts, 4, false)
      const profile = RunProfile.fit({ stops: [12, path.length - 12], dwell: 0, accel: 0.12, decel: 0.15 }, transit.ferry.minutes * 60, 2, 9)
      this.ferry = { path, profile, ships: transit.ferry.ships }
    }
    this.placeMoored(transit)
    const capBus = this.routes.reduce((s, r) => s + Math.ceil(r.span / ROUTE_SPEC[r.data.route].headway) + 1, 0) + 6
    this.bus = new Fleet('waterbus', shapes.waterbus, null, material, capBus, 1e9)
    this.ferryFleet = new Fleet('ferry', shapes.ferry, null, material, 4, 1e9)
    this.small = shapes.boats.map((g, i) => new Fleet(`boat${i}`, g, null, material, 64, 1e9))
    this.cargo = new Fleet('cargo', shapes.cargo, null, material, 8, 1e9)
  }

  get meshes() {
    return [...this.bus.meshes, ...this.ferryFleet.meshes, ...this.small.flatMap((f) => f.meshes), ...this.cargo.meshes, ...(this.detail?.meshes ?? [])]
  }

  /**
   * 航路の線（3m ごと）のうち、船体（15m × 3.6m）が岸の地形・岸壁の線にかかる所を、水の上でかからない所まで横へずらす（左右 16m まで。
   * 近い方から。止まる所の近くも同じ: 寄せる動き（dockPlan）はずらした線から乗り場の下の段へ寄せる）。ずらした量は前後 12m で広げてから
   * 前後 24m でならす（急に曲がらないように）。ずらしてもかかる所（橋の下の岸壁の線が航路を横切る所など）はそのまま
   */
  private relaxRoute(raw: Path, stops: [number, number][]): Path {
    const n = raw.x.length
    // 止まる所の前後 70m はずらさない（寄せる動き dockPlan が乗り場の下の段へ寄せる）。70〜100m でずらし始める
    const near = (x: number, y: number) => stops.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[1] - y)), Infinity)
    const mask = new Float32Array(n)
    for (let i = 0; i < n; i++) mask[i] = smooth01((near(raw.x[i], raw.y[i]) - 70) / 30)
    const need = new Float32Array(n)
    const nx = new Float32Array(n)
    const ny = new Float32Array(n)
    let any = false
    for (let i = 0; i < n; i++) {
      const j = Math.min(n - 1, i + 1)
      const k = Math.max(0, j - 1)
      let tx = raw.x[j] - raw.x[k]
      let ty = raw.y[j] - raw.y[k]
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl
      ty /= tl
      nx[i] = -ty
      ny[i] = tx
      const x = raw.x[i]
      const y = raw.y[i]
      const z = this.waterZ(x, y) ?? raw.z[i]
      const segs = this.wallsNear(x, y, 30)
      if (mask[i] <= 0) continue
      const h0 = this.hullHits(x, y, tx, ty, z, segs)
      if (h0 === 0) continue
      let best = 0
      let bestH = h0
      for (let o = 1; o <= 16 && bestH > 0; o += 1)
        for (const sg of [1, -1]) {
          const px = x + nx[i] * o * sg
          const py = y + ny[i] * o * sg
          // 海（町の水面の形の無い所）は航路の線の高さ。地形が水面より高い所は hullHits が数える
          const wz = this.waterZ(px, py) ?? raw.z[i]
          const h = this.hullHits(px, py, tx, ty, wz, this.wallsNear(px, py, 30), bestH - 1)
          if (h < bestH) {
            bestH = h
            best = o * sg
            if (h === 0) break
          }
        }
      need[i] = best
      if (best !== 0) any = true
    }
    if (!any) return raw
    // 広げる（前後 4 点 = 12m の内で一番大きくずらす量）→ ならす（前後 8 点 = 24m）
    const wide = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      let m = 0
      for (let k = -4; k <= 4; k++) {
        const v = need[Math.min(n - 1, Math.max(0, i + k))]
        if (Math.abs(v) > Math.abs(m)) m = v
      }
      wide[i] = m
    }
    const pts: [number, number, number][] = []
    for (let i = 0; i < n; i++) {
      let sum = 0
      let w = 0
      for (let k = -8; k <= 8; k++) {
        const wk = 9 - Math.abs(k)
        sum += wide[Math.min(n - 1, Math.max(0, i + k))] * wk
        w += wk
      }
      const o = (sum / w) * mask[i]
      pts.push([raw.x[i] + nx[i] * o, raw.y[i] + ny[i] * o, raw.z[i]])
    }
    return new Path(this.detour(pts, stops), 3, false)
  }

  /** 平面の点 (x, y) に、半径 3.2m の舟が浮かべられるか（岸の地形が水面 + 0.3m より低い・岸壁の線から 3.2m）。z = 水面 */
  private waterFree(x: number, y: number, z: number) {
    if (townData.heightAt(x, y) > z + 0.3) return false
    for (let a = 0; a < 8; a++) if (townData.heightAt(x + Math.cos((a * Math.PI) / 4) * 3.2, y + Math.sin((a * Math.PI) / 4) * 3.2) > z + 0.3) return false
    for (const g of this.wallsNear(x, y, 20)) {
      const dx = g[2] - g[0]
      const dy = g[3] - g[1]
      const t = Math.min(1, Math.max(0, ((x - g[0]) * dx + (y - g[1]) * dy) / (dx * dx + dy * dy || 1e-9)))
      if (Math.hypot(x - g[0] - dx * t, y - g[1] - dy * t) < 3.2) return false
    }
    return true
  }

  /**
   * 横へずらしても船体がかかる所（桟橋を横切る・岸壁の角）を、水の上の 2m の升目の最短の道で回り込む（前後 24m から。50m の外へは出ない）。
   * 止まる所が区間の中にあれば、その点は通る（止まる所の前と後ろで別々に回り込む。行き止まりの運河の奥で折り返す所を近道しない）。
   * 回り込んだ道は角を丸めて、3m ごとの点に戻す。汐見フェリーターミナルの桟橋（航路の線が桟橋の上を通っていた）など
   */
  private detour(pts: [number, number, number][], stops: [number, number][]): [number, number, number][] {
    const n = pts.length
    const hit = new Uint8Array(n)
    const sev = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)]
      const b = pts[Math.min(n - 1, i + 1)]
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const z = this.waterZ(pts[i][0], pts[i][1]) ?? pts[i][2]
      const h = this.hullHits(pts[i][0], pts[i][1], (b[0] - a[0]) / tl, (b[1] - a[1]) / tl, z, this.wallsNear(pts[i][0], pts[i][1], 30), 40)
      if (h > 2) hit[i] = 1
      sev[i] = Math.min(255, h)
    }
    const runs: [number, number][] = []
    for (let i = 0; i < n; i++) {
      if (!hit[i]) continue
      const last = runs[runs.length - 1]
      if (last && i - last[1] <= 3) last[1] = i
      else runs.push([i, i])
    }
    if (!runs.length) return pts
    let out = pts.slice()
    // 後ろの区間から（前の番号がずれないように）
    for (const [a, b] of runs.reverse()) {
      const s = a - 8
      const e = b + 8
      if (s <= 0 || e >= n - 1) continue
      let maxSev = 0
      for (let i = a; i <= b; i++) maxSev = Math.max(maxSev, sev[i])
      // 止まる所の前後 70m にかかる区間は、桟橋を横切るような大きくかかる所だけ（小さな岸の角は寄せる動き dockPlan にまかせる）
      const nearStop = stops.some(([sx, sy]) => {
        for (let i = s; i <= e; i++) if (Math.hypot(pts[i][0] - sx, pts[i][1] - sy) < 70) return true
        return false
      })
      if (nearStop && maxSev < 16) continue
      // 区間の中の止まる所（いちばん近い点）は通る
      const via: number[] = [s]
      for (const [sx, sy] of stops) {
        let bi = -1
        let bd = 4
        for (let i = s + 1; i < e; i++) {
          const d = Math.hypot(pts[i][0] - sx, pts[i][1] - sy)
          if (d < bd) {
            bd = d
            bi = i
          }
        }
        if (bi > 0) via.push(bi)
      }
      via.push(e)
      via.sort((p, q) => p - q)
      const seg: [number, number, number][] = []
      let ok = true
      for (let k = 1; k < via.length && ok; k++) {
        const part = this.waterPath(pts, via[k - 1], via[k])
        if (!part) ok = false
        else {
          seg.push(...part)
          // 止まる所の点（水の上なら。桟橋の上の点は、近くの水の上の升目を通る道のまま）
          const q = pts[via[k]]
          if (k < via.length - 1 && this.waterFree(q[0], q[1], this.waterZ(q[0], q[1]) ?? q[2])) seg.push(q)
        }
      }
      if (!ok) continue
      out = [...out.slice(0, s + 1), ...seg, ...out.slice(e)]
    }
    return out
  }

  /** 航路の点 pts[s] から pts[e] まで、水の上の 2m の升目の最短の道（両端を除く 3m ごとの点）。見つからなければ null */
  private waterPath(pts: [number, number, number][], s: number, e: number): [number, number, number][] | null {
    const p0 = pts[s]
    const p1 = pts[e]
    if (e - s <= 1) return []
    const z = (p0[2] + p1[2]) / 2
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = s; i <= e; i++) {
      x0 = Math.min(x0, pts[i][0])
      x1 = Math.max(x1, pts[i][0])
      y0 = Math.min(y0, pts[i][1])
      y1 = Math.max(y1, pts[i][1])
    }
    x0 -= 50
    y0 -= 50
    x1 += 50
    y1 += 50
    const C = 2
    const W = Math.ceil((x1 - x0) / C) + 1
    const Hh = Math.ceil((y1 - y0) / C) + 1
    const free = new Int8Array(W * Hh).fill(-1)
    const wz = this.waterZ(p0[0], p0[1]) ?? z
    const isFree = (i: number, j: number) => {
      const k = j * W + i
      if (free[k] < 0) free[k] = this.waterFree(x0 + i * C, y0 + j * C, wz) ? 1 : 0
      return free[k] === 1
    }
    // 両端が水の上でない（止まる所が桟橋の上の点）なら、いちばん近い水の上の升目から
    const nearFree = (px: number, py: number): [number, number] => {
      const ci = Math.round((px - x0) / C)
      const cj = Math.round((py - y0) / C)
      if (isFree(ci, cj)) return [ci, cj]
      for (let r = 1; r <= 8; r++)
        for (let di = -r; di <= r; di++)
          for (const dj of [-r, r])
            for (const [ii, jj] of [
              [ci + di, cj + dj],
              [ci + dj, cj + di],
            ])
              if (ii >= 0 && jj >= 0 && ii < W && jj < Hh && isFree(ii, jj)) return [ii, jj]
      return [ci, cj]
    }
    const [si, sj] = nearFree(p0[0], p0[1])
    const [ei, ej] = nearFree(p1[0], p1[1])
    // A*（8 方向）
    const g = new Float32Array(W * Hh).fill(Infinity)
    const prev = new Int32Array(W * Hh).fill(-1)
    const open: number[] = [sj * W + si]
    g[sj * W + si] = 0
    const goal = ej * W + ei
    const hf = (k: number) => Math.hypot((k % W) - ei, Math.floor(k / W) - ej)
    let found = false
    let iter = 0
    while (open.length && iter++ < 20000) {
      let bi = 0
      for (let q = 1; q < open.length; q++) if (g[open[q]] + hf(open[q]) < g[open[bi]] + hf(open[bi])) bi = q
      const k = open.splice(bi, 1)[0]
      if (k === goal) {
        found = true
        break
      }
      const ci = k % W
      const cj = Math.floor(k / W)
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue
          const ni = ci + di
          const nj = cj + dj
          if (ni < 0 || nj < 0 || ni >= W || nj >= Hh) continue
          const nk = nj * W + ni
          if (nk !== goal && !isFree(ni, nj)) continue
          const ng = g[k] + Math.hypot(di, dj)
          if (ng < g[nk]) {
            if (g[nk] === Infinity) open.push(nk)
            g[nk] = ng
            prev[nk] = k
          }
        }
    }
    if (!found) return null
    const cells: [number, number][] = []
    for (let k = goal; k >= 0; k = prev[k]) cells.unshift([x0 + (k % W) * C, y0 + Math.floor(k / W) * C])
    if (isFree(Math.round((p0[0] - x0) / C), Math.round((p0[1] - y0) / C))) cells[0] = [p0[0], p0[1]]
    if (isFree(Math.round((p1[0] - x0) / C), Math.round((p1[1] - y0) / C))) cells[cells.length - 1] = [p1[0], p1[1]]
    // 見通せる所は引き締める（2m の升目のぎざぎざを消す）
    const clear = (a: [number, number], b: [number, number]) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (let t = 1; t < len; t += 1.5) if (!this.waterFree(a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len, wz)) return false
      return true
    }
    const pulled: [number, number][] = [cells[0]]
    let k = 0
    while (k < cells.length - 1) {
      let m = cells.length - 1
      while (m > k + 1 && !clear(cells[k], cells[m])) m--
      pulled.push(cells[m])
      k = m
    }
    // 角を丸める（チャイキン 2 回）と、3m ごとの点
    let poly = pulled
    for (let it = 0; it < 2; it++) {
      const q: [number, number][] = [poly[0]]
      for (let i = 0; i < poly.length - 1; i++) {
        const A = poly[i]
        const B = poly[i + 1]
        q.push([A[0] * 0.75 + B[0] * 0.25, A[1] * 0.75 + B[1] * 0.25], [A[0] * 0.25 + B[0] * 0.75, A[1] * 0.25 + B[1] * 0.75])
      }
      q.push(poly[poly.length - 1])
      poly = q
    }
    const seg: [number, number, number][] = []
    let acc = 0
    for (let i = 1; i < poly.length; i++) {
      const A = poly[i - 1]
      const B = poly[i]
      const L = Math.hypot(B[0] - A[0], B[1] - A[1])
      for (let t = 3 - acc; t < L - 0.5 || (i < poly.length - 1 && t < L); t += 3) seg.push([A[0] + ((B[0] - A[0]) * t) / L, A[1] + ((B[1] - A[1]) * t) / L, z])
      acc = (acc + L) % 3
    }
    return seg
  }

  /** 航路（A・B・C） */
  route(id: string) {
    return this.routes.find((r) => r.data.route === id) ?? null
  }

  /** 便（航路・起点の発車の番号）の今のコマ（見えていなければ null） */
  find(route: string, run: number) {
    for (const r of this.runs) if (r.route.data.route === route && r.run === run) return r
    return null
  }

  /**
   * 便 i の、時刻 t の扉の開き具合と、止まっている乗り場（向きの並びの番号。止まっていなければ -1）
   */
  doorState(r: BoatRoute, i: number, t: number, out = { open: 0, stop: -1, dir: 1 }) {
    const tau = t - r.deps[i]
    out.open = 0
    out.stop = -1
    out.dir = 1
    for (const [list, dir] of [
      [r.outStops, 1],
      [r.backStops, -1],
    ] as const) {
      for (let j = 0; j < list.length; j++) {
        const st = list[j]
        if (tau < st.arrive || tau > st.depart) continue
        const opening = smooth01((tau - st.arrive - BOAT_DOOR.openAfter) / BOAT_DOOR.move)
        const closing = 1 - smooth01((tau - (st.depart - BOAT_DOOR.closeBefore)) / BOAT_DOOR.move)
        out.open = this.landings.has(st.id) ? Math.min(opening, closing) : 0
        out.stop = j
        out.dir = dir
        return out
      }
    }
    return out
  }

  /** 岸壁・防波堤の線（地面から立つ擁壁を除く）のうち、(x, y) から r m の中にあるもの（20m のます目で引く） */
  private wallsNear(x: number, y: number, r: number) {
    if (!this.wallGrid) {
      this.wallGrid = new Map()
      const infra = townData.infra
      for (const w of infra?.walls ?? []) {
        if (w.follow) continue
        for (let i = 1; i < w.pts.length; i++) {
          const g = [w.pts[i - 1][0], w.pts[i - 1][1], w.pts[i][0], w.pts[i][1]]
          const n = Math.max(1, Math.ceil(Math.hypot(g[2] - g[0], g[3] - g[1]) / 10))
          const keys = new Set<string>()
          for (let k = 0; k <= n; k++) keys.add(`${Math.floor((g[0] + ((g[2] - g[0]) * k) / n) / 20)},${Math.floor((g[1] + ((g[3] - g[1]) * k) / n) / 20)}`)
          for (const key of keys) {
            let list = this.wallGrid.get(key)
            if (!list) this.wallGrid.set(key, (list = []))
            list.push(g)
          }
        }
      }
    }
    const out = new Set<number[]>()
    const c = Math.ceil(r / 20)
    const gx = Math.floor(x / 20)
    const gy = Math.floor(y / 20)
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) for (const g of this.wallGrid.get(`${gx + i},${gy + j}`) ?? []) out.add(g)
    return [...out]
  }

  /** (x, y) の水面の高さ（町の水面の形の三角形。重なっていれば一番高いもの。無ければ null） */
  private waterZ(x: number, y: number) {
    const W = townData.infra?.water
    if (!W) return null
    const P = W.pos
    const I = W.idx
    if (!this.waterGrid) {
      this.waterGrid = new Map()
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3
        const b = I[t + 1] * 3
        const c = I[t + 2] * 3
        const x0 = Math.floor(Math.min(P[a], P[b], P[c]) / 20)
        const x1 = Math.floor(Math.max(P[a], P[b], P[c]) / 20)
        const y0 = Math.floor(Math.min(P[a + 1], P[b + 1], P[c + 1]) / 20)
        const y1 = Math.floor(Math.max(P[a + 1], P[b + 1], P[c + 1]) / 20)
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue
        for (let i = x0; i <= x1; i++)
          for (let j = y0; j <= y1; j++) {
            const key = `${i},${j}`
            let list = this.waterGrid.get(key)
            if (!list) this.waterGrid.set(key, (list = []))
            list.push(t)
          }
      }
    }
    let z: number | null = null
    for (const t of this.waterGrid.get(`${Math.floor(x / 20)},${Math.floor(y / 20)}`) ?? []) {
      const a = I[t] * 3
      const b = I[t + 1] * 3
      const c = I[t + 2] * 3
      const den = (P[b + 1] - P[c + 1]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 1] - P[c + 1])
      if (Math.abs(den) < 1e-9) continue
      const l1 = ((P[b + 1] - P[c + 1]) * (x - P[c]) + (P[c] - P[b]) * (y - P[c + 1])) / den
      const l2 = ((P[c + 1] - P[a + 1]) * (x - P[c]) + (P[a] - P[c]) * (y - P[c + 1])) / den
      const l3 = 1 - l1 - l2
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue
      const h = l1 * P[a + 2] + l2 * P[b + 2] + l3 * P[c + 2]
      if (z === null || h > z) z = h
    }
    return z
  }

  /**
   * 航路の道のり d の水面の高さ。航路の線の高さ（データ）は、桜見川（2.8m）と運河・港（0m）の境で 40m かけて下がるが、
   * 町の水面の形はその境で段になっている（桜見駅南船着場の前）。線の高さのままだと、舟が川の水面の下に沈み・運河の水面の上に浮く
   * ので、町の水面の形の高さ（前後 6m の一番高い所）をならして使う（段の所は短い下り。§7 の 205）
   */
  surfaceAt(r: BoatRoute, d: number) {
    let arr = this.surface.get(r)
    if (!arr) {
      const n = Math.ceil(r.path.length / 2) + 1
      const raw = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        r.path.at(i * 2, _q)
        raw[i] = this.waterZ(_q.x, _q.y) ?? _q.z
      }
      // 段の所で舟が上の水面の下に沈まないように、前後 6m の一番高い水面をとってから、前後 6m でならす
      const at = (j: number) => (r.path.loop ? (j + n) % n : Math.max(0, Math.min(n - 1, j)))
      const hi = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let m = -Infinity
        for (let k = -3; k <= 3; k++) m = Math.max(m, raw[at(i + k)])
        hi[i] = m
      }
      arr = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let sum = 0
        let w = 0
        for (let k = -3; k <= 3; k++) {
          const wk = 4 - Math.abs(k)
          sum += hi[at(i + k)] * wk
          w += wk
        }
        arr[i] = sum / w
      }
      this.surface.set(r, arr)
    }
    const f = Math.max(0, Math.min(arr.length - 1, d / 2))
    const i = Math.min(arr.length - 2, Math.floor(f))
    return arr[i] + (arr[i + 1] - arr[i]) * (f - i)
  }

  /** 船体（真ん中 (x, y)・舳先の向き (ux, uy)・水面 z）が岸の地形・岸壁にかかる試しの点の数（limit を超えたら打ち切る） */
  private hullHits(x: number, y: number, ux: number, uy: number, z: number, segs: number[][], limit = Infinity) {
    const hl = WATERBUS.length / 2 - 0.3
    const hw = WATERBUS.beam / 2 - 0.15
    const sx = -uy
    const sy = ux
    let n = 0
    for (let a = -hl; a <= hl + 0.01; a += hl / 3)
      for (const s of [-hw, 0, hw]) {
        if (townData.heightAt(x + ux * a + sx * s, y + uy * a + sy * s) > z + 0.3) n++
        if (n > limit) return n
      }
    for (const g of segs)
      for (let j = 0; j <= 6; j++) {
        const px = g[0] + ((g[2] - g[0]) * j) / 6 - x
        const py = g[1] + ((g[3] - g[1]) * j) / 6 - y
        if (Math.abs(px * ux + py * uy) < hl && Math.abs(px * sx + py * sy) < hw) n++
      }
    return n
  }

  /** 寄せる動きの形 plan で、道のり d の舟の真ん中（平面）と舳先の向き */
  private dockPose(r: BoatRoute, st: BoatStopTime, dir: number, l: BoatLanding, plan: DockPlan, d: number, out: typeof _pose) {
    r.path.at(d, _p)
    let fx = _p.dx * dir
    let fy = _p.dy * dir
    r.path.at(st.d, _q)
    const f = _q.dx * dir * l.ux + _q.dy * dir * l.uy >= 0 ? 1 : -1
    const bt = this.berth(l, f)
    const nearD = Math.abs(st.d - d)
    const k = smooth01(1 - nearD / plan.L)
    const kh = smooth01(1 - nearD / (plan.L * plan.hk))
    const b = plan.bulge * (plan.early ? Math.sin(Math.PI * Math.sqrt(1 - k)) : 4 * k * (1 - k))
    out.x = _p.x + (bt.x - _q.x) * k + l.wx * b
    out.y = _p.y + (bt.y - _q.y) * k + l.wy * b
    fx += (bt.fx - fx) * kh
    fy += (bt.fy - fy) * kh
    const fl = Math.hypot(fx, fy) || 1
    out.fx = fx / fl
    out.fy = fy / fl
    return out
  }

  /** 寄せる動きの形を、船体（15m × 3.6m）が岸の地形・岸壁にかからないものから選ぶ（初めてのときに決めて覚える） */
  private dockPlan(r: BoatRoute, st: BoatStopTime, dir: number, l: BoatLanding): DockPlan {
    const key = `${r.data.route}|${Math.round(st.d)}|${dir}`
    let plan = this.dockPlans.get(key)
    if (plan) return plan
    const segs = this.wallsNear(l.ex, l.ey, 120)
    const score = (c: DockPlan, limit: number, hits?: number[]) => {
      let n = 0
      for (let nd = 0.5; nd < c.L; nd += 1.5)
        for (const sg of [-1, 1]) {
          const d = st.d + sg * nd
          if (d < r.s0 - 0.01 || d > r.s1 + 0.01) continue
          this.dockPose(r, st, dir, l, c, d, _pose)
          const h = this.hullHits(_pose.x, _pose.y, _pose.fx, _pose.fy, this.surfaceAt(r, d), segs)
          if (h) hits?.push(sg * nd)
          n += h
          if (n > limit) return n
        }
      return n
    }
    let best: DockPlan | null = null
    for (const [L, bulge, hk, early] of DOCK_CANDIDATES) {
      const c: DockPlan = { L, bulge, hk, early, score: 0 }
      c.score = score(c, best ? best.score : Infinity)
      if (!best || c.score < best.score) best = c
      if (best.score === 0) break
    }
    plan = best!
    // 寄せる道の水面の高さ（川と運河の水面の段の所でも、舟の下の一番高い水面に浮かべる）
    const L = Math.ceil(plan.L)
    const raw = new Float32Array(2 * L + 1)
    for (let k = -L; k <= L; k++) {
      const d = Math.max(r.s0, Math.min(r.s1, st.d + k))
      this.dockPose(r, st, dir, l, plan, d, _pose)
      let z = -Infinity
      for (const a of [-WATERBUS.length / 2 + 1, 0, WATERBUS.length / 2 - 1]) {
        const w = this.waterZ(_pose.x + _pose.fx * a, _pose.y + _pose.fy * a)
        if (w !== null) z = Math.max(z, w)
      }
      raw[k + L] = Number.isFinite(z) ? z : this.surfaceAt(r, d)
    }
    const hi = raw.map((_, i) => {
      let m = -Infinity
      for (let j = Math.max(0, i - 3); j <= Math.min(raw.length - 1, i + 3); j++) m = Math.max(m, raw[j])
      return m
    })
    plan.z = hi.map((_, i) => {
      let sum = 0
      let w = 0
      for (let j = -3; j <= 3; j++) {
        const wk = 4 - Math.abs(j)
        sum += hi[Math.max(0, Math.min(hi.length - 1, i + j))] * wk
        w += wk
      }
      return sum / w
    })
    this.dockPlans.set(key, plan)
    if (townOptions().debug) {
      const hits: number[] = []
      score(plan, Infinity, hits)
      this.dockHits.set(key, hits)
    }
    return plan
  }
  readonly dockHits = new Map<string, number[]>()

  /** ?debug: 乗り場へ寄せる動きの形（決めたもの） */
  get dockPlanList() {
    return [...this.dockPlans.entries()].map(([k, v]) => ({ key: k, ...v }))
  }

  /**
   * 乗り場 l に向き f（舳先が岸に沿う向き u の +1 / −1）で横付けしたときの、舟の真ん中（平面座標）と舳先の向き・扉の側（局所の x の向き）
   */
  berth(l: BoatLanding, f: number) {
    const [cx, cy] = landingPoint(l, l.aS - f * WATERBUS.doorZ, l.stageW + LANDING.gap + WATERBUS.beam / 2)
    const fx = l.ux * f
    const fy = l.uy * f
    // 左（局所の +x）= 前を 90° 左へ。岸は −w の側
    const side = -fy * -l.wx + fx * -l.wy > 0 ? 1 : -1
    return { x: cx, y: cy, fx, fy, side }
  }

  /** 交通の時計 t（運転の日の秒）・波の時計 time の、運河バスの位置と扉（描かないコマも。乗る仕組み・カメラ・音が読む） */
  updateState(t: number, time: number, cam: THREE.Vector3 | null) {
    let n = 0
    for (const r of this.routes) {
      activeRuns(r.deps, t, PRE, r.span - PRE, _runs)
      for (const i of _runs) {
        let b = this.pool[n]
        if (!b) {
          b = { route: r, run: i, d: 0, dir: 1, speed: 0, matrix: new THREE.Matrix4(), center: new THREE.Vector3(), dist: 0, door: 0, doorSide: 1, stop: -1, stopDir: 1 }
          this.pool[n] = b
        }
        n++
        const tau = t - r.deps[i]
        let d = r.s0
        let dir = 1
        let speed = 0
        if (tau >= 0 && tau < r.out.duration) {
          d = r.out.at(tau)
          speed = r.out.speed(tau)
        } else if (tau >= r.out.duration) {
          if (!r.back) d = r.out.at(r.out.duration)
          else {
            const t2 = tau - r.out.duration - r.farDwell
            dir = -1
            if (t2 < 0) d = r.s1
            else {
              d = r.s0 + r.s1 - r.back.at(t2)
              speed = t2 < r.back.duration ? r.back.speed(t2) : 0
            }
          }
        }
        r.path.at(d, _p)
        let surfZ = this.surfaceAt(r, d)
        let x = _p.x
        let y = _p.y
        let fx = _p.dx * dir
        let fy = _p.dy * dir
        // 乗り場の前後は、下の段の横（扉が下の段の真ん中）へ寄せる（寄せ方は乗り場ごと。dockPlan）
        const list = dir > 0 ? r.outStops : r.backStops
        let near: BoatStopTime | null = null
        let nearD = Infinity
        for (const st of list) {
          const dd = Math.abs(st.d - d)
          if (dd < 80 && dd < nearD && this.landings.has(st.id)) {
            nearD = dd
            near = st
          }
        }
        if (near) {
          const l = this.landings.get(near.id)!
          const plan = this.dockPlan(r, near, dir, l)
          if (nearD < plan.L) {
            this.dockPose(r, near, dir, l, plan, d, _pose)
            // 水面の高さ: 寄せる道の端の 20% で航路の線の水面とつなぐ
            const L = Math.ceil(plan.L)
            const fz = Math.max(0, Math.min(2 * L, d - near.d + L))
            const iz = Math.min(2 * L - 1, Math.floor(fz))
            const zd = plan.z![iz] + (plan.z![iz + 1] - plan.z![iz]) * (fz - iz)
            const e = smooth01((plan.L - nearD) / (plan.L * 0.2))
            surfZ = surfZ + (zd - surfZ) * e
            x = _pose.x
            y = _pose.y
            fx = _pose.fx
            fy = _pose.fy
          }
        }
        const moving = Math.min(1, speed / 3)
        const sw = sway(time, (i * 0.29) % 1, isSea(_p.x, _p.y), moving)
        placeMatrix(b.matrix, x, y, surfZ + sw.bob - 0.02, fx, fy, 0, true, sw.roll, sw.pitch)
        b.route = r
        b.run = i
        b.d = d
        b.dir = dir
        b.speed = speed
        b.center.setFromMatrixPosition(b.matrix)
        b.dist = cam ? b.center.distanceTo(cam) : Infinity
        const ds = this.doorState(r, i, t, _door)
        b.door = ds.open
        b.stop = ds.stop
        b.stopDir = ds.dir
        b.doorSide = 1
        if (ds.stop >= 0) {
          const st = (ds.dir > 0 ? r.outStops : r.backStops)[ds.stop]
          const l = this.landings.get(st.id)
          if (l) {
            r.path.at(st.d, _q)
            b.doorSide = this.berth(l, (_q.dx * ds.dir * l.ux + _q.dy * ds.dir * l.uy) >= 0 ? 1 : -1).side
          }
        }
      }
    }
    this.runs.length = n
    for (let k = 0; k < n; k++) this.runs[k] = this.pool[k]
  }

  /** 泊まっている船を置く（データの船だまり・船着き場から。種で決まる） */
  private placeMoored(transit: TownTransit) {
    let seed = 1
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (const b of transit.basins) {
      const ring = b.ring
      const cargo = b.id.startsWith('basin.kita-futo')
      const bus = b.id === 'basin.funadamari'
      const fish = b.id.includes('gyoko')
      const step = cargo ? 70 : bus ? 18 : 11
      const inset = cargo ? 12 : bus ? 4 : 5
      let count = 0
      const max = cargo ? 2 : bus ? 4 : 16
      // 輪の辺に沿って、内側へ寄せて並べる（舳先を岸へ）
      const area = ring.reduce((s, p, i) => s + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0)
      const ccw = area > 0 ? 1 : -1
      for (let i = 0; i < ring.length && count < max; i++) {
        const a = ring[i]
        const c = ring[(i + 1) % ring.length]
        const len = Math.hypot(c[0] - a[0], c[1] - a[1])
        const ux = (c[0] - a[0]) / len
        const uy = (c[1] - a[1]) / len
        // 内向き
        const nx = -uy * ccw
        const ny = ux * ccw
        for (let s = step / 2; s < len - step / 2 && count < max; s += step) {
          if (rnd() < (cargo ? 0.4 : 0.35)) continue
          const x = a[0] + ux * s + nx * inset
          const y = a[1] + uy * s + ny * inset
          if (townData.waterAt(x, y) === 0) continue
          const kind: Moored['kind'] = cargo ? 'cargo' : bus ? 'bus' : fish ? 'boat0' : rnd() < 0.45 ? 'boat2' : rnd() < 0.5 ? 'boat0' : 'boat1'
          // 貨物船は岸に横付け、小舟は舳先を岸へ
          const along = cargo || bus
          this.moored.push({ x, y, z: 0, dx: along ? ux : -nx, dy: along ? uy : -ny, kind, seed: rnd(), sea: !bus })
          count++
        }
      }
    }
    // 運河の石段の船着き場（運河バスの乗り場でない所）の 2 つに 1 つに、小さなボート
    transit.landings.forEach((l, i) => {
      if (l.bus || i % 2) return
      const b = (l.bearing * Math.PI) / 180
      const wx = Math.sin(b)
      const wy = Math.cos(b)
      const x = l.x + wx * 3.5
      const y = l.y + wy * 3.5
      if (townData.waterAt(x, y) === 0) return
      // 岸に沿って横付け
      this.moored.push({ x, y, z: 0, dx: wy, dy: -wx, kind: 'boat1', seed: (i * 0.137) % 1, sea: false })
    })
  }

  update(t: number, time: number, camera: THREE.Camera, lit: number, dark = 0) {
    camera.getWorldPosition(_cam)
    for (const f of [this.bus, this.ferryFleet, this.cargo, ...this.small]) f.begin()
    const put = (fleet: Fleet, x: number, y: number, z: number, dx: number, dy: number, seed: number, sea: boolean, moving: number, info: [number, number, number, number]) => {
      const s = sway(time, seed, sea, moving)
      placeMatrix(_m, x, y, z + s.bob - 0.02, dx, dy, 0, true, s.roll, s.pitch)
      const dist = Math.hypot(_m.elements[12] - _cam.x, _m.elements[13] - _cam.y, _m.elements[14] - _cam.z)
      fleet.add(_m, info, dist)
    }
    // 運河バス（乗っている便と、カメラから近い 2 隻は細かい形）
    this.updateState(t, time, _cam)
    this.detail?.begin()
    const near = this.runs.filter((b) => b.dist < BOAT_DETAIL_DISTANCE).sort((a, b) => a.dist - b.dist)
    const isRidden = (b: BoatRun) => !!this.ridden && b.route.data.route === this.ridden.route && b.run === this.ridden.run
    const detailed = new Set<BoatRun>()
    for (const b of this.runs) if (isRidden(b)) detailed.add(b)
    for (const b of near) if (detailed.size < 2 + (this.ridden ? 1 : 0)) detailed.add(b)
    for (const b of this.runs) {
      _info[0] = b.speed > 0.15 ? 1 : 0
      _info[1] = lit
      _info[2] = 6
      _info[3] = (b.run * 0.29) % 1
      if (this.detail && detailed.has(b)) {
        _dinfo[0] = isRidden(b) ? Math.max(lit * 0.4, dark) : Math.max(0.15, dark)
        _dinfo[1] = b.door
        _dinfo[2] = b.doorSide
        _dinfo[3] = 6 + _info[3] * 0.5
        if (this.detail.add(b.matrix, _dinfo, b.speed)) continue
      }
      this.bus.add(b.matrix, _info, b.dist)
    }
    this.detail?.end()
    // 連絡船（2 隻。ターミナルを毎時 0 分・30 分に出る）
    if (this.ferry) {
      const f = this.ferry
      const L = f.path.length
      f.ships.forEach((_, k) => {
        const first = H(6) + k * 1800
        const last = H(21) + k * 1800
        let d = 12
        let dir = 1
        let moving = 0
        if (t >= first) {
          const tt = Math.min(t, last + 3600)
          const ph = (tt - first) % 3600
          const done = t >= last + 3600
          if (!done) {
            if (ph < f.profile.duration) {
              d = f.profile.at(ph)
              moving = Math.min(1, f.profile.speed(ph) / 3)
            } else if (ph < 1800) {
              d = L - 12
            } else if (ph < 1800 + f.profile.duration) {
              d = L - f.profile.at(ph - 1800)
              dir = -1
              moving = Math.min(1, f.profile.speed(ph - 1800) / 3)
            } else {
              d = 12
              dir = -1
            }
          }
        }
        f.path.at(d, _p)
        // ターミナルでは 2 隻目を隣の岸壁（横へ 14m）に
        const side = k * 14 * (1 - THREE.MathUtils.smoothstep(d, 30, 200))
        _info[0] = moving > 0.05 ? 1 : 0
        _info[1] = lit
        _info[2] = 7
        _info[3] = 0.3 + k * 0.4
        put(this.ferryFleet, _p.x - _p.dy * side, _p.y + _p.dx * side, _p.z, _p.dx * dir, _p.dy * dir, _info[3], true, moving, _info)
      })
    }
    // 泊まっている船
    for (const b of this.moored) {
      const fleet = b.kind === 'cargo' ? this.cargo : b.kind === 'bus' ? this.bus : this.small[b.kind === 'boat0' ? 0 : b.kind === 'boat1' ? 1 : 2]
      _info[0] = 0
      _info[1] = b.kind === 'cargo' ? lit * 0.6 : b.kind === 'bus' ? 0 : lit * 0.3
      _info[2] = 6
      _info[3] = b.seed
      put(fleet, b.x, b.y, b.z, b.dx, b.dy, b.seed, b.sea, 0, _info)
    }
    for (const f of [this.bus, this.ferryFleet, this.cargo, ...this.small]) f.end()
  }
}

/** 町のデータを読んだあとの運河バス（乗る仕組み・カメラ・音が使う） */
export const boatNet = { fleet: null as BoatFleet | null }
