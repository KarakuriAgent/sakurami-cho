import * as THREE from 'three'

/**
 * 乗り物の乗り降りで花音が歩く短い道（観覧車のゴンドラ・ケーブルカー。character/ride/ride.ts・cableRide.ts）。点は車室の局所かシーンの x, z
 */

export interface Path {
  /** 点（ゴンドラの局所か、シーン）。xz だけ使う */
  pts: THREE.Vector3[]
  len: number[]
  total: number
  /** 進んだ距離と速さ */
  s: number
  speed: number
}

export function makePath(pts: THREE.Vector3[]): Path {
  // 角を少し丸める（曲がり角の前後 0.25m を 2 次曲線で）
  const out: THREE.Vector3[] = [pts[0].clone()]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const la = Math.hypot(b.x - a.x, b.z - a.z)
    const lc = Math.hypot(c.x - b.x, c.z - b.z)
    const r = Math.min(0.28, la * 0.45, lc * 0.45)
    const p0 = b.clone().lerp(a, r / Math.max(la, 1e-6))
    const p1 = b.clone().lerp(c, r / Math.max(lc, 1e-6))
    for (let k = 0; k <= 6; k++) {
      const u = k / 6
      const q = new THREE.Vector3()
      q.x = (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * b.x + u * u * p1.x
      q.z = (1 - u) * (1 - u) * p0.z + 2 * (1 - u) * u * b.z + u * u * p1.z
      out.push(q)
    }
  }
  out.push(pts[pts.length - 1].clone())
  const len = [0]
  for (let i = 1; i < out.length; i++) len.push(len[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z))
  return { pts: out, len, total: len[len.length - 1], s: 0, speed: 0 }
}

/** 道の上の点（距離 s）と向き */
export function pathAt(p: Path, s: number, out: THREE.Vector3, dir: THREE.Vector3) {
  const t = Math.min(Math.max(s, 0), p.total)
  let i = 1
  while (i < p.len.length - 1 && p.len[i] < t) i++
  const a = p.pts[i - 1]
  const b = p.pts[i]
  const seg = Math.max(1e-6, p.len[i] - p.len[i - 1])
  const u = (t - p.len[i - 1]) / seg
  out.set(a.x + (b.x - a.x) * u, 0, a.z + (b.z - a.z) * u)
  dir.set(b.x - a.x, 0, b.z - a.z).normalize()
  return out
}

/** 道を歩く（加速・減速）。着いたら true */
export function walkPath(p: Path, dt: number, maxSpeed = 0.78) {
  const remain = p.total - p.s
  const want = Math.min(maxSpeed, Math.sqrt(2 * 1.0 * Math.max(remain, 0)) + 0.05)
  p.speed += THREE.MathUtils.clamp(want - p.speed, -1.6 * dt, 1.2 * dt)
  p.s = Math.min(p.total, p.s + p.speed * dt)
  return p.total - p.s < 0.01
}

