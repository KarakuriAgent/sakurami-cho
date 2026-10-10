/**
 * 町の時計の早送り・カット（core/clock.ts の townWarp。docs/design/map-split.md §7「5-2 で作った形」）のテスト:
 *   - カットは次の apply で町の時刻へ足す・早送りは dur 秒でちょうど total 秒進む（途中はなめらか。倍率 rate はその傾き）
 *   - 持ち主は何でもよい印。ほかの人の早送りの途中に頼んだ早送りは false（前の人の早送りを上書きしない）。やめる（cancel）のは自分の分だけ
 * 仕組みはモジュールに 1 つなので、テストごとに新しい持ち主を使い、足した時間は前の値との差で見る
 */
import { describe, expect, test } from 'bun:test'
import { clockWarp, townWarp } from '../core/clock.ts'

/** fn のあいだに町の時刻へ足した秒と、townWarp.added() の増え */
function added(fn: () => void) {
  const off0 = clockWarp.offsetSec
  const add0 = townWarp.added()
  fn()
  return { offset: clockWarp.offsetSec - off0, added: townWarp.added() - add0 }
}

describe('townWarp（町の時計の早送り・カット）', () => {
  test('カットは次の apply で足し、早送りは dur 秒でちょうど total 秒進む', () => {
    const a = { name: 'a' }
    townWarp.apply(100)
    townWarp.cut(a, 30)
    townWarp.cut(a, 12)
    expect(townWarp.busy()).toBe(true)
    expect(added(() => townWarp.apply(100.5))).toEqual({ offset: 42, added: 42 })
    expect(townWarp.busy()).toBe(false)

    expect(townWarp.fast(a, 5, 65)).toBe(true)
    expect(townWarp.rate()).toBe(1)
    // 半ばで (65 − 5) × ease(0.5) = 30 秒。倍率は 1 + (60 / 5) × 30 × 0.5² × 0.5²
    expect(added(() => townWarp.apply(103))).toEqual({ offset: 30, added: 30 })
    expect(townWarp.rate()).toBe(1 + 12 * 30 * 0.0625)
    expect(added(() => townWarp.apply(105.5))).toEqual({ offset: 30, added: 30 })
    expect(townWarp.busy()).toBe(false)
    expect(townWarp.rate()).toBe(1)
  })

  test('ほかの人の早送りの途中に頼んだ早送りは false で、前の人の早送りはそのまま。やめるのは自分の分だけ', () => {
    const a = { name: 'a' }
    const b = { name: 'b' }
    townWarp.apply(200)
    expect(townWarp.fast(a, 4, 44)).toBe(true)
    expect(townWarp.fast(b, 2, 100)).toBe(false)
    expect(townWarp.debug.warp?.owner).toBe(a)
    townWarp.cut(b, 7)
    townWarp.cancel(b)
    expect(townWarp.debug.warp?.owner).toBe(a)
    // b のカットは消え、a の早送りは進む（半ばで 20 秒）
    expect(added(() => townWarp.apply(202))).toEqual({ offset: 20, added: 20 })
    // 同じ持ち主なら新しい早送りに替える
    expect(townWarp.fast(a, 3, 33)).toBe(true)
    expect(townWarp.debug.warp).toMatchObject({ owner: a, start: 202, dur: 3, total: 33, applied: 0 })
    townWarp.cut(a, 5)
    townWarp.cut(b, 9)
    townWarp.cancel(a)
    expect(townWarp.debug.warp).toBe(null)
    expect(added(() => townWarp.apply(203))).toEqual({ offset: 9, added: 9 })
    expect(townWarp.busy()).toBe(false)
  })
})
