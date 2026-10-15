import * as THREE from 'three'
import { CubeRenderTarget, type WebGPURenderer } from 'three/webgpu'
import { outdoor, updateOutdoor } from '../../environment/daylight'
import { labLight } from '../../labLight'
import { LAB_ENV_CAPTURE, LAB_FORMERS, type LabFormerSpec } from './lightTable'

/**
 * 反射用の環境（docs/design/map-split.md §6 の「段 4」・4-3。案の §3.1）。金属やガラスへの映り込み専用で、外部 HDRI は使わない。
 * ラボの発光体の配置をざっくり再現した「光る板」（lightTable.ts の LAB_FORMERS）を、原点の cube のカメラで撮る。
 * 前の drei の Environment（EnvironmentPortal・frames 1）と Lightformer の手順をそのまま書いた物:
 *
 * - 光る板 = PlaneGeometry・RingGeometry に MeshBasicMaterial（toneMapped なし・両面・色 × 強さ）。位置と大きさを入れて場面に足したあと、
 *   向きを単位にして原点を向ける（drei の Lightformer の癖。前の rotation-x・rotation-y の指定は効いていなかった）
 * - 撮る先 = CubeRenderTarget（WebGPU。前は WebGLCubeRenderTarget）（256 px・HalfFloat）、cube のカメラは光る板の場面の最後の子（near 0.1・far 1000・原点）、背景の色 #010204。
 *   撮る間だけ renderer.autoClear を true にする
 * - 南のガラス壁と西・東の窓の板は外の光（時刻で変わる）。毎コマ撮り直すと重いので、0.25 秒ごとに外の光を見て、
 *   目に見えるほど変わったとき（明るさ 8%・色 6%）だけ撮り直す。撮り直すのは、そのコマの処理（描画まで）が終わったあと
 *   （queueMicrotask。前の drei が React の commit で撮り直していたのと同じ時期で、新しい環境はそのコマには効かず、次のコマから効く）
 */

/** 反射用の環境に入れる、外の光（ガラス壁の上の空・下の町と地面・西と東の窓の空）。色は 0〜1 に正規化し、明るさは intensity に分ける */
export interface EnvOutdoor {
  sky: string
  skyI: number
  ground: string
  groundI: number
}

const _env = new THREE.Color()

function toFormer(c: THREE.Color, comp: number): [string, number] {
  const m = Math.max(c.r, c.g, c.b, 1e-4)
  return ['#' + _env.copy(c).multiplyScalar(1 / m).getHexString(), m * comp]
}

/**
 * いまの外の光から、反射用の環境の値を作る。部屋の照明が落ちると照明が環境全体の強さ（environmentIntensity）を一緒に落とすので、
 * 外の光の分はその分だけ強めて打ち消す（外の光には部屋の照明の落ち具合をかけない）。打ち消しに使うのは入れた明るさ（labLight.level。
 * 特別演出の明滅を含まない。前の streamFx.room と同じ値）
 */
export function snapshotEnv(): EnvOutdoor {
  if (outdoor.version === 0) updateOutdoor()
  const comp = 1 / (0.4 + 0.6 * Math.min(1.2, labLight.level))
  const [sky, skyI] = toFormer(outdoor.interior.envSky, comp)
  const [ground, groundI] = toFormer(outdoor.interior.envGround, comp)
  return { sky, skyI, ground, groundI }
}

/** 前に作った環境から、目に見えるほど変わったか（明るさ 8%・色 6%） */
export function envChanged(a: EnvOutdoor, b: EnvOutdoor) {
  const rel = (x: number, y: number) => Math.abs(x - y) / Math.max(0.02, Math.max(x, y))
  const hue = (x: string, y: string) => {
    const cx = new THREE.Color(x)
    const cy = new THREE.Color(y)
    return Math.max(Math.abs(cx.r - cy.r), Math.abs(cx.g - cy.g), Math.abs(cx.b - cy.b))
  }
  return rel(a.skyI, b.skyI) > 0.08 || rel(a.groundI, b.groundI) > 0.08 || hue(a.sky, b.sky) > 0.06 || hue(a.ground, b.ground) > 0.06
}

export interface LabEnvironment {
  /** scene.environment に入れる cube のテクスチャ */
  readonly texture: THREE.Texture
  /** 光る板の場面（撮るときだけ描く） */
  readonly scene: THREE.Scene
  /** 今の値で撮る */
  capture(renderer: WebGPURenderer): void
  /** 毎コマ: 0.25 秒ごとに外の光を見て、変わっていたら、このコマの処理が終わったあとに撮り直す（renderer で） */
  update(time: number, renderer: WebGPURenderer): void
  /** 撮り直しを受け付けるか（場面に付けている間だけ true にする。外したあとに撮り直さない） */
  active: boolean
  dispose(): void
}

/** 光る板（drei の Lightformer と同じ作り方。場面に足す前に呼ぶ。向きは足したあとに aimFormer で） */
function createFormer(f: LabFormerSpec): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const geometry =
    f.form === 'circle' ? new THREE.RingGeometry(0, 0.5, 64) : f.form === 'ring' ? new THREE.RingGeometry(0.25, 0.5, 64) : new THREE.PlaneGeometry(1, 1)
  const material = new THREE.MeshBasicMaterial()
  material.toneMapped = false
  material.side = THREE.DoubleSide
  const mesh = new THREE.Mesh(geometry, material)
  if (typeof f.scale === 'number') mesh.scale.setScalar(f.scale)
  else mesh.scale.fromArray(f.scale)
  mesh.position.fromArray(f.at)
  return mesh
}

/** 光る板の色 = 色 × 強さ（drei の Lightformer と同じ: 色を入れてから強さを掛ける） */
function paintFormer(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, color: string, intensity: number) {
  mesh.material.color.set(color)
  mesh.material.color.multiplyScalar(intensity)
}

/** 原点へ向ける（drei の Lightformer の既定の target。場面に足したあとに。親の行列も見る） */
function aimFormer(mesh: THREE.Object3D) {
  mesh.quaternion.identity()
  mesh.lookAt(new THREE.Vector3(0, 0, 0))
}

/** 反射用の環境を作る（光る板の場面と撮る先。まだ撮らない）。kits: ある置き場所の id（印の付いた板のうち、無い物は作らない） */
export function createLabEnvironment(o: { kits: ReadonlySet<string> }): LabEnvironment {
  const scene = new THREE.Scene()
  const target = new CubeRenderTarget(LAB_ENV_CAPTURE.resolution)
  target.texture.type = THREE.HalfFloatType
  scene.background = new THREE.Color(LAB_ENV_CAPTURE.background)

  let env = snapshotEnv()
  let lastAt = 0
  const outdoorFormers: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; outdoor: 'sky' | 'ground' }[] = []
  const formers: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []
  const groups = new Map<number, THREE.Group>()
  const paintOutdoor = () => {
    for (const { mesh, outdoor: kind } of outdoorFormers) {
      if (kind === 'sky') paintFormer(mesh, env.sky, env.skyI)
      else paintFormer(mesh, env.ground, env.groundI)
    }
  }
  for (const f of LAB_FORMERS) {
    if (f.kit && !o.kits.has(f.kit)) continue
    const mesh = createFormer(f)
    formers.push(mesh)
    if (f.group !== undefined) {
      let g = groups.get(f.group)
      if (!g) {
        g = new THREE.Group()
        groups.set(f.group, g)
        scene.add(g)
      }
      g.add(mesh)
    } else scene.add(mesh)
    if (f.outdoor) outdoorFormers.push({ mesh, outdoor: f.outdoor })
    else paintFormer(mesh, f.color, f.intensity)
  }
  paintOutdoor()
  for (const mesh of formers) aimFormer(mesh)
  const camera = new THREE.CubeCamera(LAB_ENV_CAPTURE.near, LAB_ENV_CAPTURE.far, target)
  scene.add(camera)

  let queued = false
  const lab: LabEnvironment = {
    texture: target.texture,
    scene,
    active: false,
    capture(renderer) {
      const autoClear = renderer.autoClear
      renderer.autoClear = true
      camera.update(renderer, scene)
      renderer.autoClear = autoClear
    },
    update(time, renderer) {
      if (time - lastAt < 0.25) return
      const next = snapshotEnv()
      if (!envChanged(env, next)) return
      env = next
      lastAt = time
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (!lab.active) return
        paintOutdoor()
        // drei の Lightformer は描き直すたびに原点へ向け直していた（同じ向きになる）
        for (const mesh of formers) aimFormer(mesh)
        lab.capture(renderer)
      })
    },
    dispose() {
      target.dispose()
      for (const mesh of formers) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
    },
  }
  return lab
}
