import type { Car, CabinSeat } from '../../world/outdoor/transit/vehicle'
import type { MemberRide, Party } from './party'

/**
 * 乗る人ごとの、乗り物に乗っている間の状態（Character の ride。docs/design/map-split.md §5 の「段 2 の作りの決めごと」）。
 * 乗り物は観覧車ソラノワのゴンドラ（character/ride/ride.ts）と、丘ノ上ケーブルの車両（cableRide.ts）・緑電（tramRide.ts）・運河バス（boatRide.ts）・
 * 花音のホバーの一人乗り（hoverRide.ts）。書くのはその人の乗る仕組み（Character の rides）で、人・カメラ・光が読む。docs/design/town.md §17・§19〜§21。
 *
 * 乗り物の種類（Vehicle）と便ごとの車室（Car。車室の行列・座標の変換・乗客の一覧）は地図の持ち物（world/outdoor/transit/vehicle.ts）。
 * 乗っている便の今のコマの行列は乗る仕組みが毎コマ car.setPose で書き、人・仲間・カメラ・光は car の座標の変換（toWorld・toCabin など）で置く。
 * 乗っている間は car、降りたあとも最後に乗った便は lastCar（カメラの乗り物に付く画・観覧車の扉が閉まる間が読む）。
 * 地図の乗客の形（CabinRider）と注目点の ride（world/townHost.ts の TownFocus）をそのまま満たす（car・inside・seat）。
 * 一緒に乗る仲間（character/ride/party.ts）: 先に立つ人の仲間の一覧は party、仲間の側の乗り物の間の様子は member（車室の中へ乗り込む仲間は、
 * 乗り込みから降り終えるまで phase・car・attach・inside もこの形で持ち、乗客の一覧に入る）
 */

export type RidePhase = 'none' | 'wait' | 'board' | 'riding' | 'alight'

export interface Rider {
  phase: RidePhase
  /** 乗っている（乗り込む・待つ）便の車室（無ければ null。替えるのは setRiderCar） */
  car: Car | null
  /** 最後に乗った（待った）便の車室（降りたあとも null にしない。乗ったことが無ければ null） */
  lastCar: Car | null
  /** 乗る人の居場所（車室の局所。中の光の向き。ケーブル・緑電・運河バスの乗る仕組みが書く） */
  seat: CabinSeat
  /** 車室に付いて動く度合い（0 = 乗り場の上・1 = 車室の中） */
  attach: number
  /** 車室の中にいる（中の灯りで照らす・カメラの構図を中に収める） */
  inside: boolean
  /** 一緒に乗る仲間の一覧（先に立つ人として。いつでも出入りできる。character/ride/party.ts） */
  party: Party
  /** 仲間として一緒に乗っている様子（仲間の側。character/ride/party.ts） */
  member: MemberRide
  /** 乗り込んで座った（立った）回数・降りて出た回数（kanon.travel の until=board・alight。ケーブル・緑電・運河バス・ホバーを合わせて数える） */
  serials: { board: number; alight: number }
}

/** 乗る人ごとの状態を作る（仲間の一覧と仲間の側の様子は character/ride/party.ts の Party・createMemberRide で作って渡す。character/avatar/createCharacter.ts） */
export function createRider(party: Party, member: MemberRide): Rider {
  return {
    phase: 'none',
    car: null,
    lastCar: null,
    seat: { z: 0, side: 1 },
    attach: 0,
    inside: false,
    party,
    member,
    serials: { board: 0, alight: 0 },
  }
}

/**
 * 乗る便を替える（乗る仕組みが、待ち始める・便を替える・降りる・やめるときに。null = 乗っていない）。
 * 乗客の一覧（car.passengers）も直す（前の便から外し、新しい便に入れる）。lastCar は新しい便を指し、null にはしない
 */
export function setRiderCar(r: Rider, car: Car | null) {
  const prev = r.car
  if (prev === car) return
  prev?.leave(r)
  r.car = car
  if (car) {
    car.board(r)
    r.lastCar = car
  }
}

/** 乗っている（乗り込み・降りる途中も）か */
function riding(r: Rider) {
  return r.phase !== 'none' && r.phase !== 'wait'
}

/**
 * 乗っている車室の中の床の高さ（シーンの y）。壁の内と、乗り降りの途中なら扉の敷居から乗り場までのすき間も床にする。ほかは null。
 * 人の足元の高さ（character/avatar/locomotion.ts の groundHeight。足の高さ合わせも使う）が、車室の中で下の地面・線路を拾わないように（Car.floorAt）
 */
export function riderFloorAt(r: Rider, x: number, z: number, refY?: number): number | null {
  const car = r.car
  if (!riding(r) || !car) return null
  return car.floorAt(x, z, r.phase === 'board' || r.phase === 'alight', refY)
}
