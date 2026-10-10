import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { createFollowCamera, type FollowCamera } from 'sakurami-cho/world'
import { walker } from '../town'
import { sceneHook } from '../debug'
import { walkerEye } from '../vrm'
import { onWarp } from '../teleport'

/** 初めの向き: 立つ所の向きの少し右前から（顔と、その後ろのラボの入口が見えるように。仮） */
const START_YAW_FROM_HEADING = 0.55
/**
 * ワープしたときの向き（人の向きから。仮）: 初めは人の後ろから少し右（人が向く方の建物の入口・ホーム・乗り場が見える）。建物・壁にさえぎられて
 * 欲しい離れの WARP_CLEAR より手前へ寄った・上へ逃がしたときは、次の向き（後ろの左・右横・左横・前）を 1 コマずつ試し、いちばん離れられた向きにする
 */
const WARP_YAWS = [Math.PI + 0.3, Math.PI - 0.5, Math.PI / 2, -Math.PI / 2, 0.55]
const WARP_CLEAR = 0.8
const WARP_PITCH = 0.22

/**
 * 歩く人を追うカメラ（地図の world の createFollowCamera。R3F の既定のカメラを動かす）。優先度 −1: 乗る仕組み・歩き・町の更新（−50）で
 * 人の位置が決まったあと、町の view（0。カメラの位置を細かさの中心にする）の前。
 * ドラッグで回す・ホイールで寄る（Canvas の要素で）。歩く人が置き直されたら（'place'。旅程のカット・ワープ（teleport.ts））一度に置く。
 * ワープしたときは、人の後ろから人が向く方を見る向きにする（さえぎられたら向きを変えて試す。離れはそのまま。暗転の間に済む）。
 * 乗り物の車室の中にいる間は、カメラを車室の中に収める（歩く人の ride を地図の追うカメラが見る。6-4）
 */
export function FollowCam() {
  const camera = useThree((s) => s.camera)
  const element = useThree((s) => s.gl.domElement)
  const follow = useRef<FollowCamera | null>(null)
  /** ワープしたあとの向きの試し（人の向き・試している番号・いちばんよかった向き） */
  const trial = useRef<{ heading: number; i: number; best: { yaw: number; score: number } | null } | null>(null)

  useEffect(() => {
    const cam = createFollowCamera(camera, { yaw: walker.motion.heading + START_YAW_FROM_HEADING, pitch: 0.22, distance: 4.2 })
    follow.current = cam
    const disconnect = cam.connect(element)
    const offPlace = walker.on('place', () => cam.snap())
    const offWarp = onWarp((spot) => {
      trial.current = { heading: spot.heading, i: 0, best: null }
      cam.yaw = spot.heading + WARP_YAWS[0]!
      cam.pitch = WARP_PITCH
      cam.snap()
    })
    sceneHook.follow = cam
    return () => {
      disconnect()
      offPlace()
      offWarp()
      if (sceneHook.follow === cam) sceneHook.follow = null
      follow.current = null
    }
  }, [camera, element])

  useFrame((_, delta) => {
    const cam = follow.current
    if (!cam) return
    cam.update(walker, walkerEye(), delta)
    const t = trial.current
    if (!t) return
    // ワープしたあと: この向きでどこまで離れられたか（上へ逃がした分は引く）
    const score = cam.current / cam.distance - cam.lift
    if (!t.best || score > t.best.score) t.best = { yaw: cam.yaw, score }
    const next = WARP_YAWS[t.i + 1]
    if (score >= WARP_CLEAR || next === undefined) {
      if (cam.yaw !== t.best.yaw) {
        cam.yaw = t.best.yaw
        cam.snap()
      }
      trial.current = null
      return
    }
    t.i++
    cam.yaw = t.heading + next
    cam.snap()
  }, -1)
  return null
}
