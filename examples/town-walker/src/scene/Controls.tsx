import { useEffect, useRef, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { createKeyInput } from '../input/keys'
import { watchClicks } from '../input/click'
import { jumpByKey, keyHook, subscribeWalk, updateMarker, walkAtScreen, walkByKeys, walkUi } from '../walk'

const _fwd = new THREE.Vector3()

/**
 * WASD・クリックで歩く・スペースキーで跳ぶ（優先度 −59: 歩きを進める −58 の前に、このコマの入力を入れる）。
 * キーはページ全体（window）で受け、向きはカメラの見ている向きを水平にした物（= 追うカメラの向き yaw の逆。カメラは人の向きについて回らない）。
 * クリックは Canvas の上で、ドラッグ（追うカメラを回す）と見分ける（input/click.ts）。行き先には小さな印（仮）
 */
export function Controls() {
  const camera = useThree((s) => s.camera)
  const element = useThree((s) => s.gl.domElement)

  useEffect(() => {
    const keys = createKeyInput(window)
    keyHook.keys = keys
    const off = watchClicks(element, (x, y) => walkAtScreen(camera, element, x, y))
    return () => {
      off()
      keys.dispose()
      if (keyHook.keys === keys) keyHook.keys = null
      walkByKeys(null, false)
    }
  }, [camera, element])

  useFrame(() => {
    const keys = keyHook.keys
    if (keys) {
      camera.getWorldDirection(_fwd)
      walkByKeys(keys.direction(_fwd.x, _fwd.z), keys.run)
      if (keys.takeJump()) jumpByKey()
    }
    updateMarker()
  }, -59)

  return <GoalMarker />
}

/** クリックで歩く行き先の印（地面の上の輪。着いたら消える。仮） */
function GoalMarker() {
  const ui = useSyncExternalStore(subscribeWalk, walkUi)
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const m = ring.current
    if (m) m.scale.setScalar(1 + 0.12 * Math.sin(clock.elapsedTime * 5))
  })
  if (!ui.marker) return null
  return (
    <mesh ref={ring} name="walk-goal" position={[ui.marker[0], ui.marker[1] + 0.03, ui.marker[2]]} rotation-x={-Math.PI / 2} renderOrder={2}>
      <ringGeometry args={[0.22, 0.3, 32]} />
      <meshBasicMaterial color="#6fe6ff" transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}
