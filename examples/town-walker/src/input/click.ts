/**
 * クリックと、追うカメラのドラッグ（回す）を見分ける。左のボタンで押してから離すまでに、動いたのが CLICK_MOVE px より短く、
 * CLICK_TIME ミリ秒より早く離したらクリック（数は仮）。ドラッグで回すのは追うカメラ（地図の createFollowCamera の connect）がそのまま行う
 */

/** クリックと見る、押してから離すまでに動いてよい長さ（px）と時間（ミリ秒。仮） */
export const CLICK_MOVE = 6
export const CLICK_TIME = 400

/** element の上のクリック（画面の点 clientX・clientY）を受ける。やめる関数を返す */
export function watchClicks(element: HTMLElement, onClick: (clientX: number, clientY: number) => void): () => void {
  let press: { id: number; x: number; y: number; t: number; moved: number } | null = null
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }
  }
  const move = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return
    press.moved = Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y))
  }
  const up = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return
    const p = press
    press = null
    const moved = Math.max(p.moved, Math.hypot(e.clientX - p.x, e.clientY - p.y))
    if (moved < CLICK_MOVE && performance.now() - p.t < CLICK_TIME) onClick(e.clientX, e.clientY)
  }
  const cancel = () => {
    press = null
  }
  element.addEventListener('pointerdown', down)
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel)
  return () => {
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
  }
}
