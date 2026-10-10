import * as THREE from 'three'
import { sceneOf } from '../../../core/interiors'
import { KitBuilder, type Faces, ALL_FACES } from '../named/kitBuilder'
import type { InteriorModel } from './model'
import { PictureAtlas, type PictureKey } from './pictures'
import type { L2 } from './types'

/**
 * 中の形を作る道具（建物の局所の座標 s, t, h で書く）。
 *
 * - solid: 中の面と家具（interiorMaterial の質感。頂点の aExt = (環境光の遮り, 灯りの組の番号, 種, 0)）
 * - glow: 光る物（電球・傘・画面の光。aMat = (灯りの番号, 強さ)。灯りが消えているときは昼の色）
 * - pictures: 絵の板（ポスター・星図・写真・ホワイトボード・画面。pictures.ts のアトラス。アトラスは建物ごとに 1 枚で、作る側（interiors.ts）が渡す）
 * - clear: 透けるガラス（窓・扉・棚のガラス）
 * アトラスを渡さない（null）ときは dry: 形を作らずに、家具の障害物（通り道・カメラが避ける）だけを model に記録する
 */

export type V3 = [number, number, number]

const _c = new THREE.Color()

/** 絵の板（位置・法線・色・アトラスの uv・光り方） */
export class PictureBuilder {
  pos: number[] = []
  nrm: number[] = []
  uv: number[] = []
  /** x = 光り方（0 光らない・1 画面（灯りに関係なく光る）・2 灯りと一緒に光る）、y = 灯りの組、z = 環境光の遮り */
  info: number[] = []
  idx: number[] = []
  get count() {
    return this.pos.length / 3
  }
  quad(p: V3[], n: V3, uv: [number, number, number, number], mode: number, group: number, ao = 1) {
    const i0 = this.count
    const us = [uv[0], uv[2], uv[2], uv[0]]
    const vs = [uv[1], uv[1], uv[3], uv[3]]
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2])
      this.nrm.push(n[0], n[1], n[2])
      this.uv.push(us[i], vs[i])
      this.info.push(mode, group, ao)
    }
    this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3))
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('aPic', new THREE.Float32BufferAttribute(this.info, 3))
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    return g
  }
}

/** 形の書き先の組（面・光る物・透けるガラス・絵）。大きな建物（ドーム）は所ごとの組に分け、見えない組を描かない */
export interface ChunkSet {
  solid: KitBuilder
  glow: KitBuilder
  clear: KitBuilder
  pictures: PictureBuilder
}

function newChunkSet(): ChunkSet {
  const set = { solid: new KitBuilder(), glow: new KitBuilder(), clear: new KitBuilder(), pictures: new PictureBuilder() }
  set.solid.dirt = 0
  set.glow.dirt = 0
  return set
}

export class InteriorBuilder {
  readonly m: InteriorModel
  /** 形を作らない（障害物だけを記録する）。アトラスが無いとき */
  readonly dry: boolean
  /** この建物の絵のアトラス（dry のときは null） */
  readonly atlas: PictureAtlas | null
  solid: KitBuilder
  glow: KitBuilder
  clear: KitBuilder
  pictures: PictureBuilder
  /** 今の書き先の組の名前（null = ふだんの組） */
  chunkKey: string | null = null
  private readonly baseSet: ChunkSet
  /** 所ごとの組（名前 → 組）。ふだんの組は入れない */
  readonly chunks = new Map<string, ChunkSet>()
  /** 今の部屋（灯りの組・障害物の階） */
  group = 0
  level = 0
  /** 今の部屋の床（局所の h） */
  floorH = 0
  private seed = 1

  constructor(m: InteriorModel, atlas: PictureAtlas | null) {
    this.m = m
    this.atlas = atlas
    this.dry = atlas === null
    this.baseSet = newChunkSet()
    this.solid = this.baseSet.solid
    this.glow = this.baseSet.glow
    this.clear = this.baseSet.clear
    this.pictures = this.baseSet.pictures
  }

  /** 書き先の組を変える（null = ふだんの組）。所ごとの組は別の形になり、カメラの視野の外なら描かない */
  chunk(key: string | null) {
    let set = this.baseSet
    if (key !== null) {
      let c = this.chunks.get(key)
      if (!c) this.chunks.set(key, (c = newChunkSet()))
      set = c
    }
    this.chunkKey = key
    const g = this.solid.groundY
    this.solid = set.solid
    this.glow = set.glow
    this.clear = set.clear
    this.pictures = set.pictures
    this.solid.groundY = g
    return this
  }

  /** 部屋を選ぶ（灯りの組・階・床の高さ）。以後の家具はこの部屋に置く */
  room(id: string) {
    const r = this.m.rooms.find((q) => q.id === id)
    if (!r) throw new Error(`部屋「${id}」がありません`)
    this.group = r.group
    this.level = r.level
    this.floorH = r.def.floor ?? this.m.zone.levels[r.level].floor
    this.solid.groundY = r.group
    return this
  }

  /** 乱数（建物ごとに決まる） */
  rnd() {
    this.seed = (this.seed * 16807) % 2147483647
    return (this.seed - 1) / 2147483646
  }

  /** 局所 → シーン（h は部屋の床から。abs = true なら建物の床から） */
  p(s: number, t: number, h: number, abs = false): V3 {
    return sceneOf(this.m.frame, s, t, abs ? h : h + this.floorH)
  }

  /** 局所の向きの角度（yaw = 0 なら s の向き）→ KitBuilder.box の Y 軸の回転 */
  yaw(local = 0) {
    const f = this.m.frame
    return Math.atan2(f.ay, f.ax) + local
  }

  /** 局所の向き（s, t, h）→ シーンの向き */
  dir(ds: number, dt: number, dh: number): V3 {
    const f = this.m.frame
    return [f.ax * ds + f.bx * dt, dh, -(f.ay * ds + f.by * dt)]
  }

  private ext(ao: number) {
    this.solid.ao = ao
    this.solid.groundY = this.group
  }

  /**
   * 箱: c = 底の中心（局所の s, t）、h0 = 底の高さ（床から）、size = [幅（yaw の向き）, 奥行き, 高さ]、yaw = 局所の向きの回転（反時計回り）
   */
  box(c: L2, h0: number, size: V3, color: string, mat: number, aux = 0, yaw = 0, ao = 1, faces: Faces = ALL_FACES) {
    if (this.dry) return
    this.ext(ao)
    const p = this.p(c[0], c[1], h0 + size[2] / 2)
    this.solid.box(p, [size[0], size[2], size[1]], color, mat, aux, this.yaw(yaw), faces)
  }

  /** 縦の円柱（底の中心・半径・高さ。r1 = 上の半径） */
  cyl(c: L2, h0: number, r: number, ht: number, color: string, mat: number, aux = 0, seg = 16, r1 = r, cap = true, ao = 1) {
    if (this.dry) return
    this.ext(ao)
    this.solid.cylinder(this.p(c[0], c[1], h0), r, ht, seg, color, mat, aux, cap, r1, false)
  }

  /** 2 点を結ぶ角柱（局所の s, t, h（床から）） */
  beam(a: V3, b: V3, thick: number, color: string, mat: number, aux = 0, thickY = thick, ao = 1) {
    if (this.dry) return
    this.ext(ao)
    this.solid.beam(this.p(a[0], a[1], a[2]), this.p(b[0], b[1], b[2]), thick, color, mat, aux, thickY)
  }

  /** 2 点を結ぶ管 */
  tube(a: V3, b: V3, r: number, color: string, mat: number, aux = 0, seg = 10, ao = 1) {
    if (this.dry) return
    this.ext(ao)
    this.solid.tube(this.p(a[0], a[1], a[2]), this.p(b[0], b[1], b[2]), r, seg, color, mat, aux)
  }

  /** 4 点の面（局所の点。表から見て反時計回り） */
  quad(a: V3, b: V3, c: V3, d: V3, color: string, mat: number, aux = 0, ao = 1) {
    if (this.dry) return
    this.ext(ao)
    this.solid.quad(this.p(...a), this.p(...b), this.p(...c), this.p(...d), color, mat, aux)
  }

  /** シーンの点のまま 4 点の面 */
  quadScene(a: V3, b: V3, c: V3, d: V3, color: string, mat: number, aux = 0, ao = 1) {
    if (this.dry) return
    this.ext(ao)
    this.solid.quad(a, b, c, d, color, mat, aux)
  }

  /** 回転体（局所の位置 c・底の高さ h0 に、profile = [半径, 高さ] を回す） */
  lathe(c: L2, h0: number, profile: [number, number][], seg: number, color: string, mat: number, aux = 0, ao = 1) {
    if (this.dry) return
    this.ext(ao)
    const p = this.p(c[0], c[1], h0)
    this.solid.lathe(profile, seg, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]), color, mat, aux)
  }

  /** 光る箱（灯りの番号 lamp・強さ power。灯りが消えているときは昼の色） */
  glowBox(c: L2, h0: number, size: V3, color: string, lamp: number, power: number, yaw = 0) {
    if (this.dry) return
    this.glow.groundY = this.group
    const p = this.p(c[0], c[1], h0 + size[2] / 2)
    this.glow.box(p, [size[0], size[2], size[1]], color, lamp, power, this.yaw(yaw))
  }

  /** 光る円柱・電球（cap あり） */
  glowCyl(c: L2, h0: number, r: number, ht: number, color: string, lamp: number, power: number, r1 = r, seg = 14) {
    if (this.dry) return
    this.glow.groundY = this.group
    this.glow.cylinder(this.p(c[0], c[1], h0), r, ht, seg, color, lamp, power, true, r1, true)
  }

  /** 光る球（電球） */
  glowBulb(c: L2, h: number, r: number, color: string, lamp: number, power: number) {
    if (this.dry) return
    this.glow.groundY = this.group
    const p = this.p(c[0], c[1], h)
    const prof: [number, number][] = []
    for (let i = 0; i <= 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * Math.PI
      prof.push([Math.cos(a) * r, Math.sin(a) * r * 1.25])
    }
    this.glow.lathe(prof, 10, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]), color, lamp, power)
  }

  /**
   * 絵の板: 中心 c（局所の s, t）・中心の高さ h（床から）・幅 w・高さ ht。facing = 板の表の向き（局所の角度。0 = +s を向く、π/2 = +t を向く）。
   * mode: 0 光らない・1 画面（いつも光る）・2 灯りと一緒に光る。out = 壁から前へ浮かせる距離
   */
  picture(key: PictureKey, c: L2, h: number, w: number, ht: number, facing: number, mode = 0, out = 0.004, tilt = 0) {
    if (!this.atlas) return
    const r = this.atlas.region(key)
    // 表の向き（局所）と、表の前に立って見たときの右の向き（表の向きを反時計回りに 90°）
    const nx = Math.cos(facing)
    const ny = Math.sin(facing)
    const rx = -ny
    const ry = nx
    const cs = c[0] + nx * out
    const ct = c[1] + ny * out
    const up = Math.cos(tilt)
    const fwd = Math.sin(tilt)
    const P = (u: number, v: number): V3 => {
      const hh = v * ht * up
      const back = v * ht * fwd
      return this.p(cs + rx * u * w - nx * back, ct + ry * u * w - ny * back, h + hh)
    }
    const pts = [P(-0.5, -0.5), P(0.5, -0.5), P(0.5, 0.5), P(-0.5, 0.5)]
    const n = this.dir(nx * up, ny * up, fwd)
    this.pictures.quad(pts, n, r, mode, this.group)
  }

  /** 透けるガラスの板（局所の 4 点） */
  glass(a: V3, b: V3, c: V3, d: V3) {
    if (this.dry) return
    this.clear.quad(this.p(...a), this.p(...b), this.p(...c), this.p(...d), '#ffffff', 0, 0)
  }

  /* ---- 障害物 ---- */

  /** 長方形の障害物（底の中心 c・幅 w（yaw の向き）・奥行き d・高さの範囲 h0〜h1（床から）） */
  block(name: string, c: L2, w: number, d: number, h0: number, h1: number, yaw = 0, nav = true, cam = true) {
    const a = Math.cos(yaw)
    const b = Math.sin(yaw)
    const corners: L2[] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([x, y]) => [c[0] + a * x - b * y, c[1] + b * x + a * y])
    this.m.addObstacle({
      level: this.level,
      poly: corners.map((p) => this.m.xz(p[0], p[1])),
      center: null,
      radius: 0,
      y0: this.m.y(this.floorH + h0),
      y1: this.m.y(this.floorH + h1),
      name,
      nav,
      cam,
    })
  }

  /** 円の障害物 */
  disc(name: string, c: L2, r: number, h0: number, h1: number, nav = true, cam = true) {
    this.m.addObstacle({ level: this.level, poly: null, center: this.m.xz(c[0], c[1]), radius: r, y0: this.m.y(this.floorH + h0), y1: this.m.y(this.floorH + h1), name, nav, cam })
  }

  /** 箱を置いて、障害物も記録する */
  solidBox(name: string, c: L2, h0: number, size: V3, color: string, mat: number, aux = 0, yaw = 0, nav = true) {
    this.box(c, h0, size, color, mat, aux, yaw)
    this.block(name, c, size[0], size[1], h0, h0 + size[2], yaw, nav)
  }

  /** 色を明るさで変える（家具の色のばらつき） */
  tint(color: string, k: number) {
    _c.set(color).multiplyScalar(k)
    return `#${_c.getHexString()}`
  }
}
