import type { Character } from '../avatar/character'
import { updateCableLine, updateCableRide } from './cableRide'
import { updateRide } from './ride'
import { updateTramFleet, updateTramRide } from './tramRide'
import { updateBoatFleet, updateBoatRide } from './boatRide'
import { updateHoverCraft, updateHoverRide } from './hoverRide'

/**
 * 乗り物に乗る仕組み（観覧車 ride.ts・丘ノ上ケーブル cableRide.ts・緑電 tramRide.ts・運河バス boatRide.ts・花音のホバー hoverRide.ts）を
 * 毎コマ進める（5-5。前の src/ride/RideDriver.tsx の優先度 −79 の後半。R3F の包みは react/RideDriver.tsx）。
 * 乗る仕組みの状態は乗る人ごと（Character の rides）。乗っている間に人を動かすのは、それぞれの drive*（Character の drivers.motion に付ける。
 * kanon-lab は src/kanon/index.ts。locomotion のふだんの歩き・町の中の移動より先）。
 *
 * 交通の時計とホイールの角度を進めたあと（町の時刻を決めたあと。町の毎コマの初め town.begin。world/createTown.ts）・人を動かす前に呼ぶ
 * （kanon-lab は花音を動かす KanonNavigator の −58 より前）。
 * 乗る人ごとの更新の前に 1 回ずつ: ケーブルの 2 両の位置と扉・緑電と運河バスの便の位置と扉（誰かが乗っている間だけ）・誰も乗っていない間の
 * ホバー（置いてある・呼ばれて飛んで来る） → 乗る人ごとに（観覧車・ケーブル・緑電・運河バス・ホバー）乗っている車室の位置・扉・一緒に乗る仲間の道（character/ride/party.ts の
 * updateParty。ホバーの機体は乗っている人の更新が書く）。花音・仲間（KB-001）・カメラは、このコマの車室の位置に合わせて置く（1 コマ遅れない）。
 * ケーブルの線・緑電と運河バスの運行・ホバー（よける人）は乗る人を見て決める所があるので、段 5 では地図の毎コマ（town.begin・town.update）へ寄せない（案 §0 の 11）
 *
 * @param characters 乗り物に乗る人（kanon-lab は花音 1 人）
 * @param t 描画の時計の秒
 * @param dt このコマの秒
 */
export function updateRiders(characters: readonly Character[], t: number, dt: number) {
  updateCableLine()
  updateTramFleet(characters)
  updateBoatFleet(characters)
  updateHoverCraft(characters, dt)
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i]
    updateRide(ch, t, dt)
    updateCableRide(ch, t, dt)
    updateTramRide(ch, dt)
    updateBoatRide(ch, dt)
    updateHoverRide(ch, t, dt)
  }
}
