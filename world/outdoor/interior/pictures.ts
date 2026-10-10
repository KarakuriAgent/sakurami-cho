import * as THREE from 'three'

/**
 * 中の絵（ポスター・星図・天体写真・ホワイトボード・黒板・画面・写真・メニュー）を canvas に描いたアトラス（2048²）。
 * 絵は名前（PictureKey）ごとに 1 回だけ描き、uv の範囲を返す。画像のファイルは使わない（設定資料の言葉から描く）。
 * アトラスは中を作る建物ごとに 1 枚（interiors.ts が中を作るときに作り、片付けるときに捨てる。#15）
 */

export type PictureKey =
  | 'stellagate'
  | 'starchart'
  | 'starchart-round'
  | 'starchart-winter'
  | 'nebula'
  | 'galaxy'
  | 'moon'
  | 'milkyway'
  | 'brainstorm'
  | 'today'
  | 'solar'
  | 'code'
  | 'code2'
  | 'terminal'
  | 'scope'
  | 'first-image'
  | 'photo-family'
  | 'photo-kb'
  | 'photo-bay'
  | 'menu'
  | 'photo-ok'
  | 'wrenches'
  | 'arch-board'
  | 'calendar'
  | 'pegboard'
  | 'manuscript'
  | 'magazine'
  | 'map-town'
  | 'seizu-card'
  | 'bean-label'
  | 'tv-off'
  | 'laptop'
  | 'kanji-scroll'
  | 'cafe-menu'
  | 'cafe-timetable'
  | 'sepia-station'
  | 'sepia-steam'
  | 'sepia-platform'
  | 'ekimeihyo'
  | 'rail-poster'
  | 'clock-face'
  | 'number-plate'
  | 'cafe-card'
  | 'concourse-sign'
  | 'komorebi-menu'
  | 'happaya-sign'
  | 'bain-screen'
  | 'bain-graph'
  | 'bain-sign'
  | 'seed-sign'
  | 'seed-panel'
  | 'dome-map'
  | 'soranowa-board'
  | 'soranowa-tide'
  | 'soranowa-view'
  | 'soranowa-gate'
  | 'soranowa-ticket'
  | 'soranowa-poster'
  | 'cable-name-summit'
  | 'cable-name-fumoto'
  | 'cable-timetable'
  | 'cable-guide'
  | 'cable-gate'

/** 駅名標（白い板・上の緑の帯・大きなひらがな・漢字・ローマ字・となりの駅の矢印） */
function cableName(g: CanvasRenderingContext2D, w: number, h: number, kana: string, kanji: string, roman: string, right: string | null, left: string | null) {
  g.fillStyle = '#f8f6ee'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#2f6b3a'
  g.fillRect(0, 0, w, 10)
  g.fillRect(0, h - 34, w, 34)
  g.fillStyle = '#1f2a24'
  g.textAlign = 'center'
  g.font = `bold 46px ${JP}`
  g.fillText(kana, w / 2, 62)
  g.font = `bold 22px ${JP}`
  g.fillText(`${kanji}駅　${roman}`, w / 2, 96)
  g.fillStyle = '#ffffff'
  g.font = `bold 18px ${JP}`
  g.textAlign = 'left'
  if (left) g.fillText(`← ${left}`, 14, h - 11)
  g.textAlign = 'right'
  if (right) g.fillText(`${right} →`, w - 14, h - 11)
  g.textAlign = 'left'
}

const SIZE = 2048

interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** 決まった乱数 */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

const JP = '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", sans-serif'
const JPS = '"Noto Serif CJK JP", "Noto Serif JP", "Hiragino Mincho ProN", serif'
const MONO = '"DejaVu Sans Mono", "Noto Sans Mono", monospace'

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void

/** 星（点）を散らす */
function stars(g: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, color = '#ffffff', maxR = 1.6) {
  const r = rng(seed)
  for (let i = 0; i < n; i++) {
    const x = r() * w
    const y = r() * h
    const s = Math.pow(r(), 3) * maxR + 0.4
    g.fillStyle = color
    g.globalAlpha = 0.4 + r() * 0.6
    g.beginPath()
    g.arc(x, y, s, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
}

/** 星座の線（点をつないだ折れ線） */
function constellation(g: CanvasRenderingContext2D, pts: [number, number][], line: string, star: string, lw = 1.6) {
  g.strokeStyle = line
  g.lineWidth = lw
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.stroke()
  g.fillStyle = star
  for (const [x, y] of pts) {
    g.beginPath()
    g.arc(x, y, lw * 2.2, 0, Math.PI * 2)
    g.fill()
  }
}

/** 星座の形（オリオン・カシオペヤ・北斗七星・白鳥・夏の大三角） */
const CONSTELLATIONS: [number, number][][] = [
  [
    [0.12, 0.2],
    [0.18, 0.26],
    [0.22, 0.36],
    [0.16, 0.44],
    [0.2, 0.36],
    [0.27, 0.3],
    [0.3, 0.44],
  ],
  [
    [0.55, 0.12],
    [0.6, 0.2],
    [0.66, 0.15],
    [0.71, 0.22],
    [0.77, 0.14],
  ],
  [
    [0.4, 0.58],
    [0.47, 0.6],
    [0.52, 0.63],
    [0.58, 0.62],
    [0.6, 0.7],
    [0.67, 0.71],
    [0.68, 0.63],
    [0.6, 0.62],
  ],
  [
    [0.78, 0.5],
    [0.82, 0.6],
    [0.86, 0.7],
    [0.82, 0.6],
    [0.74, 0.58],
    [0.82, 0.6],
    [0.9, 0.62],
  ],
  [
    [0.2, 0.75],
    [0.32, 0.85],
    [0.12, 0.88],
    [0.2, 0.75],
  ],
]

/** セピアの古い写真（白い縁・セピアの色調・粒子・周辺の暗さ・下の書き込み） */
function sepiaPhoto(g: CanvasRenderingContext2D, w: number, h: number, seed: number, scene: (q: CanvasRenderingContext2D) => void, caption: string) {
  g.fillStyle = '#efe6d2'
  g.fillRect(0, 0, w, h)
  const m = 14
  g.save()
  g.beginPath()
  g.rect(m, m, w - m * 2, h - m * 2 - 18)
  g.clip()
  g.translate(m, m)
  g.scale((w - m * 2) / w, (h - m * 2 - 18) / h)
  scene(g)
  g.restore()
  // 粒子と周辺の暗さ
  const r = rng(seed)
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(40,28,14,${r() * 0.08})` : `rgba(255,246,226,${r() * 0.08})`
    g.fillRect(m + r() * (w - m * 2), m + r() * (h - m * 2 - 18), 1.5, 1.5)
  }
  const v = g.createRadialGradient(w / 2, h / 2 - 9, Math.min(w, h) * 0.2, w / 2, h / 2 - 9, Math.max(w, h) * 0.62)
  v.addColorStop(0, 'rgba(60,40,20,0)')
  v.addColorStop(1, 'rgba(60,40,20,0.45)')
  g.fillStyle = v
  g.fillRect(m, m, w - m * 2, h - m * 2 - 18)
  g.fillStyle = '#4a3a26'
  g.textAlign = 'center'
  g.font = `13px ${JPS}`
  g.fillText(caption, w / 2, h - 10)
}

const DRAW: Record<PictureKey, { w: number; h: number; draw: Draw }> = {
  // 『並行航路ステラゲート』のポスター（宇宙を舞台にしたアニメ）。縦長
  stellagate: {
    w: 360,
    h: 512,
    draw: (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#060818')
      bg.addColorStop(0.55, '#1a1450')
      bg.addColorStop(1, '#40206a')
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)
      stars(g, w, h, 260, 11)
      // 惑星と輪
      const pg = g.createRadialGradient(w * 0.62, h * 0.38, 10, w * 0.7, h * 0.42, w * 0.42)
      pg.addColorStop(0, '#9ad8ff')
      pg.addColorStop(0.6, '#3f6fb8')
      pg.addColorStop(1, '#111a40')
      g.fillStyle = pg
      g.beginPath()
      g.arc(w * 0.7, h * 0.42, w * 0.32, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(200,230,255,0.55)'
      g.lineWidth = 6
      g.beginPath()
      g.ellipse(w * 0.7, h * 0.42, w * 0.5, w * 0.1, -0.35, 0, Math.PI * 2)
      g.stroke()
      // ゲート（光の輪）と船
      g.strokeStyle = '#4ff0ff'
      g.lineWidth = 5
      g.shadowColor = '#4ff0ff'
      g.shadowBlur = 18
      g.beginPath()
      g.ellipse(w * 0.3, h * 0.62, w * 0.18, w * 0.24, 0.2, 0, Math.PI * 2)
      g.stroke()
      g.shadowBlur = 0
      g.fillStyle = '#e8ecf4'
      g.beginPath()
      g.moveTo(w * 0.18, h * 0.7)
      g.lineTo(w * 0.42, h * 0.58)
      g.lineTo(w * 0.36, h * 0.66)
      g.lineTo(w * 0.46, h * 0.68)
      g.closePath()
      g.fill()
      g.fillStyle = '#ffb347'
      g.beginPath()
      g.arc(w * 0.17, h * 0.705, 6, 0, Math.PI * 2)
      g.fill()
      // 題名
      g.fillStyle = '#ffffff'
      g.textAlign = 'center'
      g.font = `bold 40px ${JPS}`
      g.fillText('並行航路', w / 2, h * 0.84)
      g.font = `bold 34px ${JP}`
      g.fillStyle = '#7ef6ff'
      g.fillText('ステラゲート', w / 2, h * 0.91)
      g.font = `14px ${JP}`
      g.fillStyle = '#c8c8e8'
      g.fillText('PARALLEL ROUTE  STELLAGATE', w / 2, h * 0.96)
    },
  },
  // 星図（長方形。藍色の地に星と星座線）
  starchart: {
    w: 512,
    h: 340,
    draw: (g, w, h) => {
      g.fillStyle = '#0d1b3e'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = 'rgba(160,190,255,0.22)'
      g.lineWidth = 1
      for (let i = 1; i < 8; i++) {
        g.beginPath()
        g.moveTo((i / 8) * w, 0)
        g.lineTo((i / 8) * w, h)
        g.stroke()
      }
      for (let i = 1; i < 5; i++) {
        g.beginPath()
        g.moveTo(0, (i / 5) * h)
        g.lineTo(w, (i / 5) * h)
        g.stroke()
      }
      stars(g, w, h, 320, 23, '#e8ecff', 1.3)
      for (const c of CONSTELLATIONS) constellation(g, c.map(([x, y]) => [x * w, y * h]), 'rgba(230,200,120,0.75)', '#ffe7a8', 1.4)
      g.strokeStyle = '#c9a046'
      g.lineWidth = 6
      g.strokeRect(3, 3, w - 6, h - 6)
    },
  },
  // 円い星座早見（真鍮の縁）
  'starchart-round': {
    w: 400,
    h: 400,
    draw: (g, w, h) => {
      g.fillStyle = '#efe6cf'
      g.fillRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      g.fillStyle = '#132552'
      g.beginPath()
      g.arc(cx, cy, w * 0.44, 0, Math.PI * 2)
      g.fill()
      g.save()
      g.beginPath()
      g.arc(cx, cy, w * 0.44, 0, Math.PI * 2)
      g.clip()
      stars(g, w, h, 260, 41, '#f4f0ff', 1.4)
      for (const c of CONSTELLATIONS) constellation(g, c.map(([x, y]) => [x * w, y * h]), 'rgba(240,210,130,0.7)', '#ffe9b0', 1.2)
      g.restore()
      g.strokeStyle = '#a77d2f'
      g.lineWidth = 10
      g.beginPath()
      g.arc(cx, cy, w * 0.45, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = '#5a4020'
      g.font = `13px ${JPS}`
      g.textAlign = 'center'
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        g.fillText(`${i + 1}月`, cx + Math.sin(a) * w * 0.485, cy - Math.cos(a) * w * 0.485 + 5)
      }
    },
  },
  // 冬の星座（額入りの古い星図。生成りの紙に黒い線）
  'starchart-winter': {
    w: 420,
    h: 320,
    draw: (g, w, h) => {
      g.fillStyle = '#e9dfc6'
      g.fillRect(0, 0, w, h)
      const r = rng(77)
      g.fillStyle = 'rgba(120,90,50,0.08)'
      for (let i = 0; i < 40; i++) g.fillRect(r() * w, r() * h, 30 + r() * 60, 20 + r() * 40)
      stars(g, w, h, 160, 91, '#2a2418', 1.8)
      for (const c of CONSTELLATIONS.slice(0, 3)) constellation(g, c.map(([x, y]) => [x * w * 1.1, y * h * 1.2]), 'rgba(40,30,20,0.8)', '#1a1410', 1.3)
      g.fillStyle = '#3a2a18'
      g.font = `italic 18px ${JPS}`
      g.fillText('Orion & Taurus', 18, h - 18)
      g.strokeStyle = '#3a2a18'
      g.lineWidth = 2
      g.strokeRect(8, 8, w - 16, h - 16)
    },
  },
  // 天体写真: 星雲（オリオン大星雲のような赤と青）
  nebula: {
    w: 360,
    h: 280,
    draw: (g, w, h) => {
      g.fillStyle = '#030308'
      g.fillRect(0, 0, w, h)
      const r = rng(5)
      for (let i = 0; i < 90; i++) {
        const x = w * (0.35 + r() * 0.35)
        const y = h * (0.3 + r() * 0.4)
        const rad = 20 + r() * 70
        const gr = g.createRadialGradient(x, y, 0, x, y, rad)
        const c = r() < 0.55 ? '255,90,120' : r() < 0.7 ? '120,170,255' : '255,200,150'
        gr.addColorStop(0, `rgba(${c},0.12)`)
        gr.addColorStop(1, `rgba(${c},0)`)
        g.fillStyle = gr
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
      }
      stars(g, w, h, 220, 6, '#ffffff', 1.5)
    },
  },
  // 天体写真: 渦巻銀河
  galaxy: {
    w: 360,
    h: 280,
    draw: (g, w, h) => {
      g.fillStyle = '#020206'
      g.fillRect(0, 0, w, h)
      stars(g, w, h, 180, 8, '#ffffff', 1.2)
      g.save()
      g.translate(w / 2, h / 2)
      g.rotate(-0.5)
      g.scale(1, 0.42)
      const r = rng(12)
      for (let i = 0; i < 1600; i++) {
        const t = r() * 6
        const arm = r() < 0.5 ? 0 : Math.PI
        const rad = 6 + t * 18 + r() * 10
        const a = arm + t * 1.1 + r() * 0.5
        g.fillStyle = `rgba(${200 + r() * 55},${190 + r() * 50},${230},${0.25 + r() * 0.3})`
        g.fillRect(Math.cos(a) * rad, Math.sin(a) * rad, 2, 2)
      }
      const core = g.createRadialGradient(0, 0, 0, 0, 0, 40)
      core.addColorStop(0, 'rgba(255,240,210,0.95)')
      core.addColorStop(1, 'rgba(255,240,210,0)')
      g.fillStyle = core
      g.beginPath()
      g.arc(0, 0, 40, 0, Math.PI * 2)
      g.fill()
      g.restore()
    },
  },
  // 天体写真: 月面
  moon: {
    w: 300,
    h: 300,
    draw: (g, w, h) => {
      g.fillStyle = '#050505'
      g.fillRect(0, 0, w, h)
      const gr = g.createRadialGradient(w * 0.45, h * 0.45, 10, w / 2, h / 2, w * 0.42)
      gr.addColorStop(0, '#f2efe6')
      gr.addColorStop(1, '#8a877e')
      g.fillStyle = gr
      g.beginPath()
      g.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2)
      g.fill()
      const r = rng(3)
      for (let i = 0; i < 60; i++) {
        const a = r() * Math.PI * 2
        const d = r() * w * 0.36
        g.fillStyle = `rgba(80,78,70,${0.15 + r() * 0.25})`
        g.beginPath()
        g.arc(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 3 + r() * 18, 0, Math.PI * 2)
        g.fill()
      }
    },
  },
  // 天体写真: 天の川と山の稜線
  milkyway: {
    w: 512,
    h: 256,
    draw: (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#030512')
      bg.addColorStop(1, '#141c3a')
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)
      stars(g, w, h, 420, 19, '#ffffff', 1.1)
      g.save()
      g.translate(w / 2, h / 2)
      g.rotate(-0.4)
      const band = g.createLinearGradient(0, -50, 0, 50)
      band.addColorStop(0, 'rgba(200,190,255,0)')
      band.addColorStop(0.5, 'rgba(230,215,255,0.35)')
      band.addColorStop(1, 'rgba(200,190,255,0)')
      g.fillStyle = band
      g.fillRect(-w, -50, w * 2, 100)
      g.restore()
      g.fillStyle = '#05060a'
      g.beginPath()
      g.moveTo(0, h)
      for (let x = 0; x <= w; x += 16) g.lineTo(x, h * 0.82 - Math.sin(x * 0.02) * 12 - Math.sin(x * 0.007) * 20)
      g.lineTo(w, h)
      g.fill()
    },
  },
  // ブレスト・ボード（壁一面のホワイトボード。KB-001 の顔・矢印・家・電球・町の絵と、家訓）
  brainstorm: {
    w: 1024,
    h: 512,
    draw: (g, w, h) => {
      g.fillStyle = '#f7f8f6'
      g.fillRect(0, 0, w, h)
      // 消し残りのかすれ
      const r = rng(99)
      g.fillStyle = 'rgba(120,140,160,0.06)'
      for (let i = 0; i < 30; i++) g.fillRect(r() * w, r() * h, 80 + r() * 160, 10 + r() * 30)
      g.lineCap = 'round'
      g.lineJoin = 'round'
      g.strokeStyle = '#2a3440'
      g.lineWidth = 4
      // KB-001 の顔（丸と目）
      g.beginPath()
      g.arc(170, 170, 90, 0, Math.PI * 2)
      g.stroke()
      g.beginPath()
      g.roundRect(105, 130, 130, 80, 24)
      g.stroke()
      g.fillStyle = '#1f8fb0'
      g.fillRect(135, 155, 18, 30)
      g.fillRect(187, 155, 18, 30)
      // 矢印と箱
      const arrow = (x0: number, y0: number, x1: number, y1: number) => {
        g.beginPath()
        g.moveTo(x0, y0)
        g.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 40, x1, y1)
        g.stroke()
        const a = Math.atan2(y1 - y0, x1 - x0)
        g.beginPath()
        g.moveTo(x1, y1)
        g.lineTo(x1 - 16 * Math.cos(a - 0.4), y1 - 16 * Math.sin(a - 0.4))
        g.moveTo(x1, y1)
        g.lineTo(x1 - 16 * Math.cos(a + 0.4), y1 - 16 * Math.sin(a + 0.4))
        g.stroke()
      }
      arrow(270, 140, 380, 120)
      g.strokeRect(390, 70, 90, 90)
      g.beginPath()
      g.moveTo(390, 70)
      g.lineTo(420, 45)
      g.lineTo(510, 45)
      g.lineTo(480, 70)
      g.moveTo(510, 45)
      g.lineTo(510, 135)
      g.lineTo(480, 160)
      g.stroke()
      // 電球
      g.beginPath()
      g.arc(600, 105, 34, Math.PI * 0.8, Math.PI * 2.2)
      g.lineTo(615, 160)
      g.lineTo(585, 160)
      g.closePath()
      g.stroke()
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.45
        g.beginPath()
        g.moveTo(600 + Math.cos(a) * 46, 105 + Math.sin(a) * 46)
        g.lineTo(600 + Math.cos(a) * 62, 105 + Math.sin(a) * 62)
        g.stroke()
      }
      arrow(520, 120, 560, 110)
      // 家と木
      g.beginPath()
      g.moveTo(720, 170)
      g.lineTo(780, 110)
      g.lineTo(840, 170)
      g.lineTo(840, 240)
      g.lineTo(720, 240)
      g.closePath()
      g.stroke()
      g.strokeRect(765, 195, 25, 45)
      g.beginPath()
      g.arc(900, 190, 30, 0, Math.PI * 2)
      g.moveTo(900, 220)
      g.lineTo(900, 250)
      g.stroke()
      arrow(640, 130, 715, 160)
      // 歯車
      g.strokeStyle = '#b8402f'
      g.beginPath()
      g.arc(320, 330, 40, 0, Math.PI * 2)
      g.stroke()
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        g.beginPath()
        g.moveTo(320 + Math.cos(a) * 40, 330 + Math.sin(a) * 40)
        g.lineTo(320 + Math.cos(a) * 54, 330 + Math.sin(a) * 54)
        g.stroke()
      }
      g.beginPath()
      g.arc(320, 330, 14, 0, Math.PI * 2)
      g.stroke()
      // 町の輪郭
      g.strokeStyle = '#2a3440'
      g.beginPath()
      g.moveTo(460, 400)
      for (const [x, y] of [
        [480, 400],
        [480, 350],
        [510, 350],
        [510, 370],
        [540, 370],
        [540, 320],
        [570, 320],
        [570, 380],
        [600, 380],
        [600, 340],
        [640, 340],
        [640, 400],
        [700, 400],
      ])
        g.lineTo(x, y)
      g.stroke()
      // メモの字
      g.fillStyle = '#2a3440'
      g.font = `24px ${JP}`
      g.fillText('リンクの安定 → 熱?', 80, 320)
      g.fillText('ドアベル改 v3', 80, 360)
      g.fillStyle = '#1f6fb0'
      g.fillText('KB の夜の巡回ルート', 720, 300)
      g.fillStyle = '#b8402f'
      g.fillText('週末: 部品の買い出し', 720, 340)
      // 家訓（端に）
      g.fillStyle = '#1a1a1a'
      g.font = `bold 34px ${JPS}`
      g.fillText('まず作る。そして根拠を示す。', 470, 470)
      g.strokeStyle = '#1a1a1a'
      g.lineWidth = 2
      g.strokeRect(455, 430, 520, 56)
      // 枠
      g.strokeStyle = '#a7adb3'
      g.lineWidth = 10
      g.strokeRect(0, 0, w, h)
    },
  },
  // 玄関の「今日の予定」の黒板
  today: {
    w: 360,
    h: 220,
    draw: (g, w, h) => {
      g.fillStyle = '#23302a'
      g.fillRect(0, 0, w, h)
      g.fillStyle = 'rgba(255,255,255,0.06)'
      g.fillRect(10, 10, w - 20, h - 20)
      g.fillStyle = '#f2f0e8'
      g.font = `bold 22px ${JP}`
      g.fillText('今日の予定', 18, 36)
      g.font = `19px ${JP}`
      g.fillText('マイケル: 夜 リリース', 22, 78)
      g.fillText('美咲: 原稿しめきり', 22, 112)
      g.fillStyle = '#9fe6ff'
      g.fillText('花音: ラボ → 配信', 22, 146)
      g.fillStyle = '#ffd27a'
      g.fillText('KB: 充電・ケーブル束ね', 22, 180)
      g.strokeStyle = '#7a5a3a'
      g.lineWidth = 12
      g.strokeRect(0, 0, w, h)
    },
  },
  // 発電量パネル（太陽光瓦。画面）
  solar: {
    w: 240,
    h: 150,
    draw: (g, w, h) => {
      g.fillStyle = '#0b1520'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#7fe0a0'
      g.font = `bold 16px ${JP}`
      g.fillText('今日の発電', 12, 26)
      g.font = `bold 40px ${MONO}`
      g.fillStyle = '#e8fff0'
      g.fillText('8.6', 14, 82)
      g.font = `18px ${MONO}`
      g.fillText('kWh', 104, 82)
      g.strokeStyle = '#7fe0a0'
      g.lineWidth = 2
      g.beginPath()
      for (let i = 0; i <= 24; i++) {
        const x = 12 + (i / 24) * (w - 24)
        const y = h - 18 - Math.max(0, Math.sin(((i - 6) / 12) * Math.PI)) * 36
        if (i) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.stroke()
    },
  },
  // コードの画面（暗い地に色の付いた行）
  code: {
    w: 512,
    h: 300,
    draw: (g, w, h) => {
      g.fillStyle = '#0d1117'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#161b22'
      g.fillRect(0, 0, 90, h)
      const r = rng(31)
      const colors = ['#ff7b72', '#79c0ff', '#d2a8ff', '#a5d6ff', '#7ee787', '#c9d1d9', '#c9d1d9', '#8b949e']
      for (let i = 0; i < 26; i++) {
        const y = 14 + i * 11
        g.fillStyle = '#484f58'
        g.fillRect(70, y, 12, 5)
        let x = 100 + Math.floor(r() * 4) * 16
        const n = 1 + Math.floor(r() * 5)
        for (let k = 0; k < n; k++) {
          const len = 20 + r() * 70
          g.fillStyle = colors[Math.floor(r() * colors.length)]
          g.fillRect(x, y, len, 5)
          x += len + 8
        }
      }
      for (let i = 0; i < 14; i++) {
        g.fillStyle = i === 3 ? '#1f6feb' : '#30363d'
        g.fillRect(8, 14 + i * 18, 70, 8)
      }
    },
  },
  // コードの画面（明るいテーマ・図）
  code2: {
    w: 512,
    h: 300,
    draw: (g, w, h) => {
      g.fillStyle = '#1e1e2e'
      g.fillRect(0, 0, w, h)
      const r = rng(57)
      const colors = ['#f38ba8', '#89b4fa', '#cba6f7', '#a6e3a1', '#f9e2af', '#cdd6f4']
      for (let i = 0; i < 24; i++) {
        let x = 14 + Math.floor(r() * 5) * 14
        const y = 12 + i * 12
        const n = 1 + Math.floor(r() * 4)
        for (let k = 0; k < n; k++) {
          const len = 16 + r() * 80
          g.fillStyle = colors[Math.floor(r() * colors.length)]
          g.fillRect(x, y, len, 5)
          x += len + 8
        }
      }
      g.strokeStyle = '#89b4fa'
      g.lineWidth = 2
      g.strokeRect(330, 40, 160, 110)
      g.beginPath()
      g.moveTo(340, 130)
      for (let x = 0; x <= 140; x += 10) g.lineTo(340 + x, 130 - Math.abs(Math.sin(x * 0.05)) * 70)
      g.stroke()
    },
  },
  // ターミナル（緑の文字）
  terminal: {
    w: 400,
    h: 260,
    draw: (g, w, h) => {
      g.fillStyle = '#060a08'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#4cf08a'
      g.font = `13px ${MONO}`
      const lines = ['$ make flash', 'linking firmware.elf ...', 'flash: 98304 bytes OK', '$ ./monitor --port ttyUSB0', '[link] rssi -62dBm  ok', '[link] sync 0xA5 ... ok', '[kb001] battery 87%', '[kb001] cable bundle: done', '$ git log --oneline | head', '3f2a1c0 fix: relay heat', 'a91d7e2 add: doorbell v3', '$ _']
      lines.forEach((l, i) => g.fillText(l, 12, 22 + i * 19))
    },
  },
  // オシロスコープの画面（波形）
  scope: {
    w: 256,
    h: 180,
    draw: (g, w, h) => {
      g.fillStyle = '#04120c'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = 'rgba(80,200,140,0.25)'
      g.lineWidth = 1
      for (let i = 1; i < 10; i++) {
        g.beginPath()
        g.moveTo((i / 10) * w, 0)
        g.lineTo((i / 10) * w, h)
        g.stroke()
      }
      for (let i = 1; i < 8; i++) {
        g.beginPath()
        g.moveTo(0, (i / 8) * h)
        g.lineTo(w, (i / 8) * h)
        g.stroke()
      }
      g.strokeStyle = '#7dffb8'
      g.lineWidth = 2.5
      g.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const y = h * 0.35 + Math.sin(x * 0.09) * 22 + Math.sin(x * 0.31) * 6
        if (x) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.stroke()
      g.strokeStyle = '#ffd36a'
      g.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const y = h * 0.72 + (Math.sin(x * 0.05) > 0 ? -18 : 18)
        if (x) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.stroke()
    },
  },
  // こちらの世界から届いた最初の画像（印刷して額に。ぼやけた夜明けの空と、知らない町の屋根）
  'first-image': {
    w: 300,
    h: 220,
    draw: (g, w, h) => {
      g.fillStyle = '#f4f1ea'
      g.fillRect(0, 0, w, h)
      const sky = g.createLinearGradient(0, 14, 0, h - 40)
      sky.addColorStop(0, '#2c3c6e')
      sky.addColorStop(0.6, '#d68a6a')
      sky.addColorStop(1, '#f2c48a')
      g.fillStyle = sky
      g.fillRect(14, 14, w - 28, h - 54)
      g.fillStyle = '#2a2430'
      g.beginPath()
      g.moveTo(14, h - 40)
      for (let x = 14; x <= w - 14; x += 18) g.lineTo(x, h - 60 - ((x * 7) % 23))
      g.lineTo(w - 14, h - 40)
      g.fill()
      // ノイズの帯（受信の乱れ）
      const r = rng(4)
      for (let i = 0; i < 9; i++) {
        g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.1})`
        g.fillRect(14, 14 + r() * (h - 60), w - 28, 2)
      }
      g.fillStyle = '#4a4a4a'
      g.font = `14px ${JP}`
      g.fillText('2026.  はじめての一枚', 18, h - 16)
    },
  },
  // 家族の写真（3 人と KB-001）
  'photo-family': {
    w: 300,
    h: 220,
    draw: (g, w, h) => {
      g.fillStyle = '#f8f6f0'
      g.fillRect(0, 0, w, h)
      const bg = g.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#9cc4e4')
      bg.addColorStop(1, '#e8dcc0')
      g.fillStyle = bg
      g.fillRect(12, 12, w - 24, h - 24)
      const person = (x: number, hh: number, hair: string, shirt: string) => {
        g.fillStyle = shirt
        g.beginPath()
        g.roundRect(x - 26, h - 12 - hh * 0.55, 52, hh * 0.55, 14)
        g.fill()
        g.fillStyle = '#f1d2b8'
        g.beginPath()
        g.arc(x, h - 12 - hh * 0.62, 18, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = hair
        g.beginPath()
        g.arc(x, h - 18 - hh * 0.64, 19, Math.PI, Math.PI * 2)
        g.fill()
      }
      person(80, 170, '#d8c08a', '#6a4a36')
      person(150, 140, '#f0d890', '#8fc8f0')
      person(220, 150, '#1a1a1a', '#e8e0d0')
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(150, 54, 18, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#1a2a3a'
      g.fillRect(140, 48, 20, 10)
    },
  },
  // KB-001 の写真
  'photo-kb': {
    w: 220,
    h: 220,
    draw: (g, w, h) => {
      g.fillStyle = '#f8f6f0'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#2b3442'
      g.fillRect(12, 12, w - 24, h - 24)
      g.fillStyle = '#f0f2f4'
      g.beginPath()
      g.arc(w / 2, h / 2, 62, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#10161e'
      g.beginPath()
      g.roundRect(w / 2 - 44, h / 2 - 24, 88, 48, 16)
      g.fill()
      g.fillStyle = '#5ff0ff'
      g.fillRect(w / 2 - 26, h / 2 - 10, 12, 20)
      g.fillRect(w / 2 + 14, h / 2 - 10, 12, 20)
    },
  },
  // 湾の写真
  'photo-bay': {
    w: 300,
    h: 200,
    draw: (g, w, h) => {
      g.fillStyle = '#f8f6f0'
      g.fillRect(0, 0, w, h)
      const s = g.createLinearGradient(0, 12, 0, h * 0.55)
      s.addColorStop(0, '#f0a868')
      s.addColorStop(1, '#f6d6a8')
      g.fillStyle = s
      g.fillRect(12, 12, w - 24, h * 0.5)
      g.fillStyle = '#3a6a8a'
      g.fillRect(12, h * 0.5 + 12, w - 24, h * 0.5 - 24)
      g.fillStyle = '#2a3a2a'
      g.beginPath()
      g.ellipse(w * 0.72, h * 0.52, 48, 14, 0, Math.PI, Math.PI * 2)
      g.fill()
    },
  },
  // 星図珈琲のメニュー（黒板）
  menu: {
    w: 420,
    h: 560,
    draw: (g, w, h) => {
      g.fillStyle = '#1e2420'
      g.fillRect(0, 0, w, h)
      g.fillStyle = 'rgba(255,255,255,0.05)'
      g.fillRect(14, 14, w - 28, h - 28)
      g.fillStyle = '#f2e6c4'
      g.textAlign = 'center'
      g.font = `bold 30px ${JPS}`
      g.fillText('星図珈琲', w / 2, 52)
      g.font = `14px ${JP}`
      g.fillText('— MENU —', w / 2, 76)
      g.textAlign = 'left'
      const items: [string, string][] = [
        ['星図ブレンド', '520'],
        ['北極星（深煎り）', '560'],
        ['春の大三角', '560'],
        ['シリトル・レイン', '600'],
        ['エスプレッソ', '450'],
        ['カフェラテ', '580'],
        ['はちみつラテ', '640'],
        ['星屑ココア', '560'],
        ['ほうじ茶ラテ', '560'],
        ['カヌレ', '300'],
        ['夜空のガトーショコラ', '520'],
        ['月見プリン（秋）', '480'],
        ['星のトースト', '480'],
      ]
      g.font = `19px ${JP}`
      items.forEach(([n, p], i) => {
        const y = 116 + i * 31
        g.fillStyle = i === 5 ? '#ffd27a' : '#efe8d6'
        g.fillText(n, 30, y)
        g.textAlign = 'right'
        g.fillText(p, w - 30, y)
        g.textAlign = 'left'
      })
      g.fillStyle = '#ffd27a'
      g.font = `bold 20px ${JP}`
      g.fillText('★ カフェラテ＋カヌレ 800', 30, h - 40)
      g.strokeStyle = '#6a4a2a'
      g.lineWidth = 14
      g.strokeRect(0, 0, w, h)
    },
  },
  // 「どうぞ撮ってください」の小さな札
  'photo-ok': {
    w: 220,
    h: 110,
    draw: (g, w, h) => {
      g.fillStyle = '#f4ecd8'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#3a2a18'
      g.textAlign = 'center'
      g.font = `bold 22px ${JPS}`
      g.fillText('どうぞ', w / 2, 44)
      g.font = `18px ${JPS}`
      g.fillText('撮ってください', w / 2, 76)
      g.font = `12px ${JP}`
      g.fillText('ラテアートは毎日ちがう星座です', w / 2, 98)
    },
  },
  // 父ロバートのレンチセット（額の中）
  wrenches: {
    w: 420,
    h: 260,
    draw: (g, w, h) => {
      g.fillStyle = '#2a2a30'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#3c3a40'
      g.fillRect(14, 14, w - 28, h - 28)
      for (let i = 0; i < 8; i++) {
        const x = 40 + i * 46
        const len = 120 + i * 10
        const y0 = (h - len) / 2
        const grad = g.createLinearGradient(x - 8, 0, x + 8, 0)
        grad.addColorStop(0, '#8a8e94')
        grad.addColorStop(0.5, '#e6e8ec')
        grad.addColorStop(1, '#7a7e84')
        g.fillStyle = grad
        g.fillRect(x - 6, y0 + 14, 12, len - 28)
        g.beginPath()
        g.arc(x, y0 + 12, 14, 0, Math.PI * 2)
        g.arc(x, y0 + len - 12, 12, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#3c3a40'
        g.fillRect(x - 5, y0 - 4, 10, 12)
        g.beginPath()
        g.arc(x, y0 + len - 12, 6, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#c9b48a'
      g.font = `italic 15px ${JPS}`
      g.fillText('Robert Thompson — Seattle, 1971', 30, h - 22)
    },
  },
  // マイケルの書斎のホワイトボード（システムの図）
  'arch-board': {
    w: 512,
    h: 340,
    draw: (g, w, h) => {
      g.fillStyle = '#f6f7f5'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#2a3a5a'
      g.lineWidth = 3
      const box = (x: number, y: number, bw: number, bh: number, t: string) => {
        g.strokeRect(x, y, bw, bh)
        g.fillStyle = '#2a3a5a'
        g.font = `15px ${JP}`
        g.fillText(t, x + 8, y + bh / 2 + 5)
      }
      box(30, 40, 110, 50, 'edge relay')
      box(200, 40, 110, 50, 'queue')
      box(370, 40, 110, 50, 'workers ×8')
      box(200, 170, 110, 50, 'store')
      box(30, 250, 160, 50, 'monitor / alert')
      g.beginPath()
      g.moveTo(140, 65)
      g.lineTo(200, 65)
      g.moveTo(310, 65)
      g.lineTo(370, 65)
      g.moveTo(255, 90)
      g.lineTo(255, 170)
      g.moveTo(425, 90)
      g.lineTo(310, 190)
      g.stroke()
      g.strokeStyle = '#c0392b'
      g.beginPath()
      g.arc(425, 260, 34, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = '#c0392b'
      g.font = `bold 16px ${JP}`
      g.fillText('p99 < 40ms', 385, 315)
    },
  },
  // 壁掛けカレンダー
  calendar: {
    w: 240,
    h: 300,
    draw: (g, w, h) => {
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#5a7a9a'
      g.fillRect(0, 0, w, 110)
      g.fillStyle = '#ffffff'
      g.font = `bold 40px ${MONO}`
      g.fillText('10', 18, 70)
      g.font = `16px ${JP}`
      g.fillText('OCTOBER 2026', 90, 66)
      g.fillStyle = '#333'
      g.font = `14px ${MONO}`
      for (let i = 0; i < 31; i++) {
        const c = (i + 4) % 7
        const r = Math.floor((i + 4) / 7)
        g.fillStyle = c === 0 ? '#c0392b' : '#333'
        g.fillText(String(i + 1), 12 + c * 32, 140 + r * 30)
      }
    },
  },
  // 有孔ボード（工具の影の絵）
  pegboard: {
    w: 512,
    h: 256,
    draw: (g, w, h) => {
      g.fillStyle = '#c7a982'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#7a6040'
      for (let x = 8; x < w; x += 16) for (let y = 8; y < h; y += 16) g.fillRect(x - 1.5, y - 1.5, 3, 3)
    },
  },
  // 原稿（印刷した紙と赤字）
  manuscript: {
    w: 220,
    h: 300,
    draw: (g, w, h) => {
      g.fillStyle = '#fbf9f2'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#555'
      for (let i = 0; i < 20; i++) g.fillRect(18, 24 + i * 13, (w - 36) * (0.7 + ((i * 37) % 30) / 100), 4)
      g.strokeStyle = '#c0392b'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(40, 90)
      g.lineTo(150, 95)
      g.moveTo(60, 180)
      g.quadraticCurveTo(120, 160, 170, 190)
      g.stroke()
    },
  },
  // 古い技術誌の表紙
  magazine: {
    w: 220,
    h: 300,
    draw: (g, w, h) => {
      g.fillStyle = '#d64b2a'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#ffffff'
      g.font = `bold 34px ${JP}`
      g.fillText('月刊', 14, 44)
      g.font = `bold 40px ${JP}`
      g.fillText('回路と', 14, 92)
      g.fillText('プログラム', 10, 138)
      g.fillStyle = '#1a1a1a'
      g.fillRect(20, 160, w - 40, 110)
      g.fillStyle = '#5ff0ff'
      g.font = `16px ${MONO}`
      g.fillText('特集: 電波を作る', 28, 200)
      g.fillStyle = '#ffd27a'
      g.fillText('2003 / 11', 28, 250)
    },
  },
  // 桜見町の地図（額）
  'map-town': {
    w: 400,
    h: 300,
    draw: (g, w, h) => {
      g.fillStyle = '#efe6cf'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#9cc0d8'
      g.beginPath()
      g.moveTo(0, h * 0.7)
      g.bezierCurveTo(w * 0.3, h * 0.6, w * 0.6, h * 0.85, w, h * 0.65)
      g.lineTo(w, h)
      g.lineTo(0, h)
      g.fill()
      g.strokeStyle = '#8a6a48'
      g.lineWidth = 1.5
      const r = rng(13)
      for (let i = 0; i < 26; i++) {
        g.beginPath()
        g.moveTo(r() * w, r() * h * 0.65)
        g.lineTo(r() * w, r() * h * 0.65)
        g.stroke()
      }
      g.fillStyle = '#b8402f'
      g.beginPath()
      g.arc(w * 0.62, h * 0.22, 6, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#3a2a18'
      g.font = `14px ${JPS}`
      g.fillText('桜見町', 16, 26)
    },
  },
  // 星図珈琲のショップカード（カウンターの上）
  'seizu-card': {
    w: 240,
    h: 150,
    draw: (g, w, h) => {
      g.fillStyle = '#1d2440'
      g.fillRect(0, 0, w, h)
      stars(g, w, h, 60, 71, '#ffe7a8', 1.2)
      g.fillStyle = '#e8d29a'
      g.textAlign = 'center'
      g.font = `bold 28px ${JPS}`
      g.fillText('星図珈琲', w / 2, 70)
      g.font = `12px ${JP}`
      g.fillText('SEIZU COFFEE  灯町 星見横丁', w / 2, 100)
      g.fillText('11:00 – 22:00  火曜定休', w / 2, 122)
    },
  },
  // 豆の瓶のラベル
  'bean-label': {
    w: 256,
    h: 128,
    draw: (g, w, h) => {
      const names = ['星図', '北極星', '大三角', 'レイン']
      for (let i = 0; i < 4; i++) {
        const x = (i % 2) * (w / 2)
        const y = Math.floor(i / 2) * (h / 2)
        g.fillStyle = '#f2ead6'
        g.fillRect(x + 4, y + 4, w / 2 - 8, h / 2 - 8)
        g.fillStyle = '#3a2618'
        g.textAlign = 'center'
        g.font = `bold 20px ${JPS}`
        g.fillText(names[i], x + w / 4, y + h / 4 + 7)
      }
    },
  },
  // 消えているテレビ（ほとんど黒）
  'tv-off': {
    w: 256,
    h: 144,
    draw: (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h)
      gr.addColorStop(0, '#16181c')
      gr.addColorStop(0.5, '#0b0c0e')
      gr.addColorStop(1, '#141619')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
    },
  },
  // ノートパソコンの画面
  laptop: {
    w: 320,
    h: 200,
    draw: (g, w, h) => {
      g.fillStyle = '#f4f4f2'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#e0e0dc'
      g.fillRect(0, 0, w, 18)
      g.fillStyle = '#333'
      for (let i = 0; i < 12; i++) g.fillRect(20, 34 + i * 13, (w - 40) * (0.6 + ((i * 29) % 40) / 100), 4)
    },
  },
  // 掛け軸（和室の代わりに廊下の小さな書）
  'kanji-scroll': {
    w: 140,
    h: 420,
    draw: (g, w, h) => {
      g.fillStyle = '#e9e2cf'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#1a1a1a'
      g.textAlign = 'center'
      g.font = `bold 64px ${JPS}`
      g.fillText('作', w / 2, 120)
      g.fillText('証', w / 2, 220)
      g.fillStyle = '#b8402f'
      g.fillRect(w / 2 - 10, 300, 20, 20)
    },
  },
  // ---- Café Platform 1872（旧駅の待合室を模した内装。vol2 3-6） ----
  // メニューの黒板（設定のメニューのとおり）
  'cafe-menu': {
    w: 440,
    h: 640,
    draw: (g, w, h) => {
      g.fillStyle = '#1c2420'
      g.fillRect(0, 0, w, h)
      const r = rng(1872)
      // チョークのかすれ
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(255,255,255,${0.012 + r() * 0.02})`
        g.fillRect(r() * w, r() * h, 20 + r() * 80, 1 + r() * 2)
      }
      g.fillStyle = '#f0e6c8'
      g.textAlign = 'center'
      g.font = `italic bold 34px Georgia, ${JPS}`
      g.fillText('Café Platform 1872', w / 2, 58)
      g.font = `14px ${JP}`
      g.fillText('— 本日のおしながき —', w / 2, 84)
      g.textAlign = 'left'
      const sections: [string, [string, string][]][] = [
        ['COFFEE', [['ブレンド「始発」', '480'], ['ブレンド「終電」深煎り', '520'], ['カフェラテ', '560'], ['汽笛ラテ', '620']]],
        ['OTHERS', [['紅茶（ダージリン）', '520'], ['運河ソーダ', '540']]],
        ['SWEETS', [['カヌレ（汐風堂）', '300'], ['1872 プリン', '500'], ['ドームはちみつのパンケーキ', '880']]],
        ['LIGHT MEAL', [['汐見ナポリタン', '980'], ['駅弁風サンド', '750']]],
      ]
      let y = 122
      for (const [title, items] of sections) {
        g.fillStyle = '#e8c070'
        g.font = `bold 15px Georgia, ${JP}`
        g.fillText(title, 28, y)
        g.strokeStyle = 'rgba(232,192,112,0.5)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(28, y + 6)
        g.lineTo(w - 28, y + 6)
        g.stroke()
        y += 30
        g.font = `18px ${JP}`
        for (const [n, pr] of items) {
          g.fillStyle = '#efe8d6'
          g.fillText(n, 36, y)
          g.textAlign = 'right'
          g.fillText(pr, w - 30, y)
          g.textAlign = 'left'
          y += 27
        }
        y += 12
      }
      g.fillStyle = '#ffd27a'
      g.font = `bold 17px ${JP}`
      g.fillText('始発モーニング 7:00〜10:00', 28, h - 46)
      g.font = `14px ${JP}`
      g.fillStyle = '#efe8d6'
      g.fillText('ドリンク代＋150円（トースト・ゆで卵・サラダ）', 28, h - 24)
      g.strokeStyle = '#5a3a20'
      g.lineWidth = 16
      g.strokeRect(0, 0, w, h)
    },
  },
  // 明晴期の汽車の時刻表（額）
  'cafe-timetable': {
    w: 520,
    h: 380,
    draw: (g, w, h) => {
      g.fillStyle = '#e8dcbc'
      g.fillRect(0, 0, w, h)
      const r = rng(5)
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(120,90,40,${r() * 0.06})`
        g.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 6)
      }
      g.strokeStyle = '#3a2a18'
      g.lineWidth = 3
      g.strokeRect(14, 14, w - 28, h - 28)
      g.lineWidth = 1
      g.strokeRect(20, 20, w - 40, h - 40)
      g.fillStyle = '#2a1a0c'
      g.textAlign = 'center'
      g.font = `bold 28px ${JPS}`
      g.fillText('汽車 発車時刻表', w / 2, 62)
      g.font = `15px ${JPS}`
      g.fillText('明晴五年 櫻見停車場', w / 2, 86)
      const cols = ['櫻見 発', '汐見 着', '東都 着']
      const rows = [
        ['午前 八時', '八時二十分', '九時五十三分'],
        ['午前 十時', '十時二十分', '十一時五十三分'],
        ['正午', '十二時二十分', '午後一時五十三分'],
        ['午後 二時', '二時二十分', '三時五十三分'],
        ['午後 四時', '四時二十分', '五時五十三分'],
        ['午後 六時', '六時二十分', '七時五十三分'],
      ]
      const x0 = 40
      const cw = (w - 80) / 3
      g.font = `bold 17px ${JPS}`
      cols.forEach((c, i) => g.fillText(c, x0 + cw * (i + 0.5), 122))
      g.beginPath()
      g.moveTo(x0, 132)
      g.lineTo(w - x0, 132)
      g.stroke()
      g.font = `16px ${JPS}`
      rows.forEach((row, j) => row.forEach((c, i) => g.fillText(c, x0 + cw * (i + 0.5), 160 + j * 32)))
      for (let i = 1; i < 3; i++) {
        g.beginPath()
        g.moveTo(x0 + cw * i, 104)
        g.lineTo(x0 + cw * i, h - 52)
        g.stroke()
      }
      g.font = `13px ${JPS}`
      g.fillText('上等 壱円五拾銭　中等 壱円　下等 五拾銭', w / 2, h - 34)
    },
  },
  // セピアの写真: 初代の桜見停車場（明晴五年）
  'sepia-station': {
    w: 380,
    h: 270,
    draw: (g, w, h) => sepiaPhoto(g, w, h, 11, (q) => {
      // 空・地面
      q.fillStyle = '#d9c6a0'
      q.fillRect(0, 0, w, h * 0.62)
      q.fillStyle = '#9a8460'
      q.fillRect(0, h * 0.62, w, h * 0.38)
      // 木造の駅舎（寄棟・下見板・ベランダの柱）
      q.fillStyle = '#5a4630'
      q.fillRect(w * 0.12, h * 0.36, w * 0.76, h * 0.28)
      q.fillStyle = '#3a2c1c'
      q.beginPath()
      q.moveTo(w * 0.08, h * 0.37)
      q.lineTo(w * 0.24, h * 0.2)
      q.lineTo(w * 0.76, h * 0.2)
      q.lineTo(w * 0.92, h * 0.37)
      q.fill()
      q.fillStyle = '#c8b48c'
      for (let i = 0; i < 9; i++) q.fillRect(w * (0.16 + i * 0.08), h * 0.42, w * 0.035, h * 0.12)
      q.fillStyle = '#2a2016'
      for (let i = 0; i < 12; i++) q.fillRect(w * (0.13 + i * 0.063), h * 0.56, 3, h * 0.09)
      // 人力車と人
      q.fillStyle = '#2a2016'
      for (let i = 0; i < 7; i++) {
        const x = w * (0.18 + i * 0.1) + (i % 2) * 6
        q.fillRect(x, h * 0.66, 5, h * 0.09)
        q.beginPath()
        q.arc(x + 2.5, h * 0.645, 4, 0, Math.PI * 2)
        q.fill()
      }
    }, '櫻見停車場 明晴五年'),
  },
  // セピアの写真: 1 号機関車
  'sepia-steam': {
    w: 380,
    h: 250,
    draw: (g, w, h) => sepiaPhoto(g, w, h, 17, (q) => {
      q.fillStyle = '#d4c09a'
      q.fillRect(0, 0, w, h)
      q.fillStyle = '#a89070'
      q.fillRect(0, h * 0.72, w, h * 0.28)
      // 煙
      for (let i = 0; i < 9; i++) {
        q.fillStyle = `rgba(240,232,214,${0.5 - i * 0.04})`
        q.beginPath()
        q.arc(w * 0.3 + i * 18, h * 0.22 - i * 6, 18 + i * 5, 0, Math.PI * 2)
        q.fill()
      }
      // 機関車（ボイラー・運転室・煙突・動輪）
      q.fillStyle = '#231a12'
      q.fillRect(w * 0.18, h * 0.42, w * 0.42, h * 0.16)
      q.fillRect(w * 0.6, h * 0.3, w * 0.16, h * 0.3)
      q.fillRect(w * 0.24, h * 0.28, w * 0.04, h * 0.15)
      q.fillRect(w * 0.12, h * 0.56, w * 0.7, h * 0.05)
      q.strokeStyle = '#231a12'
      q.lineWidth = 4
      for (const x of [0.28, 0.42, 0.56]) {
        q.beginPath()
        q.arc(w * x, h * 0.65, h * 0.07, 0, Math.PI * 2)
        q.stroke()
      }
      q.fillStyle = '#8a7656'
      q.fillRect(w * 0.63, h * 0.35, w * 0.08, h * 0.08)
      // 線路
      q.fillStyle = '#5a4a34'
      q.fillRect(0, h * 0.73, w, 3)
    }, '一号機関車 櫻見にて'),
  },
  // セピアの写真: 開業の日のホーム
  'sepia-platform': {
    w: 320,
    h: 230,
    draw: (g, w, h) => sepiaPhoto(g, w, h, 23, (q) => {
      q.fillStyle = '#dccaa6'
      q.fillRect(0, 0, w, h)
      // ホームの屋根（斜め）と柱
      q.fillStyle = '#4a3a28'
      q.beginPath()
      q.moveTo(0, h * 0.14)
      q.lineTo(w, h * 0.3)
      q.lineTo(w, h * 0.36)
      q.lineTo(0, h * 0.24)
      q.fill()
      for (let i = 0; i < 6; i++) q.fillRect(w * (0.08 + i * 0.17), h * (0.22 + i * 0.024), 4, h * 0.5)
      // 客車
      q.fillStyle = '#3a2c1e'
      q.fillRect(w * 0.55, h * 0.42, w * 0.45, h * 0.24)
      q.fillStyle = '#c9b48c'
      for (let i = 0; i < 4; i++) q.fillRect(w * (0.58 + i * 0.1), h * 0.46, w * 0.06, h * 0.08)
      // 人（和装・帽子）
      const r = rng(9)
      for (let i = 0; i < 16; i++) {
        const x = r() * w * 0.55 + 8
        const y = h * (0.6 + r() * 0.12)
        q.fillStyle = r() < 0.5 ? '#2a2016' : '#5a4834'
        q.fillRect(x, y, 6, 20)
        q.beginPath()
        q.arc(x + 3, y - 3, 4, 0, Math.PI * 2)
        q.fill()
      }
      q.fillStyle = '#7a6648'
      q.fillRect(0, h * 0.82, w, h * 0.18)
    }, '開業の日 一番列車'),
  },
  // 1872 年当時の駅名標の複製（白い板・黒い字。カウンターの上に吊る）
  ekimeihyo: {
    w: 720,
    h: 220,
    draw: (g, w, h) => {
      g.fillStyle = '#efe9da'
      g.fillRect(0, 0, w, h)
      const r = rng(72)
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(90,70,40,${r() * 0.07})`
        g.fillRect(r() * w, r() * h, 1 + r() * 40, 1 + r() * 2)
      }
      g.strokeStyle = '#1a1a1a'
      g.lineWidth = 8
      g.strokeRect(8, 8, w - 16, h - 16)
      g.fillStyle = '#141414'
      g.textAlign = 'center'
      g.font = `bold 92px ${JPS}`
      g.fillText('櫻 見', w / 2, 112)
      g.font = `bold 34px Georgia, serif`
      g.fillText('S A K U R A M I', w / 2, 160)
      g.font = `20px ${JPS}`
      g.textAlign = 'left'
      g.fillText('← 汐見', 34, h - 26)
      g.textAlign = 'right'
      g.fillText('終着 TERMINUS', w - 34, h - 26)
      g.textAlign = 'center'
      g.font = `16px ${JPS}`
      g.fillText('明晴五年 開業', w / 2, h - 24)
    },
  },
  // 鉄道の旅の古いポスター（汐見の海と灯台）
  'rail-poster': {
    w: 320,
    h: 460,
    draw: (g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.6)
      sky.addColorStop(0, '#e9b97a')
      sky.addColorStop(1, '#f3dcae')
      g.fillStyle = sky
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#2f5d72'
      g.fillRect(0, h * 0.56, w, h * 0.44)
      g.fillStyle = '#e8d7b0'
      g.beginPath()
      g.arc(w * 0.68, h * 0.34, 36, 0, Math.PI * 2)
      g.fill()
      // 岬と灯台
      g.fillStyle = '#3f4f36'
      g.beginPath()
      g.moveTo(0, h * 0.58)
      g.quadraticCurveTo(w * 0.25, h * 0.45, w * 0.42, h * 0.58)
      g.fill()
      g.fillStyle = '#f2ece0'
      g.fillRect(w * 0.18, h * 0.38, 16, 52)
      g.fillStyle = '#b83a2a'
      g.fillRect(w * 0.18 - 2, h * 0.36, 20, 10)
      // 汽車（線路の上を走る）
      g.fillStyle = '#22303a'
      g.fillRect(w * 0.08, h * 0.66, w * 0.84, 4)
      g.fillRect(w * 0.5, h * 0.6, w * 0.3, h * 0.06)
      g.fillRect(w * 0.73, h * 0.56, w * 0.07, h * 0.06)
      g.fillStyle = '#f4ecd8'
      g.textAlign = 'center'
      g.font = `bold 34px ${JPS}`
      g.fillText('汐見の海へ', w / 2, h * 0.8)
      g.font = `18px ${JPS}`
      g.fillText('櫻見より 汽車にて二十分', w / 2, h * 0.86)
      g.font = `bold 15px Georgia, serif`
      g.fillText('HINOMOTO RAILWAY', w / 2, h * 0.93)
    },
  },
  // 駅の掛け時計の文字盤（白・黒い数字・赤い秒の印）
  'clock-face': {
    w: 320,
    h: 320,
    draw: (g, w, h) => {
      const c = w / 2
      g.fillStyle = '#2a2a2a'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#f7f3ea'
      g.beginPath()
      g.arc(c, c, c - 6, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#1a1a1a'
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2
        const r0 = i % 5 === 0 ? c - 34 : c - 22
        g.lineWidth = i % 5 === 0 ? 6 : 2
        g.beginPath()
        g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0)
        g.lineTo(c + Math.sin(a) * (c - 14), c - Math.cos(a) * (c - 14))
        g.stroke()
      }
      g.fillStyle = '#1a1a1a'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = `bold 34px Georgia, serif`
      for (let i = 1; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2
        g.fillText(String(i), c + Math.sin(a) * (c - 62), c - Math.cos(a) * (c - 62))
      }
      g.font = `14px Georgia, serif`
      g.fillText('SAKURAMI 1872', c, c + 52)
      g.textBaseline = 'alphabetic'
    },
  },
  // 機関車の番号板（真鍮の縁と字）
  'number-plate': {
    w: 360,
    h: 140,
    draw: (g, w, h) => {
      g.fillStyle = '#1e1b18'
      g.beginPath()
      g.roundRect(4, 4, w - 8, h - 8, 26)
      g.fill()
      g.strokeStyle = '#c9a046'
      g.lineWidth = 8
      g.beginPath()
      g.roundRect(12, 12, w - 24, h - 24, 20)
      g.stroke()
      g.fillStyle = '#e0bc62'
      g.textAlign = 'center'
      g.font = `bold 72px Georgia, serif`
      g.fillText('1872', w / 2, h / 2 + 24)
    },
  },
  // ショップカード（線路の地図の柄）
  'cafe-card': {
    w: 240,
    h: 150,
    draw: (g, w, h) => {
      g.fillStyle = '#1f4a36'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#e9d49a'
      g.lineWidth = 3
      g.strokeRect(8, 8, w - 16, h - 16)
      g.fillStyle = '#e9d49a'
      g.textAlign = 'center'
      g.font = `italic bold 24px Georgia, serif`
      g.fillText('Café Platform', w / 2, 60)
      g.font = `bold 30px Georgia, serif`
      g.fillText('1872', w / 2, 98)
      g.font = `12px ${JP}`
      g.fillText('停車場通一丁目2番1号 7:00〜22:00', w / 2, 128)
    },
  },
  // 駅舎の中への扉の札
  'concourse-sign': {
    w: 300,
    h: 90,
    draw: (g, w, h) => {
      g.fillStyle = '#1f4a36'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#c9a046'
      g.lineWidth = 4
      g.strokeRect(5, 5, w - 10, h - 10)
      g.fillStyle = '#efe0b0'
      g.textAlign = 'center'
      g.font = `bold 30px ${JPS}`
      g.fillText('駅舎 コンコース', w / 2, 46)
      g.font = `15px Georgia, serif`
      g.fillText('TO STATION CONCOURSE', w / 2, 72)
    },
  },
  // ---- ガーデンドーム ----
  // 喫茶 こもれびの品書き（木の札）
  'komorebi-menu': {
    w: 300,
    h: 400,
    draw: (g, w, h) => {
      g.fillStyle = '#efe4c8'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#2f5a3a'
      g.fillRect(0, 0, w, 70)
      g.fillStyle = '#f4ecd4'
      g.textAlign = 'center'
      g.font = `bold 30px ${JPS}`
      g.fillText('喫茶 こもれび', w / 2, 46)
      g.fillStyle = '#2a2a1e'
      g.textAlign = 'left'
      const items: [string, string][] = [
        ['葉っぱラテ', '600'],
        ['こもれびブレンド', '480'],
        ['森のハーブティー', '520'],
        ['ドームはちみつレモン', '540'],
        ['木の実のタルト', '480'],
        ['葉っぱクッキー', '320'],
      ]
      g.font = `20px ${JP}`
      items.forEach(([n, pr], i) => {
        const y = 112 + i * 42
        g.fillStyle = i === 0 ? '#2f6a3a' : '#2a2a1e'
        g.fillText(n, 22, y)
        g.textAlign = 'right'
        g.fillText(pr, w - 22, y)
        g.textAlign = 'left'
      })
      g.fillStyle = '#5a7a4a'
      g.font = `14px ${JP}`
      g.fillText('9:30〜20:30　幹の回廊 1 層', 22, h - 22)
    },
  },
  // 売店「葉っぱ屋」の看板
  'happaya-sign': {
    w: 480,
    h: 120,
    draw: (g, w, h) => {
      g.fillStyle = '#3f6a3a'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#e8d8a0'
      g.lineWidth = 5
      g.strokeRect(8, 8, w - 16, h - 16)
      g.fillStyle = '#f4ecd0'
      g.textAlign = 'center'
      g.font = `bold 48px ${JPS}`
      g.fillText('葉っぱ屋', w / 2 + 20, 72)
      g.font = `15px ${JP}`
      g.fillText('ドームはちみつ・種・絵はがき', w / 2 + 20, 100)
      // 葉の印
      g.fillStyle = '#9ad06a'
      g.beginPath()
      g.ellipse(70, 60, 30, 16, -0.6, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#3f6a3a'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(48, 78)
      g.lineTo(92, 42)
      g.stroke()
    },
  },
  // 光脈管制室の大きな画面（ドームの葉脈ライティングの全体。制御ソフト「ベイン」）
  'bain-screen': {
    w: 512,
    h: 330,
    draw: (g, w, h) => {
      g.fillStyle = '#06121a'
      g.fillRect(0, 0, w, h)
      const cx = w * 0.42
      const cy = h * 0.82
      const R = h * 0.68
      g.strokeStyle = 'rgba(120,255,190,0.55)'
      g.lineWidth = 1.2
      for (let i = 1; i <= 5; i++) {
        g.beginPath()
        g.ellipse(cx, cy - (R * i) / 6, R * Math.cos(Math.asin(i / 6)), (R * Math.cos(Math.asin(i / 6))) * 0.18, 0, 0, Math.PI * 2)
        g.stroke()
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI
        g.beginPath()
        g.ellipse(cx, cy, Math.abs(Math.cos(a)) * R, R, 0, Math.PI, Math.PI * 2)
        g.stroke()
      }
      const r = rng(31)
      for (let i = 0; i < 260; i++) {
        const a = r() * Math.PI
        const e = r() * 0.95
        const x = cx + Math.cos(a) * Math.cos(e * 1.4) * R * 0.95
        const y = cy - Math.sin(e * 1.4) * R * 0.95
        g.fillStyle = `rgba(${170 + r() * 80},255,${110 + r() * 60},${0.4 + r() * 0.6})`
        g.fillRect(x, y, 2, 2)
      }
      g.fillStyle = '#7dffb0'
      g.font = `bold 20px ${MONO}`
      g.fillText('BAIN  v4.2', 14, 28)
      g.font = `13px ${MONO}`
      g.fillStyle = '#9fe8ff'
      const lines = ['RHYTHM   0.42 Hz', 'CO2      418 ppm', 'HUMID    78 %', 'PAR      612 umol', 'ZONES    S E N W', 'STATUS   BREATHING']
      lines.forEach((l, i) => g.fillText(l, w - 190, 60 + i * 22))
    },
  },
  // 管制室の小さな画面（明滅のリズムの波形・センサーの値）
  'bain-graph': {
    w: 400,
    h: 260,
    draw: (g, w, h) => {
      g.fillStyle = '#081620'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = 'rgba(80,140,160,0.35)'
      for (let i = 0; i < 8; i++) {
        g.beginPath()
        g.moveTo(0, (i / 8) * h)
        g.lineTo(w, (i / 8) * h)
        g.stroke()
      }
      const wave = (col: string, amp: number, f: number, y0: number, ph: number) => {
        g.strokeStyle = col
        g.lineWidth = 2
        g.beginPath()
        for (let x = 0; x <= w; x += 4) {
          const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 2.7 + ph) * amp * 0.25
          if (x === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }
      wave('#7dffb0', 26, 0.03, h * 0.3, 0)
      wave('#9fe8ff', 18, 0.05, h * 0.58, 1.2)
      wave('#ffd27a', 14, 0.02, h * 0.82, 2.4)
      g.fillStyle = '#9fe8ff'
      g.font = `13px ${MONO}`
      g.fillText('LEAF-VEIN LIGHTING / PHOTOSYNTH', 10, 18)
    },
  },
  // 光脈管制室の札
  'bain-sign': {
    w: 360,
    h: 120,
    draw: (g, w, h) => {
      g.fillStyle = '#20262c'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#e8f4f0'
      g.textAlign = 'center'
      g.font = `bold 40px ${JP}`
      g.fillText('光脈管制室', w / 2, 62)
      g.font = `15px ${JP}`
      g.fillStyle = '#7dffb0'
      g.fillText('LEAF-VEIN LIGHTING CONTROL', w / 2, 94)
    },
  },
  // 種の間の札（吹き抜けの口）
  'seed-sign': {
    w: 400,
    h: 160,
    draw: (g, w, h) => {
      g.fillStyle = '#2a3a2e'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#efe6c8'
      g.textAlign = 'center'
      g.font = `bold 52px ${JPS}`
      g.fillText('種の間', w / 2, 76)
      g.font = `16px ${JP}`
      g.fillText('地下 種子保存庫・増殖室（公開ラボ 第一種）', w / 2, 112)
      g.fillText('↓ この階段を下りてください', w / 2, 140)
    },
  },
  // 種の間の説明の札
  'seed-panel': {
    w: 480,
    h: 320,
    draw: (g, w, h) => {
      g.fillStyle = '#f2efe4'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#2a3a2e'
      g.fillRect(0, 0, w, 54)
      g.fillStyle = '#f2efe4'
      g.font = `bold 26px ${JPS}`
      g.fillText('種をあずかる部屋', 18, 37)
      g.fillStyle = '#2a2a24'
      g.font = `16px ${JP}`
      const lines = ['約 2,400 種・6 万株の植物の種を、', 'マイナス 18℃ の保存庫で守っています。', '奥の紫の棚は増殖室。', '絶滅のおそれのある植物の苗を育てています。', '', '— ガラス越しにご覧ください —']
      lines.forEach((l, i) => g.fillText(l, 18, 92 + i * 34))
      const r = rng(9)
      for (let i = 0; i < 6; i++) {
        g.fillStyle = ['#c8a060', '#8a6a3a', '#6a8a4a'][i % 3]
        g.beginPath()
        g.ellipse(w - 70 + (r() - 0.5) * 50, h - 70 + (r() - 0.5) * 40, 8, 5, r() * 3, 0, Math.PI * 2)
        g.fill()
      }
    },
  },
  // 館内案内図（4 層 + 地下の断面と平面）
  'dome-map': {
    w: 520,
    h: 360,
    draw: (g, w, h) => {
      g.fillStyle = '#f2efe4'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#2f4a3e'
      g.font = `bold 24px ${JP}`
      g.fillText('ガーデンドーム 館内案内', 16, 34)
      // 断面
      const cx = 170
      const cy = 300
      g.strokeStyle = '#7a9a8a'
      g.lineWidth = 2
      g.beginPath()
      g.ellipse(cx, cy, 150, 200, 0, Math.PI, Math.PI * 2)
      g.stroke()
      const lv: [string, number, number][] = [
        ['梢のテラス 3 層', 140, 40],
        ['枝の回廊 2 層', 90, 105],
        ['幹の回廊 1 層', 45, 140],
        ['根の階', 0, 150],
      ]
      g.font = `13px ${JP}`
      for (const [n, y, rr] of lv) {
        g.strokeStyle = '#c9a046'
        g.beginPath()
        g.moveTo(cx - rr, cy - y)
        g.lineTo(cx + rr, cy - y)
        g.stroke()
        g.fillStyle = '#2a2a24'
        g.fillText(n, 340, cy - y + 4)
      }
      g.fillStyle = '#5a8a6a'
      g.fillRect(cx - 12, cy - 140, 24, 140)
      g.fillStyle = '#2a2a24'
      g.fillText('種の間（地下）', 340, cy + 26)
      g.strokeStyle = '#c9a046'
      g.beginPath()
      g.moveTo(cx - 40, cy + 22)
      g.lineTo(cx + 40, cy + 22)
      g.stroke()
      g.font = `12px ${JP}`
      g.fillText('南: 熱帯雨林　東: 温帯の森', 16, h - 30)
      g.fillText('北: 雲霧林　西: 海辺の植物', 16, h - 12)
    },
  },

  // ソラノワの料金と営業時間の大きな案内（改札の上に吊る）
  'soranowa-board': {
    w: 720,
    h: 300,
    draw: (g, w, h) => {
      g.fillStyle = '#1f3550'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#e2b62a'
      g.fillRect(0, h - 10, w, 10)
      // 小さなホイールの絵
      const cx = 92
      const cy = 118
      g.strokeStyle = '#f4f4f2'
      g.lineWidth = 4
      g.beginPath()
      g.arc(cx, cy, 62, 0, Math.PI * 2)
      g.stroke()
      g.lineWidth = 1.5
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        g.beginPath()
        g.moveTo(cx, cy)
        g.lineTo(cx + Math.cos(a) * 62, cy + Math.sin(a) * 62)
        g.stroke()
        g.fillStyle = ['#e85a5a', '#5a8ae8', '#e8c45a', '#5ab87a', '#c87ab0'][i % 5]
        g.beginPath()
        g.arc(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70, 5, 0, Math.PI * 2)
        g.fill()
      }
      g.lineWidth = 5
      g.beginPath()
      g.moveTo(cx - 34, cy + 128)
      g.lineTo(cx, cy)
      g.lineTo(cx + 34, cy + 128)
      g.stroke()
      g.fillStyle = '#ffffff'
      g.font = `bold 52px ${JP}`
      g.fillText('大観覧車 ソラノワ', 196, 78)
      g.font = `20px ${JP}`
      g.fillStyle = '#c9d6e4'
      g.fillText('SORANOWA  GIANT WHEEL  ・  直径 100m・ゴンドラ 60基', 198, 110)
      g.fillStyle = '#ffffff'
      g.font = `bold 34px ${JP}`
      g.fillText('一周 約15分', 198, 168)
      g.fillText('900円', 460, 168)
      g.font = `26px ${JP}`
      g.fillText('営業 11:00〜22:00', 198, 216)
      g.font = `18px ${JP}`
      g.fillStyle = '#c9d6e4'
      g.fillText('ゴンドラは止まらずに回っています。係員の案内でご乗車ください', 198, 258)
    },
  },
  // ソラノワの灯りの読み方（外周の光の高さ = 潮位、スポークを流れる光の速さ = 風速。vol2 3-9）
  'soranowa-tide': {
    w: 420,
    h: 540,
    draw: (g, w, h) => {
      g.fillStyle = '#0e1a2c'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#ffffff'
      g.font = `bold 28px ${JP}`
      g.fillText('ソラノワの灯りを読む', 22, 46)
      g.font = `15px ${JP}`
      g.fillStyle = '#9fb4cc'
      g.fillText('HOW TO READ THE LIGHTS', 22, 70)
      const cx = w / 2
      const cy = 236
      const r = 118
      // スポーク（流れる光）
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2
        const grd = g.createLinearGradient(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        grd.addColorStop(0, 'rgba(255,214,150,0.1)')
        grd.addColorStop(0.7, 'rgba(255,214,150,0.9)')
        grd.addColorStop(1, 'rgba(255,214,150,0.3)')
        g.strokeStyle = grd
        g.lineWidth = 1.6
        g.beginPath()
        g.moveTo(cx, cy)
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        g.stroke()
      }
      // 外周: 下から潮位の高さまで光る
      g.lineWidth = 7
      g.strokeStyle = '#3a4a5e'
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.stroke()
      g.strokeStyle = '#fff1d8'
      g.shadowColor = '#ffd890'
      g.shadowBlur = 14
      g.beginPath()
      g.arc(cx, cy, r, Math.PI * 0.18, Math.PI * 0.82, false)
      g.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 1.0, false)
      g.stroke()
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 0.18, false)
      g.stroke()
      g.shadowBlur = 0
      g.setLineDash([5, 5])
      g.strokeStyle = '#7fb0e0'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(cx - r - 26, cy)
      g.lineTo(cx + r + 26, cy)
      g.stroke()
      g.setLineDash([])
      g.fillStyle = '#7fb0e0'
      g.font = `14px ${JP}`
      g.fillText('いまの潮位', cx + r - 40, cy - 8)
      g.fillStyle = '#ffffff'
      g.font = `bold 19px ${JP}`
      g.fillText('外周の光の高さ ＝ 潮位', 22, 400)
      g.fillText('スポークを流れる光の速さ ＝ 風速', 22, 432)
      g.font = `14px ${JP}`
      g.fillStyle = '#c9d6e4'
      g.fillText('満潮の夜は外周がいっぱいまで光ります。', 22, 468)
      g.fillText('地元ではこれを「満ちソラ」と呼びます。', 22, 490)
      g.fillStyle = '#7f94ac'
      g.font = `12px ${JP}`
      g.fillText('データ: 汐見港 潮位観測ラボ・緑光博記念塔の風速計', 22, 522)
    },
  },
  // てっぺんからの眺め（vol2 3-9: 北に桜木丘と天文台、東に町とドーム、西に湾と汐見島）
  'soranowa-view': {
    w: 520,
    h: 340,
    draw: (g, w, h) => {
      g.fillStyle = '#f4f2ec'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#1f3550'
      g.fillRect(0, 0, w, 54)
      g.fillStyle = '#ffffff'
      g.font = `bold 26px ${JP}`
      g.fillText('てっぺんからの眺め', 18, 37)
      g.font = `14px ${JP}`
      g.fillText('地上 107.5m', w - 112, 35)
      const cx = 150
      const cy = 200
      g.strokeStyle = '#1f3550'
      g.lineWidth = 2
      g.beginPath()
      g.arc(cx, cy, 104, 0, Math.PI * 2)
      g.stroke()
      // 方位（北が上）と、見えるもの
      const items: [string, string, number][] = [
        ['北', '桜木丘と天文台・ラボ', -Math.PI / 2],
        ['東', '町とガーデンドーム', 0],
        ['西', '湾と汐見島の灯台', Math.PI],
        ['南', '新汐見の高層街区', Math.PI / 2],
      ]
      g.textAlign = 'center'
      for (const [d, , a] of items) {
        g.fillStyle = '#1f3550'
        g.font = `bold 22px ${JP}`
        g.fillText(d, cx + Math.cos(a) * 82, cy + Math.sin(a) * 82 + 8)
      }
      g.textAlign = 'left'
      // 丘・ドーム・海の小さな絵
      g.fillStyle = '#5f8a4e'
      g.beginPath()
      g.ellipse(cx, cy - 44, 40, 16, 0, Math.PI, Math.PI * 2)
      g.fill()
      g.fillStyle = '#f4f4f2'
      g.beginPath()
      g.arc(cx + 10, cy - 54, 7, Math.PI, Math.PI * 2)
      g.fill()
      g.fillStyle = '#6aa0c8'
      g.beginPath()
      g.ellipse(cx - 48, cy, 22, 44, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#e9e2c6'
      g.beginPath()
      g.arc(cx + 46, cy, 10, Math.PI, Math.PI * 2)
      g.fill()
      g.fillStyle = '#2a2a2a'
      g.font = `16px ${JP}`
      items.forEach(([d, t], i) => g.fillText(`${d}　${t}`, 290, 116 + i * 46))
      g.fillStyle = '#7a7a72'
      g.font = `12px ${JP}`
      g.fillText('晴れた夜は湾の向こうの山並みまで見えます', 290, 304)
    },
  },
  // 改札の上の「のりば」の札
  'soranowa-gate': {
    w: 460,
    h: 120,
    draw: (g, w, h) => {
      g.fillStyle = '#1f3550'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#e2b62a'
      g.fillRect(0, 0, 14, h)
      g.fillStyle = '#ffffff'
      g.font = `bold 52px ${JP}`
      g.fillText('のりば', 40, 72)
      g.font = `bold 60px ${JP}`
      g.fillText('↑', 210, 76)
      g.font = `bold 26px ${JP}`
      g.fillText('BOARDING', 280, 66)
      g.font = `15px ${JP}`
      g.fillStyle = '#c9d6e4'
      g.fillText('ゴンドラは止まらずに回っています', 40, 104)
    },
  },
  // 券売機の画面
  'soranowa-ticket': {
    w: 220,
    h: 170,
    draw: (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#1d4a7a')
      bg.addColorStop(1, '#10284a')
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#ffffff'
      g.font = `bold 18px ${JP}`
      g.fillText('ソラノワ 乗車券', 12, 28)
      g.fillStyle = '#e8eef6'
      g.fillRect(12, 44, w - 24, 46)
      g.fillStyle = '#1f3550'
      g.font = `bold 24px ${JP}`
      g.fillText('900円', 22, 77)
      g.font = `14px ${JP}`
      g.fillText('1名', w - 54, 75)
      g.fillStyle = '#e2b62a'
      g.fillRect(12, 104, (w - 30) / 2, 50)
      g.fillStyle = '#5ab87a'
      g.fillRect(18 + (w - 30) / 2, 104, (w - 30) / 2, 50)
      g.fillStyle = '#1e1e1e'
      g.font = `bold 15px ${JP}`
      g.fillText('現金', 30, 135)
      g.fillStyle = '#ffffff'
      g.fillText('IC・QR', 34 + (w - 30) / 2, 135)
    },
  },
  // 「満ちソラ」のポスター（夜のホイール）
  'soranowa-poster': {
    w: 320,
    h: 450,
    draw: (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#0a1430')
      bg.addColorStop(0.62, '#1c2a56')
      bg.addColorStop(1, '#0a1020')
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)
      stars(g, w, h * 0.5, 90, 31, '#ffffff', 1.2)
      const cx = w / 2
      const cy = 200
      const r = 110
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2
        g.strokeStyle = `rgba(255,220,160,${0.35 + 0.4 * ((i % 4) / 4)})`
        g.lineWidth = 1.2
        g.beginPath()
        g.moveTo(cx, cy)
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        g.stroke()
      }
      g.strokeStyle = '#fff3dc'
      g.shadowColor = '#ffd890'
      g.shadowBlur = 18
      g.lineWidth = 5
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.stroke()
      g.shadowBlur = 0
      // 海に映る光
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(255,214,150,${0.5 - i * 0.017})`
        g.fillRect(cx - 40 + Math.sin(i * 1.7) * 18, 340 + i * 3.6, 80 - i * 2.2, 1.6)
      }
      g.fillStyle = '#ffffff'
      g.textAlign = 'center'
      g.font = `bold 38px ${JPS}`
      g.fillText('満ちソラの夜に', cx, 50)
      g.font = `14px ${JP}`
      g.fillStyle = '#c9d6e4'
      g.fillText('満潮の夜、外周がいっぱいまで光ります', cx, 80)
      g.font = `13px ${JP}`
      g.fillText('2011年 汐灯祭の夜に初点灯  ・  大観覧車ソラノワ', cx, h - 18)
      g.textAlign = 'left'
    },
  },
  // 丘ノ上ケーブルの駅（interior/briefs/cable.ts）: 駅名標（白い板に大きなひらがな・漢字・ローマ字・となりの駅）
  'cable-name-summit': {
    w: 480,
    h: 150,
    draw: (g, w, h) => cableName(g, w, h, 'ちょうじょう', '頂上', 'CHŌJŌ', 'かえでざか', null),
  },
  'cable-name-fumoto': {
    w: 480,
    h: 150,
    draw: (g, w, h) => cableName(g, w, h, 'ふもと', '麓', 'FUMOTO', 'かえでざか', null),
  },
  // 時刻表（6:00〜23:30 の 10 分ごと。各駅の発車は同じ分。楓坂駅は 2 分あと）
  'cable-timetable': {
    w: 360,
    h: 420,
    draw: (g, w, h) => {
      g.fillStyle = '#f8f6ee'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#2f6b3a'
      g.fillRect(0, 0, w, 54)
      g.fillStyle = '#ffffff'
      g.font = `bold 26px ${JP}`
      g.fillText('丘ノ上ケーブル 時刻表', 18, 36)
      g.fillStyle = '#b71c1c'
      g.fillRect(0, 54, w, 4)
      g.fillStyle = '#1f2a24'
      g.font = `15px ${JP}`
      g.fillText('頂上駅・麓駅 発（毎時 00・10・20・30・40・50 分）', 14, 80)
      g.font = `bold 15px ${MONO}`
      const rows = 18
      const rh = (h - 120) / rows
      for (let i = 0; i < rows; i++) {
        const hr = 6 + i
        const y = 104 + i * rh
        if (i % 2 === 0) {
          g.fillStyle = '#ebe6d6'
          g.fillRect(8, y - rh + 5, w - 16, rh)
        }
        g.fillStyle = '#b71c1c'
        g.fillText(String(hr).padStart(2, ' '), 18, y)
        g.fillStyle = '#1f2a24'
        const mins = hr === 23 ? ['00', '10', '20', '30'] : ['00', '10', '20', '30', '40', '50']
        g.fillText(mins.join('  '), 64, y)
      }
      g.font = `13px ${JP}`
      g.fillStyle = '#4a5450'
      g.fillText('楓坂駅は約 2 分あと・所要 約 4 分・片道 150 円', 14, h - 10)
    },
  },
  // 路線の案内（3 駅・所要時間・運賃・ひらきパス）
  'cable-guide': {
    w: 520,
    h: 200,
    draw: (g, w, h) => {
      g.fillStyle = '#f8f6ee'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#2f6b3a'
      g.lineWidth = 6
      g.strokeRect(3, 3, w - 6, h - 6)
      g.fillStyle = '#1f2a24'
      g.font = `bold 24px ${JP}`
      g.fillText('丘ノ上ケーブル 路線のご案内', 20, 38)
      const y = 104
      g.strokeStyle = '#b71c1c'
      g.lineWidth = 8
      g.beginPath()
      g.moveTo(70, y)
      g.lineTo(w - 70, y)
      g.stroke()
      const st: [number, string, string][] = [
        [70, '麓駅', 'まるの森北'],
        [w / 2, '楓坂駅', '楓坂四丁目'],
        [w - 70, '頂上駅', '天文台前'],
      ]
      for (const [x, n, sub] of st) {
        g.fillStyle = '#ffffff'
        g.strokeStyle = '#2f6b3a'
        g.lineWidth = 5
        g.beginPath()
        g.arc(x, y, 13, 0, Math.PI * 2)
        g.fill()
        g.stroke()
        g.fillStyle = '#1f2a24'
        g.font = `bold 22px ${JP}`
        g.textAlign = 'center'
        g.fillText(n, x, y + 44)
        g.font = `14px ${JP}`
        g.fillText(sub, x, y + 64)
        g.textAlign = 'left'
      }
      g.font = `15px ${JP}`
      g.fillStyle = '#4a5450'
      g.fillText('全長 860m・高低差 102m・最大勾配 320‰・10 分ごと・約 4 分', 20, h - 14)
      g.font = `bold 15px ${JP}`
      g.fillStyle = '#2f6b3a'
      g.fillText('ひらきパス ご利用いただけます', 300, 38 + 22)
    },
  },
  // のりばの札
  'cable-gate': {
    w: 300,
    h: 90,
    draw: (g, w, h) => {
      g.fillStyle = '#2f6b3a'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#b71c1c'
      g.fillRect(0, h - 8, w, 8)
      g.fillStyle = '#ffffff'
      g.font = `bold 40px ${JP}`
      g.fillText('のりば', 24, 56)
      g.font = `bold 44px ${JP}`
      g.fillText('→', 170, 58)
      g.font = `bold 16px ${JP}`
      g.fillText('CABLE CAR', 200, 78)
    },
  },
}

/**
 * 1 棟の中の絵のアトラス（2048²。棚詰め）。中を作るときに作って InteriorBuilder に渡し、中を片付けるときに dispose で捨てる。
 * 前はモジュールに 1 枚だけ置いて「中を作っている建物が 0 のとき」にだけ空けていたので、旅程で建物の作る範囲が続いて重なると、
 * 通った建物の絵が積もってあふれ、あとの絵（カフェの番号板・時計・ポスターなど）が欠けた（#15）。
 * canvas は CPU で描く物（willReadFrequently）にする: 町が重くなってから新しく作った GPU の canvas に絵を描くと、Chrome では描いた物も下塗りも
 * 消えて透明な黒のままになることがあった（旅程でカフェに着くと絵がみな黒い板になった）。GPU の canvas は、読み返すと途中から CPU に切り替わる
 * こともあり、建物を回る順で描き方（縁のなめらかさ）が変わる。CPU の canvas なら、どの順で回っても同じ画素になる。
 * DOM が無いとき（bun）は canvas を作らず、絵の場所（uv）だけを決める
 */
export class PictureAtlas {
  readonly canvas: HTMLCanvasElement | null
  readonly tex: THREE.Texture
  private ctx: CanvasRenderingContext2D | null
  private regions = new Map<PictureKey, Region>()
  private shelfX = 0
  private shelfY = 0
  private shelfH = 0
  private dirty = false

  constructor() {
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
    if (this.canvas) {
      this.canvas.width = SIZE
      this.canvas.height = SIZE
    }
    this.ctx = this.canvas?.getContext('2d', { willReadFrequently: true }) ?? null
    if (this.ctx) {
      this.ctx.fillStyle = '#808080'
      this.ctx.fillRect(0, 0, SIZE, SIZE)
    }
    this.tex = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.Texture()
    this.tex.colorSpace = THREE.SRGBColorSpace
    this.tex.anisotropy = 8
    this.tex.generateMipmaps = true
    this.tex.minFilter = THREE.LinearMipmapLinearFilter
  }

  /** 描いた絵の数 */
  get count() {
    return this.regions.size
  }

  /** 棚の使った高さ（px。2048 を超えたらあふれている） */
  get height() {
    return this.shelfY + this.shelfH
  }

  /** 絵の uv の範囲（u0, v0, u1, v1。v は下が 0） */
  region(key: PictureKey): [number, number, number, number] {
    let r = this.regions.get(key)
    if (!r) {
      const d = DRAW[key]
      const pad = 4
      if (this.shelfX + d.w + pad > SIZE) {
        this.shelfX = 0
        this.shelfY += this.shelfH + pad
        this.shelfH = 0
      }
      if (this.shelfY + d.h > SIZE) console.warn(`[interior] 絵のアトラスがいっぱいです（${key}）`)
      r = { x: this.shelfX, y: this.shelfY, w: d.w, h: d.h }
      this.shelfX += d.w + pad
      this.shelfH = Math.max(this.shelfH, d.h)
      this.regions.set(key, r)
      const g = this.ctx
      if (g) {
        g.save()
        g.translate(r.x, r.y)
        g.beginPath()
        g.rect(0, 0, r.w, r.h)
        g.clip()
        d.draw(g, r.w, r.h)
        g.restore()
        this.dirty = true
      }
    }
    const inset = 0.5
    return [(r.x + inset) / SIZE, 1 - (r.y + r.h - inset) / SIZE, (r.x + r.w - inset) / SIZE, 1 - (r.y + inset) / SIZE]
  }

  /** 描いた絵を GPU へ送る（新しく描いたときだけ） */
  flush() {
    if (!this.dirty) return
    this.dirty = false
    this.tex.needsUpdate = true
  }

  /** 捨てる（中を片付けるとき）。GPU のテクスチャを放し、canvas の画素も手放す。このあとは使わない */
  dispose() {
    this.tex.dispose()
    this.regions.clear()
    this.ctx = null
    this.dirty = false
    if (this.canvas) {
      this.canvas.width = 0
      this.canvas.height = 0
    }
  }
}
