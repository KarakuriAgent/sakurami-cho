import * as THREE from 'three'
import { SITE } from '../../core/town'
import type { SeatSpec } from '../avatar/body'
import { BOAT_DOOR, boatNet, type BoatRoute } from '../../world/outdoor/transit/boats'
import { transitClock } from '../../world/outdoor/transit/clock'
import { LANDING, landingById, landingPoint, topA, type BoatLanding } from '../../world/outdoor/transit/landings'
import { WATERBUS, waterbusRows, waterbusSeatSpot } from '../../world/outdoor/transit/waterbusCar'
import { townData } from '../../world/outdoor/town/townData'
import { townSolids } from '../../world/walk/townSolids'
import { townWalk } from '../../world/walk/townWalk'
import type { Character } from '../avatar/character'
import { boatVehicle } from '../../world/outdoor/transit/boatVehicle'
import type { Car } from '../../world/outdoor/transit/vehicle'
import { LineRide, lineMemberSlots, type LineAdapter, type LineLayout, type LineRideSpec, type LineRun } from './lineRide'
import type { PlatformView } from './platformViews'
import { defineMemberSlots } from './party'

/**
 * 運河バスに乗る（kanon.travel の運河バスの区間。docs/design/town.md §20）。乗り場の石段を下りて下の段で待ち、舟が横付けして扉が開いたら
 * 乗り込み（甲板の敷居をまたいで一段下りる）、前の列の窓ぎわに座る（pose=stand なら操舵の台の横で前の窓の前に立つ）。降りる乗り場で
 * 横付けして扉が開いたら立って下の段へ降り、石段を上る。乗り場で 40 秒止まる間に乗り降りが終わる。波の揺れは舟の行列に入っているので、
 * 花音・KB-001・車室と一緒に動くカメラも揺れと一緒に動く。KB-001 は一緒に乗り、となりの席の上に浮かぶ。
 */

const C = WATERBUS
const SEAT: SeatSpec = { height: C.seatH, shift: -(0.28 + C.seatD / 2), hands: 'lap' }

export interface BoatPlan {
  routeId: string
  route: BoatRoute
  dir: 1 | -1
  from: string
  to: string
  fromIndex: number
  toIndex: number
  landing: BoatLanding
  exitLanding: BoatLanding
  /** 乗る・降りる乗り場の扉の側（舟の局所の x の向き） */
  side: 1 | -1
  outSide: 1 | -1
}

/* -------------------------------------------------------------------------- */
/* 便と乗り場                                                                     */
/* -------------------------------------------------------------------------- */

const stopIndex = (r: BoatRoute, dir: 1 | -1, id: string) => (dir > 0 ? r.outStops : r.backStops).findIndex((s) => s.id === id)

/** 航路 r で乗り場 from から to へ行く、時刻 t から lead 秒より先に扉が閉め始める便。無ければ null */
export function nextBoatBoarding(r: BoatRoute, from: string, to: string, t: number, lead: number) {
  for (const dir of [1, -1] as const) {
    const list = dir > 0 ? r.outStops : r.backStops
    const a = stopIndex(r, dir, from)
    const b = list.findIndex((s, j) => j > a && s.id === to)
    if (a < 0 || b < 0) continue
    const sa = list[a]
    const sb = list[b]
    for (let i = 0; i < r.deps.length; i++) {
      const T = r.deps[i]
      const close = T + sa.depart - BOAT_DOOR.closeBefore
      if (close < t + lead) continue
      return {
        dir,
        fromIndex: a,
        toIndex: b,
        run: { run: i, arrive: T + sa.arrive, open: T + sa.arrive + BOAT_DOOR.openAfter + BOAT_DOOR.move, close, depart: T + sa.depart, arriveTo: T + sb.arrive, openTo: T + sb.arrive + BOAT_DOOR.openAfter + BOAT_DOOR.move } satisfies LineRun,
      }
    }
    return null
  }
  return null
}

/** 乗り場 l に向き dir で着く舟の扉の側（局所の x） */
function sideAt(r: BoatRoute, dir: 1 | -1, index: number, l: BoatLanding): 1 | -1 {
  const list = dir > 0 ? r.outStops : r.backStops
  const st = list[index]
  const p = { x: 0, y: 0, z: 0, dx: 1, dy: 0, grade: 0 }
  r.path.at(st.d, p)
  const f = p.dx * dir * l.ux + p.dy * dir * l.uy >= 0 ? 1 : -1
  return (boatNet.fleet?.berth(l, f).side ?? 1) as 1 | -1
}

const adapter: LineAdapter<BoatPlan> = {
  vehicle: boatVehicle,
  label: '運河バス',
  line: (plan) => plan.routeId,
  pose(car, out) {
    const r = typeof car.line === 'string' ? boatNet.fleet?.find(car.line, car.run) : null
    if (!r) return false
    out.copy(r.matrix)
    return true
  },
  doorOpen(run, at, plan) {
    const r = boatNet.fleet?.find(plan.routeId, run)
    if (!r || r.stopDir !== plan.dir) return 0
    return r.stop === (at === 'from' ? plan.fromIndex : plan.toIndex) ? r.door : 0
  },
  next(plan, t, lead) {
    const b = nextBoatBoarding(plan.route, plan.from, plan.to, t, lead)
    return b && b.dir === plan.dir ? b.run : null
  },
  layout(plan, pose) {
    const side = plan.side
    const rows = waterbusRows()
    const front = rows[rows.length - 1]
    const sp = waterbusSeatSpot(front)
    const sit = pose === 'sit'
    return {
      side,
      doorZ: C.doorZ,
      outSide: plan.outSide,
      outDoorZ: C.doorZ,
      outX: C.beam / 2 + LANDING.gap + 0.4,
      inX: C.iw - 0.42,
      aisleX: side * 0.75,
      spot: sit ? new THREE.Vector3(side * sp.x, 0, sp.standZ) : new THREE.Vector3(0.62, 0, C.z1 - 0.62),
      face: new THREE.Vector3(0, 0, 1),
      seat: sit ? SEAT : null,
      standAction: 'gaze',
      // 一緒に乗る仲間（KB-001）: 座る花音の窓の側の少し前（頭より上。隣の席の上だと、通路から撮る横顔の画で花音の前に入るため）
      member: sit ? new THREE.Vector3(side * (sp.x - 0.1), C.floor + 1.5, sp.cz + 0.55) : new THREE.Vector3(0.05, C.floor + 1.5, C.z1 - 1.3),
      floor: C.floor,
    } satisfies LineLayout
  },
  setRidden(plan, run) {
    const f = boatNet.fleet
    if (f) f.ridden = run === null ? null : { route: plan.routeId, run }
  },
}

/** 一緒に乗る仲間の道（緑電・運河バスで共通。lineRide.ts の lineMemberSlots） */
defineMemberSlots('waterbus', lineMemberSlots((leader) => leader.rides.boat))

/** 運河バスに乗る仕組み（乗る人ごとに 1 つ。ch.rides.boat。character/ride/rides.ts が作る） */
export function createBoatRide(ch: Character) {
  return new LineRide<BoatPlan>(adapter, ch)
}

/** 下の段の待つ所（平面座標）と向く向き（水の方。シーンの heading） */
function waitAt(l: BoatLanding) {
  const [x, y] = landingPoint(l, l.aS + l.sgn * 0.55, l.stageW - 0.5)
  return { spot: [x, -y] as [number, number], heading: Math.atan2(l.wx, -l.wy) }
}

/**
 * 航路 routeId で乗り場 from から to へ行く便と、下の段の待つ所を決める（lead = 待つ所に着くまでの秒の見込み）。だめなら理由
 */
export function planBoatBoarding(routeId: string, from: string, to: string, lead: number) {
  const fleet = boatNet.fleet
  const r = fleet?.route(routeId)
  if (!fleet || !r) return '運河バスの航路のデータがまだありません（町のデータを読み込み中）'
  const l0 = landingById(from)
  const l1 = landingById(to)
  if (!l0 || !l1) return `運河バスの乗り場（${from}・${to}）の石段が見つかりません`
  const t = transitClock.serviceSec
  const b = nextBoatBoarding(r, from, to, t, lead + 8)
  if (!b) return `運河バス ${routeId} 航路の${l0.name}から${l1.name}へ行く便がもうありません（運転は ${routeId === 'A' ? '7:00〜21:00' : routeId === 'B' ? '7:00〜20:00' : '7:30〜19:30'} の発車）`
  const plan: BoatPlan = { routeId, route: r, dir: b.dir, from, to, fromIndex: b.fromIndex, toIndex: b.toIndex, landing: l0, exitLanding: l1, side: sideAt(r, b.dir, b.fromIndex, l0), outSide: sideAt(r, b.dir, b.toIndex, l1) }
  // 待つ所と向く向き（乗る仕組みには beginBoatRide で渡す）
  const w = waitAt(l0)
  return { plan, run: b.run, spot: w.spot, heading: w.heading, landing: l0 }
}

/** 乗るのを始める（花音は下の段の待つ所に着いている。heading = 待つ所で向く向き） */
export function beginBoatRide(ch: Character, spec: LineRideSpec, plan: BoatPlan, run: LineRun, heading: number) {
  const ride = ch.rides.boat
  ride.waitHeading = heading
  ride.begin(spec, plan, run)
}

/** locomotion から毎コマ（Character の drivers.motion。src/kanon/index.ts が付ける） */
export function driveBoat(ch: Character, _t: number, dt: number) {
  return ch.rides.boat.drive(dt)
}

/** 毎コマ（riders.ts の updateRiders。乗る人ごとの更新の前に 1 回）: 誰かが運河バスに乗っている（待つ・乗る）間は、舟の位置と扉を、乗る人を動かす前にこのコマの交通の時計で決める */
export function updateBoatFleet(riders: readonly Character[]) {
  for (let i = 0; i < riders.length; i++) {
    if (riders[i].rides.boat.active()) {
      boatNet.fleet?.updateState(transitClock.serviceSec, transitClock.sec, null)
      return
    }
  }
}

/** 毎コマ（updateRiders。updateBoatFleet のあと、乗る人ごとに） */
export function updateBoatRide(ch: Character, dt: number) {
  ch.rides.boat.update(Math.min(dt, 0.1))
}

/** 降りる乗り場 */
export function boatExitLanding(plan: BoatPlan) {
  return plan.exitLanding
}

/** 乗り場の石段の上の陸の側の点（町の平面座標。町の道を歩いて来る・出て行く所）。港の桟橋は、桟橋の付け根からつなぐ町の道の点（pierRoot） */
export function landingTown(l: BoatLanding): [number, number] {
  return (l.kind === 'pier' ? pierRoot(l)?.road : null) ?? landingPoint(l, topA(l), -LANDING.apron - 0.6)
}

const pierRoots = new Map<string, { root: [number, number]; via: [number, number][]; road: [number, number] } | null>()

/**
 * 港の桟橋の乗り場の、桟橋の付け根の点（root）と、そこから町の道の点（road）までの道（via。どれも町の平面座標）。桟橋の上は町の道のグラフに無いので、
 * 前は乗船の段の上から町の道へまっすぐつないで、桟橋の外の水の上と岸壁の斜面を歩いていた（§7 の 217）。乗船の段の上から桟橋の上（岸の線から 2m 内）を
 * 桟橋に沿って両方へたどり（水・建物に当たるまで）、そこから水の上も建物の中も通らずに町の道へつなげる所（まっすぐか、間に 1 点を置いて。30m まで）の
 * 歩く長さのいちばん短いもの。見つからなければ null（前のとおり）
 */
function pierRoot(l: BoatLanding): { root: [number, number]; via: [number, number][]; road: [number, number] } | null {
  if (pierRoots.has(l.id)) return pierRoots.get(l.id)!
  const nav = townWalk.nav
  if (!nav || !townData.allTilesLoaded()) return null
  const deckY = l.top - SITE.labFloorElevation + 1.0
  const clear = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5))
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n
      const y = ay + ((by - ay) * i) / n
      if (townData.waterAt(x, y) !== 0) return false
      const b = townSolids.blocker(x, deckY, -y, 0.3)
      if (b && b !== '桟橋') return false
    }
    return true
  }
  const ta = topA(l)
  let best: { len: number; root: [number, number]; via: [number, number][]; road: [number, number] } | null = null
  for (const sgn of [1, -1]) {
    for (let k = 0; k <= 200; k++) {
      const p = landingPoint(l, ta + sgn * k, -2)
      // 水・建物に当たったら、その向きはやめる（桟橋の先の岸壁の上の建物を通り抜けない）
      if (!clear(p[0], p[1], p[0], p[1])) break
      if (best && k >= best.len) break
      // まっすぐ町の道へ
      const sp = nav.snap(p[0], p[1], 12)
      if (sp && clear(p[0], p[1], sp.x, sp.y)) {
        const len = k + sp.dist
        if (!best || len < best.len) best = { len, root: p, via: [], road: [sp.x, sp.y] }
      }
      // 間に 1 点を置いて（建物の角を回る）。4m の升目で 30m まで
      for (let dx = -28; dx <= 28; dx += 4)
        for (let dy = -28; dy <= 28; dy += 4) {
          const d1 = Math.hypot(dx, dy)
          if (d1 > 30 || d1 < 3 || (best && k + d1 >= best.len)) continue
          const c: [number, number] = [p[0] + dx, p[1] + dy]
          const sq = nav.snap(c[0], c[1], 6)
          if (!sq || (best && k + d1 + sq.dist >= best.len) || !clear(p[0], p[1], c[0], c[1]) || !clear(c[0], c[1], sq.x, sq.y)) continue
          best = { len: k + d1 + sq.dist, root: p, via: [c], road: [sq.x, sq.y] }
        }
    }
  }
  const out = best ? { root: best.root, via: best.via, road: best.road } : null
  pierRoots.set(l.id, out)
  return out
}

/**
 * 乗り場の道（シーンの x, z の点の列）: from（町の点）→ 陸の側の敷石 → 上の踊り場 → 石段を下りる → to（下の段の上の点）。
 * reverse = 下の段の from から石段を上って、to（町の点）へ
 */
export function landingPath(l: BoatLanding, from: [number, number], to: [number, number], reverse = false): [number, number][] {
  const P = (a: number, b: number): [number, number] => {
    const [x, y] = landingPoint(l, a, b)
    return [x, -y]
  }
  const ta = topA(l)
  const apron = P(ta, -LANDING.apron + 0.5)
  const top = P(ta, LANDING.width / 2)
  const foot = P(l.aS + l.sgn * (LANDING.stage / 2 - 0.25), LANDING.width / 2 + 0.1)
  // 港の桟橋: 桟橋の付け根を通る（町の道から桟橋の上を歩いて来る・出て行く）
  const pr = l.kind === 'pier' ? pierRoot(l) : null
  const via: [number, number][] = pr ? [pr.root, ...pr.via, pr.road].map((q) => [q[0], -q[1]] as [number, number]) : []
  return reverse ? [from, foot, top, apron, ...via, to] : [from, ...[...via].reverse(), apron, top, foot, to]
}

/* -------------------------------------------------------------------------- */
/* 自動カメラ（配信。乗っている間の画）                                                 */
/* -------------------------------------------------------------------------- */

/** 乗り場で待つ間・乗り降りの途中の自動カメラの画の候補（src/camera/rideViews.ts。乗り降りの画は便 car の車室の局所で決まる） */
export function boatPlatformViews(ch: Character, _car: Car, out: PlatformView[]) {
  ch.rides.boat.platformViews(out)
}

/**
 * 乗っている間の自動カメラの画 i（便 car の舟と一緒に動く。src/camera/rideViews.ts）: 0 = 通路から花音の正面の斜め、1 = 通路から横顔と窓の外の水面、
 * 2 = 外（水の上）から追う
 */
export function boatAutoView(ch: Character, car: Car, i: number, pos: THREE.Vector3, target: THREE.Vector3): number | null {
  const L = ch.rides.boat.lay
  if (car.vehicle !== boatVehicle || !L || !ch.ride.inside) return null
  const F = C.floor
  const sp = L.spot
  const sitting = !!L.seat
  const s = L.side
  const eye = F + (sitting ? 1.1 : 1.52)
  const k = ((i % 3) + 3) % 3
  if (k === 0) {
    if (sitting) {
      car.toWorld(-s * 0.15, F + 1.42, sp.z + 1.05, pos)
      car.toWorld(sp.x, eye - 0.06, sp.z, target)
    } else {
      car.toWorld(-0.6, F + 1.55, sp.z - 1.4, pos)
      car.toWorld(sp.x, eye - 0.1, sp.z, target)
    }
    return 58
  }
  if (k === 1) {
    car.toWorld(-s * 0.3, F + 1.3, sp.z + 0.15, pos)
    car.toWorld(sp.x, eye - 0.04, sp.z - 0.05, target)
    return 52
  }
  // 外（水の上）から: 花音の側の斜め前 5m・水面から 1.6m。その側が岸・桟橋（横付けしている所など）なら反対の側から
  for (const side of [s, -s]) {
    car.toWorld(side * 4.6, 1.6, sp.z + 4.0, pos)
    car.toWorld(side * 0.9, F + 1.15, sp.z, target)
    // 下が水か（町の水の地図。平面の y = −シーンの z）
    if (townData.waterAt(pos.x, -pos.z) === 0) continue
    if (townWalk.ready) pos.y = Math.max(pos.y, townWalk.groundY(pos.x, pos.z, pos.y) + 1.2)
    if (townSolids.blocker(pos.x, pos.y, pos.z, 0.5) || !townSolids.sight(pos, target, 0.8)) continue
    return 46
  }
  return boatAutoView(ch, car, 0, pos, target)
}

/** ?debug: コンソールから（window.__boat。src/kanon/index.ts が花音で作る） */
export function boatRideDebug(ch: Character) {
  return { ride: ch.rides.boat, planBoatBoarding, boatNet }
}
