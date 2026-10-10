import { createContext, useContext, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { addLabLightDimmer } from '../world/labLight'
import type { Lab } from '../world/lab/createLab'
import { createLabScreen, type ScreenDraw } from '../world/lab/screens'
import { curvedPlaneGeometry } from '../world/lab/parts/geometry'
import { glowMaterial, perforatedMaterial, type LabMaterials } from '../world/materials/labMaterials'
import { addWallWashDimmer, createWallWashMaterial, WASH_COLOR } from '../world/materials/wallWash'

/**
 * ラボの素材・画面・明るさの入力を R3F で使うための hooks（docs/design/map-split.md §6 の「段 4」・4-2。案の §3.2）。
 * 中身は three だけの作り手（world/materials・world/lab/screens・world/lab/parts・world/labLight）で、ここは React の時期（useMemo・useEffect・
 * useFrame）に合わせて呼ぶだけ。R3F の使い手（kanon-lab の KB001.tsx・StageMark など）はここを直接読む（元のパスから再び出すのは 4-13 でやめた）。
 * 地図の側の three の形（world/lab・素材・テクスチャ・明るさの入力）はここを読まない（test/map-boundary.test.ts）
 */

/* -------------------------------------------------------------------------- */
/* 共有の素材                                                                   */
/* -------------------------------------------------------------------------- */

/** TownRoot（TownView.tsx）が作ったラボ（素材・照明・殻・什器のキット・空気。world/lab/createLab.ts） */
export const LabContext = createContext<Lab | null>(null)

/** TownRoot が作ったラボ */
export function useLab(): Lab {
  const v = useContext(LabContext)
  if (!v) throw new Error('useLab は TownRoot の内側で使ってください')
  return v
}

/** 共有の素材（TownView.tsx の TownRoot が入れる） */
export const LabMaterialsContext = createContext<LabMaterials | null>(null)

export function useLabMaterials(): LabMaterials {
  const m = useContext(LabMaterialsContext)
  if (!m) throw new Error('useLabMaterials は TownRoot の内側で使ってください')
  return m
}

/**
 * 穴の大きさを面ごとに合わせたパンチングメタル（perforatedMaterial）。
 * repeatX / repeatY はテクスチャ（穴 約 11 個分）を何回繰り返すか。
 */
export function usePerforated(repeatX: number, repeatY: number): THREE.MeshStandardMaterial {
  const mats = useLabMaterials()
  return useMemo(() => perforatedMaterial(mats, repeatX, repeatY), [mats, repeatX, repeatY])
}

/** コンポーネント内で発光マテリアルを使うためのフック */
export function useGlow(color: THREE.ColorRepresentation, intensity: number, opacity = 1): THREE.MeshBasicMaterial {
  return useMemo(() => glowMaterial(color, intensity, opacity), [color, intensity, opacity])
}

/**
 * 光のにじみの素材（createWallWashMaterial）。部屋の照明と一緒に配信中は落ちる（付けてから外すまで、addWallWashDimmer）
 */
export function useWallWashMaterial(color: THREE.Color = WASH_COLOR): THREE.MeshBasicMaterial {
  const mat = useMemo(() => createWallWashMaterial(color), [color])
  useEffect(() => addWallWashDimmer(mat, color), [mat, color])
  return mat
}

/* -------------------------------------------------------------------------- */
/* 明るさの入力                                                                 */
/* -------------------------------------------------------------------------- */

/** 任意の「明るさ」を部屋の照明に合わせて変える（ライト・シェーダーの uniform など。付いている間だけ addLabLightDimmer） */
export function useRoomDimmer(apply: (k: number) => void, min: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    return addLabLightDimmer(apply, min)
  }, [apply, min, enabled])
}

/* -------------------------------------------------------------------------- */
/* 画面                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 毎フレームではなく fps 指定で描き直す動く Canvas テクスチャ（ラボの中のモニタ画面など。createLabScreen）。カメラがホールの外なら labScreenRate で減らす。
 * draw には経過秒 t が渡る。曲面・斜めから見ても文字がつぶれないよう、異方性フィルタは GPU の最大にする。
 */
export function useCanvasScreen(w: number, h: number, draw: ScreenDraw, fps = 12): THREE.CanvasTexture {
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  // 描く関数と fps は作った時の物で始め、描く関数はそのあと下の effect で差し替える（前の drawRef と同じ）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const screen = useMemo(() => createLabScreen('', w, h, draw, fps, { maxAnisotropy }), [w, h, maxAnisotropy])
  useEffect(() => {
    screen.setContent(draw)
  }, [screen, draw])

  useFrame(({ camera }, delta) => screen.update(delta, camera))

  useEffect(() => () => screen.dispose(), [screen])

  return screen.texture
}

/* -------------------------------------------------------------------------- */
/* 形                                                                           */
/* -------------------------------------------------------------------------- */

/** 横方向に曲げた板（湾曲モニタ用。curvedPlaneGeometry） */
export function useCurvedPlane(width: number, height: number, radius: number, segments = 32) {
  return useMemo(() => curvedPlaneGeometry(width, height, radius, segments), [width, height, radius, segments])
}
