import * as THREE from 'three'
import { outdoor } from './daylight'
import { interiorLight } from '../outdoor/interior/interiors'
import { outsideness } from './outsideness'
import type { TownFrame } from '../townHost'

/**
 * 露出のなめらかな切り替え（自動露出のように）。町の段階 3（docs/design/town.md §11）。
 *
 * - カメラがラボの中にいる間は 1（今までの配信の画のまま）
 * - 外では時刻で決める: 昼は少し絞り（空と白い壁が飛ばない）、夜は少し開ける（街灯の下の暗さに目が慣れる）
 * - 扉のまわり（ガラス壁の面の前後 1.4m）は、中と外をなめらかにまぜ、その上で値を 1 秒ほどかけて追う（外へ出た直後は少し明るく、すぐ落ち着く）
 * - カメラが 1 コマで 4m 以上動いた（カットした）ときは追わずに、その画の値にする
 * 値はレンダラの toneMappingExposure（最後のトーンマッピング（Effects.tsx）が掛ける）
 *
 * three の形（5-5。前の Exposure.tsx）: createExposure() で作り、毎コマ update(f) を呼ぶ（町の毎コマの段 town.exposure。world/createTown.ts。
 * kanon-lab は react/TownView.tsx の TownExposure の優先度 0.95 で、カメラ・撮影の構図・揺れのあと、描く前）。前のコマのカメラの位置は作った物ごと、今の露出はモジュールに 1 つ
 */

/** 外の露出（昼・夜） */
const OUTDOOR_EXPOSURE = { day: 0.84, night: 1.22 }
/** 中のある建物の部屋の中の露出（昼・夜。町の段階 4 の後半） */
const INTERIOR_EXPOSURE = { day: 1.18, night: 1.12 }
/** ガラスの温室（ガーデンドーム）の中の露出（昼・夜）。ガラスと木の葉で外より少し暗い */
const GLASSHOUSE_EXPOSURE = { day: 0.98, night: 1.2 }

/** 今の露出（ほかの物が読む用） */
const exposureState = { value: 1, target: 1 }

/** 露出を作る（前のコマのカメラの位置を持つ） */
export function createExposure() {
  const last = new THREE.Vector3(1e9, 0, 0)
  return {
    /** 毎コマ（描く前）: 目標の露出を決めて追い、レンダラの toneMappingExposure に書く */
    update(f: TownFrame) {
      const { renderer: gl, camera, dt } = f
      const outside = outsideness(camera.position)
      const out = THREE.MathUtils.lerp(OUTDOOR_EXPOSURE.night, OUTDOOR_EXPOSURE.day, THREE.MathUtils.smoothstep(outdoor.daylight, 0.15, 0.85))
      let target = THREE.MathUtils.lerp(1, out, outside)
      // 中のある建物の部屋の中（カメラ）: 部屋の露出
      if (interiorLight.camera > 0) target = THREE.MathUtils.lerp(INTERIOR_EXPOSURE.night, INTERIOR_EXPOSURE.day, THREE.MathUtils.smoothstep(outdoor.daylight, 0.15, 0.85))
      else if (interiorLight.glass > 0) target = THREE.MathUtils.lerp(GLASSHOUSE_EXPOSURE.night, GLASSHOUSE_EXPOSURE.day, THREE.MathUtils.smoothstep(outdoor.daylight, 0.15, 0.85))
      exposureState.target = target
      const jumped = last.distanceToSquared(camera.position) > 16
      last.copy(camera.position)
      if (jumped) exposureState.value = target
      else exposureState.value += (target - exposureState.value) * (1 - Math.exp(-Math.min(dt, 0.1) / 0.9))
      gl.toneMappingExposure = exposureState.value
    },
  }
}

export type Exposure = ReturnType<typeof createExposure>
