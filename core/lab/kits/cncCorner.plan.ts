import { localAnchor, ROOM, WALL_PANEL_DEPTH, type LabKitPlan, type Placement, type Vec3 } from '../plan'

/**
 * CNC の隅（北の壁沿いの置き場所 workshopNorth: CNC・パーツケース）のデータの側。寸法・アンカー・障害物（作る側は cncCorner.ts）
 *
 * - partsCabinet.front: パーツケースの前（KB-001 が部品を取り出す所）
 * - partsCabinet.out: パーツケースの前の、部屋の側へ出た所（床の高さ）
 */

/** パーツケース（cncCorner.ts のパーツケース）の置き場所のローカル x */
export const PARTS_CABINET_X = 0.5
export const PARTS_CABINET_FRONT_LOCAL: Vec3 = [PARTS_CABINET_X, 1.42, WALL_PANEL_DEPTH + 0.62]
export const PARTS_CABINET_OUT_LOCAL: Vec3 = [PARTS_CABINET_X, 0, WALL_PANEL_DEPTH + 1.05]

export function cncCornerPlan(at: Placement): LabKitPlan {
  return {
    anchors: {
      'partsCabinet.front': localAnchor(at, PARTS_CABINET_FRONT_LOCAL),
      'partsCabinet.out': localAnchor(at, PARTS_CABINET_OUT_LOCAL),
    },
    obstacles: [{ kind: 'rect', name: 'CNC・パーツケース', min: [-7.4, ROOM.north], max: [-5.45, -1.5], height: 1.8 }],
  }
}
