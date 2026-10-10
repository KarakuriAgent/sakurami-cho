import { clockWarp, labClockFrozen } from '../../../core/clock'
import { outdoor } from '../../environment/daylight'
import { townOptions } from '../../townHost'

/**
 * 交通の時計（その日の 0 時からの秒）。電車・ケーブルカー・船・観覧車・信号は、この時計から位置を決める（毎回同じ画になる）。
 *
 * - ふだん（配信。時刻が進む）: 町の時刻そのもの
 * - 時刻を止めている（`?time=`・撮影の前書きの `time`）・描画の時計で進める（地図の口の clock.stepped。kanon-lab は撮影 `?capture=1`）:
 *   準備ができた（clock.ready()。kanon-lab は `__LAB_READY__`）ときの町の時刻から、描画の時計（撮影は 1 コマずつ決まった秒だけ進む）で進める。
 *   準備ができる前は止めておく（読み込みの長さで位置が変わらないように）
 * - 止めた時刻を途中で変えた（`env` の時刻・`__LAB__.setTime`）ら、その時刻からやり直す
 *
 * 運転の日は 4:00 から次の日の 4:00 まで（`serviceSec`。24 時を過ぎた終電・終発も同じ日の運転として扱う）。
 *
 * 観覧車の早送り・カットが町の時刻に足した時間（clockWarp。core/clock.ts）は、町の時刻と同じだけ交通の時計にも入る
 * （時刻を止めているときも、止めた時刻からの経過に足す。足した分を「止めた時刻が変わった」とはみなさない）。
 */
export const transitClock = {
  /** その日の 0 時からの秒（0〜86400） */
  sec: 0,
  /** 運転の日の秒（4:00 = 14400 〜 28:00 = 100800） */
  serviceSec: 4 * 3600,
}

let base = -1
let lastHours = -1
let elapsed = 0

/** 毎コマ（町の毎コマの初め town.begin から。world/createTown.ts。町の時刻を決めたあと・花音を動かす前。dt = 描画の時計の秒） */
export function updateTransitClock(dt: number) {
  const warp = clockWarp.offsetSec
  // 足した時間を除いた町の時刻（止めた時刻が変わったかを見る）
  const hours = outdoor.time.hours - warp / 3600
  const clock = townOptions().clock
  const frozen = clock.stepped || labClockFrozen()
  let sec: number
  if (!frozen) {
    sec = outdoor.time.hours * 3600
    base = -1
  } else {
    const ready = clock.ready()
    // 止めた時刻が変わった（撮影中に時刻を変えた）: やり直す
    const changed = Math.abs((((hours - lastHours) % 24) + 36) % 24 - 12) > 1 / 3600
    if (base < 0 || (!clock.stepped && changed)) {
      base = hours * 3600
      elapsed = 0
    }
    if (ready) elapsed += Math.min(Math.max(dt, 0), 1)
    sec = base + elapsed + warp
  }
  lastHours = hours
  sec = ((sec % 86400) + 86400) % 86400
  transitClock.sec = sec
  transitClock.serviceSec = sec < 4 * 3600 ? sec + 86400 : sec
}
