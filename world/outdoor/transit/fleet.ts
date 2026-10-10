import * as THREE from 'three'
import { SITE } from '../../../core/town'

/**
 * 動く物のインスタンスの入れ物。毎コマ、走っている車両の行列と iInfo を書き直す（数十〜数百。CPU で軽い）。
 * 近くの形と遠くの形の 2 つの InstancedMesh を持ち、カメラからの距離で分ける（遠くは箱に近い形）。
 */

const LAB = SITE.labFloorElevation

export class Fleet {
  readonly near: THREE.InstancedMesh
  readonly far: THREE.InstancedMesh | null
  private nInfo: THREE.InstancedBufferAttribute
  private fInfo: THREE.InstancedBufferAttribute | null
  private nearCount = 0
  private farCount = 0
  /** 近くの形で描く距離（m） */
  farFrom: number

  constructor(name: string, nearGeo: THREE.BufferGeometry, farGeo: THREE.BufferGeometry | null, material: THREE.Material, capacity: number, farFrom = 450) {
    this.farFrom = farFrom
    const mk = (g: THREE.BufferGeometry, suffix: string) => {
      const geo = g.clone()
      const info = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
      info.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('iInfo', info)
      const m = new THREE.InstancedMesh(geo, material, capacity)
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.count = 0
      m.frustumCulled = false
      m.name = `transit:${name}${suffix}`
      return { m, info }
    }
    const n = mk(nearGeo, '')
    this.near = n.m
    this.nInfo = n.info
    if (farGeo) {
      const f = mk(farGeo, ':far')
      this.far = f.m
      this.fInfo = f.info
    } else {
      this.far = null
      this.fInfo = null
    }
  }

  get meshes() {
    return this.far ? [this.near, this.far] : [this.near]
  }

  begin() {
    this.nearCount = 0
    this.farCount = 0
  }

  /** 1 台を足す（行列はシーンの座標。dist = カメラからの距離） */
  add(m: THREE.Matrix4, info: readonly [number, number, number, number], dist: number) {
    const useFar = this.far && dist > this.farFrom
    const mesh = useFar ? this.far! : this.near
    const attr = useFar ? this.fInfo! : this.nInfo
    const i = useFar ? this.farCount : this.nearCount
    if (i >= attr.count) return
    mesh.setMatrixAt(i, m)
    attr.setXYZW(i, info[0], info[1], info[2], info[3])
    if (useFar) this.farCount++
    else this.nearCount++
  }

  end() {
    for (const [mesh, count, attr] of [
      [this.near, this.nearCount, this.nInfo],
      [this.far, this.farCount, this.fInfo],
    ] as const) {
      if (!mesh || !attr) continue
      mesh.count = count
      mesh.visible = count > 0
      if (count) {
        mesh.instanceMatrix.clearUpdateRanges()
        mesh.instanceMatrix.addUpdateRange(0, count * 16)
        mesh.instanceMatrix.needsUpdate = true
        attr.clearUpdateRanges()
        attr.addUpdateRange(0, count * 4)
        attr.needsUpdate = true
      }
    }
  }
}

const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

/**
 * 行列を作る: 平面座標 (x, y)・標高 z の所に、進む向き（平面の単位ベクトル dx, dy と勾配 grade）へ形の +z を向ける。
 * level = true は勾配で傾けない（船・観覧車のゴンドラ。上はいつも真上）。roll = 横の傾き、pitch = 前後の傾き（ラジアン。船の揺れ）
 */
export function placeMatrix(m: THREE.Matrix4, x: number, y: number, z: number, dx: number, dy: number, grade: number, level = false, roll = 0, pitch = 0) {
  // シーン: x = 東、y = 上、z = -北
  _z.set(dx, level ? 0 : grade, -dy).normalize()
  if (pitch) _z.y += pitch
  _z.normalize()
  _x.crossVectors(_up, _z).normalize()
  _y.crossVectors(_z, _x).normalize()
  if (roll) {
    _y.applyAxisAngle(_z, roll)
    _x.crossVectors(_y, _z).normalize()
  }
  m.makeBasis(_x, _y, _z)
  m.setPosition(x, z - LAB, -y)
  return m
}
