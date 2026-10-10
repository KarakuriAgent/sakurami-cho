import type * as THREE from 'three'

/**
 * 外に面したガラス（南のガラス壁・西と東のハイサイドの窓）のマテリアル。
 * 部屋の共有のガラス（labMaterials の glass）から 1 つだけ作り、不透明度を時刻で変える（昼は少し暗くして、外が明るすぎないように）。
 * 展示ケースなど部屋の中のガラスは今までどおり
 */
let exteriorGlass: THREE.MeshPhysicalMaterial | null = null

export function getExteriorGlass(base: THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial {
  if (!exteriorGlass) {
    exteriorGlass = base.clone()
    exteriorGlass.name = 'exteriorGlass'
  }
  return exteriorGlass
}

/** 外に面したガラスの不透明度（OutdoorLighting が毎コマ呼ぶ） */
export function setExteriorGlassOpacity(opacity: number) {
  if (exteriorGlass) exteriorGlass.opacity = opacity
}
