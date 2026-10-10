import * as THREE from 'three'
import { directState, pickGround, setDirectInput, walkToPoint } from 'sakurami-cho/character'
import { walker } from './town'
import { nearestDestination, stopTravel } from './travel'
import type { KeyInput } from './input/keys'

/**
 * 歩く人を直接動かす所（例のアプリ。地図の character の setDirectInput・walkToPoint・pickGround を使う）。
 * - キー（input/keys.ts）: 毎コマ、カメラの向きから出した世界の向きを setDirectInput へ。押し始めたら旅程（行き先の一覧。travel.ts の stopTravel）を取り消す
 * - クリック（input/click.ts）: 画面の点からの線で地面を拾い（pickGround）、そこへ歩く（walkToPoint。今いる所の道のグラフの中だけ）。
 *   歩けないとき（立てない所・ゾーンをまたぐ・道が無い）は案内を出し、クリックした所の近くの行き先があれば「そこへ行く」（旅程）と
 *   行き先の一覧を開く口を添える（6-4）。歩き出したら旅程を取り消し、行き先に印を出す
 * - 案内と印の様子を UI（ui/WalkNotice.tsx）と場面（scene/Controls.tsx）へ（React の useSyncExternalStore）
 */

export interface WalkUi {
  /** 案内の字（無ければ null）と、出した回数（同じ字をもう一度出したときも出し直す） */
  notice: string | null
  serial: number
  /** クリックで歩く行き先（シーンの座標。歩いていなければ null） */
  marker: [number, number, number] | null
  /** 案内に添える、クリックした所の近くの行き先（行き先の一覧の旅程で行く。無ければ null。6-4） */
  suggest: { id: string; label: string; group: string; distance: number } | null
}

let ui: WalkUi = { notice: null, serial: 0, marker: null, suggest: null }
const listeners = new Set<() => void>()

function set(patch: Partial<WalkUi>) {
  ui = { ...ui, ...patch }
  for (const fn of listeners) fn()
}

/** 今の様子（useSyncExternalStore の getSnapshot） */
export function walkUi(): WalkUi {
  return ui
}

/** 様子が変わったら呼ぶ（やめる関数を返す） */
export function subscribeWalk(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 案内を出す（ui/WalkNotice.tsx が数秒で消す）。suggest = 添える近くの行き先 */
export function showNotice(text: string, suggest: WalkUi['suggest'] = null) {
  set({ notice: text, serial: ui.serial + 1, suggest })
}

/** 今のキーの入力（scene/Controls.tsx が入れる。?debug の __walker.press が使う） */
export const keyHook: { keys: KeyInput | null } = { keys: null }

let pressing = false

/** 毎コマ（scene/Controls.tsx）: キーの世界の向きを歩く人へ。押し始めたら旅程とクリックの行き先をやめる */
export function walkByKeys(dir: { x: number; z: number } | null, run: boolean) {
  if (dir && !pressing) {
    stopTravel('キーで歩く')
    if (ui.marker) set({ marker: null })
  }
  pressing = !!dir
  setDirectInput(walker, dir, run)
}

/** 点（シーンの座標）へ歩く。歩き出したら null、歩けなければ理由（案内にも出す） */
export function walkToGroundPoint(x: number, z: number, y?: number): string | null {
  const reason = walkToPoint(walker, x, z, y)
  if (reason) {
    showNotice(reason, walker.ride.phase === 'none' ? nearestDestination(x, z) : null)
    return reason
  }
  stopTravel('クリックで歩く')
  const goal = directState(walker).goal
  set({ marker: goal ? [goal[0], y ?? walker.motion.position.y, goal[1]] : null, notice: null, suggest: null })
  return null
}

const _ray = new THREE.Raycaster()
const _ndc = new THREE.Vector2()

/** 画面の点（clientX・clientY）からの線が当たる地面の点（無ければ null） */
export function groundAtScreen(camera: THREE.Camera, element: HTMLElement, clientX: number, clientY: number): THREE.Vector3 | null {
  const r = element.getBoundingClientRect()
  _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  _ray.setFromCamera(_ndc, camera)
  return pickGround(_ray.ray)
}

/** 画面の点をクリックしたとき: 地面を拾って歩く。歩き出したら null、だめなら理由 */
export function walkAtScreen(camera: THREE.Camera, element: HTMLElement, clientX: number, clientY: number): string | null {
  const p = groundAtScreen(camera, element, clientX, clientY)
  if (!p) {
    const reason = 'そこには歩ける地面がありません（建物・壁・空）'
    showNotice(reason)
    return reason
  }
  return walkToGroundPoint(p.x, p.z, p.y)
}

/** 毎コマ（scene/Controls.tsx）: 行き先に着いた・やめたら印を消す */
export function updateMarker() {
  if (ui.marker && !directState(walker).goal) set({ marker: null })
}
