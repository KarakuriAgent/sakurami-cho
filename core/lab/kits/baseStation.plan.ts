import { rectOf } from '../../labPlan'
import { BASE_STATION_RING_Y, BASE_STATION_RING_Z, ROOM, type LabKitPlan, type Placement, type Vec3 } from '../plan'

/**
 * 基地局（資料の XW-08 本体）のデータの側。アンカーと障害物（three の物は作らない。作る側は kits/baseStation.ts）
 *
 * - core・ring: リングとコアの中心（config/layout.ts の BASE_STATION_CORE・配信の演出の投影元（scene/show/ShowStage.tsx）はこの core から。4-6）
 * - pollux.top: 右のサーバータワー（ポルックス）の天板の前の縁（ON AIR の投影元。HOLO_UI.onAir.projector の手で書いた数のまま。ワールド）
 * - castor.top: 左のサーバータワー（カストル）の同じ所（pollux.top を x で折り返した数。今は使う物が無い）
 */

const XW08 = rectOf('XW-08 本体（基壇）')
const DANGER = rectOf('危険線（黄色の破線）')

/** ポルックスの天板の前の縁（ワールド。手で書いた数。式に置き換えると最後の桁が変わる） */
const POLLUX_TOP: Vec3 = [2.0, 2.62, -0.8]
/** カストルの天板の前の縁（ワールド） */
const CASTOR_TOP: Vec3 = [-2.0, 2.62, -0.8]

export function baseStationPlan(at: Placement): LabKitPlan {
  const core: Vec3 = [at.position[0], BASE_STATION_RING_Y, at.position[2] + BASE_STATION_RING_Z]
  const coreLocal = () => ({ p: [0, BASE_STATION_RING_Y, BASE_STATION_RING_Z] as Vec3, yaw: 0 })
  return {
    anchors: {
      core: { p: core, local: coreLocal() },
      ring: { p: [...core], local: coreLocal() },
      'pollux.top': { p: POLLUX_TOP },
      'castor.top': { p: CASTOR_TOP },
    },
    obstacles: [
      { kind: 'rect', name: '基地局', min: [XW08.min[0], ROOM.north], max: [XW08.max[0], XW08.max[1]], height: ROOM.height },
      // 危険線の内側（資料: 見学者は危険線の外。花音も配信ではこの外を歩く。カメラは入ってよい）
      { kind: 'rect', name: '危険線の内側', min: [DANGER.min[0], ROOM.north], max: DANGER.max, height: 0, navOnly: true },
    ],
  }
}
