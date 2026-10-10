import * as THREE from 'three'
import { groundHeight, WALK_SPEED } from '../avatar/locomotion'
import type { Character, CharacterMotion } from '../avatar/character'
import type { SeatSpec } from '../avatar/body'
import { townPlaces } from '../../core/places'
import { CABIN, CABIN_SPOTS, SORANOWA, WHEEL_OMEGA, rideDegrees, soranowaOpen, wheelHeading } from '../../core/soranowa'
import { transitClock } from '../../world/outdoor/transit/clock'
import { setRiderCar } from './rider'
import { defineMemberSlots, membersSettled, updateParty, type MemberSlot } from './party'
import { advanceBy, cancelWarp, type RideTime } from './warp'
import { makePath, pathAt, walkPath, type Path } from './walk'
import { DEG_BOARD_STEP, DEG_EXIT_OPEN, DEG_BOARD_OPEN, wheel } from '../../world/outdoor/town/soranowaWheel'
import { soranowaVehicle } from '../../world/outdoor/town/soranowaVehicle'
import type { Car } from '../../world/outdoor/transit/vehicle'
import type { ZoneId } from '../../core/interiors'

/**
 * 観覧車ソラノワに乗る（docs/design/town.md §17・§7 の 116〜）。
 *
 * - 乗る（kanon.ride）: 花音は乗車位置（soranowa-platform）で待ち、次に下へ来たゴンドラ（止まらずに 0.35m/s で動いている）の扉が開いたら、
 *   ゴンドラと一緒に歩きながら乗り込み、+x の長いすに座る。一緒に乗る仲間（KB-001。character/ride/party.ts）もあとから入って向かいの長いすの上に浮かぶ。
 *   座って、仲間がみな中に入ったら扉が閉まり、ゴンドラと一緒に上がっていく（ゴンドラはいつも水平。花音と仲間はゴンドラの局所の座標で置く）
 * - 乗っている間の時間（kanon.ride_to・kanon.alight の time）: real = そのまま流す（既定）、cut = 飛ばす（町の時刻に足して、その位置から続ける）、
 *   fast = 早送り（決まった長さで、町の時刻・交通・空も一緒に速く進める）。足した時間は core/clock.ts の clockWarp に入る
 * - 降りる（kanon.alight）: ゴンドラが下へ戻って扉が開いたら、立って歩いて台へ出て、降車位置（soranowa-exit）へ。扉は、降りたあと
 *   乗客（降りる途中の仲間）が 0 になってから閉め終える
 * - 動きは描画の時計（撮影はコマごとに決まった秒）で進めるので、撮影でも毎回同じ画になる
 */

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()

/** ゴンドラの中で座る向き（−x を向く）と、座る長いす */
const SEAT_HEADING = wheelHeading(-1, 0)
const SEAT: SeatSpec = { height: CABIN_SPOTS.seat.height, shift: CABIN_SPOTS.seat.shift, hands: 'lap' }
/** 扉が開く・閉まる時間（秒） */
const DOOR_OPEN_S = 1.1
const DOOR_CLOSE_S = 1.3

/** 降りる扉が開く角度（度。advanceWheelTo でここまで進めてから requestWheelAlight で降りる。kanon-lab の kanon.alight もそうする） */
export const WHEEL_EXIT_OPEN_DEG = DEG_EXIT_OPEN + 0.01

export type { RideTime }

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/* -------------------------------------------------------------------------- */
/* 状態                                                                         */
/* -------------------------------------------------------------------------- */

type Step = 'wait' | 'step' | 'turn' | 'sit' | 'ride' | 'stand' | 'out' | 'leave' | 'done'

/** 観覧車に乗る仕組みの状態（Character ごと。ch.rides.wheel。character/ride/rides.ts が作る） */
export function createWheelRide(ch: Character) {
  return {
    /** 乗る人（この仕組みの持ち主） */
    ch,
    /** 乗るゴンドラ（beginWheelBoarding で決める。降りたあとも最後に乗ったゴンドラを指したまま） */
    car: null as Car | null,
    step: 'wait' as Step,
    /** 営業時間を無視して乗った */
    ignoreHours: false,
    /** 乗る道（ゴンドラの局所）・降りる道（前半はゴンドラの局所、後半はシーン） */
    path: null as Path | null,
    /** 道の後半（シーン）で、ゴンドラから離れ始めたときのゴンドラの位置 */
    leaveFrom: new THREE.Vector3(),
    /** 乗り込みで、ゴンドラに付いて動き始めたときのゴンドラの位置 */
    boardFrom: new THREE.Vector3(),
    /** 扉の開き具合の目標 */
    doorWant: 0,
    /** 降りる手前（扉が開くのを待っている）か */
    alightRequested: false,
    /** 乗り込みで扉の内へ入った（出来事 ride.enter を出した） */
    entered: false,
    /** 置き直し（kanon.place）の回数（乗っている途中で置き直されたら降りたことにする） */
    placeSerial: -1,
    /** 前のコマのゴンドラの位置 */
    lastPivot: new THREE.Vector3(),
    hasLast: false,
    t: 0,
    /** 降りたあと、扉が閉まるまでのゴンドラ（番号と車室。車室は乗る人の lastCar と同じ） */
    closing: { index: -1, car: null as Car | null, door: 0 },
  }
}
export type WheelRide = ReturnType<typeof createWheelRide>

/** ソラノワに乗っている（乗る・待つ）か */
const onWheel = (ch: Character) => ch.ride.car?.vehicle === soranowaVehicle

/** ゴンドラの今の「一番下から進んだ角度」（度。0〜360） */
export function rideDegreesNow(ch: Character) {
  const car = ch.ride.car
  return car?.vehicle !== soranowaVehicle ? 0 : rideDegrees(car.run, wheel.angle)
}

/** 乗り物に乗っている途中か（乗り込み・降りるの途中も含む。待っている間は含まない。観覧車・ケーブル） */
export function isRiding(ch: Character) {
  const phase = ch.ride.phase
  return phase === 'board' || phase === 'riding' || phase === 'alight'
}

/** ソラノワのゴンドラに乗っている途中か */
export function isRidingWheel(ch: Character) {
  return isRiding(ch) && onWheel(ch)
}

/* -------------------------------------------------------------------------- */
/* アクションから                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 観覧車に乗れない理由（wheelBoardProblem が返す。種類 code と、字を作るのに使う値）。字は wheelProblemText（地図の既定の字）で作る。
 * 使う側は、種類ごとに自分の言葉の字にしてよい（kanon-lab は命令の名前を入れた字にする。src/kanon/reasons.ts）
 * - on-wheel: もう観覧車に乗っている（待っている・乗り込み・乗っている・降りる途中）
 * - on-vehicle: ほかの乗り物に乗っている（vehicle = 乗り物の名前。わからなければ null）
 * - not-at-wheel: 乗り場のゾーン（soranowa）にいない（zone = 今いるゾーン）
 * - closed: 営業時間の外（openHour・closeHour = 営業の始まりと終わりの時、hour・minute = 今の町の時刻）
 */
export type WheelProblem =
  | { code: 'on-wheel' }
  | { code: 'on-vehicle'; vehicle: string | null }
  | { code: 'not-at-wheel'; zone: ZoneId }
  | { code: 'closed'; openHour: number; closeHour: number; hour: number; minute: number }

/** 乗れるか（だめなら理由。字は wheelProblemText）。乗車位置にいるかは見ない（使う側が先に歩いて行く。kanon-lab の kanon.ride もそうする） */
export function wheelBoardProblem(ch: Character, ignoreHours: boolean): WheelProblem | null {
  const r = ch.ride
  if (r.phase !== 'none') return onWheel(ch) ? { code: 'on-wheel' } : { code: 'on-vehicle', vehicle: r.car?.vehicle.label ?? null }
  if (ch.motion.zone !== 'soranowa') return { code: 'not-at-wheel', zone: ch.motion.zone }
  const sec = transitClock.sec
  if (!ignoreHours && !soranowaOpen(sec)) return { code: 'closed', openHour: SORANOWA.openHour, closeHour: SORANOWA.closeHour, hour: Math.floor(sec / 3600) % 24, minute: Math.floor(sec / 60) % 60 }
  return null
}

/** 観覧車に乗れない理由の、地図の既定の字 */
export function wheelProblemText(p: WheelProblem): string {
  switch (p.code) {
    case 'on-wheel':
      return 'もうソラノワに乗っています（降りるのは requestWheelAlight）'
    case 'on-vehicle':
      return `${p.vehicle ?? '乗り物'}に乗っています`
    case 'not-at-wheel':
      return `ソラノワの乗り場にいません（今は ${p.zone}）。先に乗り場（soranowa-front など）へ置いてください`
    case 'closed':
      return `ソラノワの営業時間（${p.openHour}:00〜${p.closeHour}:00）の外です（今は ${p.hour}:${String(p.minute).padStart(2, '0')}）。営業時間の外にも乗るなら ignoreHours を true に`
  }
}

/** 乗る: 次に来るゴンドラを決めて待ち始める（乗る人は乗車位置で止まっていること） */
export function beginWheelBoarding(ch: Character, ignoreHours: boolean) {
  const ctl = ch.rides.wheel
  ctl.ignoreHours = ignoreHours
  // 扉が開く所まで 0.4° より先のゴンドラ
  const b = soranowaVehicle.nextBoarding({})!
  const best = b.run
  ctl.car = soranowaVehicle.car(best)
  setRiderCar(ch.ride, ctl.car)
  ch.ride.phase = 'wait'
  wheel.rideIndex = best
  ctl.step = 'wait'
  ctl.doorWant = 0
  ctl.alightRequested = false
  ctl.path = null
  ctl.placeSerial = ch.motion.placeSerial
  ctl.hasLast = false
  ch.events.emit('ride.wait', ctl.car)
  return { gondola: best, waitSec: b.waitSec }
}

/** 乗り込みを取りやめる（待っている間だけ。乗り込み始めたら最後まで乗る） */
export function cancelWheelBoarding(ch: Character) {
  if (ch.ride.phase !== 'wait' || !onWheel(ch)) return false
  resetRide(ch.rides.wheel)
  return true
}

/** 乗り終えたか（座って、扉が閉まった） */
export function boarded(ch: Character) {
  return ch.ride.phase === 'riding'
}

/** 降りる: ゴンドラが下へ戻って扉が開いたら、歩いて降りる */
export function requestWheelAlight(ch: Character) {
  ch.rides.wheel.alightRequested = true
}

/** 降り終えたか */
export function alighted(ch: Character) {
  return ch.ride.phase === 'none'
}

/**
 * 乗っている位置を進める（kanon.ride_to・kanon.alight）。target = 一番下から進んだ角度（度）。
 * real は何もしない（呼び出し元が着くまで待つ）。cut は次のコマで町の時刻へ足す。fast は duration 秒で早送りする。
 * 戻り値: 進める秒（町の時刻）と、早送りの長さ（秒）
 */
export function advanceWheelTo(ch: Character, target: number, time: RideTime, duration: number | null, speed: number | null) {
  const deg = rideDegreesNow(ch)
  const degPerSec = (WHEEL_OMEGA * 180) / Math.PI
  const delta = Math.max(0, (target - deg) / degPerSec)
  return advanceBy(ch, delta, time, duration, speed, 15)
}

/** 乗るのをやめて元に戻す（kanon.place で置き直されたときなど） */
function resetRide(ctl: WheelRide) {
  const r = ctl.ch.ride
  const car = r.car
  r.phase = 'none'
  setRiderCar(r, null)
  r.attach = 0
  r.inside = false
  wheel.rideIndex = -1
  wheel.door = 0
  ctl.doorWant = 0
  ctl.path = null
  cancelWarp(ctl.ch)
  ctl.alightRequested = false
  ctl.hasLast = false
  if (car) ctl.ch.events.emit('ride.cancel', car)
}

/* -------------------------------------------------------------------------- */
/* 毎コマ                                                                       */
/* -------------------------------------------------------------------------- */

const _pose = new THREE.Matrix4()

/**
 * 毎コマ（交通の時計とホイールを進めたあと、花音を動かす前。riders.ts の updateRiders）: ゴンドラの位置・扉・一緒に乗る仲間の道（updateParty）。
 * ホイールの角度（town/soranowaWheel.ts の updateWheel）は町の毎コマの初め（town.begin。world/createTown.ts）がこの前に進める
 */
export function updateRide(ch: Character, t: number, delta: number) {
  const ctl = ch.rides.wheel
  const r = ch.ride
  const dt = Math.min(delta, 0.1)
  ctl.t = t
  if (r.phase === 'none' || !onWheel(ch)) {
    updateClosing(ctl, dt)
    return
  }
  // 乗っている途中で別の所へ置き直された（kanon.place）: 降りたことにする
  if (ch.motion.placeSerial !== ctl.placeSerial) {
    resetRide(ctl)
    return
  }
  const car = ctl.car!
  car.setPose(soranowaVehicle.poseOf(car, _pose), !ctl.hasLast)
  ctl.lastPivot.copy(car.pivot)
  ctl.hasLast = true
  const deg = rideDegrees(car.run, wheel.angle)
  // 扉
  const ds = ctl.doorWant > wheel.door ? dt / DOOR_OPEN_S : -dt / DOOR_CLOSE_S
  wheel.door = THREE.MathUtils.clamp(wheel.door + ds, 0, 1)
  if (r.phase === 'wait') {
    // 扉は乗車位置の少し手前で開く
    if (deg >= DEG_BOARD_OPEN - 0.01 || deg < 1) ctl.doorWant = 1
    if ((deg >= DEG_BOARD_STEP && deg < 359.99) || deg < 1) startBoardWalk(ctl)
  } else if (r.phase === 'riding') {
    if (ctl.alightRequested && deg >= DEG_EXIT_OPEN && deg < 359.9) startAlight(ctl)
  }
  updateParty(ch, car, dt)
}

/** 乗り込みの道（ゴンドラの局所）: 今の位置 → 扉の外 → 扉の内 → 長いすの前 */
function startBoardWalk(ctl: WheelRide) {
  const m = ctl.ch.motion
  const car = ctl.car!
  const p0 = car.toCabin(m.position, new THREE.Vector3())
  const [dx, , dz] = CABIN_SPOTS.doorOut
  const [ix, , iz] = CABIN_SPOTS.doorIn
  const [sx, , sz] = CABIN_SPOTS.stand
  ctl.path = makePath([new THREE.Vector3(p0.x, 0, p0.z), new THREE.Vector3(dx * 0.5 + p0.x * 0.5, 0, dz), new THREE.Vector3(ix, 0, iz), new THREE.Vector3(sx - 0.05, 0, sz - 0.18), new THREE.Vector3(sx, 0, sz)])
  ctl.path.speed = 0
  ctl.boardFrom.copy(car.pivot)
  ctl.ch.ride.phase = 'board'
  ctl.step = 'step'
  ctl.entered = false
  m.stopId = null
  m.targetId = null
  m.activityHeld = false
  m.seat = null
  ctl.ch.events.emit('ride.board', car)
}

/** 降りる: 立って、扉の内 → 扉の外（ここまでゴンドラの局所）→ 降車位置（シーン） */
function startAlight(ctl: WheelRide) {
  const m = ctl.ch.motion
  ctl.ch.ride.phase = 'alight'
  ctl.step = 'stand'
  ctl.doorWant = 1
  ctl.alightRequested = false
  m.activityHeld = false
  m.action = 'present'
  // 下へ戻って降りる扉が開く所に着いた・降り始めた
  ctl.ch.events.emit('ride.arrived', ctl.car!)
  ctl.ch.events.emit('ride.alight', ctl.car!)
}

/* -------------------------------------------------------------------------- */
/* 花音の動き（locomotion の中から。乗り込み・乗っている間・降りる間だけ）                   */
/* -------------------------------------------------------------------------- */

/** 向きをなめらかに回す（locomotion の turnToward と同じ考え） */
function turnToward(m: CharacterMotion, target: number, dt: number, maxRate = 2.4) {
  const err = wrapAngle(target - m.heading)
  const rate = THREE.MathUtils.clamp(err * 4.5, -maxRate, maxRate)
  m.heading = wrapAngle(m.heading + rate * dt)
  m.turnRate = rate
  return err
}

const _dir = new THREE.Vector3()
const _pt = new THREE.Vector3()

/** 中の床の高さ（シーンの y） */
const floorY = (ctl: WheelRide) => ctl.car!.pivot.y + CABIN.floor

/** locomotion から毎コマ呼ばれる（Character の drivers.motion から）。ch を動かしたら true（locomotion のふだんの歩きは止める） */
export function driveWheel(ch: Character, _t: number, dt: number): boolean {
  if (!isRiding(ch) || !onWheel(ch)) return false
  const ctl = ch.rides.wheel
  const r = ch.ride
  const m = ch.motion
  const step = ctl.step
  const car = ctl.car!
  m.zone = 'soranowa'
  if (step === 'step') {
    // 乗り込み: 台の上からゴンドラの中へ（初めの 0.7m で、だんだんゴンドラと一緒に動く）
    const p = ctl.path!
    const done = walkPath(p, dt)
    pathAt(p, p.s, _pt, _dir)
    const k = THREE.MathUtils.smoothstep(p.s, 0.05, 0.75)
    r.attach = k
    // ゴンドラの局所の道を、乗り込み始めたときの位置からゴンドラの動きの k だけ動かしてシーンへ
    _w.copy(ctl.boardFrom).lerp(car.pivot, k)
    car.toWorld(_pt.x, 0, _pt.z, _v, _w)
    m.position.x = _v.x
    m.position.z = _v.z
    const deckY = groundHeight(ch, m.position.x, m.position.z, false, m.position.y)
    m.ground = THREE.MathUtils.lerp(deckY, floorY(ctl), k)
    m.position.y = m.ground
    m.speed = p.speed
    m.phase = 'walk'
    turnToward(m, wheelHeading(_dir.x, _dir.z), dt, 3.2)
    m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
    r.inside = _pt.z > -CABIN.innerD
    // 扉の内まで来た（一緒に乗る仲間が続いて入る所。仲間を乗り込ませるのは使う側の制御が ride.enter を聞いて）
    if (!ctl.entered && _pt.z > -CABIN.innerD + 0.1) {
      ctl.entered = true
      ch.events.emit('ride.enter', car)
    }
    if (done) ctl.step = 'turn'
    return true
  }
  // 中にいる間はゴンドラに付いて動く
  r.attach = step === 'leave' ? r.attach : 1
  if (step === 'turn' || step === 'sit' || step === 'ride') {
    const [sx, , sz] = CABIN_SPOTS.stand
    car.toWorld(sx, 0, sz, _v)
    m.position.set(_v.x, floorY(ctl), _v.z)
    m.ground = floorY(ctl)
    m.speed = 0
    m.phase = 'idle'
    r.inside = true
    if (step === 'turn') {
      const err = turnToward(m, SEAT_HEADING, dt)
      if (Math.abs(err) < 0.02 && Math.abs(m.turnRate) < 0.1) {
        m.turnRate = 0
        m.action = 'sit'
        m.seat = SEAT
        m.activityHeld = true
        ctl.step = 'sit'
      }
    } else {
      m.heading = SEAT_HEADING
      m.turnRate *= Math.exp(-dt * 8)
      // 座って、一緒に乗る仲間もみな中に入ったら扉を閉める
      if (step === 'sit' && m.actionBlend > 0.85 && membersSettled(ch, car)) {
        ctl.doorWant = 0
        if (wheel.door <= 0.001) {
          ctl.step = 'ride'
          r.phase = 'riding'
          ch.events.emit('ride.riding', car)
        }
      }
    }
    return true
  }
  if (step === 'stand') {
    // 立ち上がる（行動の姿勢がほどけるまで待つ）。扉が開いたら歩き出す
    const [sx, , sz] = CABIN_SPOTS.stand
    car.toWorld(sx, 0, sz, _v)
    m.position.set(_v.x, floorY(ctl), _v.z)
    m.ground = floorY(ctl)
    m.phase = 'idle'
    m.speed = 0
    if (m.actionBlend < 0.25 && wheel.door > 0.6) {
      m.seat = null
      const [ix, , iz] = CABIN_SPOTS.doorIn
      const [ox, , oz] = CABIN_SPOTS.doorOut
      ctl.path = makePath([new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx - 0.1, 0, sz - 0.3), new THREE.Vector3(ix, 0, iz), new THREE.Vector3(ox, 0, oz + 0.12)])
      ctl.path.speed = 0
      ctl.step = 'out'
      // 扉へ歩き出した（一緒に乗る仲間が降り始める所）
      ch.events.emit('ride.exit', car)
    }
    return true
  }
  if (step === 'out') {
    // 中から扉の外へ（ゴンドラの局所）
    const p = ctl.path!
    const done = walkPath(p, dt)
    pathAt(p, p.s, _pt, _dir)
    car.toWorld(_pt.x, 0, _pt.z, _v)
    m.position.x = _v.x
    m.position.z = _v.z
    m.ground = floorY(ctl)
    m.position.y = m.ground
    m.speed = p.speed
    m.phase = 'walk'
    turnToward(m, wheelHeading(_dir.x, _dir.z), dt, 3.2)
    r.inside = _pt.z > -CABIN.innerD
    if (done || _pt.z < -CABIN.halfD - 0.35) {
      // 台の上の降車位置へ（シーンの道。初めの 0.7m で、だんだんゴンドラから離れる）
      const stop = townPlaces()['soranowa-exit'].position
      const here = m.position.clone()
      const ahead = here.clone().addScaledVector(_v.set(Math.sin(m.heading), 0, Math.cos(m.heading)), 0.35)
      ctl.path = makePath([here.setY(0), ahead.setY(0), new THREE.Vector3(stop[0], 0, stop[2])])
      ctl.path.speed = p.speed
      ctl.leaveFrom.copy(car.pivot)
      ctl.step = 'leave'
    }
    return true
  }
  if (step === 'leave') {
    const p = ctl.path!
    const done = walkPath(p, dt, WALK_SPEED * 0.85)
    pathAt(p, p.s, _pt, _dir)
    const k = 1 - THREE.MathUtils.smoothstep(p.s, 0.0, 0.7)
    r.attach = k
    // ゴンドラから離れ始めたときからのゴンドラの動きの k だけ足す
    _w.subVectors(car.pivot, ctl.leaveFrom).multiplyScalar(k)
    m.position.x = _pt.x + _w.x
    m.position.z = _pt.z + _w.z
    const deckY = groundHeight(ch, m.position.x, m.position.z, false, m.position.y)
    m.ground = THREE.MathUtils.lerp(deckY, floorY(ctl), k)
    m.position.y = m.ground
    m.speed = p.speed
    m.phase = 'walk'
    turnToward(m, Math.atan2(_dir.x, _dir.z), dt, 3.2)
    r.inside = false
    if (done) {
      // 降車位置に着いた: locomotion の着いたときの向き直りへ渡して、乗るのを終える
      m.speed = 0
      m.phase = 'turnEnd'
      m.targetId = 'soranowa-exit'
      m.stopId = null
      ctl.step = 'done'
      finishAlight(ctl)
      return false
    }
    return true
  }
  return false
}

/* -------------------------------------------------------------------------- */
/* 一緒に乗る仲間の道（character/ride/party.ts。前の KB-001 の付き添いの式と数のまま）  */
/* -------------------------------------------------------------------------- */

const MEMBER_SPEED = 2.4

defineMemberSlots('soranowa', {
  /** 乗り込む: 扉の外 → 扉の内 → 向かいの長いすの上（花音が扉の前の通り道（x 0.3 まで）を空けるまでは扉の外で待つ。扉に近づいたらゴンドラと一緒に動き出す） */
  join(leader, way) {
    const car = leader.rides.wheel.car
    if (way !== 'cabin' || !car) return null
    const [kx, ky, kz] = CABIN_SPOTS.member
    const fy = CABIN.floor
    return wheelSlot(car, [new THREE.Vector3(0.05, fy + 1.3, -CABIN.halfD - 0.75), new THREE.Vector3(0, fy + 1.2, -CABIN.innerD + 0.35), new THREE.Vector3(kx * 0.6, fy + ky + 0.12, kz * 0.6), new THREE.Vector3(kx, fy + ky, kz)], {
      end: 'settle',
      attach0: 0,
      attachRate: 2.5,
      attachGate: (l) => l.z > -CABIN.halfD - 0.9,
      holdAtDoor: (kl) => kl.x < 0.3,
    })
  },
  /** 降りる: 扉の内 → 扉の外 → 台の上（扉を出たらゴンドラから離れる。そのあとはふだんどおり） */
  leave(_leader, slot) {
    if (slot.way !== 'cabin') return null
    const fy = CABIN.floor
    return wheelSlot(slot.car, [new THREE.Vector3(-0.2, fy + 1.15, -CABIN.innerD + 0.3), new THREE.Vector3(0, fy + 1.25, -CABIN.halfD - 0.5), new THREE.Vector3(0.4, fy + 1.45, -CABIN.halfD - 1.2)], {
      end: 'release',
      attach0: 1,
      attachRate: -2.5,
      attachGate: (l) => l.z < -CABIN.halfD - 0.25,
      holdAtDoor: null,
    })
  },
})

function wheelSlot(car: Car, pts: THREE.Vector3[], o: Pick<MemberSlot, 'end' | 'attach0' | 'attachRate' | 'attachGate' | 'holdAtDoor'>): MemberSlot {
  return { car, way: 'cabin', pts, index: 0, reach: 0.16, settle: 0.12, speed: MEMBER_SPEED, speedNow: null, lastPoint: null, aim: 'post', aimOnEnd: true, tuck: null, maxAbove: null, ...o }
}

/** 降り終えた（花音が台の上に出た）: 扉を閉めて、ホイールの細かい形を元に戻す */
function finishAlight(ctl: WheelRide) {
  const r = ctl.ch.ride
  r.phase = 'none'
  r.attach = 0
  r.inside = false
  // 扉は閉まるまで動かしたいので、ゴンドラの番号はしばらく残す（閉まったら消す）。閉まるまではホイールを回し続ける（soranowaHeld）
  const closing = ctl.closing
  closing.index = ctl.car!.run
  closing.car = ctl.car
  closing.door = wheel.door
  wheel.closing = true
  setRiderCar(r, null)
  ctl.doorWant = 0
  ctl.ch.events.emit('ride.left', closing.car!)
}

/** 降りたあと: 扉が閉まるまでと、乗客（降りる途中の仲間）が 0 になるまで */
function updateClosing(ctl: WheelRide, dt: number) {
  const closing = ctl.closing
  const r = ctl.ch.ride
  if (closing.index >= 0 && r.phase === 'none') {
    closing.door = Math.max(0, closing.door - dt / DOOR_CLOSE_S)
    wheel.rideIndex = closing.index
    wheel.door = closing.door
    // 一緒に乗った仲間が降りる途中なら、道はまだゴンドラの局所（扉の外）。仲間を進めてから、終わりを見る
    const car = closing.car
    if (car && car.passengers.length > 0) {
      car.setPose(soranowaVehicle.poseOf(car, _pose), false)
      ctl.lastPivot.copy(car.pivot)
      updateParty(ctl.ch, car, dt)
    }
    if (closing.door <= 0 && (!car || car.passengers.length === 0)) {
      closing.index = -1
      wheel.closing = false
      wheel.rideIndex = -1
      wheel.door = 0
    }
  }
}

/** ?debug: コンソールから（window.__ride。src/kanon/index.ts が花音で作る。乗るのは __LAB__.ride()・__ride.advanceWheelTo(180, 'fast', 10, null)・__ride.requestWheelAlight()） */
export function rideDebug(ch: Character) {
  return {
    ctl: ch.rides.wheel,
    rider: ch.ride,
    wheel,
    beginWheelBoarding: (ignoreHours: boolean) => beginWheelBoarding(ch, ignoreHours),
    advanceWheelTo: (target: number, time: RideTime, duration: number | null, speed: number | null) => advanceWheelTo(ch, target, time, duration, speed),
    requestWheelAlight: () => requestWheelAlight(ch),
    rideDegreesNow: () => rideDegreesNow(ch),
  }
}
