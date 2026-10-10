import { rectOf } from '../../labPlan'
import { localAnchor, WALL_PANEL_DEPTH, type LabAnchorPlan, type LabKitPlan, type Placement, type Vec3 } from '../plan'

/**
 * 試作機ギャラリー（東の壁沿い）のデータの側。寸法・アンカー・障害物（作る側は gallery.ts。4-10）
 *
 * - shelf.1〜shelf.N: 展示棚の段の上（使う側の作品の置き場所。kanon-lab は gallery-1〜N）
 * - case.1〜case.3: ガラスケースの床の中心（西から。既定の展示では case.3 が KB-γ の差し込み口）
 */

export interface GalleryPlanOpts {
  /**
   * 展示棚の段の数（既定 GALLERY_SHELVES）。使う側の作品の置き場所の数に合わせて渡す（kanon-lab は置き場所の表 config/layout.ts の
   * PLACEMENTS で、作品の置き場所の数 WORLD_GALLERY_SLOTS を渡す。4-10 で決めた）
   */
  shelves?: number
}

/** 展示棚の段の数の既定（使う側が opts の shelves で渡さないとき） */
export const GALLERY_SHELVES = 6
/** 展示棚（置き場所のローカルの高さ・奥行き・段の間） */
export const GALLERY_SHELF_Y = 1.72
export const GALLERY_SHELF_Z = WALL_PANEL_DEPTH + 0.14
export const GALLERY_SHELF_SPACING = 0.5
/** 展示棚の i 段目（1 から）のローカル x（段の数 shelves） */
export const galleryShelfXOf = (i: number, shelves: number) => (i - (shelves + 1) / 2) * GALLERY_SHELF_SPACING

/** ガラスケース 3 基の置き場所のローカルの x（西から）と z（作る側もこれを読む。4-1 で 2 か所にあった数を 4-10 で 1 つに） */
export const GALLERY_CASE_XS = [-0.95, 0, 0.95] as const
export const GALLERY_CASE_Z = WALL_PANEL_DEPTH + 0.45

const GALLERY = rectOf('KB-001 試作機ギャラリー')

export function galleryPlan(at: Placement, opts: GalleryPlanOpts = {}): LabKitPlan {
  const shelves = opts.shelves ?? GALLERY_SHELVES
  const anchors: Record<string, LabAnchorPlan> = {}
  for (let i = 1; i <= shelves; i++) anchors[`shelf.${i}`] = localAnchor(at, [galleryShelfXOf(i, shelves), GALLERY_SHELF_Y, GALLERY_SHELF_Z])
  GALLERY_CASE_XS.forEach((x, i) => {
    anchors[`case.${i + 1}`] = localAnchor(at, [x, 0, GALLERY_CASE_Z] as Vec3)
  })
  return {
    anchors,
    obstacles: [{ kind: 'rect', name: 'ギャラリー', min: GALLERY.min, max: GALLERY.max, height: 1.6 }],
  }
}
