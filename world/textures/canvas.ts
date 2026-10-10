import * as THREE from 'three'

/**
 * Canvas 2D で描くテクスチャ（ラベル・ステッカー・モニタ画面など）のユーティリティ。
 * フォントは index.html で読み込み、main.tsx で読み込み完了を待ってから描いている。
 * three だけで作る（docs/design/map-split.md §6 の「段 4」・4-2）。fps で描き直す画面（labScreenRate・createLabScreen）は world/lab/screens.ts、
 * React の hook（useCanvasScreen）は react/labHooks.ts
 */
export const FONTS = {
  display: '"Orbitron", "Noto Sans JP", sans-serif',
  mono: '"Share Tech Mono", "Noto Sans JP", monospace',
  jp: '"Noto Sans JP", sans-serif',
} as const

export type Draw2D = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

/** Canvas と 2D の描き手を作る */
export function createCanvas2D(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D コンテキストを取得できませんでした')
  return { canvas, ctx }
}

/** 一度だけ描く静的な Canvas テクスチャ（色テクスチャとして sRGB 扱い） */
export function createCanvasTexture(w: number, h: number, draw: Draw2D, colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace) {
  const { canvas, ctx } = createCanvas2D(w, h)
  draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = colorSpace
  tex.anisotropy = 8
  return tex
}

const staticCache = new Map<string, THREE.CanvasTexture>()

/** キー付きでキャッシュする静的テクスチャ（同じラベルを何度も作らない） */
export function cachedCanvasTexture(
  key: string,
  w: number,
  h: number,
  draw: Draw2D,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
) {
  let tex = staticCache.get(key)
  if (!tex) {
    tex = createCanvasTexture(w, h, draw, colorSpace)
    staticCache.set(key, tex)
  }
  return tex
}

export function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * 角丸四角のアルファマスク（白 = 不透明）。alphaMap + alphaTest で形を切り抜くのに使う。
 * inset は外周の余白（0〜0.5、テクスチャ幅に対する割合）。
 */
export function roundedRectMask(key: string, aspect: number, radius: number, inset = 0.02) {
  const w = 256
  const h = Math.max(16, Math.round(256 / aspect))
  return cachedCanvasTexture(
    `mask:${key}`,
    w,
    h,
    (ctx) => {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      const ix = w * inset
      const iy = h * inset * aspect
      roundedRectPath(ctx, ix, iy, w - ix * 2, h - iy * 2, radius * w)
      ctx.fill()
    },
    THREE.NoColorSpace,
  )
}

/** 放射状グラデーション（光のにじみ用スプライト） */
export function radialGlowTexture() {
  return cachedCanvasTexture('radial-glow', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.08)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}
