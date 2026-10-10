import { cachedCanvasTexture, FONTS, roundedRectPath } from './canvas'

/**
 * 札・額のテクスチャ（Canvas で一度だけ描く。Sticker と同じ作り方）。
 * - ひらき札: 登録公開ラボの入口に掲げる、若葉色の琺瑯の札（葉と歯車の紋章。第二種）
 * - 防災札: ひらき札の下に掛ける小さな橙色の札（ひらき防災協定）
 * - ひらきボードの額: 幼い花音が父からもらったマイコンボード（中二階の壁に額装）
 */

/** 若葉色（町の色「ひらき緑」。黄みのある明るい緑。通信のグリーン #3dffa0 とは別の色） */
export const WAKABA = '#a8c94c'
/** 防災札の橙色 */
export const BOUSAI_ORANGE = '#e07a2e'

/** 歯車（外周に歯）の輪郭のパス */
function gearPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rOut: number, rIn: number, teeth: number) {
  ctx.beginPath()
  const step = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2
    const pts: [number, number][] = [
      [a - step * 0.5, rIn],
      [a - step * 0.22, rIn],
      [a - step * 0.15, rOut],
      [a + step * 0.15, rOut],
      [a + step * 0.22, rIn],
    ]
    pts.forEach(([ang, r], k) => {
      const x = cx + Math.cos(ang) * r
      const y = cy + Math.sin(ang) * r
      if (i === 0 && k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
  }
  ctx.closePath()
}

/** 葉（先のとがった楕円に葉脈） */
function drawLeaf(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number, angle: number, fill: string, vein: string) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(-len / 2, 0)
  ctx.quadraticCurveTo(-len * 0.05, -len * 0.42, len / 2, 0)
  ctx.quadraticCurveTo(-len * 0.05, len * 0.42, -len / 2, 0)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = vein
  ctx.lineWidth = len * 0.045
  ctx.beginPath()
  ctx.moveTo(-len * 0.46, 0)
  ctx.lineTo(len * 0.4, 0)
  ctx.stroke()
  ctx.lineWidth = len * 0.03
  for (const t of [-0.2, 0.05, 0.25]) {
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(len * t, 0)
      ctx.lineTo(len * (t + 0.13), s * len * 0.13)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** 琺瑯のつや（左上が少し明るく、縁は少し暗い） */
function enamelShade(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, 'rgba(255,255,255,0.14)')
  g.addColorStop(0.5, 'rgba(255,255,255,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.12)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/** ひらき札（縦長。幅:高さ = 3:4） */
export function hirakiFudaTexture() {
  return cachedCanvasTexture('hiraki-fuda', 384, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    roundedRectPath(ctx, 2, 2, w - 4, h - 4, 26)
    ctx.fillStyle = WAKABA
    ctx.fill()
    enamelShade(ctx, w, h)
    // 白い縁取り
    ctx.strokeStyle = '#f7f8f0'
    ctx.lineWidth = 7
    roundedRectPath(ctx, 18, 18, w - 36, h - 36, 16)
    ctx.stroke()
    // 紋章: 歯車の中に葉
    const cx = w / 2
    const cy = 150
    gearPath(ctx, cx, cy, 86, 72, 12)
    ctx.fillStyle = '#f7f8f0'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, 58, 0, Math.PI * 2)
    ctx.fillStyle = WAKABA
    ctx.fill()
    drawLeaf(ctx, cx, cy + 2, 92, -Math.PI / 4, '#f7f8f0', WAKABA)
    // 文字
    ctx.fillStyle = '#f7f8f0'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 74px ${FONTS.jp}`
    ctx.fillText('ひらき', cx, 300)
    ctx.font = `700 32px ${FONTS.jp}`
    ctx.fillText('公開ラボ　第二種', cx, 368)
    ctx.fillRect(70, 400, w - 140, 3)
    ctx.font = `400 24px ${FONTS.jp}`
    ctx.fillText('桜見町登録　第 0235 号', cx, 436)
  })
}

/** 防災札（横長。幅:高さ = 3:1） */
export function bousaiFudaTexture() {
  return cachedCanvasTexture('bousai-fuda', 384, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    roundedRectPath(ctx, 2, 2, w - 4, h - 4, 18)
    ctx.fillStyle = BOUSAI_ORANGE
    ctx.fill()
    enamelShade(ctx, w, h)
    ctx.strokeStyle = '#fbf3ea'
    ctx.lineWidth = 5
    roundedRectPath(ctx, 12, 12, w - 24, h - 24, 12)
    ctx.stroke()
    ctx.fillStyle = '#fbf3ea'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 44px ${FONTS.jp}`
    ctx.fillText('防災　ひらき拠点', w / 2, h / 2 + 2)
  })
}

/**
 * ひらきボードの額の中身（台紙・マイコンボード・手書きのメモ）。幅:高さ = 4:3。
 * 基板は配色のルールに合わせて紺色（グリーンは通信だけ）
 */
export function hirakiBoardFrameTexture() {
  return cachedCanvasTexture('hiraki-board-frame', 512, 384, (ctx, w, h) => {
    // 台紙
    ctx.fillStyle = '#d9dde2'
    ctx.fillRect(0, 0, w, h)
    const bx = 106
    const by = 70
    const bw = 300
    const bh = 190
    // 台紙の窓の影
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(bx - 14, by - 14, bw + 32, bh + 32)
    ctx.fillStyle = '#c3c9d0'
    ctx.fillRect(bx - 18, by - 18, bw + 36, bh + 36)
    // 基板
    roundedRectPath(ctx, bx, by, bw, bh, 10)
    ctx.fillStyle = '#123a63'
    ctx.fill()
    // 配線
    ctx.strokeStyle = '#2a5f92'
    ctx.lineWidth = 3
    for (let i = 0; i < 9; i++) {
      ctx.beginPath()
      ctx.moveTo(bx + 30 + i * 26, by + 40)
      ctx.lineTo(bx + 30 + i * 26, by + 90 + (i % 3) * 12)
      ctx.lineTo(bx + 150, by + 120 + (i % 4) * 8)
      ctx.stroke()
    }
    // ピンヘッダ（上下の列の金色のパッド）
    ctx.fillStyle = '#c9a24a'
    for (let i = 0; i < 14; i++) {
      ctx.fillRect(bx + 22 + i * 19, by + 12, 9, 9)
      ctx.fillRect(bx + 22 + i * 19, by + bh - 21, 9, 9)
    }
    // マイコン（黒い IC）と小さな部品
    ctx.fillStyle = '#121418'
    ctx.fillRect(bx + 120, by + 62, 92, 64)
    ctx.fillStyle = '#d6d9de'
    ctx.beginPath()
    ctx.arc(bx + 130, by + 72, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#9aa3ad'
    for (let i = 0; i < 4; i++) ctx.fillRect(bx + 236, by + 50 + i * 26, 22, 12)
    // LED（最初のプログラムで点滅させた LED）
    ctx.fillStyle = '#e8eef5'
    ctx.beginPath()
    ctx.arc(bx + 262, by + 152, 8, 0, Math.PI * 2)
    ctx.fill()
    // シルク印刷
    ctx.fillStyle = '#e9eef4'
    ctx.font = `700 18px ${FONTS.mono}`
    ctx.textAlign = 'left'
    ctx.fillText('HIRAKI BOARD', bx + 22, by + 160)
    ctx.font = `14px ${FONTS.mono}`
    ctx.fillText('rev.1  2011', bx + 22, by + 178)
    // 台紙の手書きのメモ
    ctx.fillStyle = '#2b3440'
    ctx.textAlign = 'center'
    ctx.font = `400 20px ${FONTS.jp}`
    ctx.fillText('2011.5　父から　はじめての「Hello, 桜見町」', w / 2, h - 46)
  })
}
