import { createCharacterVisual, type CharacterVisual, type CharacterVisualStatus } from 'sakurami-cho/character'
import { walker } from './town'
import { clearStoredVrm, loadStoredVrm, saveStoredVrm, storeAvailable, updateStoredSettings } from './vrmStore'

/**
 * 歩く人の見た目（VRM）。使う人が選んだ・落としたファイルを blob: の URL にして、地図の見た目（createCharacterVisual）で読む。
 * VRM 0.x・1.0 のどちらも読める（0.x の向きは地図の側がそろえる）。待機・歩き・跳ぶ .vrma は地図のパッケージの既定（assets/models/animations/ の idle・walk・jump-*）。
 *
 * - 身長: 「身長を合わせる」なら、読んだ VRM の目の高さから測った身長を、設定の身長に合わせて体全体を拡大縮小する（ずれが 0.5% の内なら
 *   そのまま。地図の既定の決まり）。合わせないなら、VRM の元の大きさのまま。どちらかを変えたら、同じファイルを読み直す
 * - 入れ替え: 前の見た目を地図の dispose() で片付け（読み込みの途中なら取り消し、前の VRM の形・素材・テクスチャと縁の光の素材の一覧の物を片付ける）、
 *   前のファイルの blob: の URL を取り消す
 * - 読めないとき（.vrm でない・VRM の拡張が無い・壊れている）は、その理由を案内に出し、仮の体のまま（scene/Walker.tsx）
 * - しまった VRM（vrmStore.ts。入口のページ src/landing.ts で選んだ物か、前にここで読んだ物。このブラウザの IndexedDB）: ページを開いたら
 *   すぐ調べ、あればその設定（身長を合わせるか・身長）で読む（町の準備と並べて。読み込み中の進み具合の「VRM」の段）。?vrm=none（入口の
 *   「VRM なしで入る」）なら読まない（消しもしない）。ここで選んだ・落としたファイルが読めたら、しまってある物と入れ替える。身長の設定を変えたら
 *   しまってある物の設定も変える。「外す」はしまってある物も消す。IndexedDB が使えなければ、しまわずに今までどおり（読み直すと消える）
 * - 見た目を付け替えたら、場面（scene/Walker.tsx）に知らせて描き直す（React の useSyncExternalStore）
 */

/** VRM の様子（none = まだ選んでいない・外した。rejected = .vrm でないファイル） */
export type VrmStatus = 'none' | Exclude<CharacterVisualStatus, 'idle'> | 'rejected'

export interface VrmState {
  status: VrmStatus
  /** 読んでいるファイルの名前 */
  fileName: string | null
  /** 案内の字（読めなかった理由など） */
  message: string
  /** 身長を設定に合わせるか */
  normalize: boolean
  /** 設定の身長（m） */
  height: number
  /** 読んだ VRM の実測の身長（m。目の高さから。合わせたあとの値。読むまで null） */
  measured: number | null
  /** 読んだ VRM の版（'0' = 0.x、'1' = 1.0） */
  version: string | null
  /** 見た目を作った回数・取り消した blob: の URL の数（入れ替えの確かめ） */
  loads: number
  revoked: number
  /**
   * しまった VRM（vrmStore.ts）の様子: checking = 調べている、none = しまった物が無い、saved = しまってある（読んでいるのはその物か、
   * 入れ替えて読めなかった物）、skipped = しまってあるが ?vrm=none で読まなかった、unavailable = IndexedDB が使えない
   */
  stored: 'checking' | 'none' | 'saved' | 'skipped' | 'unavailable'
  /** 今の VRM を、しまった物から読んだか */
  fromStore: boolean
}

/** 設定の身長の既定（m。地図の Character の目安の身長と同じ） */
export const DEFAULT_HEIGHT = 1.65
/** VRM が無いときの目の高さ（m。仮の体 scene/Walker.tsx の鼻の高さ・追うカメラの注視点） */
export const BODY_EYE = 1.5

let state: VrmState = {
  status: 'none',
  fileName: null,
  message: '',
  normalize: true,
  height: DEFAULT_HEIGHT,
  measured: null,
  version: null,
  loads: 0,
  revoked: 0,
  stored: 'checking',
  fromStore: false,
}
/** 今のファイルの blob: の URL */
let objectUrl: string | null = null
/** 読めたらしまうファイル（ここで選んだ・落とした物。しまった物から読んだときは null） */
let saveOnReady: File | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<VrmState>) {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

/** 今の様子（React の useSyncExternalStore の getSnapshot） */
export function vrmState(): VrmState {
  return state
}

/** 様子が変わったら呼ぶ（やめる関数を返す） */
export function subscribeVrm(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 選んだ・落としたファイルを読む（.vrm でなければ断って案内を出す） */
export function loadVrmFile(file: File) {
  if (!/\.vrm$/i.test(file.name)) {
    set({ status: state.status === 'none' || state.status === 'rejected' ? 'rejected' : state.status, message: `「${file.name}」は VRM（.vrm）のファイルではありません。.vrm を選ぶか落としてください` })
    return
  }
  saveOnReady = file
  attach(URL.createObjectURL(file), file.name, false)
}

/** 身長を設定に合わせるか（読んでいれば読み直す） */
export function setNormalize(on: boolean) {
  if (on === state.normalize) return
  set({ normalize: on })
  storeSettings()
  if (objectUrl && state.fileName) attach(objectUrl, state.fileName, state.fromStore)
}

/** 設定の身長（m。読んでいて合わせているなら読み直す） */
export function setHeight(m: number) {
  if (!(m > 0.3 && m < 3) || m === state.height) return
  set({ height: m })
  storeSettings()
  if (objectUrl && state.fileName && state.normalize) attach(objectUrl, state.fileName, state.fromStore)
}

/** VRM を外して仮の体に戻す（しまった物も消す） */
export function clearVrm() {
  retire()
  walker.visual = null
  revoke()
  saveOnReady = null
  set({ status: 'none', fileName: null, message: '', measured: null, version: null, fromStore: false })
  if (state.stored === 'unavailable') return
  set({ stored: 'none' })
  clearStoredVrm().catch((e: unknown) => set({ message: `このブラウザにしまった VRM を消せませんでした（${reason(e)}）` }))
}

/** 準備を待つ間か（しまった物を調べている・VRM を読み込み中。場面の準備の合図 ReadySignal がこれの済むのを待つ） */
export function vrmPending(): boolean {
  return state.stored === 'checking' || state.status === 'loading'
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 身長の設定を、しまってある物にも入れる */
function storeSettings() {
  if (state.stored !== 'saved') return
  updateStoredSettings(state.normalize, state.height).catch(() => undefined)
}

/** 読めたファイルをしまう（前の物と入れ替える） */
function store(file: File) {
  if (state.stored === 'unavailable') return
  saveStoredVrm({ file, name: file.name, size: file.size, normalize: state.normalize, height: state.height, savedAt: Date.now() }).then(
    () => {
      set({ stored: 'saved' })
      // しまう間に身長の設定を変えていたら、その分も入れる
      storeSettings()
    },
    (e: unknown) => set({ message: `このブラウザにしまえませんでした（${reason(e)}）。読み直すと消える` }),
  )
}

/** しまった VRM を調べて、あれば読む（ページを開いたらすぐ。?vrm=none なら読まない） */
async function restore() {
  if (!(await storeAvailable())) {
    set({ stored: 'unavailable' })
    return
  }
  try {
    const v = await loadStoredVrm()
    // 調べている間に、ここで選んだ・落とした物を読み始めていたら、そちらを使う
    if (state.fileName !== null || state.status !== 'none') {
      set({ stored: v ? 'saved' : 'none' })
      return
    }
    if (!v) set({ stored: 'none' })
    else if (new URLSearchParams(location.search).get('vrm') === 'none') set({ stored: 'skipped' })
    else {
      // 設定は読み始め（attach の知らせ）といっしょに知らせる（間に「しまってあるが読んでいない」様子を出さない）
      state = { ...state, stored: 'saved', normalize: v.normalize, height: v.height }
      attach(URL.createObjectURL(v.file), v.name, true)
    }
  } catch (e) {
    set({ stored: 'none', message: `このブラウザにしまった VRM を読めませんでした（${reason(e)}）` })
  }
}

/** 見た目を付け替える（url = blob: の URL。前と同じ URL なら読み直す。fromStore = しまった物から読んだ） */
function attach(url: string, fileName: string, fromStore: boolean) {
  retire()
  if (objectUrl !== url) revoke()
  objectUrl = url
  const visual: CharacterVisual = createCharacterVisual(walker, {
    url,
    height: state.height,
    assetBase: import.meta.env.BASE_URL,
    normalizeHeight: state.normalize,
    onStatus: (status, error) => {
      // 入れ替えたあとの古い見た目の知らせは捨てる
      if (walker.visual !== visual) return
      if (status === 'ready') {
        set({ status, message: '', measured: walker.anchors.measuredHeight, version: visual.vrm?.meta.metaVersion ?? null })
        if (saveOnReady) store(saveOnReady)
        saveOnReady = null
      } else if (status === 'loading') set({ status, message: '' })
      else set({ status, message: status === 'missing' ? 'ファイルが見つかりません' : `VRM として読めませんでした（${error instanceof Error ? error.message : String(error)}）` })
    },
  })
  walker.visual = visual
  set({ status: 'loading', fileName, message: '', measured: null, version: null, loads: state.loads + 1, fromStore })
}

/**
 * 今の見た目を片付ける（地図の dispose()。読み込みの途中なら取り消し、あとで届いた VRM もすぐ片付ける。読んだ VRM の形・素材・テクスチャと、
 * 縁の光の素材の一覧 walker.rim.tuned の物を片付ける）。場面から外す stop は CharacterView もするが、二度呼んでもよい
 */
function retire() {
  const old = walker.visual as CharacterVisual | null
  if (!old) return
  old.dispose()
}

/** 今のファイルの blob: の URL を取り消す */
function revoke() {
  if (!objectUrl) return
  URL.revokeObjectURL(objectUrl)
  objectUrl = null
  set({ revoked: state.revoked + 1 })
}

/** 追うカメラの注視点の高さ（足元から m）: VRM を読んでいれば実測の身長の目の高さ（身長 × 0.93）、無ければ仮の体の目の高さ */
export function walkerEye() {
  const h = walker.visual && state.status === 'ready' ? walker.anchors.measuredHeight : 0
  return h > 0.3 ? h * 0.93 : BODY_EYE
}

void restore()

if (import.meta.hot) import.meta.hot.accept(() => location.reload())
