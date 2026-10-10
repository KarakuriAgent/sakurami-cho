import * as THREE from 'three'
import { SITE } from '../../../core/town'
import type { P2 } from '../town/townData'

/**
 * 遠くの名前のある建物の形（安い描き方）。町の建物のシェーダー（townMaterials.ts の形のある建物 = TOWN_INSTANCED でない方）の頂点の値で書く:
 * 外壁の窓・窓明かり・質感・汚れは町の建物と同じ答えになる。建物の外形・屋根の形・塔は近くの形と同じ寸法で、細かい物（庇・看板・装飾）は省く。
 *
 * 頂点の値: aFac = (壁に沿った位置, 床からの高さ, 壁の長さ, 4)、aB = (窓のある高さ, 階数, 正面か, 部分)、aWall = (色 0〜255, 外壁の種類)、
 * aRoof = (色, 屋根の形)、aMeta = (用途, 印, 種, 町並みの型)、aTan = (壁に沿った向き（平面）)。部分は 0 壁・1 屋根・2 窓のない壁
 */

const LAB = SITE.labFloorElevation

export interface MassStyle {
  wall: [number, number, number]
  /** 外壁の種類（buildingKit の FACADE） */
  facade: number
  roof: [number, number, number]
  /** 屋根の形（buildingKit の ROOF） */
  roofKind: number
  use: number
  flags: number
  seed: number
  style: number
  floors: number
}

export class MassWriter {
  pos: number[] = []
  fac: number[] = []
  b: number[] = []
  wall: number[] = []
  roof: number[] = []
  meta: number[] = []
  tan: number[] = []
  st: MassStyle = { wall: [200, 200, 200], facade: 1, roof: [90, 90, 90], roofKind: 0, use: 0, flags: 1, seed: 1, style: 0, floors: 1 }

  get count() {
    return this.pos.length / 3
  }

  private v(x: number, y: number, z: number, fac: readonly number[], eaveEff: number, front: number, part: number, dir: P2) {
    const s = this.st
    this.pos.push(x, z - LAB, -y)
    this.fac.push(fac[0], fac[1], fac[2], fac[3])
    this.b.push(eaveEff, s.floors, front, part)
    this.wall.push(s.wall[0], s.wall[1], s.wall[2], s.facade)
    this.roof.push(s.roof[0], s.roof[1], s.roof[2], s.roofKind)
    this.meta.push(s.use, s.flags, (s.seed % 65536) / 65536, s.style)
    this.tan.push(dir[0], dir[1], 0, 0)
  }

  /**
   * 壁（平面の a → b。外から見て a が左）。z0 = 下端の標高、z1 = 上端、floorZ = 床の標高、windowTop = 窓のある高さ（床から。0 なら窓なし）、
   * front = 正面（1 階の店先）
   */
  wallQuad(a: P2, b: P2, z0: number, z1: number, floorZ: number, windowTop: number, front = false, part = 0) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.05 || z1 - z0 < 0.02) return
    const dir: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    const p = windowTop > 0 ? part : 2
    const eff = Math.max(windowTop, 0.5)
    const f = front ? 1 : 0
    const va = z0 - floorZ
    const vb = z1 - floorZ
    const A0 = [-len / 2, va, len, 4]
    const B0 = [len / 2, va, len, 4]
    const A1 = [-len / 2, vb, len, 4]
    const B1 = [len / 2, vb, len, 4]
    // 外向き: 反時計回りの外形の辺 a → b の右手（平面）。シーンの三角形は表が外を向く順で
    this.v(a[0], a[1], z0, A0, eff, f, p, dir)
    this.v(b[0], b[1], z0, B0, eff, f, p, dir)
    this.v(b[0], b[1], z1, B1, eff, f, p, dir)
    this.v(a[0], a[1], z0, A0, eff, f, p, dir)
    this.v(b[0], b[1], z1, B1, eff, f, p, dir)
    this.v(a[0], a[1], z1, A1, eff, f, p, dir)
  }

  /** 壁の三角形（妻壁など。窓なし）。点は外から見て反時計回り */
  wallTri(a: [number, number, number], b: [number, number, number], c: [number, number, number], floorZ: number) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const dir: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    for (const q of [a, b, c]) this.v(q[0], q[1], q[2], [0, q[2] - floorZ, len, 4], 0.5, 0, 2, dir)
  }

  /** 屋根の三角形（平面座標と標高。外から見て反時計回り） */
  roofTri(a: readonly number[], b: readonly number[], c: readonly number[]) {
    const f0 = [0, 0, 1, -1]
    for (const q of [a, b, c]) this.v(q[0], q[1], q[2], f0, 3, 0, 1, [1, 0])
  }

  roofQuad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]) {
    this.roofTri(a, b, c)
    this.roofTri(a, c, d)
  }

  /** 平らな屋根（外形を三角形に。外形は反時計回り） */
  roofFlat(ring: P2[], z: number) {
    const tris = THREE.ShapeUtils.triangulateShape(
      ring.map((q) => new THREE.Vector2(q[0], q[1])),
      [],
    )
    for (const t of tris) {
      const a = ring[t[0]]
      const b = ring[t[1]]
      const c = ring[t[2]]
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (cr >= 0) this.roofTri([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z])
      else this.roofTri([a[0], a[1], z], [c[0], c[1], z], [b[0], b[1], z])
    }
  }

  /** 角柱（外形の壁と平らな屋根）。frontEdge = 正面の辺の番号（-1 なら無し） */
  prism(ring: P2[], z0: number, z1: number, floorZ: number, windowTop: number, roof = true, frontEdge = -1) {
    for (let i = 0; i < ring.length; i++) this.wallQuad(ring[i], ring[(i + 1) % ring.length], z0, z1, floorZ, windowTop, i === frontEdge)
    if (roof) this.roofFlat(ring, z1)
  }

  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.fac, 4))
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.b, 4))
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(this.wall, 4))
    g.setAttribute('aRoof', new THREE.Float32BufferAttribute(this.roof, 4))
    g.setAttribute('aMeta', new THREE.Float32BufferAttribute(this.meta, 4))
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(this.tan, 4))
    g.computeBoundingSphere()
    return g
  }

  merge(o: MassWriter) {
    for (const k of ['pos', 'fac', 'b', 'wall', 'roof', 'meta', 'tan'] as const) {
      const src = o[k]
      const dst = this[k]
      for (let i = 0; i < src.length; i++) dst.push(src[i])
    }
  }
}
