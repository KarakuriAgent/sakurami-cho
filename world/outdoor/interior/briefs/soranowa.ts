import { DECK_H, PLATFORM, SORANOWA, wheelToNoriba } from '../../../../core/soranowa'
import { NORIBA_BACK_S, NORIBA_DOORS } from '../../named/kits/soranowa'
import { NM } from '../../named/namedMaterial'
import type { InteriorBuilder } from '../builder'
import { at, plant } from '../furniture'
import { IM } from '../interiorMaterial'
import { insetPoly, type InteriorModel } from '../model'
import type { Finish, InteriorBrief, L2, LampDef } from '../types'

/**
 * 大観覧車ソラノワの乗り場（帆柱町3番。設定: vol2 3-9。docs/design/town.md §17）。
 * 局所の座標 s = 正面（南南西の面）に沿って外から見て右へ・t = 奥へ（北北東へ。ホイールの側）。正面の外形の線が t = 0。床 2.5m。
 *
 * - 建物（白い鉄骨とガラスの平屋。18.0 × 10.0m）: 入口の自動扉 → 券売機と窓口・案内（料金と営業時間・灯りの読み方・てっぺんからの眺め）→
 *   改札（自動改札 3 通路。真ん中の通路が裏口の正面）→ 裏口（開く扉 100）
 * - 外: 正面の広場・スロープの下の西の道・裏の広場（裏口から階段の下まで）。乗り場の台（階 1。高さ DECK_H）へは階段（乗る人）とスロープ（降りた人）。
 *   台・階段・スロープ・屋根の形は外観の型（named/kits/soranowa.ts）が作る。ここは歩ける所・段・障害物・建物の中の家具だけ
 * - 台の上の位置はホイールの局所の座標（core/soranowa.ts）から、この局所の座標へ直して書く（wheelToNoriba）
 */

const F = (color: string, mat: number, aux = 0): Finish => ({ color, mat, aux })

const IN = 0.15
/** 外形（局所。反時計回り: 正面の左の端 → 右の端 → 奥の右 → 奥の左） */
const RING: L2[] = [
  [0, 0],
  [17.994, 0],
  [18.014, 9.898],
  [0.084, 10.024],
]
/** 中の天井 */
const CEIL = 3.7
/** 奥の壁の線の t（s の位置で） */
const backT = (s: number) => 10.024 + ((s - 0.084) / (18.014 - 0.084)) * (9.898 - 10.024)
/** 入口の扉の中心（データの入口） */
const DOOR_S = 8.949
/** 裏口の扉の中心 */
const BACK_S = NORIBA_BACK_S
/** 改札（3 通路。真ん中の通路が裏口の正面）。t0〜t1 は改札機の長さ */
const GATES = { lanes: [BACK_S - 0.95, BACK_S, BACK_S + 0.95], t0: 6.6, t1: 7.6, h: 1.02 }
/** 窓口（きっぷうりば）・券売機 */
const BOOTH = { s0: 15.25, s1: 17.8, t0: 1.45, t1: 4.95 }

/** ホイールの局所の点 → この局所の点 */
const w = (x: number, z: number): L2 => wheelToNoriba(x, z)
/** 地面（標高 2.51m）から建物の床（2.5m）へ */
const GROUND_H = SORANOWA.ground - 2.5
const DECK = DECK_H + GROUND_H

const SHOP_HOURS: [number, number] = [10.75, 22.25]
const lamp = (id: string, a: [number, number, number], power: number, range: number, kind: LampDef['kind'] = 'ceiling', color = '#fff4e6'): LampDef => ({ id, room: 'hall', at: a, color, power, range, kind, schedule: 'shop', hours: SHOP_HOURS })

const LAMPS: LampDef[] = [
  ...[3.6, 9.0, 14.4].flatMap((s, i) => [2.1, 5.2, 8.3].map((t, j) => lamp(`ceil-${i}-${j}`, [s, t, CEIL - 0.04], 0.5, 6.2))),
  lamp('board', [BACK_S, 6.0, 3.2], 0.55, 3.4, 'spot', '#fff2e0'),
  lamp('booth', [16.5, 3.2, 2.5], 0.45, 3.2, 'ceiling'),
  lamp('gate', [BACK_S, 8.6, CEIL - 0.04], 0.45, 4.5),
]
const L = (id: string) => LAMPS.findIndex((l) => l.id === id)

/** ステアの向き（ホイールの +z。下から上へ）をこの局所の向きで */
const UP = (() => {
  const a = w(0, 0)
  const b = w(0, 1)
  const d: L2 = [b[0] - a[0], b[1] - a[1]]
  const l = Math.hypot(d[0], d[1])
  return [d[0] / l, d[1] / l] as L2
})()

const D = PLATFORM.deck
const ST = PLATFORM.stairs
const R = PLATFORM.ramp

export const SORANOWA_BRIEF: InteriorBrief = {
  zone: 'soranowa',
  wallT: 0.12,
  inset: IN,
  rooms: [
    {
      id: 'hall',
      name: '乗り場の建物（券売機・改札）',
      level: 0,
      poly: insetPoly(RING, IN),
      ceiling: CEIL,
      floorFinish: F('#d4d1ca', NM.tileClad, 0.6),
      wallFinish: F('#f2f2ee', IM.paintWall),
      ceilingFinish: F('#f4f4f0', IM.paintWall),
      baseboard: '#9aa0a4',
    },
  ],
  doors: [
    // 入口の両開きのガラスの自動扉（外観の開く扉。データの入口）と、改札を出た所の裏口（開く扉 100）
    { id: 'front', level: 0, at: [DOOR_S, IN / 2], axis: 's', width: 2.0, height: 2.56, kind: 'named', entrance: 0, thickness: IN, floor: 0 },
    { id: 'back', level: 0, at: [BACK_S, backT(BACK_S) - IN / 2], axis: 's', width: 2.0, height: 2.56, kind: 'named', entrance: NORIBA_DOORS.back, thickness: IN, floor: 0 },
  ],
  stairs: [
    // 乗る人の階段（裏の広場から台へ。8 段）。形は外観の型
    {
      id: 'stairs',
      from: 0,
      to: 1,
      start: w((ST.x0 + ST.x1) / 2, D.z0 - (ST.risers - 1) * ST.run),
      dir: UP,
      width: ST.x1 - ST.x0 - 0.3,
      risers: ST.risers,
      run: ST.run,
      y0: GROUND_H,
      y1: DECK,
      build: false,
      landing: [0.5, 0.6],
    },
    // 降りた人のスロープ（台から建物の西の道へ。16.5m・8%）。形は外観の型
    {
      id: 'ramp',
      from: 0,
      to: 1,
      start: w((R.x0 + R.x1) / 2, D.z0 - R.len),
      dir: UP,
      width: R.x1 - R.x0 - 0.2,
      risers: 56,
      run: R.len / 55,
      y0: GROUND_H,
      y1: DECK,
      build: false,
      landing: [0.6, 0.7],
    },
  ],
  outdoor: [
    // 正面の広場・建物の西（スロープの下）の道・裏の広場（裏口から階段の下まで）
    { id: 'front', poly: [[-9, -14], [27, -14], [27, -0.03], [-9, -0.03]], h: 'terrain' },
    { id: 'west', poly: [[-9, -0.03], [-0.04, -0.03], [0.04, 10.08], [-9, 10.08]], h: 'terrain' },
    { id: 'back', poly: [[0.04, 10.08], [18.7, 9.95], [18.7, 14.6], ...[w(-8.3, -4.78), w(4.62, -4.78), w(4.62, -15.2)]], h: 'terrain' },
    // 乗り場の台（階 1）
    { id: 'deck', poly: [w(D.x0 + 0.08, D.z0 + 0.08), w(D.x1 - 0.08, D.z0 + 0.08), w(D.x1 - 0.08, D.z1 - 0.02), w(D.x0 + 0.08, D.z1 - 0.02)].reverse() as L2[], h: DECK, level: 1 },
  ],
  lamps: LAMPS,
  navPoints: [
    { at: [DOOR_S, 1.35], level: 0 },
    { at: [BACK_S, 4.2], level: 0 },
    { at: [BACK_S, 6.15], level: 0 },
    { at: [BACK_S, 8.4], level: 0 },
    { at: [4.0, 3.6], level: 0 },
    { at: [13.6, 5.6], level: 0 },
    { at: [DOOR_S, -1.6], level: 0 },
    { at: [-2.4, -1.8], level: 0 },
    { at: [-2.6, 3.4], level: 0 },
    { at: [BACK_S + 0.2, 12.2], level: 0 },
    { at: w(-1.0, -9.5), level: 0 },
    { at: w(-5.2, -3.7), level: 1 },
    { at: w(-2.2, -3.1), level: 1 },
    { at: w(1.4, -3.1), level: 1 },
    { at: w(4.2, -3.4), level: 1 },
    { at: w(5.55, -3.9), level: 1 },
  ],
  furnish,
}

function furnish(ib: InteriorBuilder, m: InteriorModel) {
  void m
  ib.room('hall')
  floorGuides(ib)
  ticketMachines(ib)
  booth(ib)
  gates(ib)
  boards(ib)
  lobby(ib)
  ceiling(ib)
  outside(ib)
}

/* -------------------------------------------------------------------------- */
/* 床の誘導（入口から改札へ黄色い点字ブロック）・入口の敷物                                */
/* -------------------------------------------------------------------------- */

function floorGuides(ib: InteriorBuilder) {
  const Y = '#e2b62a'
  ib.box([DOOR_S, 0.95], 0, [2.4, 1.4, 0.008], '#3a3d40', IM.rug, 0)
  ib.box([DOOR_S, 2.45], 0, [0.3, 1.6, 0.004], Y, NM.tileClad, 0.06)
  ib.box([(DOOR_S + BACK_S) / 2, 3.4], 0, [BACK_S - DOOR_S + 0.3, 0.3, 0.004], Y, NM.tileClad, 0.06)
  ib.box([BACK_S, 4.95], 0, [0.3, 2.8, 0.004], Y, NM.tileClad, 0.06)
}

/* -------------------------------------------------------------------------- */
/* 券売機（西の壁ぎわに 3 台。画面と硬貨・紙幣の口・IC の読み取り）                        */
/* -------------------------------------------------------------------------- */

function ticketMachines(ib: InteriorBuilder) {
  const face = 0 // +s を向く
  for (const t of [2.35, 3.45, 4.55]) {
    const c: L2 = [0.48, t]
    ib.box(c, 0, [0.6, 0.95, 1.72], '#e9ecee', NM.paint, 0.55, 0)
    ib.box([0.8, t], 0.95, [0.04, 0.84, 0.62], '#1f3550', NM.paint, 0.6, 0)
    ib.picture('soranowa-ticket', [0.83, t], 1.24, 0.5, 0.39, face, 1)
    ib.box([0.8, t], 0.62, [0.08, 0.84, 0.28], '#cfd4d8', NM.steel, 0.6, 0)
    ib.box([0.84, t - 0.22], 0.7, [0.02, 0.14, 0.06], '#1e1e1e', NM.dark, 0)
    ib.box([0.84, t + 0.2], 0.7, [0.02, 0.2, 0.04], '#1e1e1e', NM.dark, 0)
    ib.glowBox([0.845, t + 0.28], 1.0, [0.01, 0.12, 0.12], '#3ab0ff', -1, 1.4)
    ib.box(c, 1.72, [0.62, 0.97, 0.06], '#1f3550', NM.paint, 0.5, 0)
    ib.block('券売機', c, 0.6, 0.95, 0, 1.78)
  }
  ib.picture('soranowa-gate', [0.2, 3.45], 2.25, 1.2, 0.32, face, 2)
}

/* -------------------------------------------------------------------------- */
/* 窓口（きっぷうりば）: ガラスの仕切りのカウンターと、中の係員の机                         */
/* -------------------------------------------------------------------------- */

function booth(ib: InteriorBuilder) {
  const B = BOOTH
  const cs = B.s0 + 0.25
  const ct = (B.t0 + B.t1) / 2
  const len = B.t1 - B.t0
  // カウンター（客の側の腰と天板）・ガラスの仕切り・上の帯の看板
  ib.box([cs, ct], 0, [0.5, len, 1.02], '#e9ecee', NM.paint, 0.5, 0)
  ib.box([cs - 0.05, ct], 1.02, [0.62, len + 0.04, 0.05], '#7a5a3c', NM.wood, 0, 0)
  for (let i = 0; i <= 3; i++) ib.box([cs + 0.18, B.t0 + (len * i) / 3], 1.07, [0.05, 0.05, 1.33], '#c9ced2', NM.steel, 0.6, 0)
  ib.glass([cs + 0.18, B.t0, 1.08], [cs + 0.18, B.t1, 1.08], [cs + 0.18, B.t1, 2.38], [cs + 0.18, B.t0, 2.38])
  ib.box([cs + 0.1, ct], 2.4, [0.3, len + 0.1, 0.42], '#1f3550', NM.paint, 0.5, 0)
  ib.picture('soranowa-board', [cs - 0.06, ct], 2.61, 1.34, 0.4, Math.PI, 2)
  // 横と奥の壁（白い板）
  ib.box([(B.s0 + B.s1) / 2, B.t0 - 0.04], 0, [B.s1 - B.s0, 0.08, 2.82], '#eef0f0', IM.paintWall, 0)
  ib.box([(B.s0 + B.s1) / 2, B.t1 + 0.04], 0, [B.s1 - B.s0, 0.08, 2.82], '#eef0f0', IM.paintWall, 0)
  // 中の机と画面・椅子・きっぷの発券機
  ib.box([16.9, ct], 0, [0.6, 2.2, 0.74], '#d8d4ca', NM.wood, 0, 0)
  ib.box([16.75, ct - 0.4], 0.74, [0.03, 0.5, 0.32], '#1a1c20', IM.screen, 0, 0)
  ib.glowBox([16.73, ct - 0.4], 0.78, [0.01, 0.44, 0.24], '#7fb8ff', L('booth'), 1.2)
  ib.box([cs + 0.05, ct + 0.6], 1.07, [0.25, 0.3, 0.18], '#5a6066', NM.paint, 0.5, 0)
  ib.cyl([16.2, ct + 0.3], 0, 0.22, 0.46, '#2a2c30', IM.fabric, 0, 14)
  ib.block('窓口', [(B.s0 + B.s1) / 2, ct], B.s1 - B.s0, len + 0.2, 0, 2.82)
  // 窓口の前の「きっぷうりば」の札（吊り）
  ib.box([cs - 0.3, ct], 2.95, [0.02, 1.2, 0.3], '#ffffff', NM.paint, 0.4, 0)
}

/* -------------------------------------------------------------------------- */
/* 改札（自動改札 3 通路・両端のガラスの仕切り・係員の小さな台）                             */
/* -------------------------------------------------------------------------- */

function gates(ib: InteriorBuilder) {
  const G = GATES
  const tc = (G.t0 + G.t1) / 2
  const glen = G.t1 - G.t0
  // 改札機の本体（通路の間と両端）
  const bodies = [G.lanes[0] - 0.475, G.lanes[0] + 0.475, G.lanes[1] + 0.475, G.lanes[2] + 0.475]
  for (const s of bodies) {
    const c: L2 = [s, tc]
    ib.box(c, 0, [0.2, glen, 0.92], '#d9dcde', NM.paint, 0.6, 0)
    ib.box(c, 0.92, [0.22, glen + 0.02, 0.1], '#2a2e33', NM.paint, 0.7, 0)
    // IC の読み取り（青く光る）と、小さな画面
    ib.glowBox([s, G.t0 + 0.22], 1.02, [0.16, 0.16, 0.012], '#3ab0ff', -1, 1.6)
    ib.box([s, G.t0 + 0.5], 1.02, [0.14, 0.12, 0.06], '#121418', IM.screen, 0, 0)
    ib.glowBox([s, G.t0 + 0.5], 1.06, [0.12, 0.08, 0.012], '#5aff9a', -1, 0.9)
    // 通路の口の上の進んでよい印（緑の矢印の灯り）
    ib.glowBox([s, G.t0 + 0.02], 0.74, [0.12, 0.012, 0.1], '#3dff8a', -1, 1.2)
    // 開いたままの扉（両側へ引っ込んだ灰色の板）
    for (const side of [-1, 1]) ib.box([s + side * 0.13, tc + 0.05], 0.46, [0.05, 0.36, 0.42], '#e05a3a', IM.plastic, 0.6, 0)
    ib.block('改札機', c, 0.24, glen, 0, 1.05)
  }
  // 両端のガラスの仕切り（1.1m）
  const glassFence = (s0: number, s1: number, t: number) => {
    ib.box([(s0 + s1) / 2, t], 0, [s1 - s0, 0.06, 0.08], '#9aa0a4', NM.steel, 0.5, 0)
    ib.box([(s0 + s1) / 2, t], 1.06, [s1 - s0, 0.07, 0.05], '#c9ced2', NM.steel, 0.7, 0)
    const n = Math.max(1, Math.round((s1 - s0) / 1.2))
    for (let i = 0; i <= n; i++) ib.box([s0 + ((s1 - s0) * i) / n, t], 0, [0.05, 0.05, 1.1], '#c9ced2', NM.steel, 0.6, 0)
    ib.glass([s0, t, 0.08], [s1, t, 0.08], [s1, t, 1.06], [s0, t, 1.06])
    ib.block('仕切り', [(s0 + s1) / 2, t], s1 - s0, 0.12, 0, 1.1)
  }
  glassFence(IN + 0.05, bodies[0] - 0.1, tc)
  glassFence(bodies[3] + 0.1, 13.5, tc)
  // 係員の台（改札の東の端）
  const sc: L2 = [14.45, tc]
  ib.box(sc, 0, [1.7, 1.1, 1.05], '#e9ecee', NM.paint, 0.5, 0)
  ib.box(sc, 1.05, [1.76, 1.16, 0.05], '#7a5a3c', NM.wood, 0, 0)
  ib.box([14.2, tc + 0.1], 1.1, [0.36, 0.26, 0.24], '#1a1c20', IM.screen, 0, 0)
  ib.block('係員の台', sc, 1.7, 1.1, 0, 1.1)
  glassFence(15.35, 17.85 - 0.05, tc)
  // 改札の前の列の仕切り（ベルトの柱。真ん中の通路へ）
  for (const s of [BACK_S - 0.68, BACK_S + 0.68]) {
    const posts = [4.75, 5.55, 6.35]
    for (const t of posts) {
      ib.cyl([s, t], 0, 0.15, 0.03, '#2a2c30', NM.iron, 0.5, 14)
      ib.cyl([s, t], 0.03, 0.03, 0.92, '#c9ced2', NM.steel, 0.8, 10)
      ib.cyl([s, t], 0.95, 0.04, 0.05, '#c9ced2', NM.steel, 0.8, 10)
      ib.disc('列の柱', [s, t], 0.12, 0, 1)
    }
    ib.box([s, (posts[0] + posts[2]) / 2], 0.86, [0.012, posts[2] - posts[0], 0.06], '#1f3550', IM.fabric, 0, 0)
  }
}

/* -------------------------------------------------------------------------- */
/* 案内（改札の上の料金と営業時間・のりば・灯りの読み方・てっぺんからの眺め・ポスター）          */
/* -------------------------------------------------------------------------- */

function boards(ib: InteriorBuilder) {
  const back = -Math.PI / 2 // −t を向く（入口の側から読む）
  // 改札の上に吊る大きな案内と「のりば」
  ib.box([BACK_S, 6.32], 2.52, [1.82, 0.06, 0.82], '#1f3550', NM.paint, 0.5, 0)
  ib.picture('soranowa-board', [BACK_S, 6.28], 2.93, 1.74, 0.725, back, 2)
  for (const s of [BACK_S - 0.8, BACK_S + 0.8]) ib.beam([s, 6.32, 3.34], [s, 6.32, CEIL], 0.02, '#9aa0a4', NM.steel, 0.5)
  ib.picture('soranowa-gate', [BACK_S, GATES.t0 - 0.02], 2.15, 1.3, 0.34, back, 2)
  ib.box([BACK_S, GATES.t0 + 0.01], 1.96, [1.36, 0.04, 0.4], '#1f3550', NM.paint, 0.5, 0)
  ib.beam([BACK_S, GATES.t0 + 0.01, 2.16], [BACK_S, GATES.t0 + 0.01, CEIL], 0.025, '#9aa0a4', NM.steel, 0.5)
  // 吊った案内の板はカメラが避け、見通しもさえぎる（改札を追うカメラが板の裏に入っていた。town.md の §7 の 148）
  ib.block('吊った案内', [BACK_S, 6.32], 1.82, 0.06, 2.52, 3.34, 0, false, true)
  ib.block('のりばの案内', [BACK_S, GATES.t0 + 0.01], 1.36, 0.04, 1.96, 2.36, 0, false, true)
  // 自立の案内の板（灯りの読み方・てっぺんからの眺め）
  const panel = (c: L2, facing: number, key: 'soranowa-tide' | 'soranowa-view', wpx: number, hpx: number, h: number) => {
    const ww = 0.9
    const hh = (ww * hpx) / wpx
    const nx = Math.cos(facing)
    const ny = Math.sin(facing)
    for (const side of [-1, 1]) {
      const p = at(c, facing + Math.PI / 2, side * (ww / 2 + 0.03), 0)
      ib.box(p, 0, [0.05, 0.05, h + hh / 2 + 0.06], '#9aa0a4', NM.steel, 0.5, 0)
    }
    ib.box([c[0] - nx * 0.02, c[1] - ny * 0.02], h - hh / 2 - 0.03, [Math.abs(ny) * (ww + 0.06) + Math.abs(nx) * 0.03, Math.abs(nx) * (ww + 0.06) + Math.abs(ny) * 0.03, hh + 0.06], '#ffffff', NM.paint, 0.4, 0)
    ib.picture(key, c, h, ww, hh, facing, 0, 0.012)
    ib.block('案内の板', c, Math.abs(ny) * ww + 0.2, Math.abs(nx) * ww + 0.2, 0, h + hh / 2)
  }
  panel([1.25, 6.4], 0, 'soranowa-tide', 420, 540, 1.45)
  panel([6.9, 6.9], back, 'soranowa-view', 520, 340, 1.42)
  // ポスター（係員の台の横の板）
  ib.box([14.45, GATES.t0 + 0.42], 1.15, [0.62, 0.03, 0.86], '#ffffff', NM.paint, 0.4, 0)
  ib.picture('soranowa-poster', [14.45, GATES.t0 + 0.4], 1.57, 0.56, 0.79, back, 0)
}

/* -------------------------------------------------------------------------- */
/* ロビー（ベンチ・ホイールの模型・植木）                                                */
/* -------------------------------------------------------------------------- */

function lobby(ib: InteriorBuilder) {
  // 正面のガラスの前のベンチ（白い鋼の脚と木の座面）
  for (const [s0, s1] of [
    [1.6, 4.6],
    [12.4, 14.6],
  ]) {
    const c: L2 = [(s0 + s1) / 2, 0.75]
    ib.box(c, 0.42, [s1 - s0, 0.44, 0.05], '#b07a4a', NM.wood, 0, 0)
    for (const s of [s0 + 0.12, s1 - 0.12]) ib.box([s, 0.75], 0, [0.06, 0.4, 0.42], '#d9dcde', NM.paint, 0.5, 0)
    ib.block('ベンチ', c, s1 - s0, 0.44, 0, 0.47)
  }
  // ホイールの模型（台の上のガラスの箱。白い輪・スポーク・脚・小さなゴンドラ）
  const mc: L2 = [5.4, 4.6]
  ib.box(mc, 0, [0.9, 0.9, 0.82], '#eef0f0', NM.paint, 0.5, 0)
  ib.box(mc, 0.82, [0.94, 0.94, 0.03], '#7a5a3c', NM.wood, 0, 0)
  const yawW = Math.PI / 2 - Math.atan2(UP[1], UP[0])
  const cx = 0.85 + 0.42
  const R0 = 0.34
  const P2 = (a: number, r: number, off = 0): [number, number, number] => {
    const p = at(mc, yawW, Math.cos(a) * r, off)
    return [p[0], p[1], cx + Math.sin(a) * r]
  }
  for (let i = 0; i < 36; i++) {
    const a0 = (i / 36) * Math.PI * 2
    const a1 = ((i + 1) / 36) * Math.PI * 2
    for (const off of [-0.035, 0.035]) ib.beam(P2(a0, R0, off), P2(a1, R0, off), 0.012, '#f4f4f2', NM.paint, 0.6)
    if (i % 3 === 0) ib.beam(P2(a0, 0.02), P2(a0, R0), 0.004, '#d9dcde', NM.steel, 0.5)
    if (i % 3 === 0) {
      const g = P2(a0, R0 + 0.035)
      const colors = ['#c85a4a', '#4a7ac8', '#d8b84a', '#4aa86a', '#b06aa0']
      ib.box([g[0], g[1]], g[2] - 0.05, [0.04, 0.03, 0.04], colors[(i / 3) % 5], NM.paint, 0.6, yawW)
    }
  }
  for (const sx of [-1, 1]) for (const off of [-0.09, 0.09]) ib.beam(P2(0, 0, off), [at(mc, yawW, sx * 0.24, off * 2.2)[0], at(mc, yawW, sx * 0.24, off * 2.2)[1], 0.85], 0.014, '#f4f4f2', NM.paint, 0.6)
  ib.glass([mc[0] - 0.44, mc[1] - 0.44, 0.85], [mc[0] + 0.44, mc[1] - 0.44, 0.85], [mc[0] + 0.44, mc[1] - 0.44, 1.75], [mc[0] - 0.44, mc[1] - 0.44, 1.75])
  ib.glass([mc[0] + 0.44, mc[1] + 0.44, 0.85], [mc[0] - 0.44, mc[1] + 0.44, 0.85], [mc[0] - 0.44, mc[1] + 0.44, 1.75], [mc[0] + 0.44, mc[1] + 0.44, 1.75])
  ib.glass([mc[0] - 0.44, mc[1] + 0.44, 0.85], [mc[0] - 0.44, mc[1] - 0.44, 0.85], [mc[0] - 0.44, mc[1] - 0.44, 1.75], [mc[0] - 0.44, mc[1] + 0.44, 1.75])
  ib.glass([mc[0] + 0.44, mc[1] - 0.44, 0.85], [mc[0] + 0.44, mc[1] + 0.44, 0.85], [mc[0] + 0.44, mc[1] + 0.44, 1.75], [mc[0] + 0.44, mc[1] - 0.44, 1.75])
  ib.block('ホイールの模型', mc, 0.95, 0.95, 0, 1.75)
  // 植木（四隅）
  plant(ib, [0.75, 0.75], 0, 0.9)
  plant(ib, [17.2, 0.75], 0, 0.9)
  plant(ib, [0.8, 9.1], 0, 0.8)
  plant(ib, [17.2, 9.0], 0, 0.8)
}

/* -------------------------------------------------------------------------- */
/* 天井の灯り（細長い光る板）                                                          */
/* -------------------------------------------------------------------------- */

function ceiling(ib: InteriorBuilder) {
  for (const l of LAMPS) {
    if (l.kind !== 'ceiling') continue
    ib.box([l.at[0], l.at[1]], CEIL - 0.06, [1.5, 0.3, 0.06], '#e6e8e8', NM.paint, 0.5, 0)
    ib.glowBox([l.at[0], l.at[1]], CEIL - 0.075, [1.4, 0.22, 0.02], '#fff6ea', L(l.id), 1.6)
  }
  // 案内の板を照らすスポット
  ib.box([BACK_S, 6.0], CEIL - 0.25, [0.12, 0.12, 0.25], '#2a2c30', NM.iron, 0.5, 0)
  ib.glowCyl([BACK_S, 5.98], CEIL - 0.27, 0.05, 0.02, '#fff2e0', L('board'), 1.2)
}

/* -------------------------------------------------------------------------- */
/* 外の障害物（台の屋根の柱）                                                          */
/* -------------------------------------------------------------------------- */

function outside(ib: InteriorBuilder) {
  for (const x of [-8.0, -2.6, 2.4, 7.0]) ib.disc('台の屋根の柱', w(x, PLATFORM.canopy.z0 + 0.15), 0.3, -0.2, DECK + 2.9)
}
