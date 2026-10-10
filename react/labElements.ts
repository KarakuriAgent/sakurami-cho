import { extend, type ThreeElement } from '@react-three/fiber'
import { HologramMaterial } from '../world/materials/hologram'

/**
 * ラボのシェーダーの素材を R3F の JSX（<hologramMaterial>）で使えるようにする登録
 * （docs/design/map-split.md §6 の「段 4」・4-2。前は world/materials/effects.ts・hologram.ts が読み込みの時にしていた）。
 * JSX でこれを使うファイル（kanon-lab の ShowStage・StageMark）は、入口の index を読む（`import 'sakurami-cho/react'`。index がこのファイルを読む）。素材そのものは three だけの物。
 * 流れ・光の筋・ほこりの素材（world/materials/effects.ts）は、JSX で使う所が無くなったので登録しない（4-13。three の形の部品が直接作る）
 */

extend({ HologramMaterial })

declare module '@react-three/fiber' {
  interface ThreeElements {
    hologramMaterial: ThreeElement<typeof HologramMaterial>
  }
}
