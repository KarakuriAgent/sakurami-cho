import { SITE } from '../../../core/town'
import type { TownManifest } from './townData'

/**
 * ラボの前の斜面の植え込み。
 * （段階 2 の目印の建物（ハーバータワーの段・ガーデンドームの基壇）は、段階 4 で名前のある建物の外観（named/）へ移した）
 */

/* -------------------------------------------------------------------------- */
/* ラボの前の斜面の植え込み                                                         */
/* -------------------------------------------------------------------------- */

export interface ShrubItem {
  x: number
  y: number
  z: number
  h: number
  r: number
  seed: number
}

/**
 * ラボの前（窓から見下ろす斜面）の植え込み: 芝の斜面のところどころの低木のかたまり（テラスのまわりの植え込みは site/siteMeshes.ts）。
 * 地面の補助の画像（G = 植生・B = 舗装）で芝の所だけに置き、窓から町を見る線（俯角 7.5°。§7 の 10）より低くする
 */
export function labShrubs(manifest: TownManifest, aux: ImageBitmap | null, heightAt: (x: number, y: number) => number, skip: (x: number, y: number) => boolean): ShrubItem[] {
  const out: ShrubItem[] = []
  const hash = (x: number, y: number) => {
    const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return v - Math.floor(v)
  }
  const eye = SITE.labFloorElevation + 1.6
  const underView = (x: number, y: number, top: number) => top < eye - Math.tan((7.5 * Math.PI) / 180) * Math.hypot(x, y) - 0.3
  if (!aux) return out
  // 補助の画像から、斜面の芝の所を読む
  const e = manifest.ground.center.extent
  const sc = aux.width / (e.width * e.pixel_m)
  const x0 = -110
  const x1 = 110
  const y0 = -150
  const y1 = 20
  const px0 = Math.floor((x0 - e.xmin) * sc)
  const py0 = Math.floor((e.ymax - y1) * sc)
  const pw = Math.ceil((x1 - x0) * sc)
  const ph = Math.ceil((y1 - y0) * sc)
  const canvas = new OffscreenCanvas(pw, ph)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(aux, px0, py0, pw, ph, 0, 0, pw, ph)
  const data = ctx.getImageData(0, 0, pw, ph).data
  const at = (x: number, y: number) => {
    const c = Math.min(pw - 1, Math.max(0, Math.floor((x - e.xmin) * sc - px0)))
    const r = Math.min(ph - 1, Math.max(0, Math.floor((e.ymax - y) * sc - py0)))
    const i = (r * pw + c) * 4
    return { veg: data[i + 1] / 255, paved: data[i + 2] / 255, land: data[i + 3] / 255 }
  }
  for (let gx = x0; gx < x1; gx += 3.5) {
    for (let gy = y0; gy < -18; gy += 3.5) {
      const h0 = hash(gx, gy)
      if (h0 > 0.11) continue
      const g = at(gx, gy)
      if (g.veg < 0.45 || g.paved > 0.15 || g.land < 0.5) continue
      const n = 2 + Math.floor(hash(gy, gx) * 4)
      for (let k = 0; k < n; k++) {
        const x = gx + (hash(gx + k, gy) - 0.5) * 3
        const y = gy + (hash(gx, gy + k) - 0.5) * 3
        const z = heightAt(x, y)
        // 急な所には置かない
        if (Math.abs(heightAt(x + 1, y) - heightAt(x - 1, y)) > 1.4 || Math.abs(heightAt(x, y + 1) - heightAt(x, y - 1)) > 1.4) continue
        const h = 0.7 + 1.1 * hash(x, y)
        if (!underView(x, y, z + h) || skip(x, y)) continue
        out.push({ x, y, z, h, r: 0.6 + 0.6 * hash(y, x), seed: hash(x * 2, y) })
      }
    }
  }
  return out
}
