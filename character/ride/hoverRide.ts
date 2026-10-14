import * as THREE from 'three'
import type { SeatSpec } from '../avatar/body'
import { groundHeight } from '../avatar/locomotion'
import type { Character, CharacterMotion } from '../avatar/character'
import { zoneOfPoint } from '../../core/interiors'
import { ZONE_PORTALS, type TravelZone } from '../../core/travel'
import { EDGE_KIND } from '../../core/walk/walkData'
import { outdoor } from '../../world/environment/daylight'
import { transitClock } from '../../world/outdoor/transit/clock'
import { hoverCraft, hoverHome, hoverVehicle, parkedHeight, parkedMatrix } from '../../world/outdoor/transit/hoverCraft'
import type { Car } from '../../world/outdoor/transit/vehicle'
import { townData } from '../../world/outdoor/town/townData'
import { HOVER } from '../../world/outdoor/transit/hoverCar'
import { TRACK_HALF, tramNet, tramOccupies, type TramLine } from '../../world/outdoor/transit/trams'
import { pathPoint } from '../../world/outdoor/transit/transitData'
import { townEvents } from '../../world/townHost'
import { propsNear } from '../../world/walk/townProps'
import { townSolids } from '../../world/walk/townSolids'
import { townWalk } from '../../world/walk/townWalk'
import { waitViews, type PlatformView } from './platformViews'
import { setRiderCar } from './rider'
import { defineMemberSlots, updateParty } from './party'
import { makePath, pathAt, walkPath, type Path } from './walk'
import { advanceBy, cancelWarp, type RideTime } from './warp'

/**
 * 花音のホバーの一人乗り（kanon.travel の via=hover。docs/design/town.md §21。#9 でどこからでも呼べる形にした）。
 *
 * 人が乗るホバーは浮遊機器法（単独で動くロボット・機器の決まり）の対象外の乗り物として扱う（ユーザーの決定）。乗り場は無く、浮遊レーンも使わない。
 * 町の道のグラフ（walk.json）の上だけを、地面から FLY_HEIGHT（0.6m）の高さで、CRUISE（12 m/s）で飛ぶ（坂・石段・橋は地面に沿って上がり下がりする。
 * 地下の道は通らない。町の道の外（水の上・草地）はまだ飛ばない）。広い道は進む向きの左に寄り、建物・木・石段のわきの擁壁・街灯の柱・ほかの人・
 * 緑電の線路（編成の幅）から横へよける。緑電の線路を横切る所は、編成のいない時刻に通る（出る時刻を選ぶ）。浮遊レーンの配送機（地上 2.5m より上）とは高さが違う。
 *
 * 呼ぶ（summonHover）: 呼んだ人の近くの歩ける所（道・広場。ラボ・中のある建物の中なら、そのゾーンの外の出入口の前）を探し、ホバーが今いる所から
 * 飛んで来て、横に下りて待つ。今いる所から NEAR（100m）より遠い（まだ一度も呼んでいない）ときは、すぐその所に現れる。
 * 乗っていない間は最後に下りた所に置いておく（hoverHome。次に呼ぶとそこから来る）。
 *
 * 乗る（旅程の via=hover。character/avatar/travel.ts）:
 *   0. 待つ（await）: 呼んだホバーが来るまで横の所で待つ（待つ間の時間の扱い wait）
 *   1. 乗る（board）: 置いたホバーの横（呼んだ人の側）から床板へ上がり、前を向いて鞍に腰掛け、ハンドルを握る
 *   2. 回す（power）: ファンを回す（2 秒）。緑電の線路を横切るなら、編成のいない時刻まで待つ（待つ間の時間の扱い wait）
 *   3. 飛ぶ（fly）: 少し真上へ浮いてから、町の道の上を飛ぶ（乗っている間の時間の扱い ride）。行き先の近くの歩ける所で、真上から下りて止まる
 *   4. 降りる（land → stand → out）: ファンを止め、立って、行き先の側へ床板から下りる。ホバーはそこに置いたまま
 * 一緒に乗る仲間（KB-001。character/ride/party.ts）は乗らずに、ホバーの左の少し前を、花音の肩より上の高さで並んで飛ぶ。
 * 経路は、乗る人の仲間に浮かぶ仲間がいれば、並走する所も町の木・建物にかからないように選ぶ（escort）。
 * ホバーの位置は交通の時計（運転の日の秒）から決まる（早送り・カットでも同じ時計で動く）。
 * 機体（置いてある所・行列・ファンの回り・灯り）は地図の側（world/outdoor/transit/hoverCraft.ts）で、ここが 1 コマ 1 回書く（ホバーは 1 台。
 * 乗っている人がいればその人の更新が書き、いなければ updateRiders（riders.ts）が乗る人の更新の前に updateHoverCraft で書く）。
 * 回し始めた・下りたは地図の出来事（townEvents の hover.spinUp・hover.land）で知らせる（音の合図は使う側が鳴らす）。
 */

const H = HOVER
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _d = new THREE.Vector3()
const _pt = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3(1, 1, 1)
const _m = new THREE.Matrix4()
const _pp = pathPoint()

/** 飛ぶ高さ（ホバーの足の下から地面まで。m）と速さ（m/s） */
export const FLY_HEIGHT = 0.6
export const CRUISE = 12
/** 呼んだときに飛んで来るのを見せる離れ（m。これより遠ければ、すぐ横に現れる） */
export const SUMMON_NEAR = 100
/** 速くする・遅くする（m/s²）・曲がるときの横の加速（m/s²）・真上へ浮く・真下へ下りるときの速さ（m/s） */
const ACCEL = 2.6
const A_LAT = 3.2
const V_LIFT = 0.55
/** 真上へ浮く・下りる高さ（m。そこから先は進みながら飛ぶ高さへ）と、進みながら高さを変える長さ（m） */
const LIFT_UP = 0.4
const LIFT_RUN = 2.5
/** 呼ばれて飛ぶ前にファンを回す秒（人が乗っていない）・乗ってから回す秒・止まってからファンを止めるまで（秒） */
const SUMMON_SPIN = 1.2
const SPIN_UP = 2.0
const SPIN_DOWN = 1.6
/** 床板の上の立つ所（局所の z）と、乗り降りする横の地面の所（|x|） */
const STAND_Z = 0.12
const SIDE_X = 0.78
/** 腰掛け: 鞍（床板から 0.42m 上）・床板の立つ所から鞍の真ん中まで後ろへ・ハンドルの握り（床板から） */
const SEAT: SeatSpec = { height: H.seatY - H.deckY, shift: H.seatZ - STAND_Z, hands: 'grip', desk: H.gripY - H.deckY, reach: H.gripZ - H.seatZ }
/** 並走する仲間（KB-001）の並ぶ所（局所。左の少し前・花音の肩より上） */
const ESCORT_LOCAL = new THREE.Vector3(0.85, H.deckY + 1.55, 0.45)
/** 並ぶ所が町の木の幹・建物にかかるときに逃げる所（花音の頭の後ろの上） */
const ESCORT_TUCK = new THREE.Vector3(0, H.deckY + 2.05, -0.6)
/** 道の縁から空ける幅（m。ホバーの幅の半分 0.33m と、乗る人の膝・余白） */
const EDGE_MARGIN = 0.6
/** 緑電の線路の真ん中の線（複線の間）から離れる横の幅（m）: 編成の幅（線路から ±1.2m）+ ホバーの幅の半分と乗る人 + 余白 */
const TRAM_CLEAR = TRACK_HALF + 1.2 + 0.95
/** ほかの人から離れる（m） */
const PEOPLE_CLEAR = 1.0

/* -------------------------------------------------------------------------- */
/* 置く所・飛ぶ道                                                                 */
/* -------------------------------------------------------------------------- */

/** 置く所（シーンの x, z と足の高さ y・向き・乗り降りする側（局所の x の向き）） */
export interface HoverPark {
  x: number
  y: number
  z: number
  heading: number
  side: 1 | -1
}

interface FlightSample {
  /** シーンの位置（ホバーの原点）・進む向き（水平の heading）・道のりの長さ（3 次元）・出てからの秒・速さ・足元の地面の高さ */
  p: THREE.Vector3
  heading: number
  s: number
  t: number
  v: number
  g: number
}

export interface HoverFlight {
  from: HoverPark
  to: HoverPark
  pts: FlightSample[]
  /** 道のりの長さ（m）と、出てから下りて止まるまでの秒 */
  length: number
  total: number
  /** 確かめ用: 道の上で、建物・木・擁壁・街灯にかかる所・地面からの高さの小さい / 大きい所・道の外の所・緑電の線路の上の所の数（水平に飛ぶ所だけ） */
  clearance: { blocked: number; minAbove: number; maxAbove: number; offWay: number; tram: number; people: number }
  /** 並走する仲間の場所を空けた道か */
  escort: boolean
  /** 町の木・建物をよけて決めた道か（町のタイルを読んでいる間は、よけない道で時間だけ見積もる） */
  avoided: boolean
  /** 緑電の線路を横切る所（出てからの秒 t・系統・線の上の長さ d・線からの横のずらし lat） */
  tramCross: { t: number; line: TramLine; d: number; lat: number }[]
}

/** 町のタイル（建物・木）を読み終えるのを待つ間か（目録が無い・全部読んだなら待たない） */
const tilesPending = () => townData.manifest !== null && !townData.allTilesLoaded()

const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * 点（シーン）が町の当たりの形にかかるか。人の歩く道・広場の上では、建物の外形の箱（駅の大庇・門・通り抜けの下など、歩く人が下を通る物も
 * 地面から屋根までの箱になっている）は見ず、木（葉と幹）と石段のわきの擁壁だけを見る
 */
function solidAt(x: number, y: number, z: number, onWay = townWalk.onWalkway(x, z, 0)) {
  return townSolids.blocker(x, y, z, 0, onWay)
}

/**
 * ホバー（と花音の体・左に並ぶ仲間）の場所が、町の建物・木（葉と幹）・石段のわきの擁壁にかかるか。y = ホバーの原点、(nx, nz) = 進む向きの左
 * （並走する仲間の場所も見るとき。0, 0 ならホバーと花音だけ）。床板と脚（原点から 0.15・0.5m）・腰掛けた花音の体（1.05m）・頭（1.62m）の高さで、
 * 真ん中とまわり（床板は 0.45m・体は 0.35m・頭は 0.25m 離れた 4 点）を見る（葉の外側の余白は足さない。カメラの確かめの余白は広すぎるため）
 */
const BODY_PROBES: readonly [number, number][] = [
  [0.15, 0.45],
  [0.5, 0.45],
  [1.05, 0.35],
  [1.62, 0.25],
]
const AROUND: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
function hoverBlocked(x: number, y: number, z: number, nx = 0, nz = 0) {
  // 歩く道の上か（真ん中とまわりの 4 向き。まわりは 0.25〜0.45m なので、0.45m の所で見る）
  const way = AROUND.map(([dx, dz]) => townWalk.onWalkway(x + dx * 0.45, z + dz * 0.45, 0))
  for (const [h, r] of BODY_PROBES) for (let k = 0; k < 5; k++) if (solidAt(x + AROUND[k][0] * r, y + h, z + AROUND[k][1] * r, way[k])) return true
  return !!((nx || nz) && solidAt(x + nx * ESCORT_LOCAL.x, y + ESCORT_LOCAL.y, z + nz * ESCORT_LOCAL.x))
}

/** 街灯の柱・木の幹にかかるか（シーンの x, z。ホバーの幅の半分 + 余白） */
function propBlocked(x: number, z: number, clear = 0.55) {
  for (const p of propsNear(x, -z, clear + 0.4)) if (Math.hypot(p.x - x, p.y + z) < p.r + clear) return true
  return false
}

/** よける人（updateRiders が渡す乗る人の一覧。飛ぶ道・置く所を決めるときの位置）と、よけない人（乗る人・呼んだ人と、その仲間） */
let people: readonly Character[] = []
function peopleNear(x: number, z: number, skip: Character | null, clear = PEOPLE_CLEAR) {
  for (const c of people) {
    if (c === skip || (skip && c.ride.member.leader === skip)) continue
    const p = c.motion.position
    if (Math.abs(p.x - x) < clear && Math.abs(p.z - z) < clear && Math.hypot(p.x - x, p.z - z) < clear) return true
  }
  return false
}

/**
 * 緑電の線路の真ん中の線（複線の間）の索引（平面。8m の升目）と、点（シーン）から clear m の内に線があるか
 */
let tramGrid: Map<number, number[]> | null = null
let tramLinesRef: unknown = null
let tramSegs: number[] = []
function nearTram(x: number, z: number, clear = TRAM_CLEAR) {
  const lines = tramNet.lines
  if (!lines?.length) return false
  if (!tramGrid || tramLinesRef !== lines) {
    tramGrid = new Map()
    tramLinesRef = lines
    tramSegs = []
    const C = TRAM_CLEAR + 1
    for (const l of lines) {
      const P = l.path
      for (let i = 1; i < P.x.length; i += 1) {
        const id = tramSegs.length / 4
        tramSegs.push(P.x[i - 1], P.y[i - 1], P.x[i], P.y[i])
        for (let gx = Math.floor((Math.min(P.x[i - 1], P.x[i]) - C) / 8); gx <= Math.floor((Math.max(P.x[i - 1], P.x[i]) + C) / 8); gx++)
          for (let gy = Math.floor((Math.min(P.y[i - 1], P.y[i]) - C) / 8); gy <= Math.floor((Math.max(P.y[i - 1], P.y[i]) + C) / 8); gy++) {
            const k = gx * 100003 + gy
            let list = tramGrid.get(k)
            if (!list) tramGrid.set(k, (list = []))
            list.push(id)
          }
      }
    }
  }
  const px = x
  const py = -z
  const list = tramGrid.get(Math.floor(px / 8) * 100003 + Math.floor(py / 8))
  if (!list) return false
  for (const i of list) {
    const ax = tramSegs[i * 4]
    const ay = tramSegs[i * 4 + 1]
    const dx = tramSegs[i * 4 + 2] - ax
    const dy = tramSegs[i * 4 + 3] - ay
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-9)))
    if (Math.hypot(px - ax - dx * t, py - ay - dy * t) < clear) return true
  }
  return false
}

/** 町の歩ける所（道・石段・橋・広場の幅の中。ホームなどの歩ける面も）か */
function onTownGround(x: number, z: number, margin = 0) {
  return townWalk.onWalkway(x, z, margin) || townWalk.extraAt(x, -z) !== null
}

/** 置いたホバー（向き heading）が、まわりの物・人・緑電にかからないか。skip = よけない人 */
function parkClear(x: number, y: number, z: number, heading: number, skip: Character | null) {
  if (!townWalk.onWalkway(x, z, EDGE_MARGIN)) return false
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  for (const k of [-0.7, 0, 0.7]) {
    const px = x + fx * k
    const pz = z + fz * k
    if (!townWalk.onWalkway(px, pz, 0.35)) return false
    if (hoverBlocked(px, y, pz)) return false
    if (propBlocked(px, pz, 0.6)) return false
  }
  if (nearTram(x, z)) return false
  if (peopleNear(x, z, skip, 1.25)) return false
  return true
}

/** 道の向き（シーンの heading）。点の近くの道（町の道のグラフの辺）に沿う向き。道が無ければ null */
function roadHeading(x: number, z: number): number | null {
  const nav = townWalk.nav
  if (!nav) return null
  const hit = nav.snap(x, -z, 12)
  if (!hit) return null
  const a = nav.pointOnEdge(hit.edge, hit.along - 1)
  const b = nav.pointOnEdge(hit.edge, hit.along + 1)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (Math.hypot(dx, dy) < 1e-3) return null
  // 平面 (dx, dy) → シーン (dx, −dy)
  return Math.atan2(dx, -dy)
}

/** 置いたホバーの、点 (px, pz) のある側（局所の x の向き。+1 = 前を向いて左） */
function sideOf(park: { x: number; z: number; heading: number }, px: number, pz: number): 1 | -1 {
  // 局所の +x（左）はシーンの (cos h, −sin h)
  const lx = (px - park.x) * Math.cos(park.heading) - (pz - park.z) * Math.sin(park.heading)
  return lx >= 0 ? 1 : -1
}

/** 置いたホバーの横の、乗り降りする所（シーンの x, z） */
function sideSpot(park: HoverPark, side: 1 | -1, out: THREE.Vector3) {
  _q.setFromAxisAngle(_d.set(0, 1, 0), park.heading)
  _m.compose(_v.set(park.x, park.y, park.z), _q, _s)
  return out.set(side * SIDE_X, 0, STAND_Z).applyMatrix4(_m)
}

/** a → b（シーンの x, z）のまっすぐの線が、町の歩ける所の上か（0.25m ごと） */
function walkableLine(ax: number, az: number, bx: number, bz: number) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25))
  for (let k = 0; k <= n; k++) if (!onTownGround(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return false
  return true
}

const RINGS = [1.6, 2.1, 2.7, 3.4, 4.3, 5.4, 6.8, 8.5, 10.5, 13, 16]

/**
 * 点（シーンの x, z と足元の高さ refY）の近くの、ホバーを置ける所（道・広場の上で、建物・木・街灯・緑電・人にかからない）。向きは道に沿い、
 * 乗り降りする側は点の側。点から横の乗り降りする所へまっすぐ歩ける所を選ぶ（無ければ近い所）。無ければ null。
 * skip = よけない人（呼んだ人）
 */
export function hoverSpotNear(x: number, z: number, refY: number, skip: Character | null = null): HoverPark | null {
  if (!townWalk.ready) return null
  let best: HoverPark | null = null
  let bestCost = Infinity
  for (const r of RINGS) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      const cx = x + Math.cos(a) * r
      const cz = z + Math.sin(a) * r
      if (!townWalk.onWalkway(cx, cz, EDGE_MARGIN)) continue
      const gy = townWalk.groundY(cx, cz, refY, false)
      if (Math.abs(gy - refY) > 0.8) continue
      const h0 = roadHeading(cx, cz) ?? Math.atan2(cx - x, cz - z) + Math.PI / 2
      for (const heading of [h0, wrapAngle(h0 + Math.PI)]) {
        const y = parkedHeight(cx, cz, heading, gy)
        if (!parkClear(cx, y, cz, heading, skip)) continue
        const side = sideOf({ x: cx, z: cz, heading }, x, z)
        const park: HoverPark = { x: cx, y, z: cz, heading, side }
        const sp = sideSpot(park, side, _w)
        const line = walkableLine(x, z, sp.x, sp.z)
        // 近いほど・まっすぐ歩けるほど・前を向いて左から乗る（同じなら）ほどよい
        const cost = r + (line ? 0 : 6) + (side > 0 ? 0 : 0.05)
        if (cost < bestCost) {
          bestCost = cost
          best = park
        }
      }
    }
    if (best && bestCost < r + 1) break
  }
  return best
}

/** 角を丸める（半径は道の幅の 0.8 倍・1〜r m。隣の線分の 45% より長くしない。角の内側へ道の外まで寄らないように）。点は [x, y, 辺] */
function roundCorners(pts: [number, number, number][], r: number): [number, number, number][] {
  const widthOf = (e: number) => (e >= 0 ? townWalk.edgeWidth(e) : 2)
  if (pts.length < 3) return pts
  const out: [number, number, number][] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const la = Math.hypot(b[0] - a[0], b[1] - a[1])
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1])
    const ang = Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])))
    if (ang < 0.08 || la < 1e-6 || lc < 1e-6) {
      out.push(b)
      continue
    }
    const rr = Math.min(r, Math.max(1, 0.8 * Math.min(widthOf(a[2]), widthOf(b[2]))), la * 0.45, lc * 0.45)
    const p0 = [b[0] + ((a[0] - b[0]) * rr) / la, b[1] + ((a[1] - b[1]) * rr) / la]
    const p1 = [b[0] + ((c[0] - b[0]) * rr) / lc, b[1] + ((c[1] - b[1]) * rr) / lc]
    const n = Math.max(2, Math.ceil(ang / 0.2))
    for (let k = 0; k <= n; k++) {
      const u = k / n
      out.push([(1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * b[0] + u * u * p1[0], (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * b[1] + u * u * p1[1], u < 0.5 ? a[2] : b[2]])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** 1m ごとの点に（点の辺は区間の始めの点のもの） */
function resample(pts: [number, number, number][], step: number): [number, number, number][] {
  const out: [number, number, number][] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l < 1e-6) continue
    const n = Math.max(1, Math.ceil(l / step))
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, k === n ? b[2] : a[2]])
  }
  return out
}

/**
 * ホバーの道を選ぶときの、辺ごとの時間の倍率（町の道のグラフの経路探索 townNav の edgeFactor）: 広場を横切る辺（広場の縁の点の間のまっすぐの線。
 * 木・建物にかかることがある）は 4 倍（線が広場の外へ出るなら 40 倍）、緑電の線路の上しか通れない所（道の幅の中に、編成から離れる所が無い）の割合だけ最大 4 倍
 */
const edgeFactors = new Map<number, number>()
let edgeFactorsOf: unknown = null
function hoverEdgeFactor(edge: number) {
  const nav = townWalk.nav
  if (!nav) return 1
  if (edgeFactorsOf !== nav || tramLinesRef !== tramNet.lines) {
    edgeFactors.clear()
    edgeFactorsOf = nav
    nearTram(0, 0)
  }
  let f = edgeFactors.get(edge)
  if (f !== undefined) return f
  const e = nav.data.edges[edge]
  if (e.k === EDGE_KIND.plaza) {
    // 広場を横切るまっすぐの線が広場の外へ出る（形のへこんだ広場）なら、ほかに道が無いときだけ
    const L = nav.edgeLength(edge)
    let out = false
    for (let d = 0; d <= L && !out; d += 1) {
      const a = nav.pointOnEdge(edge, d)
      if (!onTownGround(a[0], -a[1])) out = true
    }
    f = out ? 40 : 4
  } else {
    const L = nav.edgeLength(edge)
    const half = Math.max(0, townWalk.edgeWidth(edge) / 2 - EDGE_MARGIN)
    const n = Math.max(1, Math.ceil(L / 5))
    let bad = 0
    for (let k = 0; k <= n; k++) {
      const a = nav.pointOnEdge(edge, (L * k) / n)
      const b = nav.pointOnEdge(edge, Math.min(L, (L * k) / n + 0.5))
      const c = nav.pointOnEdge(edge, Math.max(0, (L * k) / n - 0.5))
      const dx = b[0] - c[0]
      const dy = b[1] - c[1]
      const l = Math.hypot(dx, dy) || 1
      let free = false
      for (let o = -half; o <= half + 1e-6 && !free; o += 0.5) if (!nearTram(a[0] - (dy / l) * o, -(a[1] + (dx / l) * o))) free = true
      if (!free) bad++
    }
    f = 1 + (3 * bad) / (n + 1)
  }
  edgeFactors.set(edge, f)
  return f
}

/** 辺の道で、進む向きの左へ寄る量（m。広い道は車線の真ん中くらい、狭い道・石段・橋・広場・路地は真ん中）と、寄ってよい幅の半分 */
function laneOf(edge: number): { pref: number; half: number } {
  const nav = townWalk.nav
  if (!nav || edge < 0) return { pref: 0, half: 0 }
  const e = nav.data.edges[edge]
  const w = townWalk.edgeWidth(edge)
  const half = Math.max(0, w / 2 - EDGE_MARGIN)
  if (e.k !== EDGE_KIND.road || e.f < 0) return { pref: 0, half }
  const f = nav.data.feats[e.f]
  if (f.private || w < 5) return { pref: 0, half }
  return { pref: Math.min(w / 4, half), half }
}

/**
 * ホバーが飛ぶ道（from の置いた所から to の置く所まで。町の道のグラフの上）。avoid = 町の木・建物・街灯・人・緑電をよける（町のタイルを全部読んでから）、
 * escort = 左に並走する仲間の場所も空ける、skip = よけない人（乗る人・呼んだ人）。だめなら理由。
 * よけても建物・木にかかる所が残ったら、その所の辺を避けて（時間を 8 倍にして）2 回まで選び直し、かかる所の少ない道にする
 */
export function planHoverFlight(from: HoverPark, to: HoverPark, opts: { avoid?: boolean; escort?: boolean; skip?: Character | null } = {}): HoverFlight | string {
  const avoid = opts.avoid ?? !tilesPending()
  let best = planOnce(from, to, avoid, !!opts.escort, opts.skip ?? null, null)
  if (typeof best === 'string' || !avoid) return best
  const penalty = new Set<number>()
  for (let k = 0; k < 2 && best.clearance.blocked > 0; k++) {
    for (const e of best.blockedEdges) penalty.add(e)
    const f = planOnce(from, to, avoid, !!opts.escort, opts.skip ?? null, penalty)
    if (typeof f === 'string') break
    if (f.clearance.blocked < best.clearance.blocked) best = f
  }
  return best
}

function planOnce(from: HoverPark, to: HoverPark, avoid: boolean, escort: boolean, skip: Character | null, penalty: Set<number> | null): (HoverFlight & { blockedEdges: Set<number> }) | string {
  if (!townWalk.ready || !townWalk.nav) return '町の道のデータがまだありません（町のデータを読み込み中）'
  const nav = townWalk.nav
  const route = townWalk.route([from.x, -from.z], [to.x, -to.z], { cable: false, underground: false, speed: 60 * CRUISE, maxSnap: 40, privatePenalty: 1.25, edgeFactor: penalty ? (e) => hoverEdgeFactor(e) * (penalty.has(e) ? 8 : 1) : hoverEdgeFactor })
  if (!route) return 'ホバーで行ける町の道が見つかりません'
  // 1. 道の真ん中の線（平面座標。つなぎは置く所から道の上の点へまっすぐ）を丸めて 1m ごとに
  const line: [number, number, number][] = [[from.x, -from.z, -1]]
  for (const p of nav.polyline(route)) {
    const l = line[line.length - 1]
    if (Math.hypot(p.x - l[0], p.y - l[1]) < 0.05) {
      l[2] = p.edge
      continue
    }
    line.push([p.x, p.y, p.edge])
  }
  const lastP = line[line.length - 1]
  if (Math.hypot(lastP[0] - to.x, lastP[1] + to.z) > 0.05) {
    lastP[2] = -1
    line.push([to.x, -to.z, -1])
  } else line[line.length - 1] = [to.x, -to.z, -1]
  const dense = resample(roundCorners(line, 4), 1)
  const n = dense.length
  if (n < 2) return 'ホバーで行くには近すぎます'
  // 2. 横へ寄る量: 進む向きの左（広い道）。始めと終わりの 8m は置く所へ寄せる
  const nx = new Float64Array(n)
  const ny = new Float64Array(n)
  const half = new Float64Array(n)
  const pref = new Float64Array(n)
  let along = 0
  const sAt = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (i > 0) along += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1])
    sAt[i] = along
    const a = dense[Math.max(0, i - 1)]
    const b = dense[Math.min(n - 1, i + 1)]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    nx[i] = -(b[1] - a[1]) / l
    ny[i] = (b[0] - a[0]) / l
  }
  const total = along
  for (let i = 0; i < n; i++) {
    const ln = laneOf(dense[i][2])
    const taper = Math.min(1, sAt[i] / 8, (total - sAt[i]) / 8)
    half[i] = ln.half * Math.max(0, taper)
    pref[i] = ln.pref * Math.max(0, taper)
  }
  // 寄る量をならす（道の幅の替わる所で、とびとびに寄らないように。前後 6m）
  const want = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let a = 0
    let w = 0
    for (let k = -6; k <= 6; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k))
      const wk = 7 - Math.abs(k)
      a += pref[j] * wk
      w += wk
    }
    want[i] = Math.max(-half[i], Math.min(half[i], a / w))
  }
  // 3. 地面の高さ（橋の上と下は、前の点の高さに近い面）
  const ground = (x: number, y: number, ref: number) => townWalk.groundY(x, -y, ref, false)
  const gC = new Float64Array(n)
  let ref = from.y
  for (let i = 0; i < n; i++) {
    gC[i] = ground(dense[i][0], dense[i][1], ref)
    ref = gC[i]
  }
  // 4. よける: 寄る量の所がかかれば、道の幅の中で近い所へずらす（左右 0.25m ずつ）
  const bad = (i: number, o: number) => {
    const x = dense[i][0] + nx[i] * o
    const y = dense[i][1] + ny[i] * o
    const z = -y
    const g = ground(x, y, gC[i])
    if (Math.abs(g - gC[i]) > 0.6) return 3
    if (hoverBlocked(x, g + FLY_HEIGHT, z, escort ? nx[i] : 0, escort ? -ny[i] : 0) || propBlocked(x, z)) return 3
    if (!onTownGround(x, z, 0.3)) return 2
    if (peopleNear(x, z, skip)) return 2
    if (nearTram(x, z)) return 1
    return 0
  }
  const off = Float64Array.from(want)
  const res = new Uint8Array(n)
  if (avoid) {
    for (let i = 0; i < n; i++) {
      res[i] = bad(i, want[i])
      if (!res[i]) continue
      // かからない所（無ければ、かかり方の軽い所。建物・木 > 道の外・人 > 緑電の線路）のうち、寄る量に近い所
      let level = res[i]
      for (let k = 1; k * 0.25 <= half[i] * 2 + 1e-6 && level > 0; k++) {
        for (const sg of [1, -1]) {
          const o = want[i] + sg * k * 0.25
          if (Math.abs(o) > half[i] + 1e-6) continue
          const b = bad(i, o)
          if (b < level) {
            off[i] = o
            level = b
            if (!b) break
          }
        }
      }
      res[i] = level
    }
    // ずらした所を前後に広げて（大きい方を残す）ならす。ならした所がかかるなら、そこはずらした所のまま
    const shift = new Float64Array(n)
    for (let i = 0; i < n; i++) shift[i] = off[i] - want[i]
    const wide = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let b = 0
      for (let k = -3; k <= 3; k++) {
        const v = shift[Math.min(n - 1, Math.max(0, i + k))]
        if (Math.abs(v) > Math.abs(b)) b = v
      }
      wide[i] = b
    }
    for (let i = 0; i < n; i++) {
      let a = 0
      let w = 0
      for (let k = -4; k <= 4; k++) {
        const wk = 5 - Math.abs(k)
        a += wide[Math.min(n - 1, Math.max(0, i + k))] * wk
        w += wk
      }
      const o = Math.max(-half[i], Math.min(half[i], want[i] + a / w))
      if (Math.abs(o - off[i]) > 1e-6 && bad(i, o) <= res[i]) off[i] = o
    }
  }
  // 5. 点（シーン）と高さ: 地面 + FLY_HEIGHT を前後 3m でならす（地面から 0.45〜0.95m に収める）。始めと終わりは真上へ浮く・下りる
  const P: { x: number; z: number; g: number }[] = []
  ref = from.y
  for (let i = 0; i < n; i++) {
    const x = dense[i][0] + nx[i] * off[i]
    const y = dense[i][1] + ny[i] * off[i]
    const g = ground(x, y, ref)
    ref = g
    P.push({ x, z: -y, g })
  }
  P[0].g = from.y
  P[n - 1].g = to.y
  const hy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let a = 0
    let w = 0
    for (let k = -3; k <= 3; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k))
      const wk = 4 - Math.abs(k)
      a += P[j].g * wk
      w += wk
    }
    hy[i] = Math.min(P[i].g + 0.95, Math.max(P[i].g + 0.45, a / w + FLY_HEIGHT))
  }
  // 進みながら浮く・下りる（始めと終わりの LIFT_RUN m は、真上へ浮いた LIFT_UP から飛ぶ高さへ）
  for (let i = 0; i < n; i++) {
    const e = Math.min(sAt[i], total - sAt[i])
    if (e >= LIFT_RUN) continue
    const k = THREE.MathUtils.smoothstep(e, 0, LIFT_RUN)
    hy[i] = P[i].g + LIFT_UP + (hy[i] - P[i].g - LIFT_UP) * k
  }
  const pts: FlightSample[] = []
  const edgeOf: number[] = []
  const push = (x: number, y: number, z: number, g: number, e: number) => {
    const last = pts[pts.length - 1]
    const s = last ? last.s + Math.hypot(x - last.p.x, y - last.p.y, z - last.p.z) : 0
    if (last && s - last.s < 1e-4) return
    pts.push({ p: new THREE.Vector3(x, y, z), heading: 0, s, t: 0, v: 0, g })
    edgeOf.push(e)
  }
  push(from.x, from.y, from.z, from.y, -1)
  for (let i = 0; i < n; i++) push(P[i].x, i === 0 ? from.y + LIFT_UP : i === n - 1 ? to.y + LIFT_UP : hy[i], P[i].z, P[i].g, dense[i][2])
  push(to.x, to.y, to.z, to.y, -1)
  const m = pts.length
  // 6. 向き（水平に動く向き。真上へ浮く間に、置いた向きから回す。下りる所は着く向き）
  for (let i = 0; i < m; i++) {
    const a = pts[Math.max(0, i - 1)].p
    const b = pts[Math.min(m - 1, i + 1)].p
    const hz = Math.hypot(b.x - a.x, b.z - a.z)
    pts[i].heading = hz > 0.05 ? Math.atan2(b.x - a.x, b.z - a.z) : i > 0 ? pts[i - 1].heading : from.heading
  }
  const liftLen = pts[1].s
  const descLen = pts[m - 1].s - pts[m - 2].s
  const len = pts[m - 1].s
  // 着く向き: 置く所の向き（道に沿う）のうち、来る向きに近い方
  const arrive = pts[m - 2].heading
  let toHeading = to.heading
  if (Math.abs(wrapAngle(toHeading - arrive)) > Math.PI / 2) toHeading = wrapAngle(toHeading + Math.PI)
  for (let i = 0; i < m; i++) {
    const k0 = THREE.MathUtils.smoothstep(pts[i].s, liftLen * 0.1, liftLen + 2.5)
    const k1 = THREE.MathUtils.smoothstep(len - pts[i].s, descLen * 0.1, descLen + 2.5)
    pts[i].heading = lerpAngle(toHeading, lerpAngle(from.heading, pts[i].heading, k0), k1)
  }
  // 7. 速さ（曲がり・真上の上り下りで遅く。速くする・遅くするは ACCEL）と、出てからの秒
  const vmax = new Float64Array(m)
  for (let i = 1; i < m - 1; i++) {
    // 真上へ浮いた所・真上から下りる所（その前後の区間は遅く）
    if (i === 1 || i === m - 2) {
      vmax[i] = V_LIFT
      continue
    }
    const a = pts[Math.max(1, i - 2)]
    const b = pts[Math.min(m - 2, i + 2)]
    const ds = Math.max(0.5, b.s - a.s)
    const kap = Math.abs(wrapAngle(b.heading - a.heading)) / ds
    vmax[i] = Math.min(CRUISE, Math.sqrt(A_LAT / Math.max(kap, 1e-4)))
  }
  const v = Float64Array.from(vmax)
  v[0] = 0
  for (let i = 1; i < m; i++) v[i] = Math.min(vmax[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * ACCEL * (pts[i].s - pts[i - 1].s)))
  v[m - 1] = 0
  for (let i = m - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * ACCEL * (pts[i + 1].s - pts[i].s)))
  // 真上へ浮く・下りる区間は、遅い一定の速さで（止まった所から浮き始める・着いて止まる）
  let t = 0
  for (let i = 0; i < m; i++) {
    pts[i].v = v[i]
    if (i > 0) {
      const ds = pts[i].s - pts[i - 1].s
      const avg = (v[i] + v[i - 1]) / 2
      t += ds / Math.max(avg, i === 1 || i === m - 1 ? V_LIFT * 0.5 : 0.25)
    }
    pts[i].t = t
  }
  // 8. 確かめ（水平に飛ぶ所）と、緑電の線路を横切る所
  const clearance = { blocked: 0, minAbove: Infinity, maxAbove: -Infinity, offWay: 0, tram: 0, people: 0 }
  const blockedEdges = new Set<number>()
  const tramCross: HoverFlight['tramCross'] = []
  for (let i = 2; i < m - 2; i++) {
    const p = pts[i].p
    const above = p.y - pts[i].g
    // 地面からの高さは、進みながら浮く・下りる所（始めと終わりの LIFT_RUN m）のほか
    if (pts[i].s > liftLen + LIFT_RUN + 0.5 && pts[i].s < len - descLen - LIFT_RUN - 0.5) {
      clearance.minAbove = Math.min(clearance.minAbove, above)
      clearance.maxAbove = Math.max(clearance.maxAbove, above)
    }
    if (hoverBlocked(p.x, p.y, p.z) || propBlocked(p.x, p.z, 0.45)) {
      clearance.blocked++
      if (edgeOf[i] >= 0) blockedEdges.add(edgeOf[i])
    }
    if (!onTownGround(p.x, p.z)) clearance.offWay++
    if (peopleNear(p.x, p.z, skip, 0.6)) clearance.people++
    if (nearTram(p.x, p.z)) {
      clearance.tram++
      for (const line of tramNet.lines ?? []) {
        const pr = line.path.project(p.x, -p.z)
        if (pr.dist > TRAM_CLEAR + 1) continue
        line.path.at(pr.d, _pp)
        const lat = (p.x - _pp.x) * -_pp.dy + (-p.z - _pp.y) * _pp.dx
        tramCross.push({ t: pts[i].t, line, d: pr.d, lat })
      }
    }
  }
  const toPark: HoverPark = { ...to, heading: toHeading }
  return { from, to: toPark, pts, length: pts[m - 1].s, total: pts[m - 1].t, clearance, escort, avoided: avoid, tramCross, blockedEdges }
}

/** 出てから tau 秒の、道のりの長さと速さ */
function distAt(f: HoverFlight, tau: number): { s: number; v: number } {
  const pts = f.pts
  if (tau <= 0) return { s: 0, v: 0 }
  if (tau >= f.total) return { s: f.length, v: 0 }
  let lo = 0
  let hi = pts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].t <= tau) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[hi]
  const dt = Math.max(1e-6, b.t - a.t)
  const u = Math.min(1, Math.max(0, (tau - a.t) / dt))
  // その区間は速さが時間に比例して変わる（区間の終わりで b に着くように、進んだ割合で長さを分ける）
  const go = a.v * u + 0.5 * (b.v - a.v) * u * u
  const full = (a.v + b.v) / 2
  const k = full > 1e-6 ? go / full : u
  return { s: a.s + (b.s - a.s) * k, v: a.v + (b.v - a.v) * u }
}

/** 道のりの長さ s の点と向き */
function sampleAt(f: HoverFlight, s: number, out: THREE.Vector3): number {
  const pts = f.pts
  let lo = 0
  let hi = pts.length - 1
  if (s <= 0) {
    out.copy(pts[0].p)
    return pts[0].heading
  }
  if (s >= pts[hi].s) {
    out.copy(pts[hi].p)
    return pts[hi].heading
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].s <= s) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[hi]
  const k = (s - a.s) / Math.max(1e-6, b.s - a.s)
  out.lerpVectors(a.p, b.p, k)
  return lerpAngle(a.heading, b.heading, k)
}

/** 出る時刻 t0（運転の日の秒）で飛ぶと、緑電の線路を横切る所に編成がいないか（前後と横に 1.5m の余白） */
function flightClear(f: HoverFlight, t0: number) {
  for (const c of f.tramCross) if (tramOccupies(c.line, t0 + c.t, c.d, c.lat, 1.5)) return false
  return true
}

/** 時刻 base（運転の日の秒）から 0.5 秒ごとに、緑電の編成と重ならずに出られる時刻を探す。2 分の内に無ければ base */
function pickDeparture(f: HoverFlight, base: number) {
  if (!f.tramCross.length) return base
  for (let dt = 0; dt <= 120; dt += 0.5) if (flightClear(f, base + dt)) return base + dt
  return base
}

/** 飛ぶ道の、出てから tau 秒のホバーの行列（前後・横の傾きとわずかな上下も） */
function flightPose(f: HoverFlight, tau: number, out: THREE.Matrix4, now: number) {
  const { s, v } = distAt(f, tau)
  const h = sampleAt(f, s, _pt)
  const a = distAt(f, tau + 0.25)
  sampleAt(f, a.s, _w)
  const ha = sampleAt(f, Math.min(f.length, s + Math.max(1.5, v * 0.6)), _d)
  const climb = (_w.y - _pt.y) / 0.25
  const tilt = THREE.MathUtils.clamp(-(a.v - v) * 0.04 - climb * 0.01, -0.06, 0.05)
  const bank = THREE.MathUtils.clamp(-Math.atan2(Math.sin(ha - h), Math.cos(ha - h)) * v * 0.05, -0.08, 0.08)
  // 浮いている間のわずかな上下（交通の時計で）
  const bob = 0.02 * Math.sin(now * 1.9) * THREE.MathUtils.smoothstep(tau, 0.8, 2.5) * THREE.MathUtils.smoothstep(f.total - tau, 0.6, 2.0)
  _q.setFromEuler(_e.set(tilt, h, bank, 'YXZ'))
  _pt.y += bob
  out.compose(_pt, _q, _s)
  return v
}

/* -------------------------------------------------------------------------- */
/* 呼ぶ                                                                         */
/* -------------------------------------------------------------------------- */

/** 呼んだホバーの様子（ホバーは 1 台なので 1 つ）。flight = 呼んだ人の近くへ飛んでいる道（無ければ置いてある）、depart = 出る時刻（運転の日の秒） */
const summon = {
  by: null as Character | null,
  flight: null as HoverFlight | null,
  depart: 0,
  upCued: false,
}

/** 乗っている人（乗り込みから降りるまで。機体を書く。いなければ null） */
let rider: Character | null = null

/**
 * 呼んだ人 ch の近くの置く所: 町の中・ラボのまわり・建物の外なら今いる所の近く。ラボ・中のある建物の中、近くに置ける所が無いときは、
 * そのゾーンの外の出入口の前の近く。だめなら理由
 */
function summonSpot(ch: Character): HoverPark | string {
  const m = ch.motion
  const p = m.position
  const inside = m.zone !== 'town' && (m.zone === 'lab' ? !m.outside : m.indoor)
  if (!inside) {
    const near = hoverSpotNear(p.x, p.z, m.ground, ch)
    if (near) return near
  }
  if (m.zone !== 'town') {
    const portal = ZONE_PORTALS[m.zone as TravelZone]?.[0]
    if (portal) {
      const x = portal.town[0]
      const z = -portal.town[1]
      const near = hoverSpotNear(x, z, townWalk.groundY(x, z, inside ? townWalk.groundY(x, z) : m.ground, false), ch)
      if (near) return near
    }
  }
  return '近くにホバーを置ける道・広場がありません'
}

/** 呼んだホバーが飛んでいる途中か */
const summonFlying = () => summon.flight !== null

/** 今のホバーの位置（シーン。置いてある所か、呼ばれて飛んでいる途中の所） */
function craftPose(): HoverPark | null {
  if (summon.flight) {
    const f = summon.flight
    const tau = transitClock.serviceSec - summon.depart
    const { s } = distAt(f, tau)
    const h = sampleAt(f, s, _v)
    return { x: _v.x, y: townWalk.groundY(_v.x, _v.z, _v.y - FLY_HEIGHT, false), z: _v.z, heading: h, side: hoverHome.side }
  }
  return hoverHome.placed ? { ...hoverHome } : null
}

/** ホバーを置く（すぐ。飛ばない） */
function placeHover(p: HoverPark) {
  hoverHome.placed = true
  hoverHome.x = p.x
  hoverHome.y = p.y
  hoverHome.z = p.z
  hoverHome.heading = p.heading
  hoverHome.side = p.side
}

/**
 * ホバーを置く所 spot へ来させる（飛んで来るか、すぐ現れる）。もうそこにいれば何もしない
 */
function startSummon(ch: Character, spot: HoverPark) {
  summon.by = ch
  townData.loadAllTiles()
  const here = craftPose()
  if (here && !summon.flight && Math.hypot(here.x - spot.x, here.z - spot.z) < 0.5) {
    hoverHome.side = spot.side
    return
  }
  const now = transitClock.serviceSec
  const far = !here || Math.hypot(here.x - spot.x, here.z - spot.z) > SUMMON_NEAR
  const f = far ? null : planHoverFlight(here!, spot, { escort: false, skip: ch })
  if (!f || typeof f === 'string' || f.length > SUMMON_NEAR * 2) {
    // 遠い（まだ一度も呼んでいない）: すぐ横に現れる（ファンを止めながら下りたところ）
    summon.flight = null
    placeHover(spot)
    hoverCraft.power = Math.max(hoverCraft.power, 0.7)
    townEvents.emit('hover.land', { x: spot.x, y: spot.y + 0.3, z: spot.z })
    return
  }
  // 飛んでいる途中に呼び直したら、今の所から（置いてある所を今の所に）
  if (summon.flight) placeHover({ ...here!, y: parkedHeight(here!.x, here!.z, here!.heading, here!.y) })
  const toPark: HoverPark = { ...f.to, side: sideOf(f.to, ch.motion.position.x, ch.motion.position.z) }
  f.to = toPark
  summon.flight = f
  summon.upCued = false
  summon.depart = pickDeparture(f, now + SUMMON_SPIN)
}

/**
 * ホバーを呼ぶ（公開の口。例のアプリの「ホバーを呼ぶ」）。呼んだ人 ch の近くの歩ける所（道・広場。ラボ・中のある建物の中なら、外の出入口の前）へ、
 * ホバーが今いる所から地面の少し上を飛んで来て、横に下りて待つ（100m より遠い・まだ一度も呼んでいないときは、すぐ横に現れる）。
 * 乗るのは旅程（startTravel の via: 'hover'）で、行き先の近くまで飛んで下りる。呼んだら null、呼べなければ理由の字（何もしない）。
 * 乗っていない間は最後に下りた所に置いておく
 */
export function summonHover(ch: Character): string | null {
  if (!townWalk.ready) return '町の道のデータがまだありません（町のデータを読み込み中か、町の地図データがありません）'
  if (rider && riderWrites(rider)) return rider === ch ? 'もうホバーに乗っています' : 'ホバーはほかの人が乗っています'
  if (ch.ride.phase !== 'none') return `${ch.ride.car?.vehicle.label ?? '乗り物'}に乗っています`
  const spot = summonSpot(ch)
  if (typeof spot === 'string') return spot
  startSummon(ch, spot)
  return null
}

/** ホバーの様子（公開の口 hoverStatus の返り値） */
export interface HoverStatus {
  /** none = まだ一度も呼んでいない・coming = 呼んだ人の近くへ飛んでいる・parked = 置いてある（呼んだ人の横で待つ・最後に下りた所）・riding = 人が乗っている（乗り込みから降りるまで） */
  phase: 'none' | 'coming' | 'parked' | 'riding'
  /** 今の所（シーンの x, z）と向き。none なら 0 */
  x: number
  z: number
  heading: number
  /** 呼んだ人（いなければ null）と、来るまでの秒（coming のとき。ほかは null） */
  summoner: Character | null
  arriveInSec: number | null
}

/** ホバーの様子（公開の口。例のアプリの案内・地図の印） */
export function hoverStatus(): HoverStatus {
  if (rider && riderWrites(rider)) {
    _v.setFromMatrixPosition(hoverCraft.matrix)
    return { phase: 'riding', x: _v.x, z: _v.z, heading: rider.motion.heading, summoner: summon.by, arriveInSec: null }
  }
  const p = craftPose()
  if (!p) return { phase: 'none', x: 0, z: 0, heading: 0, summoner: null, arriveInSec: null }
  if (summon.flight) return { phase: 'coming', x: p.x, z: p.z, heading: p.heading, summoner: summon.by, arriveInSec: Math.max(0, summon.depart + summon.flight.total - transitClock.serviceSec) }
  return { phase: 'parked', x: p.x, z: p.z, heading: p.heading, summoner: summon.by, arriveInSec: null }
}

/** 旅程を一度に終える（cut=none）ときなど: ホバーを置く所へすぐ置く（飛ばない。呼んでいる途中ならやめる） */
export function parkHoverAt(p: HoverPark) {
  summon.flight = null
  placeHover(p)
}

/* -------------------------------------------------------------------------- */
/* 乗る仕組みの状態                                                               */
/* -------------------------------------------------------------------------- */

export interface HoverRideSpec {
  /** 降りる所（行き先の近くの置く所）と、降りてから向かう所（シーンの x, z。降りる側を決める）・行き先の名前 */
  to: HoverPark
  toward: [number, number]
  label: string
  wait: RideTime
  ride: RideTime
  fastSec: number | null
  fastSpeed: number | null
}

type Step = 'idle' | 'await' | 'board' | 'turn' | 'settle' | 'power' | 'fly' | 'land' | 'stand' | 'out' | 'done' | 'failed'

/** ホバーに乗る仕組みの状態（Character ごと。ch.rides.hover。character/ride/rides.ts が作る） */
export function createHoverRide(ch: Character) {
  return {
    /** 乗る人（この仕組みの持ち主） */
    ch,
    /** ホバーの車室（Car。ホバーは 1 台なので便 0 の 1 つ） */
    cabin: null as Car | null,
    spec: null as HoverRideSpec | null,
    step: 'idle' as Step,
    /** 乗った所（置いてあったホバー）と飛ぶ道 */
    park: null as HoverPark | null,
    flight: null as HoverFlight | null,
    /** 出る時刻（運転の日の秒。0 = まだ決めていない） */
    depart: 0,
    upCued: false,
    powerAt: 0,
    landAt: 0,
    t: 0,
    path: null as Path | null,
    waitDone: false,
    rideDone: false,
    /** 浮く前（回す間）にやめて、乗った所で降りる */
    stayed: false,
    /** 降りる側（局所の x の向き） */
    outSide: 1 as 1 | -1,
    placeSerial: -1,
    first: true,
    error: null as string | null,
    /** 乗り込みで床板の上へ乗った・降りるときに床板から下りた（出来事 ride.enter・ride.exit を出した） */
    entered: false,
    exited: false,
  }
}
export type HoverRide = ReturnType<typeof createHoverRide>

/** 乗っている人の更新が機体を書く段（乗り込みから降りるまで。待つ間は呼んだホバーが飛んで来る） */
function riderWrites(ch: Character) {
  const step = ch.rides.hover.step
  return step !== 'idle' && step !== 'await' && step !== 'done' && step !== 'failed'
}

/** 今の様子（状態の返送） */
export function hoverRideState(ch: Character) {
  const ctl = ch.rides.hover
  if (ctl.step === 'idle') return null
  const now = transitClock.serviceSec
  const f = ctl.flight
  const coming = ctl.step === 'await' && summon.flight ? Math.max(0, summon.depart + summon.flight.total - now) : null
  return {
    step: ctl.step,
    from: null,
    to: ctl.spec?.label ?? null,
    come_in_s: coming === null ? null : Math.round(coming),
    depart_in_s: ctl.depart ? Math.round(ctl.depart - now) : null,
    arrive_in_s: f && ctl.depart ? Math.round(ctl.depart + f.total - now) : null,
    error: ctl.error,
  }
}

/** 乗る人 ch のホバーに乗る仕組みの様子と操作（travel.ts・状態の返送） */
export const hoverRide = {
  active: (ch: Character) => {
    const step = ch.rides.hover.step
    return step !== 'idle' && step !== 'done' && step !== 'failed'
  },
  result(ch: Character): { ok: boolean; error: string | null } | null {
    const ctl = ch.rides.hover
    if (ctl.step === 'done') return { ok: true, error: null }
    if (ctl.step === 'failed') return { ok: false, error: ctl.error }
    return null
  },
  clear(ch: Character) {
    const ctl = ch.rides.hover
    if (ctl.step === 'done' || ctl.step === 'failed') reset(ctl, false)
  },
  /**
   * 町の中の移動が取り消された: まだ腰掛けていなければやめる（呼んだホバーは、来る途中ならそのまま来て待つ）。回している間（浮く前）なら、
   * ファンを止めて乗った所で降りる（待つ間の早送り・カットもやめる）。飛んでいる途中なら、着いて降りるまで続ける
   */
  cancel(ch: Character) {
    const ctl = ch.rides.hover
    if (ctl.step === 'await' || ctl.step === 'board' || ctl.step === 'turn' || ctl.step === 'settle') reset(ctl, true)
    else if (ctl.step === 'power') {
      ctl.step = 'land'
      ctl.landAt = ctl.t
      ctl.stayed = true
      cancelWarp(ch)
    }
  },
  state: hoverRideState,
  /** 乗っている間の時間の扱い（続きの kanon.travel が、まだ使っていない wait・ride・早送りの倍率を変える。§7 の 216） */
  spec: (ch: Character) => ch.rides.hover.spec,
}

/** 乗る便（ホバーを呼んで、横の乗る所と、飛ぶ道）。だめなら理由 */
export interface HoverBoardingPlan {
  /** 乗る所（呼んだホバーを置く所）・飛ぶ道 */
  park: HoverPark
  flight: HoverFlight
  /** 乗り降りする横の地面の所（シーンの x, z）と、そこで向く向き（ホバーの方） */
  spot: [number, number]
  heading: number
}

/**
 * 乗る便を決める（旅程の乗り物の区間。character/avatar/travel.ts）: ホバーを乗る人 ch の近くへ呼び（もう近くで待っている・こちらへ来る途中なら、
 * そのまま）、そこから降りる所 to へ飛ぶ道を決める。escort = 並走する仲間の場所を空ける（乗る人の仲間に浮かぶ仲間がいるか: character/ride/party.ts の partyEscorts）
 */
export function planHoverBoarding(ch: Character, to: HoverPark, escort = true): HoverBoardingPlan | string {
  if (rider && rider !== ch && riderWrites(rider)) return 'ホバーはほかの人が乗っています'
  const m = ch.motion
  // 呼ぶ（来る途中・待っている所が、乗る人から 8m の内でまっすぐ歩けるなら、そのまま）
  let park: HoverPark | null = summon.flight ? summon.flight.to : hoverHome.placed ? { ...hoverHome } : null
  if (park) {
    const sp = sideSpot(park, sideOf(park, m.position.x, m.position.z), _w)
    if (summon.by !== ch || Math.hypot(sp.x - m.position.x, sp.z - m.position.z) > 8 || !walkableLine(m.position.x, m.position.z, sp.x, sp.z)) park = null
  }
  if (!park) {
    const spot = summonSpot(ch)
    if (typeof spot === 'string') return spot
    startSummon(ch, spot)
    park = summon.flight ? summon.flight.to : { ...hoverHome }
  }
  const side = sideOf(park, m.position.x, m.position.z)
  park = { ...park, side }
  if (summon.flight) summon.flight.to.side = side
  else hoverHome.side = side
  // 町の木・建物をよける道は、町のタイルを全部読んでから（まだなら、回して待つ間に決め直す）
  townData.loadAllTiles()
  const f = planHoverFlight(park, to, { avoid: !tilesPending(), escort, skip: ch })
  if (typeof f === 'string') return f
  const p = sideSpot(park, side, new THREE.Vector3())
  // 横の所でホバーの方（床板の方）を向く
  return { park, flight: f, spot: [p.x, p.z], heading: park.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2) }
}

/** 乗るのを始める（乗る人はホバーの横の乗る所に着いている。ホバーがまだ来ていなければ、来るまで待つ） */
export function beginHoverRide(ch: Character, spec: HoverRideSpec, plan: HoverBoardingPlan) {
  const ctl = ch.rides.hover
  reset(ctl, false)
  // 機体を書くのはこの人（乗り込み始めてから）
  rider = ch
  ctl.spec = spec
  ctl.park = plan.park
  ctl.flight = plan.flight
  ctl.placeSerial = ch.motion.placeSerial
  ctl.cabin = hoverVehicle.car(0)
  ctl.outSide = 1
  setRiderCar(ch.ride, ctl.cabin)
  ctl.first = true
  const m = ch.motion
  m.stopId = null
  m.targetId = null
  m.activityHeld = false
  m.seat = null
  m.action = 'present'
  ch.ride.phase = 'wait'
  ctl.step = 'await'
  ch.events.emit('ride.wait', ctl.cabin)
  // もう来ていれば、すぐ乗り込む
  if (!summonFlying()) startBoarding(ctl)
}

/** 置いたホバーへ乗り込み始める */
function startBoarding(ctl: HoverRide) {
  const ch = ctl.ch
  const park = { ...hoverHome }
  ctl.park = park
  ctl.cabin!.setPose(parkedMatrix(_m), true)
  ctl.first = false
  const s = park.side
  const p0 = ctl.cabin!.toCabin(ch.motion.position, new THREE.Vector3())
  ctl.path = makePath([new THREE.Vector3(p0.x, 0, p0.z), new THREE.Vector3(s * 0.5, 0, STAND_Z), new THREE.Vector3(0, 0, STAND_Z)])
  ctl.path.speed = 0
  ctl.step = 'board'
  ctl.entered = false
  ch.ride.phase = 'board'
  ch.events.emit('ride.board', ctl.cabin!)
}

function fail(ctl: HoverRide, msg: string) {
  const r = ctl.ch.ride
  ctl.error = msg
  ctl.step = 'failed'
  const car = r.car?.vehicle === hoverVehicle ? r.car : null
  if (car) {
    r.phase = 'none'
    setRiderCar(r, null)
  }
  if (rider === ctl.ch) rider = null
  cancelWarp(ctl.ch)
  if (car) ctl.ch.events.emit('ride.cancel', car)
}

function reset(ctl: HoverRide, stopRider: boolean) {
  const r = ctl.ch.ride
  ctl.spec = null
  ctl.step = 'idle'
  ctl.flight = null
  ctl.park = null
  ctl.path = null
  ctl.error = null
  ctl.depart = 0
  ctl.upCued = false
  ctl.waitDone = ctl.rideDone = false
  ctl.stayed = false
  const car = r.car?.vehicle === hoverVehicle ? r.car : null
  if (car) {
    r.phase = 'none'
    car.delta.set(0, 0, 0)
    setRiderCar(r, null)
    r.attach = 0
    r.inside = false
  }
  if (rider === ctl.ch) {
    rider = null
    hoverCraft.speed = 0
  }
  cancelWarp(ctl.ch)
  if (stopRider) {
    const m = ctl.ch.motion
    m.speed = 0
    m.phase = 'idle'
    m.seat = null
    m.activityHeld = false
  }
  if (car) ctl.ch.events.emit('ride.cancel', car)
}

/* -------------------------------------------------------------------------- */
/* 毎コマ（updateRiders。交通の時計を進めたあと・人を動かす前）                          */
/* -------------------------------------------------------------------------- */

/** 機体のファンの回り（回す・止める）と灯り（夜。回っている間）。1 コマ 1 回 */
function updatePower(spinning: boolean, dt: number) {
  hoverCraft.power += ((spinning ? 1 : 0) - hoverCraft.power) * (1 - Math.exp(-dt * (spinning ? 2.2 : 1.6)))
  if (hoverCraft.power < 1e-3) hoverCraft.power = 0
  const dark = 1 - THREE.MathUtils.smoothstep(outdoor.daylight, 0.08, 0.4)
  hoverCraft.lamp = Math.min(1, hoverCraft.power * 1.5) * dark
}

/** 置いてあるホバーの行列（ファンが回っている間は地面からわずかに浮く） */
function writeParked(now: number) {
  parkedMatrix(hoverCraft.matrix)
  if (hoverCraft.power > 0.01) hoverCraft.matrix.elements[13] += 0.04 * hoverCraft.power + 0.008 * Math.sin(now * 2.3) * hoverCraft.power
  hoverCraft.speed = 0
  hoverCraft.ready = true
}

/**
 * 毎コマ（riders.ts の updateRiders。乗る人ごとの更新の前に 1 回）: 乗っている人がいない間の機体（置いてある・呼ばれて飛んで来る）。
 * characters = よける人（飛ぶ道・置く所を決めるとき）
 */
export function updateHoverCraft(characters: readonly Character[], delta: number) {
  people = characters
  if (rider && riderWrites(rider)) return
  const dt = Math.min(delta, 0.1)
  const now = transitClock.serviceSec
  const f = summon.flight
  if (f) {
    const tau = now - summon.depart
    if (tau >= f.total) {
      // 着いた: 下りた所に置く（次に呼ぶとここから）
      summon.flight = null
      placeHover(f.to)
      townEvents.emit('hover.land', { x: f.to.x, y: f.to.y + 0.3, z: f.to.z })
    } else {
      if (!summon.upCued && tau > -SUMMON_SPIN) {
        summon.upCued = true
        townEvents.emit('hover.spinUp', { x: f.from.x, y: f.from.y + 0.3, z: f.from.z })
      }
      updatePower(true, dt)
      if (tau > 0) {
        hoverCraft.speed = flightPose(f, tau, hoverCraft.matrix, now)
        hoverCraft.ready = true
      } else writeParked(now)
      return
    }
  }
  updatePower(false, dt)
  if (!hoverHome.placed || !townWalk.ready) {
    hoverCraft.ready = false
    return
  }
  writeParked(now)
}

/** 乗っている人の、今のコマのホバーの行列（飛んでいる間は道の上、ほかは置いてある所） */
function updatePose(ctl: HoverRide, now: number) {
  if (rider !== ctl.ch) return
  const f = ctl.flight
  if (f && ctl.step === 'fly') {
    hoverCraft.speed = flightPose(f, now - ctl.depart, hoverCraft.matrix, now)
    hoverCraft.ready = true
  } else if (riderWrites(ctl.ch)) writeParked(now)
}

export function updateHoverRide(ch: Character, t: number, delta: number) {
  const ctl = ch.rides.hover
  const r = ch.ride
  ctl.t = t
  const dt = Math.min(delta, 0.1)
  const now = transitClock.serviceSec
  if (!hoverRide.active(ch)) return
  // ファンの回り（回す・止める）と灯り（機体を書く人だけ）
  if (rider === ch && riderWrites(ch)) updatePower(ctl.step === 'power' || ctl.step === 'fly' || (ctl.step === 'land' && t - ctl.landAt < SPIN_DOWN), dt)
  if (ch.motion.placeSerial !== ctl.placeSerial) {
    // 途中で別の所へ置き直された（ワープ・kanon.place）: 飛んでいる途中なら、ホバーはその下の地面に下ろして置く
    if (ctl.step === 'fly' && rider === ch) {
      _v.setFromMatrixPosition(hoverCraft.matrix)
      const h = Math.atan2(hoverCraft.matrix.elements[8], hoverCraft.matrix.elements[10])
      const g = townWalk.groundY(_v.x, _v.z, _v.y - FLY_HEIGHT, false)
      placeHover({ x: _v.x, y: parkedHeight(_v.x, _v.z, h, g), z: _v.z, heading: h, side: 1 })
    }
    reset(ctl, false)
    return
  }
  const spec = ctl.spec!
  const f = ctl.flight
  if (!f) {
    fail(ctl, 'ホバーの飛ぶ道がありません')
    return
  }
  if (ctl.step === 'await') {
    // 呼んだホバーが来るのを待つ（待つ間の時間の扱い wait）
    if (!summonFlying()) startBoarding(ctl)
    else if (!ctl.waitDone) {
      ctl.waitDone = true
      const arrive = summon.depart + summon.flight!.total
      if (spec.wait !== 'real' && arrive - now > 3) advanceBy(ch, arrive - 1.5 - now, spec.wait, spec.fastSec, spec.fastSpeed, 6)
    }
  } else if (ctl.step === 'power') {
    // ファンを回し始めた（花音が腰掛けて回し始めたコマ。音の合図は使う側が鳴らす）
    if (!ctl.upCued) {
      ctl.upCued = true
      const p = hoverPos(_v)
      townEvents.emit('hover.spinUp', { x: p.x, y: p.y, z: p.z })
    }
    // 町のタイルを読み終えたら、町の木・建物をよける道に決め直す（読み終えるまで待つ）
    if (!f.avoided && !tilesPending()) {
      const nf = planHoverFlight(f.from, spec.to, { avoid: true, escort: f.escort, skip: ch })
      if (typeof nf === 'string') {
        fail(ctl, nf)
        return
      }
      ctl.flight = nf
    }
    // 回し始めて 2 秒（ファンが回りきる）たったら、緑電の線路を横切る所に編成がいない出る時刻を決めて、それまで待つ
    if (!ctl.depart && ctl.flight!.avoided && t - ctl.powerAt > SPIN_UP - 0.4) {
      ctl.depart = pickDeparture(ctl.flight!, now + 0.4)
      if (!ctl.waitDone && spec.wait !== 'real' && ctl.depart - now > 3) advanceBy(ch, ctl.depart - 1.5 - now, spec.wait, spec.fastSec, spec.fastSpeed, 6)
      ctl.waitDone = true
    }
    if (ctl.depart && now >= ctl.depart) {
      ctl.step = 'fly'
      r.phase = 'riding'
    }
  } else if (ctl.step === 'fly') {
    const fl = ctl.flight!
    const tau = now - ctl.depart
    // 飛ぶ間（浮いて 6 秒飛んだら、下り始める 6 秒前へ）
    if (!ctl.rideDone && tau > 6) {
      ctl.rideDone = true
      const target = ctl.depart + fl.total - 6
      if (spec.ride !== 'real' && target - now > 2) advanceBy(ch, target - now, spec.ride, spec.fastSec, spec.fastSpeed, 20)
    }
    if (tau >= fl.total) {
      // 着いた: 下りた所に置く（次に呼ぶとここから）。ファンを止める。降りる側は、降りてから向かう所の側
      const to = fl.to
      ctl.outSide = sideOf(to, spec.toward[0], spec.toward[1])
      placeHover({ ...to, side: ctl.outSide })
      ctl.step = 'land'
      ctl.landAt = t
      const p = hoverPos(_v)
      townEvents.emit('hover.land', { x: p.x, y: p.y, z: p.z })
      // 着いた（並走していた仲間はここで離れる）
      ch.events.emit('ride.arrived', ctl.cabin!)
    }
  } else if (ctl.step === 'land') {
    if (ctl.stayed) ctl.outSide = hoverHome.side
    if (t - ctl.landAt > SPIN_DOWN) {
      ctl.step = 'stand'
      r.phase = 'alight'
      ch.motion.activityHeld = false
      ch.motion.action = 'present'
      ch.events.emit('ride.alight', ctl.cabin!)
    }
  }
  updatePose(ctl, now)
  const car = ctl.cabin
  if (car && r.car === car) {
    car.setPose(hoverCraft.matrix, ctl.first)
    ctl.first = false
  }
  if (car) updateParty(ch, car, dt)
}

/** ホバーの今の位置（シーン。音の合図の出来事） */
function hoverPos(out: THREE.Vector3) {
  return out.setFromMatrixPosition(hoverCraft.matrix).add(_d.set(0, 0.3, 0))
}

/* -------------------------------------------------------------------------- */
/* 一緒に乗る仲間の道（ホバーの左の少し前に並んで飛ぶ。character/ride/party.ts。前の KB-001 の付き添いの式と数のまま） */
/* -------------------------------------------------------------------------- */

defineMemberSlots('hover', {
  /** 並走を始める（花音が腰掛けた）: 花音の後ろ・上から、左へ回り込みながらホバーと一緒に動く（浮き上がる前にホバーに付き、飛ぶ間はばねの分だけ） */
  join(leader, way) {
    const ctl = leader.rides.hover
    if (way !== 'escort' || !ctl.cabin) return null
    return {
      car: ctl.cabin,
      way: 'escort',
      pts: [new THREE.Vector3(0.6, H.deckY + 1.9, -0.9), ESCORT_LOCAL.clone()],
      index: 0,
      reach: 0.35,
      end: 'none',
      settle: 0,
      speed: 3,
      speedNow: () => (ctl.step === 'fly' ? CRUISE + 2 : 2.6),
      attach0: 0,
      attachRate: 1.2,
      attachGate: null,
      holdAtDoor: null,
      lastPoint: null,
      aim: 'post',
      aimOnEnd: false,
      tuck: ESCORT_TUCK,
      maxAbove: null,
    }
  },
  /** 並走をやめる（下りた）: その場で離れる */
  leave: () => null,
  /** 降りて立つ所: 下りたホバーの、降りる側の横の地面（ホバーと反対の方を向く） */
  arrival(leader, out) {
    const ctl = leader.rides.hover
    if (!ctl.spec) return null
    const s = ctl.outSide
    out.set(s * SIDE_X, 0, STAND_Z).applyMatrix4(parkedMatrix(_m))
    out.y = groundHeight(leader, out.x, out.z, false, out.y)
    return hoverHome.heading + (s > 0 ? Math.PI / 2 : -Math.PI / 2)
  },
})

/* -------------------------------------------------------------------------- */
/* 花音の動き（locomotion の中から）                                               */
/* -------------------------------------------------------------------------- */

function turnToward(m: CharacterMotion, target: number, dt: number, maxRate = 2.4) {
  const err = wrapAngle(target - m.heading)
  const rate = THREE.MathUtils.clamp(err * 4.5, -maxRate, maxRate)
  m.heading = wrapAngle(m.heading + rate * dt)
  m.turnRate = rate
  return err
}

function headingOf(ctl: HoverRide, local: THREE.Vector3) {
  ctl.cabin!.dirToWorld(local, _d)
  return Math.atan2(_d.x, _d.z)
}

function setGround(ch: Character, dt: number) {
  const m = ch.motion
  const g = groundHeight(ch, m.position.x, m.position.z, false, m.position.y)
  if (Math.abs(g - m.ground) < 0.45) m.ground += (g - m.ground) * (1 - Math.exp(-dt * 14))
  else m.ground = g
  m.position.y = m.ground
}

/** locomotion から毎コマ呼ばれる（Character の drivers.motion から）。ch を動かしたら true */
export function driveHover(ch: Character, _t: number, dt: number): boolean {
  if (!hoverRide.active(ch)) return false
  const ctl = ch.rides.hover
  const r = ch.ride
  const m = ch.motion
  m.timeScale = 1
  m.stride = null
  const step = ctl.step
  const car = ctl.cabin!
  if (step === 'await') {
    // 横の乗る所で、来るホバーの方を向いて待つ
    m.speed = 0
    m.phase = 'idle'
    _v.setFromMatrixPosition(hoverCraft.matrix)
    if (hoverCraft.ready && Math.hypot(_v.x - m.position.x, _v.z - m.position.z) > 0.3) turnToward(m, Math.atan2(_v.x - m.position.x, _v.z - m.position.z), dt)
    else m.turnRate = 0
    m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
    setGround(ch, dt)
    return true
  }
  if (step === 'board' || step === 'out') {
    const p = ctl.path!
    const done = walkPath(p, dt, step === 'board' ? 0.7 : 0.75)
    pathAt(p, p.s, _pt, _dir)
    car.toWorld(_pt.x, 0, _pt.z, _v)
    m.position.x = _v.x
    m.position.z = _v.z
    m.speed = p.speed
    m.phase = 'walk'
    m.zone = zoneOfPoint(_v.x, _v.z)
    turnToward(m, headingOf(ctl, _dir), dt, 3.2)
    m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
    setGround(ch, dt)
    r.attach = Math.abs(_pt.x) < H.deckHW ? 1 : 0
    if (step === 'board' && !ctl.entered && Math.abs(_pt.x) < H.deckHW) {
      ctl.entered = true
      ch.events.emit('ride.enter', car)
    }
    if (step === 'out' && !ctl.exited && Math.abs(_pt.x) >= H.deckHW) {
      ctl.exited = true
      ch.events.emit('ride.exit', car)
    }
    if (step === 'board' && done) ctl.step = 'turn'
    if (step === 'out' && done) {
      // 横の地面に下りた: 町の中の移動へ返す
      m.speed = 0
      m.phase = 'idle'
      r.phase = 'none'
      car.delta.set(0, 0, 0)
      setRiderCar(r, null)
      r.attach = 0
      ctl.step = 'done'
      r.serials.alight++
      if (rider === ch) rider = null
      ch.events.emit('ride.left', car)
      return false
    }
    return true
  }
  // 床板の上の立つ所（ホバーに付いて動く）
  car.toWorld(0, H.deckY, STAND_Z, _v)
  m.position.x = _v.x
  m.position.z = _v.z
  m.zone = zoneOfPoint(_v.x, _v.z)
  m.speed = 0
  m.phase = 'idle'
  r.attach = 1
  m.ground = _v.y
  m.position.y = m.ground
  const want = headingOf(ctl, _d.set(0, 0, 1))
  if (step === 'turn') {
    const err = turnToward(m, want, dt)
    if (Math.abs(err) < 0.02 && Math.abs(m.turnRate) < 0.1) {
      m.turnRate = 0
      m.action = 'sit'
      m.seat = SEAT
      m.activityHeld = true
      ctl.step = 'settle'
    }
    return true
  }
  m.heading = want
  m.turnRate *= Math.exp(-dt * 8)
  m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
  if (step === 'settle') {
    if (m.actionBlend > 0.85) {
      ctl.step = 'power'
      ctl.powerAt = ctl.t
      ctl.depart = 0
      r.phase = 'riding'
      r.serials.board++
      // 腰掛けた（一緒に乗る仲間が並走を始める所）
      ch.events.emit('ride.riding', car)
    }
    return true
  }
  if (step === 'stand') {
    // 立ち上がったら（腰掛けの姿勢がほどけたら）、降りる側へ床板から下りる
    if (m.actionBlend < 0.25) {
      const s = ctl.outSide
      m.seat = null
      ctl.path = makePath([new THREE.Vector3(0, 0, STAND_Z), new THREE.Vector3(s * 0.5, 0, STAND_Z - 0.05), new THREE.Vector3(s * (SIDE_X + 0.25), 0, STAND_Z - 0.2)])
      ctl.path.speed = 0
      ctl.step = 'out'
      ctl.exited = false
    }
    return true
  }
  return true
}

/* -------------------------------------------------------------------------- */
/* 自動カメラ（配信。乗っている間の画）                                                */
/* -------------------------------------------------------------------------- */

/** 画の手前（カメラから 1〜3.5m）の、画角の縁の近くの点に、町の木の葉・建物があるか（画の手前に葉の塊が大きく入る画を使わない） */
const _fwd = new THREE.Vector3()
const _side = new THREE.Vector3()
const _upv = new THREE.Vector3()
const _probe = new THREE.Vector3()
function foregroundClear(pos: THREE.Vector3, target: THREE.Vector3, fov: number): boolean {
  _fwd.subVectors(target, pos).normalize()
  _side.crossVectors(_fwd, UP_Y)
  if (_side.lengthSq() < 1e-6) return true
  _side.normalize()
  _upv.crossVectors(_side, _fwd)
  const tv = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 0.8
  const th = tv * (16 / 9)
  let hits = 0
  for (const d of [1, 2, 3.5]) {
    for (const [sx, sy] of [[-1, 0], [1, 0], [0, 1], [-0.7, 0.7], [0.7, 0.7]]) {
      _probe.copy(pos).addScaledVector(_fwd, d).addScaledVector(_side, sx * th * d).addScaledVector(_upv, sy * tv * d)
      // 当たりの形の葉の円は、描く樹冠より小さい（樹冠の 0.8 倍）ので、0.6m 広げて見る
      if (townSolids.blocker(_probe.x, _probe.y, _probe.z, 0.6)) hits++
    }
  }
  return hits <= 1
}
const UP_Y = new THREE.Vector3(0, 1, 0)

/** 頼まれた画の番号ごとの、今使っている画と、替えた時刻（置ける・置けないが毎コマ入れ替わる所で、画が細かく切り替わらないように） */
const autoPick = new Map<number, { view: number; at: number }>()
/** ?debug: 画を置けなかったわけ（画の番号ごと） */
const autoWhy: string[] = []

/** 置いたホバーの横で乗り降りする間（待つ間も）の自動カメラの画の候補（src/camera/rideViews.ts） */
export function hoverPlatformViews(ch: Character, _car: Car, out: PlatformView[]) {
  const ctl = ch.rides.hover
  out.length = 0
  if (ctl.step === 'idle' || !hoverHome.placed) return
  // ホバーの横: ホバーの右前・左前・後ろの斜め（横の花音と、置いたホバーの全体）
  const s = ctl.step === 'out' || ctl.step === 'stand' || ctl.step === 'land' ? ctl.outSide : hoverHome.side
  waitViews(ch.motion.position, hoverHome.heading + (s > 0 ? Math.PI / 2 : -Math.PI / 2), out)
}

/**
 * 乗っている間の自動カメラの画 i（便 car のホバーと一緒に動く。src/camera/rideViews.ts）: 0 = 外から追う（左後ろの斜め上）、1 = 横に並ぶ（左。KB-001 の外）、
 * 2 = 前から。町の建物・木・地面に入る・さえぎられるなら、外から追う画へ。どれもだめなら null
 */
export function hoverAutoView(ch: Character, car: Car, i: number, pos: THREE.Vector3, target: THREE.Vector3): number | null {
  const ctl = ch.rides.hover
  if (car.vehicle !== hoverVehicle || (ctl.step !== 'power' && ctl.step !== 'fly' && ctl.step !== 'land')) return null
  const eyeY = H.deckY + 1.2
  const k = ((i % 3) + 3) % 3
  const views: [number, number, number, number, number, number, number][] = [
    // [位置 x, y, z, 注視点 x, y, z, 画角]
    [1.7, H.deckY + 2.0, -4.3, 0.1, eyeY - 0.25, 0.6, 46],
    [3.1, H.deckY + 1.15, 0.45, 0, eyeY - 0.1, -0.15, 44],
    [-0.55, H.deckY + 1.4, 3.7, 0.05, eyeY - 0.05, -0.1, 42],
    // 置けないとき: すぐ後ろの上
    [0.0, H.deckY + 1.9, -3.2, 0, eyeY - 0.1, 0.8, 50],
  ]
  const place = (kk: number) => {
    const v = views[kk]
    car.toWorld(v[0], v[1], v[2], pos)
    car.toWorld(v[3], v[4], v[5], target)
    if (townWalk.ready) {
      const g = townWalk.groundY(pos.x, pos.z, pos.y, false)
      if (pos.y < g + 0.8) pos.y = g + 0.8
    }
    // 町の建物・木の葉から 0.9m（画の手前に葉の塊が入らないように）・花音まで見通せる。すぐ後ろの上の画は 0.5m
    const mg = kk === 3 ? 0.5 : 0.9
    const b = townSolids.blocker(pos.x, pos.y, pos.z, mg) ?? (kk === 3 ? null : townSolids.blocker(pos.x, pos.y + 0.7, pos.z, mg - 0.3)) ?? townSolids.blocker(pos.x, pos.y - 0.7, pos.z, mg - 0.3)
    if (b) return ((autoWhy[kk] = `place:${b}`), false)
    const sb = townSolids.sightBlocker(pos, target, 0.8)
    if (sb) return ((autoWhy[kk] = `sight:${sb}`), false)
    return kk === 3 || foregroundClear(pos, target, v[6])
  }
  let chosen = -1
  for (const kk of [k, 0, 1, 2, 3]) {
    if (place(kk)) {
      chosen = kk
      break
    }
  }
  // 1.5 秒の内に替わったばかりなら、前の画がまだ置ける限りそのまま
  const last = autoPick.get(i)
  if (last && chosen !== last.view && ctl.t - last.at < 1.5 && ctl.t >= last.at && place(last.view)) return views[last.view][6]
  if (chosen < 0) return null
  if (!last || last.view !== chosen) autoPick.set(i, { view: chosen, at: ctl.t })
  if (!place(chosen)) return null
  return views[chosen][6]
}

/** ?debug: 今の飛ぶ道で、出てから tau 秒のホバーの位置（シーン） */
function flightPosAt(ctl: HoverRide, tau: number) {
  const f = ctl.flight
  if (!f) return null
  const out = new THREE.Vector3()
  sampleAt(f, distAt(f, tau).s, out)
  return out
}

/** ?debug: コンソールから（window.__hover。src/kanon/index.ts が花音で作る） */
export function hoverRideDebug(ch: Character) {
  const ctl = ch.rides.hover
  const r = ch.ride
  return {
    flightPosAt: (tau: number) => flightPosAt(ctl, tau),
    autoView: (i: number, pos: THREE.Vector3, target: THREE.Vector3) => (ctl.cabin ? hoverAutoView(ch, ctl.cabin, i, pos, target) : null),
    autoWhy,
    /** 仲間の今の位置（ホバーの局所）・段・行き先・付いて動く度合い */
    members: () => {
      const local = (p: THREE.Vector3) => (r.lastCar ? r.lastCar.toCabin(p, new THREE.Vector3()) : p.clone()).toArray().map((v) => +v.toFixed(2))
      return r.party.members.map((m) => ({ id: m.id, local: local(m.motion.position), mode: m.ride.member.mode, attach: +m.ride.attach.toFixed(2), target: local(m.ride.member.target) }))
    },
    ctl,
    hoverHome,
    hoverCraft,
    summon,
    summonHover: () => summonHover(ch),
    hoverStatus,
    planHoverFlight,
    hoverSpotNear,
    planHoverBoarding: (to: HoverPark, escort?: boolean) => planHoverBoarding(ch, to, escort),
    hoverRideState: () => hoverRideState(ch),
    flightClear,
    pickDeparture,
    townSolids,
    townWalk,
    nearTram,
    hoverBlocked,
    propBlocked,
  }
}
