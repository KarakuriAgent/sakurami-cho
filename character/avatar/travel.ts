import * as THREE from 'three'
import { STATION_ZONE, type CableStationKey } from '../../core/cableStations'
import { INTERIOR_ZONES, zoneOfPoint, type InteriorZoneId, type ZoneId } from '../../core/interiors'
import { townPlaces, type PlaceId } from '../../core/places'
import { TRAVEL_ROUTES, WAYPOINTS, type LegMode, type RouteEnd, type TravelRouteDef, type WaypointId } from '../../core/routes'
import { TRAVEL_PLACES, ZONE_PORTALS, type PortalDef, type TravelPlaceId, type TravelZone } from '../../core/travel'
import { beginCableRide, cableRideResult, cableRideSpec, cancelCableRide, cableRiding, cableRideState, clearCableRide, planCableBoarding } from '../ride/cableRide'
import { beginBoatRide, boatExitLanding, landingPath, landingTown, nextBoatBoarding, planBoatBoarding } from '../ride/boatRide'
import { beginTramRide, planTramBoarding, platformFoot, platformPath, tramExitPlatform, tramPlatformFor } from '../ride/tramRide'
import { beginHoverRide, hoverRide, planFlight, planHoverBoarding } from '../ride/hoverRide'
import { partyEscorts } from '../ride/party'
import { hoverHome } from '../../world/outdoor/transit/hoverCraft'
import { HOVER_DOCKS, type HoverDockId } from '../../core/hoverDocks'
import { nextTramBoarding, tramLine, tramNet, tramStopPose } from '../../world/outdoor/transit/trams'
import { boatNet } from '../../world/outdoor/transit/boats'
import { landingById } from '../../world/outdoor/transit/landings'
import { warpClock, type RideTime } from '../ride/warp'
import { townWarp } from '../../core/clock'
import { interiors } from '../../world/outdoor/interior/interiors'
import { cableInService } from '../../core/transit/cableRun'
import { transitClock } from '../../world/outdoor/transit/clock'
import { townData } from '../../world/outdoor/town/townData'
import { EDGE_KIND } from '../../core/walk/walkData'
import { walkLine } from '../../core/walk/walkLine'
import type { RouteTarget, TownRoute, XY } from '../../core/walk/townNav'
import { townWalk } from '../../world/walk/townWalk'
import { findPath } from './nav'
import { groundHeight, seatApproach, stopWalking, stopZone, TOWN_WALK_SPEED, WALK_SPEED } from './locomotion'
import type { Character, CharacterMotion } from './character'

/**
 * 花音が町の中を移動する（kanon.travel。docs/design/town.md §18）。
 *
 * 道のり = 区間（leg）の列。区間は「歩く線」（点の列。名目の速さつき）と「カット」（その間を飛ばす。町の時刻を進める）からなる:
 *   1. 今いるゾーンの中を、ゾーンの出入口まで歩く（ラボは character/avatar/nav.ts、建物の中は interior/model.ts の通り道）
 *   2. 町の道を歩く（設定の道順 A〜G の区間か、いちばん早い道。core/walk/townNav.ts → core/walk/walkLine.ts の歩く線。歩道の側・交差点で渡る・小物よけ）
 *      丘ノ上ケーブルの区間（ride）は、駅の入口からホームの扉の前まで歩き、来た便に乗り、着いた駅のホームから出口まで歩く（character/ride/cableRide.ts。
 *      待つ・乗っている間の時間の扱いは wait・rideTime）。緑電（段 3 で乗れるようにする）と、地下の駅自由通路（見えない区間）は、今はカット
 *      （次の乗り場・出口から続ける。町の時刻をその分進める）
 *   3. 行き先のゾーンの出入口から、立ち寄り先まで歩く（着いたら locomotion の「着いて向きを合わせる」へ渡す）。町の行き先は、町の道の経路の終わり
 *      （行き先の点を道の上へつないだ点）か降りた乗り場の外から、行き先の点まで歩く（行き先の点が歩ける所でなければ、その手前の縁まで）
 *
 * 時間の扱い（time）: real = そのまま歩く / cut = 飛ばす（cut=none は一度に行き先へ、cut=leg は区間ごとに少しだけ歩いて次の区間へカット） /
 * fast = 早送り（歩く間の時間を倍にして、町の時刻・交通・空も一緒に進める）。カット・早送りで足した時間は町の時刻に残る（clockWarp）。
 *
 * 位置・向き・速さは locomotion から毎コマ呼ばれる driveTravel で決める（Character の drivers.travel に付ける。kanon-lab は src/kanon/index.ts。
 * 足元の高さ・階・歩きの周期は locomotion）。描画の時計で進むので、撮影でも毎回同じ画になる。途中の様子は Character ごと（ch.travel）。
 */

export type TravelTime = 'real' | 'cut' | 'fast'
export type TravelCut = 'leg' | 'none'
export type TravelRouteId = TravelRouteDef['id'] | 'auto'

export interface TravelRequest {
  /** 行き先（立ち寄り先か町の行き先） */
  to: PlaceId | TravelPlaceId
  route: TravelRouteId
  time: TravelTime
  cut: TravelCut
  /** cut=leg のとき、区間ごとに歩いて見せる秒 */
  showSec: number
  /** fast のとき、歩く所の早送りの長さ（秒）か倍率 */
  fastSec: number | null
  fastSpeed: number | null
  /** 着いたら、その場所での行動を始めるか */
  activity: boolean
  /** ケーブルの区間: 乗っている間・待つ間の時間の扱い（省けば time と同じ。cut=leg のときも乗る所・降りる所は見せる）と、座るか立つか */
  rideTime?: RideTime
  waitTime?: RideTime
  pose?: 'sit' | 'stand'
  /**
   * route=auto のとき: auto = いちばん早い道（ケーブル・緑電・運河バスは十分に早いときだけ。ホバーはケーブルの止まっている夜中に十分に早いときだけ）/
   * walk = 歩くだけ / tram・waterbus・hover = その乗り物で
   */
  via?: 'auto' | 'walk' | 'tram' | 'waterbus' | 'hover'
}

interface Pt {
  x: number
  z: number
  s: number
  /** 名目の速さ（m/s） */
  v: number
}

interface WalkSeg {
  kind: 'walk'
  leg: number
  pts: Pt[]
  length: number
  /** 乗り物の区間の、乗り場の中を歩く所（in = 待つ所への道・out = 降りた所から出る道）。待つ間をそのまま見せるなら、早送りでも待つ所の手前の 20m と降りてからの 15m はそのままの速さ（§7 の 216） */
  station?: 'in' | 'out'
}

interface CutSeg {
  kind: 'cut'
  leg: number
  /** 町の時刻に足す秒 */
  seconds: number
  mode: LegMode | 'skip'
  /**
   * skip のとき、飛ばした歩く所の点の列（シーン）。カットの後に置く所の足元の高さを、ここを歩いたときと同じに決める（groundAlong）。
   * 道のりがこのカットで終わるときは、終わりの点へ置く
   */
  path?: Pt[]
}

export type RideVehicle = 'cable' | 'tram' | 'waterbus' | 'hover'

/**
 * 乗り物の区間（乗り場の外から歩き、待って乗り、着いた乗り場に出るまで）: 丘ノ上ケーブル（character/ride/cableRide.ts。from・to は駅）・
 * 緑電（character/ride/tramRide.ts。from・to は停留所の名前、line は系統の番号）・運河バス（character/ride/boatRide.ts。from・to は乗り場の id、line は航路）・
 * 花音のホバー（character/ride/hoverRide.ts。from・to はホバーの乗り場の id）
 */
interface RideSeg {
  kind: 'ride'
  leg: number
  vehicle: RideVehicle
  from: string
  to: string
  line?: number | string
  /** 名目の秒（待つ・乗り降りを含む。道のりの時間の見積もり） */
  seconds: number
  /** 進み: pending = これから（乗り場への道を作る）・approach = 乗り場へ歩いている・riding = 乗る仕組みが動かしている・done = 乗り場に出た */
  state: 'pending' | 'approach' | 'riding' | 'done'
  /** 道のりがこの区間で終わるとき、降りた乗り場から歩いて出る所（シーンの x, z） */
  exitAt?: [number, number]
}

type Seg = WalkSeg | CutSeg | RideSeg

export interface LegInfo {
  id: string
  label: string
  mode: LegMode | 'zone'
  /** 名目の時間（分。歩く速さ・乗り物の時間から） */
  minutes: number
  /** 歩く長さ（m） */
  length: number
}

export interface TravelPlan {
  route: TravelRouteId
  /** 道順を逆向きにたどる（A を ラボ → 家 など） */
  reversed: boolean
  segs: Seg[]
  legs: LegInfo[]
  /** 行き先 */
  stop: PlaceId | null
  place: TravelPlaceId | null
  /** 着いた所で向く向き（町の行き先のとき） */
  heading: number | null
  /** 道のり全体の名目の時間（分）・歩く長さ（m） */
  minutes: number
  length: number
  /** 通る道の名前（町の道の区間） */
  names: string[]
}

/**
 * 道のりを作れない理由（planTravel・startTravel が返す。種類 code と、字を作るのに使う値）。字は travelProblemText（地図の既定の字）で作る。
 * 使う側は、種類ごとに自分の言葉の字にしてよい（kanon-lab は命令の名前を入れた字にする。src/kanon/reasons.ts）。
 * route・leg は道順と区間の名前（core/routes.ts の TRAVEL_ROUTES）、to は頼まれた行き先（TravelRequest の to）、zone はゾーン
 */
export type TravelProblem =
  /** 町の道のデータがまだ無い（読み込み中か、アセットの根に町の地図データが無い） */
  | { code: 'no-town-data' }
  /** 行き先が立ち寄り先にも町の行き先にも無い */
  | { code: 'unknown-destination'; to: string }
  /** 行き先の立ち寄り先が、今いるゾーン（町のほか）の中（ゾーンの中は goTo で歩く） */
  | { code: 'same-zone'; stop: PlaceId; zone: ZoneId }
  /** もう町の行き先にいる */
  | { code: 'already-there'; place: TravelPlaceId }
  /** 道順の両端が、今いる所と行き先に合わない（destination = 行き先のゾーンか町の行き先） */
  | { code: 'route-ends'; route: string; label: string; from: RouteEnd; to: RouteEnd; zone: ZoneId; destination: string }
  /** 道順が丘ノ上ケーブルに乗るが、今の時刻はケーブルが動いていない */
  | { code: 'route-cable-closed'; route: string }
  /** 今いるゾーンの出入口への通り道が無い（portal = 出入口の名前） */
  | { code: 'zone-exit-path'; zone: ZoneId; portal: string }
  /** 道順の区間の駅・停留所がわからない */
  | { code: 'route-station'; route: string; leg: string }
  | { code: 'route-tram-stop'; route: string; leg: string }
  /** 緑電の、その向きの停留所のホームが無い */
  | { code: 'tram-platform'; line: number; from: string; to: string }
  /** 道順の区間の道が無い */
  | { code: 'route-leg-path'; route: string; leg: string; label: string }
  /** 町の道で行き先への道が無い（cable = 丘ノ上ケーブルの駅の前後の道） */
  | { code: 'town-path'; to: string }
  | { code: 'town-path-cable'; to: string }
  /** 緑電・運河バス（via で選んだ）で行き先へ行く乗り方が無い */
  | { code: 'transit-way'; vehicle: 'tram' | 'waterbus'; to: string }
  /** ホバー（via=hover）: 置き場が歩いて 25 分より遠い・同じ浮遊レーンの乗り場が無い（dock = 置いてある乗り場の名前）・行き先へ行く乗り方が無い */
  | { code: 'hover-far'; dock: string }
  | { code: 'hover-no-dock'; dock: string }
  | { code: 'hover-way'; to: string }
  /** 行き先のゾーンの出入口から立ち寄り先への通り道が無い */
  | { code: 'zone-entry-path'; zone: ZoneId; stop: PlaceId }
  /** 道のりが空 */
  | { code: 'empty-plan' }

/** 道のりを作れない理由の、地図の既定の字 */
export function travelProblemText(p: TravelProblem): string {
  switch (p.code) {
    case 'no-town-data':
      return '町の道のデータがまだありません（町のデータを読み込み中か、アセットの根の town/ に町の地図データがありません）'
    case 'unknown-destination':
      return `行き先「${p.to}」はありません`
    case 'same-zone':
      return `「${p.stop}」は今いるゾーン（${p.zone}）の中です。ゾーンの中は goTo で歩いてください`
    case 'already-there':
      return `もう「${p.place}」にいます`
    case 'route-ends':
      return `道順 ${p.route}（${p.label}）は ${p.from} と ${p.to} の間です（今は ${p.zone}、行き先は ${p.destination}）。route を auto にすればいちばん早い道を歩きます`
    case 'route-cable-closed':
      return `道順 ${p.route} は丘ノ上ケーブルに乗りますが、今の時刻はケーブルが動いていません（6:00〜23:30）。夜中はルート G（つづら道）か route を auto に`
    case 'zone-exit-path':
      return `${zoneLabel(p.zone)}の出入口（${p.portal}）への通り道が見つかりません`
    case 'route-station':
      return `道順 ${p.route} の ${p.leg} の駅がわかりません`
    case 'route-tram-stop':
      return `道順 ${p.route} の ${p.leg} の停留所がわかりません`
    case 'tram-platform':
      return `緑電 ${p.line} 系統の${p.from}から${p.to}へ行く停留所のホームが見つかりません（町のデータを読み込み中か、向きが違います）`
    case 'route-leg-path':
      return `道順 ${p.route} の ${p.leg}（${p.label}）の道が見つかりません`
    case 'town-path':
      return `町の道で行き先「${p.to}」への道が見つかりません`
    case 'town-path-cable':
      return `町の道で行き先「${p.to}」への道（丘ノ上ケーブルの駅の前後）が見つかりません`
    case 'transit-way':
      return `${p.vehicle === 'tram' ? '緑電' : '運河バス'}で行き先「${p.to}」へ行く乗り方が見つかりません（乗り場が遠い・便が無い時刻）。via を auto にすればいちばん早い道`
    case 'hover-far':
      return `ホバーは${p.dock}に置いてあり、歩いて 25 分より遠いです`
    case 'hover-no-dock':
      return `ホバーで行き先へ行く乗り場が見つかりません（ホバーは${p.dock}。同じ浮遊レーンの乗り場だけ）`
    case 'hover-way':
      return `ホバーで行き先「${p.to}」へ行く乗り方が見つかりません`
    case 'zone-entry-path':
      return `${zoneLabel(p.zone)}の出入口から「${p.stop}」への通り道が見つかりません`
    case 'empty-plan':
      return '道のりが空です'
  }
}

/** 道のりか、作れない理由か（startTravel・planTravel の返り値を分ける） */
export function isTravelProblem(r: TravelPlan | TravelProblem): r is TravelProblem {
  return 'code' in r
}

/* -------------------------------------------------------------------------- */
/* 道のりを作る                                                                  */
/* -------------------------------------------------------------------------- */

const ROUTE_END_ZONE: Record<RouteEnd, TravelZone | null> = { lab: 'lab', thompson: 'thompson', seizu: 'seizu', cafe: 'cafe', dome: 'dome', onodera: null, hiraki: null }

/** 道順の点のケーブルの駅（駅でなければ null） */
function stationOf(id: WaypointId): CableStationKey | null {
  const w = WAYPOINTS[id] as { station?: string }
  return (w.station as CableStationKey | undefined) ?? null
}

/** 道順の点の緑電の停留所の名前（停留所でなければ null） */
function tramStopOf(id: WaypointId): string | null {
  const w = WAYPOINTS[id] as { tramStop?: string }
  return w.tramStop ?? null
}

/** ケーブルの駅の入口の外の町の点（平面座標） */
function stationPortalTown(st: CableStationKey): XY {
  return ZONE_PORTALS[STATION_ZONE[st]][0].town as XY
}

/** 町の道の区間の、道の中心からずらす量（m）: 歩道のある広い道は歩道の真ん中、ふつうの道は端から 1m、路地・小径・石段・橋・広場は真ん中 */
function offsetOf(edge: number) {
  const nav = townWalk.nav
  if (!nav) return 0
  const e = nav.data.edges[edge]
  if (e.k !== EDGE_KIND.road || e.f < 0) return 0
  const f = nav.data.feats[e.f]
  if (f.private) return 0
  const w = f.width
  switch (f.cls) {
    case 'trunk':
      return w > 11 ? w / 2 - 2 : 0
    case 'arterial':
      return w > 9 ? w / 2 - 1.5 : 0
    case 'local':
      return Math.max(0, w / 2 - 1.0)
    case 'pedestrian':
      return Math.max(0, Math.min(2.5, w / 2 - 1.6))
    default:
      return 0
  }
}

/** 小物（街灯の柱・木の幹）の索引（町の平面座標。タイルの灯りと木から。初めて使うときに作る） */
let props: Map<number, { x: number; y: number; r: number }[]> | null = null
let propsTiles = 0
const PROP_CELL = 8
function propIndex() {
  const tiles = [...townData.tiles, ...townData.extraTiles.values()]
  if (props && propsTiles === tiles.length) return props
  props = new Map()
  propsTiles = tiles.length
  const add = (x: number, y: number, r: number) => {
    const k = Math.floor(x / PROP_CELL) * 100003 + Math.floor(y / PROP_CELL)
    let l = props!.get(k)
    if (!l) props!.set(k, (l = []))
    l.push({ x, y, r })
  }
  for (const t of tiles) {
    const tp = t.sections.t_pos?.array
    if (tp) for (let i = 0; i < tp.length; i += 4) add(tp[i], tp[i + 1], 0.35)
    const lp = t.sections.l_pos?.array
    const lk = t.sections.l_kind?.array
    if (lp && lk)
      for (let i = 0; i < lp.length / 4; i++) {
        // 街灯（柱のある灯り。灯具が地面から 2.5m より上）
        if (lk[i * 2] !== 1) continue
        const x = lp[i * 4]
        const y = lp[i * 4 + 1]
        if (lp[i * 4 + 2] - townData.heightAt(x, y) > 2.5) add(x, y, 0.2)
      }
  }
  return props
}
function propsNear(x: number, y: number, r: number) {
  const idx = propIndex()
  const out: { x: number; y: number; r: number }[] = []
  for (let gx = Math.floor((x - r) / PROP_CELL); gx <= Math.floor((x + r) / PROP_CELL); gx++)
    for (let gy = Math.floor((y - r) / PROP_CELL); gy <= Math.floor((y + r) / PROP_CELL); gy++) for (const p of idx.get(gx * 100003 + gy) ?? []) if (Math.hypot(p.x - x, p.y - y) < r + p.r) out.push(p)
  return out
}

/** 平面の点を、街灯の柱・木の幹から 0.9m 離す（止まる所が柱に重ならないように） */
function clearOfProps(p: readonly [number, number]): [number, number] {
  let x = p[0]
  let y = p[1]
  for (let k = 0; k < 3; k++)
    for (const q of propsNear(x, y, 1.5)) {
      const d = Math.hypot(x - q.x, y - q.y)
      const need = q.r + 0.9
      if (d >= need) continue
      const ux = d > 1e-3 ? (x - q.x) / d : 1
      const uy = d > 1e-3 ? (y - q.y) / d : 0
      x = q.x + ux * need
      y = q.y + uy * need
    }
  return [x, y]
}

/** ケーブルが動いている時刻か（始発の前に扉が開く 5:50 から、終発 23:30 まで。運転の日の秒） */
export function cableRunning() {
  return cableInService(transitClock.serviceSec)
}

/** 点の列（シーンの x, z）を、名目の速さ v（m/s）で歩く点に（角を少し丸める） */
function scenePath(pts: [number, number][], v: number): Pt[] {
  const out: Pt[] = []
  const push = (x: number, z: number) => {
    const last = out[out.length - 1]
    if (last && Math.hypot(last.x - x, last.z - z) < 0.01) return
    out.push({ x, z, s: last ? last.s + Math.hypot(last.x - x, last.z - z) : 0, v })
  }
  for (let i = 0; i < pts.length; i++) {
    const b = pts[i]
    if (i === 0 || i === pts.length - 1) {
      push(b[0], b[1])
      continue
    }
    const a = pts[i - 1]
    const c = pts[i + 1]
    const la = Math.hypot(b[0] - a[0], b[1] - a[1])
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1])
    const r = Math.min(0.45, la * 0.4, lc * 0.4)
    if (r < 0.02) {
      push(b[0], b[1])
      continue
    }
    const p0 = [b[0] + ((a[0] - b[0]) * r) / la, b[1] + ((a[1] - b[1]) * r) / la]
    const p1 = [b[0] + ((c[0] - b[0]) * r) / lc, b[1] + ((c[1] - b[1]) * r) / lc]
    for (let k = 0; k <= 4; k++) {
      const u = k / 4
      push((1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * b[0] + u * u * p1[0], (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * b[1] + u * u * p1[1])
    }
  }
  return out
}

function concat(a: Pt[], b: Pt[]) {
  if (!a.length) return b.slice()
  const out = a.slice()
  const last = out[out.length - 1]
  for (const p of b) {
    const l = out[out.length - 1]
    const d = Math.hypot(p.x - l.x, p.z - l.z)
    if (d < 0.01) continue
    out.push({ x: p.x, z: p.z, s: l.s + d, v: p.v })
  }
  void last
  return out
}

/** a の続きに b を歩く（b の始めは a の終わりと同じ点）。つなぎ目から先は b の速さ（concat はつなぎ目の点に a の速さを残す） */
function append(a: Pt[], b: Pt[]) {
  const out = concat(a, b)
  if (a.length && b.length) out[a.length - 1] = { ...out[a.length - 1], v: b[0].v }
  return out
}

/** 出入口の、ゾーンの中の点（シーンの x, z） */
function portalZonePoint(p: PortalDef): [number, number] {
  if (typeof p.zone === 'string') {
    const s = townPlaces()[p.zone].position
    return [s[0], s[2]]
  }
  const z = p.zone as readonly [number, number]
  return [z[0], z[1]]
}

/** ゾーンの中の通り道（シーンの x, z の点の列）。from → to。見つからなければ null */
function zonePath(zone: TravelZone, from: [number, number], fromY: number, to: [number, number], toLevel: number, stop: PlaceId | null): [number, number][] | null {
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 0.05) return [from, to]
  let path: [number, number][] | null
  if (zone === 'lab') path = findPath(from, to)
  else {
    const model = interiors.models.get(zone as InteriorZoneId)
    if (!model) return null
    path = model.findPath(from, model.levelAt(from[0], from[1], fromY), to, toLevel)
  }
  if (path && stop && townPlaces()[stop].seat) path = seatApproach(path, stop, zone)
  return path
}

/** 町の道の経路を、歩く線とカットの区間に（ケーブル・地下の道はカット） */
function townSegs(route: TownRoute, leg: number, names: string[]): Seg[] {
  const nav = townWalk.nav!
  const out: Seg[] = []
  let group: TownRoute['steps'] = []
  const flush = () => {
    if (!group.length) return
    const sub: TownRoute = { minutes: 0, length: 0, steps: group, endNode: null }
    const line = walkLine(nav.polyline(sub), { offsetOf, widthOf: (e) => townWalk.edgeWidth(e), avoid: propsNear })
    const pts: Pt[] = line.map((p) => ({ x: p.x, z: -p.y, s: p.s, v: Math.max(0.2, p.speed / 60) }))
    if (pts.length >= 2) out.push({ kind: 'walk', leg, pts, length: pts[pts.length - 1].s })
    for (const n of nav.namesOn(sub)) if (names[names.length - 1] !== n) names.push(n)
    group = []
  }
  let cut: CutSeg | null = null
  for (const st of route.steps) {
    const isCut = st.kind === EDGE_KIND.cable || st.kind === EDGE_KIND.cableBoard || st.kind === EDGE_KIND.underground
    if (isCut) {
      flush()
      if (!cut) {
        cut = { kind: 'cut', leg, seconds: 0, mode: st.kind === EDGE_KIND.underground ? 'underground' : 'cable' }
        out.push(cut)
      }
      cut.seconds += st.minutes * 60
      const n = townWalk.edgeName(st.edge)
      if (n && names[names.length - 1] !== n && !n.startsWith('（')) names.push(n)
    } else {
      cut = null
      group.push(st)
    }
  }
  flush()
  return out
}

/** 道順の点を、経路の目的地に */
function waypointTarget(id: WaypointId): RouteTarget | number {
  const w = WAYPOINTS[id]
  if ('station' in w) return townWalk.station(w.station)?.street ?? (w as never)
  if ('plaza' in w) return { nodes: townWalk.nav?.plazaNodes(w.plaza) ?? [] }
  return w.at
}

/** 経路が丘ノ上ケーブルに乗るなら、乗る駅と降りる駅 */
function cableStationsOn(route: TownRoute): { from: CableStationKey; to: CableStationKey } | null {
  const nav = townWalk.nav!
  const boards = route.steps.filter((st) => st.kind === EDGE_KIND.cableBoard)
  if (boards.length < 2) return null
  const stationAt = (edge: number) => {
    const e = nav.data.edges[edge]
    const c = nav.data.cable.find((q) => q.node === e.a || q.node === e.b)
    return (c?.id as CableStationKey | undefined) ?? null
  }
  const from = stationAt(boards[0].edge)
  const to = stationAt(boards[boards.length - 1].edge)
  return from && to && from !== to ? { from, to } : null
}

/** 緑電・運河バスに乗る道のりの候補（chooseTransit） */
interface TransitChoice {
  vehicle: 'tram' | 'waterbus'
  label: string
  /** 停留所の名前・乗り場の id と、系統の番号・航路 */
  from: string
  to: string
  line: number | string
  /** 乗る前・降りたあとの町の道（ケーブルを含むこともある）と、乗り場の外の町の点 */
  r1: TownRoute
  r2: TownRoute
  access: XY
  exit: XY
  target: { point: XY; portal: PortalDef | null }
  /** 名目の秒（待つ・乗り降りを含む）と、着くまでの分の見込み */
  rideSec: number
  total: number
}

/**
 * 緑電・運河バスに乗る道のりを選ぶ（route=auto。docs/design/town.md §7 の 198）: 乗る所までの町の道（ケーブルが動いていればケーブルも）・
 * 今の時刻から決まる次の便を待つ時間・乗っている時間・降りた所からの町の道を足した時間がいちばん短いもの。
 * via=auto では、歩く（ケーブルを含む）より 3 分以上、かつ 25% 以上早いときだけ乗る（1 停留所だけ乗るような小さな得では乗らない。乗り降りの画は長い）。
 * via=tram・waterbus はその乗り物で（乗り場まで・乗り場から歩くのはどちらも 25 分まで）。乗り場の候補は、まっすぐの距離の見積もりで 4 つに絞ってから町の道で確かめる
 */
function chooseTransit(O: XY, targets: { point: XY; portal: PortalDef | null }[], walkMin: number, via: 'auto' | 'tram' | 'waterbus', cableOk: boolean): TransitChoice | null {
  const t0 = transitClock.serviceSec
  const est = (a: XY, b: XY) => (Math.hypot(a[0] - b[0], a[1] - b[1]) * 1.35) / 80
  interface Cand {
    vehicle: 'tram' | 'waterbus'
    line: number | string
    from: string
    to: string
    label: string
    access: XY
    exit: XY
    rideMin: number
    target: { point: XY; portal: PortalDef | null }
    est: number
  }
  const cands: Cand[] = []
  const MAX_WALK = 25
  if (via !== 'waterbus') {
    for (const line of tramNet.lines) {
      for (const dir of [1, -1] as const) {
        const list = dir > 0 ? line.outStops : line.backStops
        for (let i = 0; i < list.length; i++) {
          if (!list[i].name) continue
          const pi = tramStopPose(line, dir, i)?.platform
          if (!pi) continue
          const access = platformFoot(pi, O)
          const e1 = est(O, access)
          if (e1 > MAX_WALK) continue
          for (let j = i + 1; j < list.length; j++) {
            if (!list[j].name || list[j].name === list[i].name) continue
            const pj = tramStopPose(line, dir, j)?.platform
            if (!pj) continue
            for (const tg of targets) {
              const exit = platformFoot(pj, tg.point)
              const e2 = est(exit, tg.point)
              if (e2 > MAX_WALK) continue
              const rideMin = (list[j].arrive - list[i].depart) / 60
              cands.push({ vehicle: 'tram', line: line.data.no, from: list[i].name!, to: list[j].name!, label: `緑電 ${line.data.no} 系統（${list[i].name} → ${list[j].name}）`, access, exit, rideMin, target: tg, est: e1 + rideMin + 4 + e2 })
            }
          }
        }
      }
    }
  }
  const boats = boatNet.fleet
  if (via !== 'tram' && boats) {
    for (const r of boats.routes) {
      for (const dir of [1, -1] as const) {
        const list = dir > 0 ? r.outStops : r.backStops
        for (let i = 0; i < list.length; i++) {
          const li = landingById(list[i].id)
          if (!li) continue
          const access = landingTown(li)
          const e1 = est(O, access)
          if (e1 > MAX_WALK) continue
          for (let j = i + 1; j < list.length; j++) {
            const lj = landingById(list[j].id)
            if (!lj || lj === li) continue
            for (const tg of targets) {
              const exit = landingTown(lj)
              const e2 = est(exit, tg.point)
              if (e2 > MAX_WALK) continue
              const rideMin = (list[j].arrive - list[i].depart) / 60
              cands.push({ vehicle: 'waterbus', line: r.data.route, from: list[i].id, to: list[j].id, label: `運河バス ${r.data.route} 航路（${li.name} → ${lj.name}）`, access, exit, rideMin, target: tg, est: e1 + rideMin + 6 + e2 })
            }
          }
        }
      }
    }
  }
  cands.sort((a, b) => a.est - b.est)
  let best: TransitChoice | null = null
  for (const c of cands.slice(0, 4)) {
    if (via === 'auto' && c.est > walkMin) break
    const r1 = townWalk.route(O, c.access, { cable: cableOk, privatePenalty: 1.25 })
    const r2 = townWalk.route(c.exit, c.target.point, { cable: cableOk, privatePenalty: 1.25 })
    if (!r1 || !r2 || r1.minutes > MAX_WALK || r2.minutes > MAX_WALK) continue
    // 乗り場に着く時刻から、次の便（乗り場の中を歩く 0.5 分を足す）
    const lead = r1.minutes * 60 + 30
    let arriveTo: number | null = null
    let depart = 0
    if (c.vehicle === 'tram') {
      const line = tramLine(c.line as number)
      const b = line ? nextTramBoarding(line, c.from, c.to, t0, lead + 6) : null
      if (b) {
        arriveTo = b.arriveTo
        depart = b.depart
      }
    } else {
      const r = boats?.route(c.line as string)
      const b = r ? nextBoatBoarding(r, c.from, c.to, t0, lead + 8) : null
      if (b) {
        arriveTo = b.run.arriveTo
        depart = b.run.depart
      }
    }
    if (arriveTo === null) continue
    // 着いてから降りて乗り場の外へ出るまで（0.7 分）
    const total = (arriveTo - t0) / 60 + 0.7 + r2.minutes
    if (!best || total < best.total) best = { vehicle: c.vehicle, label: c.label, from: c.from, to: c.to, line: c.line, r1, r2, access: c.access, exit: c.exit, target: c.target, rideSec: Math.max(60, arriveTo - (t0 + lead)) + 42, total }
    void depart
  }
  if (!best) return null
  if (via === 'auto' && !(best.total <= walkMin - Math.max(3, walkMin * 0.25))) return null
  return best
}

/** ホバーで行く道のり（chooseHover） */
interface HoverChoice {
  from: HoverDockId
  to: HoverDockId
  label: string
  /** 乗り場まで・乗り場から歩く町の道（乗り場の出入口が今の所・行き先と同じなら null） */
  r1: TownRoute | null
  r2: TownRoute | null
  access: XY
  exit: XY
  target: { point: XY; portal: PortalDef | null }
  rideSec: number
  total: number
}

/** 2 点が同じ所か（町の道を歩かなくてよい） */
const samePoint = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5

/**
 * 花音のホバーで行く道のりを選ぶ（route=auto。docs/design/town.md §7 の 213）: ホバーの置いてある乗り場まで歩き（25 分まで）、同じ浮遊レーンの
 * ほかの乗り場へ飛び、そこから歩く（25 分まで）。時間 = 歩く + 乗って回す 0.6 分 + 飛ぶ（弧とレーン）+ 降りる 0.4 分 + 歩く。
 * via=auto では、ケーブルの止まっている夜中（23:30〜6:00）に、歩くより 3 分以上かつ 25% 以上早いときだけ（ふだんは歩く・ケーブル・緑電。花音の習慣）。
 * escort = 並走する仲間の場所を空ける（乗る人の仲間に浮かぶ仲間がいる。character/ride/party.ts の partyEscorts）
 */
function chooseHover(O: XY, targets: { point: XY; portal: PortalDef | null }[], walkMin: number, via: 'auto' | 'hover', escort: boolean): HoverChoice | TravelProblem | null {
  const from = HOVER_DOCKS[hoverHome.at]
  const MAX_WALK = 25
  const r1 = samePoint(O, from.access) ? null : townWalk.route(O, from.access as XY, { cable: false, privatePenalty: 1.25 })
  if (!samePoint(O, from.access) && (!r1 || r1.minutes > MAX_WALK)) return via === 'hover' ? { code: 'hover-far', dock: from.label } : null
  let best: HoverChoice | null = null
  for (const to of Object.values(HOVER_DOCKS)) {
    if (to.id === from.id || to.lane !== from.lane) continue
    const f = planFlight(from, to, false, escort)
    if (typeof f === 'string') continue
    for (const tg of targets) {
      const r2 = samePoint(to.access as XY, tg.point) ? null : townWalk.route(to.access as XY, tg.point, { cable: false, privatePenalty: 1.25 })
      if (!samePoint(to.access as XY, tg.point) && (!r2 || r2.minutes > MAX_WALK)) continue
      const rideSec = f.total + 36 + 24
      const total = (r1?.minutes ?? 0) + rideSec / 60 + (r2?.minutes ?? 0)
      if (!best || total < best.total) best = { from: from.id, to: to.id, label: `ホバー（${from.label.replace('のホバーの置き場', '').replace('のホバーの乗り場', '')} → ${to.label.replace('のホバーの置き場', '').replace('のホバーの乗り場', '')}。丘レーン）`, r1, r2, access: from.access as XY, exit: to.access as XY, target: tg, rideSec, total }
    }
  }
  if (!best) return via === 'hover' ? { code: 'hover-no-dock', dock: from.label } : null
  if (via === 'auto' && !(best.total <= walkMin - Math.max(3, walkMin * 0.25))) return null
  return best
}

/** 区間の長さ・時間を足す */
function legStats(segs: Seg[], leg: number) {
  let length = 0
  let sec = 0
  for (const s of segs) {
    if (s.leg !== leg) continue
    if (s.kind === 'cut' || s.kind === 'ride') sec += s.seconds
    else {
      length += s.length
      for (let i = 1; i < s.pts.length; i++) sec += (s.pts[i].s - s.pts[i - 1].s) / s.pts[i - 1].v
    }
  }
  return { length, minutes: sec / 60 }
}

/**
 * 道のりを作る。だめなら理由（種類と値。字は travelProblemText）
 */
export function planTravel(ch: Character, req: TravelRequest): TravelPlan | TravelProblem {
  const m = ch.motion
  if (!townWalk.ready || !townWalk.nav) return { code: 'no-town-data' }
  const isStop = req.to in townPlaces()
  const stop = isStop ? req.to : null
  const place = !isStop ? (req.to as TravelPlaceId) : null
  if (!stop && !(place! in TRAVEL_PLACES)) return { code: 'unknown-destination', to: req.to }
  const fromZone: ZoneId = m.zone
  const toZone: ZoneId = stop ? stopZone(stop) : 'town'
  if (stop && fromZone === toZone && fromZone !== 'town') return { code: 'same-zone', stop, zone: fromZone }
  if (place && fromZone === 'town') {
    // 行き先の点か、町の道から歩いて着く所（行き先の点が歩ける所でないとき、その手前）のそば
    const at = TRAVEL_PLACES[place].at
    const end = routeEndAt(at)
    const goal = end ? placeGoal([end[0], -end[1]], at) : null
    if (Math.hypot(m.position.x - at[0], -m.position.z - at[1]) < 3 || (goal && Math.hypot(m.position.x - goal[0], m.position.z - goal[1]) < 1)) return { code: 'already-there', place }
  }

  const segs: Seg[] = []
  const legs: LegInfo[] = []
  const names: string[] = []
  const pushLeg = (id: string, label: string, mode: LegInfo['mode']) => {
    legs.push({ id, label, mode, minutes: 0, length: 0 })
    return legs.length - 1
  }

  // --- 道順を選ぶ ---
  let def: TravelRouteDef | null = null
  let reversed = false
  if (req.route !== 'auto') {
    def = TRAVEL_ROUTES[req.route]
    const fromEnd = ROUTE_END_ZONE[def.from]
    const toEnd = ROUTE_END_ZONE[def.to]
    const fromOk = (z: TravelZone | null) => (z === null ? fromZone === 'town' : fromZone === z)
    const toOk = (z: TravelZone | null, endName: RouteEnd) => (z === null ? place === endName : toZone === z)
    if (fromOk(fromEnd) && toOk(toEnd, def.to)) reversed = false
    else if (fromOk(toEnd) && toOk(fromEnd, def.from)) reversed = true
    else return { code: 'route-ends', route: def.id, label: def.label, from: def.from, to: def.to, zone: fromZone, destination: stop ? toZone : place! }
    if (def.legs.some((l) => l.mode === 'cable') && !cableRunning()) return { code: 'route-cable-closed', route: def.id }
  }

  // --- 出入口 ---
  const fromPortals = fromZone === 'town' ? [] : ZONE_PORTALS[fromZone as TravelZone]
  const toPortals = toZone === 'town' ? [] : ZONE_PORTALS[toZone as TravelZone]
  const wantPortal = def?.portal
  const pickTo = toPortals.find((p) => p.id === wantPortal) ?? toPortals[0] ?? null
  const startPortal = fromPortals[0] ?? null
  const here: [number, number] = [m.position.x, m.position.z]

  // 1. ゾーンを出る
  let cursorPlan: XY | number = [m.position.x, -m.position.z]
  if (startPortal) {
    const leg = pushLeg('out', `${zoneLabel(fromZone)}を出る`, 'zone')
    const zp = portalZonePoint(startPortal)
    const path = zonePath(fromZone as TravelZone, here, m.position.y, zp, 0, null)
    if (!path) return { code: 'zone-exit-path', zone: fromZone, portal: startPortal.label }
    const tp: [number, number] = [startPortal.town[0], -startPortal.town[1]]
    const pts = scenePath(path, WALK_SPEED)
    const conn = Math.hypot(tp[0] - zp[0], tp[1] - zp[1]) > 0.05 ? scenePath([zp, tp], TOWN_WALK_SPEED) : []
    const all = concat(pts, conn)
    if (all.length >= 2) segs.push({ kind: 'walk', leg, pts: all, length: all[all.length - 1].s })
    cursorPlan = startPortal.town
  }

  // 2. 町の道
  const routeTo = (from: XY | number, to: RouteTarget | number, cable: boolean) => townWalk.route(from, to, { cable, privatePenalty: def ? 1 : 1.25 })
  let cur: XY | number = cursorPlan
  let chosen: PortalDef | null = pickTo
  if (def) {
    const list = reversed ? [...def.legs].reverse() : def.legs
    for (let li = 0; li < list.length; li++) {
      const L = list[li]
      const a: WaypointId = reversed ? L.to : L.from
      const b: WaypointId = reversed ? L.from : L.to
      const leg = pushLeg(L.id, L.label + (reversed ? '（逆向き）' : ''), L.mode)
      if (L.mode === 'cable') {
        // 丘ノ上ケーブル: 駅の入口から乗って、着いた駅の入口の外まで（character/ride/cableRide.ts）
        const st0 = stationOf(a)
        const st1 = stationOf(b)
        if (!st0 || !st1) return { code: 'route-station', route: def.id, leg: L.id }
        segs.push({ kind: 'ride', leg, vehicle: 'cable', from: st0, to: st1, seconds: (L.minutes ?? 0) * 60, state: 'pending' })
        names.push(`丘ノ上ケーブル（${ZONE_PORTALS[STATION_ZONE[st0]][0].label.replace('丘ノ上ケーブル ', '').replace('の入口', '')} → ${ZONE_PORTALS[STATION_ZONE[st1]][0].label.replace('丘ノ上ケーブル ', '').replace('の入口', '')}）`)
        cur = stationPortalTown(st1)
        continue
      }
      if (L.mode === 'tram') {
        // 緑電: 停留所のホームで待って乗り、着いた停留所のホームから降りる（character/ride/tramRide.ts）
        const s0 = tramStopOf(a)
        const s1 = tramStopOf(b)
        if (!s0 || !s1 || !L.line) return { code: 'route-tram-stop', route: def.id, leg: L.id }
        const pf = tramPlatformFor(L.line, s0, s1, 'to')
        if (!pf) return { code: 'tram-platform', line: L.line, from: s0, to: s1 }
        segs.push({ kind: 'ride', leg, vehicle: 'tram', from: s0, to: s1, line: L.line, seconds: (L.minutes ?? 0) * 60, state: 'pending' })
        names.push(`緑電 ${L.line} 系統（${s0} → ${s1}）`)
        // 次の歩く区間は、降りたホームのスロープの下から（行き先・次の点に近い方の端）
        const after = list[li + 1]
        const toward = after ? waypointPoint(reversed ? after.from : after.to) : place ? TRAVEL_PLACES[place].at : waypointPoint(b)
        cur = platformFoot(pf, toward)
        continue
      }
      // 次がケーブルなら、駅の入口の外まで。次が緑電なら、乗る停留所のホームのスロープの下まで（来る向きに近い方の端）
      const next = list[li + 1]
      const nextStation = next?.mode === 'cable' ? stationOf(b) : null
      let tramFoot: XY | null = null
      if (next?.mode === 'tram' && next.line) {
        const n0 = tramStopOf(reversed ? next.to : next.from)
        const n1 = tramStopOf(reversed ? next.from : next.to)
        const pf = n0 && n1 ? tramPlatformFor(next.line, n0, n1, 'from') : null
        if (pf) tramFoot = platformFoot(pf, typeof cur === 'number' ? townWalk.nav!.node(cur) : cur)
      }
      const r = routeTo(cur, nextStation ? stationPortalTown(nextStation) : (tramFoot ?? waypointTarget(b)), false)
      if (!r) return { code: 'route-leg-path', route: def.id, leg: L.id, label: L.label }
      segs.push(...townSegs(r, leg, names))
      cur = nextStation ? stationPortalTown(nextStation) : tramFoot ? tramFoot : (r.endNode ?? waypointPoint(b))
    }
  } else {
    // いちばん早い道（ケーブルが動いている時刻なら、ケーブルも。ケーブルを使うなら、乗る駅の入口まで・乗る・降りた駅の入口から、の 3 つの区間に分ける）。
    // 緑電・運河バスは、via で選ぶか、via=auto で十分に早いとき（§7 の 198）に、乗り場まで歩く・乗る・降りた乗り場から歩く、の 3 つの区間に
    const via = req.via ?? 'auto'
    const cableOk = via !== 'walk' && cableRunning()
    let best: { r: TownRoute; portal: PortalDef | null } | null = null
    for (const p of toPortals.length ? toPortals : [null]) {
      const r = routeTo(cur, p ? p.town : TRAVEL_PLACES[place!].at, cableOk)
      if (r && (!best || r.minutes < best.r.minutes)) best = { r, portal: p }
    }
    if (!best && via !== 'tram' && via !== 'waterbus') return { code: 'town-path', to: req.to }
    const curXY: XY = typeof cur === 'number' ? townWalk.nav!.node(cur) : cur
    const targets = (toPortals.length ? toPortals : [null]).map((p) => ({ point: (p ? p.town : TRAVEL_PLACES[place!].at) as XY, portal: p }))
    let transit = via === 'auto' || via === 'tram' || via === 'waterbus' ? chooseTransit(curXY, targets, best?.r.minutes ?? Infinity, via, cableOk) : null
    if ((via === 'tram' || via === 'waterbus') && !transit) return { code: 'transit-way', vehicle: via, to: req.to }
    // ホバー: via=hover か、ケーブルの止まっている夜中に十分に早いとき（§7 の 213）
    const hv = via === 'hover' || (via === 'auto' && !cableRunning()) ? chooseHover(curXY, targets, Math.min(best?.r.minutes ?? Infinity, transit?.total ?? Infinity), via === 'hover' ? 'hover' : 'auto', partyEscorts(ch)) : null
    if (via === 'hover' && (!hv || 'code' in hv)) return hv ?? { code: 'hover-way', to: req.to }
    if (hv && !('code' in hv)) {
      transit = null
      const exitLabel = hv.r1 ? 'ホバーの乗り場へ' : ''
      if (hv.r1) segs.push(...townSegs(hv.r1, pushLeg('town', `町の道（${exitLabel}）`, 'walk'), names))
      const leg = pushLeg('hover', hv.label, 'hover')
      segs.push({ kind: 'ride', leg, vehicle: 'hover', from: hv.from, to: hv.to, seconds: hv.rideSec, state: 'pending' })
      names.push(hv.label)
      cur = hv.exit
      if (hv.r2) segs.push(...townSegs(hv.r2, pushLeg('after', '町の道', 'walk'), names))
      else cur = hv.target.point
      if (hv.target.portal) chosen = hv.target.portal
    } else if (transit) {
      if (!pushTownRoute(transit.r1, cur, transit.access, 'town', `町の道（${transit.vehicle === 'tram' ? '停留所' : '乗り場'}へ）`)) return { code: 'town-path-cable', to: req.to }
      const leg = pushLeg(transit.vehicle, transit.label, transit.vehicle)
      segs.push({ kind: 'ride', leg, vehicle: transit.vehicle, from: transit.from, to: transit.to, line: transit.line, seconds: transit.rideSec, state: 'pending' })
      names.push(transit.label)
      cur = transit.exit
      if (!pushTownRoute(transit.r2, transit.exit, transit.target.point, 'after', '町の道')) return { code: 'town-path-cable', to: req.to }
      if (transit.target.portal) chosen = transit.target.portal
    } else if (best) {
      const end = best.portal ? best.portal.town : TRAVEL_PLACES[place!].at
      if (!pushTownRoute(best.r, cur, end, 'town', '町の道')) return { code: 'town-path-cable', to: req.to }
      if (best.portal) chosen = best.portal
    }
  }

  /** 町の道の経路 r（from → to）を区間に（丘ノ上ケーブルに乗るなら、乗る駅の入口まで・乗る・降りた駅の入口から、の 3 つ） */
  function pushTownRoute(r: TownRoute, from: XY | number, to: RouteTarget | number, id: string, label: string) {
    const ride = cableStationsOn(r)
    if (!ride) {
      segs.push(...townSegs(r, pushLeg(id, label, 'walk'), names))
      return true
    }
    const r1 = routeTo(from, stationPortalTown(ride.from), false)
    const r2 = routeTo(stationPortalTown(ride.to), to, false)
    if (!r1 || !r2) return false
    segs.push(...townSegs(r1, pushLeg(id, `${label}（ケーブルの駅へ）`, 'walk'), names))
    const leg = pushLeg('cable', '丘ノ上ケーブル', 'cable')
    // 名目の時間: 全線 4 分の比例 + 乗り降り 0.5 分ずつ（D-037。道のグラフのケーブルの辺の時間）
    const sec = r.steps.filter((st) => st.kind === EDGE_KIND.cable || st.kind === EDGE_KIND.cableBoard).reduce((acc, st) => acc + st.minutes * 60, 0)
    segs.push({ kind: 'ride', leg, vehicle: 'cable', from: ride.from, to: ride.to, seconds: sec, state: 'pending' })
    names.push('丘ノ上ケーブル')
    segs.push(...townSegs(r2, pushLeg(id === 'town' ? 'town2' : `${id}-2`, label, 'walk'), names))
    return true
  }

  // 乗り物の区間で終わる（ルート F の緑電・運河バスで町の行き先へ）: 降りた乗り場から歩いて出る所（スロープの下・石段の上）
  const tail = segs[segs.length - 1]
  if (tail && tail.kind === 'ride') {
    const at = typeof cur === 'number' ? townWalk.nav!.node(cur) : cur
    tail.exitAt = [at[0], -at[1]]
  }
  // 町の行き先: 道のりの終わり（町の道の経路の終わり = 行き先の点を道の上へつないだ点か、降りた乗り場の外）から、行き先の点まで歩く
  // （ひらき通りは道の真ん中から北の歩道へ。停留所のスロープの下から歩道へ。§7 の 197）。行き先の点が歩ける所でなければ、その手前の縁まで
  if (place) {
    const end = planEnd(segs)
    if (end) {
      const goal = placeGoal(end, TRAVEL_PLACES[place].at)
      if (Math.hypot(goal[0] - end[0], goal[1] - end[1]) > 0.3) {
        const pts = scenePath([end, goal], TOWN_WALK_SPEED)
        const last = segs[segs.length - 1]
        if (last.kind === 'walk') {
          last.pts = append(last.pts, pts)
          last.length = last.pts[last.pts.length - 1].s
        } else segs.push({ kind: 'walk', leg: last.leg, pts, length: pts[pts.length - 1].s })
      }
    }
  }

  // 3. 行き先のゾーンへ入る
  const enter = chosen
  let heading: number | null = null
  if (stop && enter) {
    const leg = pushLeg('in', `${townPlaces()[stop].label}へ`, 'zone')
    const zp = portalZonePoint(enter)
    const tp: [number, number] = [enter.town[0], -enter.town[1]]
    const last = lastPoint(segs) ?? tp
    const conn = scenePath([last, tp, zp].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05) as [number, number][], TOWN_WALK_SPEED)
    const goal = townPlaces()[stop].position
    // 出入口の高さ（町の地面に近い面。建物の上の階の床を拾わないように）
    const zoneY = toZone === 'lab' ? 0 : (interiors.models.get(toZone as InteriorZoneId)?.groundAt(zp[0], zp[1], townWalk.groundY(zp[0], zp[1])) ?? INTERIOR_ZONES[toZone as InteriorZoneId].floorY)
    const path = zonePath(toZone as TravelZone, zp, zoneY, [goal[0], goal[2]], townPlaces()[stop].level ?? 0, stop)
    if (!path) return { code: 'zone-entry-path', zone: toZone, stop }
    const all = concat(conn.length >= 2 ? conn : [], scenePath(path, WALK_SPEED))
    if (all.length >= 2) segs.push({ kind: 'walk', leg, pts: all, length: all[all.length - 1].s })
  } else if (place) {
    const f = TRAVEL_PLACES[place].face
    const last = planEnd(segs) ?? lastPoint(segs)
    if (last && Math.hypot(f[0] - last[0], -f[1] - last[1]) > 0.5) heading = Math.atan2(f[0] - last[0], -f[1] - last[1])
  }
  if (!segs.length) return { code: 'empty-plan' }
  for (let i = 0; i < legs.length; i++) Object.assign(legs[i], legStats(segs, i))
  const minutes = legs.reduce((s, l) => s + l.minutes, 0)
  const length = legs.reduce((s, l) => s + l.length, 0)
  return { route: req.route, reversed, segs, legs, stop, place, heading, minutes, length, names }
}
function waypointPoint(id: WaypointId): XY {
  const w = WAYPOINTS[id]
  if ('station' in w) {
    const s = townWalk.station(w.station)
    return s ? townWalk.nav!.node(s.street) : [0, 0]
  }
  if ('plaza' in w) {
    const n = townWalk.nav?.plazaNodes(w.plaza)[0]
    return n !== undefined ? townWalk.nav!.node(n) : [0, 0]
  }
  return w.at
}

function lastPoint(segs: Seg[]): [number, number] | null {
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]
    if (s.kind === 'walk') return [s.pts[s.pts.length - 1].x, s.pts[s.pts.length - 1].z]
  }
  return null
}

/**
 * 道のりの終わりの点（シーンの x, z）: 最後が歩く所ならその終わり、飛ばした歩く所のカットなら飛ばした所の終わり、乗り物の区間なら降りた乗り場の外。
 * わからなければ null（地下の道のカット）
 */
function planEnd(segs: Seg[]): [number, number] | null {
  const s = segs[segs.length - 1]
  if (!s) return null
  if (s.kind === 'walk') return [s.pts[s.pts.length - 1].x, s.pts[s.pts.length - 1].z]
  if (s.kind === 'cut') {
    const p = s.path?.[s.path.length - 1]
    return p ? [p.x, p.z] : null
  }
  return s.exitAt ?? null
}

/** 町の点 p（平面座標）へ向かう町の道の経路が終わる所（townNav の route が目的地の点を道へつなぐのと同じ: 3m 内の節点か、いちばん近い道の上の点） */
function routeEndAt(p: XY): XY | null {
  const nav = townWalk.nav
  if (!nav) return null
  const n = nav.nearestNode(p[0], p[1])
  if (n >= 0 && Math.hypot(nav.node(n)[0] - p[0], nav.node(n)[1] - p[1]) <= 3) return nav.node(n)
  const s = nav.snap(p[0], p[1], 60)
  return s ? [s.x, s.y] : null
}

/** 町の歩ける所（道・石段・橋の幅の中で縁から margin m 以上内側・広場・停留所のホームなどの歩ける面）か（シーンの x, z） */
function onTownGround(x: number, z: number, margin = 0) {
  return townWalk.onWalkway(x, z, margin) || townWalk.extraAt(x, -z) !== null
}

/**
 * 町の行き先へ歩いて着く所（シーンの x, z）: 道のりの終わり from から、行き先の点 at（平面座標）へまっすぐ。行き先の点が町の歩ける所なら
 * その点（街灯の柱・木の幹から離す）。歩ける所でなければ（小野寺時計店は店の中の点）、まっすぐ向かって歩ける所を出る手前（縁から 0.25m）まで
 */
function placeGoal(from: [number, number], at: XY): [number, number] {
  if (onTownGround(at[0], -at[1])) {
    const g = clearOfProps(at)
    return [g[0], -g[1]]
  }
  const gx = at[0] - from[0]
  const gz = -at[1] - from[1]
  const n = Math.ceil(Math.hypot(gx, gz) / 0.25)
  let k = 0
  while (k < n && onTownGround(from[0] + (gx * (k + 1)) / n, from[1] + (gz * (k + 1)) / n, 0.25)) k++
  if (k === 0) return from
  const g = clearOfProps([from[0] + (gx * k) / n, -(from[1] + (gz * k) / n)])
  return [g[0], -g[1]]
}

function zoneLabel(z: ZoneId) {
  if (z === 'lab') return 'ラボ'
  if (z === 'town') return '町'
  return INTERIOR_ZONES[z].label
}

/* -------------------------------------------------------------------------- */
/* 時間の扱い（cut=leg・fast）                                                      */
/* -------------------------------------------------------------------------- */

/**
 * cut=leg: 区間ごとに showSec 秒ぶんだけ歩き（最初の区間は始め、最後の区間は終わり、途中は真ん中。6 分より長い区間は始めと真ん中も）、
 * ほかはカットにする。ゾーンを出る・入る短い区間は、となりの町の区間とまとめて 1 つに数える（ラボを出て小径を歩き出す所を、続けて見せる）
 */
function windowed(plan: TravelPlan, showSec: number): Seg[] {
  const out: Seg[] = []
  const showLen = showSec * TOWN_WALK_SPEED
  /** 歩く区間 s の a〜b m を飛ばすカット（続けて飛ばすなら、前のカットに足す） */
  const pushSkip = (s: WalkSeg, a: number, b: number) => {
    const seconds = timeOf(s, a, b)
    const pts = slice(s, a, b).pts
    const last = out[out.length - 1]
    if (last && last.kind === 'cut' && last.mode === 'skip') {
      last.seconds += seconds
      last.path = concat(last.path ?? [], pts)
    } else out.push({ kind: 'cut', leg: s.leg, seconds, mode: 'skip', path: pts })
  }
  // 区間をまとめる（短いゾーンの区間は、となりの町の区間と同じ組）
  const nLegs = plan.legs.length
  const group: number[] = []
  let g = 0
  for (let i = 0; i < nLegs; i++) {
    const L = plan.legs[i]
    const shortZone = L.mode === 'zone' && L.length < showLen * 1.3
    if (i > 0 && !(L.mode === 'zone' && i === nLegs - 1 && shortZone) && !(i === 1 && plan.legs[0].mode === 'zone' && plan.legs[0].length < showLen * 1.3)) g++
    group.push(g)
  }
  const nGroups = g + 1
  for (let gi = 0; gi < nGroups; gi++) {
    const segs = plan.segs.filter((s) => group[s.leg] === gi)
    const walkLen = segs.reduce((a, s) => a + (s.kind === 'walk' ? s.length : 0), 0)
    if (!walkLen) {
      for (const s of segs) out.push(s)
      continue
    }
    // 見せる範囲は時間で決める（石段・坂は遅いので、同じ秒でも短い）。歩く所の長さ ⇔ 名目の時間の表
    const dist: number[] = [0]
    const time: number[] = [0]
    for (const s of segs) {
      if (s.kind !== 'walk') continue
      for (let i = 1; i < s.pts.length; i++) {
        dist.push(dist[dist.length - 1] + (s.pts[i].s - s.pts[i - 1].s))
        time.push(time[time.length - 1] + (s.pts[i].s - s.pts[i - 1].s) / s.pts[i - 1].v)
      }
    }
    const walkSec = time[time.length - 1]
    const distAt = (sec: number) => {
      const t = Math.min(Math.max(sec, 0), walkSec)
      let lo = 0
      let hi = time.length - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (time[mid] <= t) lo = mid
        else hi = mid
      }
      const k = (t - time[lo]) / Math.max(1e-9, time[hi] - time[lo])
      return dist[lo] + (dist[hi] - dist[lo]) * Math.min(1, Math.max(0, k))
    }
    // 見せる範囲（組の歩く時間の上で → 長さへ）
    const tw: [number, number][] = []
    if (walkSec <= showSec * 1.3) tw.push([0, walkSec])
    else {
      const longLeg = walkSec > 360
      if (gi === 0 || (longLeg && gi !== nGroups - 1)) tw.push([0, showSec])
      if (gi !== 0 && gi !== nGroups - 1) tw.push([walkSec / 2 - showSec / 2, walkSec / 2 + showSec / 2])
      else if (longLeg) tw.push([walkSec / 2 - showSec / 2, walkSec / 2 + showSec / 2])
      if (gi === nGroups - 1) tw.push([walkSec - showSec, walkSec])
    }
    const wins: [number, number][] = tw.map(([a, b]) => [distAt(a), distAt(b)])
    wins.sort((a, b) => a[0] - b[0])
    let acc = 0
    for (const s of segs) {
      if (s.kind !== 'walk') {
        out.push(s)
        continue
      }
      const s0 = acc
      const s1 = acc + s.length
      acc = s1
      // この歩く区間の上の、見せる所と飛ばす所。0.5m より短い見せる所は歩かないが、道のりの最後の見せる所（着く所。乗り物を降りた
      // 乗り場の外から行き先までの、短い歩く所だけのこともある）は短くても歩く（歩かないと、行き先へ着かずに乗り場で止まる）
      let cur = s0
      for (const [a, b] of wins) {
        const u = Math.max(a, s0)
        const v = Math.min(b, s1)
        if (v <= u) continue
        if (u > cur + 0.01) pushSkip(s, cur - s0, u - s0)
        const end = gi === nGroups - 1 && v >= walkLen - 0.01
        if (v - u > (end ? 0.01 : 0.5)) out.push(slice(s, u - s0, v - s0))
        cur = v
      }
      if (s1 > cur + 0.01) pushSkip(s, cur - s0, s.length)
    }
  }
  return out
}

/** 歩く区間の a〜b m を歩く名目の秒 */
function timeOf(s: WalkSeg, a: number, b: number) {
  let sec = 0
  for (let i = 1; i < s.pts.length; i++) {
    const p = s.pts[i - 1]
    const q = s.pts[i]
    const lo = Math.max(a, p.s)
    const hi = Math.min(b, q.s)
    if (hi > lo) sec += (hi - lo) / p.v
  }
  return sec
}

/** 歩く区間の a〜b m を切り出す */
function slice(s: WalkSeg, a: number, b: number): WalkSeg {
  const pts: Pt[] = []
  const at = (d: number) => pointAt(s, d)
  pts.push({ ...at(a), s: 0 })
  for (const p of s.pts) if (p.s > a + 0.01 && p.s < b - 0.01) pts.push({ x: p.x, z: p.z, s: p.s - a, v: p.v })
  pts.push({ ...at(b), s: b - a })
  return { kind: 'walk', leg: s.leg, pts, length: b - a }
}

/** 歩く区間の d m の点 */
function pointAt(s: WalkSeg, d: number): Pt {
  const pts = s.pts
  let lo = 0
  let hi = pts.length - 1
  if (d <= 0) return pts[0]
  if (d >= s.length) return pts[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].s <= d) lo = mid
    else hi = mid
  }
  const p = pts[lo]
  const q = pts[hi]
  const t = (d - p.s) / Math.max(1e-6, q.s - p.s)
  return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, s: d, v: p.v }
}

/* -------------------------------------------------------------------------- */
/* 毎コマ                                                                       */
/* -------------------------------------------------------------------------- */

type RunPhase = 'prepare' | 'walk' | 'arrive' | 'done'

/** 町の中の移動の途中の様子（Character ごと。ch.travel） */
export function createTravelRun() {
  return {
    plan: null as TravelPlan | null,
    segs: [] as Seg[],
    seg: 0,
    /** 今の歩く区間の上の距離 */
    s: 0,
    speed: 0,
    phase: 'done' as RunPhase,
    /** 早送りの倍率 */
    scale: 1,
    /** 続きの kanon.travel で時間の扱いを変えたときの倍率の行き先（scale をなめらかに近づける。retimeTravel。§7 の 216） */
    scaleTo: 1,
    /** 今の区間（legs の番号）と、区間が変わった回数 */
    leg: 0,
    legSerial: 0,
    /** カットした回数 */
    cutSerial: 0,
    /** 始めてから町の時刻に足した秒（カット・早送り） */
    added: 0,
    /** 歩き始めた・着いたシーンの時刻 */
    startedAt: 0,
    t: 0,
    /** 着いたときの行動の扱い */
    activity: true,
    /** 中止の理由 */
    error: null as string | null,
    /** 始めた回数（取り消し・やり直しの見分け） */
    serial: 0,
    /** 始めたときの指示（ケーブルの区間の時間の扱い・座るか立つか） */
    req: null as TravelRequest | null,
    /** 乗り物の区間の乗る便の決まり（待つ所）と、乗り始めたときの乗り物の足した時間（町の時計の townWarp.added()。core/clock.ts） */
    boarding: null as Boarding | null,
    rideWarp0: 0,
  }
}

export type TravelRun = ReturnType<typeof createTravelRun>

/** 移動の途中か */
export function traveling(ch: Character) {
  return ch.travel.phase !== 'done'
}

/** 今の移動の様子（状態の返送・実行処理） */
export function travelState(ch: Character) {
  const run = ch.travel
  const p = run.plan
  if (!p || run.phase === 'done') return null
  const leg = p.legs[run.leg]
  return {
    route: p.route,
    reversed: p.reversed,
    to: p.stop ?? p.place,
    leg: leg?.id ?? null,
    leg_label: leg?.label ?? null,
    leg_index: run.leg,
    legs: p.legs.length,
    phase: run.phase,
    added_s: Math.round(run.added),
    cable: cableRideState(ch),
    tram: ch.rides.tram.state(),
    waterbus: ch.rides.boat.state(),
    hover: hoverRide.state(ch),
  }
}

/** 移動を始める。だめなら理由（種類と値。字は travelProblemText）。time=cut・cut=none は道のりを作ってすぐ行き先へ置く */
export function startTravel(ch: Character, req: TravelRequest): TravelPlan | TravelProblem {
  const run = ch.travel
  const m = ch.motion
  const plan = planTravel(ch, req)
  if (isTravelProblem(plan)) return plan
  townData.loadAllTiles()
  // ゾーンの中を歩いている途中（kanon.goto）なら、その経路をやめる
  if (m.phase !== 'idle' && run.phase === 'done') stopWalking(ch)
  run.plan = plan
  run.serial++
  run.error = null
  run.added = 0
  run.activity = req.activity
  run.req = req
  run.boarding = null
  run.leg = 0
  run.legSerial = 0
  run.cutSerial = 0
  run.startedAt = run.t
  if (req.time === 'cut' && req.cut === 'none') {
    // 一度に行き先へ（町の時刻を道のりの時間だけ進める）
    const total = plan.minutes * 60
    addTime(ch, run, total)
    run.segs = []
    jumpToEnd(ch, plan)
    return plan
  }
  run.segs = req.time === 'cut' ? windowed(plan, req.showSec) : plan.segs
  // 早送り: 歩く所の名目の時間を fastSec 秒に（倍率 fastSpeed なら、その倍）
  run.scale = 1
  if (req.time === 'fast') {
    const walkSec = run.segs.reduce((a, s) => a + (s.kind === 'walk' ? timeOf(s, 0, s.length) : 0), 0)
    run.scale = Math.max(1, req.fastSpeed ?? walkSec / Math.max(1, req.fastSec ?? 30))
  }
  run.scaleTo = run.scale
  // 早送りは歩き出してから約 1 秒でなめらかに速くする（drive の倍率の近づけ方）
  run.scale = 1
  run.seg = 0
  run.s = 0
  run.speed = m.phase === 'walk' ? m.speed : 0
  run.phase = 'prepare'
  m.stopId = null
  m.targetId = null
  m.seat = null
  m.activityHeld = false
  return plan
}

/** 移動をやめる（その場で止まる） */
export function cancelTravel(ch: Character, reason = '取り消し') {
  const run = ch.travel
  if (run.phase === 'done') return
  run.phase = 'done'
  run.error = reason
  // 乗り物の区間の途中: 待っている間ならやめる。乗っている途中なら、着いた乗り場に出るまで乗る仕組みが動かす
  const rides = ch.rides
  cancelCableRide(ch)
  rides.tram.cancel()
  rides.boat.cancel()
  hoverRide.cancel(ch)
  if (cableRiding(ch) || rides.tram.active() || rides.boat.active() || hoverRide.active(ch)) return
  const m = ch.motion
  m.speed = 0
  m.phase = 'idle'
  m.timeScale = 1
  m.stride = null
}

/**
 * 続きの kanon.travel（同じ行き先・道順。新しく始めずに続きを待つ行）で、この先の時間の扱いを変える（§7 の 216）。
 * - 歩く所: time が real ↔ fast のとき、早送りを始める・やめる（speed か、残りの歩く所を duration で）。倍率は約 1 秒でなめらかに変える。
 *   cut から・cut へは変えない（区間ごとに見せる所はもう決めてあるため）
 * - 乗り物: まだ乗り始めていない乗り物の区間の ride_time・wait と、早送りの倍率（speed）。乗っている途中の区間は変わらない
 * 戻り値: 変えた項目の名前
 */
export function retimeTravel(ch: Character, p: { time: TravelTime; fastSec: number | null; fastSpeed: number | null; rideTime?: RideTime; waitTime?: RideTime }): string[] {
  const run = ch.travel
  const req = run.req
  if (!req || run.phase === 'done') return []
  const changed: string[] = []
  if (p.rideTime && p.rideTime !== rideTimeOf(req.rideTime, req.time)) {
    req.rideTime = p.rideTime
    changed.push('ride_time')
  }
  if (p.waitTime && p.waitTime !== rideTimeOf(req.waitTime, req.time)) {
    req.waitTime = p.waitTime
    changed.push('wait')
  }
  if (p.fastSpeed !== null && p.fastSpeed !== req.fastSpeed) {
    req.fastSpeed = p.fastSpeed
    changed.push('speed')
  }
  // 乗っている途中（待つ・乗り込む・発車まで）の乗り物も: これから使う待つ間・走る間の扱いと倍率（もう使った所は変わらない）
  const { tram, boat } = ch.rides
  const active = tram.active() ? tram.spec : boat.active() ? boat.spec : cableRiding(ch) ? cableRideSpec(ch) : hoverRide.active(ch) ? hoverRide.spec(ch) : null
  if (active) {
    if (p.rideTime) active.ride = p.rideTime
    if (p.waitTime) active.wait = p.waitTime
    if (p.fastSpeed !== null) active.fastSpeed = p.fastSpeed
  }
  if (req.time === 'cut' || p.time === 'cut') return changed
  // 時間の扱いを書いていない乗り物の区間は、元の time のまま（歩く所の time を変えても、乗り物の扱いは変えない）
  req.rideTime ??= rideTimeOf(undefined, req.time)
  req.waitTime ??= rideTimeOf(undefined, req.time)
  let to = 1
  if (p.time === 'fast') {
    let walkSec = 0
    for (let i = run.seg; i < run.segs.length; i++) {
      const sg = run.segs[i]
      if (sg.kind === 'walk') walkSec += timeOf(sg, i === run.seg ? run.s : 0, sg.length)
    }
    to = Math.max(1, req.fastSpeed ?? walkSec / Math.max(1, p.fastSec ?? 30))
  }
  if (p.time !== req.time || Math.abs(to - run.scaleTo) > 1e-6) {
    if (p.time !== req.time) changed.push('time')
    req.time = p.time
    req.fastSec = p.fastSec
    run.scaleTo = to
  }
  return changed
}

/** 町の時刻に足す（時計を進めてよくない人なら足さない。character/ride/warp.ts の setWarpPermit） */
function addTime(ch: Character, run: TravelRun, sec: number) {
  if (sec <= 0 || !warpClock(ch, sec)) return
  run.added += sec
}

/** 足元の高さを拾う間隔（m。groundAlong。建物の中の段・坂と、橋の上り口で、歩いたときと同じ床・路面を選ぶのに十分に細かく） */
const GROUND_STEP = 0.3

/**
 * 今の所（足元の高さ y0）から、歩く線（シーンの点の列）を順にたどったときの足元の高さ。歩いたときと同じに、少し進むたびに今の高さに
 * いちばん近い床・路面を拾う（locomotion の groundHeight）。カット・cut=none で置く所の高さを、点の真上の面のうち前にいた高さに近い物でなく、
 * 道のりのとおりに歩いて来た面にする（建物の階が重なる所: 1 階の上の屋根裏・吹き抜けの上の回廊。橋の上と下の道）。
 * 線と線の間（乗り物・地下の道）はつながっていないので、たどらずに次の線の始めの点で拾う
 */
function groundAlong(ch: Character, lines: readonly (readonly { x: number; z: number }[])[], y0: number) {
  let y = y0
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const p = line[i]
      if (i > 0) {
        const q = line[i - 1]
        const n = Math.ceil(Math.hypot(p.x - q.x, p.z - q.z) / GROUND_STEP)
        for (let k = 1; k < n; k++) y = groundHeight(ch, q.x + ((p.x - q.x) * k) / n, q.z + ((p.z - q.z) * k) / n, false, y)
      }
      y = groundHeight(ch, p.x, p.z, false, y)
    }
  }
  return y
}

/** カット・cut=none で置いた所の足元の高さを決める（次のコマの locomotion が、この高さに近い床・路面に立たせる） */
function setGround(m: CharacterMotion, y: number) {
  m.position.y = y
  m.ground = y
}

/** 道のりの最後へすぐ置く（cut=none）。道のりの最後が乗り物の区間なら、降りた乗り場の外（planTravel の着いた所の向きと同じ点） */
function jumpToEnd(ch: Character, plan: TravelPlan) {
  const run = ch.travel
  const m = ch.motion
  const tail = plan.segs[plan.segs.length - 1]
  const exit = tail && tail.kind === 'ride' && tail.exitAt ? tail.exitAt : null
  const last = exit ?? lastPoint(plan.segs)
  if (!last) return
  const lines: { x: number; z: number }[][] = plan.segs.filter((s): s is WalkSeg => s.kind === 'walk').map((s) => s.pts)
  if (exit) lines.push([{ x: exit[0], z: exit[1] }])
  setGround(m, groundAlong(ch, lines, m.position.y))
  m.position.x = last[0]
  m.position.z = last[1]
  m.zone = zoneOfPoint(last[0], last[1])
  m.placeSerial++
  m.speed = 0
  if (plan.stop) {
    m.heading = townPlaces()[plan.stop].heading
    m.targetId = plan.stop
    m.phase = 'turnEnd'
    run.phase = 'done'
  } else {
    m.heading = plan.heading ?? m.heading
    m.phase = 'idle'
    m.stopId = null
    run.phase = 'done'
  }
  m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
  ch.events.emit('place', null)
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
/** 向きを目標へ回す（比例 + 最大の速さ）。早送りで dt が大きくても行き過ぎないよう、指数で近づける */
function turnToward(m: CharacterMotion, target: number, dt: number, maxRate = 2.6) {
  const err = wrapAngle(target - m.heading)
  const step = THREE.MathUtils.clamp(err * (1 - Math.exp(-4.5 * dt)), -maxRate * dt, maxRate * dt)
  m.heading = wrapAngle(m.heading + step)
  m.turnRate = dt > 0 ? step / dt : 0
  return err
}

/** 今の歩く区間（無ければ null） */
function walkSeg(run: TravelRun): WalkSeg | null {
  const s = run.segs[run.seg]
  return s && s.kind === 'walk' ? s : null
}

/** 残りの歩く道のり（この先にカットがあれば、カットまで。減速の目安） */
function remainBeforeStop(run: TravelRun) {
  const s = walkSeg(run)
  if (!s) return 0
  // 最後の区間・ケーブルのホームの待つ所へ歩く区間: この区間の残りで止まる（この先にカットがあれば止まらない）
  const next = run.segs[run.seg + 1]
  const stop = next && next.kind === 'ride' && next.state === 'approach'
  return s.length - run.s + (run.seg + 1 < run.segs.length && !stop ? 1e6 : 0)
}

/** 区間（legs）の番号を進める */
function setLeg(run: TravelRun, leg: number) {
  if (leg !== run.leg) {
    run.leg = leg
    run.legSerial++
  }
}

/** 次の区間へ（カットはその場で飛ばす） */
function advanceSeg(ch: Character) {
  const run = ch.travel
  const m = ch.motion
  run.seg++
  run.s = 0
  // 続けて飛ばしたカットの、飛ばした歩く所（置く所の足元の高さを、ここを歩いたときと同じにする）
  const skipped: Pt[][] = []
  while (run.seg < run.segs.length && run.segs[run.seg].kind === 'cut') {
    const c = run.segs[run.seg] as CutSeg
    addTime(ch, run, c.seconds)
    setLeg(run, c.leg)
    if (c.path?.length) skipped.push(c.path)
    // カットのたびに数える（until=leg は次の区間か、次に見せる所で完了する）
    run.cutSerial++
    run.seg++
    const next = walkSeg(run)
    if (next) {
      // 次の歩く区間の始めへ置く（カメラ・KB-001 も一緒に移る）
      const p = next.pts[0]
      const q = pointAt(next, Math.min(next.length, 1.5))
      // 飛ばした歩く所があれば（time=cut）、そこを歩いたときの足元の高さ。乗り物・地下の道のカットだけなら、次のコマの locomotion が
      // 今の高さから拾う（どの時間の扱いでも同じ）
      if (skipped.length) setGround(m, groundAlong(ch, [...skipped, [p]], m.position.y))
      skipped.length = 0
      m.position.x = p.x
      m.position.z = p.z
      m.heading = Math.atan2(q.x - p.x, q.z - p.z)
      m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
      m.zone = zoneOfPoint(p.x, p.z)
      m.placeSerial++
      // 歩いている途中から続ける（止まらずに）
      run.speed = Math.min(p.v, TOWN_WALK_SPEED)
      ch.events.emit('place', null)
    } else if (run.seg >= run.segs.length && skipped.length) {
      // 道のりがカットで終わる（乗り物を降りた乗り場から出る所を飛ばした）: 飛ばした所の終わりへ置く
      const line = skipped[skipped.length - 1]
      const p = line[line.length - 1]
      const q = line.length >= 2 ? line[line.length - 2] : { x: m.position.x, z: m.position.z }
      setGround(m, groundAlong(ch, skipped, m.position.y))
      m.position.x = p.x
      m.position.z = p.z
      if (Math.hypot(p.x - q.x, p.z - q.z) > 1e-3) m.heading = Math.atan2(p.x - q.x, p.z - q.z)
      m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
      m.zone = zoneOfPoint(p.x, p.z)
      m.placeSerial++
      ch.events.emit('place', null)
    }
  }
  const s = walkSeg(run)
  if (s) setLeg(run, s.leg)
}

/** 乗り場の手前・降りてから・着く前の、そのままの速さで歩く長さ（m。早送りから緩め始める所・速くし始める所。§7 の 216） */
const EASE_BEFORE_STATION = 20
const EASE_AFTER_STATION = 15
const EASE_BEFORE_ARRIVE = 15

/**
 * 今の早送りの倍率の行き先。早送り（time=fast）でも、乗り物の待つ間をそのまま見せる（wait=real）なら、待つ所の手前の 20m（船着き場の石段・停留所のスロープ・
 * 駅のホーム）と、降りてからの 15m（石段を上がる・ホームから出る）はそのままの速さ。道のりの最後の 15m（着く所）もそのままの速さ（§7 の 216）
 */
function scaleWanted(run: TravelRun): number {
  const to = run.scaleTo
  if (to <= 1 || !run.req || run.phase !== 'walk') return to
  const waitReal = rideTimeOf(run.req.waitTime, run.req.time) === 'real'
  // 乗っている間（乗る仕組みが花音を動かす）は、降りてから出る道をそのままの速さで始められるよう 1 のまま
  if (rideSeg(run)) return waitReal ? 1 : to
  const seg = walkSeg(run)
  if (!seg) return to
  if (seg.station === 'out' && waitReal && run.s < EASE_AFTER_STATION) return 1
  let remain = seg.length - run.s
  for (let i = run.seg + 1; i < run.segs.length; i++) {
    const n = run.segs[i]
    if (n.kind === 'ride') return waitReal && remain < EASE_BEFORE_STATION ? 1 : to
    if (n.kind === 'cut') return to
    remain += n.length
    if (remain >= EASE_BEFORE_ARRIVE) return to
  }
  return remain < EASE_BEFORE_ARRIVE ? 1 : to
}

const _tan = new THREE.Vector2()

/** locomotion から毎コマ（Character の drivers.travel）。動かしたら true */
export function driveTravel(ch: Character, t: number, dt: number): boolean {
  const run = ch.travel
  run.t = t
  const m = ch.motion
  if (run.phase === 'done' || !run.plan) {
    if (m.timeScale !== 1) m.timeScale = 1
    return false
  }
  // 早送りの倍率をなめらかに（約 1 秒で）行き先へ（歩き出し・続きの kanon.travel で始めた・やめたとき・乗り場の手前と着く前で緩めるとき）
  const kTo = scaleWanted(run)
  if (run.scale !== kTo) {
    const d = run.scale - kTo
    run.scale = Math.abs(d) < 0.02 ? kTo : kTo + d * Math.exp(-8 * Math.max(dt, 0))
  }
  m.timeScale = run.scale
  // 乗り物の区間（丘ノ上ケーブル）
  const rs = rideSeg(run)
  if (rs) return rideStep(ch, rs)
  // 着いて向きを合わせる（道のりの最後が乗り物の区間・カットのときも、区間を先へ進めない）
  if (run.phase === 'arrive') return arriveStep(ch, dt)
  let seg = walkSeg(run)
  if (!seg) {
    advanceSeg(ch)
    if (rideSeg(run)) return true
    seg = walkSeg(run)
    if (!seg) return finish(ch)
  }
  if (run.phase === 'prepare') {
    // 行き先の方へ向き、行動の姿勢を解いてから歩き出す
    const q = pointAt(seg, Math.min(seg.length, 1.2))
    const p = seg.pts[0]
    const err = turnToward(m, Math.atan2(q.x - p.x, q.z - p.z), dt)
    m.phase = 'turnStart'
    m.speed = Math.max(0, m.speed - dt * 2)
    if (Math.abs(err) < 0.4 && m.actionBlend < 0.35) {
      run.phase = 'walk'
      run.startedAt = t
    }
    return true
  }
  // --- 歩く ---
  const k = run.scale
  const here = pointAt(seg, run.s)
  const remain = remainBeforeStop(run)
  let want = Math.min(here.v, Math.sqrt(2 * 1.0 * Math.max(remain, 0)) + 0.05)
  // 先の向き（0.8m 先）。大きくずれている間は遅く（曲がり角で膨らまないように）
  const ahead = pointAt(seg, Math.min(seg.length, run.s + 0.8))
  _tan.set(ahead.x - here.x, ahead.z - here.z)
  if (_tan.lengthSq() > 1e-6) {
    const err = turnToward(m, Math.atan2(_tan.x, _tan.y), dt * k, 3.2)
    want *= THREE.MathUtils.clamp(1.25 - Math.abs(err) * 0.9, 0.35, 1)
  }
  run.speed += THREE.MathUtils.clamp(want - run.speed, -1.6 * dt * k, 1.3 * dt * k)
  run.s += Math.max(0, run.speed) * dt * k
  // 早送りの分の時間（歩いた実の時間 × (倍率 − 1)）
  if (k > 1) addTime(ch, run, dt * (k - 1))
  while (seg && run.s >= seg.length - 0.005) {
    const over = run.s - seg.length
    if (run.seg + 1 >= run.segs.length) {
      run.s = seg.length
      break
    }
    const prev = seg
    advanceSeg(ch)
    if (rideSeg(run)) {
      // 乗り物の区間へ（ホームへの道は次のコマで作る）。歩いた区間の終わりに置く
      const end = prev.pts[prev.pts.length - 1]
      m.position.x = end.x
      m.position.z = end.z
      return true
    }
    seg = walkSeg(run)
    if (seg) run.s = Math.min(seg.length, Math.max(0, over))
  }
  if (!seg) return finish(ch)
  const p = pointAt(seg, run.s)
  m.position.x = p.x
  m.position.z = p.z
  m.speed = run.speed
  m.phase = 'walk'
  m.zone = zoneOfPoint(p.x, p.z)
  // 町の石段の上は、踏面ごとに 1 歩
  const surf = m.zone === 'lab' || m.zone === 'town' ? townWalk.surface(p.x, p.z, m.position.y) : null
  m.stride = surf?.stairs ? THREE.MathUtils.clamp(surf.stairs.tread, 0.28, 0.75) : null
  if (run.seg === run.segs.length - 1 && seg.length - run.s < 0.015) return finish(ch)
  return true
}

/* -------------------------------------------------------------------------- */
/* 乗り物の区間（丘ノ上ケーブル・緑電・運河バス）                                          */
/* -------------------------------------------------------------------------- */

/** 今の乗り物の区間（無ければ null） */
function rideSeg(run: TravelRun): RideSeg | null {
  const s = run.segs[run.seg]
  return s && s.kind === 'ride' ? s : null
}

/** 時間の扱い（省けば移動の time と同じ） */
const rideTimeOf = (t: RideTime | undefined, time: TravelTime): RideTime => t ?? (time === 'fast' ? 'fast' : time === 'cut' ? 'cut' : 'real')

/** 乗り物の区間の乗る仕組みの結果（終わっていなければ null）・片付け・途中か */
function rideResult(ch: Character, v: RideVehicle) {
  return v === 'cable' ? cableRideResult(ch) : v === 'tram' ? ch.rides.tram.result() : v === 'hover' ? hoverRide.result(ch) : ch.rides.boat.result()
}
function rideClear(ch: Character, v: RideVehicle) {
  if (v === 'cable') clearCableRide(ch)
  else if (v === 'tram') ch.rides.tram.clear()
  else if (v === 'hover') hoverRide.clear(ch)
  else ch.rides.boat.clear()
}
function rideActive(ch: Character, v: RideVehicle) {
  return v === 'cable' ? cableRiding(ch) : v === 'tram' ? ch.rides.tram.active() : v === 'hover' ? hoverRide.active(ch) : ch.rides.boat.active()
}
const RIDE_LABEL: Record<RideVehicle, string> = { cable: '丘ノ上ケーブル', tram: '緑電', waterbus: '運河バス', hover: 'ホバー' }

function rideStep(ch: Character, rs: RideSeg): boolean {
  const run = ch.travel
  const m = ch.motion
  const req = run.req!
  setLeg(run, rs.leg)
  if (rs.state === 'pending') return rideApproach(ch, rs)
  if (rs.state === 'approach') {
    // 待つ所に着いた: 乗る仕組みへ（次のコマから花音を動かす）
    m.speed = 0
    run.speed = 0
    run.rideWarp0 = townWarp.added()
    const spec = { pose: req.pose ?? 'sit', wait: rideTimeOf(req.waitTime, req.time), ride: rideTimeOf(req.rideTime, req.time), fastSec: null, fastSpeed: req.fastSpeed }
    const b = run.boarding!
    if (b.vehicle === 'cable') beginCableRide(ch, { from: rs.from as CableStationKey, to: rs.to as CableStationKey, ...spec }, b.cable)
    else if (b.vehicle === 'tram') beginTramRide(ch, spec, b.tram.plan, b.tram.run, b.tram.heading)
    else if (b.vehicle === 'hover') beginHoverRide(ch, { from: b.hover.from, to: b.hover.to, wait: spec.wait, ride: spec.ride, fastSec: spec.fastSec, fastSpeed: spec.fastSpeed }, b.hover)
    else beginBoatRide(ch, spec, b.boat.plan, b.boat.run, b.boat.heading)
    rs.state = 'riding'
    const res = rideResult(ch, rs.vehicle)
    if (res && !res.ok) {
      rideClear(ch, rs.vehicle)
      cancelTravel(ch, res.error ?? `${RIDE_LABEL[rs.vehicle]}に乗れませんでした`)
      return false
    }
    m.phase = 'idle'
    return true
  }
  if (rs.state === 'riding') {
    const res = rideResult(ch, rs.vehicle)
    if (!res) return rideActive(ch, rs.vehicle)
    // 待つ・乗っている間に飛ばした・早送りした時間（乗る仕組みが町の時刻に足した分）
    run.added += townWarp.added() - run.rideWarp0
    rideClear(ch, rs.vehicle)
    if (!res.ok) {
      cancelTravel(ch, res.error ?? `${RIDE_LABEL[rs.vehicle]}に乗れませんでした`)
      return false
    }
    rideExit(ch, rs)
    return true
  }
  advanceSeg(ch)
  return true
}

/**
 * 乗り場の待つ所までの道（今の所 → 駅の入口 → 駅の中の通り道 / 停留所のスロープ → ホーム / 船着き場の石段 → 下の段）。
 * 乗る便は歩く時間の見込みから決める（見込みより長ければ決め直す）
 */
function rideApproach(ch: Character, rs: RideSeg): boolean {
  const run = ch.travel
  const m = ch.motion
  const req = run.req!
  const here: [number, number] = [m.position.x, m.position.z]
  let lead = 35
  for (let tries = 0; tries < 2; tries++) {
    const a = approachPlan(rs, here, lead, partyEscorts(ch))
    if (typeof a === 'string') {
      cancelTravel(ch, a)
      return false
    }
    const pts = a.pts
    // 歩く時間の見込み（早送りなら倍率で割る。待つ間をそのまま見せるなら、待つ所の手前の 20m はそのままの速さ。scaleWanted）
    const ws: WalkSeg = { kind: 'walk', leg: rs.leg, pts, length: pts[pts.length - 1].s }
    const k = req.time === 'fast' ? run.scaleTo : 1
    const slow = rideTimeOf(req.waitTime, req.time) === 'real' ? Math.min(ws.length, EASE_BEFORE_STATION) : 0
    const sec = timeOf(ws, 0, ws.length - slow) / k + timeOf(ws, ws.length - slow, ws.length)
    // 見込みより歩くのが長い: その時間で乗れる便を決め直す
    if (sec + 6 > lead && tries === 0) {
      lead = sec + 10
      continue
    }
    run.boarding = a.boarding
    rs.state = 'approach'
    if (req.time === 'cut') {
      // 駅の中・ホーム・石段を歩く所は飛ばす（待つ所へ置く。町の時刻は歩く時間だけ進める）
      addTime(ch, run, sec)
      const p = waitGround(a.spot, m.position.y)
      m.position.set(a.spot[0], p, a.spot[1])
      m.ground = p
      m.heading = a.heading
      m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
      m.zone = zoneOfPoint(a.spot[0], a.spot[1])
      m.placeSerial++
      m.speed = 0
      run.speed = 0
      run.cutSerial++
      ch.events.emit('place', null)
      return true
    }
    run.segs.splice(run.seg, 0, { kind: 'walk', leg: rs.leg, pts, length: pts[pts.length - 1].s, station: 'in' })
    run.s = 0
    return true
  }
  return true
}

type Boarding =
  | { vehicle: 'cable'; cable: Exclude<ReturnType<typeof planCableBoarding>, string> }
  | { vehicle: 'tram'; tram: Exclude<ReturnType<typeof planTramBoarding>, string> }
  | { vehicle: 'waterbus'; boat: Exclude<ReturnType<typeof planBoatBoarding>, string> }
  | { vehicle: 'hover'; hover: Exclude<ReturnType<typeof planHoverBoarding>, string> }

/** 乗る便・待つ所と、そこまでの道（シーンの点）。escort = ホバーで並走する仲間の場所を空ける。だめなら理由 */
function approachPlan(rs: RideSeg, here: [number, number], lead: number, escort: boolean): { boarding: Boarding; pts: Pt[]; spot: [number, number]; heading: number } | string {
  if (rs.vehicle === 'cable') {
    const zone = STATION_ZONE[rs.from as CableStationKey]
    const model = interiors.models.get(zone)
    if (!model) return `${INTERIOR_ZONES[zone].label}の中の決まりがありません（町のデータを読み込み中）`
    const zp = portalZonePoint(ZONE_PORTALS[zone][0])
    const plan = planCableBoarding(rs.from as CableStationKey, rs.to as CableStationKey, lead)
    if (typeof plan === 'string') return plan
    const path = model.findPath(zp, model.levelAt(zp[0], zp[1], model.levelFloorY(0)), plan.spot, 0)
    if (!path) return `${INTERIOR_ZONES[zone].label}の入口からホームへの通り道が見つかりません`
    const pts = concat(scenePath([here, zp], TOWN_WALK_SPEED), scenePath(path, WALK_SPEED))
    return { boarding: { vehicle: 'cable', cable: plan }, pts, spot: plan.spot, heading: plan.heading }
  }
  if (rs.vehicle === 'tram') {
    const plan = planTramBoarding(Number(rs.line), rs.from, rs.to, lead)
    if (typeof plan === 'string') return plan
    const pts = scenePath(platformPath(plan.platform, here, plan.spot), TOWN_WALK_SPEED)
    return { boarding: { vehicle: 'tram', tram: plan }, pts, spot: plan.spot, heading: plan.heading }
  }
  if (rs.vehicle === 'hover') {
    // 乗り場の出入口から台の横（乗り降りする側）へ。台の手前 1.2m を通って、まっすぐ横から寄る
    const hp = planHoverBoarding(rs.from as HoverDockId, rs.to as HoverDockId, escort)
    if (typeof hp === 'string') return hp
    const d = HOVER_DOCKS[rs.from as HoverDockId]
    const pre: [number, number] = [hp.spot[0] - Math.sin(hp.heading) * 1.2, hp.spot[1] - Math.cos(hp.heading) * 1.2]
    const pts = scenePath([here, pre, hp.spot], TOWN_WALK_SPEED)
    void d
    return { boarding: { vehicle: 'hover', hover: hp }, pts, spot: hp.spot, heading: hp.heading }
  }
  const plan = planBoatBoarding(String(rs.line), rs.from, rs.to, lead)
  if (typeof plan === 'string') return plan
  const pts = scenePath(landingPath(plan.landing, here, plan.spot), TOWN_WALK_SPEED)
  return { boarding: { vehicle: 'waterbus', boat: plan }, pts, spot: plan.spot, heading: plan.heading }
}

/** 待つ所の床の高さ（駅のホームの段・停留所のホーム・船着き場の下の段） */
function waitGround(p: [number, number], refY: number) {
  const model = interiors.modelAt(p[0], p[1])
  return model?.groundAt(p[0], p[1], refY) ?? townWalk.groundY(p[0], p[1], refY)
}

/** 降りた所から乗り場の外へ（次の町の道の始めまで）。cut ならカットにする */
function rideExit(ch: Character, rs: RideSeg) {
  const run = ch.travel
  const m = ch.motion
  const req = run.req!
  const here: [number, number] = [m.position.x, m.position.z]
  const next = run.segs[run.seg + 1]
  const nextStart: [number, number] | null = next && next.kind === 'walk' ? [next.pts[0].x, next.pts[0].z] : null
  let pts: Pt[]
  if (rs.vehicle === 'cable') {
    const zone = STATION_ZONE[rs.to as CableStationKey]
    const model = interiors.models.get(zone)
    const portal = ZONE_PORTALS[zone][0]
    const zp = portalZonePoint(portal)
    const tp: [number, number] = [portal.town[0], -portal.town[1]]
    const path = model?.findPath(here, 0, zp, model.levelAt(zp[0], zp[1], model.levelFloorY(0))) ?? [here, zp]
    const tail: [number, number][] = [zp, tp]
    if (nextStart) tail.push(nextStart)
    pts = concat(scenePath(path, WALK_SPEED), scenePath(tail, TOWN_WALK_SPEED))
  } else if (rs.vehicle === 'tram') {
    const b = run.boarding
    const pf = b && b.vehicle === 'tram' ? tramExitPlatform(b.tram.plan) : null
    pts = pf ? scenePath(platformPath(pf, here, nextStart ?? rideExitPoint(rs) ?? here, true), TOWN_WALK_SPEED) : scenePath([here, nextStart ?? here], TOWN_WALK_SPEED)
  } else if (rs.vehicle === 'hover') {
    // 台の横から、乗り場の出入口（町の道）へ
    const d = HOVER_DOCKS[rs.to as HoverDockId]
    const acc: [number, number] = [d.access[0], -d.access[1]]
    const tail: [number, number][] = [here, acc]
    if (nextStart && Math.hypot(nextStart[0] - acc[0], nextStart[1] - acc[1]) > 0.05) tail.push(nextStart)
    else if (!nextStart && rs.exitAt && Math.hypot(rs.exitAt[0] - acc[0], rs.exitAt[1] - acc[1]) > 0.05) tail.push(rs.exitAt)
    pts = scenePath(tail, TOWN_WALK_SPEED)
  } else {
    const b = run.boarding
    const ld = b && b.vehicle === 'waterbus' ? boatExitLanding(b.boat.plan) : null
    pts = ld ? scenePath(landingPath(ld, here, nextStart ?? rideExitPoint(rs) ?? here, true), TOWN_WALK_SPEED) : scenePath([here, nextStart ?? here], TOWN_WALK_SPEED)
  }
  rs.state = 'done'
  const len = pts.length >= 2 ? pts[pts.length - 1].s : 0
  if (len > 0.05) {
    // カットでも、道のりの最後の短い出口（ホバーの台の横から駅舎の前までなど。12m まで）は歩いて見せる（道のりの最後の見せる所）。
    // 飛ばすときは、出る道の終わり（次の歩く所の始めか、道のりの最後なら降りた乗り場の外）へ置く（advanceSeg）
    const last = run.seg + 1 >= run.segs.length
    if (req.time === 'cut' && !(last && len <= Math.max(12, req.showSec * TOWN_WALK_SPEED))) run.segs.splice(run.seg + 1, 0, { kind: 'cut', leg: rs.leg, seconds: timeOf({ kind: 'walk', leg: rs.leg, pts, length: len }, 0, len), mode: 'skip', path: pts })
    else run.segs.splice(run.seg + 1, 0, { kind: 'walk', leg: rs.leg, pts, length: len, station: 'out' })
  }
  advanceSeg(ch)
  run.speed = m.speed
}

/** 乗り物の区間で道のりが終わるとき（町の行き先）、降りた乗り場の外の点（シーン）。plan が決める */
function rideExitPoint(rs: RideSeg): [number, number] | null {
  return rs.exitAt ?? null
}

/** 着いた: 立ち寄り先なら locomotion の「着いて向きを合わせる」へ渡す。町の行き先は向きを合わせて止まる */
function finish(ch: Character): boolean {
  const run = ch.travel
  const m = ch.motion
  const plan = run.plan!
  m.speed = 0
  m.stride = null
  m.timeScale = 1
  run.scale = 1
  run.scaleTo = 1
  if (plan.stop) {
    m.targetId = plan.stop
    m.stopId = null
    m.phase = 'turnEnd'
    run.phase = 'done'
    return false
  }
  run.phase = 'arrive'
  return true
}

function arriveStep(ch: Character, dt: number): boolean {
  const run = ch.travel
  const m = ch.motion
  const plan = run.plan!
  m.phase = 'turnEnd'
  m.speed = 0
  const err = turnToward(m, plan.heading ?? m.heading, dt)
  if (Math.abs(err) < 0.02 && Math.abs(m.turnRate) < 0.1) {
    m.phase = 'idle'
    m.turnRate = 0
    m.stopId = null
    m.targetId = null
    m.arrivedAt = run.t
    run.phase = 'done'
    ch.events.emit('arrive', null)
    return false
  }
  return true
}

/** ?debug: 道のりの歩く所の d m の所へ飛ぶ（確かめ用。カットと同じく、カメラ・KB-001 も一緒に移る） */
function seek(ch: Character, d: number) {
  const run = ch.travel
  let acc = 0
  for (let i = 0; i < run.segs.length; i++) {
    const s = run.segs[i]
    if (s.kind !== 'walk') continue
    if (acc + s.length >= d) {
      run.seg = i
      run.s = Math.max(0, d - acc)
      run.phase = 'walk'
      setLeg(run, s.leg)
      const p = pointAt(s, run.s)
      const q = pointAt(s, Math.min(s.length, run.s + 1.5))
      const m = ch.motion
      m.position.x = p.x
      m.position.z = p.z
      m.heading = Math.atan2(q.x - p.x, q.z - p.z)
      m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
      m.zone = zoneOfPoint(p.x, p.z)
      m.placeSerial++
      ch.events.emit('place', null)
      return { seg: i, s: run.s, x: p.x, z: p.z }
    }
    acc += s.length
  }
  return null
}

/** ?debug: コンソールから（window.__travel。付けるのは使う側。kanon-lab は src/kanon/index.ts） */
export function travelDebug(ch: Character) {
  return {
    ch,
    run: ch.travel,
    planTravel: (req: TravelRequest) => planTravel(ch, req),
    startTravel: (req: TravelRequest) => startTravel(ch, req),
    cancelTravel: (reason?: string) => cancelTravel(ch, reason),
    pointAt,
    seek: (d: number) => seek(ch, d),
    chooseTransit,
  }
}
