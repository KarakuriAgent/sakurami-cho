import * as THREE from 'three'
import { ROOF } from '../../town/buildingKit'
import type { P2 } from '../../town/townData'
import { Frame, isRect, rectFrame, ringCenter } from '../frame'
import { canopy, fbox, flatRoof, gableRoof, type GlassSpec, type Kit, type Opening, spire, steps, wallLamp } from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import { acUnit, banner, column, pot, railing } from '../parts'
import { buildBody, cssOf, frontEdgeOf, hexesIn, type WinSpec } from '../shell'
import { buildPart, generic, hirakiFuda, isOpenLab, massCylinder, signText } from './common'
import { frontFace } from './shops'
import { signAtlas } from '../signs'
import type { GenericOpts } from './common'

/**
 * 大きな建物の組み立ての型: 石と煉瓦の 2〜3 階（出版社・観測所・研究会・ガラス工房・町役場の本庁舎）、近代の建物（新庁舎・科学館・スーパー・百貨店・
 * ホテル・病院）、学校・寮・体育館、ひらき通りのガラス張りの公開ラボ、円い図書館、フェリーターミナル、白い鉄とガラスの小さな建物、
 * 汐見ハーバータワー、曲面ガラスのホテル
 */

const LAB = 116

/** 屋上の物（室外機・塔屋・手すり）を陸屋根の上に */
function roofTop(k: Kit, ring: P2[], z: number, top: number, n = 3, fence = false) {
  const c = ringCenter(ring)
  const rf = rectFrame(ring, null, z)
  const b = k.solid
  for (let i = 0; i < n; i++) {
    const s = rf.W * (0.2 + 0.6 * k.rnd())
    const t = rf.D * (0.25 + 0.5 * k.rnd())
    const p = rf.frame.p(s, t, top)
    b.box([p[0], p[1] + 0.5, p[2]], [1.6, 1.0, 0.9], '#cfcec8', NM.paint, 0.4, rf.frame.yaw)
    b.box([p[0], p[1] + 0.5, p[2]], [1.0, 0.75, 0.92], '#2a2a2a', NM.dark, 0, rf.frame.yaw)
  }
  // 塔屋（階段室）
  const p = rf.frame.p(rf.W * 0.7, rf.D * 0.5, top)
  b.box([p[0], p[1] + 1.4, p[2]], [3.2, 2.8, 3.0], '#c9c6be', NM.concrete, 0, rf.frame.yaw)
  if (fence) for (let i = 0; i < ring.length; i++) {
    const f = Frame.edge(ring[i], ring[(i + 1) % ring.length], z)
    const L = Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1])
    railing(k, f, 0.3, L - 0.3, 0.35, top + 0.3, 1.5, '#9aa0a6', NM.steel, 2.0, 0.15)
  }
  void c
}

/* -------------------------------------------------------------------------- */
/* 石・煉瓦の 2〜3 階                                                            */
/* -------------------------------------------------------------------------- */

export function stoneBlock(k: Kit) {
  const rec = k.rec
  const hexes = hexesIn(rec.wallText)
  const st = signText(rec)
  const shop = rec.use === 2
  const stoneC = hexes[0] ?? cssOf(rec.wallColor)
  const trim = hexes[1] ?? '#efebe2'
  const g = generic(k, {
    wall: { color: stoneC, mat: NM.stone, aux: 0.55 },
    shop: shop ? { glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, depth: 6 }, frame: '#2f4f6f', kick: { color: '#6f6a62', mat: NM.granite }, fascia: { color: '#2f4f6f', mat: NM.paint }, sign: { text: st.main, sub: st.sub, fg: '#f3ecd8', bg: '#2f4f6f', font: 'serif' }, awning: null } : null,
    win: { w: 1.1, ht: 1.8, sill: 0.8, depth: 0.28, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 3, bar: 0.04, frame: '#2f3438', depth: 6 }, surround: { color: trim, mat: NM.stone, w: 0.14 }, sillTrim: { color: trim, mat: NM.stone } },
    bay: 2.8,
    door: { style: { kind: 'doubleGlass', color: '#2f3438', glass: { kind: GLASS.office, cls: LIGHT_CLASS.office } }, w: 1.8, ht: 2.6, lamp: 'lantern', surround: { color: trim, mat: NM.stone } },
    plinth: { ht: 0.6, color: '#8a8478', mat: NM.granite },
    bands: { hs: [3.6], ht: 0.2, proj: 0.06, color: trim, mat: NM.stone },
    cornice: { ht: 0.5, proj: 0.22, color: trim, mat: NM.stone },
    roof: { eave: 0.4, soffit: '#5a5048', gutter: '#4a4a46' },
    sign: shop ? null : { text: st.main, sub: st.sub, fg: '#2a2a2a', bg: '#f2efe6', border: '#8a7a5a', font: 'serif', h: 0.5 },
  })
  if (isOpenLab(rec)) hirakiFuda(k, g.body[g.frontEdge].f, 0.4, 1.4, rec)
  return g
}

/** 町役場の本庁舎（1929 年の石造 3 階・中央の小さな塔・正面の柱廊・旗） */
export function cityHall(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f } = ff
  const stone = '#cfc6b4'
  const trim = '#e2dccc'
  const g = generic(k, {
    wall: { color: stone, mat: NM.stone, aux: 0.6 },
    wallLower: { color: '#b8ae9a', mat: NM.stone, aux: 0.45, h: 4.2 },
    floors: 3,
    groundH: 4.6,
    floorH: 4.3,
    win: { w: 1.4, ht: 2.4, sill: 0.8, depth: 0.32, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 3, bar: 0.04, frame: '#2f3438', depth: 7 }, surround: { color: trim, mat: NM.stone, w: 0.16 }, sillTrim: { color: trim, mat: NM.stone }, lintel: { color: trim, mat: NM.stone, keystone: true } },
    groundWin: { w: 1.4, ht: 2.2, sill: 1.0, shape: 'arch', depth: 0.36, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 3, bar: 0.04, frame: '#2f3438', depth: 7 }, lintel: { color: trim, mat: NM.stone, keystone: true } },
    bay: 3.4,
    door: { style: { kind: 'doubleGlass', color: '#2f3438', transom: 0.9, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office } }, w: 2.6, ht: 3.6, shape: 'arch' },
    bands: { hs: [4.5, 8.8], ht: 0.28, proj: 0.08, color: trim, mat: NM.stone },
    cornice: { ht: 0.9, proj: 0.38, color: trim, mat: NM.stone },
    plinth: { ht: 0.8, color: '#8a8478', mat: NM.granite },
    parapet: 1.1,
    sign: null,
    parts: false,
  })
  // 正面の柱廊（6 本の柱・梁）と石段
  const s0 = ff.doorS - 6
  const s1 = ff.doorS + 6
  for (let i = 0; i < 6; i++) column(k, f, s0 + (i * (s1 - s0)) / 5, -2.6, 0, 8.6, 0.42, trim, NM.stone)
  fbox(k.solid, f, s0 - 0.8, s1 + 0.8, -3.3, 0.02, 8.6, 9.6, trim, NM.stone)
  steps(k, f.shift(0, -3.0), s0 - 0.6, s1 + 0.6, 5, 0.16, 0.34, '#a8a296')
  for (const s of [s0 - 3, ff.doorS, s1 + 3]) k.flood(f.p(s, -6.5, 0), 24, '#ffdcb0', 1.4)
  fbox(k.solid, f, s0 - 0.6, s1 + 0.6, -3.0, 0.02, -0.8, 0.0, '#a8a296', NM.granite)
  k.sign(f, ff.doorS - 3.0, 9.65, 6.0, 0.9, -3.31, { text: '桜見町役場', sub: 'SAKURAMI TOWN HALL  1929', fg: '#3a3428', bg: null, font: 'serif', bold: true }, 2)
  // 中央の塔（建物の部分）: 石の角の塔・時計のない窓・緑青の小さな屋根
  for (const p of rec.parts) {
    const pr = p.ring
    const pz = p.z ?? rec.z
    const H = p.height ?? 22
    const pf = rectFrame(pr, rec.front, pz)
    const top = H - 3.2
    buildBody(k, { ring: [pf.frame.plan(0, 0), pf.frame.plan(pf.W, 0), pf.frame.plan(pf.W, pf.D), pf.frame.plan(0, pf.D)], z: pz, bottom: g.eave - 1, floors: 1, floorH: 3, top, wall: { color: stone, mat: NM.stone, aux: 0.6 }, cornice: { ht: 0.6, proj: 0.25, color: trim, mat: NM.stone }, faces: [0, 1, 2, 3].map(() => ({ win: { w: 1.0, ht: 2.2, sill: top - 3.2, shape: 'arch' as const, depth: 0.3, glass: { kind: GLASS.dark, cls: LIGHT_CLASS.night, cols: 1, rows: 3, bar: 0.04, frame: '#2f3438' } }, bay: pf.W, minLen: 0, ground: 'windows' as const, groundWin: { w: 1.0, ht: 2.2, sill: top - 3.2, shape: 'arch' as const, depth: 0.3, glass: { kind: GLASS.dark, cls: LIGHT_CLASS.night, cols: 1, rows: 3, bar: 0.04, frame: '#2f3438' } } })), frontEdge: 0 })
    const c = pf.frame.plan(pf.W / 2, pf.D / 2)
    spire(k, c[0], c[1], pz + top + 0.3, Math.max(pf.W, pf.D) * 0.72, 2.9, 4, '#5b9a84', NM.copper, 0.35, Math.PI / 4 + Math.atan2(pf.frame.ay, pf.frame.ax))
  }
  // 旗竿 3 本（町の旗）
  for (const [i, col] of [
    [-1, '#2f6b3a'],
    [0, '#c0392b'],
    [1, '#2c4a6a'],
  ] as [number, string][]) {
    const p = f.p(ff.doorS + i * 2.4, -8, 0)
    k.solid.cylinder(p, 0.06, 9, 8, '#d8d8d4', NM.steel, 0, true)
    fbox(k.solid, f, ff.doorS + i * 2.4, ff.doorS + i * 2.4 + 1.6, -8.02, -7.98, 7.6, 8.7, col, NM.cloth)
  }
  return g
}

export function brickBlock(k: Kit) {
  const rec = k.rec
  const st = signText(rec)
  const hexes = hexesIn(rec.wallText)
  const stone = hexes[1] ?? '#e2d8c4'
  const g = generic(k, {
    wall: { color: cssOf(rec.wallColor), mat: NM.brick },
    win: { w: 1.2, ht: 2.0, sill: 0.85, shape: 'segment', depth: 0.3, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 3, bar: 0.04, frame: '#ece6da', depth: 6 }, sillTrim: { color: stone, mat: NM.stone }, lintel: { color: stone, mat: NM.stone } },
    bay: 3.0,
    door: { style: { kind: 'doubleGlass', color: '#2b2f2c', glass: { kind: GLASS.office, cls: LIGHT_CLASS.office } }, w: 1.8, ht: 2.6, lamp: 'gas', canopy: { color: '#2f3532', mat: NM.iron, depth: 1.2 } },
    plinth: { ht: 0.5, color: '#7d776e', mat: NM.granite },
    bands: { hs: [4.4], ht: 0.22, proj: 0.06, color: stone, mat: NM.stone },
    cornice: { ht: 0.5, proj: 0.2, color: stone, mat: NM.stone },
    parapet: 0.9,
    coping: stone,
    sign: { text: st.main, sub: st.sub, fg: '#f2ead6', bg: '#2b2f2c', font: 'serif', h: 0.5 },
  })
  if (isOpenLab(rec)) hirakiFuda(k, g.body[g.frontEdge].f, 0.4, 1.4, rec)
  if ((rec.name ?? '').includes('潮位')) {
    // 検潮所の観測の柱とアンテナ
    const rf = rectFrame(rec.ring, rec.front, rec.z)
    const p = rf.frame.p(rf.W * 0.7, rf.D * 0.5, g.eave + 0.9)
    k.solid.beam(p, [p[0], p[1] + 4, p[2]], 0.08, '#c8ccd0', NM.steel)
    k.solid.box([p[0], p[1] + 4.1, p[2]], [0.5, 0.25, 0.25], '#e8e8e4', NM.paint, 0.5)
  }
  return g
}

/* -------------------------------------------------------------------------- */
/* 近代の建物                                                                    */
/* -------------------------------------------------------------------------- */

type ModernLook = 'glass' | 'stoneGrid' | 'brickTeal' | 'store' | 'hotel' | 'hospital' | 'department'

export function modern(k: Kit, look: ModernLook, extra: Partial<GenericOpts> = {}) {
  const rec = k.rec
  const st = signText(rec)
  const hexes = hexesIn(rec.wallText)
  const floors = Math.max(1, rec.floors ?? 3)
  const eave = rec.height ?? floors * 3.6
  const ff = frontFace(rec)
  let wall: { color: string; mat: number; aux?: number } = { color: hexes[0] ?? cssOf(rec.wallColor), mat: NM.stone, aux: 0.9 }
  let win: WinSpec = { w: 1.5, ht: 1.8, sill: 0.8, depth: 0.22, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 1, bar: 0.04, frame: '#3a3e42', depth: 7 } }
  let bay = 2.4
  let groundWin: WinSpec | null | undefined = undefined
  let shop: GenericOpts['shop'] = null
  const ribbon = (kind: number, cls: number, ht: number, sill: number, frame = '#3a3e42'): WinSpec => ({ w: 999, ht, sill, depth: 0.16, glass: { kind, cls, cols: -1.5, rows: 1, bar: 0.05, frame, depth: 8 } })
  if (look === 'glass') {
    wall = { color: '#9fb4bc', mat: NM.glassDark }
    win = ribbon(GLASS.office, LIGHT_CLASS.office, eave / floors - 0.9, 0.55, '#5f6a70')
    bay = 999
  } else if (look === 'brickTeal') {
    wall = { color: hexes[0] ?? '#a5432f', mat: NM.brick }
    win = { w: 3.2, ht: 2.0, sill: 0.8, depth: 0.25, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 3, rows: 1, bar: 0.05, frame: hexes[1] ?? '#5fa8a0', depth: 8 }, sillTrim: { color: '#c8c4bc', mat: NM.concrete } }
    bay = 4.4
  } else if (look === 'store') {
    wall = { color: hexes[0] ?? '#a5432f', mat: NM.brick }
    win = { w: 4, ht: 1.0, sill: Math.max(3, eave - 2.2), depth: 0.2, glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, cols: 4, rows: 1, bar: 0.05, frame: hexes[1] ?? '#5fa8a0' } }
    bay = 6
    shop = { glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, depth: 14 }, frame: hexes[1] ?? '#5fa8a0', kick: { color: '#4a4a4a', mat: NM.tileClad }, fascia: { color: '#f2f2ee', mat: NM.paint }, sign: { text: st.main.replace(/「|」/g, ''), sub: st.sub, fg: '#2f6b3a', bg: '#f8f6ee', font: 'sans', bold: true }, signMode: 1, awning: null, windowTop: 3.0, door: { kind: 'doubleGlass', color: '#3a3e42' } }
  } else if (look === 'hotel') {
    win = { w: 1.4, ht: 1.7, sill: 0.7, depth: 0.25, glass: { kind: GLASS.house, cls: LIGHT_CLASS.night, cols: 2, rows: 1, bar: 0.04, frame: '#3a3e42', depth: 5 }, surround: { color: '#e8e2d4', mat: NM.stone, w: 0.12 } }
    bay = 3.2
    groundWin = { w: 2.6, ht: 3.0, sill: 0.3, depth: 0.25, glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.night, cols: 3, rows: 2, bar: 0.05, frame: '#2a2a2a', depth: 10 } }
  } else if (look === 'hospital') {
    win = ribbon(GLASS.office, LIGHT_CLASS.night, 1.6, 0.9)
    bay = 7.5
    win.w = 6.6
  } else if (look === 'department') {
    win = { w: 2.6, ht: 2.2, sill: 0.9, depth: 0.3, glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, cols: 2, rows: 1, bar: 0.05, frame: '#2a2a2a', depth: 10 }, surround: { color: '#e8e2d4', mat: NM.stone, w: 0.15 } }
    bay = 4.0
    shop = { glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, depth: 12 }, frame: '#2a2a2a', kick: { color: '#3a3a3a', mat: NM.granite }, fascia: { color: '#2f4a3e', mat: NM.paint }, sign: null, awning: { color: '#2f4a3e', stripes: 0 }, windowTop: 3.4 }
  } else {
    win = { w: 1.6, ht: 1.9, sill: 0.8, depth: 0.24, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 1, bar: 0.04, frame: '#3a3e42', depth: 7 } }
    bay = 2.6
  }
  const g = generic(k, {
    wall,
    floors,
    eave,
    groundH: look === 'department' || look === 'store' ? 4.8 : look === 'hotel' ? 5.0 : Math.min(5, eave / floors + 0.6),
    win,
    groundWin,
    bay,
    shop,
    door: { style: { kind: 'doubleGlass', color: '#3a3e42', glass: { kind: GLASS.office, cls: LIGHT_CLASS.night } }, w: 2.6, ht: 2.8, canopy: { color: look === 'hotel' ? '#2a2a2a' : '#d8d8d4', mat: NM.paint, depth: look === 'hotel' ? 3.0 : 2.2 } },
    plinth: { ht: 0.4, color: '#7d776e', mat: NM.granite },
    cornice: look === 'department' || look === 'hotel' ? { ht: 1.2, proj: 0.45, color: '#e8e2d4', mat: NM.stone } : undefined,
    parapet: 1.0,
    roofDeck: (rec.roofText ?? '').includes('緑') || (rec.roofText ?? '').includes('庭園') ? '#5d7a3e' : undefined,
    sign: null,
    ...extra,
  })
  const b = k.solid
  const f = g.body[g.frontEdge].f
  const L = g.body[g.frontEdge].L
  // 床の帯（ガラスの建物は各階のスラブの縁、ほかは 3 階ごとに少し）
  if (look === 'glass' || look === 'hospital') for (let i = 1; i < floors; i++) for (const face of g.body) fbox(b, face.f, -0.05, face.L + 0.05, -0.18, 0.02, g.groundH + (i - 1) * g.floorH - 0.25, g.groundH + (i - 1) * g.floorH + 0.1, look === 'glass' ? '#d8dcdc' : '#e8e2d4', NM.concrete)
  // 看板
  const signTop = Math.min(g.groundH + 0.2, eave - 1.2)
  if (look === 'hotel') {
    k.sign(f, L - 1.4, 6.0, 0.9, Math.min(12, eave - 8), -0.4, { text: 'ホテル・ルミエール桜見', fg: '#f6e8c0', bg: '#2a2a2a', vertical: true, font: 'serif' }, 1)
    k.sign(f, ff.doorS - 3, 3.05, 6, 0.6, -3.05, { text: 'HOTEL LUMIÈRE', sub: 'SAKURAMI', fg: '#e8c870', bg: '#1e1e1e', font: 'latin' }, 1)
  } else if (look === 'hospital') {
    k.sign(f, ff.doorS - 4.5, 3.0, 9, 0.8, -2.25, { text: '桜見市民病院', sub: 'SAKURAMI CITIZENS HOSPITAL', fg: '#2c4a6a', bg: '#f6f6f2', font: 'sans', bold: true }, 1)
    // 屋上の浮遊機のポート（H の円）
    const rf = rectFrame(rec.ring, rec.front, rec.z)
    const c = rf.frame.plan(rf.W / 2, rf.D / 2)
    const r = Math.min(rf.W, rf.D) * 0.32
    const y = rec.z + eave + 0.06
    b.cylinder([c[0], y - LAB, -c[1]], r, 0.04, 40, '#3c4044', NM.concrete, 0, true)
    b.cylinder([c[0], y + 0.045 - LAB, -c[1]], r * 0.92, 0.01, 40, '#f2f2ee', NM.paint, 0.2, true)
    b.cylinder([c[0], y + 0.05 - LAB, -c[1]], r * 0.86, 0.01, 40, '#3c4044', NM.concrete, 0, true)
    const hf = new Frame(c[0], c[1], rf.frame.ax, rf.frame.ay, y + 0.06)
    fbox(b, hf, -r * 0.35, -r * 0.2, -r * 0.45, r * 0.45, 0, 0.012, '#f2f2ee', NM.paint, 0.2)
    fbox(b, hf, r * 0.2, r * 0.35, -r * 0.45, r * 0.45, 0, 0.012, '#f2f2ee', NM.paint, 0.2)
    fbox(b, hf, -r * 0.2, r * 0.2, -0.06 * r, 0.06 * r, 0, 0.012, '#f2f2ee', NM.paint, 0.2)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      k.glow.box([c[0] + Math.cos(a) * r, y + 0.1 - LAB, -(c[1] + Math.sin(a) * r)], [0.2, 0.1, 0.2], '#9fdc8a', 0, 2.5)
    }
  } else if (look === 'department') {
    k.sign(f, 0.6, 5.5, 1.3, Math.min(14, eave - 8), -0.5, { text: '緑樹百貨', fg: '#ffffff', bg: '#2f4a3e', vertical: true, font: 'serif', bold: true }, 1)
    k.sign(f, L / 2 - 4, 3.55, 8, 0.75, -0.13, { text: '緑樹百貨', sub: 'RYOKUJU DEPARTMENT STORE', fg: '#f0e6c8', bg: '#2f4a3e', font: 'serif', bold: true }, 1)
  } else if (look !== 'store') {
    k.sign(f, ff.doorS - 3.2, signTop + 0.5, 6.4, 0.75, -0.06, { text: st.main.replace(/「|」/g, ''), sub: st.sub, fg: look === 'glass' ? '#ffffff' : '#2a2a2a', bg: look === 'glass' ? '#2f4a5a' : '#f2f0ea', font: 'sans', bold: true }, 2)
  }
  if (isOpenLab(rec)) hirakiFuda(k, f, ff.doorS + 1.8, 1.4, rec)
  // 屋上
  if ((rec.roofText ?? '').includes('緑') || (rec.roofText ?? '').includes('庭園')) {
    const rf = rectFrame(rec.ring, rec.front, rec.z)
    for (let i = 0; i < 6; i++) {
      const p = rf.frame.p(rf.W * (0.15 + 0.7 * k.rnd()), rf.D * (0.15 + 0.7 * k.rnd()), eave + 0.1)
      b.box([p[0], p[1] + 0.3, p[2]], [2.4, 0.6, 1.2], '#6b4a2e', NM.wood, 0, rf.frame.yaw)
      b.box([p[0], p[1] + 0.75, p[2]], [2.2, 0.4, 1.0], '#4f7a34', NM.leaf, 0, rf.frame.yaw)
    }
    roofTop(k, rec.ring, rec.z, eave, 2, true)
  } else roofTop(k, rec.ring, rec.z, eave, 4, false)
  if (look === 'store') {
    // 駐車場の側の大きな看板の柱
    const p = f.p(-4, -8, 0)
    k.solid.cylinder(p, 0.3, 7.5, 10, '#c8ccd0', NM.steel, 0, true)
    k.sign(f, -6, 6.0, 4.0, 2.2, -8.1, { text: 'ヒガシノマート', sub: 'HIGASHINO MART', fg: '#ffffff', bg: '#2f8a4a', font: 'sans', bold: true }, 1)
  }
  return g
}

/* -------------------------------------------------------------------------- */
/* 学校・寮・体育館                                                              */
/* -------------------------------------------------------------------------- */

export function school(k: Kit, look: 'white' | 'brick' | 'brickTeal' | 'dorm') {
  const rec = k.rec
  const hexes = hexesIn(rec.wallText)
  const floors = Math.max(1, rec.floors ?? 3)
  const wall = look === 'white' ? { color: '#f0efe9', mat: NM.concrete } : look === 'brick' ? { color: cssOf(rec.wallColor), mat: NM.brick } : look === 'dorm' ? { color: hexes[0] ?? '#a5432f', mat: NM.tileClad, aux: 0.12 } : { color: hexes[0] ?? '#a5432f', mat: NM.brick }
  const frame = look === 'brickTeal' || look === 'dorm' ? (hexes[1] ?? '#5fa8a0') : '#6a6e72'
  const g = generic(k, {
    wall,
    floors,
    win: look === 'dorm' ? { w: 1.6, ht: 1.6, sill: 0.8, depth: 0.2, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 1, bar: 0.04, frame, depth: 4 } } : { w: 3.0, ht: 1.9, sill: 0.85, depth: 0.2, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 3, rows: 2, bar: 0.04, frame, depth: 7 }, sillTrim: { color: '#c8c4bc', mat: NM.concrete } },
    bay: look === 'dorm' ? 3.0 : 3.6,
    door: { style: { kind: 'doubleGlass', color: frame, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office } }, w: 3.0, ht: 2.6, canopy: { color: '#d8d8d4', mat: NM.concrete, depth: 2.6 } },
    plinth: { ht: 0.45, color: '#8a8682', mat: NM.concrete },
    parapet: 1.0,
    sign: null,
  })
  const f = g.body[g.frontEdge].f
  const L = g.body[g.frontEdge].L
  const ff = frontFace(rec)
  // 正面の時計（小・中学校・高校）と校名
  if (look !== 'dorm' && (rec.kind ?? '').match(/学校|校舎/)) {
    const cH = g.eave - 0.9
    const dial = signAtlasClock()
    if (dial) k.signs.quad(f.p(L / 2 - 0.8, -0.06, cH - 0.8), f.p(L / 2 + 0.8, -0.06, cH - 0.8), f.p(L / 2 + 0.8, -0.06, cH + 0.8), f.p(L / 2 - 0.8, -0.06, cH + 0.8), dial, 3)
    k.clocks.push({ center: f.p(L / 2, -0.08, cH), out: f.out, radius: 0.76 })
    fbox(k.solid, f, L / 2 - 1.0, L / 2 + 1.0, -0.05, 0.02, cH - 1.0, cH + 1.0, '#e8e8e4', NM.concrete)
  }
  const name = rec.name.replace(/（.*）/, '')
  k.sign(f, ff.doorS + 1.9, 0.6, 0.42, 2.0, -0.06, { text: name, fg: '#1a1a1a', bg: '#d8d4c8', vertical: true, font: 'serif' }, 0)
  roofTop(k, rec.ring, rec.z, g.eave, 3, look !== 'dorm')
  if (look === 'dorm') {
    // 各階のベランダ
    for (let i = 1; i < g.floors; i++) for (let s = 0.4; s < L - 2.6; s += 3.0) {
      fbox(k.solid, f, s, s + 2.7, -1.0, 0.02, g.groundH + (i - 1) * g.floorH - 0.15, g.groundH + (i - 1) * g.floorH, '#d8d4c8', NM.concrete)
      railing(k, f, s + 0.05, s + 2.65, -0.95, g.groundH + (i - 1) * g.floorH, 1.0, '#c8ccd0', NM.steel, 1.3, 0.12)
    }
  }
  return g
}

function signAtlasClock() {
  return signAtlas.clockRegion(256)
}

export function gym(k: Kit) {
  const rec = k.rec
  const g = generic(k, {
    wall: { color: '#ecebe6', mat: NM.metalRoof, aux: 0.1 },
    wallLower: { color: '#d8d6d0', mat: NM.concrete, h: 2.4 },
    floors: 1,
    win: { w: 3.4, ht: 1.6, sill: (rec.height ?? 12) - 3.4, depth: 0.15, glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: 3, rows: 1, bar: 0.05, frame: '#6a6e72', depth: 20 } },
    groundWin: { w: 3.4, ht: 1.6, sill: (rec.height ?? 12) - 3.4, depth: 0.15, glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: 3, rows: 1, bar: 0.05, frame: '#6a6e72', depth: 20 } },
    bay: 4.5,
    door: { style: { kind: 'doubleGlass', color: '#6a6e72', glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office } }, w: 3.0, ht: 2.6, canopy: { color: '#d8d8d4', mat: NM.concrete, depth: 2.0 } },
    parapet: 0.8,
    sign: { text: '体育館', sub: '桜見高専', fg: '#2a2a2a', bg: '#f2f0ea', font: 'sans', h: 0.6 },
  })
  return g
}

/* -------------------------------------------------------------------------- */
/* ひらき通りのガラス張りの公開ラボ                                               */
/* -------------------------------------------------------------------------- */

export function glassLab(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const eave = rec.height ?? 7.8
  const accents = ['#2f6b8a', '#6b3a8a', '#2f8a6a', '#8a5a2f', '#8a2f4a', '#3a5a8a', '#5a8a2f', '#2f4a6b']
  const accent = accents[k.seed % accents.length]
  const glass: GlassSpec = { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: Math.max(2, Math.round((L - 1.2) / 1.6)), rows: 2, bar: 0.06, frame: '#3a3e42', depth: 9, yC: eave - 1 }
  const door: Opening = { s: Math.min(L - 2.2, Math.max(0.8, ff.doorS - 0.9)), h: 0, w: 1.8, ht: 2.5, depth: 0.2, fill: 'door', door: { kind: 'doubleGlass', color: '#3a3e42', glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office } } }
  const upper: Opening = { s: 0.5, h: 3.4, w: L - 1.0, ht: eave - 4.4, depth: 0.2, glass }
  const left: Opening = { s: 0.5, h: 0.35, w: door.s - 0.8, ht: 2.6, depth: 0.2, glass: { ...glass, cols: Math.max(1, Math.round((door.s - 0.8) / 1.6)) } }
  const rightW = L - 0.5 - (door.s + door.w + 0.3)
  const right: Opening = { s: door.s + door.w + 0.3, h: 0.35, w: rightW, ht: 2.6, depth: 0.2, glass: { ...glass, cols: Math.max(1, Math.round(rightW / 1.6)) } }
  const ops = [door, upper, ...[left, right].filter((o) => o.w > 0.6)]
  const g = generic(k, {
    wall: { color: '#a5432f', mat: NM.brick },
    floors: 2,
    groundH: 3.4,
    frontGround: 'none',
    frontOpenings: ops,
    noFrontDoor: true,
    win: { w: 1.2, ht: 1.6, sill: 0.9, depth: 0.2, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 1, bar: 0.04, frame: '#3a3e42' } },
    bay: 3.4,
    parapet: 0.7,
    coping: '#c8c4bc',
    sign: null,
  })
  // ガラスの面の枠（色の縁）と、看板の帯・ひらき札・自転車置き場
  fbox(k.solid, f, 0.2, L - 0.2, -0.12, 0.02, 3.0, 3.38, accent, NM.paint, 0.5)
  fbox(k.solid, f, 0.2, 0.5, -0.12, 0.02, 0, eave, accent, NM.paint, 0.5)
  fbox(k.solid, f, L - 0.5, L - 0.2, -0.12, 0.02, 0, eave, accent, NM.paint, 0.5)
  const st = signText(rec)
  k.sign(f, L / 2 - Math.min(3.2, L / 2 - 0.7), 3.03, Math.min(6.4, L - 1.4), 0.32, -0.125, { text: st.main, sub: st.sub, fg: '#ffffff', bg: accent, font: 'sans', bold: true }, 1)
  hirakiFuda(k, f, door.s - 0.45, 1.3, rec)
  for (let i = 0; i < 3; i++) {
    const s = 0.8 + i * 0.6
    k.solid.beam(f.p(s, -1.2, 0), f.p(s, -1.2, 0.8), 0.04, '#c8ccd0', NM.steel)
  }
  pot(k, f, L - 0.5, -0.5, 0, 0.5)
  return g
}

/* -------------------------------------------------------------------------- */
/* 円い図書館・フェリーターミナル・白い鉄とガラスの建物                                */
/* -------------------------------------------------------------------------- */

/** 町立中央図書館（木とガラスの円い 3 階・屋上緑化・中央の書架塔の天窓） */
export function roundLibrary(k: Kit) {
  const rec = k.rec
  const ring = rec.ring
  const z = rec.z
  const eave = rec.height ?? 15
  const c = ringCenter(ring)
  const R = ring.reduce((m, q) => m + Math.hypot(q[0] - c[0], q[1] - c[1]), 0) / ring.length
  const fe = frontEdgeOf(ring, rec.front)
  k.mass.st = { wall: [185, 142, 95], facade: 4, roof: [107, 143, 78], roofKind: ROOF.flat, use: 6, flags: 1 | 4, seed: k.seed, style: 0, floors: 3 }
  const glass: GlassSpec = { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 1, rows: 2, bar: 0.05, frame: '#7a5a3a', depth: 12 }
  const faces = buildBody(k, {
    ring,
    z,
    bottom: Math.min(rec.gLow, z) - z - 0.4,
    floors: 3,
    floorH: 4.6,
    groundH: 5.0,
    top: eave,
    wall: { color: '#b98e5f', mat: NM.wood, aux: 1 },
    faces: ring.map((_, i) => ({ win: { w: 999, ht: 3.6, sill: 0.5, depth: 0.25, glass }, groundWin: { w: 999, ht: 4.2, sill: 0.3, depth: 0.25, glass }, bay: 999, minLen: 1, doors: i === fe ? [{ s: 1.1, w: 1.9, ht: 2.6, style: { kind: 'doubleGlass' as const, color: '#7a5a3a', glass: { kind: GLASS.office, cls: LIGHT_CLASS.office } } }] : [] })),
    frontEdge: fe,
    windowTop: eave - 0.5,
  })
  // 各階の床の帯（木の庇）
  for (const h of [5.0, 9.6]) for (const fc of faces) fbox(k.solid, fc.f, -0.05, fc.L + 0.05, -0.9, 0.02, h - 0.3, h, '#8a6a48', NM.wood)
  flatRoof(k, ring, z, eave + 0.6, 0.6, '#b98e5f', NM.wood, '#5d7a3e', '#8a6a48', 1)
  // 屋上の植え込みと、中央の書架塔の天窓（ガラスの円筒）
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2
    const r = R * (0.45 + 0.35 * k.rnd())
    k.solid.box([c[0] + Math.cos(a) * r, z + eave + 0.35 - LAB, -(c[1] + Math.sin(a) * r)], [2.4, 0.7, 2.4], '#4f7a34', NM.leaf, 0, a)
  }
  k.solid.cylinder([c[0], z + eave - LAB, -c[1]], 6.2, 0.6, 32, '#8a6a48', NM.wood, 0, false)
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2
    const a1 = ((i + 1) / 24) * Math.PI * 2
    const P = (a: number, h: number): [number, number, number] => [c[0] + Math.cos(a) * 6.0, z + eave + h - LAB, -(c[1] + Math.sin(a) * 6.0)]
    k.glass.add([P(a0, 0.6), P(a1, 0.6), P(a1, 3.6), P(a0, 3.6)], [new THREE.Vector2(0, 0), new THREE.Vector2(1.57, 0), new THREE.Vector2(1.57, 3), new THREE.Vector2(0, 3)], [[0, 2, 1], [0, 3, 2]], 1.57, 3, [Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)], { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 1, rows: 1, bar: 0.05, frame: '#7a5a3a', depth: 10 })
  }
  k.solid.cylinder([c[0], z + eave + 3.6 - LAB, -c[1]], 6.6, 0.35, 32, '#8a6a48', NM.wood, 0, true, 6.3)
  massCylinder(k, c, 6.2, z + eave, z + eave + 3.9)
  const fr = faces[fe].f
  k.sign(fr, -2.5, 3.2, 7, 0.7, -0.92, { text: '町立中央図書館', sub: 'CENTRAL LIBRARY', fg: '#3a2a1a', bg: '#efe6d2', font: 'serif' }, 2)
}

/** 汐見フェリーターミナル（白い鋼板とガラス・緑の大屋根の切妻・柱の並ぶ深い軒） */
export function terminal(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const eave = rec.height ?? 10
  const glass: GlassSpec = { kind: GLASS.office, cls: LIGHT_CLASS.night, cols: -1.6, rows: 2, bar: 0.06, frame: '#e8ecee', depth: 14 }
  const g = generic(k, {
    wall: { color: '#e9eef0', mat: NM.metalRoof, aux: 0.08 },
    floors: 2,
    groundH: 5.0,
    win: { w: 999, ht: eave - 6.2, sill: 0.4, depth: 0.2, glass },
    groundWin: { w: 999, ht: 3.6, sill: 0.3, depth: 0.2, glass },
    bay: 999,
    door: { style: { kind: 'doubleGlass', color: '#e8ecee', glass: { kind: GLASS.office, cls: LIGHT_CLASS.night } }, w: 3.2, ht: 3.0 },
    roof: { color: '#2f6b3a', mat: NM.metalRoof, aux: 0.0, eave: 3.0, verge: 2.0, thick: 0.5, soffit: '#e8ecee', fascia: '#2f6b3a' },
    sign: null,
  })
  // 深い軒を支える柱
  for (let s = 1; s < L; s += 6) column(k, f, s, -2.6, 0, eave - 0.6, 0.22, '#e8ecee', NM.paint, false)
  k.sign(f, L / 2 - 6, eave - 1.6, 12, 1.0, -0.08, { text: '汐見フェリーターミナル', sub: 'SHIOMI FERRY TERMINAL', fg: '#2f6b3a', bg: '#f8f8f4', font: 'sans', bold: true }, 1)
  banner(k, f, ff.doorS - 3.5, -3.0, 0, '#2f6b3a', '汐見島連絡船')
  return g
}

/** 白い鉄とガラスの建物（観覧車の乗り場・海辺のレストラン） */
export function pavilion(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const st = signText(rec)
  const restaurant = (rec.kind ?? '').includes('レストラン')
  const glass: GlassSpec = { kind: restaurant ? GLASS.cafe : GLASS.office, cls: LIGHT_CLASS.shop, cols: -1.5, rows: 1, bar: 0.06, frame: '#f4f4f2', depth: 8 }
  const g = generic(k, {
    wall: { color: '#f4f4f2', mat: NM.paint, aux: 0.4 },
    floors: rec.floors ?? 1,
    groundH: restaurant ? 3.6 : rec.height ?? 4.5,
    win: { w: 999, ht: 2.4, sill: 0.4, depth: 0.15, glass },
    groundWin: { w: 999, ht: 2.6, sill: 0.25, depth: 0.15, glass },
    bay: 999,
    door: { style: { kind: 'doubleGlass', color: '#f4f4f2', glass: { kind: glass.kind, cls: LIGHT_CLASS.shop } }, w: 2.0, ht: 2.5 },
    parapet: 0.5,
    coping: '#f4f4f2',
    sign: null,
  })
  // 屋根の張り出しの白い板
  for (const fc of g.body) fbox(k.solid, fc.f, -0.6, fc.L + 0.6, -1.2, 0.02, g.eave + 0.0, g.eave + 0.35, '#f4f4f2', NM.paint, 0.4)
  k.sign(f, L / 2 - Math.min(3.5, L / 2 - 0.5), g.eave + 0.45, Math.min(7, L - 1), 0.75, -0.6, { text: st.main.replace('大観覧車', ''), sub: st.sub, fg: '#2c4a6a', bg: '#ffffff', font: 'sans', bold: true }, 1)
  if (restaurant) {
    // 海側のテラス（パラソル）
    for (let i = 0; i < 3; i++) {
      const p = f.p(1.5 + i * ((L - 3) / 2), -3.0, 0)
      k.solid.cylinder(p, 0.03, 2.2, 6, '#d8d4c8', NM.paint, 0.5, false)
      k.solid.cylinder([p[0], p[1] + 2.1, p[2]], 1.4, 0.45, 16, '#2c4a6a', NM.cloth, 0, true, 0.04)
      k.solid.cylinder([p[0], p[1] + 0.72, p[2]], 0.5, 0.04, 14, '#f2f0ea', NM.paint, 0.4, true)
    }
  }
  wallLamp(k, f, ff.doorS + 1.4, 2.6, 'bulb')
  return g
}

/* -------------------------------------------------------------------------- */
/* 汐見ハーバータワー・曲面ガラスのホテル                                           */
/* -------------------------------------------------------------------------- */

/** 隅を切った正方形の外形（反時計回り） */
function chamfered(cx: number, cy: number, h: number, c: number, rot: number): P2[] {
  const pts: P2[] = []
  for (const [x, y] of [
    [h, h],
    [-h, h],
    [-h, -h],
    [h, -h],
  ]) {
    pts.push([x - Math.sign(x) * c, y], [x, y - Math.sign(y) * c])
  }
  const ordered = pts.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]))
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  return ordered.map(([x, y]) => [cx + cr * x - sr * y, cy + sr * x + cr * y])
}

/** 汐見ハーバータワー（低層のタワーモールと、隅を切った角柱 3 段のカーテンウォール・展望台の冠・尖塔。300m まで） */
export function harborTower(k: Kit) {
  const rec = k.rec
  const z = rec.z
  const podium = rec.height ?? 24
  // 低層部（タワーモール）: 石とガラスの 5 階
  modern(k, 'glass', { parts: false, eave: podium, floors: 5 })
  const shaft = rec.parts.find((p) => (p.partKind ?? '').includes('塔'))
  const c = shaft ? ringCenter(shaft.ring) : ringCenter(rec.ring)
  const tiers: [number, number, number, number][] = [
    [podium, 150, 22, 6],
    [150, 212, 18.5, 6.5],
    [212, 246, 14.5, 6],
    [246, 258, 11, 4.5],
  ]
  const glass: GlassSpec = { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: -1.5, rows: 1, bar: 0.05, frame: '#4a5a62', depth: 10 }
  k.mass.st = { wall: [92, 140, 162], facade: 4, roof: [70, 80, 86], roofKind: ROOF.flat, use: 3, flags: 1 | 64, seed: k.seed, style: 4, floors: 62 }
  for (const [a, b, h, ch] of tiers) {
    const ring = chamfered(c[0], c[1], h, ch, 0)
    const fl = Math.max(1, Math.round((b - a) / 4.1))
    buildBody(k, {
      ring,
      z: z + a,
      bottom: -0.3,
      floors: fl,
      floorH: (b - a) / fl,
      top: b - a,
      wall: { color: '#7d97a3', mat: NM.glassDark },
      faces: ring.map(() => ({ win: { w: 999, ht: (b - a) / fl - 0.9, sill: 0.45, depth: 0.08, glass }, bay: 999, minLen: 1 })),
      frontEdge: -1,
      windowTop: b - a - 0.5,
    })
    flatRoof(k, ring, z + a, b - a + 0.4, 0.4, '#d8dcdc', NM.concrete, '#6a6e72', '#d8dcdc')
  }
  // 冠（展望台の明るい帯）と尖塔
  const crown = chamfered(c[0], c[1], 15.5, 6.2, 0)
  buildBody(k, { ring: crown, z: z + 244, bottom: 0, floors: 1, floorH: 2.2, top: 2.2, wall: { color: '#c8ccce', mat: NM.paint, aux: 0.5 }, faces: crown.map(() => null), frontEdge: -1 })
  flatRoof(k, crown, z + 244, 2.2, 0.0, '#c8ccce', NM.paint)
  spire(k, c[0], c[1], z + 258, 1.6, 42, 8, '#c0c4c8', NM.steel, 0)
  for (const hh of [258.5, 280, 299]) k.lights.push({ x: c[0], y: c[1], z: z + hh, kind: 6, color: '#ff3a2a', size: 2.2, power: 1.8, seed: 0.1 })
  k.sign(Frame.facing(c[0], c[1] - 23, 180, z + 140).shift(-6, 0), 0, 0, 12, 2.0, -0.2, { text: 'HARBOR TOWER', fg: '#e8eef0', bg: null, font: 'sans', bold: true }, 1)
}

/** ホテル帆ノ風（曲面ガラスの 22 階。白い屋上の冠） */
export function curvedHotel(k: Kit) {
  const rec = k.rec
  const floors = rec.floors ?? 22
  const eave = rec.height ?? 82
  const glass: GlassSpec = { kind: GLASS.house, cls: LIGHT_CLASS.night, cols: -1.6, rows: 1, bar: 0.05, frame: '#d8e4ea', depth: 6 }
  k.mass.st = { wall: [156, 199, 214], facade: 4, roof: [244, 244, 242], roofKind: ROOF.flat, use: 2, flags: 1 | 64, seed: k.seed, style: 4, floors }
  const fe = frontEdgeOf(rec.ring, rec.front)
  const faces = buildBody(k, {
    ring: rec.ring,
    z: rec.z,
    bottom: Math.min(rec.gLow, rec.z) - rec.z - 0.4,
    floors,
    floorH: (eave - 6) / (floors - 1),
    groundH: 6,
    top: eave,
    wall: { color: '#9cc7d6', mat: NM.glassDark },
    faces: rec.ring.map((_, i) => ({ win: { w: 999, ht: (eave - 6) / (floors - 1) - 0.8, sill: 0.4, depth: 0.06, glass }, groundWin: { w: 999, ht: 4.6, sill: 0.3, depth: 0.1, glass: { ...glass, kind: GLASS.cafe } }, bay: 999, minLen: 1, doors: i === fe ? [{ s: 1.2, w: 2.0, ht: 3.0, style: { kind: 'doubleGlass' as const, color: '#d8e4ea' } }] : [] })),
    frontEdge: fe,
    windowTop: eave - 0.5,
  })
  for (let i = 1; i < floors; i++) for (const fc of faces) fbox(k.solid, fc.f, -0.02, fc.L + 0.02, -0.12, 0.02, 6 + (i - 1) * ((eave - 6) / (floors - 1)) - 0.2, 6 + (i - 1) * ((eave - 6) / (floors - 1)) + 0.15, '#eef2f2', NM.paint, 0.5)
  flatRoof(k, rec.ring, rec.z, eave + 2.0, 2.0, '#f4f4f2', NM.paint, '#8a8e92', '#f4f4f2', 0.5)
  canopy(k, faces[fe].f, -2, 4, 4.2, 4, '#f4f4f2', NM.paint, 0.3)
  k.sign(faces[fe].f, -1.5, 4.4, 5, 0.7, -3.9, { text: 'ホテル帆ノ風', sub: 'HOTEL HONOKAZE', fg: '#2c4a6a', bg: '#ffffff', font: 'serif' }, 1)
  k.lights.push({ ...{ x: ringCenter(rec.ring)[0], y: ringCenter(rec.ring)[1] }, z: rec.z + eave + 3, kind: 6, color: '#ff3a2a', size: 1.8, power: 1.6, seed: 0.2 })
}

void isRect
void gableRoof
void acUnit
void wallLamp
void buildPart
