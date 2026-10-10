import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { VisualIdleConfig } from './visualConfig'

/**
 * コードで作るポーズ。VRM の「正規化ボーン」（T ポーズで回転 0、軸がワールドにそろっている）に対する回転で書く。
 * モデルは +Z を向き、+X が本人の左手側。
 *
 *   腕を下ろす: 左上腕は Z 軸まわりにマイナス、右上腕はプラス
 *   ひじを前に曲げる: 左前腕は Y 軸まわりにマイナス、右前腕はプラス
 *   指を曲げる: 左手は Z 軸まわりにマイナス、右手はプラス
 *   うなずく（前に倒す）: X 軸まわりにプラス
 *   右（本人から見て。-X 側）を向く: Y 軸まわりにマイナス
 */

export type BoneEuler = [x: number, y: number, z: number, order?: THREE.EulerOrder]
export type Pose = Partial<Record<VRMHumanBoneName, BoneEuler>>

/**
 * 待機の基本姿勢（腕を自然に下ろす。指の形は character/avatar/hands.ts・vrmHands.ts で毎フレーム入れる）。
 * I は腕を下ろす角度とひじの曲げ（見た目の設定の idle。character/avatar/visualConfig.ts）
 */
export function idleBasePose(I: Pick<VisualIdleConfig, 'armDown' | 'elbowBend'>): Pose {
  return {
    spine: [0.03, 0, 0],
    chest: [-0.02, 0, 0],
    leftShoulder: [0, 0, -0.06],
    rightShoulder: [0, 0, 0.06],
    leftUpperArm: [-0.1, 0, -I.armDown],
    rightUpperArm: [-0.1, 0, I.armDown],
    leftLowerArm: [0, -I.elbowBend, 0],
    rightLowerArm: [0, I.elbowBend, 0],
    leftHand: [0.05, -0.12, -0.12],
    rightHand: [0.05, 0.12, 0.12],
    leftUpperLeg: [0, 0, 0.02],
    rightUpperLeg: [0, 0, -0.02],
  }
}

const _euler = new THREE.Euler()
const _q = new THREE.Quaternion()

/** ポーズの回転を四元数にする */
export function poseQuaternion(e: BoneEuler, out: THREE.Quaternion): THREE.Quaternion {
  _euler.set(e[0], e[1], e[2], e[3] ?? 'XYZ')
  return out.setFromEuler(_euler)
}

/** 正規化ボーンに回転を設定する（ボーンが無いモデルでは何もしない） */
export function setBone(vrm: VRM, name: VRMHumanBoneName, q: THREE.Quaternion) {
  vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.copy(q)
}

/** 追加の回転を今の回転に掛ける（呼吸・首振りなどを基本姿勢に重ねる） */
export function addBoneRotation(vrm: VRM, name: VRMHumanBoneName, x: number, y: number, z: number) {
  const node = vrm.humanoid.getNormalizedBoneNode(name)
  if (!node) return
  _euler.set(x, y, z, 'XYZ')
  _q.setFromEuler(_euler)
  node.quaternion.multiply(_q)
}
