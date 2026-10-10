import { LAMP, type Lamp } from './lamps'
import { LIGHT_KIND, type LightItem } from './lights'
import { terrainHeight } from './terrain'
import type { TownTile } from './townData'

/**
 * 灯りの表（lamps.ts）に入れる灯りを集める: タイルの灯り（街灯・提灯・足元灯・港の作業灯）と、名前のある建物の灯具。
 * 形のある街灯に置き換えたラボのまわりの灯り（skip）は、ラボのセットのシェーダーが照らすので入れない
 */
export function lampsFromTiles(tiles: TownTile[], skip: (x: number, y: number, kind: number) => boolean): Lamp[] {
  const out: Lamp[] = []
  for (const t of tiles) {
    const lp = t.sections.l_pos.array as Float32Array
    const lc = t.sections.l_col.array as Uint8Array
    const lk = t.sections.l_kind.array as Uint8Array
    for (let k = 0; k < lp.length / 4; k++) {
      const kind = lk[k * 2]
      if (kind !== LIGHT_KIND.street && kind !== LIGHT_KIND.path && kind !== LIGHT_KIND.port) continue
      const x = lp[k * 4]
      const y = lp[k * 4 + 1]
      const z = lp[k * 4 + 2]
      if (skip(x, y, kind)) continue
      const power = lc[k * 4 + 3] / 50
      if (kind === LIGHT_KIND.port) out.push({ x, y, z, kind: LAMP.port, power: power * 1.4 })
      else if (kind === LIGHT_KIND.street) out.push({ x, y, z, kind: LAMP.street, power })
      else {
        // 提灯（橙）・足元灯（低い）・小径の灯り（高い）
        const lantern = lc[k * 4] > 250 && lc[k * 4 + 1] < 170
        const h = z - terrainHeight(x, y)
        out.push({ x, y, z, kind: lantern ? LAMP.lantern : h < 1.5 ? LAMP.foot : LAMP.street, power: lantern ? 1.5 : h < 1.5 ? 1.1 : power * 0.7 })
      }
    }
  }
  return out
}

/** 名前のある建物の灯具（入口の灯り・提灯・行灯・投光器）。名前のある建物の細かい形は自分で照らすので、種類 named（ほかの物だけ照らす） */
export function lampsFromNamed(lights: readonly LightItem[]): Lamp[] {
  return lights.filter((l) => l.kind === LIGHT_KIND.street || l.kind === LIGHT_KIND.path).map((l) => ({ x: l.x, y: l.y, z: l.z, kind: LAMP.named, power: Math.min(8, l.power * 1.2) }))
}
