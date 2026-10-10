/**
 * キーボードで歩く（WASD・矢印。Shift で走る）。押しているキーを覚え、カメラの向き（水平の前）から世界の向きを出す（walk.ts が毎コマ地図の
 * setDirectInput へ渡す。追うカメラは人の向きについて回らないので、W はいつも画面の奥）。
 *
 * - キーは押した所（KeyboardEvent.code）で見る（キーボードの並び・IME に左右されない）
 * - フォーカスが入力欄（input・textarea・select・contenteditable）にあるときは取らない（VRM の身長の欄など）
 * - Ctrl・Alt・Meta と一緒のときは取らない（ブラウザの操作）
 * - 窓を離れた（blur）・タブを隠した・キーを押したまま入力欄へ移ったときは、全部離したことにする（押しっぱなしで歩き続けない）
 */

/** 押したキー → 前（+1）・後ろ（−1）・右（+1）・左（−1） */
const MOVES: Record<string, [forward: number, right: number]> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyD: [0, 1],
  ArrowRight: [0, 1],
  KeyA: [0, -1],
  ArrowLeft: [0, -1],
}
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight'])

export interface KeyInput {
  /** 走るキー（Shift）を押しているか */
  readonly run: boolean
  /** 歩くキーを押しているか */
  readonly active: boolean
  /** カメラの水平の前（fx, fz。長さは見ない）から、押しているキーの世界の向き（x = 東、z = 南）。押していなければ（打ち消し合えば）null */
  direction(fx: number, fz: number): { x: number; z: number } | null
  /** 確かめ用: キー（KeyW・ShiftLeft など）を ms ミリ秒だけ押したことにする（離したら解ける。Infinity なら release で離すまで） */
  hold(code: string, ms: number): Promise<void>
  /** 確かめ用: キーを離したことにする */
  release(code: string): void
  /** やめる */
  dispose(): void
}

/** 入力欄にフォーカスがあるか（そこではキーを取らない） */
function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el || !('tagName' in el)) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

export function createKeyInput(target: Window): KeyInput {
  const held = new Set<string>()
  const down = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return
    if (!(e.code in MOVES) && !RUN_KEYS.has(e.code)) return
    held.add(e.code)
    // 矢印でページが動かないように
    if (e.code in MOVES) e.preventDefault()
  }
  const up = (e: KeyboardEvent) => {
    held.delete(e.code)
  }
  const clear = () => held.clear()
  const hidden = () => {
    if (document.visibilityState === 'hidden') held.clear()
  }
  // 押したまま入力欄へ移ったら離したことにする
  const focus = (e: FocusEvent) => {
    if (typing(e.target)) held.clear()
  }
  target.addEventListener('keydown', down)
  target.addEventListener('keyup', up)
  target.addEventListener('blur', clear)
  target.addEventListener('focusin', focus)
  document.addEventListener('visibilitychange', hidden)
  return {
    get run() {
      return held.has('ShiftLeft') || held.has('ShiftRight')
    },
    get active() {
      for (const c of held) if (c in MOVES) return true
      return false
    },
    direction(fx, fz) {
      let f = 0
      let r = 0
      for (const c of held) {
        const m = MOVES[c]
        if (!m) continue
        f += m[0]
        r += m[1]
      }
      f = Math.sign(f)
      r = Math.sign(r)
      if (!f && !r) return null
      const l = Math.hypot(fx, fz)
      if (l < 1e-6) return null
      const ax = fx / l
      const az = fz / l
      // 右 = 前を上から見て時計回りに 90°（前が北 −z なら右は東 +x）
      const x = ax * f - az * r
      const z = az * f + ax * r
      const k = Math.hypot(x, z)
      return { x: x / k, z: z / k }
    },
    hold(code, ms) {
      held.add(code)
      if (!Number.isFinite(ms)) return Promise.resolve()
      return new Promise((resolve) =>
        setTimeout(() => {
          held.delete(code)
          resolve()
        }, ms),
      )
    },
    release(code) {
      held.delete(code)
    },
    dispose() {
      target.removeEventListener('keydown', down)
      target.removeEventListener('keyup', up)
      target.removeEventListener('blur', clear)
      target.removeEventListener('focusin', focus)
      document.removeEventListener('visibilitychange', hidden)
      held.clear()
    },
  }
}
