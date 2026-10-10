import { useEffect, useRef, useSyncExternalStore } from 'react'
import { FADE_IN_MS, FADE_OUT_MS, setFadeElement, subscribeWarp, warpUi } from '../teleport'

/**
 * ワープの暗転（画面に黒い幕を重ねる。動かすのは teleport.ts）。幕は 3D の画の上・パネルの下（App.tsx で Canvas のすぐ後ろに置く）。
 * 暗くするのは短く（FADE_OUT_MS）、跳んだあと長いコマが過ぎるまで暗いままにして、明るくするのは少しゆっくり（FADE_IN_MS）。押しても下へ通す
 */
export function WarpFade() {
  const ui = useSyncExternalStore(subscribeWarp, warpUi)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setFadeElement(ref.current)
    return () => setFadeElement(null)
  }, [])
  const dark = ui.fade === 'out' || ui.fade === 'hold'
  return (
    <div
      ref={ref}
      className="warp-fade"
      data-walker="warp-fade"
      data-phase={ui.fade}
      aria-hidden="true"
      style={{ opacity: dark ? 1 : 0, transitionDuration: `${ui.fade === 'in' ? FADE_IN_MS : FADE_OUT_MS}ms` }}
    />
  )
}
