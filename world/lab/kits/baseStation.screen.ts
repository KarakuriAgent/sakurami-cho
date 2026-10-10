import { FONTS } from '../../textures/canvas'

/**
 * 基地局のサーバータワー（カストル・ポルックス）のステータス画面（通信なのでグリーン）。地図の側の既定の中身
 * （docs/design/map-split.md §6 の「段 4」・4-6。前の textures/screens.ts の drawLinkStatus から、配信の ON AIR を除いた物）。
 * 通信が確立している間は「LINK ESTABLISHED」、ふだんは待機表示。入力の値は基地局のキットの channels（link・flash）。
 * 使う側は見出しだけを差し替えられる（kanon-lab は scene/stream/linkStatusScreen.ts で、配信中の ON AIR・経過時間・接続数）
 */

/** 画面が読む入力の値（基地局の channels の link・flash） */
export interface LinkScreenInput {
  /** 通信のグリーン（0〜1。0.5 を超えると確立） */
  readonly link: number
  /** 接続が確立した瞬間のフラッシュ（0〜1。地の色が明るくなる） */
  readonly flash: number
}

/**
 * 見出しの差し替え（通信が確立している間だけ呼ぶ。描いたら true、false なら既定の「LINK ESTABLISHED」）。
 * 呼ぶ時は地・走査線を描いたあとで、textBaseline は top、塗りの色は通信のグリーン
 */
export type LinkScreenHeadline = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => boolean

/** 通信のグリーン */
const COMM = '#3dffa0'

/** 画面全体を描き直す（t は画面を作ってからの経過秒） */
export function drawLinkScreen(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, input: LinkScreenInput, headline?: LinkScreenHeadline) {
  // 起動演出中は「LINK ESTABLISHED」、ふだんは待機表示（使う側の見出しは確立している間だけ）
  const link = input.link
  const established = link > 0.5
  ctx.fillStyle = established ? `rgba(4,${24 + Math.round(input.flash * 80)},14,1)` : '#010805'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(61,255,160,0.12)'
  for (let y = 0; y < h; y += 16) {
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(w, y + 0.5)
    ctx.stroke()
  }
  ctx.textBaseline = 'top'
  ctx.fillStyle = established ? COMM : 'rgba(61,255,160,0.75)'
  // 使う側の見出しを描いたら、既定の見出しは描かない
  const replaced = established && headline !== undefined && headline(ctx, t, w, h)
  if (!replaced && established) {
    ctx.font = `bold ${Math.round(w / 12)}px ${FONTS.display}`
    ctx.fillText('LINK', 14, 10)
    ctx.fillText('ESTABLISHED', 14, 10 + w / 10)
    ctx.font = `${Math.round(w / 17)}px ${FONTS.mono}`
    ctx.fillText(`SYNC ${(99.2 + Math.sin(t * 0.7) * 0.5).toFixed(1)}%  PENDANT OK`, 14, 14 + w / 4.8)
  } else if (!established) {
    ctx.font = `bold ${Math.round(w / 11)}px ${FONTS.display}`
    ctx.fillText('LINK', 14, 12)
    ctx.font = `${Math.round(w / 16)}px ${FONTS.mono}`
    ctx.fillText(Math.floor(t * 1.5) % 2 === 0 ? 'STANDBY _' : 'STANDBY', 14, 12 + w / 9)
  }
  // 波形（通信が強いほど大きく速く）
  ctx.strokeStyle = COMM
  ctx.lineWidth = 2
  ctx.beginPath()
  const baseY = h * 0.7
  const amp = 0.25 + link * 0.75
  for (let i = 0; i <= 120; i++) {
    const x = (w * i) / 120
    const burst = Math.exp(-Math.pow((i / 120 - ((t * (0.35 + link * 0.4)) % 1)) * 6, 2))
    const v = Math.sin(i * 0.5 + t * (6 + link * 6)) * (0.06 + burst * 0.8) * amp
    const y = baseY - v * h * 0.22
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.font = `${Math.round(w / 20)}px ${FONTS.mono}`
  ctx.fillStyle = 'rgba(61,255,160,0.7)'
  ctx.fillText('CROSS-WORLD RELAY', 14, h - w / 12)
}
