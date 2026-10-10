import * as THREE from 'three'
import { Fleet, placeMatrix } from './fleet'
import { H, RunProfile, activeRuns, departures, type Headways } from '../../../core/transit/schedule'
import { Path, RAIL_STRUCT, pathPoint, type TransitRail } from './transitData'
import { TRAIN_CAR, TRAIN_GAP, type VehicleShapes } from './vehicles'

/**
 * ヒノテツ東海岸線の電車。vol3 4-2: 快速は日中 12 分間隔、各駅停車は 6 分間隔。町の駅は桜見と鐘ヶ丘（各停だけ）。
 * データに始発・終電が無いので、各停 4:50〜24:40・快速 6:00〜22:00 の発車（線の端のトンネルの口）とし、朝 7 時まで・夜 21 時からは間隔を広げる（§15）。
 * 編成は快速 10 両・各停 6 両（20m の車両）。線は浜ノ宮の側のトンネルの口 → 桜見 → 鐘ヶ丘 → 入江の側のトンネルの口で、下り（入江へ）は長さが増す向き。
 *
 * - 複線の左側を走る（下り = 線の中心の左 +2m・上り = 右 -2m）。桜見の島式ホームでは 1 番線（上り）= 線の中心、2 番線（下り）= 左 13m
 * - 灯町の石造アーチの曲線（半径 160m）とホームの前後は速度を制限する
 * - トンネルの中の車両は描かない
 */

/** 複線の中心からの距離（m） */
const HALF = 2.0
/** 2 番線の線の中心からの距離（m） */
const PLATFORM_TRACK = 13

interface Service {
  cars: number
  stops: string[]
  dwell: number
  bands: Headways
  first: number
  last: number
  /** 発車の位相（秒） */
  phase: number
}

const SERVICES: Service[] = [
  // 各停: 6 分（朝夕は 10 分）
  { cars: 6, stops: ['桜見', '鐘ヶ丘'], dwell: 45, bands: [[H(4, 50), 600], [H(7), 360], [H(21), 600]], first: H(4, 50), last: H(24, 40), phase: 180 },
  // 快速: 12 分（朝夕は 20 分）。鐘ヶ丘は通過
  { cars: 10, stops: ['桜見'], dwell: 60, bands: [[H(6), 1200], [H(7), 720], [H(21), 1200]], first: H(6), last: H(22), phase: 0 },
]

interface Run {
  service: Service
  dir: 1 | -1
  profile: RunProfile
  deps: number[]
  len: number
}

const _p = pathPoint()
const _q = pathPoint()
const _m = new THREE.Matrix4()
const _r = new THREE.Matrix4().makeRotationY(Math.PI)
const _cam = new THREE.Vector3()
const _runs: number[] = []
const _info: [number, number, number, number] = [0, 0, 5, 0]

export class TrainFleet {
  readonly path: Path
  readonly cab: Fleet
  readonly mid: Fleet
  private runs: Run[] = []
  private tunnels: [number, number][] = []
  private platform: [number, number]

  constructor(rail: TransitRail, shapes: VehicleShapes, material: THREE.Material) {
    this.path = new Path(rail.pts, 2, false, (p) => p[3] ?? 0)
    const L = this.path.length
    const sak = rail.stations.find((s) => s.name === '桜見')
    this.platform = sak?.platform ?? [-1e9, -1e9]
    // トンネルの区間
    let start = -1
    for (let i = 0; i < this.path.s.length; i++) {
      const inT = this.path.tag[i] === RAIL_STRUCT.tunnel
      if (inT && start < 0) start = this.path.s[i]
      if (!inT && start >= 0) {
        this.tunnels.push([start, this.path.s[i]])
        start = -1
      }
    }
    if (start >= 0) this.tunnels.push([start, L])
    // 速度の制限: 灯町の石造アーチの曲線（45km/h）・桜見の前後（60km/h）
    const limits: [number, number, number][] = []
    for (let i = 0; i < this.path.s.length - 1; i++) {
      if (this.path.tag[i] === RAIL_STRUCT.stoneArch) limits.push([this.path.s[i], this.path.s[i + 1], 12.5])
    }
    if (sak) limits.push([sak.platform[0] - 250, sak.platform[1] + 150, 16.7])
    for (const service of SERVICES) {
      const len = service.cars * (TRAIN_CAR + TRAIN_GAP)
      const stations = rail.stations.filter((s) => service.stops.includes(s.name))
      for (const dir of [1, -1] as const) {
        // 停車の位置は列車の中心（ホームの中ほど）。下りは長さが増す向き、上りは反対（長さを裏返して計算）
        const ds = stations.map((s) => (dir > 0 ? s.d : L - s.d)).sort((a, b) => a - b)
        const lim = limits.map(([a, b, v]) => (dir > 0 ? [a, b, v] : [L - b, L - a, v]) as [number, number, number])
        const profile = new RunProfile({ stops: [0, ...ds, L], dwell: service.dwell, vmax: 25, accel: 0.75, decel: 0.85, limits: lim })
        // 上りと下りで位相をずらす（同じ所で並ばないように）
        const deps = departures(service.first, service.last, service.bands, service.phase + (dir > 0 ? 0 : 150))
        this.runs.push({ service, dir, profile, deps, len })
      }
    }
    const cap = 24
    this.cab = new Fleet('trainCab', shapes.trainCab, shapes.trainFar, material, cap * 2, 500)
    this.mid = new Fleet('trainMid', shapes.trainMid, shapes.trainFar, material, cap * 9, 500)
  }

  get meshes() {
    return [...this.cab.meshes, ...this.mid.meshes]
  }

  /** 線の上の長さ d・向き dir の線路の横の位置（線の中心から。左 +） */
  offset(d: number, dir: number) {
    const [a, b] = this.platform
    const inSt = THREE.MathUtils.smoothstep(d, a - 120, a - 10) * (1 - THREE.MathUtils.smoothstep(d, b - 30, b + 60))
    return dir > 0 ? THREE.MathUtils.lerp(HALF, PLATFORM_TRACK, inSt) : THREE.MathUtils.lerp(-HALF, 0, inSt)
  }

  inTunnel(d: number) {
    return this.tunnels.some(([a, b]) => d > a + 15 && d < b - 15)
  }

  update(t: number, camera: THREE.Camera, lit: number) {
    camera.getWorldPosition(_cam)
    this.cab.begin()
    this.mid.begin()
    const L = this.path.length
    for (const run of this.runs) {
      activeRuns(run.deps, t, 0, run.profile.duration, _runs)
      for (const i of _runs) {
        const tau = t - run.deps[i]
        const s = run.profile.at(tau)
        const dc = run.dir > 0 ? s : L - s
        const n = run.service.cars
        const pitch = TRAIN_CAR + TRAIN_GAP
        for (let k = 0; k < n; k++) {
          // 先頭から k 両目の中心
          const c = dc - run.dir * (pitch * (k + 0.5) - run.len / 2)
          if (c < 2 || c > L - 2 || this.inTunnel(c)) continue
          const a = c + run.dir * (TRAIN_CAR / 2 - 2.5)
          const b = c - run.dir * (TRAIN_CAR / 2 - 2.5)
          this.path.at(a, _p)
          const oa = this.offset(a, run.dir)
          const ax = _p.x - _p.dy * oa
          const ay = _p.y + _p.dx * oa
          this.path.at(b, _q)
          const ob = this.offset(b, run.dir)
          const bx = _q.x - _q.dy * ob
          const by = _q.y + _q.dx * ob
          const dx = ax - bx
          const dy = ay - by
          const l = Math.hypot(dx, dy) || 1
          placeMatrix(_m, (ax + bx) / 2, (ay + by) / 2, (_p.z + _q.z) / 2, dx / l, dy / l, (_p.z - _q.z) / l)
          const dist = Math.hypot(_m.elements[12] - _cam.x, _m.elements[13] - _cam.y, _m.elements[14] - _cam.z)
          _info[1] = lit
          _info[3] = ((i * 0.37 + k * 0.11) % 1 + 1) % 1
          if (k === 0 || k === n - 1) {
            if (k === n - 1) _m.multiply(_r)
            _info[0] = k === 0 ? 1 : -1
            this.cab.add(_m, _info, dist)
          } else {
            _info[0] = 0
            this.mid.add(_m, _info, dist)
          }
        }
      }
    }
    this.cab.end()
    this.mid.end()
  }
}
