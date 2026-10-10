import { registeredLabKit, type LabKitDef } from '../kit'
import { baseStationKit } from './baseStation'
import { cncCornerKit } from './cncCorner'
import { devDeskKit } from './devDesk'
import { dockKit } from './dock'
import { galleryKit } from './gallery'
import { holoTableKit } from './holoTable'
import { robotArmKit } from './robotArm'
import { serverRackKit } from './serverRack'
import { windowPlantsKit } from './windowPlants'
import { workbenchKit } from './workbench'

/**
 * 既定のキットの種類（plan と作る側の組。docs/design/map-split.md §6 の「段 4」・4-5）。registerLabKit で登録した種類が優先。
 * 種類は kits/plans.ts の LAB_KIT_PLANS と同じ 10 種で、どれも作る側を持つ（4-11 で全部そろったので、LabKitDef の create は必須にした）
 */
export const LAB_KITS: Readonly<Record<string, LabKitDef<any, any>>> = {
  baseStation: baseStationKit,
  holoTable: holoTableKit,
  workbench: workbenchKit,
  cncCorner: cncCornerKit,
  robotArm: robotArmKit,
  devDesk: devDeskKit,
  serverRack: serverRackKit,
  gallery: galleryKit,
  windowPlants: windowPlantsKit,
  dock: dockKit,
}

/** キットの種類（登録した物、無ければ既定。無い種類は undefined） */
export function labKitDef(kind: string): LabKitDef<any, any> | undefined {
  return registeredLabKit(kind) ?? (Object.hasOwn(LAB_KITS, kind) ? LAB_KITS[kind] : undefined)
}
