import * as THREE from 'three'
import { terrainHeight } from '../town/terrain'
import { townData } from '../town/townData'
import { Fleet, placeMatrix } from './fleet'
import { H, RunProfile, activeRuns, departures, type Headways } from '../../../core/transit/schedule'
import { Path, pathPoint, type TransitTramLine, type TransitTramStop } from './transitData'
import type { ExtraSurface } from '../../walk/townWalk'
import type { TramDetail } from './tramCar'
import { TRAM_GAP, TRAM_SECTION, type VehicleShapes } from './vehicles'

/**
 * 緑電（町電）4 系統の運転。vol3 4-3: 運行は 5:30〜24:30、日中は各系統 6〜8 分間隔。表の所要分（一周 22 分・18・26・25 分）に合うよう、
 * 停留所ごとに 20 秒止まる走り方の最高速度を決める。終点で折り返し、起点に戻った車両が次の発車になる（1 周の時間 = 間隔 × 両数）。
 *
 * - 複線の左側を走る（日本の路面電車）。線の中心から ±TRACK_HALF。起点と終点の手前は単線の行き止まり（両方の向きが中心へ寄る）
 * - 4 系統は起点（桜見駅前）で 1 系統の線路と重なるので、起点では右の線路で発着し、少し先の渡り線で左へ移る
 * - 連接の 3 両は、それぞれ前後の台車の位置を結ぶ向きに置く（曲がりで折れて曲がる）
 */

/** 複線の中心からの距離（m） */
export const TRACK_HALF = 1.75
/** 1 編成の長さ（m） */
const TRAM_LEN = TRAM_SECTION * 3 + TRAM_GAP * 2
/** 停留所の停車（秒）・起点の停車（秒） */
const DWELL = 20
const ORIGIN_DWELL = 120
/** 起点で発車の前に止まって見えている秒 */
const PRE = 60

interface LineSpec {
  headway: number
  /** 起点の発車の位相（秒。系統どうしが同じ時刻に起点に並ばないように） */
  phase: number
  /** 起点で右の線路で発着する（1 系統の線路と重なる 4 系統） */
  originRight?: boolean
  /** 起点で止まる位置を先へずらす（m。起点の停留所で系統どうしの車両が重ならないように） */
  originShift?: number
}

const LINE_SPEC: Record<number, LineSpec> = {
  1: { headway: 8 * 60, phase: 0 },
  2: { headway: 7 * 60, phase: 150, originShift: 12 },
  3: { headway: 7 * 60, phase: 60 },
  4: { headway: 6 * 60, phase: 290, originRight: true, originShift: 40 },
}

export interface TramLine {
  data: TransitTramLine
  path: Path
  out: RunProfile
  back: RunProfile | null
  /** 起点を出る時刻（運転の日の秒） */
  deps: number[]
  /** 終点での停車（秒） */
  farDwell: number
  /** 1 回の運転で見えている長さ（発車の PRE 秒前から、起点に戻って ORIGIN_DWELL - PRE 秒まで） */
  span: number
  originRight: boolean
  /** 車両の中心の、起点・終点の位置（線の上の長さ） */
  s0: number
  s1: number
  lineIndex: number
  /** 停留所ごとの着く・出る秒（起点の発車からの秒）。行きの並びと帰りの並び（帰りは終点から） */
  outStops: TramStopTime[]
  backStops: TramStopTime[]
}

/** 停留所の着く・出る秒（起点の発車からの秒）。name が null は名前の無い止まる所（終点の手前の止め位置） */
export interface TramStopTime {
  name: string | null
  /** 線の上の長さ（車両の中心が止まる所） */
  d: number
  arrive: number
  depart: number
}

/** 線路の横の位置（線の中心から。左 +）。dir = +1 行き（長さが増す向き）・-1 帰り */
export function trackOffset(line: { path: Path; data: { loop: boolean }; originRight: boolean; s0: number }, d: number, dir: number) {
  if (line.data.loop) return TRACK_HALF * dir
  const L = line.path.length
  const taper = (x: number) => THREE.MathUtils.smoothstep(x, 18, 70)
  // 終点の手前は単線（中心）へ
  const tEnd = taper(L - d)
  if (line.originRight) {
    // 起点は右の線路（-TRACK_HALF）で発着。行きは 30〜80m の渡り線で左の線路へ
    if (dir > 0) return THREE.MathUtils.lerp(-TRACK_HALF, TRACK_HALF, THREE.MathUtils.smoothstep(d, line.s0 + 20, line.s0 + 70)) * tEnd
    return -TRACK_HALF * tEnd
  }
  return TRACK_HALF * dir * tEnd * taper(d)
}

/** (x, y) の道の橋の路面の高さ（橋の上でなければ null。いくつか重なれば一番高いもの） */
function bridgeDeck(x: number, y: number) {
  let best: number | null = null
  for (const br of townData.infra?.bridges ?? []) {
    for (let i = 1; i < br.pts.length; i++) {
      const a = br.pts[i - 1]
      const b = br.pts[i]
      const vx = b[0] - a[0]
      const vy = b[1] - a[1]
      const l2 = vx * vx + vy * vy || 1
      const k = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2))
      const px = a[0] + vx * k - x
      const py = a[1] + vy * k - y
      if (px * px + py * py > (br.width / 2) ** 2) continue
      const z = br.deck ?? a[2] + (b[2] - a[2]) * k
      if (best === null || z > best) best = z
    }
  }
  return best
}

/**
 * 水の上を渡る所（町のデータに橋の無い運河の横断。2 系統の一の掘割など）: 軌道の高さが水面・運河の底まで下がっていて、
 * 緑電が 1 コマで 2m ほど沈んでから戻っていた（§7 の 220）。水の上の点の続き（と前後 12m）を、前後の陸の上の高さを結んだ線より下げない
 */
function spanWater(path: Path) {
  const n = path.z.length
  const wet = (i: number) => townData.waterAt(path.x[i], path.y[i]) !== 0
  const MARGIN = 12
  const MAX_SPAN = 150
  for (let i = 0; i < n; i++) {
    if (!wet(i)) continue
    let j = i
    while (j + 1 < n && wet(j + 1)) j++
    // 前後の陸の上の点（MARGIN m 外）
    let a = i
    while (a > 0 && path.s[i] - path.s[a] < MARGIN) a--
    let b = j
    while (b < n - 1 && path.s[b] - path.s[j] < MARGIN) b++
    const span = path.s[b] - path.s[a]
    if (i > 0 && j < n - 1 && span > 0 && span < MAX_SPAN) {
      for (let k = a + 1; k < b; k++) {
        const u = (path.s[k] - path.s[a]) / span
        const z = path.z[a] + (path.z[b] - path.z[a]) * u
        if (path.z[k] < z) path.z[k] = z
      }
    }
    i = j
  }
}

/**
 * 系統の線の行って戻る短いとげを除く（町のデータで、線から 3〜5m 離れた停留所の点を線に入れた所。1 系統に 8 か所・2 系統の港町通。§7 の 220）。
 * とげを通る線では、緑電がその所で横へ 3m ずれて向きが 1 コマだけ折れ（車室の中のカメラ・花音が 1 コマ飛ぶ）、線路もとげの形に描かれていた。
 * 続く 2 つの区間が 120° より大きく折り返し、どちらも 15m より短い点を、無くなるまで除く。map = 元の線の長さ → 除いたあとの長さ（停留所の位置）
 */
function despike(pts: readonly (readonly number[])[]): { pts: (readonly number[])[]; map: (d: number) => number } {
  const keep = pts.map((_, i) => i).filter((i) => i === 0 || Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > 0.05)
  for (let changed = true; changed; ) {
    changed = false
    for (let k = 1; k + 1 < keep.length; k++) {
      const a = pts[keep[k - 1]]
      const b = pts[keep[k]]
      const c = pts[keep[k + 1]]
      const ux = b[0] - a[0]
      const uy = b[1] - a[1]
      const vx = c[0] - b[0]
      const vy = c[1] - b[1]
      const lu = Math.hypot(ux, uy)
      const lv = Math.hypot(vx, vy)
      if (lu < 0.05 || (lu < 15 && lv < 15 && (ux * vx + uy * vy) / (lu * Math.max(lv, 1e-6)) < -0.5)) {
        keep.splice(k, 1)
        changed = true
        k--
      }
    }
  }
  if (keep.length === pts.length) return { pts: pts as (readonly number[])[], map: (d) => d }
  // 元の点ごとの長さ（元の線）と、除いたあとの線の長さ（除いた点は、その前に残した点の長さ）
  const orig: number[] = [0]
  for (let i = 1; i < pts.length; i++) orig.push(orig[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const kept = new Map<number, number>()
  let acc = 0
  keep.forEach((i, k) => {
    if (k > 0) acc += Math.hypot(pts[i][0] - pts[keep[k - 1]][0], pts[i][1] - pts[keep[k - 1]][1])
    kept.set(i, acc)
  })
  const cs: number[] = []
  let last = 0
  for (let i = 0; i < pts.length; i++) {
    if (kept.has(i)) last = kept.get(i)!
    cs.push(last)
  }
  const map = (d: number) => {
    if (d <= 0) return d
    for (let i = 1; i < orig.length; i++) {
      if (d <= orig[i]) {
        const u = orig[i] > orig[i - 1] ? (d - orig[i - 1]) / (orig[i] - orig[i - 1]) : 0
        // 除いた点へ向かう区間（とげ）の上は、とげの根元に止める
        return kept.has(i) ? cs[i - 1] + (cs[i] - cs[i - 1]) * u : cs[i - 1]
      }
    }
    return cs[cs.length - 1] + (d - orig[orig.length - 1])
  }
  return { pts: keep.map((i) => pts[i]), map }
}

/** 系統ごとの運転の決まりを作る（1 回） */
export function buildTramLines(lines: TransitTramLine[]): TramLine[] {
  return lines.map((data, li) => {
    // 線路の高さ: データの軌道の高さ（3 系統の楓坂の路盤）か、地面の高い方。道の橋の上（川を渡る所）は橋の路面
    // （地面は川の底なので、そのままだと橋の中ほどで車体が 1.5m ほど沈み、岸の石積みが車室を通り抜けた。§7 の 206）
    const clean = despike(data.pts)
    const path = new Path(clean.pts, 2, data.loop)
    path.mapZ((x, y, z) => {
      const g = Math.max(z, terrainHeight(x, y))
      const deck = bridgeDeck(x, y)
      // 上を渡る橋（陸橋）は除く: 線路より 3m 以上高い橋の路面は使わない
      return deck !== null && deck > g && deck - g < 3 ? deck : g
    })
    spanWater(path)
    const L = path.length
    const half = TRAM_LEN / 2 + 1
    const spec = LINE_SPEC[data.no] ?? { headway: 7 * 60, phase: 0 }
    const s0 = half + (spec.originShift ?? 0)
    const s1 = data.loop ? L + s0 : L - half
    // 停留所（車両の中心で止まる。起点・終点は端から車両の半分）。名前も同じ並びで持つ（乗る仕組みが停留所の名前で引く）
    const clamped = data.stops.map((s) => Math.min(Math.max(clean.map(s.d), s0), data.loop ? L : s1))
    const kept = clamped.map((d, i) => ({ d, name: data.stops[i].name as string | null })).filter((_, i) => i === 0 || clamped[i] - clamped[i - 1] > 5)
    if (data.loop) kept.push({ d: s1, name: data.stops[0]?.name ?? null })
    else if (kept[kept.length - 1].d < s1 - 5) kept.push({ d: s1, name: null })
    else kept[kept.length - 1].d = s1
    kept[0].d = s0
    const stops = kept.map((k) => k.d)
    const target = data.minutes * 60
    const out = RunProfile.fit({ stops, dwell: DWELL, accel: 1.0, decel: 1.1 }, target, 3, 16)
    const back = data.loop ? null : RunProfile.fit({ stops: stops.map((d) => s0 + s1 - d).reverse(), dwell: DWELL, accel: 1.0, decel: 1.1 }, target, 3, 16)
    const h = spec.headway
    const run = out.duration + (back?.duration ?? 0)
    // 1 周 = 間隔 × 両数（終点の停車は 60 秒以上）
    let n = Math.ceil((run + ORIGIN_DWELL + (back ? 60 : 0)) / h)
    let farDwell = back ? n * h - run - ORIGIN_DWELL : 0
    if (back && farDwell < 60) {
      n++
      farDwell += h
    }
    const cycle = run + farDwell
    // 運転の時間: 5:30 の発車から、起点に 24:30 までに戻る発車まで。朝 7 時まで・夜 21 時からは間隔を倍に
    const bands: Headways = [
      [H(5, 30), h * 2],
      [H(7), h],
      [H(21), h * 2],
    ]
    const deps = departures(H(5, 30), H(24, 30) - cycle, bands, spec.phase)
    // 停留所ごとの着く・出る秒（起点の発車からの秒。行きと帰り）
    const outStops: TramStopTime[] = kept.map((k, j) => ({
      name: k.name,
      d: k.d,
      arrive: j === 0 ? -PRE : out.arrivals[j],
      depart: j === 0 ? 0 : j < kept.length - 1 ? out.arrivals[j] + DWELL : data.loop ? cycle + ORIGIN_DWELL - PRE : out.duration + farDwell,
    }))
    const backStops: TramStopTime[] = back
      ? [...kept].reverse().map((k, j) => {
          const base = out.duration + farDwell
          return {
            name: k.name,
            d: k.d,
            arrive: j === 0 ? out.duration : base + back.arrivals[j],
            depart: j === 0 ? base : j < kept.length - 1 ? base + back.arrivals[j] + DWELL : cycle + ORIGIN_DWELL - PRE,
          }
        })
      : []
    return { data, path, out, back, deps, farDwell, span: cycle + ORIGIN_DWELL, originRight: !!spec.originRight, s0, s1, lineIndex: li, outStops, backStops }
  })
}

/* -------------------------------------------------------------------------- */
/* 停留所の扉・次に乗れる便（乗る仕組み character/ride/tramRide.ts が使う。時刻だけから決まる）     */
/* -------------------------------------------------------------------------- */

/** 停留所の扉: 止まって openAfter 秒で開き始め（move 秒で開く）、発車の closeBefore 秒前に閉め始める */
export const TRAM_DOOR = { openAfter: 2.0, closeBefore: 4.0, move: 1.6 } as const
export const TRAM_DWELL = DWELL

/** なめらかな 0 → 1 */
const smooth01 = (x: number) => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

/**
 * 便 i（起点の発車の番号）の、時刻 t（運転の日の秒）の扉の開き具合（0〜1）と、止まっている停留所（行きは +1、帰りは -1 の並びの番号）。
 * 止まっていなければ stop = -1
 */
export function tramDoorState(line: TramLine, i: number, t: number, out = { open: 0, stop: -1, dir: 1 }) {
  const tau = t - line.deps[i]
  out.open = 0
  out.stop = -1
  out.dir = 1
  for (const [list, dir] of [
    [line.outStops, 1],
    [line.backStops, -1],
  ] as const) {
    for (let j = 0; j < list.length; j++) {
      const s = list[j]
      if (tau < s.arrive || tau > s.depart) continue
      if (!s.name) continue
      const opening = smooth01((tau - s.arrive - TRAM_DOOR.openAfter) / TRAM_DOOR.move)
      const closing = 1 - smooth01((tau - (s.depart - TRAM_DOOR.closeBefore)) / TRAM_DOOR.move)
      out.open = Math.min(opening, closing)
      out.stop = j
      out.dir = dir
      return out
    }
  }
  return out
}

export interface TramBoarding {
  line: TramLine
  /** 便（起点の発車の番号）と向き（+1 行き・-1 帰り） */
  run: number
  dir: 1 | -1
  /** 乗る停留所・降りる停留所の並びの番号（向きの並び） */
  fromIndex: number
  toIndex: number
  /** 乗る停留所に着く・扉が開ききる・閉め始める・発車する時刻（運転の日の秒） */
  arrive: number
  open: number
  close: number
  depart: number
  /** 降りる停留所に着く・扉が開ききる時刻 */
  arriveTo: number
  openTo: number
}

/** 停留所の並び（向き）の中の、名前の番号（無ければ -1） */
export function tramStopIndex(line: TramLine, dir: 1 | -1, name: string) {
  const list = dir > 0 ? line.outStops : line.backStops
  return list.findIndex((s) => s.name === name)
}

/**
 * 系統 line で、停留所 from から to へ行く次の便（時刻 t から lead 秒より先に扉が閉め始める便）。行けない・便が無ければ null。
 * 環状の系統（1 系統）は、起点をまたぐ乗り方はしない（起点で一度降りる）
 */
export function nextTramBoarding(line: TramLine, from: string, to: string, t: number, lead = 0): TramBoarding | null {
  for (const dir of [1, -1] as const) {
    const list = dir > 0 ? line.outStops : line.backStops
    const a = tramStopIndex(line, dir, from)
    const b = list.findIndex((s, j) => j > a && s.name === to)
    if (a < 0 || b < 0) continue
    const sa = list[a]
    const sb = list[b]
    // 乗る停留所で扉が閉め始めるのが t + lead より後の、最初の便
    for (let i = 0; i < line.deps.length; i++) {
      const T = line.deps[i]
      const close = T + sa.depart - TRAM_DOOR.closeBefore
      if (close < t + lead) continue
      return {
        line,
        run: i,
        dir,
        fromIndex: a,
        toIndex: b,
        arrive: T + sa.arrive,
        open: T + sa.arrive + TRAM_DOOR.openAfter + TRAM_DOOR.move,
        close,
        depart: T + sa.depart,
        arriveTo: T + sb.arrive,
        openTo: T + sb.arrive + TRAM_DOOR.openAfter + TRAM_DOOR.move,
      }
    }
    return null
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* 停留所のホームの置き方（形は transitInfra.ts、歩ける所は world/walk/townWalk.ts、乗る所は character/ride/tramRide.ts）  */
/* -------------------------------------------------------------------------- */

/** ホーム（長さ 32m・幅 2.6m・高さ 0.3m。端に 3m のスロープ） */
export const TRAM_PLATFORM = { length: 32, width: 2.6, height: 0.3, ramp: 3 } as const

export interface TramPlatform {
  /** 停留所の名前・系統 */
  name: string
  lines: number[]
  /** 真ん中（平面座標と、線路の標高） */
  x: number
  y: number
  z: number
  /** 線に沿う向き（平面の単位ベクトル） */
  dx: number
  dy: number
  /** ホームが線路のどちら側か（+1 = 線の左） */
  side: number
}

/** 停留所のホームの置き方（データの停留所の点を、いちばん近い系統の線へ投げる） */
export function placeTramPlatforms(trams: TramLine[], tramStops: TransitTramStop[]) {
  const out: { name: string; lines: number[]; platforms: TramPlatform[] }[] = []
  const _a = pathPoint()
  const at = (path: Path, d: number, off: number) => {
    path.at(d, _a)
    return { x: _a.x - _a.dy * off, y: _a.y + _a.dx * off, z: _a.z, dx: _a.dx, dy: _a.dy }
  }
  for (const s of tramStops) {
    const line = trams.find((l) => l.data.no === s.lines[0])
    if (!line) continue
    const pr = line.path.project(s.x, s.y)
    if (pr.dist > 25) continue
    // 停留所の位置 = 車両が止まる所（中心）。端の停留所は端から車両の半分
    const d = Math.min(Math.max(pr.d, line.s0), line.data.loop ? line.path.length : line.s1)
    const platforms: TramPlatform[] = []
    const offOut = trackOffset(line, d, 1)
    const offBack = trackOffset(line, d, -1)
    const both = Math.abs(offOut - offBack) > 2.5
    for (const dir of both ? [1, -1] : [1]) {
      const off = dir > 0 ? offOut : offBack
      const side = both ? dir : 1
      const p = at(line.path, d, off + side * (1.2 + 0.15 + 1.3))
      platforms.push({ name: s.name, lines: s.lines, ...p, side })
    }
    // 起点の停留所: 止まる位置をずらした系統（originShift）は、その位置にもホーム
    for (const no of s.lines) {
      const l = trams.find((x) => x.data.no === no)
      if (!l || l.data.loop || l.data.stops[0]?.name !== s.name) continue
      if (l === line && Math.abs(l.s0 - d) < 10) continue
      const side = l.originRight ? -1 : 1
      const p = at(l.path, l.s0, trackOffset(l, l.s0, 1) + side * (1.2 + 0.15 + 1.3))
      if (platforms.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 12)) continue
      platforms.push({ name: s.name, lines: s.lines, ...p, side })
    }
    out.push({ name: s.name, lines: s.lines, platforms })
  }
  return out
}

/** ホームの歩ける面（上は線路の標高 + 0.3m、両端の 3m のスロープで線路の高さへ） */
export function tramPlatformSurfaces(list: TramPlatform[]): ExtraSurface[] {
  const P = TRAM_PLATFORM
  return list.map((pf) => ({
    x: pf.x,
    y: pf.y,
    ux: pf.dx,
    uy: pf.dy,
    halfL: P.length / 2 + P.ramp,
    halfW: P.width / 2,
    z: (a: number) => pf.z + P.height * Math.min(1, Math.max(0, (P.length / 2 + P.ramp - Math.abs(a)) / P.ramp)),
  }))
}

/** 町のデータを読んだあとの緑電（乗る仕組み・カメラ・音が使う。無ければ空） */
export const tramNet = {
  lines: [] as TramLine[],
  stops: [] as { name: string; lines: number[]; platforms: TramPlatform[] }[],
  fleet: null as TramFleet | null,
}

/** 系統の番号の運転 */
export const tramLine = (no: number) => tramNet.lines.find((l) => l.data.no === no) ?? null

/**
 * 便 run が向き dir で停留所の並びの番号 index に止まるとき、車両の中心（平面座標と線路の標高）と、その所のホーム（車両の左（局所の +x）か右か）。
 * ホームが無ければ null
 */
export function tramStopPose(line: TramLine, dir: 1 | -1, index: number) {
  const list = dir > 0 ? line.outStops : line.backStops
  const s = list[index]
  if (!s) return null
  const p = pathPoint()
  line.path.at(s.d, p)
  const off = trackOffset(line, s.d, dir)
  const cx = p.x - p.dy * off
  const cy = p.y + p.dx * off
  // 車両の前（進む向き）と左（局所の +x = 前を向いて左）
  const fx = p.dx * dir
  const fy = p.dy * dir
  const lx = -fy
  const ly = fx
  const stop = tramNet.stops.find((q) => q.name === s.name)
  let best: TramPlatform | null = null
  let bestD = 8
  for (const pf of stop?.platforms ?? []) {
    const dd = Math.hypot(pf.x - cx, pf.y - cy)
    if (dd < bestD) {
      bestD = dd
      best = pf
    }
  }
  if (!best) return null
  const side = (best.x - cx) * lx + (best.y - cy) * ly > 0 ? 1 : -1
  return { x: cx, y: cy, z: p.z, fx, fy, platform: best, side: side as 1 | -1 }
}

const _p = pathPoint()
const _q = pathPoint()
const _r = new THREE.Matrix4().makeRotationY(Math.PI)
const _runs: number[] = []
const _cam = new THREE.Vector3()
const _info: [number, number, number, number] = [0, 0, 0, 0]

const _occ: number[] = []

/**
 * 系統 line の線の上の長さ d・線からの横のずらし lat（線の向きの左が +）の所に、時刻 t（運転の日の秒）に編成がいるか（前後と横に pad m の余白。
 * 花音のホバーが緑電の線路の上を横切るときに、編成と重ならない時刻か確かめる。character/ride/hoverRide.ts）
 */
export function tramOccupies(line: TramLine, t: number, d: number, lat: number, pad: number) {
  activeRuns(line.deps, t, PRE, line.span - PRE, _occ)
  const half = (3 * TRAM_SECTION + 2 * TRAM_GAP) / 2
  for (const i of _occ) {
    const st = tramRunState(line, t, i)
    if (Math.abs(st.d - d) > half + pad) continue
    if (Math.abs(lat - trackOffset(line, st.d, st.dir)) < 1.2 + pad) return true
  }
  return false
}

/** 車両の位置（線の上の中心の長さと向き・速さ m/s） */
export function tramRunState(line: TramLine, t: number, i: number) {
  const T = line.deps[i]
  const tau = t - T
  const { out, back } = line
  if (tau < 0) return { d: line.s0, dir: 1, moving: false, speed: 0 }
  if (tau < out.duration) {
    const v = out.speed(tau)
    return { d: out.at(tau), dir: 1, moving: v > 0.1, speed: v }
  }
  if (!back) {
    // 環状: 一周して起点（= 線の長さ + s0）で止まって見えている
    return { d: out.at(out.duration), dir: 1, moving: false, speed: 0 }
  }
  const t2 = tau - out.duration
  if (t2 < line.farDwell) return { d: line.s1, dir: -1, moving: false, speed: 0 }
  const t3 = t2 - line.farDwell
  const d = line.s0 + line.s1 - back.at(t3)
  const v = t3 < back.duration ? back.speed(t3) : 0
  return { d, dir: -1, moving: v > 0.1, speed: v }
}

/**
 * 1 両（前の台車と後ろの台車を結ぶ向き）の行列。dc = 編成の中心からの長さ（進む向き +）、half = 台車の中心からの長さ。
 * 行列は車両の局所（+z = 進む向き・+x = 前を向いて左・y = 上（レール面 = 0））→ シーン
 */
function sectionMatrix(line: TramLine, d: number, dir: number, dc: number, half: number, out: THREE.Matrix4) {
  const a = d + dir * (dc + half)
  const b = d + dir * (dc - half)
  line.path.at(a, _p)
  const oa = trackOffset(line, a, dir)
  const ax = _p.x - _p.dy * oa
  const ay = _p.y + _p.dx * oa
  const az = _p.z
  line.path.at(b, _q)
  const ob = trackOffset(line, b, dir)
  const bx = _q.x - _q.dy * ob
  const by = _q.y + _q.dx * ob
  const bz = _q.z
  const dx = ax - bx
  const dy = ay - by
  const l = Math.hypot(dx, dy) || 1
  return placeMatrix(out, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, dx / l, dy / l, (az - bz) / l)
}

/** 走っている 1 編成の今のコマ（位置・3 両と幌の行列・扉） */
export interface TramRun {
  line: TramLine
  /** 便（起点の発車の番号） */
  run: number
  d: number
  dir: number
  speed: number
  /** 3 両（0 = 前・1 = 中・2 = 後ろ。後ろの両は形を 180° 回して置く）と幌 2 つの行列 */
  sections: THREE.Matrix4[]
  gangs: THREE.Matrix4[]
  /** 中の両の中心（シーン）とカメラからの距離 */
  center: THREE.Vector3
  dist: number
  /** 扉の開き具合（0〜1）と、開く側（編成の前を向いて左 = +1）。止まっていなければ open = 0 */
  door: number
  doorSide: number
  /** 止まっている停留所（向きの並びの番号。無ければ -1）と向き */
  stop: number
  stopDir: number
}

const SEC = TRAM_SECTION
const OFFS = [SEC + TRAM_GAP, 0, -(SEC + TRAM_GAP)]
const GANGS = [(SEC + TRAM_GAP) / 2, -(SEC + TRAM_GAP) / 2]
/** 細かい形で描く距離（カメラから m）・数（乗っている編成のほかに） */
const DETAIL_DISTANCE = 70
const DETAIL_MAX = 2

/** 緑電の車両を毎コマ並べる */
export class TramFleet {
  readonly cab: Fleet
  readonly mid: Fleet
  readonly gang: Fleet
  readonly detail: TramDetail | null
  /** 走っている編成の位置（花音・カメラのそばの判定や、架線の灯りに使う） */
  readonly positions: { x: number; y: number; z: number }[] = []
  /** 今のコマに走っている（見えている）編成（updateState が書く） */
  readonly runs: TramRun[] = []
  private pool: TramRun[] = []
  /** 花音が乗っている編成（細かい形でいつも描き、中の灯りを点ける）。無ければ null */
  ridden: { line: number; run: number } | null = null

  readonly lines: TramLine[]
  private sideCache = new Map<string, number>()

  constructor(lines: TramLine[], shapes: VehicleShapes, material: THREE.Material, detail: TramDetail | null = null) {
    this.lines = lines
    this.detail = detail
    const cap = lines.reduce((s, l) => s + Math.ceil(l.span / (LINE_SPEC[l.data.no]?.headway ?? 420)) + 2, 0)
    this.cab = new Fleet('tramCab', shapes.tramCab, shapes.tramFarCab, material, cap * 2)
    this.mid = new Fleet('tramMid', shapes.tramMid, shapes.tramFarMid, material, cap)
    this.gang = new Fleet('tramGang', shapes.tramGangway, null, material, cap * 2, 450)
  }

  get meshes() {
    return [...this.cab.meshes, ...this.mid.meshes, ...this.gang.meshes, ...(this.detail?.meshes ?? [])]
  }

  /** 止まっている停留所の扉の側（編成の前を向いて左 = +1）。ホームが見つからなければ +1 */
  private doorSideAt(line: TramLine, dir: number, stop: number) {
    const key = `${line.data.no}:${dir}:${stop}`
    let v = this.sideCache.get(key)
    if (v === undefined) {
      v = tramStopPose(line, dir as 1 | -1, stop)?.side ?? 1
      // ホームを置く前（町のデータを読む途中）は覚えない
      if (tramNet.stops.length) this.sideCache.set(key, v)
    }
    return v
  }

  /** 交通の時計 t（運転の日の秒）の、走っている編成の位置・行列・扉（描かないコマも。乗る仕組み・カメラ・音が読む） */
  updateState(t: number, cam: THREE.Vector3 | null) {
    let n = 0
    for (const line of this.lines) {
      activeRuns(line.deps, t, PRE, line.span - PRE, _runs)
      for (const i of _runs) {
        let r = this.pool[n]
        if (!r) {
          r = { line, run: i, d: 0, dir: 1, speed: 0, sections: [0, 1, 2].map(() => new THREE.Matrix4()), gangs: [0, 1].map(() => new THREE.Matrix4()), center: new THREE.Vector3(), dist: 0, door: 0, doorSide: 1, stop: -1, stopDir: 1 }
          this.pool[n] = r
        }
        n++
        const st = tramRunState(line, t, i)
        r.line = line
        r.run = i
        r.d = st.d
        r.dir = st.dir
        r.speed = st.speed
        for (let k = 0; k < 3; k++) {
          sectionMatrix(line, st.d, st.dir, OFFS[k], SEC / 2 - 0.6, r.sections[k])
          // 後ろの両は後ろ向き（尾灯）
          if (k === 2) r.sections[k].multiply(_r)
        }
        for (let k = 0; k < 2; k++) sectionMatrix(line, st.d, st.dir, GANGS[k], TRAM_GAP, r.gangs[k])
        r.center.setFromMatrixPosition(r.sections[1])
        r.dist = cam ? r.center.distanceTo(cam) : Infinity
        const ds = tramDoorState(line, i, t, _door)
        r.door = ds.open
        r.stop = ds.stop
        r.stopDir = ds.dir
        r.doorSide = ds.stop >= 0 ? this.doorSideAt(line, ds.dir, ds.stop) : 1
      }
    }
    this.runs.length = n
    for (let k = 0; k < n; k++) this.runs[k] = this.pool[k]
  }

  /** 編成（系統の番号・便）の今のコマ（見えていなければ null） */
  find(lineNo: number, run: number) {
    for (const r of this.runs) if (r.line.data.no === lineNo && r.run === run) return r
    return null
  }

  update(t: number, camera: THREE.Camera, lit: number, dark = 0) {
    camera.getWorldPosition(_cam)
    this.updateState(t, _cam)
    for (const f of [this.cab, this.mid, this.gang]) f.begin()
    this.detail?.begin()
    this.positions.length = 0
    // 細かい形: 乗っている編成と、カメラから近い編成（DETAIL_MAX まで）
    const near = this.runs.filter((r) => r.dist < DETAIL_DISTANCE).sort((a, b) => a.dist - b.dist)
    const isRidden = (r: TramRun) => !!this.ridden && r.line.data.no === this.ridden.line && r.run === this.ridden.run
    const detailed = new Set<TramRun>()
    let rideRun: TramRun | null = null
    for (const r of this.runs)
      if (isRidden(r)) {
        detailed.add(r)
        rideRun = r
      }
    for (const r of near) if (detailed.size < DETAIL_MAX + (this.ridden ? 1 : 0)) detailed.add(r)
    for (const r of this.runs) {
      const seed = ((r.run * 0.618 + r.line.lineIndex * 0.31) % 1 + 1) % 1
      this.positions.push({ x: r.center.x, y: r.center.y, z: r.center.z })
      // 花音が乗っている編成と車体が重なる編成（同じ通りを走る別の系統の線路が少しずれている所）は描かない（車室の中を通り抜けて見えるので。§7 の 206）
      if (rideRun && r !== rideRun && runsOverlap(r, rideRun)) continue
      if (this.detail && detailed.has(r)) {
        _dinfo[0] = isRidden(r) ? Math.max(lit, dark) : lit
        _dinfo[1] = r.door
        _dinfo[2] = r.doorSide
        _dinfo[3] = r.line.data.no + seed * 0.5
        if (this.detail.add(r.sections, r.gangs, _dinfo)) continue
      }
      for (let k = 0; k < 3; k++) {
        const m = r.sections[k]
        const dist = Math.hypot(m.elements[12] - _cam.x, m.elements[13] - _cam.y, m.elements[14] - _cam.z)
        _info[1] = lit
        _info[2] = r.line.data.no
        _info[3] = seed
        if (k === 1) {
          _info[0] = 0
          this.mid.add(m, _info, dist)
        } else {
          // 前の車両は前照灯、後ろの車両は後ろ向き（尾灯）
          _info[0] = k === 0 ? 1 : -1
          this.cab.add(m, _info, dist)
        }
      }
      for (const m of r.gangs) {
        const dist = Math.hypot(m.elements[12] - _cam.x, m.elements[13] - _cam.y, m.elements[14] - _cam.z)
        if (dist < 450) {
          _info[0] = 0
          this.gang.add(m, _info, dist)
        }
      }
    }
    for (const f of [this.cab, this.mid, this.gang]) f.end()
    this.detail?.end()
  }
}

/** 2 つの編成の車体（3 両。上から見た箱 2.44m × 9.7m）が重なるか */
function runsOverlap(a: TramRun, b: TramRun) {
  if (Math.abs(a.center.x - b.center.x) > 32 || Math.abs(a.center.z - b.center.z) > 32) return false
  for (const ma of a.sections) for (const mb of b.sections) if (boxesOverlap(ma.elements, mb.elements, 1.22, 4.85)) return true
  return false
}

/** 上から見た 2 つの箱（行列の位置・局所の z の向き。半幅 hw・半長 hl）が重なるか（分離軸） */
function boxesOverlap(ea: ArrayLike<number>, eb: ArrayLike<number>, hw: number, hl: number) {
  const dx = eb[12] - ea[12]
  const dz = eb[14] - ea[14]
  if (dx * dx + dz * dz > (2 * hl + 1) ** 2) return false
  const fa = Math.hypot(ea[8], ea[10]) || 1
  const fb = Math.hypot(eb[8], eb[10]) || 1
  const az = [ea[8] / fa, ea[10] / fa]
  const bz = [eb[8] / fb, eb[10] / fb]
  const axes = [az, [-az[1], az[0]], bz, [-bz[1], bz[0]]]
  for (const [x, z] of axes) {
    const ra = hl * Math.abs(az[0] * x + az[1] * z) + hw * Math.abs(-az[1] * x + az[0] * z)
    const rb = hl * Math.abs(bz[0] * x + bz[1] * z) + hw * Math.abs(-bz[1] * x + bz[0] * z)
    if (Math.abs(dx * x + dz * z) > ra + rb) return false
  }
  return true
}

const _door = { open: 0, stop: -1, dir: 1 }
const _dinfo: [number, number, number, number] = [0, 0, 0, 0]
