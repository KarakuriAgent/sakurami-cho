import { CABLE_STATIONS, stationPlan, stationScene, type CableStationZone } from './cableStations'
import { DOME_FRAME, sceneOf, type InteriorZoneId } from './interiors'
import { TOWN_PLACES, type TownPlaceId } from './places'
import { WAYPOINTS } from './routes'

/**
 * 花音が町の中を移動する（kanon.travel。character/avatar/travel.ts）ときの、ゾーンの出入口と町の行き先。docs/design/town.md §18。
 *
 * ゾーン（ラボとそのまわり・中のある建物）と町の道は、出入口（portal）でつながる:
 * - town: 町の道のグラフの上の点（町の平面座標。道順の点 WAYPOINTS と同じ所）
 * - zone: ゾーンの中の歩ける点（シーンの x, z。立ち寄り先の名前（地図の表 core/places.ts の TOWN_PLACES）でもよい）。ゾーンの中の通り道（ラボは character/avatar/nav.ts、建物は interior/model.ts）で
 *   ここまで歩き、ここから town まではまっすぐ歩く
 */

export type TravelZone = 'lab' | InteriorZoneId

export interface PortalDef {
  id: string
  label: string
  town: readonly [number, number]
  zone: TownPlaceId | readonly [number, number]
}

const scenePoint = (p: readonly [number, number]) => [p[0], -p[1]] as const
const domeLocal = (s: number, t: number) => {
  const p = sceneOf(DOME_FRAME, s, t)
  return [p[0], p[2]] as const
}

export const ZONE_PORTALS: Record<TravelZone, PortalDef[]> = {
  // ラボの見学エントランスの前（天文台の擁壁沿いの小径の端。ラボの前のセットの小道の上）
  lab: [{ id: 'main', label: 'ラボの見学エントランスの前', town: WAYPOINTS.lab.at, zone: scenePoint(WAYPOINTS.lab.at) }],
  // 家の門の外（百段石段の 68 段目の踊り場。ポーチの木の階段の下を石段の線に下ろした所。§7 の 170）。道順の点 WAYPOINTS.house は
  // 町の地図データの道順の計算の点（段を等しく並べたときの 68 段目。踊り場の 3.5m 上）なので、出入口は踊り場の真ん中にする
  thompson: [{ id: 'main', label: 'トンプソン家の門の外（百段石段の 68 段目）', town: [-656.9, -367.0], zone: 'thompson-front' }],
  // 星見石段の下（立ち寄り先 seizu-front。石段の段の線の上）と、星見石段の上（入口の前の踊り場。道順 B の終わり）。
  // 石段の下から出入りできないと、石段の下の seizu-front へ来るのに石段を上って入口の前から下り、出るときも一度上ってから下りていた（§7 の 217）。
  // ゾーンを出るのは 1 つ目（石段の下。店の中からも石段を下りて出る）、入るのは route=auto ならいちばん早い方、道順 B は上（portal: 'main'）
  seizu: [
    { id: 'stairs', label: '星見石段の下（星図珈琲の前）', town: [-683.13, -1712.87], zone: 'seizu-front' },
    { id: 'main', label: '星見石段の上（星図珈琲の入口の前）', town: WAYPOINTS.seizu.at, zone: scenePoint(WAYPOINTS.seizu.at) },
  ],
  // 駅前広場（店のテラスの柵の切れ目の前）
  cafe: [{ id: 'main', label: '駅前広場（Café Platform 1872 の前）', town: WAYPOINTS.cafe.at, zone: 'cafe-front' }],
  // 南門（噴水広場の側の石段の下）と、北門（職員通用口。ルート D）
  dome: [
    { id: 'south', label: 'ガーデンドームの南門の前', town: [TOWN_PLACES['dome-gate'].position[0], -TOWN_PLACES['dome-gate'].position[2]], zone: 'dome-gate' },
    { id: 'north', label: 'ガーデンドームの北門（職員通用口）の外', town: WAYPOINTS.domeNorth.at, zone: domeLocal(0, 74.6) },
  ],
  // 乗り場の建物の前の広場
  soranowa: [{ id: 'main', label: '大観覧車ソラノワの乗り場の前', town: [TOWN_PLACES['soranowa-front'].position[0], -TOWN_PLACES['soranowa-front'].position[2]], zone: 'soranowa-front' }],
  // 丘ノ上ケーブルの 3 駅（core/cableStations.ts。頂上駅は北東の出口・楓坂駅は西口・麓駅は正面の入口）
  'cable-summit': [stationPortal('cable-summit')],
  'cable-kaedezaka': [stationPortal('cable-kaedezaka')],
  'cable-fumoto': [stationPortal('cable-fumoto')],
}

/** 駅の出入口（扉の外の町の点と、扉の中の点） */
function stationPortal(zone: CableStationZone): PortalDef {
  const d = CABLE_STATIONS[zone]
  const p = stationScene(d, d.portalIn[0], d.portalIn[1])
  return { id: 'main', label: `${d.label}の入口`, town: stationPlan(d, d.portalOut[0], d.portalOut[1]), zone: [p[0], p[2]] }
}

/**
 * 町の行き先（ゾーンの外。kanon.travel の to）。at = 町の平面座標、face = 着いたら向く点。町の道の経路は at を道の上へつないだ所で終わり、
 * そこから at まで歩いて着く（at が町の歩ける所でなければ、at へまっすぐ向かって歩ける所の縁の手前まで。小野寺時計店の at は店の中の点なので、
 * 店の入口の前の時計坂の縁）
 */
export const TRAVEL_PLACES = {
  onodera: { label: '小野寺時計店の前（灯町二丁目 時計坂。祖父母の店。ルート E）', at: WAYPOINTS.onodera.at, face: [-650.6, -1861.0] },
  // ひらき通りの停留所の北の歩道（行きのホームの西のスロープの下の外。ガラス張りの公開ラボの並ぶ北の側を向く。§7 の 197）
  hiraki: { label: '学園地区 ひらき通りの停留所の前の歩道（緑電 4 系統。ルート F）', at: [777.0, -1417.4], face: [777.0, -1400.0] },
  // 桜見駅 北口の駅前（道順の点 north。丘レーンの端・ホバーの乗り場のそば。駅舎の方を向く。§7 の 212）
  kitaguchi: { label: '桜見駅 北口の駅前（丘レーンの端。ホバーの乗り場のそば）', at: WAYPOINTS.north.at, face: [-692.7, -1490.0] },
} as const satisfies Record<string, { label: string; at: readonly [number, number]; face: readonly [number, number] }>

export type TravelPlaceId = keyof typeof TRAVEL_PLACES
export const TRAVEL_PLACE_IDS = Object.keys(TRAVEL_PLACES) as TravelPlaceId[]
