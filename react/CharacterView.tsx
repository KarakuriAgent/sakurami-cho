import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Character } from '../character/avatar/character'

/**
 * キャラクターの見た目（character.visual。character/avatar/characterVisual.ts）を R3F に置く薄い包み。
 * 置いたときに読み込み（visual.start()）、外すときに取り消す（visual.stop()）。毎コマ character.updateVisual を
 * useFrame（priority 0。置いた所の順）で呼ぶ。見るカメラは R3F の既定のカメラ
 */
export function CharacterView({ character }: { character: Character }) {
  const camera = useThree((s) => s.camera)
  const visual = character.visual

  // 読み込み（StrictMode の 2 回目の mount でも読み込み直す）
  useEffect(() => {
    if (!visual) return
    visual.start()
    return () => {
      visual.stop()
    }
  }, [visual])

  useFrame(({ clock }, delta) => {
    character.updateVisual(clock.elapsedTime, delta, camera)
  })

  return visual ? <primitive object={visual.object} /> : null
}
