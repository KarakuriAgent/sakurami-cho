/**
 * 手を伸ばす腕の角度（character/avatar/body.ts の reachArm）と、なでる（pet）姿勢:
 *   - 解いた角度を、見た目の腕の向きの式（character/avatar/characterVisual.ts の applyBodyPose と同じ回転）で戻すと、手のひらの真ん中が行き先に来る
 *   - 届かない行き先では、伸ばした腕が行き先の方を指す
 *   - pet は右腕だけを重ねる（ACTION_PART）。なでる物が遠い間は手を前に出して待ち、肩より上を指さない
 */
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { ACTION_PART, actionPose, armReach, createBodyMetrics, createPose, PET_REACH, reachArm, type ArmPose, type BodyPoint } from '../character/avatar/body.ts'

/** 体の寸法（2026-10-05 の VRM に近い値） */
const body = { ...createBodyMetrics(), hipHeight: 1.0, shoulderAboveHip: 0.36, upperArm: 0.28, foreArm: 0.23, shoulderHalf: 0.15 }
const PALM = 0.07

/** 腕の角度から、肩から見た手のひらの真ん中（体の座標: +X = 本人の左・+Y = 上・+Z = 前）。applyBodyPose と同じ回転の順 */
function palmOf(a: ArmPose, side: 1 | -1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-a.raise, -side * a.twist, side * a.out, 'XZY'))
  const upper = new THREE.Vector3(0, -1, 0).applyQuaternion(q).multiplyScalar(body.upperArm)
  const fore = new THREE.Vector3(0, -Math.cos(a.elbow), Math.sin(a.elbow)).applyQuaternion(q).multiplyScalar(body.foreArm + PALM)
  return upper.add(fore)
}

/** 体の中の点を、肩から見た体の座標に */
function fromShoulder(p: BodyPoint, side: 1 | -1) {
  return new THREE.Vector3(-p.right - side * body.shoulderHalf, p.up - body.hipHeight - body.shoulderAboveHip, p.fwd)
}

describe('reachArm', () => {
  const targets: BodyPoint[] = [
    PET_REACH,
    { right: 0.25, up: 1.05, fwd: 0.4 },
    { right: 0.1, up: 1.2, fwd: 0.5 },
    { right: 0.3, up: 1.0, fwd: 0.3 },
  ]
  for (const to of targets) {
    test(`右手が届く (${to.right}, ${to.up}, ${to.fwd})`, () => {
      const a = createPose().armR
      reachArm(a, -1, to, body)
      const got = palmOf(a, -1)
      const want = fromShoulder(to, -1)
      expect(got.distanceTo(want)).toBeLessThan(0.002)
      // 肘は前へ曲がる（逆に折れない）
      expect(a.elbow).toBeGreaterThan(0)
      expect(a.elbow).toBeLessThan(Math.PI)
    })
  }

  test('左手も同じ式で届く', () => {
    const to = { right: -0.22, up: 1.1, fwd: 0.42 }
    const a = createPose().armL
    reachArm(a, 1, to, body)
    expect(palmOf(a, 1).distanceTo(fromShoulder(to, 1))).toBeLessThan(0.002)
  })

  test('届かない先は、伸ばした腕でその方を指す', () => {
    const to = { right: 0.3, up: 1.6, fwd: 1.2 }
    const a = createPose().armR
    reachArm(a, -1, to, body)
    const got = palmOf(a, -1)
    const want = fromShoulder(to, -1)
    expect(got.length()).toBeGreaterThan(armReach(body) - 0.01)
    expect(got.clone().normalize().dot(want.clone().normalize())).toBeGreaterThan(0.999)
  })
})

describe('pet', () => {
  test('右腕だけを重ねる', () => {
    expect(ACTION_PART.pet).toBe('armR')
  })

  test('なでる物の頭の上へ手を伸ばす（往復は数 cm）', () => {
    const to = { right: 0.2, up: 1.12, fwd: 0.44 }
    const want = fromShoulder(to, -1)
    for (const t of [0, 0.3, 0.9, 1.7, 2.6]) {
      const p = actionPose('pet', t, createPose(), null, body, to)
      expect(palmOf(p.armR, -1).distanceTo(want)).toBeLessThan(0.05)
    }
  })

  test('なでる物がまだ遠い（ドックの上）間は手を前に出して待ち、宙を指さない', () => {
    // ドックの上で浮かぶ KB-001 の頭の上（肩より上・約 0.9m 先）
    const dock = { right: 0.35, up: 1.58, fwd: 0.85 }
    const p = actionPose('pet', 1, createPose(), null, body, dock)
    const palm = palmOf(p.armR, -1)
    // 手のひらは肩より下・体の前
    expect(palm.y).toBeLessThan(-0.15)
    expect(palm.z).toBeGreaterThan(0.25)
    expect(palm.length()).toBeLessThan(armReach(body) - 0.02)
  })

  test('右後ろに付いてきた所（歩いて着いた直後）へは腕を回さず、手を前に出して待つ', () => {
    const behind = { right: 0.62, up: 1.67, fwd: -0.45 }
    const ready = actionPose('pet', 1, createPose(), null, body, { right: 0.18, up: 1.06, fwd: 0.36 })
    const p = actionPose('pet', 1, createPose(), null, body, behind)
    expect(palmOf(p.armR, -1).distanceTo(palmOf(ready.armR, -1))).toBeLessThan(0.05)
    expect(palmOf(p.armR, -1).z).toBeGreaterThan(0.2)
  })
})
