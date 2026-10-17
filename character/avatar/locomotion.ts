import * as THREE from 'three'
import { townPlaces, type PlaceId, type TownPlace } from '../../core/places'
import { insideLab } from '../../core/site'
import type { InteriorZoneId, ZoneId } from '../../core/interiors'
import { interiors } from '../../world/outdoor/interior/interiors'
import { site } from '../../world/outdoor/site/siteModel'
import { findPath, segmentClear, smoothPath } from './nav'
import { riderFloorAt } from '../ride/rider'
import { townWalk } from '../../world/walk/townWalk'
import type { Character, CharacterMotion } from './character'
import { endJump, stepJump } from './jump'
import { releaseTurnStep, stepTurn, turnStepBusy } from './turnStep'

/**
 * キャラクターの移動（状態は Character が持つ。character/avatar/character.ts）。
 * 経路に沿って体全体を動かし、歩きの周期（gait）を出す。アバター側はこの ch.motion を読んで、
 * 位置・向き・脚や腕の振り・立ち寄り先での行動を作る。
 *
 * 動きの段階: idle（止まっている）→ turnStart（その場で行き先の方へ向く）→ walk（歩く）→ turnEnd（着いて向きを合わせる）→ idle
 * その場で向きを変える間（turnStart・turnEnd・見る先へ体ごと向き直る faceToward）は、足踏みで回る（character/avatar/turnStep.ts の stepTurn。
 * 1 歩ずつ、軸足を床に置いたまま、もう片方の足を回る先へ置く。体は足が宙にある間に回る）
 *
 * 自分で巡るか・巡るのを止めるか・着いたときの行動は、使う側が入れた決まり ch.policy（character/avatar/character.ts）に聞く（アプリの状態は読まない。5-1d）。
 * 今いる立ち寄り先・行き先をアプリの状態へ書くのも使う側（kanon-lab は src/kanon/KanonAvatar.tsx の KanonNavigator が、updateLocomotion のすぐあとに）
 */

export type { MotionPhase } from './character'

/** 歩く速さ（m/s）・加速・減速 */
export const WALK_SPEED = 1.1
/** 町の中を歩く速さ（m/s。平地 80 m/分。設定資料の道順の時間の決まり D-005。坂・石段は道のグラフの時間から。character/avatar/travel.ts） */
export const TOWN_WALK_SPEED = 80 / 60
const ACCEL = 1.3
const DECEL = 1.0
/** 歩きながら向きを変える最大の速さ（rad/s。その場で向きを変えるのは足踏み。turnStep.ts） */
const TURN_RATE = 2.6
/**
 * 見る先へ体ごと向き直る（使う側の決まり faceToward。kanon-lab は kanon.look_at で大きく後ろ寄りの物を見るとき）:
 * 見る先が立っていた向きから FACE_START（rad）より横・後ろなら、首と胸で届く分 FACE_KEEP を残して、
 * その場で足踏みで向き直る（character/avatar/turnStep.ts の stepTurn。1 歩をゆっくり。FACE_STEP_MIN より小さなずれでは歩かない）。見るのをやめたら元の向きへ戻る。
 * 向き直るのは止まって立っている間（待機・present・展示を眺める look・窓の外を眺める gaze）だけ。座っている・物に手を置く行動の間は首と胸だけで見る
 */
export const FACE_START = 1.2
export const FACE_KEEP = 0.7
/** 見る先へ向き直るとき、これより小さなずれでは足を踏み替えない（rad。首と胸が残りを見る） */
const FACE_STEP_MIN = 0.18
const FACE_ACTIONS: ReadonlySet<string> = new Set(['present', 'look', 'gaze'])

/** 歩幅（1 歩、m）。速さに合わせて伸び縮みさせ、足が床を滑って見えないようにする */
export function stepLength(speed: number) {
  return 0.3 + 0.3 * Math.min(1.2, speed / WALK_SPEED)
}

/** 立ち寄り先 id（使う側が configurePlaces で渡した表 townPlaces() から。core/places.ts。5-1c） */
function place(id: PlaceId): TownPlace {
  return townPlaces()[id]
}

/** 外の立ち寄り先か（町の段階 3。カメラ・KB-001 の高さはその場所の地面から。自分で歩き回るときは行かない） */
export function isOutdoorStop(id: PlaceId) {
  return !!place(id).outdoor
}

/** 立ち寄り先のゾーン（ラボとそのまわりは lab。遠くのセットは core/interiors.ts） */
export function stopZone(id: PlaceId): 'lab' | InteriorZoneId {
  return place(id).zone ?? 'lab'
}

/** ch が立ち寄り先 id にいて、止まっているか */
export function isAt(ch: Character, id: PlaceId) {
  return ch.motion.phase === 'idle' && ch.motion.stopId === id
}

const _p = new THREE.Vector3()
const _tan = new THREE.Vector3()

/** 移動を指示する（次のフレームで経路を作る） */
export function goTo(ch: Character, id: PlaceId) {
  if (!(id in townPlaces())) {
    console.warn(`[sakurami-cho] 立ち寄り先 "${id}" はありません`)
    return
  }
  ch.nav.pending = id
}

/** 同じゾーンなら歩いて、別のゾーン（遠くのセット）ならすぐ置く（操作パネル・数字キー・起動・開発の動作が使う。Hub の kanon.goto は歩くだけ） */
export function goOrPlace(ch: Character, id: PlaceId) {
  if (stopZone(id) !== ch.motion.zone) placeAt(ch, id)
  else goTo(ch, id)
}

/** その場で止まる（Hub の命令の取り消し・一時停止）。立ち寄り先の近くなら、そこに着いたことにする */
export function stopWalking(ch: Character) {
  const m = ch.motion
  ch.nav.pending = null
  if (m.phase === 'idle') return
  ch.nav.curve = null
  m.targetId = null
  m.phase = 'idle'
  m.speed = 0
  const places = townPlaces()
  let near: PlaceId | null = null
  for (const id of Object.keys(places)) {
    const p = places[id].position
    if (Math.hypot(p[0] - m.position.x, p[2] - m.position.z) < 0.25) near = id
  }
  m.stopId = near
  m.action = near ? places[near].action : null
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** 向きを目標へなめらかに回す（比例制御 + 最大速度）。回した量を返す */
function turnToward(m: CharacterMotion, target: number, dt: number, maxRate = TURN_RATE) {
  const err = wrapAngle(target - m.heading)
  const rate = THREE.MathUtils.clamp(err * 4.5, -maxRate, maxRate)
  m.heading = wrapAngle(m.heading + rate * dt)
  m.turnRate = rate
  return err
}

function startPath(ch: Character, id: PlaceId, t: number) {
  const m = ch.motion
  const nav = ch.nav
  const errors = ch.errors
  const goal = place(id).position
  const from: [number, number] = [m.position.x, m.position.z]
  if (Math.hypot(goal[0] - from[0], goal[2] - from[1]) < 0.05) {
    // すでにそこにいる: 向きだけ合わせる
    nav.curve = null
    m.targetId = id
    m.stopId = null
    m.phase = 'turnEnd'
    return
  }
  // ゾーンをまたぐ移動は歩かない（kanon.place で置く）
  const zone = stopZone(id)
  if (zone !== m.zone) {
    console.warn(`[sakurami-cho] "${id}" は別の場所（${zone}）です。placeAt で置いてください`)
    errors.unreachable = id
    errors.reason = 'zone'
    return
  }
  let path: [number, number][] | null
  if (zone === 'lab') path = findPath(from, [goal[0], goal[2]])
  else {
    const model = interiors.models.get(zone)
    if (!model) {
      errors.unreachable = id
      errors.reason = 'data'
      return
    }
    path = model.findPath(from, model.levelAt(from[0], from[1], m.position.y), [goal[0], goal[2]], place(id).level ?? 0)
  }
  if (path && place(id).seat) path = seatApproach(path, id, zone)
  if (!path) {
    console.warn(`[sakurami-cho] "${id}" への経路が見つかりませんでした`)
    errors.unreachable = id
    errors.reason = 'path'
    return
  }
  errors.unreachable = null
  errors.reason = null
  m.seat = null
  m.activityHeld = false
  const walking = m.phase === 'walk' && m.speed > 0.2
  nav.curve = smoothPath(path, walking ? m.moveDir : undefined)
  nav.curveLen = nav.curve.getLength()
  nav.travelled = 0
  m.targetId = id
  m.stopId = null
  m.phase = walking ? 'walk' : 'turnStart'
  void t
}

/**
 * 座る立ち寄り先（seat）へは、座る向きの後ろの点（0.55m・0.4m の順に試す）を通ってまっすぐ入る。
 * 経路の最後の線が横から来ると、椅子のすぐ後ろで向きを変えるまでの間に、脚が座面の縁をかすめていた（§7 の 142）
 */
export function seatApproach(path: [number, number][], id: PlaceId, zone: ZoneId): [number, number][] {
  if (path.length < 2) return path
  const s = place(id)
  const goal = path[path.length - 1]
  const prev = path[path.length - 2]
  const model = zone === 'lab' || zone === 'town' ? null : interiors.models.get(zone)
  const level = s.level ?? 0
  const clear = (a: [number, number], b: [number, number], k: number) => (model ? model.segmentClear(a, b, level, 0.28 * k) : segmentClear(a, b, 0.3 * k))
  for (const back of [0.55, 0.4]) {
    const pre: [number, number] = [goal[0] - Math.sin(s.heading) * back, goal[1] - Math.cos(s.heading) * back]
    // すでに後ろから入っている（前の点が後ろの点の近く）なら、そのまま
    if (Math.hypot(prev[0] - pre[0], prev[1] - pre[1]) < 0.12) return path
    if (clear(prev, pre, 0.9) && clear(pre, goal, 0.4)) return [...path.slice(0, -1), pre, goal]
  }
  return path
}

/** 台（lift）のある立ち寄り先の一覧と、それを作った表（表が替わったら作り直す） */
let liftTable: Readonly<Record<PlaceId, TownPlace>> | null = null
let lifted: TownPlace[] = []

/**
 * 立ち寄り先の台（lift。kanon-lab の配信の立ち位置の台など。core/places.ts）の上の、足元の高さの上乗せ（台の上だけ少し高い。5-1c）。
 * 式は前の立ち位置の台と同じ（top × k × k × (3 − 2k)、k = (radius − 距離) / edge を 0〜1 に）。台が重なる所は高い方
 */
function placeLift(x: number, z: number) {
  const table = townPlaces()
  if (table !== liftTable) {
    liftTable = table
    lifted = Object.values(table).filter((s) => s.lift)
  }
  let y = 0
  for (const s of lifted) {
    const l = s.lift!
    const d = Math.hypot(x - s.position[0], z - s.position[2])
    const k = THREE.MathUtils.clamp((l.radius - d) / l.edge, 0, 1)
    const h = l.top * k * k * (3 - 2 * k)
    if (h > y) y = h
  }
  return y
}

/**
 * 足元の地面の高さ（ラボの中は床 0、外はテラス・石段（なめらかな坂。step = true なら段のまま）・スロープ・小道・地形。site/siteModel.ts）。
 * 遠くのセット（中のある建物）では、建物の床・階段・ポーチ・踊り場（interior/model.ts）。階が重なる所は、今の高さ refY にいちばん近い床。
 * 乗り物（観覧車・ケーブルカー）に乗っている間は、車室の中は中の床（character/ride/rider.ts の riderFloorAt。ch.ride の乗っている車室）
 */
export function groundHeight(ch: Character, x: number, z: number, step = false, refY = ch.motion.position.y) {
  if (insideLab(x, z)) return 0
  // 乗り物の中（観覧車のゴンドラ・ケーブルカー。乗り降りの途中の扉の所も）は、車室の床
  const cabin = riderFloorAt(ch.ride, x, z, refY)
  if (cabin !== null) return cabin
  const model = interiors.modelAt(x, z)
  if (model) {
    const g = model.groundAt(x, z, refY, step)
    if (g !== null) return g
  }
  // 町の中（橋の路面・町の石段・ラボのまわりのセット・均した地形。world/walk/townWalk.ts）
  return townWalk.groundY(x, z, refY, step)
}

/**
 * 立ち寄り先の足元の高さ（置くとき。遠くのセットの中は、その階の床）。y = 足元（台 lift のある所は天面）、ground = 地面・床（台の分を除く）
 */
function stopGround(ch: Character, id: PlaceId) {
  const s = place(id)
  const x = s.position[0]
  const z = s.position[2]
  const zone = s.zone ?? 'lab'
  let ground: number
  let ready = true
  if (zone === 'lab') ground = groundHeight(ch, x, z, false, 0)
  else {
    const model = interiors.models.get(zone)
    if (!model) {
      ground = site.groundY(x, z)
      ready = false
    } else {
      const ref = s.outdoor ? site.groundY(x, z) : model.levelFloorY(s.level ?? 0)
      ground = model.groundAt(x, z, ref) ?? ref
    }
  }
  return { y: s.lift ? ground + s.lift.top : ground, ground, ready }
}

/** 立ち寄り先 id に立ったときの足元の地面の高さ（置いたときの motion.ground と同じ。台 lift の分は除く）。浮かぶ仲間をそこへ置くときなど */
export function stopGroundLevel(ch: Character, id: PlaceId) {
  return stopGround(ch, id).ground
}

/**
 * 立ち寄り先 id へすぐ置く（kanon.place。歩かない。撮影ではカットでつなぐ）。着いたときの行動の姿勢のまま置き、KB-001 も一緒に移る
 */
export function placeAt(ch: Character, id: PlaceId, activity = true) {
  const m = ch.motion
  const nav = ch.nav
  const s = place(id)
  nav.pending = null
  nav.curve = null
  const g = stopGround(ch, id)
  m.position.set(s.position[0], g.y, s.position[2])
  m.ground = g.ground
  m.heading = s.heading
  m.moveDir.set(Math.sin(s.heading), 0, Math.cos(s.heading))
  m.speed = 0
  m.turnRate = 0
  releaseTurnStep(m.step)
  m.walk = 0
  m.phase = 'idle'
  m.stopId = id
  m.targetId = null
  m.action = activity ? s.action : 'present'
  m.actionBlend = 1
  m.activityHeld = false
  m.seat = activity ? (s.seat ?? null) : null
  m.zone = s.zone ?? 'lab'
  m.level = s.level ?? 0
  m.arrivedAt = nav.lastT
  m.placeSerial++
  nav.snapPending = !g.ready
  ch.errors.unreachable = null
  ch.errors.reason = null
  nav.dwellUntil = nav.lastT + 8 + ch.rnd() * 12
  ch.events.emit('place', id)
}

/** 毎フレーム呼ぶ（kanon-lab は KanonNavigator から）。t はシーンの経過秒 */
export function updateLocomotion(ch: Character, t: number, dt: number) {
  const m = ch.motion
  const nav = ch.nav
  const rnd = ch.rnd
  nav.lastT = t
  // 観覧車に乗っている間（乗り込み・降りるの途中も）は、ride.ts が位置・向き・速さを決める
  if (ch.drivers.motion?.(ch, t, dt)) {
    nav.faceHome = null
    nav.pending = null
    nav.curve = null
    m.outside = true
    m.indoor = false
    // 跳んでいる途中で乗り物が動かし始めたら、跳ぶのをやめる（高さは乗る仕組みが決める）
    endJump(ch)
    m.jump.y = m.position.y
    finishFrame(ch, t, dt)
    return
  }
  // 自分で巡ってよいか（使う側の決まり。kanon-lab は探検のモードで ?wander のとき）。聞くのは町の中の移動を進める前（前に labStore を読んでいた所）
  const wander = ch.policy.wander?.() ?? false
  // 町の中の移動（kanon.travel）の間は、travel.ts が位置・向き・速さを決める
  const traveling = ch.drivers.travel?.(ch, t, dt) ?? false
  if (traveling) nav.pending = null

  // 自分で立ち寄り先を巡る（1 か所で 8〜20 秒）。巡るのを止めている間（使う側の決まり。kanon-lab は Hub の命令で動いている間・kanon.hold の間）は巡らない
  const held = ch.policy.held?.() ?? false
  if (held) nav.dwellUntil = Math.max(nav.dwellUntil, t + 8)
  if (!traveling && wander && m.phase === 'idle' && !nav.pending && !held) {
    if (nav.dwellUntil === 0) nav.dwellUntil = t + 8 + rnd() * 12
    if (t >= nav.dwellUntil) {
      // 自分で巡るのは今いるゾーンの中（ラボの中・建物の中）だけ（外の立ち寄り先へは指示があったときだけ行く）
      const places = townPlaces()
      const candidates = Object.keys(places).filter((id) => id !== m.stopId && !isOutdoorStop(id) && stopZone(id) === m.zone && places[id].level === places[m.stopId ?? id].level)
      nav.pending = candidates[Math.floor(rnd() * candidates.length)]
    }
  }

  if (nav.pending) {
    const id = nav.pending
    nav.pending = null
    if (!(m.phase === 'idle' && m.stopId === id)) startPath(ch, id, t)
    else m.targetId = null
  }

  let speedTarget = 0
  if (traveling || m.phase !== 'idle') nav.faceHome = null
  switch (traveling ? 'travel' : m.phase) {
    case 'idle':
      m.turnRate *= Math.exp(-dt * 8)
      faceToward(ch, dt)
      break
    case 'turnStart': {
      if (!nav.curve) {
        m.phase = 'idle'
        break
      }
      nav.curve.getTangentAt(0.02, _tan)
      // 足踏みで行き先の方へ向く。歩の途中は歩き出さない（足を置いてから）
      const err = stepTurn(m, Math.atan2(_tan.x, _tan.z), dt, { min: 0.25 })
      // 行動の姿勢を解いてから歩き出す
      if (Math.abs(err) < 0.4 && !m.step.foot && m.actionBlend < 0.35) m.phase = 'walk'
      break
    }
    case 'walk': {
      if (!nav.curve) {
        m.phase = 'idle'
        break
      }
      const curve = nav.curve
      const curveLen = nav.curveLen
      const remaining = curveLen - nav.travelled
      speedTarget = Math.min(WALK_SPEED, Math.sqrt(2 * DECEL * Math.max(remaining, 0)) + 0.05)
      const u = Math.min(1, nav.travelled / curveLen)
      curve.getTangentAt(Math.min(1, u + 0.25 / curveLen), _tan)
      const err = turnToward(m, Math.atan2(_tan.x, _tan.z), dt, 3.2)
      // 向きが大きくずれている間は速さを落とす（曲がり角で膨らまないように）
      speedTarget *= THREE.MathUtils.clamp(1.25 - Math.abs(err) * 0.9, 0.35, 1)
      m.speed += THREE.MathUtils.clamp(speedTarget - m.speed, -DECEL * 1.6 * dt, ACCEL * dt)
      nav.travelled = Math.min(curveLen, nav.travelled + m.speed * dt)
      curve.getPointAt(Math.min(1, nav.travelled / curveLen), _p)
      m.position.x = _p.x
      m.position.z = _p.z
      if (curveLen - nav.travelled < 0.015) {
        m.speed = 0
        m.phase = 'turnEnd'
      }
      break
    }
    case 'turnEnd': {
      const id = m.targetId
      if (!id) {
        m.phase = 'idle'
        break
      }
      m.speed = Math.max(0, m.speed - DECEL * 2 * dt)
      // 足踏みで立ち寄り先の向きへ（小さなずれは足を上げずに合わせ、遅れた足はそろえる）
      const err = stepTurn(m, place(id).heading, dt, { exact: true, close: true })
      if (Math.abs(err) < 0.015 && !turnStepBusy(m.step, m.heading)) {
        m.phase = 'idle'
        m.stopId = id
        m.targetId = null
        // 着いたときの行動（使う側の決まり。kanon-lab は kanon.goto・kanon.travel の activity: false の present。聞いたら使う側が消す）
        m.action = ch.policy.takeArriveAction?.() ?? place(id).action
        m.seat = m.action === 'sit' ? (place(id).seat ?? null) : null
        m.arrivedAt = t
        m.turnRate = 0
        nav.dwellUntil = t + 8 + rnd() * 12
        nav.curve = null
        ch.events.emit('arrive', id)
      }
      break
    }
  }
  if (m.phase !== 'walk' && !traveling) m.speed = Math.max(0, m.speed - DECEL * 2 * dt)
  // 歩いている・座っている・跳んでいる間は、その場の足踏みを外す（足はアニメーションのまま）
  if (m.phase === 'walk' || m.speed > 0.05 || m.seat !== null || m.jump.phase !== 'none') releaseTurnStep(m.step)

  // 遠くのセットに置いたときに中の決まりが無かったら、できたときに階の床へ置き直す
  if (nav.snapPending && m.stopId && interiors.models.has(m.zone as InteriorZoneId)) {
    nav.snapPending = false
    const g = stopGround(ch, m.stopId)
    m.position.y = g.y
  }
  // 床・地面の高さ（立ち位置の台に上る。外は地面に沿う。建物の中は今の階の床と階段）。階・橋の上と下は、跳んでいる間も足元の地面の高さから選ぶ
  const air = m.jump.phase === 'air'
  const g = groundHeight(ch, m.position.x, m.position.z, false, m.position.y - m.jump.height)
  if (!air && (m.zone !== 'lab' || traveling) && Math.abs(g - m.ground) < 0.45) {
    // 上がり框・扉の敷居の小さな段は、体をなめらかに上げ下げする（足は IK で段に合わせる）。跳んでいる間は使わない（体は重さだけで動く。character/avatar/jump.ts）
    m.ground += (g - m.ground) * (1 - Math.exp(-dt * 16))
  } else m.ground = g
  // 跳ぶ（使う側が jump を呼んだときだけ。足元の地面からの高さ m.jump.height を決める）
  const base = m.ground + placeLift(m.position.x, m.position.z)
  stepJump(ch, dt, base)
  m.position.y = base + m.jump.height
  m.outside = !insideLab(m.position.x, m.position.z)
  if (m.zone !== 'lab' && m.zone !== 'town') {
    const model = interiors.models.get(m.zone)
    m.indoor = !!model?.roomAt(m.position.x, base + 1.0, m.position.z, -0.1)
    if (model) m.level = model.levelAt(m.position.x, m.position.z, base)
  } else m.indoor = false
  finishFrame(ch, t, dt)
}

/**
 * 止まって立っている間、使う側の決まり faceToward の見る先が横・後ろ（FACE_START より）なら、その場で体ごと向き直る（FACE_KEEP を残して）。
 * 見るのをやめた・向き直れない行動になったら、向き直る前の向き（nav.faceHome）へ戻る。置き直した（placeSerial が進んだ）ら戻らない
 */
function faceToward(ch: Character, dt: number) {
  const m = ch.motion
  const nav = ch.nav
  if (nav.faceHome !== null && nav.facePlace !== m.placeSerial) nav.faceHome = null
  const free = m.seat === null && m.jump.phase === 'none' && (m.action === null || FACE_ACTIONS.has(m.action))
  const p = free ? (ch.policy.faceToward?.() ?? null) : null
  if (p) {
    const want = Math.atan2(p.x - m.position.x, p.z - m.position.z)
    const home = nav.faceHome ?? m.heading
    const rel = wrapAngle(want - home)
    if (nav.faceHome === null) {
      if (Math.abs(rel) <= FACE_START) return
      nav.faceHome = m.heading
      nav.facePlace = m.placeSerial
    }
    const target = Math.abs(rel) > FACE_KEEP ? wrapAngle(want - Math.sign(rel) * FACE_KEEP) : home
    stepTurn(m, target, dt, { min: FACE_STEP_MIN, slow: true })
  } else if (nav.faceHome !== null) {
    // 元の向きへ戻る（ぴったり合わせて、遅れた足もそろえる）
    const err = stepTurn(m, nav.faceHome, dt, { slow: true, exact: true, close: true })
    if (Math.abs(err) < 0.004 && !turnStepBusy(m.step, m.heading)) {
      m.heading = nav.faceHome
      m.turnRate = 0
      nav.faceHome = null
    }
  } else if (m.step.foot || turnStepBusy(m.step, m.heading)) {
    // 向き直りの途中の歩を終え、遅れた足をそろえる
    stepTurn(m, m.heading, dt, { slow: true, close: true })
  }
  m.moveDir.set(Math.sin(m.heading), 0, Math.cos(m.heading))
}

/** 毎コマの終わり（進む向き・歩きの周期・行動の強さ）。ふだんの歩きと、観覧車に乗っている間の両方 */
function finishFrame(ch: Character, t: number, dt: number) {
  const m = ch.motion
  void t

  // 進む向き（なめらかに）
  if (m.speed > 0.05) {
    _tan.set(Math.sin(m.heading), 0, Math.cos(m.heading))
    m.moveDir.lerp(_tan, 1 - Math.exp(-dt * 3)).normalize()
  }

  // 歩きの周期: 歩いているときは進んだ距離から（歩幅に合わせる）、その場で向きを変えるときは足踏み（足踏みを脚に入れる仕組み turnStep.ts を
  // 使っていない回り方（乗り物の乗り降りなど）だけ。使っている間は見た目の turnStepPose.ts が足を運ぶ）
  const stepping = Math.abs(m.turnRate) > 0.25 && m.phase !== 'walk' && !m.step.active
  if (m.speed > 0.01) m.gait += (Math.PI * m.speed * dt * m.timeScale) / (m.stride ?? stepLength(m.speed))
  else if (stepping) m.gait += Math.abs(m.turnRate) * dt * 1.6
  const walkTarget = m.phase === 'walk' ? Math.min(1, m.speed / 0.55) : stepping ? 0.3 : 0
  m.walk += (walkTarget - m.walk) * (1 - Math.exp(-dt * 7))

  // 行動の強さ: 止まっている間は 1 へ、動き出したら 0 へ
  const actionTarget = m.phase === 'idle' && (m.stopId || m.activityHeld) ? 1 : 0
  m.actionBlend += THREE.MathUtils.clamp(actionTarget - m.actionBlend, -dt * 3, dt * 1.1)
  if (m.actionBlend <= 0.001 && m.phase !== 'idle') m.action = null
}

/** 歩き出してからの経過（デバッグ用） */
export function locomotionDebug(ch: Character) {
  return { phase: ch.motion.phase, travelled: ch.nav.travelled, curveLen: ch.nav.curveLen, t: ch.nav.lastT }
}
