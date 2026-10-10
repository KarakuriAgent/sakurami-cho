import * as THREE from 'three'
import { GeoBuilder, MAT } from './builder'
import { naturalY } from './siteModel'

/**
 * 旧桜木丘電波観測所の大パラボラ（地図データの structure.sakuragioka.parabola: 皿の直径 12m・鉄骨の架台 6m 四方・皿の中心の高さ 9m・
 * 方位 250°・仰角 30°で止めてある。白い塗装がところどころはげ、錆が浮く。1999 年に閉所）。
 * ラボの東隣で、歩いて見に行ける立ち寄り先（大パラボラの前）があるので、町の構造物の仮の形ではなく、ここで細かく作る（§7 の 31）
 */

export interface ParabolaSpec {
  /** シーンの x, z（町の平面座標の y の逆） */
  x: number
  z: number
  dish: number
  center: number
  azimuth: number
  elevation: number
}

const RUST = '#6a5f55'
const STEEL = '#6b6862'
const WHITE = '#e6e3da'
const BACK = '#a7a39b'

export function buildParabola(b: GeoBuilder, s: ParabolaSpec) {
  const gy = naturalY(s.x, s.z)
  const base = gy + 0.45
  // 基礎（コンクリートの台）
  b.boxMinMax(s.x - 3.6, gy - 0.6, s.z - 3.6, s.x + 3.6, base, s.z + 3.6, '#8f8b83', MAT.concrete, 0)
  // 架台: 4 本の脚（下 6m 四方 → 上 2.4m 四方）と、3 段の帯と各面のたすき掛け
  const top = base + 6.0
  const leg = (sx: number, sz: number, y: number) => {
    const k = (y - base) / (top - base)
    const h = 3.0 + (1.2 - 3.0) * k
    return [s.x + sx * h, y, s.z + sz * h] as [number, number, number]
  }
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  for (const [sx, sz] of corners) {
    b.beam(leg(sx, sz, base), leg(sx, sz, top), 0.26, RUST, MAT.worn, 0.8)
    b.box([leg(sx, sz, base)[0], base + 0.05, leg(sx, sz, base)[2]], [0.6, 0.1, 0.6], STEEL, MAT.paint, 0.2)
  }
  const levels = [base + 0.3, base + 2.2, base + 4.1, top]
  for (const y of levels) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]
      const [bx, bz] = corners[(i + 1) % 4]
      b.beam(leg(ax, az, y), leg(bx, bz, y), 0.16, RUST, MAT.worn, 0.85)
    }
  }
  for (let l = 1; l < levels.length; l++) {
    const y0 = levels[l - 1]
    const y1 = levels[l]
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]
      const [bx, bz] = corners[(i + 1) % 4]
      b.beam(leg(ax, az, y0), leg(bx, bz, y1), 0.09, RUST, MAT.worn, 0.9)
      b.beam(leg(bx, bz, y0), leg(ax, az, y1), 0.09, RUST, MAT.worn, 0.9)
    }
  }
  // 上の点検の床と手すり
  b.boxMinMax(s.x - 1.6, top, s.z - 1.6, s.x + 1.6, top + 0.12, s.z + 1.6, STEEL, MAT.paint, 0.2)
  // 旋回台と、仰角の軸を支える 2 本の腕
  b.cylinder([s.x, top + 0.12, s.z], 1.25, 0.7, 24, '#7c7871', MAT.worn, 0.5)
  const az = (s.azimuth * Math.PI) / 180
  const el = (s.elevation * Math.PI) / 180
  // 皿の向き（シーンの座標。方位は北 = -z から時計回り）
  const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az))
  const horiz = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az))
  const side = new THREE.Vector3(-horiz.z, 0, horiz.x)
  const axisY = s.center + gy - 0.2
  const axis = new THREE.Vector3(s.x, axisY, s.z)
  for (const k of [-1, 1]) {
    const foot = new THREE.Vector3(s.x, top + 0.82, s.z).addScaledVector(side, k * 1.05)
    const head = axis.clone().addScaledVector(side, k * 1.6)
    b.beam([foot.x, foot.y, foot.z], [head.x, head.y, head.z], 0.42, '#77736c', MAT.worn, 0.6)
  }
  const a0 = axis.clone().addScaledVector(side, -1.9)
  const a1 = axis.clone().addScaledVector(side, 1.9)
  b.beam([a0.x, a0.y, a0.z], [a1.x, a1.y, a1.z], 0.36, STEEL, MAT.worn, 0.5)
  // 釣り合いのおもり（皿の後ろ）
  const cw = axis.clone().addScaledVector(dir, -1.5).addScaledVector(new THREE.Vector3(0, -1, 0), 0.4)
  b.box([cw.x, cw.y, cw.z], [1.4, 1.1, 1.4], '#6e6a63', MAT.worn, 0.7, Math.atan2(horiz.x, horiz.z))

  // 皿（回転放物面。直径 dish、f/D = 0.4）。表は白い塗装（はげと錆）、裏は灰色の鋼板
  const R = s.dish / 2
  const f = s.dish * 0.4
  const profile: [number, number][] = []
  for (let i = 0; i <= 14; i++) {
    const r = (i / 14) * R
    profile.push([r, (r * r) / (4 * f)])
  }
  const vertex = axis.clone().addScaledVector(dir, 0.35)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  const m = new THREE.Matrix4().compose(vertex, q, new THREE.Vector3(1, 1, 1))
  b.lathe(profile, 48, m, WHITE, MAT.worn, 0.45, false)
  const back = new THREE.Matrix4().compose(vertex.clone().addScaledVector(dir, -0.06), q, new THREE.Vector3(1, 1, 1))
  b.lathe(profile, 48, back, BACK, MAT.worn, 0.7, true)
  // 縁の輪と、裏の放射状の骨（16 本）
  const P = (r: number, a: number, off = 0) => {
    const h = (r * r) / (4 * f)
    return new THREE.Vector3(Math.sin(a) * r, h - off, Math.cos(a) * r).applyMatrix4(m)
  }
  for (let j = 0; j < 48; j++) {
    const p0 = P(R + 0.04, (j / 48) * Math.PI * 2, 0.08)
    const p1 = P(R + 0.04, ((j + 1) / 48) * Math.PI * 2, 0.08)
    b.beam([p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], 0.16, BACK, MAT.worn, 0.75)
  }
  for (let j = 0; j < 16; j++) {
    const a = (j / 16) * Math.PI * 2
    for (let i = 1; i <= 6; i++) {
      const p0 = P(((i - 1) / 6) * R, a, 0.22)
      const p1 = P((i / 6) * R, a, 0.22)
      b.beam([p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], 0.12, RUST, MAT.worn, 0.9)
    }
  }
  // 受信機を支える 4 本の脚と、焦点の受信機の筒
  const focus = vertex.clone().addScaledVector(dir, f * 0.92)
  for (let j = 0; j < 4; j++) {
    const a = (j / 4) * Math.PI * 2 + Math.PI / 4
    const p = P(R * 0.86, a)
    b.beam([p.x, p.y, p.z], [focus.x, focus.y, focus.z], 0.08, '#d9d6cd', MAT.worn, 0.55)
  }
  const fm = new THREE.Matrix4().compose(focus.clone().addScaledVector(dir, -0.4), q, new THREE.Vector3(1, 1, 1))
  b.lathe(
    [
      [0.0, 0],
      [0.35, 0],
      [0.35, 0.9],
      [0.22, 1.2],
      [0.0, 1.2],
    ],
    16,
    fm,
    '#cfcbc1',
    MAT.worn,
    0.5,
    true,
  )
}
