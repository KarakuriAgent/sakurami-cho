import { checkVrmFile, clearStoredVrm, formatSize, loadStoredVrm, readThumbnail, saveStoredVrm, storeAvailable, updateStoredSettings, type StoredVrm } from './vrmStore'

/**
 * 入口のページ（/。index.html）の小さなスクリプト: 使う VRM を選んで、このブラウザの中（IndexedDB。src/vrmStore.ts）にしまい、
 * アプリ（/walk/）がそれを読んで始める。three・React・地図のパッケージは読まない（入口を軽くするため）。
 *
 * - 「VRM を選ぶ」: 名前が .vrm か・頭が glTF の印かだけを見て、違えば断る（しまっていた物はそのまま）。よければしまい、名前・大きさ・
 *   サムネイル（ファイルの中の画。無ければ出さない）を出す
 * - 「身長を合わせる」と身長（cm）: しまった VRM の設定として、いっしょにしまう（アプリの左上のつまみの初めの値になる）
 * - 「忘れる」: しまった VRM を消す。「VRM なしで入る」（/walk/?vrm=none）は、しまった物を消さずに仮の体で入る
 * - しまう途中で「入る」を押したら、しまい終えてから移る
 * - IndexedDB が使えないときは、ここでは選べないことを出し、選ぶつまみを出さない（アプリの左上で選ぶ今の形で動く）
 * - スクリプトが動かないときは、HTML に書いた案内（入ってから左上で選ぶ）のまま
 * - 戻るでこのページに戻ったとき（アプリで入れ替えた・外したあと）は、しまった物を読み直して出し直す
 */

const DEFAULT_HEIGHT = 1.65

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null

const root = $<HTMLElement>('vrm-pick')
const fileInput = $<HTMLInputElement>('vrm-file')
const forget = $<HTMLButtonElement>('vrm-forget')
const normalize = $<HTMLInputElement>('vrm-normalize')
const height = $<HTMLInputElement>('vrm-height')
const nameText = $<HTMLElement>('vrm-name')
const message = $<HTMLElement>('vrm-message')
const thumb = $<HTMLImageElement>('vrm-thumb')

/** しまった VRM（無ければ null） */
let current: StoredVrm | null = null
/** 出しているサムネイルの blob: の URL */
let thumbUrl: string | null = null
/** しまう・消す途中の仕事（「入る」はこれを待ってから移る） */
let pending: Promise<unknown> | null = null
/** 出し直しの回（古い回のサムネイルは捨てる） */
let drawn = 0

function say(text: string, error = false) {
  if (!message) return
  message.textContent = text
  message.dataset.error = error ? '1' : ''
}

/** しまった VRM を出す（名前・大きさ・サムネイル・設定・「忘れる」） */
function show(v: StoredVrm | null) {
  current = v
  const turn = ++drawn
  if (thumbUrl) URL.revokeObjectURL(thumbUrl)
  thumbUrl = null
  if (thumb) {
    thumb.hidden = true
    thumb.removeAttribute('src')
  }
  root?.setAttribute('data-has-vrm', v ? '1' : '')
  if (nameText) nameText.textContent = v ? `「${v.name}」（${formatSize(v.size)}）` : 'まだ選んでいません（選ばなければ仮の体で入る）'
  if (forget) forget.hidden = !v
  if (normalize) normalize.checked = v ? v.normalize : true
  if (height) {
    height.value = String(Math.round((v ? v.height : DEFAULT_HEIGHT) * 100))
    height.disabled = !(v ? v.normalize : true)
  }
  if (!v || !thumb) return
  void readThumbnail(v.file).then((img) => {
    if (!img || turn !== drawn) return
    thumbUrl = URL.createObjectURL(img)
    thumb.src = thumbUrl
    thumb.hidden = false
  })
}

/** 仕事を「入る」が待てるようにする */
function track<T>(p: Promise<T>): Promise<T> {
  const mine: Promise<unknown> = p.finally(() => {
    if (pending === mine) pending = null
  })
  pending = mine
  return p
}

async function onPick(file: File) {
  const reason = await checkVrmFile(file)
  if (reason) {
    say(`${reason}。.vrm のファイルを選んでください${current ? '（しまってある VRM はそのまま）' : ''}`, true)
    return
  }
  const v: StoredVrm = {
    file,
    name: file.name,
    size: file.size,
    normalize: normalize?.checked ?? true,
    height: heightValue() ?? current?.height ?? DEFAULT_HEIGHT,
    savedAt: Date.now(),
  }
  say('しまっています…')
  try {
    await track(saveStoredVrm(v))
  } catch (e) {
    const quota = e instanceof DOMException && e.name === 'QuotaExceededError'
    say(`このブラウザにしまえませんでした（${quota ? '入れられる量を越えた' : e instanceof Error ? e.message : String(e)}）。入ってから左上の「VRM を選ぶ」で読んでください`, true)
    return
  }
  show(v)
  say('入ると、この VRM で始まる')
}

async function onForget() {
  try {
    await track(clearStoredVrm())
  } catch (e) {
    say(`消せませんでした（${e instanceof Error ? e.message : String(e)}）`, true)
    return
  }
  show(null)
  say('忘れました（このブラウザから消した）')
}

/** 身長の欄の値（m。範囲の外なら null） */
function heightValue(): number | null {
  const cm = Number(height?.value)
  return cm >= 50 && cm <= 250 ? cm / 100 : null
}

function onSettings() {
  if (height && normalize) height.disabled = !normalize.checked
  const h = heightValue()
  if (!current || h === null) return
  const next = { ...current, normalize: normalize?.checked ?? true, height: h }
  current = next
  void track(updateStoredSettings(next.normalize, next.height)).catch((e: unknown) => say(`設定をしまえませんでした（${e instanceof Error ? e.message : String(e)}）`, true))
}

/** しまった物を読み直して出す */
async function refresh() {
  try {
    show(await loadStoredVrm())
  } catch (e) {
    show(null)
    say(`しまった VRM を読めませんでした（${e instanceof Error ? e.message : String(e)}）`, true)
  }
}

async function start() {
  if (!root) return
  if (!(await storeAvailable())) {
    root.dataset.mode = 'unavailable'
    return
  }
  root.dataset.mode = 'ready'
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    // 同じファイルをもう一度選んでも読むように
    fileInput.value = ''
    if (file) void onPick(file)
  })
  forget?.addEventListener('click', () => void onForget())
  normalize?.addEventListener('change', onSettings)
  height?.addEventListener('change', onSettings)
  // しまう途中で「入る」を押したら、しまい終えてから移る
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-enter]')) {
    a.addEventListener('click', (e) => {
      if (!pending || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      void pending.finally(() => location.assign(a.href))
    })
  }
  // 戻るで戻った（bfcache）ときは、アプリで入れ替えた・外した分を出し直す
  addEventListener('pageshow', (e) => {
    if (e.persisted) void refresh()
  })
  await refresh()
}

void start()
