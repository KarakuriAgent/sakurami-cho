import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Vec3 } from '../../../core/lab/plan'

/**
 * プロシージャルな形状ヘルパー（Blender で作ったモデルに差し替えるまでのつなぎ）。three だけで作る
 * （docs/design/map-split.md §6 の「段 4」・4-2。前は scene/parts/geometry.ts。そちらはここを再び出す）。
 */

/** 中心が原点、XY 平面上の厚みのあるリング（Z 方向に depth） */
export function annulusGeometry(rOut: number, rIn: number, depth: number, bevel = 0.012, segments = 128) {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, rOut, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, rIn, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: segments,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/**
 * 切れ目の入ったリング（count 個の扇形セグメント）。gap はセグメント間の隙間（ラジアン）。
 * 1 つのジオメトリにまとめて返す。
 */
export function segmentedRingGeometry(rOut: number, rIn: number, depth: number, count: number, gap: number, bevel = 0.008) {
  const parts: THREE.BufferGeometry[] = []
  const step = (Math.PI * 2) / count
  for (let i = 0; i < count; i++) {
    const a0 = i * step + gap / 2
    const a1 = (i + 1) * step - gap / 2
    const shape = new THREE.Shape()
    shape.absarc(0, 0, rOut, a0, a1, false)
    shape.absarc(0, 0, rIn, a1, a0, true)
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: Math.max(6, Math.round(48 / count) * 2),
    })
    g.translate(0, 0, -depth / 2)
    parts.push(g)
  }
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  if (!merged) throw new Error('segmentedRingGeometry: ジオメトリの結合に失敗しました')
  return merged
}

/** 角を面取りした箱（ExtrudeGeometry）。中心が原点 */
export function chamferBoxGeometry(w: number, h: number, d: number, chamfer = 0.02) {
  const shape = new THREE.Shape()
  const x = w / 2 - chamfer
  const y = h / 2 - chamfer
  shape.moveTo(-x, -y)
  shape.lineTo(x, -y)
  shape.lineTo(x, y)
  shape.lineTo(-x, y)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - chamfer * 2,
    bevelEnabled: true,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelSegments: 1,
  })
  g.translate(0, 0, -(d - chamfer * 2) / 2)
  return g
}

/** 円周上に並べるための行列を作る（XY 平面、半径 r、count 個） */
export function radialMatrices(count: number, r: number, z = 0, scale: [number, number, number] = [1, 1, 1], phase = 0) {
  const out: THREE.Matrix4[] = []
  const s = new THREE.Vector3(...scale)
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a)
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z), q, s))
  }
  return out
}

/** 床を這うケーブル用に、XZ の通過点から床に接する高さの点列を作る */
export function floorPath(radius: number, ...xz: [number, number][]): Vec3[] {
  return xz.map(([x, z]) => [x, radius, z])
}

/** 矩形の四隅（+ 辺の中間）にボルトを打つ位置を作る。plane は 'xy' | 'xz' | 'yz' */
export function boltGrid(
  center: Vec3,
  width: number,
  height: number,
  plane: 'xy' | 'xz' | 'yz',
  countX = 2,
  countY = 2,
): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i < countX; i++) {
    for (let j = 0; j < countY; j++) {
      if (i > 0 && i < countX - 1 && j > 0 && j < countY - 1) continue
      const u = countX === 1 ? 0 : (i / (countX - 1) - 0.5) * width
      const v = countY === 1 ? 0 : (j / (countY - 1) - 0.5) * height
      if (plane === 'xy') out.push([center[0] + u, center[1] + v, center[2]])
      else if (plane === 'xz') out.push([center[0] + u, center[1], center[2] + v])
      else out.push([center[0], center[1] + v, center[2] + u])
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* 曲面スクリーン                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 横方向に曲げた板（湾曲モニタ用）。中心が原点、端が +z 側（見る人の方）へ反る。
 * radius が曲率半径、width / height は画面の大きさ。
 */
export function curvedPlaneGeometry(width: number, height: number, radius: number, segments = 32) {
  const g = new THREE.PlaneGeometry(width, height, segments, 1)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const a = x / radius
    pos.setX(i, Math.sin(a) * radius)
    pos.setZ(i, radius - Math.cos(a) * radius)
  }
  g.computeVertexNormals()
  return g
}
