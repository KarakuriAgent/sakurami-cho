import { useRef, useSyncExternalStore } from 'react'
import type * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { updateLocomotion } from 'sakurami-cho/character'
import { CharacterView } from 'sakurami-cho/react'
import { walker } from '../town'
import { walkerState } from '../debug'
import { updateTravel } from '../travel'
import { updateClock } from '../clock'
import { BODY_EYE, subscribeVrm, vrmState } from '../vrm'

/** 仮の体の高さ（m）と半径 */
const BODY_HEIGHT = 1.6
const BODY_RADIUS = 0.22

/**
 * 歩きを進める（優先度 −58。乗る仕組み −79 のあと、町の更新 −50 の前。dt は 0.1 秒まで。kanon-lab の KanonNavigator と同じ）。
 * 進めたあと、旅程の様子（着いた・だめだった・今の区間・乗り物）と、時刻のつまみの様子（町の時刻・旅程の途中で変えられないか。clock.ts）を直す
 */
export function WalkerDriver() {
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1)
    updateLocomotion(walker, clock.elapsedTime, dt)
    walkerState.walkTime += dt
    updateTravel()
    updateClock()
  }, -58)
  return null
}

/**
 * 歩く人の見た目（優先度 0）。VRM を読んでいれば地図の見た目（CharacterView。置いたら読み込み・外したら止める）、読んでいない・読めない間は仮の体。
 * VRM を付け替えたら（vrm.ts）描き直して、CharacterView が前の見た目を止めて新しい見た目を読む
 */
export function WalkerView() {
  const vrm = useSyncExternalStore(subscribeVrm, vrmState)
  return (
    <>
      <CharacterView character={walker} />
      {vrm.status !== 'ready' && <PlaceholderBody />}
    </>
  )
}

/** 仮の体（VRM が無いとき。足元に立つ円柱と、向きの印の鼻） */
function PlaceholderBody() {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = group.current
    if (!g) return
    g.position.copy(walker.motion.position)
    g.rotation.y = walker.motion.heading
  })
  return (
    <group ref={group} name="walker-placeholder">
      <mesh position={[0, BODY_HEIGHT / 2, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[BODY_RADIUS, BODY_HEIGHT - BODY_RADIUS * 2, 6, 16]} />
        <meshStandardMaterial color="#8fb8c8" roughness={0.6} />
      </mesh>
      <mesh position={[0, BODY_EYE, BODY_RADIUS]} castShadow>
        <boxGeometry args={[0.1, 0.06, 0.12]} />
        <meshStandardMaterial color="#e8f4f8" roughness={0.5} />
      </mesh>
    </group>
  )
}
