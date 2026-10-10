import * as THREE from 'three'
import { baseWheelAngle, CABIN, degreesAtX, pivotWheel, RIDE_SPOTS, SORANOWA, soranowaOpen, WHEEL_OMEGA, wheelToScene } from '../../../core/soranowa'

/**
 * 観覧車ソラノワのホイールの回り方（交通の時計から決まる角度）と、乗っているゴンドラの位置（docs/design/town.md §17）。地図の持ち物
 * （回すのは town/soranowa.ts。毎コマ updateWheel を呼ぶのは町の毎コマの初め town.begin（world/createTown.ts。交通の時計を進めた直後）で、営業時間の外も回すかは
 * 乗客の一覧から決める（town/soranowaVehicle.ts の soranowaHeld）。乗っているゴンドラの番号と扉は乗る仕組み character/ride/ride.ts が書く）。
 *
 * - ふだんは営業時間（11:00〜22:00）だけ回る（core/soranowa.ts の baseWheelAngle）。止まっている間は最後の角度
 * - 人が乗っている間（ゴンドラの乗客の一覧に人がいる・降りたあと扉が閉まる途中）は、営業時間の外でも回る（閉まる 22:00 を過ぎても、
 *   乗っている人が降りるまで回る。営業時間を無視して乗ったときも）。
 *   そのぶん回った角度は extra に足していき、降りたあとも続ける（ホイールが元の角度へ跳ばない）
 * - 角度は交通の時計（観覧車の早送り・カットで足した時間も入る）から毎コマ決まるので、撮影のコマ送りでも毎回同じ
 */

const DAY = 86400

export const wheel = {
  /** 今のホイールの角度（rad。town/soranowa.ts が回す） */
  angle: 0,
  /** 営業時間の外に回った分（rad） */
  extra: 0,
  /** 前のコマの交通の時計（秒） */
  lastSec: null as number | null,
  /** 回っているか */
  running: false,
  /** 花音が乗っている（乗り込み・降りる途中も）ゴンドラの番号（無ければ -1。細かく描くゴンドラは 1 つ） */
  rideIndex: -1,
  /** 降りたあと、扉が閉まる途中のゴンドラがあるか（乗る仕組みが書く。閉まるまでは営業時間の外でも回す） */
  closing: false,
  /** 乗っているゴンドラの扉の開き具合（0〜1。town/soranowa.ts が扉を動かす） */
  door: 0,
  /** 乗っているゴンドラの中の灯り（0〜1） */
  cabinLamp: 0,
}

/** [a, b] のうち営業時間の外の長さ（秒。a ≤ b。日をまたいでもよい） */
function outsideHours(a: number, b: number) {
  let total = 0
  let t = a
  while (t < b - 1e-6) {
    const day = Math.floor(t / DAY) * DAY
    const open = day + SORANOWA.openHour * 3600
    const close = day + SORANOWA.closeHour * 3600
    const next = Math.min(b, day + DAY)
    // [t, next] と [open, close] の重なりを除いた長さ
    const inside = Math.max(0, Math.min(next, close) - Math.max(t, open))
    total += next - t - inside
    t = next
  }
  return total
}

/**
 * 毎コマ（交通の時計を進めたあと）。sec = 交通の時計（0〜86400）、riding = 人が乗っているか（営業時間の外でも回す。soranowaHeld()）
 */
export function updateWheel(sec: number, riding: boolean) {
  if (wheel.lastSec !== null && riding) {
    // 進んだ秒（日をまたいだ・カットで大きく進んだときも）
    let d = sec - wheel.lastSec
    if (d < -DAY / 2) d += DAY
    if (d > 0) wheel.extra -= outsideHours(wheel.lastSec, wheel.lastSec + d) * WHEEL_OMEGA
  }
  wheel.lastSec = sec
  wheel.angle = baseWheelAngle(sec) + wheel.extra
  wheel.running = riding || soranowaOpen(sec)
}

/** 回っているとき、dt 秒後の角度（乗っている間はいつも回るので、ゴンドラの位置の先読みに使う） */
export function angleAfter(dt: number) {
  return wheel.angle - dt * WHEEL_OMEGA
}

const _p: [number, number, number] = [0, 0, 0]

/** ゴンドラ i を吊る軸（ゴンドラの局所の原点）のシーンの位置（ホイールの角度 angle のとき） */
export function pivotScene(i: number, angle: number, out = new THREE.Vector3()) {
  const w = pivotWheel(i, angle, _p)
  const s = wheelToScene(w[0], w[1], w[2], _p)
  return out.set(s[0], s[1], s[2])
}

/** ゴンドラの中の床の高さ（シーンの y） */
export function cabinFloorY(i: number, angle: number) {
  return pivotWheel(i, angle, _p)[1] + SORANOWA.ground - 116 + CABIN.floor
}

/** 乗車の扉が開く・歩き出すときの、ゴンドラが一番下から進んだ角度（度。一番下の手前は 360 に近い）と、降車の扉が開く角度 */
export const DEG_BOARD_OPEN = 360 + degreesAtX(RIDE_SPOTS.boardOpenX)
export const DEG_BOARD_STEP = 360 + degreesAtX(RIDE_SPOTS.boardStepX)
export const DEG_EXIT_OPEN = 360 + degreesAtX(RIDE_SPOTS.exitOpenX)
