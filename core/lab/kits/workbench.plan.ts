import { localAnchor, ROOM, WALL_PANEL_DEPTH, type LabKitPlan, type Placement, type Vec3 } from '../plan'

/**
 * 作業台（西の壁沿いの置き場所 workshop: 作業台・有孔ボード・3D プリンタ）のデータの側。寸法・アンカー・障害物
 * （作る側は workbench.ts。world/places.ts の作品の置き場所はここのアンカーを読む）
 *
 * - bench.assembly: 組み立ての場所（world.spawn how=assemble。作品の置き場所 'bench' の 1 つ目）
 * - bench.b・bench.c: 作品の置き場所 'bench' の 2・3 つ目
 * - bench.tray: 部品のトレイ（KB-001 がパーツケースから運んでくる）を置く所
 * - printer.bed: 3D プリンタのベッドの天面の中心
 */

/** 作業台（workbench.ts の作業台。置き場所のローカル BENCH_ORIGIN に置かれる）の天面 */
export const BENCH_TOP = 0.92
export const BENCH_ORIGIN: Vec3 = [0.4, 0, WALL_PANEL_DEPTH]
/** 作業台の上の、作業台のローカル座標（x, z）→ 置き場所のローカル座標 */
export const benchLocal = (x: number, z: number, y = BENCH_TOP + 0.003): Vec3 => [BENCH_ORIGIN[0] + x, y, BENCH_ORIGIN[2] + z]

/** 組み立ての場所（作業台のローカル。workbench.ts の組み立てのマットの位置） */
export const ASSEMBLY_SPOT_LOCAL: [number, number] = [-0.36, 0.55]
/** 部品のトレイを置く場所（作業台のローカル） */
export const TRAY_SPOT_LOCAL: [number, number] = [-0.64, 0.66]
/** 作品の置き場所 'bench' の 2・3 つ目（作業台のローカル） */
export const BENCH_SPOT_B_LOCAL: [number, number] = [-0.02, 0.64]
export const BENCH_SPOT_C_LOCAL: [number, number] = [0.76, 0.42]

/** 3D プリンタ（workbench.ts の 3D プリンタ。置き場所のローカル PRINTER_ORIGIN）のベッドの天面 */
export const PRINTER_ORIGIN: Vec3 = [-1.2, 0, WALL_PANEL_DEPTH + 0.34]
export const PRINTER_CABINET = 0.72
export const PRINTER_BED_TOP = PRINTER_CABINET + 0.126

export function workbenchPlan(at: Placement): LabKitPlan {
  return {
    anchors: {
      'bench.assembly': localAnchor(at, benchLocal(...ASSEMBLY_SPOT_LOCAL)),
      'bench.b': localAnchor(at, benchLocal(...BENCH_SPOT_B_LOCAL)),
      'bench.c': localAnchor(at, benchLocal(...BENCH_SPOT_C_LOCAL)),
      'bench.tray': localAnchor(at, benchLocal(...TRAY_SPOT_LOCAL)),
      'printer.bed': localAnchor(at, [PRINTER_ORIGIN[0], PRINTER_BED_TOP, PRINTER_ORIGIN[2]]),
    },
    obstacles: [
      { kind: 'rect', name: '作業台', min: [-ROOM.halfWidth, 0.5], max: [-7.5, 2.5], height: 1.35 },
      { kind: 'rect', name: '3D プリンタ', min: [-ROOM.halfWidth, 2.75], max: [-7.6, 3.45], height: 1.45 },
    ],
  }
}
