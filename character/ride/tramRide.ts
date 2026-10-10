import * as THREE from 'three'
import type { SeatSpec } from '../avatar/body'
import { transitClock } from '../../world/outdoor/transit/clock'
import { TRAM_CAR, tramSeatSpot, tramSeats } from '../../world/outdoor/transit/tramCar'
import { nextTramBoarding, tramLine, tramNet, tramStopIndex, tramStopPose, TRAM_PLATFORM, type TramBoarding, type TramLine, type TramPlatform } from '../../world/outdoor/transit/trams'
import { townSolids } from '../../world/walk/townSolids'
import { townWalk } from '../../world/walk/townWalk'
import type { Character } from '../avatar/character'
import { tramVehicle } from '../../world/outdoor/transit/tramVehicle'
import type { Car } from '../../world/outdoor/transit/vehicle'
import { LineRide, lineMemberSlots, type LineAdapter, type LineLayout, type LineRideSpec, type LineRun } from './lineRide'
import type { PlatformView } from './platformViews'
import { defineMemberSlots } from './party'

/**
 * 緑電に乗る（kanon.travel の緑電の区間。ルート F の 4 系統 まるの森東 → ひらき通り など。docs/design/town.md §20）。
 * 車室の局所 = 編成の真ん中の両（扉は真ん中に 1 か所。両の局所の +z = 進む向き）。停留所のホームの、扉が来る所で待ち、
 * 止まって扉が開いたら乗り込み、窓ぎわの前向きの席に座る（pose=stand なら反対側の扉の窓の前に立つ）。降りる停留所で止まって扉が開いたら立って降りる。
 * KB-001 は一緒に乗り、花音の窓の側の少し前に浮かぶ（§7 の 195）。
 */

const T = TRAM_CAR
const SEAT: SeatSpec = { height: T.seatH, shift: -(0.28 + T.seatD / 2), hands: 'lap' }

export interface TramPlan {
  lineNo: number
  line: TramLine
  dir: 1 | -1
  from: string
  to: string
  fromIndex: number
  toIndex: number
  /** 乗る停留所・降りる停留所の扉の側（局所の x の向き） */
  side: 1 | -1
  outSide: 1 | -1
  /** 乗る停留所のホーム */
  platform: TramPlatform
}

/* -------------------------------------------------------------------------- */
/* 便と停留所                                                                     */
/* -------------------------------------------------------------------------- */

const toRun = (b: TramBoarding): LineRun => ({ run: b.run, open: b.open, close: b.close, depart: b.depart, arriveTo: b.arriveTo, openTo: b.openTo, arrive: b.arrive })

const adapter: LineAdapter<TramPlan> = {
  vehicle: tramVehicle,
  label: '緑電',
  line: (plan) => plan.lineNo,
  pose(car, out) {
    const r = typeof car.line === 'number' ? tramNet.fleet?.find(car.line, car.run) : null
    if (!r) return false
    out.copy(r.sections[1])
    return true
  },
  doorOpen(run, at, plan) {
    const r = tramNet.fleet?.find(plan.lineNo, run)
    if (!r || r.stopDir !== plan.dir) return 0
    return r.stop === (at === 'from' ? plan.fromIndex : plan.toIndex) ? r.door : 0
  },
  next(plan, t, lead) {
    const b = nextTramBoarding(plan.line, plan.from, plan.to, t, lead)
    return b && b.dir === plan.dir ? toRun(b) : null
  },
  layout(plan, pose) {
    const side = plan.side
    const seats = tramSeats(false).filter((s) => s.face === 1)
    // 扉にいちばん近い前向きの席（扉の側の窓ぎわ）
    let best = seats[0]
    for (const s of seats) if (Math.abs(tramSeatSpot(s).standZ) < Math.abs(tramSeatSpot(best).standZ)) best = s
    const sp = tramSeatSpot(best)
    const sit = pose === 'sit'
    return {
      side,
      doorZ: 0,
      outSide: plan.outSide,
      outDoorZ: 0,
      outX: T.hw + 0.55,
      inX: T.iw - 0.25,
      aisleX: side * 0.22,
      spot: sit ? new THREE.Vector3(side * sp.x, 0, sp.standZ) : new THREE.Vector3(-side * 0.78, 0, 0.12),
      face: sit ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-side, 0, 0),
      seat: sit ? SEAT : null,
      standAction: 'gaze',
      // 一緒に乗る仲間（KB-001）: 座る花音の前の窓ぎわ（胸の高さ・窓の壁から 0.04m）。吊り手の棒（x = ±0.6m）のつり革の輪の下端（床から 1.26m）より
      // 下に浮かび、通路から撮る画でつり革・握り棒と重ならない。花音の顔との間は 0.9m 前（前から撮る画で顔の前に入らない。§7 の 209）
      member: sit ? new THREE.Vector3(side * (T.iw - 0.19), T.floor + 0.98, sp.cz + 0.9) : new THREE.Vector3(-side * 0.25, T.floor + 1.55, 0.75),
      // 乗り込む・降りる道も、つり革の輪の下（床から 1.05m。輪の下端 1.26m）
      memberPathY: 1.05,
      floor: T.floor,
    } satisfies LineLayout
  },
  setRidden(plan, run) {
    const f = tramNet.fleet
    if (f) f.ridden = run === null ? null : { line: plan.lineNo, run }
  },
}

/** 一緒に乗る仲間の道（緑電・運河バスで共通。lineRide.ts の lineMemberSlots） */
defineMemberSlots('tram', lineMemberSlots((leader) => leader.rides.tram))

/** 緑電に乗る仕組み（乗る人ごとに 1 つ。ch.rides.tram。character/ride/rides.ts が作る） */
export function createTramRide(ch: Character) {
  return new LineRide<TramPlan>(adapter, ch)
}

/**
 * 系統 lineNo で停留所 from から to へ行く便と、ホームの待つ所を決める（lead = 待つ所に着くまでの秒の見込み）。だめなら理由
 */
export function planTramBoarding(lineNo: number, from: string, to: string, lead: number) {
  const line = tramLine(lineNo)
  if (!line || !tramNet.fleet) return '緑電の線路のデータがまだありません（町のデータを読み込み中）'
  const t = transitClock.serviceSec
  const b = nextTramBoarding(line, from, to, t, lead + 6)
  if (!b) {
    const known = tramStopIndex(line, 1, from) >= 0 && (tramStopIndex(line, 1, to) >= 0 || tramStopIndex(line, -1, to) >= 0)
    return known ? `緑電 ${lineNo} 系統の${from}から${to}へ行く便がもうありません（運転は 5:30〜24:30）` : `緑電 ${lineNo} 系統に「${from}」「${to}」の停留所がありません`
  }
  const at = tramStopPose(line, b.dir, b.fromIndex)
  const to2 = tramStopPose(line, b.dir, b.toIndex)
  if (!at || !to2) return `緑電の${from}・${to}の停留所のホームが見つかりません`
  const plan: TramPlan = { lineNo, line, dir: b.dir, from, to, fromIndex: b.fromIndex, toIndex: b.toIndex, side: at.side, outSide: to2.side, platform: at.platform }
  // 待つ所: 中の両の扉の前（ホームの線路の側の縁から 0.6m・扉の真ん中から 0.45m 後ろ）
  const pf = at.platform
  const nx = -pf.dy * pf.side
  const ny = pf.dx * pf.side
  const edge = -TRAM_PLATFORM.width / 2 + 0.6
  const back = -0.45
  const wx = pf.x + nx * edge + at.fx * back
  const wy = pf.y + ny * edge + at.fy * back
  // ホームの線路の側を向く（ホームの外向きの逆。乗る仕組みには beginTramRide で渡す）
  const heading = Math.atan2(-nx, ny)
  return { plan, run: toRun(b), spot: [wx, -wy] as [number, number], heading, platform: pf }
}

/** 乗るのを始める（花音は待つ所に着いている。heading = 待つ所で向く向き） */
export function beginTramRide(ch: Character, spec: LineRideSpec, plan: TramPlan, run: LineRun, heading: number) {
  const ride = ch.rides.tram
  ride.waitHeading = heading
  ride.begin(spec, plan, run)
}

/** locomotion から毎コマ（Character の drivers.motion。src/kanon/index.ts が付ける） */
export function driveTram(ch: Character, _t: number, dt: number) {
  return ch.rides.tram.drive(dt)
}

/**
 * 毎コマ（riders.ts の updateRiders。乗る人ごとの更新の前に 1 回）: 誰かが緑電に乗っている（待つ・乗る）間は、便の位置と扉を、乗る人を動かす前に
 * このコマの交通の時計で決める（描くのは Landscape のあと。1 コマ遅れないように）
 */
export function updateTramFleet(riders: readonly Character[]) {
  for (let i = 0; i < riders.length; i++) {
    if (riders[i].rides.tram.active()) {
      tramNet.fleet?.updateState(transitClock.serviceSec, null)
      return
    }
  }
}

/** 毎コマ（updateRiders。updateTramFleet のあと、乗る人ごとに） */
export function updateTramRide(ch: Character, dt: number) {
  ch.rides.tram.update(Math.min(dt, 0.1))
}

/**
 * 停留所のホームの道（シーンの x, z の点の列）: from（町の点）から、近い方のスロープの下 → スロープの上 → ホームの上を to（ホームの上の点）へ。
 * reverse = ホームの上の from から、近い方のスロープを下りて to（町の点）へ
 */
export function platformPath(pf: TramPlatform, from: [number, number], to: [number, number], reverse = false): [number, number][] {
  const L = TRAM_PLATFORM.length / 2
  const R = TRAM_PLATFORM.ramp
  // ホームの局所: a = 線に沿って、b = 線路から外へ。通る所は真ん中より少し外（屋根の柱・ベンチ・標識を避けて、線路の側から 0.9m）
  const nx = -pf.dy * pf.side
  const ny = pf.dx * pf.side
  const P = (a: number, b: number): [number, number] => [pf.x + pf.dx * a + nx * b, -(pf.y + pf.dy * a + ny * b)]
  const town = reverse ? to : from
  const tx = town[0] - pf.x
  const ty = -town[1] - pf.y
  const ta = tx * pf.dx + ty * pf.dy
  const end = ta >= 0 ? 1 : -1
  const lane = -TRAM_PLATFORM.width / 2 + 0.9
  const foot = P(end * (L + R + 0.6), lane)
  const top = P(end * (L - 0.3), lane)
  const on = reverse ? from : to
  const pts: [number, number][] = reverse ? [on, top, foot, to] : [from, foot, top, on]
  return pts
}

/* -------------------------------------------------------------------------- */
/* 自動カメラ（配信。乗っている間の画）                                                 */
/* -------------------------------------------------------------------------- */

/** 乗り場で待つ間・乗り降りの途中の自動カメラの画の候補（src/camera/rideViews.ts。乗り降りの画は便 car の車室の局所で決まる） */
export function tramPlatformViews(ch: Character, _car: Car, out: PlatformView[]) {
  ch.rides.tram.platformViews(out)
}

/**
 * 乗っている間の自動カメラの画 i（便 car の中の両と一緒に動く。src/camera/rideViews.ts）: 0 = 通路から花音の正面の斜め、1 = 通路の向かいから花音の横顔と窓の外、
 * 2 = 外から追う（扉の側の斜め横）。乗っていなければ null
 */
export function tramAutoView(ch: Character, car: Car, i: number, pos: THREE.Vector3, target: THREE.Vector3): number | null {
  const ride = ch.rides.tram
  const L = ride.lay
  if (car.vehicle !== tramVehicle || !L || !ch.ride.inside) return null
  const F = T.floor
  const sp = L.spot
  const sitting = !!L.seat
  const s = L.side
  const eye = F + (sitting ? 1.12 : 1.52)
  let k = ((i % 3) + 3) % 3
  // 停留所で扉が開いている間（途中の停留所は早送りでも止まって開く・乗り降りで車室の中を歩く間も）: 正面の斜めの画は、花音のすぐ前の扉の戸の袖が
  // 画をふさぐので、通路の向かいの画に（§7 の 220）
  if (k === 0) {
    const r = ride.plan && ride.run ? tramNet.fleet?.find(ride.plan.lineNo, ride.run.run) : null
    if (r && (r.stop >= 0 || r.door > 0.02 || r.speed < 2)) k = 1
  }
  if (k === 0) {
    if (sitting) {
      car.toWorld(s * 0.05, F + 1.42, sp.z + 1.55, pos)
      car.toWorld(sp.x, eye - 0.08, sp.z, target)
    } else {
      car.toWorld(-s * 0.1, F + 1.5, sp.z + 1.6, pos)
      car.toWorld(sp.x, eye - 0.1, sp.z, target)
    }
    return 56
  }
  if (k === 1) {
    // 通路の向かいから、花音の横顔と後ろの窓の外（流れる町）
    car.toWorld(-s * 0.32, F + 1.32, sp.z + 0.25, pos)
    car.toWorld(sp.x, eye - 0.05, sp.z - 0.05, target)
    return 50
  }
  // 外から: ホームの側（扉の側）の斜め横 4m・地面から 1.4m より上。建物・木に入るなら中の正面へ
  car.toWorld(s * 3.4, F + 1.65, sp.z - 3.6, pos)
  car.toWorld(s * 0.6, F + 1.15, sp.z + 0.3, target)
  if (townWalk.ready) pos.y = Math.max(pos.y, townWalk.groundY(pos.x, pos.z, pos.y) + 1.4)
  if (townSolids.blocker(pos.x, pos.y, pos.z, 0.5) || !townSolids.sight(pos, target, 0.8)) return tramAutoView(ch, car, 0, pos, target)
  return 44
}

/** ?debug: コンソールから（window.__tram。src/kanon/index.ts が花音で作る） */
export function tramRideDebug(ch: Character) {
  return { ride: ch.rides.tram, planTramBoarding, tramNet }
}

/** 系統 lineNo で from から to へ乗るときの、乗る（which = 'from'）・降りる（'to'）停留所のホーム。無ければ null */
export function tramPlatformFor(lineNo: number, from: string, to: string, which: 'from' | 'to') {
  const line = tramLine(lineNo)
  if (!line) return null
  for (const dir of [1, -1] as const) {
    const a = tramStopIndex(line, dir, from)
    const list = dir > 0 ? line.outStops : line.backStops
    const b = list.findIndex((s, j) => j > a && s.name === to)
    if (a < 0 || b < 0) continue
    return tramStopPose(line, dir, which === 'from' ? a : b)?.platform ?? null
  }
  return null
}

/** 降りる停留所のホーム */
export function tramExitPlatform(plan: TramPlan) {
  return tramStopPose(plan.line, plan.dir, plan.toIndex)?.platform ?? null
}

/** ホームのスロープの下の点（町の平面座標）。toward（平面座標）に近い方の端 */
export function platformFoot(pf: TramPlatform, toward: readonly [number, number]): [number, number] {
  const L = TRAM_PLATFORM.length / 2 + TRAM_PLATFORM.ramp + 0.6
  const ta = (toward[0] - pf.x) * pf.dx + (toward[1] - pf.y) * pf.dy
  const end = ta >= 0 ? 1 : -1
  const nx = -pf.dy * pf.side
  const ny = pf.dx * pf.side
  const b = -TRAM_PLATFORM.width / 2 + 0.9
  return [pf.x + pf.dx * end * L + nx * b, pf.y + pf.dy * end * L + ny * b]
}
