import { placeAtPoint, teleport, townSpots, type TownSpot } from 'sakurami-cho/character'
import { SPOT_KINDS, type SpotKind } from 'sakurami-cho/core'
import { onTownStatus, townUnavailable, walker } from './town'
import { stopTravel } from './travel'

/**
 * ワープ（例のアプリ。地図の character の townSpots・teleport・placeAtPoint）。作り込んだ建物の手前と、乗り物ののりばの手前へ一瞬で移る。
 * ワープの口（teleport・placeAtPoint・townSpots）を呼ぶのはこのファイルだけ（見張り）。
 *
 * - 一覧: 地図の townSpots() を種類ごとに（建物・ケーブルの駅・観覧車・緑電の停留所・運河バスの乗り場。組の名前は地図の SPOT_KINDS。ホバーは乗り場が無いのでワープ先に無い）。
 *   緑電・運河バスは町の地図データを読んで町を組み立ててから出る（町の状態が ready になったら作り直す。地図は ready を知らせる前に交通を組み立てる）。
 *   町の地図データが無い・形の版が合わない・読めないときは、ラボ（ゾーン lab）のワープ先だけ。位置は地図の表と地図データから引き、ここに座標を書かない
 * - 跳ぶ: 旅程・観覧車の待ちをやめ（travel.ts の stopTravel('ワープ')）、画面を短く暗くしてから跳ぶ（地図の teleport が旅程・乗り物の早送り・
 *   WASD とクリックの歩きをやめて置く。乗っている途中なら次のコマで降りる）。追うカメラは歩く人の 'place' で一度に置き直し、跳んだときは
 *   人の後ろの少し右から、人が向く方（建物の入口・ホームの線路・乗り場の水）を見る向きにする（onWarp。scene/FollowCam.tsx。仮）
 * - 暗転（仮）: 跳んだ直後は、遠景の細かさの作り直し・中のある建物を作る・地形で 0.4〜0.9 秒のコマが出る（6-0 で見た）ので、暗いまま待ち、
 *   コマが短くなってから明るくする（ui/WarpFade.tsx が画面に重ねる。パネルは上のまま）
 */

/** 暗くする・明るくする長さ（ミリ秒。仮） */
export const FADE_OUT_MS = 160
export const FADE_IN_MS = 320
/** 暗いまま待つ: 跳んだあと少なくとも HOLD_MIN_FRAMES コマ描き、続けて SHORT_FRAMES コマが SHORT_MS ミリ秒より短くなるまで（長くて HOLD_MAX_MS。仮） */
const HOLD_MIN_FRAMES = 3
const SHORT_FRAMES = 3
const SHORT_MS = 100
const HOLD_MAX_MS = 4000
/** 確かめ用に覚えるコマの数（直近のワープの分） */
const FRAME_LOG = 600

export interface WarpGroup {
  kind: SpotKind
  label: string
  items: { id: string; label: string }[]
}

/** 暗転: none = 無い・out = 暗くしている・hold = 暗いまま（この間に跳ぶ）・in = 明るくしている */
export type FadePhase = 'none' | 'out' | 'hold' | 'in'

/** 直近のワープのコマ（前のコマからの長さ ms・その時の暗転・重ねた幕の不透明度。teleport = このコマの前に跳んだ） */
export interface WarpFrame {
  ms: number
  phase: FadePhase
  opacity: number
  teleport?: true
}

export interface WarpUi {
  groups: WarpGroup[]
  /** 町の地図データの分（緑電・運河バス）も入ったか */
  complete: boolean
  /** 町の地図データが無い・読めない（ラボのワープ先だけ） */
  unavailable: boolean
  fade: FadePhase
  /** 直近に跳んだ先と、跳んだ回数 */
  last: { id: string; label: string } | null
  count: number
  /** 案内の字（跳べなかった理由など） */
  message: string | null
}

let ui: WarpUi = { groups: [], complete: false, unavailable: false, fade: 'none', last: null, count: 0, message: null }
const listeners = new Set<() => void>()

function set(patch: Partial<WarpUi>) {
  ui = { ...ui, ...patch }
  for (const fn of listeners) fn()
}

/** 今の様子（useSyncExternalStore の getSnapshot） */
export function warpUi(): WarpUi {
  return ui
}

/** 様子が変わったら呼ぶ（やめる関数を返す） */
export function subscribeWarp(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** ワープ先の一覧（地図の townSpots。呼んだときの物） */
export function warpSpots(): TownSpot[] {
  return townSpots()
}

/** 跳んだときに呼ぶ（追うカメラの向きを直す。やめる関数を返す） */
const warpListeners = new Set<(spot: TownSpot) => void>()
export function onWarp(fn: (spot: TownSpot) => void): () => void {
  warpListeners.add(fn)
  return () => warpListeners.delete(fn)
}

/** 町の地図データが無いときに跳べるワープ先か（ラボのゾーンだけ。町の地面・道・乗り物が無いため） */
const usable = (s: TownSpot) => !townUnavailable() || s.zone === 'lab'

/** 一覧を地図から作り直す（数が変わったときだけ知らせる） */
function refreshGroups() {
  const spots = townSpots().filter(usable)
  const groups: WarpGroup[] = []
  for (const k of SPOT_KINDS) {
    const items = spots.filter((s) => s.kind === k.id).map((s) => ({ id: s.id, label: s.label }))
    if (items.length) groups.push({ kind: k.id, label: k.label, items })
  }
  const complete = groups.some((g) => g.kind === 'tram') && groups.some((g) => g.kind === 'waterbus')
  const unavailable = townUnavailable()
  const before = ui.groups.map((g) => `${g.kind}:${g.items.length}`).join()
  if (complete !== ui.complete || unavailable !== ui.unavailable || groups.map((g) => `${g.kind}:${g.items.length}`).join() !== before) set({ groups, complete, unavailable })
}

refreshGroups()
// 町の状態が変わったら作り直す（ready: 町を組み立てて緑電・運河バスの乗り場ができた。missing など: ラボだけにする）
const offStatus = onTownStatus(() => refreshGroups())
// このファイルを書き換えたときは、前の聞く所を外す
if (import.meta.hot) import.meta.hot.dispose(() => offStatus())

/* -------------------------------------------------------------------------- */
/* 暗転とコマの記録                                                                */
/* -------------------------------------------------------------------------- */

/** 重ねる幕の要素（ui/WarpFade.tsx が入れる。不透明度を記録するため） */
let fadeEl: HTMLElement | null = null
export function setFadeElement(el: HTMLElement | null) {
  fadeEl = el
}

const opacity = () => (fadeEl ? Number(getComputedStyle(fadeEl).opacity) : 0)

let frames: WarpFrame[] = []
/** 直近のワープのコマ（確かめ用。?debug の __walker.state().teleport） */
export function warpFrames(): readonly WarpFrame[] {
  return frames
}

/**
 * ワープ先 id へ跳ぶ（一覧で選んだとき）。fade = false なら暗転せずにすぐ跳ぶ（?debug の口）。跳び始めたら null、だめなら理由（様子にも出す）
 */
export function warpTo(id: string, fade = true): string | null {
  if (ui.fade !== 'none') return fail('ワープの途中です')
  const spot = townSpots().find((s) => s.id === id)
  if (!spot) return fail(`知らないワープ先: ${id}`)
  if (!usable(spot)) return fail(`町の地図データが無いので、「${spot.label}」へはワープできません`)
  stopTravel('ワープ')
  if (!fade) {
    jump(spot)
    return null
  }
  frames = []
  set({ fade: 'out', message: null })
  runFade(id)
  return null
}

function fail(message: string): string {
  set({ message })
  return message
}

/** 跳ぶ（地図の teleport。旅程・乗り物の早送り・WASD とクリックの歩きをやめて置く） */
function jump(spot: TownSpot) {
  teleport(walker, spot)
  for (const fn of warpListeners) fn(spot)
  set({ last: { id: spot.id, label: spot.label }, count: ui.count + 1, message: null })
}

/**
 * 暗くする → 暗くなりきったら跳ぶ → 暗いまま、コマが短くなるまで待つ → 明るくする。コマの長さは requestAnimationFrame の間隔
 * （R3F の毎コマも同じ requestAnimationFrame で描くので、跳んだあとの長いコマはそのまま間隔に出る）
 */
function runFade(id: string) {
  let prev = performance.now()
  let outAt = prev
  let jumpedAt = 0
  let since = 0
  let short = 0
  let inAt = 0
  const step = (now: number) => {
    const ms = now - prev
    prev = now
    const frame: WarpFrame = { ms: Math.round(ms * 10) / 10, phase: ui.fade, opacity: Math.round(opacity() * 1000) / 1000 }
    if (frames.length < FRAME_LOG) frames.push(frame)
    if (ui.fade === 'out') {
      // 暗くなりきったら（幕が不透明になってから 1 コマ置いて）跳ぶ。跳んだ所はこのあとのコマに出る
      if (now - outAt >= FADE_OUT_MS && (frame.opacity >= 0.999 || now - outAt > FADE_OUT_MS + 500)) {
        const spot = townSpots().find((s) => s.id === id)
        if (spot) jump(spot)
        jumpedAt = now
        set(spot ? { fade: 'hold' } : { fade: 'hold', message: `知らないワープ先: ${id}` })
        frame.teleport = true
      }
    } else if (ui.fade === 'hold') {
      since++
      short = ms < SHORT_MS ? short + 1 : 0
      if ((since >= HOLD_MIN_FRAMES && short >= SHORT_FRAMES) || now - jumpedAt > HOLD_MAX_MS) {
        inAt = now
        set({ fade: 'in' })
      }
    } else if (ui.fade === 'in') {
      if (now - inAt >= FADE_IN_MS + 50) {
        set({ fade: 'none' })
        return
      }
    } else return
    requestAnimationFrame(step)
  }
  requestAnimationFrame((now) => {
    prev = now
    outAt = now
    requestAnimationFrame(step)
  })
}

/**
 * 確かめ用: 歩く人を点（シーンの x, z）に置く（地図の placeAtPoint。足元は refY にいちばん近い地面・床）。旅程・観覧車の待ちは先にやめる。暗転しない
 */
export function putWalker(x: number, z: number, heading: number, refY: number | null) {
  stopTravel('置き直す')
  placeAtPoint(walker, x, z, heading, refY)
}
