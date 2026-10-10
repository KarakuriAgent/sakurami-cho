import { circleOf } from '../../labPlan'
import type { LabKitPlan, Placement } from '../plan'

/**
 * ホロテーブルのデータの側。寸法・アンカー・障害物（作る側は kits/holoTable.ts）
 *
 * - top: 天板の上に物を置く高さ（world/places.ts の 'holotable' の置き場所。天板の面 0.95 より少し上）
 * - projector: 天板の真ん中の投影機（screen/state.ts の SCREEN_SLOT_DEFS.holotable.projector の高さ）
 * - projection: 投影の中身（差し込み口 projection。kanon-lab は KB-001 の分解図）の中心の高さ HOLO_Y
 */

/** 天板の上に物を置く高さ */
export const HOLOTABLE_TOP = 0.955
/** 投影機（光の線が出る所）の高さ */
const PROJECTOR_Y = 1.02
/** 投影の中身の中心の高さ（作る側の kits/holoTable.ts もこれを読む。4-1 で 2 か所にあった数を 4-9 で 1 つに） */
export const HOLO_Y = 1.62

const HOLO_TABLE = circleOf('ホロテーブル')

export function holoTablePlan(at: Placement): LabKitPlan {
  const [x, , z] = at.position
  return {
    anchors: {
      top: { p: [x, HOLOTABLE_TOP, z] },
      projector: { p: [x, PROJECTOR_Y, z] },
      projection: { p: [x, HOLO_Y, z] },
    },
    // 高さは上に浮かぶホログラムまで（追従カメラがホログラム越しに花音を写さないように）
    obstacles: [{ kind: 'circle', name: 'ホロテーブル', center: HOLO_TABLE.center, radius: HOLO_TABLE.radius + 0.15, height: 2.3 }],
  }
}
