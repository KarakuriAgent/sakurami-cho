import { townData } from './townData'

/**
 * 町の高さ画像の標高（m。均す前）。全体の範囲の外は端の値から、離れるほど下げる（陸は 8km で半分ほどに、海底はそのまま）。
 * 地形の格子（terrain.ts）は、これをラボのまわりで均した値（site/siteModel.ts）を使う
 */
export function naturalHeight(x: number, y: number) {
  const o = townData.overview
  if (!o) return 0
  const h = townData.heightAt(x, y)
  const e = o.extent
  const dx = Math.max(e.xmin - x, 0, x - e.xmax)
  const dy = Math.max(e.ymin - y, 0, y - e.ymax)
  const out = Math.hypot(dx, dy)
  if (out <= 0 || h <= 0) return h
  const fade = Math.exp(-out / 9000)
  // 遠くの丘のゆるい起伏（端の値をそのまま伸ばした筋を目立たなくする）
  const wobble = 1 + 0.25 * Math.sin(x * 0.0007 + 1.7) * Math.cos(y * 0.0009 - 0.6)
  return h * fade * wobble
}
