import * as THREE from 'three'
import type { PlaceAction, PlaceId } from '../../core/places'
import type { ZoneId } from '../../core/interiors'
import type { TownFocus } from '../../world/townHost'
import type { Rider } from '../ride/rider'
import type { CharacterRides } from '../ride/rides'
import type { BodyMetrics, SeatSpec } from './body'
import { CharacterEvents, type CharacterEventMap, type CharacterEventName } from './events'
import { CharacterExpressions } from './expressions'
import type { FloatState } from './float'
import type { CharacterJump } from './jump'
import { CharacterLayers } from './layers'
import { setVrmRimBlend, type VrmRim } from './loadVrm'
import type { TravelRun } from './travel'

/**
 * キャラクター（1 人ずつ状態を持つ。docs/design/map-split.md §5 の「段 2 の作りの決めごと」）。
 * ここは状態だけを持ち、動かす計算は今の関数に Character を渡す形（character/avatar/locomotion.ts の updateLocomotion(ch, t, dt)・goTo(ch, id)・
 * character/avatar/travel.ts の startTravel(ch, req)・character/ride/* の begin*(ch, …) など）。このファイルは locomotion.ts を読まない。
 * 作るのは character/avatar/createCharacter.ts、kanon-lab の花音は src/kanon/index.ts の 1 つのインスタンス。
 * 乗り物に乗っている間の状態（ride。character/ride/rider.ts）と乗る仕組みの状態（rides。character/ride/rides.ts）も持つ。
 * 地図の注目点（world/townHost.ts の TownFocus）をそのまま満たす（setTownFocus(kanon)。getter は割り当てをしない。ride は同じ物）。
 * 種類（kind）は歩く人（walker。VRM の人。locomotion・乗る仕組みで動く）と浮かんで動く物（float。character/avatar/float.ts。kanon-lab の KB-001 は src/kb001/kb.ts）。
 * float も歩く人の部品（nav・travel・ride・rides など）を作るが使わない（種類で作り分けるかは段 5 で決める）。
 */

/** キャラクターの種類: walker = 歩く人（VRM）、float = 浮かんで動く物（character/avatar/float.ts） */
export type CharacterKind = 'walker' | 'float'

/** 動きの段階: idle（止まっている）→ turnStart（その場で行き先の方へ向く）→ walk（歩く）→ turnEnd（着いて向きを合わせる）→ idle */
export type MotionPhase = 'idle' | 'turnStart' | 'walk' | 'turnEnd'

/** 動き（位置・向き・歩きの周期・立ち寄り先での行動）。アバターの側はこれを読んで、位置・向き・脚や腕の振り・行動を作る */
export interface CharacterMotion {
  /** 足元の位置（y は床・地面の高さ。立ち寄り先の台（lift。配信の立ち位置の台など）の上では、その分を足した高さ）。浮かんで動く物（float）は本体の中心（揺れは含まない） */
  position: THREE.Vector3
  /** 足元の地面の高さ（立ち寄り先の台 lift の分を除く。ラボの中は 0、外は地面。配信の飾りやカメラの高さの基準） */
  ground: number
  /** ラボの外にいるか（扉の外へ出たら true） */
  outside: boolean
  /** 体の向き（0 = +Z 向き。float は FloatState の yaw） */
  heading: number
  /** 進む速さ（m/s） */
  speed: number
  /** 向きを変える速さ（rad/s） */
  turnRate: number
  /** 歩きの周期（ラジアン。2π で左右 1 歩ずつ） */
  gait: number
  /** 歩きの強さ（0〜1。止まっているとき 0） */
  walk: number
  phase: MotionPhase
  /** 今いる立ち寄り先（歩いている途中は null） */
  stopId: PlaceId | null
  /** 行き先 */
  targetId: PlaceId | null
  /** 立ち寄り先での行動と、その強さ（0〜1） */
  action: PlaceAction | null
  actionBlend: number
  /** 進んでいる向き（なめらかにしたもの。カメラと KB-001 が使う） */
  moveDir: THREE.Vector3
  /** 立ち寄り先に着いた時刻（シーンの経過秒） */
  arrivedAt: number
  /** 行動を外から指示された（kanon.activity）。立ち寄り先でなくても行動を続ける。歩き出したら外れる */
  activityHeld: boolean
  /** 今いるゾーン（lab = ラボとそのまわり。遠くのセットは core/interiors.ts） */
  zone: ZoneId
  /** 建物の中の階（遠くのセットの中。外は 0） */
  level: number
  /** 中のある建物の部屋の中にいるか */
  indoor: boolean
  /** 座っている椅子（立ち寄り先の seat） */
  seat: SeatSpec | null
  /** kanon.place で置き直した回数（KB-001・カメラが一緒に移る合図）。町の中の移動のカットでも増やす */
  placeSerial: number
  /** 時間の倍率（kanon.travel の早送りの間だけ 1 より大きい。歩きの周期とアニメーションをこの倍で進める） */
  timeScale: number
  /** 歩幅を決めて歩くとき（町の石段の上は踏面の長さ。null なら速さから stepLength） */
  stride: number | null
  /** 跳ぶ様子（character/avatar/jump.ts。跳ぶのは使う側が jump(ch) を呼んだときだけ。air の間は position.y が足元の地面から height だけ上） */
  jump: CharacterJump
}

/** 歩きの途中の経路と、自分で巡るときの待ち（character/avatar/locomotion.ts が使う） */
export interface CharacterNav {
  curve: THREE.CatmullRomCurve3 | null
  curveLen: number
  travelled: number
  /** 次のコマで経路を作る行き先 */
  pending: PlaceId | null
  /** 自分で巡るとき、次へ歩き出す時刻（シーンの経過秒） */
  dwellUntil: number
  /** 前のコマの時刻（シーンの経過秒） */
  lastT: number
  /** 遠くのセットで、まだ町のデータ（中の決まり）が無いうちに置いた: 決まりができたら階の床へ置き直す */
  snapPending: boolean
}

/** 経路が見つからなかった行き先と理由（Hub の命令に返すため。zone = ゾーンが違う（kanon.place を使う）、data = 町のデータがまだ無い、path = 通り道が無い） */
export interface LocomotionErrors {
  unreachable: PlaceId | null
  reason: 'zone' | 'data' | 'path' | null
}

/**
 * 体の位置（ワールド座標）。見た目（character/avatar/characterVisual.ts）が毎コマ書き、被写界深度のピント合わせ・コメントパネルの位置合わせ・カメラ・KB-001 などが読む。
 * VRM が無いときは、作るときの目安（createCharacter の anchorGuess）の位置のまま
 */
export interface CharacterAnchors {
  /** VRM が読み込まれて、下の値が本物のボーンの位置になっているか */
  ready: boolean
  /** 頭（被写界深度のピント） */
  head: THREE.Vector3
  /** 胸 */
  chest: THREE.Vector3
  /** 実測した身長（m）。VRM が無いときは 0 */
  measuredHeight: number
}

/**
 * キャラクターの見た目（Character の visual。character/avatar/characterVisual.ts の createCharacterVisual が作る。このファイルは形だけを読む）。
 * object をシーンに置き、start() で読み込み、毎コマ update(t, dt, camera)（ch.updateVisual から）、stop() で読み込みの取り消しとシーンから外す
 */
export interface CharacterVisualLike {
  /** シーンに置く物 */
  readonly object: THREE.Object3D
  start(): void
  stop(): void
  update(t: number, dt: number, camera: THREE.Camera): void
}

/** 毎コマ呼び、true を返したらふだんの歩きを止めて、そちらが動かす */
export type CharacterDriver = (ch: Character, t: number, dt: number) => boolean

/**
 * 外から動かすもの（locomotion から ride・travel を import しないための入れ物。使う側が付ける。kanon-lab は src/kanon/index.ts）
 * - motion: 乗り物に乗っている間（乗り込み・降りるの途中も）。true を返したらふだんの歩き（経路・地面の高さ）を止める
 * - travel: 町の中の移動（kanon.travel）。true を返したら位置・向き・速さ・ゾーンはそちらが決め、locomotion は足元の高さ・外か中か・階・歩きの周期だけを決める
 */
export interface CharacterDrivers {
  motion: CharacterDriver | null
  travel: CharacterDriver | null
}

/**
 * 使う側の決まり（自分で巡るか・巡るのを止めるか・着いたときの行動。locomotion がアプリの状態を読まないための入れ物。5-1d）。
 * 入れるのは使う側（kanon-lab は src/kanon/index.ts。labStore の mode・wander と direction の holds・arriveAction）。省いた物は、巡らない・止めない・
 * 着いたら立ち寄り先の行動。locomotion が呼ぶ時期は毎コマ決まっていて、前に labStore・direction を読んでいた所と同じ:
 * - wander: 自分で立ち寄り先を巡ってよいか。乗り物に乗っていないコマに 1 回、町の中の移動（drivers.travel）を進める前に呼ぶ
 * - held: 巡るのを止めているか（true の間は、次へ歩き出す時刻を先へ延ばす）。乗り物に乗っていないコマに 1 回、町の中の移動を進めたあとに呼ぶ
 * - takeArriveAction: 歩いて着いたコマ（向きを合わせ終えたとき）に 1 回。立ち寄り先の行動の代わりにする行動（無ければ null）。呼んだら使う側は消す
 */
export interface CharacterPolicy {
  wander?: () => boolean
  held?: () => boolean
  takeArriveAction?: () => PlaceAction | null
}

export interface CharacterInit {
  id: string
  kind: CharacterKind
  /** 浮かんで動く物の状態（kind = 'float' のときだけ。ほかは null） */
  float: FloatState | null
  motion: CharacterMotion
  anchors: CharacterAnchors
  body: BodyMetrics
  rim: VrmRim
  rnd: () => number
  travel: TravelRun
  ride: Rider
  /** 乗る仕組みの状態を作る（作っている Character を受ける。character/ride/rides.ts の createRides） */
  rides: (ch: Character) => CharacterRides
}

export class Character implements TownFocus {
  readonly id: string
  /** 種類（walker = 歩く人・float = 浮かんで動く物） */
  readonly kind: CharacterKind
  /** 浮かんで動く物の状態（kind = 'float' のときだけ。動かすのは character/avatar/float.ts の floatCarry・floatStep・floatClampCabin・floatYaw・placeFloat） */
  readonly float: FloatState | null
  /** 動き（今の位置・向き・段階・行動） */
  readonly motion: CharacterMotion
  /** 歩きの途中の経路（locomotion） */
  readonly nav: CharacterNav
  /** 経路が見つからなかった行き先と理由 */
  readonly errors: LocomotionErrors = { unreachable: null, reason: null }
  /** 乱数（自分で巡る行き先・待つ長さ。撮影で毎回同じになるように種から） */
  readonly rnd: () => number
  /** 外から動かすもの（乗り物・町の中の移動） */
  readonly drivers: CharacterDrivers = { motion: null, travel: null }
  /** 使う側の決まり（自分で巡る・巡るのを止める・着いたときの行動。省けば巡らない・止めない・立ち寄り先の行動） */
  policy: CharacterPolicy = {}
  /** 町の中の移動の途中の様子（character/avatar/travel.ts） */
  readonly travel: TravelRun
  /** 体の位置（頭・胸。見た目（character/avatar/characterVisual.ts）が書く） */
  readonly anchors: CharacterAnchors
  /** 体の寸法（座る姿勢・机に手を置く高さ。VRM を読んだら測って入れる。character/avatar/body.ts） */
  readonly body: BodyMetrics
  /** 縁の光（読み込んだ VRM の MToon と、外にいる度合い。character/avatar/loadVrm.ts） */
  readonly rim: VrmRim
  /**
   * 乗り物に乗っている間の状態（段階・乗っている便・最後に乗った便・車室の中か・居場所・一緒に乗る仲間の一覧と仲間の側の様子・乗り降りの回数。character/ride/rider.ts・character/ride/party.ts）。
   * 注目点の ride（地図の乗客の形 CabinRider）もこれ
   */
  readonly ride: Rider
  /** 乗る仕組みの状態（観覧車・ケーブル・緑電・運河バス・ホバー。character/ride/rides.ts） */
  readonly rides: CharacterRides
  /** 出来事（乗り降り・着いた・置き直された。character/avatar/events.ts）。聞くのは on、出すのはキャラクターと乗る仕組みの側（events.emit） */
  readonly events = new CharacterEvents()
  /** 姿勢の層（キャラクターに固有の身ぶり・反応・視線・表情・飾り。付けた順が段の中の順。character/avatar/layers.ts）。付けるのは使う側（kanon-lab は src/kanon/KanonAvatar.tsx） */
  readonly layers = new CharacterLayers()
  /** 表情（VRM に無い名前は飛ばす・まばたきの強さ blinkScale。character/avatar/expressions.ts）。見た目が読み込んだ VRM につなぐ */
  readonly expressions = new CharacterExpressions()
  /** 見た目（character/avatar/characterVisual.ts。付けるのは使う側（kanon-lab は src/kanon/KanonAvatar.tsx）。無ければ見た目を持たない） */
  visual: CharacterVisualLike | null = null

  constructor(init: CharacterInit) {
    this.id = init.id
    this.kind = init.kind
    this.float = init.float
    this.motion = init.motion
    this.anchors = init.anchors
    this.body = init.body
    this.rim = init.rim
    this.rnd = init.rnd
    this.travel = init.travel
    this.ride = init.ride
    this.nav = { curve: null, curveLen: 0, travelled: 0, pending: null, dwellUntil: 0, lastT: 0, snapPending: init.motion.zone !== 'lab' }
    this.rides = init.rides(this)
  }

  /** 足元の位置（注目点） */
  get position(): THREE.Vector3 {
    return this.motion.position
  }

  /** ラボの外にいるか（注目点） */
  get outside(): boolean {
    return this.motion.outside
  }

  /** 歩いているか（注目点。中のある建物の扉が使う） */
  get walking(): boolean {
    return this.motion.phase === 'walk'
  }

  /** 進んでいる向き（注目点。中のある建物の扉が使う） */
  get moveDir(): THREE.Vector3 {
    return this.motion.moveDir
  }

  /**
   * 出来事を聞く（やめる関数を返す）。状態が変わったその場（同じコマ・同じ関数の中）で呼ばれるので、聞く側は自分の状態を書くだけにする
   * （乗る仕組み・動きの状態を書き換えない）。出来事の一覧と出る所は character/avatar/events.ts
   */
  on<K extends CharacterEventName>(name: K, fn: (e: CharacterEventMap[K]) => void): () => void {
    return this.events.on(name, fn)
  }

  /**
   * 見た目を 1 コマ進める（t = シーンの経過秒、dt = 前のコマからの秒（丸めない）、camera = 見ているカメラ）。
   * kanon-lab は react/CharacterView.tsx の useFrame（priority 0）から
   */
  updateVisual(t: number, dt: number, camera: THREE.Camera) {
    this.visual?.update(t, dt, camera)
  }

  /** 縁の光を、ラボの中（0）と外・建物の中（1）の間でまぜる（地図は外にいる度合いを出すだけで、人物に反映するのはこちら。map-split.md §4） */
  setRimBlend(k: number) {
    setVrmRimBlend(this.rim, k)
  }
}
