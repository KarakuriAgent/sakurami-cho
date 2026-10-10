import * as THREE from 'three'
import { HOVER_DOCKS, type HoverDock, type HoverDockId } from '../../../core/hoverDocks'
import { townWalk } from '../../walk/townWalk'
import { HOVER } from './hoverCar'
import { defineVehicle, type CabinSpec } from './vehicle'

/**
 * 花音のホバーの一人乗りの機体（docs/design/town.md §21）。地図の持ち物で、ホバーは 1 台（docs/design/map-split.md §5）。
 * 置いてある乗り場・今の行列・ファンの回り・速さ・灯りを持つ。描く（transit/hover.ts）・音（町の音）・カメラが読む。
 * 値を書くのは乗る仕組み（character/ride/hoverRide.ts）で、毎コマ（交通の時計を進めたあと）行列・power・lamp・speed を決める。
 * 乗り物としての形（transit/vehicle.ts の Vehicle）は hoverVehicle（便は 0 の 1 つ）
 */

/** ホバーの置いてある乗り場（乗って行った先に置いたまま。ページを開き直すとラボの置き場） */
export const hoverHome = { at: 'lab' as HoverDockId }

/** 今の機体の様子（乗る仕組みが書く。ほかは読むだけ） */
export const hoverCraft = {
  /** 局所 → シーンの行列（置いてある・飛んでいる） */
  matrix: new THREE.Matrix4(),
  /** ファンの回り（0〜1）・速さ（m/s）・灯り（0〜1） */
  power: 0,
  speed: 0,
  lamp: 0,
  /** 行列を決めたか（町のデータを読む前は false） */
  ready: false,
}

const _v = new THREE.Vector3()
const _d = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 1)

/** 乗り場の台の上の高さ（シーンの y）。台の下の地面のいちばん高い所 + 1cm（台は斜面にめり込ませる） */
export function padTop(d: HoverDock) {
  if (!townWalk.ready) return 0
  let top = -Infinity
  for (const [dx, dz] of [
    [0, 0],
    [1.1, 0],
    [-1.1, 0],
    [0, 1.1],
    [0, -1.1],
    [0.8, 0.8],
    [-0.8, 0.8],
    [0.8, -0.8],
    [-0.8, -0.8],
  ])
    top = Math.max(top, townWalk.groundY(d.pad[0] + dx, d.pad[1] + dz, undefined, false))
  return top + 0.0125
}

/** 置いたホバーの行列 */
export function parkedMatrix(d: HoverDock, out: THREE.Matrix4) {
  _q.setFromAxisAngle(_d.set(0, 1, 0), d.heading)
  return out.compose(_v.set(d.pad[0], padTop(d), d.pad[1]), _q, _s)
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
  nextBoarding(q) {
    // いつでも乗れる。扉の側 = 乗り場（省けば置いてある乗り場）の乗り降りする側
    const d = HOVER_DOCKS[(q.station ?? hoverHome.at) as HoverDockId]
    return { run: 0, waitSec: 0, closeSec: Infinity, departSec: null, side: d?.side ?? 1 }
  },
  arrival() {
    return null
  },
})
