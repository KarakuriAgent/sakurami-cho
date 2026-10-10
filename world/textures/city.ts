import { mulberry32 } from '../../core/random'
import { cachedCanvasTexture } from './canvas'

/** 床に吹き付けた、かすれたステンシル文字 */
export function floorStencilTexture(lines: string[], key: string) {
  return cachedCanvasTexture(`stencil:${key}`, 1024, 512, (ctx, w, h) => {
    const rnd = mulberry32(key.length * 97 + 11)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    lines.forEach((line, i) => {
      const size = i === 0 ? 170 : 70
      ctx.font = `900 ${size}px "Orbitron", sans-serif`
      // 1 行だけのときは、横幅（左右に 5% ずつ余白）に収まるまで縮める。複数行のときは今までどおりの大きさで描く
      if (lines.length === 1) {
        const measured = ctx.measureText(line).width
        if (measured > w * 0.9) ctx.font = `900 ${(size * w * 0.9) / measured}px "Orbitron", sans-serif`
      }
      ctx.fillText(line, w / 2, h * (lines.length === 1 ? 0.5 : i === 0 ? 0.4 : 0.78))
    })
    // すり減り（ランダムに削る）
    ctx.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 2600; i++) {
      ctx.globalAlpha = 0.25 + rnd() * 0.6
      const r = 1 + rnd() * 7
      ctx.beginPath()
      ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2)
      ctx.fill()
    }
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.5
      ctx.fillRect(rnd() * w, rnd() * h, 60 + rnd() * 200, 2 + rnd() * 4)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  })
}
