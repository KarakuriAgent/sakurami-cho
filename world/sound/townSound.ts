import * as THREE from 'three'
import { CABLE_STATIONS, stationScene } from '../../core/cableStations'
import { townWarp } from '../../core/clock'
import { boatNet } from '../outdoor/transit/boats'
import { cableTrack } from '../outdoor/transit/cable'
import { CABLE_RUN, CABLE_TRIPS, cableInService, cableTrip, tripStart } from '../../core/transit/cableRun'
import { transitClock } from '../outdoor/transit/clock'
import { hoverCraft } from '../outdoor/transit/hoverCraft'
import { droneOnLane, laneNet } from '../outdoor/transit/lanes'
import { tramNet } from '../outdoor/transit/trams'
import type { Car } from '../outdoor/transit/vehicle'
import { townFocus, townOptions } from '../townHost'
import { listenTownCues, soundCues } from './cues'
import { loopBuffer, oneShotBuffer, warmSounds, type LoopId, type OneShotId } from './synth'

/**
 * 交通と駅の音（docs/design/film-mode.md §10・town.md §20・§7 の 200〜）。地図の町の音（docs/design/map-split.md §7「5-3 で作った形」）。
 *
 * 毎コマ、聞く所（カメラ）のまわりの交通の様子から「鳴っている音（くり返す音）」と「鳴らす音（一度だけ）」を決める（sound.update）:
 * - 丘ノ上ケーブル: 発車ベル（発車の 12 秒前。vol2「ケーブルカーの発車ベル」）・着いたときの駅の放送のチャイム・扉の開け閉め・走る音・綱車のきしみ・
 *   頂上駅の巻き上げ機の低い唸り
 * - 緑電: 発車の「チンチン」（発車の 1.5 秒前）・扉のチャイムと開け閉め・モーター・車輪とレールの継ぎ目・止まっている間の補機
 * - 運河バス: 静かな電気のモーター・波を切る音・水の音・発車の汽笛・扉・下の段に着く小さな当たり
 * - 駅員ロボ: 会釈の小さな音・発車の合図（地図の出来事 robot.bow・robot.signal を、world/sound/cues.ts が音の合図にする）
 * - ホバーの一人乗り: ファンの唸り（回り・速さで高さ）・飛ぶ間の風・回す / 止める / 下りて止まる音（出来事 hover.spinUp・hover.land の合図）。
 *   浮遊レーンの配送機の小さな羽音（カメラから 40m）
 * 音の強さは距離で小さく（近い所の基準の距離 ÷ 距離。遠いほど高い音が減る）、カメラの右・左で振り分ける。聞く所の便（既定は地図の注目点の便）の
 * 車室の中にカメラがあれば、外の音はこもって小さく、乗っている車室の響き（cabin）を足す。早送りの間は小さく、カット・早送りの間の一度だけの音は鳴らさない。
 *
 * 使う側は createTownSound で 1 つ作り、毎コマ（交通・人・カメラを動かしたあと）update(camera) を呼ぶ:
 * - live: 使う側の AudioContext（context）で鳴らす（出口の音量 = gain() × 早送りの下げ。on() が false なら 0）
 * - record: 鳴らさずに、地図のシーンの時計（townOptions().clock.sceneTime）で「いつ・何を・どの強さで」を記録し、撮り終えたら
 *   OfflineAudioContext で同じ素材から書き出す（render のあと chunk で取り出す）。素材は world/sound/synth.ts で式から作る（権利の心配が無い）
 * 状態・記録・書き出しの持ち物はモジュールに 1 つ（町と同じく 1 ページに 1 つ。2 つ目を作ると例外）
 */

/** 町の音を作るときの引数 */
export interface TownSoundOptions {
  /** live = その場で鳴らす、record = 鳴らさずに記録して、あとで書き出す（撮影） */
  mode: 'live' | 'record'
  /** live で鳴らす AudioContext（鳴らす設定のときに、まだ作っていなければ毎コマ呼ぶ。null ならそのコマは鳴らさない）。省けば鳴らさない */
  context?: () => AudioContext | null
  /** 鳴らすか（false なら出口の音量 0。live は AudioContext を求めない）。省けば鳴らす */
  on?: () => boolean
  /** 出口の音量（町はこれに早送りの下げ（倍率 > 1.6 で 0.45）を掛ける）。省けば 1 */
  gain?: () => number
  /** 聞く所の便（カメラがこの便の車室の中なら、外の音をこもらせて車室の響きを足す）。省けば地図の注目点の便（townFocus().ride.car） */
  listenerCar?: () => Car | null
}

/** 町の音の様子 */
export interface TownSoundInfo {
  /** record = 記録している、playing = 鳴らしている、blocked = AudioContext が止まっている（自動再生の制限）、idle = まだ鳴らしていない */
  mode: 'record' | 'playing' | 'blocked' | 'idle'
  /** record のときの記録の数と、最後の一度だけの音 */
  recorded: { loops: number; events: number; last_event: { t: number; id: OneShotId; p: Params } | null } | null
}

/** 町の音（createTownSound が返す物） */
export interface TownSound {
  /** 毎コマ（交通・人・カメラを動かしたあと） */
  update(camera: THREE.Camera): void
  /** 様子 */
  info(): TownSoundInfo
  /** 記録の中身（確かめ用。一度だけの音の時刻と種類） */
  events(): { t: number; id: OneShotId; gain: number }[]
  /** 記録した音を、シーンの時計の t0 から seconds 秒、48kHz の 2 チャンネルに書き出す（返り値は長さなど。中身は chunk で） */
  render(t0: number, seconds: number): Promise<{ rate: number; frames: number; chunks: number; peak: number; rms: number; loops: number; events: number }>
  /** 書き出した音の i 番目の 10 秒（2 チャンネルを交互に並べた 16 bit を base64 で） */
  chunk(i: number): string
}

interface Params {
  gain: number
  rate: number
  cutoff: number
  pan: number
}

/* -------------------------------------------------------------------------- */
/* 聞く所と距離                                                                     */
/* -------------------------------------------------------------------------- */

const _cam = new THREE.Vector3()
const _right = new THREE.Vector3()
const _d = new THREE.Vector3()
const _l = new THREE.Vector3()

/** カメラが乗り物の車室の中か（乗っている間） */
let camInside = false

/** 音源の位置 p の、聞こえ方（ref = この距離まではそのままの強さ、max = ここで消える）。聞こえなければ null */
function heard(p: THREE.Vector3, base: number, ref: number, max: number, own = false): Params | null {
  _d.subVectors(p, _cam)
  const d = _d.length()
  if (d > max) return null
  let gain = (base * ref) / Math.max(ref, d)
  gain *= 1 - THREE.MathUtils.smoothstep(d, max * 0.65, max)
  let cutoff = 18000 / (1 + d / 45)
  const pan = d > 0.5 ? THREE.MathUtils.clamp(_d.dot(_right) / d, -1, 1) * 0.75 : 0
  if (camInside) {
    // 車室の中: 外の音はこもって小さく。乗っている車両の走る音は、床から伝わる低い音に
    cutoff = Math.min(cutoff, own ? 900 : 1500)
    gain *= own ? 0.75 : 0.45
  }
  return { gain, rate: 1, cutoff, pan }
}

/* -------------------------------------------------------------------------- */
/* 鳴らす仕組み（live: AudioContext / record: 記録）                                    */
/* -------------------------------------------------------------------------- */

interface LiveLoop {
  src: AudioBufferSourceNode
  filter: BiquadFilterNode
  gain: GainNode
  pan: StereoPannerNode
}

/** live（配信）: その場で鳴らす */
class LiveEngine {
  readonly ctx: AudioContext
  private master: GainNode
  private loops = new Map<string, LiveLoop>()
  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(ctx.destination)
    warmSounds(ctx)
  }
  setMaster(v: number) {
    if (!Number.isFinite(v)) return
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.12)
  }
  loop(key: string, id: LoopId, p: Params) {
    let l = this.loops.get(key)
    const now = this.ctx.currentTime
    if (!l) {
      const src = this.ctx.createBufferSource()
      src.buffer = loopBuffer(this.ctx, id)
      src.loop = true
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      const pan = this.ctx.createStereoPanner()
      src.connect(filter).connect(gain).connect(pan).connect(this.master)
      // くり返す音は、同じ音が重ならないよう音源ごとに始めの位置をずらす
      src.start(now, (hashKey(key) % 1000) / 250)
      l = { src, filter, gain, pan }
      this.loops.set(key, l)
    }
    l.src.playbackRate.setTargetAtTime(p.rate, now, 0.08)
    l.filter.frequency.setTargetAtTime(p.cutoff, now, 0.08)
    l.gain.gain.setTargetAtTime(p.gain, now, 0.06)
    l.pan.pan.setTargetAtTime(p.pan, now, 0.08)
  }
  /** このコマに鳴らさなかったくり返す音を止める */
  sweep(seen: Set<string>) {
    for (const [key, l] of this.loops) {
      if (seen.has(key)) continue
      const now = this.ctx.currentTime
      l.gain.gain.setTargetAtTime(0, now, 0.05)
      l.src.stop(now + 0.4)
      l.src.onended = () => l.pan.disconnect()
      this.loops.delete(key)
    }
  }
  fire(id: OneShotId, p: Params) {
    const src = this.ctx.createBufferSource()
    src.buffer = oneShotBuffer(this.ctx, id)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = p.cutoff
    const gain = this.ctx.createGain()
    gain.gain.value = p.gain
    const pan = this.ctx.createStereoPanner()
    pan.pan.value = p.pan
    src.connect(filter).connect(gain).connect(pan).connect(this.master)
    src.start(this.ctx.currentTime + 0.02)
    src.onended = () => pan.disconnect()
  }
  stopAll() {
    this.sweep(new Set())
  }
}

const hashKey = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** record（撮影）: シーンの時計で記録する（くり返す音は値が変わったときと 0.25 秒ごと、一度だけの音は鳴らした時刻） */
interface RecLoop {
  id: LoopId
  /** [t, gain, rate, cutoff, pan, …] */
  pts: number[]
  last: number
  ended: boolean
}

class Recorder {
  loops = new Map<string, RecLoop>()
  events: { t: number; id: OneShotId; p: Params }[] = []
  master: [number, number][] = []
  private lastMaster = -1
  setMaster(t: number, v: number) {
    if (Math.abs(v - this.lastMaster) < 1e-4) return
    this.lastMaster = v
    this.master.push([t, v])
  }
  loop(t: number, key: string, id: LoopId, p: Params) {
    let l = this.loops.get(key)
    if (!l || l.ended) {
      // 一度止まってまた鳴り出した音は、別の音として記録する
      if (l?.ended) this.loops.set(`${key}#${t.toFixed(3)}`, l)
      l = { id, pts: [], last: -1e9, ended: false }
      this.loops.set(key, l)
    }
    const n = l.pts.length
    const changed = n === 0 || Math.abs(l.pts[n - 4] - p.gain) > 0.01 + 0.03 * p.gain || Math.abs(l.pts[n - 3] - p.rate) > 0.01 || Math.abs(l.pts[n - 1] - p.pan) > 0.04 || Math.abs(l.pts[n - 2] - p.cutoff) > 0.08 * p.cutoff
    if (changed || t - l.last > 0.25) {
      l.pts.push(t, p.gain, p.rate, p.cutoff, p.pan)
      l.last = t
    }
  }
  sweep(t: number, seen: Set<string>) {
    for (const [key, l] of this.loops) {
      if (l.ended || seen.has(key) || key.includes('#')) continue
      const n = l.pts.length
      l.pts.push(t, 0, l.pts[n - 4] ?? 1, l.pts[n - 2] ?? 18000, l.pts[n - 1] ?? 0)
      l.ended = true
    }
  }
  fire(t: number, id: OneShotId, p: Params) {
    if (this.events.length < 20000) this.events.push({ t, id, p })
  }
}

let live: LiveEngine | null = null
const recorder = new Recorder()

/* -------------------------------------------------------------------------- */
/* 使う側の引数（createTownSound）                                                  */
/* -------------------------------------------------------------------------- */

/** 作ったか（1 ページに 1 つ） */
let created = false
/** 鳴らし方と、使う側の値（createTownSound で入れる） */
let recording = false
let context: () => AudioContext | null = () => null
let soundOn: () => boolean = () => true
let outGain: () => number = () => 1
/** 聞く所の便（既定は地図の注目点の人が乗っている車室） */
let listenerCar: () => Car | null = () => townFocus().ride.car
/** シーンの時計の秒（記録の時刻。地図の時計の引数） */
const sceneTime = () => townOptions().clock.sceneTime()

/* -------------------------------------------------------------------------- */
/* 毎コマ: 交通の様子から音を決める                                                    */
/* -------------------------------------------------------------------------- */

/** 一度だけの音の前のコマの様子（音源ごと） */
const memo = new Map<string, { door: number; stop: number; t: number }>()
let prevT = -1
const prevCableU = [0, 0]
const cableSpeed = [0, 0]
const _p = new THREE.Vector3()
const _q = new THREE.Vector3()
const seen = new Set<string>()

/** この秒のあいだに、時刻 at を過ぎたか */
const crossed = (t0: number, t1: number, at: number) => t0 < at && at <= t1

function emitLoop(key: string, id: LoopId, p: Params | null, gain: number, rate: number, cutoffMax = 20000) {
  if (!p || gain * p.gain < 1e-3) return
  const q = { gain: p.gain * gain, rate, cutoff: Math.min(p.cutoff, cutoffMax), pan: p.pan }
  // カメラ・車両の位置が一コマ定まらない（NaN）ときは鳴らさない（AudioParam は非有限の値で例外になる）
  if (!Number.isFinite(q.gain + q.rate + q.cutoff + q.pan)) return
  seen.add(key)
  if (recording) recorder.loop(sceneTime(), key, id, q)
  else live?.loop(key, id, q)
}

let eventsOn = true

function emitOnce(id: OneShotId, p: Params | null, gain = 1) {
  if (!p || !eventsOn) return
  const q = { ...p, gain: p.gain * gain }
  if (!(q.gain >= 2e-3) || !Number.isFinite(q.gain + q.rate + q.cutoff + q.pan)) return
  if (recording) recorder.fire(sceneTime(), id, q)
  else live?.fire(id, q)
}

/** 毎コマ（sound.update。交通・人・カメラを動かしたあと） */
function updateTownSound(camera: THREE.Camera) {
  const t = transitClock.serviceSec
  const dtT = prevT < 0 ? 0 : t - prevT
  // カット（町の時刻が 1 秒より跳んだ）・早送り: 一度だけの音は鳴らさない（前の様子も覚え直す）
  const rate = townWarp.rate()
  eventsOn = prevT >= 0 && dtT >= 0 && dtT < 1.0 && rate < 1.6
  if (!eventsOn) memo.clear()
  const t0 = prevT
  prevT = t
  seen.clear()

  // 出口の音量（使う側の入切・音量（kanon-lab は音量 × 話している間の下げ）× 早送りの下げ）
  const on = soundOn()
  const master = on ? outGain() * (rate > 1.6 ? 0.45 : 1) : 0
  if (recording) recorder.setMaster(sceneTime(), master)
  else {
    if (!live && on) {
      const ctx = context()
      if (ctx) live = new LiveEngine(ctx)
    }
    live?.setMaster(master)
  }
  if (!live && !recording) {
    soundCues.length = 0
    return
  }

  camera.getWorldPosition(_cam)
  _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  // 聞く所の便（既定は地図の注目点の人が乗っている車室）
  const car = listenerCar()
  const v = car?.vehicle
  camInside = !!car && car.vehicle.id !== 'soranowa' && car.inside(car.toCabin(_cam, _l), -0.05)

  cableSounds(t, t0, dtT)
  tramSounds(t, t0)
  boatSounds(t, t0)
  hoverSounds()

  // 乗っている車室の響き（カメラが中のとき）
  // （緑電・運河バスの乗っている便は、系統・航路と便で探す）
  if (camInside && car && v) {
    let speed = 0
    if (v.id === 'cable') speed = Math.max(...cableSpeed)
    else if (v.id === 'tram') speed = (typeof car.line === 'number' ? tramNet.fleet?.find(car.line, car.run)?.speed : 0) ?? 0
    else if (v.id === 'waterbus') speed = ((typeof car.line === 'string' ? boatNet.fleet?.find(car.line, car.run)?.speed : 0) ?? 0) * 2
    emitLoop('ride:cabin', 'cabin', { gain: 1, rate: 1, cutoff: 600, pan: 0 }, 0.08 + 0.32 * Math.min(1, speed / 5), 0.8 + speed / 15)
  }

  // 町の物の合図（駅員ロボ・ホバーなど。地図の出来事から。world/sound/cues.ts）
  for (const c of soundCues) emitOnce(c.id, heard(_p.set(c.x, c.y, c.z), 0.55, 2.5, 45), c.gain)
  soundCues.length = 0

  if (recording) recorder.sweep(sceneTime(), seen)
  else live?.sweep(seen)
}

/** 丘ノ上ケーブル */
function cableSounds(t: number, t0: number, dtT: number) {
  const line = cableTrack.line
  if (!line) return
  const rideCar = listenerCar()
  for (let i = 0; i < 2; i++) {
    const c = line.cars[i]
    if (dtT > 0 && dtT < 0.5) cableSpeed[i] += (Math.abs(c.u - prevCableU[i]) / dtT - cableSpeed[i]) * 0.5
    prevCableU[i] = c.u
    _p.setFromMatrixPosition(c.matrix)
    const sp = Math.min(1, cableSpeed[i] / 4.9)
    const own = rideCar?.vehicle.id === 'cable' && rideCar.run === i
    const h = heard(_p, 1, 5, 90, own)
    emitLoop(`cable${i}:rumble`, 'rumble', h, 0.5 * Math.min(1, cableSpeed[i] / 1.5), 0.6 + 0.6 * sp)
    emitLoop(`cable${i}:squeal`, 'squeal', h, 0.1 * Math.min(1, cableSpeed[i] / 1.5), 0.95 + 0.1 * sp, own && camInside ? 800 : 20000)
    // 扉の開け閉め
    const key = `cable${i}`
    const m = memo.get(key)
    if (m) {
      if (m.door < 0.03 && c.door >= 0.03) emitOnce('cableDoor', heard(_p, 0.7, 3, 40, own))
      if (m.door > 0.97 && c.door <= 0.97) emitOnce('cableDoor', heard(_p, 0.7, 3, 40, own))
    }
    memo.set(key, { door: c.door, stop: c.station ? 1 : -1, t })
  }
  // 頂上駅の巻き上げ機（運転の間。車両が走っている間は強く）
  const sd = CABLE_STATIONS['cable-summit']
  const w = stationScene(sd, 34, 0, 2.2)
  _q.set(w[0], w[1], w[2])
  const moving = Math.min(1, Math.max(...cableSpeed) / 1.5)
  emitLoop('cable:winch', 'winch', heard(_q, 1, 6, 75), 0.45 * moving + (cableInService(t) ? 0.05 : 0), 0.85 + 0.15 * moving)
  if (t0 < 0) return
  // 発車ベル（発車の 12 秒前。端の駅は次の便の発車、楓坂駅は行き違いのあとの発車）と、着いたときの駅の放送のチャイム（着いて 3 秒）
  const { k } = cableTrip(t)
  for (const kk of [k, k + 1]) {
    if (kk < 0) continue
    const depEnds = tripStart(kk)
    const depMid = tripStart(kk) + CABLE_RUN.leg + CABLE_RUN.midDwell
    const arrMid = tripStart(kk) + CABLE_RUN.leg
    const arrEnd = tripStart(kk) + CABLE_RUN.trip
    // 端の駅は 2 両がそれぞれの駅に、楓坂駅は 2 両が同じ駅にいるので 1 回（2 両の真ん中）
    const each = (id: OneShotId, base: number, max: number, mid: boolean) => {
      if (mid) emitOnce(id, heard(_p.setFromMatrixPosition(line.cars[0].matrix).add(_q.setFromMatrixPosition(line.cars[1].matrix)).multiplyScalar(0.5), base, 6, max))
      else for (const c of line.cars) emitOnce(id, heard(_p.setFromMatrixPosition(c.matrix), base, 6, max))
    }
    if (kk < CABLE_TRIPS && crossed(t0, t, depEnds - 12)) each('cableBell', 0.9, 110, false)
    if (crossed(t0, t, depMid - 12)) each('cableBell', 0.9, 110, true)
    if (crossed(t0, t, arrMid + 3)) each('announce', 0.6, 70, true)
    if (crossed(t0, t, arrEnd + 3)) each('announce', 0.6, 70, false)
  }
}

/** 緑電（カメラから 150m の編成） */
function tramSounds(t: number, t0: number) {
  const f = tramNet.fleet
  if (!f) return
  // 聞く所の便の編成（系統と便で 1 回だけ引く）
  const rideCar = listenerCar()
  const ownRun = rideCar?.vehicle.id === 'tram' && typeof rideCar.line === 'number' ? f.find(rideCar.line, rideCar.run) : null
  for (const r of f.runs) {
    if (r.center.distanceTo(_cam) > 150) continue
    const key = `tram:${r.line.data.no}:${r.run}`
    const own = r === ownRun
    const h = heard(r.center, 1, 6, 150, own)
    const v = r.speed
    emitLoop(`${key}:rumble`, 'rumble', h, 0.45 * Math.min(1, v / 6), 0.7 + v / 12)
    emitLoop(`${key}:joints`, 'joints', h, 0.4 * Math.min(1, v / 3), THREE.MathUtils.clamp(v / 10, 0.25, 2.2))
    emitLoop(`${key}:motor`, 'tramMotor', h, 0.22 * Math.min(1, v / 1.5), 0.55 + v / 16)
    emitLoop(`${key}:idle`, 'idleHum', h, v < 0.3 ? 0.12 : 0.03, 1)
    // 扉・発車の「チンチン」
    const m = memo.get(key)
    if (m && t0 >= 0) {
      // 扉は開く側の真ん中の両の外
      _q.copy(r.center).add(_l.setFromMatrixColumn(r.sections[1], 0).multiplyScalar(r.doorSide * 1.4))
      if (m.door < 0.02 && r.door >= 0.02) {
        emitOnce('doorChime', heard(_q, 0.55, 3, 45, own))
        emitOnce('doorOpen', heard(_q, 0.6, 3, 40, own))
      }
      if (m.door > 0.98 && r.door <= 0.98) emitOnce('doorClose', heard(_q, 0.6, 3, 40, own))
      if (r.stop >= 0) {
        const list = r.stopDir > 0 ? r.line.outStops : r.line.backStops
        const dep = r.line.deps[r.run] + list[r.stop].depart
        if (crossed(t0, t, dep - 1.5)) emitOnce('tramGong', heard(_p.setFromMatrixPosition(r.sections[0]), 0.8, 6, 120, own))
      }
    }
    memo.set(key, { door: r.door, stop: r.stop, t })
  }
}

/** 運河バス（カメラから 180m の舟） */
function boatSounds(t: number, t0: number) {
  const f = boatNet.fleet
  if (!f) return
  // 聞く所の便の舟（航路と便で 1 回だけ引く）
  const rideCar = listenerCar()
  const ownRun = rideCar?.vehicle.id === 'waterbus' && typeof rideCar.line === 'string' ? f.find(rideCar.line, rideCar.run) : null
  for (const b of f.runs) {
    if (b.center.distanceTo(_cam) > 180) continue
    const key = `boat:${b.route.data.route}:${b.run}`
    const own = b === ownRun
    const h = heard(b.center, 1, 6, 180, own)
    const v = b.speed
    emitLoop(`${key}:motor`, 'boatMotor', h, 0.1 + 0.28 * Math.min(1, v / 3), 0.75 + v / 6)
    emitLoop(`${key}:wake`, 'wake', h, 0.4 * Math.min(1, v / 3), 0.9 + v / 10, own && camInside ? 1200 : 20000)
    emitLoop(`${key}:water`, 'water', h, 0.22, 1)
    const m = memo.get(key)
    if (m && t0 >= 0) {
      _q.copy(b.center).add(_l.setFromMatrixColumn(b.matrix, 0).multiplyScalar(b.doorSide * 1.7))
      if (m.door < 0.02 && b.door >= 0.02) emitOnce('doorOpen', heard(_q, 0.45, 3, 35, own))
      if (m.door > 0.98 && b.door <= 0.98) emitOnce('doorClose', heard(_q, 0.45, 3, 35, own))
      if (m.stop < 0 && b.stop >= 0) emitOnce('boatBump', heard(_q, 0.6, 3, 30, own))
      if (b.stop >= 0) {
        const list = b.stopDir > 0 ? b.route.outStops : b.route.backStops
        const dep = b.route.deps[b.run] + list[b.stop].depart
        if (crossed(t0, t, dep - 3)) emitOnce('horn', heard(b.center, 0.8, 8, 200, own))
      }
    }
    memo.set(key, { door: b.door, stop: b.stop, t })
  }
}

/** 花音のホバー（ファン・風）と、浮遊レーンの配送機の羽音 */
function hoverSounds() {
  if (hoverCraft.ready && hoverCraft.power > 0.01) {
    _p.setFromMatrixPosition(hoverCraft.matrix)
    _p.y += 0.2
    const h = heard(_p, 1, 4, 90)
    const pw = hoverCraft.power
    const v = hoverCraft.speed
    emitLoop('hover:fan', 'hoverFan', h, 0.42 * pw, 0.55 + 0.45 * pw + v / 40)
    // 風は花音のそば（ホバーと一緒に動くカメラ）で聞こえる強さ
    emitLoop('hover:wind', 'wind', h, 0.3 * Math.min(1, v / 4.5), 0.85 + v / 20)
  }
  const t = transitClock.sec
  let n = 0
  for (const lane of laneNet.lanes) {
    for (let k = 0; k < lane.n && n < 4; k++) {
      droneOnLane(lane, k, t, _q)
      if (Math.abs(_q.x - _cam.x) > 40 || Math.abs(_q.z - _cam.z) > 40) continue
      const h = heard(_q, 1, 3, 40)
      if (!h) continue
      emitLoop(`drone:${lane.id}:${k}`, 'droneBuzz', h, 0.16, 1 + ((k * 37) % 7) * 0.012)
      n++
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 撮影の書き出し（OfflineAudioContext）                                            */
/* -------------------------------------------------------------------------- */

const RATE = 48_000
let rendered: { data: [Float32Array, Float32Array]; frames: number } | null = null

/**
 * 記録した音を、シーンの時計の t0 から seconds 秒、48kHz の 2 チャンネルに書き出す（配信と同じ素材・同じつなぎ方）。
 * 返り値は長さだけ（中身は chunk で少しずつ取り出す。ページの外へ一度に大きな値を渡さないため）
 */
async function renderSound(t0: number, seconds: number) {
  const frames = Math.max(1, Math.ceil(seconds * RATE))
  const ctx = new OfflineAudioContext(2, frames, RATE)
  warmSounds(ctx)
  const master = ctx.createGain()
  master.connect(ctx.destination)
  // 出口の音量（入切・音量・話している間・早送り）
  const mp = master.gain
  let m0 = 0
  for (const [t, v] of recorder.master) if (t <= t0) m0 = v
  mp.setValueAtTime(m0, 0)
  for (const [t, v] of recorder.master) {
    const tt = t - t0
    if (tt <= 0 || tt > seconds) continue
    mp.setTargetAtTime(v, tt, 0.12)
  }
  // くり返す音
  for (const [key, l] of recorder.loops) {
    const pts = l.pts
    if (pts.length < 5) continue
    const start = pts[0] - t0
    const end = pts[pts.length - 5] - t0
    if (end < 0 || start > seconds) continue
    const src = ctx.createBufferSource()
    src.buffer = loopBuffer(ctx, l.id)
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    const gain = ctx.createGain()
    const pan = ctx.createStereoPanner()
    src.connect(filter).connect(gain).connect(pan).connect(master)
    // 始めの値（t0 より前に始まった音は、t0 の直前の値から）
    let i0 = 0
    while (i0 + 5 < pts.length && pts[i0 + 5] - t0 <= 0) i0 += 5
    const first = Math.max(0, start)
    gain.gain.setValueAtTime(start >= 0 ? 0 : pts[i0 + 1], first)
    src.playbackRate.setValueAtTime(pts[i0 + 2], first)
    filter.frequency.setValueAtTime(pts[i0 + 3], first)
    pan.pan.setValueAtTime(pts[i0 + 4], first)
    for (let i = i0; i < pts.length; i += 5) {
      const tt = pts[i] - t0
      if (tt <= first) continue
      if (tt > seconds + 0.5) break
      gain.gain.linearRampToValueAtTime(pts[i + 1], tt)
      src.playbackRate.linearRampToValueAtTime(pts[i + 2], tt)
      filter.frequency.linearRampToValueAtTime(pts[i + 3], tt)
      pan.pan.linearRampToValueAtTime(pts[i + 4], tt)
    }
    src.start(first, start >= 0 ? (hashKey(key.split('#')[0]) % 1000) / 250 : ((-start + (hashKey(key) % 1000) / 250) % 4))
    if (end + 0.5 < seconds) src.stop(end + 0.5)
  }
  // 一度だけの音
  for (const e of recorder.events) {
    const tt = e.t - t0 + 0.02
    if (tt > seconds) continue
    const buf = oneShotBuffer(ctx, e.id)
    if (tt + buf.duration < 0) continue
    const src = ctx.createBufferSource()
    src.buffer = buf
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = e.p.cutoff
    const gain = ctx.createGain()
    gain.gain.value = e.p.gain
    const pan = ctx.createStereoPanner()
    pan.pan.value = e.p.pan
    src.connect(filter).connect(gain).connect(pan).connect(master)
    if (tt >= 0) src.start(tt)
    else src.start(0, -tt)
  }
  const buf = await ctx.startRendering()
  rendered = { data: [buf.getChannelData(0), buf.getChannelData(1)], frames }
  let peak = 0
  let sum = 0
  for (const ch of rendered.data)
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > peak) peak = a
      sum += ch[i] * ch[i]
    }
  return { rate: RATE, frames, chunks: Math.ceil(frames / CHUNK), peak, rms: Math.sqrt(sum / (frames * 2)), loops: recorder.loops.size, events: recorder.events.length }
}

const CHUNK = RATE * 10

/** 書き出した音の i 番目の 10 秒（2 チャンネルを交互に並べた 16 bit を base64 で） */
function soundChunk(i: number): string {
  if (!rendered) return ''
  const a = i * CHUNK
  const b = Math.min(rendered.frames, a + CHUNK)
  const out = new Int16Array(Math.max(0, b - a) * 2)
  const [L, R] = rendered.data
  for (let k = a; k < b; k++) {
    const l = Math.max(-1, Math.min(1, L[k]))
    const r = Math.max(-1, Math.min(1, R[k]))
    out[(k - a) * 2] = Math.round(l < 0 ? l * 32768 : l * 32767)
    out[(k - a) * 2 + 1] = Math.round(r < 0 ? r * 32768 : r * 32767)
  }
  const bytes = new Uint8Array(out.buffer)
  let s = ''
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  return btoa(s)
}

/** 様子（kanon-lab は入切・音量と合わせて、状態の返送・__LAB__.sound() に出す） */
function soundInfo(): TownSoundInfo {
  return {
    mode: recording ? 'record' : live ? (live.ctx.state === 'running' ? 'playing' : 'blocked') : 'idle',
    recorded: recording ? { loops: recorder.loops.size, events: recorder.events.length, last_event: recorder.events[recorder.events.length - 1] ?? null } : null,
  }
}

/** 記録の中身（確かめ用。一度だけの音の時刻と種類） */
function soundEvents() {
  return recorder.events.map((e) => ({ t: Math.round(e.t * 1000) / 1000, id: e.id, gain: Math.round(e.p.gain * 1000) / 1000 }))
}

/* -------------------------------------------------------------------------- */
/* 作る                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 町の音を作る（1 ページに 1 つ。2 つ目は例外）。作ったときから、地図の出来事（えきもりの会釈・発車の合図、ホバーの回し始め・着いた）を
 * 音の合図として聞く（world/sound/cues.ts）。AudioContext は作らない（live で鳴らす設定になったコマに context() を呼ぶ）
 */
export function createTownSound(opts: TownSoundOptions): TownSound {
  if (created) throw new Error('[town] 町の音は 1 ページに 1 つです（createTownSound を 2 回呼びました）')
  created = true
  recording = opts.mode === 'record'
  if (opts.context) context = opts.context
  if (opts.on) soundOn = opts.on
  if (opts.gain) outGain = opts.gain
  if (opts.listenerCar) listenerCar = opts.listenerCar
  listenTownCues()
  return { update: updateTownSound, info: soundInfo, events: soundEvents, render: renderSound, chunk: soundChunk }
}
