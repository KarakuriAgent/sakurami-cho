import {
  advanceWheelTo,
  beginWheelBoarding,
  cancelTravel,
  cancelWheelBoarding,
  goTo,
  isTravelProblem,
  requestWheelAlight,
  startTravel,
  stopDirect,
  stopWalking,
  traveling,
  travelProblemText,
  travelState,
  WHEEL_EXIT_OPEN_DEG,
  wheelBoardProblem,
  wheelProblemText,
  type RideTime,
  type TravelCut,
  type TravelRequest,
  type TravelRouteId,
  type TravelTime,
} from 'sakurami-cho/character'
import { INTERIOR_ZONES, TOWN_PLACES, TRAVEL_PLACES, TRAVEL_ROUTE_IDS, TRAVEL_ROUTES, type TownPlace, type ZoneId } from 'sakurami-cho/core'
import { town, townUnavailable, walker } from './town'

/**
 * 行き先の一覧と旅程（例のアプリ。地図の character の startTravel・cancelTravel・travelState と、観覧車の乗り降り）。
 * 旅程と観覧車の口（startTravel・cancelTravel・beginWheelBoarding・requestWheelAlight など）を呼ぶのはこのファイルだけ（WASD・クリックで歩き出したときの取り消しも
 * walk.ts からここの stopTravel を呼ぶ。見張り）。
 *
 * - 行き先: 地図の立ち寄り先の表（TOWN_PLACES。42 か所）と町の行き先（TRAVEL_PLACES。3 か所）の 45 か所を、ゾーンごとに並べる（ラボの中・ラボのまわり・
 *   中のある建物と乗り場（ゾーンの名前は地図の INTERIOR_ZONES）・町の中）。位置は地図の表から引き、ここに座標を書かない
 * - 選ぶと: 今いるゾーンと同じゾーンの立ち寄り先なら、そのゾーンの中を歩く（goTo）。ほかは旅程（startTravel。ゾーンを出て町の道を歩き、乗り物に乗り、
 *   行き先のゾーンの出入口から歩く）。乗り物に乗っている間は選べない（着いた乗り場で降りてから）
 * - 進め方（仮）: 道順（auto・A〜G）・乗り物（route=auto のとき。auto・歩くだけ・緑電・運河バス・ホバー）・時間（そのまま・カット（区間ごと・一度に）・
 *   早送り（秒））・乗っている間と待つ間の時間（省けば時間と同じ）・乗り物の中で座るか立つか
 * - 様子: 行き先・道のり・今の区間・乗っている乗り物・町の時刻と足した時間・着いた・取り消した・だめだった理由、乗り降りなどの出来事
 * - 観覧車ソラノワ: 乗り場のゾーンにいるとき、乗る（乗車位置へ歩いてから）・降りる（降りる扉が開く所まで進める。時間の扱いは進め方の時間）
 * - 町の地図データが無い・形の版が合わない・読めない（6-6）: 行き先はラボの中とまわり（ゾーン lab）だけ（町の道・乗り物・中のある建物が無いため）
 */

/* -------------------------------------------------------------------------- */
/* 行き先                                                                        */
/* -------------------------------------------------------------------------- */

export interface Destination {
  /** 立ち寄り先の名前か町の行き先の名前（startTravel の to） */
  id: string
  label: string
  /** 一覧の組（ゾーンなど） */
  group: string
  /** 行き先のゾーン（町の行き先は town） */
  zone: ZoneId
  /** 位置（シーンの x, z。クリックした所に近い行き先を探す） */
  x: number
  z: number
  /** place = 立ち寄り先・town = 町の行き先 */
  kind: 'place' | 'town'
}

export interface DestinationGroup {
  id: string
  label: string
  items: Destination[]
}

const PLACES = TOWN_PLACES as Readonly<Record<string, TownPlace>>

function buildGroups(): DestinationGroup[] {
  const groups = new Map<string, DestinationGroup>()
  const add = (gid: string, label: string, d: Omit<Destination, 'group'>) => {
    let g = groups.get(gid)
    if (!g) groups.set(gid, (g = { id: gid, label, items: [] }))
    g.items.push({ ...d, group: gid })
  }
  // 立ち寄り先（表の並びのまま。ラボは中と外に分ける）
  for (const [id, p] of Object.entries(PLACES)) {
    const zone = p.zone ?? 'lab'
    const gid = p.zone ?? (p.outdoor ? 'lab-out' : 'lab-in')
    const label = p.zone ? INTERIOR_ZONES[p.zone].label : p.outdoor ? 'ラボのまわり' : 'ラボの中'
    add(gid, label, { id, label: p.label, zone, x: p.position[0], z: p.position[2], kind: 'place' })
  }
  // 町の行き先（町の平面座標 → シーン: x, −y）
  for (const [id, p] of Object.entries(TRAVEL_PLACES)) add('town', '町の中', { id, label: p.label, zone: 'town', x: p.at[0], z: -p.at[1], kind: 'town' })
  return [...groups.values()]
}

/** 行き先の一覧（組ごと） */
export const DESTINATION_GROUPS: readonly DestinationGroup[] = buildGroups()
const BY_ID = new Map(DESTINATION_GROUPS.flatMap((g) => g.items.map((d) => [d.id, d] as const)))

/** 行き先（無ければ undefined） */
export function destination(id: string): Destination | undefined {
  return BY_ID.get(id)
}

/** 今行ける行き先か（町の地図データが無いときは、ラボの中とまわりだけ） */
export const reachable = (d: Pick<Destination, 'zone'>) => !townUnavailable() || d.zone === 'lab'

/** クリックした点の近くの行き先を探すときの、いちばん遠い離れ（m。仮） */
const SUGGEST_RADIUS = 200

/**
 * シーンの点（x, z）にいちばん近い行き先（今いるゾーンの立ち寄り先は除く。クリックで歩けたはずなので）。SUGGEST_RADIUS より遠ければ null。
 * クリックでゾーンをまたげなかったとき、案内（walk.ts）に「そこへ行く」を出すのに使う
 */
export function nearestDestination(x: number, z: number): { id: string; label: string; group: string; distance: number } | null {
  const here = walker.motion.zone
  let best: Destination | null = null
  let bestD = SUGGEST_RADIUS
  for (const d of BY_ID.values()) {
    if (d.kind === 'place' && d.zone === here && here !== 'town') continue
    if (!reachable(d)) continue
    const dist = Math.hypot(d.x - x, d.z - z)
    if (dist < bestD) {
      bestD = dist
      best = d
    }
  }
  return best ? { id: best.id, label: best.label, group: best.group, distance: Math.round(bestD) } : null
}

/* -------------------------------------------------------------------------- */
/* 進め方                                                                        */
/* -------------------------------------------------------------------------- */

export type Via = NonNullable<TravelRequest['via']>

export interface TravelOptions {
  /** 道順（auto = いちばん早い道・A〜G = 設定の道順） */
  route: TravelRouteId
  /** route=auto のときの乗り物 */
  via: Via
  /** 時間の扱い（real = そのまま・cut = カット・fast = 早送り） */
  time: TravelTime
  /** time=cut のとき: leg = 区間ごとに showSec 秒だけ見せる・none = 一度に行き先へ */
  cut: TravelCut
  showSec: number
  /** time=fast のとき: 歩く所の早送りの長さ（秒）か倍率（倍率があればそちら） */
  fastSec: number
  fastSpeed: number | null
  /** 乗り物に乗っている間・便を待つ間の時間の扱い（same = time と同じ） */
  rideTime: RideTime | 'same'
  waitTime: RideTime | 'same'
  /** 乗り物の中で: 座る・立つ */
  pose: 'sit' | 'stand'
}

/** 進め方の既定（仮: 歩くとラボから町まで 20 分ほどかかるので、早送り 30 秒） */
export const DEFAULT_OPTIONS: TravelOptions = {
  route: 'auto',
  via: 'auto',
  time: 'fast',
  cut: 'leg',
  showSec: 5,
  fastSec: 30,
  fastSpeed: null,
  rideTime: 'same',
  waitTime: 'same',
  pose: 'sit',
}

/** 道順の選び（auto と、地図の道順の表の A〜G） */
export const ROUTE_CHOICES: readonly { id: TravelRouteId; label: string }[] = [
  { id: 'auto', label: 'いちばん早い道（auto）' },
  ...TRAVEL_ROUTE_IDS.map((id) => ({ id, label: `${id}: ${TRAVEL_ROUTES[id].label}` })),
]

export const VIA_CHOICES: readonly { id: Via; label: string }[] = [
  { id: 'auto', label: 'いちばん早い（auto）' },
  { id: 'walk', label: '歩くだけ' },
  { id: 'tram', label: '緑電' },
  { id: 'waterbus', label: '運河バス' },
  { id: 'hover', label: 'ホバー' },
]

export const TIME_CHOICES: readonly { id: TravelTime; label: string }[] = [
  { id: 'real', label: 'そのまま' },
  { id: 'cut', label: 'カット' },
  { id: 'fast', label: '早送り' },
]

/* -------------------------------------------------------------------------- */
/* 様子（useSyncExternalStore）                                                   */
/* -------------------------------------------------------------------------- */

/** 乗り降りなどの出来事（地図の Character の出来事） */
const EVENT_NAMES = ['ride.wait', 'ride.board', 'ride.enter', 'ride.riding', 'ride.arrived', 'ride.alight', 'ride.exit', 'ride.left', 'ride.cancel', 'arrive', 'place'] as const
type EventName = (typeof EVENT_NAMES)[number]
const EVENT_LABELS: Record<EventName, string> = {
  'ride.wait': '乗る便を決めた',
  'ride.board': '乗り込み始めた',
  'ride.enter': '中へ入った',
  'ride.riding': '座った・立った',
  'ride.arrived': '乗り物が着いた',
  'ride.alight': '立ち上がった',
  'ride.exit': '扉を出た',
  'ride.left': '降りた',
  'ride.cancel': '乗るのをやめた',
  arrive: '着いた',
  place: '置き直した',
}

export interface TravelEvent {
  name: EventName
  label: string
  /** 乗り物の名前か立ち寄り先の名前（無ければ null） */
  detail: string | null
  /** 町の時刻（HH:MM） */
  townTime: string
}

export interface TravelUi {
  /** 一覧を開いているか・目立たせる組（クリックの案内から開いたとき） */
  open: boolean
  focus: string | null
  options: TravelOptions
  /** 今の移動（旅程か、同じゾーンの中を歩く）。無ければ null */
  run: { kind: 'travel' | 'walk'; to: string; label: string; route: TravelRouteId | null; minutes: number | null; length: number | null; legs: string[] } | null
  /** idle = 何もしていない・moving = 移動中・arrived = 着いた・cancelled = 取り消した・failed = だめだった */
  status: 'idle' | 'moving' | 'arrived' | 'cancelled' | 'failed'
  /** 結果の字（着いた・取り消した理由・だめだった理由） */
  message: string | null
  /** 今の区間（番号は 1 から）と、旅程の段階（prepare・walk・arrive） */
  leg: { index: number; count: number; label: string | null; phase: string } | null
  /** 乗っている（待っている）乗り物と段階 */
  ride: { vehicle: string; phase: string } | null
  /** 町の時刻（HH:MM）と、この旅程で町の時刻に足した秒（カット・早送り） */
  townTime: string
  added: number
  /** 観覧車ソラノワの乗り場にいるか・乗る前に乗車位置へ歩いているか */
  wheel: { here: boolean; pending: 'board' | 'alight' | null }
  /** 出来事（新しい順に 12 まで） */
  events: TravelEvent[]
}

let ui: TravelUi = {
  open: true,
  focus: null,
  options: { ...DEFAULT_OPTIONS },
  run: null,
  status: 'idle',
  message: null,
  leg: null,
  ride: null,
  townTime: '--:--',
  added: 0,
  wheel: { here: false, pending: null },
  events: [],
}
const listeners = new Set<() => void>()

function set(patch: Partial<TravelUi>) {
  ui = { ...ui, ...patch }
  for (const fn of listeners) fn()
}

/** 今の様子（useSyncExternalStore の getSnapshot） */
export function travelUi(): TravelUi {
  return ui
}

/** 様子が変わったら呼ぶ（やめる関数を返す） */
export function subscribeTravel(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 進め方を変える */
export function setTravelOptions(patch: Partial<TravelOptions>) {
  set({ options: { ...ui.options, ...patch } })
}

/** 一覧を開く・閉じる（focus = 開いて目立たせる組） */
export function openTravel(open: boolean, focus: string | null = null) {
  set({ open, focus })
}

/** 町の時刻（HH:MM。地図の外の状態の時刻） */
export function townClock(): string {
  const h = town.sun.time.hours
  const hh = Math.floor(h)
  const mm = Math.floor((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const RIDE_PHASE: Record<string, string> = { wait: '待っている', board: '乗り込み中', riding: '乗っている', alight: '降りている' }

/* -------------------------------------------------------------------------- */
/* 旅程を始める・やめる                                                            */
/* -------------------------------------------------------------------------- */

/** 乗り込み・乗っている・降りる途中か（待っている間は含まない） */
const riding = () => walker.ride.phase === 'board' || walker.ride.phase === 'riding' || walker.ride.phase === 'alight'

function fail(message: string): string {
  set({ status: 'failed', message })
  return message
}

/** 観覧車の乗車位置（立ち寄り先の名前） */
const WHEEL_PLATFORM = 'soranowa-platform'
/** 観覧車の便を待っている間の字（乗ったら消す） */
const WHEEL_WAIT = '観覧車の便を待っています'
/** 観覧車を降りるのを早送りするときの長さ（秒。仮） */
const WHEEL_FAST_SEC = 20

let wheelPending: 'board' | 'alight' | null = null

/**
 * 行き先 id へ移る（一覧で選んだとき）。同じゾーンの中なら歩き、ほかは旅程。over で進め方の一部を替える（?debug の口）。
 * 始めたら null、だめなら理由（様子にも出す）
 */
export function travelTo(id: string, over: Partial<TravelOptions> = {}): string | null {
  const dest = BY_ID.get(id)
  if (!dest) return fail(`知らない行き先: ${id}`)
  if (!reachable(dest)) return fail(`町の地図データが無いので、「${dest.label}」へは行けません（ラボの中とまわりだけ）`)
  if (riding()) return fail(`${walker.ride.car?.vehicle.label ?? '乗り物'}に乗っている間は、行き先を選べません（降りてから選んでください）`)
  const m = walker.motion
  if (dest.kind === 'place' && m.stopId === id && m.phase === 'idle') return fail(`もう「${dest.label}」にいます`)
  // 前の移動・観覧車の待ち・クリックの歩きをやめる
  cancelTravel(walker, '別の行き先')
  cancelWheelBoarding(walker)
  wheelPending = null
  stopDirect(walker)
  const o = { ...ui.options, ...over }
  if (dest.kind === 'place' && dest.zone === m.zone && m.zone !== 'town') {
    // 同じゾーンの中（ラボの中・建物の中など）は、ゾーンの中の通り道を歩く（旅程はゾーンをまたぐ移動）
    goTo(walker, id)
    set({ run: { kind: 'walk', to: id, label: dest.label, route: null, minutes: null, length: null, legs: [] }, status: 'moving', message: null, leg: null, focus: null })
    return null
  }
  const req: TravelRequest = {
    to: id,
    route: o.route,
    time: o.time,
    cut: o.cut,
    showSec: o.showSec,
    fastSec: o.fastSec,
    fastSpeed: o.fastSpeed,
    activity: true,
    rideTime: o.rideTime === 'same' ? undefined : o.rideTime,
    waitTime: o.waitTime === 'same' ? undefined : o.waitTime,
    pose: o.pose,
    via: o.via,
  }
  const plan = startTravel(walker, req)
  if (isTravelProblem(plan)) return fail(travelProblemText(plan))
  set({
    run: {
      kind: 'travel',
      to: id,
      label: dest.label,
      route: plan.route,
      minutes: Math.round(plan.minutes * 10) / 10,
      length: Math.round(plan.length),
      legs: plan.legs.map((l) => `${l.label}（${l.mode === 'zone' || l.mode === 'walk' ? `${Math.round(l.length)}m・` : ''}${l.minutes.toFixed(1)} 分）`),
    },
    status: 'moving',
    message: null,
    focus: null,
  })
  return null
}

/**
 * 移動をやめる（取り消すボタン・WASD やクリックで歩き出したとき・置き直すとき）。その場で止まる。乗っている途中なら、着いた乗り場で降りるまで
 * 乗り物が動かす（地図の cancelTravel）。観覧車の便を待っている間ならやめる
 */
export function stopTravel(reason = '取り消し') {
  const moving = ui.status === 'moving'
  cancelTravel(walker, reason)
  cancelWheelBoarding(walker)
  wheelPending = null
  const run = ui.run
  if (moving && run?.kind === 'walk' && walker.motion.targetId === run.to) stopWalking(walker)
  if (moving) set({ status: 'cancelled', message: `取り消しました（${reason}）` })
}

/** 観覧車に乗る（乗り場のゾーンにいるとき。乗車位置にいなければ歩いて行ってから）。始めたら null、だめなら理由 */
export function boardWheel(): string | null {
  if (walker.motion.zone !== 'soranowa') return fail('観覧車ソラノワの乗り場にいません（行き先の一覧の「大観覧車ソラノワ」から乗り場へ行ってください）')
  if (walker.ride.phase !== 'none') return fail(`${walker.ride.car?.vehicle.label ?? '乗り物'}に乗っています`)
  stopTravel('観覧車に乗る')
  stopDirect(walker)
  const problem = wheelBoardProblem(walker, false)
  if (problem) return fail(wheelProblemText(problem))
  const m = walker.motion
  if (m.stopId !== WHEEL_PLATFORM || m.phase !== 'idle') {
    goTo(walker, WHEEL_PLATFORM)
    wheelPending = 'board'
    set({ status: 'moving', message: null, run: { kind: 'walk', to: WHEEL_PLATFORM, label: 'ソラノワの乗車位置（乗る）', route: null, minutes: null, length: null, legs: [] } })
    return null
  }
  beginWheelBoarding(walker, false)
  set({ status: 'idle', message: WHEEL_WAIT })
  return null
}

/** 観覧車を降りる（降りる扉が開く所まで進める。時間の扱いは進め方の時間。待っている間ならやめる）。始めたら null、だめなら理由 */
export function alightWheel(time: RideTime = ui.options.time): string | null {
  if (walker.ride.car?.vehicle.id !== 'soranowa' || walker.ride.phase === 'none') return fail('観覧車に乗っていません')
  if (walker.ride.phase === 'wait') {
    cancelWheelBoarding(walker)
    set({ status: 'idle', message: '観覧車に乗るのをやめました' })
    return null
  }
  if (walker.ride.phase !== 'riding') {
    // 乗り込み・降りる途中: 座ってから
    wheelPending = 'alight'
    alightTime = time
    return null
  }
  advanceWheelTo(walker, WHEEL_EXIT_OPEN_DEG, time, time === 'fast' ? WHEEL_FAST_SEC : null, null)
  requestWheelAlight(walker)
  set({ message: '観覧車を降ります（下へ戻って扉が開いたら）' })
  return null
}

let alightTime: RideTime = 'fast'

/* -------------------------------------------------------------------------- */
/* 毎コマ                                                                        */
/* -------------------------------------------------------------------------- */

/** 毎コマ（scene/Walker.tsx。歩きを進めたあと）: 着いた・だめだったを見て、様子を直す。観覧車の乗る・降りるの続き */
export function updateTravel() {
  const m = walker.motion
  let { status, message } = ui
  const run = ui.run
  if (status === 'moving' && run) {
    if (run.kind === 'walk') {
      if (walker.errors.unreachable === run.to) {
        status = 'failed'
        message = `「${run.label}」への通り道が見つかりませんでした`
        wheelPending = wheelPending === 'board' ? null : wheelPending
      } else if (m.stopId === run.to && m.phase === 'idle') {
        status = 'arrived'
        message = `「${run.label}」に着きました`
      }
    } else if (!traveling(walker)) {
      const err = walker.travel.error
      if (err) {
        status = 'failed'
        message = `移動をやめました（${err}）`
      } else if (m.phase === 'idle' && (destination(run.to)?.kind === 'town' || m.stopId === run.to)) {
        status = 'arrived'
        message = `「${run.label}」に着きました`
      }
    }
  }
  // 観覧車: 乗車位置に着いたら乗る・座ったら降りる
  if (wheelPending === 'board' && m.stopId === WHEEL_PLATFORM && m.phase === 'idle') {
    wheelPending = null
    const problem = wheelBoardProblem(walker, false)
    if (problem) {
      status = 'failed'
      message = wheelProblemText(problem)
    } else {
      beginWheelBoarding(walker, false)
      status = 'idle'
      message = WHEEL_WAIT
    }
  } else if (wheelPending === 'alight' && walker.ride.phase === 'riding') {
    wheelPending = null
    advanceWheelTo(walker, WHEEL_EXIT_OPEN_DEG, alightTime, alightTime === 'fast' ? WHEEL_FAST_SEC : null, null)
    requestWheelAlight(walker)
    message = '観覧車を降ります（下へ戻って扉が開いたら）'
  }
  if (message === WHEEL_WAIT && walker.ride.phase !== 'wait') message = null
  const st = travelState(walker)
  const leg = st ? { index: st.leg_index + 1, count: st.legs, label: st.leg_label, phase: st.phase } : null
  const car = walker.ride.car
  const ride = walker.ride.phase !== 'none' && car ? { vehicle: car.vehicle.label, phase: RIDE_PHASE[walker.ride.phase] ?? walker.ride.phase } : null
  const townTime = townClock()
  const added = Math.round(walker.travel.added)
  const here = m.zone === 'soranowa' || car?.vehicle.id === 'soranowa'
  const changed =
    status !== ui.status ||
    message !== ui.message ||
    townTime !== ui.townTime ||
    added !== ui.added ||
    here !== ui.wheel.here ||
    wheelPending !== ui.wheel.pending ||
    JSON.stringify(leg) !== JSON.stringify(ui.leg) ||
    JSON.stringify(ride) !== JSON.stringify(ui.ride)
  if (changed) set({ status, message, leg, ride, townTime, added, wheel: { here, pending: wheelPending } })
}

/* -------------------------------------------------------------------------- */
/* 出来事                                                                        */
/* -------------------------------------------------------------------------- */

const offs = EVENT_NAMES.map((name) =>
  walker.on(name, (e) => {
    const detail = typeof e === 'string' ? (PLACES[e]?.label ?? e) : (e?.vehicle.label ?? null)
    const ev: TravelEvent = { name, label: EVENT_LABELS[name], detail, townTime: townClock() }
    set({ events: [ev, ...ui.events].slice(0, 12) })
  }),
)

// このファイルを書き換えたときは、前の聞く所を外す（モジュールを差し替えても出来事が 2 回入らないように）
if (import.meta.hot) import.meta.hot.dispose(() => offs.forEach((off) => off()))
