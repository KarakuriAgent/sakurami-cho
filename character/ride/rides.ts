import type { Character } from '../avatar/character'
import { createBoatRide, type BoatPlan } from './boatRide'
import { createCableRide, type CableRide } from './cableRide'
import { createHoverRide, type HoverRide } from './hoverRide'
import type { LineRide } from './lineRide'
import { createWheelRide, type WheelRide } from './ride'
import { createTramRide, type TramPlan } from './tramRide'

/**
 * 乗る仕組みの状態（Character ごと。ch.rides。docs/design/map-split.md §5 の「段 2 の作りの決めごと」）: 観覧車（ride.ts）・丘ノ上ケーブル（cableRide.ts）・
 * 緑電（tramRide.ts）・運河バス（boatRide.ts。どちらも lineRide.ts の LineRide）・ホバー（hoverRide.ts）。
 * 乗る仕組みの関数は Character を受けて、その人の状態（ch.rides.*）と乗っている間の状態（ch.ride）を読み書きする。作るのは character/avatar/createCharacter.ts
 */
export interface CharacterRides {
  wheel: WheelRide
  cable: CableRide
  tram: LineRide<TramPlan>
  boat: LineRide<BoatPlan>
  hover: HoverRide
}

export function createRides(ch: Character): CharacterRides {
  return { wheel: createWheelRide(ch), cable: createCableRide(ch), tram: createTramRide(ch), boat: createBoatRide(ch), hover: createHoverRide(ch) }
}
