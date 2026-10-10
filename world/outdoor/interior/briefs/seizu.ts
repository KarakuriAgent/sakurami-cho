import { STAIRS } from '../../named/grade'
import { NM } from '../../named/namedMaterial'
import type { InteriorBuilder } from '../builder'
import { at, bookshelf, box, cabinet, chair, frame, pendant, plant, smallPlant, stool, table } from '../furniture'
import { IM } from '../interiorMaterial'
import type { InteriorModel } from '../model'
import type { Finish, InteriorBrief, L2, LampDef } from '../types'

/**
 * 星図珈琲の中（灯町三丁目 星見横丁8番。設定: vol2 3-5。席はカウンター 6 席・テーブル 2 卓）。
 * 局所の座標 s = 正面に沿って外から見て右へ・t = 奥へ（正面の外形の線が t = 0）。床はデータの ground_z_m（8.13m）。
 *
 * - 壁は古い赤煉瓦（厚み 0.25m）、床は焦げ茶の板張り、天井一面に律の手描きの星図（藍色の地に金の星と星座線）
 * - 入口（格子戸）は正面の中ほど（データの入口の位置。外観の型のとおり）。左右の大きな窓の前にテーブル A・B、
 *   その奥に窓と平行に厚い一枚板のカウンター（C1〜C6。C4 が花音の定位置）、カウンターの中にマスターの仕事場と豆の棚・焙煎機。
 *   いちばん奥は仕切りの向こうの裏（倉庫と流し）。データに部屋の間取りは無い（D-064）ので、ここで決めた（§7）
 */

const F = (color: string, mat: number, aux = 0): Finish => ({ color, mat, aux })

/** 扉の中心（外観の型の seizu と同じ。データの入口の位置を正面の辺へ寄せた所） */
const DOOR_S = 3.547
const COUNTER = { t0: 3.2, t1: 3.84, s0: 0.75, s1: 6.35, h: 1.02 }
const SEATS = [1.1, 2.0, 2.9, 3.8, 4.7, 5.6]

const LAMPS: LampDef[] = [
  ...[1.45, 2.75, 4.05, 5.35].map((s, i): LampDef => ({ id: `counter-${i}`, room: 'shop', at: [s, 3.5, 2.05], color: '#ffe2c6', power: 0.5, range: 4.5, kind: 'bulb', schedule: 'shop' })),
  { id: 'table-a', room: 'shop', at: [1.5, 1.05, 1.68], color: '#ffe2c6', power: 0.42, range: 3.6, kind: 'bulb', schedule: 'shop' },
  { id: 'table-b', room: 'shop', at: [5.55, 1.05, 1.68], color: '#ffe2c6', power: 0.42, range: 3.6, kind: 'bulb', schedule: 'shop' },
  { id: 'entry', room: 'shop', at: [DOOR_S, 0.9, 2.35], color: '#ffe4ca', power: 0.3, range: 3.2, kind: 'bulb', schedule: 'shop' },
  { id: 'back-counter', room: 'shop', at: [3.5, 5.6, 1.55], color: '#ffe6cc', power: 0.55, range: 3.4, kind: 'spot', dir: [0, 0, -1], schedule: 'shop' },
  { id: 'sconce-l', room: 'shop', at: [0.42, 4.6, 1.95], color: '#ffe2c6', power: 0.22, range: 3, kind: 'bulb', schedule: 'shop' },
  { id: 'sconce-r', room: 'shop', at: [6.6, 4.6, 1.95], color: '#ffe2c6', power: 0.22, range: 3, kind: 'bulb', schedule: 'shop' },
  { id: 'candle', room: 'shop', at: [6.12, 3.45, 1.16], color: '#ffb070', power: 0.05, range: 1.3, kind: 'fire', schedule: 'shop' },
  { id: 'back', room: 'back', at: [3.5, 7.0, 2.55], color: '#fff2dc', power: 0.6, range: 4, kind: 'ceiling', schedule: 'shop' },
]
const L = (id: string) => LAMPS.findIndex((l) => l.id === id)

export const SEIZU_BRIEF: InteriorBrief = {
  zone: 'seizu',
  wallT: 0.12,
  inset: 0.25,
  rooms: [
    {
      id: 'shop',
      name: '店',
      level: 0,
      poly: [
        [0.25, 0.25],
        [6.78, 0.25],
        [6.78, 6.15],
        [0.25, 6.15],
      ],
      floorFinish: F('#4a382c', IM.woodFloor, 0.12),
      wallFinish: F('#8a5a4c', NM.brick, 0.55),
      ceilingFinish: F('#16204a', IM.starmap),
      baseboard: '#3a2618',
    },
    { id: 'back', name: '裏（倉庫と流し）', level: 0, poly: [[0.25, 6.15], [6.78, 6.15], [6.78, 7.78], [0.25, 7.78]], ceiling: 3.0, floorFinish: F('#8a847a', NM.tileClad, 0.2), wallFinish: F('#e8e0d0', NM.plaster), ceilingFinish: F('#f0ece4', IM.paintWall) },
  ],
  doors: [
    // 入口の格子戸（外観の開く扉）
    { id: 'front', level: 0, at: [DOOR_S, 0.125], axis: 's', width: 0.95, height: 2.25, kind: 'named', entrance: 0, thickness: 0.25, floor: 0 },
    // カウンターの奥から裏へ（マスターの扉）
    { id: 'back', level: 0, at: [6.05, 6.15], axis: 's', width: 0.78, height: 2.0, kind: 'swing', hinge: 1, side: 1, color: '#4a3020', style: 'panel', thickness: 0.12, frame: '#3a2618', floor: 0 },
  ],
  stairs: [
    // 星見石段（外観の型が作る 16 段。路地から入口の前の踊り場へ）
    { id: 'hoshimi', from: 0, to: 0, start: [DOOR_S, -(STAIRS.landing + STAIRS.steps * STAIRS.run)], dir: [0, 1], width: STAIRS.width - 0.2, risers: STAIRS.steps, run: STAIRS.run, y0: -STAIRS.steps * STAIRS.rise, y1: 0, build: false },
  ],
  outdoor: [
    // 入口の前の踊り場と、石段の下の路地
    { id: 'landing', poly: [[DOOR_S - 1.35, -STAIRS.landing - 0.05], [DOOR_S + 1.35, -STAIRS.landing - 0.05], [DOOR_S + 1.35, -0.02], [DOOR_S - 1.35, -0.02]], h: 0 },
    { id: 'alley', poly: [[0.8, -11.2], [6.4, -11.2], [6.4, -6.4], [0.8, -6.4]], h: 'terrain' },
  ],
  lamps: LAMPS,
  navPoints: [
    { at: [DOOR_S, 1.6], level: 0 },
    { at: [DOOR_S, 2.45], level: 0 },
    { at: [1.8, 2.4], level: 0 },
    { at: [5.4, 2.4], level: 0 },
    { at: [DOOR_S, -0.75], level: 0 },
  ],
  furnish,
}

function furnish(ib: InteriorBuilder, m: InteriorModel) {
  void m
  ib.room('shop')
  counter(ib)
  backBar(ib)
  tables(ib)
  walls(ib)
  back(ib)
}

/** カウンター（厚い一枚板）と 6 つの丸椅子・C4 のカフェラテとカヌレ・花瓶とキャンドル・「どうぞ撮ってください」の札 */
function counter(ib: InteriorBuilder) {
  const c: L2 = [(COUNTER.s0 + COUNTER.s1) / 2, (COUNTER.t0 + COUNTER.t1) / 2]
  const w = COUNTER.s1 - COUNTER.s0
  // 腰（客の側は縦の板、上に厚い一枚板）
  ib.box([c[0], COUNTER.t0 + 0.27], 0, [w, 0.5, COUNTER.h - 0.07], '#4e3a2c', NM.boardV, 0.12)
  ib.box([c[0], COUNTER.t0 + 0.04], 0, [w, 0.04, 0.08], '#2a1a10', NM.wood, 0, 0, 0.7)
  ib.box([c[0], c[1] - 0.06], COUNTER.h - 0.07, [w + 0.1, COUNTER.t1 - COUNTER.t0 + 0.22, 0.07], '#5a4636', NM.wood, 0)
  // 足をのせる真鍮の棒
  ib.beam([COUNTER.s0, COUNTER.t0 - 0.08, 0.22], [COUNTER.s1, COUNTER.t0 - 0.08, 0.22], 0.035, '#b8913a', NM.gold, 0, 0.035)
  ib.block('カウンター', c, w + 0.1, COUNTER.t1 - COUNTER.t0 + 0.22, 0, COUNTER.h)
  // 丸椅子（C1〜C6。C4 は花音の席なので通り道の障害物にしない）
  SEATS.forEach((s, i) => stool(ib, [s, COUNTER.t0 - 0.38], 0.72, '#6a3e22', '#2a2622', 0.28, i !== 3))
  // C4 のカフェラテ（受け皿・カップ・ラテアートの白）とカヌレ
  const top = COUNTER.h
  ib.cyl([3.8, 3.12], top, 0.075, 0.012, '#f4f0e8', IM.ceramic, 0, 18)
  ib.cyl([3.8, 3.12], top + 0.012, 0.048, 0.075, '#f4f0e8', IM.ceramic, 0, 16, 0.055)
  ib.cyl([3.8, 3.12], top + 0.082, 0.05, 0.003, '#c8925a', IM.ceramic, 0.3, 16)
  ib.cyl([3.8, 3.12], top + 0.0855, 0.022, 0.002, '#f4ecd8', IM.ceramic, 0.3, 10)
  ib.cyl([3.6, 3.14], top, 0.06, 0.008, '#f4f0e8', IM.ceramic, 0, 14)
  ib.cyl([3.6, 3.14], top + 0.008, 0.028, 0.05, '#4a2410', NM.wood, 0, 10, 0.022)
  // 札とショップカード
  ib.box([4.25, 3.2], top, [0.12, 0.05, 0.012], '#3a2618', NM.wood, 0)
  ib.picture('photo-ok', [4.25, 3.17], top + 0.07, 0.14, 0.07, -Math.PI / 2, 0, 0.004, 0.25)
  ib.picture('seizu-card', [2.4, 3.2], top + 0.002, 0.09, 0.055, Math.PI / 2 + 0.3, 0, 0, Math.PI / 2)
  // 花瓶とキャンドル（カウンターの端）
  ib.cyl([6.0, 3.5], top, 0.04, 0.16, '#3a5a6a', IM.ceramic, 0, 12, 0.025)
  ib.box([6.0, 3.5], top + 0.15, [0.12, 0.12, 0.12], '#e8c860', NM.leaf, 0, 0.4)
  ib.cyl([6.12, 3.45], top, 0.035, 0.12, '#f2ead8', IM.plastic, 0.2, 12)
  ib.glowBulb([6.12, 3.45], top + 0.15, 0.012, '#ffb060', L('candle'), 9)
  // 吊り下げの裸電球（エジソン電球）
  ;[1.45, 2.75, 4.05, 5.35].forEach((s, i) => pendant(ib, [s, 3.5], 2.0, 3.25, L(`counter-${i}`), '#2b2b2b', 'bulb'))
}

/** カウンターの中（マスターの側）: 仕事の台・エスプレッソの機械・ミル・ドリップの道具・焙煎機・豆のガラス瓶の棚 */
function backBar(ib: InteriorBuilder) {
  // 奥の仕事の台（仕切りの壁沿い）
  ib.box([3.3, 5.78], 0, [5.2, 0.6, 0.88], '#4a3020', NM.boardV, 0.15)
  ib.box([3.3, 5.76], 0.88, [5.3, 0.64, 0.05], '#6e4428', NM.wood, 0)
  ib.block('奥の台', [3.3, 5.78], 5.3, 0.64, 0, 0.93)
  // カウンターの中の低い台（カウンターの裏）
  ib.box([3.55, 4.08], 0, [5.4, 0.42, 0.9], '#3a2618', NM.wood, 0, 0, 0.7)
  ib.block('カウンターの裏の台', [3.55, 4.08], 5.4, 0.42, 0, 0.9)
  // エスプレッソの機械（銀と銅）・ミル・ドリップのポット
  ib.box([2.2, 5.72], 0.93, [0.7, 0.5, 0.42], '#c8ccd0', NM.steel, 0)
  ib.box([2.2, 5.72], 1.35, [0.72, 0.52, 0.06], '#b06a3a', NM.copper, 0.2)
  for (const ds of [-0.18, 0.18]) ib.box([2.2 + ds, 5.45], 1.05, [0.06, 0.12, 0.06], '#2a2a2a', NM.iron, 0.4)
  ib.cyl([3.1, 5.75], 0.93, 0.09, 0.28, '#2a2a2a', NM.iron, 0.4, 14)
  ib.cyl([3.1, 5.75], 1.21, 0.1, 0.12, '#cfd8d8', IM.plastic, 0.8, 14, 0.06)
  for (const s of [3.6, 3.85, 4.1]) {
    ib.cyl([s, 5.7], 0.93, 0.07, 0.15, '#c8ccd0', NM.steel, 0, 14, 0.055)
    ib.tube([s + 0.06, 5.7, 1.02], [s + 0.16, 5.62, 1.12], 0.008, '#c8ccd0', NM.steel)
  }
  // 焙煎機（奥の東の角）
  ib.solidBox('焙煎機の台', [6.2, 5.0], 0, [0.7, 0.8, 0.9], '#2a2a2a', NM.iron, 0.3)
  ib.cyl([6.2, 5.0], 0.9, 0.3, 0.36, '#3a3a3a', NM.iron, 0.4, 18)
  ib.cyl([6.2, 5.0], 1.26, 0.2, 0.3, '#b06a3a', NM.copper, 0.15, 16, 0.08)
  ib.tube([6.2, 5.0, 1.56], [6.2, 5.0, 3.2], 0.06, '#2a2a2a', NM.iron, 0.3)
  // 豆のガラス瓶の棚（仕切りの壁）
  for (let r = 0; r < 3; r++) {
    const h = 1.35 + r * 0.42
    ib.box([3.0, 6.0], h, [4.6, 0.26, 0.03], '#6e4428', NM.wood, 0)
    for (let i = 0; i < 14; i++) {
      const s = 0.95 + i * 0.32
      ib.cyl([s, 5.98], h + 0.03, 0.065, 0.2, ['#3a2210', '#4a2c14', '#2a180c', '#5a3418'][(i + r) % 4], IM.plastic, 0.85, 12)
      ib.cyl([s, 5.98], h + 0.23, 0.07, 0.03, '#b8913a', NM.gold, 0, 12)
    }
  }
  ib.picture('bean-label', [3.0, 5.86], 1.3, 0.5, 0.25, -Math.PI / 2, 0, 0.002)
  // 棚の下の灯り
  ib.glowBox([3.0, 5.9], 1.33, [4.4, 0.02, 0.01], '#ffd8a8', L('back-counter'), 2)
  // カップの並ぶ棚
  for (let i = 0; i < 8; i++) ib.cyl([4.6 + (i % 4) * 0.13, 5.7 + Math.floor(i / 4) * 0.12], 0.93, 0.045, 0.07, '#f4f0e8', IM.ceramic, 0, 12, 0.05)
}

/** 窓際のテーブル A・B（2 人掛け）と吊り下げの電球・窓辺の植物 */
function tables(ib: InteriorBuilder) {
  for (const [s, key] of [
    [1.5, 'table-a'],
    [5.55, 'table-b'],
  ] as [number, string][]) {
    table(ib, 'テーブル', [s, 1.05], 0.66, 0.66, 0.72, 0, '#6a4428')
    chair(ib, [s - 0.55, 1.05], 0, '#4a2c18', 0.46, '#7a3a2a')
    chair(ib, [s + 0.55, 1.05], Math.PI, '#4a2c18', 0.46, '#7a3a2a')
    pendant(ib, [s, 1.05], 1.7, 3.25, L(key), '#2b2b2b', 'bulb')
    ib.cyl([s - 0.12, 1.0], 0.72, 0.035, 0.07, '#f4f0e8', IM.ceramic, 0, 12, 0.04)
    smallPlant(ib, [s + 0.15, 1.15], 0.72, 0.12)
  }
  plant(ib, [0.55, 0.55], 0, 0.42, '#6a4a3a', '#3c6a32', 1.6)
  plant(ib, [6.5, 0.55], 0, 0.4, '#6a4a3a', '#456e38', 1.4)
  // 入口の内の電球
  pendant(ib, [DOOR_S, 0.9], 2.3, 3.25, L('entry'), '#2b2b2b', 'bulb')
}

/** 壁の額（星図・天体写真）・メニューの黒板・壁の灯り */
function walls(ib: InteriorBuilder) {
  // 左の壁（s = 0.25）: メニュー・星図・天体写真
  frame(ib, 'menu', [0.27, 4.4], 1.55, 0.6, 0.8, 0, '#3a2618')
  frame(ib, 'starchart-winter', [0.27, 2.7], 1.7, 0.7, 0.53, 0, '#2a1a10')
  frame(ib, 'moon', [0.27, 1.6], 1.65, 0.36, 0.36, 0, '#1a1a1a')
  // 右の壁（s = 6.78）: 星座早見・星雲・銀河・天の川
  frame(ib, 'starchart-round', [6.76, 2.6], 1.7, 0.56, 0.56, Math.PI, '#5a4020')
  frame(ib, 'nebula', [6.76, 1.5], 1.62, 0.42, 0.33, Math.PI, '#1a1a1a')
  frame(ib, 'galaxy', [6.76, 3.55], 1.62, 0.42, 0.33, Math.PI, '#1a1a1a')
  frame(ib, 'milkyway', [3.3, 6.075], 2.35, 0.9, 0.45, -Math.PI / 2, '#2a1a10')
  // 壁の灯り（真鍮の腕と裸電球）
  for (const [s, f, key] of [
    [0.28, 0, 'sconce-l'],
    [6.75, Math.PI, 'sconce-r'],
  ] as [number, number, string][]) {
    const c: L2 = [s, 4.6]
    ib.box(c, 1.85, [0.04, 0.12, 0.12], '#b8913a', NM.gold, 0)
    const arm = at(c, f, 0.14, 0)
    ib.beam([c[0], c[1], 1.9], [arm[0], arm[1], 1.98], 0.015, '#b8913a', NM.gold)
    ib.glowBulb(arm, 1.92, 0.035, '#ffcf8a', L(key), 7)
  }
}

/** 裏（倉庫と流し）: 豆の袋・棚・流し */
function back(ib: InteriorBuilder) {
  ib.room('back')
  bookshelf(ib, '倉庫の棚', [1.4, 7.55], 2.0, 0.42, 2.0, Math.PI, '#8a7a62', 4, 0.0, 1, '#7a6a52')
  for (let i = 0; i < 6; i++) box(ib, [0.75 + (i % 3) * 0.6, 7.55], 0.1 + Math.floor(i / 3) * 0.5, [0.5, 0.36, 0.4], 0, '#b8a07a')
  for (let i = 0; i < 4; i++) ib.box([3.4 + i * 0.5, 7.45], 0, [0.42, 0.52, 0.55 - (i % 2) * 0.1], '#c8b48a', IM.fabric, 0, 0.1 * i)
  cabinet(ib, '流し', [5.6, 7.45], 1.2, 0.6, 0.88, Math.PI, '#d8d4cc', 1, NM.paint, '#8a8a8a', 2)
  ib.box([5.6, 7.45], 0.88, [1.24, 0.64, 0.04], '#c8ccd0', NM.steel, 0)
  pendant(ib, [3.5, 7.0], 2.6, 3.0, L('back'), '#e8e4dc', 'dome')
}
