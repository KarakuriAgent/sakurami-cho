import * as THREE from 'three'
import { perforatedMaterial, type LabMaterials } from '../../materials/labMaterials'
import { createWallWashMaterial, WASH_COLOR } from '../../materials/wallWash'
import { UNIT_BOX } from '../parts/details'

/**
 * 殻を組み立てる間に持ち回る物（docs/design/map-split.md §6 の「段 4」・4-4）。部品の作り手（room.ts・northDoors.ts・mezzanine.ts・entrance.ts）は
 * 前の R3F の部品と同じ順（部品の hooks の素材 → JSX の子の順。子を作ってから群）で作り、ここに次のことを書き残す:
 *
 * - shared: 使い回しの物（共有の素材・キャッシュの素材・モジュールの形）。dispose で捨てない
 * - textures: 殻だけが使うテクスチャ（パンチングメタルの写し）。dispose で捨てる
 * - washes: 光のにじみの素材（attach で部屋の照明に合わせる。前の useWallWashMaterial の effect）
 * - sunCasters: 太陽の影を落とす物の群（attach で enableSunShadow。前の SunShadowCasters の layout effect と同じ順）
 */
export interface ShellBuild {
  readonly mats: LabMaterials
  readonly shared: Set<object>
  readonly textures: THREE.Texture[]
  readonly washes: { material: THREE.MeshBasicMaterial; color: THREE.Color }[]
  readonly sunCasters: THREE.Object3D[]
}

export function createShellBuild(mats: LabMaterials): ShellBuild {
  const shared = new Set<object>([UNIT_BOX, ...Object.values(mats).filter((m): m is THREE.Material => m instanceof THREE.Material)])
  return { mats, shared, textures: [], washes: [], sunCasters: [] }
}

/** 使い回しの物として印を付けて返す（dispose で捨てない） */
export function keep<T extends object>(b: ShellBuild, x: T): T {
  b.shared.add(x)
  return x
}

/** 穴の大きさを面ごとに合わせたパンチングメタル（前の usePerforated。テクスチャの写しは殻の物） */
export function perforated(b: ShellBuild, repeatX: number, repeatY: number): THREE.MeshStandardMaterial {
  const m = perforatedMaterial(b.mats, repeatX, repeatY)
  for (const t of [m.alphaMap, m.normalMap]) if (t) b.textures.push(t)
  return m
}

/** 光のにじみの素材（前の useWallWashMaterial。部屋の照明に合わせるのは attach から） */
export function wallWash(b: ShellBuild, color: THREE.Color = WASH_COLOR): THREE.MeshBasicMaterial {
  const material = createWallWashMaterial(color)
  b.washes.push({ material, color })
  return material
}

/** 太陽の影を落とす物の群（前の SunShadowCasters の群）。印は attach で付ける */
export function sunCasters(b: ShellBuild, children: readonly THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group()
  for (const c of children) g.add(c)
  b.sunCasters.push(g)
  return g
}
