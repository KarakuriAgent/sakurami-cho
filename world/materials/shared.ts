import { Fn, dot, fract, uniform, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'

/**
 * 自作シェーダー群で共有する時間 uniform。
 * 町の毎コマの初め（town.begin。world/createTown.ts）が毎フレーム 1 回だけ更新し（5-6 から。前は Lab.tsx の ShaderClock）、全マテリアルが同じオブジェクトを参照する。
 * WebGPU への移行（第 1 段）から TSL のノードの uniform（TSL の材質はそのまま式に使う。value は前と同じく読み書きできる）
 */
export const sharedTime = uniform(0)

/** 軽量なハッシュ（1 次元 → 0〜1。TSL の Fn。前の GLSL の hash11） */
export const hash11 = Fn(([p0]: [Node<'float'>]) => {
  const p = fract(p0.mul(0.1031)).toVar()
  p.mulAssign(p.add(33.33))
  p.mulAssign(p.add(p))
  return fract(p)
})

/** 軽量なハッシュ（2 次元 → 0〜1。TSL の Fn。前の GLSL の hash21） */
export const hash21 = Fn(([p]: [Node<'vec2'>]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar()
  p3.addAssign(dot(p3, p3.yzx.add(33.33)))
  return fract(p3.x.add(p3.y).mul(p3.z))
})
