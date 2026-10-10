import type { LabKitPlan, Placement } from '../plan'

/** ロボットアーム（工作ゾーンの床の中ほど）のデータの側。障害物（作る側は robotArm.ts） */

/** 作業範囲の印の半径 */
const REACH = 1.1

export function robotArmPlan(at: Placement): LabKitPlan {
  return {
    anchors: {},
    obstacles: [{ kind: 'circle', name: 'ロボットアームの作業範囲', center: [at.position[0], at.position[2]], radius: REACH, height: 2 }],
  }
}
