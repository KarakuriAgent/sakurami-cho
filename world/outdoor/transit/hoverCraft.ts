import * as THREE from 'three'
import { townWalk } from '../../walk/townWalk'
import { HOVER } from './hoverCar'
import { defineVehicle, type CabinSpec } from './vehicle'

/**
 * 花音のホバーの一人乗りの機体（docs/design/town.md §21）。地図の持ち物で、ホバーは 1 台（docs/design/map-split.md §5）。
 * 置いてある所・今の行列・ファンの回り・速さ・灯りを持つ。描く（transit/hover.ts）・音（町の音）・カメラが読む。
 * 値を書くのは乗る仕組み（character/ride/hoverRide.ts）で、毎コマ（交通の時計を進めたあと）行列・power・lamp・speed を決める。
 * 乗り物としての形（transit/vehicle.ts の Vehicle）は hoverVehicle（便は 0 の 1 つ）。
 *
 * 乗り場は無い（#9）。呼ぶと（character/ride/hoverRide.ts の summonHover）呼んだ人の近くの歩ける所へ来て下りて待ち、乗っていない間は
 * 最後に下りた所に置いておく。ページを開いてから一度も呼んでいない間は、町のどこにも無い（placed = false。描かない）
 */

/** ホバーの置いてある所（最後に下りた所。シーンの x, z と足元の高さ y・向き heading（0 = +z）・乗り降りする側 side（局所の x の向き）） */
export const hoverHome = {
  placed: false,
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  side: 1 as 1 | -1,
}

/** 今の機体の様子（乗る仕組みが書く。ほかは読むだけ） */
export const hoverCraft = {
  /** 局所 → シーンの行列（置いてある・飛んでいる） */
  matrix: new THREE.Matrix4(),
  /** ファンの回り（0〜1）・速さ（m/s）・灯り（0〜1） */
  power: 0,
  speed: 0,
  lamp: 0,
  /** 行列を決めたか（町のデータを読む前・まだ一度も呼んでいない間は false。描かない） */
  ready: false,
}

const _v = new THREE.Vector3()
const _d = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 1)

/**
 * 地面に置いたホバーの足の高さ（シーンの y）: 床板の下のゴムの脚の 4 か所と真ん中の地面のいちばん高い所 + 1cm（坂・段の縁では高い方に乗せる）。
 * refY = 足元の面を選ぶ高さ（橋の上と下）
 */
export function parkedHeight(x: number, z: number, heading: number, refY: number) {
  if (!townWalk.ready) return refY
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  let top = -Infinity
  for (const [lx, lz] of [
    [0, 0],
    [0.24, 0.55],
    [-0.24, 0.55],
    [0.24, -0.55],
    [-0.24, -0.55],
  ]) {
    // 局所 (lx, lz) → シーン: +z の向きが heading
    const wx = x + lx * c + lz * s
    const wz = z - lx * s + lz * c
    top = Math.max(top, townWalk.groundY(wx, wz, refY, false))
  }
  return top + 0.01
}

/** 置いたホバーの行列（hoverHome） */
export function parkedMatrix(out: THREE.Matrix4) {
  _q.setFromAxisAngle(_d.set(0, 1, 0), hoverHome.heading)
  return out.compose(_v.set(hoverHome.x, hoverHome.y, hoverHome.z), _q, _s)
}

/* -------------------------------------------------------------------------- */
/* 乗り物としてのホバー                                                              */
/* -------------------------------------------------------------------------- */

const H = HOVER

/** 乗っている所（局所）。屋根も壁も無いので「中」は乗る人の体のまわりの箱だけ（カメラの寄せ・中の光は使わない） */
const hoverCabin: CabinSpec = {
  inside(l, margin = 0) {
    return Math.abs(l.x) < H.deckHW - margin && l.z > H.deckZ0 - 0.5 + margin && l.z < H.deckZ1 - margin && l.y > H.deckY + margin && l.y < H.deckY + 1.6 - margin
  },
  floorAt(x, z, door) {
    if (Math.abs(x) < H.deckHW + (door ? 0.02 : 0.05) && z > H.deckZ0 - 0.02 && z < H.deckZ1 + 0.02) return H.deckY
    return null
  },
  center: new THREE.Vector3(0, H.deckY + 1.0, 0),
}

export const hoverVehicle = defineVehicle({
  id: 'hover',
  label: 'ホバー',
  cabin: hoverCabin,
  glassBox: false,
  open: true,
  poseOf(_car, out) {
    return out.copy(hoverCraft.matrix)
  },
  nextBoarding() {
    // いつでも乗れる。扉の側 = 置いてあるホバーの乗り降りする側（呼んだ人の側）
    return { run: 0, waitSec: 0, closeSec: Infinity, departSec: null, side: hoverHome.side }
  },
  arrival() {
    return null
  },
})
