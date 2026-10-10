import type { Character } from '../avatar/character'
import { driveWheel } from './ride'
import { driveCable } from './cableRide'
import { driveTram } from './tramRide'
import { driveBoat } from './boatRide'
import { driveHover } from './hoverRide'

/**
 * 乗り物に乗っている間に人を動かす、標準の順（Character の drivers.motion に付ける。docs/design/map-split.md §8 の段 6）。
 * 観覧車ソラノワ（ride.ts）→ 丘ノ上ケーブル（cableRide.ts）→ 緑電（tramRide.ts）→ 運河バス（boatRide.ts）→ ホバー（hoverRide.ts）の順に聞き、
 * どれかが動かしたら（乗り込み・乗っている間・降りるの途中）true を返す（それより後ろは聞かない）。乗る仕組みを毎コマ進めるのは
 * character/ride/riders.ts の updateRiders（R3F は react/RideDriver.tsx。人を動かす locomotion より前）。
 *
 * 使い方: `ch.drivers.motion = driveRides`（町の中の移動は `ch.drivers.travel = driveTravel`）。
 * kanon-lab の花音（src/kanon/index.ts）は同じ順を自分で組んでいて、ここは読まない（読むとモジュールの評価の順が変わるため。段 6 の例のアプリから使う）
 *
 * @param t 描画の時計の秒
 * @param dt このコマの秒（locomotion に渡した物と同じ）
 */
export function driveRides(ch: Character, t: number, dt: number): boolean {
  return driveWheel(ch, t, dt) || driveCable(ch, t, dt) || driveTram(ch, t, dt) || driveBoat(ch, t, dt) || driveHover(ch, t, dt)
}
