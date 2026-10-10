import { parseDate, parseTimeOfDay, timeOfDayName } from 'sakurami-cho/core'
import { traveling } from 'sakurami-cho/character'
import { town, walker } from './town'
import { warpUi } from './teleport'

/**
 * 町の時刻のつまみ（例のアプリ。地図の town.setTime・town.setDate）。太陽・空・町の灯り・交通は、この時刻（日本時間）で決まる。
 * 町の時刻と日付を変える口（town.setTime・town.setDate）を呼ぶのはこのファイルだけ（見張り）。
 *
 * - 今の時刻（now）: 何も止めていない（地図の既定。PC の時計の日本時間で進む）
 * - 進める（run）: 選んだ時刻から speed 倍で進める（1 秒で 1 秒・1 分・10 分・1 時間）。つまみを動かすと、その時刻から同じ速さで進む
 *   （今の時刻のときは 1 倍で進む）
 * - 止める（stop）: 今の時刻で止める。?time=HH:MM で開いたときも止めて始める
 * - 今に戻す: 時刻・日付の固定をやめる（旅程のカット・早送りで足した時間も消える）
 * - 日付: 選んだ日付で止める（?date=YYYY-MM-DD で開いたときも）。時刻を動かすと、今出している日付でも止める（旅程の早送りで日をまたいだ分を
 *   消さないように。仮）
 *
 * 旅程の途中（カット・早送りが町の時刻に時間を足し、乗る便は時刻表で決まる）・乗り物を待つ・乗っている間と、ワープの暗転の間は、時刻を変えない（仮）。
 * 早送り・カットで足した時間は、地図の町の時刻（town.sun.time）にもう入っているので、つまみはそれを読んでそこから動かす
 * （地図の setTime は足した時間を 0 に戻すので、今の時刻を渡し直す）
 */

export type ClockMode = 'now' | 'run' | 'stop'

/** 進める速さの選び（1 秒に進む町の秒） */
export const SPEED_CHOICES: readonly { speed: number; label: string }[] = [
  { speed: 1, label: '1 秒で 1 秒（実時間）' },
  { speed: 60, label: '1 秒で 1 分' },
  { speed: 600, label: '1 秒で 10 分' },
  { speed: 3600, label: '1 秒で 1 時間' },
]

/** 「進める」の既定の速さ（止めたあと） */
const DEFAULT_RUN_SPEED = 60
/** 今の時刻のときに、町の時刻が実時間からずれていると見る秒（旅程で足した時間など。「今に戻す」を出す） */
const DRIFT_SEC = 60

export interface ClockUi {
  mode: ClockMode
  /** 進める速さ（now は 1、stop は「進める」を押したときの速さ） */
  speed: number
  /** 町の時刻（その日の 0 時からの分。つまみの値）と、HH:MM・時間帯の名前・日付（YYYY-MM-DD） */
  minutes: number
  label: string
  period: string
  date: string
  /** 日付を止めているか */
  dateFixed: boolean
  /** 今の時刻のときに、旅程で足した時間などで実時間からずれているか */
  drift: boolean
  /** 時刻を変えられない理由（旅程の途中など）。変えられるなら null */
  locked: string | null
  /** 案内の字（読めない日付など） */
  message: string | null
}

const two = (n: number) => String(n).padStart(2, '0')

let mode: ClockMode = 'now'
let speed = 1
let dateFixed = false

let ui: ClockUi = { mode, speed, minutes: 0, label: '--:--', period: '', date: '', dateFixed, drift: false, locked: null, message: null }
const listeners = new Set<() => void>()

function set(patch: Partial<ClockUi>) {
  ui = { ...ui, ...patch }
  for (const fn of listeners) fn()
}

/** 今の様子（useSyncExternalStore の getSnapshot） */
export function clockUi(): ClockUi {
  return ui
}

/** 様子が変わったら呼ぶ（やめる関数を返す） */
export function subscribeClock(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 時刻を変えられない理由（変えられるなら null） */
function lockReason(): string | null {
  if (warpUi().fade !== 'none') return 'ワープの途中は時刻を変えられません'
  if (walker.ride.phase !== 'none') return '乗り物を待つ・乗っている間は時刻を変えられません（降りてから）'
  if (traveling(walker)) return '旅程の途中は時刻を変えられません（着くか、取り消してから）'
  return null
}

/** 地図の町の時刻（早送り・カットで足した時間も入った物）: その日の 0 時からの秒と日付 */
function townNow() {
  const t = town.sun.time
  return { sec: Math.min(24 * 3600 - 1, Math.max(0, t.hours * 3600)), date: `${t.year}-${two(t.month)}-${two(t.day)}` }
}

/** 時刻を sec に固定して speed 倍で進める（0 で止める）。日付もそのとき出している日付で止める */
function apply(sec: number, nextSpeed: number, date: string) {
  town.setTime(sec, nextSpeed)
  if (!dateFixed) {
    town.setDate(date)
    dateFixed = true
  }
}

/** だめな理由を様子に出して返す */
function fail(message: string): string {
  set({ message })
  return message
}

/** つまみ: 町の時刻をその日の minutes 分にする（今の速さのまま。今の時刻のときは 1 倍で進める）。変えたら null、だめなら理由 */
export function setClockMinutes(minutes: number): string | null {
  const lock = lockReason()
  if (lock) return fail(lock)
  const sec = Math.min(24 * 60 - 1, Math.max(0, Math.round(minutes))) * 60
  if (mode === 'now') {
    mode = 'run'
    speed = 1
  }
  apply(sec, mode === 'run' ? speed : 0, townNow().date)
  refresh({ message: null })
  return null
}

/** 進める（今の町の時刻から、s 倍。省けば選んでいる速さ）。変えたら null、だめなら理由 */
export function runClock(s: number = speed): string | null {
  const lock = lockReason()
  if (lock) return fail(lock)
  const now = townNow()
  speed = s > 0 ? s : DEFAULT_RUN_SPEED
  mode = 'run'
  apply(now.sec, speed, now.date)
  refresh({ message: null })
  return null
}

/** 止める（今の町の時刻で）。変えたら null、だめなら理由 */
export function stopClock(): string | null {
  const lock = lockReason()
  if (lock) return fail(lock)
  const now = townNow()
  mode = 'stop'
  if (speed === 1) speed = DEFAULT_RUN_SPEED
  apply(now.sec, 0, now.date)
  refresh({ message: null })
  return null
}

/** 進める速さを選ぶ（進めている間ならすぐその速さに。止めている間は次に「進める」を押したときの速さ） */
export function setClockSpeed(s: number): string | null {
  if (mode === 'stop') {
    speed = s
    refresh({ message: null })
    return null
  }
  return runClock(s)
}

/** 今に戻す（時刻・日付の固定をやめる。旅程で足した時間も消える）。変えたら null、だめなら理由 */
export function resetClock(): string | null {
  const lock = lockReason()
  if (lock) return fail(lock)
  town.setTime(null)
  town.setDate(null)
  mode = 'now'
  speed = 1
  dateFixed = false
  refresh({ message: null })
  return null
}

/** 日付を YYYY-MM-DD で止める（時刻はそのまま）。変えたら null、だめなら理由 */
export function setClockDate(value: string): string | null {
  const lock = lockReason()
  if (lock) return fail(lock)
  if (!parseDate(value)) return fail(`日付 "${value}" が読めません（例: 2026-10-03）`)
  town.setDate(value)
  dateFixed = true
  refresh({ message: null })
  return null
}

/**
 * 読み込み直すときに引き継ぐ時刻と日付（?time・?date の値。今の時刻なら null。進めている間も、今の時刻で止めて引き継ぐ。画質の切り替え quality.ts が使う）
 */
export function clockCarry(): { time: string | null; date: string | null } {
  const now = townNow()
  const m = Math.floor(now.sec / 60)
  return { time: mode === 'now' ? null : `${two(Math.floor(m / 60))}:${two(m % 60)}`, date: dateFixed ? now.date : null }
}

/** 様子を地図の町の時刻から作り直す（変わったときだけ知らせる） */
function refresh(patch: Partial<ClockUi> = {}) {
  const t = town.sun.time
  const now = townNow()
  const minutes = Math.floor(now.sec / 60)
  const next: ClockUi = {
    ...ui,
    mode,
    speed,
    minutes,
    label: `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`,
    period: timeOfDayName(t.hours),
    date: now.date,
    dateFixed,
    drift: mode === 'now' && Math.abs(t.utcMs - Date.now()) > DRIFT_SEC * 1000,
    locked: lockReason(),
    ...patch,
  }
  const changed = (Object.keys(next) as (keyof ClockUi)[]).some((k) => next[k] !== ui[k])
  if (changed) set(next)
}

/** 毎コマ（scene/Walker.tsx。町の時刻を決めたあと）: 時刻・日付・変えられるかを様子へ */
export function updateClock() {
  refresh()
}

/* 確かめ用の URL の引数（?time=HH:MM で時刻を止める・?date=YYYY-MM-DD で日付を止める。読めなければ地図が warning を出して今のまま） */
const params = new URLSearchParams(location.search)
const startTime = params.get('time')
const startSec = startTime ? parseTimeOfDay(startTime) : null
if (startSec !== null) {
  town.setTime(startSec)
  mode = 'stop'
  speed = DEFAULT_RUN_SPEED
}
const startDate = params.get('date')
if (startDate && parseDate(startDate)) {
  town.setDate(startDate)
  dateFixed = true
}
