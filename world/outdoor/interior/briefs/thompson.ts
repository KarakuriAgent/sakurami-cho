import { NM } from '../../named/namedMaterial'
import type { InteriorBuilder } from '../builder'
import { at, bed, bookshelf, bookStack, box, cabinet, ceilingLight, chair, curtains, cushion, deskLamp, floorLamp, frame, keyboard, monitor, mug, pegboard, pendant, plant, rug, smallPlant, sofa, stool, table } from '../furniture'
import { IM } from '../interiorMaterial'
import type { InteriorModel } from '../model'
import type { Finish, InteriorBrief, L2, LampDef } from '../types'

/**
 * トンプソン家の中（楓坂三丁目12番7号。設定: vol2 3-4・vol5 5-3-2・vol4 4-11）。局所の座標 u = 東・v = 北（母屋の南西の角が原点）、
 * 高さは建物の床（データの ground_z_m = 47.75m = 玄関の土間）から。1 階の床は 0.15m 上（上がり框）、2 階 2.9m、屋根裏 5.75m。
 *
 * 部屋はデータの rooms の多角形のまま。ただし（docs/design/town.md の §7）:
 * - 階段は 1 階のリビングの北の壁に沿った直階段（玄関の南の「階段」の所から東へ上り、2 階のホールに着く）。その上は吹き抜け
 *   （データの 2 階の花音の部屋の北の端・美咲の書斎の南の端は、吹き抜けの分だけ狭い）
 * - 2 階のホールと「階段・廊下」とその間のすき間はひと続きの廊下。両親の寝室は西の壁を u 5.65・北の壁を v 4.3 に
 * - 屋根裏へは 2 階の廊下の天井の折りたたみ梯子（歩いては上がらない）
 * - 勝手口はキッチンの北の壁（u 7.95〜8.75）からガレージへ（データの位置 u 6.8 は洗面の北の壁）
 */

const F = (color: string, mat: number, aux = 0): Finish => ({ color, mat, aux })

const FLOOR_WOOD = F('#9c805f', IM.woodFloor, 0.14)
const FLOOR_WOOD_2F = F('#a88c6a', IM.woodFloor, 0.13)
const WALL = F('#efe9df', IM.paintWall)
const CEIL = F('#f7f4ee', IM.paintWall)
const BASE = '#ebe5d9'

/** 灯り（番号 = 並び順。家具の光る物が同じ番号を使う） */
const LAMPS: LampDef[] = [
  { id: 'living-ceiling', room: 'living', at: [3.0, 2.0, 2.4], color: '#ffe6cc', power: 1.6, range: 7, kind: 'ceiling', schedule: 'evening' },
  { id: 'dining-1', room: 'living', at: [5.55, 2.65, 1.72], color: '#ffdcb4', power: 0.75, range: 4.5, kind: 'pendant', schedule: 'evening' },
  { id: 'dining-2', room: 'living', at: [6.15, 2.65, 1.72], color: '#ffdcb4', power: 0.75, range: 4.5, kind: 'pendant', schedule: 'evening' },
  { id: 'dining-3', room: 'living', at: [6.75, 2.65, 1.72], color: '#ffdcb4', power: 0.75, range: 4.5, kind: 'pendant', schedule: 'evening' },
  { id: 'floor-lamp', room: 'living', at: [0.55, 2.66, 1.35], color: '#ffd8ac', power: 0.7, range: 4.5, kind: 'floor', schedule: 'evening' },
  { id: 'stove', room: 'living', at: [3.0, 0.9, 0.35], color: '#ff8a3a', power: 0.45, range: 4.0, kind: 'fire', schedule: 'fire' },
  { id: 'kitchen', room: 'kitchen', at: [8.45, 5.0, 2.4], color: '#fff4e6', power: 1.1, range: 5, kind: 'ceiling', schedule: 'evening' },
  { id: 'genkan', room: 'genkan', at: [1.2, 6.2, 2.4], color: '#ffe6cc', power: 0.6, range: 4, kind: 'ceiling', schedule: 'evening' },
  { id: 'stair', room: 'shaft', at: [3.2, 4.42, 4.85], color: '#ffe6cc', power: 0.9, range: 6.5, kind: 'pendant', schedule: 'evening' },
  { id: 'study-desk', room: 'study', at: [4.2, 6.15, 1.45], color: '#ffeedc', power: 0.45, range: 3.2, kind: 'spot', dir: [0.3, 0, -1], schedule: 'late' },
  { id: 'study-screens', room: 'study', at: [4.55, 6.15, 1.05], color: '#a8c8ff', power: 0.35, range: 3.2, kind: 'screen', dir: [-1, 0, 0], schedule: 'late' },
  { id: 'study-indirect', room: 'study', at: [4.8, 6.15, 0.85], color: '#5f8fff', power: 0.22, range: 2.5, kind: 'bulb', schedule: 'late' },
  { id: 'bath', room: 'bath', at: [6.2, 6.1, 2.35], color: '#f6f2ff', power: 0.9, range: 4, kind: 'ceiling', schedule: 'presence' },
  { id: 'garage', room: 'garage', at: [6.8, 9.5, 2.75], color: '#eef4ff', power: 3.2, range: 9, kind: 'ceiling', schedule: 'presence' },
  { id: 'garage-bench', room: 'garage', at: [5.6, 8.1, 1.95], color: '#fff2dc', power: 1.0, range: 3.5, kind: 'spot', dir: [0, -0.2, -1], schedule: 'presence' },
  { id: 'kanon-ceiling', room: 'kanon', at: [2.3, 1.7, 2.45], color: '#fff4e8', power: 1.0, range: 6, kind: 'ceiling', schedule: 'presence' },
  { id: 'kanon-desk', room: 'kanon', at: [1.0, 3.5, 1.18], color: '#ffecd2', power: 0.6, range: 3, kind: 'spot', dir: [0.25, 0.2, -1], schedule: 'presence' },
  { id: 'kanon-led', room: 'kanon', at: [1.3, 3.3, 1.12], color: '#5ff0ff', power: 0.2, range: 2.6, kind: 'bulb', schedule: 'presence' },
  { id: 'kanon-screen', room: 'kanon', at: [1.45, 3.7, 1.0], color: '#9ad0ff', power: 0.22, range: 2.6, kind: 'screen', dir: [0, -1, 0], schedule: 'presence' },
  { id: 'hall2', room: 'hall2', at: [5.0, 5.4, 2.45], color: '#ffeedc', power: 0.7, range: 5, kind: 'ceiling', schedule: 'evening' },
  { id: 'misaki-desk', room: 'misaki', at: [2.5, 6.95, 1.2], color: '#ffe4c2', power: 0.55, range: 3.5, kind: 'spot', dir: [-0.2, 0, -1], schedule: 'late' },
  { id: 'misaki-ceiling', room: 'misaki', at: [2.0, 6.1, 2.45], color: '#ffeedc', power: 0.6, range: 4.5, kind: 'ceiling', schedule: 'late' },
  { id: 'bed-left', room: 'bedroom', at: [6.45, 3.95, 0.85], color: '#ffdcb4', power: 0.3, range: 3, kind: 'bulb', schedule: 'evening' },
  { id: 'bed-right', room: 'bedroom', at: [8.65, 3.95, 0.85], color: '#ffdcb4', power: 0.3, range: 3, kind: 'bulb', schedule: 'evening' },
  { id: 'toilet2', room: 'toilet2', at: [8.4, 5.8, 2.4], color: '#fff6ea', power: 0.5, range: 3, kind: 'ceiling', schedule: 'presence' },
  { id: 'hall2-s', room: 'hall2', at: [5.08, 1.8, 2.45], color: '#ffe8cc', power: 0.55, range: 4.5, kind: 'ceiling', schedule: 'evening' },
  { id: 'attic', room: 'attic', at: [4.8, 3.75, 2.0], color: '#ffd8a0', power: 1.9, range: 9, kind: 'bulb', schedule: 'presence' },
  { id: 'kb-dock', room: 'kitchen', at: [7.85, 3.15, 0.08], color: '#5ff0ff', power: 0.06, range: 1.2, kind: 'bulb', schedule: 'always' },
]
const L = (id: string) => LAMPS.findIndex((l) => l.id === id)

export const THOMPSON_BRIEF: InteriorBrief = {
  zone: 'thompson',
  wallT: 0.1,
  inset: 0.15,
  rooms: [
    // --- 1 階 ---
    {
      id: 'living',
      name: 'リビング・ダイニング',
      level: 0,
      poly: [
        [0.15, 0.15],
        [9.45, 0.15],
        [9.45, 3.5],
        [7.6, 3.5],
        [7.6, 4.9],
        [4.88, 4.9],
        [4.88, 3.95],
        [0.15, 3.95],
      ],
      group: 'ldk',
      open: ['kitchen', 'shaft'],
      floorFinish: FLOOR_WOOD,
      wallFinish: WALL,
      ceilingFinish: CEIL,
      baseboard: BASE,
    },
    { id: 'kitchen', name: 'キッチン（対面式）', level: 0, poly: [[7.6, 3.5], [9.45, 3.5], [9.45, 7.35], [7.6, 7.35]], group: 'ldk', open: ['living'], floorFinish: FLOOR_WOOD, wallFinish: WALL, ceilingFinish: CEIL, baseboard: BASE },
    // 階段の吹き抜け（1 階の床から 2 階の天井まで）。リビングと 2 階の廊下にひと続き
    { id: 'shaft', name: '階段', level: 0, poly: [[0.15, 3.95], [4.88, 3.95], [4.88, 4.9], [0.15, 4.9]], ceiling: 5.45, group: 'ldk', open: ['living', 'hall2'], floorFinish: FLOOR_WOOD, wallFinish: WALL, ceilingFinish: CEIL, baseboard: BASE },
    {
      id: 'genkan',
      name: '玄関',
      level: 0,
      poly: [
        [0.15, 4.9],
        [2.1, 4.9],
        [2.1, 7.35],
        [1.25, 7.35],
        [1.25, 5.45],
        [0.15, 5.45],
      ],
      group: 'genkan',
      open: ['doma'],
      floorFinish: FLOOR_WOOD,
      wallFinish: WALL,
      ceilingFinish: CEIL,
      baseboard: BASE,
    },
    // 土間（玄関の扉の内。建物の床の高さ）
    { id: 'doma', name: '玄関（土間）', level: 0, poly: [[0.15, 5.45], [1.25, 5.45], [1.25, 7.35], [0.15, 7.35]], floor: 0, group: 'genkan', open: ['genkan'], floorFinish: F('#8c867c', NM.tileClad, 0.3), wallFinish: WALL, ceilingFinish: CEIL },
    { id: 'study', name: 'マイケルの書斎', level: 0, poly: [[2.1, 4.9], [4.9, 4.9], [4.9, 7.35], [2.1, 7.35]], floorFinish: F('#8a6444', IM.woodFloor, 0.12), wallFinish: F('#d4d9d0', IM.paintWall), ceilingFinish: CEIL, baseboard: '#d8d4c8' },
    { id: 'bath', name: '洗面・浴室・トイレ', level: 0, poly: [[4.9, 4.9], [7.6, 4.9], [7.6, 7.35], [4.9, 7.35]], floorFinish: F('#cbc6bb', NM.tileClad, 0.15), wallFinish: F('#f0efea', IM.paintWall), ceilingFinish: CEIL, wainscot: { h: 1.25, finish: F('#e6ebea', NM.tileClad, 0.1) } },
    // ガレージ（家庭工房）。床は建物の床の高さ、屋根の下の勾配の天井
    {
      id: 'garage',
      name: 'ガレージ（家庭工房）',
      level: 0,
      dataName: 'ガレージ（家庭工房）',
      floor: 0,
      sloped: { axis: 's', at: 9.5, ridge: 4.0, slope: 0.6 },
      floorFinish: F('#9c9890', NM.concrete),
      wallFinish: F('#d2b892', NM.boardV, 0.6),
      ceilingFinish: F('#b89c74', NM.boardV, 0.2),
    },
    // --- 2 階 ---
    { id: 'kanon', name: '花音の部屋', level: 1, poly: [[0.15, 0.15], [4.5, 0.15], [4.5, 3.95], [0.15, 3.95]], floorFinish: FLOOR_WOOD_2F, wallFinish: F('#dde2e5', IM.paintWall), ceilingFinish: CEIL, baseboard: '#e2e4e2' },
    {
      id: 'hall2',
      name: 'ホール・階段・廊下',
      level: 1,
      poly: [
        [4.5, 0.15],
        [5.65, 0.15],
        [5.65, 4.3],
        [7.4, 4.3],
        [7.4, 7.35],
        [4.0, 7.35],
        [4.0, 4.9],
        [4.88, 4.9],
        [4.88, 3.95],
        [4.5, 3.95],
      ],
      open: ['shaft'],
      floorFinish: FLOOR_WOOD_2F,
      wallFinish: WALL,
      ceilingFinish: CEIL,
      baseboard: BASE,
    },
    { id: 'misaki', name: '美咲の書斎', level: 1, poly: [[0.15, 4.9], [4.0, 4.9], [4.0, 7.35], [0.15, 7.35]], floorFinish: FLOOR_WOOD_2F, wallFinish: F('#efe6d6', IM.paintWall), ceilingFinish: CEIL, baseboard: BASE },
    { id: 'bedroom', name: '両親の寝室', level: 1, poly: [[5.65, 0.15], [9.45, 0.15], [9.45, 4.3], [5.65, 4.3]], floorFinish: FLOOR_WOOD_2F, wallFinish: F('#e9e4dc', IM.paintWall, 1), ceilingFinish: CEIL, baseboard: BASE },
    { id: 'toilet2', name: 'トイレ', level: 1, poly: [[7.4, 4.3], [9.45, 4.3], [9.45, 7.35], [7.4, 7.35]], floorFinish: F('#d4cfc5', NM.tileClad, 0.15), wallFinish: F('#f2f0ea', IM.paintWall), ceilingFinish: CEIL, wainscot: { h: 1.0, finish: F('#ebeeea', NM.tileClad, 0.1) } },
    // --- 屋根裏（切妻の屋根の下。棟は東西、v 3.75） ---
    {
      id: 'attic',
      name: '屋根裏',
      level: 2,
      poly: [[0.15, 0.15], [9.45, 0.15], [9.45, 7.35], [0.15, 7.35]],
      sloped: { axis: 's', at: 3.75, ridge: 8.35, slope: 0.693 },
      floorFinish: F('#a88a64', NM.wood, 0),
      wallFinish: F('#b4966c', NM.boardV, 0.14),
      ceilingFinish: F('#a88c66', NM.boardV, 0.16),
    },
  ],
  doors: [
    // 玄関（外観の開く扉。西の面）
    { id: 'front', level: 0, at: [0.075, 6.045], axis: 't', width: 0.95, height: 2.15, kind: 'named', entrance: 0, thickness: 0.15, floor: 0 },
    // 玄関 → 階段の下（開口）
    { id: 'genkan-hall', level: 0, at: [0.82, 4.9], axis: 's', width: 0.9, height: 2.1, kind: 'open', floor: 0.15 },
    { id: 'study', level: 0, at: [2.1, 6.75], axis: 't', width: 0.8, height: 2.0, kind: 'swing', hinge: 1, side: -1, color: '#ece8de', style: 'panel', floor: 0.15 },
    { id: 'bath', level: 0, at: [7.6, 5.55], axis: 't', width: 0.75, height: 2.0, kind: 'swing', hinge: -1, side: 1, color: '#ece8de', style: 'glass', floor: 0.15 },
    // 勝手口（キッチン → ガレージ。外壁の厚み 0.3m。ガレージの床は 0.15m 低い）
    { id: 'garage', level: 0, at: [8.35, 7.5], axis: 's', width: 0.8, height: 2.0, kind: 'swing', hinge: 1, side: -1, color: '#5a6a5a', style: 'flush', thickness: 0.3, floor: [0.15, 0], jambs: false },
    // 2 階
    { id: 'kanon', level: 1, at: [4.5, 3.0], axis: 't', width: 0.8, height: 2.0, kind: 'swing', hinge: -1, side: -1, color: '#f2f0ea', style: 'panel', floor: 2.9 },
    { id: 'misaki', level: 1, at: [4.0, 6.2], axis: 't', width: 0.8, height: 2.0, kind: 'swing', hinge: -1, side: 1, color: '#f2f0ea', style: 'panel', floor: 2.9 },
    { id: 'bedroom', level: 1, at: [5.65, 3.25], axis: 't', width: 0.8, height: 2.0, kind: 'swing', hinge: 1, side: -1, color: '#f2f0ea', style: 'panel', floor: 2.9 },
    { id: 'toilet2', level: 1, at: [7.4, 5.3], axis: 't', width: 0.7, height: 2.0, kind: 'swing', hinge: -1, side: -1, color: '#f2f0ea', style: 'flush', floor: 2.9 },
    // バルコニーのガラス戸（外観の開く扉）
    { id: 'balcony', level: 1, at: [1.0, 0.075], axis: 's', width: 1.0, height: 2.05, kind: 'named', entrance: 101, thickness: 0.15, floor: [2.95, 2.9] },
  ],
  stairs: [
    // 1 階のリビングの北の壁に沿って東へ上る直階段（14 段・蹴上げ 0.196m・踏み面 0.26m）
    { id: 'main', from: 0, to: 1, start: [1.5, 4.42], dir: [1, 0], width: 0.88, risers: 14, run: 0.26, y0: 0.15, y1: 2.9, rail: 2, wall: -1, landing: [0.45, 0.32] },
    // ポーチの木の階段（外観の型が作る。設計どおり 4 段・蹴上げ 0.12m。段の下の庭の地面は named/grade.ts が下げる（core/interiors.ts の approaches。§7 の 143））
    { id: 'porch', from: 0, to: 0, start: [-3.6, 8.25], dir: [1, 0], width: 1.15, risers: 4, run: 0.3, y0: -0.48, y1: 0, build: false },
  ],
  outdoor: [
    { id: 'porch', poly: [[-2.28, 3.06], [-0.02, 3.06], [-0.02, 8.94], [-2.28, 8.94]], h: 0 },
    { id: 'yard', poly: [[-6.9, 6.6], [-3.4, 6.6], [-3.4, 9.9], [-6.9, 9.9]], h: 'terrain' },
    { id: 'balcony', poly: [[0.08, -1.42], [2.37, -1.42], [2.37, -0.04], [0.08, -0.04]], h: 2.95, level: 1 },
  ],
  lamps: LAMPS,
  navPoints: [
    { at: [1.25, 2.2], level: 0 },
    { at: [2.2, 1.42], level: 0 },
    { at: [4.5, 1.3], level: 0 },
    { at: [6.5, 0.95], level: 0 },
    { at: [8.55, 1.3], level: 0 },
    { at: [8.55, 2.95], level: 0 },
    { at: [4.45, 3.66], level: 0 },
    { at: [1.3, 3.66], level: 0 },
    { at: [0.75, 4.2], level: 0 },
    { at: [8.2, 3.0], level: 0 },
    { at: [8.3, 6.6], level: 0 },
    { at: [6.0, 8.9], level: 0 },
    { at: [-1.1, 6.05], level: 0 },
    { at: [-1.1, 8.0], level: 0 },
    { at: [5.08, 2.4], level: 1 },
    { at: [5.3, 5.2], level: 1 },
    { at: [5.0, 6.3], level: 1 },
    { at: [3.4, 2.2], level: 1 },
    { at: [1.6, 0.9], level: 1 },
    { at: [1.2, -0.75], level: 1 },
    { at: [5.0, 3.75], level: 2 },
  ],
  furnish,
}

/* -------------------------------------------------------------------------- */
/* 家具                                                                        */
/* -------------------------------------------------------------------------- */

function furnish(ib: InteriorBuilder, m: InteriorModel) {
  void m
  living(ib)
  kitchen(ib)
  genkan(ib)
  study(ib)
  bath(ib)
  garage(ib)
  kanonRoom(ib)
  hall2(ib)
  misaki(ib)
  bedroom(ib)
  toilet2(ib)
  attic(ib)
  porchRoof(ib)
}

/**
 * ポーチの片流れの屋根（外観の型 named/kits/houses.ts の thompson が作る。床の 2.47〜2.95m 上・母屋の西の壁から 2.7m・v 2.6〜9.4）を、
 * カメラだけが避ける障害物に（百段石段を下りて家の前へ着く追う画のカメラが、屋根の中を通って画面が屋根で埋まらないように。§7 の 175）
 */
function porchRoof(ib: InteriorBuilder) {
  ib.room('living')
  ib.block('ポーチの屋根', [-1.35, 6.0], 2.9, 7.0, 2.25, 3.0, 0, false, true)
}

/** リビング・ダイニング（薪ストーブ・ソファ・6 人掛けのテーブル・ブレスト・ボード・本棚・窓のカーテン） */
function living(ib: InteriorBuilder) {
  ib.room('living')
  // 薪ストーブ（南の壁。外の煉瓦の煙突の内側）: 炉台・煉瓦の背・鋳物の本体・ガラスの火・煙突の管
  ib.box([3.0, 0.72], 0, [1.25, 1.12, 0.04], '#4f4a44', NM.tileClad, 0.22, 0, 0.9)
  ib.box([3.0, 0.19], 0, [1.15, 0.06, 1.95], '#87574a', NM.brick, 0.6, 0, 0.9)
  ib.box([3.0, 0.72], 0.04, [0.08, 0.08, 0.12], '#1a1a1c', NM.iron, 0.3)
  ib.box([3.0, 0.68], 0.12, [0.64, 0.5, 0.56], '#26262a', NM.iron, 0.35)
  ib.box([3.0, 0.68], 0.68, [0.7, 0.56, 0.04], '#1c1c1e', NM.iron, 0.4)
  ib.glowBox([3.0, 0.42], 0.24, [0.4, 0.012, 0.26], '#ff8a3a', L('stove'), 4.5)
  ib.box([3.0, 0.425], 0.2, [0.5, 0.01, 0.34], '#2c2c30', NM.iron, 0.4, 0, 0.9, [true, true, true, true, false, true])
  ib.tube([3.0, 0.68, 0.72], [3.0, 0.68, 1.62], 0.075, '#1f1f22', NM.iron, 0.3)
  ib.tube([3.0, 0.68, 1.62], [3.0, 0.2, 1.8], 0.075, '#1f1f22', NM.iron, 0.3)
  ib.block('薪ストーブ', [3.0, 0.68], 0.75, 0.62, 0, 1.0)
  // 炉台（床から 4cm の板）も通り道は避ける（前は本体だけだったので、ストーブとローテーブルの間の炉台の縁を歩き、足が板に沈んでいた。§7 の 142）
  ib.block('薪ストーブの炉台', [3.0, 0.72], 1.25, 1.12, 0, 0.04, 0, true, false)
  // 薪の棚（ストーブの東）
  ib.box([3.95, 0.4], 0, [0.46, 0.34, 0.6], '#5a3e2a', NM.wood, 0)
  for (let i = 0; i < 9; i++) {
    const x = 3.95 + ((i % 3) - 1) * 0.13
    const y = 0.07 + Math.floor(i / 3) * 0.16
    ib.tube([x, 0.25, y + 0.06], [x, 0.56, y + 0.06], 0.06, i % 2 ? '#9a7652' : '#8a6644', NM.wood, 1, 8)
  }
  ib.block('薪の棚', [3.95, 0.4], 0.5, 0.36, 0, 0.6)
  // ソファ（ストーブの方を向く）・クッション・ローテーブル・敷物・フロアスタンド・ひじ掛け椅子
  rug(ib, [2.95, 2.15], 2.9, 2.2, 0, '#b4a084', 2)
  sofa(ib, [2.85, 2.88], 2.1, 0.9, 0, '#5d6b78')
  cushion(ib, at([2.85, 2.88], 0, -0.78, 0.12), 0.42, 0.25, '#d9b26a')
  cushion(ib, at([2.85, 2.88], 0, 0.8, 0.12), 0.42, -0.2, '#b84a3a')
  table(ib, 'ローテーブル', [2.85, 2.02], 1.1, 0.5, 0.42, 0, '#6a4a30')
  bookStack(ib, [2.6, 2.02], 0.42, 0.2, 3)
  mug(ib, [3.2, 1.92], 0.42)
  ib.box([3.0, 2.1], 0.42, [0.24, 0.17, 0.01], '#1a1a1e', IM.screen, 0, 0.3)
  // フロアスタンドは西の本棚の北の端の角（ソファの裏の通り道と、階段を撮る画にかからないように。§7 の 142・148）
  floorLamp(ib, [0.42, 2.66], 1.55, L('floor-lamp'))
  sofa(ib, [0.85, 0.85], 0.88, 0.84, Math.PI / 4 + Math.PI / 2, '#8a6a4a', 1)
  // 西の壁の低い本棚と、その上の写真と植物
  bookshelf(ib, '本棚', [0.32, 1.35], 1.8, 0.32, 0.92, Math.PI / 2, '#7a5236', 3, 0.8, 3)
  frame(ib, 'photo-family', [0.16, 0.95], 1.35, 0.3, 0.22, 0, '#3a2a1e')
  frame(ib, 'photo-bay', [0.16, 1.7], 1.42, 0.36, 0.24, 0)
  smallPlant(ib, [0.32, 2.05], 0.92, 0.2)
  plant(ib, [4.35, 0.5], 0, 0.42, '#c8b8a0', '#3c6a32', 1.6)
  // 6 人掛けの木のテーブルと椅子・吊り下げの灯り 3 つ
  table(ib, 'ダイニングテーブル', [6.3, 2.6], 1.85, 0.95, 0.74, 0, '#8a6c50')
  for (const [x, y, f] of [
    [5.75, 1.87, Math.PI / 2],
    [6.85, 1.87, Math.PI / 2],
    [5.75, 3.33, -Math.PI / 2],
    [6.85, 3.33, -Math.PI / 2],
    [5.1, 2.6, 0],
    [7.5, 2.6, Math.PI],
  ] as [number, number, number][])
    chair(ib, [x, y], f, '#6e5440', 0.46, '#c9b48a')
  ib.cyl([6.3, 2.6], 0.74, 0.16, 0.06, '#d8cdb8', IM.ceramic, 0, 18, 0.12)
  for (const [x, y, c] of [
    [6.25, 2.55, '#d0402a'],
    [6.35, 2.65, '#e8a83a'],
    [6.28, 2.67, '#7aa83a'],
  ] as [number, number, string][])
    ib.cyl([x, y], 0.79, 0.035, 0.06, c, IM.plastic, 0.3, 10)
  mug(ib, [5.7, 2.35], 0.74, '#2f4a6a')
  mug(ib, [6.95, 2.85], 0.74)
  // ドリップのコーヒー（ガラスのポット）
  ib.cyl([5.5, 2.8], 0.74, 0.07, 0.17, '#3a2416', NM.glassDark, 0, 14, 0.06)
  for (const [x, id] of [
    [5.7, 'dining-1'],
    [6.3, 'dining-2'],
    [6.9, 'dining-3'],
  ] as [number, string][])
    pendant(ib, [x, 2.6], 1.72, 2.47, L(id), '#2f3a35', 'dome')
  ceilingLight(ib, [3.0, 2.0], 2.47, L('living-ceiling'), 0.24)
  // ブレスト・ボード（北の壁一面のホワイトボード）と、受け皿のマーカー
  ib.box([6.25, 4.83], 0.82, [2.62, 0.03, 1.36], '#c8ccd0', NM.steel, 0, 0, 0.95)
  ib.picture('brainstorm', [6.25, 4.815], 1.5, 2.54, 1.28, -Math.PI / 2, 0, 0.002)
  ib.box([6.25, 4.78], 0.8, [2.4, 0.08, 0.025], '#b8bcc0', NM.steel, 0)
  for (const [x, c] of [
    [5.4, '#1a1a1a'],
    [5.5, '#c0392b'],
    [5.6, '#1f5f9a'],
  ] as [number, string][])
    ib.box([x, 4.77], 0.826, [0.12, 0.018, 0.018], c, IM.plastic, 0.4)
  // 天井近くを一周するレール（模型の線路の棚。南と東の壁）
  for (const [a, b] of [
    [[0.25, 0.27], [9.35, 0.27]],
    [[9.33, 0.27], [9.33, 3.4]],
  ] as [L2, L2][]) {
    ib.beam([a[0], a[1], 2.22], [b[0], b[1], 2.22], 0.2, '#7a5236', NM.wood, 0, 0.025)
    ib.beam([a[0], a[1], 2.245], [b[0], b[1], 2.245], 0.07, '#4a4a4a', NM.iron, 0.3, 0.012)
  }
  // 小さな機関車と客車（レールの上）
  for (let i = 0; i < 3; i++) ib.box([7.6 - i * 0.24, 0.27], 2.25, [0.21, 0.07, 0.09], i === 0 ? '#2a3a2a' : '#8a2a22', NM.paint, 0.5)
  // 窓のカーテン（生成りの麻）
  curtains(ib, [0.85, 0.22], [2.85, 0.22], 0.35, 2.32, '#ddd3c0', 0.82)
  curtains(ib, [4.95, 0.22], [7.35, 0.22], 0.35, 2.32, '#ddd3c0', 0.82)
  // 階段の下の側（リビングの側）の板壁と小さな扉（物入れ）
  {
    const y0 = 0.0
    const pts: [number, number][] = []
    for (let i = 0; i <= 8; i++) {
      const u = 1.5 + (3.38 * i) / 8
      pts.push([u, 0.15 + (2.75 * (u - 1.5 + 0.13)) / 3.64 - 0.22 - 0.15])
    }
    for (let i = 0; i < 8; i++) {
      const [u0, h0] = pts[i]
      const [u1, h1] = pts[i + 1]
      if (h1 <= y0 + 0.01) continue
      ib.quad([u0, 3.965, y0], [u1, 3.965, y0], [u1, 3.965, Math.max(y0, h1)], [u0, 3.965, Math.max(y0, h0)], '#efe9df', IM.paintWall, 0, 0.92)
    }
    ib.box([3.9, 3.955], 0.02, [0.62, 0.02, 1.45], '#ece6da', NM.paint, 0.35)
    ib.box([4.15, 3.94], 0.8, [0.02, 0.03, 0.1], '#c9b98a', NM.gold)
  }
  plant(ib, [8.95, 0.55], 0, 0.5, '#e0dcd2', '#2f5a2a', 2)
  // 掛け時計（東の壁）
  ib.box([9.43, 1.7], 1.9, [0.04, 0.32, 0.32], '#3a2a1e', NM.wood, 0, 0)
  ib.box([9.41, 1.7], 1.92, [0.01, 0.26, 0.26], '#f2ead8', NM.paint, 0.2)
}

/** キッチン（対面のカウンター・壁際の流しとコンロ・吊り戸棚・冷蔵庫・KB-001 の家用ドック） */
function kitchen(ib: InteriorBuilder) {
  ib.room('kitchen')
  const cab = '#4a5e58'
  const top = '#dcd6ca'
  // 対面のカウンター（ダイニングの側に天板が張り出す）
  ib.box([7.32, 4.2], 0, [0.56, 1.3, 0.88], cab, NM.paint, 0.35)
  ib.box([7.24, 4.2], 0.88, [0.78, 1.38, 0.04], top, NM.granite, 0)
  ib.block('対面のカウンター', [7.28, 4.2], 0.7, 1.38, 0, 0.92)
  smallPlant(ib, [7.15, 4.65], 0.92, 0.16)
  ib.cyl([7.18, 3.8], 0.92, 0.11, 0.07, '#e8e0d0', IM.ceramic, 0, 16, 0.14)
  // 壁際の流しとコンロ（東の壁）
  ib.box([9.15, 4.95], 0.08, [0.6, 2.7, 0.8], cab, NM.paint, 0.35)
  ib.box([9.15, 4.95], 0, [0.56, 2.66, 0.08], '#22262a', NM.paint, 0, 0, 0.6)
  ib.box([9.13, 4.95], 0.88, [0.64, 2.74, 0.04], top, NM.granite, 0)
  ib.block('流し台', [9.15, 4.95], 0.64, 2.74, 0, 0.92)
  for (let i = 0; i < 4; i++) {
    const v = 3.9 + i * 0.68
    ib.box([8.84, v], 0.12, [0.01, 0.64, 0.7], '#56706a', NM.paint, 0.4)
    ib.box([8.83, v], 0.72, [0.01, 0.18, 0.018], '#c9b98a', NM.gold)
  }
  // 流し（窓の下）と蛇口
  ib.box([9.12, 5.4], 0.7, [0.46, 0.6, 0.2], '#b8bcc0', NM.steel, 0, 0, 0.7)
  ib.tube([9.38, 5.4, 0.92], [9.38, 5.4, 1.18], 0.015, '#c8ccd0', NM.steel)
  ib.tube([9.38, 5.4, 1.18], [9.2, 5.4, 1.18], 0.015, '#c8ccd0', NM.steel)
  // コンロ（黒いガラス）と換気扇
  ib.box([9.13, 4.15], 0.92, [0.56, 0.6, 0.012], '#101012', IM.screen, 0)
  ib.box([9.2, 4.15], 1.62, [0.5, 0.7, 0.5], '#d0d2d4', NM.steel, 0)
  // 壁のタイル（流しとコンロの後ろ）と吊り戸棚
  ib.box([9.445, 4.95], 0.92, [0.01, 2.7, 0.62], '#f2f0ea', NM.tileClad, 0.075, 0, 0.95)
  for (const [v, w] of [
    [3.75, 0.5],
    [6.15, 0.5],
  ] as [number, number][]) {
    ib.box([9.27, v], 1.55, [0.36, w, 0.72], cab, NM.paint, 0.35)
    ib.box([9.085, v], 1.6, [0.01, 0.02, 0.1], '#c9b98a', NM.gold)
  }
  // 冷蔵庫（北東の角）
  ib.solidBox('冷蔵庫', [9.12, 6.95], 0, [0.62, 0.66, 1.8], '#d8dadb', NM.steel, 0)
  ib.box([8.8, 6.75], 1.0, [0.02, 0.03, 0.5], '#a8acb0', NM.steel, 0)
  // 電気ケトル・炊飯器・まな板
  ib.cyl([9.1, 6.0], 0.92, 0.08, 0.22, '#e8e8e4', IM.plastic, 0.5, 14)
  ib.box([9.1, 4.75], 0.92, [0.3, 0.26, 0.24], '#f0eee8', IM.plastic, 0.4)
  ib.box([9.05, 5.05], 0.92, [0.3, 0.4, 0.02], '#c8a070', NM.wood, 0)
  ceilingLight(ib, [8.45, 5.0], 2.47, L('kitchen'), 0.22)
  // KB-001 の家用ドック（キッチンの横の床）
  ib.cyl([9.1, 3.2], 0, 0.26, 0.05, '#e8eaec', IM.plastic, 0.5, 24)
  ib.glowCyl([9.1, 3.2], 0.05, 0.22, 0.006, '#5ff0ff', L('kb-dock'), 3)
  ib.cyl([9.1, 3.2], 0.056, 0.18, 0.01, '#1a2026', IM.plastic, 0.6, 24)
  ib.disc('KB-001 のドック', [9.1, 3.2], 0.27, 0, 0.1, false, false)
}

/** 玄関（土間・靴箱と今日の予定の黒板・発電量のパネル・スニーカー・傘立て・上がり框） */
function genkan(ib: InteriorBuilder) {
  ib.room('doma')
  // 靴箱（土間の北の壁）と黒板
  cabinet(ib, '靴箱', [0.7, 7.15], 1.05, 0.38, 1.0, 0, '#e8e2d4', 3, NM.paint, '#8a7a5a', 2)
  ib.box([0.7, 7.15], 1.0, [1.1, 0.4, 0.03], '#8a6444', NM.wood, 0)
  frame(ib, 'today', [0.7, 7.33], 1.62, 0.6, 0.37, -Math.PI / 2, '#7a5a3a')
  // スニーカー（花音の。土間の奥の、靴箱の前に並ぶ。扉から上がり框への通り道（v 5.45〜6.5）にかからないように）
  const cols = ['#f2f2f2', '#e8c840', '#1f5f9a', '#d04030', '#2a2a2a', '#5fd0e0']
  for (let i = 0; i < 4; i++) {
    for (const dx of [-0.06, 0.06]) {
      const c: L2 = [0.45 + i * 0.22 + dx, 6.68 + (i % 2) * 0.06]
      ib.box(c, 0, [0.1, 0.28, 0.03], '#f4f4f0', IM.plastic, 0.2, 0.05)
      ib.box(c, 0.03, [0.09, 0.26, 0.06], cols[(i + (dx > 0 ? 1 : 0)) % cols.length], IM.fabric, 0, 0.05)
    }
  }
  // 傘立てと玄関マット
  ib.cyl([1.1, 7.15], 0, 0.11, 0.48, '#3a4a5a', NM.iron, 0.3, 14)
  ib.disc('傘立て', [1.1, 7.15], 0.12, 0, 0.5, true, false)
  ib.box([0.6, 6.05], 0, [0.65, 0.95, 0.012], '#7a6a52', IM.rug, 1)
  // ドアベル改（扉の横の小さな箱と、光るボタン）
  ib.box([0.16, 6.75], 1.3, [0.02, 0.1, 0.14], '#2a2e34', IM.plastic, 0.4)
  ib.glowBox([0.172, 6.75], 1.36, [0.004, 0.03, 0.03], '#5ff0ff', L('genkan'), 2)
  // 上がり框（木の縁）
  ib.room('genkan')
  ib.box([0.7, 5.45], -0.15, [1.1, 0.06, 0.15], '#8a6444', NM.wood, 0)
  ib.box([1.25, 6.4], -0.15, [0.06, 1.9, 0.15], '#8a6444', NM.wood, 0, 0)
  // 発電量のパネル（南の壁）と、照明
  ib.box([1.78, 4.955], 1.4, [0.3, 0.02, 0.2], '#1a1e22', IM.plastic, 0.5)
  ib.picture('solar', [1.78, 4.97], 1.5, 0.26, 0.16, Math.PI / 2, 1, 0.002)
  ceilingLight(ib, [1.2, 6.2], 2.47, L('genkan'), 0.16)
  plant(ib, [1.9, 5.2], 0, 0.3, '#d8d0c0', '#456e38', 1.3)
}

/** マイケルの書斎（モニタ 3 枚・コード・技術書・ホワイトボード・ドリップの道具・床はケーブルの海・父のレンチセットの額・間接照明） */
function study(ib: InteriorBuilder) {
  ib.room('study')
  table(ib, '書斎の机', [4.48, 6.15], 1.8, 0.72, 0.74, Math.PI / 2, '#5a4030', 0.04, '#2a2a2a')
  monitor(ib, [4.66, 5.52], 0.74, Math.PI + 0.25, 0.56, 'code')
  monitor(ib, [4.7, 6.15], 0.74, Math.PI, 0.6, 'terminal')
  monitor(ib, [4.66, 6.78], 0.74, Math.PI - 0.25, 0.56, 'code2')
  keyboard(ib, [4.3, 6.15], 0.74, Math.PI / 2)
  mug(ib, [4.3, 6.65], 0.74, '#1a1a1a')
  deskLamp(ib, [4.6, 7.05], 0.74, Math.PI + 0.4, L('study-desk'))
  // 間接照明（机の奥の青い光の帯）
  ib.glowBox([4.83, 6.15], 0.76, [0.02, 1.7, 0.012], '#5f8fff', L('study-indirect'), 3)
  // 椅子・机の下のサーバ
  chair(ib, [3.85, 6.15], 0, '#2a2a2c', 0.48, '#3a3a3e')
  ib.box([4.55, 5.45], 0, [0.22, 0.45, 0.45], '#1e1e20', IM.plastic, 0.3)
  ib.glowBox([4.43, 5.45], 0.35, [0.005, 0.01, 0.04], '#5ff0a0', L('study-indirect'), 6)
  // 床はケーブルの海
  for (let i = 0; i < 14; i++) {
    let p: L2 = [4.4 + (ib.rnd() - 0.5) * 0.5, 5.6 + ib.rnd() * 1.2]
    const col = ['#1a1a1a', '#2a2a2a', '#3a3a3a', '#1f3a5a', '#d0d0d0'][i % 5]
    for (let k = 0; k < 5; k++) {
      const q: L2 = [p[0] - 0.15 - ib.rnd() * 0.35, p[1] + (ib.rnd() - 0.5) * 0.5]
      if (q[0] < 2.3) break
      ib.tube([p[0], p[1], 0.008], [q[0], q[1], 0.008], 0.006, col, IM.plastic, 0.3, 6)
      p = q
    }
  }
  // 技術書の本棚（南の壁）・ホワイトボード（北の壁）・父のレンチセットの額（西の壁）
  bookshelf(ib, '技術書の本棚', [3.25, 5.13], 1.7, 0.32, 2.1, Math.PI, '#4a3a2c', 6, 0.92, 7)
  ib.box([4.05, 7.33], 1.1, [1.16, 0.02, 0.8], '#c8ccd0', NM.steel, 0)
  ib.picture('arch-board', [4.05, 7.318], 1.5, 1.1, 0.74, -Math.PI / 2, 0, 0.002)
  frame(ib, 'wrenches', [2.16, 5.6], 1.55, 0.76, 0.47, 0, '#2a2420')
  // ドリップの道具（窓際の小さな台）
  table(ib, 'コーヒーの台', [3.62, 7.08], 0.6, 0.4, 0.8, 0, '#6a4a30')
  ib.cyl([3.49, 7.08], 0.8, 0.06, 0.14, '#c8ccd0', NM.steel, 0, 12, 0.05)
  ib.cyl([3.72, 7.08], 0.8, 0.055, 0.12, '#f2eee6', IM.ceramic, 0, 12, 0.07)
  ib.cyl([3.72, 7.08], 0.92, 0.06, 0.05, '#f2eee6', IM.ceramic, 0, 12, 0.08)
  ib.box([3.85, 6.98], 0.8, [0.1, 0.1, 0.2], '#3a2a1e', NM.wood, 0)
  plant(ib, [2.4, 5.45], 0, 0.36, '#3a3a3a', '#3c6a32', 1.3)
}

/** 洗面・浴室・トイレ（洗面台と鏡・洗濯機・浴槽とガラスの仕切り・便器） */
function bath(ib: InteriorBuilder) {
  ib.room('bath')
  // 洗濯機（南西の角）と洗面台・鏡（南の壁）
  ib.solidBox('洗濯機', [5.28, 5.27], 0, [0.6, 0.62, 0.9], '#f2f2f0', IM.plastic, 0.5)
  ib.cyl([5.28, 5.58], 0.4, 0.2, 0.01, '#3a4a5a', IM.screen, 0)
  ib.box([6.2, 5.18], 0, [0.95, 0.46, 0.8], '#e8e4dc', NM.paint, 0.4)
  ib.box([6.2, 5.17], 0.8, [1.0, 0.5, 0.05], '#f4f2ee', IM.ceramic, 0)
  ib.box([6.2, 5.2], 0.76, [0.45, 0.36, 0.06], '#d8dadc', IM.ceramic, 0, 0, 0.7)
  ib.box([6.2, 4.97], 1.15, [0.7, 0.02, 0.85], '#b8c4cc', IM.plastic, 0.95)
  ib.block('洗面台', [6.2, 5.18], 1.0, 0.5, 0, 0.9)
  // 浴槽とガラスの仕切り（北西）
  ib.box([5.66, 6.92], 0, [1.42, 0.78, 0.58], '#f6f6f4', IM.ceramic, 0)
  ib.box([5.66, 6.92], 0.5, [1.26, 0.62, 0.09], '#cfe4ea', IM.plastic, 0.9, 0, 0.8)
  ib.block('浴槽', [5.66, 6.92], 1.42, 0.78, 0, 0.6)
  ib.glass([6.42, 6.45, 0.05], [6.42, 7.3, 0.05], [6.42, 7.3, 2.0], [6.42, 6.45, 2.0])
  ib.glass([4.95, 6.45, 0.05], [6.42, 6.45, 0.05], [6.42, 6.45, 2.0], [4.95, 6.45, 2.0])
  ib.beam([4.95, 6.45, 2.0], [6.42, 6.45, 2.0], 0.025, '#c8ccd0', NM.steel)
  ib.beam([6.42, 6.45, 2.0], [6.42, 7.3, 2.0], 0.025, '#c8ccd0', NM.steel)
  ib.block('浴室の仕切り', [5.68, 6.88], 1.5, 0.9, 0, 2.0, 0, true, false)
  // 便器（北東）
  ib.box([7.25, 6.95], 0, [0.4, 0.5, 0.4], '#f6f6f4', IM.ceramic, 0)
  ib.box([7.42, 6.95], 0.4, [0.18, 0.42, 0.42], '#f6f6f4', IM.ceramic, 0)
  ib.block('便器', [7.3, 6.95], 0.6, 0.5, 0, 0.8)
  ib.box([7.55, 6.4], 0.85, [0.06, 0.14, 0.14], '#e8e4dc', IM.plastic, 0.4)
  ceilingLight(ib, [6.2, 6.1], 2.47, L('bath'), 0.16)
}

/** ガレージの家庭工房（作業台と万力・有孔ボードと工具・旋盤・ボール盤・溶接機・部品の棚・試作品） */
function garage(ib: InteriorBuilder) {
  ib.room('garage')
  // 作業台（南の壁）と有孔ボード
  table(ib, '作業台', [5.6, 8.02], 2.6, 0.66, 0.92, 0, '#9a7a52', 0.06, '#5a4a3a')
  ib.box([5.6, 8.02], 0.18, [2.5, 0.6, 0.03], '#7a5a3a', NM.wood, 0, 0, 0.7)
  pegboard(ib, [5.6, 7.665], 1.05, 2.6, 0.95, Math.PI / 2)
  // 万力・工具箱・小さなロボットの試作品
  ib.box([4.55, 7.9], 0.92, [0.16, 0.24, 0.12], '#2a5a8a', NM.iron, 0.4)
  ib.box([6.5, 8.05], 0.92, [0.5, 0.26, 0.24], '#c0392b', NM.paint, 0.5)
  ib.cyl([5.6, 8.05], 0.92, 0.09, 0.14, '#e8eaec', IM.plastic, 0.4, 16)
  ib.box([5.6, 8.0], 1.04, [0.14, 0.04, 0.06], '#1a2026', IM.screen, 0)
  ib.glowBox([5.6, 7.98], 1.055, [0.06, 0.004, 0.02], '#5ff0ff', L('garage-bench'), 3)
  // 作業灯（作業台の上）
  ib.box([5.6, 8.1], 1.95, [1.2, 0.12, 0.05], '#e8e8e4', NM.paint, 0.4)
  ib.glowBox([5.6, 8.1], 1.94, [1.15, 0.08, 0.01], '#fff6e8', L('garage-bench'), 4)
  // 旋盤（西の壁）・ボール盤
  ib.solidBox('旋盤', [3.95, 9.2], 0, [0.6, 1.3, 0.85], '#3a5a4a', NM.paint, 0.3, Math.PI / 2)
  ib.box([3.95, 9.2], 0.85, [0.32, 1.2, 0.28], '#4a6a5a', NM.paint, 0.4, Math.PI / 2)
  ib.cyl([3.95, 9.75], 1.0, 0.12, 0.2, '#8a8e94', NM.steel, 0)
  ib.solidBox('ボール盤の台', [3.95, 10.65], 0, [0.5, 0.5, 0.8], '#5a5a5a', NM.iron, 0.3)
  ib.box([3.95, 10.75], 0.8, [0.12, 0.12, 0.9], '#2a5a8a', NM.paint, 0.4)
  ib.box([3.95, 10.62], 1.55, [0.25, 0.4, 0.25], '#2a5a8a', NM.paint, 0.4)
  // 溶接機（北東の角）と部品の棚（東の壁）
  ib.solidBox('溶接機', [9.55, 10.8], 0, [0.5, 0.4, 0.55], '#c04020', NM.paint, 0.4)
  ib.box([9.55, 10.8], 0.55, [0.42, 0.34, 0.15], '#2a2a2a', NM.iron, 0.3)
  bookshelf(ib, '部品の棚', [9.88, 8.75], 1.6, 0.42, 1.9, -Math.PI / 2, '#8a8a88', 4, 0.0, 1, '#6a6a68')
  for (let r = 0; r < 4; r++)
    for (let i = 0; i < 4; i++) box(ib, [9.85, 8.15 + i * 0.4], 0.09 + r * 0.45, [0.34, 0.36, 0.22], -Math.PI / 2, ['#3a6aa8', '#c8a040', '#c04030', '#4a8a4a'][(r + i) % 4])
  // 床の油のしみ・自転車の代わりの台車
  ib.box([7.6, 9.6], 0, [1.1, 0.8, 0.004], '#6a665e', NM.concrete, 0, 0.3, 0.8)
  ib.solidBox('台車', [8.0, 10.6], 0.08, [0.9, 0.55, 0.05], '#3a3a3a', NM.iron, 0.3)
  // 天井の照明（細長い蛍光灯）
  for (const v of [8.8, 10.2]) {
    ib.box([6.8, v], 2.62, [1.3, 0.16, 0.06], '#e8e8e4', NM.paint, 0.4)
    ib.glowBox([6.8, v], 2.6, [1.25, 0.1, 0.012], '#f4f8ff', L('garage'), 3.5)
  }
}

/** 花音の部屋（ロフトベッドと下の作業机・はんだ・オシロスコープ・部品の引き出し・有孔ボード・ポスター・スニーカーの棚・3D プリンタ・本棚・ビーズクッション・KB-001 の充電台） */
function kanonRoom(ib: InteriorBuilder) {
  ib.room('kanon')
  const steel = '#1e1f22'
  // ロフトベッド（黒い鉄のフレーム）
  for (const [u, v] of [
    [0.27, 2.97],
    [2.33, 2.97],
    [0.27, 3.87],
    [2.33, 3.87],
  ] as L2[])
    ib.box([u, v], 0, [0.05, 0.05, 1.88], steel, IM.steelBlack, 0)
  ib.box([1.3, 3.42], 1.38, [2.12, 0.96, 0.06], steel, IM.steelBlack, 0)
  ib.box([1.3, 3.42], 1.44, [2.04, 0.9, 0.16], '#f0eee8', IM.bedding, 0)
  ib.box([1.15, 3.42], 1.6, [1.6, 0.92, 0.07], '#3a4a6a', IM.bedding, 0)
  ib.box([0.48, 3.42], 1.6, [0.34, 0.55, 0.12], '#f4f2ec', IM.bedding, 0)
  // 水色のクジラ「シオ」（ベッドの上）
  ib.box([1.9, 3.3], 1.66, [0.34, 0.18, 0.16], '#8fd0ec', IM.fabric, 0, 0.3)
  ib.box([2.08, 3.25], 1.7, [0.1, 0.16, 0.1], '#8fd0ec', IM.fabric, 0, 0.6)
  // 手すり（南の側。梯子の所は空ける）と梯子（東の端）
  ib.beam([0.27, 2.97, 1.82], [1.95, 2.97, 1.82], 0.035, steel, IM.steelBlack)
  ib.beam([0.27, 2.97, 1.62], [1.95, 2.97, 1.62], 0.025, steel, IM.steelBlack)
  for (let i = 0; i <= 6; i++) ib.beam([0.27 + i * 0.28, 2.97, 1.44], [0.27 + i * 0.28, 2.97, 1.82], 0.02, steel, IM.steelBlack)
  ib.beam([0.27, 3.87, 1.82], [2.33, 3.87, 1.82], 0.035, steel, IM.steelBlack)
  for (const dv of [-0.18, 0.18]) ib.beam([2.62, 3.42 + dv, 0], [2.36, 3.42 + dv, 1.86], 0.035, steel, IM.steelBlack)
  for (let i = 1; i <= 6; i++) {
    const k = i / 7
    ib.beam([2.62 - 0.26 * k, 3.24, 1.86 * k], [2.62 - 0.26 * k, 3.6, 1.86 * k], 0.025, steel, IM.steelBlack)
  }
  ib.block('ロフトベッド', [1.3, 3.42], 2.15, 1.0, 0, 1.9)
  ib.block('梯子', [2.5, 3.42], 0.3, 0.45, 0, 1.9)
  // 作業机（ロフトベッドの下）: 天板・部品の引き出し棚・棚板とシアンの LED テープ
  ib.box([1.25, 3.55], 0.72, [1.86, 0.68, 0.035], '#6e5038', NM.wood, 0)
  cabinet(ib, '部品の引き出し棚', [0.48, 3.55], 0.4, 0.6, 0.7, 0, '#d8dade', 6, IM.plastic, '#5a5a5a', 3)
  ib.box([2.1, 3.85], 0, [0.04, 0.04, 0.72], steel, IM.steelBlack, 0)
  ib.box([2.1, 3.25], 0, [0.04, 0.04, 0.72], steel, IM.steelBlack, 0)
  ib.box([1.3, 3.75], 1.12, [1.9, 0.26, 0.025], '#6e5038', NM.wood, 0)
  ib.glowBox([1.3, 3.62], 1.115, [1.86, 0.008, 0.01], '#5ff0ff', L('kanon-led'), 5)
  ib.glowBox([1.3, 3.45], 1.36, [1.9, 0.02, 0.01], '#fff0d8', L('kanon-desk'), 2.5)
  // 有孔ボードと工具（机の奥の壁）
  pegboard(ib, [1.25, 3.89], 0.78, 1.7, 0.33, -Math.PI / 2)
  // 机の上: モニタとキーボード・オシロスコープ・はんだのステーション・部品の箱・小さなロボットの試作品・最初の画像の額・マグ・電気スタンド
  monitor(ib, [1.45, 3.72], 0.755, -Math.PI / 2, 0.5, 'code2')
  keyboard(ib, [1.4, 3.35], 0.755, 0)
  ib.box([0.95, 3.7], 0.755, [0.34, 0.24, 0.2], '#c8c8c4', IM.plastic, 0.3)
  ib.picture('scope', [0.9, 3.578], 0.88, 0.14, 0.1, -Math.PI / 2, 1, 0.001)
  ib.box([2.0, 3.65], 0.755, [0.18, 0.15, 0.09], '#2a5a8a', IM.plastic, 0.4)
  ib.tube([2.0, 3.5, 0.85], [1.88, 3.42, 0.92], 0.008, '#c0392b', IM.plastic)
  ib.box([0.78, 3.38], 0.755, [0.22, 0.16, 0.06], '#3a3a3a', IM.plastic, 0.3)
  for (let i = 0; i < 6; i++) ib.box([0.71 + (i % 3) * 0.07, 3.35 + Math.floor(i / 3) * 0.06], 0.815, [0.05, 0.04, 0.02], ['#c0392b', '#2a8a4a', '#2a5a9a', '#d4a020'][i % 4], IM.plastic, 0.4)
  ib.box([1.85, 3.36], 0.755, [0.09, 0.09, 0.1], '#e8eaec', IM.plastic, 0.4)
  ib.cyl([1.85, 3.36], 0.855, 0.05, 0.06, '#e8eaec', IM.plastic, 0.4, 12)
  ib.glowBox([1.85, 3.31], 0.875, [0.05, 0.004, 0.012], '#5ff0ff', L('kanon-led'), 4)
  frame(ib, 'first-image', [2.05, 3.82], 0.9, 0.2, 0.15, -Math.PI / 2, '#f4f2ec')
  mug(ib, [1.82, 3.2], 0.755, '#f0b040')
  deskLamp(ib, [0.75, 3.75], 0.755, -Math.PI / 2 + 0.3, L('kanon-desk'))
  // 作業の丸椅子（花音が座る。立ち寄り先 thompson-desk の椅子なので、通り道の障害物は脚の中心だけ）
  stool(ib, [1.3, 2.83], 0.5, '#5a4030', '#1e1f22', 0.18, false)
  // ポスター（北の壁。『並行航路ステラゲート』・星図）と写真
  frame(ib, 'stellagate', [3.0, 3.895], 1.62, 0.5, 0.71, -Math.PI / 2, '#1a1a1a')
  frame(ib, 'starchart', [3.92, 3.895], 1.72, 0.66, 0.44, -Math.PI / 2, '#2a2420')
  frame(ib, 'photo-kb', [3.75, 3.895], 1.22, 0.2, 0.2, -Math.PI / 2, '#f4f2ec')
  frame(ib, 'photo-bay', [4.12, 3.895], 1.24, 0.26, 0.17, -Math.PI / 2, '#f4f2ec')
  // 引き出しのキャビネット（ポスターの下）と KB-001 の充電台
  cabinet(ib, '部品のキャビネット', [3.5, 3.7], 1.5, 0.42, 0.74, 0, '#3a4048', 4, NM.paint, '#c8ccd0', 3)
  ib.cyl([3.0, 3.68], 0.74, 0.17, 0.025, '#e8eaec', IM.plastic, 0.5, 24)
  ib.glowCyl([3.0, 3.68], 0.765, 0.14, 0.004, '#5ff0ff', L('kanon-led'), 4)
  smallPlant(ib, [4.15, 3.7], 0.74, 0.18)
  // スニーカーの棚（東の壁一面。14 足）
  {
    const c: L2 = [4.28, 1.38]
    const w = 2.2
    ib.box([c[0], c[1]], 0, [0.32, w, 0.04], '#e8e4dc', NM.paint, 0.4, 0)
    for (const dv of [-w / 2, w / 2]) ib.box([c[0], c[1] + dv], 0, [0.32, 0.03, 1.9], '#e8e4dc', NM.paint, 0.4, 0)
    const cols = ['#f2f2f2', '#e8c840', '#1f5f9a', '#d04030', '#2a2a2a', '#5fd0e0', '#8a4ad0', '#f0a0c0']
    let n = 0
    for (let r = 0; r < 6; r++) {
      const h = 0.06 + r * 0.31
      ib.box([c[0], c[1]], h + 0.27, [0.32, w - 0.02, 0.02], '#e8e4dc', NM.paint, 0.4, 0)
      for (let i = 0; i < 3 && n < 14; i++, n++) {
        const v = c[1] - w / 2 + 0.4 + i * 0.8
        for (const dv of [-0.075, 0.075]) {
          ib.box([c[0] - 0.02, v + dv], h, [0.27, 0.11, 0.035], '#f6f6f2', IM.plastic, 0.2)
          ib.box([c[0] - 0.01, v + dv], h + 0.035, [0.25, 0.1, 0.07], cols[(n * 3 + (dv > 0 ? 1 : 0)) % cols.length], IM.fabric, 0)
        }
      }
    }
    ib.block('スニーカーの棚', c, 0.34, w, 0, 1.9)
  }
  // 3D プリンタ（南の窓際の台の上）
  table(ib, 'プリンタの台', [3.7, 0.52], 0.7, 0.62, 0.62, 0, '#3a4048')
  ib.box([3.7, 0.5], 0.62, [0.5, 0.48, 0.05], '#2a2a2c', NM.iron, 0.3)
  for (const [du, dv] of [
    [-0.22, -0.2],
    [0.22, -0.2],
    [-0.22, 0.2],
    [0.22, 0.2],
  ] as L2[])
    ib.box([3.7 + du, 0.5 + dv], 0.67, [0.03, 0.03, 0.48], '#2a2a2c', NM.iron, 0.3)
  ib.box([3.7, 0.5], 1.12, [0.5, 0.48, 0.04], '#2a2a2c', NM.iron, 0.3)
  ib.box([3.7, 0.5], 0.95, [0.48, 0.04, 0.03], '#c8ccd0', NM.steel, 0)
  ib.box([3.7, 0.5], 0.69, [0.12, 0.12, 0.09], '#f08a30', IM.plastic, 0.4)
  ib.cyl([3.92, 0.75], 1.16, 0.09, 0.06, '#f08a30', IM.plastic, 0.4, 14)
  // 本棚（技術書・マンガ・SF。西の壁の南）
  bookshelf(ib, '花音の本棚', [0.32, 0.75], 1.0, 0.32, 1.8, Math.PI / 2, '#e8e4dc', 5, 0.86, 11)
  // ビーズクッション・ラグ・猫のぬいぐるみ
  rug(ib, [2.25, 1.75], 1.9, 1.4, 0.1, '#3c4456', 0)
  ib.lathe([2.0, 1.55], 0, [
    [0.42, 0],
    [0.46, 0.12],
    [0.42, 0.3],
    [0.3, 0.42],
    [0.05, 0.46],
  ], 16, '#2c3446', IM.fabric, 0)
  ib.disc('ビーズクッション', [2.0, 1.55], 0.44, 0, 0.45, true, false)
  ib.box([2.6, 1.4], 0, [0.22, 0.14, 0.16], '#f2f0ea', IM.fabric, 0, 0.4)
  ib.box([2.66, 1.42], 0.14, [0.12, 0.12, 0.1], '#f2f0ea', IM.fabric, 0, 0.4)
  // 祖父の掛け時計（西の壁）
  ib.box([0.17, 2.65], 1.55, [0.05, 0.3, 0.62], '#4a2e1c', NM.wood, 0)
  ib.box([0.2, 2.65], 1.9, [0.01, 0.22, 0.22], '#f2ead8', NM.paint, 0.2)
  ib.box([0.2, 2.65], 1.6, [0.01, 0.04, 0.25], '#c9a54a', NM.gold, 0)
  // カーテン（紺）
  curtains(ib, [1.68, 0.22], [3.12, 0.22], 3.55 - 2.9, 5.15 - 2.9, '#2a3450', 0.8)
  ceilingLight(ib, [2.3, 1.7], 2.55, L('kanon-ceiling'), 0.22)
  // 床のケーブル（KB-001 が束ねた）
  ib.tube([2.0, 3.9, 0.01], [3.3, 3.85, 0.01], 0.012, '#2a2a2a', IM.plastic, 0.3, 6)
}

/** 2 階の廊下（吹き抜けの手すり・照明・屋根裏の点検口・家族の写真） */
function hall2(ib: InteriorBuilder) {
  ib.room('hall2')
  const rail = (a: L2, b: L2) => {
    ib.beam([a[0], a[1], 0.92], [b[0], b[1], 0.92], 0.06, '#8a5a34', NM.wood, 0, 0.045)
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.11))
    for (let i = 0; i <= n; i++) {
      const k = i / n
      ib.box([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], 0, [0.022, 0.022, 0.9], '#f2efe8', NM.paint, 0.4)
    }
  }
  rail([4.52, 3.93], [4.86, 3.93])
  rail([4.02, 4.88], [4.86, 4.88])
  ib.box([4.88, 3.93], 0, [0.08, 0.08, 1.0], '#8a5a34', NM.wood, 0)
  ib.box([4.88, 4.88], 0, [0.08, 0.08, 1.0], '#8a5a34', NM.wood, 0)
  ceilingLight(ib, [5.0, 5.4], 2.55, L('hall2'), 0.18)
  ceilingLight(ib, [5.08, 1.8], 2.55, L('hall2-s'), 0.15)
  // 屋根裏の点検口と、たたんだ梯子のひも
  ib.box([6.3, 6.3], 2.53, [0.68, 0.98, 0.02], '#e8e2d4', NM.paint, 0.3, 0, 0.8)
  ib.box([6.3, 6.3], 2.52, [0.62, 0.92, 0.012], '#d8d0c0', NM.wood, 0, 0, 0.8)
  ib.tube([6.3, 5.9, 2.1], [6.3, 5.9, 2.52], 0.004, '#3a3a3a', NM.iron, 0, 4)
  ib.box([6.3, 5.9], 2.05, [0.04, 0.04, 0.05], '#3a3a3a', NM.iron, 0)
  frame(ib, 'photo-family', [7.37, 6.2], 1.5, 0.32, 0.24, Math.PI, '#3a2a1e')
  frame(ib, 'map-town', [5.62, 1.6], 1.55, 0.6, 0.45, Math.PI, '#5a4030')
  plant(ib, [7.0, 7.05], 0, 0.36, '#d8d0c0', '#456e38', 1.2)
}

/** 美咲の書斎（小説とデザインノートの本棚・窓際の机・原稿・紅茶のポット・古い技術誌） */
function misaki(ib: InteriorBuilder) {
  ib.room('misaki')
  bookshelf(ib, '美咲の本棚', [2.0, 5.12], 3.5, 0.32, 2.25, Math.PI, '#5a3e2c', 7, 0.95, 21)
  bookshelf(ib, '美咲の本棚（西）', [0.32, 6.6], 1.3, 0.32, 2.25, Math.PI / 2, '#5a3e2c', 7, 0.9, 27)
  table(ib, '美咲の机', [2.15, 6.98], 1.35, 0.62, 0.72, 0, '#7a5236')
  chair(ib, [2.15, 6.35], Math.PI / 2, '#6a4a30', 0.46, '#8a6a4a')
  ib.box([2.0, 7.0], 0.72, [0.32, 0.22, 0.015], '#c8c8c4', IM.plastic, 0.4)
  ib.picture('laptop', [2.0, 7.11], 0.86, 0.3, 0.19, -Math.PI / 2, 1, 0, 0.25)
  ib.picture('manuscript', [2.5, 6.9], 0.725, 0.2, 0.28, Math.PI / 2, 0, 0, Math.PI / 2)
  ib.picture('manuscript', [2.55, 6.95], 0.735, 0.2, 0.28, Math.PI / 2 + 0.3, 0, 0, Math.PI / 2)
  deskLamp(ib, [2.7, 7.15], 0.72, -Math.PI / 2 - 0.4, L('misaki-desk'))
  // 窓台の紅茶のポット
  ib.cyl([1.75, 7.26], 0.98, 0.08, 0.12, '#f4f0e6', IM.ceramic, 0, 14, 0.06)
  ib.cyl([1.95, 7.26], 0.98, 0.04, 0.07, '#f4f0e6', IM.ceramic, 0, 12)
  // 古い技術誌の箱と、読む椅子
  box(ib, [3.6, 7.05], 0, [0.4, 0.32, 0.3], 0, '#a8845a')
  ib.picture('magazine', [3.6, 7.05], 0.31, 0.2, 0.27, Math.PI / 2, 0, 0, Math.PI / 2)
  sofa(ib, [1.05, 5.65], 0.85, 0.8, Math.PI / 2, '#8a5a4a')
  rug(ib, [2.2, 6.2], 1.8, 1.2, 0, '#7a4a3a', 1)
  ceilingLight(ib, [2.0, 6.1], 2.55, L('misaki-ceiling'), 0.18)
  plant(ib, [3.65, 5.4], 0, 0.34, '#d8d0c0', '#456e38', 1.2)
}

/** 両親の寝室（ダブルベッド・ナイトテーブルと灯り・洋服箪笥・鏡台） */
function bedroom(ib: InteriorBuilder) {
  ib.room('bedroom')
  rug(ib, [7.7, 2.8], 2.4, 1.8, 0, '#b8a890', 0)
  bed(ib, [7.7, 3.2], 1.6, 2.05, Math.PI / 2, '#6a4a30', '#f2f0ea', '#8a9aa8')
  for (const u of [6.62, 8.8]) {
    cabinet(ib, 'ナイトテーブル', [u, 3.98], 0.45, 0.4, 0.5, 0, '#6a4a30', 1, NM.wood, '#c9b98a')
    ib.cyl([u, 3.98], 0.5, 0.06, 0.25, '#c8b8a0', IM.ceramic, 0, 12, 0.04)
    ib.glowCyl([u, 3.98], 0.72, 0.13, 0.18, '#f4e4c8', L(u < 7.5 ? 'bed-left' : 'bed-right'), 2, 0.09)
  }
  cabinet(ib, '洋服箪笥', [5.95, 1.2], 1.6, 0.58, 2.0, Math.PI / 2, '#7a5838', 1, NM.wood, '#c9b98a', 2)
  cabinet(ib, '鏡台', [8.9, 0.5], 1.0, 0.45, 0.78, Math.PI, '#7a5838', 3, NM.wood, '#c9b98a')
  ib.box([8.9, 0.22], 0.85, [0.6, 0.02, 0.7], '#b8c4cc', IM.plastic, 0.95)
  plant(ib, [9.0, 3.95], 0, 0.36, '#d8d0c0', '#456e38', 1.4)
  ceilingLight(ib, [7.5, 2.2], 2.55, L('bed-left'), 0.2)
}

function toilet2(ib: InteriorBuilder) {
  ib.room('toilet2')
  ib.box([9.1, 5.9], 0, [0.4, 0.5, 0.4], '#f6f6f4', IM.ceramic, 0)
  ib.box([9.3, 5.9], 0.4, [0.18, 0.42, 0.42], '#f6f6f4', IM.ceramic, 0)
  ib.block('便器', [9.15, 5.9], 0.6, 0.5, 0, 0.8)
  ib.box([8.5, 7.2], 0.8, [0.45, 0.25, 0.08], '#f6f6f4', IM.ceramic, 0)
  ceilingLight(ib, [8.4, 5.8], 2.55, L('toilet2'), 0.12)
}

/** 屋根裏（垂木と棟木・季節の物の箱・花音の子どものころの作品（段ボールのロボット）・古い技術誌の箱・裸電球） */
function attic(ib: InteriorBuilder) {
  ib.room('attic')
  // 低い所は歩かない（屋根の勾配。中ほどの v 2.45〜5.05 だけ立って歩ける）
  ib.block('屋根の低い所（南）', [4.8, 1.25], 9.4, 2.4, 0, 1.6, 0, true, false)
  ib.block('屋根の低い所（北）', [4.8, 6.25], 9.4, 2.4, 0, 1.6, 0, true, false)
  // 垂木（0.6m ごと）と棟木
  const ridge = 8.35 - 5.75
  for (let u = 0.45; u < 9.4; u += 0.6) {
    for (const sgn of [-1, 1]) {
      const v1 = 3.75 + sgn * 3.55
      const h1 = ridge - 0.693 * 3.55
      ib.beam([u, 3.75, ridge - 0.08], [u, v1, h1 - 0.08], 0.05, '#8a6a46', NM.wood, 0, 0.12)
    }
  }
  ib.beam([0.2, 3.75, ridge - 0.1], [9.4, 3.75, ridge - 0.1], 0.14, '#7a5a3a', NM.wood, 0, 0.18)
  // 季節の物の箱（低い所に積む）
  const boxes: [number, number, number, number, number][] = [
    [1.0, 2.0, 0.6, 0.45, 0.4],
    [1.6, 1.95, 0.5, 0.5, 0.35],
    [1.05, 2.05, 0.5, 0.4, 0.3],
    [7.4, 5.4, 0.6, 0.5, 0.42],
    [8.1, 5.5, 0.55, 0.45, 0.38],
    [7.5, 5.45, 0.5, 0.4, 0.3],
    [3.0, 5.5, 0.7, 0.5, 0.35],
    [5.8, 2.0, 0.6, 0.5, 0.4],
  ]
  let stack = 0
  boxes.forEach(([u, v, w, d, h], i) => {
    const below = i > 0 && Math.hypot(boxes[i - 1][0] - u, boxes[i - 1][1] - v) < 0.2 ? stack : 0
    box(ib, [u, v], below, [w, d, h], (i % 3) * 0.2)
    stack = below + h
  })
  // 段ボールのロボット（花音の子どものころの作品）
  box(ib, [4.1, 4.85], 0, [0.36, 0.26, 0.42], 0.3, '#c09a6a')
  box(ib, [4.1, 4.85], 0.42, [0.26, 0.22, 0.22], 0.3, '#c09a6a')
  ib.box([4.06, 4.73], 0.5, [0.05, 0.02, 0.05], '#5ff0ff', IM.plastic, 0.6, 0.3)
  ib.box([4.16, 4.76], 0.5, [0.05, 0.02, 0.05], '#5ff0ff', IM.plastic, 0.6, 0.3)
  ib.tube([4.1, 4.85, 0.64], [4.1, 4.85, 0.8], 0.006, '#c0392b', NM.iron, 0, 6)
  ib.box([4.1, 4.85], 0.8, [0.04, 0.04, 0.04], '#c0392b', IM.plastic, 0.4)
  // 古い技術誌の箱（ふたが開いている）
  box(ib, [5.4, 4.9], 0, [0.45, 0.34, 0.3], 0, '#a8845a')
  ib.picture('magazine', [5.4, 4.88], 0.31, 0.2, 0.27, Math.PI / 2, 0, 0, Math.PI / 2)
  // 扇風機・古いスーツケース・床の点検口（廊下から上がる梯子の口）
  ib.box([2.5, 4.6], 0, [0.5, 0.25, 0.7], '#5a3a2a', NM.paint, 0.4, 0.2)
  ib.box([6.3, 6.3], -0.02, [0.7, 1.0, 0.03], '#2a2622', NM.dark, 0, 0, 0.5)
  for (const [a, b] of [
    [[5.92, 5.78], [6.68, 5.78]],
    [[5.92, 5.78], [5.92, 6.82]],
    [[6.68, 5.78], [6.68, 6.82]],
  ] as [L2, L2][])
    ib.beam([a[0], a[1], 0.6], [b[0], b[1], 0.6], 0.04, '#8a6a46', NM.wood)
  ib.block('点検口', [6.3, 6.3], 0.8, 1.1, 0, 0.7)
  // 裸電球
  ib.tube([4.8, 3.75, 2.1], [4.8, 3.75, ridge - 0.12], 0.004, '#1a1a1a', NM.iron, 0, 6)
  ib.glowBulb([4.8, 3.75], 2.04, 0.04, '#ffcf8a', L('attic'), 7)
}
