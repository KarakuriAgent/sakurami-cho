import type { Character } from '../avatar/character'
import { clockWarp, townWarp } from '../../core/clock'

/**
 * 乗り物に乗っている間・待っている間の時間の扱い（観覧車・ケーブル共通。docs/design/town.md §7 の 117）。
 * real = そのまま流す、cut = 飛ばす（次のコマの初めに町の時刻へ足す）、fast = 早送り（決まった長さで、町の時刻・交通・空も一緒に速く進める）。
 *
 * ここに置くのは「だれが進めてよいか」と「いつ・どれだけ進めるか」だけ。早送り・カットの状態と、町の時刻へ足す仕組みは町の時計
 * （core/clock.ts の townWarp。5-2）の持ち物で、足した時間は clockWarp に入る（交通の時計も同じだけ進む）。
 *
 * 時計は町に 1 つなので、進めてよい人（早送り・カットの持ち主になれる人）は使う側が決める（setWarpPermit。kanon-lab は花音だけ。src/townBinding.ts）。
 * 許されていない人の早送り・カットは real として扱う（時計を進めない）。決めていなければ誰も進めない。
 * 早送り・カットは頼んだ人の物で、やめる（cancelWarp）ときは自分の分だけ消す（docs/design/map-split.md §5 の「段 3 の作りの決めごと」）。
 * ほかの人の早送りの途中に頼んだ早送りも real として扱う（前の人の早送りを上書きしない。§7「段 5 の作りの決めごと」）
 */

export type RideTime = 'real' | 'cut' | 'fast'

/** 時計を進めてよい人（使う側が決める。null = 誰も進めない） */
let permit: ((ch: Character) => boolean) | null = null
let warnedDenied = false
let warnedBusy = false

/** 時計を進めてよい人を決める（使う側が起動のときに 1 回。kanon-lab は src/townBinding.ts で花音だけ） */
export function setWarpPermit(fn: ((ch: Character) => boolean) | null) {
  permit = fn
}

/** ch が時計を進めてよいか */
export function mayWarp(ch: Character) {
  return permit !== null && permit(ch)
}

/** 許されていない人が早送り・カットを頼んだ（real として扱う。初めの 1 回だけ知らせる） */
function denied(ch: Character) {
  if (warnedDenied) return
  warnedDenied = true
  console.warn(`[sakurami-cho] ${ch.id} は時計を進められないので、早送り・カットはそのまま流します（setWarpPermit）`)
}

/**
 * ch の乗り物を delta 秒先へ進める。real は何もしない（呼び出し元が着くまで待つ）。cut は次のコマで町の時刻へ足す。fast は duration 秒（か speed 倍）で早送りする。
 * 時計を進めてよくない人（setWarpPermit）の cut・fast と、ほかの人の早送りの途中に頼んだ fast は real として扱う。戻り値: 進める秒と、かかる長さ（秒）
 */
export function advanceBy(ch: Character, delta: number, time: RideTime, duration: number | null, speed: number | null, defaultFast = 15) {
  if (time === 'real' || delta < 0.05) return { delta, duration: delta }
  if (!mayWarp(ch)) {
    denied(ch)
    return { delta, duration: delta }
  }
  if (time === 'cut') {
    townWarp.cut(ch, delta)
    return { delta, duration: 0 }
  }
  // 早送り: 長さ（duration）か倍率（speed）から。そのままより遅くはしない
  const dur = Math.min(delta, duration ?? (speed ? delta / speed : defaultFast))
  if (dur >= delta - 0.05) return { delta, duration: delta }
  if (!townWarp.fast(ch, dur, delta)) {
    if (!warnedBusy) {
      warnedBusy = true
      console.warn(`[sakurami-cho] ほかの人の早送りの途中なので、${ch.id} の早送りはそのまま流します`)
    }
    return { delta, duration: delta }
  }
  return { delta, duration: dur }
}

/** ch の早送り・カットをやめる（乗るのをやめたとき。ほかの人の分は残す） */
export function cancelWarp(ch: Character) {
  townWarp.cancel(ch)
}

/**
 * 町の時刻へ sec 秒をすぐ足す（町の中の移動のカット・早送り。character/avatar/travel.ts）。時計を進めてよくない人なら足さずに false。
 * ここで足した分は townWarp.added() に数えない（呼び出し元が数える）
 */
export function warpClock(ch: Character, sec: number) {
  if (!mayWarp(ch)) {
    denied(ch)
    return false
  }
  clockWarp.offsetSec += sec
  return true
}
