import { overlaps, type Box, type MapLine, type MapModel, type RoadClass } from './mapData'

/**
 * 町の地図（#1）を 2D の canvas に描く（ミニマップの下絵と、全体の地図の下絵・印）。北が上。描く物は ./mapData の MapModel。
 * 見える広さの外の物は囲みで外し、同じ見た目の線はまとめて 1 回で描く。DOM は canvas の 2D の口だけを使う（テストは bun で、描く口の数を数える）。
 */

/** 描く所: 中心（町の平面座標 m）・縮尺（canvas の px / m）・canvas の大きさ（px）・CSS の 1px が canvas の何 px か（dpr） */
export interface MapView {
  cx: number
  cy: number
  scale: number
  width: number
  height: number
  px: number
}

/** 町の平面座標 → canvas の px */
export const toScreenX = (v: MapView, x: number) => (x - v.cx) * v.scale + v.width / 2
export const toScreenY = (v: MapView, y: number) => (v.cy - y) * v.scale + v.height / 2
/** canvas の px → 町の平面座標 */
export const toPlaneX = (v: MapView, sx: number) => (sx - v.width / 2) / v.scale + v.cx
export const toPlaneY = (v: MapView, sy: number) => v.cy - (sy - v.height / 2) / v.scale

/** 見えている広さ（町の平面座標） */
export function viewBox(v: MapView): Box {
  const hw = v.width / 2 / v.scale
  const hh = v.height / 2 / v.scale
  return { xmin: v.cx - hw, xmax: v.cx + hw, ymin: v.cy - hh, ymax: v.cy + hh }
}

/** 色（アプリの暗い画面に合わせる） */
export const MAP_COLORS = {
  background: '#101a26',
  water: '#1d4a6c',
  plaza: '#263444',
  building: '#3a4b5f',
  buildingEdge: '#62778e',
  mark: 'rgba(111, 230, 255, 0.4)',
  markEdge: '#6fe6ff',
  rail: '#cdb98d',
  railCasing: '#2a2418',
  cable: '#ff8a72',
  label: '#e4f3fa',
  halo: 'rgba(6, 10, 18, 0.9)',
  dest: '#ffd36f',
  destSelected: '#6fe6ff',
} as const

/** 道の見た目（描く順。後ろほど上）: 色と、細いときの最小の太さ（CSS px）と、これより細くなるなら描かない太さ（CSS px） */
const ROAD_STYLE: Record<RoadClass, { color: string; min: number; hide: number }> = {
  private: { color: '#3d4a57', min: 0.5, hide: 0.35 },
  alley: { color: '#566678', min: 0.6, hide: 0.25 },
  path: { color: '#7d8c70', min: 0.7, hide: 0.2 },
  local: { color: '#7a8ca0', min: 0.9, hide: 0.12 },
  major: { color: '#a3b5c8', min: 1.4, hide: 0 },
  bridge: { color: '#b9c9da', min: 1.2, hide: 0 },
  stairs: { color: '#d2bf8e', min: 1.2, hide: 0.15 },
}
const ROAD_ORDER = Object.keys(ROAD_STYLE) as RoadClass[]

/** 地面の画の濃さ */
const GROUND_ALPHA = 0.6

/** 下に敷く画（町の地面の画。extent は画の広さ（町の平面座標）、画の 1 行目が北の端） */
export interface GroundLayer {
  image: CanvasImageSource & { width: number; height: number }
  extent: Box
}

export interface BaseOptions {
  /** 強く描く路線（乗っている緑電の系統・ケーブル） */
  highlight: { tram: number | null; cable: boolean }
  /** 印を付ける建物（中にいるラボ・建物の id） */
  mark: string | null
  /** 下に敷く地面の画（敷かなければ空） */
  ground?: readonly GroundLayer[]
}

/** 下絵を描く: 背景・(地面の画)・水・広場・道・線路・建物・路線・印を付ける建物 */
export function drawBase(ctx: CanvasRenderingContext2D, m: MapModel, v: MapView, o: BaseOptions) {
  const box = viewBox(v)
  ctx.save()
  ctx.fillStyle = MAP_COLORS.background
  ctx.fillRect(0, 0, v.width, v.height)
  // 地面の画は薄く（上の線が読めるよう、暗い背景を透かす）
  ctx.globalAlpha = GROUND_ALPHA
  for (const g of o.ground ?? []) drawGround(ctx, g, v, box)
  ctx.globalAlpha = 1
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // 水（三角をまとめて 1 回で塗る）と小川
  if (overlaps(m.water.box, box)) {
    const t = m.water.tris
    ctx.beginPath()
    for (let i = 0; i + 5 < t.length; i += 6) {
      const ax = t[i]!
      const ay = t[i + 1]!
      const bx = t[i + 2]!
      const by = t[i + 3]!
      const cx = t[i + 4]!
      const cy = t[i + 5]!
      if (Math.max(ax, bx, cx) < box.xmin || Math.min(ax, bx, cx) > box.xmax || Math.max(ay, by, cy) < box.ymin || Math.min(ay, by, cy) > box.ymax) continue
      ctx.moveTo(toScreenX(v, ax), toScreenY(v, ay))
      ctx.lineTo(toScreenX(v, bx), toScreenY(v, by))
      ctx.lineTo(toScreenX(v, cx), toScreenY(v, cy))
      ctx.closePath()
    }
    ctx.fillStyle = MAP_COLORS.water
    ctx.fill()
    // 三角のすき間（細い線）が見えないように、同じ色で縁も塗る
    ctx.strokeStyle = MAP_COLORS.water
    ctx.lineWidth = Math.max(0.6 * v.px, 1)
    ctx.stroke()
  }
  strokeLines(ctx, v, box, m.streams, MAP_COLORS.water, 1)

  // 広場
  ctx.fillStyle = MAP_COLORS.plaza
  ctx.beginPath()
  for (const a of m.plazas) if (overlaps(a.box, box)) ring(ctx, v, a.ring)
  ctx.fill()

  // 道（種類・幅ごとにまとめる）
  const groups = new Map<string, { cls: RoadClass; width: number; lines: MapLine[] }>()
  for (const r of m.roads) {
    if (!overlaps(r.box, box, r.width)) continue
    const key = `${r.cls}|${r.width}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { cls: r.cls, width: r.width, lines: [] }))
    g.lines.push(r)
  }
  const sorted = [...groups.values()].sort((a, b) => ROAD_ORDER.indexOf(a.cls) - ROAD_ORDER.indexOf(b.cls) || a.width - b.width)
  for (const g of sorted) {
    const st = ROAD_STYLE[g.cls]
    const w = g.width * v.scale
    if (w < st.hide * v.px) continue
    strokeLines(ctx, v, box, g.lines, st.color, Math.max(w, st.min * v.px) / v.px, false)
  }

  // 線路（ふちを暗くして道と分ける。トンネルは点線）
  const open = m.rails.filter((r) => !r.tunnel)
  const tunnel = m.rails.filter((r) => r.tunnel)
  strokeLines(ctx, v, box, open, MAP_COLORS.railCasing, (railWidth(v) + 1.6 * v.px) / v.px)
  strokeLines(ctx, v, box, open, MAP_COLORS.rail, railWidth(v) / v.px)
  ctx.setLineDash([4 * v.px, 4 * v.px])
  strokeLines(ctx, v, box, tunnel, MAP_COLORS.rail, 1.2)
  ctx.setLineDash([])

  // 名前のある建物
  ctx.beginPath()
  for (const b of m.buildings) if (overlaps(b.box, box)) ring(ctx, v, b.ring)
  ctx.fillStyle = MAP_COLORS.building
  ctx.fill()
  ctx.strokeStyle = MAP_COLORS.buildingEdge
  ctx.lineWidth = 0.8 * v.px
  ctx.stroke()

  // 路線: 緑電の系統（薄く）とケーブル。乗っている系統・ケーブルは太く濃く
  for (const t of m.trams) {
    const on = o.highlight.tram === t.no
    if (on) continue
    ctx.globalAlpha = 0.4
    strokeLines(ctx, v, box, [t], t.color, 1.2)
    ctx.globalAlpha = 1
  }
  if (m.cable) {
    if (o.highlight.cable) strokeLines(ctx, v, box, [m.cable], MAP_COLORS.halo, 8)
    strokeLines(ctx, v, box, [m.cable], MAP_COLORS.cable, o.highlight.cable ? 5 : 1.8)
  }
  const ridden = o.highlight.tram === null ? undefined : m.trams.find((t) => t.no === o.highlight.tram)
  if (ridden) {
    strokeLines(ctx, v, box, [ridden], MAP_COLORS.halo, 8)
    strokeLines(ctx, v, box, [ridden], ridden.color, 5)
  }

  // 中にいる建物の印
  const marked = o.mark ? m.buildings.find((b) => b.id === o.mark) : undefined
  if (marked) {
    ctx.beginPath()
    ring(ctx, v, marked.ring)
    ctx.fillStyle = MAP_COLORS.mark
    ctx.fill()
    ctx.strokeStyle = MAP_COLORS.markEdge
    ctx.lineWidth = 2.2 * v.px
    ctx.stroke()
    // 小さく描かれる建物（ラボは 17m ほど）でも分かるよう、まわりに輪（真ん中の矢印に隠れない大きさ）
    const r = Math.max(Math.hypot(marked.box.xmax - marked.box.xmin, marked.box.ymax - marked.box.ymin) * 0.5 * v.scale + 4 * v.px, 17 * v.px)
    ctx.beginPath()
    ctx.arc(toScreenX(v, marked.cx), toScreenY(v, marked.cy), r, 0, Math.PI * 2)
    ctx.setLineDash([4 * v.px, 3 * v.px])
    ctx.lineWidth = 1.6 * v.px
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
}

/** 線路の太さ（canvas の px。複線の幅 9m ほどで、細くても 2 CSS px） */
const railWidth = (v: MapView) => Math.max(9 * v.scale * 0.6, 2 * v.px)

/** 線を同じ色・太さ（CSS px）でまとめて描く。囲みで外す（pad = 太さ分） */
function strokeLines(ctx: CanvasRenderingContext2D, v: MapView, box: Box, lines: readonly MapLine[], color: string, cssWidth: number, cull = true) {
  ctx.beginPath()
  let any = false
  for (const l of lines) {
    if (cull && !overlaps(l.box, box, l.width)) continue
    const p = l.pts
    ctx.moveTo(toScreenX(v, p[0]!), toScreenY(v, p[1]!))
    for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(toScreenX(v, p[i]!), toScreenY(v, p[i + 1]!))
    any = true
  }
  if (!any) return
  ctx.strokeStyle = color
  ctx.lineWidth = cssWidth * v.px
  ctx.stroke()
}

function ring(ctx: CanvasRenderingContext2D, v: MapView, r: Float64Array) {
  ctx.moveTo(toScreenX(v, r[0]!), toScreenY(v, r[1]!))
  for (let i = 2; i + 1 < r.length; i += 2) ctx.lineTo(toScreenX(v, r[i]!), toScreenY(v, r[i + 1]!))
  ctx.closePath()
}

/** 地面の画の、見えている所だけを写す */
function drawGround(ctx: CanvasRenderingContext2D, g: GroundLayer, v: MapView, box: Box) {
  const e = g.extent
  const x0 = Math.max(box.xmin, e.xmin)
  const x1 = Math.min(box.xmax, e.xmax)
  const y0 = Math.max(box.ymin, e.ymin)
  const y1 = Math.min(box.ymax, e.ymax)
  if (x1 <= x0 || y1 <= y0) return
  const kx = g.image.width / (e.xmax - e.xmin)
  const ky = g.image.height / (e.ymax - e.ymin)
  ctx.drawImage(g.image, (x0 - e.xmin) * kx, (e.ymax - y1) * ky, (x1 - x0) * kx, (y1 - y0) * ky, toScreenX(v, x0), toScreenY(v, y1), (x1 - x0) * v.scale, (y1 - y0) * v.scale)
}

/* -------------------------------------------------------------------------- */
/* 名前と印                                                                      */
/* -------------------------------------------------------------------------- */

/** 地図に出す行き先（町の平面座標と短い名前） */
export interface MapPin {
  id: string
  label: string
  x: number
  y: number
}

/** 描いた名前の囲み（重なる名前を出さないため） */
type Rect = [number, number, number, number]
const hits = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

/**
 * 行き先の点と名前（並びの前ほど先に描き、前の名前に重なる名前は出さない。点はどれも描く）。selected は色を変え、名前を必ず出す。
 * 描いた名前の数を返す
 */
export function drawPins(ctx: CanvasRenderingContext2D, v: MapView, pins: readonly MapPin[], o: { selected?: string | null; font?: number; labels?: boolean; taken?: Rect[] } = {}): number {
  const px = v.px
  const size = (o.font ?? 11) * px
  const taken: Rect[] = o.taken ?? []
  const pad = 2 * px
  const box = viewBox(v)
  const order = o.selected ? [...pins.filter((p) => p.id === o.selected), ...pins.filter((p) => p.id !== o.selected)] : pins
  ctx.save()
  ctx.font = `600 ${size}px system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', 'Noto Sans CJK JP', sans-serif`
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  let drawn = 0
  // 点（選んだ物は最後に上へ）
  for (const p of [...order].reverse()) {
    if (p.x < box.xmin || p.x > box.xmax || p.y < box.ymin || p.y > box.ymax) continue
    const sel = p.id === o.selected
    const sx = toScreenX(v, p.x)
    const sy = toScreenY(v, p.y)
    ctx.beginPath()
    ctx.arc(sx, sy, (sel ? 5.5 : 3.6) * px, 0, Math.PI * 2)
    ctx.fillStyle = sel ? MAP_COLORS.destSelected : MAP_COLORS.dest
    ctx.fill()
    ctx.lineWidth = 1.4 * px
    ctx.strokeStyle = MAP_COLORS.halo
    ctx.stroke()
  }
  if (o.labels === false) {
    ctx.restore()
    return 0
  }
  for (const p of order) {
    if (p.x < box.xmin || p.x > box.xmax || p.y < box.ymin || p.y > box.ymax) continue
    const sel = p.id === o.selected
    const sx = toScreenX(v, p.x) + 7 * px
    const sy = toScreenY(v, p.y)
    const w = ctx.measureText(p.label).width
    const r: Rect = [sx - pad, sy - size / 2 - pad, sx + w + pad, sy + size / 2 + pad]
    if (!sel && (r[2] > v.width || r[0] < 0 || r[1] < 0 || r[3] > v.height || taken.some((t) => hits(t, r)))) continue
    taken.push(r)
    ctx.lineWidth = 3 * px
    ctx.strokeStyle = MAP_COLORS.halo
    ctx.strokeText(p.label, sx, sy)
    ctx.fillStyle = sel ? MAP_COLORS.destSelected : MAP_COLORS.label
    ctx.fillText(p.label, sx, sy)
    drawn++
  }
  ctx.restore()
  return drawn
}

/** 歩く人の印（全体の地図）: 向き付きの矢印（deg = 時計回りの度。0 = 北）か、乗り物の印（字 1 つ） */
export function drawWalker(ctx: CanvasRenderingContext2D, v: MapView, x: number, y: number, deg: number, vehicle: string | null) {
  const px = v.px
  const sx = toScreenX(v, x)
  const sy = toScreenY(v, y)
  ctx.save()
  ctx.translate(sx, sy)
  // 今いる所の輪
  ctx.beginPath()
  ctx.arc(0, 0, 16 * px, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(111, 230, 255, 0.18)'
  ctx.fill()
  ctx.lineWidth = 1.5 * px
  ctx.strokeStyle = 'rgba(111, 230, 255, 0.7)'
  ctx.stroke()
  if (vehicle) {
    ctx.beginPath()
    ctx.arc(0, 0, 10 * px, 0, Math.PI * 2)
    ctx.fillStyle = '#6fe6ff'
    ctx.fill()
    ctx.lineWidth = 2 * px
    ctx.strokeStyle = MAP_COLORS.halo
    ctx.stroke()
    ctx.fillStyle = '#04111c'
    ctx.font = `700 ${12 * px}px system-ui, 'Noto Sans JP', 'Noto Sans CJK JP', sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(vehicle, 0, 0.5 * px)
  } else {
    ctx.rotate((deg * Math.PI) / 180)
    ctx.beginPath()
    ctx.moveTo(0, -11 * px)
    ctx.lineTo(7.5 * px, 8 * px)
    ctx.lineTo(0, 4 * px)
    ctx.lineTo(-7.5 * px, 8 * px)
    ctx.closePath()
    ctx.fillStyle = '#6fe6ff'
    ctx.fill()
    ctx.lineWidth = 2 * px
    ctx.strokeStyle = MAP_COLORS.halo
    ctx.stroke()
  }
  ctx.restore()
}
