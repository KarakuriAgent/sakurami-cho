import { labKitPlanFn } from './kits/plans'
import { PLACE, WINDOW_PLANTS, type LabKitPlan, type Obstacle, type Placement } from './plan'

/**
 * 什器の置き場所の表（データの側。docs/design/map-split.md §6 の「段 4」）。表の順が作る順と毎コマの順になる（4-5 から）。
 * 外す・足すは表を filter・足した表を渡す（labKitPlanOf・labObstacles・labAnchor の placements、createLab の placements）。キットの種類（kit）の plan は
 * kits/plans.ts（差し替えは kit.ts の registerLabKit。plan を差し替えられるのは、その種類の plan を読む前だけ）。
 * three・React・アプリの側に依存しない。
 */

export interface LabPlacement {
  /** 置き場所の名前（アンカーの名前の頭。'baseStation' → 'baseStation.core'） */
  readonly id: string
  /** キットの種類（kits/plans.ts の名前） */
  readonly kit: string
  readonly at: Placement
  /** キットの opts（省けばキットの既定） */
  readonly opts?: object
}

/** 原点（置き場所を持たない什器。鉢の位置は opts で決める） */
const ORIGIN: Placement = { position: [0, 0, 0], rotationY: 0 }

export const LAB_PLACEMENTS: readonly LabPlacement[] = [
  { id: 'baseStation', kit: 'baseStation', at: PLACE.baseStation },
  { id: 'holoTable', kit: 'holoTable', at: PLACE.holoTable },
  { id: 'workshop', kit: 'workbench', at: PLACE.workshop },
  { id: 'workshopNorth', kit: 'cncCorner', at: PLACE.workshopNorth },
  { id: 'robotArm', kit: 'robotArm', at: PLACE.robotArm },
  { id: 'devDesk', kit: 'devDesk', at: PLACE.devDesk },
  { id: 'serverRack', kit: 'serverRack', at: PLACE.serverRack },
  { id: 'gallery', kit: 'gallery', at: PLACE.gallery },
  { id: 'windowPlants', kit: 'windowPlants', at: ORIGIN, opts: WINDOW_PLANTS },
  { id: 'kb001Dock', kit: 'dock', at: PLACE.kb001Dock },
]

/** 表の中の置き場所（無ければ undefined） */
export function labPlacement(id: string, placements: readonly LabPlacement[] = LAB_PLACEMENTS): LabPlacement | undefined {
  return placements.find((p) => p.id === id)
}

/** 表ごとに、置き場所の plan を 1 回だけ出す（同じ表なら同じ物を返す） */
const planCache = new WeakMap<readonly LabPlacement[], Map<string, LabKitPlan>>()

/** 置き場所のキットの plan（アンカーと障害物）。置き場所が表に無ければ undefined。キットの種類が無ければ例外 */
export function labKitPlanOf(id: string, placements: readonly LabPlacement[] = LAB_PLACEMENTS): LabKitPlan | undefined {
  let cache = planCache.get(placements)
  if (!cache) planCache.set(placements, (cache = new Map()))
  const hit = cache.get(id)
  if (hit) return hit
  const at = labPlacement(id, placements)
  if (!at) return undefined
  const plan = labKitPlanFn(at.kit)
  if (!plan) throw new Error(`lab: キットの種類が無い（${at.kit}。置き場所 ${id}）`)
  const out = plan(at.at, at.opts)
  cache.set(id, out)
  return out
}

/** 置き場所のキットの障害物（ワールド）。置き場所が表に無ければ空 */
export function labObstacles(id: string, placements: readonly LabPlacement[] = LAB_PLACEMENTS): readonly Obstacle[] {
  return labKitPlanOf(id, placements)?.obstacles ?? []
}
