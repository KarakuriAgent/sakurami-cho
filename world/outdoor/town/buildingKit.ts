import * as THREE from 'three'
import { SITE } from '../../../core/town'
import type { PolyBuilding, TownTile } from './townData'

/**
 * 建物の組み立て。
 *
 * - 長方形の建物（町の建物のほとんど）は「型」（屋根の形ごとの単位の形）をインスタンスで描く。型の頂点は幅・奥行きに対する割合と、
 *   高さの種類（基礎の下・軒・屋根の途中・陸屋根の屋上）を持ち、建物の大きさ・軒と棟の高さ・向きはインスタンスの値からシェーダーが決める
 *   （townMaterials.ts の BUILDING_VERTEX）。型は屋根の形の数だけ（8 つ）で、町じゅうの建物を 8 回の描画で描く。
 * - 長方形でない建物（駅・天文台・図書館・ドーム・尖塔・煙突など）は、外形を押し出して 1 つの形にまとめる（polyBuildingsGeometry）。
 *
 * 段階 2（質を上げる）で外壁の型を差し込むときは、ここの型（ARCHETYPES）を細かい形（窓の凹み・庇・バルコニー・屋上の物）に替えるか、
 * 外壁の種類（FACADE）ごとの型を足す。インスタンスの値の形（INSTANCE_ATTRIBUTES）はそのまま使える。
 */

/** 屋根の形（tools/town/buildings.mjs の ROOF と同じ番号） */
export const ROOF = { flat: 0, gable: 1, hip: 2, mansard: 3, shed: 4, sawtooth: 5, irimoya: 6, arch: 7 } as const
/** 外壁の種類（tools/town/buildings.mjs の FACADE と同じ番号） */
export const FACADE = { wood: 0, plaster: 1, stone: 2, brick: 3, glass: 4, concrete: 5, metal: 6, archGlass: 7 } as const

/* -------------------------------------------------------------------------- */
/* 型（屋根の形ごとの単位の形）                                                    */
/* -------------------------------------------------------------------------- */

/** 頂点: 割合 px・pz、高さの種類 mode、屋根の高さの割合 t、外への張り出し ox・oz（m）、中への引っ込み kx・kz（短い辺の半分に対する割合） */
interface V {
  px: number
  pz: number
  mode: number
  t?: number
  ox?: number
  oz?: number
  kx?: number
  kz?: number
}

/** 部分: 0 = 壁（窓あり）、1 = 屋根、2 = 妻壁など（壁の色・窓なし）、3 = パラペット */
const PART = { wall: 0, roof: 1, gable: 2, parapet: 3 }
/** 壁の向き: 0 = 局所 +y、1 = 局所 -y、2 = 局所 +x、3 = 局所 -x、-1 = 屋根など */
const SIDE_HINT: Record<number, [number, number, number]> = { 0: [0, 0, 1], 1: [0, 0, -1], 2: [1, 0, 0], 3: [-1, 0, 0] }

const EAVE_OUT = 0.45
const VERGE_OUT = 0.3

class Arch {
  pos: number[] = []
  av: number[] = []
  ak: number[] = []
  idx: number[] = []

  /** 見本の建物（幅 12・奥行き 8・軒 6・棟 9）での頂点の位置（局所の x, 高さ, y）。面の表裏を決めるのに使う */
  private sample(v: V): [number, number, number] {
    const w = 12
    const d = 8
    const m = 4
    const sx = Math.sign(v.px)
    const sz = Math.sign(v.pz)
    const lx = sx * Math.max(Math.abs(v.px) * w + (v.ox ?? 0) - (v.kx ?? 0) * m, 0)
    const ly = sz * Math.max(Math.abs(v.pz) * d + (v.oz ?? 0) - (v.kz ?? 0) * m, 0)
    const h = v.mode === 0 ? -2 : v.mode === 1 ? 6 : v.mode === 2 ? 6 + (v.t ?? 0) * 3 : 5.25
    return [lx, h, ly]
  }

  /**
   * 凸な面（頂点を周りの順に）を足す。hint は外向き（局所の x, 上, y）。表が外を向くように頂点の順を直す
   */
  face(verts: V[], part: number, side: number, hint: [number, number, number]) {
    const p = verts.map((v) => this.sample(v))
    // シーンの座標（x, 上, -y）での法線
    const a = new THREE.Vector3(p[0][0], p[0][1], -p[0][2])
    const b = new THREE.Vector3(p[1][0], p[1][1], -p[1][2])
    const c = new THREE.Vector3(p[2][0], p[2][1], -p[2][2])
    const n = b.clone().sub(a).cross(c.clone().sub(a))
    const hv = new THREE.Vector3(hint[0], hint[1], -hint[2])
    const order = n.dot(hv) < 0 ? [...verts].reverse() : verts
    const base = this.pos.length / 3
    for (const v of order) {
      this.pos.push(v.px, 0, v.pz)
      this.av.push(v.mode, v.t ?? 0, v.ox ?? 0, v.oz ?? 0)
      this.ak.push(v.kx ?? 0, v.kz ?? 0, part, side)
    }
    for (let i = 1; i < order.length - 1; i++) this.idx.push(base, base + i, base + i + 1)
  }

  /** 4 つの壁（基礎の下から top まで。top は面ごとに変えられる） */
  walls(top: (px: number, pz: number) => V = (px, pz) => ({ px, pz, mode: 1 })) {
    const sides: [number, number, number, number, number][] = [
      // 向き, 角 1 の px, pz, 角 2 の px, pz
      [0, -0.5, 0.5, 0.5, 0.5],
      [1, 0.5, -0.5, -0.5, -0.5],
      [2, 0.5, 0.5, 0.5, -0.5],
      [3, -0.5, -0.5, -0.5, 0.5],
    ]
    for (const [side, x1, z1, x2, z2] of sides) {
      this.face([{ px: x1, pz: z1, mode: 0 }, { px: x2, pz: z2, mode: 0 }, top(x2, z2), top(x1, z1)], PART.wall, side, SIDE_HINT[side])
    }
  }

  build(): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('aV', new THREE.Float32BufferAttribute(this.av, 4))
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.ak, 4))
    g.setIndex(this.idx)
    return g
  }
}

const e = (px: number, pz: number, extra: Partial<V> = {}): V => ({ px, pz, mode: 1, ...extra })
const r = (px: number, pz: number, t: number, extra: Partial<V> = {}): V => ({ px, pz, mode: 2, t, ...extra })

/** 陸屋根（パラペットつき） */
function flatArch() {
  const a = new Arch()
  a.walls()
  const IN = -0.3
  const corners: [number, number][] = [
    [-0.5, 0.5],
    [0.5, 0.5],
    [0.5, -0.5],
    [-0.5, -0.5],
  ]
  // パラペットの上（外の縁 → 内の縁）
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = corners[i]
    const [x2, z2] = corners[(i + 1) % 4]
    a.face([e(x1, z1), e(x2, z2), e(x2, z2, { ox: IN, oz: IN }), e(x1, z1, { ox: IN, oz: IN })], PART.parapet, -1, [0, 1, 0])
    // パラペットの内側の壁（屋上の面へ下りる。内向き）
    const inward: [number, number, number] = [-(x1 + x2), 0, -(z1 + z2)]
    a.face(
      [e(x1, z1, { ox: IN, oz: IN }), e(x2, z2, { ox: IN, oz: IN }), { px: x2, pz: z2, mode: 3, ox: IN, oz: IN }, { px: x1, pz: z1, mode: 3, ox: IN, oz: IN }],
      PART.parapet,
      -1,
      inward,
    )
  }
  a.face(
    corners.map(([x, z]) => ({ px: x, pz: z, mode: 3, ox: IN, oz: IN })),
    PART.roof,
    -1,
    [0, 1, 0],
  )
  return a.build()
}

/** 切妻（棟は局所の x） */
function gableArch() {
  const a = new Arch()
  a.walls()
  for (const sx of [0.5, -0.5]) a.face([e(sx, -0.5), e(sx, 0.5), r(sx, 0, 1)], PART.gable, sx > 0 ? 2 : 3, [Math.sign(sx), 0, 0])
  for (const sz of [0.5, -0.5]) {
    const o = { ox: VERGE_OUT, oz: EAVE_OUT }
    a.face([e(-0.5, sz, o), e(0.5, sz, o), r(0.5, 0, 1, { ox: VERGE_OUT }), r(-0.5, 0, 1, { ox: VERGE_OUT })], PART.roof, -1, [0, 1, Math.sign(sz) * 0.5])
  }
  return a.build()
}

/** 寄棟（棟は長い辺の向き。kx = 1 で 45 度の隅棟）。入母屋は隅棟を短くして近い形にする */
function hipArch(kx: number) {
  const a = new Arch()
  a.walls()
  const o = { ox: EAVE_OUT, oz: EAVE_OUT }
  for (const sz of [0.5, -0.5]) a.face([e(-0.5, sz, o), e(0.5, sz, o), r(0.5, 0, 1, { kx }), r(-0.5, 0, 1, { kx })], PART.roof, -1, [0, 1, Math.sign(sz) * 0.5])
  for (const sx of [0.5, -0.5]) a.face([e(sx, -0.5, o), e(sx, 0.5, o), r(sx, 0, 1, { kx })], PART.roof, -1, [Math.sign(sx) * 0.5, 1, 0])
  return a.build()
}

/** マンサード（下は急な勾配、上はゆるい寄棟と平らな頂） */
function mansardArch() {
  const a = new Arch()
  a.walls()
  const corners: [number, number][] = [
    [-0.5, 0.5],
    [0.5, 0.5],
    [0.5, -0.5],
    [-0.5, -0.5],
  ]
  const low = { ox: 0.2, oz: 0.2 }
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = corners[i]
    const [x2, z2] = corners[(i + 1) % 4]
    const out: [number, number, number] = [x1 + x2, 0.45, z1 + z2]
    a.face([e(x1, z1, low), e(x2, z2, low), r(x2, z2, 0.75, { kx: 0.3, kz: 0.3 }), r(x1, z1, 0.75, { kx: 0.3, kz: 0.3 })], PART.roof, -1, out)
    a.face([r(x1, z1, 0.75, { kx: 0.3, kz: 0.3 }), r(x2, z2, 0.75, { kx: 0.3, kz: 0.3 }), r(x2, z2, 1, { kx: 0.62, kz: 0.62 }), r(x1, z1, 1, { kx: 0.62, kz: 0.62 })], PART.roof, -1, [out[0] * 0.3, 1, out[2] * 0.3])
  }
  a.face(
    corners.map(([x, z]) => r(x, z, 1, { kx: 0.62, kz: 0.62 })),
    PART.roof,
    -1,
    [0, 1, 0],
  )
  return a.build()
}

/** 片流れ（正面 = 局所 +y が低く、裏 -y が高い） */
function shedArch() {
  const a = new Arch()
  a.walls((px, pz) => (pz > 0 ? e(px, pz) : r(px, pz, 1)))
  a.face([e(-0.5, 0.5, { ox: VERGE_OUT, oz: EAVE_OUT }), e(0.5, 0.5, { ox: VERGE_OUT, oz: EAVE_OUT }), r(0.5, -0.5, 1, { ox: VERGE_OUT, oz: 0.3 }), r(-0.5, -0.5, 1, { ox: VERGE_OUT, oz: 0.3 })], PART.roof, -1, [0, 1, 0.3])
  return a.build()
}

/** のこぎり屋根（4 つの山。垂直の面は北向きの明かり取り） */
function sawtoothArch() {
  const a = new Arch()
  a.walls()
  const n = 4
  for (let k = 0; k < n; k++) {
    const z0 = -0.5 + k / n
    const z1 = z0 + 1 / n
    a.face([e(-0.5, z0), e(0.5, z0), r(0.5, z0, 1), r(-0.5, z0, 1)], PART.gable, 1, [0, 0, -1])
    a.face([r(-0.5, z0, 1), r(0.5, z0, 1), e(0.5, z1), e(-0.5, z1)], PART.roof, -1, [0, 1, 0.3])
    for (const sx of [0.5, -0.5]) a.face([e(sx, z0), e(sx, z1), r(sx, z0, 1)], PART.gable, sx > 0 ? 2 : 3, [Math.sign(sx), 0, 0])
  }
  return a.build()
}

/** 高架の下のアーチの店（箱。上は高架の中に隠れる） */
function archShopArch() {
  const a = new Arch()
  a.walls()
  a.face([e(-0.5, 0.5), e(0.5, 0.5), e(0.5, -0.5), e(-0.5, -0.5)], PART.roof, -1, [0, 1, 0])
  return a.build()
}

/** 遠くの陸屋根（パラペットを省く。壁と屋上の面だけ） */
function flatFarArch() {
  const a = new Arch()
  a.walls()
  a.face([e(-0.5, 0.5), e(0.5, 0.5), e(0.5, -0.5), e(-0.5, -0.5)], PART.roof, -1, [0, 1, 0])
  return a.build()
}

/** 屋根の形の番号 → 型を作る関数（近くの建物） */
export const ARCHETYPES: Record<number, () => THREE.InstancedBufferGeometry> = {
  [ROOF.flat]: flatArch,
  [ROOF.gable]: gableArch,
  [ROOF.hip]: () => hipArch(1),
  [ROOF.mansard]: mansardArch,
  [ROOF.shed]: shedArch,
  [ROOF.sawtooth]: sawtoothArch,
  [ROOF.irimoya]: () => hipArch(0.6),
  [ROOF.arch]: archShopArch,
}

/** 遠くの建物の型（三角形を減らす。陸屋根はパラペットなし、マンサードは寄棟、のこぎり屋根は片流れ） */
export const ARCHETYPES_FAR: Record<number, () => THREE.InstancedBufferGeometry> = {
  ...ARCHETYPES,
  [ROOF.flat]: flatFarArch,
  [ROOF.mansard]: () => hipArch(1),
  [ROOF.sawtooth]: shedArch,
}

/** これより遠い建物は遠くの型で描く（m。ラボからの距離） */
export const BUILDING_LOD_DISTANCE = 650

/* -------------------------------------------------------------------------- */
/* インスタンスの値                                                               */
/* -------------------------------------------------------------------------- */

/** インスタンスの値（タイルの b_pos・b_dim・b_ext・b_wall・b_roof・b_meta と同じ並び） */
export const INSTANCE_ATTRIBUTES = [
  ['iPos', 'b_pos', 4],
  ['iDim', 'b_dim', 4],
  ['iExt', 'b_ext', 4],
  ['iWall', 'b_wall', 4],
  ['iRoof', 'b_roof', 4],
  ['iMeta', 'b_meta', 4],
] as const

export interface InstanceSet {
  count: number
  attrs: Record<string, THREE.InstancedBufferAttribute>
}

/**
 * タイルの長方形の建物を、屋根の形ごとのインスタンスの値に分ける（と、全部をまとめたもの）。
 * 片流れは低い側（正面）が局所 +y になるよう向きを直す
 */
export function collectInstances(
  tiles: TownTile[],
  center: [number, number] = [0, 0],
  lodDistance = BUILDING_LOD_DISTANCE,
  skip: (namedIndex: number, eave: number) => boolean = () => false,
  /** 全部をまとめたもの（遠くの窓明かりの点が使う）も作るか。細かさの中心を動かすとき（landscape.ts の relod）は要らない */
  withAll = true,
): { byRoof: Map<number, InstanceSet>; all: InstanceSet } {
  // 目印の建物の形に置き換えたインスタンスは描かない（landmarks.ts）
  const skipped = (s: TownTile['sections'], i: number) => (s.b_named.array as Int32Array)[i] >= 0 && skip((s.b_named.array as Int32Array)[i], s.b_dim.array[i * 4 + 2])
  // 型の鍵 = 屋根の形 × 2 + 遠いか（細かさの中心 center から遠い建物は遠くの型）
  const keyOf = (s: TownTile['sections'], i: number) => s.b_roof.array[i * 4 + 3] * 2 + (Math.hypot(s.b_pos.array[i * 4] - center[0], s.b_pos.array[i * 4 + 1] - center[1]) > lodDistance ? 1 : 0)
  const counts = new Map<number, number>()
  let total = 0
  for (const t of tiles) {
    const n = t.sections.b_pos.array.length / 4
    for (let i = 0; i < n; i++) {
      if (skipped(t.sections, i)) continue
      const k = keyOf(t.sections, i)
      counts.set(k, (counts.get(k) ?? 0) + 1)
      total++
    }
  }
  const make = (n: number): InstanceSet => ({
    count: 0,
    attrs: Object.fromEntries(
      INSTANCE_ATTRIBUTES.map(([name, , size]) => {
        const isByte = name === 'iWall' || name === 'iRoof' || name === 'iMeta'
        const array = isByte ? new Uint8Array(Math.max(1, n) * size) : new Float32Array(Math.max(1, n) * size)
        return [name, new THREE.InstancedBufferAttribute(array, size, false)]
      }),
    ),
  })
  const byRoof = new Map<number, InstanceSet>()
  for (const [k, n] of counts) byRoof.set(k, make(n))
  const all = make(withAll ? total : 0)
  // 近い建物から順に並べる（手前の建物を先に描くと、奥の隠れた画素を深度のテストで早く捨てられる）。
  // 2m ごとの距離の箱で数えて並べる（比べて並べ替えるより速い。箱の中の順は問わない）
  const tileOf = new Uint16Array(total)
  const idxOf = new Uint32Array(total)
  const binOf = new Uint32Array(total)
  let k0 = 0
  let maxBin = 0
  tiles.forEach((t, ti) => {
    const s = t.sections
    const n = s.b_pos.array.length / 4
    for (let i = 0; i < n; i++) {
      if (skipped(s, i)) continue
      const b = Math.floor(Math.hypot(s.b_pos.array[i * 4] - center[0], s.b_pos.array[i * 4 + 1] - center[1]) / 2)
      tileOf[k0] = ti
      idxOf[k0] = i
      binOf[k0] = b
      if (b > maxBin) maxBin = b
      k0++
    }
  })
  const start = new Uint32Array(maxBin + 2)
  for (let k = 0; k < total; k++) start[binOf[k] + 1]++
  for (let b = 1; b < start.length; b++) start[b] += start[b - 1]
  const order = new Uint32Array(total)
  for (let k = 0; k < total; k++) order[start[binOf[k]]++] = k
  {
    for (let o = 0; o < total; o++) {
      const s = tiles[tileOf[order[o]]].sections
      const i = idxOf[order[o]]
      const roof = s.b_roof.array[i * 4 + 3]
      for (const set of withAll ? [byRoof.get(keyOf(s, i))!, all] : [byRoof.get(keyOf(s, i))!]) {
        const j = set.count
        for (const [name, key, size] of INSTANCE_ATTRIBUTES) (set.attrs[name].array as Float32Array | Uint8Array).set(s[key].array.subarray(i * size, i * size + size), j * size)
        if (roof === ROOF.shed && s.b_ext.array[i * 4 + 2] === 1) {
          const pos = set.attrs.iPos.array as Float32Array
          pos[j * 4 + 3] += Math.PI
          ;(set.attrs.iExt.array as Float32Array)[j * 4 + 2] = 0
        }
        set.count++
      }
    }
  }
  return { byRoof, all }
}

/**
 * 型のインスタンスの描画（Mesh + InstancedBufferGeometry。InstancedMesh の行列は使わない）。key = 屋根の形 × 2 + 遠いか。
 * インスタンスの値 6 つは 1 本の浮動小数のバッファに交互に並べる（WebGPU の頂点バッファは 8 本まで。型の頂点 3 本 + 6 本では足りない。
 * バイトの値（iWall・iRoof・iMeta）も 0〜255 の浮動小数のまま入れ、シェーダーが 255 で割る）
 */
export function instancedBuildingMesh(key: number, set: InstanceSet, material: THREE.Material, depth?: THREE.Material) {
  const roof = key >> 1
  const g = (key & 1 ? ARCHETYPES_FAR : ARCHETYPES)[roof]()
  const stride = INSTANCE_ATTRIBUTES.length * 4
  const data = new Float32Array(Math.max(1, set.count) * stride)
  INSTANCE_ATTRIBUTES.forEach(([name], f) => {
    const a = set.attrs[name].array
    for (let i = 0; i < set.count; i++) for (let c = 0; c < 4; c++) data[i * stride + f * 4 + c] = a[i * 4 + c]!
  })
  const buf = new THREE.InstancedInterleavedBuffer(data, stride, 1)
  INSTANCE_ATTRIBUTES.forEach(([name], f) => g.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, 4, f * 4)))
  g.instanceCount = set.count
  const mesh = new THREE.Mesh(g, material)
  mesh.frustumCulled = false
  mesh.name = `townBuildings:${roof}${key & 1 ? ':far' : ''}`
  if (depth) mesh.userData.shadowMaterial = depth
  return mesh
}

/* -------------------------------------------------------------------------- */
/* 長方形でない建物（外形を押し出す）                                               */
/* -------------------------------------------------------------------------- */

const LAB = SITE.labFloorElevation

class PolyWriter {
  pos: number[] = []
  fac: number[] = []
  b: number[] = []
  wall: number[] = []
  roof: number[] = []
  meta: number[] = []
  tan: number[] = []
  /** 今の壁の向き（平面の単位ベクトル。壁に沿った位置の増える向き） */
  dir: [number, number] = [1, 0]
  private cur!: PolyBuilding
  private eaveEff = 3
  begin(p: PolyBuilding, eaveEff: number) {
    this.cur = p
    this.eaveEff = eaveEff
  }
  /** 頂点（平面座標 x, y と標高 z）。fac = (壁に沿った位置, 床からの高さ, 壁の長さ, 向き)、part = 部分 */
  vert(x: number, y: number, z: number, fac: [number, number, number, number], part: number) {
    const p = this.cur
    this.pos.push(x, z - LAB, -y)
    this.fac.push(...fac)
    this.b.push(this.eaveEff, p.floors, 0, part)
    this.wall.push(p.wall[0], p.wall[1], p.wall[2], p.facade)
    this.roof.push(p.roofColor[0], p.roofColor[1], p.roofColor[2], p.roof)
    this.meta.push(p.use, p.flags, (p.seed % 65536) / 65536, p.style ?? 0)
    this.tan.push(this.dir[0], this.dir[1], 0, 0)
  }
  /** 三角形（表がシーンの外を向くように、法線の向き hint（シーンの座標）で順を直す） */
  tri(a: number[], b: number[], c: number[], fa: number[], fb: number[], fc: number[], part: number, hint: THREE.Vector3) {
    const sa = new THREE.Vector3(a[0], a[2], -a[1])
    const sb = new THREE.Vector3(b[0], b[2], -b[1])
    const sc = new THREE.Vector3(c[0], c[2], -c[1])
    const n = sb.clone().sub(sa).cross(sc.clone().sub(sa))
    const list = n.dot(hint) < 0 ? [a, c, b] : [a, b, c]
    const facs = n.dot(hint) < 0 ? [fa, fc, fb] : [fa, fb, fc]
    for (let i = 0; i < 3; i++) this.vert(list[i][0], list[i][1], list[i][2], facs[i] as [number, number, number, number], part)
  }
}

/** 長方形でない建物と建物の部分を 1 つの形に（頂点の値は建物のシェーダーの TOWN_INSTANCED でない方） */
export function polyBuildingsGeometry(list: PolyBuilding[]) {
  const w = new PolyWriter()
  const up = new THREE.Vector3(0, 1, 0)
  for (const p of list) {
    const ring = p.ring
    const n = ring.length
    if (n < 3) continue
    const cx = ring.reduce((s, q) => s + q[0], 0) / n
    const cy = ring.reduce((s, q) => s + q[1], 0) / n
    const rad = ring.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cy), 0) / n
    const top = p.floorZ + p.eave
    let wallTop = top
    let z0 = p.floorZ - p.base - 1.5
    if (p.special === 'dome') wallTop = Math.max(p.floorZ + 1, top - rad)
    else if (p.special === 'clocktower') wallTop = top - rad * 1.05
    else if (p.special === 'spire') wallTop = p.floorZ + p.eave * 0.42
    else if (p.special === 'canopy') z0 = top - 0.7
    if (p.roof !== ROOF.flat && !p.special) wallTop = top
    const eaveEff = p.roof === ROOF.flat && !p.special ? Math.max(2.2, wallTop - p.floorZ - 0.9) : wallTop - p.floorZ
    w.begin(p, eaveEff)
    const wallPart = p.special === 'chimney' || p.special === 'spire' || p.special === 'canopy' ? PART.gable : PART.wall
    // 壁
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 0.05) continue
      const out = new THREE.Vector3(b[1] - a[1], 0, b[0] - a[0]).normalize()
      const va = z0 - p.floorZ
      const vb = wallTop - p.floorZ
      const A0 = [a[0], a[1], z0]
      const B0 = [b[0], b[1], z0]
      const A1 = [a[0], a[1], wallTop]
      const B1 = [b[0], b[1], wallTop]
      const fA0 = [-len / 2, va, len, 4]
      const fB0 = [len / 2, va, len, 4]
      const fA1 = [-len / 2, vb, len, 4]
      const fB1 = [len / 2, vb, len, 4]
      w.dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
      w.tri(A0, B0, B1, fA0, fB0, fB1, wallPart, out)
      w.tri(A0, B1, A1, fA0, fB1, fA1, wallPart, out)
    }
    const f0 = [0, 0, 1, -1]
    w.dir = [1, 0]
    if (p.special === 'dome' || p.special === 'clocktower') {
      // ドーム（外形に内接する半球。高さが半径より低ければ平たい球の帽子）
      const dr = p.special === 'clocktower' ? rad * 1.05 : rad
      const h = Math.max(0.5, top - wallTop)
      const seg = 24
      const rings = 7
      for (let j = 0; j < rings; j++) {
        const t0 = (j / rings) * (Math.PI / 2)
        const t1 = ((j + 1) / rings) * (Math.PI / 2)
        for (let k = 0; k < seg; k++) {
          const a0 = (k / seg) * Math.PI * 2
          const a1 = ((k + 1) / seg) * Math.PI * 2
          const pt = (t: number, a: number) => [cx + Math.cos(a) * Math.cos(t) * dr, cy + Math.sin(a) * Math.cos(t) * dr, wallTop + Math.sin(t) * h]
          const q00 = pt(t0, a0)
          const q01 = pt(t0, a1)
          const q10 = pt(t1, a0)
          const q11 = pt(t1, a1)
          const mid = new THREE.Vector3(Math.cos((a0 + a1) / 2) * Math.cos(t0), Math.sin(t0) + 0.2, -Math.sin((a0 + a1) / 2) * Math.cos(t0))
          w.tri(q00, q01, q11, f0, f0, f0, PART.roof, mid)
          if (j < rings - 1) w.tri(q00, q11, q10, f0, f0, f0, PART.roof, mid)
        }
      }
      continue
    }
    if (p.special === 'spire') {
      // 尖塔: 外形から頂点へ
      for (let i = 0; i < n; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % n]
        const out = new THREE.Vector3(b[1] - a[1], 0.4, b[0] - a[0]).normalize()
        w.tri([a[0], a[1], wallTop], [b[0], b[1], wallTop], [cx, cy, top], f0, f0, f0, PART.roof, out)
      }
      continue
    }
    // 屋根: 陸屋根は外形を三角形に。勾配のある屋根は重心へ寄せた寄棟（段階 4 で名前のある建物の形を作り直す）
    const contour = ring.map((q) => new THREE.Vector2(q[0], q[1]))
    const tris = THREE.ShapeUtils.triangulateShape(contour, [])
    if (p.roof === ROOF.flat || p.special === 'chimney' || p.special === 'canopy') {
      for (const t of tris) w.tri([...ring[t[0]], wallTop], [...ring[t[1]], wallTop], [...ring[t[2]], wallTop], f0, f0, f0, PART.roof, up)
      if (p.special === 'canopy') for (const t of tris) w.tri([...ring[t[0]], z0], [...ring[t[1]], z0], [...ring[t[2]], z0], f0, f0, f0, PART.roof, up.clone().negate())
    } else {
      // 棟の高さ（データの roof_height_m は塔を含む全体の高さのことがあるので、外形の大きさに見合う勾配までにする）
      const ridge = wallTop + Math.min(Math.max(p.ridge - p.eave, 0.5), rad * 0.6, 8)
      const k = 0.28
      const inner = ring.map((q) => [cx + (q[0] - cx) * k, cy + (q[1] - cy) * k])
      for (let i = 0; i < n; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % n]
        const ia = inner[i]
        const ib = inner[(i + 1) % n]
        const out = new THREE.Vector3(b[1] - a[1], 0.8, b[0] - a[0]).normalize()
        w.tri([a[0], a[1], wallTop], [b[0], b[1], wallTop], [ib[0], ib[1], ridge], f0, f0, f0, PART.roof, out)
        w.tri([a[0], a[1], wallTop], [ib[0], ib[1], ridge], [ia[0], ia[1], ridge], f0, f0, f0, PART.roof, out)
      }
      for (const t of tris) w.tri([...inner[t[0]], ridge], [...inner[t[1]], ridge], [...inner[t[2]], ridge], f0, f0, f0, PART.roof, up)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3))
  g.setAttribute('aFac', new THREE.Float32BufferAttribute(w.fac, 4))
  g.setAttribute('aB', new THREE.Float32BufferAttribute(w.b, 4))
  g.setAttribute('aWall', new THREE.Float32BufferAttribute(w.wall, 4))
  g.setAttribute('aRoof', new THREE.Float32BufferAttribute(w.roof, 4))
  g.setAttribute('aMeta', new THREE.Float32BufferAttribute(w.meta, 4))
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(w.tan, 4))
  g.computeBoundingSphere()
  return g
}
