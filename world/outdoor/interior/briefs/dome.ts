import { NM } from '../../named/namedMaterial'
import { GATE_STEP_RUN } from '../../named/kits/observatory'
import type { InteriorBuilder } from '../builder'
import { IM } from '../interiorMaterial'
import type { InteriorModel } from '../model'
import { DOME, DEG, P, planting } from '../dome/layout'
import { domeStructure, type DomeLampIx } from '../dome/structure'
import { domeDecor } from '../dome/decor'
import type { Finish, InteriorBrief, L2, LampDef, NavPointDef, OutdoorArea, RoomDef } from '../types'

/**
 * ガーデンドームの中（まるの森町1番。自治港町立ガーデンドーム。設定: vol2 3-2・2章①。データの rooms: 4 層 + 地下・方角ごとの植生）。
 * 局所の座標 s = 東・t = 北（原点はドームの中心）、h = 床（7.75m）から。形の決まった値は dome/layout.ts、形は dome/structure.ts、
 * 植物・水・霧・ガラスのドームは dome/decor.ts。
 *
 * - 大きな空間（hall）は壁を作らない部屋（ガラスの温室の光。カメラの確かめはドームの天井の高さまで）。張り出しの入口 3 つ（南門・西口・北門）と
 *   種の間（地下）は、ふつうの部屋（壁・床・天井を共通の仕組みで作る）
 * - 歩ける所は「外の歩ける所」の面で書く（根の階の道・広場・アーケード、回廊の床、つり橋、核の踊り場、梢のテラス）。層の間は弧のスロープ A・B と
 *   らせん階段 C（弧の段）と、地下への直階段 D
 * - 灯り（28）: 回廊の灯りの柱と金の光の帯（夕方の葉脈ライティングと同じ時刻に点く）・梢のテラスのロタンダ・池の滝を照らす灯り・中の店・入口・種の間
 */

const F = (color: string, mat: number, aux = 0): Finish => ({ color, mat, aux })

/* -------------------------------------------------------------------------- */
/* 灯り                                                                         */
/* -------------------------------------------------------------------------- */

const DUSK = (id: string, room: string, a: [number, number, number], power: number, range: number, kind: LampDef['kind'] = 'bulb', color = '#ffd9a8', dir?: [number, number, number]): LampDef => ({ id, room, at: a, color, power, range, kind, schedule: 'dusk', dir })
const SHOP = (id: string, room: string, a: [number, number, number], power: number, range: number, hours: [number, number], kind: LampDef['kind'] = 'pendant', color = '#ffe2c0'): LampDef => ({ id, room, at: a, color, power, range, kind, schedule: 'shop', hours })

const g1 = (a: number): [number, number, number] => [...P(DOME.L1.r0 - 0.06, a * DEG), DOME.L1.h + 2.86] as [number, number, number]
const g2 = (a: number): [number, number, number] => [...P(DOME.L2.r0 + 0.06, a * DEG), DOME.L2.h + 2.86] as [number, number, number]

const LAMPS: LampDef[] = [
  ...[30, 90, 150, 210, 270, 330].map((a, i) => DUSK(`gallery-${i}`, 'hall', g1(a), 9, 20)),
  ...[60, 180, 300].map((a, i) => DUSK(`branch-${i}`, 'hall', g2(a), 8, 18)),
  DUSK('terrace', 'hall', [0, 0, DOME.L3.h + 4.1], 7, 15),
  DUSK('terrace-rim', 'hall', [...P(10.5, 200 * DEG), DOME.L3.h + 0.9] as [number, number, number], 2.5, 8),
  DUSK('landing', 'hall', [...P(DOME.landing.r1 - 0.3, -100 * DEG), DOME.landing.h - 0.75] as [number, number, number], 6, 12, 'bulb', '#ffd9a0'),
  DUSK('falls-1', 'hall', [...P(DOME.pool.r1 - 0.6, -96 * DEG), 0.2] as [number, number, number], 12, 26, 'spot', '#fff0d0', [0, 0.45, 0.9]),
  DUSK('falls-2', 'hall', [...P(DOME.pool.r1 - 0.6, -84 * DEG), 0.2] as [number, number, number], 12, 26, 'spot', '#fff0d0', [0, 0.45, 0.9]),
  SHOP('komorebi-1', 'hall', [...P(DOME.komorebi.r1 - 1.0, -46.5 * DEG), DOME.L1.h + 2.12] as [number, number, number], 1.6, 7, [9.5, 20.5], 'bulb'),
  SHOP('komorebi-2', 'hall', [...P(DOME.komorebi.r1 - 1.0, -43.5 * DEG), DOME.L1.h + 2.12] as [number, number, number], 1.6, 7, [9.5, 20.5], 'bulb'),
  SHOP('happaya', 'hall', [...P(DOME.arcade.r1 + 0.75, DOME.happaya.a), 3.0] as [number, number, number], 1.4, 6, [9, 21], 'bulb'),
  { id: 'control', room: 'hall', at: [...P(54, 16 * DEG), DOME.L1.h + 2.9] as [number, number, number], color: '#eef6ff', power: 1.6, range: 6, kind: 'ceiling', schedule: 'always' },
  { id: 'screen', room: 'hall', at: [...P(55.4, 16 * DEG), DOME.L1.h + 1.5] as [number, number, number], color: '#9fe8ff', power: 0.9, range: 5, kind: 'screen', dir: [-1, 0, 0], schedule: 'always' },
  DUSK('path-1', 'hall', [3.6, -48, 0.7], 1.4, 7),
  DUSK('path-2', 'hall', [-3.6, -30, 0.7], 1.4, 7),
  SHOP('gate-s', 'gate-s', [0, -61, DOME.gates.south.ceil - 0.2], 1.6, 9, [9, 21], 'ceiling', '#fff2dc'),
  SHOP('gate-w', 'gate-w', [-59.2, 0, DOME.gates.west.ceil - 0.15], 0.9, 6, [9, 21], 'ceiling', '#fff2dc'),
  SHOP('gate-n', 'gate-n', [0, 59.2, DOME.gates.north.ceil - 0.15], 0.9, 6, [9, 21], 'ceiling', '#fff2dc'),
  SHOP('seeds-1', 'seeds', [-3.5, 30.2, 3.75], 8, 10, [9, 21], 'ceiling', '#eef4ff'),
  SHOP('seeds-2', 'seeds', [3.5, 30.2, 3.75], 8, 10, [9, 21], 'ceiling', '#eef4ff'),
  { id: 'vault', room: 'vault', at: [0, 37, 3.6], color: '#e4d8ff', power: 4.5, range: 12, kind: 'ceiling', schedule: 'always' },
  SHOP('seeds-stair', 'seeds-stair', [3.7, 26.8, 2.6], 2.2, 7, [9, 21], 'ceiling', '#eef4ff'),
]
const L = (id: string) => LAMPS.findIndex((l) => l.id === id)

const LAMP_IX: DomeLampIx = {
  gallery: L('gallery-0'),
  branch: L('branch-0'),
  terrace: L('terrace'),
  landing: L('landing'),
  komorebi: L('komorebi-1'),
  happaya: L('happaya'),
  control: L('control'),
  screen: L('screen'),
  path: L('path-1'),
  seeds: L('seeds-1'),
  vault: L('vault'),
  seedsStair: L('seeds-stair'),
}

/* -------------------------------------------------------------------------- */
/* 部屋                                                                         */
/* -------------------------------------------------------------------------- */

const circle = (r: number, n = 64): L2[] => Array.from({ length: n }, (_, i) => P(r, -Math.PI + (i / n) * Math.PI * 2))
const rect = (s0: number, s1: number, t0: number, t1: number): L2[] => [
  [s0, t0],
  [s1, t0],
  [s1, t1],
  [s0, t1],
]

const IN = 0.6
const GS = DOME.gates.south
const GW = DOME.gates.west
const GN = DOME.gates.north
const STONE_FLOOR = F('#cfc6b4', NM.paving)
const STONE_WALL = F('#e9e4d8', NM.stone, 0.6)
const CEIL = F('#efece4', IM.paintWall)
const B1 = DOME.b1

const ROOMS: RoomDef[] = [
  // 張り出しの入口（外観の型の箱の中。壁の中の面は外形から 0.6m）。奥の辺はドームの大きな空間との仕切り（開口）
  { id: 'gate-s', name: '南門（入口の間）', level: 0, poly: rect(GS.s0 + IN, GS.s1 - IN, GS.t0 + IN, GS.t1), ceiling: GS.ceil, floorFinish: STONE_FLOOR, wallFinish: STONE_WALL, ceilingFinish: CEIL, baseboard: '#bdb4a2' },
  { id: 'gate-w', name: '西口（入口の間）', level: 0, poly: rect(GW.s0 + IN, GW.s1, GW.t0 + IN, GW.t1 - IN), ceiling: GW.ceil, floorFinish: STONE_FLOOR, wallFinish: STONE_WALL, ceilingFinish: CEIL, baseboard: '#bdb4a2' },
  { id: 'gate-n', name: '北門（職員通用口の間）', level: 0, poly: rect(GN.s0 + IN, GN.s1 - IN, GN.t0, GN.t1 - IN), ceiling: GN.ceil, floorFinish: STONE_FLOOR, wallFinish: STONE_WALL, ceilingFinish: CEIL, baseboard: '#bdb4a2' },
  // 種の間（地下）: 階段の吹き抜け・見学の通路・ガラスの向こうの種子保存庫と増殖室
  {
    id: 'seeds-stair',
    name: '種の間への階段',
    level: 4,
    poly: rect(B1.stair.s0, B1.stair.s1, B1.stair.t0, B1.stair.t1),
    floor: B1.h,
    ceiling: 0,
    noCeiling: true,
    group: 'seeds',
    open: ['seeds'],
    floorFinish: F('#8a8478', NM.stone, 0.3),
    wallFinish: F('#d8d4c8', NM.stone, 0.5),
    ceilingFinish: CEIL,
  },
  { id: 'seeds', name: '種の間（見学の通路）', level: 4, poly: rect(B1.hall.s0, B1.hall.s1, B1.hall.t0, B1.hall.t1), floor: B1.h, ceiling: B1.ceil, open: ['vault', 'seeds-stair'], floorFinish: F('#7a7e78', NM.granite), wallFinish: F('#e2e0d8', NM.concrete), ceilingFinish: F('#e8e8e4', IM.paintWall), baseboard: '#3a3e3a' },
  { id: 'vault', name: '種子保存庫と増殖室', level: 4, poly: rect(B1.hall.s0, B1.hall.s1, B1.hall.t1, B1.vault.t1), floor: B1.h, ceiling: B1.ceil, noWalk: true, group: 'seeds', open: ['seeds'], floorFinish: F('#d8dcde', NM.tileClad, 0.3), wallFinish: F('#eef0f2', NM.tileClad, 0.4), ceilingFinish: F('#f2f4f6', IM.paintWall) },
  // ドームの大きな空間（壁・床・天井は作らない。カメラの確かめの天井はガラスの半球）
  {
    id: 'hall',
    name: 'ドーム（根の階〜梢のテラス）',
    level: 0,
    poly: circle(DOME.R - 0.6),
    ceiling: DOME.H,
    domeCeil: { center: [0, 0], radius: DOME.R, height: DOME.H - 0.8, base: DOME.base },
    noWalls: true,
    noFloor: true,
    noCeiling: true,
    noWalk: true,
    floorFinish: STONE_FLOOR,
    wallFinish: STONE_WALL,
    ceilingFinish: CEIL,
  },
]

/* -------------------------------------------------------------------------- */
/* 歩ける所                                                                      */
/* -------------------------------------------------------------------------- */

/** 扇形の面（r0〜r1・a0〜a1（度）・高さ・階）を、角度で区切った面の並びにする（となりと 0.7m 重ねる） */
function sector(id: string, r0: number, r1: number, a0: number, a1: number, h: number, level: number, step = 7.5): OutdoorArea[] {
  const out: OutdoorArea[] = []
  const n = Math.max(1, Math.ceil((a1 - a0) / step))
  const ov = (0.7 / ((r0 + r1) / 2)) / DEG
  for (let i = 0; i < n; i++) {
    const q0 = (a0 + ((a1 - a0) * i) / n - (i > 0 || a1 - a0 >= 359 ? ov : 0)) * DEG
    const q1 = (a0 + ((a1 - a0) * (i + 1)) / n + (i < n - 1 || a1 - a0 >= 359 ? ov : 0)) * DEG
    const qm = (q0 + q1) / 2
    out.push({ id: `${id}-${i}`, poly: [P(r0, q0), P(r1, q0), P(r1, qm), P(r1, q1), P(r0, q1), P(r0, qm)], h, level })
  }
  return out
}

/** 線分に沿った長方形の面 */
function strip(id: string, a: L2, b: L2, w: number, h: number | 'terrain', level: number): OutdoorArea {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = Math.hypot(dx, dy)
  const nx = (-dy / l) * (w / 2)
  const ny = (dx / l) * (w / 2)
  return {
    id,
    poly: [
      [a[0] + nx, a[1] + ny],
      [a[0] - nx, a[1] - ny],
      [b[0] - nx, b[1] - ny],
      [b[0] + nx, b[1] + ny],
    ],
    h,
    level,
  }
}

const L1 = DOME.L1
const L2l = DOME.L2
const GATE_DROP = 7.75 - 6.93
const GATE_STEPS = Math.max(1, Math.round(GATE_DROP / 0.165))

const OUTDOOR: OutdoorArea[] = [
  // 南門の前の広場（地形の高さ）
  { id: 'gate-plaza', poly: rect(-18, 18, -86, GS.t0 - GATE_STEPS * GATE_STEP_RUN + 0.35), h: 'terrain' },
  // 北門（職員通用口）の外の小径（地形の高さ）。町の道（ドームの北門への小径）から北門へ入る（kanon.travel のルート D。§7 の 153）
  { id: 'gate-n-path', poly: rect(-2.2, 2.2, GN.t1 - 0.4, 76.5), h: 'terrain' },
  // 根の階: 放射の道・広場・アーケードの下の道・スロープ A の下の口・種の間への階段の口
  // 放射の道は広場の環の中ほどまで重ねる（面の境で歩ける所が切れないように）
  strip('path-south', [0, GS.t1 + 0.05], [0, -16.6], DOME.southPathW, 0, 0),
  strip('path-west', [GW.s1 + 0.05, 0], [-16.6, 0], DOME.pathW, 0, 0),
  strip('path-north', [0, GN.t0 - 0.05], [0, 16.6], DOME.pathW, 0, 0),
  strip('path-east', [DOME.arcade.r1 + 0.3, 0], [16.6, 0], DOME.pathW, 0, 0),
  ...sector('plaza', DOME.plaza.r0 + 0.5, DOME.plaza.r1, -180, 180, 0, 0, 15),
  ...sector('arcade', DOME.arcade.r0 - 0.35, DOME.arcade.r1 + 0.35, -180, 180, 0, 0, 7.5),
  ...sector('rampA-foot', DOME.rampA.r - 1.85, DOME.rampA.r + 1.85, -91, -80.5, 0, 0, 12),
  { id: 'seeds-mouth', poly: rect(B1.stair.s0 - 0.35, B1.stair.s1 + 0.35, 18.4, 20.1), h: 0, level: 0 },
  // 幹の回廊（1 層）: 環の床・スロープの口・こもれびと管制室の張り出し
  ...sector('l1', L1.r0 + 0.1, L1.r1 - 0.1, -180, 180, L1.h, 1, 7.5),
  ...sector('l1-rampA', DOME.rampA.r - 1.5, L1.r0 + 1.0, 2, 9, L1.h, 1, 8),
  ...sector('l1-rampB', DOME.rampB.r - 1.5, L1.r0 + 1.0, 13, 19.5, L1.h, 1, 8),
  ...sector('l1-komorebi', L1.r1 - 0.8, DOME.komorebi.r1 - 0.1, -53, -37, L1.h, 1, 8),
  ...sector('l1-control', L1.r1 - 0.8, DOME.control.r1 - 0.2, 9, 23, L1.h, 1, 7),
  // 枝の回廊（2 層）: 環の床・スロープ B の上の口・つり橋・核の踊り場
  ...sector('l2', L2l.r0 + 0.1, L2l.r1 - 0.1, -180, 180, L2l.h, 2, 7.5),
  ...sector('l2-rampB', L2l.r1 - 0.8, DOME.rampB.r + 1.5, 113, 120.5, L2l.h, 2, 8),
  ...DOME.bridges.map((b, i) => strip(`bridge-${i}`, P(DOME.landing.r1 - 0.8, b), P(L2l.r0 + 0.8, b), DOME.bridgeW - 0.1, L2l.h, 2)),
  ...sector('landing', DOME.landing.r0 + 0.2, DOME.landing.r1 - 0.05, -180, 180, DOME.landing.h, 2, 20),
  // 梢のテラス（3 層）
  { id: 'terrace', poly: Array.from({ length: 48 }, (_, i) => P(DOME.L3.r - 0.2, -Math.PI + (i / 48) * Math.PI * 2)), h: DOME.L3.h, level: 3 },
]

/** 通り道の点（環の道は等間隔に） */
function ringNodes(r: number, n: number, level: number, a0 = 0): NavPointDef[] {
  return Array.from({ length: n }, (_, i) => ({ at: P(r, (a0 + (i / n) * 360) * DEG), level }))
}

const NAV: NavPointDef[] = [
  ...ringNodes((DOME.plaza.r0 + DOME.plaza.r1) / 2 + 0.2, 16, 0, 11.25),
  ...ringNodes((DOME.arcade.r0 + DOME.arcade.r1) / 2, 36, 0, 0),
  ...ringNodes((L1.r0 + L1.r1) / 2, 36, 1, 5),
  ...ringNodes((L2l.r0 + L2l.r1) / 2, 28, 2, 6.4),
  ...ringNodes(9.1, 14, 2, 0),
  ...ringNodes(6.5, 8, 3, 22.5),
  ...ringNodes(10.6, 12, 3, 15),
  // 放射の道
  ...[-52, -44, -36, -28, -22].map((t): NavPointDef => ({ at: [0, t], level: 0 })),
  ...[-52, -44, -36, -28, -22].map((s): NavPointDef => ({ at: [s, 0], level: 0 })),
  ...[52, 44, 36, 28, 22].map((t): NavPointDef => ({ at: [0, t], level: 0 })),
  ...[44, 36, 28, 22].map((s): NavPointDef => ({ at: [s, 0], level: 0 })),
  // スロープの口・橋・張り出し
  { at: P(DOME.rampA.r, -86 * DEG), level: 0 },
  { at: P(DOME.rampA.r + 0.2, 6 * DEG), level: 1 },
  { at: P(DOME.rampB.r + 0.4, 15.5 * DEG), level: 1 },
  { at: P(DOME.rampB.r - 0.6, 118 * DEG), level: 2 },
  // つり橋（核の踊り場の上・橋の上・枝の回廊の上。どれも橋の中心の線の上）
  ...DOME.bridges.flatMap((b): NavPointDef[] => [9.1, 16, 22, 28, (L2l.r0 + L2l.r1) / 2].map((r) => ({ at: P(r, b), level: 2 }))),
  // 放射の道と、広場・アーケードの環の交わる所
  ...[-90, 180, 90, 0].flatMap((a): NavPointDef[] => [{ at: P((DOME.plaza.r0 + DOME.plaza.r1) / 2 + 0.2, a * DEG), level: 0 }, { at: P((DOME.arcade.r0 + DOME.arcade.r1) / 2, a * DEG), level: 0 }]),
  { at: P(53.5, -45 * DEG), level: 1 },
  { at: P(53.6, 16 * DEG), level: 1 },
  { at: P(51.3, 16 * DEG), level: 1 },
  // 入口の間・種の間
  { at: [0, -60.5], level: 0 },
  { at: [-59.2, 0], level: 0 },
  { at: [0, 59.2], level: 0 },
  { at: [0, GS.t0 - GATE_STEPS * GATE_STEP_RUN - 1.2], level: 0 },
  { at: [3.7, 19.2], level: 0 },
  { at: [0, 30.2], level: 4 },
  { at: [-4.5, 30.2], level: 4 },
  { at: [4.5, 30.2], level: 4 },
]

export const DOME_BRIEF: InteriorBrief = {
  zone: 'dome',
  wallT: 0.3,
  inset: IN,
  rooms: ROOMS,
  doors: [
    // 外観の開く扉（南門は幅 9m のアーチ。穴はアーチの起点の高さまで、上は外観の開口の穴）
    { id: 'gate-s', level: 0, at: [0, GS.t0 + IN / 2], axis: 's', width: GS.door, height: GS.doorH - GS.door / 2, kind: 'named', entrance: 0, thickness: IN, floor: 0 },
    { id: 'gate-n', level: 0, at: [0, GN.t1 - IN / 2], axis: 's', width: GN.door, height: GN.doorH, kind: 'named', entrance: 1, thickness: IN, floor: 0 },
    { id: 'gate-w', level: 0, at: [GW.s0 + IN / 2, 0], axis: 't', width: GW.door, height: GW.doorH, kind: 'named', entrance: 2, thickness: IN, floor: 0 },
    // 入口の間からドームの中へ（開口。外観の奥の壁の開口と同じ大きさ）
    { id: 'gate-s-in', level: 0, at: [0, GS.t1], axis: 's', width: GS.innerW, height: GS.innerH, kind: 'open', thickness: 0.3, floor: 0, jambs: false },
    { id: 'gate-w-in', level: 0, at: [GW.s1, 0], axis: 't', width: GW.innerW, height: GW.innerH, kind: 'open', thickness: 0.3, floor: 0, jambs: false },
    { id: 'gate-n-in', level: 0, at: [0, GN.t0], axis: 's', width: GN.innerW, height: GN.innerH, kind: 'open', thickness: 0.3, floor: 0, jambs: false },
  ],
  stairs: [
    // 南門の前の石段（外観の型が作る）
    { id: 'gate-steps', from: 0, to: 0, start: [0, GS.t0 - GATE_STEPS * GATE_STEP_RUN], dir: [0, 1], width: GS.door + 1.2, risers: GATE_STEPS, run: GATE_STEP_RUN, y0: -GATE_DROP, y1: 0, build: false },
    // スロープ A（根の階 → 幹の回廊）・B（幹 → 枝）: 弧の坂（段なし）
    { id: 'rampA', from: 0, to: 1, start: [0, 0], dir: [1, 0], width: DOME.rampA.w - 0.4, risers: 120, run: 0.5, y0: 0, y1: L1.h, build: false, arc: { center: [0, 0], radius: DOME.rampA.r, a0: DOME.rampA.a0, a1: DOME.rampA.a1 }, blockUnder: false, landing: [0.9, 0.9] },
    { id: 'rampB', from: 1, to: 2, start: [0, 0], dir: [1, 0], width: DOME.rampB.w - 0.4, risers: 120, run: 0.5, y0: L1.h, y1: L2l.h, build: false, arc: { center: [0, 0], radius: DOME.rampB.r, a0: DOME.rampB.a0, a1: DOME.rampB.a1 }, blockUnder: false, landing: [0.9, 0.9] },
    // らせん階段 C（枝の踊り場 → 梢のテラス）
    {
      id: 'stairC',
      from: 2,
      to: 3,
      start: [0, 0],
      dir: [1, 0],
      width: DOME.stairC.w - 0.3,
      risers: DOME.stairC.risers,
      run: ((DOME.stairC.a1 - DOME.stairC.a0) * DOME.stairC.r) / DOME.stairC.risers,
      y0: DOME.landing.h,
      y1: DOME.L3.h,
      build: false,
      arc: { center: [0, 0], radius: DOME.stairC.r, a0: DOME.stairC.a0, a1: DOME.stairC.a1 },
      landing: [0.65, 0.65],
    },
    // 直階段 D（種の間 → 根の階。吹き抜けの北の端から南へ上る）
    { id: 'stairD', from: 4, to: 0, start: [(B1.stair.s0 + B1.stair.s1) / 2, B1.stair.t1 - 0.25], dir: [0, -1], width: 2.0, risers: 25, run: 0.3, y0: B1.h, y1: 0, rail: 2, wall: 2, finish: F('#cfc6b4', NM.stone), landing: [0.5, 0.5] },
  ],
  outdoor: OUTDOOR,
  lamps: LAMPS,
  navPoints: NAV,
  maxEdge: 11,
  furnish,
  decorate: domeDecor,
}

function furnish(ib: InteriorBuilder, m: InteriorModel) {
  void m
  domeStructure(ib, LAMP_IX)
  plantObstacles(ib)
}

/**
 * 植物の障害物（木の幹・ヤシ・木生シダ。道の近くだけ。植え込みは歩ける所の外なので要らない）。
 * カメラには、木の樹冠・垂れるつる・大きな葉の株もさえぎる物として入れる（追うカメラ・自動カメラが葉の中を通ったり、つるが画面の半分をふさいだりしていた。§7 の 148）
 */
function plantObstacles(ib: InteriorBuilder) {
  ib.room('hall')
  ib.level = 0
  ib.floorH = 0
  const pl = planting()
  for (const t of pl.trees) {
    if (t.height > 3) ib.disc('木', [t.s, t.t], 0.45, t.h, t.h + t.height, true, true)
    // 樹冠（幹の上の 6 割ほど。半径は少し小さめに）
    if (t.height > 2) ib.disc('木の樹冠', [t.s, t.t], t.radius * 0.75, t.h + t.height * 0.4, t.h + t.height, false, true)
  }
  for (const p of pl.plants) {
    if (p.kind === 'palm' || p.kind === 'treeFern' || p.kind === 'mangrove') ib.disc(p.kind, [p.s, p.t], p.kind === 'mangrove' ? 1.2 : 0.4, p.h, p.h + p.size, true, true)
    // 垂れるつる（踊り場・テラス・回廊の縁から。上の端 h から len だけ下へ）
    else if (p.kind === 'vine' && p.len) ib.disc('つる', [p.s, p.t], 0.3, p.h - p.len, p.h + 0.2, false, true)
    // 大きな葉の株（アロカシア・オオタニワタリ）
    else if ((p.kind === 'alocasia' || p.kind === 'nestFern') && p.size > 1.2) ib.disc(p.kind, [p.s, p.t], p.size * 0.4, p.h, p.h + p.size, false, true)
  }
}
