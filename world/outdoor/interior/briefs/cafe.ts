import * as THREE from 'three'
import { headingOf, sceneOf } from '../../../../core/interiors'
import { outdoor } from '../../../environment/daylight'
import { KitBuilder } from '../../named/kitBuilder'
import { NM } from '../../named/namedMaterial'
import type { InteriorBuilder } from '../builder'
import { at, cabinet, chair, frame, mug, pendant, plant, smallPlant, stool, table } from '../furniture'
import { IM } from '../interiorMaterial'
import type { InteriorModel } from '../model'
import type { DecorContext, Finish, InteriorBrief, InteriorDecor, L2, LampDef } from '../types'

/**
 * Café Platform 1872 の中（停車場通一丁目2番1号。桜見駅の右翼の角。設定: vol2 3-6・D-051）。
 * 局所の座標 s = 正面（北西の面）に沿って外から見て右へ（南西へ）・t = 奥へ（南東へ）。正面の外形の線が t = 0、駅舎の側の壁が s = 0。床 4.84m。
 *
 * - 旧駅の待合室を模した内装: 木の床・腰板と生成りの漆喰の壁・高い天井（6.9m。板張りの天井と黒い鉄のトラス 4 組）・長いコードの黒いペンダント
 * - 席（データの席の配置）: 店内テーブル 8 卓（窓際の 1〜4 番、奥の 5〜8 番）・カウンター 6 席（店の中央）・テラス 4 卓（外観の型が作る）
 *   2 番テーブルは正面の窓の真ん中の窓（窓 B）。窓のやや右（北北西、約 470m 先）に、まるの森の木々の向こうのガーデンドームが見える（花音の定位置）
 * - カウンターは古いレールを再利用した腰（レールの断面を 3 段）と厚い一枚板。上に 1872 年当時の駅名標の複製（「櫻見」）を吊る。
 *   カウンターの奥にエスプレッソの機械（3 連の真鍮と銀）・ミル・カップの棚・カヌレのショーケース
 * - 鉄道の手がかり: 明晴期の時刻表の額・セピアの写真 3 枚（初代の停車場・一号機関車・開業の日のホーム）・鉄道の旅のポスター・
 *   駅の掛け時計（町の時刻）・機関車の番号板「1872」・信号灯と発車ベル・待合室の長いベンチ・模型の機関車のショーケース・駅舎への扉
 * - 奥の左は厨房（扉）。駅舎の中への扉（データの side の入口）は左の壁（s = 0.45、t = 7）に、閉じた扉として作る（駅舎の中は無い）
 */

const F = (color: string, mat: number, aux = 0): Finish => ({ color, mat, aux })

export const CAFE = {
  W: 16.05,
  D: 14,
  inset: 0.45,
  ceil: 6.9,
  /** 入口（データの入口を正面の辺へ寄せた所。外観の型と同じ） */
  doorS: 8.06,
  /** カウンター（店の中央）と奥の台 */
  counter: { s0: 3.9, s1: 11.1, t0: 5.0, t1: 5.65, h: 1.05 },
  back: { t0: 7.15, t1: 7.75 },
  /** カウンターの丸椅子（s）と、その奥行き t。花音の席は 3 つ目（s = 6.9） */
  stools: [4.6, 5.75, 6.9, 8.05, 9.2, 10.35],
  stoolT: 4.6,
  /** 2 番テーブル（窓 B の前）と、窓に向いた背もたれの無いベンチ。花音の席は s = 6.05（ドームの方角の線が窓 B の中を通る） */
  t2: { s: 5.7, t: 1.2, benchT: 2.0, seatS: 6.05 },
} as const

const C = CAFE
const IN = C.inset
const S1 = C.W - IN
const T1 = C.D - IN
const KITCHEN_T = 9.8
const KITCHEN_S = 6.2

/** テーブル（番号 → 中心と形）。1〜4 は窓際、5〜8 は奥 */
const TABLES: { n: number; c: L2; kind: 'round' | 'bench' | 'square' }[] = [
  { n: 1, c: [2.2, 1.35], kind: 'round' },
  { n: 2, c: [C.t2.s, C.t2.t], kind: 'bench' },
  { n: 3, c: [11.3, 1.35], kind: 'round' },
  { n: 4, c: [14.5, 2.55], kind: 'square' },
  { n: 5, c: [8.6, 9.6], kind: 'square' },
  { n: 6, c: [12.4, 9.6], kind: 'square' },
  { n: 7, c: [8.6, 12.35], kind: 'square' },
  { n: 8, c: [12.4, 12.35], kind: 'square' },
]

const WARM = '#ffd9a8'
const HOURS: [number, number] = [7, 22]
const lamp = (id: string, room: string, a: [number, number, number], power: number, range: number, kind: LampDef['kind'] = 'pendant', color = WARM, dir?: [number, number, number]): LampDef => ({ id, room, at: a, color, power, range, kind, schedule: 'shop', hours: HOURS, dir })

const COUNTER_PENDANTS = [4.8, 6.6, 8.4, 10.2]
const TRUSS_S = [2.3, 6.1, 9.9, 13.7]

const LAMPS: LampDef[] = [
  ...TABLES.map((t) => lamp(`table-${t.n}`, 'cafe', [t.c[0], t.c[1], 2.05], 0.55, 4.2)),
  ...COUNTER_PENDANTS.map((s, i) => lamp(`counter-${i}`, 'cafe', [s, (C.counter.t0 + C.counter.t1) / 2, 2.2], 0.5, 4.2)),
  lamp('backbar', 'cafe', [7.5, 6.95, 2.05], 0.6, 3.4, 'spot', '#ffe2c0', [0, 0.3, -1]),
  lamp('sconce-l1', 'cafe', [0.6, 2.3, 2.45], 0.28, 3.2, 'bulb'),
  lamp('sconce-l2', 'cafe', [0.6, 5.2, 2.45], 0.28, 3.2, 'bulb'),
  lamp('sconce-b1', 'cafe', [9.6, 13.4, 2.45], 0.28, 3.2, 'bulb'),
  lamp('sconce-b2', 'cafe', [14.4, 13.4, 2.45], 0.28, 3.2, 'bulb'),
  lamp('entry', 'cafe', [C.doorS, 1.6, 2.7], 0.35, 3.4, 'bulb'),
  lamp('vitrine', 'cafe', [14.95, 6.3, 1.1], 0.18, 2.2, 'bulb', '#fff0d8'),
  lamp('kitchen', 'kitchen', [3.3, 11.7, 3.1], 0.75, 5, 'ceiling', '#fff4e4'),
  lamp('truss-up-1', 'cafe', [6.1, 6.8, 5.6], 0.9, 7.5, 'spot', '#ffcf9a', [0, 0, 1]),
  lamp('truss-up-2', 'cafe', [9.9, 6.8, 5.6], 0.9, 7.5, 'spot', '#ffcf9a', [0, 0, 1]),
]
const L = (id: string) => LAMPS.findIndex((l) => l.id === id)

export const CAFE_BRIEF: InteriorBrief = {
  zone: 'cafe',
  wallT: 0.14,
  inset: IN,
  rooms: [
    {
      id: 'cafe',
      name: '店（旧駅の待合室を模した内装）',
      level: 0,
      poly: [
        [IN, IN],
        [S1, IN],
        [S1, T1],
        [KITCHEN_S, T1],
        [KITCHEN_S, KITCHEN_T],
        [IN, KITCHEN_T],
      ],
      floorFinish: F('#76522f', IM.woodFloor, 0.13),
      wallFinish: F('#e6dac0', NM.plaster),
      ceilingFinish: F('#4e3626', IM.woodFloor, 0.16),
      wainscot: { h: 1.15, finish: F('#4a3022', NM.boardV, 0.16) },
      baseboard: '#2e1e14',
    },
    {
      id: 'kitchen',
      name: '厨房',
      level: 0,
      poly: [
        [IN, KITCHEN_T],
        [KITCHEN_S, KITCHEN_T],
        [KITCHEN_S, T1],
        [IN, T1],
      ],
      ceiling: 3.2,
      floorFinish: F('#8c8780', NM.tileClad, 0.2),
      wallFinish: F('#eeeae2', NM.tileClad, 0.15),
      ceilingFinish: F('#f2efe8', IM.paintWall),
      baseboard: '#8a8a86',
    },
  ],
  doors: [
    // 入口の両開きのガラス扉（外観の開く扉）。アーチの開口なので、穴はアーチの起点の高さまで（上は外観の開口の穴）
    { id: 'front', level: 0, at: [C.doorS, IN / 2], axis: 's', width: 1.9, height: 2.62, kind: 'named', entrance: 0, thickness: IN, floor: 0 },
    // 厨房への扉（カウンターの奥の左）
    { id: 'kitchen', level: 0, at: [5.3, KITCHEN_T], axis: 's', width: 0.9, height: 2.1, kind: 'swing', hinge: 1, side: 1, color: '#3e2a1c', style: 'glass', frame: '#2e1e14', floor: 0 },
  ],
  stairs: [],
  outdoor: [
    // 正面の前の歩道（駅舎の前から続く。テラスとの間）・テラス・駅前広場・テラスの柵の切れ目（入口の正面）
    { id: 'walk', poly: [[-6, -3.1], [C.W + 4, -3.1], [C.W + 4, -0.02], [-6, -0.02]], h: 'terrain' },
    { id: 'terrace', poly: [[0.25, -9.3], [15.8, -9.3], [15.8, -1.7], [0.25, -1.7]], h: 'terrain' },
    { id: 'plaza', poly: [[-8, -22], [C.W + 6, -22], [C.W + 6, -9.15], [-8, -9.15]], h: 'terrain' },
    { id: 'gap', poly: [[C.doorS - 0.8, -9.9], [C.doorS + 0.8, -9.9], [C.doorS + 0.8, -8.6], [C.doorS - 0.8, -8.6]], h: 'terrain' },
  ],
  lamps: LAMPS,
  navPoints: [
    { at: [C.doorS, 1.35], level: 0 },
    { at: [C.doorS, 3.4], level: 0 },
    { at: [3.4, 3.35], level: 0 },
    { at: [12.6, 3.35], level: 0 },
    { at: [13.0, 5.4], level: 0 },
    { at: [13.0, 7.9], level: 0 },
    { at: [10.5, 10.95], level: 0 },
    { at: [7.0, 10.95], level: 0 },
    { at: [2.6, 6.2], level: 0 },
    { at: [3.0, 8.6], level: 0 },
    { at: [5.3, 8.9], level: 0 },
    { at: [3.3, 11.6], level: 0 },
    { at: [C.doorS, -1.3], level: 0 },
    { at: [C.doorS, -5.6], level: 0 },
    { at: [C.doorS, -10.6], level: 0 },
    { at: [4.6, -2.6], level: 0 },
    { at: [3.0, -1.3], level: 0 },
    { at: [13.0, -1.3], level: 0 },
  ],
  furnish,
  decorate,
}

function furnish(ib: InteriorBuilder, m: InteriorModel) {
  void m
  ib.room('cafe')
  architecture(ib)
  counter(ib)
  backBar(ib)
  tables(ib)
  walls(ib)
  railwayThings(ib)
  terraceObstacles(ib)
  kitchen(ib)
}

/* -------------------------------------------------------------------------- */
/* 建物: トラス・付け柱・額の長押・天井の回り縁・入口の敷物                              */
/* -------------------------------------------------------------------------- */

function architecture(ib: InteriorBuilder) {
  const black = '#1e1d1c'
  // 鉄のトラス（t の向きに渡す。下弦 5.7m・上弦は天井の下・束と斜材・ボルトの板）。壁際の持ち送り
  for (const s of TRUSS_S) {
    const y0 = 5.62
    const y1 = C.ceil - 0.1
    const t0 = IN + 0.05
    const t1e = s < KITCHEN_S + 0.4 ? KITCHEN_T - 0.07 : T1 - 0.05
    ib.beam([s, t0, y0], [s, t1e, y0], 0.11, black, IM.steelBlack, 0, 0.17)
    ib.beam([s, t0, y1], [s, t1e, y1], 0.1, black, IM.steelBlack, 0, 0.12)
    const n = Math.round((t1e - t0) / 1.6)
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1e - t0) * i) / n
      ib.beam([s, t, y0], [s, t, y1], 0.06, black, IM.steelBlack, 0, 0.06)
      if (i < n) {
        const tn = t0 + ((t1e - t0) * (i + 1)) / n
        const up = i % 2 === 0
        ib.beam([s, t, up ? y0 : y1], [s, tn, up ? y1 : y0], 0.05, black, IM.steelBlack, 0, 0.05)
        ib.box([s, t], y0 - 0.02, [0.02, 0.26, 0.26], '#2a2826', IM.steelBlack, 0)
      }
    }
    // 壁の持ち送り（両端）
    for (const [t, d] of [
      [t0, 1],
      [t1e, -1],
    ] as [number, number][]) {
      ib.beam([s, t, y0 - 1.1], [s, t + d * 0.9, y0], 0.07, black, IM.steelBlack, 0, 0.07)
      ib.box([s, t + d * 0.04], y0 - 1.3, [0.18, 0.08, 1.4], black, IM.steelBlack, 0)
    }
  }
  // 天井の回り縁と、額の長押（壁の 3.1m。絵を吊る）
  const ring: [L2, L2][] = [
    [[IN, IN], [S1, IN]],
    [[S1, IN], [S1, T1]],
    [[S1, T1], [KITCHEN_S, T1]],
    [[KITCHEN_S, T1], [KITCHEN_S, KITCHEN_T]],
    [[KITCHEN_S, KITCHEN_T], [IN, KITCHEN_T]],
    [[IN, KITCHEN_T], [IN, IN]],
  ]
  for (const [a, b] of ring) {
    const d: L2 = [b[0] - a[0], b[1] - a[1]]
    const len = Math.hypot(d[0], d[1])
    const nIn: L2 = [-d[1] / len, d[0] / len]
    const c: L2 = [(a[0] + b[0]) / 2 + nIn[0] * 0.06, (a[1] + b[1]) / 2 + nIn[1] * 0.06]
    const yaw = Math.atan2(d[1], d[0])
    ib.box(c, C.ceil - 0.24, [len, 0.12, 0.24], '#d8ccb2', NM.plaster, 0, yaw, 0.85)
    const c2: L2 = [(a[0] + b[0]) / 2 + nIn[0] * 0.02, (a[1] + b[1]) / 2 + nIn[1] * 0.02]
    ib.box(c2, 3.08, [len, 0.04, 0.06], '#4a3022', NM.wood, 0, yaw)
    // 腰板の笠木
    ib.box([(a[0] + b[0]) / 2 + nIn[0] * 0.025, (a[1] + b[1]) / 2 + nIn[1] * 0.025], 1.12, [len, 0.05, 0.05], '#3a2418', NM.wood, 0, yaw)
  }
  // 付け柱（左の壁と奥の壁。腰板の上から回り縁まで）
  for (const t of [3.9, 8.6]) ib.box([IN + 0.06, t], 0, [0.12, 0.34, C.ceil - 0.24], '#d6c9ae', NM.plaster, 0, 0, 0.92)
  for (const s of [8.0, 11.8]) ib.box([s, T1 - 0.06], 0, [0.34, 0.12, C.ceil - 0.24], '#d6c9ae', NM.plaster, 0, 0, 0.92)
  // 入口の内の敷物（駅のタイル風の六角の目地の敷物）と、入口の上の小さな電球
  ib.box([C.doorS, 1.15], 0, [2.4, 1.3, 0.012], '#3a3228', IM.rug, 2, 0, 0.95)
  pendant(ib, [C.doorS, 1.6], 2.7, C.ceil, L('entry'), '#1e1e1e', 'bulb')
  // 窓台の上の小さな鉢（正面の窓・横の窓）
  for (const s of [1.3, 3.1, 4.8, 6.6, 10.4, 12.2]) smallPlant(ib, [s, IN + 0.08], 0.66, 0.16)
}

/* -------------------------------------------------------------------------- */
/* カウンター（古いレールの腰と厚い一枚板）と丸椅子・駅名標の複製                         */
/* -------------------------------------------------------------------------- */

function counter(ib: InteriorBuilder) {
  const k = C.counter
  const w = k.s1 - k.s0
  const cs = (k.s0 + k.s1) / 2
  const ct = (k.t0 + k.t1) / 2
  // 腰の芯（暗い板）と、客の側に古いレール 3 段（断面: 頭・腹・底。錆びた鉄と磨いた頭）
  ib.box([cs, ct + 0.04], 0, [w, k.t1 - k.t0 - 0.08, k.h - 0.08], '#2e2018', NM.boardV, 0.14)
  for (const [i, h] of [0.18, 0.5, 0.82].entries()) {
    const t = k.t0 + 0.02
    ib.box([cs, t + 0.03], h - 0.08, [w, 0.13, 0.03], '#4a3a30', NM.iron, 0.25)
    ib.box([cs, t - 0.005], h - 0.05, [w, 0.02, 0.1], '#5a4636', NM.iron, 0.3)
    ib.box([cs, t - 0.01], h + 0.04, [w, 0.07, 0.045], i === 1 ? '#8c8a86' : '#7a746c', NM.steel, 0.35)
  }
  // 端の小口の板と、真鍮の足をのせる棒
  for (const s of [k.s0 + 0.02, k.s1 - 0.02]) ib.box([s, ct], 0, [0.05, k.t1 - k.t0 + 0.04, k.h - 0.07], '#3a2418', NM.wood, 0)
  ib.beam([k.s0 + 0.1, k.t0 - 0.12, 0.24], [k.s1 - 0.1, k.t0 - 0.12, 0.24], 0.035, '#9a7a3e', NM.gold, 0, 0.035)
  for (let i = 0; i <= 6; i++) {
    const s = k.s0 + 0.1 + ((w - 0.2) * i) / 6
    ib.beam([s, k.t0 - 0.12, 0.24], [s, k.t0 - 0.01, 0.3], 0.02, '#9a7a3e', NM.gold)
  }
  // 厚い一枚板（くるみ）
  ib.box([cs, ct - 0.05], k.h - 0.07, [w + 0.12, k.t1 - k.t0 + 0.24, 0.07], '#5e3e28', NM.wood, 0)
  ib.block('カウンター', [cs, ct - 0.02], w + 0.12, k.t1 - k.t0 + 0.3, 0, k.h)
  // 丸椅子（花音の席 = 3 つ目は通り道の障害物にしない）
  C.stools.forEach((s, i) => stool(ib, [s, C.stoolT], 0.74, '#5a3420', '#1e1e1e', 0.28, i !== 2))
  // カウンターの上: 花音の席のカフェラテ（受け皿・カップ・ラテアート）とカヌレ、ほかの席のカップ・紙ナプキン・メニュー立て
  const top = k.h
  const kt = k.t0 + 0.2
  ib.cyl([6.9, kt], top, 0.075, 0.012, '#f4f0e8', IM.ceramic, 0, 18)
  ib.cyl([6.9, kt], top + 0.012, 0.048, 0.075, '#1f4a36', IM.ceramic, 0, 16, 0.055)
  ib.cyl([6.9, kt], top + 0.082, 0.05, 0.003, '#c8925a', IM.ceramic, 0.3, 16)
  ib.cyl([6.9, kt], top + 0.0855, 0.024, 0.002, '#f4ecd8', IM.ceramic, 0.3, 10)
  ib.cyl([6.68, kt + 0.02], top, 0.06, 0.008, '#f4f0e8', IM.ceramic, 0, 14)
  ib.cyl([6.68, kt + 0.02], top + 0.008, 0.028, 0.05, '#4a2410', NM.wood, 0, 10, 0.022)
  mug(ib, [9.2, kt], top, '#f2ede2')
  for (const s of [4.6, 8.05, 10.35]) ib.box([s + 0.18, kt + 0.05], top, [0.12, 0.12, 0.012], '#f2efe6', IM.fabric, 0, 0.2)
  ib.box([5.2, kt + 0.1], top, [0.1, 0.08, 0.16], '#1f4a36', NM.paint, 0.4)
  ib.picture('cafe-card', [5.2, kt + 0.055], top + 0.09, 0.12, 0.075, -Math.PI / 2, 0, 0.002)
  // 吊り下げの黒いペンダント（長いコード）
  COUNTER_PENDANTS.forEach((s, i) => pendant(ib, [s, ct], 2.2, C.ceil, L(`counter-${i}`), '#1a1a1a', 'cone'))
  // 駅名標の複製（カウンターの上。天井から鎖で吊る。両面）
  const sc: L2 = [7.5, ct]
  const bw = 2.5
  const bh = 0.76
  const by = 3.15
  ib.box(sc, by - 0.05, [bw + 0.12, 0.08, bh + 0.1], '#2a2420', NM.wood, 0)
  ib.picture('ekimeihyo', [sc[0], sc[1] - 0.042], by + bh / 2, bw, bh, -Math.PI / 2, 2, 0.002)
  ib.picture('ekimeihyo', [sc[0], sc[1] + 0.042], by + bh / 2, bw, bh, Math.PI / 2, 2, 0.002)
  for (const ds of [-1.05, 1.05]) ib.tube([sc[0] + ds, sc[1], by + bh + 0.05], [sc[0] + ds, sc[1], C.ceil - 0.1], 0.008, '#3a3632', NM.iron, 0.3, 6)
}

/** カウンターの奥: 奥の台（大理石の天板）・エスプレッソの機械（3 連）・ミル・カップの棚・メニューの黒板・カヌレのショーケース */
function backBar(ib: InteriorBuilder) {
  const k = C.counter
  const b = C.back
  const w = k.s1 - k.s0
  const cs = (k.s0 + k.s1) / 2
  const bt = (b.t0 + b.t1) / 2
  // 台（扉の付いた腰と、白い大理石の天板）
  ib.box([cs, bt], 0, [w, b.t1 - b.t0, 0.9], '#3a2618', NM.wood, 0)
  for (let i = 0; i < 8; i++) {
    const s = k.s0 + 0.45 + i * ((w - 0.9) / 7)
    ib.box([s, b.t0 - 0.005], 0.12, [0.7, 0.012, 0.66], '#4a3222', NM.wood, 0)
    ib.box([s + 0.26, b.t0 - 0.02], 0.62, [0.03, 0.02, 0.1], '#b8913a', NM.gold)
  }
  ib.box([cs, bt], 0.9, [w + 0.06, b.t1 - b.t0 + 0.04, 0.04], '#e8e4dc', NM.granite, 0)
  ib.block('奥の台', [cs, bt], w + 0.06, b.t1 - b.t0 + 0.06, 0, 0.94)
  // 奥の台の裏（奥の席の側）: 駅の古い板の腰
  ib.box([cs, b.t1 + 0.01], 0, [w, 0.02, 0.9], '#5a3e2a', NM.boardV, 0.12)
  const top = 0.94
  // エスプレッソの機械（3 連。銀の胴・真鍮の上・黒い取っ手・湯気の管）
  const ec: L2 = [6.9, bt - 0.02]
  ib.box(ec, top, [1.05, 0.55, 0.5], '#c9ccd0', NM.steel, 0)
  ib.box(ec, top + 0.5, [1.08, 0.57, 0.05], '#b88a3a', NM.gold, 0)
  ib.cyl([ec[0] - 0.36, ec[1] + 0.05], top + 0.55, 0.06, 0.18, '#b88a3a', NM.gold, 0, 12, 0.03)
  ib.cyl([ec[0] + 0.36, ec[1] + 0.05], top + 0.55, 0.06, 0.18, '#b88a3a', NM.gold, 0, 12, 0.03)
  ib.lathe([ec[0], ec[1] + 0.05], top + 0.55, [
    [0.12, 0],
    [0.12, 0.08],
    [0.09, 0.16],
    [0.04, 0.22],
    [0.015, 0.26],
  ], 14, '#b88a3a', NM.gold, 0)
  for (const ds of [-0.32, 0, 0.32]) {
    ib.box([ec[0] + ds, ec[1] - 0.3], top + 0.22, [0.12, 0.08, 0.07], '#2a2a2a', NM.iron, 0.4)
    ib.box([ec[0] + ds, ec[1] - 0.42], top + 0.24, [0.03, 0.18, 0.03], '#1a1a1a', IM.plastic, 0.5)
    ib.cyl([ec[0] + ds, ec[1] - 0.3], top + 0.04, 0.04, 0.06, '#f4f0e8', IM.ceramic, 0, 10, 0.045)
  }
  ib.tube([ec[0] + 0.55, ec[1] - 0.2, top + 0.35], [ec[0] + 0.62, ec[1] - 0.32, top + 0.1], 0.008, '#c9ccd0', NM.steel)
  ib.box([ec[0], ec[1] - 0.28], top + 0.02, [0.95, 0.12, 0.015], '#3a3a3a', NM.iron, 0.3)
  // ミル 2 台・ドリップのポット・豆のガラス瓶
  for (const s of [5.6, 8.3]) {
    ib.box([s, bt], top, [0.2, 0.22, 0.32], '#2a2a2a', NM.iron, 0.4)
    ib.cyl([s, bt], top + 0.32, 0.09, 0.2, '#cfd8d8', IM.plastic, 0.85, 14, 0.06)
  }
  for (const s of [4.5, 4.75, 5.0]) {
    ib.cyl([s, bt - 0.05], top, 0.065, 0.14, '#c8ccd0', NM.steel, 0, 14, 0.05)
    ib.tube([s + 0.06, bt - 0.05, top + 0.09], [s + 0.15, bt - 0.12, top + 0.18], 0.007, '#c8ccd0', NM.steel)
  }
  for (let i = 0; i < 6; i++) {
    const s = 9.0 + i * 0.22
    ib.cyl([s, bt + 0.08], top, 0.07, 0.22, ['#3a2210', '#4a2c14', '#2a180c'][i % 3], IM.plastic, 0.85, 12)
    ib.cyl([s, bt + 0.08], top + 0.22, 0.075, 0.03, '#b8913a', NM.gold, 0, 12)
  }
  // 上の棚（両端の柱と 2 段のガラスの棚板。カップとソーサー・グラス）。棚の下の灯り
  for (const s of [k.s0 + 0.1, k.s1 - 0.1, cs]) ib.box([s, b.t1 - 0.08], top, [0.08, 0.08, 1.5], '#3a2418', NM.wood, 0)
  for (const h of [1.62, 2.12]) {
    ib.box([cs, b.t1 - 0.16], h, [w - 0.1, 0.3, 0.03], '#4a3022', NM.wood, 0)
    for (let i = 0; i < 22; i++) {
      const s = k.s0 + 0.35 + i * ((w - 0.7) / 21)
      if (Math.abs(s - cs) < 0.15) continue
      if (h < 2) ib.cyl([s, b.t1 - 0.16], h + 0.03, 0.045, 0.08, i % 5 === 0 ? '#1f4a36' : '#f4f0e8', IM.ceramic, 0, 12, 0.05)
      else ib.cyl([s, b.t1 - 0.16], h + 0.03, 0.035, 0.13, '#dfe8ea', IM.plastic, 0.9, 10, 0.04)
    }
  }
  ib.box([cs, b.t1 - 0.1], 2.42, [w + 0.1, 0.36, 0.1], '#3a2418', NM.wood, 0)
  ib.glowBox([cs, b.t1 - 0.18], 1.58, [w - 0.3, 0.03, 0.012], '#ffd8a8', L('backbar'), 2)
  // メニューの黒板（棚の上、客の側を向く）
  ib.box([4.95, b.t1 - 0.05], 2.52, [1.0, 0.05, 1.32], '#3a2418', NM.wood, 0)
  ib.picture('cafe-menu', [4.95, b.t1 - 0.08], 2.52 + 0.66, 0.92, 1.24, -Math.PI / 2, 2, 0.002)
  // カヌレのショーケース（カウンターの右の端の上。木の枠とガラス・カヌレの列）
  const sh: L2 = [10.45, (k.t0 + k.t1) / 2 - 0.02]
  const kh = k.h
  ib.box(sh, kh, [0.95, 0.5, 0.03], '#3a2418', NM.wood, 0)
  ib.box(sh, kh + 0.42, [0.95, 0.5, 0.025], '#3a2418', NM.wood, 0)
  for (const ds of [-0.46, 0.46]) for (const dt of [-0.23, 0.23]) ib.box([sh[0] + ds, sh[1] + dt], kh + 0.03, [0.025, 0.025, 0.39], '#3a2418', NM.wood, 0)
  ib.box(sh, kh + 0.2, [0.9, 0.45, 0.012], '#d8e0e2', IM.plastic, 0.9)
  for (let i = 0; i < 8; i++) {
    const p: L2 = [sh[0] - 0.33 + (i % 4) * 0.22, sh[1] - 0.1 + Math.floor(i / 4) * 0.2]
    ib.cyl(p, kh + (i < 4 ? 0.03 : 0.215), 0.032, 0.05, '#5a2a10', NM.wood, 0, 10, 0.025)
  }
  // ガラス（客の側と左右）
  const g = (a: L2, b2: L2) => ib.glass([a[0], a[1], kh + 0.03], [b2[0], b2[1], kh + 0.03], [b2[0], b2[1], kh + 0.42], [a[0], a[1], kh + 0.42])
  g([sh[0] - 0.47, sh[1] - 0.24], [sh[0] + 0.47, sh[1] - 0.24])
  g([sh[0] + 0.47, sh[1] - 0.24], [sh[0] + 0.47, sh[1] + 0.24])
  g([sh[0] - 0.47, sh[1] + 0.24], [sh[0] - 0.47, sh[1] - 0.24])
}

/* -------------------------------------------------------------------------- */
/* テーブル 8 卓（窓際の 1〜4、奥の 5〜8）と椅子・吊り下げの灯り                          */
/* -------------------------------------------------------------------------- */

function tables(ib: InteriorBuilder) {
  const wood = '#5e3e28'
  const chairC = '#3e2818'
  for (const tb of TABLES) {
    const c = tb.c
    if (tb.kind === 'round') {
      // 丸いテーブル（鉄の 1 本脚）と 2 脚の椅子
      ib.cyl(c, 0.7, 0.36, 0.035, wood, NM.wood, 0, 24)
      ib.cyl(c, 0.02, 0.04, 0.68, '#1e1e1e', IM.steelBlack, 0, 10)
      ib.cyl(c, 0, 0.22, 0.03, '#1e1e1e', IM.steelBlack, 0, 16)
      ib.disc('テーブル', c, 0.38, 0, 0.74)
      chair(ib, [c[0] - 0.66, c[1] + 0.05], 0, chairC, 0.46, '#7a3a2a')
      chair(ib, [c[0] + 0.66, c[1] + 0.05], Math.PI, chairC, 0.46, '#7a3a2a')
    } else if (tb.kind === 'bench') {
      // 2 番テーブル（窓に向いた 2 人掛け。背もたれの無い革張りのベンチ。花音の定位置）
      table(ib, 'テーブル', c, 1.3, 0.62, 0.72, 0, wood)
      const bt = C.t2.benchT
      ib.box([c[0], bt], 0.04, [1.4, 0.42, 0.38], '#3a2418', NM.wood, 0)
      ib.box([c[0], bt], 0.42, [1.38, 0.4, 0.06], '#6a3424', IM.leather, 0)
      for (const ds of [-0.62, 0.62]) for (const dt of [-0.15, 0.15]) ib.box([c[0] + ds, bt + dt], 0, [0.05, 0.05, 0.05], '#1e1e1e', NM.iron)
      // ベンチの s の小さい半分だけ通り道の障害物（大きい半分 s = 6.05 が花音の席。そこから窓 B のやや右にドームが見える）
      ib.block('ベンチ', [c[0] - 0.4, bt], 0.6, 0.42, 0, 0.48, 0, true, false)
    } else {
      // 四角いテーブル（4 人掛け）と椅子 4 脚（奥の 7・8 番は壁のベンチの側に椅子を置かない）
      table(ib, 'テーブル', c, 0.8, 0.8, 0.72, 0, wood)
      const back = tb.n === 7 || tb.n === 8
      chair(ib, [c[0], c[1] - 0.62], Math.PI / 2, chairC, 0.46, '#2f4a3a')
      if (!back) chair(ib, [c[0], c[1] + 0.62], -Math.PI / 2, chairC, 0.46, '#2f4a3a')
      if (tb.n !== 4) {
        chair(ib, [c[0] - 0.62, c[1]], 0, chairC, 0.46, '#2f4a3a')
        chair(ib, [c[0] + 0.62, c[1]], Math.PI, chairC, 0.46, '#2f4a3a')
      } else chair(ib, [c[0] - 0.62, c[1]], 0, chairC, 0.46, '#2f4a3a')
    }
    // 吊り下げの灯り（黒い琺瑯の傘・長いコード）
    pendant(ib, c, 2.05, C.ceil, L(`table-${tb.n}`), '#1a1a1a', 'cone')
    // テーブルの上: 小さな一輪挿しと、番号の札
    const topH = tb.kind === 'round' ? 0.735 : 0.72
    ib.cyl([c[0] + 0.12, c[1] - 0.08], topH, 0.025, 0.11, '#e8eef0', IM.plastic, 0.9, 10, 0.018)
    ib.box([c[0] + 0.12, c[1] - 0.08], topH + 0.11, [0.06, 0.06, 0.08], ['#e85a6a', '#f2d14b', '#ffffff'][tb.n % 3], NM.cloth, 0)
  }
  // 2 番テーブルの上: 花音のカフェラテ（ラテアート）とカヌレ・ノート
  const t2 = C.t2
  const top = 0.72
  const ks = t2.seatS
  ib.cyl([ks + 0.12, t2.t + 0.12], top, 0.075, 0.012, '#f4f0e8', IM.ceramic, 0, 18)
  ib.cyl([ks + 0.12, t2.t + 0.12], top + 0.012, 0.048, 0.075, '#f4f0e8', IM.ceramic, 0, 16, 0.055)
  ib.cyl([ks + 0.12, t2.t + 0.12], top + 0.082, 0.05, 0.003, '#c8925a', IM.ceramic, 0.3, 16)
  ib.cyl([ks + 0.12, t2.t + 0.12], top + 0.0855, 0.022, 0.002, '#f4ecd8', IM.ceramic, 0.3, 10)
  ib.cyl([ks - 0.12, t2.t + 0.05], top, 0.06, 0.008, '#f4f0e8', IM.ceramic, 0, 14)
  ib.cyl([ks - 0.12, t2.t + 0.05], top + 0.008, 0.028, 0.05, '#4a2410', NM.wood, 0, 10, 0.022)
  ib.box([t2.s - 0.35, t2.t + 0.05], top, [0.22, 0.16, 0.012], '#2a4a6a', NM.paint, 0.2, 0.15)
  // 窓辺の観葉植物（大きな鉢）
  plant(ib, [IN + 0.42, IN + 0.42], 0, 0.48, '#6a4a3a', '#3c6a32', 1.9)
  plant(ib, [S1 - 0.45, 4.4], 0, 0.5, '#6a4a3a', '#456e38', 2.1)
  plant(ib, [9.5, IN + 0.38], 0, 0.36, '#6a4a3a', '#4a7a3a', 1.5)
}

/* -------------------------------------------------------------------------- */
/* 壁: 待合室の長いベンチ・時刻表の額・セピアの写真・ポスター・掛け時計の枠・壁の灯り・駅舎への扉        */
/* -------------------------------------------------------------------------- */

function walls(ib: InteriorBuilder) {
  // 左の壁（s = 0.45。駅舎の側）: 待合室の長いベンチ（背もたれ付き）と、その上のセピアの写真・時刻表
  const bench: L2 = [IN + 0.3, 2.35]
  ib.box(bench, 0.42, [0.5, 2.6, 0.05], '#6a4428', NM.wood, 0)
  for (let i = 0; i < 6; i++) ib.box([IN + 0.06, bench[1] - 1.2 + i * 0.48], 0.5, [0.04, 0.4, 0.62], '#5a3a22', NM.wood, 0)
  ib.box([IN + 0.05, bench[1]], 1.06, [0.06, 2.6, 0.06], '#4a2e1c', NM.wood, 0)
  for (const dt of [-1.22, 0, 1.22]) {
    ib.box([bench[0] + 0.18, bench[1] + dt], 0, [0.06, 0.06, 0.42], '#2a1a10', NM.wood, 0)
    ib.box([bench[0], bench[1] + dt], 0.42, [0.5, 0.05, 0.25], '#4a2e1c', NM.wood, 0)
  }
  ib.block('待合室のベンチ', bench, 0.55, 2.65, 0, 1.1)
  frame(ib, 'cafe-timetable', [IN + 0.012, 2.35], 2.1, 1.25, 0.92, 0, '#2a1a10')
  frame(ib, 'sepia-station', [IN + 0.012, 4.55], 1.95, 0.76, 0.54, 0, '#3a2a1a')
  frame(ib, 'sepia-steam', [IN + 0.012, 5.6], 2.25, 0.62, 0.41, 0, '#3a2a1a')
  frame(ib, 'sepia-platform', [IN + 0.012, 5.6], 1.62, 0.56, 0.4, 0, '#3a2a1a')
  // 駅舎の中への扉（閉じたまま。上半分に小さなガラス・真鍮の取っ手・「駅舎 コンコース」の札）
  const dt = 7.0
  ib.box([IN + 0.03, dt], 0, [0.06, 1.1, 2.3], '#3a2418', NM.wood, 0)
  ib.box([IN + 0.065, dt], 0.08, [0.02, 0.9, 2.1], '#4a3022', NM.wood, 0)
  for (const h of [0.25, 1.15]) ib.box([IN + 0.08, dt], h, [0.012, 0.74, 0.7], '#553826', NM.wood, 0)
  ib.box([IN + 0.075, dt], 1.5, [0.012, 0.6, 0.46], '#2a3034', IM.screen, 0)
  ib.box([IN + 0.1, dt - 0.36], 1.0, [0.06, 0.03, 0.12], '#b8913a', NM.gold, 0)
  ib.box([IN + 0.08, dt], 2.36, [0.03, 0.64, 0.2], '#1f4a36', NM.paint, 0.5)
  ib.picture('concourse-sign', [IN + 0.096, dt], 2.46, 0.6, 0.18, 0, 0, 0.002)
  // 掛け時計（左の壁の高い所。文字盤は絵、針は decorate で町の時刻に動かす）
  clockBody(ib)
  // 奥の壁（t = 13.55）: 鉄道の旅のポスター・時刻表の大きな額・壁の灯り。革張りの長いベンチ（背もたれ）
  frame(ib, 'rail-poster', [10.6, T1 - 0.012], 2.25, 0.62, 0.89, -Math.PI / 2, '#2a1a10')
  frame(ib, 'sepia-station', [13.6, T1 - 0.012], 2.15, 0.7, 0.5, -Math.PI / 2, '#3a2a1a')
  const banq: L2 = [10.5, T1 - 0.3]
  const bw = 7.6
  ib.box(banq, 0, [bw, 0.55, 0.42], '#3a2418', NM.wood, 0)
  ib.box([banq[0], banq[1] - 0.02], 0.42, [bw - 0.04, 0.52, 0.08], '#5e2a20', IM.leather, 0)
  ib.box([banq[0], T1 - 0.08], 0.48, [bw - 0.04, 0.14, 0.58], '#5a2a20', IM.leather, 0)
  ib.box([banq[0], T1 - 0.05], 1.06, [bw, 0.1, 0.05], '#3a2418', NM.wood, 0)
  ib.block('壁のベンチ', banq, bw, 0.58, 0, 1.1)
  // 壁の灯り（真鍮の腕と乳白のガラスの傘）
  for (const [p, f, key] of [
    [[IN + 0.02, 2.3], 0, 'sconce-l1'],
    [[IN + 0.02, 5.2], 0, 'sconce-l2'],
    [[9.6, T1 - 0.02], -Math.PI / 2, 'sconce-b1'],
    [[14.4, T1 - 0.02], -Math.PI / 2, 'sconce-b2'],
  ] as [L2, number, string][]) {
    ib.box(p, 2.32, [0.05, 0.12, 0.16], '#b8913a', NM.gold, 0, f - Math.PI / 2)
    const arm = at(p, f, 0.16, 0)
    ib.beam([p[0], p[1], 2.4], [arm[0], arm[1], 2.48], 0.016, '#b8913a', NM.gold)
    ib.glowCyl(arm, 2.38, 0.07, 0.13, '#fff1d8', L(key), 3.2, 0.05)
  }
}

/** 掛け時計の位置（左の壁・高さ 4.25m・半径 0.42m） */
const CLOCK = { t: 4.0, h: 4.25, r: 0.42 }

/** 掛け時計の胴（木の縁・文字盤の絵）。針は decorate */
function clockBody(ib: InteriorBuilder) {
  const c: L2 = [IN + 0.03, CLOCK.t]
  // 縁（24 角の木の帯）
  const n = 24
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    const p0: [number, number, number] = [IN + 0.05, CLOCK.t + Math.cos(a0) * (CLOCK.r + 0.04), CLOCK.h + Math.sin(a0) * (CLOCK.r + 0.04)]
    const p1: [number, number, number] = [IN + 0.05, CLOCK.t + Math.cos(a1) * (CLOCK.r + 0.04), CLOCK.h + Math.sin(a1) * (CLOCK.r + 0.04)]
    ib.beam(p0, p1, 0.07, '#3a2418', NM.wood, 0, 0.1)
  }
  ib.box(c, CLOCK.h - 0.05, [0.04, 0.1, 0.1], '#3a2418', NM.wood, 0)
  ib.picture('clock-face', [IN + 0.04, CLOCK.t], CLOCK.h, CLOCK.r * 2, CLOCK.r * 2, 0, 2, 0.01)
}

/* -------------------------------------------------------------------------- */
/* 鉄道の部品: 番号板・信号灯・発車ベル・模型の機関車のショーケース・トランク                    */
/* -------------------------------------------------------------------------- */

function railwayThings(ib: InteriorBuilder) {
  // 横の壁（s = 15.6）: 窓 1 と 2 の間に機関車の番号板「1872」と信号灯
  ib.box([S1 - 0.03, 4.4], 2.5, [0.05, 0.78, 0.32], '#1e1b18', NM.iron, 0.4)
  ib.picture('number-plate', [S1 - 0.06, 4.4], 2.66, 0.74, 0.29, Math.PI, 0, 0.002)
  // 信号灯（腕木の灯具。赤と緑のレンズ）を棚の上に
  const sig: L2 = [S1 - 0.25, 8.15]
  ib.box(sig, 1.15, [0.32, 0.3, 0.42], '#1e2a24', NM.iron, 0.35)
  ib.cyl([sig[0] - 0.17, sig[1]], 1.42, 0.07, 0.02, '#c82a1a', IM.plastic, 0.9, 12)
  ib.cyl(sig, 1.57, 0.05, 0.12, '#1e2a24', NM.iron, 0.35, 10)
  ib.box([sig[0], sig[1]], 0, [0.5, 0.5, 1.15], '#3a2418', NM.wood, 0)
  ib.block('信号灯の台', sig, 0.5, 0.5, 0, 1.6)
  // 発車ベル（入口の横の壁。真鍮の鐘と腕）
  const bell: L2 = [6.85, IN + 0.05]
  ib.box(bell, 2.6, [0.12, 0.05, 0.2], '#2a2420', NM.wood, 0)
  ib.beam([bell[0], bell[1] + 0.02, 2.72], [bell[0], bell[1] + 0.2, 2.72], 0.02, '#b8913a', NM.gold)
  ib.lathe([bell[0], bell[1] + 0.22], 2.52, [
    [0.11, 0],
    [0.1, 0.03],
    [0.07, 0.1],
    [0.055, 0.16],
    [0.02, 0.2],
  ], 14, '#c9a046', NM.gold, 0)
  // 模型の機関車のショーケース（窓 2 の下。ガラスの箱・線路・黒い機関車と客車）
  const v: L2 = [14.95, 6.3]
  ib.box(v, 0, [0.7, 1.9, 0.85], '#3a2418', NM.wood, 0)
  ib.box(v, 0.85, [0.66, 1.86, 0.02], '#2f4a3a', NM.cloth, 0)
  ib.box(v, 0.87, [0.12, 1.7, 0.01], '#6a5a4a', NM.iron, 0.3)
  ib.box([v[0], v[1] - 0.45], 0.88, [0.11, 0.42, 0.12], '#141414', IM.steelBlack, 0)
  ib.cyl([v[0], v[1] - 0.58], 0.98, 0.012, 0.06, '#141414', IM.steelBlack, 0, 8)
  for (const dt of [0.08, 0.5]) ib.box([v[0], v[1] + dt], 0.88, [0.1, 0.38, 0.1], '#5a2a1a', NM.paint, 0.4)
  ib.box(v, 1.25, [0.7, 1.9, 0.03], '#3a2418', NM.wood, 0)
  ib.glowBox(v, 1.235, [0.5, 1.6, 0.01], '#fff0d8', L('vitrine'), 1.6)
  const g0 = v[0] - 0.33
  const g1 = v[0] + 0.33
  ib.glass([g0, v[1] - 0.93, 0.87], [g0, v[1] + 0.93, 0.87], [g0, v[1] + 0.93, 1.25], [g0, v[1] - 0.93, 1.25])
  void g1
  ib.block('ショーケース', v, 0.72, 1.92, 0, 1.28)
  // 窓際の上の網棚（荷物棚）と古いトランク（待合室の名残り。正面の窓の間の壁の上）
  for (const s of [3.95, 9.5]) {
    ib.box([s, IN + 0.2], 2.95, [0.7, 0.36, 0.03], '#2a2420', NM.lattice, 0.03)
    ib.box([s, IN + 0.2], 2.98, [0.5, 0.3, 0.22], s < 5 ? '#6a3a20' : '#2f3a4a', IM.leather, 0)
  }
}

/** テラスの 4 卓と椅子（外観の型が作る形）の障害物と、テラスの柵 */
function terraceObstacles(ib: InteriorBuilder) {
  const s0 = 0.6
  const s1 = C.W - 0.6
  const t0 = -9.5 + 0.6
  const t1 = -2.5 - 0.4
  for (let i = 0; i < 4; i++) {
    const s = s0 + ((i + 0.5) / 4) * (s1 - s0)
    const t = (t0 + t1) / 2 + (i % 2 ? 0.8 : -0.8)
    ib.disc('テラスのテーブルと椅子', [s, t], 0.95, -0.2, 2.6, true, false)
  }
  // 柵（入口の正面の切れ目の外）
  ib.block('テラスの柵', [(s0 - 0.3 + C.doorS - 0.85) / 2, t0 - 0.3], C.doorS - 0.85 - (s0 - 0.3), 0.14, -0.3, 0.85)
  ib.block('テラスの柵', [(C.doorS + 0.85 + s1 + 0.3) / 2, t0 - 0.3], s1 + 0.3 - (C.doorS + 0.85), 0.14, -0.3, 0.85)
}

/* -------------------------------------------------------------------------- */
/* 厨房                                                                         */
/* -------------------------------------------------------------------------- */

function kitchen(ib: InteriorBuilder) {
  ib.room('kitchen')
  const steel = '#c4c8cc'
  // 壁沿いのステンレスの台（左の壁と奥の壁）・コンロとオーブン・流し・冷蔵庫・換気扇・棚
  cabinet(ib, '調理台', [IN + 0.35, 11.6], 3.2, 0.66, 0.88, Math.PI / 2, steel, 1, NM.steel, '#8a8a8a', 4)
  ib.box([IN + 0.35, 11.6], 0.88, [0.7, 3.24, 0.04], '#d8dcde', NM.steel, 0)
  cabinet(ib, '流しとコンロ', [3.6, T1 - 0.35], 3.4, 0.66, 0.88, Math.PI, steel, 1, NM.steel, '#8a8a8a', 4)
  ib.box([3.6, T1 - 0.35], 0.88, [3.44, 0.7, 0.04], '#d8dcde', NM.steel, 0)
  ib.box([2.6, T1 - 0.4], 0.8, [0.6, 0.45, 0.1], '#9aa0a4', NM.steel, 0)
  for (const ds of [-0.2, 0.2]) for (const dt of [-0.12, 0.12]) ib.cyl([4.4 + ds, T1 - 0.35 + dt], 0.92, 0.08, 0.02, '#1e1e1e', NM.iron, 0.3, 12)
  ib.box([4.4, T1 - 0.3], 1.9, [0.9, 0.55, 0.45], steel, NM.steel, 0)
  ib.solidBox('冷蔵庫', [KITCHEN_S - 0.45, 12.0], 0, [0.8, 0.7, 1.9], '#d8dcde', NM.steel, 0)
  for (const h of [1.5, 1.9]) {
    ib.box([IN + 0.18, 11.6], h, [0.32, 3.0, 0.03], steel, NM.steel, 0)
    for (let i = 0; i < 9; i++) ib.cyl([IN + 0.18, 10.4 + i * 0.3], h + 0.03, 0.1, 0.02 + (i % 3) * 0.02, '#f4f0e8', IM.ceramic, 0, 14)
  }
  pendant(ib, [3.3, 11.7], 3.0, 3.2, L('kitchen'), '#e8e4dc', 'dome')
}

/* -------------------------------------------------------------------------- */
/* 掛け時計の針（町の時刻）                                                         */
/* -------------------------------------------------------------------------- */

function decorate(ctx: DecorContext): InteriorDecor {
  const m = ctx.model
  const group = m.rooms.find((r) => r.id === 'cafe')?.group ?? 0
  const mk = (len: number, w: number, color: string) => {
    const b = new KitBuilder()
    b.dirt = 0
    b.groundY = group
    // 局所: x = 文字盤の外向き（厚み）、y = 針の向き（12 時）。根元から少し反対へ
    b.box([0, len / 2 - 0.05, 0], [0.012, len + 0.1, w], color, NM.iron, 0.3)
    const mesh = new THREE.Mesh(b.build(), ctx.surface)
    mesh.frustumCulled = false
    mesh.userData.noLocalShadow = true
    return mesh
  }
  const pivot = new THREE.Group()
  pivot.name = 'cafe:clock'
  const c = sceneOf(m.frame, IN + 0.07, CLOCK.t, CLOCK.h)
  pivot.position.set(...c)
  // 壁の法線（+s）の向きへ x を向ける
  pivot.rotation.y = headingOf(m.frame, 1, 0) - Math.PI / 2
  const hour = mk(CLOCK.r * 0.55, 0.035, '#141414')
  const minute = mk(CLOCK.r * 0.82, 0.024, '#141414')
  const second = mk(CLOCK.r * 0.86, 0.008, '#b8281c')
  hour.position.x = 0.004
  minute.position.x = 0.012
  second.position.x = 0.02
  pivot.add(hour, minute, second)
  const update = () => {
    const h = outdoor.time.hours
    const mm = (h % 1) * 60
    const ss = (mm % 1) * 60
    // 文字盤を外から（+x の側から）見て時計回り
    hour.rotation.x = -(((h % 12) / 12) * Math.PI * 2)
    minute.rotation.x = -((mm / 60) * Math.PI * 2)
    second.rotation.x = -((Math.floor(ss) / 60) * Math.PI * 2)
  }
  update()
  return {
    objects: [pivot],
    update,
    dispose: () => {
      for (const o of [hour, minute, second]) o.geometry.dispose()
    },
  }
}
