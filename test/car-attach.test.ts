/**
 * 車室と一緒に運ぶ口（world/outdoor/transit/vehicle.ts の Car。docs/design/map-split.md §5 の「段 3 の作りの決めごと」）のテスト:
 *   - 登録する形（car.attach）で運んだ位置と向きが、引く形（car.carry・car.deltaQuat）と同じ
 *   - 強さ（weight）0.5 なら半分だけ運ぶ・detach の後は動かない・乗り始め（setPose の first）では動かさない
 */
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { defineVehicle, type Car } from '../world/outdoor/transit/vehicle.ts'

/** 試しの乗り物（車室の決まりは使わない） */
function testCar(): Car {
  const v = defineVehicle({
    id: 'tram',
    label: '試し',
    cabin: { inside: () => true, floorAt: () => 0, center: new THREE.Vector3() },
    poseOf: (_car, out) => out.identity(),
    nextBoarding: () => null,
    arrival: () => null,
    glassBox: false,
  })
  return v.car(0)
}

/** 位置 (x, y, z)・y 軸まわりに yaw 回した車室の行列 */
function pose(x: number, y: number, z: number, yaw: number) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1))
}

/** 車室の中に置いた物（シーンの直下） */
function prop() {
  const o = new THREE.Object3D()
  o.position.set(1.2, 0.8, -0.4)
  o.quaternion.setFromEuler(new THREE.Euler(0.1, 0.4, -0.2))
  return o
}

const close = (a: THREE.Vector3, b: THREE.Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-12)
const closeQ = (a: THREE.Quaternion, b: THREE.Quaternion) => expect(Math.abs(Math.abs(a.dot(b)) - 1)).toBeLessThan(1e-12)

describe('car.attach（登録する形）', () => {
  test('運んだ位置と向きが car.carry・car.deltaQuat と同じ（動かして回したコマ）', () => {
    const car = testCar()
    car.setPose(pose(10, 2, -5, 0.3), true)
    const o = prop()
    const p0 = o.position.clone()
    const q0 = o.quaternion.clone()
    car.attach(o)
    car.setPose(pose(10.5, 2.1, -4.6, 0.55), false)
    // 引く形で同じコマの動きを運んだもの
    close(o.position, car.carry(p0.clone(), 1))
    closeQ(o.quaternion, car.deltaQuat.clone().multiply(q0))
    // 車室の局所で見ると同じ所に居る（車室と一緒に動いた）
    const before = p0.clone().applyMatrix4(pose(10, 2, -5, 0.3).invert())
    close(car.toCabin(o.position), before)
  })

  test('weight 0.5 は半分だけ運ぶ', () => {
    const car = testCar()
    car.setPose(pose(0, 0, 0, 0), true)
    const o = prop()
    const p0 = o.position.clone()
    const q0 = o.quaternion.clone()
    const a = car.attach(o, 0.5)
    expect(a.weight).toBe(0.5)
    // まっすぐ動かすだけなら、動きのちょうど半分
    car.setPose(pose(2, 0.4, -1, 0), false)
    close(o.position, p0.clone().add(new THREE.Vector3(1, 0.2, -0.5)))
    closeQ(o.quaternion, q0)
    // 回したら、引く形の carry(位置, 0.5) と identity.slerp(deltaQuat, 0.5) と同じ
    const p1 = o.position.clone()
    const q1 = o.quaternion.clone()
    car.setPose(pose(2.3, 0.4, -1.2, 0.8), false)
    close(o.position, car.carry(p1.clone(), 0.5))
    closeQ(o.quaternion, new THREE.Quaternion().slerp(car.deltaQuat, 0.5).multiply(q1))
    // 向きの変わりも半分（0.8 の半分の 0.4 だけ回る）
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4).multiply(q1)
    closeQ(o.quaternion, turned)
  })

  test('detach の後は動かない（attach の戻り値でも、物でも外せる）', () => {
    const car = testCar()
    car.setPose(pose(0, 0, 0, 0), true)
    const o1 = prop()
    const o2 = prop()
    const a1 = car.attach(o1)
    car.attach(o2)
    car.setPose(pose(1, 0, 0, 0.2), false)
    car.detach(a1)
    car.detach(o2)
    expect(car.attachments.length).toBe(0)
    const p1 = o1.position.clone()
    const q1 = o1.quaternion.clone()
    const p2 = o2.position.clone()
    car.setPose(pose(3, 1, 2, 1.0), false)
    expect(o1.position.equals(p1)).toBe(true)
    expect(o1.quaternion.equals(q1)).toBe(true)
    expect(o2.position.equals(p2)).toBe(true)
  })

  test('乗り始め（first）のコマでは動かさない', () => {
    const car = testCar()
    car.setPose(pose(0, 0, 0, 0), true)
    const o = prop()
    car.attach(o)
    const p0 = o.position.clone()
    const q0 = o.quaternion.clone()
    // 別の所から乗り始め直す（便を使い回す）: 前のコマの動きは足さない
    car.setPose(pose(50, 3, 20, 1.3), true)
    expect(o.position.equals(p0)).toBe(true)
    expect(o.quaternion.equals(q0)).toBe(true)
    // 次のコマからは運ぶ
    car.setPose(pose(51, 3, 20, 1.3), false)
    close(o.position, p0.clone().add(new THREE.Vector3(1, 0, 0)))
  })

  test('weight 0 は運ばない（あとから強さを上げると次のコマから運ぶ）', () => {
    const car = testCar()
    car.setPose(pose(0, 0, 0, 0), true)
    const o = prop()
    const a = car.attach(o, 0)
    const p0 = o.position.clone()
    car.setPose(pose(1, 0, 0, 0.5), false)
    expect(o.position.equals(p0)).toBe(true)
    a.weight = 1
    car.setPose(pose(2, 0, 0, 0.5), false)
    close(o.position, p0.clone().add(new THREE.Vector3(1, 0, 0)))
  })
})
