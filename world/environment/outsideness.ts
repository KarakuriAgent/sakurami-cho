import * as THREE from 'three'
import { MEZZANINE, ROOM } from '../../core/lab/plan'

const HALL = { x: ROOM.halfWidth, z0: ROOM.north - MEZZANINE.depth, z1: ROOM.south }

/** カメラがラボの外にいる度合い（0〜1）。壁の外側からの距離でなめらかに（露出 exposure.ts と色の仕上げ scene/grade.ts が使う） */
export function outsideness(p: THREE.Vector3) {
  const dx = Math.abs(p.x) - HALL.x
  const dz = Math.max(HALL.z0 - p.z, p.z - HALL.z1)
  const dy = p.y - ROOM.height
  const sd = Math.max(dx, dz, dy)
  return THREE.MathUtils.smoothstep(sd, -0.3, 1.1)
}
