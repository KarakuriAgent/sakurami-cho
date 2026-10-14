import { useFrame } from '@react-three/fiber'
import type { Character } from '../character/avatar/character'
import { updateRiders } from '../character/ride/riders'

export interface RideDriverProps {
  /** 乗り物に乗る人（乗る仕組みの状態は Character ごと。ch.rides。kanon-lab は花音 1 人） */
  characters: readonly Character[]
}

/**
 * 乗り物に乗る仕組みを毎コマ進める R3F の薄い包み（Canvas の中に 1 つだけ置く。5-5 で character/ride から移した）。
 * 乗る仕組みの中身は three の形（character/ride/riders.ts の updateRiders）で、ここは useFrame の時期に合わせて呼ぶだけ。
 *
 * 優先度 -79（町の毎コマの初め town.begin（−90。早送り・カットの分を町の時刻へ → 外の状態 → 交通の時計 → ホイールの角度。react/TownView.tsx の
 * TownClock）のあと、花音を動かす KanonNavigator の -58 より前）: 乗る人の乗り物（updateRiders。ケーブルの線・緑電と運河バスの運行・誰も乗っていない間のホバー →
 * 乗る人ごと）。地図の更新を乗る人の数によらず 1 コマ 1 回にするため（交通の時計とホイールは 5-6 で town.begin へ。docs/design/map-split.md §7）
 */
export function RideDriver({ characters }: RideDriverProps) {
  useFrame(({ clock }, delta) => {
    updateRiders(characters, clock.elapsedTime, delta)
  }, -79)
  // ?debug の道具（早送りの様子 __warp と、乗る人ごとの __ride・__cable・__tram・__boat・__hover）は src/kanon/index.ts が作る
  return null
}
