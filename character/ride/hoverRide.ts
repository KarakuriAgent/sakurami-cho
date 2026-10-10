import * as THREE from 'three'
import type { SeatSpec } from '../avatar/body'
import { groundHeight } from '../avatar/locomotion'
import type { Character, CharacterMotion } from '../avatar/character'
import { HOVER_DOCKS, type HoverDock, type HoverDockId } from '../../core/hoverDocks'
import { zoneOfPoint } from '../../core/interiors'
import { SITE } from '../../core/town'
import { outdoor } from '../../world/environment/daylight'
import { transitClock } from '../../world/outdoor/transit/clock'
import { hoverCraft, hoverHome, hoverVehicle, parkedMatrix } from '../../world/outdoor/transit/hoverCraft'
import type { Car } from '../../world/outdoor/transit/vehicle'
import { townData } from '../../world/outdoor/town/townData'
import { HOVER } from '../../world/outdoor/transit/hoverCar'
import { droneOnLane, LANE_OFFSET, LANE_SPEED, laneNet, type LaneTrack } from '../../world/outdoor/transit/lanes'
import { TRACK_HALF, tramNet, tramOccupies, type TramLine } from '../../world/outdoor/transit/trams'
import { pathPoint } from '../../world/outdoor/transit/transitData'
import { townEvents } from '../../world/townHost'
import { townSolids } from '../../world/walk/townSolids'
import { townWalk } from '../../world/walk/townWalk'
import { waitViews, type PlatformView } from './platformViews'
import { setRiderCar } from './rider'
import { defineMemberSlots, updateParty } from './party'
import { makePath, pathAt, walkPath, type Path } from './walk'
import { advanceBy, cancelWarp, type RideTime } from './warp'

/**
 * 花音のホバーの一人乗りに乗る（kanon.travel の via=hover。docs/design/town.md §21・§7 の 211〜）。
 *
 * 人が乗るホバーは浮遊機器法（単独で動くロボット・機器の決まり）の対象外の乗り物として扱う（ユーザーの決定）。町の中は浮遊レーンの上を、
 * レーンの高さ（地上 5m 以下）で、配送の浮遊機と同じ速さ（4.5 m/s）・同じ左側を飛ぶ。時刻表は無い。
 *
 *   1. 乗る（board）: 乗り場の台に置いたホバーの横（乗り降りする側）から床板へ上がり、前を向いて鞍に腰掛け、ハンドルを握る
 *   2. 回す（power）: ファンを回す（2 秒）。レーンの配送機と近づかない時刻まで待つ（合流待ち。待つ時間の扱い wait）
 *   3. 浮き上がる（lift）: 台からレーンの高さ・左側の列へ、3〜4 秒の弧で上がり、そのままレーンの速さに
 *   4. 飛ぶ（cruise）: レーンの線に沿って（乗っている間の時間の扱い ride）。向かいから来る配送機とは右側ですれ違う
 *   5. 下りる（descend）: 行き先の乗り場の台へ 3〜4 秒の弧で下りて止まる（land）。ファンを止める
 *   6. 降りる（alight）: 立って、乗り降りする側へ床板から下りる。ホバーはその台に置いたまま（次に乗るまで）
 * 一緒に乗る仲間（KB-001。character/ride/party.ts）は乗らずに、ホバーの左（レーンの外の側。向かいの配送機と反対）の少し前を、花音の肩より上の高さで並んで飛ぶ。
 * 経路は、乗る人の仲間に浮かぶ仲間がいれば、並走する所も町の木・建物にかからないように選ぶ（planFlight の escort）。
 * ホバーの位置は交通の時計（運転の日の秒）だけから決まる（早送り・カットでも、配送機と同じ時計で動く）。
 * 機体（置いてある乗り場・行列・ファンの回り・灯り）は地図の側（world/outdoor/transit/hoverCraft.ts）で、ここが 1 コマ 1 回書く（ホバーは 1 台。
 * 乗る仕組みの状態は乗る人ごと（ch.rides.hover）だが、機体を書くのは最後に乗り始めた人（hoverUser）の更新だけ。まだ誰も乗っていない間は、
 * updateRiders（riders.ts）が乗る人の更新の前に置いてある姿を書く（updateParkedHover）。持ち主ごとの機体と、機体を地図が動かす形にするのは段 5）。
 * 回し始めた・台に着いたは地図の出来事（townEvents の hover.spinUp・hover.land）で知らせる（音の合図は使う側が鳴らす）。
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
const _pp = pathPoint()

/** レーンの上の速さ（配送機と同じ） */
const CRUISE = LANE_SPEED
/** ファンを回してから浮き上がれるまで・止まってからファンを止めるまで（秒） */
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

/* -------------------------------------------------------------------------- */
/* 飛ぶ道（浮き上がる弧・レーン・下りる弧）と時間                                          */
/* -------------------------------------------------------------------------- */

interface FlightSample {
  /** シーンの位置（ホバーの原点）・進む向き（水平の heading）・道のりの長さ */
  p: THREE.Vector3
  heading: number
  s: number
}

export interface HoverFlight {
  from: HoverDock
  to: HoverDock
  lane: LaneTrack
  /** レーンの長さの増える向きに進むか（+1 / −1）と、レーンへ入る所の長さ */
  dir: 1 | -1
  dM: number
  pts: FlightSample[]
  /** 浮き上がる弧・レーン・下りる弧の長さと秒 */
  liftLen: number
  cruiseLen: number
  descLen: number
  liftSec: number
  cruiseSec: number
  descSec: number
  total: number
  /** 道の上で、地面・建物・木に近すぎた所の数（確かめ用。escort = 並走する所がかかった所。並走の場所を空けない道では数えない） */
  clearance: { low: number; blocked: number; minAbove: number; maxAbove: number; escort: number; tram: number }
  /** 並走する仲間の場所を空けた道か */
  escort: boolean
  /** 町の木・建物をよけて決めた道か（町のタイルを全部読む前は、よけない道で時間だけ見積もる） */
  avoided: boolean
  /** 緑電の線路を横切る所（道のりの長さ s・系統・線の上の長さ d・線からの横のずらし lat） */
  tramCross: { s: number; line: TramLine; d: number; lat: number }[]
}

/** 3 次ベジェの点の列 */
function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, n: number) {
  const out: THREE.Vector3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = (1 - t) ** 3
    const b = 3 * (1 - t) ** 2 * t
    const c = 3 * (1 - t) * t * t
    const d = t ** 3
    out.push(new THREE.Vector3(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y, a * p0.z + b * p1.z + c * p2.z + d * p3.z))
  }
  return out
}

/**
 * レーンの長さ d の点（シーン）と進む向き（シーンの x, z の単位ベクトル）。off = 進む向きの左へのずらし（配送機と同じ左側の列は LANE_OFFSET）。
 * 高さはレーンの線のまま（別に決める）
 */
function lanePoint(lane: LaneTrack, d: number, dir: 1 | -1, out: THREE.Vector3, tangent: THREE.Vector3, off = LANE_OFFSET) {
  lane.path.at(d, _pp)
  const tx = _pp.dx * dir
  const ty = _pp.dy * dir
  // 進む向きの左（配送機と同じ。町の平面で (−ty, tx)）
  const x = _pp.x - ty * off
  const y = _pp.y + tx * off
  tangent.set(tx, 0, -ty)
  return out.set(x, _pp.z - SITE.labFloorElevation, -y)
}

/**
 * ホバー（と花音の体・左に並ぶ仲間）の場所が、町の建物・木（葉と幹）・石段のわきの擁壁にかかるか。y = ホバーの原点、(nx, nz) = 進む向きの左
 * （並走する仲間の場所も見るとき。0, 0 ならホバーと花音だけ）
 */
function hoverBlocked(x: number, y: number, z: number, nx = 0, nz = 0) {
  return !!(
    townSolids.blocker(x, y + 0.45, z, 0.45) ||
    townSolids.blocker(x, y + 1.05, z, 0.45) ||
    townSolids.blocker(x, y + 1.62, z, 0.32) ||
    ((nx || nz) && townSolids.blocker(x + nx * ESCORT_LOCAL.x, y + ESCORT_LOCAL.y, z + nz * ESCORT_LOCAL.x, 0.25))
  )
}

/**
 * 緑電の線路の真ん中の線（複線の間）の索引（平面。8m の升目）。ホバーは、編成（線路の真ん中から ±1.75m の線路の上の幅 2.4m）と、線路の上の
 * 架線（地上 5.4m。花音の頭は地上 5m ほど）から横へ 2m 離れる（浮遊レーン条例 5「緑電の架線から 2m 以上」）: 真ん中の線から TRAM_CLEAR m の内には入らない
 */
const TRAM_CLEAR = TRACK_HALF + 2.0 + 0.33 + 0.3
let tramGrid: Map<number, number[]> | null = null
let tramSegs: number[] = []
function nearTram(x: number, z: number) {
  const lines = tramNet.lines
  if (!lines?.length) return false
  if (!tramGrid) {
    tramGrid = new Map()
    tramSegs = []
    for (const l of lines) {
      const P = l.path
      for (let i = 1; i < P.x.length; i += 1) {
        const id = tramSegs.length / 4
        tramSegs.push(P.x[i - 1], P.y[i - 1], P.x[i], P.y[i])
        for (let gx = Math.floor((Math.min(P.x[i - 1], P.x[i]) - TRAM_CLEAR) / 8); gx <= Math.floor((Math.max(P.x[i - 1], P.x[i]) + TRAM_CLEAR) / 8); gx++)
          for (let gy = Math.floor((Math.min(P.y[i - 1], P.y[i]) - TRAM_CLEAR) / 8); gy <= Math.floor((Math.max(P.y[i - 1], P.y[i]) + TRAM_CLEAR) / 8); gy++) {
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
    if (Math.hypot(px - ax - dx * t, py - ay - dy * t) < TRAM_CLEAR) return true
  }
  return false
}

/**
 * よける道の横のずらし（進む向きの左が +。m）と高さの上げ（m）の候補: −1.2〜+6.0m。ふだんは浮遊レーンの通り道（枝を払った幅 ±2.1m。
 * world/walk/laneCorridor.ts）の内、左側の列（+1.2m）。緑電の通りの上を通る所（丘レーンの 1.5km ほど）は、架線から 2m 離れる歩道の側の上へ
 */
const AVOID_OFF = Array.from({ length: 25 }, (_, i) => -1.2 + i * 0.3)
const AVOID_UP = [0, 0.5, 1.0]

/**
 * 町の木（レーンの多くは街路樹の並びの上を通る。葉は地上 2.5〜3.5m から上）・建物の角をよける（§7 の 214）: レーンの真ん中から −2.4〜+4.2m 横へ、
 * 0〜1m 上へずらす道を、1m ごとの動的計画法で選ぶ（左側の列 +1.2m・レーンの高さにいるほどよく、向かいの列（−）は避け、1m に 0.3m より大きく横へ動かない）。
 * 選んだ道を前後 6m でならし、ならした所がかかるなら、そこは選んだ道のまま。centers = 真ん中の点、normals = 左の向き、base = 高さ、top = 高さの上限、
 * escort = 左に並ぶ仲間の場所も空ける
 */
function avoidObstacles(centers: THREE.Vector3[], normals: THREE.Vector3[], base: number[], top: number[], escort: boolean) {
  const n = centers.length
  const NO = AVOID_OFF.length
  const NU = AVOID_UP.length
  const pref = AVOID_OFF.findIndex((o) => Math.abs(o - LANE_OFFSET) < 0.01)
  const at = (i: number, o: number, u: number) => {
    const x = centers[i].x + normals[i].x * o
    const z = centers[i].z + normals[i].z * o
    const y = base[i] + u
    // 横へずらした所の地面からも 2.5m 以上（坂の横の斜面）。緑電の編成・架線から離れる
    if (y - townWalk.groundY(x, z, y, false) < 2.45 || nearTram(x, z)) return true
    return escort ? hoverBlocked(x, y, z, normals[i].x, normals[i].z) : hoverBlocked(x, y, z)
  }
  // 左側の列のままでかかる所と、その前後 24m だけ全部の候補を確かめる
  tramGrid = null
  const prefBlocked = centers.map((_, i) => at(i, LANE_OFFSET, 0))
  const near = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (prefBlocked[i]) for (let j = Math.max(0, i - 24); j <= Math.min(n - 1, i + 24); j++) near[j] = 1
  const S = NO * NU
  const blocked = new Uint8Array(n * S)
  for (let i = 0; i < n; i++) {
    if (!near[i]) continue
    for (let o = 0; o < NO; o++) for (let u = 0; u < NU; u++) blocked[i * S + o * NU + u] = base[i] + AVOID_UP[u] > top[i] || at(i, AVOID_OFF[o], AVOID_UP[u]) ? 1 : 0
  }
  const stateCost = (i: number, o: number, u: number) => {
    const off = AVOID_OFF[o]
    // 通り道（枝を払った幅）の外は、葉が当たりの形に残るので、当たらなければ通ってよい（少し高くつく）
    let c = 0.6 * Math.abs(off - LANE_OFFSET) + 1.6 * AVOID_UP[u] + (off < 0 ? 2 + -off * 2 : 0) + (off > 1.5 ? 1.5 + (off - 1.5) * 0.4 : 0)
    if (blocked[i * S + o * NU + u]) c += 1000
    return c
  }
  const cost = new Float64Array(n * S).fill(Infinity)
  const from = new Int32Array(n * S).fill(-1)
  for (let o = 0; o < NO; o++) for (let u = 0; u < NU; u++) cost[o * NU + u] = stateCost(0, o, u) + (o === pref && u === 0 ? 0 : 50)
  for (let i = 1; i < n; i++) {
    for (let o = 0; o < NO; o++)
      for (let u = 0; u < NU; u++) {
        const sc = stateCost(i, o, u)
        let best = Infinity
        let arg = -1
        for (let po = Math.max(0, o - 1); po <= Math.min(NO - 1, o + 1); po++)
          for (let pu = Math.max(0, u - 1); pu <= Math.min(NU - 1, u + 1); pu++) {
            const c = cost[(i - 1) * S + po * NU + pu] + (po !== o ? 0.15 : 0) + (pu !== u ? 0.4 : 0)
            if (c < best) {
              best = c
              arg = po * NU + pu
            }
          }
        cost[i * S + o * NU + u] = best + sc
        from[i * S + o * NU + u] = arg
      }
  }
  // 終わりは左側の列・レーンの高さへ戻す（下りる弧につなぐ）
  let st = pref * NU
  let bestEnd = cost[(n - 1) * S + st]
  for (let k = 0; k < S; k++) if (cost[(n - 1) * S + k] + 50 < bestEnd) {
    bestEnd = cost[(n - 1) * S + k] + 50
    st = k
  }
  const offs = new Float64Array(n)
  const ups = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    offs[i] = AVOID_OFF[Math.floor(st / NU)]
    ups[i] = AVOID_UP[st % NU]
    if (i > 0) st = from[i * S + st]
  }
  // 前後 6m でならす（ならした所がかかるなら、そこは選んだ道のまま）
  const K = 6
  const so = new Float64Array(n)
  const su = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let a = 0
    let b = 0
    let w = 0
    for (let k = -K; k <= K; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k))
      const wk = 1 - Math.abs(k) / (K + 1)
      a += offs[j] * wk
      b += ups[j] * wk
      w += wk
    }
    so[i] = a / w
    su[i] = b / w
    if (near[i] && at(i, so[i], su[i]) && !at(i, offs[i], ups[i])) {
      so[i] = offs[i]
      su[i] = ups[i]
    }
  }
  return { offs: so, ups: su }
}

/** レーンの高さを、地面から 2.6〜4.6m に収めて、前後 12m でならした高さの列（d0 → d1 を 1m ごと）と、高さの上限（地上 4.95m） */
function cruiseHeights(lane: LaneTrack, d0: number, d1: number, dir: 1 | -1) {
  const n = Math.max(2, Math.ceil(Math.abs(d1 - d0)))
  const raw: number[] = []
  const lo: number[] = []
  const top: number[] = []
  for (let i = 0; i <= n; i++) {
    const d = d0 + ((d1 - d0) * i) / n
    lanePoint(lane, d, dir, _v, _dir)
    const g = townWalk.groundY(_v.x, _v.z, _v.y, false)
    // 道の上の橋・高架の下を通る所は、下の面（今の高さに近い面）から
    lo.push(g + 2.6)
    top.push(g + 4.95)
    raw.push(THREE.MathUtils.clamp(_v.y, g + 2.6, g + 4.6))
  }
  const K = 12
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    let sum = 0
    let w = 0
    for (let k = -K; k <= K; k++) {
      const j = Math.min(n, Math.max(0, i + k))
      const wk = 1 - Math.abs(k) / (K + 1)
      sum += raw[j] * wk
      w += wk
    }
    // ならしても、地面から 2.5m より下にはしない（人の頭の上は 2.5m 以上。浮遊レーン条例 3）
    out.push(Math.max(sum / w, lo[i] - 0.1))
  }
  return { heights: out, top }
}

/**
 * 乗り場 from から to へ飛ぶ道（同じレーンの上だけ）。avoid = 町の木・建物をよける（重い。乗るときだけ）、escort = 左に並走する仲間の場所も空ける
 * （乗る人の仲間に浮かぶ仲間がいるとき。character/ride/party.ts の partyEscorts）。だめなら理由
 */
export function planFlight(from: HoverDock, to: HoverDock, avoid = false, escort = true): HoverFlight | string {
  if (from.lane !== to.lane) return `${from.label}と${to.label}は別の浮遊レーンです（レーンを乗り継ぐのは、まだできません）`
  const lane = laneNet.byId.get(from.lane)
  if (!lane || !townWalk.ready) return '浮遊レーンのデータがまだありません（町のデータを読み込み中）'
  const pa = parkedMatrix(from, new THREE.Matrix4())
  const pb = parkedMatrix(to, new THREE.Matrix4())
  const A = new THREE.Vector3().setFromMatrixPosition(pa)
  const B = new THREE.Vector3().setFromMatrixPosition(pb)
  const sa = lane.path.project(A.x, -A.z).d
  const sb = lane.path.project(B.x, -B.z).d
  const dir: 1 | -1 = sb >= sa ? 1 : -1
  // レーンへ入る所・出る所（台から前後 9m）
  const MERGE = 9
  const dM = THREE.MathUtils.clamp(sa + dir * MERGE, 0, lane.path.length)
  const dN = THREE.MathUtils.clamp(sb - dir * MERGE, 0, lane.path.length)
  if ((dN - dM) * dir < 5) return `${from.label}と${to.label}は近すぎます（歩いてください）`
  const { heights, top } = cruiseHeights(lane, dM, dN, dir)
  const n = heights.length - 1
  const cruise: THREE.Vector3[] = []
  const tangents: THREE.Vector3[] = []
  const centers: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []
  for (let i = 0; i <= n; i++) {
    const t = new THREE.Vector3()
    const c = lanePoint(lane, dM + ((dN - dM) * i) / n, dir, new THREE.Vector3(), t, 0)
    c.y = heights[i]
    centers.push(c)
    tangents.push(t)
    // 進む向きの左（シーン）: 平面の (−ty, tx) → シーン (−ty, −tx)。t はシーンの (tx, 0, −ty)
    normals.push(new THREE.Vector3(t.z, 0, -t.x))
  }
  const av = avoid ? avoidObstacles(centers, normals, heights, top, escort) : null
  for (let i = 0; i <= n; i++) cruise.push(centers[i].clone().addScaledVector(normals[i], av ? av.offs[i] : LANE_OFFSET).setY(heights[i] + (av ? av.ups[i] : 0)))
  const M = cruise[0]
  const TM = tangents[0]
  const N = cruise[n]
  const TN = tangents[n]
  // 浮き上がる弧: まっすぐ上へ 1.6m、それからレーンの向きへ
  const lift = bezier(A, A.clone().add(_v.set(0, 1.7, 0)).addScaledVector(_d.subVectors(M, A).setY(0).normalize(), 0.6), M.clone().addScaledVector(TM, -4.2), M, 40)
  const desc = bezier(N, N.clone().addScaledVector(TN, 4.2), B.clone().add(_v.set(0, 1.7, 0)).addScaledVector(_d.subVectors(N, B).setY(0).normalize(), 0.6), B, 40)
  // 道のりの長さ s: 弧は弧の長さ、レーンの上はレーンの線の長さ（配送機と同じレーンの長さで進むので、同じ向きの配送機との間が変わらない。
  // 木をよけて横へずれた所・曲がり角の内と外で、ホバーの道の長さとレーンの長さが少し違う）
  const pts: FlightSample[] = []
  const push = (p: THREE.Vector3, s: number) => {
    const last = pts[pts.length - 1]
    if (last && s - last.s < 1e-4) return
    pts.push({ p: p.clone(), heading: 0, s })
  }
  let acc = 0
  for (let i = 0; i < lift.length; i++) {
    if (i > 0) acc += lift[i].distanceTo(lift[i - 1])
    push(lift[i], acc)
  }
  const liftLen = acc
  const step = Math.abs(dN - dM) / n
  for (let i = 1; i <= n; i++) push(cruise[i], liftLen + i * step)
  const cruiseLen = Math.abs(dN - dM)
  acc = liftLen + cruiseLen
  for (let i = 1; i < desc.length; i++) {
    acc += desc[i].distanceTo(desc[i - 1])
    push(desc[i], acc)
  }
  const total = acc
  const descLen = total - liftLen - cruiseLen
  // 向き: 水平に動く向き（真上・真下へ動く所は、台に置いた向きから・台に置く向きへなめらかに）
  const fromH = from.heading
  const toH = to.heading
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)].p
    const b = pts[Math.min(pts.length - 1, i + 1)].p
    const dx = b.x - a.x
    const dz = b.z - a.z
    const hz = Math.hypot(dx, dz)
    const move = Math.atan2(dx, dz)
    const s = pts[i].s
    // 台の近く（弧の始め 35%・終わり 35%）は台の向きから回す
    const kFrom = THREE.MathUtils.smoothstep(s, liftLen * 0.15, liftLen * 0.75)
    const kTo = THREE.MathUtils.smoothstep(total - s, descLen * 0.15, descLen * 0.75)
    let h = hz > 1e-3 ? move : i > 0 ? pts[i - 1].heading : fromH
    h = lerpAngle(fromH, h, kFrom)
    h = lerpAngle(toH, h, kTo)
    pts[i].heading = h
  }
  const liftSec = THREE.MathUtils.clamp((1.3 * liftLen) / CRUISE, 3.0, 4.2)
  const descSec = THREE.MathUtils.clamp((1.3 * descLen) / CRUISE, 3.0, 4.2)
  const cruiseSec = cruiseLen / CRUISE
  // 地面・建物・木からの近さ（確かめ用）
  const clearance = { low: 0, blocked: 0, minAbove: Infinity, maxAbove: -Infinity, escort: 0, tram: 0 }
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i].p
    const g = townWalk.groundY(p.x, p.z, p.y, false)
    const above = p.y - g
    const inCruise = pts[i].s > liftLen && pts[i].s < liftLen + cruiseLen
    if (inCruise) {
      clearance.minAbove = Math.min(clearance.minAbove, above)
      clearance.maxAbove = Math.max(clearance.maxAbove, above)
      if (above < 2.4) clearance.low++
    }
    if (hoverBlocked(p.x, p.y, p.z)) clearance.blocked++
    if (inCruise && nearTram(p.x, p.z)) clearance.tram++
    else if (escort && inCruise && townSolids.blocker(p.x + Math.cos(pts[i].heading) * ESCORT_LOCAL.x, p.y + ESCORT_LOCAL.y, p.z - Math.sin(pts[i].heading) * ESCORT_LOCAL.x, 0.2)) clearance.escort++
  }
  // 緑電の線路を横切る所（レーンの上。前後 3m ごと）
  const tramCross: HoverFlight['tramCross'] = []
  for (let i = 0; i < pts.length; i += 3) {
    const p = pts[i].p
    const sp = pts[i].s
    if (sp < liftLen || sp > liftLen + cruiseLen || !nearTram(p.x, p.z)) continue
    for (const line of tramNet.lines ?? []) {
      const pr = line.path.project(p.x, -p.z)
      if (pr.dist > TRAM_CLEAR + 1) continue
      line.path.at(pr.d, _pp)
      const lat = (p.x - _pp.x) * -_pp.dy + (-p.z - _pp.y) * _pp.dx
      tramCross.push({ s: sp, line, d: pr.d, lat })
    }
  }
  return { from, to, lane, dir, dM, tramCross, pts, liftLen, cruiseLen, descLen, liftSec, cruiseSec, descSec, total: liftSec + cruiseSec + descSec, clearance, avoided: avoid, escort }
}

const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k

/** 出てから tau 秒の、道のりの長さと速さ（浮き上がる弧は 0 → レーンの速さ、下りる弧はレーンの速さ → 0。3 次のエルミート） */
function distAt(f: HoverFlight, tau: number): { s: number; v: number } {
  if (tau <= 0) return { s: 0, v: 0 }
  if (tau < f.liftSec) {
    const u = tau / f.liftSec
    const s = f.liftLen * (3 * u * u - 2 * u * u * u) + CRUISE * f.liftSec * (u * u * u - u * u)
    const v = (f.liftLen * (6 * u - 6 * u * u) + CRUISE * f.liftSec * (3 * u * u - 2 * u)) / f.liftSec
    return { s, v }
  }
  const t2 = tau - f.liftSec
  if (t2 < f.cruiseSec) return { s: f.liftLen + t2 * CRUISE, v: CRUISE }
  const t3 = t2 - f.cruiseSec
  if (t3 < f.descSec) {
    const u = t3 / f.descSec
    // s(0) = 0, s'(0) = v, s(1) = L, s'(1) = 0
    const s = CRUISE * f.descSec * (u * u * u - 2 * u * u + u) + f.descLen * (3 * u * u - 2 * u * u * u)
    const v = (CRUISE * f.descSec * (3 * u * u - 4 * u + 1) + f.descLen * (6 * u - 6 * u * u)) / f.descSec
    return { s: f.liftLen + f.cruiseLen + s, v }
  }
  return { s: f.liftLen + f.cruiseLen + f.descLen, v: 0 }
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

/**
 * 出る時刻 t0（運転の日の秒）で飛ぶと、レーンの配送機と近づかないか: 同じ向きにレーンの上で前後 8m の内の配送機とは 4m、ほかの配送機とは 1.0m
 * （向かいの配送機とは、ふだんは 2.4m、木の幹をよけてレーンの真ん中を飛ぶ所では 1.2m 離れてすれ違う。つづら折りではとなりの列の配送機が近くを通る）。
 * 0.5 秒ごとに確かめる
 */
function flightClear(f: HoverFlight, t0: number, why?: { tau: number; s: number; k: number; same: boolean; d: number }) {
  const lane = f.lane
  // 緑電の線路を横切るとき、編成がそこにいない（前後と横に 1.5m の余白）
  for (const c of f.tramCross) {
    const tau = f.liftSec + (c.s - f.liftLen) / CRUISE
    if (tramOccupies(c.line, t0 + tau, c.d, c.lat, 1.5)) {
      if (why) Object.assign(why, { tau, s: c.s, k: -1, same: false, d: 0 })
      return false
    }
  }
  for (let tau = 0; tau <= f.total; tau += 0.5) {
    const { s } = distAt(f, tau)
    sampleAt(f, s, _w)
    const sec = (t0 + tau) % 86400
    // ホバーのレーンの上の長さ（弧の間は入る所・出る所）
    const dh = f.dM + f.dir * THREE.MathUtils.clamp(s - f.liftLen, 0, f.cruiseLen)
    for (let k = 0; k < lane.n; k++) {
      const dr = droneOnLane(lane, k, sec, _v)
      if (Math.abs(_v.x - _w.x) > 4 || Math.abs(_v.z - _w.z) > 4) continue
      const d = _v.distanceTo(_w)
      // 同じ向きにレーンの上で前後 8m の内（追いつく・追いつかれる）か、どの配送機とも 1.0m より近い（すれ違い・つづら折りのとなりの列）
      const same = dr.back === f.dir && Math.abs(dr.d - dh) < 8
      if (d < (same ? 4 : 1.0)) {
        if (why) Object.assign(why, { tau, s, k, same, d })
        return false
      }
    }
  }
  return true
}

/**
 * 時刻 base（運転の日の秒）から 0.5 秒ごとに、配送機と近づかず・緑電の編成と重ならずに出られる時刻を探す（1 コマに 10 個まで。1 個 2ms ほど）。
 * 見つかればその時刻、まだなら null（次のコマに続ける）。2 分の内に無ければ base
 */
function searchDeparture(ctl: HoverRide, f: HoverFlight) {
  for (let k = 0; k < 10; k++) {
    if (ctl.searchDt > 120) return ctl.searchBase
    if (flightClear(f, ctl.searchBase + ctl.searchDt)) return ctl.searchBase + ctl.searchDt
    ctl.searchDt += 0.5
  }
  return null
}
function pickDeparture(ctl: HoverRide, f: HoverFlight, now: number, lead: number) {
  ctl.searchBase = now + lead
  ctl.searchDt = 0
  let r: number | null = null
  while (r === null) r = searchDeparture(ctl, f)
  return r
}

/* -------------------------------------------------------------------------- */
/* 状態                                                                         */
/* -------------------------------------------------------------------------- */

export interface HoverRideSpec {
  from: HoverDockId
  to: HoverDockId
  wait: RideTime
  ride: RideTime
  fastSec: number | null
  fastSpeed: number | null
}

type Step = 'idle' | 'board' | 'turn' | 'settle' | 'power' | 'fly' | 'land' | 'stand' | 'out' | 'done' | 'failed'

/** ホバーに乗る仕組みの状態（Character ごと。ch.rides.hover。character/ride/rides.ts が作る） */
export function createHoverRide(ch: Character) {
  return {
    /** 乗る人（この仕組みの持ち主） */
    ch,
    /** ホバーの車室（Car。ホバーは 1 台なので便 0 の 1 つ） */
    cabin: null as Car | null,
    spec: null as HoverRideSpec | null,
    step: 'idle' as Step,
    dock: null as HoverDock | null,
    flight: null as HoverFlight | null,
    /** 出る時刻（運転の日の秒）・回し始めたシーンの時計・止まったシーンの時計 */
    depart: 0,
    /** 出る時刻を探す途中（探し始めた時刻と、次に確かめるずれ。-1 = 探していない） */
    searchBase: 0,
    searchDt: -1,
    upCued: false,
    powerAt: 0,
    landAt: 0,
    t: 0,
    path: null as Path | null,
    waitDone: false,
    rideDone: false,
    /** 浮く前（回す間）にやめて、乗った台で降りる（下りる・降りる段の台は行き先でなく乗った台） */
    stayed: false,
    placeSerial: -1,
    first: true,
    error: null as string | null,
    /** 乗り込みで床板の上へ乗った・降りるときに床板から下りた（出来事 ride.enter・ride.exit を出した） */
    entered: false,
    exited: false,
  }
}
export type HoverRide = ReturnType<typeof createHoverRide>

/** 機体を書く人（最後に乗り始めた人。ホバーは 1 台なので 1 人。まだ誰も乗っていなければ null で、その間は updateRiders が updateParkedHover で書く） */
let hoverUser: Character | null = null

/** 今の様子（状態の返送） */
export function hoverRideState(ch: Character) {
  const ctl = ch.rides.hover
  if (ctl.step === 'idle') return null
  const now = transitClock.serviceSec
  const f = ctl.flight
  return {
    step: ctl.step,
    from: ctl.spec ? HOVER_DOCKS[ctl.spec.from].label : null,
    to: ctl.spec ? HOVER_DOCKS[ctl.spec.to].label : null,
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
   * 町の中の移動が取り消された: まだ腰掛けていなければやめる。回している間（浮く前）なら、ファンを止めて乗った台で降りる（合流待ちの
   * 早送り・カットもやめる）。飛んでいる途中なら、着いて降りるまで続ける
   */
  cancel(ch: Character) {
    const ctl = ch.rides.hover
    if (ctl.step === 'board' || ctl.step === 'turn' || ctl.step === 'settle') reset(ctl, true)
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

/** 乗る便（乗り場の台の横の待つ所と、飛ぶ道）。だめなら理由 */
export interface HoverBoardingPlan {
  from: HoverDockId
  to: HoverDockId
  flight: HoverFlight
  /** 乗り降りする横の地面の所（シーンの x, z）と、そこで向く向き */
  spot: [number, number]
  heading: number
}

/** 乗る便を決める（escort = 並走する仲間の場所を空ける。乗る人の仲間に浮かぶ仲間がいるか: character/ride/party.ts の partyEscorts） */
export function planHoverBoarding(from: HoverDockId, to: HoverDockId, escort = true): HoverBoardingPlan | string {
  if (hoverHome.at !== from) return `ホバーは${HOVER_DOCKS[hoverHome.at].label}に置いてあります（${HOVER_DOCKS[from].label}ではありません）`
  const d = HOVER_DOCKS[from]
  // 町の木・建物をよける道は、町のタイルを全部読んでから（まだなら、回して待つ間に決め直す）
  townData.loadAllTiles()
  const f = planFlight(d, HOVER_DOCKS[to], townData.allTilesLoaded(), escort)
  if (typeof f === 'string') return f
  const m = parkedMatrix(d, new THREE.Matrix4())
  const p = new THREE.Vector3(d.side * SIDE_X, 0, STAND_Z).applyMatrix4(m)
  // 横の所でホバーの方（床板の方）を向く
  return { from, to, flight: f, spot: [p.x, p.z], heading: d.heading + (d.side > 0 ? -Math.PI / 2 : Math.PI / 2) }
}

/** 乗るのを始める（花音は乗り場の台の横に着いている） */
export function beginHoverRide(ch: Character, spec: HoverRideSpec, plan: HoverBoardingPlan) {
  const ctl = ch.rides.hover
  // 機体を書くのはこの人（乗り始める前の止め直しから）
  hoverUser = ch
  reset(ctl, false)
  ctl.spec = spec
  ctl.dock = HOVER_DOCKS[spec.from]
  ctl.flight = plan.flight
  ctl.placeSerial = ch.motion.placeSerial
  ctl.cabin = hoverVehicle.car(0)
  setRiderCar(ch.ride, ctl.cabin)
  ch.ride.phase = 'board'
  ctl.first = true
  updatePose(ctl, 0)
  // 横の地面の所 → 床板の縁 → 立つ所（局所）
  const s = ctl.dock.side
  const p0 = ctl.cabin.toCabin(ch.motion.position, new THREE.Vector3())
  ctl.path = makePath([new THREE.Vector3(p0.x, 0, p0.z), new THREE.Vector3(s * 0.5, 0, STAND_Z), new THREE.Vector3(0, 0, STAND_Z)])
  ctl.path.speed = 0
  ctl.step = 'board'
  ctl.entered = false
  const m = ch.motion
  m.stopId = null
  m.targetId = null
  m.activityHeld = false
  m.seat = null
  m.action = 'present'
  // ホバーは待たない（乗る機体が決まって、すぐ乗り込み始める）
  ch.events.emit('ride.wait', ctl.cabin)
  ch.events.emit('ride.board', ctl.cabin)
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
  cancelWarp(ctl.ch)
  if (car) ctl.ch.events.emit('ride.cancel', car)
}

function reset(ctl: HoverRide, stopRider: boolean) {
  const r = ctl.ch.ride
  ctl.spec = null
  ctl.step = 'idle'
  ctl.flight = null
  ctl.path = null
  ctl.error = null
  ctl.depart = 0
  ctl.searchDt = -1
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
  if (hoverUser === ctl.ch) {
    hoverCraft.power = 0
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
/* 毎コマ（updateRiders。交通の時計を進めたあと・花音を動かす前）                          */
/* -------------------------------------------------------------------------- */

/**
 * 今のコマのホバーの行列（飛んでいる間は道の上、ほかは置いてある乗り場）。機体を書く人（hoverUser）の分だけ書く。
 * ctl = null は誰も乗っていない間（updateRiders の updateParkedHover。置いてある乗り場 hoverHome.at）
 */
function updatePose(ctl: HoverRide | null, dt: number) {
  if (ctl && hoverUser !== ctl.ch) return
  const f = ctl?.flight
  const now = transitClock.serviceSec
  let speed = 0
  let tilt = 0
  let bank = 0
  let bob = 0
  if (ctl && f && ctl.step === 'fly') {
    const tau = now - ctl.depart
    const { s, v } = distAt(f, tau)
    const h = sampleAt(f, s, _pt)
    // 前後の傾き（速さの変わり方と上り下り）・曲がるときの横の傾き（向きの変わり方）
    const a = distAt(f, tau + 0.25)
    sampleAt(f, a.s, _w)
    const ha = sampleAt(f, Math.min(f.pts[f.pts.length - 1].s, s + Math.max(1.5, v * 0.6)), _d)
    const climb = (_w.y - _pt.y) / 0.25
    tilt = THREE.MathUtils.clamp(-(a.v - v) * 0.04 - climb * 0.012, -0.06, 0.05)
    bank = THREE.MathUtils.clamp(-Math.atan2(Math.sin(ha - h), Math.cos(ha - h)) * v * 0.05, -0.07, 0.07)
    speed = v
    // 浮いている間のわずかな上下（交通の時計で）
    bob = 0.025 * Math.sin(now * 1.9) * THREE.MathUtils.smoothstep(tau, 0.8, 2.5) * THREE.MathUtils.smoothstep(f.total - tau, 0.6, 2.0)
    _q.setFromEuler(_e.set(tilt, h, bank, 'YXZ'))
    _pt.y += bob
    hoverCraft.matrix.compose(_pt, _q, _s)
  } else {
    const d = !ctl || ctl.step === 'idle' || !ctl.spec ? HOVER_DOCKS[hoverHome.at] : ctl.step === 'land' || ctl.step === 'stand' || ctl.step === 'out' || ctl.step === 'done' ? alightDock(ctl) : HOVER_DOCKS[ctl.spec.from]
    if (!townWalk.ready) return
    parkedMatrix(d, hoverCraft.matrix)
    // ファンが回っている間は台からわずかに浮く（着く前・止める前）
    if (hoverCraft.power > 0.01) {
      const lift = 0.04 * hoverCraft.power + 0.008 * Math.sin(now * 2.3) * hoverCraft.power
      hoverCraft.matrix.elements[13] += lift
    }
  }
  hoverCraft.speed = speed
  hoverCraft.ready = true
  void dt
  if (!ctl) return
  const car = ctl.ch.ride.car
  if (car?.vehicle === hoverVehicle) {
    car.setPose(hoverCraft.matrix, ctl.first)
    ctl.first = false
  }
}

/** 降りる乗り場の台（ふだんは行き先。浮く前にやめたときは乗った台）。spec がある間だけ */
function alightDock(ctl: HoverRide) {
  return HOVER_DOCKS[ctl.stayed ? ctl.spec!.from : ctl.spec!.to]
}

/** 機体のファンの回り（回す・止める）と灯り（夜。回っている間）。機体を書く人の更新か、誰も乗っていない間の updateParkedHover から 1 コマ 1 回 */
function updatePower(spinning: boolean, dt: number) {
  hoverCraft.power += ((spinning ? 1 : 0) - hoverCraft.power) * (1 - Math.exp(-dt * (spinning ? 2.2 : 1.6)))
  if (hoverCraft.power < 1e-3) hoverCraft.power = 0
  const dark = 1 - THREE.MathUtils.smoothstep(outdoor.daylight, 0.08, 0.4)
  hoverCraft.lamp = Math.min(1, hoverCraft.power * 1.5) * dark
}

/**
 * 毎コマ（riders.ts の updateRiders。乗る人ごとの更新の前）: まだ誰も乗っていない間（hoverUser が null）の機体（置いてある乗り場・ファンは止まったまま）。
 * 乗る人の「乗っていない間」の分と同じ式
 */
export function updateParkedHover(delta: number) {
  if (hoverUser) return
  const dt = Math.min(delta, 0.1)
  updatePower(false, dt)
  updatePose(null, dt)
}

export function updateHoverRide(ch: Character, t: number, delta: number) {
  const ctl = ch.rides.hover
  const r = ch.ride
  ctl.t = t
  const dt = Math.min(delta, 0.1)
  // ファンの回り（回す・止める）と灯り（機体を書く人だけ）
  if (hoverUser === ch) updatePower(ctl.step === 'power' || ctl.step === 'fly' || (ctl.step === 'land' && t - ctl.landAt < SPIN_DOWN), dt)
  if (!hoverRide.active(ch)) {
    updatePose(ctl, dt)
    return
  }
  if (ch.motion.placeSerial !== ctl.placeSerial) {
    // 途中で別の所へ置き直された（kanon.place）: ホバーは今いる乗り場（飛んでいる途中なら行き先）に置く
    if (ctl.step === 'fly' && ctl.spec) hoverHome.at = ctl.spec.to
    reset(ctl, false)
    updatePose(ctl, dt)
    return
  }
  const spec = ctl.spec!
  const f = ctl.flight
  if (!f) {
    fail(ctl, 'ホバーの飛ぶ道がありません')
    return
  }
  const now = transitClock.serviceSec
  if (ctl.step === 'power') {
    // ファンを回し始めた（花音が腰掛けて回し始めたコマ。音の合図は使う側が鳴らす）
    if (!ctl.upCued) {
      ctl.upCued = true
      const p = hoverPos(_v)
      townEvents.emit('hover.spinUp', { x: p.x, y: p.y, z: p.z })
    }
    // 町のタイルを読み終えたら、町の木・建物をよける道に決め直す（読み終えるまで待つ。並走の場所を空けるかは、乗り始めたときの道のまま）
    if (!f.avoided && townData.allTilesLoaded()) {
      const nf = planFlight(f.from, f.to, true, f.escort)
      if (typeof nf === 'string') {
        fail(ctl, nf)
        return
      }
      ctl.flight = nf
    }
    // 回し始めて 2 秒（ファンが回りきる）たったら、配送機と近づかない出る時刻を決めて、それまで待つ（合流待ち）
    if (!ctl.depart && ctl.flight!.avoided && t - ctl.powerAt > SPIN_UP - 0.4) {
      if (ctl.searchDt < 0) {
        ctl.searchBase = now + 0.4
        ctl.searchDt = 0
      }
      const dep = searchDeparture(ctl, ctl.flight!)
      if (dep !== null) {
        ctl.depart = dep
        ctl.searchDt = -1
      }
    }
    if (ctl.depart && !ctl.waitDone) {
      ctl.waitDone = true
      if (spec.wait !== 'real' && ctl.depart - now > 3) advanceBy(ch, ctl.depart - 1.5 - now, spec.wait, spec.fastSec, spec.fastSpeed, 6)
    }
    if (ctl.depart && now >= ctl.depart) {
      ctl.step = 'fly'
      r.phase = 'riding'
    }
  } else if (ctl.step === 'fly') {
    const tau = now - ctl.depart
    // 飛ぶ間（浮き上がってレーンを 6 秒飛んだら、下り始める 6 秒前へ）
    if (!ctl.rideDone && tau > f.liftSec + 6) {
      ctl.rideDone = true
      const target = ctl.depart + f.liftSec + f.cruiseSec - 6
      if (spec.ride !== 'real' && target - now > 2) advanceBy(ch, target - now, spec.ride, spec.fastSec, spec.fastSpeed, 20)
    }
    if (tau >= f.total) {
      // 着いた: 台に置く。ファンを止める
      hoverHome.at = spec.to
      ctl.step = 'land'
      ctl.landAt = t
      const p = hoverPos(_v)
      townEvents.emit('hover.land', { x: p.x, y: p.y, z: p.z })
      // 台に着いた（並走していた仲間はここで離れる）
      ch.events.emit('ride.arrived', ctl.cabin!)
    }
  } else if (ctl.step === 'land') {
    if (t - ctl.landAt > SPIN_DOWN) {
      ctl.step = 'stand'
      r.phase = 'alight'
      ch.motion.activityHeld = false
      ch.motion.action = 'present'
      ch.events.emit('ride.alight', ctl.cabin!)
    }
  }
  updatePose(ctl, dt)
  updateParty(ch, ctl.cabin!, dt)
}

/** ホバーの今の位置（シーン。音の合図の出来事） */
function hoverPos(out: THREE.Vector3) {
  return out.setFromMatrixPosition(hoverCraft.matrix).add(_d.set(0, 0.3, 0))
}

/* -------------------------------------------------------------------------- */
/* 一緒に乗る仲間の道（ホバーの左の少し前に並んで飛ぶ。character/ride/party.ts。前の KB-001 の付き添いの式と数のまま） */
/* -------------------------------------------------------------------------- */

const _arrivalM = new THREE.Matrix4()

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
      speedNow: () => (ctl.step === 'fly' ? 4 : 2.6),
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
  /** 並走をやめる（台に着いた）: その場で離れる */
  leave: () => null,
  /** 降りて立つ所: 降りる乗り場の台（行き先。浮く前にやめたときは乗った台）に置いたホバーの、乗り降りする側の横の地面（ホバーと反対の方を向く） */
  arrival(leader, out) {
    const ctl = leader.rides.hover
    if (!ctl.spec) return null
    const d = alightDock(ctl)
    out.set(d.side * SIDE_X, 0, STAND_Z).applyMatrix4(parkedMatrix(d, _arrivalM))
    out.y = groundHeight(leader, out.x, out.z, false, out.y)
    return d.heading + (d.side > 0 ? Math.PI / 2 : -Math.PI / 2)
  },
})

/* -------------------------------------------------------------------------- */
/* 花音の動き（locomotion の中から）                                               */
/* -------------------------------------------------------------------------- */

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

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
  const s = ctl.dock?.side ?? 1
  const car = ctl.cabin!
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
      // 台の横の地面に下りた: 町の中の移動へ返す
      m.speed = 0
      m.phase = 'idle'
      r.phase = 'none'
      car.delta.set(0, 0, 0)
      setRiderCar(r, null)
      r.attach = 0
      ctl.step = 'done'
      r.serials.alight++
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
    // 立ち上がったら（腰掛けの姿勢がほどけたら）、乗り降りする側へ床板から下りる
    if (m.actionBlend < 0.25) {
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

/**
 * 乗っている間の自動カメラの画 i（ホバーと一緒に動く）: 0 = 外から追う（左後ろの斜め上）、1 = 横に並ぶ（左。KB-001 の外）、2 = 前から（進む先の
 * レーンの上。向かいの配送機とすれ違うのが見える）。町の建物・木・地面に入る・さえぎられるなら、外から追う画へ。どれもだめなら null
 */
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

/** 乗り場の台の横で乗り降りする間の自動カメラの画の候補（src/camera/rideViews.ts） */
export function hoverPlatformViews(ch: Character, _car: Car, out: PlatformView[]) {
  const ctl = ch.rides.hover
  out.length = 0
  if (ctl.step === 'idle' || !ctl.dock) return
  // 乗り場の台の横: ホバーの右前・左前・後ろの斜め（台の上の花音と、置いたホバーの全体）
  waitViews(ch.motion.position, ctl.dock.heading + (ctl.dock.side > 0 ? Math.PI / 2 : -Math.PI / 2), out)
}

/** 乗っている間の自動カメラの画 i（便 car のホバーと一緒に動く。src/camera/rideViews.ts） */
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
    // 置けないとき: すぐ後ろの上（浮遊レーンの通り道の中。枝を払った幅の内）
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
    // 町の建物・木の葉から 0.9m（画の手前に葉の塊が入らないように）・花音まで見通せる。通り道の外の画は、画の手前の縁も見る
    // すぐ後ろの上の画（通り道の中。通り道の壁の葉まで 0.9m ほど）は、0.5m
    const m = kk === 3 ? 0.5 : 0.9
    // （通り道の上は葉が残っているので、すぐ後ろの上の画は上を見ない）
    const b = townSolids.blocker(pos.x, pos.y, pos.z, m) ?? (kk === 3 ? null : townSolids.blocker(pos.x, pos.y + 0.7, pos.z, m - 0.3)) ?? townSolids.blocker(pos.x, pos.y - 0.7, pos.z, m - 0.3)
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
    droneOnLane,
    /** 仲間の今の位置（ホバーの局所）・段・行き先・付いて動く度合い */
    members: () => {
      const local = (p: THREE.Vector3) => (r.lastCar ? r.lastCar.toCabin(p, new THREE.Vector3()) : p.clone()).toArray().map((v) => +v.toFixed(2))
      return r.party.members.map((m) => ({ id: m.id, local: local(m.motion.position), mode: m.ride.member.mode, attach: +m.ride.attach.toFixed(2), target: local(m.ride.member.target) }))
    },
    ctl,
    hoverHome,
    hoverCraft,
    planFlight,
    planHoverBoarding,
    beginHoverRide: (spec: HoverRideSpec, plan: HoverBoardingPlan) => beginHoverRide(ch, spec, plan),
    hoverRideState: () => hoverRideState(ch),
    flightClear,
    pickDeparture: (f: HoverFlight, now: number, lead: number) => pickDeparture(ctl, f, now, lead),
    laneNet,
    townSolids,
    townWalk,
    nearTram,
    docks: HOVER_DOCKS,
  }
}
