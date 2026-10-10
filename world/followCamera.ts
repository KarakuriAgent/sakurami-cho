import * as THREE from 'three'
import { insideLab, SHELL } from '../core/site'
import { SITE } from '../core/town'
import { insideHall, ROOM, type Obstacle } from '../core/lab/plan'
import { labNavObstacles } from '../core/lab/navData'
import { interiors } from './outdoor/interior/interiors'
import { designedY, obstacleDistance, site } from './outdoor/site/siteModel'
import { terrainHeight } from './outdoor/town/terrain'
import { townSolids } from './walk/townSolids'
import { townWalk } from './walk/townWalk'
import type { CabinRider, Car } from './outdoor/transit/vehicle'

/**
 * 人を追うカメラ（three の形。docs/design/map-split.md §8 の段 6。例のアプリ town-walker が使う。kanon-lab のカメラ（src/camera/）とは別の、簡単な物）。
 *
 * - 注視点は追う物の足元 ＋ 目の高さ（eye。VRM が無ければ使う側が 1.5m などを渡す）。カメラは注視点のまわりの球の上（向き yaw・仰ぎ pitch・離れ distance）
 * - 注視点からカメラへの線の途中に、さえぎる物があれば、当たった所の手前まで寄せる:
 *   町の建物・木・石段のわきの擁壁（world/walk/townSolids.ts）、ラボのまわりの外の小物（site.obstacles）、ラボの殻（外から）、地面、
 *   中のある建物の壁・床・天井・家具（interior/model.ts の cameraOk）、ラボの中なら部屋の箱（壁・天井の照明の梁より下）と家具（core/lab/navData.ts の障害物）、
 *   部屋の無い中のある建物（楓坂駅の上屋とホーム）の外形の線（柵・壁。追う物が外形の外ならカメラも外、中なら中。6-7）、
 *   地形の草むら（道・ラボのまわりのセットの外。world/outdoor/town/grass.ts の株の高さ）と、カメラの床より少し上にある地形（土手に埋まったホームの上など。6-7）
 * - 乗り物の車室の中にいる間（追う物の ride。観覧車のゴンドラ・ケーブルカー・緑電・運河バス。6-4）は、さえぎる物は車室の壁・天井・床だけにして、
 *   カメラを車室の中に収める（車体の中・外にカメラを置かない）。注視点は車室と一緒に運び、向きも車室の向きの変わりと一緒に回す。
 *   狭い車室ですぐ近くでさえぎられるときは、仰ぎに加えて向きも変えて（左右 30° ずつ）、車室の長い方へ回す
 *   屋根も壁も無い乗り物（ホバーの一人乗り）は外のまま
 * - カメラは地面・床の 0.3m 上より下へ行かない。草むらの生える地形の上では、地形の 0.65m 上（草の葉の上）より下へ行かない（6-7）
 * - すぐ近く（1.6m より手前）でさえぎられるとき（家具・低い塀・部屋の壁の手前）は、仰ぎを上げて（上から見下ろして）届く向きを探す（lift）
 * - 寄るのはすぐ（そのコマで。壁の中に入らないように）、離れるのはゆっくり。注視点もなめらかに追い、大きく跳んだら（置き直し・ワープ）一度に置く。
 *   snap() で次のコマに一度に置く（使う側は Character の 'place' の出来事で呼ぶ）
 * - ドラッグで回す（向き・仰ぎ）・ホイールで寄る・離れる（connect(要素)）
 *
 * 毎コマ update(追う物, 目の高さ, dt) を、町の更新（town.update）と乗り物・歩き（人の位置が決まる）のあと、町の view（town.view。カメラの位置を
 * 細かさの中心にする）の前に呼ぶ（例のアプリは R3F の優先度 −1）
 */

/** 追う物（足元の位置。Character・町の注目点 TownFocus がそのまま入る） */
export interface FollowTarget {
  readonly position: THREE.Vector3
  /**
   * 任意: 乗っている車室（Character・TownFocus の ride。乗っていなければ car は null）。車室の中（inside）にいる間は、カメラを車室の中に収める（6-4）
   */
  readonly ride?: CabinRider
}

export interface FollowCameraOptions {
  /** 初めの離れ（m。既定 4.5） */
  distance?: number
  /** ホイールで寄れるいちばん近い離れ（m。既定 1.2）。さえぎる物で寄せるときは、これより近くまで寄る */
  minDistance?: number
  /** ホイールで離れられるいちばん遠い離れ（m。既定 40） */
  maxDistance?: number
  /** 初めの向き（ラジアン。カメラが注視点から見てどちらにいるか。0 = +Z の側（南）。人の向き heading と同じ測り方で、heading + π なら後ろ） */
  yaw?: number
  /** 初めの仰ぎ（ラジアン。0 = 水平、正で上から見下ろす。既定 0.28） */
  pitch?: number
  /** ラボの中で避ける家具（省けば地図の置き場所の表 LAB_PLACEMENTS で並べた障害物 labNavObstacles()。navOnly の物は避けない） */
  labObstacles?: readonly Obstacle[]
}

/** 人を追うカメラ */
export interface FollowCamera {
  /** 動かすカメラ */
  readonly camera: THREE.Camera
  /** 向き（ラジアン。0 = カメラが注視点の +Z の側） */
  yaw: number
  /** 仰ぎ（ラジアン。minPitch〜maxPitch） */
  pitch: number
  /** 欲しい離れ（m。さえぎる物が無いときの離れ） */
  distance: number
  /** 今の離れ（m。さえぎる物で寄せたあと） */
  readonly current: number
  /** 今の注視点（シーンの座標） */
  readonly target: THREE.Vector3
  /** このコマで寄せた理由（さえぎった物の名前。寄せていなければ null） */
  readonly blocker: string | null
  /** すぐ近くでさえぎられたので、上から見下ろす向きへ足している仰ぎ（ラジアン。0 なら足していない） */
  readonly lift: number
  /** 回す（ラジアン。dx は向き、dy は仰ぎ） */
  orbit(dx: number, dy: number): void
  /** 離れを k 倍にする（1 より小さいと寄る） */
  zoom(k: number): void
  /** 次のコマで、注視点と離れを一度に置く（なめらかに追わない） */
  snap(): void
  /** 毎コマ（target = 追う物、eye = 足元から目の高さ（m）、dt = 前のコマからの秒） */
  update(target: FollowTarget, eye: number, dt: number): void
  /** ドラッグで回す・ホイールで寄る（要素は Canvas など）。やめる関数を返す */
  connect(element: HTMLElement): () => void
}

/** 仰ぎの範囲（ラジアン。下から少し見上げる〜ほぼ真上から） */
const MIN_PITCH = -0.2
const MAX_PITCH = 1.35
/** さえぎる物で寄せるときの、いちばん近い離れ（m） */
const NEAR = 0.35
/** さえぎる物からカメラを離す余白（線の上で手前へ戻す長さ。m） */
const BACK_OFF = 0.3
/** 地面・床から上の余白（m） */
const ABOVE_GROUND = 0.3
/** 離れるときの速さ（1 秒あたりの割合の指数）・注視点を追う速さ */
const EASE_OUT = 1.6
const EASE_TARGET = 12
/** すぐ近く（この離れより手前）でさえぎられたら、仰ぎを LIFT_STEP ずつ上げて届く向きを探す。上げる速さ・戻す速さ（1 秒あたりの割合の指数） */
const LIFT_NEED = 1.6
const LIFT_STEP = 0.15
const LIFT_UP = 8
const LIFT_DOWN = 1.5
/** 注視点がこれより跳んだら（置き直し・ワープ）なめらかに追わずに置く（m） */
const JUMP = 4
/**
 * 草むら（world/outdoor/town/grass.ts。株の高さは地形から 0.5m ほどまで）: 線がこの高さより下を通ったらさえぎられたと見て（GRASS_TOP）、カメラは
 * 地形のこの高さより下へ行かない（GRASS_CLEAR）。6-7
 */
const GRASS_TOP = 0.55
const GRASS_CLEAR = 0.65
/**
 * カメラの床（ホーム・乗り場の面・道）より地形がこの高さまで上なら、カメラは地形の中（土手に埋まったホームの上など）と見て、地形を床にする。
 * これより上の地形はトンネル・地下の道の上なので見ない（m。6-7）
 */
const TERRAIN_COVER = 2.5
/** ラボの床の標高（地形の標高からシーンの y へ） */
const LAB_FLOOR = SITE.labFloorElevation

/** 車室の中のカメラの、壁・天井・床からの余白（m） */
const CABIN_MARGIN = 0.12
/** 車室の中ですぐ近くでさえぎられたら、向きを左右に CABIN_YAW_STEP ずつ（半周まで）変えて、届く離れがいちばん長い向きへ回す（速さは 1 秒あたりの割合の指数） */
const CABIN_YAW_STEP = Math.PI / 6
const CABIN_TURN = 3

/** ラボの殻の外の箱（外のカメラはこの中に入らない。屋上より上はよい） */
const SHELL_BOX = { x0: -SHELL.outerX - 0.3, x1: SHELL.outerX + 0.3, z0: SHELL.northOuter - 0.3, z1: SHELL.portalZ + 0.3, y1: SHELL.parapetTop + 0.3 }

/** 点から障害物までの距離（中なら負） */
function obstacleDist(o: Obstacle, x: number, z: number) {
  if (o.kind === 'circle') return Math.hypot(x - o.center[0], z - o.center[1]) - o.radius
  const dx = Math.max(o.min[0] - x, 0, x - o.max[0])
  const dz = Math.max(o.min[1] - z, 0, z - o.max[1])
  return dx === 0 && dz === 0 ? -1 : Math.hypot(dx, dz)
}

/** 追う物が中にいる車室（屋根も壁も無い乗り物・車室の外なら null） */
function cabinOf(target: FollowTarget): Car | null {
  const r = target.ride
  const car = r?.car ?? null
  return car && r!.inside && !car.vehicle.open ? car : null
}

/** 人を追うカメラを作る（camera を毎コマ動かす。R3F なら既定のカメラ） */
export function createFollowCamera(camera: THREE.Camera, o: FollowCameraOptions = {}): FollowCamera {
  return new Follow(camera, o)
}

class Follow implements FollowCamera {
  readonly camera: THREE.Camera
  yaw: number
  pitch: number
  distance: number
  current: number
  readonly target = new THREE.Vector3()
  blocker: string | null = null
  lift = 0
  private readonly minDistance: number
  private readonly maxDistance: number
  private readonly obstacles: readonly Obstacle[]
  private snapping = true
  private readonly dir = new THREE.Vector3()
  private readonly p = new THREE.Vector3()
  private readonly want = new THREE.Vector3()
  private readonly local = new THREE.Vector3()
  private readonly turn = new THREE.Vector3()
  private readonly focus = new THREE.Vector3()
  private readonly from = new THREE.Vector3()
  /** 中にいる車室（無ければ null）と、運んだ車室の動きの番号（Car.serial。同じコマの動きを 2 回足さない） */
  private car: Car | null = null
  private carSerial = -1
  /** このコマの注視点（さえぎる物の決まりで、追う物が部屋の無い建物の外形の中か外かを見る） */
  private at = new THREE.Vector3()

  constructor(camera: THREE.Camera, o: FollowCameraOptions) {
    this.camera = camera
    this.distance = o.distance ?? 4.5
    this.current = this.distance
    this.minDistance = o.minDistance ?? 1.2
    this.maxDistance = o.maxDistance ?? 40
    this.yaw = o.yaw ?? 0
    this.pitch = THREE.MathUtils.clamp(o.pitch ?? 0.28, MIN_PITCH, MAX_PITCH)
    this.obstacles = (o.labObstacles ?? labNavObstacles()).filter((b) => !b.navOnly)
  }

  orbit(dx: number, dy: number) {
    this.yaw += dx
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, MIN_PITCH, MAX_PITCH)
  }

  zoom(k: number) {
    this.distance = THREE.MathUtils.clamp(this.distance * k, this.minDistance, this.maxDistance)
  }

  snap() {
    this.snapping = true
  }

  update(target: FollowTarget, eye: number, dt: number) {
    const want = this.want.set(target.position.x, target.position.y + eye, target.position.z)
    // 車室の中: 注視点を車室と一緒に運び（なめらかに追うのは車室の中の動きだけ）、向きも車室の向きの変わりと一緒に回す
    const car = cabinOf(target)
    if (car !== this.car) {
      this.car = car
      this.carSerial = car?.serial ?? -1
    } else if (car && car.serial !== this.carSerial) {
      this.carSerial = car.serial
      car.carry(this.target)
      this.turn.set(0, 0, 1).applyQuaternion(car.deltaQuat)
      this.yaw += Math.atan2(this.turn.x, this.turn.z)
    }
    const snap = this.snapping || this.target.distanceToSquared(want) > JUMP * JUMP
    if (snap) this.target.copy(want)
    else this.target.lerp(want, 1 - Math.exp(-dt * EASE_TARGET))
    // 注視点（車室の中で、注視点が壁・天井の外（低いゴンドラで頭が天井に近いなど）なら、車室の中の真ん中の方へ中まで寄せた点）
    const t = this.car ? this.intoCabin(this.focus.copy(this.target), this.car) : this.target
    const foot = this.target.y - eye
    this.at.copy(t)
    const inHall = insideHall(t.x, t.z)
    const inLab = insideLab(t.x, t.z)
    // すぐ近くでさえぎられるなら（家具・低い塀・部屋の壁の手前）、上から見下ろす向きへ逃がす（届く離れがいちばん長い仰ぎ。上げるのは速く、戻すのはゆっくり）
    const need = Math.min(this.distance, LIFT_NEED)
    let lift = 0
    let best = this.reach(t, this.pitch, inHall, inLab)
    if (this.car && best < need) {
      // 車室の中: 向き（左右 30° ずつ・半周まで）と仰ぎ（0・0.3・0.6）を変えて、届く離れがいちばん長い向きへ回す（窓の側の席から、車室の長い方へ）
      let bestA = best
      let bestDy = 0
      for (let i = 1; i <= 6; i++) {
        for (const sign of i === 6 ? [1] : [1, -1]) {
          const dy = sign * i * CABIN_YAW_STEP
          for (let k = 0; k <= 0.6 + 1e-6 && this.pitch + k <= MAX_PITCH + 1e-6; k += 0.3) {
            const a = this.reach(t, this.pitch + k, inHall, inLab, false, this.yaw + dy)
            if (a > bestA + 0.1) {
              bestA = a
              bestDy = dy
            }
          }
        }
      }
      if (bestDy) {
        this.yaw += bestDy * (snap ? 1 : 1 - Math.exp(-dt * CABIN_TURN))
        best = this.reach(t, this.pitch, inHall, inLab)
      }
    }
    if (best < need) {
      for (let k = LIFT_STEP; this.pitch + k <= MAX_PITCH + 1e-6; k += LIFT_STEP) {
        const a = this.reach(t, this.pitch + k, inHall, inLab)
        if (a > best + 0.05) {
          best = a
          lift = k
        }
        if (a >= need) break
      }
    }
    if (snap || lift > this.lift) this.lift += (lift - this.lift) * (snap ? 1 : 1 - Math.exp(-dt * LIFT_UP))
    else this.lift += (lift - this.lift) * (1 - Math.exp(-dt * LIFT_DOWN))
    // 今の向きで、注視点から外へ線をたどり、初めにさえぎる物の手前までにする
    const pitch = Math.min(MAX_PITCH, this.pitch + this.lift)
    const allowed = this.reach(t, pitch, inHall, inLab, true)
    if (snap || allowed < this.current) this.current = allowed
    else this.current += (allowed - this.current) * (1 - Math.exp(-dt * EASE_OUT))
    this.snapping = false
    const p = this.p.copy(this.direction(pitch)).multiplyScalar(this.current).add(t)
    // 地面・床の 0.3m 上より下へ行かない（床は足元の高さに近い物。建物の中で上の階の床を拾わないように）。車室の中は車室の床で止めたので見ない
    if (!this.car) {
      const g = this.groundAt(p, inLab, foot)
      if (p.y < g + ABOVE_GROUND) p.y = g + ABOVE_GROUND
      // 草むらの生える地形・カメラの床より少し上の地形の上（ラボの中・中のある建物の外形のまわり 0.6m の内は見ない）
      if (!(inLab && insideLab(p.x, p.z)) && !interiors.modelAt(p.x, p.z)?.inBuilding(p.x, p.z, 0.6)) {
        const n = this.natural(p.x, p.z, g)
        if (n && p.y < n.y + (n.grass ? GRASS_CLEAR : ABOVE_GROUND)) p.y = n.y + (n.grass ? GRASS_CLEAR : ABOVE_GROUND)
      }
    } else if (!this.car.inside(this.car.toCabin(p, this.local), CABIN_MARGIN)) {
      // いちばん近く（NEAR）でも車室の外なら、注視点との間で中まで戻す
      this.towardInside(p, t, this.car)
    }
    this.camera.position.copy(p)
    this.camera.lookAt(t)
    this.camera.updateMatrixWorld()
  }

  /** 車室の中の点にする（中でなければ、車室の中の真ん中（cabin.center）の方へ中まで寄せる）。p を書き換えて返す */
  private intoCabin(p: THREE.Vector3, car: Car) {
    if (car.inside(car.toCabin(p, this.local), CABIN_MARGIN)) return p
    const c = car.vehicle.cabin.center
    const center = car.toWorld(c.x, c.y, c.z, this.turn)
    return this.towardInside(p, center, car)
  }

  /** 点 p を、車室の中の点 inner との間で、車室の中に入るいちばん p に近い所へ動かす（二分。p を書き換えて返す） */
  private towardInside(p: THREE.Vector3, inner: THREE.Vector3, car: Car) {
    const from = this.from.copy(p)
    let lo = 0
    let hi = 1
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      p.lerpVectors(from, inner, mid)
      if (car.inside(car.toCabin(p, this.local), CABIN_MARGIN)) hi = mid
      else lo = mid
    }
    return p.lerpVectors(from, inner, hi)
  }

  /** 注視点から仰ぎ pitch・向き yaw（省けば今の向き）の向き */
  private direction(pitch: number, yaw = this.yaw) {
    const cp = Math.cos(pitch)
    return this.dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp)
  }

  /** 注視点 t から仰ぎ pitch・向き yaw の向きへ、さえぎられずに届く離れ（欲しい離れまで）。record なら寄せた理由を blocker に書く */
  private reach(t: THREE.Vector3, pitch: number, inHall: boolean, inLab: boolean, record = false, yaw = this.yaw) {
    const dir = this.direction(pitch, yaw)
    let blocker: string | null = null
    let allowed = this.distance
    for (let s = NEAR; ; s += s < 6 ? 0.2 : 0.4) {
      const d = Math.min(s, this.distance)
      this.p.copy(dir).multiplyScalar(d).add(t)
      const b = this.blockedAt(this.p, inHall, inLab)
      if (b) {
        allowed = Math.min(this.distance, Math.max(NEAR, d - BACK_OFF))
        blocker = b
        break
      }
      if (d >= this.distance) break
    }
    if (record) this.blocker = blocker
    return allowed
  }

  /** カメラを点 p に置けない・線が通れないなら、その理由（さえぎる物の名前）。inHall・inLab は注視点がラボの中か */
  private blockedAt(p: THREE.Vector3, inHall: boolean, inLab: boolean): string | null {
    // 車室の中: 車室の壁・天井・床だけ（窓の外の町は見ない。車室の中に収める）
    const car = this.car
    if (car) return car.inside(car.toCabin(p, this.local), CABIN_MARGIN) ? null : `${car.vehicle.label}の車室`
    if (inLab) {
      // ラボの中: 部屋の箱（壁・天井・床）と家具
      if (inHall ? !insideHall(p.x, p.z, -0.15) : !insideLab(p.x, p.z, -0.15)) return 'ラボの壁'
      // 天井の下の照明の梁・ケーブルの棚（天井から 0.5〜0.55m 下）より下に
      if (p.y > ROOM.height - 0.7) return 'ラボの天井'
      if (p.y < 0.05) return 'ラボの床'
      for (const o of this.obstacles) if (p.y < o.height + 0.05 && obstacleDist(o, p.x, p.z) < 0.12) return o.name
      return null
    }
    // 外から: ラボの殻
    if (p.x > SHELL_BOX.x0 && p.x < SHELL_BOX.x1 && p.z > SHELL_BOX.z0 && p.z < SHELL_BOX.z1 && p.y < SHELL_BOX.y1) return 'ラボの殻'
    const model = interiors.modelAt(p.x, p.z)
    if (model) {
      // 中のある建物のゾーン: 建物の壁・床・天井・家具は中の決まり、建物の外（外形から 0.6m より外）は町の木・まわりの建物・草むらも
      if (!model.cameraOk(p, 0.1)) return model.zone.label
      // 部屋の無い建物（楓坂駅の上屋とホーム。cameraOk は地面の上ならよい）: 外形の線（柵・壁）を越えない。追う物が外形の外ならカメラも外
      // （町の当たりでは「建物」だが、外形のまわり 0.6m の内は木だけを見るので、ここで止める）、中ならカメラも中
      if (!model.rooms.length && model.inBuilding(p.x, p.z, 0.05) !== model.inBuilding(this.at.x, this.at.z, 0)) return model.zone.label
      const near = model.inBuilding(p.x, p.z, 0.6)
      if (!near) {
        const ground = this.naturalBlocker(p, model.groundAt(p.x, p.z, p.y) ?? townWalk.groundY(p.x, p.z, p.y))
        if (ground) return ground
      }
      return townSolids.blocker(p.x, p.y, p.z, 0.15, near)
    }
    const g = townWalk.groundY(p.x, p.z, p.y)
    if (p.y < g + 0.05) return '地面'
    const ground = this.naturalBlocker(p, g)
    if (ground) return ground
    for (const s of site.obstacles) if (p.y < g + s.height && obstacleDistance(s, p.x, p.z) < 0.15) return s.name
    return townSolids.blocker(p.x, p.y, p.z, 0.15)
  }

  /**
   * 外の点 (x, z) の、カメラの床 g のかわりに見る地形（草むらの根元）: 地形がカメラの床に近いか、床より少し上（TERRAIN_COVER まで。土手に
   * 埋まったホームなど）なら、その高さと、草むらが生える所か（null ならカメラの床 g のまま。橋・ホームなど地形より上の面、トンネル・地下の道）。
   * 草むらが生える所は、地図の草むら（world/outdoor/landscape.ts の Grass の allowed）と同じ決まりの写しに、町の道の上（舗装。地面の補助の
   * 画像で草を置かない所の近似）を足した物。草むらを描かない画質（low）でも同じに見る
   */
  private natural(x: number, z: number, g: number): { y: number; grass: boolean } | null {
    if (insideLab(x, z, 3)) return null
    const y = terrainHeight(x, -z) - LAB_FLOOR
    if (y < g - 0.15 || y > g + TERRAIN_COVER) return null
    const grass =
      !(x > -11 && x < 11 && z > -15 && z < 11) &&
      !(Math.abs(x) < 400 && Math.abs(z) < 400 && (designedY(x, z) !== null || site.pathAt(x, z, 0.6))) &&
      !interiors.grassBlocked(x, z) &&
      !townWalk.onWalkway(x, z)
    return y > g || grass ? { y: Math.max(y, g), grass } : null
  }

  /** 外の点 p がカメラの床 g のかわりに見る地形・草むらの中なら、その理由（地面・草むら）。地面の近くだけ地形を見る（毎コマ何度も呼ぶので） */
  private naturalBlocker(p: THREE.Vector3, g: number): string | null {
    if (p.y > g + TERRAIN_COVER + GRASS_TOP) return null
    const n = this.natural(p.x, p.z, g)
    if (!n) return null
    if (n.grass && p.y < n.y + GRASS_TOP) return '草むら'
    return p.y < n.y + 0.05 ? '地面' : null
  }

  /** 点の真下の地面・床の高さ（ラボの中は床 0。橋の上と下・建物の階のように重なる所は、追う物の足元の高さ foot に近い物） */
  private groundAt(p: THREE.Vector3, inLab: boolean, foot: number) {
    if (inLab && insideLab(p.x, p.z)) return 0
    const model = interiors.modelAt(p.x, p.z)
    return (model ? model.groundAt(p.x, p.z, foot) : null) ?? townWalk.groundY(p.x, p.z, foot)
  }

  connect(element: HTMLElement) {
    let drag: { id: number; x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
      element.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      this.orbit(-(e.clientX - drag.x) * 0.006, (e.clientY - drag.y) * 0.005)
      drag.x = e.clientX
      drag.y = e.clientY
    }
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      drag = null
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId)
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      this.zoom(Math.exp(e.deltaY * 0.0012))
    }
    const menu = (e: Event) => e.preventDefault()
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('contextmenu', menu)
    return () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('contextmenu', menu)
    }
  }
}
