import { localAnchor, WINDOW_PLANTS, type LabAnchorPlan, type LabKitPlan, type Obstacle, type Placement } from '../plan'

/**
 * 窓際の観葉植物のデータの側。アンカー（1〜鉢の数。鉢の中心の床）と障害物（作る側は windowPlants.ts）。
 * 置き場所は原点で、鉢の位置は opts（既定は plan.ts の WINDOW_PLANTS）
 */

export interface WindowPlantsOpts {
  /** 鉢の中心の x と z */
  xs: readonly number[]
  z: number
}

export function windowPlantsPlan(at: Placement, opts: WindowPlantsOpts = WINDOW_PLANTS): LabKitPlan {
  const anchors: Record<string, LabAnchorPlan> = {}
  opts.xs.forEach((x, i) => {
    anchors[`${i + 1}`] = localAnchor(at, [x, 0, opts.z])
  })
  return {
    anchors,
    obstacles: opts.xs.map((x): Obstacle => ({ kind: 'circle', name: '観葉植物', center: [x, opts.z], radius: 0.3, height: 1.3 })),
  }
}
