import type * as THREE from 'three'

/**
 * 太陽の影を落とす物のレイヤー。太陽の光（outdoor/outdoorLighting.ts の DirectionalLight）の影は、このレイヤーの物だけで描く
 * （OutdoorLighting が、このレイヤーだけを見るカメラで影の地図を描く。three.js の影のパスは描くときのカメラのレイヤーで物を選ぶため）。
 * 影に入るのは「部屋の殻（天井・壁・ガラス壁の枠・柱・見学エントランスの枠）と花音」だけなので、家具をすべて描き直さずに済む。
 * 普通の描画はレイヤー 0 のままなので、見た目は変わらない。
 */
export const SUN_SHADOW_LAYER = 5

/**
 * 太陽の影のときだけ影を落とす物（もともと castShadow でなかった部屋の殻）。three.js は影を落とす物をライトごとに選べないので、
 * ふだんは castShadow を切っておき（部屋のスポットの影の地図に入れない）、太陽の影を描く間だけ入れる（setSunOnlyCasters）
 */
const sunOnly = new Set<THREE.Mesh>()

/** object とその中のメッシュを、太陽の影を落とす物にする（透明な物（ガラス）と、小さな部品（ボルト・表示板など。半径 minRadius m 未満）は除く） */
export function enableSunShadow(object: THREE.Object3D, minRadius = 0.25) {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (mats.some((m) => m.transparent)) return
    const g = mesh.geometry
    if (!g.boundingSphere) g.computeBoundingSphere()
    const scale = Math.max(Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z))
    if ((g.boundingSphere?.radius ?? 0) * scale < minRadius) return
    if (!mesh.castShadow && !mesh.layers.isEnabled(SUN_SHADOW_LAYER)) sunOnly.add(mesh)
    mesh.layers.enable(SUN_SHADOW_LAYER)
  })
}

/** 太陽の影を描く間だけ、部屋の殻にも影を落とさせる（OutdoorLighting が太陽の影の地図を描く前後に呼ぶ） */
export function setSunOnlyCasters(on: boolean) {
  sunOnly.forEach((m) => {
    m.castShadow = on
  })
}
