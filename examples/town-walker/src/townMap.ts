import { INTERIOR_ZONES, TOWN_DATA, type InteriorZoneId } from 'sakurami-cho/core'
import { hoverStatus } from 'sakurami-cho/character'
import { onTownStatus, townState, walker } from './town'
import { DESTINATION_GROUPS, reachable } from './travel'
import { arrowDegrees, buildMapModel, needsRecenter, shortLabel, type InfraJson, type MapModel, type NamedJson, type WalkJson } from './mapData'
import { drawBase, drawPins, type BaseOptions, type GroundLayer, type MapPin, type MapView } from './mapDraw'

/**
 * 町の地図（#1）: 右下（スマホの幅では右上）の小さい地図（ミニマップ）と、それを押すと開く全体の地図（ui/MiniMap.tsx・ui/TownMap.tsx）の動く所。
 *
 * - 材料: 町の地図データの状態が ready になってから（町を組み立て終えてから）、アセットの根の town/ の walk.json・infra.json・named.json を読み
 *   （地図のパッケージが読んだのと同じファイル。ブラウザのキャッシュから届く）、./mapData で描く形にする。地図データが無い・形の版が合わない・
 *   読めない（町の状態 missing・outdated・error）ときは読まず、ミニマップに出せない理由を出す（アプリは止めない）
 * - 北が上で固定（全体の地図と向きをそろえる）。歩く人は真ん中の向き付きの矢印。乗り物に乗っている間は、乗り物の位置（乗っている人の位置）を
 *   真ん中にして、矢印を乗り物の印（字 1 つ）に替え、ケーブル・緑電は乗っている路線の線を強く描く
 * - ラボ・中のある建物の中では、町の地図の上でその建物に印を付ける（中の間取りは出さない）
 * - ホバー（#9）: 置いてある・呼ばれて来る所に「ホ」の印を出す（ミニマップは窓の外なら縁に寄せる。乗っている間は真ん中の印が「ホ」）。
 *   ワープしても、ホバーは置いた所のまま（印もそこ）
 * - 下に町の地面の画を薄く敷く（下の「地面の画」。敷く・敷かないを見比べて決めた）
 * - ミニマップは半径 MINIMAP_RADIUS m。下絵（その 2 倍の広さ）を描いておき、毎コマは下絵を CSS でずらし、矢印を回すだけ。歩く人が下絵の
 *   中心から離れた・印や強く描く路線・大きさが変わったときだけ描き直す（./mapData の needsRecenter）。毎コマの段は scene/Scene.tsx の MapFrame
 * - 全体の地図は画面いっぱいの重ね（開いている間は、WASD・スペースキーで歩く人を動かさない。scene/Controls.tsx）
 */

/** ミニマップの半径（m） */
export const MINIMAP_RADIUS = 150

/** 乗り物の印（字 1 つ。乗り物の種類の id → 字） */
const VEHICLE_GLYPH: Record<string, string> = { soranowa: '観', cable: 'ケ', tram: '電', waterbus: '船', hover: 'ホ' }

/** 地図の材料の様子: wait = 町の準備を待っている・loading = 読んでいる・ready・unavailable = 町の地図データが無い・error = 読めなかった */
export type MapDataStatus = 'wait' | 'loading' | 'ready' | 'unavailable' | 'error'

/** 歩く人のいる所の様子（変わったときだけ替える） */
export interface MapWhere {
  /** ミニマップの下の字（ラボの中・町の中・緑電 1 系統に乗っている など） */
  caption: string
  /** 乗り物に乗っている間の印（字 1 つ。乗っていなければ null = 矢印） */
  vehicle: string | null
  /** 印を付ける建物（named.json の id。中にいなければ null） */
  mark: string | null
  /** 強く描く路線（乗っている緑電の系統・ケーブル） */
  tram: number | null
  cable: boolean
}

export interface MapUi {
  data: MapDataStatus
  message: string | null
  /** 全体の地図を開いているか */
  open: boolean
  where: MapWhere
}

const NO_WHERE: MapWhere = { caption: '', vehicle: null, mark: null, tram: null, cable: false }
let ui: MapUi = { data: 'wait', message: null, open: false, where: NO_WHERE }
const listeners = new Set<() => void>()

function set(patch: Partial<MapUi>) {
  ui = { ...ui, ...patch }
  for (const fn of listeners) fn()
}

/** 今の様子（useSyncExternalStore の getSnapshot） */
export function mapUi(): MapUi {
  return ui
}

/** 様子が変わったら呼ぶ（やめる関数を返す） */
export function subscribeMap(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 全体の地図を開く・閉じる（材料が無ければ開かない） */
export function openMap(open: boolean) {
  if (open && ui.data !== 'ready') return
  if (open !== ui.open) set({ open })
}

/* -------------------------------------------------------------------------- */
/* 材料を読む                                                                    */
/* -------------------------------------------------------------------------- */

let model: MapModel | null = null

/** 描く形（読み終えるまで null） */
export function mapModel(): MapModel | null {
  return model
}

async function fetchJson<T>(file: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL}${TOWN_DATA.dir}/${file}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${file} を読めませんでした（${res.status}）`)
  return (await res.json()) as T
}

async function load() {
  set({ data: 'loading', message: null })
  try {
    const manifest = await fetchJson<{ walkFile?: string; infra?: string; namedFile?: string }>('manifest.json')
    const [walk, infra, named] = await Promise.all([
      fetchJson<WalkJson>(manifest.walkFile ?? 'walk.json'),
      fetchJson<InfraJson>(manifest.infra ?? 'infra.json'),
      fetchJson<NamedJson>(manifest.namedFile ?? 'named.json'),
    ])
    model = buildMapModel(walk, infra, named)
    mini.dirty = true
    set({ data: 'ready' })
    void loadGround()
  } catch (e) {
    model = null
    set({ data: 'error', message: e instanceof Error ? e.message : String(e), open: false })
  }
}

/** 町の状態を見て、ready になったら読む・無いと分かったら読まない */
function onStatus() {
  const s = townState.status
  if (s === 'ready' && ui.data === 'wait') void load()
  else if ((s === 'missing' || s === 'outdated' || s === 'error') && ui.data !== 'ready') set({ data: 'unavailable', open: false })
}
onStatus()
const offStatus = onTownStatus(onStatus)
if (import.meta.hot) import.meta.hot.dispose(() => offStatus())

/* -------------------------------------------------------------------------- */
/* 行き先の点                                                                    */
/* -------------------------------------------------------------------------- */

/** 地図に出す行き先（名前を出す順: 町の中・中のある建物と乗り場 → ラボのまわり → ラボの中） */
export interface MapDestination extends MapPin {
  /** 一覧の名前と組の名前（選んだときに出す） */
  full: string
  group: string
}

const GROUP_RANK = (id: string) => (id === 'lab-in' ? 2 : id === 'lab-out' ? 1 : 0)

/** 今行ける行き先（町の地図データが無ければラボだけ） */
export function mapDestinations(): MapDestination[] {
  return [...DESTINATION_GROUPS]
    .sort((a, b) => GROUP_RANK(a.id) - GROUP_RANK(b.id))
    .flatMap((g) => g.items.filter(reachable).map((d) => ({ id: d.id, label: shortLabel(d.label), full: d.label, group: g.label, x: d.x, y: -d.z })))
}

/* -------------------------------------------------------------------------- */
/* 歩く人のいる所                                                                 */
/* -------------------------------------------------------------------------- */

/** ラボの建物（named.json の id。町の地図データの元の名前） */
export const LAB_BUILDING = 'building.sakuragioka.lab'

/** 歩く人の今の様子から、ミニマップの字・印・強く描く路線を決める */
export function whereNow(): MapWhere {
  const m = walker.motion
  const r = walker.ride
  const car = r.car
  if (car && (r.phase === 'board' || r.phase === 'riding' || r.phase === 'alight')) {
    const id = car.vehicle.id
    const tram = id === 'tram' && typeof car.line === 'number' ? car.line : null
    return { caption: tram !== null ? `緑電 ${tram} 系統に乗っています` : `${car.vehicle.label}に乗っています`, vehicle: VEHICLE_GLYPH[id] ?? '乗', mark: null, tram, cable: id === 'cable' }
  }
  if (m.zone === 'lab') return m.outside ? { ...NO_WHERE, caption: 'ラボのまわり' } : { ...NO_WHERE, caption: 'ラボの中', mark: LAB_BUILDING }
  if (m.zone === 'town') return { ...NO_WHERE, caption: '町の中' }
  const zone = INTERIOR_ZONES[m.zone as InteriorZoneId]
  if (!zone) return { ...NO_WHERE, caption: '町の中' }
  return m.indoor ? { ...NO_WHERE, caption: `${zone.label}の中`, mark: zone.buildingId } : { ...NO_WHERE, caption: `${zone.label}のあたり` }
}

const sameWhere = (a: MapWhere, b: MapWhere) => a.caption === b.caption && a.vehicle === b.vehicle && a.mark === b.mark && a.tram === b.tram && a.cable === b.cable

/** 下絵の描き方（いる所の印・強く描く路線・下に敷く地面の画） */
export function baseOptions(where: MapWhere): BaseOptions {
  return { highlight: { tram: where.tram, cable: where.cable }, mark: where.mark, ground: ground.on ? ground.layers : [] }
}

/* -------------------------------------------------------------------------- */
/* 地面の画                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 下に敷く地面の画（town/ground/ の overview.png（5m/画素・17×14.5km）と center.png（1m/画素・3.1×3.3km））。#1 で敷く・敷かないを見比べて敷くことにした:
 * 道・線路・水・建物の線だけでは、海と陸の境（岸・埠頭・突堤）・公園の緑・街区が出ず、港のあたりで今どこにいるかが分からないため。
 * 地図のパッケージが読んだのと同じファイル（ブラウザのキャッシュから届く）を、縮めて開く（overview は 10m/画素・center は 2m/画素。合わせて約 20MB。
 * そのままだと約 80MB）。上の線が読めるよう、暗い背景の上に薄く敷く（mapDraw.ts）。読めなければ敷かずに描く
 */
const GROUND_PIXEL: Record<'center' | 'overview', number> = { overview: 10, center: 2 }
const ground: { on: boolean; layers: GroundLayer[]; status: 'wait' | 'loading' | 'ready' | 'error' } = { on: true, layers: [], status: 'wait' }

async function loadGround() {
  if (ground.status !== 'wait') return
  ground.status = 'loading'
  try {
    const manifest = await fetchJson<{ ground: Record<'center' | 'overview', { albedo: string; extent: { xmin: number; xmax: number; ymin: number; ymax: number } }> }>('manifest.json')
    const layers: GroundLayer[] = []
    for (const k of ['overview', 'center'] as const) {
      const g = manifest.ground[k]
      const res = await fetch(`${import.meta.env.BASE_URL}${TOWN_DATA.dir}/${g.albedo}`)
      if (!res.ok) throw new Error(`${g.albedo} を読めませんでした（${res.status}）`)
      const e = g.extent
      const image = await createImageBitmap(await res.blob(), {
        resizeWidth: Math.round((e.xmax - e.xmin) / GROUND_PIXEL[k]),
        resizeHeight: Math.round((e.ymax - e.ymin) / GROUND_PIXEL[k]),
        resizeQuality: 'medium',
      })
      layers.push({ image, extent: e })
    }
    ground.layers = layers
    ground.status = 'ready'
  } catch (e) {
    ground.status = 'error'
    console.warn('[town-walker] 地図の地面の画を読めませんでした（敷かずに描きます）', e)
  }
  mini.dirty = true
  fullHook.redraw?.()
}

/** 確かめ用（見比べ）: 地面の画を下に敷く・やめる */
export function setGround(on: boolean) {
  ground.on = on
  mini.dirty = true
  fullHook.redraw?.()
}

/* -------------------------------------------------------------------------- */
/* ミニマップ（毎コマ）                                                           */
/* -------------------------------------------------------------------------- */

/** ミニマップの要素と下絵の様子 */
const mini = {
  /** 見せる窓（丸）・下絵の canvas・矢印（ui/MiniMap.tsx の ref が入れる） */
  view: null as HTMLElement | null,
  buffer: null as HTMLCanvasElement | null,
  arrow: null as HTMLElement | null,
  /** ホバーの印（窓の真ん中からのずらしで置く）と、前に書いたずらし（CSS px。NaN = 隠している） */
  hover: null as HTMLElement | null,
  hx: NaN,
  hy: NaN,
  /** 窓の直径（CSS px） */
  size: 0,
  dpr: 1,
  /** 下絵の中心（町の平面座標） */
  bx: 0,
  by: 0,
  dirty: true,
  /** 前に書いたずらし（CSS px）・矢印の回り（度） */
  tx: NaN,
  ty: NaN,
  deg: NaN,
}

/**
 * 地図に出すホバーの印（地図の hoverStatus。町の平面座標）。まだ一度も呼んでいない・乗っている（真ん中の印が「ホ」）間は null
 */
export function hoverPin(): { x: number; y: number; coming: boolean } | null {
  const h = hoverStatus()
  if (h.phase !== 'parked' && h.phase !== 'coming') return null
  return { x: h.x, y: -h.z, coming: h.phase === 'coming' }
}

/** 確かめ用の数（毎コマの段の時間と、下絵を描き直した回数と時間） */
const stats = { frames: 0, updateMs: 0, updateMax: 0, redraws: 0, redrawMs: 0, redrawMax: 0 }

export function setMiniView(el: HTMLElement | null) {
  mini.view = el
  mini.dirty = true
}
export function setMiniBuffer(el: HTMLCanvasElement | null) {
  mini.buffer = el
  mini.dirty = true
  mini.tx = mini.ty = NaN
}
export function setMiniArrow(el: HTMLElement | null) {
  mini.arrow = el
  mini.deg = NaN
}
export function setMiniHover(el: HTMLElement | null) {
  mini.hover = el
  mini.hx = mini.hy = NaN
}
/** 窓の直径（CSS px）が変わったとき（ResizeObserver） */
export function setMiniSize(size: number) {
  if (Math.abs(size - mini.size) < 0.5) return
  mini.size = size
  mini.dirty = true
}

/** 下絵を、今の歩く人を中心に描き直す */
function redrawMini(x: number, y: number) {
  const canvas = mini.buffer
  if (!canvas || !model || mini.size < 8) return
  const t0 = performance.now()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  // 下絵は窓の 2 倍の広さ（直径 2 × size の正方形）
  const css = mini.size * 2
  const px = Math.round(css * dpr)
  if (canvas.width !== px || canvas.height !== px || mini.dpr !== dpr) {
    canvas.width = px
    canvas.height = px
    canvas.style.width = `${css}px`
    canvas.style.height = `${css}px`
    canvas.style.left = `${-mini.size / 2}px`
    canvas.style.top = `${-mini.size / 2}px`
    mini.dpr = dpr
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const view: MapView = { cx: x, cy: y, scale: (mini.size / (MINIMAP_RADIUS * 2)) * dpr, width: px, height: px, px: dpr }
  drawBase(ctx, model, view, baseOptions(ui.where))
  // 近くの行き先の点と名前（ラボの中の行き先など、重なる名前は出さない）
  drawPins(ctx, view, mapDestinations(), { font: 10 })
  mini.bx = x
  mini.by = y
  mini.dirty = false
  mini.tx = mini.ty = NaN
  const ms = performance.now() - t0
  stats.redraws++
  stats.redrawMs += ms
  stats.redrawMax = Math.max(stats.redrawMax, ms)
}

/**
 * 毎コマ（scene/Scene.tsx の MapFrame。歩く人・乗り物・カメラが動いたあと）: いる所の様子を見直し（変わったら下絵も描き直す）、
 * 下絵が要れば描き直し、下絵をずらして矢印を回す（前と同じなら書かない）
 */
export function updateMiniMap() {
  const t0 = performance.now()
  const where = whereNow()
  if (!sameWhere(where, ui.where)) {
    if (where.mark !== ui.where.mark || where.tram !== ui.where.tram || where.cable !== ui.where.cable) mini.dirty = true
    set({ where })
  }
  if (!model || !mini.buffer || !mini.view || ui.data !== 'ready') return
  const p = walker.motion.position
  const x = p.x
  const y = -p.z
  if (mini.dirty || needsRecenter(mini.bx, mini.by, x, y, MINIMAP_RADIUS)) redrawMini(x, y)
  const k = mini.size / (MINIMAP_RADIUS * 2)
  const tx = Math.round((mini.bx - x) * k * 4) / 4
  const ty = Math.round((y - mini.by) * k * 4) / 4
  if (tx !== mini.tx || ty !== mini.ty) {
    mini.buffer.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
    mini.tx = tx
    mini.ty = ty
  }
  if (mini.hover) {
    // ホバーの印: 真ん中（歩く人）からのずらし。窓の外なら縁に寄せる（向きが分かるように）
    const pin = hoverPin()
    let hx = NaN
    let hy = NaN
    if (pin) {
      hx = (pin.x - x) * k
      hy = (y - pin.y) * k
      const rim = mini.size / 2 - 9
      const d = Math.hypot(hx, hy)
      if (d > rim) {
        hx *= rim / d
        hy *= rim / d
      }
      hx = Math.round(hx * 2) / 2
      hy = Math.round(hy * 2) / 2
    }
    if (!(hx === mini.hx && hy === mini.hy) && !(Number.isNaN(hx) && Number.isNaN(mini.hx))) {
      if (pin) {
        mini.hover.style.display = ''
        mini.hover.style.transform = `translate(calc(-50% + ${hx}px), calc(-50% + ${hy}px))`
        mini.hover.dataset.coming = pin.coming ? '1' : ''
      } else mini.hover.style.display = 'none'
      mini.hx = hx
      mini.hy = hy
    }
  }
  if (mini.arrow) {
    const deg = Math.round(arrowDegrees(walker.motion.heading) * 2) / 2
    if (deg !== mini.deg) {
      mini.arrow.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`
      mini.deg = deg
    }
  }
  const ms = performance.now() - t0
  stats.frames++
  stats.updateMs += ms
  stats.updateMax = Math.max(stats.updateMax, ms)
}

/* -------------------------------------------------------------------------- */
/* 全体の地図の見え方（ui/TownMap.tsx が読み書きする。?debug の口も）               */
/* -------------------------------------------------------------------------- */

/** 全体の地図: 中心（町の平面座標）・縮尺（CSS px / m）・選んだ行き先と、描き直す口（開いている間だけ） */
export const fullHook: { cx: number; cy: number; k: number; selected: string | null; redraw: (() => void) | null; select: ((id: string | null) => void) | null } = {
  cx: 0,
  cy: 0,
  k: 0,
  selected: null,
  redraw: null,
  select: null,
}

/** 確かめ用の様子（?debug の __walker.state().map） */
export function mapDebugState() {
  const r = (v: number) => Math.round(v * 1000) / 1000
  return {
    data: ui.data,
    message: ui.message,
    open: ui.open,
    where: ui.where,
    ground: { on: ground.on, status: ground.status, layers: ground.layers.map((l) => [l.image.width, l.image.height]) },
    mini: {
      size: mini.size,
      radius: MINIMAP_RADIUS,
      center: [r(mini.bx), r(mini.by)] as [number, number],
      offset: [mini.tx, mini.ty] as [number, number],
      arrow: mini.deg,
      hover: [mini.hx, mini.hy] as [number, number],
      frames: stats.frames,
      updateAvgMs: stats.frames ? r(stats.updateMs / stats.frames) : 0,
      updateMaxMs: r(stats.updateMax),
      redraws: stats.redraws,
      redrawAvgMs: stats.redraws ? r(stats.redrawMs / stats.redraws) : 0,
      redrawMaxMs: r(stats.redrawMax),
    },
    full: { cx: r(fullHook.cx), cy: r(fullHook.cy), k: r(fullHook.k), selected: fullHook.selected },
  }
}

/** 確かめ用: 数を 0 に戻す */
export function resetMapStats() {
  Object.assign(stats, { frames: 0, updateMs: 0, updateMax: 0, redraws: 0, redrawMs: 0, redrawMax: 0 })
}
