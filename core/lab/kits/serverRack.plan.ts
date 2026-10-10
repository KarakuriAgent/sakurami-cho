import { rectOf } from '../../labPlan'
import { ROOM, type LabKitPlan, type Placement } from '../plan'

/** サーバラック（北の壁沿いの東。3 本）のデータの側。障害物（作る側は serverRack.ts） */

const RACK = rectOf('サーバーラック')

export function serverRackPlan(_at: Placement): LabKitPlan {
  return {
    anchors: {},
    obstacles: [{ kind: 'rect', name: 'サーバラック', min: [RACK.min[0], ROOM.north], max: RACK.max, height: 2.1 }],
  }
}
