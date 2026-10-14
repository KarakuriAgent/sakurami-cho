import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { walker } from '../town'
import { travelTo } from '../travel'
import { arrowDegrees, type Box } from '../mapData'
import { drawBase, drawHover, drawPins, drawWalker, type MapView } from '../mapDraw'
import { baseOptions, fullHook, hoverPin, mapDestinations, mapModel, mapUi, openMap, subscribeMap, type MapDestination, type MapWhere } from '../townMap'

/** 寄れる縮尺の上（CSS px / m） */
const K_MAX = 8
/** クリックと見る動きの長さ（px）・時間（ミリ秒）と、点を拾う離れ（px） */
const CLICK_MOVE = 6
const CLICK_TIME = 500
const PICK_PX = 18
/** 「寄る」「引く」のボタンとキー（+・−）の倍率 */
const ZOOM_STEP = 1.5

/**
 * 全体の地図（画面いっぱいの重ね。ミニマップを押すと開く。#1）。北が上。町全体を描き、今いる所（矢印か乗り物の印）と行き先の一覧の 45 か所の点、
 * 置いてある・呼ばれて来るホバーの「ホ」の印（#9）を出す。
 * - 動かす: ドラッグ・ホイール（カーソルの所を中心に寄る）・2 本指でつまむ（スマホ）・「寄る」「引く」・+ −のキー・「今いる所」
 * - 行き先の点を押すと、下にその行き先と、行き先の一覧と同じ「そこへ行く」（旅程。travel.ts の travelTo）を出す。行き始めたら地図を閉じる
 * - Esc か「閉じる」で閉じる。開いている間は地図にフォーカスを置き（閉じたら前の所へ戻す）、WASD・スペースキーで歩く人を動かさない（scene/Controls.tsx）
 * - 下絵（道・水・建物）は見え方が変わったときだけ描き、上の層（点・名前・歩く人）は歩く人が動いた・選んだときだけ描く
 */
export function TownMap() {
  const ui = useSyncExternalStore(subscribeMap, mapUi)
  if (!ui.open || ui.data !== 'ready') return null
  return <Overlay />
}

function Overlay() {
  const root = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const topRef = useRef<HTMLCanvasElement>(null)
  const pins = useMemo(() => mapDestinations(), [])
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const zoom = useRef<(f: number) => void>(() => {})
  const here = useRef<() => void>(() => {})
  const marked = useRef<(id: string | null) => void>(() => {})

  // 選んだ行き先を上の層へ
  useEffect(() => {
    fullHook.selected = selected
    marked.current(selected)
    setMessage(null)
  }, [selected])

  // フォーカスと、Esc・+・−のキー
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    root.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === 'Escape') {
        e.preventDefault()
        openMap(false)
      } else if (e.key === '+' || e.key === '=' || e.key === ';') zoom.current(ZOOM_STEP)
      else if (e.key === '-') zoom.current(1 / ZOOM_STEP)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // 閉じたら、開く前にフォーカスのあった所（ミニマップ）へ戻す
      const back = prev?.isConnected ? prev : document.querySelector<HTMLElement>('[data-walker="minimap"]')
      if (back && 'focus' in back) back.focus({ preventScroll: true })
    }
  }, [])

  // 描く・動かす
  useEffect(() => {
    const model = mapModel()
    const el = root.current
    const base = baseRef.current
    const top = topRef.current
    if (!model || !el || !base || !top) return
    const bctx = base.getContext('2d')
    const tctx = top.getContext('2d')
    if (!bctx || !tctx) return
    let W = 0
    let H = 0
    let dpr = 1
    let baseDirty = true
    let topDirty = true
    let sel: string | null = fullHook.selected
    let where: MapWhere = mapUi().where
    let last = { x: NaN, y: NaN, deg: NaN, hx: NaN, hy: NaN, hc: false }
    const v = fullHook

    const kMin = () => Math.min(W / ((model.bounds.xmax - model.bounds.xmin) * 1.05), H / ((model.bounds.ymax - model.bounds.ymin) * 1.05))
    const clamp = () => {
      v.k = Math.min(K_MAX, Math.max(kMin(), v.k))
      v.cx = Math.min(model.bounds.xmax, Math.max(model.bounds.xmin, v.cx))
      v.cy = Math.min(model.bounds.ymax, Math.max(model.bounds.ymin, v.cy))
      baseDirty = true
    }
    const walkerAt = () => ({ x: walker.motion.position.x, y: -walker.motion.position.z })
    /** 囲みが入る縮尺と中心にする（上の帯と下の札の分をあける） */
    const fit = (b: Box) => {
      v.cx = (b.xmin + b.xmax) / 2
      v.cy = (b.ymin + b.ymax) / 2
      v.k = Math.min((W - 80) / Math.max(b.xmax - b.xmin, 50), (H - 200) / Math.max(b.ymax - b.ymin, 50))
      clamp()
    }
    const resize = () => {
      W = el.clientWidth
      H = el.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      for (const c of [base, top]) {
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
        c.style.width = `${W}px`
        c.style.height = `${H}px`
      }
      clamp()
    }
    resize()
    // 初め: 行き先の全部と今いる所が入るように
    const w0 = walkerAt()
    const all: Box = { xmin: w0.x, xmax: w0.x, ymin: w0.y, ymax: w0.y }
    for (const p of pins) {
      all.xmin = Math.min(all.xmin, p.x)
      all.xmax = Math.max(all.xmax, p.x)
      all.ymin = Math.min(all.ymin, p.y)
      all.ymax = Math.max(all.ymax, p.y)
    }
    fit(all)

    const view = (): MapView => ({ cx: v.cx, cy: v.cy, scale: v.k * dpr, width: base.width, height: base.height, px: dpr })
    /** 画面の点（CSS px）を中心に f 倍寄る */
    const zoomAt = (f: number, sx: number, sy: number) => {
      const x = v.cx + (sx - W / 2) / v.k
      const y = v.cy - (sy - H / 2) / v.k
      v.k = Math.min(K_MAX, Math.max(kMin(), v.k * f))
      v.cx = x - (sx - W / 2) / v.k
      v.cy = y + (sy - H / 2) / v.k
      clamp()
    }
    zoom.current = (f) => zoomAt(f, W / 2, H / 2)
    here.current = () => {
      const p = walkerAt()
      v.cx = p.x
      v.cy = p.y
      v.k = Math.max(v.k, 1)
      clamp()
    }
    marked.current = (id) => {
      sel = id
      topDirty = true
    }
    fullHook.redraw = () => {
      baseDirty = true
    }
    fullHook.select = (id) => setSelected(id)

    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const w = mapUi().where
      if (w !== where) {
        if (w.mark !== where.mark || w.tram !== where.tram || w.cable !== where.cable) baseDirty = true
        where = w
        topDirty = true
      }
      if (baseDirty) {
        drawBase(bctx, model, view(), baseOptions(where))
        baseDirty = false
        topDirty = true
      }
      const p = walkerAt()
      const deg = arrowDegrees(walker.motion.heading)
      const hv = hoverPin()
      const hx = hv?.x ?? NaN
      const hy = hv?.y ?? NaN
      if (Math.abs(p.x - last.x) * v.k > 0.5 || Math.abs(p.y - last.y) * v.k > 0.5 || Math.abs(deg - last.deg) > 1) topDirty = true
      if (Number.isNaN(hx) !== Number.isNaN(last.hx) || Math.abs(hx - last.hx) * v.k > 0.5 || Math.abs(hy - last.hy) * v.k > 0.5 || !!hv?.coming !== last.hc) topDirty = true
      if (!topDirty) return
      const tv = view()
      tctx.clearRect(0, 0, top.width, top.height)
      drawPins(tctx, tv, pins, { selected: sel, font: 12 })
      if (hv) drawHover(tctx, tv, hv.x, hv.y, hv.coming)
      drawWalker(tctx, tv, p.x, p.y, deg, where.vehicle)
      last = { x: p.x, y: p.y, deg, hx, hy, hc: !!hv?.coming }
      topDirty = false
    }
    raf = requestAnimationFrame(frame)

    // ドラッグ・2 本指・クリック
    const pointers = new Map<number, { x: number; y: number }>()
    let press: { x: number; y: number; t: number; moved: number } | null = null
    let pinch: { d: number; mx: number; my: number } | null = null
    const local = (e: PointerEvent) => {
      const r = top.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const pinchOf = () => {
      const [a, b] = [...pointers.values()]
      return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 }
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      try {
        top.setPointerCapture(e.pointerId)
      } catch {
        // 押した指がもう無い（すぐ離した）ときは取れない。取れなくても動かせる
      }
      const p = local(e)
      pointers.set(e.pointerId, p)
      if (pointers.size === 1) press = { ...p, t: performance.now(), moved: 0 }
      else {
        press = null
        pinch = pinchOf()
      }
    }
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const p = local(e)
      pointers.set(e.pointerId, p)
      if (pointers.size >= 2 && pinch) {
        const now = pinchOf()
        if (pinch.d > 1) zoomAt(now.d / pinch.d, now.mx, now.my)
        v.cx -= (now.mx - pinch.mx) / v.k
        v.cy += (now.my - pinch.my) / v.k
        clamp()
        pinch = now
        return
      }
      v.cx -= (p.x - prev.x) / v.k
      v.cy += (p.y - prev.y) / v.k
      clamp()
      if (press) press.moved = Math.max(press.moved, Math.hypot(p.x - press.x, p.y - press.y))
    }
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (pointers.size === 1) press = null
      if (pointers.size === 0 && press && e.type === 'pointerup') {
        const p = local(e)
        if (press.moved < CLICK_MOVE && performance.now() - press.t < CLICK_TIME) setSelected(pick(p.x, p.y))
      }
      if (pointers.size === 0) press = null
    }
    /** 画面の点（CSS px）のいちばん近い行き先（PICK_PX より遠ければ null） */
    const pick = (sx: number, sy: number): string | null => {
      let best: MapDestination | null = null
      let bestD = PICK_PX
      for (const d of pins) {
        const dd = Math.hypot((d.x - v.cx) * v.k + W / 2 - sx, (v.cy - d.y) * v.k + H / 2 - sy)
        if (dd < bestD) {
          bestD = dd
          best = d
        }
      }
      return best?.id ?? null
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = { x: e.offsetX, y: e.offsetY }
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomAt(Math.exp(-dy * 0.0015), p.x, p.y)
    }
    top.addEventListener('pointerdown', down)
    top.addEventListener('pointermove', move)
    top.addEventListener('pointerup', up)
    top.addEventListener('pointercancel', up)
    top.addEventListener('wheel', wheel, { passive: false })
    const ro = new ResizeObserver(() => resize())
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      top.removeEventListener('pointerdown', down)
      top.removeEventListener('pointermove', move)
      top.removeEventListener('pointerup', up)
      top.removeEventListener('pointercancel', up)
      top.removeEventListener('wheel', wheel)
      fullHook.redraw = null
      fullHook.select = null
      fullHook.selected = null
    }
  }, [pins])

  const dest = selected ? pins.find((p) => p.id === selected) : undefined
  const distance = dest ? Math.round(Math.hypot(dest.x - walker.motion.position.x, dest.y + walker.motion.position.z)) : 0
  const go = () => {
    if (!dest) return
    const err = travelTo(dest.id)
    if (err) setMessage(err)
    else openMap(false)
  }

  return (
    <div className="town-map" ref={root} role="dialog" aria-modal="true" aria-label="町の全体の地図" tabIndex={-1} data-walker="town-map">
      <canvas className="town-map-canvas" ref={baseRef} aria-hidden="true" />
      <canvas className="town-map-canvas town-map-top" ref={topRef} aria-hidden="true" />
      <div className="town-map-bar">
        <h2 className="panel-title">町の地図</h2>
        <span className="hint town-map-help">ドラッグで動かす・ホイールか 2 本指で寄る・黄色の点を押すと行き先</span>
        <span className="town-map-buttons">
          <button type="button" className="button secondary small" aria-label="寄る" data-walker="map-zoom-in" onClick={() => zoom.current(ZOOM_STEP)}>
            ＋
          </button>
          <button type="button" className="button secondary small" aria-label="引く" data-walker="map-zoom-out" onClick={() => zoom.current(1 / ZOOM_STEP)}>
            −
          </button>
          <button type="button" className="button secondary small" data-walker="map-here" onClick={() => here.current()}>
            今いる所
          </button>
          <button type="button" className="button small" data-walker="map-close" onClick={() => openMap(false)}>
            閉じる
          </button>
        </span>
      </div>
      {dest && (
        <div className="town-map-card panel" data-walker="map-card" aria-live="polite">
          <p className="run-to">{dest.full}</p>
          <p className="hint">
            {dest.group}・今いる所から約 {distance}m
          </p>
          {message && <p className="status status-failed">{message}</p>}
          <button type="button" className="button" data-walker="map-go" onClick={go}>
            「{dest.label}」へ行く
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setSelected(null)
              setMessage(null)
            }}
          >
            やめる
          </button>
        </div>
      )}
    </div>
  )
}
