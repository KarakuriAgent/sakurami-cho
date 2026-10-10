import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * 遠景の形の部品（形をまとめる道具・観覧車・ケーブルカーの車体・灯台の光の帯）。
 * 町の構造物（岸壁・線路・橋・クレーン・灯台など）は town/infraMeshes.ts がこの道具で組み立てる。
 * どれも頂点の色（color）と夜の光（aEmit）を持たせて 1 つの形にまとめ、1 回の描画で描く。
 */

/* -------------------------------------------------------------------------- */
/* まとめて作る道具                                                              */
/* -------------------------------------------------------------------------- */

/** 頂点の色・夜の光（rgb + 種類）を付けた形を集めて、最後に 1 つにまとめる */
export class ShapeBatch {
  private parts: THREE.BufferGeometry[] = []
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()

  /** 形を置く（位置・回転（オイラー角）・大きさ）。color はリニアにして入れる。emit は夜に光る色と種類（1 時計 / 2 窓 / 3 ケーブルカー） */
  add(
    geometry: THREE.BufferGeometry,
    position: readonly [number, number, number],
    color: THREE.ColorRepresentation,
    opts: { rotation?: readonly [number, number, number]; scale?: readonly [number, number, number]; emit?: [THREE.ColorRepresentation, number]; led?: [number, number] } = {},
  ) {
    const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()) as THREE.BufferGeometry
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    this.e.set(...(opts.rotation ?? [0, 0, 0]))
    this.q.setFromEuler(this.e)
    this.m.compose(new THREE.Vector3(...position), this.q, new THREE.Vector3(...(opts.scale ?? [1, 1, 1])))
    g.applyMatrix4(this.m)
    const n = g.attributes.position.count
    const c = new THREE.Color(color)
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const emit = new Float32Array(n * 4)
    if (opts.emit) {
      const ec = new THREE.Color(opts.emit[0])
      for (let i = 0; i < n; i++) emit.set([ec.r, ec.g, ec.b, opts.emit[1]], i * 4)
    }
    g.setAttribute('aEmit', new THREE.BufferAttribute(emit, 4))
    const led = new Float32Array(n * 2)
    if (opts.led) for (let i = 0; i < n; i++) led.set(opts.led, i * 2)
    g.setAttribute('aLed', new THREE.BufferAttribute(led, 2))
    this.parts.push(g)
  }

  /** 頂点ごとの色・aLed を自分で付けた形をそのまま足す（足りない属性は 0 で埋める） */
  push(g: THREE.BufferGeometry) {
    const n = g.attributes.position.count
    if (g.attributes.uv) g.deleteAttribute('uv')
    if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
    if (!g.attributes.aEmit) g.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(n * 4), 4))
    if (!g.attributes.aLed) g.setAttribute('aLed', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
    this.parts.push(g)
  }

  /** 位置・法線・色をそのまま渡す形（地面に沿った帯など） */
  addRaw(positions: number[], color: THREE.ColorRepresentation) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.computeVertexNormals()
    this.add(g, [0, 0, 0], color)
  }

  private raw = { pos: [] as number[], nrm: [] as number[], col: [] as number[], emit: [] as number[] }
  private _c = new THREE.Color()
  private _a = new THREE.Vector3()
  private _b = new THREE.Vector3()

  /** 三角形を 1 つ（シーンの座標。面の法線は頂点の順から。表裏は気にしない: 構造物のシェーダーは両面を描き、見ている側へ法線を向ける） */
  tri(a: readonly number[], b: readonly number[], c: readonly number[], color: THREE.ColorRepresentation, emit?: [THREE.ColorRepresentation, number]) {
    const r = this.raw
    this._a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    this._b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    const n = this._a.cross(this._b)
    const len = n.length()
    if (len < 1e-9) return
    n.multiplyScalar(1 / len)
    this._c.set(color)
    const ec = emit ? new THREE.Color(emit[0]) : null
    for (const p of [a, b, c]) {
      r.pos.push(p[0], p[1], p[2])
      r.nrm.push(n.x, n.y, n.z)
      r.col.push(this._c.r, this._c.g, this._c.b)
      r.emit.push(ec ? ec.r : 0, ec ? ec.g : 0, ec ? ec.b : 0, emit ? emit[1] : 0)
    }
  }

  /** 四角形（a → b → c → d の順） */
  quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], color: THREE.ColorRepresentation, emit?: [THREE.ColorRepresentation, number]) {
    this.tri(a, b, c, color, emit)
    this.tri(a, c, d, color, emit)
  }

  build(): THREE.BufferGeometry {
    const r = this.raw
    if (r.pos.length) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(r.pos, 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(r.nrm, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(r.col, 3))
      g.setAttribute('aEmit', new THREE.Float32BufferAttribute(r.emit, 4))
      g.setAttribute('aLed', new THREE.BufferAttribute(new Float32Array((r.pos.length / 3) * 2), 2))
      this.parts.push(g)
      this.raw = { pos: [], nrm: [], col: [], emit: [] }
    }
    if (!this.parts.length) return new THREE.BufferGeometry()
    const merged = mergeGeometries(this.parts, false)
    this.parts.forEach((g) => g.dispose())
    this.parts = []
    merged.computeBoundingSphere()
    return merged
  }
}

export const BOX = new THREE.BoxGeometry(1, 1, 1)
export const CYL16 = new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
export const CONE16 = new THREE.ConeGeometry(0.5, 1, 16)
export const HEMI = new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2)

/** 形のローカルの +z（正面）を、その方位（真北から時計回りの度）へ向けるときの Y 軸まわりの回転（ラジアン） */
export const yawOf = (bearingDeg: number) => Math.PI - (bearingDeg * Math.PI) / 180

/** 灯台の光の帯（灯台から +z へ range m 伸びる円錐） */
export function beamGeometry(range: number) {
  const g = new THREE.CylinderGeometry(0.6, range * 0.045, range, 24, 1, true)
  // 先の細い方（top）を灯台に、+z へ伸ばす
  g.translate(0, -range / 2, 0)
  g.rotateX(-Math.PI / 2)
  return g
}
