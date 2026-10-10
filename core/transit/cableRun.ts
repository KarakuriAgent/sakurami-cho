import { CABLE } from '../town'

/**
 * 丘ノ上ケーブルの運転（ダイヤ。時刻だけから決まる。docs/design/town.md §19・§7 の 176〜）。vol3 4-4: 6:00〜23:30・10 分間隔・所要約 4 分、中間の楓坂駅で行き違う。
 *
 * - 2 両（さくら号 = 0・かえで号 = 1）は 1 本の綱の両端なので、いつも線路の真ん中について対になる位置にいる。10 分ごとに両方の端の駅を同時に発車し、
 *   真ん中の楓坂駅（行き違い線）に同時に着いて 30 秒止まり（さくら号は南東の線、かえで号は北西の線）、同時に発車して反対の端の駅に着く（片道 4 分）。
 *   端の駅では次の発車まで 6 分止まる。偶数の便はさくら号が下る（最後の便の後はさくら号が頂上駅、かえで号が麓駅。D-047）
 * - 位置 q: 0 = 頂上駅の止まる位置、1 = 麓駅の止まる位置（さくら号の q。かえで号は 1 − q）。駅と駅の間は、なめらかに速さを上げ下げする（加速 22 秒・最高 4.9m/s）
 * - 扉: 駅に着いて 4 秒で開き始め（2 秒で開く）、発車の 8 秒前に閉め始める。開くのはホームの側だけ（頂上駅は南東、麓駅は北西、
 *   楓坂駅はそれぞれの行き違い線の外の側）。車両の局所の x の向き（+x = 山を向いて左 = 北西）で −1 / 1
 *
 * このファイルは線路の形を持たない（時刻と駅の割合だけ。車両の位置・向きは cable.ts の CableLine）
 */

export type CableStationId = 'station.cable-summit' | 'station.cable-kaedezaka' | 'station.cable-fumoto'

export const CABLE_RUN = {
  /** 発車の間隔・片道（秒） */
  interval: CABLE.interval,
  trip: CABLE.tripSeconds,
  /** 駅と駅の間を走る秒・楓坂駅で止まる秒（105 + 30 + 105 = 240） */
  leg: 105,
  midDwell: 30,
  /** 速さを上げる・下げる秒 */
  ramp: 22,
  /** 端の駅の止まる位置（線路の端から水平に m。D-047・D-055 の待機位置） */
  endStop: 20.36,
  /** 扉: 着いてから開き始めるまで・発車の何秒前に閉め始めるか・開け閉めの秒 */
  doorOpenAfter: 4,
  doorCloseBefore: 8,
  doorMove: 2,
  /** 始発の前に端の駅で扉が開いている時間（秒） */
  openBeforeFirst: 600,
} as const

/** 駅の位置（さくら号の q で） */
export const CABLE_STATION_Q: Record<CableStationId, number> = {
  'station.cable-summit': 0,
  'station.cable-kaedezaka': 0.5,
  'station.cable-fumoto': 1,
}

export const CABLE_STATION_LABEL: Record<CableStationId, string> = {
  'station.cable-summit': '頂上駅',
  'station.cable-kaedezaka': '楓坂駅',
  'station.cable-fumoto': '麓駅',
}

const FIRST = CABLE.service[0] * 3600
const LAST = CABLE.service[1] * 3600
/** 便の数（6:00〜23:30 の 10 分ごと。106 本。偶数なので最後の便の後はさくら号が頂上駅） */
export const CABLE_TRIPS = Math.floor((LAST - FIRST) / CABLE_RUN.interval) + 1

/** 便 k の発車（運転の日の秒） */
export const tripStart = (k: number) => FIRST + k * CABLE_RUN.interval

/** 運転の日の秒 t の便（k = 発車した便の番号。始発の前は -1、最後の便の後も最後の番号）と、発車からの秒 */
export function cableTrip(t: number) {
  if (t < FIRST) return { k: -1, s: t - FIRST }
  const k = Math.min(CABLE_TRIPS - 1, Math.floor((t - FIRST) / CABLE_RUN.interval))
  return { k, s: t - tripStart(k) }
}

/** なめらかに速さを上げ下げして走る区間の進み（0〜1。x = 区間の時間の割合、a = 加速の割合） */
function rampDistance(x: number, a: number) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const tot = 1 - a
  if (x < a) return (x / 2 - (a / (2 * Math.PI)) * Math.sin((Math.PI * x) / a)) / tot
  if (x <= 1 - a) return (a / 2 + (x - a)) / tot
  const y = 1 - x
  return (tot - (y / 2 - (a / (2 * Math.PI)) * Math.sin((Math.PI * y) / a))) / tot
}

/** 区間の中の速さ（区間の平均の速さに対する割合） */
function rampSpeed(x: number, a: number) {
  if (x <= 0 || x >= 1) return 0
  const v = x < a ? (1 - Math.cos((Math.PI * x) / a)) / 2 : x > 1 - a ? (1 - Math.cos((Math.PI * (1 - x)) / a)) / 2 : 1
  return v / (1 - a)
}

/** 便の中の進み（0 = 発車した端、1 = 着いた端。発車からの秒 s） */
export function tripProgress(s: number) {
  const { leg, midDwell, ramp } = CABLE_RUN
  const a = ramp / leg
  if (s <= 0) return 0
  if (s < leg) return 0.5 * rampDistance(s / leg, a)
  if (s < leg + midDwell) return 0.5
  return Math.min(1, 0.5 + 0.5 * rampDistance((s - leg - midDwell) / leg, a))
}

/** 便の中の速さ（全線の割合 / 秒） */
export function tripRate(s: number) {
  const { leg, midDwell, ramp } = CABLE_RUN
  const a = ramp / leg
  if (s <= 0 || s >= CABLE_RUN.trip) return 0
  if (s < leg) return (0.5 * rampSpeed(s / leg, a)) / leg
  if (s < leg + midDwell) return 0
  return (0.5 * rampSpeed((s - leg - midDwell) / leg, a)) / leg
}

/** さくら号が便 k で下るか（偶数の便） */
export const sakuraDown = (k: number) => k % 2 === 0

/** 車両 car（0 = さくら号、1 = かえで号）の位置 q（0 = 頂上駅、1 = 麓駅）。t = 運転の日の秒 */
export function carQ(car: number, t: number) {
  const { k, s } = cableTrip(t)
  let q: number
  if (k < 0) q = 0
  else {
    const f = tripProgress(s)
    q = sakuraDown(k) ? f : 1 - f
  }
  return car === 0 ? q : 1 - q
}

/** 車両 car の速さ（全線の割合 / 秒。麓へ向かうのが +） */
export function carRate(car: number, t: number) {
  const { k, s } = cableTrip(t)
  if (k < 0) return 0
  const r = tripRate(s) * (sakuraDown(k) ? 1 : -1)
  return car === 0 ? r : -r
}

/** 車両 car が便 k で下るか */
export const carDown = (car: number, k: number) => (car === 0 ? sakuraDown(k) : !sakuraDown(k))

/**
 * 駅でホームのある側（車両の局所の x の向き。+x = 山を向いて左 = 北西）。頂上駅は南東（−1）、麓駅は北西（+1）、
 * 楓坂駅は行き違い線の外の側（さくら号は南東の線なので −1、かえで号は北西の線なので +1）
 */
export function platformSide(car: number, station: CableStationId) {
  if (station === 'station.cable-summit') return -1
  if (station === 'station.cable-fumoto') return 1
  return car === 0 ? -1 : 1
}

/** 車両 car が便 k で駅 st に着く・発車する（運転の日の秒）。その便で止まらなければ null */
export function stopTimes(car: number, k: number, st: CableStationId) {
  const q = CABLE_STATION_Q[st]
  const t0 = tripStart(k)
  const down = carDown(car, k)
  // この便で発車する端（q = 0 か 1）・真ん中・着く端
  const from = down ? 0 : 1
  if (q === 0.5) return { arrive: t0 + CABLE_RUN.leg, depart: t0 + CABLE_RUN.leg + CABLE_RUN.midDwell }
  if (q === from) {
    // 発車する端: 前の便で着いてから止まっている（始発は始発の前から）
    const arrive = k === 0 ? t0 - CABLE_RUN.openBeforeFirst - CABLE_RUN.doorOpenAfter : tripStart(k - 1) + CABLE_RUN.trip
    return { arrive, depart: t0 }
  }
  // 着く端（最後の便のあとは、着いてから 6 分で扉を閉める）
  const arrive = t0 + CABLE_RUN.trip
  return { arrive, depart: k + 1 < CABLE_TRIPS ? tripStart(k + 1) : arrive + CABLE_RUN.interval - CABLE_RUN.trip }
}

/** 扉が開いている間（運転の日の秒。開き始め・開ききる・閉め始め・閉まる） */
export function doorWindow(arrive: number, depart: number) {
  const o0 = arrive + CABLE_RUN.doorOpenAfter
  const c0 = depart - CABLE_RUN.doorCloseBefore
  return { open0: o0, open1: o0 + CABLE_RUN.doorMove, close0: c0, close1: c0 + CABLE_RUN.doorMove }
}

/** 車両 car の今の扉の開き具合（0〜1）と、開いている側（−1 / 1。止まっていなければ 0）・止まっている駅 */
export function carDoors(car: number, t: number): { open: number; side: number; station: CableStationId | null } {
  const { k } = cableTrip(t)
  const q = carQ(car, t)
  let st: CableStationId | null = null
  for (const id of Object.keys(CABLE_STATION_Q) as CableStationId[]) if (Math.abs(CABLE_STATION_Q[id] - q) < 1e-6) st = id
  if (!st) return { open: 0, side: 0, station: null }
  // 止まっている間の着いた・発車する時刻（今の便・次の便・前の便のうち、今を含むもの）
  let times: { arrive: number; depart: number } | null = null
  for (const kk of [Math.max(0, k), k + 1, k - 1]) {
    if (kk < 0 || kk >= CABLE_TRIPS) continue
    const tm = stopTimes(car, kk, st)
    if (tm && t >= tm.arrive - 0.5 && t <= tm.depart + 0.5) {
      times = tm
      break
    }
  }
  if (!times) return { open: 0, side: 0, station: st }
  const w = doorWindow(times.arrive, times.depart)
  const open = t < w.open0 ? 0 : t < w.open1 ? (t - w.open0) / CABLE_RUN.doorMove : t < w.close0 ? 1 : t < w.close1 ? 1 - (t - w.close0) / CABLE_RUN.doorMove : 0
  return { open, side: platformSide(car, st), station: st }
}

/**
 * 駅 from から駅 toward へ行く、次に乗れる便（扉が閉め始めるまで lead 秒より先のもの。side を決めればそのホームの側の便）。運転の終わったあとは null。
 * 戻り値: 車両・便・着く/扉が開ききる/閉め始める/発車する時刻（運転の日の秒）・ホームの側
 */
export function nextCableBoarding(from: CableStationId, toward: CableStationId, t: number, lead = 0, side = 0) {
  const qf = CABLE_STATION_Q[from]
  const qt = CABLE_STATION_Q[toward]
  if (qf === qt) return null
  const down = qt > qf
  const { k: k0 } = cableTrip(t)
  for (let k = Math.max(0, k0 - 1); k < CABLE_TRIPS; k++) {
    for (const car of [0, 1]) {
      if (carDown(car, k) !== down) continue
      const times = stopTimes(car, k, from)
      if (!times) continue
      // 端の駅の「着く端」は、その便では乗れない（降りる側）
      const fromEnd = down ? 0 : 1
      if (qf !== 0.5 && qf !== fromEnd) continue
      const w = doorWindow(times.arrive, times.depart)
      if (w.close0 - lead <= t) continue
      // ホームの側を決めたとき（楓坂駅で、もう片方のホームにいる）は、その側に来る便だけ
      if (side && platformSide(car, from) !== side) continue
      return { car, k, open: w.open1, close: w.close0, arrive: times.arrive, depart: times.depart, side: platformSide(car, from) }
    }
  }
  return null
}

/** 便 k で車両 car が駅 at に着いて扉が開ききる時刻（運転の日の秒）。その便で着かなければ null */
export function cableArrivalOpen(car: number, k: number, at: CableStationId) {
  const down = carDown(car, k)
  const qa = CABLE_STATION_Q[at]
  const fromEnd = down ? 0 : 1
  if (qa === fromEnd) return null
  const times = stopTimes(car, k, at)
  return doorWindow(times.arrive, times.depart).open1
}

/** ケーブルが動いている時刻か（運転の日の秒。最後の発車まで） */
export function cableInService(t: number) {
  return t >= FIRST - CABLE_RUN.openBeforeFirst && t <= LAST
}
