import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { Character } from './character'
import { groundHeight } from './locomotion'

/** 足の高さ合わせの状態（見た目が 1 つ持つ。足ごとのなめらかにした高さの差） */
export interface FootIkState {
  dL: number
  dR: number
  drop: number
  /** 歩く間に腰を上げた高さ（立脚の膝を伸ばす。m） */
  lift: number
  /** 前のコマで腰に足した高さと、そのあとの腰の高さ（置き直されたかを見る） */
  applied: number
  lastY: number | null
}

const _fa = new THREE.Vector3()
const _fb = new THREE.Vector3()
const _fc = new THREE.Vector3()
const _fd = new THREE.Vector3()
const _fe = new THREE.Vector3()
const _fn = new THREE.Vector3()
const _fq = new THREE.Quaternion()
const _fp = new THREE.Quaternion()
const _fr = new THREE.Quaternion()
const _fx = new THREE.Vector3(1, 0, 0)

/** 歩く間の立脚の膝の曲げの目安（rad。人の歩きの立脚の中ほどは 10〜15°） */
const STANCE_KNEE = (11 * Math.PI) / 180
/** 歩く間に腰を上げる上限（m） */
const STANCE_LIFT_MAX = 0.04

/** 太もも a・すね b の脚で、股関節から足首までが D のときの膝の曲げ（0 = まっすぐ）と、股関節での脚の線からの太ももの開き */
export function legAngles(a: number, b: number, D: number) {
  const d = THREE.MathUtils.clamp(D, Math.abs(a - b) + 1e-4, a + b - 1e-5)
  const knee = Math.PI - Math.acos(THREE.MathUtils.clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1))
  const hip = Math.acos(THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1))
  return { knee, hip }
}

/**
 * 足の高さ合わせ（2 本の骨の IK。町の段階 3）と、歩く間の立脚の膝を伸ばす直し（§7 の 208）。
 *
 * 1. 体（ch.motion.position）は地面のなめらかな高さ（石段はなめらかな坂）に沿うので、足ごとに「足の下の本当の地面（石段は段のまま）」との差を測り、
 *    低い方の足に合わせて腰を下げ、高い方の足は膝を曲げて持ち上げる（外だけ。ラボの中の平らな床では差が 0）
 * 2. 歩きの .vrma（素材の歩き）は立脚の膝を 25〜35° 曲げたまま運ぶので、花音の脚では中腰に見えた。歩く間は、地面に着いている足の膝が
 *    STANCE_KNEE まで伸びる高さだけ腰を上げ（地面に着いている足が届く分まで・4cm まで）、足の位置はアニメーションのまま（膝を伸ばす）にする
 * 3. 座っている間（行動 sit。座る姿勢を混ぜる強さで）は、腰は座面に載っているので下げず、足だけを足の下の床・地面へまっすぐ
 *    上げ下げする（低い所へは脚を伸ばし、高い所へは膝を曲げる）。傾いた車室（ケーブルカーの急な区間）で前に出した足の下の床が低くても、
 *    腰が座面に沈まない
 * 4. 跳ぶ姿勢の間（jumpHold = 跳ぶ姿勢の強さ 0〜1。character/avatar/characterVisual.ts）は 2 の直しをその分だけ弱め（しゃがむ膝を伸ばさない）、
 *    跳んでいる間（足が地面から離れている）は 1 の高さの差を 0 へ戻す（足を地面へ伸ばさない）
 * 脚は前後の面の中でだけ曲げる（太ももを前へ・膝を後ろへ）。太ももとすねの長さの違いも入れる。立っている脚は股関節から足首の線の上で足首を
 * 動かす。座っている脚は股関節から足首の線が前へ倒れているので、その線の上で動かすと足首が前へずれて床に届かない。足首の行き先（真上・真下）
 * へ届くよう、膝をその骨の曲がる軸のまわりに曲げ（骨の長さと向きのまま解く）、太ももを股関節のまわりに振る（reachSeated）
 */
export function applyFootIk(ch: Character, vrm: VRM, st: FootIkState, delta: number, ankleRest: number, jumpHold = 0) {
  const m = ch.motion
  // 跳んでいる間（足が地面から離れている）は、足の下の地面に合わせない
  const air = m.jump.phase === 'air'
  const k = 1 - Math.exp(-Math.min(delta, 0.1) * 14)
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')
  const legs = [
    { up: vrm.humanoid.getNormalizedBoneNode('leftUpperLeg'), low: vrm.humanoid.getNormalizedBoneNode('leftLowerLeg'), foot: vrm.humanoid.getNormalizedBoneNode('leftFoot'), key: 'dL' as const },
    { up: vrm.humanoid.getNormalizedBoneNode('rightUpperLeg'), low: vrm.humanoid.getNormalizedBoneNode('rightLowerLeg'), foot: vrm.humanoid.getNormalizedBoneNode('rightFoot'), key: 'dR' as const },
  ]
  if (!hips || legs.some((l) => !l.up || !l.low || !l.foot)) return
  const scale = vrm.scene.scale.y || 1
  const walking = m.walk > 0.02 && m.seat === null
  if (!m.outside && !walking && Math.abs(st.dL) + Math.abs(st.dR) + Math.abs(st.drop) + Math.abs(st.lift) < 1e-4) {
    if (st.applied !== 0 && st.lastY !== null && Math.abs(hips.position.y - st.lastY) < 1e-7) hips.position.y -= st.applied / scale
    st.dL = st.dR = st.drop = st.lift = st.applied = 0
    st.lastY = null
    return
  }
  // 腰の位置: アニメーションが毎コマ置き直していれば、そこから。置き直していなければ（コードの姿勢）前のコマの分を引いてから
  if (st.lastY !== null && Math.abs(hips.position.y - st.lastY) < 1e-7) hips.position.y -= st.applied / scale
  vrm.scene.updateMatrixWorld(true)
  const baseY = vrm.scene.parent ? vrm.scene.parent.getWorldPosition(_fc).y : 0
  for (const l of legs) {
    l.foot!.getWorldPosition(_fa)
    const want = m.outside && !air ? groundHeight(ch, _fa.x, _fa.z, true, m.position.y - m.jump.height) - m.ground : 0
    st[l.key] += (THREE.MathUtils.clamp(want, -0.3, 0.3) - st[l.key]) * k
  }
  // 座る姿勢の強さ（characterVisual が行動の姿勢を混ぜるのと同じ形）。座っている間は腰を下げない
  const b = m.action === 'sit' ? m.actionBlend : 0
  const sit = b * b * (3 - 2 * b)
  const drop = Math.min(0, st.dL, st.dR) * (1 - sit)
  st.drop += (drop - st.drop) * k
  // 脚の長さ（太もも・すね）
  const rest = vrm.humanoid.normalizedRestPose
  const len = (p?: number[]) => (p ? Math.hypot(p[0], p[1], p[2]) : 0)
  const A = ((len(rest.leftLowerLeg?.position) + len(rest.rightLowerLeg?.position)) / 2) * scale
  const B = ((len(rest.leftFoot?.position) + len(rest.rightFoot?.position)) / 2) * scale
  if (A < 0.05 || B < 0.05) return
  const reach = (A + B) * 0.998
  // 股関節から足首まで（アニメーションのまま）と、足首の地面からの高さ（アニメーションが足を上げている分）
  const D: number[] = []
  const H: number[] = []
  for (const l of legs) {
    l.up!.getWorldPosition(_fa)
    l.foot!.getWorldPosition(_fb)
    D.push(_fa.distanceTo(_fb))
    H.push(_fb.y - baseY - ankleRest)
  }
  // 歩く間の立脚の膝を伸ばす高さ: 地面に着いている足（H が小さい）ほど強く。どの足も地面から離れない（届く）分まで
  let lift = 0
  if (walking) {
    const Dt = Math.sqrt(A * A + B * B + 2 * A * B * Math.cos(STANCE_KNEE))
    let want = 0
    let limit = STANCE_LIFT_MAX
    legs.forEach((l, i) => {
      const Dn = D[i] - (st[l.key] - st.drop)
      const contact = 1 - THREE.MathUtils.smoothstep(H[i], 0.012, 0.05)
      want = Math.max(want, contact * (Dt - Dn))
      limit = Math.min(limit, reach - Dn + Math.max(0, H[i] - 0.008))
    })
    lift = THREE.MathUtils.clamp(Math.min(want, limit), 0, STANCE_LIFT_MAX) * THREE.MathUtils.smoothstep(m.walk, 0.02, 0.6) * (1 - jumpHold)
  }
  st.lift = lift
  hips.position.y += (st.drop + lift) / scale
  st.applied = st.drop + lift
  st.lastY = hips.position.y
  vrm.scene.updateMatrixWorld(true)
  legs.forEach((l, i) => {
    // 足をアニメーションの位置（+ 地面の差）に戻すために、股関節から足首を縮める（+）・伸ばす（−）長さ
    const raise = st[l.key] - st.drop - lift
    if (Math.abs(raise) < 0.002) return
    const D0 = D[i]
    if (sit > 0) {
      reachSeated(l.up!, l.low!, l.foot!, raise, D0, sit, (A + B) * 0.55, reach)
      return
    }
    const D2 = THREE.MathUtils.clamp(D0 - raise, (A + B) * 0.55, reach)
    const a0 = legAngles(A, B, D0)
    const a1 = legAngles(A, B, D2)
    // 太ももを前へ（X 軸まわりに -）、膝を後ろへ（+）
    l.up!.quaternion.multiply(_fq.setFromAxisAngle(_fx, -(a1.hip - a0.hip)))
    l.low!.quaternion.multiply(_fq.setFromAxisAngle(_fx, a1.knee - a0.knee))
  })
}

/**
 * 座っている脚の足首を、今の所から raise（m）上げ下げした所へ届かせる。行き先は、真上・真下（座る強さ sit = 1）と、立っている脚と同じ
 * 股関節から足首の線の上（sit = 0）を混ぜた点。股関節からの長さは minD〜maxD に収める。
 * 膝はすねの骨の X 軸（曲がる軸）のまわりに曲げ、股関節から足首までがちょうど行き先までの長さになる角度を、骨の今の向きと長さから解く
 * （2 つの解のうち、今の膝の曲げから近い方）。そのあと太ももを股関節のまわりに振って、足首を行き先に重ねる。シーンの行列は呼ぶ前に新しくしておく
 */
function reachSeated(up: THREE.Object3D, low: THREE.Object3D, foot: THREE.Object3D, raise: number, D0: number, sit: number, minD: number, maxD: number) {
  const H = up.getWorldPosition(_fa)
  const K = low.getWorldPosition(_fb)
  const P = foot.getWorldPosition(_fc)
  // 行き先 _fd（股関節から見た向きと長さ）: 線の上へ動かす分 −(P − H) / D0 × raise と、真上・真下 (0, raise, 0) を sit で混ぜる
  _fd.subVectors(P, H).multiplyScalar(-raise / D0)
  _fd.x *= 1 - sit
  _fd.z *= 1 - sit
  _fd.y += (raise - _fd.y) * sit
  _fd.add(P).sub(H)
  const D2 = THREE.MathUtils.clamp(_fd.length(), minD, maxD)
  _fd.setLength(D2)
  // 膝: u = 膝 − 股関節、s = 足首 − 膝。軸 n のまわりに φ 回すと u・s は c0 + Pc cos φ + Ps sin φ。|u + s(φ)| = D2 になる φ
  const u = K.sub(H)
  const s = P.sub(H).sub(u)
  low.getWorldQuaternion(_fq)
  const n = _fn.copy(_fx).applyQuaternion(_fq)
  const c0 = u.dot(n) * s.dot(n)
  const sPerp = _fe.copy(n).multiplyScalar(-s.dot(n)).add(s)
  const Pc = u.dot(sPerp)
  const Ps = u.dot(n.cross(sPerp))
  const R = Math.hypot(Pc, Ps)
  if (R > 1e-9) {
    const g = (D2 * D2 - u.lengthSq() - s.lengthSq()) / 2 - c0
    const base = Math.atan2(Ps, Pc)
    const open = Math.acos(THREE.MathUtils.clamp(g / R, -1, 1))
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
    const p1 = wrap(base + open)
    const p2 = wrap(base - open)
    low.quaternion.multiply(_fq.setFromAxisAngle(_fx, Math.abs(p1) < Math.abs(p2) ? p1 : p2))
  }
  // 太もも: 股関節から足首の向きを行き先へ（シーンの回りを、太ももの親の座標に直して前から掛ける）
  up.updateMatrixWorld(true)
  foot.getWorldPosition(_fe).sub(up.getWorldPosition(_fc)).normalize()
  _fp.setFromUnitVectors(_fe, _fd.normalize())
  up.parent!.getWorldQuaternion(_fq)
  up.quaternion.premultiply(_fp.premultiply(_fr.copy(_fq).invert()).multiply(_fq))
}
