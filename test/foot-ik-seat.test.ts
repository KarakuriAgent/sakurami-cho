/**
 * 足の高さ合わせ（character/avatar/footIk.ts の applyFootIk）の、座っている間の形:
 *   - 傾いた車室（ケーブルカーの急な区間は 10.9°）の長いすに座ると、前に出した足の下の床は座面の下より低い（谷を向く）・高い（山を向く）。
 *     どの傾き・向きでも、腰は座面から動かさず（沈めない）、足首だけを足の下の床から平らな所と同じ高さへまっすぐ上げ下げする
 *   - 立っている間は今までどおり、低い方の足に合わせて腰を下げる
 *
 * 人と VRM は、足の高さ合わせが読む所だけの代わり（腰・太もも・すね・足の骨と、乗っている車室の床）。座る姿勢は太ももを前へ 1.36 rad・
 * 膝を 1.38 rad 曲げた形（character/avatar/body.ts の sit とおよそ同じ）。座る脚は、本当の VRM のように膝・足首の骨が脚の線から少し横・前後へ
 * ずれ、太ももを少し外へ開く（脚が 1 つの面に収まらない）。毎コマ姿勢を置き直してから掛ける（使う側のコードの姿勢と同じ）
 */
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { Character } from '../character/avatar/character.ts'
import { applyFootIk, type FootIkState } from '../character/avatar/footIk.ts'
import { defineVehicle, type Car } from '../world/outdoor/transit/vehicle.ts'

/** 太もも・すねの長さ、股関節の左右の間の半分、座面の高さ、座面から股関節まで */
const THIGH = 0.4
const SHIN = 0.38
const HIP_X = 0.08
const SEAT_H = 0.42
const SEAT_TO_HIP = 0.1
/** 座る姿勢の太もも・膝の曲げ（rad） */
const SIT_THIGH = 1.36
const SIT_KNEE = 1.38
/** 立つ姿勢の太もも・膝の曲げ（rad。脚が伸びきらない少しの曲げ） */
const STAND_THIGH = 0.1
const STAND_KNEE = 0.2

/** 車室の床（局所の y = 0。幅 2m・長さ 6m） */
const vehicle = defineVehicle({
  id: 'cable',
  label: '試し',
  cabin: { inside: () => true, floorAt: (x, z) => (Math.abs(x) < 1 && Math.abs(z) < 3 ? 0 : null), center: new THREE.Vector3() },
  poseOf: (_car, out) => out.identity(),
  nextBoarding: () => null,
  arrival: () => null,
  glassBox: false,
})

/** 町の中（ラボから離れた所）で、進む向き（局所の +z）が pitch（度）だけ上を向いた車室 */
function tiltedCar(pitch: number): Car {
  const car = vehicle.car(Math.round(pitch * 1000))
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (-pitch * Math.PI) / 180)
  car.setPose(new THREE.Matrix4().compose(new THREE.Vector3(500, 20, 500), q, new THREE.Vector3(1, 1, 1)), true)
  return car
}

interface Rig {
  vrm: VRM
  group: THREE.Group
  hips: THREE.Object3D
  legs: { up: THREE.Object3D; low: THREE.Object3D; foot: THREE.Object3D }[]
}

/** 腰・太もも・すね・足の骨（VRM の正規化した骨と同じ向き: 前が +z、X 軸まわりに − で太ももが前へ）。skew = 膝・足首の骨を脚の線からずらす */
function makeRig(skew: boolean): Rig {
  const group = new THREE.Group()
  const scene = new THREE.Group()
  group.add(scene)
  const hips = new THREE.Object3D()
  scene.add(hips)
  const bones: Record<string, THREE.Object3D> = { hips }
  const legs = ([1, -1] as const).map((side) => {
    const up = new THREE.Object3D()
    up.position.set(side * HIP_X, -0.05, 0)
    const low = new THREE.Object3D()
    low.position.set(skew ? side * 0.012 : 0, -THIGH, skew ? 0.015 : 0)
    const foot = new THREE.Object3D()
    foot.position.set(skew ? -side * 0.01 : 0, -SHIN, skew ? -0.02 : 0)
    hips.add(up)
    up.add(low)
    low.add(foot)
    const n = side > 0 ? 'left' : 'right'
    bones[`${n}UpperLeg`] = up
    bones[`${n}LowerLeg`] = low
    bones[`${n}Foot`] = foot
    return { up, low, foot }
  })
  const rest = Object.fromEntries(['leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'].map((n) => [n, { position: bones[n].position.toArray() }]))
  const vrm = { scene, humanoid: { getNormalizedBoneNode: (name: string) => bones[name] ?? null, normalizedRestPose: rest } } as unknown as VRM
  return { vrm, group, hips, legs }
}

/** 姿勢を置き直す（座る: 太ももを前へ・膝を曲げる。立つ: 膝を少し曲げる）。腰の位置は置き直さない（足の高さ合わせが前のコマの分を引く） */
function pose(rig: Rig, sit: boolean) {
  rig.legs.forEach((l, i) => {
    l.up.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), sit ? -SIT_THIGH : -STAND_THIGH)
    // 座るときは太ももを少し外へ開く（左は +z まわり・右は −z まわり）
    if (sit) l.up.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), i === 0 ? 0.1 : -0.1))
    l.low.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), sit ? SIT_KNEE : STAND_KNEE)
  })
}

/**
 * 車室の真ん中の長いす（局所の z = 0、座面の高さ SEAT_H）に、heading（シーン）の向きで座る（sit = false なら、その所に立つ）。
 * 腰・足元の決め方は乗り物の乗る仕組み（ケーブルカーの seatFeet）と同じ: 座面の真ん中の SEAT_TO_HIP 上に股関節、足元の高さ motion.ground は
 * 座面の高さから SEAT_H 下。60 コマ掛けたあとの、股関節（腰）の高さの動きと、足首ごとの「足の下の床からの高さ」
 */
function settle(pitch: number, heading: number, sit: boolean) {
  const car = tiltedCar(pitch)
  const rig = makeRig(sit)
  const seat = car.toWorld(0, sit ? SEAT_H : 0, 0, new THREE.Vector3())
  const ground = seat.y - (sit ? SEAT_H : 0)
  // 股関節（太ももの付け根）の高さ: 座る = 座面 + SEAT_TO_HIP、立つ = 足首が床の上 0.06m に来る高さ
  const hipY = sit ? seat.y + SEAT_TO_HIP : ground + 0.06 + THIGH * Math.cos(STAND_THIGH) + SHIN * Math.cos(STAND_KNEE - STAND_THIGH)
  rig.group.position.set(seat.x, 0, seat.z)
  rig.group.rotation.y = heading
  rig.hips.position.set(0, hipY + 0.05, 0)
  const motion = {
    position: new THREE.Vector3(seat.x, ground, seat.z),
    ground,
    outside: true,
    walk: 0,
    action: sit ? 'sit' : 'present',
    actionBlend: 1,
    seat: sit ? { height: SEAT_H, shift: -0.4, hands: 'lap' } : null,
  }
  const ch = { motion, ride: { phase: 'riding', car } } as unknown as Character
  const st: FootIkState = { dL: 0, dR: 0, drop: 0, lift: 0, applied: 0, lastY: null }
  const before = new THREE.Vector3()
  for (let i = 0; i < 60; i++) {
    pose(rig, sit)
    rig.group.updateMatrixWorld(true)
    if (i === 0) rig.hips.getWorldPosition(before)
    applyFootIk(ch, rig.vrm, st, 1 / 30, 0)
  }
  rig.group.updateMatrixWorld(true)
  const hips = rig.hips.getWorldPosition(new THREE.Vector3())
  const feet = rig.legs.map((l) => {
    const p = l.foot.getWorldPosition(new THREE.Vector3())
    // p = 座面の真ん中（の真下）から見た足首の平面の位置と、高さ
    return { p: new THREE.Vector3(p.x - seat.x, p.y, p.z - seat.z), aboveFloor: p.y - car.floorAt(p.x, p.z, false, p.y)! }
  })
  return { hipsMoved: hips.y - before.y, feet }
}

/** 車室の向き（シーンの +z）に対して、谷を向く・山を向く・横を向く */
const FACINGS = [
  ['谷を向く', Math.PI],
  ['山を向く', 0],
  ['横を向く', Math.PI / 2],
] as const
const PITCHES = [0, 2, 5, 8, 10.9, 14]

describe('座っている間の足の高さ合わせ（傾いた車室の長いす）', () => {
  // 平らな車室で座ったときの、足首の床からの高さ（姿勢のまま。どの傾きでもこれにそろう）
  const flat = settle(0, Math.PI, true).feet[0].aboveFloor

  test('平らな車室では何も動かさない', () => {
    const r = settle(0, Math.PI, true)
    expect(Math.abs(r.hipsMoved)).toBeLessThan(1e-9)
    for (const f of r.feet) expect(Math.abs(f.aboveFloor - flat)).toBeLessThan(1e-9)
  })

  for (const [label, heading] of FACINGS) {
    for (const pitch of PITCHES) {
      test(`${label}・傾き ${pitch}°: 腰は座面から動かず、足首は足の下の床から平らな所と同じ高さ`, () => {
        const r = settle(pitch, heading, true)
        // 腰を座面に沈めない（前は谷を向く 10.9° で 7cm ほど下げていた）
        expect(Math.abs(r.hipsMoved)).toBeLessThan(0.001)
        for (const f of r.feet) expect(Math.abs(f.aboveFloor - flat)).toBeLessThan(0.003)
      })
    }
  }

  test('足首はまっすぐ上げ下げする（前後・左右へずらさない）', () => {
    for (const [, heading] of FACINGS) {
      const level = settle(0, heading, true).feet
      const tilted = settle(10.9, heading, true).feet
      // 座面の真ん中から見た平面の位置を比べる
      tilted.forEach((f, i) => expect(Math.hypot(f.p.x - level[i].p.x, f.p.z - level[i].p.z)).toBeLessThan(0.002))
    }
  })
})

describe('立っている間の足の高さ合わせ（今までどおり）', () => {
  test('傾いた床に立つと、低い方の足に合わせて腰を下げる', () => {
    // 横を向いて立つと、左右の足の下の床の高さが違う（股関節の間 2 × HIP_X × tan（傾き））
    const r = settle(10.9, Math.PI / 2, false)
    const lower = HIP_X * Math.tan((10.9 * Math.PI) / 180)
    expect(r.hipsMoved).toBeCloseTo(-lower, 3)
    // 足首は、どちらも床の上 0.06m
    for (const f of r.feet) expect(f.aboveFloor).toBeCloseTo(0.06, 3)
  })
})
