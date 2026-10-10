import * as THREE from 'three'
import { outdoor } from '../../environment/daylight'
import { TRAM_CAR } from './tramCar'
import { tramNet } from './trams'
import { defineVehicle, type CabinSpec } from './vehicle'

/**
 * 乗り物としての緑電（transit/vehicle.ts の Vehicle。車室の局所 = 編成の真ん中の両。便の鍵 = 系統の番号（car.line）と便の番号。地図の持ち物）。
 * 乗る仕組みは character/ride/tramRide.ts。docs/design/town.md §20
 */

const T = TRAM_CAR

const tramCabin: CabinSpec = {
  // 両端の 0.4m（貫通路のそば）は外とみなす: 曲がる所で前後の両の壁が回り込んでくるので、カメラを置かない
  inside(l, margin = 0) {
    return Math.abs(l.x) < T.iw - margin && Math.abs(l.z) < T.half - 0.4 - margin && l.y > T.floor - 0.05 + Math.max(0, margin) && l.y < T.ceilMid + 0.05 - Math.max(0, margin)
  },
  floorAt(x, z, door) {
    if (Math.abs(z) > T.half + 0.2) return null
    if (Math.abs(x) < T.iw) return T.floor
    // 乗り降りの途中は、扉の敷居からホームの縁までのすき間（0.15m）も床にする
    if (door && Math.abs(x) < T.hw + 0.16 && Math.abs(z) < 0.66) return T.floor
    return null
  },
  center: new THREE.Vector3(0, 1.6, 0),
  clampMember(l) {
    l.x = THREE.MathUtils.clamp(l.x, -T.iw + 0.25, T.iw - 0.25)
    l.z = THREE.MathUtils.clamp(l.z, -T.half + 0.3, T.half - 0.3)
    l.y = THREE.MathUtils.clamp(l.y, T.floor + 0.6, T.ceilSide - 0.3)
  },
}

const _w = new THREE.Vector3()
const _v = new THREE.Vector3()

export const tramVehicle = defineVehicle({
  id: 'tram',
  label: '緑電',
  cabin: tramCabin,
  // 大きな窓の箱: 露出は温室の値
  glassBox: true,
  poseOf(car, out) {
    const r = typeof car.line === 'number' ? tramNet.fleet?.find(car.line, car.run) : null
    return r ? out.copy(r.sections[1]) : out.identity()
  },
  nextBoarding() {
    return null
  },
  arrival() {
    return null
  },
  light(car, seat, head, out) {
    // 夜: 天井の 2 本の灯りの帯（電球色の LED）。昼: 大きな窓から空の光と、明るい化粧板の照り返し
    const dark = 1 - THREE.MathUtils.smoothstep(outdoor.daylight, 0.05, 0.38)
    const p = car.toWorld(0, T.ceilSide, seat.z, _w)
    const night = _v.subVectors(p, head).normalize()
    const win = car.toWorld(seat.side * (T.hw + 2.0), T.floor + 1.9, seat.z, new THREE.Vector3()).sub(head).normalize()
    out.dir.copy(win).lerp(night, dark).normalize()
    const sky = outdoor.skyLight
    const sl = Math.max(1e-3, Math.max(sky.r, sky.g, sky.b))
    out.color.setRGB(1.0, 0.86, 0.68).multiplyScalar(3 * dark)
    out.color.r += ((sky.r / sl) * 0.8 + 0.22) * (1 - dark) * 3
    out.color.g += ((sky.g / sl) * 0.8 + 0.21) * (1 - dark) * 3
    out.color.b += ((sky.b / sl) * 0.8 + 0.19) * (1 - dark) * 3
    out.intensity = 0.62 * dark + 0.42 * (1 - dark)
    out.ambient.setRGB(0.07 * dark + 0.055 * (1 - dark), 0.062 * dark + 0.052 * (1 - dark), 0.05 * dark + 0.048 * (1 - dark))
    return Math.max(dark, 0.6)
  },
})
