import { STAIR_SIDE, stairRiseAt, stairSideOn, stairSmoothZ, type StairIndex } from './townStairs.ts'

/**
 * 町の石段の下の地形を下げる（地形の格子 town/terrain.ts の terrainHeight と、足元の高さ site/siteModel.ts の地形が使う）。
 * 石段の幅の中は「段の鼻を結ぶ坂の 1 段と 10cm 下」より上に出さず（粗い地形の格子の三角形が段の角から出ないように）、
 * わきは 0.25m の先から勾配 0.8 で元の地面へ戻す（下げるだけで上げない）。
 * 地形が段より低い所は、石段の形（town/townStairsMesh.ts）が段の下を地面まで埋める。
 *
 * 石段の索引は町のデータを読んだときに townWalk が入れる（循環の import を避けるため、ここは入れ物だけ）
 */

const holder: { index: StairIndex | null; extra: ((x: number, y: number, h: number) => number) | null } = { index: null, extra: null }

/**
 * ほかに地形を下げる所（運河バスの川岸の乗り場の石段の下など。交通が入れる）。町の石段のあとに、下げるだけの関数を通す。
 * 地形の格子を作る前に入れる（Landscape の createTown）
 */
export function setExtraGrade(fn: ((x: number, y: number, h: number) => number) | null) {
  holder.extra = fn
}

export function setStairIndex(index: StairIndex | null) {
  holder.index = index
}

export function stairIndex() {
  return holder.index
}

/**
 * 下げたあとの標高（町の平面座標 x, y と元の標高 h）。わきに縁石・擁壁を付ける所（stairSideOn。§7 の 172）は、石段の縁から STAIR_SIDE.band まで
 * 段の高さで下げ、その先は勾配 STAIR_SIDE.ramp で戻す（下げた所と戻す坂は、擁壁と擁壁の裏の植え込み（town/townStairsMesh.ts）が隠す。
 * 地形の格子は 1m ほどの刻みなので、石段の縁のすぐ外から急に上げると、格子の三角形が段の上へ出るため）
 */
export function stairGrade(x: number, y: number, h: number) {
  const g = townStairGrade(x, y, h)
  return holder.extra ? Math.min(g, holder.extra(x, y, g)) : g
}

function townStairGrade(x: number, y: number, h: number) {
  const idx = holder.index
  if (!idx) return h
  const hit = idx.at(x, y, 3.5)
  if (!hit) return h
  const p = hit.profile
  const top = stairSmoothZ(p, hit.s) - stairRiseAt(p, hit.s) - 0.1
  if (stairSideOn(p, hit.s, hit.side)) return Math.min(h, top + Math.max(0, hit.d - p.halfWidth - STAIR_SIDE.band) * STAIR_SIDE.ramp)
  const out = Math.max(0, hit.d - p.halfWidth - 0.25)
  return Math.min(h, top + out * 0.8)
}
