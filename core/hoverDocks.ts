/**
 * 花音のホバーの一人乗り（character/ride/hoverRide.ts）の乗り場。docs/design/town.md §21・§7 の 211〜。
 *
 * 乗り場は浮遊レーンのそばの、道（町の道のグラフ）から歩いて入れる台。今は丘レーンの両端の 2 つ（ラボの前の置き場・桜見駅 北口）。
 * 途中の乗り場（百段石段の上など）は、置ける平らな所が無く（家と石段と木）、まだ無い（§7 の 212）。ホバーはここに置き、ここから浮き上がって浮遊レーンへ入り、
 * 行き先の乗り場へ下りる（同じレーンの上だけ。レーンを乗り継ぐのは、まだ）。
 * - pad: 台の真ん中（シーンの x, z）。heading: 置いたホバーの向き（シーンの heading。0 = +z）
 * - access: 歩いて来る・出て行く所（町の平面座標。町の道のグラフへつなぐ点。ラボはゾーンの出入口と同じ）
 * - side: 乗り降りする側（ホバーの局所の x の向き。+1 = 前を向いて左）
 * - lane: 浮遊レーンの id（町の地図データの float_lane）
 */

export type HoverDockId = 'lab' | 'kitaguchi'

export interface HoverDock {
  id: HoverDockId
  label: string
  lane: string
  pad: readonly [number, number]
  heading: number
  access: readonly [number, number]
  side: 1 | -1
  /** 花音の私物の置き場（充電の柱と名前の札）。ほかは町の乗り場（共用の台） */
  private?: boolean
}

export const HOVER_DOCKS: Record<HoverDockId, HoverDock> = {
  // ラボの置き場: 見学エントランスの前の小径の西の芝生（丘レーンの端の真下の手前）。北口の方（西）を向けて置く
  lab: { id: 'lab', label: 'ラボの前のホバーの置き場', lane: 'float_lane.oka', pad: [-16.6, 12.4], heading: -Math.PI / 2, access: [-10.0, -9.0], side: -1, private: true },
  // 桜見駅 北口の駅舎の前の石畳（駅舎と東の赤れんがの建物の間。丘レーンの始まりの 9m 東）。ラボから来て下りる向き（西）へ向けて置き、北の側（駅舎の側）から乗り降りする
  kitaguchi: { id: 'kitaguchi', label: '桜見駅 北口のホバーの乗り場', lane: 'float_lane.oka', pad: [-684.0, 1516.0], heading: -Math.PI / 2, access: [-692.7, -1513.1], side: -1 },
}

export const HOVER_DOCK_IDS = Object.keys(HOVER_DOCKS) as HoverDockId[]
