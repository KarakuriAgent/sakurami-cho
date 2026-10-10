import type * as THREE from 'three'
import type { Kit } from './kit'

/**
 * 中のある建物（core/interiors.ts のゾーンの建物）の外観のうち、中を作ったら隠す・替える物の登録。
 *
 * - 窓のガラス（部屋の奥を描く不透明なガラス）と、扉の奥の暗い箱などの仮の物: 中を作ったら隠す（中の組み立てが透けるガラスと桟を作る）
 * - 開く扉のガラス: 不透明なガラスと透けるガラスの 2 つを作っておき、中を作ったら透ける方を出す
 *
 * 外観の形は細かさの中心が動くたびに作り直される（createNamed の rebuild）ので、そのたびに登録し直し、今の状態（active）を当て直す。
 * 中を作る・壊すのは interior/interiors.ts（setActive）
 */

export interface InteriorExteriorParts {
  glass: THREE.Object3D | null
  placeholder: THREE.Object3D | null
  doorGlass: { opaque: THREE.Object3D; clear: THREE.Object3D }[]
}

class NamedInteriorParts {
  private parts = new Map<string, InteriorExteriorParts>()
  /** 中を作ってある建物 */
  private active = new Set<string>()
  /** 中のある建物の外観の組み立て（開口とガラスの記録・影を落とす形） */
  readonly kits = new Map<string, Kit>()

  /** 外観を作り直す前に呼ぶ */
  clear() {
    this.parts.clear()
  }

  register(buildingId: string, p: InteriorExteriorParts) {
    this.parts.set(buildingId, p)
    this.apply(buildingId)
  }

  /** 中を作った（true）・壊した（false） */
  setActive(buildingId: string, on: boolean) {
    if (on) this.active.add(buildingId)
    else this.active.delete(buildingId)
    this.apply(buildingId)
  }

  isActive(buildingId: string) {
    return this.active.has(buildingId)
  }

  /** 外観が細かい形か（遠くの安い形のときは中を作っても見えない） */
  isNear(buildingId: string) {
    return this.parts.has(buildingId)
  }

  private apply(buildingId: string) {
    const p = this.parts.get(buildingId)
    if (!p) return
    const on = this.active.has(buildingId)
    if (p.glass) p.glass.visible = !on
    if (p.placeholder) p.placeholder.visible = !on
    for (const d of p.doorGlass) {
      d.opaque.visible = !on
      d.clear.visible = on
    }
  }
}

export const namedInteriorParts = new NamedInteriorParts()
