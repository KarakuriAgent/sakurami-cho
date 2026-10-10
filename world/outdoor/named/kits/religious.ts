import * as THREE from 'three'
import { ROOF } from '../../town/buildingKit'
import { Frame, rectFrame, type V3 } from '../frame'
import { fbox, gableRoof, irimoyaRoof, type Kit, type Opening, spire, steps, wallLamp } from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import { buildBody, windowTrims } from '../shell'
import { hexesIn } from '../shell'
import { penRoof, railing } from '../parts'
import { buildPart } from './common'

/**
 * 社寺と教会の組み立ての型: 神社（流造の社殿・朱の鳥居・石灯籠・狛犬・注連縄）、寺（入母屋の本堂・縁と高欄・香炉）、
 * 運河の大聖堂（切妻の身廊・控え壁・尖頭アーチのステンドグラス・ばら窓・尖塔）
 */

const LAB = 116

/** 鳥居（面 f の (s, t) を中心に、幅 w・高さ h。朱か白木） */
export function torii(k: Kit, f: Frame, s: number, t: number, h0: number, w: number, h: number, color: string) {
  const b = k.solid
  const mat = color === '#d8c7a3' ? NM.wood : NM.lacquer
  const r = Math.max(0.12, w * 0.06)
  for (const ds of [-w / 2, w / 2]) {
    const p = f.p(s + ds, t, h0)
    b.cylinder(p, r, h, 12, color, mat, 0.6, false, r * 0.9)
    b.cylinder([p[0], p[1] - 0.05, p[2]], r * 1.35, 0.4, 12, '#2a2a28', NM.paint, 0.4, true)
  }
  // 貫（下の横木）・笠木と島木（上の横木。両端が少し反る）・額束
  fbox(b, f, s - w / 2 - r * 1.2, s + w / 2 + r * 1.2, t - r * 0.7, t + r * 0.7, h0 + h * 0.72, h0 + h * 0.72 + r * 1.3, color, mat, 0.6)
  const kas = h0 + h
  const ext = w * 0.22
  b.beam(f.p(s - w / 2 - ext, t, kas + 0.18), f.p(s, t, kas + 0.05), r * 1.6, color, mat, 0.6, r * 1.3)
  b.beam(f.p(s, t, kas + 0.05), f.p(s + w / 2 + ext, t, kas + 0.18), r * 1.6, color, mat, 0.6, r * 1.3)
  b.beam(f.p(s - w / 2 - ext - 0.05, t, kas + 0.36), f.p(s, t, kas + 0.24), r * 1.8, '#1e1e1c', NM.paint, 0.3, r * 1.0)
  b.beam(f.p(s, t, kas + 0.24), f.p(s + w / 2 + ext + 0.05, t, kas + 0.36), r * 1.8, '#1e1e1c', NM.paint, 0.3, r * 1.0)
  fbox(b, f, s - r * 0.8, s + r * 0.8, t - r * 0.5, t + r * 0.5, h0 + h * 0.72 + r * 1.3, kas - 0.05, color, mat, 0.6)
  k.mass.prism(
    [f.plan(s - w / 2 - 0.2, t - 0.2), f.plan(s + w / 2 + 0.2, t - 0.2), f.plan(s + w / 2 + 0.2, t + 0.2), f.plan(s - w / 2 - 0.2, t + 0.2)],
    f.z0 + h0 + h - 0.3,
    f.z0 + h0 + h + 0.3,
    f.z0,
    0,
  )
}

/** 石灯籠（面 f の (s, t)、地面 h0） */
export function stoneLantern(k: Kit, f: Frame, s: number, t: number, h0: number, size = 1) {
  const b = k.solid
  const p = f.p(s, t, h0)
  const c = '#8f8a80'
  b.box([p[0], p[1] + 0.15 * size, p[2]], [0.6 * size, 0.3 * size, 0.6 * size], c, NM.stone, 0.3, f.yaw)
  b.cylinder([p[0], p[1] + 0.3 * size, p[2]], 0.12 * size, 0.8 * size, 8, c, NM.stone, 0.3)
  b.box([p[0], p[1] + 1.15 * size, p[2]], [0.5 * size, 0.12 * size, 0.5 * size], c, NM.stone, 0.3, f.yaw)
  k.glow.box([p[0], p[1] + 1.4 * size, p[2]], [0.3 * size, 0.32 * size, 0.3 * size], '#ffd9a0', 0, 1.4, f.yaw)
  b.box([p[0], p[1] + 1.62 * size, p[2]], [0.62 * size, 0.1 * size, 0.62 * size], c, NM.stone, 0.3, f.yaw)
  b.cylinder([p[0], p[1] + 1.67 * size, p[2]], 0.38 * size, 0.2 * size, 6, c, NM.stone, 0.3, true, 0.04)
  k.lamp([p[0], p[1] + 1.4 * size, p[2]], 4, '#ffb870', 0.8, 0.3, 3)
}

/** 狛犬・狐（石の台の上の座った形を箱で） */
function guardian(k: Kit, f: Frame, s: number, t: number, h0: number, fox: boolean) {
  const b = k.solid
  fbox(b, f, s - 0.35, s + 0.35, t - 0.35, t + 0.35, h0, h0 + 0.7, '#8f8a80', NM.stone, 0.3)
  const c = fox ? '#e8e2d4' : '#9a948a'
  fbox(b, f, s - 0.22, s + 0.22, t - 0.3, t + 0.25, h0 + 0.7, h0 + 1.15, c, NM.stone, 0.3)
  fbox(b, f, s - 0.16, s + 0.16, t - 0.32, t - 0.02, h0 + 1.1, h0 + 1.42, c, NM.stone, 0.3)
  if (fox) {
    fbox(b, f, s - 0.14, s - 0.06, t - 0.2, t - 0.12, h0 + 1.42, h0 + 1.56, c, NM.stone)
    fbox(b, f, s + 0.06, s + 0.14, t - 0.2, t - 0.12, h0 + 1.42, h0 + 1.56, c, NM.stone)
    fbox(b, f, s - 0.12, s + 0.12, t - 0.34, t - 0.26, h0 + 1.0, h0 + 1.14, '#c0392b', NM.cloth)
  }
}

/**
 * 神社: 石の基壇の上の流造の社殿（朱か白木の柱・格子の扉・銅板の切妻と、前へ長く延びる向拝）・鳥居・石灯籠・狛犬（稲荷は狐）・
 * 注連縄・賽銭箱。大きい社（汐見明神社）は入母屋の拝殿
 */
export function shrine(k: Kit) {
  const rec = k.rec
  const hexes = hexesIn(rec.wallText)
  const red = (rec.wallText ?? '').includes('朱')
  const pillar = red ? (hexes.find((h) => h === '#c0392b') ?? '#b8352a') : '#d8c7a3'
  const pillarMat = red ? NM.lacquer : NM.wood
  const white = '#e9e2d0'
  const rf = rectFrame(rec.ring, rec.front, rec.z)
  const { frame: f, W, D } = rf
  const z = rec.z
  const big = W * D > 80
  const base = big ? 0.9 : 0.5
  // 大きな社（拝殿）は、データの軒の高さを屋根の中ほどと読み、壁を低く屋根を大きく見せる（§7）
  const eave = big ? Math.min(rec.height ?? 5, base + 4.4) : (rec.height ?? 3)
  const ridge = rec.roofHeight ?? eave + 1.4
  const b = k.solid
  k.mass.st = { wall: [216, 199, 163], facade: 0, roof: [79, 143, 122], roofKind: big ? ROOF.irimoya : ROOF.gable, use: 9, flags: 1, seed: k.seed, style: 1, floors: 1 }
  // 基壇（石）
  fbox(b, f, -0.4, W + 0.4, -0.4, D + 0.4, Math.min(rec.gLow, z) - z - 0.5, base, '#9a948a', NM.stone, 0.4)
  const fz = f.shift(0, 0, base)
  // 壁（白い板・漆喰）と柱
  const wallTop = eave - base
  const fr: Opening = { s: W * 0.15, h: 0.1, w: W * 0.7, ht: Math.min(2.2, wallTop - 0.5), depth: 0.12, fill: 'door', door: { kind: 'lattice', color: pillar, glass: { kind: GLASS.shoji, cls: LIGHT_CLASS.none } } }
  const ring = [fz.plan(0, 0), fz.plan(W, 0), fz.plan(W, D), fz.plan(0, D)]
  buildBody(k, { ring, z: z + base, bottom: -0.05, floors: 1, floorH: wallTop, top: wallTop, wall: { color: white, mat: big ? NM.plaster : NM.wood }, faces: [{ win: null, bay: 3, openings: [fr], minLen: 0 }, null, null, null], frontEdge: 0 })
  for (const s of [0, W])
    for (const t of [0, D]) {
      const p = fz.p(s, t, 0)
      b.cylinder(p, big ? 0.18 : 0.1, wallTop, 10, pillar, pillarMat, 0.5, false)
    }
  // 長押（柱の上の横木）と縁・高欄
  for (const [s0, s1, t0, t1] of [
    [0, W, -0.06, 0.06],
    [0, W, D - 0.06, D + 0.06],
    [-0.06, 0.06, 0, D],
    [W - 0.06, W + 0.06, 0, D],
  ])
    fbox(b, fz, s0, s1, t0, t1, wallTop - 0.3, wallTop, pillar, pillarMat, 0.5)
  fbox(b, fz, -0.6, W + 0.6, -0.6, D + 0.6, -0.06, 0.02, '#a08a68', NM.wood)
  railing(k, fz, -0.55, W + 0.55, -0.55, 0.02, 0.5, pillar, pillarMat, 0.9, 0)
  // 屋根: 銅板の切妻（大きい社は入母屋）と、前へ延びる向拝（流造）
  const roofSt = { color: '#5b9a84', mat: NM.copper, aux: 0.3, eave: big ? 1.0 : 0.6, verge: big ? 0.8 : 0.45, thick: big ? 0.3 : 0.18, soffit: '#6b5640', fascia: '#e9e2d0', gable: { color: white, mat: NM.wood } }
  if (big) irimoyaRoof(k, fz, W, D, wallTop, ridge - base, roofSt, 0.5)
  else gableRoof(k, fz, W, D, wallTop, ridge - base, roofSt)
  penRoof(k, fz, -0.3, W + 0.3, wallTop - 0.05, big ? 2.8 : 1.6, '#5b9a84', NM.copper, 0.36, 0.3)
  for (const s of [0.1, W - 0.1]) {
    const p = fz.p(s, big ? -2.6 : -1.45, -base)
    b.cylinder(p, big ? 0.15 : 0.08, wallTop + base - (big ? 1.0 : 0.6), 10, pillar, pillarMat, 0.5, false)
  }
  // 千木と鰹木（棟の飾り。小さな社）
  if (!big) {
    for (let i = 0; i < 3; i++) {
      const s = W * (0.25 + i * 0.25)
      const p = fz.p(s, D / 2, ridge - base + 0.18)
      b.cylinder([p[0], p[1] - 0.06, p[2]], 0.07, 0.12, 8, '#c9a046', NM.gold, 0, true)
    }
    for (const s of [-0.2, W + 0.2]) {
      b.beam(fz.p(s, D / 2 - 0.4, ridge - base - 0.2), fz.p(s, D / 2 + 0.25, ridge - base + 0.55), 0.06, '#5b9a84', NM.copper, 0.3, 0.12)
      b.beam(fz.p(s, D / 2 + 0.4, ridge - base - 0.2), fz.p(s, D / 2 - 0.25, ridge - base + 0.55), 0.06, '#5b9a84', NM.copper, 0.3, 0.12)
    }
  }
  // 階（前の木の段）・賽銭箱・注連縄と紙垂・鈴の綱
  steps(k, fz, W * 0.3, W * 0.7, Math.max(2, Math.round(base / 0.18)), base / Math.max(2, Math.round(base / 0.18)), 0.26, '#8a6a48', NM.wood)
  const sbox = fz.p(W / 2, -0.9 - (big ? 1.4 : 0.5), -base)
  b.box([sbox[0], sbox[1] + 0.35, sbox[2]], [big ? 1.4 : 0.7, 0.7, 0.5], '#5a3a26', NM.wood, 0, f.yaw)
  const rope = (s0: number, s1: number, t: number, h: number, r: number) => {
    const n = 10
    for (let i = 0; i < n; i++) {
      const u0 = i / n
      const u1 = (i + 1) / n
      const sag = (u: number) => -Math.sin(u * Math.PI) * 0.18
      b.beam(fz.p(s0 + (s1 - s0) * u0, t, h + sag(u0)), fz.p(s0 + (s1 - s0) * u1, t, h + sag(u1)), r, '#d9c79a', NM.cloth, 0, r)
    }
    for (let i = 1; i < 4; i++) {
      const s = s0 + ((s1 - s0) * i) / 4
      fbox(b, fz, s - 0.06, s + 0.06, t - 0.01, t + 0.01, h - 0.55, h - 0.12, '#f6f4ee', NM.cloth)
    }
  }
  rope(0.1, W - 0.1, -0.15, wallTop - 0.45, big ? 0.16 : 0.08)
  // 鳥居・灯籠・狛犬（狐）: 社の前の参道
  const front = big ? 9 : 3.4
  // 参道の地面（社の床より低い所まで）
  const gz = (_t: number) => Math.min(0, rec.gLow - z)
  const fox = (rec.name ?? '').includes('稲荷')
  torii(k, f, W / 2, -front, gz(front), big ? 4.2 : 2.0, big ? 4.6 : 2.6, red || fox ? '#c0392b' : '#d8c7a3')
  if (fox) {
    // 稲荷の小さな鳥居の連なり
    for (let i = 1; i <= 2; i++) torii(k, f, W / 2, -front + i * 0.9, gz(front), 1.7, 2.3, '#c0392b')
  }
  stoneLantern(k, f, W / 2 - (big ? 3.0 : 1.4), -front * 0.5, gz(front), big ? 1.2 : 0.8)
  stoneLantern(k, f, W / 2 + (big ? 3.0 : 1.4), -front * 0.5, gz(front), big ? 1.2 : 0.8)
  guardian(k, f, W / 2 - (big ? 2.0 : 1.0), -front * 0.28, gz(front), fox)
  guardian(k, f, W / 2 + (big ? 2.0 : 1.0), -front * 0.28, gz(front), fox)
  // 社の名の額（鳥居の上）
  const name = rec.name.replace(/（.*）/, '')
  k.sign(f, W / 2 - 0.22 * (big ? 1.6 : 1), gz(front) + (big ? 4.6 : 2.6) * 0.78, 0.44 * (big ? 1.6 : 1), 0.7 * (big ? 1.6 : 1), -front - 0.12, { text: name.replace(/神社|稲荷|明神社|明神 奥宮/, (m) => m), fg: '#e8d29a', bg: '#1e1e1c', border: '#c9a046', vertical: true, font: 'serif', bold: true }, 0)
  void wallLamp
}

/** 寺の本堂（入母屋の銀鼠の瓦・深い軒・焦げ茶の柱と白壁・縁と高欄・正面の格子戸・石段・香炉と灯籠） */
export function temple(k: Kit) {
  const rec = k.rec
  const rf = rectFrame(rec.ring, rec.front, rec.z)
  const { frame: f, W, D } = rf
  const z = rec.z
  const base = 1.0
  const eave = (rec.height ?? 7) - base
  const ridge = (rec.roofHeight ?? 12) - base
  const b = k.solid
  const wood = '#4a3426'
  k.mass.st = { wall: [233, 227, 214], facade: 1, roof: [125, 128, 133], roofKind: ROOF.irimoya, use: 9, flags: 1, seed: k.seed, style: 1, floors: 1 }
  fbox(b, f, -1.2, W + 1.2, -1.2, D + 1.2, Math.min(rec.gLow, z) - z - 0.5, base, '#8f8a80', NM.stone, 0.45)
  const fz = f.shift(0, 0, base)
  const ring = [fz.plan(0, 0), fz.plan(W, 0), fz.plan(W, D), fz.plan(0, D)]
  const nb = Math.max(3, Math.round(W / 3.4))
  const bw = W / nb
  const doors: Opening[] = []
  for (let i = 1; i < nb - 1; i++) doors.push({ s: i * bw + 0.15, h: 0.1, w: bw - 0.3, ht: Math.min(3.2, eave - 1.2), depth: 0.18, fill: 'door', door: { kind: 'lattice', color: wood, glass: { kind: GLASS.shoji, cls: LIGHT_CLASS.window } } })
  buildBody(k, {
    ring,
    z: z + base,
    bottom: -0.05,
    floors: 1,
    floorH: eave,
    top: eave,
    wall: { color: '#ebe5d6', mat: NM.plaster },
    wallLower: { color: wood, mat: NM.boardV, aux: 0.24, h: 0.9 },
    faces: [{ win: null, bay: 3, openings: doors, minLen: 0 }, { win: { w: 1.6, ht: 1.0, sill: 1.6, glass: { kind: GLASS.shoji, cls: LIGHT_CLASS.window, cols: 1, rows: 1, bar: 0 }, depth: 0.1 }, bay: 3.4 }, null, { win: { w: 1.6, ht: 1.0, sill: 1.6, glass: { kind: GLASS.shoji, cls: LIGHT_CLASS.window, cols: 1, rows: 1, bar: 0 }, depth: 0.1 }, bay: 3.4 }],
    frontEdge: 0,
  })
  // 柱・長押・貫
  for (let i = 0; i <= nb; i++) for (const t of [0, D]) b.cylinder(fz.p(i * bw, t, 0), 0.2, eave, 10, wood, NM.wood, 0, false)
  for (let i = 0; i <= Math.round(D / 3.4); i++) for (const s of [0, W]) b.cylinder(fz.p(s, (i * D) / Math.round(D / 3.4), 0), 0.2, eave, 10, wood, NM.wood, 0, false)
  for (const h of [eave - 0.35, 2.6]) {
    fbox(b, fz, -0.08, W + 0.08, -0.08, 0.08, h, h + 0.22, wood, NM.wood)
    fbox(b, fz, -0.08, W + 0.08, D - 0.08, D + 0.08, h, h + 0.22, wood, NM.wood)
  }
  // 縁と高欄
  fbox(b, fz, -1.2, W + 1.2, -1.2, D + 1.2, -0.08, 0.02, '#7a5e42', NM.wood)
  railing(k, fz, -1.15, W + 1.15, -1.15, 0.02, 0.7, wood, NM.wood, 1.5, 0)
  // 屋根（入母屋・深い軒）
  irimoyaRoof(k, fz, W, D, eave, ridge, { color: '#6f7378', mat: NM.kawara, eave: 1.6, verge: 1.0, thick: 0.45, soffit: '#5a4232', fascia: '#3a2a1e', gable: { color: '#e8e2d2', mat: NM.plaster } }, 0.5)
  // 正面の石段・香炉・灯籠
  steps(k, fz, W / 2 - 2.5, W / 2 + 2.5, 6, base / 6 + 0.02, 0.32, '#9a948a')
  const ins = f.p(W / 2, -6, Math.min(0, rec.gLow - z))
  b.cylinder(ins, 0.7, 0.9, 12, '#5a4a36', NM.metalRoof, 0, true, 0.55)
  b.box([ins[0], ins[1] + 1.15, ins[2]], [0.9, 0.5, 0.9], '#4a3a28', NM.metalRoof, 0, f.yaw)
  stoneLantern(k, f, W / 2 - 4, -5, Math.min(0, rec.gLow - z), 1.3)
  stoneLantern(k, f, W / 2 + 4, -5, Math.min(0, rec.gLow - z), 1.3)
  // 扁額
  k.sign(fz, W / 2 - 0.9, eave - 0.3, 1.8, 0.8, -0.3, { text: '鐘ヶ丘', fg: '#e8d29a', bg: '#2a1f17', border: '#8a6a3a', font: 'serif', bold: true, finish: 'wood' }, 0)
}

/** 運河の大聖堂（灰白の石の身廊・控え壁・尖頭アーチのステンドグラス・正面のばら窓と大扉・尖塔） */
export function church(k: Kit) {
  const rec = k.rec
  const rf = rectFrame(rec.ring, rec.front, rec.z)
  const { frame: f, W, D } = rf
  const z = rec.z
  const eave = rec.height ?? 14.6
  const stone = '#d6d2c8'
  const trim = '#bfb9ad'
  const b = k.solid
  k.mass.st = { wall: [214, 210, 200], facade: 2, roof: [95, 102, 112], roofKind: ROOF.gable, use: 9, flags: 1, seed: k.seed, style: 2, floors: 1 }
  // 身廊は奥へ長い（正面 = 狭い辺）。窓は横の面に尖頭アーチ、正面にばら窓と大扉
  const sideWin = { w: 2.0, ht: 8.0, sill: 3.0, shape: 'pointed' as const, depth: 0.6, glass: { kind: GLASS.stained, cls: LIGHT_CLASS.night, cols: 3, rows: 6, bar: 0.06, frame: '#3a3a3a', depth: 20 }, lintel: { color: trim, mat: NM.stone } }
  const portal: Opening = { s: W / 2 - 2.0, h: 0, w: 4.0, ht: 7.0, shape: 'pointed', depth: 0.9, fill: 'door', door: { kind: 'double', color: '#4a3020', transom: 2.2 } }
  const rose: Opening = { s: W / 2 - 3.2, h: 8.0, w: 6.4, ht: 6.4, shape: 'round', depth: 0.6, glass: { kind: GLASS.stained, cls: LIGHT_CLASS.night, cols: 8, rows: 8, bar: 0.08, frame: '#3a3a3a', depth: 30 } }
  const faces = buildBody(k, {
    ring: rec.ring.length === 4 ? [rf.frame.plan(0, 0), rf.frame.plan(W, 0), rf.frame.plan(W, D), rf.frame.plan(0, D)] : rec.ring,
    z,
    bottom: Math.min(rec.gLow, z) - z - 0.4,
    floors: 1,
    floorH: eave,
    top: eave,
    wall: { color: stone, mat: NM.stone, aux: 0.6 },
    plinth: { ht: 1.0, color: '#a8a296', mat: NM.stone, aux: 0.5, proj: 0.15 },
    cornice: { ht: 0.6, proj: 0.25, color: trim, mat: NM.stone },
    faces: [
      { win: null, bay: 4, openings: [portal, rose], minLen: 0 },
      { win: sideWin, bay: 4.4 },
      { win: { ...sideWin, w: 2.4, ht: 7 }, bay: 6 },
      { win: sideWin, bay: 4.4 },
    ],
    frontEdge: 0,
  })
  windowTrims(k, faces[0].f, portal, { w: 4, ht: 7, sill: 0, shape: 'pointed', lintel: { color: trim, mat: NM.stone } })
  windowTrims(k, faces[0].f, rose, { w: 6.4, ht: 6.4, sill: 8, shape: 'round', lintel: { color: trim, mat: NM.stone } })
  // 控え壁（横の面の窓のあいだ）
  for (const i of [1, 3]) {
    const fc = faces[i]
    const n = Math.max(1, Math.round(fc.L / 4.4))
    for (let j = 0; j <= n; j++) {
      const s = (j * fc.L) / n
      fbox(b, fc.f, s - 0.45, s + 0.45, -1.4, 0.02, -0.5, eave - 3.5, trim, NM.stone, 0.5)
      b.quad(fc.f.p(s - 0.45, -1.4, eave - 3.5), fc.f.p(s + 0.45, -1.4, eave - 3.5), fc.f.p(s + 0.45, 0, eave - 0.6), fc.f.p(s - 0.45, 0, eave - 0.6), trim, NM.stone, 0)
      // 小尖塔
      spire(k, ...fc.f.plan(s, -0.9), z + eave - 0.2, 0.3, 2.0, 4, '#8a8f96', NM.slate, 0)
    }
  }
  // 夜の投光器（正面と尖塔）
  for (const s of [W * 0.2, W * 0.8]) k.flood(faces[0].f.p(s, -6, 0), 30, '#ffe2bc', 1.6)
  // 正面の破風の三角の縁と頂の十字
  const ridge = eave + W * 0.5
  gableRoof(k, rf.frame.turnRight(W), D, W, eave, ridge, { color: '#5f6670', mat: NM.slate, eave: 0.4, verge: 0.35, thick: 0.3, soffit: '#8a8478', fascia: trim, gable: { color: stone, mat: NM.stone, aux: 0.6 } })
  const cp = f.p(W / 2, -0.2, ridge + 0.3)
  b.beam(cp, [cp[0], cp[1] + 2.2, cp[2]], 0.18, '#c9a046', NM.gold)
  b.beam([cp[0], cp[1] + 1.5, cp[2]].map((v, i) => v + [f.dir(-0.6, 0, 0)[0], 0, f.dir(-0.6, 0, 0)[2]][i]) as V3, [cp[0], cp[1] + 1.5, cp[2]].map((v, i) => v + [f.dir(0.6, 0, 0)[0], 0, f.dir(0.6, 0, 0)[2]][i]) as V3, 0.16, '#c9a046', NM.gold)
  // 尖塔（建物の部分）: 角の塔（鐘の窓）と高いスレートの尖塔
  for (const p of rec.parts) {
    if (!(p.name ?? '').includes('尖塔')) {
      buildPart(k, p, { color: stone, mat: NM.stone, aux: 0.6 })
      continue
    }
    const pr = p.ring
    const pz = p.z ?? z
    const H = p.height ?? 48
    const towerTop = H * 0.5
    const pf = rectFrame(pr, rec.front, pz)
    buildBody(k, {
      ring: [pf.frame.plan(0, 0), pf.frame.plan(pf.W, 0), pf.frame.plan(pf.W, pf.D), pf.frame.plan(0, pf.D)],
      z: pz,
      bottom: -0.5,
      floors: 1,
      floorH: towerTop,
      top: towerTop,
      wall: { color: stone, mat: NM.stone, aux: 0.6 },
      plinth: { ht: 1.0, color: '#a8a296', mat: NM.stone, aux: 0.5, proj: 0.15 },
      cornice: { ht: 0.8, proj: 0.3, color: trim, mat: NM.stone },
      bands: { hs: [eave, towerTop - 6], ht: 0.4, proj: 0.15, color: trim, mat: NM.stone },
      faces: [0, 1, 2, 3].map(() => ({ win: { w: 1.4, ht: 4.4, sill: towerTop - 5.6, shape: 'pointed' as const, depth: 0.5, glass: { kind: GLASS.dark, cls: LIGHT_CLASS.none, cols: 2, rows: 4, bar: 0.08, frame: '#3a3a3a' }, lintel: { color: trim, mat: NM.stone } }, bay: pf.W, minLen: 0 })),
      frontEdge: 0,
    })
    const c = pf.frame.plan(pf.W / 2, pf.D / 2)
    spire(k, c[0], c[1], pz + towerTop + 0.8, Math.min(pf.W, pf.D) * 0.62, H - towerTop - 0.8 - 2.5, 8, '#5f6670', NM.slate, 0, Math.PI / 8)
    const top = pz + H - 2.5
    b.beam([c[0], top - LAB, -c[1]], [c[0], top + 2.5 - LAB, -c[1]], 0.14, '#c9a046', NM.gold)
    // 塔の四隅の小尖塔
    for (const [s, t] of [
      [0.3, 0.3],
      [pf.W - 0.3, 0.3],
      [pf.W - 0.3, pf.D - 0.3],
      [0.3, pf.D - 0.3],
    ]) {
      const q = pf.frame.plan(s, t)
      spire(k, q[0], q[1], pz + towerTop + 0.8, 0.45, 3.5, 4, '#8a8f96', NM.slate, 0, Math.PI / 4)
    }
  }
  void THREE
}
