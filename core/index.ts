/**
 * 入口 core（three に依存しない: 座標・地名・道順・歩く道のグラフと経路探索・時刻表・データの形の版。docs/design/map-split.md §7）。
 *
 * 公開の口（段 6 の終わり 6-7 に決めた。docs/design/map-split.md §10・docs/usage.md の「公開の口」）。選んだ名前だけを出す（export * はしない。
 * 名前がぶつからないように・出す名前が公開の口になるので）。出すのは、例のアプリ（examples/town-walker）が使う物と、地図の表を差し替える・読む口
 * （立ち寄り先の表・ラボの置き場所の表とアンカー）、それらの引数・返り値・欄の型。ここにはコードを書かない（export だけ）。
 * kanon-lab はここからは読まず、深いパス（sakurami-cho/core/…）で読む（index から読むと、使わない物まで先に評価されて、モジュールの評価の順が変わるため）
 */
// 立ち寄り先の表（地図の既定の表・差し替える・今の表）
export { configurePlaces, TOWN_PLACES, townPlaces } from './places'
export type { PlaceAction, PlaceId, TownPlace, TownPlaceId } from './places'
// 中のある建物のゾーン・点のゾーン
export { INTERIOR_ZONES, zoneOfPoint } from './interiors'
export type { InteriorZoneId, ZoneId } from './interiors'
// 町の中の移動の行き先・道順
export { TRAVEL_PLACES } from './travel'
export type { TravelPlaceId } from './travel'
export { TRAVEL_ROUTE_IDS, TRAVEL_ROUTES } from './routes'
// ワープ先の種類
export { SPOT_KINDS } from './spots'
export type { SpotKind } from './spots'
// 時刻と日付を読む・時間帯の名前（町の時刻 town.sun.time の型 LabTime）
export { parseDate, parseTimeOfDay, timeOfDayName } from './clock'
export type { DateParts, LabTime } from './clock'
// 町の地図データの形の版・町の画質の段
export { TOWN_DATA, TOWN_QUALITY } from './town'
export type { TownQualityName } from './town'
// ラボの置き場所の表（地図の既定。使う側が足した表を react の TownRoot の placements に渡す）とアンカー
export { LAB_PLACEMENTS } from './lab/placements'
export type { LabPlacement } from './lab/placements'
export { labAnchor } from './lab/anchors'
export type { LabAnchorData } from './lab/anchors'
