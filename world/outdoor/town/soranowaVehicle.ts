import * as THREE from 'three'
import { CABIN, CABIN_SPOTS, rideDegrees, SORANOWA, WHEEL_OMEGA } from '../../../core/soranowa'
import { outdoor } from '../../environment/daylight'
import { defineVehicle, type CabinSpec } from '../transit/vehicle'
import { DEG_BOARD_OPEN, DEG_BOARD_STEP, DEG_EXIT_OPEN, pivotScene, wheel } from './soranowaWheel'

/**
 * 乗り物としての観覧車ソラノワ（transit/vehicle.ts の Vehicle。ゴンドラの中の形・乗り場・中の光。地図の持ち物）。
 * ホイールの回り方と扉・灯りの状態は soranowaWheel.ts。乗る仕組みは character/ride/ride.ts。docs/design/town.md §17
 */

const _rot = new THREE.Matrix4().makeRotationY(SORANOWA.axis)
const _pv = new THREE.Vector3()
const DEG_PER_SEC = (WHEEL_OMEGA * 180) / Math.PI

/** ゴンドラの中（局所。原点 = 吊る軸。扉は −z の面。ゴンドラはいつも水平で、向きはホイールの局所と同じ） */
const gondolaCabin: CabinSpec = {
  inside: (l, margin = 0) => Math.abs(l.x) < CABIN.innerW - margin && Math.abs(l.z) < CABIN.innerD - margin && l.y > CABIN.floor - 0.05 && l.y < CABIN.ceiling + 0.05,
  floorAt(x, z, door) {
    const inside = Math.abs(x) < CABIN.innerW && Math.abs(z) < CABIN.innerD
    // 乗り降りの途中は、扉の敷居から台までのすき間（0.2m）も床にする
    const sill = door && Math.abs(x) < CABIN.doorW / 2 + 0.15 && z < 0 && z > -CABIN.halfD - 0.3
    return inside || sill ? CABIN.floor : null
  },
  center: new THREE.Vector3(0, -2.3, 0),
  clampMember(l) {
    if (gondolaCabin.inside(l, 0.2)) return
    l.x = THREE.MathUtils.clamp(l.x, -1.0, 1.0)
    l.z = THREE.MathUtils.clamp(l.z, -0.9, 0.9)
    l.y = THREE.MathUtils.clamp(l.y, -3.25, -1.25)
  },
}

/**
 * 観覧車ソラノワ（便 = ゴンドラの番号）。ゴンドラは止まらずに回るので、扉が開く「乗り場」は一番下の台の上だけ（at = 'exit' は降りる扉が開く所）
 */
export const soranowaVehicle = defineVehicle({
  id: 'soranowa',
  label: '大観覧車ソラノワ',
  cabin: gondolaCabin,
  glassBox: true,
  poseOf(car, out) {
    pivotScene(car.run, wheel.angle, _pv)
    return out.copy(_rot).setPosition(_pv)
  },
  nextBoarding(q) {
    // 扉が開く所まで lead 秒（既定 0.4° ぶん）より先のゴンドラ
    const minDeg = Math.max(0.4, (q.lead ?? 0) * DEG_PER_SEC)
    let best = -1
    let bestRemain = Infinity
    for (let i = 0; i < SORANOWA.gondolas; i++) {
      let remain = (DEG_BOARD_OPEN - rideDegrees(i, wheel.angle) + 360) % 360
      if (remain < minDeg) remain += 360
      if (remain < bestRemain) {
        bestRemain = remain
        best = i
      }
    }
    if (best < 0) return null
    const waitSec = bestRemain / DEG_PER_SEC
    return { run: best, waitSec, closeSec: waitSec + (DEG_BOARD_STEP - DEG_BOARD_OPEN + 360) % 360 / DEG_PER_SEC, departSec: null, side: 0 }
  },
  arrival(run, at) {
    if (at !== 'exit') return null
    const deg = rideDegrees(run, wheel.angle)
    return Math.max(0, (DEG_EXIT_OPEN - deg) / DEG_PER_SEC)
  },
  light(car, _seat, head, out) {
    const lamp = wheel.cabinLamp
    const l = CABIN_SPOTS.lamp
    const p = car.toWorld(0, CABIN.floor + l[1], 0, _pv)
    out.dir.subVectors(p, head).normalize()
    out.color.setRGB(1.0, 0.86, 0.68).multiplyScalar(3)
    const led = outdoor.soranowa
    out.intensity = 0.62 * lamp + 0.06 * led
    out.ambient.setRGB(0.058 * lamp + 0.016 * led, 0.052 * lamp + 0.013 * led, 0.044 * lamp + 0.01 * led)
    return 1 - THREE.MathUtils.smoothstep(outdoor.daylight, 0.05, 0.38)
  },
})

/**
 * 観覧車を営業時間の外でも回すか（町の毎コマの初め town.begin が毎コマ updateWheel に渡す）: ゴンドラの乗客の一覧に人がいる（待つ・乗り込む・乗っている・降りる途中）か、
 * 降りたあと扉が閉まる途中のゴンドラがある（wheel.closing）
 */
export function soranowaHeld() {
  const cars = soranowaVehicle.cars
  for (let i = 0; i < cars.length; i++) if (cars[i].passengers.length > 0) return true
  return wheel.closing
}
