import * as THREE from 'three'
import type { SeatSpec } from '../avatar/body'
import { groundHeight } from '../avatar/locomotion'
import type { Character, CharacterMotion } from '../avatar/character'
import { CABLE_STATIONS, STATION_ZONE, stationHeading, stationScene, waitSpot, type CableStationKey } from '../../core/cableStations'
import { zoneOfPoint } from '../../core/interiors'
import { cableTrack } from '../../world/outdoor/transit/cable'
import { CABLE_CAR, compAt, compFloor, compZ } from '../../world/outdoor/transit/cableCar'
import { CABLE_RUN, CABLE_STATION_LABEL, cableArrivalOpen, nextCableBoarding } from '../../core/transit/cableRun'
import { cableVehicle } from '../../world/outdoor/transit/cableVehicle'
import type { Car } from '../../world/outdoor/transit/vehicle'
import { transitClock } from '../../world/outdoor/transit/clock'
import { townWalk } from '../../world/walk/townWalk'
import { setRiderCar } from './rider'
import { defineMemberSlots, releaseParty, updateParty, type MemberSlot } from './party'
import { makePath, pathAt, walkPath, type Path } from './walk'
import { advanceBy, cancelWarp, type RideTime } from './warp'
import { doorViews, waitViews, type PlatformView } from './platformViews'

/**
 * 丘ノ上ケーブルに乗る（kanon.travel のケーブルの区間。docs/design/town.md §19・§7 の 176〜）。
 *
 * 町の中の移動（character/avatar/travel.ts）が、駅の入口からホームの扉の前（待つ所）まで花音を歩かせたあと、ここが引き継ぐ:
 *   1. 待つ（wait）: ホームの扉の前で線路の方を向いて、次の便の扉が開くのを待つ（待つ時間の扱い real / cut / fast）。扉が開いたら
 *   2. 乗り込む（board）: 扉から区画に入り、座る（進む向きを向いて、湾の側（−x）の窓ぎわの長いす）か、湾の側の扉の窓の前に立つ（gaze）
 *   3. 乗っている（riding）: 発車まで待ち（待つ時間の扱い）、走る間（乗っている間の扱い real / cut / fast）。途中の楓坂駅では降りない
 *   4. 降りる（alight）: 着いて降りる側の扉が開いたら、立って扉からホームへ出る。出たら町の中の移動へ返す（出口までは travel.ts が歩く）
 * 一緒に乗る仲間（KB-001。character/ride/party.ts）は乗らずに、車両の外の行き違い線の外の側（さくら号は南東・かえで号は北西）を、花音の区画の窓の横に
 * 並んで飛ぶ（地上 4.8m まで。並走する仲間の道）。降りた側と並走していた側が違えば、降りたあと車両の谷の端を回って戻る。
 * 車両の位置・扉はダイヤ（transit/cableRun.ts）から決まるので、花音はそれに合わせて動く（扉が閉まる前に乗り込める便を選ぶ）。
 * 動きは描画の時計（撮影はコマごとに決まった秒）で進めるので、撮影でも毎回同じ画になる。
 */

const C = CABLE_CAR
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _d = new THREE.Vector3()
const _pt = new THREE.Vector3()
const _dir = new THREE.Vector3()

/** 車両の中の歩く速さ・乗り降りの扉のまわりの点 */
const STEP_SPEED = 0.85
/** 座る長いす（座面の高さ・立つ位置から座面の真ん中まで後ろへ。観覧車と同じ考え） */
const SEAT: SeatSpec = { height: C.seatH, shift: -0.5, hands: 'lap' }
/** 湾の側（−x）の窓ぎわの席の x */
const SEAT_X = -0.74
/** 扉の前に立つ所（湾の側の扉の窓の前） */
const STAND_X = -(C.innerW - 0.42)

/* -------------------------------------------------------------------------- */
/* 状態                                                                         */
/* -------------------------------------------------------------------------- */

export interface CableRideSpec {
  from: CableStationKey
  to: CableStationKey
  /** 座る（湾の側の窓ぎわ）か、湾の側の扉の窓の前に立つか */
  pose: 'sit' | 'stand'
  /** 待つ時間（ホームと、乗ってから発車まで）・走る間の扱い */
  wait: RideTime
  ride: RideTime
  /** 早送りの長さ（秒）か倍率 */
  fastSec: number | null
  fastSpeed: number | null
}

type Step = 'idle' | 'wait' | 'board' | 'turn' | 'settle' | 'ride' | 'stand' | 'out' | 'done' | 'failed'

/** ケーブルに乗る仕組みの状態（Character ごと。ch.rides.cable。character/ride/rides.ts が作る） */
export function createCableRide(ch: Character) {
  return {
    /** 乗る人（この仕組みの持ち主） */
    ch,
    spec: null as CableRideSpec | null,
    step: 'idle' as Step,
    /** 乗る車両（0 = さくら号・1 = かえで号）・便・乗る扉の側・区画 */
    car: -1,
    /** 乗る車両の車室（Car。乗る車両を決めるたびに引く。降りたあとも最後に乗った車両を指したまま） */
    cabin: null as Car | null,
    trip: -1,
    side: 0,
    comp: -1,
    /** 降りる駅の扉の側（車両の局所の x の向き） */
    outSide: 0,
    /** 発車・着いて扉が開ききる時刻（運転の日の秒） */
    depart: 0,
    arriveOpen: 0,
    /** 歩く道（車両の局所） */
    path: null as Path | null,
    /** 座る・立つ所（車両の局所の足元）と、向く向き（車両の局所の z の向き。立つときは x の向き） */
    spot: new THREE.Vector3(),
    face: new THREE.Vector3(),
    /** 時間を飛ばした・早送りしたか（待つ・発車まで・走る間） */
    waitDone: false,
    departDone: false,
    rideDone: false,
    /** 町の中の移動が取り消された（乗っている途中なら、着いて降りたら止まる） */
    cancelled: false,
    placeSerial: -1,
    first: true,
    error: null as string | null,
    /** 乗り込みで扉の内へ入った・降りるときに扉の外へ出た（出来事 ride.enter・ride.exit を出した） */
    entered: false,
    exited: false,
  }
}
export type CableRide = ReturnType<typeof createCableRide>

/** 乗る車両の、乗り物の局所 → シーンの行列を毎コマ写す */
function updatePose(ctl: CableRide) {
  const line = cableTrack.line
  if (!line || ctl.car < 0 || !ctl.cabin) return
  ctl.cabin.setPose(line.cars[ctl.car].matrix, ctl.first)
  ctl.first = false
}

/** 乗る人の居場所（中の光の向き。湾の側の窓・区画）を書く */
function writeSeat(ctl: CableRide) {
  ctl.ch.ride.seat = { z: ctl.spot.z, side: -1, comp: ctl.comp }
}

/** 今の状態（travel.ts・状態の返送） */
export function cableRideState(ch: Character) {
  const ctl = ch.rides.cable
  if (ctl.step === 'idle') return null
  const t = transitClock.serviceSec
  return {
    step: ctl.step,
    car: ctl.car < 0 ? null : ctl.car === 0 ? 'さくら号' : 'かえで号',
    from: ctl.spec ? CABLE_STATION_LABEL[ctl.spec.from] : null,
    to: ctl.spec ? CABLE_STATION_LABEL[ctl.spec.to] : null,
    depart_in_s: ctl.depart ? Math.round(ctl.depart - t) : null,
    arrive_in_s: ctl.arriveOpen ? Math.round(ctl.arriveOpen - t) : null,
    error: ctl.error,
  }
}

/** ケーブルの区間の途中（待つ・乗っている）か */
/** 乗っている間の時間の扱い（続きの kanon.travel が、まだ使っていない wait・ride・早送りの倍率を変える。§7 の 216） */
export function cableRideSpec(ch: Character) {
  return ch.rides.cable.spec
}

export function cableRiding(ch: Character) {
  const step = ch.rides.cable.step
  return step !== 'idle' && step !== 'done' && step !== 'failed'
}

/** 終わった（降りてホームに出た / 乗れなかった）なら、その結果。ほかは null */
export function cableRideResult(ch: Character): { ok: boolean; error: string | null } | null {
  const ctl = ch.rides.cable
  if (ctl.step === 'done') return { ok: true, error: null }
  if (ctl.step === 'failed') return { ok: false, error: ctl.error }
  return null
}

/** 結果を受け取ったあと、元に戻す */
export function clearCableRide(ch: Character) {
  const ctl = ch.rides.cable
  if (ctl.step === 'done' || ctl.step === 'failed') resetRide(ctl, false)
}

/* -------------------------------------------------------------------------- */
/* 乗る便とホームの待つ所                                                         */
/* -------------------------------------------------------------------------- */

export interface CableBoardingPlan {
  car: number
  side: 1 | -1
  comp: number
  /** 待つ所（シーンの x, z）と、向く向き（heading） */
  spot: [number, number]
  heading: number
  /** 扉が開くまでの秒（今から） */
  waitSec: number
}

/**
 * 駅 from から駅 to へ行く便と、ホームで待つ所を決める（lead = 待つ所に着くまでの秒の見込み）。だめなら理由
 */
export function planCableBoarding(from: CableStationKey, to: CableStationKey, lead: number): CableBoardingPlan | string {
  if (!cableTrack.line) return '丘ノ上ケーブルの線路のデータがまだありません（町のデータを読み込み中）'
  const t = transitClock.serviceSec
  const b = nextCableBoarding(from, to, t, lead + 6)
  if (!b) return `丘ノ上ケーブルの${CABLE_STATION_LABEL[from]}から${CABLE_STATION_LABEL[to]}へ行く便がもうありません（終発は 23:30。夜中はルート G のつづら道か route を auto に）`
  const d = CABLE_STATIONS[STATION_ZONE[from]]
  const side = b.side as 1 | -1
  // 改札・入口にいちばん近い扉の区画
  const access = d.access[side > 0 ? '1' : '-1'] ?? d.comps[0].door
  let comp = 0
  for (let i = 1; i < 4; i++) if (Math.abs(d.comps[i].door - access) < Math.abs(d.comps[comp].door - access)) comp = i
  const [s, tt] = waitSpot(d, comp, side)
  const p = stationScene(d, s, tt)
  return { car: b.car, side, comp, spot: [p[0], p[2]], heading: stationHeading(d, 0, -side), waitSec: Math.max(0, b.open - t) }
}

/** 乗るのを始める（花音は待つ所に着いている）。plan = planCableBoarding の結果 */
export function beginCableRide(ch: Character, spec: CableRideSpec, plan: CableBoardingPlan) {
  const ctl = ch.rides.cable
  resetRide(ctl, false)
  ctl.spec = spec
  ctl.side = plan.side
  ctl.comp = plan.comp
  ctl.step = 'wait'
  ctl.placeSerial = ch.motion.placeSerial
  // 今の時刻で、この側のホームに来る便（歩く間に時間が過ぎていれば次の便）
  if (!pickBoarding(ctl)) return
  setRiderCar(ch.ride, ctl.cabin)
  writeSeat(ctl)
  ch.ride.phase = 'wait'
  ctl.first = true
  updatePose(ctl)
  ch.events.emit('ride.wait', ctl.cabin!)
}

/** 待っている側のホームに来る、乗れる便を選ぶ。無ければ失敗にする */
function pickBoarding(ctl: CableRide) {
  const spec = ctl.spec!
  const t = transitClock.serviceSec
  const b = nextCableBoarding(spec.from, spec.to, t, 5, ctl.side)
  if (!b) {
    fail(ctl, `丘ノ上ケーブルの${CABLE_STATION_LABEL[spec.from]}から${CABLE_STATION_LABEL[spec.to]}へ行く便がもうありません（終発は 23:30）`)
    return false
  }
  ctl.car = b.car
  ctl.trip = b.k
  ctl.depart = b.depart
  ctl.arriveOpen = cableArrivalOpen(b.car, b.k, spec.to) ?? 0
  // 降りる駅のホームの側（局所の x の向き）
  const out = CABLE_STATIONS[STATION_ZONE[spec.to]]
  ctl.outSide = spec.to === 'station.cable-kaedezaka' ? (b.car === 0 ? -1 : 1) : out.sides[0]
  // 乗る車両の車室（待つ間に替わったら、前の車両の動きを足さないように乗り始めとして書く）
  const cabin = cableVehicle.car(b.car)
  if (ctl.cabin !== cabin) {
    ctl.cabin = cabin
    ctl.first = true
  }
  const r = ctl.ch.ride
  if (r.car?.vehicle === cableVehicle && r.car !== cabin) {
    setRiderCar(r, cabin)
    // 待つ間に乗る車両を決め直した
    ctl.ch.events.emit('ride.wait', cabin)
  }
  return true
}

function fail(ctl: CableRide, msg: string) {
  const r = ctl.ch.ride
  const car = r.car?.vehicle === cableVehicle ? r.car : null
  ctl.error = msg
  ctl.step = 'failed'
  r.phase = 'none'
  setRiderCar(r, null)
  cancelWarp(ctl.ch)
  if (car) ctl.ch.events.emit('ride.cancel', car)
}

/** 町の中の移動が取り消された: 待っている間ならやめる。乗っている途中なら、着いて降りるまで続ける */
export function cancelCableRide(ch: Character) {
  const ctl = ch.rides.cable
  if (ctl.step === 'wait') {
    resetRide(ctl, true)
    return
  }
  if (cableRiding(ch)) ctl.cancelled = true
}

function resetRide(ctl: CableRide, stopRider: boolean) {
  const r = ctl.ch.ride
  ctl.spec = null
  ctl.step = 'idle'
  ctl.car = -1
  ctl.trip = -1
  ctl.comp = -1
  ctl.path = null
  ctl.waitDone = ctl.departDone = ctl.rideDone = false
  ctl.cancelled = false
  ctl.error = null
  ctl.depart = 0
  ctl.arriveOpen = 0
  const car = r.car?.vehicle === cableVehicle ? r.car : null
  if (car) {
    r.phase = 'none'
    car.delta.set(0, 0, 0)
    setRiderCar(r, null)
    r.attach = 0
    r.inside = false
  }
  if (cableTrack.line) cableTrack.line.ridden = -1
  cancelWarp(ctl.ch)
  if (stopRider) {
    ctl.ch.motion.speed = 0
    ctl.ch.motion.phase = 'idle'
  }
  if (car) ctl.ch.events.emit('ride.cancel', car)
}

/* -------------------------------------------------------------------------- */
/* 毎コマ（updateRiders から。交通の時計を進めたあと・花音を動かす前）                    */
/* -------------------------------------------------------------------------- */

/** 毎コマ（riders.ts の updateRiders。乗る人ごとの更新の前に 1 回）: 2 両の位置と扉（このコマの交通の時計で。描くのは Landscape のあと） */
export function updateCableLine() {
  cableTrack.line?.updateState(transitClock.serviceSec)
}

/** 毎コマ（updateRiders。updateCableLine のあと、乗る人ごとに） */
export function updateCableRide(ch: Character, t: number, delta: number) {
  const ctl = ch.rides.cable
  const r = ch.ride
  const line = cableTrack.line
  if (!line) return
  const dt = Math.min(delta, 0.1)
  // 降りたあと、一緒に乗った仲間が車両の谷の端を回って花音のそばへ戻る途中（車両は止まっている）。途中で花音が別の所へ置き直されたら、その場で離れる
  if (r.car === null && ctl.cabin) {
    updateParty(ch, ctl.cabin, dt)
    if (ch.motion.placeSerial !== ctl.placeSerial) releaseParty(ch, ctl.cabin)
  }
  if (ctl.step === 'idle' || ctl.step === 'done' || ctl.step === 'failed') return
  void t
  // 途中で別の所へ置き直された（kanon.place）: 乗るのをやめる
  if (ch.motion.placeSerial !== ctl.placeSerial) {
    resetRide(ctl, false)
    return
  }
  updatePose(ctl)
  line.ridden = r.phase === 'none' || r.phase === 'wait' ? -1 : ctl.car
  const spec = ctl.spec!
  const now = transitClock.serviceSec
  const doors = line.cars[ctl.car]
  if (ctl.step === 'wait') {
    // 待つ時間を飛ばす・早送りする（車両がまだ来ていなければ入ってくる 6 秒前へ、止まっていれば扉が開く 1.5 秒前へ）
    if (!ctl.waitDone) {
      ctl.waitDone = true
      const stopped = doors.station === spec.from
      const open = nextCableBoarding(spec.from, spec.to, now, 5, ctl.side)
      if (open && spec.wait !== 'real') {
        const target = stopped ? open.open - CABLE_RUN.doorMove - 1.5 : open.arrive - 6
        if (target - now > 2) advanceBy(ch, target - now, spec.wait, spec.fastSec, spec.fastSpeed, 8)
      }
    }
    // 便が変わった（待つ間に乗れる便が過ぎた）: 次の便
    if (now > ctl.depart - CABLE_RUN.doorCloseBefore - 4 && !(doors.station === spec.from && doors.door > 0.5)) pickBoarding(ctl)
    if (doors.station === spec.from && doors.door > 0.85 && doors.side === ctl.side && now < ctl.depart - CABLE_RUN.doorCloseBefore - 4) startBoard(ctl)
  } else if (ctl.step === 'ride') {
    // 発車まで（扉が閉まる少し前へ）
    if (!ctl.departDone && now < ctl.depart - 12) {
      ctl.departDone = true
      if (spec.wait !== 'real') advanceBy(ch, ctl.depart - 11 - now, spec.wait, spec.fastSec, spec.fastSpeed, 6)
    }
    // 走る間（発車して 4 秒走ったら、着いて止まる 5 秒前へ）
    if (!ctl.rideDone && now > ctl.depart + 4) {
      ctl.rideDone = true
      const target = ctl.arriveOpen - CABLE_RUN.doorOpenAfter - CABLE_RUN.doorMove - 5
      if (spec.ride !== 'real' && target - now > 2) advanceBy(ch, target - now, spec.ride, spec.fastSec, spec.fastSpeed, 20)
    }
    // 着いて、降りる側の扉が開いたら立つ
    if (doors.station === spec.to && doors.side === ctl.outSide && doors.door > 0.4) startStand(ctl)
  }
  updateParty(ch, ctl.cabin!, dt)
}

/** 乗り込む: 扉の外 → 扉の内 → 席の前（車両の局所） */
function startBoard(ctl: CableRide) {
  const m = ctl.ch.motion
  const spec = ctl.spec!
  const { zc } = compZ(ctl.comp)
  const up = spec.to === 'station.cable-summit' || (spec.to === 'station.cable-kaedezaka' && spec.from === 'station.cable-fumoto')
  const p0 = ctl.cabin!.toCabin(m.position, new THREE.Vector3())
  const s = ctl.side
  const pts = [new THREE.Vector3(p0.x, 0, p0.z), new THREE.Vector3(s * (C.halfW + 0.38), 0, zc), new THREE.Vector3(s * (C.innerW - 0.3), 0, zc)]
  if (spec.pose === 'sit') {
    // 進む向きを向く長いす（上りは谷の側の長いすに山を向いて、下りは山の側の長いすに谷を向いて）の、湾の側の席
    const { za, zb } = compZ(ctl.comp)
    const back = up ? (ctl.comp === 0 ? -C.innerL : za + C.partition / 2) : ctl.comp === C.comps - 1 ? C.innerL : zb - C.partition / 2
    const dir = up ? 1 : -1
    const feetZ = back + dir * (C.benchDepth + 0.3)
    pts.push(new THREE.Vector3(SEAT_X * 0.55, 0, (zc + feetZ) / 2), new THREE.Vector3(SEAT_X, 0, feetZ))
    ctl.spot.set(SEAT_X, 0, feetZ)
    ctl.face.set(0, 0, dir)
  } else {
    // 湾の側の扉の窓の前に立つ（窓の外を向く）
    pts.push(new THREE.Vector3(STAND_X, 0, zc + 0.08))
    ctl.spot.set(STAND_X, 0, zc + 0.08)
    ctl.face.set(-1, 0, 0)
  }
  writeSeat(ctl)
  ctl.path = makePath(pts)
  ctl.path.speed = 0
  ctl.step = 'board'
  ctl.ch.ride.phase = 'board'
  ctl.entered = false
  m.stopId = null
  m.targetId = null
  m.activityHeld = false
  m.seat = null
  m.action = 'present'
  ctl.ch.events.emit('ride.board', ctl.cabin!)
}

/** 降りる: 立つ（行動の姿勢を解く）→ 扉の内 → 扉の外（ホーム） */
function startStand(ctl: CableRide) {
  const m = ctl.ch.motion
  ctl.step = 'stand'
  ctl.ch.ride.phase = 'alight'
  m.activityHeld = false
  m.action = 'present'
  // 着いて扉が開いた・降り始めた
  ctl.ch.events.emit('ride.arrived', ctl.cabin!)
  ctl.ch.events.emit('ride.alight', ctl.cabin!)
}

/* -------------------------------------------------------------------------- */
/* 一緒に乗る仲間の道（乗らずに車両の外を並走。character/ride/party.ts。前の KB-001 の付き添いの式と数のまま） */
/* -------------------------------------------------------------------------- */

/** 仲間が並走する側（行き違い線の外の側。さくら号は −x = 南東、かえで号は +x = 北西） */
const escortSide = (ctl: CableRide) => (ctl.car === 0 ? -1 : 1)

/** 並走する所（車両の局所）: 花音の区画の窓の横、窓の高さ */
function escortPoint(ctl: CableRide, out: THREE.Vector3) {
  const { zc } = compZ(Math.max(0, ctl.comp))
  return out.set(escortSide(ctl) * (C.halfW + 1.35), compFloor(Math.max(0, ctl.comp)) + 1.45, zc)
}

defineMemberSlots('cable', {
  /** 並走を始める（花音が乗り込んだ）。乗った側と並走する側が違えば、車両の谷の端を回る。並走する所は毎コマ車両に付いて動く */
  join(leader, way) {
    const ctl = leader.rides.cable
    if (way !== 'escort' || !ctl.cabin) return null
    const es = escortSide(ctl)
    const pts: THREE.Vector3[] = []
    if (es !== ctl.side) {
      const y = compFloor(0) + 1.5
      pts.push(new THREE.Vector3(ctl.side * (C.halfW + 0.9), y, compZ(ctl.comp).zc), new THREE.Vector3(ctl.side * (C.halfW + 0.9), y, -C.halfL - 1.2), new THREE.Vector3(es * (C.halfW + 0.9), y, -C.halfL - 1.2))
    }
    pts.push(escortPoint(ctl, new THREE.Vector3()))
    return cableSlot(ctl.cabin, pts, { end: 'none', attach0: 0, attachRate: 1.5, lastPoint: (out) => escortPoint(ctl, out) })
  },
  /** 並走をやめて花音のそばへ戻る（花音がホームへ出た）。並走している側と降りた側が同じならその場で離れ、違えば車両の谷の端を回る */
  leave(leader, slot) {
    const ctl = leader.rides.cable
    const es = escortSide(ctl)
    if (es === ctl.outSide) return null
    const y = compFloor(0) + 1.5
    const pts = [new THREE.Vector3(es * (C.halfW + 0.9), y, -C.halfL - 1.2), new THREE.Vector3(ctl.outSide * (C.halfW + 0.9), y, -C.halfL - 1.2), new THREE.Vector3(ctl.outSide * (C.halfW + 1.2), y, compZ(ctl.comp).zc)]
    return cableSlot(slot.car, pts, { end: 'arrive', attach0: 0, attachRate: 0, lastPoint: null })
  },
  /** 降りて立つ所: 降りる駅のホームの、乗った区画の扉の前（ホームの側を向く） */
  arrival(leader, out) {
    const ctl = leader.rides.cable
    if (!ctl.spec || ctl.comp < 0 || !ctl.outSide) return null
    const d = CABLE_STATIONS[STATION_ZONE[ctl.spec.to]]
    const side = (ctl.outSide > 0 ? 1 : -1) as 1 | -1
    const [s, t] = waitSpot(d, ctl.comp, side)
    const p = stationScene(d, s, t)
    out.set(p[0], groundHeight(leader, p[0], p[2], false, p[1]), p[2])
    return stationHeading(d, 0, side)
  },
})

function cableSlot(car: Car, pts: THREE.Vector3[], o: Pick<MemberSlot, 'end' | 'attach0' | 'attachRate' | 'lastPoint'>): MemberSlot {
  return { car, way: 'escort', pts, index: 0, reach: 0.4, settle: 0.5, speed: 7, speedNow: null, attachGate: null, holdAtDoor: null, aim: 'post', aimOnEnd: false, tuck: null, maxAbove: 4.8, ...o }
}

/* -------------------------------------------------------------------------- */
/* 花音の動き（locomotion の中から）                                               */
/* -------------------------------------------------------------------------- */

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

function turnToward(m: CharacterMotion, target: number, dt: number, maxRate = 2.4) {
  const err = wrapAngle(target - m.heading)
  const rate = THREE.MathUtils.clamp(err * 4.5, -maxRate, maxRate)
  m.heading = wrapAngle(m.heading + rate * dt)
  m.turnRate = rate
  return err
}

/** 車両の局所の向き → シーンの heading */
function headingOf(ctl: CableRide, local: THREE.Vector3) {
  ctl.cabin!.dirToWorld(local, _d)
  return Math.atan2(_d.x, _d.z)
}

/** 座ったときの上半身の真ん中の、座面からの高さ（背もたれが体の上へ倒れてくる分を、この高さで前へよける） */
const SIT_TORSO_H = 0.3

/**
 * 座っている間の足元（シーン）: 体は傾けずに立てたまま描く（characterVisual。座面の高さ SEAT.height だけ上・向きの水平に SEAT.shift の所に
 * 腰を下ろす）ので、車室の座面の真ん中（局所）から逆算する。急な区間（u 800〜825 の勾配 0.32。車体が 10.9° 傾く）では、谷を向いて座ると
 * 背もたれと山の側の壁が体の上へ倒れてくるので、上半身の真ん中の高さ × sin（傾き）だけ前へ出す（山を向いて座るときは、背もたれは体から
 * 離れる向きなので出さない）。heading = 体の向き（シーン）。前は足元をレールの高さの点（局所の y = 0）で取り、座面までを水平・鉛直に足していたので、
 * 急な区間で体が山の側へ 0.3m ほどずれて、背もたれと山の側の壁の中に入った（issue #10）
 */
function seatFeet(ctl: CableRide, F: number, heading: number, out: THREE.Vector3) {
  const car = ctl.cabin!
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  car.toWorld(ctl.spot.x + ctl.face.x * SEAT.shift, F + SEAT.height, ctl.spot.z + ctl.face.z * SEAT.shift, out)
  out.x -= fx * SEAT.shift
  out.y -= SEAT.height
  out.z -= fz * SEAT.shift
  // 車室の上の向きが、体の前へ倒れている割合（sin（傾き））
  car.dirToWorld(_d.set(0, 1, 0), _dir)
  const lean = Math.max(0, _dir.x * fx + _dir.z * fz) * SIT_TORSO_H
  out.x += fx * lean
  out.z += fz * lean
  return out
}

/** 足元の高さを、小さな段はなめらかに */
function setGround(ch: Character, dt: number) {
  const m = ch.motion
  const g = groundHeight(ch, m.position.x, m.position.z, false, m.position.y)
  if (Math.abs(g - m.ground) < 0.45) m.ground += (g - m.ground) * (1 - Math.exp(-dt * 16))
  else m.ground = g
  m.position.y = m.ground
}

/** locomotion から毎コマ呼ばれる（Character の drivers.motion から）。ch を動かしたら true（ふだんの歩き・町の中の移動は止める） */
export function driveCable(ch: Character, _t: number, dt: number): boolean {
  if (!cableRiding(ch)) return false
  const ctl = ch.rides.cable
  const r = ch.ride
  const m = ch.motion
  m.timeScale = 1
  m.stride = null
  const step = ctl.step
  const car = ctl.cabin!
  if (step === 'wait') {
    // ホームの扉の前で、線路の方を向いて待つ
    m.speed = Math.max(0, m.speed - dt * 2)
    m.phase = 'idle'
    m.stopId = null
    turnToward(m, stationHeading(CABLE_STATIONS[STATION_ZONE[ctl.spec!.from]], 0, -ctl.side), dt)
    setGround(ch, dt)
    return true
  }
  if (step === 'board' || step === 'out') {
    const p = ctl.path!
    const done = walkPath(p, dt, STEP_SPEED)
    pathAt(p, p.s, _pt, _dir)
    // 平面の位置は区画の床の高さの点で（席・扉の前と同じ。駅の中でも車体はわずかに傾いているので、レールの高さの点だと少しずれる）
    car.toWorld(_pt.x, compFloor(ctl.comp), _pt.z, _v)
    m.position.x = _v.x
    m.position.z = _v.z
    m.speed = p.speed
    m.phase = 'walk'
    m.zone = zoneOfPoint(_v.x, _v.z)
    turnToward(m, headingOf(ctl, _dir), dt, 3.2)
    m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
    setGround(ch, dt)
    const inside = Math.abs(_pt.x) < C.innerW - 0.05
    r.inside = inside
    r.attach = inside ? 1 : 0
    if (step === 'board') {
      // 扉の内まで来た（一緒に乗る仲間は外の並走へ。並走させるのは使う側の制御が ride.enter を聞いて）
      if (!ctl.entered && Math.abs(_pt.x) < C.innerW) {
        ctl.entered = true
        ch.events.emit('ride.enter', car)
      }
      if (done) ctl.step = 'turn'
    } else {
      // 扉の外へ出た（並走していた仲間が並走をやめる所）
      if (!ctl.exited && Math.abs(_pt.x) > C.halfW + 0.15) {
        ctl.exited = true
        ch.events.emit('ride.exit', car)
      }
      if (done) {
        // ホームに出た: 町の中の移動へ返す（出口までは travel.ts）
        m.speed = 0
        m.phase = 'idle'
        r.phase = 'none'
        car.delta.set(0, 0, 0)
        setRiderCar(r, null)
        r.attach = 0
        r.inside = false
        if (cableTrack.line) cableTrack.line.ridden = -1
        ctl.step = 'done'
        r.serials.alight++
        ch.events.emit('ride.left', car)
        return false
      }
    }
    return true
  }
  // 席・扉の前（車両に付いて動く）。足元は車室の床の点（走る間は毎コマ）。座っている間は、傾いた車室の座面に腰が来る所（seatFeet）
  const F = compFloor(compAt(ctl.spot.z))
  car.toWorld(ctl.spot.x, F, ctl.spot.z, _v)
  const sit = m.action === 'sit' && m.seat === SEAT ? m.actionBlend * m.actionBlend * (3 - 2 * m.actionBlend) : 0
  if (sit > 0) _v.lerp(seatFeet(ctl, F, m.heading, _w), sit)
  m.position.copy(_v)
  m.ground = _v.y
  m.zone = zoneOfPoint(_v.x, _v.z)
  m.speed = 0
  m.phase = 'idle'
  r.inside = true
  r.attach = 1
  const want = headingOf(ctl, ctl.face)
  if (step === 'turn') {
    const err = turnToward(m, want, dt)
    if (Math.abs(err) < 0.02 && Math.abs(m.turnRate) < 0.1) {
      m.turnRate = 0
      if (ctl.spec!.pose === 'sit') {
        m.action = 'sit'
        m.seat = SEAT
      } else {
        m.action = 'gaze'
        m.seat = null
      }
      m.activityHeld = true
      ctl.step = 'settle'
    }
    return true
  }
  m.heading = want
  m.turnRate *= Math.exp(-dt * 8)
  m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
  if (step === 'settle') {
    if (m.actionBlend > 0.85) {
      ctl.step = 'ride'
      r.phase = 'riding'
      r.serials.board++
      ch.events.emit('ride.riding', car)
    }
    return true
  }
  if (step === 'stand') {
    // 立ち上がったら（行動の姿勢がほどけたら）、扉から出る
    if (m.actionBlend < 0.25) {
      m.seat = null
      const { zc } = compZ(ctl.comp)
      const s = ctl.outSide
      ctl.path = makePath([ctl.spot.clone(), new THREE.Vector3((ctl.spot.x + s * 0.6) / 2, 0, (ctl.spot.z + zc) / 2), new THREE.Vector3(s * (C.innerW - 0.3), 0, zc), new THREE.Vector3(s * (C.halfW + 0.62), 0, zc)])
      ctl.path.speed = 0
      ctl.step = 'out'
      ctl.exited = false
    }
    return true
  }
  return true
}

/** ?debug: コンソールから（window.__cable。src/kanon/index.ts が花音で作る） */
export function cableRideDebug(ch: Character) {
  return {
    ctl: ch.rides.cable,
    planCableBoarding,
    beginCableRide: (spec: CableRideSpec, plan: CableBoardingPlan) => beginCableRide(ch, spec, plan),
    cancelCableRide: () => cancelCableRide(ch),
    cableRideState: () => cableRideState(ch),
  }
}

/* -------------------------------------------------------------------------- */
/* 自動カメラ（配信。乗っている間の画）                                              */
/* -------------------------------------------------------------------------- */

/** 乗っている間の自動カメラの画の数 */
export const CABLE_AUTO_VIEWS = 3

/** 乗り場で待つ間・乗り降りの途中の自動カメラの画の候補（src/camera/rideViews.ts。乗り降りの画は便 car の車室の局所で決まる） */
export function cablePlatformViews(ch: Character, car: Car, out: PlatformView[]) {
  const ctl = ch.rides.cable
  out.length = 0
  if (!ctl.spec) return
  if (ctl.step === 'wait') waitViews(ch.motion.position, stationHeading(CABLE_STATIONS[STATION_ZONE[ctl.spec.from]], 0, -ctl.side), out)
  else if (ctl.step === 'board' && ctl.comp >= 0) doorViews(car, ctl.side, compZ(ctl.comp).zc, C.halfW + 0.62, compFloor(ctl.comp), out)
  else if ((ctl.step === 'stand' || ctl.step === 'out') && ctl.comp >= 0) doorViews(car, ctl.outSide, compZ(ctl.comp).zc, C.halfW + 0.62, compFloor(ctl.comp), out)
}

/**
 * 乗っている間の自動カメラの画 i（便 car の車両と一緒に動く。src/camera/rideViews.ts）: 0 = 中から花音の正面の斜め、1 = 花音の肩越しに湾の側の窓、
 * 2 = 外から車両を追う（湾の側の斜め後ろ）。pos・target をシーンの座標で書き、画角を返す。乗っていなければ null
 */
export function cableAutoView(ch: Character, car: Car, i: number, pos: THREE.Vector3, target: THREE.Vector3): number | null {
  const ctl = ch.rides.cable
  if (car.vehicle !== cableVehicle || ctl.comp < 0 || !ch.ride.inside) return null
  const F = compFloor(ctl.comp)
  const { zc } = compZ(ctl.comp)
  const sp = ctl.spot
  const sitting = ctl.spec?.pose !== 'stand'
  // 進む向き（座る向き。立っているときは上りなら +z）
  const up = ctl.spec ? ctl.spec.to === 'station.cable-summit' || (ctl.spec.to === 'station.cable-kaedezaka' && ctl.spec.from === 'station.cable-fumoto') : true
  const fz = sitting ? ctl.face.z : up ? 1 : -1
  const eyeY = F + (sitting ? 1.12 : 1.5)
  if (i % CABLE_AUTO_VIEWS === 0) {
    car.toWorld(Math.min(C.innerW - 0.25, sp.x + 1.35), F + 1.38, sp.z + fz * 1.75, pos)
    car.toWorld(sp.x, eyeY - 0.08, sp.z, target)
    return 56
  }
  if (i % CABLE_AUTO_VIEWS === 1) {
    // 花音の斜め前の通路の側から、花音の横顔ごしに湾の側の窓
    car.toWorld(Math.min(C.innerW - 0.2, sp.x + 1.55), F + 1.5, sp.z + fz * 1.05, pos)
    car.toWorld(-C.halfW - 1.2, F + 1.1, sp.z - fz * 0.35, target)
    return 64
  }
  car.toWorld(-C.halfW - 3.6, F + 1.9, zc - fz * 5.5, pos)
  car.toWorld(-0.4, F + 1.15, zc + fz * 0.6, target)
  // 切り通し・土手では地面の下に入らないように（地面から 1.2m 上へ）
  if (townWalk.ready) pos.y = Math.max(pos.y, townWalk.groundY(pos.x, pos.z, pos.y) + 1.2)
  return 42
}
