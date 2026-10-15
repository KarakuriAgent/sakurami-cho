import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { TownQualityName } from '../core/town'
import type { CabinRider } from './outdoor/transit/vehicle'

/**
 * 地図の口（docs/design/map-split.md §4）。地図（町・ラボ・ほかの建物・公共交通）が、使う側（アプリ）から受け取る物と、
 * 外へ知らせる物をここにまとめる。地図の側のコードはアプリの側（avatar・ride・sound・stream・state・config/runtime）を
 * import せず、ここを読む。値と関数は使う側が起動のときに入れる（5-6 から町の口 world/createTown.ts の createTown と town.setFocus などを通す。
 * kanon-lab は src/townBinding.ts）。
 *
 * - 引数（configureTown）: アセットの置き場（assetBase）・品質・町の画質の段・デバッグ・全部のタイルを読むか・影の地図の大きさ・後処理の有無・時計・
 *   読み込みの状態の知らせ先
 * - 注目点（setTownFocus）: 細かさ・光の中心、外にいるか、えきもりの会釈の相手、乗っている車室（中の光・町の音）。参照を渡すので、毎コマの写しは要らない
 * - 扉を開ける物（addTownDoorOpener）: 注目点のほかに自動の扉を開ける物（付いて浮かぶロボットなど）。これも参照を持つ
 * - 出来事（townEvents.on）: 外にいる度合い（outsideness）・えきもりの会釈と発車の合図・ホバーの回し始めと着いたなど。出したコマの中で、そのまま呼ぶ
 *
 * 引数はモジュールの読み込み時には読まない（初めて使うときに読む）。使う側が入れる前に読まれないように。
 * ラボの明るさは world/labLight.ts、町の時刻の固定（setLabTime・setLabDate）と早送り・カット（clockWarp）は core/clock.ts。
 */

/** 町の地図データの読み込みの状態。missing・outdated は `pnpm sync:town` の案内を出す（world/outdoor/town/townData.ts） */
export type TownStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'outdated' | 'error'

/** 地図の時計のうち、使う側が決めるもの（町の時刻そのものは core/clock.ts） */
export interface TownClock {
  /** 場面の時計の秒（扉の開け閉めなどの時刻の基準。撮影の 1 コマ送りでも同じように進む） */
  sceneTime: () => number
  /** 交通を描画の時計で進めるか（撮影のように、1 コマずつ決まった秒だけ進める。world/outdoor/transit/clock.ts） */
  stepped: boolean
  /** 準備ができたか（時刻を止めている・stepped のとき、交通はこれが true になってから進め始める） */
  ready: () => boolean
}

export interface TownOptions {
  /**
   * アセットの置き場（public の根に当たる URL。末尾は /）。この下の town/（町の地図データ。world/outdoor/town/townData.ts）・
   * textures/（町・ラボ・敷地のテクスチャ。townTextures.ts・site/siteMaterial.ts・react/LabView.tsx）を読む。
   * 既定は '/'（Vite の base を変えていないアプリの import.meta.env.BASE_URL と同じ）。kanon-lab は import.meta.env.BASE_URL を渡す。
   * 地図の側は Vite の import.meta.env を読まない（5-4）
   */
  assetBase: string
  /** 重い処理（太陽の影・床の映り込み・星やほこりの数など）を使う high か、落とす low か */
  quality: 'high' | 'low'
  /** 町の画質の段（core/town.ts の TOWN_QUALITY） */
  townQuality: TownQualityName
  /** デバッグの表示・コンソールの道具（window.__transit など） */
  debug: boolean
  /** 窓から見えないタイルも初めから全部読む（カメラが窓の外へ出られるとき） */
  allTiles: boolean
  /** 太陽の影の地図の大きさ（px） */
  sunShadowMapSize: number
  /** 後処理（ポストエフェクト）を使うか（使うときは、描き先を付けてシェーダーを先に作る） */
  postEffects: boolean
  clock: TownClock
  /** 町の地図データの読み込みの状態が変わった */
  onStatus: (status: TownStatus, message: string) => void
}

const options: TownOptions = {
  assetBase: '/',
  quality: 'high',
  townQuality: 'high',
  debug: false,
  allTiles: false,
  sunShadowMapSize: 2048,
  postEffects: true,
  clock: { sceneTime: () => performance.now() / 1000, stepped: false, ready: () => true },
  onStatus: () => undefined,
}
let configured = false
let warned = false

/** 地図の引数を入れる（使う側が起動のとき、地図のモジュールが使う前に 1 回。足りない項目は既定のまま。5-6 から町の口 createTown が呼ぶ） */
export function configureTown(next: Partial<Omit<TownOptions, 'clock'>> & { clock?: Partial<TownClock> }) {
  const { clock, ...rest } = next
  Object.assign(options, rest)
  if (clock) options.clock = { ...options.clock, ...clock }
  configured = true
}

/** 地図の引数（地図の側が、使うときに読む） */
export function townOptions(): Readonly<TownOptions> {
  if (!configured && !warned) {
    warned = true
    console.warn('[town] configureTown の前に地図の引数を読みました（既定の値を使います）')
  }
  return options
}

/** 重い処理を使うか（townOptions().quality === 'high'） */
export const townHighQuality = () => townOptions().quality === 'high'

/* -------------------------------------------------------------------------- */
/* 注目点                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 地図が注目する人（細かさ・光の中心、外にいるか、えきもりの会釈の相手）。使う側の物をそのまま渡す（地図は読むだけ。
 * kanon-lab は Character（character/avatar/character.ts）がそのまま満たす）。walking・moveDir は中のある建物の扉が使う（歩いているか・進む向き）。
 * ride は乗っている車室（地図の乗客の形 CabinRider: 乗っている便・車室の中か・居場所）で、車室の中の光（interior/interiors.ts）・
 * えきもりの会釈（transit/robots.ts）・町の音の車室の響き（world/sound/townSound.ts）が使う
 */
export interface TownFocus {
  /** 足元の位置 */
  readonly position: THREE.Vector3
  /** ラボの外にいるか */
  readonly outside: boolean
  /** 歩いているか */
  readonly walking: boolean
  /** 進んでいる向き */
  readonly moveDir: THREE.Vector3
  /** 乗っている車室（乗っていなければ car は null） */
  readonly ride: CabinRider
}

let focus: TownFocus = { position: new THREE.Vector3(), outside: false, walking: false, moveDir: new THREE.Vector3(0, 0, 1), ride: { car: null, inside: false, seat: { z: 0, side: 1 } } }

/** 注目点を入れる（参照を持つので、使う側が値を書き換えればそのまま地図に届く） */
export function setTownFocus(target: TownFocus) {
  focus = target
}

/** 注目点（地図の側が読む） */
export function townFocus(): TownFocus {
  return focus
}

/* -------------------------------------------------------------------------- */
/* 扉を開ける物                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 注目点のほかに、自動の扉（見学エントランスのガラスの扉・中のある建物の扉）を開ける物（付いて浮かぶロボットなど）。
 * 使う側の物をそのまま渡す（地図は position を毎コマ読むだけ。参照を持つので、使う側が書き換えればそのまま届く）。
 * 扉の前にいる（中のある建物の扉は水平 0.9m・扉の床から 1m の高さの上下 1.8m の中、見学エントランスはセンサーの 3/4 の距離の中）と開く
 */
export interface TownDoorOpener {
  /** 今の位置（シーン。浮かぶ物は描く位置） */
  readonly position: THREE.Vector3
}

const doorOpeners: TownDoorOpener[] = []

/** 扉を開ける物を足す（やめる関数を返す） */
export function addTownDoorOpener(o: TownDoorOpener): () => void {
  doorOpeners.push(o)
  return () => {
    const i = doorOpeners.indexOf(o)
    if (i >= 0) doorOpeners.splice(i, 1)
  }
}

/** 扉を開ける物の一覧（地図の側が毎コマ読む。足した順。毎コマ同じ配列を返す） */
export function townDoorOpeners(): readonly TownDoorOpener[] {
  return doorOpeners
}

/* -------------------------------------------------------------------------- */
/* 出来事                                                                       */
/* -------------------------------------------------------------------------- */

/** 音を鳴らす所などの位置（シーンの座標） */
export interface TownPoint {
  x: number
  y: number
  z: number
}

/** 地図が知らせる出来事と、その中身 */
export interface TownEventMap {
  /**
   * 注目点の人がラボの外（町・ほかの建物の中）にいる度合い（0〜1。なめらかに）。毎コマ、外の光を決めるときに知らせる
   * （人物の縁の光などをそれに合わせる。同じコマの中で呼ぶので、遅れは出ない）
   */
  outsideness: number
  /** 駅員ロボ（えきもり）が会釈した（位置は頭のあたり） */
  'robot.bow': TownPoint
  /** えきもりが発車の合図をした（右手を上げた。位置は上げた手のあたり） */
  'robot.signal': TownPoint
  /** ホバーがファンを回し始めた（乗る人が腰掛けて回し始めたコマ。位置は機体の 0.3m 上） */
  'hover.spinUp': TownPoint
  /** ホバーが下りて止まった（呼ばれて来た・行き先の近く・すぐ現れた。ファンを止め始める。位置は機体の 0.3m 上） */
  'hover.land': TownPoint
}
export type TownEventName = keyof TownEventMap

type Listener = (e: never) => void
const listeners = new Map<TownEventName, Set<Listener>>()

export const townEvents = {
  /** 出来事を聞く（やめる関数を返す） */
  on<K extends TownEventName>(name: K, fn: (e: TownEventMap[K]) => void): () => void {
    let set = listeners.get(name)
    if (!set) listeners.set(name, (set = new Set()))
    set.add(fn as Listener)
    return () => {
      set.delete(fn as Listener)
    }
  },
  /** 出来事を知らせる（地図の側が呼ぶ。聞いている所をその場で呼ぶ） */
  emit<K extends TownEventName>(name: K, e: TownEventMap[K]) {
    const set = listeners.get(name)
    if (set) for (const fn of set) (fn as (e: TownEventMap[K]) => void)(e)
  },
}

/* -------------------------------------------------------------------------- */
/* 毎コマ                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 町の部品（遠景 outdoor/landscape.ts・外の光 outdoor/outdoorLighting.ts・露出 world/environment/exposure.ts）と町の毎コマの段（world/createTown.ts の
 * town.begin・update・view・exposure・frame）に渡す物（5-5・5-6）。
 * 使う側が毎コマ書き入れて渡す（同じ物を使い回してよい。部品は呼ばれた間だけ読み、持っておかない）。
 * time は描画の時計の秒、dt はこのコマの秒、camera はこのコマに描くふだんのカメラ（床の映り込みなどの別のカメラではない）
 */
export interface TownFrame {
  time: number
  dt: number
  camera: THREE.Camera
  renderer: WebGPURenderer
  scene: THREE.Scene
}
