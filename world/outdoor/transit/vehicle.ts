import * as THREE from 'three'

/**
 * 人が乗る乗り物の形（地図の持ち物。docs/design/map-split.md §5）。乗り物は 2 層:
 *
 * - 種類（Vehicle）: 観覧車ソラノワ（town/soranowaVehicle.ts）・丘ノ上ケーブル（cableVehicle.ts）・緑電（tramVehicle.ts）・運河バス（boatVehicle.ts）・
 *   ホバーの一人乗り（hoverCraft.ts）。車室の中の決まり・乗れる便・中の光
 * - 便ごとの車室（Car）: 鍵は系統・航路（line）と便（run）。今のコマの車室の行列・座標の変換・乗っている人の一覧
 *
 * 車室は「局所の座標」を持つ（ゴンドラは原点 = 吊る軸・いつも水平、ケーブルカーは原点 = 車両の中心のレール面・線路に沿って傾く）。
 * 今のコマの局所 → シーンの行列は、乗っている人の乗る仕組み（character/ride/）が毎コマ setPose で書き、人・KB-001・カメラ・光はそれで置く。
 * 地図は乗る人（Character）を知らない（乗客の一覧は CabinRider の形で受ける）
 *
 * 車室と一緒に運ぶ口は 2 つ（docs/design/map-split.md §5 の「段 3 の作りの決めごと」。乗客として乗る Character は乗る仕組みが運ぶので、どちらも使わない）:
 *
 * - 引く形（carry・deltaQuat）: 自分の毎コマの更新を持つ物（花音の揺れもの・KB-001 など）が、自分の更新の中で、便の serial が替わったら 1 回だけ
 *   car.carry(位置, 強さ) で位置を運び、向き・速さは identity.slerp(car.deltaQuat, 強さ) を前から掛けて回す。強さを毎コマ自分で決める物はこちら
 * - 登録する形（attach・detach）: 自分の毎コマの更新を持たない物（荷物・飾り・座らせておくだけの人形など）を car.attach(物, 強さ) で登録すると、
 *   setPose（乗る仕組みの −79）の終わりに便が一緒に運ぶ。運ぶのはその便の行列を誰かが書いている間だけ（すべての便の行列を地図が書くのは段 5）
 */

export type VehicleId = 'soranowa' | 'cable' | 'tram' | 'waterbus' | 'hover'

/** 便の系統・航路（緑電は系統の番号・運河バスは航路の id。ほかは null） */
export type CarLine = number | string | null

/** 車室の中の決まり（局所の座標） */
export interface CabinSpec {
  /** 局所の点が中か（壁・床・天井から margin 内側。負なら外へ広げる） */
  inside(l: THREE.Vector3, margin?: number): boolean
  /**
   * 局所の (x, z) の中の床の高さ（局所の y）。中でなければ null。door = 乗り降りの途中（扉の敷居から外の台・ホームまでのすき間も床にする）。
   * y = 今の高さ（局所。段々の床で、今の段に近い床を選ぶ）
   */
  floorAt(x: number, z: number, door: boolean, y: number): number | null
  /** カメラを中へ寄せるときの、中の真ん中（局所） */
  center: THREE.Vector3
  /** 中にいる浮かぶ仲間（KB-001 など。character/ride/party.ts）を、壁と天井の内に収める（局所の点を直す） */
  clampMember?(l: THREE.Vector3): void
}

/** 乗る便を探す問い（乗り場・行き先の向き）と答え */
export interface BoardingQuery {
  /** 乗り場（ケーブルは station.cable-* の id・ホバーは乗り場の id。観覧車は省く） */
  station?: string
  /** 行き先の乗り場（ケーブルの向きを決める） */
  toward?: string
  /** 今から何秒より先に扉が閉まる便（乗り込むのに要る時間） */
  lead?: number
}
export interface Boarding {
  /** 便（ゴンドラの番号・車両の番号） */
  run: number
  /** 扉が開くまでの秒（もう開いていれば 0） */
  waitSec: number
  /** 扉が閉まるまでの秒（止まらない乗り物は扉が開いてから乗り込める間） */
  closeSec: number
  /** 発車までの秒（止まらない乗り物は null） */
  departSec: number | null
  /** 扉の側（車室の局所の x の向き。−1 / 1。観覧車は 0 = −z の面） */
  side: number
}

/** 乗る人の居場所（車室の局所。中の光の向きを決める）: z = 座る・立つ所の z、side = 乗る扉の側（窓の側）、comp = ケーブルカーの区画 */
export interface CabinSeat {
  z: number
  side: 1 | -1
  comp?: number
}

export interface CabinLightOut {
  dir: THREE.Vector3
  color: THREE.Color
  intensity: number
  ambient: THREE.Color
}

/**
 * 車室に乗っている人（乗客の一覧に入れる形）。地図は Character を知らないので、乗る人の側の状態（乗っている便・車室の中か・居場所）をこの形で受ける
 */
export interface CabinRider {
  readonly car: Car | null
  readonly inside: boolean
  readonly seat: CabinSeat
}

/** 乗り物の種類 */
export interface Vehicle {
  id: VehicleId
  label: string
  cabin: CabinSpec
  /** 便 car の今のコマの、車室の局所 → シーンの行列（便が見つからなければ単位行列） */
  poseOf(car: Car, out: THREE.Matrix4): THREE.Matrix4
  /** 次に乗れる便（だめなら null） */
  nextBoarding(q: BoardingQuery): Boarding | null
  /** 便 run が乗り場 at に着いて扉が開くまでの秒（着かない・もう過ぎたなら null） */
  arrival(run: number, at: string): number | null
  /** 便 car の中の、居場所 seat の人を照らす光（暗いときの天井の灯りなど）。head = 頭の位置（シーン）。光の強さ（0〜1。0 なら照らさない）を返す */
  light?(car: Car, seat: CabinSeat, head: THREE.Vector3, out: CabinLightOut): number
  /** カメラが中なら露出を温室の値（四方がガラスの箱）にする */
  glassBox: boolean
  /** 屋根も壁も無い乗り物（ホバーの一人乗り）: 車室の中へ構図を寄せない・中の光で照らさない（人は外の光のまま） */
  open?: boolean
  /** 便ごとの車室（同じ鍵には同じ物を返す。乗り始めるとき・便を替えるときに引く。毎コマは引かず、乗る人が持つ参照を使う） */
  car(run: number, line?: CarLine): Car
  /** 今までに引いた便の車室（引いた順。乗客がいるかを毎コマ見るときに、割り当てをせずに回る） */
  readonly cars: readonly Car[]
}

/**
 * 便と一緒に運ぶ物（car.attach の戻り値。外すときは car.detach に渡す）。object は親の座標がシーンと同じ物（シーンの直下か、行列が単位の親の下）。
 * weight = 運ぶ強さ（0〜1。あとから書き換えてよい。次の setPose から効く）
 */
export interface CarAttachment {
  readonly object: THREE.Object3D
  weight: number
}

/** setPose の通し番号（便を乗り換えても番号が重ならないように、モジュール全体で 1 つ） */
let poseSerial = 0

const _q = new THREE.Quaternion()
const _qi = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()
const _l = new THREE.Vector3()
const _w = new THREE.Vector3()
const _qa = new THREE.Quaternion()

/** 便ごとの車室（Vehicle.car で引く） */
export class Car {
  readonly vehicle: Vehicle
  /** 便（ゴンドラの番号・車両の番号・系統や航路の便の番号） */
  readonly run: number
  /** 系統・航路（緑電・運河バス。ほかは null） */
  readonly line: CarLine
  /** 車室の局所 → シーンの行列（向きは quat）と、局所の原点のシーンの位置 */
  readonly matrix = new THREE.Matrix4()
  readonly quat = new THREE.Quaternion()
  readonly pivot = new THREE.Vector3()
  /**
   * 前のコマからの車室の動きの全部（回転込み）: 前のコマの pivot（prevPivot）・位置の動き（delta）・向きの変わり（deltaQuat。前の向き → 今の向き）。
   * serial は setPose のたびに、モジュール全体の通し番号で替わる（車室と一緒に運ぶ物（KB-001・揺れもの）が、同じコマの動きを 1 回だけ足すため。§7 の 219）。
   * 引く形の口: 使う側は serial が替わったら 1 回だけ carry(位置, 強さ) で運び、向きは identity.slerp(deltaQuat, 強さ) を前から掛ける
   */
  readonly prevPivot = new THREE.Vector3()
  readonly delta = new THREE.Vector3()
  readonly deltaQuat = new THREE.Quaternion()
  serial = 0
  /** 乗っている人（乗り込む・待つ・降りる途中も） */
  readonly passengers: CabinRider[] = []
  /** 一緒に運ぶ物（attach で登録した順） */
  readonly attachments: CarAttachment[] = []

  constructor(vehicle: Vehicle, run: number, line: CarLine) {
    this.vehicle = vehicle
    this.run = run
    this.line = line
  }

  /**
   * 今のコマの行列を書く（乗る仕組みが毎コマ。pivot・quat・delta も）。first = 乗り始め（前のコマの動きを足さない。Car は使い回すので、乗り始めは必ず true）。
   * 決まり: 1 便に 1 コマ 1 回だけ書く（2 回書くと、2 回目の delta・deltaQuat が 0 になり、引く形・登録する形で運ぶ物が動かない。
   * 歩く 2 人が同じ便に乗る形と、すべての便の行列を地図が書く形は段 5）。
   * 終わりに、登録した物（attach）を前のコマからの動きの分だけ運ぶ（first のコマは運ばない）
   */
  setPose(m: THREE.Matrix4, first: boolean) {
    const prev = _v.copy(this.pivot)
    _qi.copy(this.quat)
    this.matrix.copy(m)
    m.decompose(this.pivot, _q, _s)
    this.quat.copy(_q)
    if (first) {
      this.delta.set(0, 0, 0)
      this.prevPivot.copy(this.pivot)
      this.deltaQuat.identity()
    } else {
      this.delta.subVectors(this.pivot, prev)
      this.prevPivot.copy(prev)
      this.deltaQuat.copy(_q).multiply(_qi.invert())
    }
    this.serial = ++poseSerial
    if (first) return
    const list = this.attachments
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      if (a.weight <= 0) continue
      this.carry(a.object.position, a.weight)
      a.object.quaternion.premultiply(_qa.identity().slerp(this.deltaQuat, Math.min(1, a.weight)))
    }
  }

  /**
   * 便と一緒に運ぶ物を登録する（登録する形。object は親の座標がシーンと同じ物、weight = 運ぶ強さ 0〜1）。
   * 次の setPose（first でないコマ）から、position を carry(position, weight) で、quaternion に identity.slerp(deltaQuat, weight) を前から掛けて運ぶ。
   * 便が替わっても自動では外さない（外すのは使う側。detach）。同じ物を 2 回登録すると 2 回運ぶ
   */
  attach(object: THREE.Object3D, weight = 1): CarAttachment {
    const a: CarAttachment = { object, weight }
    this.attachments.push(a)
    return a
  }

  /** 一緒に運ぶのをやめる（attach の戻り値か、登録した物。登録していなければ何もしない） */
  detach(target: CarAttachment | THREE.Object3D) {
    const list = this.attachments
    for (let i = 0; i < list.length; i++) {
      if (list[i] === target || list[i].object === target) {
        list.splice(i, 1)
        return
      }
    }
  }

  /** 車室の局所 → シーン（pivot を渡せば、向きは今の車室のまま原点だけ替える） */
  toWorld(x: number, y: number, z: number, out = new THREE.Vector3(), pivot: THREE.Vector3 = this.pivot) {
    return out.set(x, y, z).applyQuaternion(this.quat).add(pivot)
  }

  /** シーン → 車室の局所 */
  toCabin(p: THREE.Vector3, out = new THREE.Vector3(), pivot: THREE.Vector3 = this.pivot) {
    _qi.copy(this.quat).invert()
    return out.subVectors(p, pivot).applyQuaternion(_qi)
  }

  /** シーンの向き → 車室の局所の向き */
  dirToCabin(d: THREE.Vector3, out = new THREE.Vector3()) {
    _qi.copy(this.quat).invert()
    return out.copy(d).applyQuaternion(_qi)
  }

  /** 車室の局所の向き → シーンの向き */
  dirToWorld(d: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(d).applyQuaternion(this.quat)
  }

  /**
   * 前のコマの車室に付いていた点 p（シーン）を、今のコマの車室の同じ所へ運ぶ（車室の動き・向きの変わりの全部。§7 の 219）。
   * weight = 運ぶ強さ（0 = 運ばない・1 = 車室と一緒・間は運んだ所との間）。引く形の口（便の serial ごとに 1 回）
   */
  carry(p: THREE.Vector3, weight = 1) {
    if (weight <= 0) return p
    _v.subVectors(p, this.prevPivot).applyQuaternion(this.deltaQuat).add(this.pivot)
    return weight >= 1 ? p.copy(_v) : p.lerp(_v, weight)
  }

  /** 車室の局所の点が中か（壁から margin 内側） */
  inside(local: THREE.Vector3, margin = 0) {
    return this.vehicle.cabin.inside(local, margin)
  }

  /**
   * 車室の中の床の高さ（シーンの y）。壁の内と、door（乗り降りの途中）なら扉の敷居から乗り場までのすき間も床にする。ほかは null。refY = 今の高さ（シーン）。
   * 傾いた車室（ケーブルカー）は、床の局所の高さをシーンへ戻して、その点の高さを読む（2 回で十分近い）
   */
  floorAt(x: number, z: number, door: boolean, refY?: number): number | null {
    const cabin = this.vehicle.cabin
    _w.set(x, refY ?? this.pivot.y, z)
    this.toCabin(_w, _l)
    let fy = cabin.floorAt(_l.x, _l.z, door, _l.y)
    if (fy === null) return null
    for (let i = 0; i < 2; i++) {
      this.toWorld(_l.x, fy, _l.z, _w)
      // 床の点のシーンの x, z がずれた分だけ、局所の x, z を戻す
      _w.set(x, _w.y, z)
      this.toCabin(_w, _l)
      const f2 = cabin.floorAt(_l.x, _l.z, door, fy)
      if (f2 === null) break
      fy = f2
    }
    return this.toWorld(_l.x, fy, _l.z, _w).y
  }

  /** 乗客の一覧に入れる（もういれば何もしない） */
  board(rider: CabinRider) {
    if (!this.passengers.includes(rider)) this.passengers.push(rider)
  }

  /** 乗客の一覧から外す */
  leave(rider: CabinRider) {
    const i = this.passengers.indexOf(rider)
    if (i >= 0) this.passengers.splice(i, 1)
  }
}

/** 乗り物の種類を作る（便ごとの車室を引く口 car と、引いた車室の一覧 cars を付ける。同じ系統・便には同じ Car） */
export function defineVehicle(spec: Omit<Vehicle, 'car' | 'cars'>): Vehicle {
  const byLine = new Map<CarLine, Map<number, Car>>()
  const cars: Car[] = []
  const v = spec as Omit<Vehicle, 'cars'> as Vehicle & { cars: Car[] }
  v.cars = cars
  v.car = (run, line = null) => {
    let runs = byLine.get(line)
    if (!runs) byLine.set(line, (runs = new Map()))
    let c = runs.get(run)
    if (!c) {
      runs.set(run, (c = new Car(v, run, line)))
      cars.push(c)
    }
    return c
  }
  return v
}
