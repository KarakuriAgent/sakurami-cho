import { SITE } from '../../../core/town'
import type { Frame, V3 } from './frame'
import { fbox, type Kit, quadFacing } from './kit'
import { NM } from './namedMaterial'
import { signAtlas, type SignStyle } from './signs'

/**
 * 組み立ての型が使う小さな部品（下屋の庇・袖看板・暖簾・手すり・ベランダ・柱・煙突・植木鉢・樽・郵便受け・旗）
 */

const LAB = SITE.labFloorElevation

/** 下屋の庇（町家の 1 階と 2 階のあいだの瓦の小さな屋根）: s0〜s1、壁の付け根の高さ h、出 depth、勾配 pitch（rise/run） */
export function penRoof(k: Kit, f: Frame, s0: number, s1: number, h: number, depth: number, color: string, mat: number, pitch = 0.45, aux = 0) {
  const b = k.solid
  const hl = h - depth * pitch
  const th = 0.12
  b.quad(f.p(s0, 0, h), f.p(s1, 0, h), f.p(s1, -depth, hl), f.p(s0, -depth, hl), color, mat, aux)
  b.ao = 0.6
  b.quad(f.p(s0, -depth, hl - th), f.p(s1, -depth, hl - th), f.p(s1, 0, h - th), f.p(s0, 0, h - th), '#4a3f35', NM.wood, 0)
  b.ao = 1
  quadFacing(b, f.p(s0, -depth, hl), f.p(s1, -depth, hl), f.p(s1, -depth, hl - th), f.p(s0, -depth, hl - th), f.dir(0, -1, 0), '#3a3028', NM.wood)
  for (const s of [s0, s1]) quadFacing(b, f.p(s, 0, h), f.p(s, -depth, hl), f.p(s, -depth, hl - th), f.p(s, 0, h - th), f.dir(s === s0 ? -1 : 1, 0, 0), '#3a3028', NM.wood)
  // 軒先の瓦の縁（丸い軒瓦の帯）
  b.beam(f.p(s0, -depth - 0.03, hl + 0.02), f.p(s1, -depth - 0.03, hl + 0.02), 0.08, color, mat, aux, 0.08)
  // 腕木（下から支える木）
  const n = Math.max(2, Math.round((s1 - s0) / 1.8) + 1)
  for (let i = 0; i < n; i++) {
    const s = s0 + 0.12 + (i / (n - 1)) * (s1 - s0 - 0.24)
    b.beam(f.p(s, 0.02, h - 0.35), f.p(s, -depth * 0.85, hl - th - 0.02), 0.07, '#3d3128', NM.wood, 0, 0.1)
  }
  const P = (s: number, t: number, hh: number) => [...f.plan(s, t), f.z0 + hh]
  k.mass.roofQuad(P(s0, 0, h), P(s1, 0, h), P(s1, -depth, hl), P(s0, -depth, hl))
}

/** 袖看板（壁から直角に出る板。両面に字）。s = 壁の位置、h = 下端、w = 出、ht = 高さ */
export function bladeSign(k: Kit, f: Frame, s: number, h: number, w: number, ht: number, style: Omit<SignStyle, 'w' | 'h'>, frameColor = '#2a2522', mode = 2) {
  const b = k.solid
  const t0 = -0.15
  const t1 = t0 - w
  fbox(b, f, s - 0.04, s + 0.04, t1 - 0.04, t0 + 0.04, h - 0.04, h + ht + 0.04, frameColor, NM.paint, 0.3)
  b.beam(f.p(s, 0.02, h + ht + 0.1), f.p(s, t1, h + ht + 0.1), 0.04, '#222', NM.iron)
  b.beam(f.p(s, 0.02, h + 0.1), f.p(s, t0, h + 0.1), 0.04, '#222', NM.iron)
  // 両面（面に直角の向きの面: 局所の s が一定の面）
  const A = (t: number, hh: number, side: number): V3 => f.p(s + side * 0.045, t, hh)
  const reg = signAtlasRegion(style, w, ht)
  if (reg) {
    // +s の面（右から見る）: 左下 = 外の端
    k.signs.quad(A(t0, h, 1), A(t1, h, 1), A(t1, h + ht, 1), A(t0, h + ht, 1), reg, mode)
    k.signs.quad(A(t1, h, -1), A(t0, h, -1), A(t0, h + ht, -1), A(t1, h + ht, -1), reg, mode)
  }
}

function signAtlasRegion(style: Omit<SignStyle, 'w' | 'h'>, w: number, h: number) {
  return signAtlas.region({ ...style, w, h } as SignStyle)
}

/** 丸い吊り看板（腕から下がる。両面） */
export function hangingRound(k: Kit, f: Frame, s: number, h: number, d: number, style: Omit<SignStyle, 'w' | 'h'>, mode = 2) {
  const b = k.solid
  b.beam(f.p(s, 0.02, h + d + 0.15), f.p(s, -d - 0.25, h + d + 0.15), 0.035, '#1e1e1e', NM.iron)
  b.beam(f.p(s, 0.02, h + d - 0.2), f.p(s, -0.5, h + d + 0.13), 0.025, '#1e1e1e', NM.iron)
  const c = -0.2 - d / 2
  for (const dy of [-0.06, 0.06]) b.beam(f.p(s, c + dy * 3, h + d + 0.13), f.p(s, c + dy * 3, h + d), 0.012, '#1e1e1e', NM.iron)
  const reg = signAtlasRegion({ ...style, shape: style.shape ?? 'round' }, d, d)
  if (reg) {
    const A = (t: number, hh: number, side: number): V3 => f.p(s + side * 0.02, t, hh)
    k.signs.quad(A(c + d / 2, h, 1), A(c - d / 2, h, 1), A(c - d / 2, h + d, 1), A(c + d / 2, h + d, 1), reg, mode)
    k.signs.quad(A(c - d / 2, h, -1), A(c + d / 2, h, -1), A(c + d / 2, h + d, -1), A(c - d / 2, h + d, -1), reg, mode)
  }
}

/** 暖簾（入口の上から下がる布。字入り）。s0〜s1・上端 h・丈 len */
export function noren(k: Kit, f: Frame, s0: number, s1: number, h: number, len: number, style: Omit<SignStyle, 'w' | 'h'>) {
  k.solid.beam(f.p(s0 - 0.1, -0.12, h + 0.03), f.p(s1 + 0.1, -0.12, h + 0.03), 0.04, '#3a2c20', NM.wood)
  k.sign(f, s0, h - len, s1 - s0, len, -0.1, { ...style, finish: 'noren' }, 2)
}

/** 手すり（面 f の t の位置、s0〜s1、高さ h0 から ht。柱の間隔 every） */
export function railing(k: Kit, f: Frame, s0: number, s1: number, t: number, h0: number, ht: number, color: string, mat: number = NM.iron, every = 1.2, balusters = 0.12) {
  const b = k.solid
  b.beam(f.p(s0, t, h0 + ht), f.p(s1, t, h0 + ht), 0.05, color, mat, 0.3, 0.05)
  b.beam(f.p(s0, t, h0 + 0.1), f.p(s1, t, h0 + 0.1), 0.035, color, mat, 0.3, 0.035)
  const n = Math.max(1, Math.round((s1 - s0) / every))
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n
    b.beam(f.p(s, t, h0), f.p(s, t, h0 + ht), 0.05, color, mat, 0.3)
  }
  if (balusters > 0) {
    const m = Math.round((s1 - s0) / balusters)
    for (let i = 1; i < m; i++) {
      const s = s0 + ((s1 - s0) * i) / m
      b.beam(f.p(s, t, h0 + 0.1), f.p(s, t, h0 + ht), 0.018, color, mat, 0.3)
    }
  }
}

/** ベランダ（床の板と手すり）: s0〜s1、出 depth、床の高さ h */
export function balcony(k: Kit, f: Frame, s0: number, s1: number, depth: number, h: number, floorColor: string, railColor: string, railMat: number = NM.iron) {
  fbox(k.solid, f, s0, s1, -depth, 0.02, h - 0.16, h, floorColor, NM.concrete)
  railing(k, f, s0, s1, -depth + 0.04, h, 1.0, railColor, railMat)
  // 横の手すり
  for (const s of [s0 + 0.04, s1 - 0.04]) {
    const ff = f
    k.solid.beam(ff.p(s, -depth + 0.04, h + 1.0), ff.p(s, 0, h + 1.0), 0.05, railColor, railMat, 0.3, 0.05)
    k.solid.beam(ff.p(s, -depth / 2, h), ff.p(s, -depth / 2, h + 1.0), 0.04, railColor, railMat, 0.3)
  }
}

/** 円柱（面 f の (s, t) に、h0 から h1。台と柱頭つき） */
export function column(k: Kit, f: Frame, s: number, t: number, h0: number, h1: number, r: number, color: string, mat: number, capital = true) {
  const p = f.p(s, t, h0)
  k.solid.cylinder(p, r, h1 - h0, 14, color, mat, 0, false)
  if (capital) {
    fbox(k.solid, f, s - r * 1.4, s + r * 1.4, t - r * 1.4, t + r * 1.4, h0, h0 + 0.25, color, mat)
    fbox(k.solid, f, s - r * 1.5, s + r * 1.5, t - r * 1.5, t + r * 1.5, h1 - 0.22, h1, color, mat)
  }
}

/** 煙突（平面の中心・大きさ・下端と上端の標高） */
export function chimney(k: Kit, x: number, y: number, w: number, d: number, z0: number, z1: number, rot: number, color: string, mat: number = NM.brick) {
  const b = k.solid
  b.box([x, (z0 + z1) / 2 - LAB, -y], [w, z1 - z0, d], color, mat, 0, rot)
  b.box([x, z1 - LAB + 0.08, -y], [w + 0.12, 0.16, d + 0.12], '#6f6a62', NM.concrete, 0, rot)
  b.box([x, z1 - LAB + 0.2, -y], [w * 0.5, 0.2, d * 0.5], '#2a2826', NM.dark, 0, rot)
  k.mass.prism(
    [
      [x - w / 2, y - d / 2],
      [x + w / 2, y - d / 2],
      [x + w / 2, y + d / 2],
      [x - w / 2, y + d / 2],
    ],
    z0,
    z1,
    z0,
    0,
  )
}

/** 植木鉢（面 f の (s, t) の地面 h に）と、葉 */
export function pot(k: Kit, f: Frame, s: number, t: number, h: number, size = 0.4, color = '#8a4b32', leaf = '#3f6a2e') {
  const p = f.p(s, t, h)
  k.solid.cylinder(p, size * 0.5, size * 0.8, 10, color, NM.plaster, 0, true, size * 0.6)
  k.solid.box([p[0], p[1] + size * 0.8 + size * 0.45, p[2]], [size * 1.2, size * 0.9, size * 1.2], leaf, NM.leaf, 0, k.rnd() * 3)
}

/** 樽（面 f の (s, t)、地面 h） */
export function barrel(k: Kit, f: Frame, s: number, t: number, h: number) {
  const p = f.p(s, t, h)
  k.solid.cylinder(p, 0.3, 0.85, 12, '#6b4a2e', NM.wood, 1, true, 0.3)
  for (const y of [0.15, 0.7]) k.solid.cylinder([p[0], p[1] + y, p[2]], 0.315, 0.05, 12, '#2a2a28', NM.iron, 0, false)
}

/** 縦の幟・旗（ポールと布）。面 f の (s, t)、地面 h */
export function banner(k: Kit, f: Frame, s: number, t: number, h: number, color: string, text: string, ht = 2.4) {
  const b = k.solid
  b.beam(f.p(s, t, h), f.p(s, t, h + ht + 0.3), 0.04, '#d8d4c8', NM.paint, 0.4)
  b.beam(f.p(s, t, h + ht + 0.25), f.p(s + 0.55, t, h + ht + 0.25), 0.03, '#d8d4c8', NM.paint, 0.4)
  k.sign(f, s + 0.03, h + 0.9, 0.5, ht - 0.65, t - 0.02, { text, fg: '#ffffff', bg: color, vertical: true, font: 'sans', bold: true }, 0)
}

/** 室外機（面 f の (s, t)、地面 h。壁の前の箱） */
export function acUnit(k: Kit, f: Frame, s: number, t: number, h: number) {
  fbox(k.solid, f, s - 0.4, s + 0.4, t - 0.3, t, h, h + 0.62, '#d7d6d0', NM.paint, 0.4)
  fbox(k.solid, f, s - 0.3, s + 0.16, t - 0.31, t - 0.29, h + 0.1, h + 0.52, '#2a2a2a', NM.dark)
}

/** 格子（縦の細い桟の並び。開口 o の前、壁から t の位置）。桟の幅 bw・間隔 pitch */
export function latticeSlats(k: Kit, f: Frame, s0: number, s1: number, h0: number, h1: number, t: number, color: string, pitch = 0.1, bw = 0.035, depth = 0.04) {
  const b = k.solid
  const n = Math.max(2, Math.round((s1 - s0) / pitch))
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n
    fbox(b, f, s - bw / 2, s + bw / 2, t - depth, t, h0, h1, color, NM.wood, 1)
  }
  fbox(b, f, s0 - 0.03, s1 + 0.03, t - depth - 0.01, t, h1 - 0.05, h1 + 0.03, color, NM.wood)
  fbox(b, f, s0 - 0.03, s1 + 0.03, t - depth - 0.01, t, h0 - 0.03, h0 + 0.05, color, NM.wood)
  if (h1 - h0 > 1.2) fbox(b, f, s0, s1, t - depth - 0.005, t, (h0 + h1) / 2 - 0.02, (h0 + h1) / 2 + 0.02, color, NM.wood)
}
