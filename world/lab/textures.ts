import * as THREE from 'three'
import type { LabTextures } from '../materials/labMaterials'
import { ROOM } from '../../core/lab/plan'

/**
 * ラボのテクスチャ（docs/design/map-split.md §6 の「段 4」・4-2。案の §3.2）。共有の 7 枚（素材の法線・ラフネス・マスク）と床の 3 枚。
 * 読み込みは使う側（今は R3F の useTexture。react の包み）がして、ここは置き場所と、読んだあとの下ごしらえ
 * （繰り返し・異方性・色空間・repeat。前の LabMaterialsProvider と Room.tsx の Floor がしていたことを同じ順で）だけ。出典は assets/textures/CREDITS.md
 */

/** 床（コンクリート）のテクスチャ */
export interface LabFloorTextures {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
}

export interface LabTextureSet {
  shared: LabTextures
  floor: LabFloorTextures
}

export interface LabTextureUrls {
  shared: Record<keyof LabTextures, string>
  floor: Record<keyof LabFloorTextures, string>
}

/** テクスチャの置き場所。base は public の根（地図の引数 assetBase。react/LabView.tsx が渡す） */
export function labTextureUrls(base: string): LabTextureUrls {
  return {
    shared: {
      brushedNormal: `${base}textures/brushed_metal/normal.jpg`,
      brushedRough: `${base}textures/brushed_metal/roughness.jpg`,
      panelNormal: `${base}textures/panel_metal/normal.jpg`,
      panelRough: `${base}textures/panel_metal/roughness.jpg`,
      perfOpacity: `${base}textures/perforated_metal/opacity.jpg`,
      perfNormal: `${base}textures/perforated_metal/normal.jpg`,
      smudge: `${base}textures/smudges/mask.jpg`,
    },
    floor: {
      map: `${base}textures/concrete_floor/color.jpg`,
      normalMap: `${base}textures/concrete_floor/normal.jpg`,
      roughnessMap: `${base}textures/concrete_floor/roughness.jpg`,
    },
  }
}

/** 共有のテクスチャの下ごしらえ（読んだ物をそのまま直して返す） */
export function prepareLabSharedTextures(t: LabTextures): LabTextures {
  for (const tex of Object.values(t)) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 8
    // すべてデータテクスチャ（法線・ラフネス・マスク）なので色空間はリニアのまま
    tex.colorSpace = THREE.NoColorSpace
    tex.needsUpdate = true
  }
  return t
}

/** 床のテクスチャの下ごしらえ（読んだ物をそのまま直して返す）。色だけ sRGB */
export function prepareLabFloorTextures(t: LabFloorTextures): LabFloorTextures {
  for (const [name, tex] of Object.entries(t)) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    // 1 タイル ≒ 3m 四方
    tex.repeat.set(ROOM.width / 3, ROOM.depth / 3)
    tex.anisotropy = 16
    tex.colorSpace = name === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace
    tex.needsUpdate = true
  }
  return t
}

/** 共有 → 床の順に下ごしらえする */
export function prepareLabTextures(t: LabTextureSet): LabTextureSet {
  prepareLabSharedTextures(t.shared)
  prepareLabFloorTextures(t.floor)
  return t
}
