/**
 * 運転の決まり（ダイヤ）と、走り方（加速・最高速度・減速・停車）の計算。どれも時刻だけから決まる（同じ時刻なら同じ位置）。
 *
 * - 走り方（`RunProfile`）: 停車する所（線の上の長さ）と停車の秒、最高速度・加速度・減速度・速度の制限の区間から、
 *   発車からの秒 → 線の上の長さ の表を 0.5 秒ごとに作る（1 回だけ）
 * - ダイヤ（`Timetable`）: 起点を出る時刻の並び（時間帯ごとの間隔）。列車・電車・船は「起点を出た時刻」ごとの 1 本の運転で、
 *   今の時刻に走っている運転だけを描く
 *
 * 運転の時間・本数の決め方は docs/design/town.md の §15。
 */

export interface RunSpec {
  /** 停車する所（線の上の長さ。昇順。最初 = 起点、最後 = 終点） */
  stops: number[]
  /** 途中の停車の秒（起点・終点は含まない） */
  dwell: number | number[]
  /** 最高速度（m/s）・加速度・減速度（m/s²） */
  vmax: number
  accel: number
  decel: number
  /** 速度の制限 [始まり, 終わり, m/s]（線の上の長さ） */
  limits?: [number, number, number][]
}

/** 発車からの秒 → 線の上の長さ（起点からの長さ。0.5 秒ごと） */
export class RunProfile {
  readonly dt = 0.5
  readonly d: Float32Array
  readonly duration: number
  /** 停車する所に着いた秒（stops と同じ順） */
  readonly arrivals: number[]

  constructor(spec: RunSpec) {
    const { stops, vmax, accel, decel } = spec
    const limits = spec.limits ?? []
    const dt = this.dt
    const out: number[] = [stops[0]]
    const arrivals = [0]
    let t = 0
    // その所で許される速さ（先の制限へ減速が間に合う速さ）
    const allowed = (d: number) => {
      let v = vmax
      for (const [a, b, lim] of limits) {
        if (d >= a && d <= b) v = Math.min(v, lim)
        else if (d < a) v = Math.min(v, Math.sqrt(lim * lim + 2 * decel * (a - d)))
      }
      return v
    }
    for (let k = 1; k < stops.length; k++) {
      const end = stops[k]
      let d = stops[k - 1]
      let v = 0
      let guard = 0
      while (end - d > 0.02 && guard++ < 200000) {
        const rest = end - d
        const brake = Math.sqrt(2 * decel * rest)
        const target = Math.min(allowed(d), brake)
        if (v < target) v = Math.min(target, v + accel * dt)
        else v = Math.max(Math.min(target, v), v - decel * dt * 1.5)
        // 最後は止まる所へ寄せる（とても遅い速さで残らない）
        const step = Math.max(v * dt, Math.min(rest, 0.05))
        d = Math.min(end, d + step)
        t += dt
        out.push(d)
      }
      arrivals.push(t)
      if (k < stops.length - 1) {
        const w = Array.isArray(spec.dwell) ? (spec.dwell[k - 1] ?? 20) : spec.dwell
        const n = Math.round(w / dt)
        for (let i = 0; i < n; i++) out.push(end)
        t += n * dt
      }
    }
    this.d = Float32Array.from(out)
    this.duration = (out.length - 1) * dt
    this.arrivals = arrivals
  }

  /** 発車から t 秒の、線の上の長さ（前は起点、後は終点で止まる） */
  at(t: number) {
    if (t <= 0) return this.d[0]
    const f = t / this.dt
    const i = Math.floor(f)
    if (i >= this.d.length - 1) return this.d[this.d.length - 1]
    return this.d[i] + (this.d[i + 1] - this.d[i]) * (f - i)
  }

  /** 発車から t 秒のときの速さ（m/s） */
  speed(t: number) {
    const i = Math.max(0, Math.min(this.d.length - 2, Math.floor(t / this.dt)))
    return (this.d[i + 1] - this.d[i]) / this.dt
  }

  /**
   * 全体の時間が target 秒になる最高速度で作る（緑電・運河バスの表の所要分に合わせる）。最高速度は lo〜hi m/s の中で探す
   */
  static fit(spec: Omit<RunSpec, 'vmax'>, target: number, lo = 3, hi = 22) {
    let a = lo
    let b = hi
    let best = new RunProfile({ ...spec, vmax: hi })
    if (best.duration > target) return best
    for (let i = 0; i < 18; i++) {
      const m = (a + b) / 2
      const p = new RunProfile({ ...spec, vmax: m })
      if (p.duration > target) a = m
      else {
        b = m
        best = p
      }
    }
    return best
  }
}

/** 時間帯ごとの発車の間隔: [始まりの秒（運転の日）, 間隔の秒]。最後の要素の始まり = 最終の発車の後 */
export type Headways = [number, number][]

const H = (h: number, m = 0) => h * 3600 + m * 60

/** 起点を出る時刻の並び（運転の日の秒） */
export function departures(first: number, last: number, bands: Headways, phase = 0) {
  const out: number[] = []
  let t = first + phase
  while (t <= last + 1e-6) {
    out.push(t)
    let h = bands[0][1]
    for (const [from, step] of bands) if (t >= from) h = step
    t += h
  }
  return out
}

/** 時刻 t（運転の日の秒）に走っている運転（発車時刻が t - span 〜 t のもの）を探す。list は昇順 */
export function activeRuns(list: readonly number[], t: number, before: number, span: number, out: number[]) {
  out.length = 0
  // 二分探索で、発車時刻 ≥ t - span の最初
  let lo = 0
  let hi = list.length
  const from = t - span
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid] < from) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < list.length && list[i] - before <= t; i++) out.push(i)
  return out
}

export { H }
