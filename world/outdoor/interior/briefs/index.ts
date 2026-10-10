import type { InteriorZoneId } from '../../../../core/interiors'
import type { InteriorBrief } from '../types'
import { CABLE_FUMOTO_BRIEF, CABLE_KAEDEZAKA_BRIEF, CABLE_SUMMIT_BRIEF } from './cable'
import { CAFE_BRIEF } from './cafe'
import { DOME_BRIEF } from './dome'
import { SEIZU_BRIEF } from './seizu'
import { SORANOWA_BRIEF } from './soranowa'
import { THOMPSON_BRIEF } from './thompson'

/**
 * 建物ごとの中の決まり（ゾーンの id → brief）。新しく中を作る建物は、core/interiors.ts にゾーンを足し、ここに brief を足す
 * （docs/design/town.md の §13「中を作る仕組みの使い方」）
 */
export const INTERIOR_BRIEFS: Partial<Record<InteriorZoneId, InteriorBrief>> = {
  thompson: THOMPSON_BRIEF,
  seizu: SEIZU_BRIEF,
  cafe: CAFE_BRIEF,
  dome: DOME_BRIEF,
  soranowa: SORANOWA_BRIEF,
  'cable-summit': CABLE_SUMMIT_BRIEF,
  'cable-kaedezaka': CABLE_KAEDEZAKA_BRIEF,
  'cable-fumoto': CABLE_FUMOTO_BRIEF,
}
