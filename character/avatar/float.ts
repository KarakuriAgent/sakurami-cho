import * as THREE from 'three'
import { zoneOfPoint } from '../../core/interiors'
import type { Car } from '../../world/outdoor/transit/vehicle'
import type { Character } from './character'

/**
 * 浮かんで動く種類のキャラクター（Character の kind = 'float'。docs/design/map-split.md §5 の「段 3 の作りの決めごと」）の共通の仕組み。
 * 位置は ch.motion.position（本体の中心。描くときの揺れは含まない）、向きは yaw（ch.motion.heading にも写す）。
 * ここは「行き先へばねで寄る・速さの上限・乗り物の車室に付いて運ばれる・車室の中に収める・向きを寄せる」だけを持ち、
 * どこへ行くか（行き先・ばねの強さ・速さの上限・向く先・押し出し）は使う側の制御が毎コマ決めて書く（kanon-lab の KB-001 は src/kb001/follow.ts）。
 * 乗り物で一緒に乗る仲間（character/ride/party.ts）の間は、行き先・速さの上限・運ばれる便と度合い・収める便を仲間の道が書く（使う側はそのままにする）。
 * 毎コマの呼ぶ順は使う側が決める（kanon-lab は kb001/KB001.tsx: floatCarry → 行き先 → floatStep → 押し出し → floatClampCabin → floatYaw）
 */

/** 浮かんで動く物の状態（Character ごと。ch.float） */
export interface FloatState {
  /** 速さ（m/s。ワールド座標） */
  vel: THREE.Vector3
  /** 行き先（ワールド座標。使う側の制御が毎コマ書く。一緒に乗る仲間の間は仲間の道が書く） */
  target: THREE.Vector3
  /** ばねの強さ（臨界減衰のばねの角振動数。使う側が毎コマ選ぶ） */
  stiffness: number
  /** 速さの上限（m/s。使う側が毎コマ選ぶ。一緒に乗る仲間の間は仲間の道が書く） */
  maxSpeed: number
  /** 向き（Y 軸まわり、0 = +Z 向き。floatYaw が ch.motion.heading にも写す） */
  yaw: number
  /** 向く先（使う側が毎コマ書く） */
  yawTarget: number
  /** 車室に付いて運ばれる便と度合い（0〜1。0 なら運ばれない）。一緒に乗る仲間の道（character/ride/party.ts）が書く */
  car: Car | null
  attach: number
  /** 中に収める便の車室（null なら収めない）。一緒に乗る仲間の道が、中に入ったら書く */
  cabin: Car | null
  /** 車室の動きを最後に足した便の serial（便の動きは 1 コマに 1 回だけ足す。-1 = まだ足していない） */
  carried: number
}

/** 浮かんで動く物の状態を作る（character/avatar/createCharacter.ts の kind = 'float'）。向きは heading から */
export function createFloatState(position: THREE.Vector3, heading: number): FloatState {
  return {
    vel: new THREE.Vector3(),
    target: position.clone(),
    stiffness: 2.3,
    maxSpeed: 2.4,
    yaw: heading,
    yawTarget: heading,
    car: null,
    attach: 0,
    cabin: null,
    carried: -1,
  }
}

/** 向きを寄せる速さ（1/s） */
const YAW_RATE = 4

const _dq = new THREE.Quaternion()
const _tmp = new THREE.Vector3()

/**
 * 車室に付いて運ぶ（ch.float.car と attach が決まっている間）。便の動きを回転込みで位置に足し、速さも便の向きの変わりの分だけ回す
 * （緑電・運河バスが曲がる間・早送りで 1 コマに大きく曲がっても、車室の中の同じ所に残る）。便の動きは serial ごとに 1 回だけ（引く形の car.carry・car.deltaQuat）
 */
export function floatCarry(ch: Character) {
  const f = ch.float
  if (!f) return
  const car = f.car
  if (f.attach > 0 && car && f.carried !== car.serial) {
    f.carried = car.serial
    car.carry(ch.motion.position, f.attach)
    f.vel.applyQuaternion(_dq.identity().slerp(car.deltaQuat, f.attach))
  }
}

/** 行き先へ寄る（臨界減衰のばね → 速さの上限 → 進める）。dt = 前のコマからの秒（使う側が丸めた値） */
export function floatStep(ch: Character, dt: number) {
  const f = ch.float
  if (!f) return
  const pos = ch.motion.position
  const w = f.stiffness
  _tmp.subVectors(f.target, pos).multiplyScalar(w * w).addScaledVector(f.vel, -2 * w)
  f.vel.addScaledVector(_tmp, dt)
  if (f.vel.length() > f.maxSpeed) f.vel.setLength(f.maxSpeed)
  pos.addScaledVector(f.vel, dt)
}

/** 中に収める便（ch.float.cabin）があれば、車室の壁と天井の内側に収める（車室の形の clampMember） */
export function floatClampCabin(ch: Character) {
  const f = ch.float
  const car = f?.cabin
  const clamp = car?.vehicle.cabin.clampMember
  if (!car || !clamp) return
  const pos = ch.motion.position
  const l = car.toCabin(pos, _tmp)
  if (!car.inside(l, 0.2)) {
    clamp(l)
    car.toWorld(l.x, l.y, l.z, pos)
  }
}

/**
 * 向きを向く先（ch.float.yawTarget）へ寄せ、動きの欄（heading = yaw・moveDir = 水平に進む向き・zone）を書く。毎コマの最後に（位置が決まったあと）
 */
export function floatYaw(ch: Character, dt: number) {
  const f = ch.float
  if (!f) return
  const diff = Math.atan2(Math.sin(f.yawTarget - f.yaw), Math.cos(f.yawTarget - f.yaw))
  f.yaw += diff * (1 - Math.exp(-dt * YAW_RATE))
  const m = ch.motion
  m.heading = f.yaw
  const h = Math.hypot(f.vel.x, f.vel.z)
  if (h > 1e-4) m.moveDir.set(f.vel.x / h, 0, f.vel.z / h)
  m.zone = zoneOfPoint(m.position.x, m.position.z)
}

/** その場へ置き直す（止まった状態で。遠くへ一緒に跳ぶときなど） */
export function placeFloat(ch: Character, p: THREE.Vector3) {
  const f = ch.float
  if (!f) return
  ch.motion.position.copy(p)
  f.vel.set(0, 0, 0)
}
