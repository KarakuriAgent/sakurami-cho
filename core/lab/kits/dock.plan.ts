import { circleOf } from '../../labPlan'
import { KB001_DOCK_TOP, KB001_HOVER, type LabKitPlan, type Placement } from '../plan'

/**
 * KB-001 のドック（ギャラリーの横）のデータの側。アンカーと障害物（作る側は kits/dock.ts。4-11）
 *
 * - pad: 台座の天面の中心
 * - hover: ドックの上で KB-001 が浮かぶ中心（kanon-lab の kb001/kb.ts の KB_DOCK_POINT はこのアンカーから。4-11）
 */

const DOCK = circleOf('KB-001 のドック')

export function dockPlan(at: Placement): LabKitPlan {
  const [x, , z] = at.position
  return {
    anchors: {
      pad: { p: [x, KB001_DOCK_TOP, z] },
      hover: { p: [x, KB001_DOCK_TOP + KB001_HOVER, z] },
    },
    obstacles: [{ kind: 'circle', name: 'KB-001 のドック', center: DOCK.center, radius: DOCK.radius, height: 1.5 }],
  }
}
