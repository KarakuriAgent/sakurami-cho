import * as THREE from 'three'
import { TOWN_PLACES } from 'sakurami-cho/core'
import { canStand, directState, goTo, hoverStatus, pickGround, placeAt, travelState, type CharacterVisual } from 'sakurami-cho/character'
import type { FollowCamera, TownStatus } from 'sakurami-cho/world'
import { DEBUG, town, townState, walker } from './town'
import { clearVrm, setHeight, setNormalize, vrmState, type VrmState } from './vrm'
import { groundAtScreen, jumpByKey, keyHook, walkAtScreen, walkToGroundPoint, walkUi } from './walk'
import { alightWheel, boardWheel, callHover, DESTINATION_GROUPS, openTravel, setTravelOptions, stopTravel, travelTo, travelUi, type TravelOptions, type TravelUi } from './travel'
import { putWalker, warpFrames, warpSpots, warpTo, warpUi, type WarpFrame, type WarpUi } from './teleport'
import { clockUi, resetClock, runClock, setClockDate, setClockMinutes, setClockSpeed, stopClock, type ClockUi } from './clock'
import { QUALITY, qualityUrl, type Quality } from './quality'
import { fullHook, mapDebugState, openMap, resetMapStats, setGround } from './townMap'

/**
 * 確かめ用の window.__walker（?debug のときだけ出す。確かめの道具がページの中を読む口。段 6 の区切りごとに広げる）。
 * 6-1: 準備ができたか・様子（町の地図データの状態・描いたコマの数）。6-2: 歩く人・VRM・追うカメラ・描く物の数の様子、立ち寄り先へ置く・歩く、
 * 追うカメラの向き、カメラから頭までの見通し、VRM の設定（身長を合わせるか・身長・外す）。6-3: キーを押す（WASD）・点へ歩く・画面の点を
 * クリックする・地面を拾う・立てるか、様子に WASD・クリックの歩きと案内。6-4: 行き先へ移る（旅程）・取り消す・進め方・行き先の一覧・観覧車に乗る・降りる、
 * 様子に旅程・乗っている乗り物・出来事・町の時刻。6-5: ワープする・ワープ先の一覧、様子にワープ（暗転・跳んだ先・直近のワープのコマの長さ）。
 * put は地図の placeAtPoint で置く（teleport.ts の putWalker）。6-6: 時刻のつまみ（画面と同じ口）、様子に時刻のつまみ・画質・外の光（太陽の向き・灯り）。
 * #8: 跳ぶ（スペースキーと同じ口）、様子に跳ぶ様子。#1: 町の地図（全体の地図を開く・閉じる・行き先を選ぶ・見え方・地面の画を敷く（見比べ用））、様子に町の地図。
 * #9: ホバーを呼ぶ（ボタンと同じ口）、様子にホバー
 */
export interface WalkerDebug {
  /** 町の地図データを読み終えて（か、無いと分かって）、そのあと 30 コマ描いた */
  readonly ready: boolean
  /** 今の様子（写し。JSON にできる形） */
  state(): WalkerState
  /** 歩く人を立ち寄り先へ置く（地図の placeAt。追うカメラは一度に置き直す）。知らない名前なら理由 */
  placeAt(id: string): string | null
  /** 歩く人を立ち寄り先へ歩かせる（地図の goTo。同じゾーンの中だけ）。知らない名前なら理由 */
  goTo(id: string): string | null
  /** 追うカメラの向き・仰ぎ（ラジアン）・離れ（m）を変える（省いた物はそのまま。次のコマで一度に置く） */
  view(o: { yaw?: number; pitch?: number; distance?: number }): void
  /** カメラから歩く人の頭（VRM が無ければ目の高さ）までの線に当たる、描いている物（近い順。歩く人の見た目と、ラボの空気のような奥行きを書かない透けた物は除く） */
  sight(): { distance: number; hits: { name: string; distance: number }[] }
  /** VRM の設定（画面のつまみと同じ） */
  vrm: { normalize(on: boolean): void; height(m: number): void; clear(): void }
  /**
   * キーを ms ミリ秒押す（keys は W・A・S・D の並び。run なら Shift も。キーボードで押すのと同じ口）。離したあと 300ms 待って state()。
   * sim なら ms は歩きを進めた時間（walkTime。コマが遅いときも同じだけ歩く）で、離したあと止まるまで（最大 3 秒）待つ
   */
  press(keys: string, ms: number, run?: boolean, sim?: boolean): Promise<WalkerState>
  /** 跳ぶ（スペースキーと同じ口）。跳び始めたら null、跳べなければ理由。跳ぶ様子は state().walker.jump */
  jump(): string | null
  /** 点（シーンの x, z と、省ければ足元に近い地面の高さ y）へ歩く（クリックと同じ。地面は拾わない）。歩けなければ理由 */
  walkTo(x: number, z: number, y?: number): string | null
  /** Canvas の上の点（左上からの CSS の px）をクリックする（地面を拾って歩く）。拾った点と、歩けなければ理由 */
  click(px: number, py: number): { point: V3 | null; reason: string | null }
  /** Canvas の上の点から地面を拾う（歩かない） */
  pick(px: number, py: number): V3 | null
  /** 歩く人が点に立てるか（地図の canStand。y を省けば歩く人の足元の地面の高さ） */
  canStand(x: number, z: number, y?: number): boolean
  /**
   * 確かめ用: 歩く人を町の点（シーンの x, z）に置く（地図の placeAtPoint。足元は真上から拾ったいちばん上の地面・橋に近い面。拾えなければ y の近く）。
   * 向きは heading（省けばそのまま）。追うカメラも一度に置く（'place'）。中のある建物の中は拾えないので placeAt を使う。暗転しない
   */
  put(x: number, z: number, heading?: number, y?: number): V3
  /** 行き先へ移る（一覧で選ぶのと同じ。同じゾーンなら歩き、ほかは旅程）。省いた進め方は画面の物。始めたら null、だめなら理由 */
  travel(req: { to: string } & Partial<TravelOptions>): string | null
  /** 移動を取り消す（取り消すボタンと同じ） */
  cancel(reason?: string): void
  /** 画面の進め方を変える */
  options(o: Partial<TravelOptions>): void
  /** 行き先の一覧（組ごとの名前） */
  destinations(): { group: string; label: string; ids: string[] }[]
  /** 行き先の一覧を開く・閉じる */
  openList(open: boolean, group?: string): void
  /** 観覧車ソラノワに乗る・降りる（画面のボタンと同じ。降りるの time を省けば進め方の時間） */
  wheel: { board(): string | null; alight(time?: 'real' | 'cut' | 'fast'): string | null }
  /** ホバーを呼ぶ（「ホバーを呼ぶ」のボタンと同じ。#9）。呼んだら null、だめなら理由。様子は state().hover */
  hover(): string | null
  /** ワープする（一覧で選ぶのと同じ。fade を false にすると暗転せずにすぐ跳ぶ）。跳び始めたら null、だめなら理由。暗転が終わったかは state().teleport.fade */
  teleport(id: string, fade?: boolean): string | null
  /** ワープ先の一覧（地図の townSpots。呼んだときの物。緑電・運河バスは町の地図データを読んでから） */
  spots(): { id: string; kind: string; label: string; place: string | null; zone: string; x: number; z: number; heading: number; refY: number | null }[]
  /** 時刻のつまみ（画面と同じ口。変えたら null、だめなら理由）: 時刻（その日の分）・進める（速さ）・止める・速さ・今に戻す・日付 */
  clock: { minutes(m: number): string | null; run(speed?: number): string | null; stop(): string | null; speed(s: number): string | null; now(): string | null; date(v: string): string | null }
  /** 画質を変えた URL（読み込み直しはしない。確かめの道具が開く） */
  qualityUrl(q: Quality): string
  /**
   * 町の地図（#1）: 全体の地図を開く・閉じる（ミニマップを押す・Esc と同じ口）・行き先を選ぶ（点を押すのと同じ。開いている間だけ）・
   * 見え方（中心の町の平面座標 x = 東・y = 北と、縮尺 CSS px / m）・地面の画を下に敷く・やめる（見比べ用。既定は敷く）・数を 0 に戻す
   */
  map: { open(on: boolean): void; select(id: string | null): void; view(o: { cx?: number; cy?: number; k?: number }): void; ground(on: boolean): void; resetStats(): void }
}

type V3 = [number, number, number]

/** __walker.state() の形 */
export interface WalkerState {
  /** 町の地図データの読み込みの状態と知らせの字（createTown の onStatus） */
  town: { status: TownStatus; message: string }
  /** 描いたコマの数と、歩きを進めた時間の合計（秒。コマごとの dt は 0.1 秒まで） */
  frames: number
  walkTime: number
  /** 歩く人（足元の位置・足元の地面・そこに立てるか（canStand）・向き・速さ・歩幅・時間の倍率（旅程の早送り）・ゾーン・階・動きの段階・今いる立ち寄り先・外か・建物の中か・置き直した回数・跳ぶ様子（段階・地面からの高さ・跳んだ回数）） */
  walker: { position: V3; ground: number; stand: boolean; heading: number; speed: number; stride: number | null; timeScale: number; zone: string; level: number; phase: string; stopId: string | null; outside: boolean; indoor: boolean; placeSerial: number; jump: { phase: string; height: number; serial: number } }
  /** WASD・クリックの歩き（地図の directState: 向きの入力・走るか・行き先と残り・動かしているか）と、出している案内の字 */
  direct: ReturnType<typeof directState> & { notice: string | null }
  /** VRM（vrm.ts の様子と、地図の見た目の状態・待機と歩きと跳ぶ .vrma・頭の位置・縁の光の素材の数） */
  vrm: VrmState & { visual: string | null; idleClip: boolean; walkClip: boolean; jumpClip: boolean; anchorsReady: boolean; head: V3; rimMaterials: number }
  /** 追うカメラ（位置・注視点・向き・仰ぎ・上へ逃がした仰ぎ・欲しい離れ・今の離れ・寄せた理由） */
  camera: { position: V3; target: V3; yaw: number; pitch: number; lift: number; distance: number; current: number; blocker: string | null } | null
  /** 旅程（画面の様子・地図の travelState・乗っている乗り物）と町の時刻（時・UTC のミリ秒。早送り・カットで進む） */
  travel: { ui: Omit<TravelUi, 'events'>; state: ReturnType<typeof travelState>; ride: { phase: string; vehicle: string | null; inside: boolean; boards: number; alights: number }; events: TravelUi['events'] }
  clock: { hours: number; utcMs: number; wallMs: number; ui: ClockUi }
  /** ホバー（地図の hoverStatus。#9）: 様子・今の所（シーンの x, z）と向き・来るまでの秒・呼んだのが歩く人か */
  hover: { phase: string; x: number; z: number; heading: number; arriveInSec: number | null; mine: boolean }
  /** このページの画質（URL の引数）と、外の光（太陽の方位・高度（度）・昼の明るさ・街灯の点き具合） */
  quality: Quality
  sun: { azimuth: number; elevation: number; daylight: number; street: number }
  /** ワープ（暗転・跳んだ先と回数・案内・一覧の組ごとの数・直近のワープのコマ（前のコマからの ms・暗転・幕の不透明度）） */
  teleport: Omit<WarpUi, 'groups'> & { groups: { kind: string; count: number }[]; frames: readonly WarpFrame[] }
  /** 町の地図（材料の様子・全体の地図を開いているか・いる所の字と印・ミニマップ（窓の直径・下絵の中心とずらし・矢印の回り・毎コマの段と描き直しの時間）・全体の地図の見え方） */
  map: ReturnType<typeof mapDebugState>
  /** 描く物の数（three の renderer.info.memory）と JS のヒープ（MB。Chrome だけ） */
  memory: { geometries: number; textures: number; programs: number; heapMB: number | null } | null
}

declare global {
  interface Window {
    __walker?: WalkerDebug
  }
}

/** ページの様子（Scene.tsx の毎コマが書く） */
export const walkerState = { ready: false, frames: 0, walkTime: 0 }

/** 場面の物（scene/ の部品が入れる。確かめの口が読む） */
export const sceneHook: { follow: FollowCamera | null; gl: THREE.WebGLRenderer | null; scene: THREE.Scene | null } = { follow: null, gl: null, scene: null }

const r3 = (v: THREE.Vector3): V3 => [round(v.x), round(v.y), round(v.z)]
const round = (x: number) => Math.round(x * 1000) / 1000

function state(): WalkerState {
  const m = walker.motion
  const visual = walker.visual as CharacterVisual | null
  const cam = sceneHook.follow
  const gl = sceneHook.gl
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
  return {
    town: { ...townState },
    frames: walkerState.frames,
    walkTime: round(walkerState.walkTime),
    walker: {
      position: r3(m.position),
      ground: round(m.ground),
      stand: canStand(walker, m.position.x, m.position.z, m.ground),
      heading: round(m.heading),
      speed: round(m.speed),
      stride: m.stride === null ? null : round(m.stride),
      timeScale: round(m.timeScale),
      zone: m.zone,
      level: m.level,
      phase: m.phase,
      stopId: m.stopId,
      outside: m.outside,
      indoor: m.indoor,
      placeSerial: m.placeSerial,
      jump: { phase: m.jump.phase, height: round(m.jump.height), serial: m.jump.serial },
    },
    direct: { ...directState(walker), notice: walkUi().notice },
    vrm: {
      ...vrmState(),
      visual: visual?.status ?? null,
      idleClip: !!visual?.rig?.idle,
      walkClip: !!visual?.rig?.walk,
      jumpClip: !!visual?.rig?.jump,
      anchorsReady: walker.anchors.ready,
      head: r3(walker.anchors.head),
      rimMaterials: walker.rim.tuned.length,
    },
    camera: cam
      ? {
          position: r3(cam.camera.position),
          target: r3(cam.target),
          yaw: round(cam.yaw),
          pitch: round(cam.pitch),
          lift: round(cam.lift),
          distance: round(cam.distance),
          current: round(cam.current),
          blocker: cam.blocker,
        }
      : null,
    travel: (() => {
      const { events, ...rest } = travelUi()
      const r = walker.ride
      return { ui: rest, state: travelState(walker), ride: { phase: r.phase, vehicle: r.car?.vehicle.id ?? null, inside: r.inside, boards: r.serials.board, alights: r.serials.alight }, events }
    })(),
    clock: { hours: round(town.sun.time.hours), utcMs: town.sun.time.utcMs, wallMs: Date.now(), ui: clockUi() },
    hover: (() => {
      const h = hoverStatus()
      return { phase: h.phase, x: round(h.x), z: round(h.z), heading: round(h.heading), arriveInSec: h.arriveInSec === null ? null : round(h.arriveInSec), mine: h.summoner === walker }
    })(),
    quality: { ...QUALITY },
    sun: sunState(),
    teleport: (() => {
      const { groups, ...rest } = warpUi()
      return { ...rest, groups: groups.map((g) => ({ kind: g.kind, count: g.items.length })), frames: warpFrames() }
    })(),
    map: mapDebugState(),
    memory: gl ? { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0, heapMB: heap ? round(heap / 1048576) : null } : null,
  }
}

/** 外の光（地図の town.sun）: 太陽の方位（北から時計回り）と高度（度）・昼の明るさ・街灯の点き具合（0〜1） */
function sunState() {
  const o = town.sun
  return { azimuth: round(o.sun.azimuth), elevation: round(o.sun.altitude), daylight: round(o.daylight), street: round(o.lights.street) }
}

/** キーの名前（W・A・S・D）→ 押した所（KeyboardEvent.code） */
const KEY_CODES: Record<string, string> = { W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD' }

/** Canvas の上の点（左上からの CSS の px）→ 画面の点 */
function screenPoint(px: number, py: number) {
  const el = sceneHook.gl?.domElement
  const cam = sceneHook.follow?.camera
  if (!el || !cam) return null
  const r = el.getBoundingClientRect()
  return { el, cam, x: r.left + px, y: r.top + py }
}

const unknownPlace = (id: string) => (id in TOWN_PLACES ? null : `知らない立ち寄り先: ${id}`)

/** カメラから頭までの線に当たる物（歩く人の見た目・仮の体・見えない物・奥行きを書かない透けた物・線や点は数えない） */
function sight() {
  const cam = sceneHook.follow
  const scene = sceneHook.scene
  if (!cam || !scene) return { distance: 0, hits: [] }
  const from = cam.camera.getWorldPosition(new THREE.Vector3())
  const to = walker.anchors.ready && walker.visual ? walker.anchors.head.clone() : cam.target.clone()
  const dir = to.clone().sub(from)
  const distance = dir.length()
  const ray = new THREE.Raycaster(from, dir.normalize(), 0, Math.max(0, distance - 0.05))
  const own = new Set<THREE.Object3D>()
  const visual = walker.visual
  if (visual) visual.object.traverse((o) => own.add(o))
  scene.getObjectByName('walker-placeholder')?.traverse((o) => own.add(o))
  const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent))
  const hits = ray
    .intersectObjects(scene.children, true)
    .filter((h) => (h.object as THREE.Mesh).isMesh && !own.has(h.object) && shown(h.object) && !airy(h.object as THREE.Mesh))
    .slice(0, 8)
    .map((h) => ({ name: nameOf(h.object), distance: round(h.distance) }))
  return { distance: round(distance), hits }
}

/** 奥行きを書かない透けた物（ラボの空気・光の筋など。さえぎらない） */
function airy(mesh: THREE.Mesh): boolean {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return mats.every((m) => m.transparent && !m.depthWrite)
}

/** 物の名前（無ければ親の名前を上へたどる） */
function nameOf(o: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name) return p.name
  return o.type
}

if (DEBUG) {
  window.__walker = {
    get ready() {
      return walkerState.ready
    },
    state,
    placeAt(id) {
      const err = unknownPlace(id)
      if (!err) {
        stopTravel('置き直す')
        placeAt(walker, id)
      }
      return err
    },
    goTo(id) {
      const err = unknownPlace(id)
      if (!err) goTo(walker, id)
      return err
    },
    view(o) {
      const cam = sceneHook.follow
      if (!cam) return
      if (o.yaw !== undefined) cam.yaw = o.yaw
      if (o.pitch !== undefined) cam.pitch = o.pitch
      if (o.distance !== undefined) cam.distance = o.distance
      cam.snap()
    },
    sight,
    vrm: { normalize: setNormalize, height: setHeight, clear: clearVrm },
    async press(keys, ms, run = false, sim = false) {
      const input = keyHook.keys
      if (!input) return state()
      const codes = [...keys.toUpperCase()].map((k) => KEY_CODES[k]).filter((c): c is string => !!c)
      if (run) codes.push('ShiftLeft')
      const sleep = (t: number) => new Promise((r) => setTimeout(r, t))
      if (!sim) {
        await Promise.all(codes.map((c) => input.hold(c, ms)))
        await sleep(300)
        return state()
      }
      const t0 = walkerState.walkTime
      for (const c of codes) void input.hold(c, Infinity)
      while (walkerState.walkTime - t0 < ms / 1000) await sleep(20)
      for (const c of codes) input.release(c)
      const end = performance.now() + 3000
      while (performance.now() < end && directState(walker).active) await sleep(50)
      return state()
    },
    jump: () => jumpByKey(),
    walkTo: (x, z, y) => walkToGroundPoint(x, z, y),
    click(px, py) {
      const s = screenPoint(px, py)
      if (!s) return { point: null, reason: '場面がまだありません' }
      const p = groundAtScreen(s.cam, s.el, s.x, s.y)
      return { point: p ? r3(p) : null, reason: walkAtScreen(s.cam, s.el, s.x, s.y) }
    },
    pick(px, py) {
      const s = screenPoint(px, py)
      const p = s ? groundAtScreen(s.cam, s.el, s.x, s.y) : null
      return p ? r3(p) : null
    },
    canStand: (x, z, y) => canStand(walker, x, z, y),
    put(x, z, heading, y) {
      const top = pickGround(new THREE.Ray(new THREE.Vector3(x, 600, z), new THREE.Vector3(0, -1, 0)))
      putWalker(x, z, heading ?? walker.motion.heading, top?.y ?? y ?? null)
      return r3(walker.motion.position)
    },
    travel: ({ to, ...over }) => travelTo(to, over),
    cancel: (reason) => stopTravel(reason),
    options: (o) => setTravelOptions(o),
    destinations: () => DESTINATION_GROUPS.map((g) => ({ group: g.id, label: g.label, ids: g.items.map((d) => d.id) })),
    openList: (open, group) => openTravel(open, group ?? null),
    wheel: { board: () => boardWheel(), alight: (time) => alightWheel(time) },
    hover: () => callHover(),
    teleport: (id, fade = true) => warpTo(id, fade),
    clock: { minutes: setClockMinutes, run: (sp) => runClock(sp), stop: stopClock, speed: setClockSpeed, now: resetClock, date: setClockDate },
    qualityUrl: (q) => qualityUrl(q, { time: null, date: null }),
    map: {
      open: (on) => openMap(on),
      select: (id) => fullHook.select?.(id),
      view(o) {
        if (o.cx !== undefined) fullHook.cx = o.cx
        if (o.cy !== undefined) fullHook.cy = o.cy
        if (o.k !== undefined) fullHook.k = o.k
        fullHook.redraw?.()
      },
      ground: (on) => setGround(on),
      resetStats: resetMapStats,
    },
    spots: () => warpSpots().map((s) => ({ id: s.id, kind: s.kind, label: s.label, place: s.place, zone: s.zone, x: round(s.x), z: round(s.z), heading: round(s.heading), refY: s.refY === null ? null : round(s.refY) })),
  }
}
