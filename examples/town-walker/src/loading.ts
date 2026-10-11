import { TOWN_DATA } from 'sakurami-cho/core'
import { onTownStatus, townState } from './town'

/**
 * 読み込み中の進み具合（画面の真ん中の段ごとの棒。初めの形は walk/index.html の #loading で、スクリプトが届くまではそこのインラインの JS が経過を数える）。
 * スクリプトが動き出したら、ここが引き継いで段ごとの数を入れ、準備ができたら（scene/Scene.tsx の ReadySignal が loadingReady を呼ぶ）消す。
 * 地図のパッケージは変えず、今ある物から数える:
 *
 *   スクリプト      このモジュールが動いたら済み（大きさは Resource Timing の .js の合計）
 *   フォント        main.tsx の waitForFonts が知らせる（document.fonts.load の 6 つ。3 秒で打ち切り）
 *   テクスチャ      Resource Timing（PerformanceObserver）でアセットの根の textures/ の下を読み終えた数。分母はビルドのときの textures/ の下の画像の数
 *                   （vite.config.ts の __WALKER_TEXTURE_FILES__。ラボの 12 枚は R3F の useTexture・TextureLoader、町の 5 枚は地図が fetch で読む）
 *   ラボを作る      フォントを待って描き始めてから、ラボのテクスチャを読んでラボを作り、最初のコマを描き終えるまで（ReadySignal の 2 コマ目に loadingLabBuilt）
 *   町の地図データ  地図の onStatus の loading から、Resource Timing で town/ の下（manifest.json のほか）を読み終えたバイトの合計。分母は manifest.json の
 *                   stats.bytes（書き出したファイルの大きさの合計。allTiles なので全部読む）
 *   町を組み立てる  町の地図データを読み終えてから、地図の onStatus が ready になるまで
 *
 * 町の地図データが無い・形の版が合わない・読めないときは「町の地図データ」の段に出し（くわしくは上の案内 ui/TownNotice.tsx）、組み立ては省く。
 * 途中で捕まえられなかった誤り（window の error・unhandledrejection）が出たら、そのとき進んでいた段に出す
 */

type StepId = 'script' | 'fonts' | 'textures' | 'lab' | 'townData' | 'build'
type StepState = 'wait' | 'active' | 'done' | 'fail' | 'skip'

interface Boot {
  t0: number
  taken: boolean
  done: boolean
}

const STEP_LABELS: Record<StepId, string> = {
  script: 'スクリプト',
  fonts: 'フォント',
  textures: 'テクスチャ',
  lab: 'ラボを作る',
  townData: '町の地図データ',
  build: '町を組み立てる',
}
const ORDER = Object.keys(STEP_LABELS) as StepId[]

declare global {
  /** walk/index.html のインラインの JS が作る（スクリプトが届くまでの経過と、引き継いだか） */
  interface Window {
    __walkerBoot?: Boot
  }
  /** アセットの根の textures/ の下の画像の数（vite.config.ts の define） */
  const __WALKER_TEXTURE_FILES__: number
}

const boot: Boot = window.__walkerBoot ?? { t0: Date.now(), taken: false, done: false }
boot.taken = true

const panel = document.getElementById('loading')
const states = new Map<StepId, StepState>(ORDER.map((id) => [id, 'wait']))
/** 段が進み始めた時刻（済みの段に掛かった秒を出す） */
const started = new Map<StepId, number>()

/**
 * 段の様子を変える。fraction は 0〜1（null なら往き来する帯）。済み・失敗・省いた段は、もう進めない（あとから届いた知らせで戻さない）
 */
function setStep(id: StepId, state: StepState, detail?: string, fraction: number | null = null) {
  const prev = states.get(id)!
  if ((prev === 'done' || prev === 'fail' || prev === 'skip') && state === 'active') return
  if (state === 'active' && !started.has(id)) started.set(id, performance.now())
  states.set(id, state)
  const row = panel?.querySelector<HTMLElement>(`[data-step="${id}"]`)
  if (!row) return
  row.dataset.state = state
  if (detail !== undefined) row.querySelector('.step-detail')!.textContent = detail
  const fill = row.querySelector<HTMLElement>('.step-fill')!
  const bar = row.querySelector<HTMLElement>('.step-bar')!
  if (state === 'active' && fraction === null) row.setAttribute('data-indeterminate', '')
  else row.removeAttribute('data-indeterminate')
  const pct = state === 'active' ? Math.round(Math.min(1, Math.max(0, fraction ?? 0)) * 100) : state === 'wait' || state === 'skip' ? 0 : 100
  fill.style.width = `${pct}%`
  bar.setAttribute('role', 'progressbar')
  bar.setAttribute('aria-label', STEP_LABELS[id])
  bar.setAttribute('aria-valuemin', '0')
  bar.setAttribute('aria-valuemax', '100')
  if (state === 'active' && fraction === null) bar.removeAttribute('aria-valuenow')
  else bar.setAttribute('aria-valuenow', String(pct))
}

/** 段に掛かった秒（進み始めてから今まで） */
function seconds(id: StepId) {
  const t = started.get(id)
  return t === undefined ? '' : `${((performance.now() - t) / 1000).toFixed(1)} 秒`
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(1)

/** 下の知らせ（誤り） */
function note(text: string) {
  const p = panel?.querySelector<HTMLElement>('.loading-note')
  if (!p) return
  p.hidden = false
  p.textContent = text
}

/* -------------------------------------------------------------------------- */
/* スクリプト                                                                    */
/* -------------------------------------------------------------------------- */

started.set('script', boot.t0 - Date.now() + performance.now())
{
  const js = performance
    .getEntriesByType('resource')
    .filter((e) => /\.(?:m?js|tsx?)(?:\?|$)/.test(e.name))
    .reduce((s, e) => s + ((e as PerformanceResourceTiming).decodedBodySize || 0), 0)
  setStep('script', 'done', js > 0 ? `${mb(js)} MB・${seconds('script')}` : seconds('script'))
}

/* -------------------------------------------------------------------------- */
/* テクスチャと町の地図データ（Resource Timing）                                  */
/* -------------------------------------------------------------------------- */

const base = new URL(import.meta.env.BASE_URL, location.href).href
const TEXTURE_PREFIX = `${base}textures/`
const TOWN_PREFIX = `${base}${TOWN_DATA.dir}/`
const MANIFEST = `${TOWN_PREFIX}manifest.json`
const TEXTURE_TOTAL = Math.max(1, __WALKER_TEXTURE_FILES__)

const textures = new Map<string, boolean>()
const townFiles = new Map<string, number>()
let townBytes = 0
/** 町の地図データの合計（manifest.json の stats.bytes。読めなければ null） */
let townTotal: number | null = null

function showTextures() {
  const ok = [...textures.values()].filter(Boolean).length
  const failed = textures.size - ok
  const detail = `${textures.size} / ${TEXTURE_TOTAL}${failed ? `（${failed} 個を読めず 1 色で描く）` : ''}`
  if (textures.size >= TEXTURE_TOTAL) setStep('textures', failed ? 'fail' : 'done', detail)
  else setStep('textures', 'active', detail, textures.size / TEXTURE_TOTAL)
}

function showTown() {
  const s = states.get('townData')
  if (s !== 'active') return
  if (townTotal === null) {
    setStep('townData', 'active', `${mb(townBytes)} MB`)
    return
  }
  if (townBytes >= townTotal) {
    setStep('townData', 'done', `${mb(townTotal)} MB・${seconds('townData')}`)
    setStep('build', 'active', '組み立てています')
  } else setStep('townData', 'active', `${mb(townBytes)} / ${mb(townTotal)} MB`, townBytes / townTotal)
}

function onResource(e: PerformanceResourceTiming) {
  const url = e.name.split('#')[0]!.split('?')[0]!
  // 読めなかった物（4xx・5xx。responseStatus の無いブラウザでは、中身が 0 バイトなら読めなかったとみる）
  const status = (e as PerformanceResourceTiming & { responseStatus?: number }).responseStatus
  const ok = status !== undefined && status !== 0 ? status < 400 : e.decodedBodySize > 0
  if (url.startsWith(TEXTURE_PREFIX) && /\.(?:jpe?g|png|webp)$/.test(url)) {
    if (textures.get(url) !== true) textures.set(url, ok)
    showTextures()
  } else if (url.startsWith(TOWN_PREFIX) && url !== MANIFEST && !townFiles.has(url)) {
    const bytes = e.decodedBodySize || e.encodedBodySize || 0
    townFiles.set(url, bytes)
    townBytes += bytes
    showTown()
  }
}

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) onResource(e as PerformanceResourceTiming)
  }).observe({ type: 'resource', buffered: true })
} catch {
  // Resource Timing の無いブラウザでは数えない（準備ができたら消える）
}

// 町の地図データの合計（地図も同じ物を読む。キャッシュを確かめ直すだけで、2 回は落とさない）
fetch(MANIFEST, { cache: 'no-cache' })
  .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<{ stats?: { bytes?: number } }>) : null))
  .then((m) => {
    const bytes = m?.stats?.bytes
    if (typeof bytes === 'number' && bytes > 0) {
      townTotal = bytes
      showTown()
    }
  })
  .catch(() => undefined)

/* -------------------------------------------------------------------------- */
/* 町の地図データの状態（地図の onStatus）                                         */
/* -------------------------------------------------------------------------- */

const TOWN_FAILS: Partial<Record<string, string>> = {
  missing: 'ありません（上の案内）',
  outdated: '形の版が合いません（上の案内）',
  error: '読む途中で失敗しました（上の案内）',
}

function onStatus(status: string) {
  if (status === 'loading') {
    setStep('townData', 'active', townTotal === null ? '' : `0.0 / ${mb(townTotal)} MB`, 0)
    showTown()
  } else if (status === 'ready') {
    if (states.get('townData') !== 'done') setStep('townData', 'done', townTotal === null ? seconds('townData') : `${mb(townTotal)} MB・${seconds('townData')}`)
    setStep('build', 'done', seconds('build'))
  } else if (TOWN_FAILS[status]) {
    setStep('townData', 'fail', TOWN_FAILS[status])
    setStep('build', 'skip', 'ラボだけで始めます')
  }
}
onTownStatus((status) => onStatus(status))
if (townState.status !== 'idle') onStatus(townState.status)

/* -------------------------------------------------------------------------- */
/* 捕まえられなかった誤り                                                          */
/* -------------------------------------------------------------------------- */

function onError(message: string) {
  if (boot.done) return
  const id = ORDER.find((s) => states.get(s) === 'active')
  if (!id) return
  setStep(id, 'fail', '止まりました')
  note(`「${STEP_LABELS[id]}」の途中で止まりました（${message}）。ページを読み込み直してください。続くときは、ブラウザで WebGL2 が使えるか（GPU・ブラウザの設定）を確かめてください。`)
}
window.addEventListener('error', (e) => onError(e.message || String(e.error ?? '?')))
window.addEventListener('unhandledrejection', (e) => onError(e.reason instanceof Error ? e.reason.message : String(e.reason)))

/* -------------------------------------------------------------------------- */
/* ほかのモジュールが知らせる口                                                    */
/* -------------------------------------------------------------------------- */

/** フォント（main.tsx の waitForFonts）: settled 個が読み終えた・total 個のうち。timedOut なら打ち切った */
export function loadingFonts(settled: number, total: number, timedOut = false) {
  if (total === 0) setStep('fonts', 'done', '使わない')
  else if (timedOut) setStep('fonts', 'done', `${settled} / ${total}（3 秒で打ち切り。代わりの字で描く）`)
  else if (settled >= total) setStep('fonts', 'done', `${total} / ${total}・${seconds('fonts')}`)
  else setStep('fonts', 'active', `${settled} / ${total}`, settled / total)
}

/** 描き始めた（フォントを待ったあと。ここからラボのテクスチャを読み、ラボを作る） */
export function loadingRender() {
  if (states.get('fonts') === 'active' || states.get('fonts') === 'wait') setStep('fonts', 'done')
  setStep('lab', 'active', '作っています')
  if (states.get('textures') === 'wait') showTextures()
}

/** ラボを作り終えた（ReadySignal の 2 コマ目。最初のコマを描き終えた） */
export function loadingLabBuilt() {
  setStep('lab', 'done', seconds('lab'))
}

/** 準備ができた（町の地図データを読み終えて（か、無いと分かって）から 30 コマ描いた）。進み具合を消す（誤りがあれば少し見せてから） */
export function loadingReady() {
  if (boot.done) return
  boot.done = true
  // テクスチャは、町の地図データが無いと町の 5 枚を読まないので、分母に届かないまま済みになる（そのときは読んだ数だけ出す）
  if (states.get('textures') === 'active') setStep('textures', 'done', `${textures.size} 個`)
  for (const id of ORDER) if (states.get(id) === 'active' || states.get(id) === 'wait') setStep(id, 'done')
  if (!panel) return
  const failed = ORDER.some((id) => states.get(id) === 'fail')
  panel.removeAttribute('aria-busy')
  setTimeout(
    () => {
      panel.dataset.state = 'done'
      setTimeout(() => panel.remove(), 700)
    },
    failed ? 4000 : 300,
  )
}
