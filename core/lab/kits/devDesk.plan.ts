import { rectOf } from '../../labPlan'
import { localAnchor, WALL_PANEL_DEPTH, type LabKitPlan, type Placement, type Vec3 } from '../plan'

/**
 * 開発デスク（窓際の L 字のデスク）のデータの側。寸法・アンカー・障害物（作る側は kits/devDesk.ts）
 *
 * - desk.a・desk.b: 作品の置き場所 'desk' の 1・2 つ目（天板の上）
 * - taskSign: 作業の見出し（kanon-lab の DevTaskSign）の位置と向き。前はデスクの群 → モニタの群（ローカル x = MONITOR_X）の中の
 *   [0, DESK_H + 1.5, 0.95]・向き 0.3。アンカーは「置き場所＋ローカル」（モニタの群のずれを足したローカル）で持つ。
 *   置き場所と同じ位置・向きの群の子にこのローカルで置けば、行列が前と最後の桁まで同じになる（4-0 で確かめ、4-8 でこの形に付け替えた）
 * - monitor（中央のモニタ）は作った時に行列から出すので、データの側には無い（インスタンスの側。kits/devDesk.ts）
 */

/** デスクの天板の高さ（作る側の kits/devDesk.ts もこれを読む） */
export const DESK_H = 0.74
/** モニタ・キーボード・空中パネルの並びの中心（モニタの群のローカル x。作る側もこれを読む） */
export const MONITOR_X = 0.3
/** 作品を置く天板の上の高さ（world/places.ts の 'desk' の置き場所） */
export const DESK_TOP = 0.742
export const DESK_A_LOCAL: Vec3 = [0.88, DESK_TOP, WALL_PANEL_DEPTH + 0.52]
export const DESK_B_LOCAL: Vec3 = [-0.92, DESK_TOP, WALL_PANEL_DEPTH + 0.6]

const DESK = rectOf('開発デスク')

export function devDeskPlan(at: Placement): LabKitPlan {
  return {
    anchors: {
      'desk.a': localAnchor(at, DESK_A_LOCAL),
      'desk.b': localAnchor(at, DESK_B_LOCAL),
      taskSign: localAnchor(at, [MONITOR_X, DESK_H + 1.5, 0.95], 0.3),
    },
    obstacles: [
      { kind: 'rect', name: '開発デスク（長辺）', min: [DESK.min[0], 3.9], max: DESK.max, height: 1.9 },
      { kind: 'rect', name: '開発デスク（短辺）', min: [6.5, DESK.min[1]], max: [DESK.max[0], 3.9], height: 1.2 },
      { kind: 'circle', name: '椅子', center: [6.0, 3.35], radius: 0.38, height: 1.2 },
    ],
  }
}
