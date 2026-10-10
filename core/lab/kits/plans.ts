import type { LabKitPlanFn } from '../plan'
import { baseStationPlan } from './baseStation.plan'
import { cncCornerPlan } from './cncCorner.plan'
import { devDeskPlan } from './devDesk.plan'
import { dockPlan } from './dock.plan'
import { galleryPlan } from './gallery.plan'
import { holoTablePlan } from './holoTable.plan'
import { robotArmPlan } from './robotArm.plan'
import { serverRackPlan } from './serverRack.plan'
import { windowPlantsPlan } from './windowPlants.plan'
import { workbenchPlan } from './workbench.plan'

/**
 * キットの種類 → データの側（plan）。置き場所の表（placements.ts）の kit の名前で引く（labKitPlanFn）。
 * 既定は LAB_KIT_PLANS。差し替え・足すのは kit.ts の registerLabKit（plan と作る側を一緒に登録する）で、plan はここに入る。
 *
 * 差し替えの時期（4-5 で決めた）: plan は読み込みの時の定数（config/layout.ts の OBSTACLES・world/places.ts の PLACES など）にも使う。
 * そのため、ある種類の plan を一度読んだら、その種類には違う plan を登録できない（例外）。同じ plan の関数での登録（作る側だけの差し替え）は
 * いつでもよい。plan を差し替えるときは、ラボのデータを読むモジュールより先に評価されるモジュール（使う側の入口のいちばん初め）で登録する。
 * 読み込みの時の定数と、あとで作るラボの物が違う plan を使うことは起きない。
 *
 * three・React・アプリの側に依存しない（データの側）
 */
export const LAB_KIT_PLANS: Readonly<Record<string, LabKitPlanFn<any>>> = {
  baseStation: baseStationPlan,
  holoTable: holoTablePlan,
  workbench: workbenchPlan,
  cncCorner: cncCornerPlan,
  robotArm: robotArmPlan,
  devDesk: devDeskPlan,
  serverRack: serverRackPlan,
  gallery: galleryPlan,
  windowPlants: windowPlantsPlan,
  dock: dockPlan,
}

/** 登録で差し替えた・足した plan */
const registered = new Map<string, LabKitPlanFn<any>>()
/** plan を一度でも読んだ種類（もう違う plan にできない） */
const used = new Set<string>()

function current(kind: string): LabKitPlanFn<any> | undefined {
  return registered.get(kind) ?? (Object.hasOwn(LAB_KIT_PLANS, kind) ? LAB_KIT_PLANS[kind] : undefined)
}

/**
 * 種類の plan を差し替える・足す（ふつうは kit.ts の registerLabKit から）。今と同じ関数なら何もしない。
 * その種類の plan をもう読んでいたら例外（読み込みの時の定数に、前の plan を使ったため）
 */
export function registerLabKitPlan(kind: string, plan: LabKitPlanFn<any>): void {
  if (current(kind) === plan) return
  if (used.has(kind)) {
    throw new Error(
      `lab: キットの種類 ${kind} の plan はもう読まれているので差し替えられない（障害物・アンカーなど読み込みの時の定数に使った。plan の差し替えは、ラボのデータを読むモジュールより先に登録する）`,
    )
  }
  registered.set(kind, plan)
}

/** 種類の plan（無ければ undefined）。読んだ種類は、そのあと違う plan を登録できない */
export function labKitPlanFn(kind: string): LabKitPlanFn<any> | undefined {
  const plan = current(kind)
  if (plan) used.add(kind)
  return plan
}
