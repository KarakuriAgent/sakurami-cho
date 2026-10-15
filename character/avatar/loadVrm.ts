import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MToonMaterialLoaderPlugin, VRMExpressionTextureTransformBind, VRMLoaderPlugin, VRMUtils, type MToonMaterial, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm'
import type { MToonNodeMaterial } from '@pixiv/three-vrm/nodes'
import { VrmMToonNodeMaterial } from './vrmMToonNode'
import { SUN_SHADOW_LAYER } from '../../world/environment/sunShadow'
import type { VrmMtoonConfig } from './visualConfig'

/**
 * VRM の読み込みと、暗いラボになじませる下ごしらえ。
 * 調整の値（MToon・影・目の高さの割合）は引数で受ける（既定値は character/avatar/visualConfig.ts。モデル固有の値（メッシュ名・身長など）はここには書かない）。
 */

export type VrmLoadResult = { status: 'ready'; vrm: VRM } | { status: 'missing' } | { status: 'error'; error: unknown }

/** public/ にファイルがあるか確かめる（無いと開発サーバーは index.html を返すので、種類も見る） */
async function exists(url: string): Promise<boolean> {
  // 落としたファイル（blob:）と中身を書いた URL（data:）は HEAD で取れない（fetch が失敗する）ので、確かめずに読む（読めなければ error）
  if (/^(?:blob|data):/i.test(url)) return true
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const type = res.headers.get('content-type') ?? ''
    return res.ok && !type.includes('text/html')
  } catch {
    return false
  }
}

/** 読み込むときの調整（character/avatar/visualConfig.ts の mtoon・castShadow） */
export interface VrmLoadOptions {
  /** MToon の調整（リムの色と混ぜ方は rim の物を使う） */
  mtoon: VrmMtoonConfig
  /** 影を落とす */
  castShadow: boolean
}

/**
 * 表情の UV のずらし（texture transform bind）を MToonNodeMaterial でも効かせる（WebGPU への移行の第 2 段）。
 *
 * three-vrm（3.5.5）の VRMExpressionTextureTransformBind は、材質の isMeshStandardMaterial・isMeshBasicMaterial・isMToonMaterial を見て、
 * ずらすテクスチャ（map など）を複製し、表情の重みで offset・repeat を動かす。MToonNodeMaterial は isMToonNodeMaterial なので当たらず、
 * 「Tried to add a texture transform bind … not supported」と警告して何もしない（lookAt が expression の方式の kanon.vrm は視線・驚いた顔の瞳が止まる）。
 * MToonNodeMaterial のテクスチャは material の欄を読むノード（materialReference）で、three の TextureNode がテクスチャの offset・repeat
 * （texture.matrix）を UV に掛けるので、ずらす欄の表に isMToonNodeMaterial を足せば WebGL の MToonMaterial と同じに動く（欄は WebGL の MToon と同じ物）。
 * 表は three-vrm の private な static（_propertyNamesMap）なので、無ければ何もしない（three-vrm を上げたら確かめる）
 */
export function enableNodeTextureTransformBind() {
  const map = (VRMExpressionTextureTransformBind as unknown as { _propertyNamesMap?: Record<string, string[]> })._propertyNamesMap
  if (!map || map.isMToonNodeMaterial || !map.isMToonMaterial) return
  map.isMToonNodeMaterial = [...map.isMToonMaterial]
}

/** VRM を読み込む。MToon は rim（読み込む Character の縁の光）に入れ、今の外にいる度合いの色で始める */
export async function loadVrm(url: string, rim: VrmRim, opts: VrmLoadOptions, onProgress?: (ratio: number) => void): Promise<VrmLoadResult> {
  if (!(await exists(url))) return { status: 'missing' }
  try {
    const loader = new GLTFLoader()
    // MToon は WebGPU（TSL）の版 MToonNodeMaterial で作る（WebGPURenderer は ShaderMaterial の MToonMaterial を描けない）。
    // 渡し方は mtoonMaterialPlugin（mtoonMaterialPluginOptions では効かず ShaderMaterial のまま。sakurami-cho#31・kanon-stream-video#25 の試作）。
    // 材質の型は、WebGL の MToon と同じ見た目にした VrmMToonNodeMaterial（vrmMToonNode.ts。影の当たり方・リムの光・複製の alphaTest）。表情の UV のずらし（texture transform bind。lookAt が expression の
    // 方式の VRM の虹彩・ハイライト）は、three-vrm が MToonNodeMaterial を知らないので、読む前に enableNodeTextureTransformBind で足す（下）
    enableNodeTextureTransformBind()
    loader.register((parser) => new VRMLoaderPlugin(parser, { mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, { materialType: VrmMToonNodeMaterial }) }))
    const gltf = await loader.loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total)
    })
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) return { status: 'error', error: new Error('VRM の拡張が見つかりません') }

    // 軽量化（使っていない頂点・スケルトンの統合）と、VRM 0.x の向きをそろえる（1.0 では何もしない）
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm)

    shareSkinnedBounds(vrm.scene)
    vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      // 視錐台カリングは有効のまま（境界は shareSkinnedBounds で全身を囲む球にそろえる）。
      // 切ると、画面外でも影・床の反射のパスで毎回描かれて重くなる
      mesh.castShadow = opts.castShadow
      // 窓から差し込む太陽の光の影にも入る（world/environment/sunShadow.ts）
      if (opts.castShadow) mesh.layers.enable(SUN_SHADOW_LAYER)
      mesh.receiveShadow = true
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) tuneMaterial(m, rim, opts.mtoon)
    })
    return { status: 'ready', vrm }
  } catch (error) {
    return { status: 'error', error }
  }
}

/**
 * 見える三角形に使われている頂点（1 = 使われている）。面積の無い三角形（3 点が一直線・同じ点）だけに使われている頂点は 0。
 * VRM には、視錐台カリングの境界を広げるための見えない三角形（腰の骨に付いた、±2.5m の角の 3 点ずつ）を入れたものがある（§7 の 208）
 */
function visibleVertices(g: THREE.BufferGeometry): Uint8Array {
  const pos = g.attributes.position
  const idx = g.index
  const used = new Uint8Array(pos.count)
  const nTri = idx ? idx.count / 3 : pos.count / 3
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < nTri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1).sub(a)
    c.fromBufferAttribute(pos, i2).sub(a)
    if (b.cross(c).lengthSq() < 1e-14) continue
    used[i0] = used[i1] = used[i2] = 1
  }
  return used
}

/** 全身を囲む球の余白（m）。座る（腰を 0.35m 下げて 0.5m 前へ）・かがむ・足の高さ合わせで腰を下げる分 */
const BOUNDS_MARGIN = 0.8

/**
 * スキンのある形の視錐台カリングの境界を、全身を囲む 1 つの球にそろえる。three.js はスキンのある形の境界を最初の姿勢（T ポーズ）で
 * 1 度だけ計算するので、目・まつ毛・サングラスのレンズのような小さな形は、座って頭が下がると境界が実際の頭から離れ、
 * 顔の寄りで画面の外と見なされて描かれなかった（観覧車のゴンドラの中の寄り。docs/design/town.md §7 の 131）。
 * 球は見える三角形の頂点（スキニング後）だけで測る。VRM の境界を広げる見えない三角形（±2.5m。§7 の 208）を数えると、球の半径が 5m を超え、
 * ラボの中の離れた照明の影の地図にも花音が毎コマ描かれていた（配信のラボの中の画が 2% 遅くなった）
 */
function shareSkinnedBounds(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const meshes: THREE.SkinnedMesh[] = []
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    meshes.push(mesh)
    const used = visibleVertices(mesh.geometry)
    for (let i = 0; i < used.length; i++) {
      if (!used[i]) continue
      mesh.getVertexPosition(i, v)
      box.expandByPoint(v.applyMatrix4(mesh.matrixWorld))
    }
  })
  if (box.isEmpty()) return
  // 世界の座標で求めて、形ごとの座標へ戻す
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  sphere.radius += BOUNDS_MARGIN
  const inv = new THREE.Matrix4()
  for (const mesh of meshes) mesh.boundingSphere = sphere.clone().applyMatrix4(inv.copy(mesh.matrixWorld).invert())
}

const white = new THREE.Color(1, 1, 1)
/**
 * ラボの外・中のある建物の中のリム（段階 5 の色の仕上げ）。ラボのシアンの縁取りは照明とあまり関係なく出るので、暗い夜の町では
 * 花音が青緑に見えた。外にいる度合いで、うすい灰の、照明に比例するリムへ寄せる（ラボの中は今のまま）
 */
const rimColorAway = new THREE.Color('#d6dbe4').multiplyScalar(0.1)
const RIM_MIX_AWAY = 0.85
const _rim = new THREE.Color()

/**
 * 調整する MToon（WebGPU の MToonNodeMaterial。調整に使う欄は WebGL の MToonMaterial と同じ名前なので、どちらも受ける）
 */
export type VrmMToon = MToonMaterial | MToonNodeMaterial

/** MToon か（WebGL の MToonMaterial・WebGPU の MToonNodeMaterial のどちらでも。使う側の材質の判定もこれを使う） */
export function isVrmMToon(m: THREE.Material): m is THREE.Material & VrmMToon {
  const x = m as Partial<{ isMToonMaterial: boolean; isMToonNodeMaterial: boolean }>
  return x.isMToonMaterial === true || x.isMToonNodeMaterial === true
}

/** 縁の光（Character ごと。読み込んだ VRM の調整した MToon と、外にいる度合い） */
export interface VrmRim {
  /** 調整した MToon（リムを外にいる度合いで変える） */
  readonly tuned: VrmMToon[]
  /** 外にいる度合い（0 = ラボの中、1 = 外・建物の中） */
  blend: number
  /** MToon の調整（リムの色・照明との混ぜ方。character/avatar/visualConfig.ts の mtoon） */
  readonly mtoon: VrmMtoonConfig
  /** ラボの中のリムの色（rimColor × rimIntensity） */
  readonly color: THREE.Color
}

/** 縁の光を作る（mtoon は読み込むときの MToon の調整と同じ物） */
export function createVrmRim(mtoon: VrmMtoonConfig): VrmRim {
  return { tuned: [], blend: 0, mtoon, color: new THREE.Color(mtoon.rimColor).multiplyScalar(mtoon.rimIntensity) }
}

/** リムを、ラボの中（0）と外・建物の中（1）の間でまぜる（Character.setRimBlend から。kanon-lab は townBinding が地図の outsideness で毎コマ呼ぶ） */
export function setVrmRimBlend(rim: VrmRim, k: number) {
  if (k < 1e-3) k = 0
  if (Math.abs(k - rim.blend) < 1e-4) return
  rim.blend = k
  _rim.copy(rim.color).lerp(rimColorAway, k)
  const mix = rim.mtoon.rimLightingMix + (RIM_MIX_AWAY - rim.mtoon.rimLightingMix) * k
  for (const m of rim.tuned) {
    m.parametricRimColorFactor.copy(_rim)
    m.rimLightingMixFactor = mix
  }
}

/**
 * 読んだ VRM を片付ける: 縁の光の素材の一覧（rim.tuned）からこの VRM の素材を外し、形・素材・テクスチャを片付ける（VRMUtils.deepDispose）。
 * シーンから外すのは呼ぶ側（character/avatar/characterVisual.ts の dispose）
 */
export function releaseVrm(vrm: VRM, rim: VrmRim) {
  const mats = new Set<THREE.Material>()
  vrm.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if (m) for (const x of Array.isArray(m) ? m : [m]) mats.add(x)
  })
  for (let i = rim.tuned.length - 1; i >= 0; i--) if (mats.has(rim.tuned[i]!)) rim.tuned.splice(i, 1)
  VRMUtils.deepDispose(vrm.scene)
}

/** MToon を暗いラボ向けに調整する（輪郭のリム・影色の持ち上げ。リムの色と混ぜ方は rim の物） */
function tuneMaterial(material: THREE.Material, rim: VrmRim, cfg: VrmMtoonConfig) {
  if (!isVrmMToon(material)) return
  const m: VrmMToon = material
  // 背景に埋もれないよう、輪郭をシアンで縁取る（視線に対するリム）
  rim.tuned.push(m)
  m.parametricRimColorFactor.copy(rim.color).lerp(rimColorAway, rim.blend)
  m.parametricRimFresnelPowerFactor = cfg.rimFresnelPower
  m.parametricRimLiftFactor = cfg.rimLift
  m.rimLightingMixFactor = rim.mtoon.rimLightingMix + (RIM_MIX_AWAY - rim.mtoon.rimLightingMix) * rim.blend
  // 環境光の均一化（giEqualization）は WebGPU の MToonNodeMaterial に無い（環境光は向きのまま当たる。均一化 0 と同じ）。WebGL の MToonMaterial のときだけ
  // 入れる。花音は独自の材質に作り直すので、node 版に足すことはしない（第 1 段の決め。kanon-stream-video#25）
  if ('giEqualizationFactor' in m) m.giEqualizationFactor = cfg.giEqualization
  // 影色を少し持ち上げて、キーライトが当たらない側が黒くつぶれないようにする
  m.shadeColorFactor.lerp(white, cfg.shadeLift)
  m.outlineWidthFactor *= cfg.outlineWidthScale
  // 物理単位のライトに合わせて露出を下げる（白飛び防止）
  m.color.multiplyScalar(cfg.exposure)
  m.shadeColorFactor.multiplyScalar(cfg.exposure)
  // 腕を上げたときに袖の内側などが抜けて見えないよう、両面を描く。
  // ただしアウトライン用のマテリアル（裏返したシェルで描く）は両面にすると全身を覆ってしまうので触らない
  if (!m.isOutline && !m.transparent) m.side = THREE.DoubleSide
}

/**
 * 目の高さから身長を推定する（帽子・髪の盛りを含めないため）。目が無ければ頭のボーンから。
 * soleY は靴底の高さ（そこからの高さで測る）、eyeHeightRatio は目の高さ ÷ 身長 の目安（character/avatar/visualConfig.ts）
 */
export function estimateHeight(vrm: VRM, soleY: number, eyeHeightRatio: number): number | null {
  const pos = new THREE.Vector3()
  const eye = vrm.humanoid.getRawBoneNode('leftEye') ?? vrm.humanoid.getRawBoneNode('rightEye')
  if (eye) return (eye.getWorldPosition(pos).y - soleY) / eyeHeightRatio
  const head = vrm.humanoid.getRawBoneNode('head')
  // 頭のボーン（首の付け根の少し上）は身長のおよそ 88% の高さ
  if (head) return (head.getWorldPosition(pos).y - soleY) / 0.88
  return null
}

/**
 * いちばん低い頂点（靴底）の高さ。スキニング後の頂点で測る。
 * 面積の無い三角形（3 点が一直線）だけに使われている頂点は数えない。VRM には、視錐台カリングの境界を広げるための
 * 見えない三角形（腰の骨に付いた、±2.5m の角の 3 点ずつ）を入れたものがあり、それを数えると靴底が 0.39m 低く出て、
 * 花音が浮いて小さく（0.78 倍に）なっていた（docs/design/town.md §7 の 208）
 */
export function measureLowestPoint(root: THREE.Object3D): number {
  root.updateMatrixWorld(true)
  let minY = Infinity
  const v = new THREE.Vector3()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return
    const used = visibleVertices(mesh.geometry)
    for (let i = 0; i < used.length; i++) {
      if (!used[i]) continue
      mesh.getVertexPosition(i, v)
      v.applyMatrix4(mesh.matrixWorld)
      if (v.y < minY) minY = v.y
    }
  })
  return Number.isFinite(minY) ? minY : 0
}

/** 名前の候補（部分一致・大文字小文字を区別しない）でメッシュを探す */
export function findMeshByNames(root: THREE.Object3D, candidates: readonly string[]): THREE.Mesh | null {
  const keys = candidates.map((c) => c.toLowerCase())
  let found: THREE.Mesh | null = null
  root.traverse((obj) => {
    if (found || !(obj as THREE.Mesh).isMesh) return
    // GLTFLoader はノード名をメッシュに付ける。複数プリミティブのときは親のグループ名も見る
    const names = [obj.name, obj.parent?.name ?? ''].map((n) => n.toLowerCase())
    if (names.some((n) => keys.some((k) => n.includes(k)))) found = obj as THREE.Mesh
  })
  return found
}

/** ヒューマノイドのボーン（raw）。無ければ代わりの候補を順に探す */
export function getBone(vrm: VRM, ...names: VRMHumanBoneName[]): THREE.Object3D | null {
  for (const name of names) {
    const bone = vrm.humanoid.getRawBoneNode(name)
    if (bone) return bone
  }
  return null
}
