import * as THREE from 'three'
import { SITE } from '../../../core/town'
import { LIGHT_KIND, type LightItem } from '../town/lights'
import { Fleet, placeMatrix } from './fleet'
import { Path, pathPoint, type TownTransit } from './transitData'
import { boatNet } from './boats'
import { tramNet } from './trams'
import type { VehicleShapes } from './vehicles'

/**
 * 浮遊レーン（vol3 4-7。地上 5m 以下の浮遊機器の通り道。街灯の柱のレーン灯（青緑の小さな灯）、夜は点滅）。
 * 設定に浮遊機器の数は無いので、控えめに: 1 本のレーンに 300m に 1 機ほどの配送の浮遊機が 4.5m/s で行き来する（向きは交互）。
 * レーン灯は 40m ごとの小さな光の点（夜だけ、ゆっくり点滅）。浮遊機はカメラから 900m までだけ描く。
 * レーンは緑電の通りや運河の上も通るので、緑電の編成・運河バスのそばでは、その屋根の上へ浮き上がって越える（車室の中を通り抜けない。town.md §7 の 206）
 */

const SPEED = 4.5
const SPACING = 300
/** 配送機の速さ（m/s）と、行き来する向きで左右に分ける幅（レーンの真ん中から。進む向きの左。花音のホバーも同じ。character/ride/hoverRide.ts） */
export const LANE_SPEED = SPEED
export const LANE_OFFSET = 1.2

/** レーン 1 本（線・配送機の数・時刻のずれ） */
export interface LaneTrack {
  id: string
  name: string
  path: Path
  n: number
  phase: number
}

/** 町の浮遊レーン（交通を作ったときに入る。ホバーの一人乗りが読む） */
export const laneNet = { lanes: [] as LaneTrack[], byId: new Map<string, LaneTrack>() }

const _dp = pathPoint()

/**
 * 配送機 k の時刻 t（その日の 0 時からの秒）の位置（シーンの座標。out）と、レーンの上の長さ d・進む向き back（+1 = 長さの増える向き）。
 * 端で折り返す往復（三角波）。行き来する向きで左右に分ける（進む向きの左）
 */
export function droneOnLane(lane: LaneTrack, k: number, t: number, out: THREE.Vector3) {
  const L = lane.path.length
  const dir = k % 2 === 0 ? 1 : -1
  const u = ((t * SPEED) / L + k / lane.n + lane.phase) % 2
  const f = u < 1 ? u : 2 - u
  const d = (dir > 0 ? f : 1 - f) * L
  lane.path.at(d, _dp)
  const back = (u < 1 ? 1 : -1) * dir
  const off = back * LANE_OFFSET
  const x = _dp.x - _dp.dy * off
  const y = _dp.y + _dp.dx * off
  out.set(x, _dp.z + 0.12 * Math.sin(t * 1.7 + k) - SITE.labFloorElevation, -y)
  return { d, back, dx: _dp.dx * back, dy: _dp.dy * back }
}

const _p = pathPoint()
const _m = new THREE.Matrix4()
const _cam = new THREE.Vector3()
const _info: [number, number, number, number] = [1, 0, 0, 0]
const _w = new THREE.Vector3()
const _l = new THREE.Vector3()
const _inv = new THREE.Matrix4()

/** 前後左右 3m で 0 → 1 */
const fade = (out: number) => 1 - THREE.MathUtils.smoothstep(out, 0, 3)

/**
 * シーンの点 w（浮遊機）を、緑電の編成・運河バスの屋根の上（0.9m 上）まで持ち上げる高さ（m）。
 * 車体の箱（局所）から外へ離れるほど小さく（3m で 0）
 */
function vehicleLift(w: THREE.Vector3) {
  let lift = 0
  for (const r of tramNet.fleet?.runs ?? []) {
    if (Math.abs(r.center.x - w.x) > 20 || Math.abs(r.center.z - w.z) > 20) continue
    for (const m of r.sections) {
      _l.copy(w).applyMatrix4(_inv.copy(m).invert())
      const out = Math.max(Math.abs(_l.x) - 1.25, Math.abs(_l.z) - 4.9, 0)
      if (out >= 3) continue
      lift = Math.max(lift, (3.5 + 0.9 - _l.y) * fade(out))
    }
  }
  for (const b of boatNet.fleet?.runs ?? []) {
    if (Math.abs(b.center.x - w.x) > 14 || Math.abs(b.center.z - w.z) > 14) continue
    _l.copy(w).applyMatrix4(_inv.copy(b.matrix).invert())
    const out = Math.max(Math.abs(_l.x) - 1.85, Math.abs(_l.z) - 7.6, 0)
    if (out >= 3) continue
    lift = Math.max(lift, (2.8 + 0.9 - _l.y) * fade(out))
  }
  return lift
}

export class LaneFleet {
  readonly fleet: Fleet
  private lanes: LaneTrack[] = []
  /** レーン灯（光の点） */
  readonly lights: LightItem[] = []

  constructor(transit: TownTransit, shapes: VehicleShapes, material: THREE.Material) {
    let total = 0
    transit.lanes.forEach((l, li) => {
      if (l.pts.length < 2) return
      const path = new Path(l.pts, 4, false)
      const n = Math.max(1, Math.floor(path.length / SPACING))
      const track: LaneTrack = { id: l.id, name: l.name, path, n, phase: li * 0.37 }
      this.lanes.push(track)
      total += n
      // レーン灯（40m ごと。レーンの高さより少し低い柱の上）
      for (let d = 10; d < path.length; d += l.spacing) {
        path.at(d, _p)
        this.lights.push({ x: _p.x - _p.dy * 4, y: _p.y + _p.dx * 4, z: _p.z - 0.6, kind: LIGHT_KIND.lane, color: '#7fdcc0', size: 0.18, power: 1.2, seed: ((d * 0.013 + li * 0.21) % 1 + 1) % 1 })
      }
    })
    this.fleet = new Fleet('drone', shapes.drone, null, material, total + 4, 1e9)
    laneNet.lanes = this.lanes
    laneNet.byId = new Map(this.lanes.map((l) => [l.id, l]))
  }

  get meshes() {
    return this.fleet.meshes
  }

  update(t: number, camera: THREE.Camera) {
    camera.getWorldPosition(_cam)
    this.fleet.begin()
    for (const lane of this.lanes) {
      for (let k = 0; k < lane.n; k++) {
        // 端で折り返す往復（三角波）。行き来する向きで左右に分ける
        const st = droneOnLane(lane, k, t, _w)
        const dist = _w.distanceTo(_cam)
        if (dist > 900) continue
        // 緑電・運河バスのそばでは屋根の上へ
        const z = _w.y + SITE.labFloorElevation + vehicleLift(_w)
        placeMatrix(_m, _w.x, -_w.z, z, st.dx, st.dy, 0, true, 0.04 * Math.sin(t * 1.3 + k), 0)
        _info[3] = (k * 0.41) % 1
        this.fleet.add(_m, _info, dist)
      }
    }
    this.fleet.end()
  }
}
