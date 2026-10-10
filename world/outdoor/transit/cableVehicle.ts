import * as THREE from 'three'
import type { CableStationKey } from '../../../core/cableStations'
import { outdoor } from '../../environment/daylight'
import { cableTrack } from './cable'
import { CABLE_CAR, compAt, compFloor, compZ } from './cableCar'
import { cableArrivalOpen, cableTrip, nextCableBoarding } from '../../../core/transit/cableRun'
import { transitClock } from './clock'
import { defineVehicle, type CabinSpec } from './vehicle'

/**
 * 乗り物としての丘ノ上ケーブルの車両（transit/vehicle.ts の Vehicle。便 = 車両の番号 0 = さくら号・1 = かえで号。地図の持ち物）。
 * 乗る仕組みは character/ride/cableRide.ts。docs/design/town.md §19
 */

const C = CABLE_CAR
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _d = new THREE.Vector3()

/** 区画（車両の局所）の中か */
const carCabin: CabinSpec = {
  inside(l, margin = 0) {
    if (Math.abs(l.x) > C.innerW - margin || Math.abs(l.z) > C.innerL - margin) return false
    const F = compFloor(compAt(l.z))
    return l.y > F - 0.05 + Math.max(0, margin) && l.y < F + C.ceilMid + 0.05 - Math.max(0, margin)
  },
  floorAt(x, z, door) {
    if (Math.abs(z) > C.innerL) return null
    const i = compAt(z)
    const F = compFloor(i)
    if (Math.abs(x) < C.innerW) return F
    // 乗り降りの途中は、扉の敷居からホームの縁までのすき間（0.15m）も床にする
    if (door && Math.abs(x) < C.halfW + 0.32 && Math.abs(z - compZ(i).zc) < C.doorW / 2 + 0.05) return F
    return null
  },
  center: new THREE.Vector3(0, 1.6, 0),
}

export const cableVehicle = defineVehicle({
  id: 'cable',
  label: '丘ノ上ケーブル',
  cabin: carCabin,
  // 四方の窓と木の中: 露出は温室の値（外が飛ばない）
  glassBox: true,
  poseOf(car, out) {
    const line = cableTrack.line
    return line ? out.copy(line.cars[car.run].matrix) : out.identity()
  },
  nextBoarding(q) {
    if (!q.station || !q.toward) return null
    const t = transitClock.serviceSec
    const b = nextCableBoarding(q.station as CableStationKey, q.toward as CableStationKey, t, q.lead ?? 0)
    if (!b) return null
    return { run: b.car, waitSec: Math.max(0, b.open - t), closeSec: b.close - t, departSec: b.depart - t, side: b.side }
  },
  arrival(run, at) {
    const t = transitClock.serviceSec
    const { k } = cableTrip(t)
    for (const kk of [k, k + 1]) {
      if (kk < 0) continue
      const o = cableArrivalOpen(run, kk, at as CableStationKey)
      if (o !== null && o >= t - 1) return Math.max(0, o - t)
    }
    return null
  },
  light(car, seat, head, out) {
    // 夜: 乗る人の区画（seat.comp）の天井の丸い灯り（電球色）。まわりは木の壁と天井の照り返し。
    // 昼: 屋根と木の壁の箱の中なので、外の光はおもに湾の側（−x）と山の側の窓から。空の色の光と、木の照り返しの暖かいまわりの光
    const i = seat.comp !== undefined && seat.comp >= 0 ? seat.comp : 1
    const { zc } = compZ(i)
    const dark = 1 - THREE.MathUtils.smoothstep(outdoor.daylight, 0.05, 0.38)
    const lamp = Math.max(dark, outdoor.cableRunning > 0.5 ? 1 : 0)
    const p = car.toWorld(0, compFloor(i) + C.ceilMid - 0.1, zc, _w)
    const night = _v.subVectors(p, head).normalize()
    // 窓の向き（湾の側の窓の高さ・少し上から）
    const win = car.toWorld(-C.halfW - 2.0, compFloor(i) + 2.2, seat.z, _d).sub(head).normalize()
    out.dir.copy(win).lerp(night, dark).normalize()
    const sky = outdoor.skyLight
    const sl = Math.max(1e-3, Math.max(sky.r, sky.g, sky.b))
    out.color.setRGB(1.0, 0.8, 0.58).multiplyScalar(3 * dark)
    out.color.r += (sky.r / sl) * 0.75 * (1 - dark) * 3 + 0.25 * (1 - dark) * 3
    out.color.g += (sky.g / sl) * 0.75 * (1 - dark) * 3 + 0.22 * (1 - dark) * 3
    out.color.b += (sky.b / sl) * 0.75 * (1 - dark) * 3 + 0.17 * (1 - dark) * 3
    out.intensity = 0.58 * lamp * dark + 0.42 * (1 - dark)
    out.ambient.setRGB(0.062 * lamp * dark + 0.05 * (1 - dark), 0.05 * lamp * dark + 0.042 * (1 - dark), 0.036 * lamp * dark + 0.032 * (1 - dark))
    // 昼も中の光で照らす（外の光そのままだと、木の中で人だけ明るく青く見える）。外へ出る扉の所は外の光へ
    return Math.max(dark, 0.75)
  },
})
