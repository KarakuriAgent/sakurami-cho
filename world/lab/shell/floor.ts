import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { ROOM } from '../../../core/lab/plan'
import type { LabFloorTextures } from '../textures'
import { BlurPass } from './reflector/BlurPass'
import { MeshReflectorMaterial } from './reflector/MeshReflectorMaterial'

/**
 * ラボの床（docs/design/map-split.md §6 の「段 4」・4-4。前の Room.tsx の Floor）。品質が high なら、濡れたコンクリートのような、
 * なめらかにぼけた映り込み（drei の MeshReflectorMaterial を reflector/ に写した物）。low ならふつうの PBR の床。
 *
 * 映り込みを描く手順は、drei の core/MeshReflectorMaterial.js（React の部品）の beforeRender と useFrame をそのまま写した:
 * 床を隠す → 床で折り返したカメラ（斜めの近い面で床の下を切る）で場面を撮る（xr と影の地図の自動更新を止める。autoClear でなければ消す）
 * → ぼかす → 戻す。撮る先（1024 px・HalfFloat・深さのテクスチャ）とぼかしは作る時に 1 回だけ作る（drei の useMemo と同じ。値は変えない）。
 * 毎コマ、殻の更新の初め（照明と町の遠景のあと、什器・KB-001・配信の部品の更新より前。案の E2・E3）に renderReflection を呼ぶ。
 * 映るのは、什器などの前のコマの姿と、光と花音の今のコマの姿（前と同じ）
 */

/** 映り込みの値（前の Room.tsx の MeshReflectorMaterial に渡していた物） */
const REFLECTOR = {
  color: '#a3abb4',
  roughness: 0.62,
  metalness: 0,
  resolution: 1024,
  blur: [520, 260] as [number, number],
  mixBlur: 0.9,
  mixStrength: 7,
  mixContrast: 1,
  mirror: 0.8,
  depthScale: 0.8,
  minDepthThreshold: 0.25,
  maxDepthThreshold: 1.4,
  depthToBlurRatioBias: 0.4,
  /** drei の既定の値（前は渡していなかった物） */
  distortion: 1,
  reflectorOffset: 0,
}

export interface LabFloor {
  readonly mesh: THREE.Mesh
  /** 床の映り込みを描く（high のときだけ。low なら何もしない） */
  renderReflection(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): void
  /** 撮る先・ぼかし・素材・形を捨てる（床のテクスチャは使う側の物なので捨てない） */
  dispose(): void
}

/** 床を作る。textures は下ごしらえした床のテクスチャ（textures.ts の prepareLabFloorTextures） */
export function createLabFloor(o: { textures: LabFloorTextures; quality: 'high' | 'low' }): LabFloor {
  const geometry = new THREE.PlaneGeometry(ROOM.width, ROOM.depth)
  if (o.quality !== 'high') {
    const material = new THREE.MeshStandardMaterial({ ...o.textures, color: '#8d949c', normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.55, metalness: 0 })
    const mesh = floorMesh(geometry, material)
    return {
      mesh,
      renderReflection() {},
      dispose() {
        geometry.dispose()
        material.dispose()
      },
    }
  }
  const reflector = createReflector(o.textures.map)
  const mesh = floorMesh(geometry, reflector.material)
  return {
    mesh,
    // WebGPU への移行（第 1 段）: 映り込みを撮る所（reflector.render）は WebGL の state を直に触るので、WebGPURenderer では呼ばない。
    // 床は MeshReflectorMaterial の元の MeshStandardMaterial の見た目（映り込み無し）で出る。第 2 段で TSL の reflector() に置き換える
    renderReflection: () => undefined,
    dispose() {
      geometry.dispose()
      reflector.dispose()
    },
  }
}

function floorMesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(0, 0, ROOM.centerZ)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  return mesh
}

/**
 * 映り込みの素材と、描く手順（drei の core/MeshReflectorMaterial.js の写し）。
 * 法線マップで映り込みを歪ませる（波打ったノイズになる）・ラフネスマップでぼかし量がまだらになるので、反射の側には色マップの色ムラだけを使う
 */
function createReflector(map: THREE.Texture) {
  const R = REFLECTOR
  const blur = R.blur
  const hasBlur = blur[0] + blur[1] > 0
  const blurX = blur[0]
  const blurY = blur[1]
  // drei の useState の物
  const reflectorPlane = new THREE.Plane()
  const normal = new THREE.Vector3()
  const reflectorWorldPosition = new THREE.Vector3()
  const cameraWorldPosition = new THREE.Vector3()
  const rotationMatrix = new THREE.Matrix4()
  const lookAtPosition = new THREE.Vector3(0, 0, -1)
  const clipPlane = new THREE.Vector4()
  const view = new THREE.Vector3()
  const target = new THREE.Vector3()
  const q = new THREE.Vector4()
  const textureMatrix = new THREE.Matrix4()
  const virtualCamera = new THREE.PerspectiveCamera()

  // drei の useMemo の物（撮る先・ぼかし）
  const parameters = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType }
  const fbo1 = new THREE.WebGLRenderTarget(R.resolution, R.resolution, parameters)
  fbo1.depthBuffer = true
  fbo1.depthTexture = new THREE.DepthTexture(R.resolution, R.resolution)
  fbo1.depthTexture.format = THREE.DepthFormat
  fbo1.depthTexture.type = THREE.UnsignedShortType
  const fbo2 = new THREE.WebGLRenderTarget(R.resolution, R.resolution, parameters)
  const blurpass = new BlurPass({
    resolution: R.resolution,
    width: blurX,
    height: blurY,
    minDepthThreshold: R.minDepthThreshold,
    maxDepthThreshold: R.maxDepthThreshold,
    depthScale: R.depthScale,
    depthToBlurRatioBias: R.depthToBlurRatioBias,
  })

  // 素材（R3F が JSX の値を入れていた順: drei の reflectorProps → 渡した値）
  const material = new MeshReflectorMaterial()
  material.mirror = R.mirror
  material.textureMatrix = textureMatrix
  material.mixBlur = R.mixBlur
  material.tDiffuse = fbo1.texture
  material.tDepth = fbo1.depthTexture
  material.tDiffuseBlur = fbo2.texture
  material.hasBlur = hasBlur
  material.mixStrength = R.mixStrength
  material.minDepthThreshold = R.minDepthThreshold
  material.maxDepthThreshold = R.maxDepthThreshold
  material.depthScale = R.depthScale
  material.depthToBlurRatioBias = R.depthToBlurRatioBias
  material.distortion = R.distortion
  material.mixContrast = R.mixContrast
  const defines = material.defines!
  if (hasBlur) defines.USE_BLUR = ''
  if (R.depthScale > 0) defines.USE_DEPTH = ''
  material.map = map
  material.color.set(R.color)
  material.roughness = R.roughness
  material.metalness = R.metalness

  /** 折り返したカメラと、映り込みを貼る行列を決める（drei の beforeRender） */
  const beforeRender = (parent: THREE.Object3D, camera: THREE.Camera) => {
    reflectorWorldPosition.setFromMatrixPosition(parent.matrixWorld)
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld)
    rotationMatrix.extractRotation(parent.matrixWorld)
    normal.set(0, 0, 1)
    normal.applyMatrix4(rotationMatrix)
    reflectorWorldPosition.addScaledVector(normal, R.reflectorOffset)
    view.subVectors(reflectorWorldPosition, cameraWorldPosition)
    // Avoid rendering when reflector is facing away
    if (view.dot(normal) > 0) return
    view.reflect(normal).negate()
    view.add(reflectorWorldPosition)
    rotationMatrix.extractRotation(camera.matrixWorld)
    lookAtPosition.set(0, 0, -1)
    lookAtPosition.applyMatrix4(rotationMatrix)
    lookAtPosition.add(cameraWorldPosition)
    target.subVectors(reflectorWorldPosition, lookAtPosition)
    target.reflect(normal).negate()
    target.add(reflectorWorldPosition)
    virtualCamera.position.copy(view)
    virtualCamera.up.set(0, 1, 0)
    virtualCamera.up.applyMatrix4(rotationMatrix)
    virtualCamera.up.reflect(normal)
    virtualCamera.lookAt(target)
    virtualCamera.far = (camera as THREE.PerspectiveCamera).far // Used in WebGLBackground
    virtualCamera.updateMatrixWorld()
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix)
    // Update the texture matrix
    textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0)
    textureMatrix.multiply(virtualCamera.projectionMatrix)
    textureMatrix.multiply(virtualCamera.matrixWorldInverse)
    textureMatrix.multiply(parent.matrixWorld)
    // Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
    // Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
    reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition)
    reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse)
    clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant)
    const projectionMatrix = virtualCamera.projectionMatrix
    q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0]
    q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5]
    q.z = -1.0
    q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14]
    // Calculate the scaled plane vector
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q))
    // Replacing the third row of the projection matrix
    projectionMatrix.elements[2] = clipPlane.x
    projectionMatrix.elements[6] = clipPlane.y
    projectionMatrix.elements[10] = clipPlane.z + 1.0
    projectionMatrix.elements[14] = clipPlane.w
  }

  return {
    material,
    /** 映り込みを撮る（drei の useFrame。向こうを向いていても撮る所も同じ） */
    render(parent: THREE.Object3D, gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
      parent.visible = false
      const currentXrEnabled = gl.xr.enabled
      const currentShadowAutoUpdate = gl.shadowMap.autoUpdate
      beforeRender(parent, camera)
      gl.xr.enabled = false
      gl.shadowMap.autoUpdate = false
      gl.setRenderTarget(fbo1)
      gl.state.buffers.depth.setMask(true)
      if (!gl.autoClear) gl.clear()
      gl.render(scene, virtualCamera)
      if (hasBlur) blurpass.render(gl, fbo1, fbo2)
      gl.xr.enabled = currentXrEnabled
      gl.shadowMap.autoUpdate = currentShadowAutoUpdate
      parent.visible = true
      gl.setRenderTarget(null)
    },
    dispose() {
      fbo1.depthTexture?.dispose()
      fbo1.dispose()
      fbo2.dispose()
      blurpass.renderTargetA.dispose()
      blurpass.renderTargetB.dispose()
      blurpass.convolutionMaterial.dispose()
      blurpass.screen.geometry.dispose()
      material.dispose()
    },
  }
}
