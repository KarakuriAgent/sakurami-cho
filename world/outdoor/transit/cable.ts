import * as THREE from 'three'
import type { TownInfra } from '../town/townData'
import { CABLE_CAR, CableCarDetail } from './cableCar'
import { CABLE_RUN, carDoors, carQ, type CableStationId } from '../../../core/transit/cableRun'
import { Fleet, placeMatrix } from './fleet'
import { Path, pathPoint } from './transitData'
import { type VehicleShapes } from './vehicles'

/**
 * 丘ノ上ケーブル（交走式。vol3 4-4: 6:00〜23:30、10 分間隔、所要約 4 分）の 2 両（さくら号・かえで号）の位置・向きと、描くもの。
 * 運転（ダイヤ・扉）は cableRun.ts、細かい車両（中の段々の床・長いす・木の窓枠・つり革）は cableCar.ts。docs/design/town.md §15・§19。
 *
 * - 位置は交通の時計（transit/clock.ts）から決める。車両の中心は前後の台車（中心から ±3.9m）のレールの点の真ん中、向きは台車を結ぶ線
 *   （データの線路の点は 25m ごとに勾配が折れるので、台車の 2 点で車体の傾きがなめらかに変わる）
 * - 楓坂駅の前後 100m は行き違い線（データの線路の左右 2.19m）。さくら号は南東、かえで号は北西の線を通り、前後 15m で本線へ寄る
 * - 車両の形の段々の床は勾配 0.12 で作り（cableCar.ts の CABLE_CAR.slope）、線路の勾配との差だけ車体を傾ける
 *
 * 乗る仕組み（character/ride/cableRide.ts）は cableTrack.line からこの線を使う（町のデータを読んだあとにできる）
 */

const _p = pathPoint()
const _q = pathPoint()
const _m = new THREE.Matrix4()
const _cam = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _info: [number, number, number, number] = [0, 1, 0, 0.3]
const _dinfo: [number, number, number, number] = [0, 0, 0, 0]

/** 前後の台車の、車両の中心からの距離（m） */
const BOGIE = 3.9
/** 細かい車両で描く距離（カメラから m） */
const DETAIL_DISTANCE = 90

/** 線路の上の 1 点（平面座標・標高。lateral = 左右のずらし（南東が +）） */
export interface TrackPoint {
  x: number
  y: number
  z: number
}

export class CableLine {
  /** 頂上（高い方）→ 麓。長さ = 水平の長さ */
  readonly path: Path
  readonly fleet: Fleet
  readonly detail: CableCarDetail
  /** 行き違い線の真ん中（麓からの水平の長さ）・半分の長さ・本線からのずらし（m） */
  readonly loopMid: number
  readonly loopHalf: number
  readonly loopOff: number
  /** 行き違い線へ寄る長さ（m） */
  readonly loopTaper = 15
  /** 車両の形に作り込んだ勾配（形の段々の床）。線路の勾配との差だけ車体を傾ける */
  private builtSlope: number
  /** さくら号の位置（0 = 頂上、1 = 麓。かえで号は 1 - これ） */
  pos = 0
  /** 今のコマの車両の行列（車両の局所 → シーン）と、扉 */
  readonly cars = [0, 1].map(() => ({ matrix: new THREE.Matrix4(), door: 0, side: 0, station: null as CableStationId | null, u: 0 }))
  /** 乗っている車両（細かい形でいつも描く。-1 = なし）と、中の灯りを点けておくか */
  ridden = -1

  constructor(cable: NonNullable<TownInfra['cable']>, shapes: VehicleShapes, material: THREE.Material, builtSlope: number) {
    const pts = cable.pts[0][2] >= cable.pts[cable.pts.length - 1][2] ? cable.pts : [...cable.pts].reverse()
    this.path = new Path(pts, 1)
    this.builtSlope = builtSlope
    // 行き違い線（データの 2 本の線。線の両端の真ん中と、本線からのずらし）
    let mid = this.path.length / 2
    let half = 50
    let off = 2.19
    const loop = cable.loops[0]
    if (loop && loop.length >= 2) {
      const a = this.uOf(loop[0][0], loop[0][1])
      const b = this.uOf(loop[loop.length - 1][0], loop[loop.length - 1][1])
      mid = (a + b) / 2
      half = Math.abs(b - a) / 2
      const m = loop[Math.floor(loop.length / 2)]
      this.path.at(this.path.length - mid, _p)
      off = Math.abs((m[0] - _p.x) * -_p.dy + (m[1] - _p.y) * _p.dx) || off
    }
    this.loopMid = mid
    this.loopHalf = half
    this.loopOff = off
    this.fleet = new Fleet('cableCar', shapes.cableCar, null, material, 2, 1e9)
    this.detail = new CableCarDetail(2)
  }

  /** 線路の長さ（水平・m） */
  get length() {
    return this.path.length
  }

  /** 平面の点の、麓からの水平の長さ */
  uOf(x: number, y: number) {
    return this.path.length - this.path.project(x, y).d
  }

  /** 麓からの水平の長さ u の、本線からのずらしの割合（行き違い線の中は 1） */
  loopWeight(u: number) {
    const d = Math.abs(u - this.loopMid)
    return 1 - THREE.MathUtils.smoothstep(d, this.loopHalf, this.loopHalf + this.loopTaper)
  }

  /** 麓からの水平の長さ u・左右のずらし lat（南東が +）の、線路の点（平面と標高）と進む向き（麓へ） */
  track(u: number, lat: number, out: TrackPoint & { dx: number; dy: number; grade: number } = { x: 0, y: 0, z: 0, dx: 0, dy: 0, grade: 0 }) {
    this.path.at(this.path.length - u, _q)
    out.x = _q.x - _q.dy * lat
    out.y = _q.y + _q.dx * lat
    out.z = _q.z
    out.dx = _q.dx
    out.dy = _q.dy
    out.grade = _q.grade
    return out
  }

  /** 車両 car（0 = さくら号・1 = かえで号）の、麓からの水平の長さ u のときの左右のずらし（行き違い線。南東が +） */
  lateral(car: number, u: number) {
    return (car === 0 ? 1 : -1) * this.loopOff * this.loopWeight(u)
  }

  /** 位置 q（0 = 頂上の止まる位置、1 = 麓の止まる位置）→ 麓からの水平の長さ */
  uAt(q: number) {
    const top = this.path.length - CABLE_RUN.endStop
    return top - q * (top - CABLE_RUN.endStop)
  }

  /** 車両 car の中心が麓からの水平の長さ u にあるときの行列（車両の局所 → シーン。+z = 山の側、+x = 山を向いて左、y = 上） */
  carMatrix(car: number, u: number, out: THREE.Matrix4) {
    const b = this.track(u - BOGIE, this.lateral(car, u - BOGIE), _tb)
    const f = this.track(u + BOGIE, this.lateral(car, u + BOGIE), _tf)
    const hx = f.x - b.x
    const hy = f.y - b.y
    const hl = Math.hypot(hx, hy) || 1
    const grade = (f.z - b.z) / hl
    // 形の +z は山側。勾配は形の段々との差だけ
    const extra = Math.tan(Math.atan(grade) - Math.atan(this.builtSlope))
    return placeMatrix(out, (b.x + f.x) / 2, (b.y + f.y) / 2, (b.z + f.z) / 2, hx / hl, hy / hl, extra)
  }

  /** 交通の時計（運転の日の秒）から、2 両の位置・行列・扉を決める（毎コマ。描かないコマも） */
  updateState(t: number) {
    this.pos = carQ(0, t)
    for (let i = 0; i < 2; i++) {
      const c = this.cars[i]
      c.u = this.uAt(carQ(i, t))
      this.carMatrix(i, c.u, c.matrix)
      const d = carDoors(i, t)
      c.door = d.open
      c.side = d.side
      c.station = d.station
    }
  }

  /** 描く（毎コマ）。lit = 中の灯り（運転の間は 1）、dark = 暗さ（0〜1。乗っている車両の灯り） */
  update(t: number, camera: THREE.Camera, lit: number, dark = 0) {
    camera.getWorldPosition(_cam)
    this.updateState(t)
    this.fleet.begin()
    this.detail.begin()
    for (let i = 0; i < 2; i++) {
      const c = this.cars[i]
      _pos.setFromMatrixPosition(c.matrix)
      const dist = _pos.distanceTo(_cam)
      if (i === this.ridden || dist < DETAIL_DISTANCE) {
        // 中の灯り（運転の間・乗っている車両は暗ければいつも）・車両の種・扉（+x の側・−x の側の開き具合）
        _dinfo[0] = i === this.ridden ? Math.max(lit, dark) : lit
        _dinfo[1] = i
        _dinfo[2] = c.side > 0 ? c.door : 0
        _dinfo[3] = c.side < 0 ? c.door : 0
        if (this.detail.add(c.matrix, _dinfo)) continue
      }
      _info[0] = 1
      _info[1] = lit
      _info[3] = i === 0 ? 0.21 : 0.73
      _m.copy(c.matrix)
      this.fleet.add(_m, _info, dist)
    }
    this.fleet.end()
    this.detail.end()
  }

  /** 描く物（交通のまとめ transit.ts が group に入れる） */
  get meshes() {
    return [...this.fleet.meshes, ...this.detail.meshes]
  }
}

const _tb = { x: 0, y: 0, z: 0, dx: 0, dy: 0, grade: 0 }
const _tf = { x: 0, y: 0, z: 0, dx: 0, dy: 0, grade: 0 }

/** 町のデータを読んだあとの線（乗る仕組み character/ride/cableRide.ts が使う。無ければ null） */
export const cableTrack = { line: null as CableLine | null }

export { CABLE_CAR }
