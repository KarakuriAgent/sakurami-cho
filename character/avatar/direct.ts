import * as THREE from 'three'
import { insideLab, PATH_REROUTE, SHELL } from '../../core/site'
import { ROOM } from '../../core/lab/plan'
import { zoneOfPoint } from '../../core/interiors'
import { townPlaces } from '../../core/places'
import { ZONE_PORTALS } from '../../core/travel'
import { interiors } from '../../world/outdoor/interior/interiors'
import { polyMargin, type InteriorModel, type PatchM } from '../../world/outdoor/interior/model'
import { NAV_RADIUS, obstacleDistance, site } from '../../world/outdoor/site/siteModel'
import { townSolids } from '../../world/walk/townSolids'
import { townWalk } from '../../world/walk/townWalk'
import { findPath, isWalkable, smoothPath } from './nav'
import { groundHeight } from './locomotion'
import type { Character } from './character'

/**
 * 人を直接動かす（WASD などの向きの入力と、地面をクリックして歩く。docs/design/map-split.md §8 の段 6。例のアプリ town-walker が使う。
 * kanon-lab は読まない）。town.md の「段 5 見る人の歩き」。
 *
 * - 使い方: `ch.drivers.travel = (c, t, dt) => driveTravel(c, t, dt) || driveDirect(c, t, dt)`（旅程が動いている間は旅程が先）。
 *   向きは setDirectInput（世界の向き。カメラの向きから直すのは使う側）、クリックは pickGround で地面の点を拾って walkToPoint
 * - 動いている間は、位置・向き・速さ・段階（walk）・ゾーン・歩幅（町の石段の上）をここが決め、足元の高さ・階・外か中かは locomotion（drivers.travel の約束）
 * - 歩ける所（canStand。持ち主の決め: 道・広場・建物の中などに限る）:
 *   ラボの中と敷地（nav.ts の isWalkable。中は家具をよける）、町の道・石段・橋・広場（townWalk.onWalkway と同じ決まり。ケーブル・地下の辺は道の索引に
 *   入っていない。ラボのまわりではセットが形を替えた道を数えない）と
 *   ホーム・乗り場の面（townWalk.extraAt）、中のある建物のゾーンでは今の階の歩ける面（InteriorModel.walkable）と階をまたぐ段、
 *   ゾーンの出入口の間（core/travel.ts の ZONE_PORTALS の町の点とゾーンの点を結ぶ線のまわり PORTAL_HALF m）。
 *   そのうえで、建物・木の幹・石段のわきの擁壁（townSolids.blocker）の中でなく、今の足元の高さから STEP m より高い・低い所へは行かない
 *   （芝生・斜面・水・線路の上は、どれにも入らないので出ない）
 * - 向きの入力: 入力の向きへ進み（加速・減速）、体はその向きへ回る。行けない所に当たったら、向きを少しずつ（20°・40°・60°）ずらして
 *   行ける向きへ沿ってすべる（速さはずらした角の cos 倍。壁へまっすぐ向かうときは止まる）。手を離したら止まる（少し滑ってから）。
 *   跳んでいる間（character/avatar/jump.ts の air）は、踏み切ったときの速さと向きのまま進む（入力でも手を離しても変えない。行けない所に当たったら同じく沿ってすべる・止まる）。
 *   立てるかは跳んでいる体の高さでなく足元の地面（motion.ground）から見るので、跳んでも段・壁・柵を越えない
 * - クリック: 今いる所のグラフの中だけ（ラボとそのまわり = nav.ts の findPath、中のある建物 = InteriorModel.findPath、町の道 = townWalk.route と polyline。
 *   町は、まっすぐ立てる所だけを通れる近い所（STRAIGHT_MAX m まで。広場の中など）なら、まっすぐ歩く）。
 *   ゾーンをまたぐ・グラフが見つからないときは、理由の字を返して歩かない（ゾーンをまたぐ移動は旅程の仕事。startTravel）
 *
 * Character ごとの状態は、この中の WeakMap に持つ（character.ts を直さない）
 */

/** 歩く・走る速さ（m/s。仮） */
const WALK = 1.3
const RUN = 2.6
/** 加速・減速（m/s²）。手を離したあとの減速は強め */
const ACCEL = 3.2
const DECEL = 6
/** クリックで歩くとき、着く手前で落とす減速（m/s²。locomotion の DECEL と同じ） */
const ARRIVE_DECEL = 1.0
/** 体を回す速さ（比例の係数と最大 rad/s） */
const TURN_GAIN = 9
const TURN_MAX = 9
/** 段の高さの上限（m）。今の足元から、これより高い・低い所へは 1 コマで行かない */
const STEP = 0.45
/** 体の半径（ラボ・中のある建物の家具と縁からの余白。m） */
const BODY = 0.25
/** 階をまたぐ段の上の余白（m。段は幅が狭いので小さく） */
const STAIR_BODY = 0.15
/** 町の道の縁からの余白（m） */
const ROAD_MARGIN = 0.2
/** ゾーンの出入口の間の幅の半分（m） */
const PORTAL_HALF = 0.8
/** 町の当たり（建物・木の幹・擁壁）を見る高さ（足元から m）と余白（m） */
const BLOCK_H = 0.3
const BLOCK_MARGIN = 0.2
/** 行けない所に当たったとき、試す向きのずれ（ラジアン。小さい順に左右。60° まで: まっすぐ壁へ向かうときは止まる） */
const SLIDE = [0.35, 0.7, 1.05]
/** 止まったと見る速さ（m/s） */
const STOP_SPEED = 0.05

type XZ = [number, number]

/** 歩いている所のグラフ（クリックで歩く道を作る所） */
type Graph = { kind: 'lab' } | { kind: 'model'; model: InteriorModel } | { kind: 'town' }
/** 立てる所の種類（出入口の間は町の道の側として扱う） */
type Surface = Graph | { kind: 'portal' }

const LAB: Graph = { kind: 'lab' }
const TOWN: Graph = { kind: 'town' }
const PORTAL: Surface = { kind: 'portal' }

interface DirectPath {
  /** 点の列（シーンの x, z）と、始めからの長さ */
  pts: XZ[]
  cum: number[]
  /** 進んだ長さ */
  s: number
}

interface DirectRun {
  /** 向きの入力（世界の向き。単位ベクトル）。無ければ null */
  input: { x: number; z: number } | null
  run: boolean
  /** クリックで歩く道（無ければ null） */
  path: DirectPath | null
  /** 進む速さ（m/s。入力の速さへ加速・減速）と、最後に進んだ向き */
  speed: number
  dir: THREE.Vector2
  /** 前のコマで動かした（drivers.travel で true を返した） */
  active: boolean
}

const runs = new WeakMap<Character, DirectRun>()

function runOf(ch: Character): DirectRun {
  let r = runs.get(ch)
  if (!r) runs.set(ch, (r = { input: null, run: false, path: null, speed: 0, dir: new THREE.Vector2(0, 1), active: false }))
  return r
}

/* -------------------------------------------------------------------------- */
/* 歩ける所                                                                      */
/* -------------------------------------------------------------------------- */

/** 階をまたぐ段の、体の高さのなめらかな坂（interior/model.ts の patchY の step = false と同じ式） */
function linkStairY(model: InteriorModel, p: PatchM, x: number, z: number): number | null {
  if (p.arc) {
    const ac = p.arc
    const [s, t] = model.local(x, z)
    let a = Math.atan2(t - ac.c[1], s - ac.c[0])
    const mid = (ac.a0 + ac.a1) / 2
    while (a < mid - Math.PI) a += Math.PI * 2
    while (a > mid + Math.PI) a -= Math.PI * 2
    const k = Math.min(1, Math.max(0, (a - ac.a0) / (ac.a1 - ac.a0)))
    return ac.y0 + (ac.y1 - ac.y0) * k
  }
  const r = p.ramp
  if (!r) return null
  const k = Math.min(1, Math.max(0, ((x - r.ox) * r.dx + (z - r.oz) * r.dz) / r.len))
  return r.y0 + (r.y1 - r.y0) * k
}

/** 中のある建物の歩ける面の上か（足元の高さ g の階の面か、その高さの所の階をまたぐ段） */
function onModel(model: InteriorModel, x: number, z: number, g: number) {
  if (model.walkable(x, z, model.levelAt(x, z, g), BODY)) return true
  for (const p of model.patches) {
    if (!p.link || !p.walk || polyMargin(p.poly, x, z) < STAIR_BODY) continue
    const y = linkStairY(model, p, x, z)
    if (y !== null && Math.abs(y - g) < 0.3) return true
  }
  return false
}

/** ラボのまわりのセットが小道を自分で持つ範囲（ラボからの m。siteModel.ts の walkable の小道と同じ） */
const SITE_PATH_RADIUS = NAV_RADIUS + 20

/** 点が多角形の中か（町の平面座標） */
function inRing(ring: readonly (readonly [number, number])[], x: number, y: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * 町の道・石段・橋の上か、広場の中か（townWalk.onWalkway と同じ決まりで、縁から ROAD_MARGIN m 内側。ケーブル・乗り降り・広場・地下の辺は道の索引に無い）。
 * ラボのまわり（SITE_PATH_RADIUS m の内）では、ラボのまわりのセットが形を替えた・やめた道（core/site.ts の PATH_REROUTE。ラボの前の小径など）を数えない
 * （そこはセットの小道・テラスが正しい形で、地図データの線のままだとテラスの手すりの外へ出てしまう）
 */
function onTownWalk(x: number, z: number) {
  const nav = townWalk.nav
  if (!nav) return false
  const data = nav.data
  const nearLab = Math.hypot(x, z) < SITE_PATH_RADIUS
  const hit = nav.snap(x, -z, 30, nearLab ? (e) => data.edges[e].f < 0 || !(data.feats[data.edges[e].f].id in PATH_REROUTE) : undefined)
  if (hit) {
    const e = data.edges[hit.edge]
    if (hit.dist <= (e.f >= 0 ? data.feats[e.f].width : 4) / 2 - ROAD_MARGIN) return true
  }
  for (const p of data.plazas) if (inRing(p.ring, x, -z)) return true
  return false
}

/** 出入口の、ゾーンの中の点（シーンの x, z。立ち寄り先の名前なら、使う側が渡した表から） */
function portalZonePoint(zone: string | readonly [number, number]): XZ | null {
  if (typeof zone !== 'string') return [zone[0], zone[1]]
  const s = townPlaces()[zone]
  return s ? [s.position[0], s.position[2]] : null
}

/** ゾーンの出入口の間（町の点とゾーンの点を結ぶ線のまわり）か */
function inPortal(x: number, z: number) {
  for (const list of Object.values(ZONE_PORTALS)) {
    for (const p of list) {
      const b = portalZonePoint(p.zone)
      if (!b) continue
      const ax = p.town[0]
      const az = -p.town[1]
      const dx = b[0] - ax
      const dz = b[1] - az
      const l2 = dx * dx + dz * dz
      const k = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
      if (Math.hypot(x - ax - dx * k, z - az - dz * k) <= PORTAL_HALF) return true
    }
  }
  return false
}

/**
 * 点 (x, z) に立てるなら、その所の種類（どれでもなければ null）。y = 今の足元の高さ（階・橋の上と下を選ぶ。STEP より離れた高さの所は立てない）
 */
function surfaceAt(ch: Character, x: number, z: number, y: number): Surface | null {
  const g = groundHeight(ch, x, z, false, y)
  if (!(Math.abs(g - y) <= STEP)) return null
  // ラボの中（部屋・中二階・見学エントランス。家具と壁をよける）
  if (insideLab(x, z)) return isWalkable(x, z, BODY) ? LAB : null
  const model = interiors.modelAt(x, z)
  let kind: Surface | null = null
  if (model) {
    if (onModel(model, x, z, g)) kind = { kind: 'model', model }
    // 建物の中で歩ける面でない所（壁・家具・吹き抜け）
    else if (model.inBuilding(x, z, 0)) return null
  }
  if (!kind) {
    if (site.walkable(x, z, BODY)) kind = LAB
    // ラボのまわりのセットの縁（手すり・花壇の際）と小物（街灯・ベンチ・望遠鏡）のそばは、重なる町の道があっても立てない
    else if (site.walkable(x, z, 0) || site.obstacles.some((o) => obstacleDistance(o, x, z) < BODY)) return null
    else if (onTownWalk(x, z) || townWalk.extraAt(x, -z)) kind = TOWN
    else if (inPortal(x, z)) kind = PORTAL
    else return null
  }
  // 町の建物・木の幹・石段のわきの擁壁（中のある建物の外形のまわりは、建物は中の決まりが見るので木だけ）
  if (townSolids.blocker(x, g + BLOCK_H, z, BLOCK_MARGIN, !!model && model.inBuilding(x, z, 0.6))) return null
  return kind
}

/**
 * 点 (x, z) に立てるか（シーンの座標。y = 今の足元の高さ。省けば ch の足元の地面）。
 * 道・石段・橋・広場・ホームと乗り場・ラボの中と敷地・中のある建物の今の階の床と段・ゾーンの出入口の間で、建物・木・擁壁の中でなく、段が STEP m まで
 */
export function canStand(ch: Character, x: number, z: number, y = ch.motion.ground): boolean {
  return surfaceAt(ch, x, z, y) !== null
}

/* -------------------------------------------------------------------------- */
/* 地面を拾う                                                                    */
/* -------------------------------------------------------------------------- */

/** ラボの殻の外の箱（外からの線はこの中に入らない。屋上より上はよい。world/followCamera.ts と同じ箱） */
const SHELL_BOX = { x0: -SHELL.outerX - 0.3, x1: SHELL.outerX + 0.3, z0: SHELL.northOuter - 0.3, z1: SHELL.portalZ + 0.3, y1: SHELL.parapetTop + 0.3 }

/** 点の真下の地面・床（ラボの中は床 0。中のある建物は refY に近い床。町は橋の上と下を refY で選ぶ） */
function floorAt(x: number, z: number, refY: number) {
  if (insideLab(x, z)) return 0
  const model = interiors.modelAt(x, z)
  return (model ? model.groundAt(x, z, refY) : null) ?? townWalk.groundY(x, z, refY)
}

/** 線の点が、通り抜けられない物（ラボの壁と殻・中のある建物の壁と天井・町の建物）の中か */
function solidAt(p: THREE.Vector3) {
  if (p.x > SHELL_BOX.x0 && p.x < SHELL_BOX.x1 && p.z > SHELL_BOX.z0 && p.z < SHELL_BOX.z1 && p.y < SHELL_BOX.y1) {
    // ラボの殻の中で、部屋の中（照明の梁の下まで）と南のガラスの前（額縁の内側）はあいている（ガラス越しに中・外の床を拾える）
    return !(Math.abs(p.x) < ROOM.halfWidth && p.y < ROOM.height && (insideLab(p.x, p.z) || p.z > SHELL.glassZ))
  }
  const model = interiors.modelAt(p.x, p.z)
  if (model?.rooms.length && model.inBuilding(p.x, p.z, 0.05)) return !model.roomAt(p.x, p.y, p.z, 0)
  const b = townSolids.blocker(p.x, p.y, p.z, 0, !!model && model.inBuilding(p.x, p.z, 0.6))
  // 木（幹・葉）は通り抜ける（木の下の道をクリックできるように）
  return !!b && !b.startsWith('木')
}

const _p = new THREE.Vector3()

/**
 * 線（カメラから画面の点を通る線など）が初めに当たる地面・床の点（シーンの座標。max m までに無ければ null）。
 * 町の三角形に raycast せず、地面・床の高さの関数でたどる（近くは 5cm ごと、遠くは離れの 1%（2m まで）ごと。当たったら二分して詰める）。
 * ラボの壁・天井・殻、中のある建物の壁・天井、町の建物に先に当たったら null（ラボの南のガラスと木は通り抜ける。線の初めがそれらの中のとき
 * （カメラが天井・壁の際）は、あいた所へ出るまで数えない）
 */
export function pickGround(ray: THREE.Ray, max = 2000): THREE.Vector3 | null {
  const gap = (t: number) => {
    ray.at(t, _p)
    return _p.y - floorAt(_p.x, _p.z, _p.y)
  }
  let prevT = 0
  let prevGap = gap(0)
  // 初めは通り抜けられない物の中でも数えない（カメラが天井・壁の際にあるとき）。一度あいた所へ出てから当たったら止める
  let open = false
  for (let t = 0; t < max; ) {
    t = Math.min(max, t + THREE.MathUtils.clamp(t * 0.01, 0.05, 2))
    const g = gap(t)
    if (prevGap > 0 && g <= 0) {
      // 二分して地面の高さに詰める
      let a = prevT
      let b = t
      for (let i = 0; i < 24; i++) {
        const m = (a + b) / 2
        if (gap(m) > 0) a = m
        else b = m
      }
      ray.at(b, _p)
      return new THREE.Vector3(_p.x, floorAt(_p.x, _p.z, _p.y), _p.z)
    }
    ray.at(t, _p)
    // 床のすぐ上（15cm まで）は壁と見ない（部屋の床の際は部屋の外と数えるので）
    if (g < 0.15 || !solidAt(_p)) open = true
    else if (open) return null
    prevT = t
    prevGap = g
    if (t >= max) break
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* 入力                                                                          */
/* -------------------------------------------------------------------------- */

/**
 * 向きの入力を入れる（世界の向き。x = 東、z = 南。長さは見ない。null で手を離す）。run なら走る。
 * 入力があればクリックで歩く道はやめる。旅程を取り消すのは使う側（cancelTravel。drivers.travel で旅程が先に動くため）
 */
export function setDirectInput(ch: Character, dir: { x: number; z: number } | null, run = false) {
  const r = runOf(ch)
  const l = dir ? Math.hypot(dir.x, dir.z) : 0
  if (!dir || l < 1e-3) {
    r.input = null
    r.run = false
    return
  }
  r.input = { x: dir.x / l, z: dir.z / l }
  r.run = run
  r.path = null
}

/** 動かすのをやめる（入力とクリックで歩く道を消し、動いていたらその場で止める） */
export function stopDirect(ch: Character) {
  const r = runs.get(ch)
  if (!r) return
  r.input = null
  r.run = false
  r.path = null
  r.speed = 0
  if (r.active) {
    const m = ch.motion
    m.speed = 0
    m.phase = 'idle'
    m.stride = null
    r.active = false
  }
}

/** 所の名前（理由の字） */
function graphLabel(g: Graph) {
  return g.kind === 'lab' ? 'ラボとそのまわり' : g.kind === 'town' ? '町の道' : g.model.zone.label
}

/** 立てる所 → 道を作るグラフ（出入口の間は町の道の側） */
const graphOf = (s: Surface): Graph => (s.kind === 'portal' ? TOWN : s)

/** 今いる所のグラフ（立てない所にいるときは、ゾーンから） */
function hereGraph(ch: Character): Graph {
  const m = ch.motion
  const s = surfaceAt(ch, m.position.x, m.position.z, m.ground)
  if (s) return graphOf(s)
  if (m.zone === 'lab') return LAB
  if (m.zone === 'town') return TOWN
  const model = interiors.models.get(m.zone)
  return model ? { kind: 'model', model } : TOWN
}

/** 町でまっすぐ歩いてよい長さ（m。広場の中・道の上の近い所。これより遠い・途中に立てない所があれば道のグラフ） */
const STRAIGHT_MAX = 60

/** start から end まで、まっすぐ立てる所だけを通るか（25cm ごと。高さは前の点から続けてたどる） */
function straightClear(ch: Character, start: XZ, end: XZ, y: number) {
  const len = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (len > STRAIGHT_MAX) return false
  const n = Math.max(1, Math.ceil(len / 0.25))
  let ref = y
  for (let i = 1; i <= n; i++) {
    const k = i / n
    const x = start[0] + (end[0] - start[0]) * k
    const z = start[1] + (end[1] - start[1]) * k
    if (!surfaceAt(ch, x, z, ref)) return false
    ref = groundHeight(ch, x, z, false, ref)
  }
  return true
}

/** 点の列を道にする（なめらかにした曲線なら 10cm ごとの点に） */
function makePath(pts: XZ[], smooth: boolean, dir?: THREE.Vector3): DirectPath {
  let list = pts
  if (smooth && pts.length > 2) {
    const curve = smoothPath(pts, dir)
    const n = Math.max(2, Math.ceil(curve.getLength() / 0.1))
    list = curve.getSpacedPoints(n).map((p) => [p.x, p.z] as XZ)
  }
  const out: XZ[] = []
  for (const p of list) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-3) out.push(p)
  }
  const cum = [0]
  for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]))
  return { pts: out, cum, s: 0 }
}

/**
 * 点 (x, z) へ歩く（今いる所のグラフの中で道を作る。y = その点の高さ（pickGround の点。省けば今の足元に近い地面））。
 * 歩き出したら null、歩けなければ理由の字（立てない所・ゾーンをまたぐ・道が見つからない・乗り物に乗っている）
 */
export function walkToPoint(ch: Character, x: number, z: number, y?: number): string | null {
  if (ch.ride.phase !== 'none') return '乗り物に乗っている間は、クリックで歩けません'
  const m = ch.motion
  const gy = y ?? groundHeight(ch, x, z, false, m.ground)
  const goal = surfaceAt(ch, x, z, gy)
  if (!goal) return 'そこへは歩けません（道・広場・建物の中の床・ラボの中と敷地をクリックしてください）'
  const to = graphOf(goal)
  const from = hereGraph(ch)
  const same = from.kind === to.kind && (from.kind !== 'model' || (to.kind === 'model' && from.model === to.model))
  if (!same) return `${graphLabel(from)}から${graphLabel(to)}へは、クリックでは歩けません（ゾーンをまたぐ移動は、行き先の一覧から選んでください）`
  const start: XZ = [m.position.x, m.position.z]
  const end: XZ = [x, z]
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.05) return null
  const moving = m.phase === 'walk' && m.speed > 0.2 ? m.moveDir : undefined
  let path: DirectPath | null = null
  if (to.kind === 'lab') {
    const p = findPath(start, end)
    if (p) path = makePath(p, true, moving)
  } else if (to.kind === 'model') {
    const md = to.model
    const p = md.findPath(start, md.levelAt(start[0], start[1], m.ground), end, md.levelAt(x, z, gy))
    if (p) path = makePath(p, true, moving)
  } else if (straightClear(ch, start, end, m.ground)) path = makePath([start, end], false)
  else {
    const route = townWalk.route([start[0], -start[1]], [end[0], -end[1]])
    if (route) path = makePath([start, ...townWalk.polyline(route).map((p) => [p.x, -p.y] as XZ), end], false)
  }
  if (!path || path.pts.length < 2) return `${graphLabel(to)}の中で、そこへの道が見つかりませんでした`
  const r = runOf(ch)
  r.path = path
  r.input = null
  return null
}

/** 今の様子（使う側の印・確かめ用）: 向きの入力・走るか・クリックで歩く行き先と残りの長さ・動かしているか */
export function directState(ch: Character) {
  const r = runs.get(ch)
  const p = r?.path
  return {
    input: r?.input ? { x: r.input.x, z: r.input.z } : null,
    run: !!r?.run,
    goal: p ? ([...p.pts[p.pts.length - 1]] as XZ) : null,
    remaining: p ? p.cum[p.cum.length - 1] - p.s : 0,
    active: !!r?.active,
  }
}

/* -------------------------------------------------------------------------- */
/* 毎コマ                                                                        */
/* -------------------------------------------------------------------------- */

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** 体の向きを target へ回す（回し残しを返す） */
function turnToward(ch: Character, target: number, dt: number, gain = TURN_GAIN, max = TURN_MAX) {
  const m = ch.motion
  const err = wrapAngle(target - m.heading)
  const rate = THREE.MathUtils.clamp(err * gain, -max, max)
  m.heading = wrapAngle(m.heading + rate * dt)
  m.turnRate = rate
  return err
}

/** 動き出すとき: 立ち寄り先の歩き（goTo）・行き先・座る・行動を外す */
function leavePlace(ch: Character) {
  const m = ch.motion
  ch.nav.pending = null
  ch.nav.curve = null
  m.targetId = null
  m.stopId = null
  m.seat = null
  m.activityHeld = false
}

/** 町の石段の上は踏面ごとに 1 歩（旅程と同じ） */
function strideAt(ch: Character, x: number, z: number) {
  const m = ch.motion
  if (m.zone !== 'lab' && m.zone !== 'town') return null
  const surf = townWalk.surface(x, z, m.position.y)
  return surf.stairs ? THREE.MathUtils.clamp(surf.stairs.tread, 0.28, 0.75) : null
}

/** 1 コマ分、(dx, dz) の向きへ len m 進む。行けなければ向きをずらして沿ってすべる。進んだ向き（無ければ null） */
function stepToward(ch: Character, dx: number, dz: number, len: number): XZ | null {
  const m = ch.motion
  const x = m.position.x
  const z = m.position.z
  const y = m.ground
  if (canStand(ch, x + dx * len, z + dz * len, y)) return [dx, dz]
  for (const a of SLIDE) {
    const k = Math.cos(a)
    for (const s of [1, -1]) {
      const c = Math.cos(a * s)
      const sn = Math.sin(a * s)
      const ex = dx * c + dz * sn
      const ez = -dx * sn + dz * c
      if (canStand(ch, x + ex * len * k, z + ez * len * k, y)) return [ex * k, ez * k]
    }
  }
  return null
}

/**
 * 毎コマ（Character の drivers.travel に。旅程 driveTravel の後ろにつなぐ）。向きの入力・クリックで歩く道があれば人を動かして true。
 * 手を離して止まったコマ・着いたコマは止めて false（そこからは locomotion のふだんの止まっている人）
 */
export function driveDirect(ch: Character, t: number, dt: number): boolean {
  const r = runs.get(ch)
  if (!r || (!r.input && !r.path && !r.active)) return false
  void t
  const m = ch.motion
  if (!r.active) {
    leavePlace(ch)
    r.speed = m.phase === 'walk' ? m.speed : 0
  }
  r.active = true
  if (r.input) driveInput(ch, r, dt)
  else if (r.path) driveClick(ch, r, r.path, dt)
  else coast(ch, r, dt)
  m.zone = zoneOfPoint(m.position.x, m.position.z)
  if (r.speed <= STOP_SPEED && !r.input && !r.path) {
    r.speed = 0
    r.active = false
    m.speed = 0
    m.phase = 'idle'
    m.stride = null
    return false
  }
  return true
}

/** 向きの入力で進む */
function driveInput(ch: Character, r: DirectRun, dt: number) {
  const m = ch.motion
  const input = r.input!
  // 行動の姿勢（座る・作業）を解いてから歩き出す（locomotion の turnStart と同じ）
  if (m.actionBlend > 0.35 && r.speed < 0.2) {
    turnToward(ch, Math.atan2(input.x, input.z), dt, 4.5, 3)
    m.phase = 'turnStart'
    m.speed = 0
    return
  }
  // 跳んでいる間は、踏み切ったときの速さと向きのまま進む（足が地面に着くまで速さも向きも変えない。character/avatar/jump.ts）
  if (m.jump.phase === 'air') {
    if (r.speed > STOP_SPEED) move(ch, r, r.dir.x, r.dir.y, dt)
    return
  }
  const want = r.run ? RUN : WALK
  r.speed += THREE.MathUtils.clamp(want - r.speed, -DECEL * dt, ACCEL * dt)
  move(ch, r, input.x, input.z, dt)
}

/** 手を離したあと、少し滑ってから止まる */
function coast(ch: Character, r: DirectRun, dt: number) {
  // 跳んでいる間は落とさない（手を離しても、着くまで今の速さのまま進む）
  if (ch.motion.jump.phase !== 'air') r.speed = Math.max(0, r.speed - DECEL * dt)
  if (r.speed > STOP_SPEED) move(ch, r, r.dir.x, r.dir.y, dt)
}

/** 速さ r.speed で (dx, dz) の向きへ（沿ってすべる）。体はその向きへ回る */
function move(ch: Character, r: DirectRun, dx: number, dz: number, dt: number) {
  const m = ch.motion
  const len = r.speed * dt
  const went = len > 1e-5 ? stepToward(ch, dx, dz, len) : null
  if (went) {
    m.position.x += went[0] * len
    m.position.z += went[1] * len
    const k = Math.hypot(went[0], went[1])
    r.dir.set(went[0] / k, went[1] / k)
    m.speed = r.speed * k
    turnToward(ch, Math.atan2(went[0], went[1]), dt)
  } else {
    // 行けない（壁・水・段に当たった）: その場で入力の向きへ向く
    r.speed = 0
    m.speed = 0
    turnToward(ch, Math.atan2(dx, dz), dt)
  }
  m.phase = m.speed > STOP_SPEED ? 'walk' : 'idle'
  m.stride = m.phase === 'walk' ? strideAt(ch, m.position.x, m.position.z) : null
}

/** 道の上の s m の点 */
function pointOn(p: DirectPath, s: number): XZ {
  const c = p.cum
  const d = Math.min(Math.max(s, 0), c[c.length - 1])
  let i = 1
  while (i < c.length - 1 && c[i] < d) i++
  const l = c[i] - c[i - 1]
  const k = l > 0 ? (d - c[i - 1]) / l : 0
  const a = p.pts[i - 1]
  const b = p.pts[i]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
}

/** クリックで作った道をたどる（旅程の歩きと同じ: 0.8m 先を向き、向きが大きくずれている間は遅く、着く手前で落とす） */
function driveClick(ch: Character, r: DirectRun, p: DirectPath, dt: number) {
  const m = ch.motion
  const total = p.cum[p.cum.length - 1]
  const remain = total - p.s
  if (m.actionBlend > 0.35 && r.speed < 0.2) {
    const q = pointOn(p, Math.min(total, p.s + 0.8))
    turnToward(ch, Math.atan2(q[0] - m.position.x, q[1] - m.position.z), dt, 4.5, 3)
    m.phase = 'turnStart'
    m.speed = 0
    return
  }
  let want = Math.min(WALK, Math.sqrt(2 * ARRIVE_DECEL * Math.max(remain, 0)) + 0.05)
  const here = pointOn(p, p.s)
  const ahead = pointOn(p, Math.min(total, p.s + 0.8))
  const ax = ahead[0] - here[0]
  const az = ahead[1] - here[1]
  if (ax * ax + az * az > 1e-6) {
    const err = turnToward(ch, Math.atan2(ax, az), dt, 4.5, 3.2)
    want *= THREE.MathUtils.clamp(1.25 - Math.abs(err) * 0.9, 0.35, 1)
    r.dir.set(ax, az).normalize()
  }
  r.speed += THREE.MathUtils.clamp(want - r.speed, -1.6 * dt, ACCEL * dt)
  p.s = Math.min(total, p.s + Math.max(0, r.speed) * dt)
  const q = pointOn(p, p.s)
  m.position.x = q[0]
  m.position.z = q[1]
  m.speed = r.speed
  m.phase = 'walk'
  m.stride = strideAt(ch, q[0], q[1])
  if (total - p.s < 0.015) {
    // 着いた
    r.path = null
    r.speed = 0
  }
}
