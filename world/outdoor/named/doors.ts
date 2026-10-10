import * as THREE from 'three'
import type { DoorSpec } from './kit'

/**
 * 開く扉の登録（段階 4 の後半で中を作る 4 棟: トンプソン家・Café Platform 1872・星図珈琲・ガーデンドーム）。
 *
 * 扉は近くの形（細かさの中心から nearRadius m 以内）のときだけ作られ、createNamed の rebuild のたびに登録し直す。
 * 扉の Object3D は蝶番の軸の下端が原点で、局所の x = 蝶番から戸先へ・y = 上・z = x × y。setOpen(t) で 0（閉）〜 1（開）。
 * 壁の開口は扉の大きさで穴があいていて、奥は暗い（中はまだ無い）。中を作るときは、扉の外の面（DoorSpec の hinge の奥行き）を
 * 中の壁の外の面に合わせる（docs/design/town.md の §12「段階 4 の後半への引き継ぎ」）
 */

export interface NamedDoor {
  spec: DoorSpec
  pivot: THREE.Object3D
  /** 閉じたときの向き */
  q0: THREE.Quaternion
  open: number
}

const _q = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)

class NamedDoors {
  private byBuilding = new Map<string, NamedDoor[]>()

  clear() {
    this.byBuilding.clear()
  }

  add(spec: DoorSpec, pivot: THREE.Object3D) {
    const list = this.byBuilding.get(spec.buildingId) ?? []
    list.push({ spec, pivot, q0: pivot.quaternion.clone(), open: 0 })
    this.byBuilding.set(spec.buildingId, list)
  }

  /** 建物の扉（無ければ空。建物が遠くの形のときも空） */
  get(buildingId: string) {
    return this.byBuilding.get(buildingId) ?? []
  }

  /** すべての扉 */
  all() {
    return [...this.byBuilding.values()].flat()
  }

  /** 扉を開ける（t = 0 閉 〜 1 開。外開き。entrance を省くとその建物の全部） */
  setOpen(buildingId: string, t: number, entrance?: number) {
    for (const d of this.get(buildingId)) {
      if (entrance !== undefined && d.spec.entrance !== entrance) continue
      d.open = THREE.MathUtils.clamp(t, 0, 1)
      // 局所の y（上）のまわりに回す
      _q.setFromAxisAngle(_up, d.spec.openSign * d.spec.swing * d.open * Math.PI * 0.47)
      d.pivot.quaternion.copy(d.q0).multiply(_q)
    }
  }
}

export const namedDoors = new NamedDoors()
