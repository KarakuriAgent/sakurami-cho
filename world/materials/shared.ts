/**
 * 自作シェーダー群で共有する時間 uniform。
 * 町の毎コマの初め（town.begin。world/createTown.ts）が毎フレーム 1 回だけ更新し（5-6 から。前は Lab.tsx の ShaderClock）、全マテリアルが同じオブジェクトを参照する。
 */
export const sharedTime = { value: 0 }

/** GLSL: 軽量なハッシュ関数 */
export const GLSL_HASH = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`
