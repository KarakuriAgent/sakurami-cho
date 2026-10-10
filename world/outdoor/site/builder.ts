import * as THREE from 'three'

/**
 * ラボの外観とまわりのセットの形を、頂点の配列へ直接書いて作る道具（何千もの箱を 1 つの形にまとめる）。
 * 頂点には 位置・法線・色（質感を染める色。リニア）・aMat（x = 質感の種類 MAT、y = 種類ごとの値）を持たせる。
 * 面の表は外向き（法線の向き）。シェーダーは片面で描く（見えない裏は描かない）
 */

/** 質感の種類（siteMaterial.ts のシェーダーと同じ番号） */
export const MAT = {
  /** 打ち放しのコンクリート（ラボの外壁。型枠の跡・P コンの穴・雨だれ） */
  formed: 0,
  /** なめらかなコンクリート（テラスの土間・スロープ・袖壁・擁壁・植え込みの箱）。y = 目地の間隔（m。0 なら目地なし） */
  concrete: 1,
  /** 石の敷石（小道） */
  slab: 2,
  /** 御影石（縁石・笠石・石段の踏み面） */
  granite: 3,
  /** 砂利 */
  gravel: 4,
  /** アスファルト */
  asphalt: 5,
  /** 石畳 */
  cobble: 6,
  /** 塗装した鉄（窓枠・手すりの柱・街灯の柱・雨どい・庇）。y = つや（0〜1） */
  paint: 7,
  /** ステンレス・亜鉛めっきの鉄（手すり・室外機・アンテナ） */
  steel: 8,
  /** 木（ベンチの座面・道しるべ） */
  wood: 9,
  /** 屋上の防水（灰色のシート） */
  roof: 10,
  /** 室外機・放熱器のファンの格子（暗い穴） */
  grille: 11,
  /** 植え込みの土 */
  soil: 12,
  /** はげた白い塗装と錆（大パラボラ）。y = 錆の多さ（0〜1） */
  worn: 13,
} as const

const _c = new THREE.Color()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _m = new THREE.Matrix4()
const _v = new THREE.Vector3()
const _n = new THREE.Vector3()
const _nm = new THREE.Matrix3()

type V3 = readonly [number, number, number]

/** 単位の箱の 6 面（外向き。各面 4 点を反時計回り） */
const BOX_FACES: { n: V3; v: V3[] }[] = [
  { n: [1, 0, 0], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
]

/** 箱の面の選び方（+x, -x, +y, -y, +z, -z の順。false の面は作らない） */
export type FaceMask = readonly [boolean, boolean, boolean, boolean, boolean, boolean]
const ALL: FaceMask = [true, true, true, true, true, true]

export class GeoBuilder {
  pos: number[] = []
  nrm: number[] = []
  col: number[] = []
  mat: number[] = []
  idx: number[] = []

  get vertexCount() {
    return this.pos.length / 3
  }

  private vertex(p: V3 | THREE.Vector3, n: V3 | THREE.Vector3, color: THREE.Color, m: number, aux: number) {
    const [px, py, pz] = Array.isArray(p) ? p : [(p as THREE.Vector3).x, (p as THREE.Vector3).y, (p as THREE.Vector3).z]
    const [nx, ny, nz] = Array.isArray(n) ? n : [(n as THREE.Vector3).x, (n as THREE.Vector3).y, (n as THREE.Vector3).z]
    this.pos.push(px, py, pz)
    this.nrm.push(nx, ny, nz)
    this.col.push(color.r, color.g, color.b)
    this.mat.push(m, aux)
    return this.vertexCount - 1
  }

  /** 四角形（a → b → c → d を表から見て反時計回り）。法線は面から */
  quad(a: V3, b: V3, c: V3, d: V3, color: THREE.ColorRepresentation, m: number, aux = 0) {
    _c.set(color)
    // 法線は Newell の方法で（2 点が重なった四角形 = 三角形でも向きが決まる）
    const n = new THREE.Vector3()
    const ps = [a, b, c, d]
    for (let i = 0; i < 4; i++) {
      const p0 = ps[i]
      const p1 = ps[(i + 1) % 4]
      n.x += (p0[1] - p1[1]) * (p0[2] + p1[2])
      n.y += (p0[2] - p1[2]) * (p0[0] + p1[0])
      n.z += (p0[0] - p1[0]) * (p0[1] + p1[1])
    }
    n.normalize()
    const i0 = this.vertex(a, n, _c, m, aux)
    this.vertex(b, n, _c, m, aux)
    this.vertex(c, n, _c, m, aux)
    this.vertex(d, n, _c, m, aux)
    this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
  }

  /** 三角形（反時計回りが表） */
  tri(a: V3, b: V3, c: V3, color: THREE.ColorRepresentation, m: number, aux = 0) {
    _c.set(color)
    const n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize()
    const i0 = this.vertex(a, n, _c, m, aux)
    this.vertex(b, n, _c, m, aux)
    this.vertex(c, n, _c, m, aux)
    this.idx.push(i0, i0 + 1, i0 + 2)
  }

  /** 箱（中心・大きさ・Y 軸まわりの回転か、オイラー角） */
  box(center: V3, size: V3, color: THREE.ColorRepresentation, m: number, aux = 0, rot: number | V3 = 0, faces: FaceMask = ALL) {
    _c.set(color)
    // 回転の順は YXZ（向き → 傾き。beam が使う）
    const r = typeof rot === 'number' ? ([0, rot, 0] as const) : rot
    _e.set(r[0], r[1], r[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_v.set(...center), _q, new THREE.Vector3(...size))
    _nm.getNormalMatrix(_m)
    BOX_FACES.forEach((f, fi) => {
      if (!faces[fi]) return
      _n.set(...f.n).applyMatrix3(_nm).normalize()
      const i0 = this.vertexCount
      for (const v of f.v) this.vertex(_v.set(...v).applyMatrix4(_m), _n, _c, m, aux)
      this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
    })
  }

  /** 範囲で決めた箱（回転なし） */
  boxMinMax(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.ColorRepresentation, m: number, aux = 0, faces: FaceMask = ALL) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return
    this.box([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [x1 - x0, y1 - y0, z1 - z0], color, m, aux, 0, faces)
  }

  /** 円柱（縦。中心の下の点・半径・高さ・分割）。cap = 上下のふた */
  cylinder(base: V3, r: number, h: number, seg: number, color: THREE.ColorRepresentation, m: number, aux = 0, cap = true, r1 = r) {
    _c.set(color)
    const [bx, by, bz] = base
    const slope = (r - r1) / h
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2
      const a1 = ((i + 1) / seg) * Math.PI * 2
      const n0 = new THREE.Vector3(Math.sin(a0), slope, Math.cos(a0)).normalize()
      const n1 = new THREE.Vector3(Math.sin(a1), slope, Math.cos(a1)).normalize()
      const i0 = this.vertex([bx + Math.sin(a0) * r, by, bz + Math.cos(a0) * r], n0, _c, m, aux)
      this.vertex([bx + Math.sin(a1) * r, by, bz + Math.cos(a1) * r], n1, _c, m, aux)
      this.vertex([bx + Math.sin(a1) * r1, by + h, bz + Math.cos(a1) * r1], n1, _c, m, aux)
      this.vertex([bx + Math.sin(a0) * r1, by + h, bz + Math.cos(a0) * r1], n0, _c, m, aux)
      this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
      if (cap) {
        const t = this.vertex([bx, by + h, bz], [0, 1, 0], _c, m, aux)
        this.vertex([bx + Math.sin(a0) * r1, by + h, bz + Math.cos(a0) * r1], [0, 1, 0], _c, m, aux)
        this.vertex([bx + Math.sin(a1) * r1, by + h, bz + Math.cos(a1) * r1], [0, 1, 0], _c, m, aux)
        this.idx.push(t, t + 1, t + 2)
      }
    }
  }

  /**
   * 回転体（profile = [半径, 高さ] の列を、局所の y 軸のまわりに seg 分割で回す）を、行列 m で置く。
   * outward = 外向きの面（false なら内向き。皿の表と裏で 2 回呼ぶ）
   */
  lathe(profile: [number, number][], seg: number, matrix: THREE.Matrix4, color: THREE.ColorRepresentation, m: number, aux = 0, outward = true) {
    _c.set(color)
    _nm.getNormalMatrix(matrix)
    const ring = (i: number, j: number) => {
      const a = (j / seg) * Math.PI * 2
      const [r, h] = profile[i]
      return new THREE.Vector3(Math.sin(a) * r, h, Math.cos(a) * r)
    }
    // 頂点ごとの法線（輪郭の傾きから）
    const normalAt = (i: number, j: number) => {
      const a = (j / seg) * Math.PI * 2
      const p0 = profile[Math.max(0, i - 1)]
      const p1 = profile[Math.min(profile.length - 1, i + 1)]
      const dr = p1[0] - p0[0]
      const dh = p1[1] - p0[1]
      // 輪郭の接線 (dr, dh) に垂直で外向き: (dh, -dr)
      const nr = dh
      const ny = -dr
      const v = new THREE.Vector3(Math.sin(a) * nr, ny, Math.cos(a) * nr).normalize()
      return outward ? v : v.negate()
    }
    for (let i = 1; i < profile.length; i++) {
      for (let j = 0; j < seg; j++) {
        const quad = [ring(i - 1, j), ring(i - 1, j + 1), ring(i, j + 1), ring(i, j)]
        const norms = [normalAt(i - 1, j), normalAt(i - 1, j + 1), normalAt(i, j + 1), normalAt(i, j)]
        const order = outward ? [0, 1, 2, 3] : [0, 3, 2, 1]
        const i0 = this.vertexCount
        for (const k of order) this.vertex(quad[k].applyMatrix4(matrix), norms[k].applyMatrix3(_nm).normalize(), _c, m, aux)
        this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
      }
    }
  }

  /** 2 点を結ぶ角柱（手すり・腕・配管）。thick = 断面の幅 */
  beam(a: V3, b: V3, thick: number, color: THREE.ColorRepresentation, m: number, aux = 0, thickY = thick) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = d.length()
    if (len < 1e-4) return
    const yaw = Math.atan2(d.x, d.z)
    const pitch = -Math.asin(THREE.MathUtils.clamp(d.y / len, -1, 1))
    this.box([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [thick, thickY, len], color, m, aux, [pitch, yaw, 0])
  }

  /** 別の形（位置・法線・色・aMat を持つ）を足す */
  merge(o: GeoBuilder) {
    const base = this.vertexCount
    this.pos.push(...o.pos)
    this.nrm.push(...o.nrm)
    this.col.push(...o.col)
    this.mat.push(...o.mat)
    for (const i of o.idx) this.idx.push(i + base)
  }

  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 2))
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    return g
  }
}

/** 色（sRGB の 16 進）をリニアの THREE.Color に */
export const lin = (hex: string) => new THREE.Color(hex)
