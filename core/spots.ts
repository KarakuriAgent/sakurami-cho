import type { TownPlaceId } from './places'

/**
 * ワープ（コードでは teleport。warp は時刻の早送り・カットの名前）で跳べる所の名前の表（docs/design/map-split.md §8 の段 6-5）。
 * 中まで作り込んだ建物（入れる建物）の手前と、乗り物ののりばの手前。three を読まない。
 *
 * - ここに置くのは名前だけ（座標を写さない）。位置は立ち寄り先の表（core/places.ts の TOWN_PLACES。使う側が configurePlaces で渡した表）から引く
 * - ホバーは乗り場が無い（#9。どこからでも呼べる）ので入れない
 * - 緑電の停留所と運河バスの乗り場は、町の地図データ（infra.json の transit）にだけある（core に写すと sync-town の書き出しと二重になる）。
 *   町を組み立てたあとに character/avatar/teleport.ts の townSpots() が地図データから足す
 * - 鉄道の駅（桜見・鐘ヶ丘）は乗れないので入れない
 */

/** ワープ先の種類（一覧の組。並びは一覧の並び） */
export type SpotKind = 'building' | 'cable' | 'wheel' | 'tram' | 'waterbus'

/** ワープ先の種類と、一覧の組の名前（並びは一覧の並び。tram・waterbus は町の地図データを読んでから） */
export const SPOT_KINDS: readonly { readonly id: SpotKind; readonly label: string }[] = [
  { id: 'building', label: '建物' },
  { id: 'cable', label: 'ケーブルの駅' },
  { id: 'wheel', label: '観覧車' },
  { id: 'tram', label: '緑電の停留所' },
  { id: 'waterbus', label: '運河バスの乗り場' },
]

/**
 * 立ち寄り先の手前へ跳ぶワープ先（立ち寄り先の名前。どれも外の立ち寄り先 outdoor で、建物の入口・駅の前に立つ）。
 * ラボの前・中のある建物 4 つ（トンプソン家・星図珈琲・Café Platform 1872・ガーデンドーム）の前、ケーブルの 3 駅の前、観覧車ソラノワの乗り場の前
 */
export const PLACE_SPOTS: readonly { readonly place: TownPlaceId; readonly kind: SpotKind }[] = [
  { place: 'front', kind: 'building' },
  { place: 'thompson-front', kind: 'building' },
  { place: 'seizu-front', kind: 'building' },
  { place: 'cafe-front', kind: 'building' },
  { place: 'dome-gate', kind: 'building' },
  { place: 'cable-summit-front', kind: 'cable' },
  { place: 'cable-kaedezaka-front', kind: 'cable' },
  { place: 'cable-fumoto-front', kind: 'cable' },
  { place: 'soranowa-front', kind: 'wheel' },
]

