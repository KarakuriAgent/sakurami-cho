import type * as THREE from 'three'

/**
 * 太陽の影を落とす物のレイヤー。太陽の光（outdoor/outdoorLighting.ts の DirectionalLight）の影は、このレイヤーの物だけで描く
 * （WebGPU の影は影のカメラのレイヤーで物を選ぶので、outdoorLighting.ts が sun.shadow.camera.layers をこのレイヤーだけにする）。
 * 影に入るのは「部屋の殻（天井・壁・ガラス壁の枠・柱・見学エントランスの枠）と花音」だけなので、家具をすべて描き直さずに済む。
 * 普通の描画はレイヤー 0 のままなので、見た目は変わらない。
 */
export const SUN_SHADOW_LAYER = 5

/**
 * object とその中のメッシュを、太陽の影を落とす物にする（透明な物（ガラス）と、小さな部品（ボルト・表示板など。半径 minRadius m 未満）は除く）。
 *
 * WebGPU への移行（第 1 段）: 前は「太陽の影のときだけ影を落とす物」として castShadow を切っておき、太陽の影を描く間だけ入れていた（setSunOnlyCasters。
 * WebGL の three は影を落とす物をライトごとに選べなかったため）。WebGPU では影のカメラのレイヤーで選べるので、castShadow を入れたままにする。
 * そのぶん、影を落とす部屋のスポット（作業台の 1 つ。高画質だけ）の影の地図にも殻が入る（スポットは天井の下から下を向くので、見た目はほぼ変わらない）
 */
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
    mesh.castShadow = true
    mesh.layers.enable(SUN_SHADOW_LAYER)
  })
}
