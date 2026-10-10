import { townEvents } from '../townHost'
import type { OneShotId } from './synth'

/**
 * 町の物が鳴らす一度だけの音の合図（駅員ロボの会釈・発車の合図、ホバーの回し始め・着いたなど）。合図は push するだけで、町の音
 * （world/sound/townSound.ts）が毎コマ取り出して、聞く所（カメラ）からの距離と向きで鳴らす。
 * 地図の出来事（world/townHost.ts の townEvents）を合図にするのもここ（町の音を作ったときに 1 回。前は kanon-lab の townBinding.ts が聞いていた）
 */
export interface SoundCue {
  id: OneShotId
  /** シーンの座標 */
  x: number
  y: number
  z: number
  /** 音量の倍率（1 = ふつう） */
  gain: number
}

export const soundCues: SoundCue[] = []

/** 音を鳴らす（このコマの終わりに町の音が取り出す） */
export function cue(id: OneShotId, x: number, y: number, z: number, gain = 1) {
  if (soundCues.length < 64) soundCues.push({ id, x, y, z, gain })
}

/**
 * 地図の出来事を音の合図にする（町の音の createTownSound が呼ぶ。やめる関数を返す）。強さと、1 つの出来事で鳴らす順:
 * えきもりの会釈 0.8・発車の合図 0.9、ホバーの回し始め 0.9、台に着いた 0.8（着いた音 → 止める音の順に 2 つ）
 */
export function listenTownCues(): () => void {
  const offs = [
    townEvents.on('robot.bow', (p) => cue('robotBow', p.x, p.y, p.z, 0.8)),
    townEvents.on('robot.signal', (p) => cue('robotSignal', p.x, p.y, p.z, 0.9)),
    townEvents.on('hover.spinUp', (p) => cue('hoverUp', p.x, p.y, p.z, 0.9)),
    townEvents.on('hover.land', (p) => {
      cue('hoverTouch', p.x, p.y, p.z, 0.8)
      cue('hoverDown', p.x, p.y, p.z, 0.8)
    }),
  ]
  return () => {
    for (const off of offs) off()
  }
}
