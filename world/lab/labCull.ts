import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { OUTDOOR_LAYER } from '../outdoor/layers'

/**
 * ラボの什器を、見えないコマだけ描かない（WebGPU への移行の第 3 段。kanon-claire-thompson/kanon-stream-video#25）。
 *
 * 町の通りなど、ラボから離れた所では、ラボは丘や建物の陰で見えないのに、什器（1 コマ 300 余りの描く物と、作業台・舞台のスポットの影の地図）を
 * 描いていた（WebGL の前のアプリも同じ）。見えないことを確かめてから、什器の群（と空気の群）を隠す。見え方は変わらない:
 *
 * - カメラがラボの箱（殻と什器を囲む箱を広げた物）の中なら、いつも描く
 * - ラボの箱がカメラの視野の外なら描かない（描いても画面に出ない。three のカリングで消えるのと同じ。スポットの影の地図の描く物も減る。
 *   スポットの光は殻の中に当たり、殻（壁・床・天井）は隠さないので、影の地図に殻は残る）。視野に入ったコマから描く（遅れは無い）
 * - 視野の中なら、GPU の遮蔽のクエリ（occlusion query）でラボの箱の前の面が全部ほかの物の陰か調べる。続けて 3 回陰なら描かない。
 *   結果は GPU から非同期に戻るので 1〜数コマ遅れる。遅れて見え始めても画が欠けないよう、箱は「3m と、カメラからの距離の 3°分」の大きい方だけ
 *   広げる（ラボそのものより先に箱が見え始める）。カメラが 4m より跳んだコマ（カット）・カメラが替わったコマは、結果を捨てて描く
 *
 * 箱（proxy）は色も深さも書かない、何も描かない mesh（遠景のレイヤー。ふだんのカメラだけが見て、床の映り込みと影の地図には入らない）。
 * 不透明の物を描き終えたあとに描く（renderOrder）。使う側は proxy を場面に置き、毎コマ、カメラを動かしたあと・什器を描く前に update(camera) を呼ぶ
 */

/** 箱を広げる幅（m）と角度（ラジアン。カメラからの距離に掛ける） */
const MARGIN = { min: 3, angle: THREE.MathUtils.degToRad(3) }
/** 陰が続いた回数がこれに届いたら隠す */
const HIDE_AFTER = 3
/** カメラがこれより跳んだら結果を捨てる（m。撮影のカットと同じ） */
const CUT = 4

export interface LabCull {
  /** 遮蔽を調べる箱（場面に置く） */
  readonly proxy: THREE.Mesh
  /** 今のコマで什器を描くか */
  readonly visible: boolean
  /** 隠す群を入れ替える（作ったあとで群が決まるとき） */
  setTargets(targets: readonly THREE.Object3D[]): void
  /** 箱（ワールド。殻と什器を囲む箱）を入れる */
  setBounds(box: THREE.Box3): void
  /** 毎コマ、カメラを動かしたあと・什器を描く前 */
  update(camera: THREE.Camera): void
  dispose(): void
}

const _box = new THREE.Box3()
const _center = new THREE.Vector3()
const _size = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _frustum = new THREE.Frustum()

export function createLabCull(): LabCull {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new MeshBasicNodeMaterial()
  material.name = 'labCullProxy'
  material.colorWrite = false
  material.depthWrite = false
  material.fog = false
  const proxy = new THREE.Mesh(geometry, material)
  proxy.name = 'lab:cullProxy'
  proxy.occlusionTest = true
  proxy.castShadow = false
  proxy.receiveShadow = false
  // 不透明の物（遠景の ORDER 10 も）を描き終えたあと
  proxy.renderOrder = 1000
  proxy.layers.set(OUTDOOR_LAYER)
  proxy.visible = false

  const bounds = new THREE.Box3()
  let targets: readonly THREE.Object3D[] = []
  let visible = true
  /** 続けて陰だった回数（ふだんのカメラのコマで数える） */
  let hidden = 0
  let lastCamera: THREE.Camera | null = null
  const lastPos = new THREE.Vector3()
  let inView = false
  /** 数え直したあと、読まずに捨てる回数（前の結果がまだ残っている間） */
  let skip = 0

  // ふだんのカメラのコマで、前に戻った結果を読む（renderer.isOccluded は描いている描き先の、最後に戻った結果）
  proxy.onBeforeRender = (renderer, _scene, camera) => {
    if (camera !== lastCamera) return
    if (skip > 0) {
      skip--
      return
    }
    const occluded = (renderer as unknown as { isOccluded(o: THREE.Object3D): boolean }).isOccluded(proxy)
    hidden = occluded ? hidden + 1 : 0
  }

  const apply = (v: boolean) => {
    if (v === visible) return
    visible = v
    for (const t of targets) t.visible = v
  }

  return {
    proxy,
    get visible() {
      return visible
    },
    setTargets(next) {
      for (const t of targets) t.visible = true
      targets = next
      for (const t of targets) t.visible = visible
    },
    setBounds(box) {
      bounds.copy(box)
      proxy.visible = !bounds.isEmpty()
    },
    update(camera) {
      if (bounds.isEmpty()) return apply(true)
      camera.updateMatrixWorld()
      const p = camera.getWorldPosition(_center)
      const jumped = camera !== lastCamera || p.distanceTo(lastPos) > CUT
      lastCamera = camera
      lastPos.copy(p)
      // 箱を広げる（3m と、距離の 3°分の大きい方）
      const d = bounds.distanceToPoint(p)
      _box.copy(bounds).expandByScalar(Math.max(MARGIN.min, d * Math.tan(MARGIN.angle)))
      _box.getCenter(_center)
      _box.getSize(_size)
      proxy.position.copy(_center)
      proxy.scale.copy(_size)
      proxy.updateMatrix()
      proxy.updateMatrixWorld()
      if (_box.containsPoint(camera.getWorldPosition(_center)) || jumped) {
        hidden = 0
        skip = 2
        inView = true
        return apply(true)
      }
      _frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem)
      const nowInView = _frustum.intersectsBox(_box)
      if (!nowInView) {
        inView = false
        hidden = 0
        return apply(false)
      }
      if (!inView) {
        // 視野に入ったコマ: 前の結果は使わない（描いて、新しい結果を待つ）
        inView = true
        hidden = 0
        skip = 2
      }
      apply(hidden < HIDE_AFTER)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
