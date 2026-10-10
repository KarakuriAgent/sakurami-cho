import * as THREE from 'three'
import { ROOF } from '../../town/buildingKit'
import type { P2 } from '../../town/townData'
import { Frame, type V3 } from '../frame'
import {
  awning,
  band,
  canopy,
  dome,
  dormer,
  fbox,
  gableRoof,
  hipBand,
  type GlassSpec,
  type Kit,
  type Opening,
  pilaster,
  type RoofStyle,
  spire,
  steps,
  wallLamp,
} from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import { column, pot, railing } from '../parts'
import { buildBody, type FaceSpec, type WinSpec, windowTrims } from '../shell'
import { signAtlas } from '../signs'
import { frontFace } from './shops'

/**
 * 駅の組み立ての型: 桜見駅（赤煉瓦と白い石の帯・中央の時計塔と緑青のドーム・ガラスと緑の鉄骨の大庇・両翼の寄棟と端の塔屋）、
 * Café Platform 1872（駅舎の右翼の角の平屋・深緑の日よけ・テラスのパラソル・混雑表示のパネル）、北口駅舎、ケーブルの 3 駅、鐘ヶ丘駅
 */

const LAB = 116
const BRICK = '#a8452f'
const STONE = '#ece2cc'
const COPPER = '#5b9a84'
const GREEN = '#2f5a46'

/** 局所の長方形（面 F の s0〜s1・t0〜t1）の平面の外形（反時計回り）。辺 0 = 正面（t0）・1 = 右（s1）・2 = 裏（t1）・3 = 左（s0） */
export function localRect(F: Frame, s0: number, s1: number, t0: number, t1: number): P2[] {
  return [F.plan(s0, t0), F.plan(s1, t0), F.plan(s1, t1), F.plan(s0, t1)]
}

/** 長方形の胴（面ごとの決まり: [正面, 右, 裏, 左]） */
function rectBody(k: Kit, F: Frame, s0: number, s1: number, t0: number, t1: number, z: number, bottom: number, top: number, floors: number, floorH: number, groundH: number, faces: (FaceSpec | null)[], extra: Partial<Parameters<typeof buildBody>[1]> = {}) {
  return buildBody(k, { ring: localRect(F, s0, s1, t0, t1), z, bottom, floors, floorH, groundH, top, wall: { color: BRICK, mat: NM.brick }, faces, frontEdge: 0, windowTop: top - 0.6, ...extra })
}

const stoneTrim = { color: STONE, mat: NM.stone }
const archWin = (w: number, ht: number, sill: number, kind: number = GLASS.office, cls: number = LIGHT_CLASS.office): WinSpec => ({ w, ht, sill, shape: 'arch', depth: 0.32, glass: { kind, cls, cols: 2, rows: 3, bar: 0.04, frame: '#f2eee4', depth: 6 }, sillTrim: stoneTrim, lintel: { ...stoneTrim, keystone: true } })
const rectWin = (w: number, ht: number, sill: number): WinSpec => ({ w, ht, sill, depth: 0.3, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 3, bar: 0.04, frame: '#f2eee4', depth: 6 }, sillTrim: stoneTrim, lintel: { ...stoneTrim, keystone: true } })

/* -------------------------------------------------------------------------- */
/* 桜見駅                                                                     */
/* -------------------------------------------------------------------------- */

export function station(k: Kit) {
  const rec = k.rec
  const ring = rec.ring
  // 正面の辺（北東の端 → 南西）: s = 0（北東）〜 110（南西の角。Café の外の角）、t = 奥へ（南東）
  const G = rec.z
  const raised = (rec.extra.raised_base_m as number | undefined) ?? 1.5
  const z = G + raised
  // 高さは床（地面 + 基壇 1.5m）から
  const F = Frame.edge(ring[6], ring[0], z)
  const bottom = -raised - 0.4
  const eave = 10.0 // 両翼の軒（床から。地面から 11.5m）
  const g1 = 5.2
  const g2 = eave - g1
  const depth = 36
  const b = k.solid
  k.mass.st = { wall: [181, 70, 47], facade: 3, roof: [79, 143, 122], roofKind: ROOF.hip, use: 6, flags: 1, seed: k.seed, style: 2, floors: 2 }
  const wingFront = (bayW: number): FaceSpec => ({ win: rectWin(1.4, 2.5, 0.9), groundWin: archWin(1.7, 3.3, 0.8), bay: bayW, minLen: 1 })
  const wingSide: FaceSpec = { win: rectWin(1.3, 2.4, 0.9), groundWin: archWin(1.5, 3.1, 0.8), bay: 3.6, minLen: 1 }
  const back: FaceSpec = { win: rectWin(1.3, 2.3, 0.9), groundWin: rectWin(1.6, 2.8, 0.6), bay: 4.0, minLen: 1 }
  const roof: RoofStyle = { color: COPPER, mat: NM.copper, aux: 0.5, eave: 0.6, verge: 0.4, thick: 0.25, soffit: '#d9cfba', fascia: STONE, gutter: '#4b6f62' }
  const common = { plinth: { ht: 0.5, color: '#9a948a', mat: NM.granite, proj: 0.08 }, bands: { hs: [g1 - 0.1], ht: 0.32, proj: 0.08, ...stoneTrim }, cornice: { ht: 0.75, proj: 0.3, ...stoneTrim }, quoins: stoneTrim }
  // 左翼（北東）: s 0〜41
  const left = rectBody(k, F, 0, 41, 0, depth, z, bottom, eave, 2, g2, g1, [wingFront(3.5), null, back, { ...wingSide, doors: [{ s: depth - 17.96, w: 2.2, ht: 3.4, style: { kind: 'doubleGlass', color: GREEN }, lamp: 'gas', canopy: { color: '#2f3b36', mat: NM.paint, depth: 1.4 } }] }], common)
  // 右翼（南西）: s 69〜94（正面）と、Café の奥 s 94〜110・t 14〜36
  const right = rectBody(k, F, 69, 94, 0, depth, z, bottom, eave, 2, g2, g1, [wingFront(3.5), null, back, null], common)
  const rightBack = rectBody(k, F, 94, 110, 14, depth, z, bottom, eave, 2, g2, g1, [{ win: rectWin(1.3, 2.4, 0.9), groundWin: null, bay: 3.5, minLen: 1 }, wingSide, back, null], common)
  // 中央部（3 階・地面から 16m）: s 41〜69。正面に 3 つの入口と高さ 9m の半円窓
  const cTop = 14.5
  const doorsC = [46, 55, 64].map((s) => ({ s, w: 3.0, ht: 4.4, shape: 'arch' as const, style: { kind: 'doubleGlass' as const, color: GREEN, transom: 1.6, glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.night } } }))
  const bigArch: Opening = { s: 50.5 - 41, h: 5.0, w: 9.0, ht: 9.0, shape: 'arch', depth: 0.45, glass: { kind: GLASS.stained, cls: LIGHT_CLASS.night, cols: 6, rows: 4, bar: 0.07, frame: '#2f4a3e', depth: 30 } }
  const center = rectBody(k, F, 41, 69, 0, depth, z, bottom, cTop, 3, 4.6, g1, [
    { win: null, bay: 4, doors: doorsC.map((d) => ({ ...d, s: d.s - 41, steps: 0, lamp: null })), openings: [bigArch], minLen: 1 },
    { win: rectWin(1.3, 2.4, 0.9), bay: 3.5, minLen: 1, ground: 'none' },
    back,
    { win: rectWin(1.3, 2.4, 0.9), bay: 3.5, minLen: 1, ground: 'none' },
  ], { ...common, bands: { hs: [g1 - 0.1, 9.6], ht: 0.32, proj: 0.08, ...stoneTrim } })
  void left
  void right
  void rightBack
  // 大きな半円窓の迫石と、入口の額・付け柱
  const fc = center[0].f
  b.ao = 1
  windowTrims(k, fc, bigArch, { w: 9, ht: 9, sill: 5, shape: 'arch', sillTrim: stoneTrim, lintel: { ...stoneTrim, keystone: true } })
  for (const d of doorsC) {
    const o: Opening = { s: d.s - 41 - d.w / 2, h: 0, w: d.w, ht: d.ht, shape: 'arch' }
    windowTrims(k, fc, o, { w: d.w, ht: d.ht, sill: 0, shape: 'arch', lintel: { ...stoneTrim, keystone: true } })
  }
  for (const s of [0.4, 27.6]) pilaster(k, fc, s, 1.1, 0, cTop, 0.25, STONE, NM.stone, 0.6)
  for (const s of [9.0, 19.0]) pilaster(k, fc, s, 0.7, 0, cTop - 0.8, 0.18, BRICK, NM.brick)
  // 中央部の屋根: 正面の妻（ペディメント）の切妻（棟は奥へ）。妻の三角に丸窓
  const cr = F.shift(41, 0).turnRight(28)
  gableRoof(k, new Frame(...cr.plan(0, 0), cr.ax, cr.ay, z), depth, 28, cTop, cTop + 4.2, { ...roof, eave: 0.7, verge: 0.6, gable: { color: BRICK, mat: NM.brick, openings: [[], [{ s: 14 - 1.1, h: cTop + 0.9, w: 2.2, ht: 2.2, shape: 'round', depth: 0.3, glass: { kind: GLASS.dark, cls: LIGHT_CLASS.night, cols: 4, rows: 4, bar: 0.06 } }]] } })
  // ペディメントの縁（白い石）
  const ped = F.shift(41, 0)
  b.beam(ped.p(-0.5, -0.35, cTop + 0.05), ped.p(14, -0.35, cTop + 4.2 + 0.15), 0.4, STONE, NM.stone, 0, 0.35)
  b.beam(ped.p(28.5, -0.35, cTop + 0.05), ped.p(14, -0.35, cTop + 4.2 + 0.15), 0.4, STONE, NM.stone, 0, 0.35)
  band(k, ped, 0, 28, cTop - 0.1, 0.4, 0.35, STONE, NM.stone)
  // 両翼の屋根（緑青の寄棟。軒から 6m の斜面と平らな上）と屋根窓
  const hip = (s0: number, s1: number, t0: number, t1: number) => {
    const f = F.shift(s0, t0)
    hipBand(k, f, s1 - s0, t1 - t0, eave, eave + 4.6 * (((t1 - t0) / 2) / 6.5), eave + 4.6, roof)
  }
  hip(0, 41, 0, depth)
  hip(69, 94, 0, depth)
  hip(94, 110, 14, depth)
  for (const s of [9, 16, 23, 30]) dormer(k, F, s, 1.9, eave + 1.0, 1.5, 1.2, BRICK, NM.brick, roof, { kind: GLASS.dark, cls: LIGHT_CLASS.office, cols: 2, rows: 2, bar: 0.04, frame: '#f2eee4' })
  for (const s of [74, 81]) dormer(k, F, s, 1.9, eave + 1.0, 1.5, 1.2, BRICK, NM.brick, roof, { kind: GLASS.dark, cls: LIGHT_CLASS.office, cols: 2, rows: 2, bar: 0.04, frame: '#f2eee4' })
  // 端の塔屋（6m 角。両翼の屋根の上へ 13.5m まで、小さなドーム、頂 17m）
  const turret = (s0: number) => {
    const f = F.shift(s0, 0)
    const tz0 = eave - 0.2
    const tTop = 13.5 - raised + 0.0
    rectBody(k, f, 0, 6, 0, 6, z, tz0, tTop + 1.0, 1, 3, 3, [0, 1, 2, 3].map(() => ({ win: { w: 1.0, ht: 1.8, sill: 0.6, shape: 'arch' as const, depth: 0.3, glass: { kind: GLASS.dark, cls: LIGHT_CLASS.night, cols: 1, rows: 3, bar: 0.04, frame: '#f2eee4' }, lintel: { ...stoneTrim, keystone: false } }, bay: 3, minLen: 1 })), { cornice: { ht: 0.6, proj: 0.25, ...stoneTrim }, quoins: stoneTrim, bands: undefined, plinth: undefined })
    const c = f.plan(3, 3)
    dome(k, c[0], c[1], z + tTop + 1.0, 2.7, 2.4, COPPER, NM.copper, 0.35, 20, 7)
    k.solid.cylinder([c[0], z + tTop + 3.3 - LAB, -c[1]], 0.35, 0.9, 10, COPPER, NM.copper, 0.3, true, 0.25)
    spire(k, c[0], c[1], G + 16.2, 0.2, 0.8, 6, '#c9a046', NM.gold)
  }
  turret(0)
  turret(87.5)
  // 時計塔（10m 角。中央部の上から。4 面の時計・緑青のドームと頂の小塔）
  const tw = F.shift(50, 1)
  const towerTop = 25.5 - raised
  rectBody(k, tw, 0, 10, 0, 10, z, cTop - 0.5, towerTop, 1, 4, 4, [0, 1, 2, 3].map(() => ({ win: { w: 1.1, ht: 2.6, sill: cTop + 0.6, shape: 'arch' as const, depth: 0.35, glass: { kind: GLASS.dark, cls: LIGHT_CLASS.night, cols: 1, rows: 3, bar: 0.05, frame: '#f2eee4' }, lintel: { ...stoneTrim, keystone: true } }, bay: 5, minLen: 1, ground: 'windows' as const, groundWin: { w: 1.1, ht: 2.6, sill: cTop + 0.6, shape: 'arch' as const, depth: 0.35, glass: { kind: GLASS.dark, cls: LIGHT_CLASS.night, cols: 1, rows: 3, bar: 0.05, frame: '#f2eee4' }, lintel: { ...stoneTrim, keystone: true } } })), { cornice: { ht: 0.9, proj: 0.4, ...stoneTrim }, quoins: stoneTrim, bands: { hs: [cTop + 4.0], ht: 0.3, proj: 0.1, ...stoneTrim }, plinth: undefined })
  // 時計（各面の上の方。直径 3.2m。白い石の輪）
  const clockH = towerTop - 2.6
  const faces: Frame[] = [tw, tw.turnRight(10), new Frame(...tw.plan(10, 10), -tw.ax, -tw.ay, z), new Frame(...tw.plan(0, 10), tw.nx, tw.ny, z)]
  const dial = signAtlas.clockRegion(512)
  for (const f of faces) {
    const c = f.p(5, -0.12, clockH)
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...f.out), new THREE.Vector3(0, 1, 0))
    void m
    // 石の輪（16 角の帯）
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2
      const a1 = ((i + 1) / 16) * Math.PI * 2
      const P = (a: number, r: number, t: number): V3 => f.p(5 + Math.cos(a) * r, t, clockH + Math.sin(a) * r)
      b.quad(P(a0, 1.6, -0.1), P(a1, 1.6, -0.1), P(a1, 1.95, -0.1), P(a0, 1.95, -0.1), STONE, NM.stone)
      b.quad(P(a0, 1.95, -0.1), P(a1, 1.95, -0.1), P(a1, 1.95, 0.02), P(a0, 1.95, 0.02), STONE, NM.stone)
    }
    if (dial) k.signs.quad(f.p(3.4, -0.11, clockH - 1.6), f.p(6.6, -0.11, clockH - 1.6), f.p(6.6, -0.11, clockH + 1.6), f.p(3.4, -0.11, clockH + 1.6), dial, 3)
    k.clocks.push({ center: c, out: f.out, radius: 1.55 })
    k.lights.push({ x: c[0], y: -c[2], z: c[1] + LAB, kind: 7, color: '#fff1d6', size: 2.8, power: 1.2, seed: 0 })
  }
  // ドーム（八角の胴・緑青のドーム・頂の小塔と飾り）
  const tc = tw.plan(5, 5)
  k.solid.cylinder([tc[0], z + towerTop + 0.9 - LAB, -tc[1]], 3.6, 1.4, 8, BRICK, NM.brick, 0, false)
  band(k, tw, 1.2, 8.8, towerTop + 0.9, 0.01, 0.01, STONE, NM.stone)
  dome(k, tc[0], tc[1], z + towerTop + 2.3, 3.7, 3.6, COPPER, NM.copper, 0.35, 24, 9)
  k.solid.cylinder([tc[0], z + towerTop + 5.7 - LAB, -tc[1]], 0.75, 1.3, 8, COPPER, NM.copper, 0.3, true, 0.6)
  spire(k, tc[0], tc[1], z + towerTop + 7.0, 0.6, 1.0, 8, COPPER, NM.copper, 0.3)
  k.solid.cylinder([tc[0], z + towerTop + 7.9 - LAB, -tc[1]], 0.05, 1.0, 6, '#c9a046', NM.gold, 0, true)
  // 隅の小さな尖塔（4 隅）
  for (const [s, t] of [
    [0.6, 0.6],
    [9.4, 0.6],
    [9.4, 9.4],
    [0.6, 9.4],
  ]) {
    const p = tw.plan(s, t)
    k.solid.cylinder([p[0], z + towerTop + 0.8 - LAB, -p[1]], 0.45, 1.0, 8, STONE, NM.stone, 0, true)
    spire(k, p[0], p[1], z + towerTop + 1.8, 0.45, 1.6, 8, COPPER, NM.copper, 0.3)
  }
  // 大庇（ガラスと緑の鉄骨のアーチ。s 40〜70・t −8.5〜0。柱は緑の鋳鉄）
  const ca0 = 40
  const ca1 = 70
  const ct0 = -8.5
  const spanW = ca1 - ca0
  const archAt = (u: number) => {
    // u = 0〜1（左から右）。両端 5.2m、真ん中 7.5m（地面から）
    const x = u * 2 - 1
    return G + 5.2 + (7.5 - 5.2) * Math.sqrt(Math.max(0, 1 - x * x))
  }
  const ribs = 7
  const NSEG = 16
  for (let r = 0; r <= ribs; r++) {
    const t = ct0 + (r / ribs) * (-ct0 - 0.2)
    for (let i = 0; i < NSEG; i++) {
      const u0 = i / NSEG
      const u1 = (i + 1) / NSEG
      b.beam(F.p(ca0 + u0 * spanW, t, archAt(u0) - z), F.p(ca0 + u1 * spanW, t, archAt(u1) - z), 0.18, GREEN, NM.paint, 0.5, 0.28)
    }
  }
  // 縦の桁（アーチの頂・肩）と、ガラス
  for (const u of [0, 0.15, 0.32, 0.5, 0.68, 0.85, 1]) b.beam(F.p(ca0 + u * spanW, ct0, archAt(u) - z + 0.1), F.p(ca0 + u * spanW, -0.2, archAt(u) - z + 0.1), 0.14, GREEN, NM.paint, 0.5, 0.2)
  for (let i = 0; i < NSEG; i++) {
    const u0 = i / NSEG
    const u1 = (i + 1) / NSEG
    k.clear.quad(F.p(ca0 + u0 * spanW, ct0, archAt(u0) - z + 0.12), F.p(ca0 + u1 * spanW, ct0, archAt(u1) - z + 0.12), F.p(ca0 + u1 * spanW, -0.2, archAt(u1) - z + 0.12), F.p(ca0 + u0 * spanW, -0.2, archAt(u0) - z + 0.12), '#ffffff', 0)
  }
  // 正面のアーチの縁の飾り（扇の桟）と柱
  for (let i = 0; i < 9; i++) {
    const u = 0.1 + (i / 8) * 0.8
    b.beam(F.p(ca0 + spanW / 2, ct0 - 0.05, G + 5.2 - z), F.p(ca0 + u * spanW, ct0 - 0.05, archAt(u) - z), 0.06, GREEN, NM.paint, 0.5)
  }
  b.beam(F.p(ca0, ct0 - 0.05, G + 5.2 - z), F.p(ca1, ct0 - 0.05, G + 5.2 - z), 0.25, GREEN, NM.paint, 0.5, 0.35)
  for (const s of [ca0 + 0.3, ca0 + 7.7, ca0 + 15, ca0 + 22.3, ca1 - 0.3]) {
    const p = F.p(s, ct0 + 0.3, -raised)
    b.cylinder(p, 0.2, raised + 5.2, 12, GREEN, NM.paint, 0.5, false)
    b.cylinder(p, 0.36, 0.5, 12, GREEN, NM.paint, 0.5, true)
    b.cylinder([p[0], p[1] + raised + 4.9, p[2]], 0.18, 0.3, 12, GREEN, NM.paint, 0.5, true, 0.42)
  }
  // 大庇の下の灯り（ペンダントの白い球）
  for (const s of [44, 49, 55, 61, 66]) {
    const p = F.p(s, -4.5, G + 4.6 - z)
    k.glow.box(p, [0.32, 0.32, 0.32], '#fff1d8', 0, 2.6)
    k.solid.beam([p[0], p[1] + 0.16, p[2]], [p[0], p[1] + 1.4, p[2]], 0.02, '#1e1e1e', NM.iron)
    k.lamp(p, 9, '#ffd8a0', 2.2, 0.5, 1)
  }
  // 正面の石段（11 段。大庇の下）
  steps(k, F.shift(ca0 - 2, 0), 0, spanW + 4, 11, raised / 11, 0.34, '#a7a198')
  // 駅名（大庇の上の幕板と、中央部の壁の金の字）
  k.sign(F, 49.0, 10.6 - raised + 0.0, 12, 1.0, -0.36, { text: '桜見駅', sub: 'SAKURAMI STATION  1872', fg: '#e8c870', bg: null, font: 'serif', bold: true }, 2)
  // 中の店の小さな看板（1 階の窓の上）
  const tenantSigns = rec.tenants.filter((t) => t.floor === 1)
  tenantSigns.forEach((t) => {
    const [s, tt] = F.local(t.x, t.y)
    if (tt > 20 || s < 2 || s > 92 || (s > 40 && s < 70)) return
    k.sign(F, s - 1.1, g1 - 0.75, 2.2, 0.4, -0.12, { text: t.name.replace(/^駅舎|^弁当\s*/, ''), fg: '#f2ead6', bg: GREEN, font: 'serif' }, 2)
  })
  // 夜の投光器（正面の両翼と中央・時計塔を下から）
  for (const s of [12, 30, 48, 62, 80]) k.flood(F.p(s, -5, -raised), 26, '#ffd8a8', 1.5)
  // 駅前広場の街灯（緑の鉄・ガス灯風・てっぺんに花籠）・石のプランター・黒い車止め
  for (const s of [30, 38, 72, 80]) gasLamp(k, F, s, -11.5, -raised)
  for (const s of [34, 76]) planter(k, F, s, -10, -raised)
  for (let s = 28; s <= 82; s += 3) {
    if (s > 39 && s < 71) continue
    const p = F.p(s, -9.2, -raised)
    b.cylinder(p, 0.11, 0.9, 10, '#1d1d1c', NM.iron, 0.5, true, 0.09)
  }
}

/** 駅前のガス灯風の街灯（緑の鉄の柱・灯具・てっぺんの花籠） */
function gasLamp(k: Kit, F: Frame, s: number, t: number, h: number) {
  const b = k.solid
  const p = F.p(s, t, h)
  b.cylinder(p, 0.28, 0.6, 12, '#2a4a3a', NM.iron, 0.5, true, 0.18)
  b.cylinder([p[0], p[1] + 0.6, p[2]], 0.09, 3.4, 10, '#2a4a3a', NM.iron, 0.5, false)
  b.cylinder([p[0], p[1] + 4.0, p[2]], 0.22, 0.1, 10, '#2a4a3a', NM.iron, 0.5, true)
  k.glow.cylinder([p[0], p[1] + 4.1, p[2]], 0.2, 0.55, 8, '#fff1d6', 0, 2.8, true, 0.26)
  b.cylinder([p[0], p[1] + 4.65, p[2]], 0.3, 0.12, 8, '#2a4a3a', NM.iron, 0.5, true, 0.05)
  // 花籠
  b.cylinder([p[0], p[1] + 3.2, p[2]], 0.38, 0.28, 10, '#3a2a1e', NM.wood, 0, true, 0.45)
  b.box([p[0], p[1] + 3.6, p[2]], [0.95, 0.5, 0.95], '#4f7a34', NM.leaf, 0, 0.4)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    b.box([p[0] + Math.cos(a) * 0.4, p[1] + 3.75, p[2] + Math.sin(a) * 0.4], [0.22, 0.18, 0.22], ['#e85a7a', '#f2d14b', '#ffffff', '#c0392b', '#b07ad0'][i], NM.cloth)
  }
  k.lamp([p[0], p[1] + 4.3, p[2]], 9, '#ffcf90', 2.4, 0.7, 1)
}

/** 石のプランター（花） */
function planter(k: Kit, F: Frame, s: number, t: number, h: number) {
  fbox(k.solid, F, s - 0.7, s + 0.7, t - 0.7, t + 0.7, h, h + 0.75, '#b9b2a4', NM.stone, 0.4)
  fbox(k.solid, F, s - 0.6, s + 0.6, t - 0.6, t + 0.6, h + 0.75, h + 1.15, '#4f7a34', NM.leaf)
  for (let i = 0; i < 6; i++) fbox(k.solid, F, s - 0.5 + (i % 3) * 0.35, s - 0.3 + (i % 3) * 0.35, t - 0.4 + Math.floor(i / 3) * 0.5, t - 0.2 + Math.floor(i / 3) * 0.5, h + 1.1, h + 1.3, ['#e85a7a', '#f2d14b', '#ffffff'][i % 3], NM.cloth)
}

/* -------------------------------------------------------------------------- */
/* Café Platform 1872                                                          */
/* -------------------------------------------------------------------------- */

export function cafePlatform(k: Kit) {
  const rec = k.rec
  // 駅舎と同じ正面の向き。Café の外形: 局所 s 0〜16（北東 → 南西）、t 0〜14
  const ring = rec.ring
  const F = Frame.edge(ring[2], ring[3], rec.z) // (-696.8,-1401.3) → (-708.1,-1412.7) の正面
  const W = Math.hypot(ring[3][0] - ring[2][0], ring[3][1] - ring[2][1])
  const D = 14
  const z = rec.z
  const eave = rec.height ?? 8.0
  const b = k.solid
  const main = rec.entrances.findIndex((e) => e.kind === 'main')
  const [ds] = F.local(rec.entrances[main].x, rec.entrances[main].y)
  k.mass.st = { wall: [181, 70, 47], facade: 3, roof: [79, 143, 122], roofKind: ROOF.hip, use: 2, flags: 1 | 16, seed: k.seed, style: 2, floors: 1 }
  const gl: GlassSpec = { kind: GLASS.cafe, cls: LIGHT_CLASS.shop, cols: 3, rows: 3, bar: 0.05, frame: GREEN, depth: 12, yC: 6.5 }
  const winArch = (s: number, w: number): Opening => ({ s, h: 0.65, w, ht: 5.0, shape: 'arch', depth: 0.38, glass: gl })
  const door: Opening = { s: ds - 0.95, h: 0, w: 1.9, ht: 3.6, shape: 'arch', depth: 0.38, fill: 'door', door: { kind: 'doubleGlass', color: GREEN, transom: 1.0, operable: main, glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.shop } } }
  const frontOps = [winArch(0.9, 2.6), winArch(4.4, 2.6), door, winArch(ds + 1.95, 2.6), winArch(ds + 5.45, 2.6)].filter((o) => o.s + o.w < W - 0.5)
  const sideOps = [winArch(1.2, 2.6), winArch(5.0, 2.6), winArch(8.8, 2.6)]
  const ringL = localRect(F, 0, W, 0, D)
  const faces = buildBody(k, {
    ring: ringL,
    z,
    bottom: Math.min(rec.gLow, z) - z - 0.4,
    floors: 1,
    floorH: eave,
    top: eave,
    wall: { color: BRICK, mat: NM.brick },
    plinth: { ht: 0.6, color: '#9a948a', mat: NM.granite, proj: 0.08 },
    cornice: { ht: 0.7, proj: 0.28, ...stoneTrim },
    quoins: stoneTrim,
    bands: { hs: [5.9], ht: 0.28, proj: 0.07, ...stoneTrim },
    faces: [{ win: null, bay: 3, openings: frontOps, minLen: 1 }, { win: null, bay: 3, openings: sideOps, minLen: 1 }, null, null],
    frontEdge: 0,
    windowTop: 5.5,
  })
  for (const [i, ops] of [
    [0, frontOps],
    [1, sideOps],
  ] as [number, Opening[]][])
    for (const o of ops) windowTrims(k, faces[i].f, o, { w: o.w, ht: o.ht, sill: o.h, shape: 'arch', sillTrim: o.fill ? null : stoneTrim, lintel: { ...stoneTrim, keystone: true } })
  // 屋根（緑青の寄棟。軒 8m → 11.5m）
  hipBand(k, F, W, D, eave, eave + 3.5 * ((D / 2) / 5.5), eave + 3.5, { color: COPPER, mat: NM.copper, aux: 0.5, eave: 0.55, thick: 0.22, soffit: '#d9cfba', fascia: STONE, gutter: '#4b6f62' })
  // 深緑の日よけテント（正面・横）と、入口の上の混雑表示のパネル・店名
  const f0 = faces[0].f
  const f1 = faces[1].f
  awning(k, f0, 0.5, ds - 1.2, 4.0, 1.9, 0.35, '#1f4a36', 0)
  awning(k, f0, ds + 1.2, W - 0.5, 4.0, 1.9, 0.35, '#1f4a36', 0)
  awning(k, f1, 0.6, D - 0.6, 4.0, 1.6, 0.35, '#1f4a36', 0)
  k.sign(f0, ds - 2.3, 6.15, 4.6, 0.95, -0.1, { text: 'Café Platform 1872', fg: '#e9d49a', bg: GREEN, border: '#c9a046', font: 'latin' }, 2)
  fbox(b, f0, ds - 0.75, ds + 0.75, -0.2, 0.02, 3.95, 4.55, '#141414', NM.paint, 0.6)
  k.sign(f0, ds - 0.7, 4.0, 1.4, 0.5, -0.205, { text: '空席あり', sub: 'VACANCY', fg: '#f4e7b0', bg: '#141414', font: 'sans', bold: true }, 1)
  wallLamp(k, f0, ds - 1.35, 3.0, 'gas')
  wallLamp(k, f0, ds + 1.35, 3.0, 'gas')
  // テラス（駅前広場の上。4 卓・白いパラソル）
  const terrace = (rec.extra.terrace as { polygon: P2[] } | undefined)?.polygon
  if (terrace) {
    const tl = terrace.map((q) => F.local(q[0], q[1]))
    const s0 = Math.min(...tl.map((q) => q[0])) + 0.6
    const s1 = Math.max(...tl.map((q) => q[0])) - 0.6
    const t0 = Math.min(...tl.map((q) => q[1])) + 0.6
    const t1 = Math.max(...tl.map((q) => q[1])) - 0.4
    // 低い鉄の柵と鉢植え。入口の正面は柵を切って、広場からテラスを通って入口へ（中の通り道。interior/briefs/cafe.ts）
    railing(k, F, s0 - 0.3, ds - 0.85, t0 - 0.3, -0.0, 0.8, '#1e2a24', NM.iron, 1.6, 0)
    railing(k, F, ds + 0.85, s1 + 0.3, t0 - 0.3, -0.0, 0.8, '#1e2a24', NM.iron, 1.6, 0)
    for (const s of [ds - 0.85, ds + 0.85]) fbox(b, F, s - 0.06, s + 0.06, t0 - 0.36, t0 - 0.24, 0, 0.95, '#1e2a24', NM.iron, 0.3)
    for (let i = 0; i < 4; i++) {
      const s = s0 + ((i + 0.5) / 4) * (s1 - s0)
      const t = (t0 + t1) / 2 + (i % 2 ? 0.8 : -0.8)
      const p = F.p(s, t, 0)
      b.cylinder(p, 0.32, 0.03, 12, '#1e1e1e', NM.iron, 0.5, true)
      b.cylinder(p, 0.04, 0.72, 6, '#1e1e1e', NM.iron, 0.5, false)
      b.cylinder([p[0], p[1] + 0.72, p[2]], 0.38, 0.04, 14, '#e8e4da', NM.paint, 0.4, true)
      for (const a of [0, Math.PI]) {
        const cp = [p[0] + Math.cos(a + i) * 0.62, p[1], p[2] + Math.sin(a + i) * 0.62] as V3
        b.box([cp[0], cp[1] + 0.45, cp[2]], [0.42, 0.04, 0.42], '#6b4a2e', NM.wood, 0, a + i)
        b.box([cp[0] + Math.cos(a + i) * 0.2, cp[1] + 0.7, cp[2] + Math.sin(a + i) * 0.2], [0.04, 0.5, 0.42], '#6b4a2e', NM.wood, 0, a + i)
        for (const [dx, dz] of [
          [0.17, 0.17],
          [-0.17, 0.17],
          [0.17, -0.17],
          [-0.17, -0.17],
        ])
          b.box([cp[0] + dx, cp[1] + 0.22, cp[2] + dz], [0.03, 0.45, 0.03], '#1e1e1e', NM.iron)
      }
      // パラソル（白）
      b.cylinder([p[0], p[1] + 0.76, p[2]], 0.025, 1.7, 6, '#d8d4c8', NM.paint, 0.5, false)
      b.cylinder([p[0], p[1] + 2.15, p[2]], 1.35, 0.42, 16, '#f2efe6', NM.cloth, 0, true, 0.04)
      b.cylinder([p[0], p[1] + 2.05, p[2]], 1.36, 0.1, 16, '#f2efe6', NM.cloth, 0, false, 1.35)
    }
    pot(k, F, s0 - 0.2, t0 - 0.5, 0, 0.55)
    pot(k, F, s1 + 0.2, t0 - 0.5, 0, 0.55)
  }
  // 中は暗い仮の奥（扉の中。中を作ったら隠す）
  fbox(k.temp, F, door.s, door.s + door.w, 0.4, 2.0, 0, door.ht, '#141210', NM.dark)
  void canopy
  void column
}

/* -------------------------------------------------------------------------- */
/* 北口駅舎・鐘ヶ丘駅・ケーブルの駅                                                  */
/* -------------------------------------------------------------------------- */

/** 桜見駅 北口駅舎（灯町口）: 煉瓦の小さな切妻・緑青の銅板・アーチの入口・駅名 */
export function stationHall(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { L } = ff
  const eave = rec.height ?? 5.5
  const ring = rec.ring
  const door: Opening = { s: ff.doorS - 1.6, h: 0, w: 3.2, ht: 3.4, shape: 'arch', depth: 0.35, fill: 'door', door: { kind: 'open', color: GREEN } }
  k.mass.st = { wall: [181, 70, 47], facade: 3, roof: [79, 143, 122], roofKind: ROOF.gable, use: 6, flags: 1, seed: k.seed, style: 2, floors: 1 }
  const faces = buildBody(k, {
    ring,
    z: rec.z,
    bottom: -0.6,
    floors: 1,
    floorH: eave,
    top: eave,
    wall: { color: BRICK, mat: NM.brick },
    plinth: { ht: 0.5, color: '#9a948a', mat: NM.granite },
    cornice: { ht: 0.5, proj: 0.22, ...stoneTrim },
    quoins: stoneTrim,
    faces: ring.map((_, i) => (i === ff.edge ? { win: archWin(1.3, 2.6, 0.9, GLASS.cafe, LIGHT_CLASS.night), bay: 3.2, doors: [{ s: ff.doorS, w: 3.2, ht: 3.4, shape: 'arch' as const, style: door.door! }], minLen: 1 } : { win: archWin(1.3, 2.6, 0.9, GLASS.cafe, LIGHT_CLASS.night), bay: 3.2, minLen: 1 })),
    frontEdge: ff.edge,
  })
  const fr = faces[ff.edge].f
  windowTrims(k, fr, door, { w: 3.2, ht: 3.4, sill: 0, shape: 'arch', lintel: { ...stoneTrim, keystone: true } })
  // 屋根（緑青の切妻。棟は長い辺）
  const long = faces.reduce((a, c) => (c.L > a.L ? c : a))
  gableRoof(k, long.f, long.L, faces.find((x) => x !== long && Math.abs(x.L - long.L) > 1)?.L ?? 6, eave, rec.roofHeight ?? 7.0, { color: COPPER, mat: NM.copper, aux: 0.45, eave: 0.5, soffit: '#d9cfba', fascia: STONE, gable: { color: BRICK, mat: NM.brick } })
  k.sign(fr, L / 2 - 2.2, door.ht + 0.45, 4.4, 0.7, -0.08, { text: '桜見駅 北口', sub: '灯町口  AKARIMACHI EXIT', fg: '#f3ecd8', bg: GREEN, font: 'serif' }, 2)
  wallLamp(k, fr, door.s - 0.5, 2.8, 'gas')
  wallLamp(k, fr, door.s + door.w + 0.5, 2.8, 'gas')
}

/** 町の色（緑とクリーム）の小さな駅舎: 鐘ヶ丘駅 */
export function smallStation(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const eave = rec.height ?? 5
  k.mass.st = { wall: [243, 233, 210], facade: 1, roof: [46, 125, 50], roofKind: ROOF.gable, use: 6, flags: 1, seed: k.seed, style: 0, floors: 1 }
  const g = buildBody(k, {
    ring: rec.ring,
    z: rec.z,
    bottom: -0.5,
    floors: 1,
    floorH: eave,
    top: eave,
    wall: { color: '#f3e9d2', mat: NM.plaster },
    wallLower: { color: '#2f6b3a', mat: NM.paint, aux: 0.4, h: 0.9 },
    faces: rec.ring.map((_, i) => ({ win: { w: 1.6, ht: 1.6, sill: 1.0, glass: { kind: GLASS.office, cls: LIGHT_CLASS.night, cols: 3, rows: 2, bar: 0.04, frame: '#2f6b3a' }, depth: 0.14 }, bay: 3.2, minLen: 2, doors: i === ff.edge ? [{ s: ff.doorS, w: 2.4, ht: 2.6, style: { kind: 'open' as const, color: '#2f6b3a' } }] : [] })),
    frontEdge: ff.edge,
  })
  const long = g.reduce((a, c) => (c.L > a.L ? c : a))
  gableRoof(k, long.f, long.L, g.find((x) => Math.abs(x.L - long.L) > 1)?.L ?? 10, eave, rec.roofHeight ?? 7, { color: '#2f6b3a', mat: NM.metalRoof, aux: 0, eave: 1.2, soffit: '#f3e9d2', fascia: '#2f6b3a', gable: { color: '#f3e9d2', mat: NM.plaster } })
  canopy(k, f, ff.doorS - 2.5, ff.doorS + 2.5, 3.0, 1.6, '#2f6b3a', NM.metalRoof)
  k.sign(f, L / 2 - 2, 3.25, 4.0, 0.7, -0.08, { text: '鐘ヶ丘駅', sub: 'HINOTETSU  KANEGAOKA', fg: '#2f6b3a', bg: '#f8f3e6', border: '#2f6b3a', font: 'sans', bold: true }, 2)
  wallLamp(k, f, ff.doorS - 1.6, 2.6, 'bulb')
}
