import * as THREE from 'three'
import type { PlaceAction } from '../../core/places'
import { ACTION_HANDS, addCurl, blendHand, createHand, HANDS, lerpHand, setHand, type HandShape } from './hands'

/**
 * 体の姿勢（歩き・立ち寄り先の動作・反応を、腕・脚・上半身の角度で書く）。
 *
 * 腕は「体の横に下ろした状態」からの回転で書く（1 本ずつ）:
 *   raise … 前へ上げる角度（0 = 下ろす、π/2 = 前に水平、マイナスで後ろへ）
 *   out   … 横へ上げる角度（0 = 体の横、π/2 = 横に水平）
 *   twist … 腕のねじり（肘を曲げる向きが変わる。手を後ろで組むときなど）
 *   elbow … 肘の曲げ（前へ）、elbowSide … 肘から先を横へ倒す（手を振るとき）
 * 体は +Z を向き、+X が本人の左。VRM は T ポーズの向きに直して正規化ボーンに入れる（character/avatar/characterVisual.ts）。
 *
 * 手の形（handL / handR。指・前腕のひねり・手首。character/avatar/hands.ts）も、腕と同じ強さで混ぜる。
 * VRM の指の骨に入れる（character/avatar/vrmHands.ts）。
 */

export interface ArmPose {
  raise: number
  out: number
  twist: number
  elbow: number
  elbowSide: number
}

export interface BodyPose {
  armL: ArmPose
  armR: ArmPose
  /** 太ももの振り（前へ +）と膝の曲げ */
  thighL: number
  thighR: number
  kneeL: number
  kneeR: number
  /** 上半身の前傾（+ で前へ）・左右の傾き・ひねり */
  lean: number
  tilt: number
  twist: number
  /** 頭のうつむき（+ で下を見る）・左右（+ で本人の左）・かしげ */
  headPitch: number
  headYaw: number
  headRoll: number
  /** 体全体の上下（跳ねる・歩きの上下動、m） */
  bob: number
  /** 体全体を前へ（体の向きに、m。座るときに座面の上へ腰を動かす） */
  shift: number
  /** 行動の姿勢のとき、首をカメラへ向ける割合（0 = 行動の視線のまま） */
  lookCamera: number
  /** 手の形（本人の左手・右手。VRM だけが使う） */
  handL: HandShape
  handR: HandShape
}

const arm = (raise: number, out: number, elbow: number, twist = 0, elbowSide = 0): ArmPose => ({ raise, out, twist, elbow, elbowSide })

export function createPose(): BodyPose {
  return {
    armL: arm(0.04, 0.36, 0.22),
    armR: arm(0.04, 0.36, 0.22),
    thighL: 0,
    thighR: 0,
    kneeL: 0,
    kneeR: 0,
    lean: 0,
    tilt: 0,
    twist: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    bob: 0,
    shift: 0,
    lookCamera: 1,
    handL: createHand(),
    handR: createHand(),
  }
}

function setArm(a: ArmPose, raise: number, out: number, elbow: number, twist = 0, elbowSide = 0) {
  a.raise = raise
  a.out = out
  a.elbow = elbow
  a.twist = twist
  a.elbowSide = elbowSide
}

/** 待機（立ち位置で配信しているとき・歩いていないとき）の姿勢 */
export function restPose(out: BodyPose, t: number) {
  const breath = Math.sin((t / 4.2) * Math.PI * 2)
  setArm(out.armL, 0.04, 0.36 + breath * 0.01 + Math.sin(t * 0.7) * 0.015, 0.22)
  setArm(out.armR, 0.04, 0.36 + breath * 0.01 - Math.sin(t * 0.63) * 0.015, 0.22)
  out.thighL = out.thighR = out.kneeL = out.kneeR = 0
  out.lean = 0.01
  out.tilt = Math.sin((t / 7.5) * Math.PI * 2) * 0.012
  out.twist = 0
  out.headPitch = -Math.sin(t * 0.5) * 0.02
  out.headYaw = 0
  out.headRoll = Math.sin(t * 0.37 + 0.8) * 0.02
  out.bob = breath * 0.003
  out.shift = 0
  out.lookCamera = 1
  // 力の抜けた手（指がごくゆっくり少しだけ動く）
  setHand(out.handL, HANDS.relaxed)
  setHand(out.handR, HANDS.relaxed)
  const driftL = Math.sin(t * 0.41 + 0.3) * 0.03
  const driftR = Math.sin(t * 0.37 + 2.1) * 0.03
  addCurl(out.handL, driftL, driftL * 0.8, driftL * 0.6, driftL * 0.5)
  addCurl(out.handR, driftR, driftR * 0.8, driftR * 0.6, driftR * 0.5)
  return out
}

/**
 * 体の寸法（m。座る姿勢の腰の下げ方・机に手を置く高さに使う）。Character ごとに持ち（ch.body）、VRM を読んだら見た目（character/avatar/characterVisual.ts）が測って入れる（setBodyMetrics）。
 * 既定は前の VRM の値。VRM を替えると脚の長さが変わり、決まった値のままでは座面から浮いた（2026-10-05 の VRM は股関節 1.06m。§7 の 145）
 */
export interface BodyMetrics {
  /** 立っているときの股関節の高さ */
  hipHeight: number
  /** 立っているときの、肩（上腕の付け根）の股関節からの高さ（座る姿勢の腕の高さ） */
  shoulderAboveHip: number
  /** 上腕・前腕の長さ */
  upperArm: number
  foreArm: number
}

/** 体の寸法の既定（VRM を測る前） */
export function createBodyMetrics(): BodyMetrics {
  return { hipHeight: 0.86, shoulderAboveHip: 0.35, upperArm: 0.25, foreArm: 0.22 }
}

export function setBodyMetrics(body: BodyMetrics, m: Partial<BodyMetrics>) {
  Object.assign(body, m)
}

/** 座面から股関節まで（股関節の高さに比べた割合。座ると太ももの裏とお尻が股関節の下に来る） */
const SEAT_TO_HIP_RATIO = 0.125
/**
 * 座る姿勢（前傾 0.13）で、肩（上腕の付け根）が股関節より上に来る高さは、VRM を読んだときに測った体の寸法の shoulderAboveHip（立った姿勢の差）の
 * cos(前傾) 倍。机・カウンターの高さ（SeatSpec.desk）が分かれば、肘を天板の少し上に置き、前腕を天板に沿わせる（armOnDesk）。
 * 前は股関節の高さの 0.258 倍の決まった割合だった（靴底を測り違えていた VRM の値。§7 の 208）
 */
const sitShoulderAboveHip = (lean: number, body: BodyMetrics) => body.shoulderAboveHip * Math.cos(lean)
/** 天板から肘・手首の骨まで（腕の太さの半分ほど） */
const ELBOW_ABOVE_DESK = 0.04
const WRIST_ABOVE_DESK = 0.045

/** 座る椅子（立ち寄り先の seat。省けばふつうの椅子） */
export interface SeatSpec {
  height: number
  shift: number
  /** 手の置き場所: desk = 前の机・カウンター（既定）、lap = ひざの上（観覧車の長いす・ベンチ）、grip = 前のハンドルを握る（ホバーの一人乗り。desk = 握りの高さ） */
  hands?: 'desk' | 'lap' | 'grip'
  /** 前の机・カウンターの天板の高さ（床から m）。省けば腕の高さはそのまま */
  desk?: number
  /** hands = grip のとき、座面の真ん中（腰）から握りまでの前への距離（m） */
  reach?: number
}

/**
 * 机・カウンターに前腕を置く: 肘を天板の少し上へ（上腕を前へ上げる角度を、肩から天板までの高さ drop から決める）、前腕は天板に沿ってほぼ水平に。
 * 決まった角度のままだと、天板が高いカウンターでは前腕が天板の下を通って手だけが天板の上に出た（星図珈琲の C4。§7 の 145）
 */
function armOnDesk(a: ArmPose, drop: number, body: BodyMetrics) {
  const U = body.upperArm
  const F = body.foreArm
  const elbowDrop = drop - ELBOW_ABOVE_DESK
  const r = Math.acos(THREE.MathUtils.clamp(elbowDrop / U, 0.05, 1))
  const forearm = Math.acos(THREE.MathUtils.clamp((drop - WRIST_ABOVE_DESK - elbowDrop) / F, -1, 1))
  a.raise = r
  a.elbow = Math.max(0.2, forearm - r)
}

/**
 * 窓の外を眺める（gaze）ときの左腕: 上腕はほぼ下ろして肘を体の横に置き、肘を深く曲げて、手を胸のペンダントに添える。
 * 角度は VRM（2026-10-05。肩幅 0.30m・上腕 0.28m・前腕 0.23m）の肩からペンダントまでを、腕の向きの式（applyBodyPose）で解いた物
 */
const GAZE_ARM = { raise: 0.5, out: 0.12, twist: 0.7, elbow: 2.25 } as const

/**
 * 行動の姿勢が .vrma の待機に重ねる所（.vrma があるとき。character/avatar/characterVisual.ts）。
 * body = 上半身と腰から下（行動の姿勢のとおり）、armL・armR = その腕と手だけ（体・もう片方の腕・脚は待機の .vrma のまま。呼吸・重心の移しを残す）
 */
export type ActionPart = 'body' | 'armL' | 'armR'

export const ACTION_PART: Record<PlaceAction, ActionPart> = {
  present: 'body',
  holo: 'body',
  work: 'body',
  type: 'body',
  look: 'body',
  gaze: 'armL',
  pet: 'body',
  sit: 'body',
}

/** 立ち寄り先での行動の姿勢（t はシーンの経過秒）。seat = 座る椅子（sit のとき）、body = 体の寸法（Character の body） */
export function actionPose(action: PlaceAction, t: number, out: BodyPose, seat: SeatSpec | null | undefined, body: BodyMetrics) {
  restPose(out, t)
  setHand(out.handL, ACTION_HANDS[action].L)
  setHand(out.handR, ACTION_HANDS[action].R)
  switch (action) {
    case 'present':
      break
    case 'holo': {
      // ホログラムを見ながら、両手で拡大・回転させるように動かす
      const s = Math.sin(t * 1.3)
      const c = Math.cos(t * 1.05)
      setArm(out.armL, 0.95 + s * 0.14, 0.32 + c * 0.2, 0.85 + s * 0.12)
      setArm(out.armR, 0.9 - s * 0.12, 0.28 - c * 0.18, 0.95 - c * 0.1)
      out.headPitch = 0.05 + Math.sin(t * 0.6) * 0.05
      out.headYaw = Math.sin(t * 0.45) * 0.18
      out.lean = 0.04
      out.lookCamera = 0.15
      // 指先で触れる・つつく
      out.handR.index += Math.max(0, Math.sin(t * 2.1)) * 0.12
      out.handR.wrist += Math.sin(t * 2.1) * 0.06
      out.handL.spread += c * 0.15
      break
    }
    case 'work': {
      // 作業台で両手を前に出し、細かく手を動かす
      const a = Math.sin(t * 3.1)
      const b = Math.sin(t * 2.3 + 1)
      setArm(out.armL, 0.62 + a * 0.05, 0.12, 0.95 + b * 0.08)
      setArm(out.armR, 0.66 - b * 0.06, 0.08, 0.88 + a * 0.1)
      out.lean = 0.2
      out.headPitch = 0.42 + Math.sin(t * 0.8) * 0.04
      out.headYaw = Math.sin(t * 0.5) * 0.1
      out.lookCamera = 0.05
      // 左手は部品をつまみ直し、右手は工具の先を細かく動かす
      out.handL.thumbCurl += Math.sin(t * 2.3 + 1) * 0.06
      out.handL.index += Math.sin(t * 2.3 + 1) * 0.05
      out.handR.wrist += a * 0.08
      out.handR.index += Math.sin(t * 3.1 + 0.6) * 0.04
      break
    }
    case 'type': {
      // 立ったままキーボードを打つ（左右の手が交互に小さく上下する）
      const tapL = Math.max(0, Math.sin(t * 17)) * 0.05
      const tapR = Math.max(0, Math.sin(t * 15 + 1.3)) * 0.05
      setArm(out.armL, 0.42, 0.14, 1.05 + tapL)
      setArm(out.armR, 0.45, 0.12, 1.02 + tapR)
      out.lean = 0.22
      out.headPitch = 0.08 + Math.sin(t * 0.4) * 0.03
      out.headYaw = Math.sin(t * 0.33) * 0.22
      out.lookCamera = 0.05
      // 指が 1 本ずつキーを押す
      typeFingers(out, t, 1)
      break
    }
    case 'look': {
      // 後ろで手を組んで、展示をゆっくり眺める
      setArm(out.armL, -0.28, 0.12, 1.35, 2.5)
      setArm(out.armR, -0.28, 0.12, 1.35, 2.5)
      out.headYaw = Math.sin(t * 0.3) * 0.38
      out.headPitch = 0.12 + Math.sin(t * 0.52) * 0.05
      out.headRoll = Math.sin(t * 0.3) * 0.06
      out.lean = 0.05
      out.lookCamera = 0
      break
    }
    case 'gaze': {
      // 窓の前に立って外を眺める。左手は胸のペンダントに軽く添え、右腕は下ろしたまま（.vrma があれば、右腕と体は待機の .vrma のまま。ACTION_PART）。
      // 前は左腕を前へ伸ばして窓に手を当てていたが、立ち寄り先からガラスまでの距離は場所ごとに違い（ラボの窓際で約 0.6m）、
      // 腕が届かずに手が宙に浮いて、腕が前へ伸びたまま固まって見えた
      const sway = Math.sin(t * 0.43 + 0.6)
      setArm(out.armL, GAZE_ARM.raise + sway * 0.015, GAZE_ARM.out, GAZE_ARM.elbow + Math.sin(t * 0.31) * 0.025, GAZE_ARM.twist)
      // 指先がごくゆっくりペンダントをなぞる
      const drift = Math.sin(t * 0.37 + 1.4) * 0.05
      addCurl(out.handL, drift, drift * 0.8, drift * 0.6, drift * 0.4)
      out.handL.thumbCurl += Math.sin(t * 0.29) * 0.04
      out.headPitch = -0.08 + Math.sin(t * 0.35) * 0.04
      out.headYaw = Math.sin(t * 0.22) * 0.3
      out.tilt = 0.02
      out.lookCamera = 0
      break
    }
    case 'sit': {
      // 椅子に座る: 座面の上へ腰を前に動かして下ろし、太ももを前へ、すねは下へ（高い椅子なら足をのせ台に）。
      // 両手は前の机・カウンターに置き、ときどき指を動かす
      const h = seat?.height ?? 0.46
      const breath = Math.sin((t / 4.6) * Math.PI * 2)
      const seatToHip = body.hipHeight * SEAT_TO_HIP_RATIO
      out.bob = h + seatToHip - body.hipHeight + breath * 0.002
      out.shift = seat?.shift ?? 0.3
      const thigh = h > 0.62 ? 1.42 : 1.36
      out.thighL = thigh + Math.sin(t * 0.31) * 0.02
      out.thighR = thigh - 0.06 + Math.sin(t * 0.27 + 1) * 0.02
      out.kneeL = thigh + (h > 0.62 ? 0.25 : 0.02)
      out.kneeR = thigh + (h > 0.62 ? 0.12 : 0.1)
      setArm(out.armL, 0.62 + breath * 0.01, 0.18, 1.2 + Math.sin(t * 0.7) * 0.03)
      setArm(out.armR, 0.66, 0.16, 1.12 + Math.sin(t * 0.53 + 2) * 0.03)
      out.lean = 0.13 + Math.sin(t * 0.21) * 0.015
      out.headPitch = 0.12 + Math.sin(t * 0.37) * 0.04
      out.headYaw = Math.sin(t * 0.19) * 0.12
      out.lookCamera = 0.3
      out.handL.wrist += Math.sin(t * 1.3) * 0.04
      out.handR.index += Math.max(0, Math.sin(t * 0.9)) * 0.08
      if (seat?.desk !== undefined && seat.hands !== 'lap') {
        // 前腕を天板に置く（座面と天板の差は椅子ごとに違う。作業机 0.26m・カウンター 0.3〜0.35m）
        const drop = h + seatToHip + sitShoulderAboveHip(out.lean, body) - seat.desk
        armOnDesk(out.armL, drop + breath * 0.004, body)
        armOnDesk(out.armR, drop, body)
      }
      if (seat?.hands === 'grip') {
        // ハンドルを握る（ホバーの一人乗り）: 背すじを起こして前を見る。腕は肩から握り（前へ reach・座面から desk の高さ）へ、
        // 上腕と前腕（と手のひらの真ん中まで）の 2 本の骨で届かせる（肘は少し曲げて下へ）。手は握る形
        out.lean = 0.08 + Math.sin(t * 0.21) * 0.008
        const U = body.upperArm
        const F = body.foreArm + 0.07
        const fwd = (seat.reach ?? 0.5) - Math.sin(out.lean) * body.shoulderAboveHip
        const down = h + seatToHip + sitShoulderAboveHip(out.lean, body) - (seat.desk ?? h + 0.3)
        const D = THREE.MathUtils.clamp(Math.hypot(fwd, down), Math.abs(U - F) + 0.02, U + F - 0.015)
        const toward = Math.atan2(fwd, down)
        const atShoulder = Math.acos(THREE.MathUtils.clamp((U * U + D * D - F * F) / (2 * U * D), -1, 1))
        const elbow = Math.PI - Math.acos(THREE.MathUtils.clamp((U * U + F * F - D * D) / (2 * U * F), -1, 1))
        for (const [a, k] of [
          [out.armL, 1],
          [out.armR, 0.97],
        ] as const) {
          a.raise = (toward - atShoulder) * k + breath * 0.006
          a.elbow = elbow
          a.out = 0.16
          a.twist = 0
          a.elbowSide = 0
        }
        setHand(out.handL, HANDS.hold)
        setHand(out.handR, HANDS.hold)
        out.handL.wrist += 0.1
        out.handR.wrist += 0.1
        out.headPitch = 0.02 + Math.sin(t * 0.37) * 0.02
        out.headYaw = Math.sin(t * 0.19) * 0.15
        out.lookCamera = 0.15
      }
      if (seat?.hands === 'lap') {
        // 両手をひざの上に重ねて、背すじを少し起こす（前に机が無い長いす）
        setArm(out.armL, 0.3 + breath * 0.01, 0.2, 1.02 + Math.sin(t * 0.6) * 0.02, 0.2)
        setArm(out.armR, 0.32, 0.19, 0.98 + Math.sin(t * 0.47 + 2) * 0.02, 0.2)
        out.lean = 0.05 + Math.sin(t * 0.21) * 0.01
        out.headPitch = 0.04 + Math.sin(t * 0.37) * 0.03
        out.lookCamera = 0.35
      }
      break
    }
    case 'pet': {
      // KB-001 をなでる
      const s = Math.sin(t * 2.4)
      setArm(out.armR, 1.2 + s * 0.08, 0.1, 0.45 + s * 0.12)
      out.handR.wrist += s * 0.12
      out.headPitch = 0.1
      out.headYaw = -0.1
      out.headRoll = 0.08
      out.lean = 0.06
      out.lookCamera = 0.2
      break
    }
  }
  return out
}

/**
 * 打鍵の指（1 本ずつ、少しずつずらしてキーを押す）。強さ k（devGestures の「速く打つ」で大きくする）
 */
export function typeFingers(p: BodyPose, t: number, k: number) {
  const tap = (ph: number) => Math.pow(Math.max(0, Math.sin(t * 11 + ph)), 3) * 0.2 * k
  addCurl(p.handL, tap(0), tap(2.1), tap(4.3), tap(1.2) * 0.5)
  addCurl(p.handR, tap(3.4), tap(0.9), tap(5.2), tap(2.7) * 0.5)
  return p
}

/** 歩き（周期 gait、強さ walk）を姿勢に重ねる */
export function applyGait(p: BodyPose, gait: number, walk: number, speed: number) {
  if (walk <= 0.001) return p
  const amp = walk * (0.33 + 0.12 * Math.min(1, speed / 1.1))
  const s = Math.sin(gait)
  p.thighL = THREE.MathUtils.lerp(p.thighL, s * amp, walk)
  p.thighR = THREE.MathUtils.lerp(p.thighR, -s * amp, walk)
  // 振り出す脚の膝を曲げる
  p.kneeL = THREE.MathUtils.lerp(p.kneeL, Math.max(0, Math.sin(gait + 1.1)) * 0.75 * amp * 2, walk)
  p.kneeR = THREE.MathUtils.lerp(p.kneeR, Math.max(0, Math.sin(gait + 1.1 + Math.PI)) * 0.75 * amp * 2, walk)
  // 腕は脚と逆に振る
  const armSwing = s * 0.42 * walk
  p.armL.raise = THREE.MathUtils.lerp(p.armL.raise, -armSwing, walk)
  p.armR.raise = THREE.MathUtils.lerp(p.armR.raise, armSwing, walk)
  p.armL.out = THREE.MathUtils.lerp(p.armL.out, 0.2, walk)
  p.armR.out = THREE.MathUtils.lerp(p.armR.out, 0.2, walk)
  p.armL.elbow = THREE.MathUtils.lerp(p.armL.elbow, 0.35 + Math.max(0, -s) * 0.3, walk)
  p.armR.elbow = THREE.MathUtils.lerp(p.armR.elbow, 0.35 + Math.max(0, s) * 0.3, walk)
  p.armL.twist = THREE.MathUtils.lerp(p.armL.twist, 0, walk)
  p.armR.twist = THREE.MathUtils.lerp(p.armR.twist, 0, walk)
  // 上下動（1 周期に 2 回）・腰の揺れ・少し前傾
  p.bob += walk * 0.028 * (0.5 - 0.5 * Math.cos(2 * gait)) - walk * 0.02
  p.tilt += Math.sin(gait) * 0.03 * walk
  p.twist += Math.sin(gait) * 0.05 * walk
  p.lean = THREE.MathUtils.lerp(p.lean, 0.06, walk)
  p.headPitch = THREE.MathUtils.lerp(p.headPitch, 0.04, walk)
  lerpHand(p.handL, HANDS.walk, walk)
  lerpHand(p.handR, HANDS.walk, walk)
  return p
}

/** 2 つの姿勢を混ぜる（out = a から b へ k だけ） */
export function blendPose(a: BodyPose, b: BodyPose, k: number, out: BodyPose) {
  const L = THREE.MathUtils.lerp
  for (const side of ['armL', 'armR'] as const) {
    for (const key of ['raise', 'out', 'twist', 'elbow', 'elbowSide'] as const) out[side][key] = L(a[side][key], b[side][key], k)
  }
  for (const key of ['thighL', 'thighR', 'kneeL', 'kneeR', 'lean', 'tilt', 'twist', 'headPitch', 'headYaw', 'headRoll', 'bob', 'shift', 'lookCamera'] as const) {
    out[key] = L(a[key], b[key], k)
  }
  blendHand(a.handL, b.handL, k, out.handL)
  blendHand(a.handR, b.handR, k, out.handR)
  return out
}

/** 手を振るときの腕（ラジアン）。swing は肘の曲げの振れ幅（片側） */
const WAVE_ARM = { raise: 0.55, out: 1.0, twist: -1.1, elbow: 1.95, swing: 0.3 } as const

/** 手を振る速さ（振りの位相 = 振り始めてからの秒 × これ。11 で 1 秒に約 1.75 往復） */
export const WAVE_RATE = 11

/**
 * 手を振る（本人の左手 = カメラから見て右手）。w は強さ、ph は振りの位相（ラジアン。1 秒に約 1.75 往復の速さで渡す）。
 *
 * 人の「バイバイ」と同じ形にする: 上腕は横へ肩より少し下まで上げて少し前に出し、外へひねって肘の曲がる向きを上にする。
 * 肘を曲げて前腕を立て、肘の曲げ伸ばしで前腕を左右（頭の方と外側）に振る。手のひらはカメラの方。
 * （前は肘を伸ばしたまま横へ倒して振っていたので、肘が曲がらない向きに折れて見えた）
 */
export function applyWave(p: BodyPose, w: number, ph: number) {
  if (w <= 0.001) return p
  const L = THREE.MathUtils.lerp
  const a = p.armL
  const sway = Math.sin(ph)
  // 振りの中で肩も少しだけ動かす（前腕だけが動くと機械っぽい）
  a.raise = L(a.raise, WAVE_ARM.raise + Math.sin(ph - 0.6) * 0.03, w)
  a.out = L(a.out, WAVE_ARM.out + sway * 0.05, w)
  a.twist = L(a.twist, WAVE_ARM.twist, w)
  // 肘は上げ下ろしの途中では浅く曲げる（w の 2 乗）。曲げたまま上腕のひねりが戻ると、前腕が胸の前を横切るため
  a.elbow = L(a.elbow, WAVE_ARM.elbow + sway * WAVE_ARM.swing, w * w)
  a.elbowSide = L(a.elbowSide, 0, w)
  lerpHand(p.handL, HANDS.wave, w)
  // 手首は前腕より少し遅れて付いてくる
  p.handL.wrist += Math.sin(ph - 1.1) * 0.1 * w
  p.headRoll = L(p.headRoll, -0.07, w)
  p.headYaw = L(p.headYaw, 0.06, w)
  p.tilt = L(p.tilt, -0.025, w)
  return p
}


/** 両手を上げて跳ねる（最大の演出）。w は強さ、ct は始まってからの秒 */
export function applyCheer(p: BodyPose, w: number, ct: number) {
  if (w <= 0.001) return p
  const L = THREE.MathUtils.lerp
  const shake = Math.sin(ct * 13) * 0.12
  for (const [a, sd] of [
    [p.armL, 1],
    [p.armR, -1],
  ] as const) {
    a.raise = L(a.raise, 0.35, w)
    a.out = L(a.out, 2.7 + shake * sd, w)
    a.twist = L(a.twist, 0, w)
    a.elbow = L(a.elbow, 0.25, w)
    a.elbowSide = L(a.elbowSide, 0, w)
  }
  lerpHand(p.handL, HANDS.open, w)
  lerpHand(p.handR, HANDS.open, w)
  // 3 回跳ねる（しゃがんでから跳ぶ）
  const hopT = ct - 0.2
  let hop = 0
  let crouch = 0
  if (hopT > 0 && hopT < 2.1) {
    const k = (hopT % 0.7) / 0.7
    hop = Math.max(0, Math.sin(k * Math.PI)) * 0.14
    crouch = k > 0.85 || k < 0.08 ? 0.35 : 0
  }
  p.bob += hop * w
  p.kneeL = L(p.kneeL, crouch, w)
  p.kneeR = L(p.kneeR, crouch, w)
  p.thighL = L(p.thighL, crouch * 0.5, w)
  p.thighR = L(p.thighR, crouch * 0.5, w)
  p.headPitch = L(p.headPitch, -0.12, w)
  p.lean = L(p.lean, -0.05, w)
  return p
}

/**
 * コメントを読む仕草（chat.pick の「DECODING…」の間）: 右手をあごに当て、左手でその肘を支え、少し前かがみになる。
 * w は強さ（0〜1）、t はシーンの経過秒（小さく揺らす）
 */
export function applyRead(p: BodyPose, w: number, t: number) {
  if (w <= 0.001) return p
  const L = THREE.MathUtils.lerp
  const r = p.armR
  r.raise = L(r.raise, 1.02 + Math.sin(t * 1.3) * 0.03, w)
  r.out = L(r.out, 0.42, w)
  r.twist = L(r.twist, 0.55, w)
  r.elbow = L(r.elbow, 2.25, w)
  r.elbowSide = L(r.elbowSide, 0, w)
  const l = p.armL
  l.raise = L(l.raise, 0.5, w)
  l.out = L(l.out, 0.02, w)
  l.twist = L(l.twist, 1.25, w)
  l.elbow = L(l.elbow, 1.7, w)
  l.elbowSide = L(l.elbowSide, 0, w)
  lerpHand(p.handR, HANDS.chin, w)
  lerpHand(p.handL, HANDS.hold, w)
  p.lean = L(p.lean, 0.06, w)
  p.tilt = L(p.tilt, 0.05, w)
  p.headRoll = L(p.headRoll, 0.1, w)
  return p
}
