import { SITE } from './town'

/**
 * 日本時間（日之本標準時。UTC+9、夏時間なし）の時計。光・空・町の灯りはこの時刻で決まる。
 *
 * - いまの時刻は Date.now() を UTC+9 にずらして求める（PC のタイムゾーンに関係なく日本時間）。
 *   撮影モード（?capture=1）では Playwright の page.clock が Date を動かすので、それに従う（動画でも同じ光になる）
 * - 時刻・日付の固定は、使う側が起動のときに setLabTime・setLabDate で入れる（kanon-lab は ?time=HH:MM・?date=YYYY-MM-DD。
 *   src/townBinding.ts）。このファイルは使う側の設定を読まない（地図の口。docs/design/map-split.md §4）
 * - デバッグ: __LAB__.setTime('17:30')・__LAB__.setTime('16:30', 120)（16:30 から 120 倍速で進める）・__LAB__.setTime(null)（今の時刻に戻す）、
 *   __LAB__.setDate('2026-12-21')・__LAB__.getTime()
 */

/** "17:30" / "17:30:15" → その日の 0 時からの秒。読めなければ null（警告を出す） */
export function parseTimeOfDay(value: string | null): number | null {
  if (value === null || value === '') return null
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (m) {
    const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
    if (h <= 24 && mi < 60 && s < 60) return Math.min(24 * 3600, h * 3600 + mi * 60 + s)
  }
  console.warn(`[sakurami-cho] 時刻 "${value}" が読めません（例: 17:30）。今の日本時間を使います`)
  return null
}

/** 日付（年・月・日） */
export interface DateParts {
  year: number
  month: number
  day: number
}

/** "2026-10-03" → 年・月・日。読めなければ null（警告を出す） */
export function parseDate(value: string | null): DateParts | null {
  if (value === null || value === '') return null
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim())
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const d = new Date(Date.UTC(year, month - 1, day))
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) return { year, month, day }
  }
  console.warn(`[sakurami-cho] 日付 "${value}" が読めません（例: 2026-10-03）。今日の日付を使います`)
  return null
}

const OFFSET_MS = SITE.utcOffsetHours * 3600_000
const DAY_SEC = 24 * 3600

/** 日本時間のいまの時刻 */
export interface LabTime {
  /** その瞬間の UTC のミリ秒（太陽の位置の計算に使う） */
  utcMs: number
  year: number
  month: number
  day: number
  /** 0〜24 の時（小数。17.5 = 17:30） */
  hours: number
  /** 1 月 1 日が 0 の、年の中の日 */
  dayOfYear: number
}

interface ClockState {
  /** 固定した時刻（その日の 0 時からの秒）。null なら今の時刻 */
  fixedSec: number | null
  fixedDate: DateParts | null
  /** 早送り（fixedSec から speed 倍で進める。0 なら止めたまま） */
  speed: number
  /** 早送りを始めた実時間（Date.now()） */
  speedFrom: number
}

const state: ClockState = {
  fixedSec: null,
  fixedDate: null,
  speed: 0,
  speedFrom: 0,
}

/**
 * 町の時刻に足す時間（秒）。早送り・カット（下の townWarp と、町の中の移動のカット・早送り character/ride/warp.ts の warpClock。docs/design/town.md §7 の 117）が足す。
 * 光・空・町の灯り（labNow）と交通の時計（world/outdoor/transit/clock.ts）の両方に入るので、早送り・カットのあとも
 * ゴンドラの位置・町の時刻・交通がそろう。時刻を固定し直す（setLabTime）と 0 に戻る
 */
export const clockWarp = { offsetSec: 0 }

/* -------------------------------------------------------------------------- */
/* 早送り・カット（町の時計の持ち物。docs/design/map-split.md §4・§7「5-2 で作った形」）                    */
/* -------------------------------------------------------------------------- */

/** 早送り・カットの持ち主（何でもよい印。=== で比べるだけ。kanon-lab は Character。character/ride/warp.ts） */
export type WarpOwner = unknown

/** カットの、持ち主ごとの次のコマに足す秒（持ち主ごとに 1 つを使い回す） */
interface PendingCut {
  owner: WarpOwner
  sec: number
}

const warpState = {
  /** 早送り（描画の時計で start から dur 秒のあいだに、町の時刻へ total − dur 秒を足す。owner = 頼んだ人。1 つだけ） */
  warp: null as null | { owner: WarpOwner; start: number; dur: number; total: number; applied: number },
  /** カット（次のコマの初めに町の時刻へ足す秒。持ち主ごと） */
  cuts: [] as PendingCut[],
  /** 今の描画の時計（apply で受けた t） */
  t: 0,
  /** cut・fast で足した秒の合計（呼び出し元が前の値との差で区間の足した時間を数える） */
  added: 0,
}

/** owner のカットの入れ物（初めて頼んだときに作る） */
function pendingCut(owner: WarpOwner) {
  for (let i = 0; i < warpState.cuts.length; i++) if (warpState.cuts[i].owner === owner) return warpState.cuts[i]
  const c: PendingCut = { owner, sec: 0 }
  warpState.cuts.push(c)
  return c
}

/** なめらかな 0 → 1（両端で傾きが 0。早送りの速さの上げ下げ） */
const ease = (x: number) => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * k * (k * (k * 6 - 15) + 10)
}

/**
 * 町の時計の早送り・カット。町の時計は 1 つなので、仕組みもモジュールに 1 つ。持ち主（owner）は何でもよい印で、だれが進めてよいか・
 * いつ進めるかは使う側が決める（kanon-lab は character/ride/warp.ts の setWarpPermit・advanceBy）。足した時間は clockWarp に入る。
 * 描画の時計で進めるので、撮影でも毎回同じ画になる
 */
export const townWarp = {
  /** owner のカット: 次のコマの初め（apply）に、町の時刻へ sec 秒を足す（同じ持ち主の分は足し合わせる） */
  cut(owner: WarpOwner, sec: number) {
    pendingCut(owner).sec += sec
  },
  /**
   * owner の早送り: 今の描画の時計（前の apply の t）から dur 秒のあいだに、町の時刻へ total − dur 秒をなめらかに足す
   * （dur 秒たつと、ちょうど total 秒進んだことになる）。ほかの人の早送りの途中なら始めずに false（頼んだ側はそのまま流す。
   * 前の人の早送りを黙って上書きしない）。同じ持ち主の早送りの途中なら、新しい早送りに替える
   */
  fast(owner: WarpOwner, dur: number, total: number) {
    if (warpState.warp !== null && warpState.warp.owner !== owner) return false
    warpState.warp = { owner, start: warpState.t, dur, total, applied: 0 }
    return true
  },
  /** owner の早送り・カットをやめる（ほかの人の分は残す。足し終えた分はそのまま） */
  cancel(owner: WarpOwner) {
    if (warpState.warp?.owner === owner) warpState.warp = null
    for (let i = 0; i < warpState.cuts.length; i++) if (warpState.cuts[i].owner === owner) warpState.cuts[i].sec = 0
  },
  /** 毎コマ（町の時刻を決める前。町の毎コマの初め town.begin。world/createTown.ts）: 早送り・カットの分を町の時刻へ足す */
  apply(t: number) {
    const st = warpState
    st.t = t
    for (let i = 0; i < st.cuts.length; i++) {
      const c = st.cuts[i]
      if (c.sec > 0) {
        clockWarp.offsetSec += c.sec
        st.added += c.sec
        c.sec = 0
      }
    }
    const w = st.warp
    if (!w) return
    const k = (t - w.start) / w.dur
    const want = (w.total - w.dur) * ease(k)
    clockWarp.offsetSec += want - w.applied
    st.added += want - w.applied
    w.applied = want
    if (k >= 1) st.warp = null
  },
  /** 今の早送りの倍率（そのままなら 1。早送りの途中は、町の時刻の進み / 描画の時計の進み） */
  rate() {
    const w = warpState.warp
    if (!w) return 1
    const k = (warpState.t - w.start) / w.dur
    // ease の傾き（30k²(1-k)²）から
    const x = Math.min(1, Math.max(0, k))
    return 1 + ((w.total - w.dur) / w.dur) * 30 * x * x * (1 - x) * (1 - x)
  },
  /** cut・fast で足した秒の合計（呼び出し元が前の値との差で区間の足した時間を数える。clockWarp へ直に足した分は数えない） */
  added() {
    return warpState.added
  },
  /** 早送り・カットの途中か（誰の分でも） */
  busy() {
    if (warpState.warp !== null) return true
    for (let i = 0; i < warpState.cuts.length; i++) if (warpState.cuts[i].sec > 0) return true
    return false
  },
  /** 確かめ用の中の状態（書き換えない。kanon-lab は ?debug の __warp。src/kanon/index.ts） */
  debug: warpState as Readonly<typeof warpState>,
}

const two = (n: number) => String(n).padStart(2, '0')

/** いまの日本時間（固定・早送りの指定があればそれに従う） */
export function labNow(out?: LabTime): LabTime {
  const now = Date.now()
  const jst = new Date(now + OFFSET_MS)
  let year = jst.getUTCFullYear()
  let month = jst.getUTCMonth() + 1
  let day = jst.getUTCDate()
  let sec = jst.getUTCHours() * 3600 + jst.getUTCMinutes() * 60 + jst.getUTCSeconds() + jst.getUTCMilliseconds() / 1000
  if (state.fixedSec !== null) {
    sec = state.fixedSec + (state.speed > 0 ? ((now - state.speedFrom) / 1000) * state.speed : 0)
  }
  sec += clockWarp.offsetSec
  if (state.fixedDate) ({ year, month, day } = state.fixedDate)
  // 早送り（と、観覧車の早送り・カットで足した時間）で日をまたいだら、日付も進める
  let dayShift = Math.floor(sec / DAY_SEC)
  if ((state.fixedSec !== null && state.speed > 0 && sec >= DAY_SEC) || (clockWarp.offsetSec !== 0 && (sec >= DAY_SEC || sec < 0))) sec -= dayShift * DAY_SEC
  else dayShift = 0
  const dayStartUtc = Date.UTC(year, month - 1, day + dayShift) - OFFSET_MS
  const utcMs = dayStartUtc + Math.min(sec, DAY_SEC) * 1000
  const d = new Date(dayStartUtc + OFFSET_MS)
  const t = out ?? ({} as LabTime)
  t.utcMs = utcMs
  t.year = d.getUTCFullYear()
  t.month = d.getUTCMonth() + 1
  t.day = d.getUTCDate()
  t.hours = Math.min(sec, DAY_SEC) / 3600
  t.dayOfYear = Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(t.year, 0, 1)) / 86400_000)
  return t
}

/**
 * 時刻を固定する（'17:30' など。読み終えた秒（その日の 0 時から）でもよい。null で今の時刻に戻す）。
 * speed を付けると、その時刻から speed 倍の速さで進める（夕焼けの確認など）
 */
export function setLabTime(value: string | number | null, speed = 0) {
  clockWarp.offsetSec = 0
  if (value === null) {
    state.fixedSec = null
    state.speed = 0
    return
  }
  const sec = typeof value === 'number' ? (Number.isFinite(value) ? Math.min(DAY_SEC, Math.max(0, value)) : null) : parseTimeOfDay(value)
  if (sec === null) return
  state.fixedSec = sec
  state.speed = Number.isFinite(speed) && speed > 0 ? speed : 0
  state.speedFrom = Date.now()
}

/** 時刻が止まっているか（?time= や setTime で固定して、早送りしていない）。止まっている間も、交通は撮影の時計で動かす（world/outdoor/transit/clock.ts） */
export function labClockFrozen() {
  return state.fixedSec !== null && state.speed === 0
}

/** 日付を固定する（'2026-12-21' など。読み終えた年・月・日でもよい。null で今日に戻す） */
export function setLabDate(value: string | DateParts | null) {
  state.fixedDate = value === null ? null : typeof value === 'string' ? (parseDate(value) ?? state.fixedDate) : { ...value }
}

/** 表示用: "2026-10-03 17:30:00" */
export function formatLabTime(t: LabTime): string {
  const sec = Math.floor(t.hours * 3600)
  return `${t.year}-${two(t.month)}-${two(t.day)} ${two(Math.floor(sec / 3600) % 24)}:${two(Math.floor(sec / 60) % 60)}:${two(sec % 60)}`
}

/** 設定資料（第5章）の時間帯の名前 */
export function timeOfDayName(hours: number): string {
  if (hours < 3) return '深夜'
  if (hours < 5) return '未明'
  if (hours < 7) return '早朝'
  if (hours < 9) return '朝'
  if (hours < 11) return '午前'
  if (hours < 14) return '昼'
  if (hours < 16) return '午後'
  if (hours < 18) return '夕方'
  if (hours < 20) return '宵'
  return '夜'
}
