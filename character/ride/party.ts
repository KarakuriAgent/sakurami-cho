import * as THREE from 'three'
import type { Character } from '../avatar/character'
import type { Car, VehicleId } from '../../world/outdoor/transit/vehicle'
import { townSolids } from '../../world/walk/townSolids'
import { townWalk } from '../../world/walk/townWalk'
import { setRiderCar } from './rider'

/**
 * 一緒に乗る仲間（docs/design/map-split.md §5 の「段 3 の作りの決めごと」）。先に立つ人（乗り物に歩いて乗る人）の仲間の一覧は Rider の party、
 * 仲間 1 人ずつの乗り物の間の様子は、その仲間の Rider の member（MemberRide）。
 *
 * - 仲間の一覧（party.add・party.remove）はいつでも出入りできる。ここは「今、仲間である物」だけを見る（外したら、ホバーは並走の場所を空けず、
 *   乗り込まない。乗っている途中で外したら、その場で離れる）
 * - いつ一緒に乗り込む・降りるか（joinRide・leaveRide を呼ぶ所）は使う側が決める（kanon-lab の KB-001 は src/kb001/follow.ts が花音の出来事
 *   character.on('ride.*') を聞いて呼ぶ）。仲間でも、先に立つ人から遠く離れている・別のゾーンにいるときは一緒に乗り込まない（joinRide が false）
 * - 仲間の道（MemberSlot。乗り込む・中で浮かぶ・降りる・並走する・回り込んで戻る）は乗り物ごとの乗る仕組みが作り（defineMemberSlots で登録）、
 *   道を進めるのは先に立つ人の乗る仕組みの毎コマの更新の中（updateParty。updateRiders。RideDriver の −79。花音が乗ったことになるコマを変えないため）。
 *   浮かぶ動き（ばね・車室と一緒に運ぶ・車室の中に収める）は仲間自身の毎コマの更新（character/avatar/float.ts）で、道は仲間の FloatState の
 *   car・attach・cabin・target・maxSpeed を書く
 * - 扉で待つ乗り物（観覧車）は、仲間が全員中に入るまで扉を閉めない（membersSettled）・閉まる途中も乗客（中にいる仲間を含む）が 0 になるまで待つ。
 *   時刻表で動く乗り物（緑電・運河バス・ケーブル）は待たない。ホバーは浮かぶ仲間がいれば並走の場所を空けた経路を選ぶ（partyEscorts）
 *
 * 段 3 で作るのは浮かぶ小さな仲間（Character の kind = 'float'）の道だけ。歩く 2 人目が一緒に乗る形（席と道）は型の名前だけ（段 5）。
 */

/** 仲間の乗り方: cabin = 車室の中へ乗り込む（観覧車・緑電・運河バス）、escort = 乗らずに車両の外を並走する（ケーブル・ホバー） */
export type MemberWay = 'cabin' | 'escort'

/** 仲間の段: none（一緒に乗っていない）・board（乗り込む途中）・inside（中で浮かぶ）・alight（降りる・回り込んで戻る途中）・escort（並走） */
export type MemberMode = 'none' | 'board' | 'inside' | 'alight' | 'escort'

/**
 * 仲間の道（便ごと。乗る仕組みが作る。前の付き添いの式と数のまま）。点は車室の局所。
 * 1 コマの進め方（updateParty）: 今の点に reach より近ければ次の点へ（holdAtDoor の間は初めの点で待つ）→ 車室に付く度合い（Rider の attach）を
 * attachRate で変える（attachGate を満たす間だけ）→ 終わり（end）を見る → 行き先を決める（aim の点。高さの上限 maxAbove・逃げる所 tuck）
 */
export interface MemberSlot {
  /** 道の便（車室の局所の点を、この便の今のコマの行列でシーンへ） */
  car: Car
  way: MemberWay
  /** 道の点（車室の局所）と、今の番号 */
  pts: THREE.Vector3[]
  index: number
  /** 今の点に着いたとする半径（m） */
  reach: number
  /**
   * 終わり: settle = 最後の点まで来て、前の点からの近さが settle より近ければ中に入った（inside。度合い 1）・release = 最後の点まで来て
   * 度合いが 0 になったら離れる・arrive = 初めから最後の点にいて settle より近ければ離れる・none = 終わらない（並走。使う側が leaveRide で終える）
   */
  end: 'settle' | 'release' | 'arrive' | 'none'
  settle: number
  /** 速さの上限（m/s）。speedNow があれば毎コマそれで決める（ホバーの浮く前と飛ぶ間） */
  speed: number
  speedNow: (() => number) | null
  /** 乗り始めの車室に付く度合いと、変える速さ（1/s。+ で上げる・− で下げる・0 で変えない）・変える所（局所の位置と今の番号。null ならいつも） */
  attach0: number
  attachRate: number
  attachGate: ((local: THREE.Vector3, index: number) => boolean) | null
  /** 扉で待つ: 初めの点の間、先に立つ人の足元（局所）がまだ扉の所にいれば進まない（扉の所で頭と重ならないように）。null なら待たない */
  holdAtDoor: ((leaderLocal: THREE.Vector3) => boolean) | null
  /** 最後の点を毎コマ決め直す（並走する所。最後の点まで来ている間だけ） */
  lastPoint: ((out: THREE.Vector3) => void) | null
  /** 行き先にする点: post = 進めたあとの点・pre = 進める前の点（緑電・運河バス）。終わったコマにも行き先を書くか */
  aim: 'pre' | 'post'
  aimOnEnd: boolean
  /** 最後の点が町の木の幹・建物にかかるときに逃げる所（局所。null なら逃げない） */
  tuck: THREE.Vector3 | null
  /** 行き先の高さの上限（地面から m。浮遊レーンの決まり。null なら見ない） */
  maxAbove: number | null
}

/** 乗る仕組みが登録する、仲間の道の作り方（乗り物の種類ごと） */
export interface MemberSlotSource {
  /** 乗り込む・並走を始める道（先に立つ人が今乗っている便で。乗り方が乗り物に合わなければ null） */
  join(leader: Character, way: MemberWay): MemberSlot | null
  /** 降りる・回り込んで戻る道（null = その場で離れる） */
  leave(leader: Character, slot: MemberSlot): MemberSlot | null
  /**
   * 任意: 先に立つ人が今の便を降りて立つ所（シーンの足元を out に入れ、そこで向く向きを返す。分からなければ null）。
   * 並走の乗り物（ケーブル・ホバー）だけ。遠く離れた仲間を、使う側が先に着く所へ行かせて待たせるのに使う（rideArrival）
   */
  arrival?(leader: Character, out: THREE.Vector3): number | null
}

/** 仲間 1 人ずつの、乗り物の間の様子（仲間の Rider の member） */
export interface MemberRide {
  mode: MemberMode
  /** 一緒に乗っている先に立つ人（乗っていなければ null） */
  leader: Character | null
  slot: MemberSlot | null
  /**
   * 道の行き先（シーン）。道を進めるたびに書き、仲間の FloatState の target へ写す。降りたあとも最後の行き先を残し、
   * 乗り込み・並走を始めたコマ（道を進める前）はこの値のまま（段 3-5 までの付き添いと同じ。初めは原点）
   */
  target: THREE.Vector3
}

export function createMemberRide(): MemberRide {
  return { mode: 'none', leader: null, slot: null, target: new THREE.Vector3() }
}

/** 先に立つ人の仲間の一覧（Rider の party。いつも一緒に乗る仲間。いつでも出入りできる） */
export class Party {
  /** 今の仲間（足した順） */
  readonly members: Character[] = []

  has(member: Character) {
    return this.members.includes(member)
  }

  /** 仲間に入れる（もういれば何もしない）。乗っている途中で入れても、次に乗るまで一緒には乗らない（乗り込むかは使う側が joinRide で決める） */
  add(member: Character) {
    if (!this.has(member)) this.members.push(member)
  }

  /** 仲間から外す。この先に立つ人と一緒に乗っている途中なら、その場で離れる（leaveRide(member, 'now')） */
  remove(member: Character) {
    const i = this.members.indexOf(member)
    if (i < 0) return
    this.members.splice(i, 1)
    const mr = member.ride.member
    if (mr.mode !== 'none' && mr.leader?.ride.party === this) leaveRide(member, 'now')
  }
}

const SOURCES = new Map<VehicleId, MemberSlotSource>()

/** 乗り物の種類の、仲間の道の作り方を登録する（乗る仕組みのファイルが読み込み時に 1 回） */
export function defineMemberSlots(vehicle: VehicleId, source: MemberSlotSource) {
  SOURCES.set(vehicle, source)
}

/** 先に立つ人が今乗っている便で、仲間が乗り込む・並走を始める道（乗っていない・乗り方が合わなければ null） */
export function memberSlot(leader: Character, way: MemberWay): MemberSlot | null {
  const car = leader.ride.car
  if (!car) return null
  return SOURCES.get(car.vehicle.id)?.join(leader, way) ?? null
}

/**
 * 先に立つ人が今乗っている便を降りて立つ所（シーンの足元を out に入れ、そこで向く向きを返す）。乗っていない・乗り物が知らせない
 * （車室の中へ乗る乗り物）なら null。仲間でない物を先に着く所へ行かせて待たせるときに、使う側が呼ぶ（毎コマは呼ばない）
 */
export function rideArrival(leader: Character, out: THREE.Vector3): number | null {
  const car = leader.ride.car
  if (!car) return null
  return SOURCES.get(car.vehicle.id)?.arrival?.(leader, out) ?? null
}

/** 一緒に乗り込むのは、先に立つ人からこの距離（m）の内で、同じゾーンにいる仲間だけ */
export const JOIN_RANGE = 10

/** 仲間が一緒に乗っている途中か（乗り込み・中・降りる・並走・回り込んで戻る途中） */
export function memberBusy(member: Character) {
  return member.ride.member.mode !== 'none'
}

/**
 * 仲間 member が、先に立つ人 leader の今の便に一緒に乗り込む・並走を始める（使う側が先に立つ人の出来事を聞いて呼ぶ）。
 * 仲間でない・もう一緒に乗っている途中（前の降りる途中など。使う側が待つ）・先に立つ人が乗っていない・遠く離れている・別のゾーンにいる・
 * 浮かぶ仲間でない（歩く仲間は段 5）・乗り方が乗り物に合わないなら、何もしないで false
 */
export function joinRide(member: Character, leader: Character, way: MemberWay): boolean {
  const f = member.float
  const mr = member.ride.member
  if (!f || !leader.ride.party.has(member) || mr.mode !== 'none') return false
  if (member.motion.zone !== leader.motion.zone || member.motion.position.distanceTo(leader.motion.position) > JOIN_RANGE) return false
  const slot = memberSlot(leader, way)
  if (!slot) return false
  const r = member.ride
  mr.mode = way === 'cabin' ? 'board' : 'escort'
  mr.leader = leader
  mr.slot = slot
  r.attach = slot.attach0
  r.inside = false
  if (way === 'cabin') {
    // 車室の中へ乗り込む仲間は乗客の一覧に入る（観覧車の扉は、閉まる途中も乗客が 0 になるまで待つ）
    setRiderCar(r, slot.car)
    r.phase = 'board'
  }
  f.car = slot.car
  f.attach = r.attach
  f.cabin = null
  f.maxSpeed = slot.speed
  // 道を進める前のこのコマは、前の道の最後の行き先のまま（段 3-5 までと同じ）
  f.target.copy(mr.target)
  return true
}

/**
 * 仲間が一緒に乗るのをやめる。how = alight（乗り物の決まった道で降りる・回り込んで戻る。道が無ければその場で離れる）・now（その場で離れる）。
 * 一緒に乗っていなければ何もしないで false
 */
export function leaveRide(member: Character, how: 'alight' | 'now'): boolean {
  const mr = member.ride.member
  const slot = mr.slot
  if (mr.mode === 'none' || !slot || !mr.leader || (how === 'alight' && mr.mode === 'alight')) return false
  const next = how === 'alight' ? (SOURCES.get(slot.car.vehicle.id)?.leave(mr.leader, slot) ?? null) : null
  const f = member.float
  const r = member.ride
  if (next) {
    mr.mode = 'alight'
    mr.slot = next
    r.attach = next.attach0
    r.inside = false
    if (next.way === 'cabin') r.phase = 'alight'
    if (f) {
      f.car = next.car
      f.attach = r.attach
      f.cabin = null
      f.maxSpeed = next.speed
    }
    return true
  }
  mr.mode = 'none'
  mr.slot = null
  mr.leader = null
  r.attach = 0
  r.inside = false
  r.phase = 'none'
  setRiderCar(r, null)
  if (f) {
    f.car = null
    f.attach = 0
    f.cabin = null
  }
  return true
}

/** 先に立つ人の、便 car で一緒に乗っている仲間がみな落ち着いたか（乗り込む途中の仲間がいない。観覧車は、これと座ったので扉を閉める） */
export function membersSettled(leader: Character, car: Car): boolean {
  const list = leader.ride.party.members
  for (let i = 0; i < list.length; i++) {
    const mr = list[i].ride.member
    if (mr.leader === leader && mr.slot?.car === car && mr.mode === 'board') return false
  }
  return true
}

/** 便 car で一緒に乗っている仲間を、みなその場で離す（先に立つ人が別の所へ置き直されたときなど） */
export function releaseParty(leader: Character, car: Car) {
  const list = leader.ride.party.members
  for (let i = list.length - 1; i >= 0; i--) {
    const mr = list[i].ride.member
    if (mr.leader === leader && mr.slot?.car === car) leaveRide(list[i], 'now')
  }
}

/** 先に立つ人の仲間に、並走する（浮かぶ）仲間がいるか（ホバーの経路で並走の場所を空ける。遠く離れていても仲間なら空ける） */
export function partyEscorts(leader: Character): boolean {
  const list = leader.ride.party.members
  for (let i = 0; i < list.length; i++) if (list[i].kind === 'float') return true
  return false
}

const _local = new THREE.Vector3()
const _lead = new THREE.Vector3()

/**
 * 毎コマ（先に立つ人の乗る仕組みの更新の中。updateRiders。RideDriver の −79）: 便 car で一緒に乗っている仲間の道を 1 コマ進め、仲間の FloatState の
 * target・attach・maxSpeed（中に入ったら cabin）を書く。仲間の位置は前のコマの仲間の更新のあとの位置
 */
export function updateParty(leader: Character, car: Car, dt: number) {
  const list = leader.ride.party.members
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    const mr = m.ride.member
    if (mr.leader !== leader || !mr.slot || mr.slot.car !== car) continue
    stepMember(m, leader, mr, mr.slot, dt)
  }
}

function stepMember(member: Character, leader: Character, mr: MemberRide, s: MemberSlot, dt: number) {
  const car = s.car
  const pts = s.pts
  const last = pts.length - 1
  const r = member.ride
  if (s.speedNow) s.speed = s.speedNow()
  let p = pts[Math.min(s.index, last)]
  let ended = false
  if (mr.mode !== 'inside') {
    const local = car.toCabin(member.motion.position, _local)
    const i0 = s.index
    const d0 = local.distanceTo(p)
    if (s.lastPoint && i0 >= last) s.lastPoint(pts[last])
    const hold = s.holdAtDoor !== null && i0 === 0 && s.holdAtDoor(car.toCabin(leader.motion.position, _lead))
    if (d0 < s.reach && i0 < last && !hold) s.index++
    if (s.attachRate !== 0 && (!s.attachGate || s.attachGate(local, s.index))) r.attach = THREE.MathUtils.clamp(r.attach + s.attachRate * dt, 0, 1)
    if (s.end === 'settle' && s.index === last && d0 < s.settle) {
      mr.mode = 'inside'
      r.attach = 1
      r.inside = true
      if (s.way === 'cabin') r.phase = 'riding'
      if (member.float) member.float.cabin = car.vehicle.cabin.clampMember ? car : null
    } else if (s.end === 'release' && s.index === last && r.attach <= 0) ended = true
    else if (s.end === 'arrive' && i0 === last && d0 < s.settle) ended = true
    if (s.aim === 'post') p = pts[Math.min(s.index, last)]
  }
  if (!ended || s.aimOnEnd) {
    const t = car.toWorld(p.x, p.y, p.z, mr.target)
    if (s.maxAbove !== null) {
      // 浮遊レーンの決まり（地上 5m 以下）
      const g = townWalk.ready ? townWalk.groundY(t.x, t.z, t.y) : t.y - 2
      if (t.y - g > s.maxAbove) t.y = g + s.maxAbove
    }
    // 並ぶ所が町の木の幹・建物にかかるなら、逃げる所へ（通り過ぎたら戻る）
    if (s.tuck && s.index === last && townSolids.blocker(t.x, t.y, t.z, 0.3)) car.toWorld(s.tuck.x, s.tuck.y, s.tuck.z, t)
  }
  if (ended) {
    leaveRide(member, 'now')
    return
  }
  const f = member.float
  if (f) {
    f.target.copy(mr.target)
    f.attach = r.attach
    f.maxSpeed = s.speed
  }
}
