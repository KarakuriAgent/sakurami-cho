import { useEffect, useRef, useSyncExternalStore } from 'react'
import { MINIMAP_RADIUS, mapUi, openMap, setMiniArrow, setMiniBuffer, setMiniSize, setMiniView, subscribeMap } from '../townMap'

/**
 * 小さい地図（ミニマップ。右下、スマホの幅では右上。#1）。北が上で、真ん中が歩く人（向き付きの矢印。乗り物の中は乗り物の印）。
 * 描くのは townMap.ts（下絵を描いておき、毎コマはずらすだけ）。押すと全体の地図（ui/TownMap.tsx）が開く。
 * 町の地図データが無い・読めないときは、地図を出さずに理由を出す。確かめの道具は data-walker="minimap" で押す
 */
export function MiniMap() {
  const ui = useSyncExternalStore(subscribeMap, mapUi)
  const view = useRef<HTMLSpanElement>(null)
  const ready = ui.data === 'ready'

  // 窓の大きさ（CSS の幅で変わる。スマホの幅では小さい）
  useEffect(() => {
    const el = view.current
    if (!el) return
    setMiniView(el)
    const ro = new ResizeObserver(() => setMiniSize(el.clientWidth))
    ro.observe(el)
    setMiniSize(el.clientWidth)
    return () => {
      ro.disconnect()
      setMiniView(null)
    }
  }, [ready])

  if (!ready) {
    const text =
      ui.data === 'unavailable'
        ? '町の地図データが無いので、地図は出せません'
        : ui.data === 'error'
          ? `地図を読めませんでした${ui.message ? `（${ui.message}）` : ''}`
          : '地図は町の準備ができてから出ます'
    return (
      <div className="minimap minimap-empty" data-walker="minimap" data-state={ui.data} role="status">
        <span className="minimap-view">
          <span className="minimap-note">{text}</span>
        </span>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="minimap"
      data-walker="minimap"
      data-state={ui.data}
      aria-label={`全体の地図を開く（今いる所: ${ui.where.caption}）`}
      aria-haspopup="dialog"
      onClick={() => openMap(true)}
    >
      <span className="minimap-view" ref={view}>
        <canvas className="minimap-buffer" ref={setMiniBuffer} aria-hidden="true" />
        <span className="minimap-north" aria-hidden="true">
          N
        </span>
        {ui.where.vehicle ? (
          <span className="minimap-vehicle" aria-hidden="true">
            {ui.where.vehicle}
          </span>
        ) : (
          <span className="minimap-arrow" ref={setMiniArrow} aria-hidden="true">
            <svg viewBox="-12 -13 24 24" width="22" height="22">
              <path d="M0 -11 L7.5 8 L0 4 L-7.5 8 Z" fill="#6fe6ff" stroke="#060a12" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </span>
      <span className="minimap-caption">
        {ui.where.caption}
        <span className="minimap-scale"> ・半径 {MINIMAP_RADIUS}m</span>
      </span>
    </button>
  )
}
