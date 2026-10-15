import type * as THREE from 'three'
import { setLabDate, setLabTime, townWarp, type DateParts } from '../core/clock'
import { outdoor, updateOutdoor, type Outdoor } from './environment/daylight'
import { createExposure } from './environment/exposure'
import { townPlaces, type PlaceId, type TownPlace } from '../core/places'
import { townWalk } from './walk/townWalk'
import { createLab, type Lab, type LabOptions } from './lab/createLab'
import { labLighting, type LabLightInput } from './labLight'
import { sharedTime } from './materials/shared'
import { landscape } from './outdoor/landscape'
import { outdoorLights } from './outdoor/outdoorLighting'
import { updateStars } from './outdoor/sky'
import { transitClock, updateTransitClock } from './outdoor/transit/clock'
import { soranowaHeld } from './outdoor/town/soranowaVehicle'
import { updateWheel } from './outdoor/town/soranowaWheel'
import {
  addTownDoorOpener,
  configureTown,
  setTownFocus,
  townEvents,
  townHighQuality,
  townOptions,
  type TownClock,
  type TownDoorOpener,
  type TownEventMap,
  type TownEventName,
  type TownFocus,
  type TownFrame,
  type TownOptions,
} from './townHost'

/**
 * 町の口（docs/design/map-split.md §7 の「段 5 の作りの決めごと」・「5-6 で作った形」。案の §2.1）。地図（町・ラボ・外の光・遠景・交通の時計）を
 * 使う側から 1 つの物として扱う。町は 1 ページに 1 つ（外の状態・交通の時計・観覧車・町のデータ・中のある建物・明るさの入力がモジュールに 1 つずつ
 * あるため。2 つ目を作ると例外）。
 *
 * 「口を作る」と「形を作る」を分ける:
 * - createTown(options): 地図の引数（configureTown）を入れて、口と状態だけを作る（three の描く物・素材は作らない）。町の時計は、ラボのテクスチャを
 *   待つ間も begin で進める
 * - buildLab(o): ラボを作る（ラボのテクスチャを読んでから。world/lab/createLab.ts。何度呼んでもよく、作るたびに新しいラボ。どれを毎コマ動かすかは attach で決める）
 * - buildOutdoor(): 外の光（太陽 → 太陽の target → 空の光 → trigger）と遠景の根（子は空の球・星・町の群）。初めて呼んだときに作り、あとは同じ物
 *   （作り直さず、捨てない）。作る順はラボのあと（素材の id の並びを前に合わせる）
 * - attach(lab, camera): 場面に付ける（照明の撮影と環境の強さ → ふだんのカメラに遠景のレイヤー → 殻の太陽の影の印と光のにじみ → 殻と什器の
 *   動かない物を合わせる（lab.mergeStatic））。外す関数を返す
 * - start(): ?debug の道具を出して、地図データを読み始める（attach のあと）
 *
 * 毎コマは 4 つの段に分ける（間に使う側の物が挟まるため。kanon-lab では花音（−58）・配信の明るさ（−60）・カメラ（−1・15）・撮影の構図（0.5））。
 * 順に頼らない使う側は frame(f) で 4 つを続けて呼ぶ:
 * 1. begin(f): 共有の時計（sharedTime）→ 早送り・カットの分を町の時刻へ → 外の状態 → 交通の時計 → 観覧車（乗る人を動かす前。形が無くても進める）
 * 2. update(f): 遠景（町を組み立てる・影・中のある建物・交通・灯り）→ 外の光（外にいる度合いを知らせる）（注目点を動かしたあと、カメラの前）
 * 3. view(f): ラボの照明 → 星 → 遠景の窓の見え隠れと細かさの中心 → 什器の見え隠れ（lab.cull）→ 殻（床の映り込み・見学エントランスの扉）→
 *    什器のキット（カメラを動かしたあと）
 * 4. exposure(f): 露出（撮影の構図・揺れのあと、描く前）
 *
 * ラボの明るさの入力は、前のままモジュールに 1 つ（world/labLight.ts）で、口は setLabLight
 */

/** createTown の引数（地図の引数 TownOptions。足りない項目は既定のまま。world/townHost.ts の configureTown と同じ） */
export type TownCreateOptions = Partial<Omit<TownOptions, 'clock'>> & { clock?: Partial<TownClock> }

/** buildLab の引数（品質を省けば地図の引数の quality） */
export type TownLabOptions = Omit<LabOptions, 'quality'> & { quality?: LabOptions['quality'] }

/** 外の光と遠景（場面の直下に、lights をこの順で、そのあとに landscape を置く） */
export interface TownOutdoor {
  /** 太陽 → 太陽の target → 空の光 → trigger（太陽の影の地図を描く物） */
  readonly lights: readonly THREE.Object3D[]
  /** 遠景の根の群（子は空の球・星・町の群） */
  readonly landscape: THREE.Object3D
}

export interface Town {
  /** 地図の引数（createTown で入れた物と既定） */
  readonly options: Readonly<TownOptions>
  /** 立ち寄り先の表（使う側が configurePlaces で渡した表。渡していなければ地図の表） */
  readonly places: Readonly<Record<PlaceId, TownPlace>>
  /** 町を歩く仕組み（道のグラフ・石段・橋の路面。world/walk/townWalk.ts） */
  readonly walk: typeof townWalk
  /** 外の状態（太陽・空・町の灯り・部屋に入る外の光。begin で毎コマ計算する。world/environment/daylight.ts） */
  readonly sun: Outdoor

  /** 注目点を入れる（参照を持つ。world/townHost.ts の setTownFocus） */
  setFocus(target: TownFocus): void
  /** 注目点のほかに扉を開ける物を足す（やめる関数を返す） */
  addDoorOpener(o: TownDoorOpener): () => void
  /** 町の出来事を聞く（やめる関数を返す。outsideness・robot.bow など） */
  on<K extends TownEventName>(name: K, fn: (e: TownEventMap[K]) => void): () => void
  /** 町の時刻を固定する（'HH:MM' か時。null で今の時刻。speed は 1 秒に進む時間（0 で止める）。core/clock.ts の setLabTime） */
  setTime(value: string | number | null, speed?: number): void
  /** 町の日付を固定する（'YYYY-MM-DD'。null で今日。setLabDate） */
  setDate(value: string | DateParts | null): void
  /** ラボの照明の明るさの入力（毎コマ、ラボの照明の更新の前に。world/labLight.ts の labLighting.set） */
  setLabLight(input: LabLightInput): void

  /** ラボを作る（ラボのテクスチャを読んでから） */
  buildLab(o: TownLabOptions): Lab
  /** 外の光と遠景（初めて呼んだときに作る。あとは同じ物） */
  buildOutdoor(): TownOutdoor
  /** 場面に付ける（毎コマ動かすラボを lab にする）。外す関数を返す */
  attach(lab: Lab, camera: THREE.Camera): () => void
  /** ?debug の道具を出して、地図データを読み始める（attach のあと。何度呼んでもよい） */
  start(): void

  /** 毎コマ 1: 時計と外の状態 */
  begin(f: TownFrame): void
  /** 毎コマ 2: 遠景と外の光 */
  update(f: TownFrame): void
  /** 毎コマ 3: カメラを動かしたあと（ラボ・星・遠景の窓・殻・什器） */
  view(f: TownFrame): void
  /** 毎コマ 4: 露出 */
  exposure(f: TownFrame): void
  /** 毎コマの 4 つの段を続けて（順に頼らない使う側） */
  frame(f: TownFrame): void
}

let created = false

/** 町を作る（口と状態だけ。three の描く物は buildLab・buildOutdoor で作る）。1 ページに 1 つ */
export function createTown(options: TownCreateOptions = {}): Town {
  if (created) throw new Error('[town] createTown は 1 ページに 1 回だけ呼んでください（町の状態はモジュールに 1 つ）')
  created = true
  configureTown(options)

  /** 毎コマ動かすラボ（attach で入れ、外したら空に） */
  let lab: Lab | null = null
  /** 外の光と遠景を作ったか（作る前の update・view は外の部品を動かさない。作る順を変えないため） */
  let outdoorBuilt: TownOutdoor | null = null
  const exposure = createExposure()

  const town: Town = {
    get options() {
      return townOptions()
    },
    get places() {
      return townPlaces()
    },
    walk: townWalk,
    sun: outdoor,

    setFocus: setTownFocus,
    addDoorOpener: addTownDoorOpener,
    on: (name, fn) => townEvents.on(name, fn),
    setTime: (value, speed) => setLabTime(value, speed),
    setDate: (value) => setLabDate(value),
    setLabLight: (input) => labLighting.set(input),

    buildLab(o) {
      return createLab({ ...o, quality: o.quality ?? (townHighQuality() ? 'high' : 'low') })
    },
    buildOutdoor() {
      if (!outdoorBuilt) {
        // 作る順は外の光 → 空の球と星 → 遠景の群（前の OutdoorLighting・Landscape の描く順）
        const lights = outdoorLights()
        outdoorBuilt = { lights: lights.objects, landscape: landscape().object }
      }
      return outdoorBuilt
    },
    attach(next, camera) {
      town.buildOutdoor()
      lab = next
      // 前の LabLights・Landscape・LabShell の layout effect の順（明るさが入るたびに呼ぶ物の並びも、照明の環境の強さ → 殻の光のにじみ）
      const offLighting = next.lighting.attach()
      landscape().attach(camera)
      const offShell = next.shell.attach()
      // 動かない物を合わせる（殻の太陽の影の印のあと、最初に描く前。WebGPU への移行の第 3 段。2 回目からは何もしない）
      next.mergeStatic()
      return () => {
        offLighting()
        offShell()
        if (lab === next) lab = null
      }
    },
    start() {
      landscape().start()
    },

    begin(f) {
      // 自作シェーダーの共有の時計（町の遠景・ラボの部品の素材が読む。前は kanon-lab の ShaderClock（−200）が書いていた。間に読む物は無い）
      sharedTime.value = f.time
      // 早送り・カットの分を町の時刻へ（いつ早送りするかは使う側。kanon-lab は character/ride/warp.ts）
      townWarp.apply(f.time)
      // 日本時間から外の状態（太陽・空・町の灯り・部屋に入る外の光）
      updateOutdoor()
      // 交通の時計（描画の時計のまま。1 秒までに抑えるのは時計の側）と、ホイールの角度（人が乗っている間は営業時間の外も回す）
      updateTransitClock(f.dt)
      updateWheel(transitClock.sec, soranowaHeld())
    },
    update(f) {
      if (!outdoorBuilt) return
      landscape().update(f)
      outdoorLights().update(f)
    },
    view(f) {
      if (lab) lab.lighting.update(f.dt, f)
      if (outdoorBuilt) {
        updateStars(f.renderer)
        landscape().updateView(f)
      }
      if (lab) {
        // 什器を見えないコマだけ描かない（カメラを動かしたあと、殻（床の映り込み）と什器の前。WebGPU への移行の第 3 段）
        lab.cull.update(f.camera)
        lab.shell.update(f.dt, f)
        lab.kits.update(f.dt, f)
      }
    },
    exposure(f) {
      exposure.update(f)
    },
    frame(f) {
      town.begin(f)
      town.update(f)
      town.view(f)
      town.exposure(f)
    },
  }
  return town
}
