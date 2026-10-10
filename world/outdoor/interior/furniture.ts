import { NM } from '../named/namedMaterial'
import type { InteriorBuilder, V3 } from './builder'
import { IM } from './interiorMaterial'
import type { PictureKey } from './pictures'
import type { L2 } from './types'

/**
 * 家具と小物（中の組み立て。建物の局所の座標 s, t と部屋の床からの高さ h。yaw = 局所の向きの回転（反時計回り。0 = 正面が +t の向き…ではなく、
 * 幅が s の向き）。家具の「正面」は、yaw = 0 のとき -t の側（局所の手前）とする）。どれも障害物（通り道・カメラ）を記録する
 */

/** 局所の点を、中心 c・回転 yaw でずらす */
export function at(c: L2, yaw: number, dx: number, dy: number): L2 {
  const a = Math.cos(yaw)
  const b = Math.sin(yaw)
  return [c[0] + a * dx - b * dy, c[1] + b * dx + a * dy]
}

const WOOD = '#8a5e3c'
const DARK = '#2a2622'

/** テーブル（天板・脚 4 本）。w = 幅（yaw の向き）、d = 奥行き */
export function table(ib: InteriorBuilder, name: string, c: L2, w: number, d: number, h: number, yaw = 0, color = WOOD, top = 0.04, legColor = color) {
  ib.box(c, h - top, [w, d, top], color, NM.wood, 0, yaw)
  // 天板の縁の陰（幕板）
  ib.box(c, h - top - 0.08, [w - 0.12, d - 0.12, 0.08], ib.tint(color, 0.85), NM.wood, 0, yaw, 0.8)
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) ib.box(at(c, yaw, sx * (w / 2 - 0.06), sy * (d / 2 - 0.06)), 0, [0.055, 0.055, h - top], legColor, NM.wood, 0, yaw, 0.85)
  ib.block(name, c, w, d, 0, h, yaw, true, true)
}

/** 椅子（背もたれ付き）。正面（座る人の向き）は yaw の向きの -t…ここでは facing = 座った人が向く局所の角度 */
export function chair(ib: InteriorBuilder, c: L2, facing: number, color = WOOD, seat = 0.45, cushion: string | null = null) {
  // facing の向きに座る。背もたれは反対側
  const yaw = facing - Math.PI / 2
  const w = 0.44
  const d = 0.44
  ib.box(c, seat - 0.04, [w, d, 0.04], color, NM.wood, 0, yaw)
  if (cushion) ib.box(c, seat, [w - 0.04, d - 0.04, 0.035], cushion, IM.fabric, 0, yaw)
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) ib.box(at(c, yaw, sx * (w / 2 - 0.03), sy * (d / 2 - 0.03)), 0, [0.035, 0.035, seat - 0.04], color, NM.wood, 0, yaw, 0.85)
  // 背もたれ（座る向きの反対の端）
  const back = at(c, yaw, 0, -(d / 2 - 0.025))
  for (const sx of [-1, 1]) ib.box(at(back, yaw, sx * (w / 2 - 0.03), 0), seat, [0.035, 0.035, 0.45], color, NM.wood, 0, yaw)
  ib.box(at(back, yaw, 0, 0), seat + 0.3, [w - 0.02, 0.025, 0.14], color, NM.wood, 0, yaw)
  ib.block('椅子', c, w, d, 0, seat + 0.45, yaw, true, false)
}

/**
 * 丸い座面の椅子（背なし。カウンター・作業机）。footrest = 足をのせる輪の高さ。
 * nav = false は立ち寄り先の座る椅子: 座る前に椅子のすぐ後ろ（seat.shift 0.32〜0.35m）まで歩くので、障害物は脚の中心の小さな円（半径 0.1m）だけにする
 * （無しにすると、横から来る通り道が座面の縁をかすめ、脚が椅子にかかった。§7 の 142）
 */
export function stool(ib: InteriorBuilder, c: L2, seat: number, top = '#7a4a2c', frame = '#2a2a2a', footrest = 0, nav = true) {
  ib.cyl(c, seat - 0.045, 0.18, 0.045, top, NM.wood, 0, 20, 0.18)
  ib.cyl(c, seat - 0.05, 0.16, 0.012, ib.tint(top, 0.7), NM.wood, 0, 20)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const foot = at(c, 0, Math.cos(a) * 0.2, Math.sin(a) * 0.2)
    const head = at(c, 0, Math.cos(a) * 0.12, Math.sin(a) * 0.12)
    ib.beam([foot[0], foot[1], 0], [head[0], head[1], seat - 0.05], 0.025, frame, NM.iron, 0.4)
  }
  if (footrest > 0) {
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4
      const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4
      const r = 0.2 - (footrest / seat) * 0.08
      const p0 = at(c, 0, Math.cos(a0) * r, Math.sin(a0) * r)
      const p1 = at(c, 0, Math.cos(a1) * r, Math.sin(a1) * r)
      ib.beam([p0[0], p0[1], footrest], [p1[0], p1[1], footrest], 0.018, frame, NM.iron, 0.5)
    }
  }
  ib.disc(nav ? '丸椅子' : '座る丸椅子', c, nav ? 0.2 : 0.1, 0, seat, true, false)
}

/** ソファ（布）。正面は yaw の向きの -t（手前）。w = 幅、d = 奥行き */
export function sofa(ib: InteriorBuilder, c: L2, w: number, d: number, yaw: number, color: string, pattern = 0, legs = '#3a2a1e') {
  const arm = 0.16
  const seatH = 0.42
  ib.box(c, 0.06, [w, d, 0.22], ib.tint(color, 0.85), IM.fabric, pattern, yaw, 0.8)
  // 座面のクッション（2〜3 つ）
  const n = w > 1.7 ? 3 : 2
  const cw = (w - arm * 2) / n
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + arm + cw * (i + 0.5)
    ib.box(at(c, yaw, x, -0.05), 0.28, [cw - 0.02, d - 0.24, 0.14], color, IM.fabric, pattern, yaw)
    // 背のクッション
    ib.box(at(c, yaw, x, d / 2 - 0.14), seatH, [cw - 0.03, 0.2, 0.36], color, IM.fabric, pattern, yaw)
  }
  // 背と肘
  ib.box(at(c, yaw, 0, d / 2 - 0.05), 0.06, [w, 0.1, 0.78], ib.tint(color, 0.9), IM.fabric, pattern, yaw, 0.9)
  for (const sx of [-1, 1]) ib.box(at(c, yaw, sx * (w / 2 - arm / 2), 0), 0.06, [arm, d, 0.6], ib.tint(color, 0.95), IM.fabric, pattern, yaw)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) ib.box(at(c, yaw, sx * (w / 2 - 0.06), sy * (d / 2 - 0.06)), 0, [0.05, 0.05, 0.06], legs, NM.wood, 0, yaw, 0.7)
  ib.block('ソファ', c, w, d, 0, 0.84, yaw, true, true)
}

/** クッション（小さな布の箱） */
export function cushion(ib: InteriorBuilder, c: L2, h: number, yaw: number, color: string, size = 0.4) {
  ib.box(c, h, [size, 0.12, size * 0.9], color, IM.fabric, 0, yaw + 0.1)
}

/** 本棚（棚板の段ごとに本の列）。正面は -t（yaw = 0 のとき）。rows = 段の数、fill = 本の詰まり具合 */
export function bookshelf(ib: InteriorBuilder, name: string, c: L2, w: number, d: number, h: number, yaw: number, color = WOOD, rows = 5, fill = 0.85, seed = 1, back: string | null = null) {
  const t = 0.025
  // 側板・天板・底板・背板
  for (const sx of [-1, 1]) ib.box(at(c, yaw, sx * (w / 2 - t / 2), 0), 0, [t, d, h], color, NM.wood, 0, yaw)
  ib.box(c, h - t, [w, d, t], color, NM.wood, 0, yaw)
  ib.box(c, 0, [w, d, 0.08], ib.tint(color, 0.85), NM.wood, 0, yaw, 0.8)
  ib.box(at(c, yaw, 0, d / 2 - 0.006), 0, [w - t, 0.012, h], back ?? ib.tint(color, 0.7), NM.wood, 0, yaw, 0.7)
  const rowH = (h - 0.08 - t) / rows
  for (let i = 0; i < rows; i++) {
    const y = 0.08 + i * rowH
    if (i > 0) ib.box(c, y - t / 2, [w - 2 * t, d - 0.01, t], color, NM.wood, 0, yaw)
    // 本の列（棚の幅の fill だけ。端に横倒しの本や小物の分を空ける）
    const bh = rowH * (0.72 + 0.18 * ((seed * (i + 3)) % 7) / 7)
    const span = (w - 2 * t) * fill
    const off = ((i % 2 ? 1 : -1) * (w - 2 * t - span)) / 2
    ib.box(at(c, yaw, off, 0.02), y + t / 2, [span, d - 0.08, bh], '#806040', IM.books, seed + i * 0.37, yaw, 0.85)
  }
  ib.block(name, c, w, d, 0, h, yaw)
}

/** 引き出しの箪笥・キャビネット（取っ手の付いた引き出しの段） */
export function cabinet(ib: InteriorBuilder, name: string, c: L2, w: number, d: number, h: number, yaw: number, color: string, drawers = 3, mat: number = NM.paint, handle = '#c9b98a', cols = 1) {
  ib.box(c, 0.04, [w, d, h - 0.04], color, mat, 0.3, yaw)
  ib.box(c, 0, [w - 0.04, d - 0.04, 0.04], ib.tint(color, 0.5), mat, 0, yaw, 0.6)
  const dh = (h - 0.08) / drawers
  for (let j = 0; j < cols; j++)
    for (let i = 0; i < drawers; i++) {
      const cw = w / cols
      const x = -w / 2 + cw * (j + 0.5)
      const front = at(c, yaw, x, -d / 2 - 0.004)
      ib.box(front, 0.06 + i * dh, [cw - 0.02, 0.01, dh - 0.02], ib.tint(color, 1.04), mat, 0.3, yaw)
      ib.box(at(front, yaw, 0, -0.012), 0.06 + i * dh + dh * 0.55, [Math.min(0.12, cw * 0.4), 0.018, 0.018], handle, NM.gold, 0, yaw)
    }
  ib.block(name, c, w, d, 0, h, yaw)
}

/** ベッド（枠・マットレス・掛け布団・枕） */
export function bed(ib: InteriorBuilder, c: L2, w: number, len: number, yaw: number, frame: string, sheet: string, cover: string, pillows = 2) {
  // len の向き = yaw の向き。枕は +（yaw の向きの先）の端
  ib.box(c, 0.08, [len, w, 0.22], frame, NM.wood, 0, yaw, 0.85)
  ib.box(c, 0.3, [len - 0.06, w - 0.06, 0.18], sheet, IM.bedding, 0, yaw)
  ib.box(at(c, yaw, -0.18, 0), 0.47, [len - 0.42, w - 0.02, 0.07], cover, IM.bedding, 0, yaw)
  // 頭板
  ib.box(at(c, yaw, len / 2 + 0.03, 0), 0, [0.06, w + 0.04, 0.95], frame, NM.wood, 0, yaw)
  for (let i = 0; i < pillows; i++) {
    const y = pillows === 1 ? 0 : (i - (pillows - 1) / 2) * (w / pillows)
    ib.box(at(c, yaw, len / 2 - 0.28, y), 0.47, [0.36, Math.min(0.6, w / pillows - 0.06), 0.13], '#f4f2ec', IM.bedding, 0, yaw)
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) ib.box(at(c, yaw, sx * (len / 2 - 0.05), sy * (w / 2 - 0.05)), 0, [0.06, 0.06, 0.08], frame, NM.wood, 0, yaw)
  ib.block('ベッド', c, len, w, 0, 0.56, yaw)
}

/** 敷物 */
export function rug(ib: InteriorBuilder, c: L2, w: number, d: number, yaw: number, color: string, pattern = 0) {
  ib.box(c, 0.0, [w, d, 0.012], color, IM.rug, pattern, yaw, 0.95)
}

/** 鉢植え（鉢と、葉のかたまり） */
export function plant(ib: InteriorBuilder, c: L2, h0: number, size: number, pot = '#b8653a', leaf = '#3f6e34', tall = 1) {
  ib.cyl(c, h0, size * 0.42, size * 0.7, pot, NM.plaster, 0, 14, size * 0.5)
  ib.cyl(c, h0 + size * 0.7, size * 0.48, 0.03, '#3a2a1a', NM.soil, 0, 14)
  const n = 5
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + ib.rnd()
    const r = size * 0.32
    const p = at(c, 0, Math.cos(a) * r, Math.sin(a) * r)
    ib.box(p, h0 + size * 0.7 + size * 0.2 * tall * ib.rnd(), [size * 0.55, size * 0.5, size * 0.75 * tall], ib.tint(leaf, 0.85 + 0.3 * ib.rnd()), NM.leaf, 0, a)
  }
  ib.box(c, h0 + size * 0.75, [size * 0.7, size * 0.7, size * 0.95 * tall], leaf, NM.leaf, 0, ib.rnd() * 3)
  if (h0 < 0.05) ib.disc('鉢植え', c, size * 0.48, 0, size * 1.6 * tall, true, false)
  // 葉のかたまり（大きな鉢だけ）はカメラが避け、見通しもさえぎる（追うカメラが葉の中を通り、画面をふさいでいた。§7 の 148）
  if (size >= 0.35) ib.disc('鉢植えの葉', c, size * 0.55, h0 + size * 0.7, h0 + size * (0.75 + 0.95 * tall), false, true)
}

/** フロアスタンド（傘は光る。lamp = 灯りの番号） */
export function floorLamp(ib: InteriorBuilder, c: L2, h: number, lamp: number, shade = '#f0e2c4', color = '#1f1f1f') {
  ib.cyl(c, 0, 0.16, 0.025, color, IM.steelBlack, 0, 16)
  ib.tube([c[0], c[1], 0.02], [c[0], c[1], h - 0.2], 0.012, color, IM.steelBlack, 0)
  ib.glowCyl(c, h - 0.32, 0.2, 0.3, shade, lamp, 2.2, 0.13)
  ib.disc('フロアスタンド', c, 0.18, 0, h, true, false)
  // 傘（幅 0.4m）はカメラが避け、見通しもさえぎる（追うカメラの前で傘が画面の上をふさいでいた。§7 の 148）
  ib.disc('フロアスタンドの傘', c, 0.22, h - 0.36, h + 0.02, false, true)
}

/** 吊り下げの灯り（コードと傘と電球）。h = 傘の下端の高さ、ceil = 天井の高さ（どちらも床から） */
export function pendant(ib: InteriorBuilder, c: L2, h: number, ceil: number, lamp: number, shade = '#2b2b2b', kind: 'cone' | 'bulb' | 'dome' = 'cone') {
  ib.tube([c[0], c[1], h + 0.12], [c[0], c[1], ceil], 0.004, '#1a1a1a', NM.iron, 0, 6)
  ib.cyl(c, ceil - 0.02, 0.05, 0.02, '#1a1a1a', NM.iron, 0, 12)
  if (kind === 'bulb') {
    ib.cyl(c, h + 0.1, 0.018, 0.04, '#7a6a4a', NM.gold, 0, 10)
    ib.glowBulb(c, h + 0.05, 0.045, '#ffcf8a', lamp, 7)
    return
  }
  if (kind === 'dome') {
    ib.lathe(c, h, [
      [0.2, 0],
      [0.19, 0.05],
      [0.14, 0.11],
      [0.05, 0.14],
      [0.02, 0.15],
    ], 18, shade, NM.paint, 0.5)
    ib.glowCyl(c, h + 0.02, 0.15, 0.01, '#fff1d6', lamp, 4)
    return
  }
  ib.cyl(c, h, 0.17, 0.2, shade, NM.paint, 0.5, 18, 0.05)
  ib.glowCyl(c, h - 0.005, 0.15, 0.01, '#fff1d6', lamp, 4)
}

/** 天井の照明（円い乳白の板） */
export function ceilingLight(ib: InteriorBuilder, c: L2, ceil: number, lamp: number, r = 0.25) {
  ib.cyl(c, ceil - 0.025, r + 0.02, 0.025, '#e8e6e0', NM.paint, 0.5, 20)
  ib.glowCyl(c, ceil - 0.06, r, 0.04, '#fff6e8', lamp, 2.4)
}

/** モニタ（台・首・画面の絵）。facing = 画面の表の向き（局所の角度）。h = 机の高さ */
export function monitor(ib: InteriorBuilder, c: L2, h: number, facing: number, w: number, key: PictureKey, lamp = -1) {
  const yaw = facing - Math.PI / 2
  ib.box(c, h, [0.22, 0.18, 0.015], '#1c1c1e', NM.paint, 0.5, yaw)
  const back = at(c, yaw, 0, 0.04)
  ib.box(back, h, [0.04, 0.03, 0.18], '#1c1c1e', NM.paint, 0.5, yaw)
  const ht = w * 0.58
  const sc = at(c, yaw, 0, 0.01)
  ib.box(sc, h + 0.14, [w + 0.02, 0.03, ht + 0.02], '#141416', IM.screen, 0, yaw)
  ib.picture(key, at(sc, yaw, 0, -0.016), h + 0.15 + ht / 2, w - 0.02, ht - 0.02, facing, 1, 0)
  void lamp
}

/** キーボード */
export function keyboard(ib: InteriorBuilder, c: L2, h: number, yaw: number, color = '#2a2a2c') {
  ib.box(c, h, [0.42, 0.14, 0.022], color, IM.plastic, 0.3, yaw)
  ib.box(c, h + 0.022, [0.39, 0.115, 0.006], '#3a3a3e', IM.plastic, 0.2, yaw)
}

/** マグカップ */
export function mug(ib: InteriorBuilder, c: L2, h: number, color = '#f0ece2') {
  ib.cyl(c, h, 0.04, 0.09, color, IM.ceramic, 0, 12)
  ib.cyl(c, h + 0.08, 0.034, 0.008, '#3a2416', NM.wood, 0, 12)
}

/** 本の山（横倒し） */
export function bookStack(ib: InteriorBuilder, c: L2, h: number, yaw: number, n: number) {
  const cols = ['#7a2a22', '#24365a', '#d8cfb8', '#2f4a32', '#a8742a']
  let y = h
  for (let i = 0; i < n; i++) {
    const th = 0.025 + 0.015 * ib.rnd()
    ib.box(at(c, yaw, (ib.rnd() - 0.5) * 0.03, 0), y, [0.24 - ib.rnd() * 0.05, 0.17, th], cols[i % cols.length], NM.paint, 0.2, yaw + (ib.rnd() - 0.5) * 0.3)
    y += th
  }
}

/** 額（枠と絵）。facing = 表の向き */
export function frame(ib: InteriorBuilder, key: PictureKey, c: L2, h: number, w: number, ht: number, facing: number, color = '#2a2420', mode = 0) {
  const nx = Math.cos(facing)
  const ny = Math.sin(facing)
  const yaw = facing - Math.PI / 2
  ib.box([c[0] + nx * 0.012, c[1] + ny * 0.012], h - ht / 2 - 0.03, [w + 0.06, 0.024, ht + 0.06], color, NM.wood, 0, yaw, 0.9)
  ib.picture(key, c, h, w, ht, facing, mode, 0.026)
}

/** 段ボール箱（屋根裏・ガレージ） */
export function box(ib: InteriorBuilder, c: L2, h0: number, size: V3, yaw: number, color = '#b08a5a') {
  ib.box(c, h0, size, color, IM.cardboard, ib.rnd(), yaw)
}

/** 植物の葉のかたまり（つる・小さな鉢） */
export function smallPlant(ib: InteriorBuilder, c: L2, h: number, size = 0.18) {
  ib.cyl(c, h, size * 0.45, size * 0.6, '#d8d0c0', IM.ceramic, 0, 10, size * 0.55)
  ib.box(c, h + size * 0.55, [size * 1.1, size * 1.1, size * 0.9], '#4a7a3a', NM.leaf, 0, ib.rnd() * 3)
}

/** 机の上の小さな電気スタンド（光る頭） */
export function deskLamp(ib: InteriorBuilder, c: L2, h: number, facing: number, lamp: number, color = '#1f1f1f') {
  const yaw = facing - Math.PI / 2
  ib.cyl(c, h, 0.07, 0.02, color, IM.steelBlack, 0, 14)
  const elbow = at(c, yaw, 0, 0.05)
  ib.beam([c[0], c[1], h + 0.02], [elbow[0], elbow[1], h + 0.36], 0.014, color, IM.steelBlack)
  const head = at(c, yaw, 0, -0.18)
  ib.beam([elbow[0], elbow[1], h + 0.36], [head[0], head[1], h + 0.38], 0.014, color, IM.steelBlack)
  ib.cyl(head, h + 0.31, 0.07, 0.08, color, IM.steelBlack, 0, 14, 0.035)
  ib.glowCyl(head, h + 0.305, 0.06, 0.008, '#fff3dc', lamp, 5)
}

/** 有孔ボードと工具（ドライバー・ペンチ・スパナの影の形）。facing = 表の向き。w × ht、h0 = 下端 */
export function pegboard(ib: InteriorBuilder, c: L2, h0: number, w: number, ht: number, facing: number, color = '#c7a982', tools = true) {
  const yaw = facing - Math.PI / 2
  ib.box(at(c, yaw, 0, 0.008), h0, [w, 0.016, ht], color, NM.lattice, 0.025, yaw, 0.9)
  if (!tools) return
  const toolCols = ['#c0392b', '#1f5f9a', '#2a2a2a', '#d4a020', '#8a8e94', '#2f7a4a']
  const n = Math.floor(w / 0.09)
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.06 + i * 0.09 + (ib.rnd() - 0.5) * 0.02
    const p = at(c, yaw, x, -0.012)
    const row = i % 3
    const len = 0.14 + ib.rnd() * 0.12
    const y = h0 + ht - 0.08 - row * (ht / 3) - len
    const col = toolCols[Math.floor(ib.rnd() * toolCols.length)]
    // 柄と先
    ib.box(p, y + len * 0.55, [0.028, 0.025, len * 0.45], col, IM.plastic, 0.3, yaw)
    ib.box(p, y, [0.012, 0.012, len * 0.55], '#a8acb2', NM.steel, 0, yaw)
  }
}

/** 窓のカーテン（左右に寄せた布）。facing = 部屋の内向き。s0〜s1 = 窓の幅、h1 = 上端 */
export function curtains(ib: InteriorBuilder, a: L2, b: L2, h0: number, h1: number, color: string, open = 0.75) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L = Math.hypot(dx, dy)
  const yaw = Math.atan2(dy, dx)
  // レール
  ib.beam([a[0], a[1], h1 + 0.04], [b[0], b[1], h1 + 0.04], 0.025, '#d8d4cc', NM.paint, 0.4)
  const w = (L / 2) * (1 - open) + 0.18
  for (const side of [0, 1]) {
    const cx = side === 0 ? w / 2 : L - w / 2
    const c: L2 = [a[0] + (dx / L) * cx, a[1] + (dy / L) * cx]
    const folds = Math.max(3, Math.round(w / 0.07))
    for (let i = 0; i < folds; i++) {
      const x = -w / 2 + (i + 0.5) * (w / folds)
      ib.box(at(c, yaw, x, (i % 2) * 0.02), h0, [w / folds + 0.012, 0.03, h1 - h0], ib.tint(color, i % 2 ? 0.88 : 1), IM.fabric, 0, yaw)
    }
  }
}

export { DARK, WOOD }
