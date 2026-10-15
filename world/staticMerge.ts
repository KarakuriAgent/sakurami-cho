import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * 動かない物を合わせて描く回数を減らす（WebGPU への移行の第 3 段。kanon-claire-thompson/kanon-stream-video#25）。
 *
 * WebGPURenderer は描く物 1 つごとに CPU の仕事（描く物の控えの引き当て・ノードと uniform の更新・バインドグループ・描く命令）が要り、
 * ラボ（什器と殻で 1 コマ 700 余り。床の映り込みでもう 1 回）では WebGL より重かった。そこで、作り終えたあとに一度だけ、
 * 動かない mesh を「同じ素材・同じ影の設定・同じレイヤー・同じ頂点の並び」ごとに 1 つの形へ合わせる（形の頂点を、合わせ先の群から見た位置へ写す）。
 * 見た目は同じ（同じ素材・同じ三角形。写すのは CPU で 1 回だけ）。
 *
 * - 動く物（位置・回転・大きさ・見え隠れを毎コマ変える物）は markDynamic で印を付ける。印の付いた物と合わせ先の群（bodies）・根は「体」で、
 *   その下の動かない mesh は、いちばん近い体の子として合わせる（体ごと動くので、合わせた形も一緒に動く）
 * - 合わせない物: 透明・加算などの混ぜ方・深さを書かない素材（描く順が要る）、複数の素材、描く順（renderOrder）、骨・モーフのある物、
 *   見えない物、カリングを切った物、毎コマの onBeforeRender を持つ物、深さだけの素材を自前で持つ物、名前のある物（名前で引かれる）、
 *   色をインスタンスごとに持つ InstancedMesh・動く InstancedMesh、裏返しの行列（鏡写し）、drawRange を使う形。skip が真の物とその下
 *   （差し込み口など、外から中身が入る物）も触らない
 * - 1 つにしかならない物は合わせない（描く回数は減らないので、元のまま）
 * - freeze: 合わせたあと、体でない物（動かない群・残った mesh）の行列を固める（matrixAutoUpdate = false）。毎コマ・描くたびの
 *   updateMatrixWorld の行列の組み立てと掛け算を省く（使う側は、場面の根も固めると、動く物の下だけを計算する）
 * - dispose(): 合わせた形を捨てる（元の形・素材は元の持ち主が捨てる）
 */

const DYNAMIC = 'staticMerge:dynamic'

/** 動く物の印を付ける（位置・回転・大きさ・見え隠れを作ったあとで変える物。合わせる・固める対象から外れ、体になる） */
export function markDynamic<T extends THREE.Object3D>(...objects: T[]): T | undefined {
  for (const o of objects) o.userData[DYNAMIC] = true
  return objects[0]
}

export function isDynamic(o: THREE.Object3D): boolean {
  return o.userData[DYNAMIC] === true
}

export interface StaticMergeOptions {
  /** 合わせた mesh を付ける群（動く物と根のほか。太陽の影の印を付けた群など、群の下にあることに意味がある物） */
  bodies?: Iterable<THREE.Object3D>
  /** 真なら、その物とその下は触らない（合わせない・固めない） */
  skip?: (o: THREE.Object3D) => boolean
  /** 合わせたあと、体でない物と根の行列を固める（既定 true） */
  freeze?: boolean
}

export interface StaticMerge {
  /** 合わせた元の mesh（InstancedMesh は 1 つで数える）の数 */
  readonly sources: number
  /** 合わせてできた mesh の数 */
  readonly merged: number
  /** 合わせた形を捨てる */
  dispose(): void
}

const _rel = new THREE.Matrix4()
const _inv = new THREE.Matrix4()
const _inst = new THREE.Matrix4()
const _m = new THREE.Matrix4()

/** mesh を合わせてよいか（体かどうか・祖先の見え隠れは呼ぶ側が見る） */
function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh
  if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false
  if (m.name !== '' || !m.visible || !m.frustumCulled || m.renderOrder !== 0) return false
  if (m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || m.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return false
  if (m.customDepthMaterial || m.customDistanceMaterial || m.userData.shadowMaterial) return false
  if (Array.isArray(m.material)) return false
  const mat = m.material
  if (mat.transparent || mat.blending !== THREE.NormalBlending || !mat.depthWrite || !mat.depthTest || !mat.visible) return false
  if ((mat as THREE.MeshPhysicalMaterial).transmission > 0) return false
  const g = m.geometry
  if (!g.attributes.position || Object.keys(g.morphAttributes).length > 0) return false
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false
  const im = m as unknown as THREE.InstancedMesh
  if (im.isInstancedMesh) {
    if (im.instanceColor || im.morphTexture || im.instanceMatrix.usage !== THREE.StaticDrawUsage || im.count === 0) return false
  }
  return true
}

const isInterleaved = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): a is THREE.InterleavedBufferAttribute =>
  (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true

/** 頂点の並びの印（同じ印の形どうしだけを合わせる） */
function attributeKey(g: THREE.BufferGeometry): string {
  return Object.keys(g.attributes)
    .sort()
    .map((name) => {
      const a = g.attributes[name]!
      const arr = isInterleaved(a) ? a.data.array : a.array
      return `${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${arr.constructor.name}`
    })
    .join(',')
}

/** 形を写して新しい形にする（頂点の値は写した物。交互に詰めた属性はほどく。index は無ければ順に振る） */
function bakedGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  for (const name of Object.keys(src.attributes)) {
    const a = src.attributes[name]!
    const count = a.count
    const size = a.itemSize
    // 格納したままの値を写す（normalized の整数の属性を 0〜1 に戻さない）
    const il = isInterleaved(a) ? a : null
    const arr = il ? il.data.array : (a as THREE.BufferAttribute).array
    const stride = il ? il.data.stride : size
    const offset = il ? il.offset : 0
    const out = new (arr.constructor as new (n: number) => THREE.TypedArray)(count * size)
    for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) out[i * size + k] = arr[i * stride + offset + k]!
    g.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized))
  }
  const n = src.attributes.position!.count
  if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1))
  else {
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n)
    for (let i = 0; i < n; i++) idx[i] = i
    g.setIndex(new THREE.BufferAttribute(idx, 1))
  }
  g.applyMatrix4(matrix)
  return g
}

interface Bucket {
  body: THREE.Object3D
  material: THREE.Material
  castShadow: boolean
  receiveShadow: boolean
  layers: number
  sources: THREE.Mesh[]
  /** 写す形と行列（InstancedMesh はインスタンスの数だけ） */
  parts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]
}

/**
 * root の下の動かない mesh を合わせる（作り終えたあと、最初に描く前に 1 回。動く物には先に markDynamic で印を付けておく）
 */
export function mergeStatic(root: THREE.Object3D, o: StaticMergeOptions = {}): StaticMerge {
  const bodies = new Set<THREE.Object3D>(o.bodies ?? [])
  const skip = o.skip ?? (() => false)
  root.updateMatrixWorld(true)
  const buckets = new Map<string, Bucket>()
  const inverses = new Map<THREE.Object3D, THREE.Matrix4>()
  const inverseOf = (body: THREE.Object3D) => {
    let m = inverses.get(body)
    if (!m) inverses.set(body, (m = _inv.copy(body.matrixWorld).invert().clone()))
    return m
  }

  const visit = (obj: THREE.Object3D, body: THREE.Object3D) => {
    if (skip(obj)) return
    const isBody = obj === root || isDynamic(obj) || bodies.has(obj)
    // 動かない見えない物の下は合わせない（見え隠れを変えないので描かれない。元のまま置く）
    if (!isBody && !obj.visible) return
    if (!isBody && mergeable(obj)) {
      const mesh = obj as THREE.Mesh<THREE.BufferGeometry, THREE.Material>
      _rel.multiplyMatrices(inverseOf(body), mesh.matrixWorld)
      if (_rel.determinant() > 0) {
        const g = mesh.geometry
        const key = `${body.id}|${mesh.material.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${mesh.layers.mask}|${attributeKey(g)}`
        let b = buckets.get(key)
        if (!b) {
          b = { body, material: mesh.material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, layers: mesh.layers.mask, sources: [], parts: [] }
          buckets.set(key, b)
        }
        b.sources.push(mesh)
        const im = mesh as unknown as THREE.InstancedMesh
        if (im.isInstancedMesh) {
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, _inst)
            b.parts.push({ geometry: g, matrix: _m.multiplyMatrices(_rel, _inst).clone() })
          }
        } else b.parts.push({ geometry: g, matrix: _rel.clone() })
      }
    }
    const next = isBody ? obj : body
    // 子を写してから回る（合わせた物を外すので）
    for (const child of [...obj.children]) visit(child, next)
  }
  visit(root, root)

  const made: THREE.Mesh[] = []
  let sources = 0
  for (const b of buckets.values()) {
    if (b.parts.length < 2 || b.sources.length < 2) continue
    const geometries = b.parts.map((p) => bakedGeometry(p.geometry, p.matrix))
    const geometry = mergeGeometries(geometries, false)
    for (const g of geometries) g.dispose()
    if (!geometry) continue
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
    const mesh = new THREE.Mesh(geometry, b.material)
    mesh.name = `static:${b.material.name || b.material.type}`
    mesh.castShadow = b.castShadow
    mesh.receiveShadow = b.receiveShadow
    mesh.layers.mask = b.layers
    mesh.matrixAutoUpdate = false
    mesh.userData.staticMerged = b.sources.length
    for (const s of b.sources) s.removeFromParent()
    b.body.add(mesh)
    mesh.updateMatrixWorld(true)
    made.push(mesh)
    sources += b.sources.length
  }

  if (o.freeze ?? true) {
    const freeze = (obj: THREE.Object3D) => {
      if (skip(obj)) return
      if (!isDynamic(obj)) {
        obj.updateMatrix()
        obj.matrixAutoUpdate = false
      }
      for (const child of obj.children) freeze(child)
    }
    freeze(root)
    root.updateMatrixWorld(true)
  }

  return {
    sources,
    merged: made.length,
    dispose() {
      for (const m of made) m.geometry.dispose()
    },
  }
}
