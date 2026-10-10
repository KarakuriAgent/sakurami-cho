import { TOWN_QUALITY, type TownQualityName } from 'sakurami-cho/core'

/**
 * 画質（例のアプリ。URL の引数で決め、町を作るときに createTown へ渡す。src/town.ts）。
 * 画質はラボ・遠景を作るときに決まり、町は 1 ページに 1 回しか作れない（createTown の 2 回目は例外）ので、変えるときは引数を付けてページごと読み込み直す。
 * 引数の名前と値は kanon-lab と同じ（kanon-lab の README の URL の引数）:
 *
 * - ?quality=low … ラボと光の重い処理（太陽の影・床の映り込み・星やほこりの数など）を落とす（地図の quality。省けば high）。
 *   例のアプリでは描く細かさ（dpr）も 1 にし、Canvas の antialias も切る（仮。App.tsx）
 * - ?town=low|high … 町の画質の段（地図の townQuality。core の TOWN_QUALITY。省けば ?quality=low なら low、ほかは high）。
 *   撮影の段の film・final も URL では選べる（画面のつまみは low・high だけ。仮）
 *
 * 画面のつまみ（ui/TownPanel.tsx）で選ぶと、引数を付け替えて読み込み直す（ほかの引数 ?debug などはそのまま。止めた時刻と日付は ?time・?date で引き継ぐ。
 * VRM・歩く人の位置は初めに戻る。仮）
 */

export type LabQuality = 'high' | 'low'

export interface Quality {
  /** ラボと光（地図の quality） */
  lab: LabQuality
  /** 町の画質の段（地図の townQuality） */
  town: TownQualityName
}

const params = new URLSearchParams(location.search)

const TOWN_NAMES = Object.keys(TOWN_QUALITY) as TownQualityName[]

/** ?town を省いたときの町の段（kanon-lab と同じ: ?quality=low なら low、ほかは high） */
const defaultTown = (lab: LabQuality): TownQualityName => (lab === 'low' ? 'low' : 'high')

function parse(): Quality {
  const lab: LabQuality = params.get('quality') === 'low' ? 'low' : 'high'
  const t = params.get('town')
  const town = t !== null && (TOWN_NAMES as string[]).includes(t) ? (t as TownQualityName) : defaultTown(lab)
  return { lab, town }
}

/** このページの画質（URL の引数から。読み込んだあとは変わらない） */
export const QUALITY: Readonly<Quality> = Object.freeze(parse())

/** 画面のつまみで選べる物（町の段は low・high。URL で film・final を選んでいれば、それも出す） */
export const LAB_CHOICES: readonly { id: LabQuality; label: string }[] = [
  { id: 'high', label: '高い' },
  { id: 'low', label: '低い' },
]
export const TOWN_CHOICES: readonly { id: TownQualityName; label: string }[] = [
  { id: 'high', label: '高い' },
  { id: 'low', label: '低い' },
  ...(QUALITY.town === 'high' || QUALITY.town === 'low' ? [] : [{ id: QUALITY.town, label: `${QUALITY.town}（URL）` }]),
]

/**
 * 画質 next にした URL（今の URL の引数を付け替える。既定と同じ値は書かない）。carry は引き継ぐ時刻・日付（null なら外す）
 */
export function qualityUrl(next: Quality, carry: { time: string | null; date: string | null }): string {
  const url = new URL(location.href)
  const p = url.searchParams
  p.delete('quality')
  p.delete('town')
  if (next.lab === 'low') p.set('quality', 'low')
  if (next.town !== defaultTown(next.lab)) p.set('town', next.town)
  for (const [k, v] of [['time', carry.time], ['date', carry.date]] as const) {
    if (v === null) p.delete(k)
    else p.set(k, v)
  }
  return url.toString()
}

/** 画質を変えて読み込み直す（同じなら何もしない。読み込み直すなら true） */
export function reloadWithQuality(next: Quality, carry: { time: string | null; date: string | null }): boolean {
  if (next.lab === QUALITY.lab && next.town === QUALITY.town) return false
  location.assign(qualityUrl(next, carry))
  return true
}
