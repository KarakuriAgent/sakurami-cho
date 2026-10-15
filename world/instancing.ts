import * as THREE from 'three'

/**
 * InstancedMesh の入れ物の最小の数（WebGPU への移行の第 3 段）。three の WebGPURenderer は、インスタンスの行列の配列が uniform に入る大きさ
 * （1,024 個 = 64KB）以下だと、行列を uniform の配列で読む式を組み、その配列の長さがシェーダーに入るので、InstancedMesh ごとに別のシェーダーと
 * パイプラインになる（同じ素材でも共有されない）。入れ物を 1,025 個以上で作れば、行列は頂点ごとの値で読まれ、同じ素材・形の物はパイプラインを
 * 共有する。描く数は count で減らす（入れ物の残りは単位行列のまま描かない）
 */
export const INSTANCE_CAPACITY_MIN = 1025

/** 入れ物を INSTANCE_CAPACITY_MIN 以上で作り、count を描く数にした InstancedMesh */
export function instancedMesh<G extends THREE.BufferGeometry, M extends THREE.Material>(geometry: G, material: M, count: number): THREE.InstancedMesh<G, M> {
  const m = new THREE.InstancedMesh(geometry, material, Math.max(count, INSTANCE_CAPACITY_MIN))
  m.count = count
  return m
}
