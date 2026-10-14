import { insideLab, SHELL } from '../../core/site'
import { ENTRANCE, ROOM } from '../../core/lab/plan'
import { SITE } from '../../core/town'
import { interiors } from '../../world/outdoor/interior/interiors'
import { townWalk } from '../../world/walk/townWalk'
import type { Character } from './character'

/**
 * 跳ぶ（その場で・歩きながら・走りながら上へ跳んで、重さで落ちる。例のアプリのスペースキー。issue #8）。
 * 跳ぶのは使う側が jump(ch) を呼んだときだけ（呼ばなければ跳ばない。決まりは足さない）。
 *
 * - 段階（ch.motion.jump.phase）: none → crouch（踏み切る前にしゃがむ JUMP_CROUCH 秒）→ air（跳んでいる）→ land（着いてしゃがむ JUMP_LAND 秒）→ none
 * - 高さ: 足元の地面から JUMP_HEIGHT m（踏み切る速さ √(2gh)、重さ GRAVITY）。天井の低い所（ラボの扉・中のある建物の部屋と扉と段・橋の下）では、
 *   頭（VRM の実測の身長 + HAIR。VRM が無ければ BODY_GUESS）が天井の HEAD_CLEAR 下に届く高さまでにし、跳んでいる間に低い天井の下へ入ったら、
 *   そこで止めて落ち始める（headroom）
 * - 横の動きは跳んでいないときと同じ決まり（WASD・クリックの direct.ts、立ち寄り先への歩き・旅程の locomotion）。立てるか（direct.ts の canStand）は
 *   跳んでいる体の高さではなく足元の地面（motion.ground）から見るので、跳んでも段・壁・柵・擁壁を越えて、歩けない所へは入らない（着くのは歩いて行ける所だけ）。
 *   跳んでいる間（air）は、上がれる段の高さの決まり（足元の地面の小さな段を、体をなめらかに上げ下げしてつなぐ）を使わず、体は重さだけで動き、
 *   足元の地面に届いたら着く（下りの段の上へ出たら、その下の地面まで落ちる）。WASD で歩いて・走っていたら、跳んでいる間は今の速さと向きのまま進む（direct.ts）
 * - 跳べないとき（何もしない。理由の字を返す）: 歩く人でない・乗り物に乗っている（乗り込み・降りるの途中も）・座っている・町の中の移動（旅程）の途中・
 *   旅程の早送りの途中・扉をくぐる途中（ラボの見学エントランスと通用口・中のある建物の扉の中）・頭の上が低すぎる・もう跳んでいる。
 *   時刻の早送り・カットは旅程と乗り物の間だけなので、その 2 つの決まりで止まる。使う側のワープの暗転の間（例のアプリ）は使う側が呼ばない
 * - 跳んでいる途中で乗り物・旅程が動き出した・置き直された（placeSerial が変わった。ワープ・旅程のカット・placeAt）ときは、その場で地面に戻す
 * - 毎コマ進めるのは locomotion（character/avatar/locomotion.ts の updateLocomotion が、足元の地面を決めたあとに stepJump）。見た目（characterVisual.ts）は
 *   motion.jump を読んで姿勢を作り、足の高さ合わせ（footIk.ts）は跳んでいる間は弱める。影は体と一緒に動く（見た目の object の位置が motion.position）
 */

/** 跳ぶ段階: none（跳んでいない）・crouch（踏み切る前にしゃがむ）・air（跳んでいる）・land（着いてしゃがむ） */
export type JumpPhase = 'none' | 'crouch' | 'air' | 'land'

/** 跳ぶ様子（Character の motion.jump。locomotion が毎コマ進める） */
export interface CharacterJump {
  phase: JumpPhase
  /** 今の段階に入ってからの秒 */
  t: number
  /** 足元の、地面（立ち位置の台を含む）からの高さ（m。air の間だけ 0 より大きい） */
  height: number
  /** 足元の高さ（シーンの y。air の間の体の高さ。ほかは足元の地面） */
  y: number
  /** 上向きの速さ（m/s。air の間） */
  vy: number
  /** 踏み切ったときの速さ（m/s。天井で低くした分も入る。見た目が上りと下りを分ける） */
  v0: number
  /** 着いたときの落ちる速さ（m/s。見た目が着いてしゃがむ深さに使う） */
  impact: number
  /** 跳び始めた回数（見た目が新しい跳びを見分ける） */
  serial: number
  /** 跳び始めたときの motion.placeSerial（置き直されたら跳ぶのをやめる） */
  placeSerial: number
}

/** 跳ぶ高さ（足元の地面から m。決めた 0.4〜0.5m の真ん中） */
export const JUMP_HEIGHT = 0.45
/** 重さ（m/s²） */
export const GRAVITY = 9.8
/** 踏み切る前にしゃがむ長さ・着いてしゃがむ長さ（秒） */
export const JUMP_CROUCH = 0.14
export const JUMP_LAND = 0.3
/** 頭の上にあける余白（m） */
const HEAD_CLEAR = 0.05
/** 実測の身長（目の高さから出した値）に足す、髪の分（m） */
const HAIR = 0.06
/** VRM を読む前の身長の目安（m。createCharacter の DEFAULT_HEIGHT と同じ） */
const BODY_GUESS = 1.65
/** これより低くしか跳べないなら跳ばない（m） */
const MIN_RISE = 0.03
/** 跳んでいる長さの上限（秒。足元の地面に届かないまま、これを過ぎたら地面に戻す） */
const MAX_AIR = 3
/** 中のある建物で、同じ床と見る高さの差（m） */
const SAME_FLOOR = 0.5
/** 橋の床版の厚み（下の面 = 路面 − これ。world/outdoor/town/infraMeshes.ts の addBridges の 0.9） */
const BRIDGE_DECK = 0.9
/** 扉の通り抜けの、壁の面からの広がり（m） */
const DOOR_REACH = 0.3

/** 跳んでいない様子（createCharacter が motion.jump に入れる） */
export function createJump(y = 0): CharacterJump {
  return { phase: 'none', t: 0, height: 0, y, vy: 0, v0: 0, impact: 0, serial: 0, placeSerial: 0 }
}

/** 頭のてっぺんの、足元からの高さ（m） */
export function headHeight(ch: Character) {
  const h = ch.anchors.measuredHeight
  return (h > 0.5 ? h : BODY_GUESS) + HAIR
}

/** 頭の上の天井（シーンの y。無ければ Infinity）と、扉をくぐる途中か */
export interface Headroom {
  top: number
  door: boolean
}

/**
 * 点 (x, z) に足元の高さ foot で立つ人の、頭の上の天井と扉:
 * - ラボの中: メインホールの天井の照明の梁の下（ROOM.height − 0.7。カメラの決まり world/followCamera.ts と同じ）、
 *   見学エントランスのガラスの扉（ENTRANCE.doorHeight）と通用口（staffDoorHeight）の中は、その扉の上端（扉をくぐる途中）
 * - 中のある建物: 部屋の天井（勾配・丸い天井はその点の高さ）・扉の上端（扉をくぐる途中）・段の上・頭の上の障害物（InteriorModel.headroom）
 * - 町: 頭の上の橋の床版の下の面
 */
export function headroomAt(x: number, z: number, foot: number): Headroom {
  let top = Infinity
  let door = false
  // ラボの見学エントランス（南のガラスの面）と通用口（西の壁）の扉の中
  const glass = ENTRANCE.glassDoor
  if (x > glass[0] && x < glass[1] && Math.abs(z - SHELL.glassZ) < DOOR_REACH) {
    top = Math.min(top, ENTRANCE.doorHeight)
    door = true
  }
  const staff = ENTRANCE.staffDoor.z
  if (z > staff[0] && z < staff[1] && x > -SHELL.outerX - DOOR_REACH && x < -ROOM.halfWidth + DOOR_REACH) {
    top = Math.min(top, ENTRANCE.staffDoorHeight)
    door = true
  }
  if (insideLab(x, z)) return { top: Math.min(top, ROOM.height - 0.7), door }
  const model = interiors.modelAt(x, z)
  if (model) {
    const h = model.headroom(x, z, foot, SAME_FLOOR)
    top = Math.min(top, h.top)
    door ||= h.door
  }
  // 町の橋の下（路面が頭より上にある橋。重なる橋は足元から 4m 上に近い方）
  const deck = townWalk.ready ? townWalk.bridgeZ(x, -z, foot + SITE.labFloorElevation + 4) : null
  if (deck !== null) {
    const under = deck - SITE.labFloorElevation - BRIDGE_DECK
    if (under > foot + 1) top = Math.min(top, under)
  }
  return { top, door }
}

/** 足元の高さ foot で、点 (x, z) から上へどれだけ跳べるか（m。頭が天井の HEAD_CLEAR 下まで。天井が無ければ Infinity） */
function riseAt(ch: Character, x: number, z: number, foot: number) {
  return headroomAt(x, z, foot).top - HEAD_CLEAR - headHeight(ch) - foot
}

/** 跳べない理由（跳べるなら null） */
export function jumpProblem(ch: Character): string | null {
  const m = ch.motion
  if (ch.kind !== 'walker') return '歩く人だけが跳べます'
  if (m.jump.phase === 'crouch' || m.jump.phase === 'air') return 'もう跳んでいます'
  if (ch.ride.phase !== 'none') return '乗り物に乗っている間は跳べません'
  if (m.seat !== null || (m.action === 'sit' && m.actionBlend > 0.05)) return '座っている間は跳べません'
  if (ch.travel.phase !== 'done') return '町の中の移動（旅程）の途中は跳べません'
  if (m.timeScale !== 1) return '早送りの途中は跳べません'
  const h = headroomAt(m.position.x, m.position.z, m.position.y)
  if (h.door) return '扉をくぐる途中は跳べません'
  if (h.top - HEAD_CLEAR - headHeight(ch) - m.position.y < MIN_RISE) return '頭の上が低くて跳べません'
  return null
}

/**
 * 跳ぶ（踏み切る前にしゃがんでから、上へ跳ぶ。着いてしゃがむあいだにまた呼べば、続けて跳ぶ）。
 * 跳び始めたら null、跳べなければ理由の字（何もしない）。毎コマ進めるのは updateLocomotion
 */
export function jump(ch: Character): string | null {
  const problem = jumpProblem(ch)
  if (problem) return problem
  const j = ch.motion.jump
  j.phase = 'crouch'
  j.t = 0
  j.height = 0
  j.vy = 0
  j.v0 = 0
  j.impact = 0
  j.y = ch.motion.position.y
  j.serial++
  j.placeSerial = ch.motion.placeSerial
  return null
}

/** 跳ぶのをやめて地面に戻す（乗り物・旅程が動き出した・置き直されたとき。locomotion が呼ぶ） */
export function endJump(ch: Character) {
  const j = ch.motion.jump
  if (j.phase === 'none') return
  j.phase = 'none'
  j.t = 0
  j.height = 0
  j.vy = 0
}

/**
 * 1 コマ進める（locomotion が足元の地面 base（立ち位置の台を含む）を決めたあと）。motion.jump.height（足元の、地面からの高さ）を決める。
 * 置き直された・旅程が動いているときはやめる
 */
export function stepJump(ch: Character, dt: number, base: number) {
  const m = ch.motion
  const j = m.jump
  if (j.phase === 'none') {
    j.y = base
    return
  }
  if (m.placeSerial !== j.placeSerial || ch.travel.phase !== 'done' || ch.ride.phase !== 'none') {
    endJump(ch)
    j.y = base
    return
  }
  j.t += dt
  switch (j.phase) {
    case 'crouch': {
      j.y = base
      j.height = 0
      if (j.t < JUMP_CROUCH) break
      // 踏み切る: 頭の上の天井までの高さで速さを決める（天井が低ければ低く。届かないほど低ければ跳ばずに戻る）
      const rise = Math.min(JUMP_HEIGHT, riseAt(ch, m.position.x, m.position.z, base))
      if (rise < MIN_RISE) {
        endJump(ch)
        break
      }
      j.phase = 'air'
      j.t = 0
      j.v0 = j.vy = Math.sqrt(2 * GRAVITY * rise)
      break
    }
    case 'air': {
      // 重さで落ちる（速さの前後の平均で進める。決まった重さなら、コマの長さによらず同じ高さまで上がる）
      const vy0 = j.vy
      j.vy -= GRAVITY * dt
      j.y += ((vy0 + j.vy) / 2) * dt
      // 頭が天井に届いたら、そこで止めて落ち始める（跳んでいる間に低い天井の下へ入ったとき）
      const roof = headroomAt(m.position.x, m.position.z, base).top - HEAD_CLEAR - headHeight(ch)
      if (j.y > roof) {
        j.y = Math.max(base, roof)
        j.vy = Math.min(j.vy, 0)
      }
      if (j.y <= base || j.t > MAX_AIR) {
        // 着く（足元の地面に届いた）
        j.impact = Math.max(0, -j.vy)
        j.phase = 'land'
        j.t = 0
        j.y = base
        j.vy = 0
      }
      break
    }
    case 'land':
      j.y = base
      if (j.t >= JUMP_LAND) {
        j.phase = 'none'
        j.t = 0
      }
      break
  }
  j.height = j.phase === 'air' ? j.y - base : 0
}

/** 跳んでいる（足が地面から離れている）か */
export function airborne(ch: Character) {
  return ch.motion.jump.phase === 'air'
}
