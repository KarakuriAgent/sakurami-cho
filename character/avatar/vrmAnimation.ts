import type * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation'

/** 読み込んだ .vrma（VRM に合わせたクリップと、足が滑らない進む速さ） */
export interface LoadedVrmAnimation {
  clip: THREE.AnimationClip
  /** 1 倍の速さで再生したときに足が滑らない進む速さ（m/s、このモデルの大きさで）。速さの情報が無ければ null */
  walkSpeed: number | null
}

/**
 * .vrma（VRM Animation）を読み込む。ファイルが無ければ null（警告は出さない）。
 * walkSpeed は、1 倍の速さで再生したときに足が滑らない進む速さ（m/s、このモデルの大きさで）。
 * `pnpm sync:anim` で作った歩きには、.vrma の骨格での速さ（extras.walkSpeed）と脚の長さ（extras.legLength）が入っているので、
 * このモデルの脚の長さ（太もも + すね。拡大縮小を含む）との比を掛けて直す。無ければ null
 */
export async function loadVrmAnimation(url: string, vrm: VRM): Promise<LoadedVrmAnimation | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
    const gltf = await loader.loadAsync(url)
    const anim = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0]
    if (!anim) return null
    const extras = gltf.parser.json.animations?.[0]?.extras as { walkSpeed?: number; legLength?: number } | undefined
    const rest = vrm.humanoid.normalizedRestPose
    const len = (p?: number[]) => (p ? Math.hypot(p[0], p[1], p[2]) : 0)
    const leg = (len(rest.leftLowerLeg?.position) + len(rest.leftFoot?.position)) * vrm.scene.scale.y
    const walkSpeed = extras?.walkSpeed && extras.legLength && leg > 0 ? (extras.walkSpeed * leg) / extras.legLength : null
    return { clip: createVRMAnimationClip(anim, vrm), walkSpeed }
  } catch (e) {
    console.warn(`[sakurami-cho] VRM アニメーションを読み込めませんでした（${url}）。コードの動きを使います。`, e)
    return null
  }
}
