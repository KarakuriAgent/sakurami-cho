/**
 * その場で向きを変える足踏み（character/avatar/turnStep.ts）と、2 本の骨の IK（character/avatar/limbIk.ts）:
 *   - 回る角度に合わせて 1 歩ずつ回る（小さい角度は 1 歩、90° は 2 歩、180° は 4 歩ほど）。体は足が宙にある間だけ回る
 *   - 床に残る足は体の向きから STEP_LAG_MAX より遅れない。回り終えたら、遅れた足をそろえる（STEP_CLOSE まで）
 *   - exact なら着いた所の向きにぴったり合う。早送り（timeScale）では足踏みも速い
 *   - IK は先を届く所へ置き、膝・肘を pole の側へ曲げる
 */
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { createTurnStep, STEP_CLOSE, STEP_LAG_MAX, stepTurn, turnStepBusy, type StepTurnOptions } from '../character/avatar/turnStep.ts'
import { solveTwoBone } from '../character/avatar/limbIk.ts'

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** target まで回し切る。歩の数・かかった秒・コマごとの足の遅れの最大・足が床にある間に体が回った量を返す */
function turnTo(start: number, target: number, opts: StepTurnOptions = { exact: true, close: true }, timeScale = 1) {
  const m = { heading: start, turnRate: 0, timeScale, step: createTurnStep() }
  const dt = 1 / 60
  let t = 0
  let maxLag = 0
  let groundedTurn = 0
  for (; t < 20; t += dt) {
    const before = m.heading
    const swinging = m.step.foot
    stepTurn(m, target, dt, opts)
    if (!swinging && !m.step.foot) groundedTurn += Math.abs(wrap(m.heading - before))
    for (const f of ['L', 'R'] as const) {
      if (m.step.foot === f) continue
      maxLag = Math.max(maxLag, Math.abs(wrap((f === 'L' ? m.step.yawL : m.step.yawR) - m.heading)))
    }
    if (!turnStepBusy(m.step, m.heading) && Math.abs(wrap(target - m.heading)) < 1e-4) break
  }
  return { m, steps: m.step.count, t, maxLag, groundedTurn }
}

describe('stepTurn', () => {
  test('小さい角度（20°）は 1 歩', () => {
    const r = turnTo(0, (20 * Math.PI) / 180)
    expect(r.steps).toBe(1)
    expect(Math.abs(wrap(r.m.heading - (20 * Math.PI) / 180))).toBeLessThan(1e-3)
  })

  test('90° は 2 歩（回る側の足から、交互に）', () => {
    const r = turnTo(0, Math.PI / 2)
    expect(r.steps).toBe(2)
    expect(r.maxLag).toBeLessThanOrEqual(STEP_LAG_MAX + 0.21)
  })

  test('右へ回るときは右足から', () => {
    const m = { heading: 0, turnRate: 0, timeScale: 1, step: createTurnStep() }
    stepTurn(m, -1, 1 / 60)
    expect(m.step.foot).toBe('R')
    const n = { heading: 0, turnRate: 0, timeScale: 1, step: createTurnStep() }
    stepTurn(n, 1, 1 / 60)
    expect(n.step.foot).toBe('L')
  })

  test('180° は 3〜5 歩で、床の足は遅れすぎない', () => {
    const r = turnTo(0.3, 0.3 + Math.PI - 0.01)
    expect(r.steps).toBeGreaterThanOrEqual(3)
    expect(r.steps).toBeLessThanOrEqual(5)
    expect(r.maxLag).toBeLessThanOrEqual(STEP_LAG_MAX + 0.21)
  })

  test('回り終えると、どちらの足も STEP_CLOSE より遅れていない・向きはぴったり', () => {
    for (const deg of [35, 70, 110, 150, -60, -130]) {
      const target = (deg * Math.PI) / 180
      const r = turnTo(0, target)
      expect(Math.abs(wrap(r.m.step.yawL - r.m.heading))).toBeLessThanOrEqual(STEP_CLOSE + 1e-6)
      expect(Math.abs(wrap(r.m.step.yawR - r.m.heading))).toBeLessThanOrEqual(STEP_CLOSE + 1e-6)
      expect(Math.abs(wrap(r.m.heading - target))).toBeLessThan(1e-3)
    }
  })

  test('体は足を上げている間に回る（床に両足があるときに回るのは、歩幅に満たないずれだけ）', () => {
    const r = turnTo(0, 2.0)
    expect(r.groundedTurn).toBeLessThan(0.1)
  })

  test('早送り（timeScale 3）では足踏みも 3 倍の速さ', () => {
    const a = turnTo(0, Math.PI / 2)
    const b = turnTo(0, Math.PI / 2, { exact: true, close: true }, 3)
    expect(b.steps).toBe(a.steps)
    expect(b.t).toBeLessThan(a.t / 2.5)
  })

  test('min より小さいずれは歩かない（見る先へ向き直る）', () => {
    const m = { heading: 0, turnRate: 0, timeScale: 1, step: createTurnStep() }
    for (let i = 0; i < 60; i++) stepTurn(m, 0.1, 1 / 60, { min: 0.18, slow: true })
    expect(m.step.count).toBe(0)
    expect(m.heading).toBe(0)
  })
})

describe('solveTwoBone', () => {
  /** 股関節 → 膝 → 足首（長さ 0.4・0.4。まっすぐ下） */
  function leg() {
    const root = new THREE.Object3D()
    const up = new THREE.Object3D()
    const mid = new THREE.Object3D()
    const end = new THREE.Object3D()
    root.add(up)
    up.add(mid)
    mid.add(end)
    up.position.set(0, 1, 0)
    mid.position.set(0, -0.4, 0)
    end.position.set(0, -0.4, 0)
    root.rotation.y = 0.7
    root.updateMatrixWorld(true)
    return { root, up, mid, end }
  }

  test('届く先へ先を置き、膝は pole の側へ曲がる', () => {
    const l = leg()
    const target = new THREE.Vector3(0.15, 0.4, 0.1)
    const pole = new THREE.Vector3(0.5, 0.7, 2)
    expect(solveTwoBone(l.up, l.mid, l.end, target, pole)).toBe(true)
    l.root.updateMatrixWorld(true)
    const p = l.end.getWorldPosition(new THREE.Vector3())
    expect(p.distanceTo(target)).toBeLessThan(1e-4)
    // 骨の長さは変わらない
    const h = l.up.getWorldPosition(new THREE.Vector3())
    const k = l.mid.getWorldPosition(new THREE.Vector3())
    expect(k.distanceTo(h)).toBeCloseTo(0.4, 5)
    expect(p.distanceTo(k)).toBeCloseTo(0.4, 5)
    // 膝は pole の側（股関節から先への線より前 = +z 寄り）
    const line = target.clone().sub(h).normalize()
    const off = k.clone().sub(h)
    off.addScaledVector(line, -off.dot(line))
    expect(off.dot(pole.clone().sub(h))).toBeGreaterThan(0)
  })

  test('届かない先は、その方へ伸ばす', () => {
    const l = leg()
    const target = new THREE.Vector3(0.3, -0.5, 0.3)
    expect(solveTwoBone(l.up, l.mid, l.end, target, new THREE.Vector3(0, 0.5, 2))).toBe(false)
    l.root.updateMatrixWorld(true)
    const h = l.up.getWorldPosition(new THREE.Vector3())
    const p = l.end.getWorldPosition(new THREE.Vector3())
    expect(p.clone().sub(h).normalize().dot(target.clone().sub(h).normalize())).toBeGreaterThan(0.9999)
    expect(p.distanceTo(h)).toBeCloseTo(0.8, 3)
  })
})
