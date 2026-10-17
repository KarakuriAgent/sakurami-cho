import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { Character } from './character'
import { solveTwoBone, rotateWorld, setWorldQuaternion } from './limbIk'
import { footYaw, stepLiftEase, type StepFoot } from './turnStep'

/**
 * その場で向きを変える足踏み（character/avatar/turnStep.ts の ch.motion.step）を脚に入れる（見た目。characterVisual.ts が、待機・行動の姿勢を
 * 作った後・足の高さ合わせの前に呼ぶ）。
 *
 * 足ごとの「床に置いた向き」と体の向きの差（遅れ）だけ、足首と膝を体の真下の縦の軸のまわりに回した所を行き先にし、2 本の骨の IK（limbIk.ts）で
 * 足首を届かせる（膝は回した膝の側へ曲げる）。床に残る足はその場に留まり、持ち上げた足は前の所から次の所へ、弧を描いて持ち上げて運ぶ。
 * 足の向きは、持ち上げた足は遅れのまま回し、床に残る足は遅れの半分（つま先を軸に、かかとを少し回す。turnStep.ts の STEP_LAG_MAX）。
 * 足を持ち上げている間は、体を床に残る足の側へ少し寄せて少し沈める（体重を移す）。足首が届かない（遠い）ときは、届く分だけ体を下げる（腰の高さ）。
 * 体の位置の直しは見た目の置き場（object）の位置に足す（毎コマ ch.motion から置き直すので、たまらない）。
 * 足踏みを外したら（歩き出したなど）、0.25 秒ほどでアニメーションの足へ戻す
 */

/** 足踏みを脚に入れる強さと、外したときに戻す前の遅れ・持ち上げ（見た目が 1 つ持つ） */
export interface TurnStepPoseState {
  w: number
  lagL: number
  lagR: number
  liftL: number
  liftR: number
  /** 床に残る足の側へ寄せる強さ（0〜1）と、どちらの足か */
  shift: number
  stance: StepFoot | null
}

export function createTurnStepPose(): TurnStepPoseState {
  return { w: 0, lagL: 0, lagR: 0, liftL: 0, liftR: 0, shift: 0, stance: null }
}

/** 持ち上げる高さ（m）: 足を回す角度が大きいほど高く */
const LIFT_MIN = 0.035
const LIFT_PER_RAD = 0.025
const LIFT_MAX = 0.07
/** 体重を移す: 床に残る足の側へ寄せる（m）・沈める（m） */
const SHIFT = 0.02
const SINK = 0.008
/** 足首が届かないときに体を下げる上限（m） */
const DROP_MAX = 0.05
/** 遅れがこれを超えたら（ほかの仕組みが体を回したなど）、その足は合わせない（rad） */
const LAG_LIMIT = 2.2

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const _c = new THREE.Vector3()
const _a = new THREE.Vector3()
const _k = new THREE.Vector3()
const _h = new THREE.Vector3()
const _t = [new THREE.Vector3(), new THREE.Vector3()]
const _pole = [new THREE.Vector3(), new THREE.Vector3()]
const _fq = [new THREE.Quaternion(), new THREE.Quaternion()]
const _q = new THREE.Quaternion()
const _y = new THREE.Vector3(0, 1, 0)

export function applyTurnStepPose(ch: Character, vrm: VRM, object: THREE.Object3D, st: TurnStepPoseState, delta: number) {
  const m = ch.motion
  const s = m.step
  const on = s.active && m.seat === null && m.jump.phase === 'none' && m.walk < 0.6
  st.w += ((on ? 1 : 0) - st.w) * (1 - Math.exp(-Math.min(delta, 0.1) * 12))
  if (!on && st.w < 0.002) {
    st.w = 0
    return
  }
  if (on) {
    for (const f of ['L', 'R'] as const) {
      const lag = wrap(footYaw(s, f) - m.heading)
      let lift = 0
      if (s.foot === f) {
        const swing = Math.abs(wrap(s.to - s.footFrom))
        lift = Math.min(LIFT_MAX, LIFT_MIN + LIFT_PER_RAD * swing) * stepLiftEase(s.u)
      }
      if (f === 'L') {
        st.lagL = Math.abs(lag) > LAG_LIMIT ? 0 : lag
        st.liftL = lift
      } else {
        st.lagR = Math.abs(lag) > LAG_LIMIT ? 0 : lag
        st.liftR = lift
      }
    }
    st.stance = s.foot === 'L' ? 'R' : s.foot === 'R' ? 'L' : null
    st.shift = s.foot ? stepLiftEase(s.u) : 0
  }
  const w = st.w
  if (Math.abs(st.lagL) + Math.abs(st.lagR) + st.liftL + st.liftR < 1e-4) return
  const hu = vrm.humanoid
  const legs = [
    { up: hu.getNormalizedBoneNode('leftUpperLeg'), low: hu.getNormalizedBoneNode('leftLowerLeg'), foot: hu.getNormalizedBoneNode('leftFoot'), lag: st.lagL, lift: st.liftL, side: 'L' as const },
    { up: hu.getNormalizedBoneNode('rightUpperLeg'), low: hu.getNormalizedBoneNode('rightLowerLeg'), foot: hu.getNormalizedBoneNode('rightFoot'), lag: st.lagR, lift: st.liftR, side: 'R' as const },
  ]
  if (legs.some((l) => !l.up || !l.low || !l.foot)) return
  object.updateMatrixWorld(true)
  // 体の真下（置き場の原点）を回す軸に
  object.getWorldPosition(_c)
  // 行き先（足首・膝を軸のまわりに遅れだけ回した所）と足の向き（アニメーションの向きを、持ち上げた足は遅れ、床の足は遅れの半分だけ回す）
  legs.forEach((l, i) => {
    const lag = l.lag * w
    _q.setFromAxisAngle(_y, lag)
    l.foot!.getWorldPosition(_a)
    _t[i].copy(_a).sub(_c).applyQuaternion(_q).add(_c)
    _t[i].y += l.lift * w
    l.low!.getWorldPosition(_k)
    _pole[i].copy(_k).sub(_c).applyQuaternion(_q).add(_c)
    l.foot!.getWorldQuaternion(_fq[i])
    // 足の向き: 床の足は遅れの半分（つま先を軸に回す）、持ち上げた足は持ち上げるにつれて遅れのまま
    const swinging = st.stance !== null && st.stance !== l.side
    _fq[i].premultiply(_q.setFromAxisAngle(_y, lag * (0.5 + 0.5 * (swinging ? st.shift : 0))))
  })
  // 体重を移す（床に残る足の側へ寄せて、少し沈める）
  if (st.stance && st.shift > 1e-3) {
    const stanceT = _t[st.stance === 'L' ? 0 : 1]
    _a.set(stanceT.x - _c.x, 0, stanceT.z - _c.z)
    const len = _a.length()
    if (len > 1e-4) object.position.addScaledVector(_a, (SHIFT * st.shift * w) / len)
    object.position.y -= SINK * st.shift * w
  }
  object.updateMatrixWorld(true)
  // 足首が届かなければ、届く分だけ体を下げる
  let drop = 0
  legs.forEach((l, i) => {
    l.up!.getWorldPosition(_h)
    const a = _h.distanceTo(l.low!.getWorldPosition(_k))
    const b = _k.distanceTo(l.foot!.getWorldPosition(_a))
    drop = Math.max(drop, _h.distanceTo(_t[i]) - (a + b) * 0.995)
  })
  if (drop > 1e-4) {
    object.position.y -= Math.min(DROP_MAX, drop)
    object.updateMatrixWorld(true)
  }
  legs.forEach((l, i) => {
    // 太ももごと縦の軸のまわりに回してから（膝と足の向きが一緒に回る）、足首を行き先へ
    if (Math.abs(l.lag * w) > 1e-4) {
      rotateWorld(l.up!, _q.setFromAxisAngle(_y, l.lag * w * 0.75))
      l.up!.updateMatrixWorld(true)
    }
    solveTwoBone(l.up!, l.low!, l.foot!, _t[i], _pole[i])
    setWorldQuaternion(l.foot!, _fq[i])
    l.foot!.updateMatrixWorld(true)
  })
}
