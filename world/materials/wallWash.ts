import * as THREE from 'three'
import { PALETTE } from '../palette'
import { addLabLightDimmer } from '../labLight'
import { cachedCanvasTexture } from '../textures/canvas'

/**
 * 光のにじみの素材。three だけで作る（docs/design/map-split.md §6 の「段 4」・4-2）。
 * React の hook（useWallWashMaterial）は react/labHooks.ts
 */

/** 下から上へ消えていくグラデーション（壁を照らす光のにじみ用） */
function washTexture() {
  return cachedCanvasTexture('wall-wash', 8, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.12, 'rgba(255,255,255,0.45)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}

/** 床際の LED ラインのにじみの色 */
export const WASH_COLOR = new THREE.Color(PALETTE.cyan).multiplyScalar(0.22)

/** 配信中に部屋の照明と一緒に落とすときの、いちばん暗い割合 */
const WASH_DIM_MIN = 0.3

/**
 * 光のにじみ（下から上へ消える加算合成の板）のマテリアル。部屋の照明と一緒に配信中は落ちる（addWallWashDimmer で付ける）。
 * 壁（殻の shell/room.ts の wallWashes）のほか、壁の前に出っ張った物（北の壁の扉など）・中二階の壁にも貼る。
 * 板を上下さかさまにすれば、天井際の照明が壁を上から照らす光になる。呼ぶたびに素材を 1 つ作る（テクスチャは共有）
 */
export function createWallWashMaterial(color: THREE.Color = WASH_COLOR): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: washTexture(),
    color: color.clone(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
}

/** にじみを部屋の照明の明るさに合わせて暗くする（color × 割合）。外す関数を返す */
export function addWallWashDimmer(material: THREE.MeshBasicMaterial, color: THREE.Color = WASH_COLOR): () => void {
  return addLabLightDimmer((k) => material.color.copy(color).multiplyScalar(k), WASH_DIM_MIN)
}
