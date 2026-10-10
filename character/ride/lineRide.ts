import * as THREE from 'three'
import type { SeatSpec } from '../avatar/body'
import { groundHeight } from '../avatar/locomotion'
import type { Character, CharacterMotion } from '../avatar/character'
import { zoneOfPoint } from '../../core/interiors'
import { transitClock } from '../../world/outdoor/transit/clock'
import type { Car, CarLine, Vehicle } from '../../world/outdoor/transit/vehicle'
import { setRiderCar } from './rider'
import { updateParty, type MemberSlot, type MemberSlotSource } from './party'
import { makePath, pathAt, walkPath, type Path } from './walk'
import { advanceBy, cancelWarp, type RideTime } from './warp'
import { doorViews, waitViews, type PlatformView } from './platformViews'

/**
 * ダイヤどおりに停留所・乗り場に止まる乗り物に乗る、共通の仕組み（緑電 character/ride/tramRide.ts・運河バス character/ride/boatRide.ts。docs/design/town.md §20）。
 * 丘ノ上ケーブル（cableRide.ts）と同じ流れで、乗り物ごとの違い（車室の行列・扉・座る所・一緒に乗る仲間の居場所）は LineAdapter が持つ:
 *
 *   1. 待つ（wait）: 停留所のホーム・乗り場の段の、扉の来る所で線路・水の方を向いて待つ（待つ時間の扱い real / cut / fast）。
 *      乗る便が止まって扉が開いたら（閉め始めるより十分前なら）
 *   2. 乗り込む（board）: 扉から入り、座る所の前へ歩く（車室の局所の道。停車の間に終わる長さ）。一緒に乗る仲間（KB-001。character/ride/party.ts）も
 *      続いて乗る（待たない。仲間の道は lineMemberSlots）
 *   3. 座る・立つ（turn → settle）→ 乗っている（ride）: 発車まで（待つ時間の扱い）・走る間（乗っている間の扱い）。途中の停留所では降りない
 *   4. 降りる（stand → out）: 降りる停留所・乗り場に止まって扉が開いたら立ち（「止まってから席をお立ちください」）、扉からホーム・段へ出る。
 *      出たら町の中の移動（character/avatar/travel.ts）へ返す
 *
 * 動きは描画の時計で進めるので、撮影でも毎回同じ画になる。乗り物の位置・扉は交通の時計（時刻）だけから決まる。
 */

/** 便と、その乗り降りの時刻（運転の日の秒） */
export interface LineRun {
  /** 乗り物の中の番号（系統・航路の便の番号） */
  run: number
  /** 乗る所で扉が開ききる・閉め始める・発車する時刻 */
  open: number
  close: number
  depart: number
  /** 降りる所に着く・扉が開ききる時刻 */
  arriveTo: number
  openTo: number
  /** 乗る所に着く時刻 */
  arrive: number
}

/** 車室の局所の、乗り降りの道と居場所 */
export interface LineLayout {
  /** 乗る扉の側（局所の x の向き）と扉の真ん中の z */
  side: 1 | -1
  doorZ: number
  /** 降りる扉の側と真ん中の z */
  outSide: 1 | -1
  outDoorZ: number
  /** 扉の外の点の x（|x|）・扉の中の点の x（|x|）・通路の x（側つき） */
  outX: number
  inX: number
  aisleX: number
  /** 座る・立つ所（局所の足元）と向く向き、座席の決まり（立つなら null）、立つときの行動 */
  spot: THREE.Vector3
  face: THREE.Vector3
  seat: SeatSpec | null
  standAction: 'gaze' | 'present'
  /** 一緒に乗る仲間（KB-001）の居場所（局所） */
  member: THREE.Vector3
  /** 仲間が乗り込む・降りるときに浮かぶ高さ（床から。省けば乗り込み 1.55m・降りる 1.75m。緑電はつり革の下を通る） */
  memberPathY?: number
  /** 床の高さ（局所の y） */
  floor: number
}

export interface LineAdapter<P> {
  vehicle: Vehicle
  /** 乗る系統・航路（便ごとの車室 Car の鍵。vehicle.car(run, line)） */
  line(plan: P): CarLine
  /** 便 car の今のコマの車室の行列（局所 → シーン）。見えていなければ false */
  pose(car: Car, out: THREE.Matrix4): boolean
  /** 便 run が乗る所（from）・降りる所（to）に止まっていて扉が開いている度合い（0〜1。止まっていなければ 0） */
  doorOpen(run: number, at: 'from' | 'to', plan: P): number
  /** 時刻 t から lead 秒より先に乗れる次の便（無ければ null） */
  next(plan: P, t: number, lead: number): LineRun | null
  /** 局所の道と居場所 */
  layout(plan: P, pose: 'sit' | 'stand', run: number): LineLayout
  /** 乗っている便（細かい形でいつも描く・中の灯り）。降りたら null */
  setRidden(plan: P, run: number | null): void
  /** 名前（理由の文） */
  label: string
}

export interface LineRideSpec {
  pose: 'sit' | 'stand'
  wait: RideTime
  ride: RideTime
  fastSec: number | null
  fastSpeed: number | null
}

type Step = 'idle' | 'wait' | 'board' | 'turn' | 'settle' | 'ride' | 'stand' | 'out' | 'done' | 'failed'

const STEP_SPEED = 0.9
const _v = new THREE.Vector3()
const _d = new THREE.Vector3()
const _pt = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _pose = new THREE.Matrix4()

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * ダイヤの乗り物に乗る（乗る人ごと・乗り物の種類ごとに 1 つ。ch.rides.tram・ch.rides.boat。character/ride/rides.ts が作る）。
 * 乗り込んで座った（立った）回数・降りて出た回数は乗る人の ride.serials（kanon.travel の until=board・alight。ケーブル・ホバーと合わせて数える）
 */
export class LineRide<P> {
  readonly adapter: LineAdapter<P>
  /** 乗る人（この仕組みの持ち主） */
  readonly ch: Character
  /** 待つ所で向く向き（シーンの heading。begin の前に乗る仕組みのファイル（tramRide.ts・boatRide.ts）が書く） */
  waitHeading = 0
  step: Step = 'idle'
  plan: P | null = null
  spec: LineRideSpec | null = null
  run: LineRun | null = null
  /** 乗る便の車室（begin・便を替えるときに引く。降りたあとも最後に乗った便を指したまま） */
  car: Car | null = null
  lay: LineLayout | null = null
  path: Path | null = null
  error: string | null = null
  private placeSerial = -1
  private first = true
  private waitDone = false
  private departDone = false
  private rideDone = false
  /** 乗り込みで扉の内へ入った・降りるときに扉まで来た（出来事 ride.enter・ride.exit を出した） */
  private entered = false
  private exited = false

  constructor(adapter: LineAdapter<P>, ch: Character) {
    this.adapter = adapter
    this.ch = ch
  }

  /** 待つ・乗っている途中か */
  active() {
    return this.step !== 'idle' && this.step !== 'done' && this.step !== 'failed'
  }

  /** 終わった（降りて出た / 乗れなかった）なら、その結果 */
  result(): { ok: boolean; error: string | null } | null {
    if (this.step === 'done') return { ok: true, error: null }
    if (this.step === 'failed') return { ok: false, error: this.error }
    return null
  }

  clear() {
    if (this.step === 'done' || this.step === 'failed') this.reset(false)
  }

  /** 今の様子（状態の返送） */
  state() {
    if (this.step === 'idle' || !this.run) return null
    const t = transitClock.serviceSec
    return {
      step: this.step,
      run: this.run.run,
      depart_in_s: Math.round(this.run.depart - t),
      arrive_in_s: Math.round(this.run.arriveTo - t),
      error: this.error,
    }
  }

  /** 乗るのを始める（乗る人は待つ所に着いている） */
  begin(spec: LineRideSpec, plan: P, run: LineRun) {
    const ch = this.ch
    this.reset(false)
    this.spec = spec
    this.plan = plan
    this.run = run
    this.step = 'wait'
    this.placeSerial = ch.motion.placeSerial
    this.lay = this.adapter.layout(plan, spec.pose, run.run)
    this.car = this.adapter.vehicle.car(run.run, this.adapter.line(plan))
    setRiderCar(ch.ride, this.car)
    ch.ride.seat = { z: this.lay.spot.z, side: this.lay.side }
    ch.ride.phase = 'wait'
    this.first = true
    this.updatePose()
    ch.events.emit('ride.wait', this.car)
  }

  /** 町の中の移動が取り消された: 待っている間ならやめる。乗っている途中なら、着いて降りるまで続ける */
  cancel() {
    if (this.step === 'wait') this.reset(true)
  }

  private fail(msg: string) {
    this.error = msg
    this.step = 'failed'
    const r = this.ch.ride
    const car = r.car?.vehicle === this.adapter.vehicle ? r.car : null
    if (car) {
      r.phase = 'none'
      setRiderCar(r, null)
    }
    if (this.plan) this.adapter.setRidden(this.plan, null)
    cancelWarp(this.ch)
    if (car) this.ch.events.emit('ride.cancel', car)
  }

  private reset(stopRider: boolean) {
    if (this.plan) this.adapter.setRidden(this.plan, null)
    this.plan = null
    this.spec = null
    this.run = null
    this.lay = null
    this.step = 'idle'
    this.path = null
    this.error = null
    this.waitDone = this.departDone = this.rideDone = false
    const r = this.ch.ride
    const car = r.car?.vehicle === this.adapter.vehicle ? r.car : null
    if (car) {
      r.phase = 'none'
      car.delta.set(0, 0, 0)
      setRiderCar(r, null)
      r.attach = 0
      r.inside = false
    }
    cancelWarp(this.ch)
    if (stopRider) {
      this.ch.motion.speed = 0
      this.ch.motion.phase = 'idle'
    }
    if (car) this.ch.events.emit('ride.cancel', car)
  }

  private updatePose() {
    if (!this.run || !this.car) return false
    if (!this.adapter.pose(this.car, _pose)) return false
    this.car.setPose(_pose, this.first)
    this.first = false
    return true
  }

  /* ------------------------------------------------------------------------ */
  /* 毎コマ（updateRiders。交通の時計を進めたあと・花音を動かす前）                          */
  /* ------------------------------------------------------------------------ */

  update(dt: number) {
    if (!this.active() || !this.run || !this.plan || !this.spec) return
    // 途中で別の所へ置き直された（kanon.place）: 乗るのをやめる
    if (this.ch.motion.placeSerial !== this.placeSerial) {
      this.reset(false)
      return
    }
    const now = transitClock.serviceSec
    const spec = this.spec
    const run = this.run
    const a = this.adapter
    if (!this.updatePose() && this.step !== 'wait') {
      // 乗っている便が見えなくなった（ありえないが、交通のデータを作り直したとき）
      this.fail(`${a.label}の便が見つかりません`)
      return
    }
    const riding = this.step !== 'wait'
    a.setRidden(this.plan, riding || now > run.arrive - 30 ? run.run : null)
    if (this.step === 'wait') {
      // 待つ時間を飛ばす・早送りする（まだ来ていなければ着く 8 秒前へ、止まっていれば扉が開く 1.5 秒前へ）
      if (!this.waitDone) {
        this.waitDone = true
        if (spec.wait !== 'real') {
          const target = now < run.arrive ? run.arrive - 8 : run.open - 1.5
          if (target - now > 2) advanceBy(this.ch, target - now, spec.wait, spec.fastSec, spec.fastSpeed, 8)
        }
      }
      // 乗れる便が過ぎた（早送りで扉が閉まった・置いた時刻が遅かった）: 次の便
      if (now > run.close - 2.5 && a.doorOpen(run.run, 'from', this.plan) < 0.85) {
        const next = a.next(this.plan, now, 6)
        if (!next) {
          this.fail(`${a.label}の便がもうありません`)
          return
        }
        this.run = next
        this.lay = a.layout(this.plan, spec.pose, next.run)
        this.car = a.vehicle.car(next.run, a.line(this.plan))
        setRiderCar(this.ch.ride, this.car)
        this.ch.ride.seat = { z: this.lay.spot.z, side: this.lay.side }
        this.first = true
        this.waitDone = false
        this.updatePose()
        // 乗る便を決め直した
        this.ch.events.emit('ride.wait', this.car)
        return
      }
      if (a.doorOpen(run.run, 'from', this.plan) > 0.85 && now < run.close - 2.5) this.startBoard()
    } else if (this.step === 'ride') {
      // 発車まで（扉が閉まる少し前へ）
      if (!this.departDone && now < run.depart - 10) {
        this.departDone = true
        if (spec.wait !== 'real') advanceBy(this.ch, run.depart - 8 - now, spec.wait, spec.fastSec, spec.fastSpeed, 6)
      }
      // 走る間（発車して 5 秒走ったら、着く 7 秒前へ。止まる所を見せる）
      if (!this.rideDone && now > run.depart + 5) {
        this.rideDone = true
        const target = run.arriveTo - 7
        if (spec.ride !== 'real' && target - now > 2) advanceBy(this.ch, target - now, spec.ride, spec.fastSec, spec.fastSpeed, 20)
      }
      // 着いて止まり、扉が開いたら立つ
      if (now > run.arriveTo - 1 && a.doorOpen(run.run, 'to', this.plan) > 0.5) this.startStand()
    }
    updateParty(this.ch, this.car!, dt)
  }

  /** 乗り込む: 扉の外 → 扉の内 → 通路 → 座る・立つ所の前（局所） */
  private startBoard() {
    const m = this.ch.motion
    const L = this.lay!
    const s = L.side
    const p0 = this.car!.toCabin(m.position, new THREE.Vector3())
    const pts = [new THREE.Vector3(p0.x, 0, p0.z), new THREE.Vector3(s * L.outX, 0, L.doorZ), new THREE.Vector3(s * L.inX, 0, L.doorZ)]
    // 通路を通って居場所へ（扉の中から、居場所の z の通路へ）
    const ax = L.aisleX
    if (Math.abs(L.spot.z - L.doorZ) > 0.6) pts.push(new THREE.Vector3(ax, 0, L.doorZ + Math.sign(L.spot.z - L.doorZ) * 0.45), new THREE.Vector3(ax, 0, L.spot.z))
    pts.push(new THREE.Vector3(L.spot.x, 0, L.spot.z))
    this.path = makePath(pts)
    this.path.speed = 0
    this.step = 'board'
    this.ch.ride.phase = 'board'
    this.entered = false
    m.stopId = null
    m.targetId = null
    m.activityHeld = false
    m.seat = null
    m.action = 'present'
    this.ch.events.emit('ride.board', this.car!)
  }

  /** 降りる: 立つ（行動の姿勢を解く）→ 通路 → 扉の内 → 扉の外 */
  private startStand() {
    const m = this.ch.motion
    this.step = 'stand'
    this.ch.ride.phase = 'alight'
    m.activityHeld = false
    m.action = 'present'
    // 着いて扉が開いた・降り始めた
    this.ch.events.emit('ride.arrived', this.car!)
    this.ch.events.emit('ride.alight', this.car!)
  }

  /* ------------------------------------------------------------------------ */
  /* 花音の動き（locomotion の中から）                                                */
  /* ------------------------------------------------------------------------ */

  private turnToward(m: CharacterMotion, target: number, dt: number, maxRate = 2.4) {
    const err = wrapAngle(target - m.heading)
    const rate = THREE.MathUtils.clamp(err * 4.5, -maxRate, maxRate)
    m.heading = wrapAngle(m.heading + rate * dt)
    m.turnRate = rate
    return err
  }

  private headingOf(local: THREE.Vector3) {
    this.car!.dirToWorld(local, _d)
    return Math.atan2(_d.x, _d.z)
  }

  private setGround(ch: Character, dt: number) {
    const m = ch.motion
    const g = groundHeight(ch, m.position.x, m.position.z, false, m.position.y)
    if (Math.abs(g - m.ground) < 0.45) m.ground += (g - m.ground) * (1 - Math.exp(-dt * 16))
    else m.ground = g
    m.position.y = m.ground
  }

  /** 乗り場で待つ間・乗り降りの途中の自動カメラの画の候補（src/camera/rideViews.ts） */
  platformViews(out: PlatformView[]) {
    out.length = 0
    const L = this.lay
    if (!L || !this.active()) return
    if (this.step === 'wait') waitViews(this.ch.motion.position, this.waitHeading, out)
    else if (this.step === 'board') doorViews(this.car!, L.side, L.doorZ, L.outX, L.floor, out)
    else if (this.step === 'stand' || this.step === 'out') doorViews(this.car!, L.outSide, L.outDoorZ, L.outX, L.floor, out)
  }

  /** locomotion から毎コマ（Character の drivers.motion から）。乗る人を動かしたら true。待つ間は waitHeading の向きを向く */
  drive(dt: number): boolean {
    if (!this.active() || !this.lay) return false
    const ch = this.ch
    const r = ch.ride
    const m = ch.motion
    const L = this.lay
    const car = this.car!
    m.timeScale = 1
    m.stride = null
    const step = this.step
    if (step === 'wait') {
      m.speed = Math.max(0, m.speed - dt * 2)
      m.phase = 'idle'
      m.stopId = null
      this.turnToward(m, this.waitHeading, dt)
      this.setGround(ch, dt)
      return true
    }
    if (step === 'board' || step === 'out') {
      const p = this.path!
      const done = walkPath(p, dt, STEP_SPEED)
      pathAt(p, p.s, _pt, _dir)
      car.toWorld(_pt.x, L.floor, _pt.z, _v)
      m.position.x = _v.x
      m.position.z = _v.z
      m.speed = p.speed
      m.phase = 'walk'
      m.zone = zoneOfPoint(_v.x, _v.z)
      this.turnToward(m, this.headingOf(_dir), dt, 3.2)
      m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
      this.setGround(ch, dt)
      const inside = Math.abs(_pt.x) < L.inX + 0.05
      r.inside = inside
      r.attach = inside ? 1 : THREE.MathUtils.clamp((L.outX - Math.abs(_pt.x)) / Math.max(0.05, L.outX - L.inX), 0, 1)
      if (step === 'board') {
        // 扉の内へ入った（一緒に乗る仲間が続いて入る所。仲間を乗り込ませるのは使う側の制御が ride.enter を聞いて）
        if (!this.entered && inside) {
          this.entered = true
          ch.events.emit('ride.enter', car)
        }
        if (done) this.step = 'turn'
      } else {
        // 降りる: 花音が扉まで来た（一緒に乗る仲間も後から扉を出る所。通路で花音の頭と重ならないように）
        if (!this.exited && Math.abs(_pt.x) > L.inX - 0.1) {
          this.exited = true
          ch.events.emit('ride.exit', car)
        }
      }
      if (step === 'out' && done) {
        // 出た: 町の中の移動へ返す（ホーム・段から先は travel.ts）
        m.speed = 0
        m.phase = 'idle'
        r.phase = 'none'
        car.delta.set(0, 0, 0)
        setRiderCar(r, null)
        r.attach = 0
        r.inside = false
        if (this.plan) this.adapter.setRidden(this.plan, null)
        // 出た（一緒に乗る仲間はここで離れて、ふだんどおり付いていく。外へ出る花音の通った跡を追うので、扉から出る）
        this.step = 'done'
        r.serials.alight++
        ch.events.emit('ride.left', car)
        return false
      }
      return true
    }
    // 座る・立つ所（車室に付いて動く）
    car.toWorld(L.spot.x, L.floor, L.spot.z, _v)
    m.position.x = _v.x
    m.position.z = _v.z
    m.zone = zoneOfPoint(_v.x, _v.z)
    m.speed = 0
    m.phase = 'idle'
    r.inside = true
    r.attach = 1
    m.ground = _v.y
    m.position.y = m.ground
    const want = this.headingOf(L.face)
    if (step === 'turn') {
      const err = this.turnToward(m, want, dt)
      if (Math.abs(err) < 0.02 && Math.abs(m.turnRate) < 0.1) {
        m.turnRate = 0
        if (L.seat) {
          m.action = 'sit'
          m.seat = L.seat
        } else {
          m.action = L.standAction
          m.seat = null
        }
        m.activityHeld = true
        this.step = 'settle'
      }
      return true
    }
    m.heading = want
    m.turnRate *= Math.exp(-dt * 8)
    m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
    if (step === 'settle') {
      if (m.actionBlend > 0.85) {
        this.step = 'ride'
        r.phase = 'riding'
        r.serials.board++
        ch.events.emit('ride.riding', car)
      }
      return true
    }
    if (step === 'stand') {
      // 立ち上がったら（行動の姿勢がほどけたら）、降りる扉から出る
      if (m.actionBlend < 0.25) {
        m.seat = null
        const s = L.outSide
        const pts = [L.spot.clone()]
        if (Math.abs(L.spot.z - L.outDoorZ) > 0.6) pts.push(new THREE.Vector3(L.aisleX, 0, L.spot.z), new THREE.Vector3(L.aisleX, 0, L.outDoorZ + Math.sign(L.spot.z - L.outDoorZ) * 0.45))
        pts.push(new THREE.Vector3(s * L.inX, 0, L.outDoorZ), new THREE.Vector3(s * (L.outX + 0.45), 0, L.outDoorZ))
        this.path = makePath(pts)
        this.path.speed = 0
        this.step = 'out'
        this.exited = false
      }
      return true
    }
    return true
  }
}

/* -------------------------------------------------------------------------- */
/* 一緒に乗る仲間の道（character/ride/party.ts。前の KB-001 の付き添いの式と数のまま）  */
/* -------------------------------------------------------------------------- */

/**
 * 緑電・運河バスの仲間の道（tramRide.ts・boatRide.ts が defineMemberSlots で登録する）。ride = 先に立つ人のその乗り物の LineRide。
 * 乗り込む: 扉の外 → 扉の内 → 通路 → 居場所（花音が扉の中へ入るまでは扉の外で待つ。扉の内へ入るか次の点へ進んだら車室と一緒に動く）、
 * 降りる: 通路 → 扉 → 扉の外（扉の外へ出たら車室から離れる）
 */
export function lineMemberSlots(ride: (leader: Character) => LineRide<unknown>): MemberSlotSource {
  return {
    join(leader, way) {
      const lr = ride(leader)
      const L = lr.lay
      if (way !== 'cabin' || !L || !lr.car) return null
      const y = L.floor + (L.memberPathY ?? 1.55)
      const mid = L.memberPathY === undefined ? L.member.y + 0.15 : Math.min(y, L.member.y)
      const pts = [new THREE.Vector3(L.side * (L.outX + 0.6), y, L.doorZ + 0.5), new THREE.Vector3(L.side * L.inX * 0.6, y, L.doorZ), new THREE.Vector3(L.member.x * 0.5 + L.aisleX * 0.5, mid, (L.member.z + L.doorZ) / 2), L.member.clone()]
      return lineSlot(lr.car, pts, {
        end: 'settle',
        attach0: 0,
        attachRate: 2.5,
        attachGate: (l, index) => Math.abs(l.x) < L.inX + 0.2 || index > 0,
        holdAtDoor: (kl) => Math.abs(kl.z - L.doorZ) < 0.75 && Math.abs(kl.x) > L.inX - 0.3,
      })
    },
    leave(leader, slot) {
      const L = ride(leader).lay
      if (slot.way !== 'cabin' || !L) return null
      const y = L.floor + (L.memberPathY ?? 1.75)
      const pts = [new THREE.Vector3(L.outSide * L.inX * 0.3, y, L.outDoorZ + 0.35), new THREE.Vector3(L.outSide * L.inX * 0.8, y, L.outDoorZ), new THREE.Vector3(L.outSide * (L.outX + 0.9), y, L.outDoorZ + 0.5)]
      return lineSlot(slot.car, pts, { end: 'release', attach0: 1, attachRate: -2.5, attachGate: (l) => Math.abs(l.x) > L.outX, holdAtDoor: null })
    },
  }
}

function lineSlot(car: Car, pts: THREE.Vector3[], o: Pick<MemberSlot, 'end' | 'attach0' | 'attachRate' | 'attachGate' | 'holdAtDoor'>): MemberSlot {
  return { car, way: 'cabin', pts, index: 0, reach: 0.2, settle: 0.15, speed: 2.0, speedNow: null, lastPoint: null, aim: 'pre', aimOnEnd: false, tuck: null, maxAbove: null, ...o }
}
