import { FONTS, roundedRectPath } from './canvas'

/**
 * モニタ・ホロパネルに流す画面の描画関数。
 * すべて (ctx, t, w, h) を受け取り、Canvas 全体を描き直す。
 * 「通信」に関係する表示だけグリーン、それ以外はシアン / ブルー系でまとめている。
 */

const C = {
  bg: '#040a13',
  panel: '#07111e',
  grid: 'rgba(61,224,255,0.08)',
  cyan: '#3de0ff',
  blue: '#1e6fff',
  sky: '#8fd8ff',
  comm: '#3dffa0',
  text: '#d6e2ee',
  dim: '#5b6b7d',
  kw: '#4d9dff',
  type: '#3de0ff',
  str: '#ffcf8a',
  num: '#ff9e7a',
}

/* -------------------------------------------------------------------------- */
/* コードエディタ                                                               */
/* -------------------------------------------------------------------------- */

const CODE = `import { Link, Pendant } from '@0235/crossworld'
import { Servo, Thruster } from './hardware'

// ペンダントとのリンクを維持する
export async function keepAlive(link: Link) {
  const pendant = await Pendant.find({ owner: 'kanon' })
  if (!pendant) return link.retry(3)
  for await (const packet of link.stream()) {
    pendant.relay(packet, { gain: 1.8 })
    metrics.push('rssi', packet.rssi)
  }
}

export class KB001 {
  private hover = new Thruster({ rings: 3 })
  private ears = [new Servo(0x21), new Servo(0x22)]

  constructor(readonly id = 'KB-001') {}

  // ふわふわ浮く高さを PID で安定させる
  update(dt: number, target = 0.34) {
    const err = target - this.sensor.altitude
    this.integral += err * dt
    const out = 2.4 * err + 0.6 * this.integral
    this.hover.thrust = clamp(out, 0, 1)
  }

  blink(eyes = 2) {
    return this.face.animate('blink', { eyes, ms: 120 })
  }
}

const station = new BaseStation({ rings: 3, core: 'comm' })
station.on('sync', (s) => log.info('sync', s.ratio.toFixed(3)))
await station.spinUp({ rpm: 4.5, direction: 'alternate' })

// TODO: ホロテーブルの分解図を最新版に更新
export const VERSION = '0.23.5'`.split('\n')

const KEYWORDS = new Set(
  'import from export async function const let if return for await of new class private readonly constructor'.split(' '),
)

function drawCodeLine(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, charW: number) {
  const comment = line.indexOf('//')
  const codePart = comment >= 0 ? line.slice(0, comment) : line
  // トークン単位で色分け（簡易）
  const tokens: { text: string; color: string }[] = []
  const re = /('[^']*'|\b\d+(\.\d+)?\b|0x[0-9a-f]+|\b[A-Z][A-Za-z0-9]*\b|\b[a-z_][A-Za-z0-9_]*\b|\s+|.)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(codePart))) {
    const t = m[0]
    let color = C.text
    if (t.startsWith("'")) color = C.str
    else if (/^(\d|0x)/.test(t)) color = C.num
    else if (KEYWORDS.has(t)) color = C.kw
    else if (/^[A-Z]/.test(t)) color = C.type
    tokens.push({ text: t, color })
  }
  let cx = x
  for (const tk of tokens) {
    ctx.fillStyle = tk.color
    ctx.fillText(tk.text, cx, y)
    cx += tk.text.length * charW
  }
  if (comment >= 0) {
    ctx.fillStyle = C.dim
    ctx.font = `${Math.round(charW * 1.55)}px ${FONTS.jp}`
    ctx.fillText(line.slice(comment), cx, y)
    ctx.font = `${Math.round(charW * 1.8)}px ${FONTS.mono}`
  }
}

export function drawCodeScreen(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)

  const fontSize = Math.round(h / 24)
  const lineH = fontSize * 1.3
  const charW = fontSize * 0.55
  ctx.font = `${fontSize}px ${FONTS.mono}`
  ctx.textBaseline = 'top'

  // タブバー
  ctx.fillStyle = '#081627'
  ctx.fillRect(0, 0, w, lineH * 1.4)
  const tabs = ['kb001/firmware.ts', 'station/link.ts', 'README.md']
  let tx = 10
  tabs.forEach((name, i) => {
    const tw = name.length * charW + 30
    ctx.fillStyle = i === 0 ? C.bg : '#0a1a2c'
    ctx.fillRect(tx, 4, tw, lineH * 1.4 - 4)
    ctx.fillStyle = i === 0 ? C.text : C.dim
    ctx.fillText(name, tx + 14, 10)
    if (i === 0) {
      ctx.fillStyle = C.cyan
      ctx.fillRect(tx, 4, tw, 2)
    }
    tx += tw + 4
  })

  // 本文（ゆっくりスクロール）
  const top = lineH * 1.8
  const visible = Math.floor((h - top - lineH * 1.2) / lineH)
  const scroll = Math.floor(t * 0.6) % CODE.length
  const gutter = charW * 5
  const cursorLine = visible - 4
  for (let i = 0; i < visible; i++) {
    const idx = (scroll + i) % CODE.length
    const y = top + i * lineH
    if (i === cursorLine) {
      ctx.fillStyle = 'rgba(61,224,255,0.07)'
      ctx.fillRect(0, y - 2, w, lineH)
    }
    ctx.fillStyle = i === cursorLine ? C.sky : '#2c3a4a'
    ctx.fillText(String(idx + 1).padStart(3, ' '), 8, y)
    let line = CODE[idx]
    // カーソル行はタイプ中の演出
    if (i === cursorLine) {
      const typed = Math.floor((t * 14) % (line.length + 20))
      line = line.slice(0, typed)
      const cursorX = 8 + gutter + line.length * charW
      if (Math.floor(t * 2) % 2 === 0) {
        ctx.fillStyle = C.cyan
        ctx.fillRect(cursorX, y, 2, fontSize)
      }
    }
    drawCodeLine(ctx, line, 8 + gutter, y, charW)
  }

  // ミニマップ
  const mmX = w - 70
  ctx.fillStyle = 'rgba(255,255,255,0.03)'
  ctx.fillRect(mmX, top, 60, h - top - lineH * 1.2)
  for (let i = 0; i < CODE.length; i++) {
    const len = Math.min(CODE[i].length, 60)
    ctx.fillStyle = CODE[i].includes('//') ? 'rgba(91,107,125,0.6)' : 'rgba(143,216,255,0.35)'
    ctx.fillRect(mmX + 4, top + 4 + i * 4.2, len * 0.8, 2)
  }
  ctx.fillStyle = 'rgba(61,224,255,0.12)'
  ctx.fillRect(mmX, top + 4 + scroll * 4.2, 60, visible * 4.2)

  // ステータスバー
  ctx.fillStyle = '#0b3a66'
  ctx.fillRect(0, h - lineH * 1.1, w, lineH * 1.1)
  ctx.fillStyle = C.text
  ctx.fillText(`main*  ⎇  Ln ${scroll + cursorLine + 1}, Col ${Math.floor(t * 14) % 40}   UTF-8   TypeScript`, 10, h - lineH * 0.95)
  ctx.textAlign = 'right'
  ctx.fillText('KANON-WS01', w - 12, h - lineH * 0.95)
  ctx.textAlign = 'left'
}

/* -------------------------------------------------------------------------- */
/* グラフ・ダッシュボード                                                        */
/* -------------------------------------------------------------------------- */

function panelFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string, color = C.cyan) {
  ctx.fillStyle = C.panel
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = 'rgba(61,224,255,0.25)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.fillStyle = color
  ctx.fillRect(x, y, 3, 18)
  ctx.font = `13px ${FONTS.display}`
  ctx.textBaseline = 'top'
  ctx.fillText(title, x + 10, y + 4)
}

function gridLines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step: number) {
  ctx.strokeStyle = C.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let gx = x; gx <= x + w; gx += step) {
    ctx.moveTo(gx + 0.5, y)
    ctx.lineTo(gx + 0.5, y + h)
  }
  for (let gy = y; gy <= y + h; gy += step) {
    ctx.moveTo(x, gy + 0.5)
    ctx.lineTo(x + w, gy + 0.5)
  }
  ctx.stroke()
}

export function drawGraphScreen(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const pad = 10
  const colW = (w - pad * 3) / 2
  const rowH = (h - pad * 3) / 2

  // 1) KB-001 ホバー高度（波形）
  {
    const x = pad
    const y = pad
    panelFrame(ctx, x, y, colW, rowH, 'KB-001 HOVER ALT')
    gridLines(ctx, x + 8, y + 26, colW - 16, rowH - 34, 24)
    ctx.strokeStyle = C.cyan
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i <= 200; i++) {
      const px = x + 8 + ((colW - 16) * i) / 200
      const v = Math.sin(i * 0.09 + t * 2.2) * 0.35 + Math.sin(i * 0.31 + t * 3.7) * 0.12
      const py = y + 26 + (rowH - 34) * (0.5 - v * 0.8)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.fillStyle = C.text
    ctx.font = `20px ${FONTS.mono}`
    ctx.fillText(`${(0.34 + Math.sin(t * 2.2) * 0.01).toFixed(3)} m`, x + colW - 120, y + 4)
  }

  // 2) スペクトラム
  {
    const x = pad * 2 + colW
    const y = pad
    panelFrame(ctx, x, y, colW, rowH, 'THRUSTER SPECTRUM', C.blue)
    const bars = 36
    const bw = (colW - 20) / bars
    for (let i = 0; i < bars; i++) {
      const v = 0.25 + 0.6 * Math.abs(Math.sin(i * 0.5 + t * 2.5) * Math.cos(i * 0.13 - t * 1.3))
      const bh = (rowH - 40) * v
      const grad = ctx.createLinearGradient(0, y + rowH - 8 - bh, 0, y + rowH - 8)
      grad.addColorStop(0, C.cyan)
      grad.addColorStop(1, C.blue)
      ctx.fillStyle = grad
      ctx.fillRect(x + 10 + i * bw, y + rowH - 8 - bh, bw - 3, bh)
    }
  }

  // 3) CPU / 温度ゲージ
  {
    const x = pad
    const y = pad * 2 + rowH
    panelFrame(ctx, x, y, colW, rowH, 'SYSTEM')
    const labels = ['CPU', 'GPU', 'MEM', 'TEMP']
    labels.forEach((label, i) => {
      const v = 0.35 + 0.5 * Math.abs(Math.sin(t * (0.3 + i * 0.17) + i))
      const by = y + 34 + i * ((rowH - 44) / 4)
      ctx.fillStyle = C.dim
      ctx.font = `15px ${FONTS.mono}`
      ctx.fillText(label, x + 12, by)
      ctx.fillStyle = 'rgba(61,224,255,0.12)'
      ctx.fillRect(x + 70, by + 2, colW - 140, 12)
      ctx.fillStyle = i === 3 && v > 0.8 ? '#ffb347' : C.cyan
      ctx.fillRect(x + 70, by + 2, (colW - 140) * v, 12)
      ctx.fillStyle = C.text
      ctx.fillText(`${Math.round(v * 100)}%`, x + colW - 60, by)
    })
  }

  // 4) 通信リンク（通信なのでグリーン）
  {
    const x = pad * 2 + colW
    const y = pad * 2 + rowH
    panelFrame(ctx, x, y, colW, rowH, 'CROSS-WORLD LINK', C.comm)
    const cx = x + 70
    const cy = y + rowH / 2 + 10
    for (let r = 0; r < 3; r++) {
      ctx.strokeStyle = `rgba(61,255,160,${0.8 - r * 0.25})`
      ctx.lineWidth = 2
      ctx.beginPath()
      const start = t * (1 + r * 0.5) * (r % 2 ? -1 : 1)
      ctx.arc(cx, cy, 18 + r * 14, start, start + Math.PI * 1.3)
      ctx.stroke()
    }
    ctx.fillStyle = C.comm
    ctx.beginPath()
    ctx.arc(cx, cy, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `28px ${FONTS.display}`
    ctx.fillText(`${(98 + Math.sin(t) * 0.9).toFixed(1)}%`, x + 140, y + 40)
    ctx.font = `14px ${FONTS.mono}`
    ctx.fillStyle = C.text
    ctx.fillText('PENDANT  ONLINE', x + 140, y + 82)
    ctx.fillText(`LATENCY  ${(3.2 + Math.sin(t * 3) * 0.4).toFixed(1)} ms`, x + 140, y + 102)
  }
}

/* -------------------------------------------------------------------------- */
/* ターミナル                                                                   */
/* -------------------------------------------------------------------------- */

const LOGS: { text: string; color?: string }[] = [
  { text: '$ pnpm build --filter kb001-firmware' },
  { text: '  ✓ compiled 128 modules in 2.4s', color: C.sky },
  { text: '$ kb flash --port /dev/ttyACM0' },
  { text: '  writing 0x0000 ... 0x7fff  [##########] 100%', color: C.sky },
  { text: '[kb-001] servo calibration ... ok' },
  { text: '[kb-001] thruster ring 1/2/3 ... ok' },
  { text: '[link] handshake with pendant ... ok', color: C.comm },
  { text: '[link] rssi -41 dBm  snr 28 dB', color: C.comm },
  { text: '[station] ring A 4.5 rpm / ring B -6.0 rpm' },
  { text: '[station] core temp 41.2 C  coolant flow 12 L/min' },
  { text: '[printer] layer 212/340  nozzle 215 C' },
  { text: '[cnc] job "ear-housing-v7" 63%' },
  { text: '$ git commit -m "fix: hover jitter"' },
  { text: '  [main 7e1c0a2] fix: hover jitter', color: C.sky },
  { text: '[link] relay packet #88412 -> crossworld', color: C.comm },
  { text: '[kb-001] battery 87%  temp 33.0 C' },
  { text: '$ htop' },
  { text: '[warn] fan 3 rpm low (re-check)', color: '#ffb347' },
]

export function drawTerminalScreen(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
  ctx.fillStyle = '#02060c'
  ctx.fillRect(0, 0, w, h)
  const fontSize = Math.round(h / 22)
  const lineH = fontSize * 1.35
  ctx.font = `${fontSize}px ${FONTS.mono}`
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#0a1a2c'
  ctx.fillRect(0, 0, w, lineH * 1.2)
  ctx.fillStyle = C.dim
  ctx.fillText('kanon@lab: ~/kb001', 12, 6)
  const rows = Math.floor((h - lineH * 1.5) / lineH)
  const step = Math.floor(t * 1.2)
  for (let i = 0; i < rows; i++) {
    const idx = (step + i) % LOGS.length
    const log = LOGS[idx]
    ctx.fillStyle = log.color ?? C.text
    ctx.fillText(log.text, 12, lineH * 1.5 + i * lineH)
  }
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = C.cyan
    ctx.fillRect(12, lineH * 1.5 + rows * lineH - lineH * 0.1, fontSize * 0.6, fontSize)
  }
}

/* -------------------------------------------------------------------------- */
/* 浮遊ホロパネル（背景透明。HologramMaterial の mapTexture に使う）             */
/* -------------------------------------------------------------------------- */

export function drawHoloDiagnostics(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(160,235,255,0.9)'
  ctx.lineWidth = 2
  roundedRectPath(ctx, 4, 4, w - 8, h - 8, 14)
  ctx.stroke()
  ctx.fillStyle = 'rgba(61,224,255,0.08)'
  ctx.fill()
  ctx.fillStyle = '#bff3ff'
  ctx.font = `bold 26px ${FONTS.display}`
  ctx.textBaseline = 'top'
  ctx.fillText('KB-001 DIAGNOSTICS', 24, 20)
  // 円形ゲージ
  const cx = w * 0.25
  const cy = h * 0.58
  const r = h * 0.26
  ctx.lineWidth = 10
  ctx.strokeStyle = 'rgba(61,224,255,0.2)'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  const v = 0.87
  ctx.strokeStyle = '#7fe9ff'
  ctx.beginPath()
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  const a = t * 1.2
  ctx.arc(cx, cy, r * 0.72, a, a + 1.2)
  ctx.stroke()
  ctx.font = `bold 34px ${FONTS.display}`
  ctx.fillStyle = '#e8fbff'
  ctx.textAlign = 'center'
  ctx.fillText('87%', cx, cy - 18)
  ctx.font = `16px ${FONTS.mono}`
  ctx.fillText('BATTERY', cx, cy + 22)
  ctx.textAlign = 'left'
  // バー
  const items = ['EAR-L', 'EAR-R', 'THRUST', 'OPTICS', 'GYRO']
  items.forEach((label, i) => {
    const y = h * 0.3 + i * 36
    const val = 0.55 + 0.4 * Math.abs(Math.sin(t * 0.8 + i * 1.3))
    ctx.fillStyle = '#9fe6ff'
    ctx.font = `16px ${FONTS.mono}`
    ctx.fillText(label, w * 0.5, y)
    ctx.fillStyle = 'rgba(61,224,255,0.2)'
    ctx.fillRect(w * 0.64, y + 3, w * 0.28, 10)
    ctx.fillStyle = '#6fe4ff'
    ctx.fillRect(w * 0.64, y + 3, w * 0.28 * val, 10)
  })
}

export function drawHoloPipeline(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(160,235,255,0.9)'
  ctx.lineWidth = 2
  roundedRectPath(ctx, 4, 4, w - 8, h - 8, 14)
  ctx.stroke()
  ctx.fillStyle = 'rgba(30,111,255,0.1)'
  ctx.fill()
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#bff3ff'
  ctx.font = `bold 24px ${FONTS.display}`
  ctx.fillText('BUILD PIPELINE', 24, 20)
  const steps = ['lint', 'typecheck', 'unit test', 'firmware build', 'flash KB-001', 'deploy station']
  const active = Math.floor(t * 0.5) % (steps.length + 2)
  steps.forEach((s, i) => {
    const y = 70 + i * 34
    const done = i < active
    const running = i === active
    ctx.strokeStyle = done ? '#7fe9ff' : 'rgba(127,233,255,0.4)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(40, y + 9, 9, 0, Math.PI * 2)
    ctx.stroke()
    if (done) {
      ctx.fillStyle = '#7fe9ff'
      ctx.beginPath()
      ctx.arc(40, y + 9, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (running) {
      ctx.strokeStyle = '#e8fbff'
      ctx.beginPath()
      ctx.arc(40, y + 9, 13, t * 5, t * 5 + 2)
      ctx.stroke()
    }
    ctx.fillStyle = done || running ? '#e0f8ff' : 'rgba(160,220,255,0.45)'
    ctx.font = `18px ${FONTS.mono}`
    ctx.fillText(s, 64, y)
    ctx.textAlign = 'right'
    ctx.fillText(done ? `${(1.2 + i * 0.7).toFixed(1)}s` : running ? '...' : '', w - 24, y)
    ctx.textAlign = 'left'
  })
}

export function drawHoloNetwork(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(160,235,255,0.9)'
  ctx.lineWidth = 2
  roundedRectPath(ctx, 4, 4, w - 8, h - 8, 14)
  ctx.stroke()
  ctx.fillStyle = 'rgba(61,224,255,0.06)'
  ctx.fill()
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#bff3ff'
  ctx.font = `bold 22px ${FONTS.display}`
  ctx.fillText('LAB NETWORK', 24, 18)
  const nodes = [
    [0.5, 0.55],
    [0.2, 0.4],
    [0.8, 0.38],
    [0.28, 0.8],
    [0.72, 0.8],
    [0.5, 0.28],
  ]
  ctx.strokeStyle = 'rgba(127,233,255,0.5)'
  ctx.lineWidth = 1.5
  nodes.slice(1).forEach(([x, y]) => {
    ctx.beginPath()
    ctx.moveTo(nodes[0][0] * w, nodes[0][1] * h)
    ctx.lineTo(x * w, y * h)
    ctx.stroke()
  })
  nodes.slice(1).forEach(([x, y], i) => {
    const p = (t * 0.6 + i * 0.23) % 1
    ctx.fillStyle = '#e8fbff'
    ctx.beginPath()
    ctx.arc(nodes[0][0] * w + (x - nodes[0][0]) * w * p, nodes[0][1] * h + (y - nodes[0][1]) * h * p, 3, 0, Math.PI * 2)
    ctx.fill()
  })
  const names = ['CORE', 'KB-001', 'STATION', 'PRINTER', 'CNC', 'RACK']
  nodes.forEach(([x, y], i) => {
    ctx.fillStyle = i === 0 ? '#e8fbff' : '#7fe9ff'
    ctx.beginPath()
    ctx.arc(x * w, y * h, i === 0 ? 10 : 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `14px ${FONTS.mono}`
    ctx.fillStyle = '#bff3ff'
    ctx.fillText(names[i], x * w + 12, y * h - 7)
  })
}

/* -------------------------------------------------------------------------- */
/* 小さな機械の画面                                                             */
/* -------------------------------------------------------------------------- */

export function drawOscilloscope(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
  ctx.fillStyle = '#020a10'
  ctx.fillRect(0, 0, w, h)
  gridLines(ctx, 0, 0, w, h, w / 10)
  ctx.strokeStyle = C.cyan
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i <= 160; i++) {
    const x = (w * i) / 160
    const phase = i / 16 + t * 3
    const v = (phase % 1 < 0.5 ? 1 : -1) * 0.5 + Math.sin(phase * 13) * 0.05
    const y = h * 0.35 - v * h * 0.2
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.strokeStyle = '#ffd08a'
  ctx.beginPath()
  for (let i = 0; i <= 160; i++) {
    const x = (w * i) / 160
    const y = h * 0.72 - Math.sin(i * 0.2 + t * 4) * h * 0.12
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.fillStyle = C.sky
  ctx.font = `${Math.round(h / 10)}px ${FONTS.mono}`
  ctx.textBaseline = 'top'
  ctx.fillText('CH1 2V  CH2 500mV  1ms', 6, 4)
}

export function drawMachineScreen(title: string, sub: string) {
  return (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => {
    ctx.fillStyle = '#03101c'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = C.cyan
    ctx.textBaseline = 'top'
    ctx.font = `bold ${Math.round(h / 7)}px ${FONTS.display}`
    ctx.fillText(title, 10, 8)
    ctx.font = `${Math.round(h / 9)}px ${FONTS.mono}`
    ctx.fillStyle = C.text
    ctx.fillText(sub, 10, h * 0.32)
    const p = (t * 0.02) % 1
    ctx.fillStyle = 'rgba(61,224,255,0.2)'
    ctx.fillRect(10, h * 0.62, w - 20, h * 0.12)
    ctx.fillStyle = C.cyan
    ctx.fillRect(10, h * 0.62, (w - 20) * (0.4 + p * 0.6), h * 0.12)
    ctx.fillStyle = C.sky
    ctx.fillText(`${Math.round((0.4 + p * 0.6) * 100)}%`, 10, h * 0.8)
  }
}
