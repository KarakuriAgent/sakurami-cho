import * as THREE from 'three'
import { ROOF } from '../../town/buildingKit'
import type { P2 } from '../../town/townData'
import { Frame, rectFrame, ringCenter } from '../frame'
import { dome, fbox, flatRoof, type Kit, type Opening, steps, wallLamp } from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import { column, railing } from '../parts'
import { buildBody, windowTrims } from '../shell'
import { massCylinder } from './common'
import type { KitContext } from './index'

/**
 * 桜木丘天文台（白い石の 2 階の本館・屋上の観測ドーム（直径 9m・スリット）・北のプラネタリウム「星の間」・屋上の気象観測の機器・北の正面の柱廊）と、
 * ガーデンドーム（ガラスと骨組みはドームのシェーダー。ここは石の基壇・白い鋼の骨（近く）・南門のアーチと列柱・北門・西口）
 */

const LAB = 116
const WHITE = '#f0eee8'
const TRIM = '#e2ded4'

export function observatory(k: Kit) {
  const rec = k.rec
  const z = rec.z
  const b = k.solid
  const main = rec.parts.find((p) => (p.partKind ?? '').includes('本館'))
  const dpart = rec.parts.find((p) => (p.partKind ?? '') === 'ドーム')
  const plan = rec.parts.find((p) => (p.partKind ?? '').includes('プラネタリウム'))
  const H = main?.height ?? rec.height ?? 8.6
  k.mass.st = { wall: [242, 240, 234], facade: 2, roof: [240, 240, 240], roofKind: ROOF.flat, use: 6, flags: 1, seed: k.seed, style: 0, floors: 2 }
  // 本館（白い石。北が正面）
  const mring = main?.ring ?? rec.ring
  const rf = rectFrame(mring, rec.front, z)
  const { frame: f, W, D } = rf
  const ring: P2[] = [f.plan(0, 0), f.plan(W, 0), f.plan(W, D), f.plan(0, D)]
  const mainE = rec.entrances.findIndex((e) => e.kind === 'main')
  const [es] = f.local(rec.entrances[mainE].x, rec.entrances[mainE].y)
  const win = { w: 1.3, ht: 2.3, sill: 0.8, depth: 0.32, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 3, bar: 0.04, frame: '#3c4146', depth: 6 }, surround: { color: TRIM, mat: NM.stone, w: 0.16 }, sillTrim: { color: TRIM, mat: NM.stone } }
  const door: Opening = { s: es - 1.0, h: 0, w: 2.0, ht: 2.9, shape: 'arch', depth: 0.4, fill: 'door', door: { kind: 'doubleGlass', color: '#2c3a48', transom: 0.8, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office } } }
  const faces = buildBody(k, {
    ring,
    z,
    bottom: Math.min(rec.gLow, z) - z - 0.4,
    floors: 2,
    floorH: 4.0,
    groundH: 4.2,
    top: H,
    wall: { color: WHITE, mat: NM.stone, aux: 0.5 },
    plinth: { ht: 0.7, color: '#d8d4ca', mat: NM.stone, aux: 0.35, proj: 0.1 },
    bands: { hs: [4.1], ht: 0.3, proj: 0.08, color: TRIM, mat: NM.stone },
    cornice: { ht: 0.8, proj: 0.3, color: TRIM, mat: NM.stone },
    faces: [{ win, bay: 3.2, doors: [], openings: [door], minLen: 0 }, { win, bay: 3.2 }, { win, bay: 3.2 }, { win, bay: 3.2, doors: [{ s: D - 10, w: 1.0, ht: 2.2, style: { kind: 'panel', color: '#4a4a48' } }] }],
    frontEdge: 0,
  })
  windowTrims(k, faces[0].f, door, { w: 2, ht: 2.9, sill: 0, shape: 'arch', lintel: { color: TRIM, mat: NM.stone, keystone: true } })
  flatRoof(k, ring, z, H + 0.9, 0.9, WHITE, NM.stone, '#9a9890', '#e8e6e0', 0.5)
  // 正面の柱廊（4 本の柱・三角の破風）と石段
  const f0 = faces[0].f
  const p0 = es - 3.4
  const p1 = es + 3.4
  for (const s of [p0, p0 + 2.27, p0 + 4.53, p1]) column(k, f0, s, -2.2, 0, 5.4, 0.28, WHITE, NM.stone)
  fbox(b, f0, p0 - 0.5, p1 + 0.5, -2.8, 0.02, 5.4, 6.2, TRIM, NM.stone)
  b.polygon([f0.p(p0 - 0.5, -2.82, 6.2), f0.p(p1 + 0.5, -2.82, 6.2), f0.p(es, -2.82, 7.6)], TRIM, NM.stone)
  b.quad(f0.p(p0 - 0.7, -2.95, 6.15), f0.p(es, -2.95, 7.75), f0.p(es, 0.0, 7.75), f0.p(p0 - 0.7, 0.0, 6.15), '#bdb8ac', NM.stone)
  b.quad(f0.p(es, -2.95, 7.75), f0.p(p1 + 0.7, -2.95, 6.15), f0.p(p1 + 0.7, 0.0, 6.15), f0.p(es, 0.0, 7.75), '#bdb8ac', NM.stone)
  fbox(b, f0, p0 - 0.6, p1 + 0.6, -3.2, 0.02, -0.6, 0.15, '#d0ccc2', NM.stone)
  const ent = rec.entrances[mainE]
  const ns = Math.max(1, Math.round((z - ent.ground) / 0.16))
  steps(k, f0.shift(0, -3.2), p0 - 0.4, p1 + 0.4, Math.min(8, ns), Math.max(0.1, (z - ent.ground) / Math.min(8, ns)), 0.32, '#d0ccc2', NM.stone)
  k.sign(f0, es - 2.2, 4.25, 4.4, 0.62, -0.1, { text: '桜木丘天文台', sub: 'SAKURAGIOKA OBSERVATORY  1912', fg: '#3a3a3a', bg: null, font: 'serif', bold: true }, 2)
  wallLamp(k, f0, p0 - 0.8, 2.6, 'lantern')
  wallLamp(k, f0, p1 + 0.8, 2.6, 'lantern')
  // 売店「ほしぞら」の小さな看板（1 階）
  const shop = rec.tenants.find((t) => t.name.includes('ほしぞら'))
  if (shop) {
    const [ss] = f0.local(shop.x, shop.y)
    k.sign(f0, Math.min(W - 2.5, Math.max(0.5, ss - 1)), 3.25, 2.0, 0.45, -0.06, { text: '売店 ほしぞら', fg: '#f4f0e0', bg: '#1d2a4a', font: 'sans', icon: 'star' }, 2)
  }
  // 観測ドーム（屋上の中央。直径 9m。白い胴とドーム・スリット）
  if (dpart) {
    const c = ringCenter(dpart.ring)
    const r = ((dpart.diameter_m as number | undefined) ?? 9) / 2
    const base = (dpart.base_height_m as number | undefined) ?? H
    const drum = (dpart.drum_height_m as number | undefined) ?? 1.6
    const top = dpart.height ?? 14.7
    const gz = dpart.z ?? z
    b.cylinder([c[0], gz + base - LAB, -c[1]], r, drum + 0.9, 40, WHITE, NM.paint, 0.3, false)
    b.cylinder([c[0], gz + base + drum + 0.9 - LAB, -c[1]], r + 0.12, 0.12, 40, '#c8c4bb', NM.paint, 0.4, false)
    massCylinder(k, c, r, gz + base, gz + base + drum + 0.9)
    domeWithSlit(k, c, gz + base + drum + 0.9, r, top - base - drum - 0.9)
    // ドームのまわりの手すり
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2
      const a1 = ((i + 1) / 24) * Math.PI * 2
      const P = (a: number, h: number): [number, number, number] => [c[0] + Math.cos(a) * (r + 1.4), gz + base + 0.9 + h - LAB, -(c[1] + Math.sin(a) * (r + 1.4))]
      b.beam(P(a0, 1.0), P(a1, 1.0), 0.04, '#9aa0a6', NM.steel)
      b.beam(P(a0, 0), P(a0, 1.0), 0.035, '#9aa0a6', NM.steel)
    }
  }
  // プラネタリウム「星の間」（北の低いドーム）
  if (plan) {
    const c = ringCenter(plan.ring)
    const r = ((plan.outer_diameter_m as number | undefined) ?? 14) / 2
    const base = (plan.base_height_m as number | undefined) ?? 3.2
    const top = plan.height ?? 9.2
    const gz = plan.z ?? z
    b.cylinder([c[0], Math.min(rec.gLow, gz) - 0.5 - LAB, -c[1]], r, base + (gz - Math.min(rec.gLow, gz)) + 0.5, 40, WHITE, NM.stone, 0.5, false)
    b.cylinder([c[0], gz + base - 0.3 - LAB, -c[1]], r + 0.2, 0.3, 40, TRIM, NM.stone, 0, false)
    massCylinder(k, c, r, gz, gz + base)
    dome(k, c[0], c[1], gz + base, r, top - base, '#e9e7e1', NM.paint, 0.4, 36, 10)
  }
  // 屋上の西の気象観測の機器（風向風速計の柱・百葉箱・雨量計）
  const wf = faces[3].f
  const rp = wf.p(D / 2, 2.5, H + 0.9 - 0.9)
  b.beam([rp[0], rp[1], rp[2]], [rp[0], rp[1] + 5.0, rp[2]], 0.08, '#c8ccd0', NM.steel)
  b.beam([rp[0] - 0.6, rp[1] + 5.0, rp[2]], [rp[0] + 0.6, rp[1] + 5.0, rp[2]], 0.05, '#c8ccd0', NM.steel)
  b.box([rp[0] + 0.6, rp[1] + 5.1, rp[2]], [0.12, 0.25, 0.12], '#e8e8e4', NM.paint, 0.5)
  b.box([rp[0] - 0.65, rp[1] + 5.05, rp[2]], [0.35, 0.06, 0.06], '#e8e8e4', NM.paint, 0.5)
  const hy = wf.p(D / 2 - 3.5, 3.0, H)
  b.box([hy[0], hy[1] + 0.6, hy[2]], [0.06, 1.2, 0.06], '#f2f2ee', NM.paint, 0.4)
  b.box([hy[0], hy[1] + 1.55, hy[2]], [0.8, 0.7, 0.6], '#f6f6f2', NM.lattice, 0.06)
  b.box([hy[0], hy[1] + 1.95, hy[2]], [0.95, 0.08, 0.75], '#f6f6f2', NM.paint, 0.4)
  const rg = wf.p(D / 2 + 3, 3.2, H)
  b.cylinder(rg, 0.12, 0.6, 12, '#c8ccd0', NM.steel, 0, true)
  railing(k, wf, 0.5, D - 0.5, 0.4, H + 0.9, 0.9, '#9aa0a6', NM.steel, 1.8, 0)
}

/** スリットのある観測ドーム（白い半球に、頂から南へ暗い縦の帯。帯の縁の金属の枠） */
function domeWithSlit(k: Kit, c: P2, z: number, r: number, h: number) {
  const b = k.solid
  const seg = 40
  const rings = 12
  const slitAng = Math.PI * 1.5 // 南
  const half = Math.asin(0.55 / r)
  for (let i = 0; i < rings; i++) {
    const t0 = (i / rings) * (Math.PI / 2)
    const t1 = ((i + 1) / rings) * (Math.PI / 2)
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2
      const a1 = ((j + 1) / seg) * Math.PI * 2
      const mid = (a0 + a1) / 2
      let d = Math.abs(((mid - slitAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      const inSlit = d < half * 1.0 / Math.max(Math.cos(t0), 0.25) * 1.0 && i < rings - 1
      const P = (a: number, t: number): [number, number, number] => [c[0] + Math.cos(a) * Math.cos(t) * r, z + Math.sin(t) * h - LAB, -(c[1] + Math.sin(a) * Math.cos(t) * r)]
      const col = inSlit ? '#22262a' : '#eeede8'
      const mat = inSlit ? NM.dark : NM.paint
      b.quad(P(a0, t0), P(a1, t0), P(a1, t1), P(a0, t1), col, mat, 0.45)
      void d
    }
  }
  // スリットの縁の枠（2 本の弧）
  for (const side of [-1, 1]) {
    const a = slitAng + side * half * 1.1
    for (let i = 0; i < rings; i++) {
      const t0 = (i / rings) * (Math.PI / 2)
      const t1 = ((i + 1) / rings) * (Math.PI / 2)
      const P = (t: number): [number, number, number] => [c[0] + Math.cos(a) * Math.cos(t) * (r + 0.06), z + Math.sin(t) * (h + 0.06) - LAB, -(c[1] + Math.sin(a) * Math.cos(t) * (r + 0.06))]
      b.beam(P(t0), P(t1), 0.14, '#cfccc4', NM.paint, 0.5)
    }
  }
  // 遠くの形
  const n = 12
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    for (let j = 0; j < 3; j++) {
      const t0 = (j / 3) * (Math.PI / 2)
      const t1 = ((j + 1) / 3) * (Math.PI / 2)
      const P = (a: number, t: number) => [c[0] + Math.cos(a) * Math.cos(t) * r, c[1] + Math.sin(a) * Math.cos(t) * r, z + Math.sin(t) * h]
      if (j < 2) k.mass.roofQuad(P(a0, t0), P(a1, t0), P(a1, t1), P(a0, t1))
      else k.mass.roofTri(P(a0, t0), P(a1, t0), P(a0, t1))
    }
  }
}

/* -------------------------------------------------------------------------- */
/* ガーデンドーム                                                                */
/* -------------------------------------------------------------------------- */

/**
 * ガーデンドームの外観の部品（ドームのガラスと骨はドームのシェーダー infraMeshes の gardenDomeMesh）。
 * 石の基壇と白い輪・近くの白い鋼管の骨（大アーチ 16・輪 5）・南門（アーチ形の大きな入口と左右の白い列柱。開く扉）・北門・西口・頂の明かり取り
 */
/** ガーデンドームの張り出しの入口の、奥の壁（ドームの中へ抜ける）の開口の大きさ（中の決まりと同じ） */
export const GATE_INNER = { main: { w: 7.0, ht: 6.0 }, side: { w: 3.4, ht: 3.2 } }
/** 南門の前の石段の踏み面 */
export const GATE_STEP_RUN = 0.42

export function gardenDome(k: Kit, ctx: KitContext) {
  const rec = k.rec
  const c = ringCenter(rec.ring)
  const R = rec.ring.reduce((m, q) => m + Math.hypot(q[0] - c[0], q[1] - c[1]), 0) / rec.ring.length
  const z = rec.z
  const Hh = rec.height ?? 48
  const b = k.solid
  k.mass.st = { wall: [216, 216, 210], facade: 5, roof: [200, 200, 196], roofKind: ROOF.flat, use: 6, flags: 1, seed: k.seed, style: 0, floors: 1 }
  // 基壇（石の円筒の帯）と白い鋼の輪。入口の張り出しの所は切る（張り出しの中を、基壇の円筒が横切らないように。中のある建物）。
  // 上のふたは作らない（ふたがあるとドームの中を作ったときに、根の階の上に 2.65m の天井ができていた）
  const bottom = Math.min(rec.gLow, z) - 0.6
  const m4 = new THREE.Matrix4().makeTranslation(c[0], 0, -c[1])
  // lathe の角度: x = sin a・z = cos a（南 = 0、北 = π、西 = 3π/2）
  const gaps = rec.entrances.map((e) => {
    const ang = Math.atan2(e.y - c[1], e.x - c[0])
    const la = (Math.atan2(Math.cos(ang), -Math.sin(ang)) + Math.PI * 2) % (Math.PI * 2)
    const half = ((e.kind === 'main' ? 9 : 4.5) / 2 + 0.8 + 0.15) / (R + 0.6)
    return [la - half, la + half] as [number, number]
  })
  const spans: [number, number][] = []
  {
    const sorted = gaps.map(([g0, g1]) => {
      const a0 = (g0 + Math.PI * 2) % (Math.PI * 2)
      return [a0, a0 + (g1 - g0)] as [number, number]
    }).sort((p, q) => p[0] - q[0])
    for (let i = 0; i < sorted.length; i++) {
      const s0 = sorted[i][1]
      const s1 = i + 1 < sorted.length ? sorted[i + 1][0] : sorted[0][0] + Math.PI * 2
      if (s1 > s0) spans.push([s0, s1])
    }
    if (!sorted.length) spans.push([0, Math.PI * 2])
  }
  for (const [a0, a1] of spans) {
    const seg = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 64))
    b.lathe([[R + 0.6, bottom - LAB], [R + 0.6, z + 3.0 - LAB]], seg, m4, '#8c8578', NM.stone, 0.6, true, a0, a1)
    b.lathe([[R + 0.75, z + 2.4 - LAB], [R + 0.75, z + 2.65 - LAB]], seg, m4, '#9a9386', NM.stone, 0, true, a0, a1)
    b.lathe([[R + 0.3, z + 2.65 - LAB], [R + 0.3, z + 3.1 - LAB]], seg, m4, '#e2e2dc', NM.paint, 0.6, true, a0, a1)
  }
  massCylinder(k, c, R + 0.6, z, z + 3.0)
  // 白い鋼管の骨（近くだけ。ドームのシェーダーの骨の少し外）: 大アーチ 16 本・水平の輪 5 本
  const domeAt = (a: number, t: number, off = 0.25): [number, number, number] => [c[0] + Math.cos(a) * Math.cos(t) * (R + off), z - 0.5 + Math.sin(t) * (Hh + off) - LAB, -(c[1] + Math.sin(a) * Math.cos(t) * (R + off))]
  const ribs = 16
  const segs = 14
  // 入口の張り出しの上に降りる骨は、張り出しの屋根の上で止める（張り出しの中を骨が通らないように）
  const roofOver = (a: number) => {
    for (const e of rec.entrances) {
      const ang = Math.atan2(e.y - c[1], e.x - c[0])
      const d = Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)))
      if (d < 0.12) return (e.kind === 'main' ? 7.5 : 3.6) + 2.3
    }
    return -Infinity
  }
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2
    const minH = roofOver(a)
    for (let j = 0; j < segs; j++) {
      const t0 = (j / segs) * (Math.PI / 2) * 0.97 + 0.06
      const t1 = ((j + 1) / segs) * (Math.PI / 2) * 0.97 + 0.06
      if (Math.sin(t1) * Hh - 0.5 < minH) continue
      b.beam(domeAt(a, t0), domeAt(a, t1), 0.55, '#f2f2ee', NM.paint, 0.55, 0.55)
    }
  }
  for (let r = 1; r <= 5; r++) {
    const t = (r / 6) * (Math.PI / 2)
    const n = 48
    for (let i = 0; i < n; i++) b.beam(domeAt((i / n) * Math.PI * 2, t, 0.3), domeAt(((i + 1) / n) * Math.PI * 2, t, 0.3), 0.4, '#f2f2ee', NM.paint, 0.55, 0.4)
  }
  // 頂の明かり取り
  b.cylinder([c[0], z + Hh - 0.6 - LAB, -c[1]], 4.2, 1.6, 24, '#e8e8e2', NM.paint, 0.5, false)
  b.cylinder([c[0], z + Hh + 1.0 - LAB, -c[1]], 4.6, 0.35, 24, '#cfd6d4', NM.paint, 0.5, true, 3.6)
  // 入口（データの入口の向きに。南門は大きなアーチと列柱）
  rec.entrances.forEach((e, idx) => {
    const ang = Math.atan2(e.y - c[1], e.x - c[0])
    const main = e.kind === 'main'
    const w = main ? 9 : 4.5
    const h = main ? 7.5 : 3.6
    const depth = main ? 7 : 4
    const ex = c[0] + Math.cos(ang) * (R - 1.5)
    const ey = c[1] + Math.sin(ang) * (R - 1.5)
    // 入口の面: 外向き = ang の向き
    const bearing = (90 - (ang * 180) / Math.PI + 360) % 360
    const f = Frame.facing(ex + Math.cos(ang) * depth, ey + Math.sin(ang) * depth, bearing, z).shift(-w / 2 - 0.8, 0)
    const fw = w + 1.6
    // 張り出しの箱（石の壁）と、アーチの開口（ガラスの扉）
    const door: Opening = { s: 0.8, h: 0, w, ht: h, shape: main ? 'arch' : 'rect', depth: 0.5, fill: 'door', door: { kind: 'doubleGlass', color: '#e8e8e2', transom: main ? 0 : 0.6, operable: idx, glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.night } } }
    const ring = [f.plan(0, 0), f.plan(fw, 0), f.plan(fw, depth + 2), f.plan(0, depth + 2)]
    // 奥の壁（ドームの中の側）の開口: 張り出しの入口の間からドームの中へ抜ける（中の決まりの開口と同じ大きさ。interior/briefs/dome.ts の GATES）
    const inner = GATE_INNER[main ? 'main' : 'side']
    const back: Opening = { s: fw / 2 - inner.w / 2, h: 0, w: inner.w, ht: inner.ht, depth: 0.3, fill: 'void' }
    buildBody(k, { ring, z, bottom: Math.min(rec.gLow, z) - z - 0.5, floors: 1, floorH: h + 1.5, top: h + 1.5, wall: { color: '#e9e6de', mat: NM.stone, aux: 0.6 }, faces: [{ win: null, bay: 4, openings: [door], minLen: 0 }, null, { win: null, bay: 4, openings: [back], minLen: 0 }, null], frontEdge: 0, cornice: { ht: 0.5, proj: 0.25, color: '#f2f2ee', mat: NM.paint } })
    // 南門の前の石段（広場は床より低い。データの入口の地面まで）
    const drop = z - e.ground
    if (main && drop > 0.1) {
      const n = Math.max(1, Math.round(drop / 0.165))
      steps(k, f, -0.4, fw + 0.4, n, drop / n, GATE_STEP_RUN, '#cfc9bc', NM.granite)
    }
    flatRoof(k, ring, z, h + 1.5 + 0.4, 0.4, '#e9e6de', NM.stone, '#9a9890', '#f2f2ee')
    windowTrims(k, f, door, { w, ht: h, sill: 0, shape: door.shape, lintel: { color: '#f2f2ee', mat: NM.paint, keystone: main } })
    if (main) {
      // 左右の白い列柱（3 本ずつ）とその上の梁
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const s = side < 0 ? -1.2 - i * 2.4 : fw + 1.2 + i * 2.4
        column(k, f, s, -1.5, Math.min(0, -(z - e.ground) - 0.25), 8.4, 0.38, '#f4f4f0', NM.paint)
      }
      fbox(b, f, -7, fw + 7, -2.2, -0.8, 8.4, 9.2, '#f4f4f0', NM.paint, 0.5)
      k.sign(f, fw / 2 - 4, h + 0.25, 8, 0.9, -0.08, { text: 'ガーデンドーム', sub: 'GARDEN DOME  公開ラボ 第一種 第1号', fg: '#2f4a3e', bg: null, font: 'sans', bold: true }, 2)
      for (const s of [-0.4, fw + 0.4]) wallLamp(k, f, s, 3.0, 'lantern')
    } else wallLamp(k, f, fw + 0.3, 2.6, 'bulb')
    // 扉の中の暗い奥（中を作ったら隠す）
    fbox(k.temp, f, 0.8, 0.8 + w, 0.8, depth + 1.8, 0, h, '#141a16', NM.dark)
    void ctx
  })
}
