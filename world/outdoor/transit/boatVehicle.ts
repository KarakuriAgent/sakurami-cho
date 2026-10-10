import * as THREE from 'three'
import { outdoor } from '../../environment/daylight'
import { boatNet } from './boats'
import { LANDING } from './landings'
import { WATERBUS } from './waterbusCar'
import { defineVehicle, type CabinSpec } from './vehicle'

/**
 * 乗り物としての運河バス（transit/vehicle.ts の Vehicle。便の鍵 = 航路の id（car.line）と便の番号。地図の持ち物）。
 * 波の揺れは舟の行列に入っているので、車室と一緒に動く物も揺れと一緒に動く。乗る仕組みは character/ride/boatRide.ts。docs/design/town.md §20
 */

const C = WATERBUS

const boatCabin: CabinSpec = {
  inside(l, margin = 0) {
    return Math.abs(l.x) < C.iw - margin && l.z > C.z0 + margin && l.z < C.z1 - margin && l.y > C.floor - 0.05 + Math.max(0, margin) && l.y < C.ceilMid + 0.05 - Math.max(0, margin)
  },
  floorAt(x, z, door) {
    const ax = Math.abs(x)
    if (z < C.z0 || z > C.z1) return null
    if (ax < C.iw - 0.34) return C.floor
    const atDoor = Math.abs(z - C.doorZ) < C.doorW / 2 + 0.02
    if (ax < C.iw) return atDoor ? C.stepY : C.floor
    // 乗り降りの途中は、扉の敷居（甲板）から下の段の縁までも床にする
    if (door && atDoor && ax < C.beam / 2 + LANDING.gap + 0.05) return C.deck
    return null
  },
  center: new THREE.Vector3(0, 1.4, 0),
  clampMember(l) {
    l.x = THREE.MathUtils.clamp(l.x, -C.iw + 0.3, C.iw - 0.3)
    l.z = THREE.MathUtils.clamp(l.z, C.z0 + 0.3, C.z1 - 0.3)
    l.y = THREE.MathUtils.clamp(l.y, C.floor + 0.6, C.ceilSide - 0.3)
  },
}

const _w = new THREE.Vector3()
const _v = new THREE.Vector3()

export const boatVehicle = defineVehicle({
  id: 'waterbus',
  label: '運河バス',
  cabin: boatCabin,
  glassBox: true,
  poseOf(car, out) {
    const r = typeof car.line === 'string' ? boatNet.fleet?.find(car.line, car.run) : null
    return r ? out.copy(r.matrix) : out.identity()
  },
  nextBoarding() {
    return null
  },
  arrival() {
    return null
  },
  light(car, seat, head, out) {
    // 夜: 天井の 2 本の灯りの帯（電球色）。昼: ぐるりの窓から水面の照り返しを含む空の光と、木の照り返し
    const dark = 1 - THREE.MathUtils.smoothstep(outdoor.daylight, 0.05, 0.38)
    const z = seat.z
    const p = car.toWorld(0, C.ceilSide + 0.15, z, _w)
    const night = _v.subVectors(p, head).normalize()
    const win = car.toWorld(seat.side * (C.hw + 2.0), C.floor + 1.5, z, new THREE.Vector3()).sub(head).normalize()
    out.dir.copy(win).lerp(night, dark).normalize()
    const sky = outdoor.skyLight
    const sl = Math.max(1e-3, Math.max(sky.r, sky.g, sky.b))
    out.color.setRGB(1.0, 0.82, 0.6).multiplyScalar(3 * dark)
    out.color.r += ((sky.r / sl) * 0.8 + 0.2) * (1 - dark) * 3
    out.color.g += ((sky.g / sl) * 0.8 + 0.2) * (1 - dark) * 3
    out.color.b += ((sky.b / sl) * 0.8 + 0.2) * (1 - dark) * 3
    out.intensity = 0.58 * dark + 0.45 * (1 - dark)
    out.ambient.setRGB(0.066 * dark + 0.056 * (1 - dark), 0.056 * dark + 0.054 * (1 - dark), 0.042 * dark + 0.052 * (1 - dark))
    return Math.max(dark, 0.55)
  },
})
