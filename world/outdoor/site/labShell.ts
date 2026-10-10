import * as THREE from 'three'
import { rectOf } from '../../../core/labPlan'
import { ENTRANCE, ROOM } from '../../../core/lab/plan'
import { DOOR, SHELL } from '../../../core/site'
import { GeoBuilder, MAT } from './builder'
import { naturalY } from './siteModel'

/**
 * ラボの外側の殻（打ち放しのコンクリート・陸屋根）の形。中のラボ（殻の world/lab/shell の room.ts・entrance.ts）とぴったり合うように、
 * 中の壁の面（x = ±8.4・北の部屋の奥 z = -5.2）の外へ SHELL.wall（0.2m）の厚みで作る。外の面は設定資料の外形（17.2m × 10.8m）。
 *
 * - 東西の壁: ハイサイドの窓（y 2.6〜4.4・メインホールの奥行き）の開口と見込み、外の押縁と水切り。西の壁の南端に通用口の開口
 * - 北の壁: 冷却機械室のガラリと扉、給湯室・WC の換気口
 * - 南: 南西の角の柱（外の面にひらき札。world/lab/shell/entrance.ts）と、ガラス壁を囲む額縁（東の柱・屋根の縁）。ガラスの外の押縁
 * - 屋根: スラブ・パラペット・笠木・防水・室外機 3 台と冷媒管・小さなアンテナ・点検口・避雷針
 * - 雨どい（角の 4 本）・庇（見学エントランスの上と、通用口の上）・北の水冷放熱器 2 基（地図データの位置。ラボの北 2m）
 * 光る物（ネオン・灯り）と外から見たガラスは別の形（glow・glass）で返す
 */

const CON = '#8e9093'
const CON_DARK = '#7f8183'
const METAL = '#2a2e33'
const GUTTER = '#3b4045'
const COPING = '#9ca1a5'

const HW = ROOM.halfWidth
const OX = SHELL.outerX
const GZ = SHELL.glassZ
const PZ = SHELL.portalZ
const NI = SHELL.northInner
const NO = SHELL.northOuter
const BOT = SHELL.plinthBottom
const CEIL = SHELL.ceiling
const RT = SHELL.roofTop
const PT = SHELL.parapetTop
const [CL0, CL1] = SHELL.clerestory
const GLASS_X0 = ENTRANCE.glassFrom
const GLASS_X1 = HW - 0.4
const PARAPET = 0.22

export interface ShellParts {
  /** 打ち放し・金属・屋上の物（サイトのシェーダー） */
  solid: GeoBuilder
  /** 光る物（ネオン）。シアンのネオンの箱 */
  neon: GeoBuilder
  /** 夜に灯る電球色の物（庇の下の灯り・北の扉の灯り） */
  warm: GeoBuilder
  /** 外から見たガラスの面（南のガラス壁・ハイサイドの窓） */
  glass: THREE.BufferGeometry
}

/**
 * 外壁の箱（aux = その面の上の水切りの高さ。雨だれの始まり）。inner = 部屋の側の面（'+x' など）は作らない
 * （中の壁の下地（shell/room.ts の wallBacking）は壁の面のわずか外にあるので、外壁の中の面を作ると、パネルの目地から打ち放しが見えてしまう）
 */
function wall(b: GeoBuilder, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, drip: number, inner: '+x' | '-x' | '+z' | '-z' | null = null, color = CON) {
  const mask: [boolean, boolean, boolean, boolean, boolean, boolean] = [inner !== '+x', inner !== '-x', true, true, inner !== '+z', inner !== '-z']
  b.boxMinMax(x0, y0, z0, x1, y1, z1, color, MAT.formed, drip, mask)
}

export function buildShell(): ShellParts {
  const b = new GeoBuilder()
  const neon = new GeoBuilder()
  const warm = new GeoBuilder()

  // --- 東西の壁（外の面 |x| = OX、中の面 |x| = HW）。ハイサイドの窓の開口（メインホールの奥行き、y CL0〜CL1）。西の壁の南端は通用口の開口 ---
  for (const s of [-1, 1]) {
    const xa = s < 0 ? -OX : HW
    const xb = s < 0 ? -HW : OX
    const inner = s < 0 ? '+x' : '-x'
    // 北の部屋の分（窓なし）。壁は天井の高さまで（その上は屋根のスラブとパラペット）
    wall(b, xa, xb, BOT, CEIL, NO, ROOM.north, PT, inner)
    // ホールの分: 窓の下（西は通用口の開口を除く）・上と、南の端の柱
    if (s < 0) {
      const [d0, d1] = ENTRANCE.staffDoor.z
      const dh = ENTRANCE.staffDoorHeight
      wall(b, xa, xb, BOT, CL0, ROOM.north, d0, CL0, inner)
      wall(b, xa, xb, dh, CL0, d0, d1, CL0, inner)
      wall(b, xa, xb, BOT, -0.02, d0, d1, 0, inner)
      wall(b, xa, xb, BOT, CL0, d1, GZ, CL0, inner)
      // 通用口の外の枠（見込みの縁の金属）と、扉の下の沓摺り
      b.boxMinMax(-OX - 0.01, 0, d0 - 0.04, -OX + 0.02, dh, d0, METAL, MAT.paint, 0.45)
      b.boxMinMax(-OX - 0.01, 0, d1, -OX + 0.02, dh, d1 + 0.04, METAL, MAT.paint, 0.45)
      b.boxMinMax(-OX - 0.01, dh, d0 - 0.04, -OX + 0.02, dh + 0.04, d1 + 0.04, METAL, MAT.paint, 0.45)
      b.boxMinMax(-OX, -0.02, d0, -HW + 0.06, 0.005, d1, '#b6bbbf', MAT.steel)
    } else wall(b, xa, xb, BOT, CL0, ROOM.north, GZ, CL0, inner)
    wall(b, xa, xb, CL1, CEIL, ROOM.north, GZ, PT, inner)
    wall(b, xa, xb, BOT, CEIL, GZ, PZ, PT, inner)
    // 窓の水切り（下の見込みの外に、少し出た金属の板）と、外の押縁（ガラスの外の面の方立て。中の方立てと同じ 1.5m ごと）
    const xo = s * OX
    b.boxMinMax(Math.min(xo, xo + s * 0.05), CL0 - 0.03, ROOM.north, Math.max(xo, xo + s * 0.05), CL0 + 0.015, GZ, METAL, MAT.paint, 0.4)
    const xg = s * (HW + 0.02)
    const bays = Math.round(ROOM.depth / 1.5)
    for (let k = 0; k <= bays; k++) {
      const z = ROOM.north + (k * ROOM.depth) / bays
      b.box([xg, (CL0 + CL1) / 2, z], [0.04, CL1 - CL0, 0.06], METAL, MAT.paint, 0.4)
    }
    for (const y of [CL0 + 0.03, CL1 - 0.03]) b.box([xg, y, (ROOM.north + GZ) / 2], [0.05, 0.06, GZ - ROOM.north], METAL, MAT.paint, 0.4)
  }

  // --- 北の壁（中二階の下の北の部屋の奥） ---
  wall(b, -HW, HW, BOT, CEIL, NO, NI, PT, '+z')
  // 冷却機械室のガラリ（枠と、斜めの羽根）
  const cooling = rectOf('冷却機械室')
  {
    const x0 = cooling.min[0] + 0.5
    const x1 = cooling.min[0] + 2.7
    const y0 = 1.0
    const y1 = 2.5
    const z = NO - 0.02
    b.boxMinMax(x0 - 0.06, y0 - 0.06, z - 0.03, x1 + 0.06, y1 + 0.06, z + 0.02, '#5c6166', MAT.paint, 0.3)
    b.boxMinMax(x0, y0, z - 0.035, x1, y1, z - 0.03, '#15181b', MAT.grille, 0)
    for (let y = y0 + 0.06; y < y1; y += 0.11) b.box([(x0 + x1) / 2, y, z - 0.05], [x1 - x0, 0.012, 0.09], '#6a6f74', MAT.paint, 0.3, [-0.6, 0, 0])
  }
  // 冷却機械室の扉（鉄の扉と枠・小さな庇・ブラケットの灯り）
  {
    const x0 = cooling.max[0] - 1.35
    const x1 = cooling.max[0] - 0.45
    const z = NO
    b.boxMinMax(x0 - 0.05, 0, z - 0.04, x1 + 0.05, 2.15, z + 0.01, '#3c4146', MAT.paint, 0.4)
    b.boxMinMax(x0, 0.02, z - 0.06, x1, 2.08, z - 0.035, '#596067', MAT.paint, 0.35)
    b.box([x1 - 0.12, 1.02, z - 0.08], [0.12, 0.03, 0.03], '#b9bec2', MAT.steel)
    b.boxMinMax(x0 - 0.35, 2.4, z - 0.75, x1 + 0.35, 2.47, z, METAL, MAT.paint, 0.4)
    b.box([(x0 + x1) / 2, 2.7, z - 0.08], [0.16, 0.2, 0.12], '#2e3236', MAT.paint, 0.4)
    warm.box([(x0 + x1) / 2, 2.6, z - 0.1], [0.12, 0.012, 0.08], '#ffd2a0', 0, 0)
    // 扉の前の小さな土間
    b.boxMinMax(x0 - 0.5, -1.2, z - 1.0, x1 + 0.5, -0.82, z, '#a19d95', MAT.concrete, 0)
  }
  // 小さな換気口（給湯室・WC）
  for (const x of [(rectOf('給湯室').min[0] + rectOf('給湯室').max[0]) / 2, (rectOf('WC').min[0] + rectOf('WC').max[0]) / 2]) {
    b.box([x, 2.2, NO - 0.02], [0.32, 0.32, 0.05], '#9da2a6', MAT.paint, 0.3)
    b.box([x, 2.2, NO - 0.046], [0.24, 0.24, 0.01], '#1a1d20', MAT.grille, 0)
  }

  // --- 南: 南西の角の柱（外の面にひらき札）と、ガラス壁の東の柱 ---
  wall(b, -HW, GLASS_X0, BOT, CEIL, GZ, PZ, PT, '-z')
  wall(b, GLASS_X1, HW, BOT, CEIL, GZ, PZ, PT, '-z')
  // ガラス壁の外の押縁（中の方立て・欄間と同じ位置）
  {
    const g0 = -GLASS_X1 // 中の SouthWall の壁ローカル（x を反転）
    const d0 = -ENTRANCE.glassDoor[1]
    const bays = Math.round((d0 - g0) / 1.2)
    const xs = [...Array.from({ length: bays + 1 }, (_, i) => -(g0 + ((d0 - g0) * i) / bays)), -(-ENTRANCE.glassDoor[0])]
    const z = GZ + 0.03
    for (const x of xs) b.box([x, CEIL / 2, z], [0.06, CEIL, 0.05], METAL, MAT.paint, 0.5)
    for (const y of [0.03, ...ENTRANCE.transoms, CEIL - 0.04]) {
      // 扉の区画は欄間から上だけ
      if (y < ENTRANCE.transoms[0]) b.box([(GLASS_X1 + ENTRANCE.glassDoor[1]) / 2, y, z], [GLASS_X1 - ENTRANCE.glassDoor[1], 0.07, 0.05], METAL, MAT.paint, 0.5)
      else b.box([(GLASS_X1 + GLASS_X0) / 2, y, z], [GLASS_X1 - GLASS_X0, 0.07, 0.05], METAL, MAT.paint, 0.5)
    }
  }

  // --- 屋根: スラブ（縁は打ち放し、上は防水）・パラペット・笠木 ---
  // スラブの下の面は、北の部屋の上（中二階の上）と、ガラス壁の外の軒裏だけ（ホールの天井の板と重ならないように）
  b.boxMinMax(-OX, CEIL, NO, OX, RT, PZ, CON, MAT.formed, PT, [true, true, false, false, true, true])
  b.quad([-OX, CEIL, NO], [OX, CEIL, NO], [OX, CEIL, ROOM.north], [-OX, CEIL, ROOM.north], CON, MAT.formed, PT)
  b.quad([-OX, CEIL, GZ], [OX, CEIL, GZ], [OX, CEIL, PZ], [-OX, CEIL, PZ], CON, MAT.formed, PT)
  b.quad([-OX + PARAPET, RT, PZ - PARAPET], [OX - PARAPET, RT, PZ - PARAPET], [OX - PARAPET, RT, NO + PARAPET], [-OX + PARAPET, RT, NO + PARAPET], '#6d7174', MAT.roof)
  const parapet = (x0: number, x1: number, z0: number, z1: number) => {
    wall(b, x0, x1, RT, PT, z0, z1, PT)
    b.boxMinMax(x0 - 0.03, PT, z0 - 0.03, x1 + 0.03, PT + 0.05, z1 + 0.03, COPING, MAT.paint, 0.55)
  }
  parapet(-OX, OX, NO, NO + PARAPET)
  parapet(-OX, OX, PZ - PARAPET, PZ)
  parapet(-OX, -OX + PARAPET, NO + PARAPET, PZ - PARAPET)
  parapet(OX - PARAPET, OX, NO + PARAPET, PZ - PARAPET)
  // 屋上の縁のシアンのネオン（笠木の下、外の面に沿って一周）
  {
    const y = PT - 0.1
    const t = 0.022
    const o = 0.014
    neon.boxMinMax(-OX - o - t, y - t / 2, NO - o - t, OX + o + t, y + t / 2, NO - o, '#000', 0)
    neon.boxMinMax(-OX - o - t, y - t / 2, PZ + o, OX + o + t, y + t / 2, PZ + o + t, '#000', 0)
    neon.boxMinMax(-OX - o - t, y - t / 2, NO - o, -OX - o, y + t / 2, PZ + o, '#000', 0)
    neon.boxMinMax(OX + o, y - t / 2, NO - o, OX + o + t, y + t / 2, PZ + o, '#000', 0)
  }
  // ガラス壁の枠のネオン（額縁の見込みの面: 西の柱・東の柱・屋根の縁の下）
  {
    const t = 0.018
    const z = PZ - 0.06
    neon.boxMinMax(GLASS_X0, 0.06, z - t / 2, GLASS_X0 + t, CEIL - 0.06, z + t / 2, '#000', 0)
    neon.boxMinMax(GLASS_X1 - t, 0.06, z - t / 2, GLASS_X1, CEIL - 0.06, z + t / 2, '#000', 0)
    neon.boxMinMax(GLASS_X0, CEIL - t, z - t / 2, GLASS_X1, CEIL, z + t / 2, '#000', 0)
  }

  // --- 屋上の物 ---
  // 室外機 3 台（架台・本体・ファンの格子・冷媒管）
  for (let i = 0; i < 3; i++) {
    const x = 2.6 + i * 1.25
    const z = NO + 1.25
    b.boxMinMax(x - 0.55, RT, z - 0.3, x + 0.55, RT + 0.22, z + 0.3, '#4d5257', MAT.paint, 0.3)
    b.boxMinMax(x - 0.48, RT + 0.22, z - 0.19, x + 0.48, RT + 0.98, z + 0.19, '#d9d6cd', MAT.paint, 0.35)
    b.boxMinMax(x - 0.38, RT + 0.32, z + 0.19, x + 0.18, RT + 0.88, z + 0.2, '#222426', MAT.grille, 0)
    b.beam([x + 0.36, RT + 0.4, z - 0.19], [x + 0.36, RT + 0.12, z - 0.62], 0.07, '#cfcac0', MAT.paint, 0.2)
  }
  b.beam([2.96, RT + 0.12, NO + 0.63], [-1.2, RT + 0.12, NO + 0.63], 0.12, '#cfcac0', MAT.paint, 0.2)
  b.beam([-1.2, RT + 0.12, NO + 0.63], [-1.2, RT + 0.12, NO + PARAPET + 0.05], 0.12, '#cfcac0', MAT.paint, 0.2)
  // 点検口
  b.boxMinMax(-3.1, RT, NO + 0.9, -2.2, RT + 0.5, NO + 1.8, '#7d8389', MAT.paint, 0.3)
  b.boxMinMax(-3.15, RT + 0.5, NO + 0.85, -2.15, RT + 0.55, NO + 1.85, '#6b7177', MAT.paint, 0.4)
  // 小さなアンテナ（マストと横木・小さな皿・控えの線）
  {
    const x = -6.4
    const z = NO + 1.4
    b.boxMinMax(x - 0.25, RT, z - 0.25, x + 0.25, RT + 0.08, z + 0.25, '#55595d', MAT.paint, 0.3)
    b.cylinder([x, RT + 0.08, z], 0.03, 2.7, 8, '#a9aeb2', MAT.steel, 0, true)
    for (const [h, w] of [
      [2.3, 0.9],
      [2.55, 0.7],
      [2.72, 0.5],
    ] as const)
      b.beam([x - w / 2, RT + h, z], [x + w / 2, RT + h, z], 0.018, '#b5babe', MAT.steel)
    b.beam([x, RT + 2.45, z - 0.55], [x, RT + 2.45, z + 0.4], 0.02, '#b5babe', MAT.steel)
    // 小さな皿（南南西へ）
    const dish = new THREE.Vector3(x + 0.12, RT + 1.5, z + 0.18)
    b.cylinder([dish.x, dish.y - 0.02, dish.z], 0.3, 0.06, 18, '#e3e1da', MAT.paint, 0.4, true, 0.22)
    for (const [dx, dz] of [
      [1.2, 0],
      [-0.9, 0.9],
      [-0.9, -0.9],
    ])
      b.beam([x, RT + 1.9, z], [x + dx, RT + 0.05, z + dz], 0.008, '#8f9498', MAT.steel)
  }
  // 避雷針（北西の角）
  b.cylinder([-OX + 0.12, PT + 0.05, NO + 0.12], 0.012, 1.4, 6, '#9aa0a4', MAT.steel, 0, true)

  // --- 雨どい（角の 4 本。笠木の下の集水器から地面へ） ---
  for (const [x, z, sx] of [
    [-OX - 0.06, NO + 0.35, -1],
    [OX + 0.06, NO + 0.35, 1],
    [-OX - 0.06, GZ - 0.35, -1],
    [OX + 0.06, GZ - 0.35, 1],
  ] as const) {
    const top = PT - 0.42
    const base = Math.max(-1.2, naturalY(x, z)) - 0.05
    b.boxMinMax(x - 0.05, base, z - 0.05, x + 0.05, top, z + 0.05, GUTTER, MAT.paint, 0.35)
    b.boxMinMax(x - 0.12, top, z - 0.14, x + 0.12, top + 0.26, z + 0.14, GUTTER, MAT.paint, 0.35)
    b.boxMinMax(Math.min(x, x - sx * 0.25), PT - 0.3, z - 0.05, Math.max(x, x - sx * 0.25), PT - 0.2, z + 0.05, GUTTER, MAT.paint, 0.35)
    for (let y = base + 0.6; y < top - 0.2; y += 1.6) b.boxMinMax(x - 0.065, y, z - 0.065, x + 0.065, y + 0.04, z + 0.065, '#30353a', MAT.paint, 0.35)
    // 足元の排水の桝
    b.boxMinMax(x - 0.2, base - 0.02, z - 0.2, x + 0.2, base + 0.03, z + 0.2, '#3a3d40', MAT.grille, 0)
  }

  // --- 庇（見学エントランスの上・通用口の上）。下に灯り（ひらき札と扉の前）と、扉の上のセンサー ---
  {
    const x0 = -OX
    const x1 = DOOR.x + DOOR.width / 2 + 0.6
    const y = 2.86
    const z1 = PZ + 1.25
    b.boxMinMax(x0, y - 0.07, PZ, x1, y, z1, METAL, MAT.paint, 0.45)
    b.boxMinMax(x0, y - 0.16, z1 - 0.04, x1, y + 0.02, z1, METAL, MAT.paint, 0.45)
    for (const x of [x0 + 0.5, x1 - 0.4]) b.beam([x, y, z1 - 0.1], [x, y + 1.05, PZ], 0.025, '#5a6066', MAT.steel)
    for (const x of [(-OX + GLASS_X0) / 2, DOOR.x]) warm.cylinder([x, y - 0.075, PZ + 0.6], 0.07, 0.006, 16, '#000', 0, 0, true)
    b.box([DOOR.x, y - 0.1, PZ + 0.12], [0.36, 0.06, 0.1], '#16191c', MAT.paint, 0.6)
  }
  {
    // 通用口（西の面）の上の小さな庇と灯り
    const [d0, d1] = ENTRANCE.staffDoor.z
    const y = 2.55
    b.boxMinMax(-OX - 0.9, y - 0.06, d0 - 0.35, -OX, y, d1 + 0.35, METAL, MAT.paint, 0.45)
    b.boxMinMax(-OX - 0.9, y - 0.14, d0 - 0.35, -OX - 0.86, y + 0.02, d1 + 0.35, METAL, MAT.paint, 0.45)
    warm.cylinder([-OX - 0.45, y - 0.065, (d0 + d1) / 2], 0.06, 0.006, 16, '#000', 0, 0, true)
  }

  // --- 北の水冷放熱器 2 基（地図データの structure.sakuragioka.lab-radiator-1・2 の位置。ラボの北 2m。コンクリートの基礎・本体・天板のファン・壁への配管） ---
  for (const cx of [-4.2, -0.8]) {
    const cz = NO - 2.6
    const gy = naturalY(cx, cz)
    const y0 = gy + 0.12
    b.boxMinMax(cx - 1.55, gy - 0.4, cz - 0.85, cx + 1.55, y0, cz + 0.85, '#a29e96', MAT.concrete, 0)
    b.boxMinMax(cx - 1.3, y0, cz - 0.6, cx + 1.3, y0 + 1.45, cz + 0.6, '#c6cacd', MAT.paint, 0.3)
    // 側面のフィン（暗い格子）
    for (const sz of [-1, 1]) b.boxMinMax(cx - 1.2, y0 + 0.15, cz + sz * 0.6 - (sz > 0 ? 0 : 0.01), cx + 1.2, y0 + 1.3, cz + sz * 0.6 + (sz > 0 ? 0.01 : 0), '#2a2d30', MAT.grille, 0)
    for (const fx of [-0.62, 0.62]) {
      b.cylinder([cx + fx, y0 + 1.45, cz], 0.5, 0.12, 22, '#b9bdc0', MAT.paint, 0.3, false)
      b.cylinder([cx + fx, y0 + 1.5, cz], 0.46, 0.01, 22, '#202224', MAT.grille, 0, true)
    }
    // 配管（保温材の白）
    for (const dx of [-0.35, 0.35]) {
      b.beam([cx + dx, y0 + 0.5, cz + 0.6], [cx + dx, y0 + 0.5, NO - 0.05], 0.13, '#d2cec4', MAT.paint, 0.2)
    }
  }

  // --- 外から見たガラス（南のガラス壁の固定の部分と欄間、東西のハイサイドの窓） ---
  const gpos: number[] = []
  const gnrm: number[] = []
  const quad = (a: number[], b2: number[], c: number[], d: number[], n: number[]) => {
    gpos.push(...a, ...b2, ...c, ...a, ...c, ...d)
    for (let i = 0; i < 6; i++) gnrm.push(...n)
  }
  const gz = GZ + 0.012
  quad([ENTRANCE.glassDoor[1], 0, gz], [GLASS_X1, 0, gz], [GLASS_X1, CEIL, gz], [ENTRANCE.glassDoor[1], CEIL, gz], [0, 0, 1])
  quad([GLASS_X0, ENTRANCE.transoms[0], gz], [ENTRANCE.glassDoor[1], ENTRANCE.transoms[0], gz], [ENTRANCE.glassDoor[1], CEIL, gz], [GLASS_X0, CEIL, gz], [0, 0, 1])
  for (const s of [-1, 1]) {
    const x = s * (HW + 0.008)
    if (s > 0) quad([x, CL0, ROOM.south], [x, CL0, ROOM.north], [x, CL1, ROOM.north], [x, CL1, ROOM.south], [1, 0, 0])
    else quad([x, CL0, ROOM.north], [x, CL0, ROOM.south], [x, CL1, ROOM.south], [x, CL1, ROOM.north], [-1, 0, 0])
  }
  const glass = new THREE.BufferGeometry()
  glass.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3))
  glass.setAttribute('normal', new THREE.Float32BufferAttribute(gnrm, 3))

  void CON_DARK
  return { solid: b, neon, warm, glass }
}
