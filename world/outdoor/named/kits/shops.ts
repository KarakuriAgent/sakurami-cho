import { Frame } from '../frame'
import { awning, canopy, fbox, type GlassSpec, type Kit, lantern, type Opening, pilaster, spansExcept, steps, wallLamp } from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import type { NamedRecord } from '../namedData'
import { STAIRS } from '../grade'
import { banner, barrel, bladeSign, hangingRound, latticeSlats, noren, penRoof, pot } from '../parts'
import { cssOf, doorsOnEdge, frontEdgeOf, hexesIn, stepsFor } from '../shell'
import { signAtlas, type SignStyle } from '../signs'
import { generic, hirakiFuda, isOpenLab, signText } from './common'

/**
 * 店の組み立ての型: 町家の店（灯町の焦げ茶の板と漆喰・楓坂の白い板張り）、小野寺時計店、星図珈琲、煉瓦の洋風の店（停車場通・港・学園）、
 * 石と漆喰の店（運河・文庫町）、旧商館、島の石の家、銭湯、茶屋
 */

/** 正面の面（外から見て左が s = 0）と長さ、主な入口の位置 */
export function frontFace(rec: NamedRecord) {
  const ring = rec.ring
  const edge = frontEdgeOf(ring, rec.front)
  const p = ring[edge]
  const q = ring[(edge + 1) % ring.length]
  const f = Frame.edge(p, q, rec.z)
  const L = Math.hypot(q[0] - p[0], q[1] - p[1])
  const ds = doorsOnEdge(rec, p, q, rec.z, 4)
  const main = ds.find((d) => d.e.kind === 'main') ?? ds[0]
  return { f, L, edge, doorS: main ? main.s : L / 2, doorIndex: main?.index ?? 0, ground: main ? main.e.ground : rec.z }
}

/** 店の種類から看板の絵 */
function iconOf(rec: NamedRecord): SignStyle['icon'] {
  const k = `${rec.kind ?? ''}${rec.name}`
  if (k.includes('喫茶') || k.includes('カフェ') || k.includes('珈琲')) return 'cup'
  if (k.includes('パン') || k.includes('ベーカリー')) return 'bread'
  if (k.includes('時計')) return 'clock'
  if (k.includes('郵便')) return 'post'
  if (k.includes('花')) return 'leaf'
  if (k.includes('船') || k.includes('マリン')) return 'anchor'
  if (k.includes('ラボ') || k.includes('研究')) return 'flask'
  return null
}

/** 食べ物・飲み物の店か（暖簾・提灯） */
function isEatery(rec: NamedRecord) {
  const k = rec.kind ?? ''
  return /居酒屋|小料理|焼き鳥|食堂|定食|バー/.test(k)
}

/* -------------------------------------------------------------------------- */
/* 町家の店                                                                     */
/* -------------------------------------------------------------------------- */

export interface MachiyaOpts {
  /** 灯町（焦げ茶の板と漆喰・茶色の瓦）か、楓坂（白い板張り・黒瓦） */
  look: 'akari' | 'kaede'
  sign?: Omit<SignStyle, 'w' | 'h'> | null
  blade?: Omit<SignStyle, 'w' | 'h'> | null
  round?: Omit<SignStyle, 'w' | 'h'> | null
  noren?: Omit<SignStyle, 'w' | 'h'> | null
  lanterns?: string | null
  /** 1 階の店先の扉（引き戸のガラス・格子戸） */
  door?: 'sliding' | 'lattice' | 'glass'
  glass?: GlassSpec
  awning?: { color: string; stripes?: number } | null
  /** 店の前の物（植木鉢・樽・野菜の台） */
  front?: ('pots' | 'barrel' | 'produce' | 'bench' | 'post')[]
}

export function machiya(k: Kit, o: MachiyaOpts) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const hexes = hexesIn(rec.wallText)
  const akari = o.look === 'akari'
  const dark = akari ? (hexes.find((h) => h === '#5b4033') ?? '#5b4033') : '#4a3a2c'
  const light = akari ? (hexes.find((h) => h !== '#5b4033') ?? '#e9e1cf') : (hexes[0] ?? '#f2efe8')
  const eave = Math.max(5.6, rec.height ?? 6.2)
  const floors = Math.max(1, rec.floors ?? 2)
  const groundH = floors > 1 ? 3.2 : eave
  const doorW = Math.min(1.8, L * 0.32)
  const ds = Math.min(L - doorW / 2 - 0.4, Math.max(doorW / 2 + 0.4, ff.doorS))
  const glass: GlassSpec = o.glass ?? { kind: isEatery(rec) || /喫茶|カフェ/.test(rec.kind ?? '') ? GLASS.cafe : GLASS.shop, cls: LIGHT_CLASS.shop, cols: 2, rows: 2, bar: 0.03, frame: '#3a2a1e', depth: 5 }
  // 1 階の正面: 扉（引き戸）と、左右の窓
  const openings: Opening[] = []
  const door: Opening = { s: ds - doorW / 2, h: 0, w: doorW, ht: 2.3, depth: 0.2, fill: 'door', door: { kind: o.door === 'lattice' ? 'lattice' : o.door === 'glass' ? 'glass' : 'sliding', color: akari ? '#3a2a1e' : '#5a4632', glass } }
  openings.push(door)
  const winL: Opening = { s: 0.45, h: 0.75, w: ds - doorW / 2 - 0.75, ht: 1.65, depth: 0.16, glass }
  const winR: Opening = { s: ds + doorW / 2 + 0.3, h: 0.75, w: L - 0.45 - (ds + doorW / 2 + 0.3), ht: 1.65, depth: 0.16, glass }
  const sideWins = [winL, winR].filter((w) => w.w > 0.6)
  openings.push(...sideWins)
  const g = generic(k, {
    floors,
    groundH,
    eave,
    wall: akari ? { color: light, mat: NM.plaster } : { color: light, mat: NM.siding, aux: 0.21 },
    wallLower: akari ? { color: dark, mat: NM.boardV, aux: 0.2, h: groundH } : undefined,
    frontGround: 'none',
    frontOpenings: openings,
    noFrontDoor: true,
    win: { w: 1.3, ht: 1.05, sill: 0.8, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: akari ? 4 : 2, rows: akari ? 1 : 2, bar: 0.03, frame: akari ? '#3a2a1e' : '#f4f2ec' }, depth: 0.12, sillTrim: akari ? null : { color: '#f4f2ec', mat: NM.paint } },
    groundWin: { w: 1.0, ht: 1.1, sill: 0.9, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 1, bar: 0.03, frame: '#3a2a1e' } },
    roof: { eave: 0.75, verge: 0.4, soffit: '#3b3027', fascia: '#2e261f', gutter: akari ? '#4a4038' : '#8a8a86' },
    sign: null,
  })
  const b = k.solid
  // 1 階の窓の前の格子（灯町）か、白い窓枠と腰板（楓坂）
  for (const w of sideWins) {
    if (akari) latticeSlats(k, f, w.s, w.s + w.w, w.h, w.h + w.ht, 0.02, '#3a2a1e', 0.11, 0.035)
    else fbox(b, f, w.s - 0.08, w.s + w.w + 0.08, -0.08, 0.02, w.h - 0.1, w.h, '#f4f2ec', NM.paint, 0.4)
  }
  // 2 階の窓の前の格子（灯町の虫籠のかわり）
  if (akari && floors > 1) {
    for (const o2 of g.body[ff.edge].openings) if (o2.h > groundH) latticeSlats(k, f, o2.s, o2.s + o2.w, o2.h, o2.h + o2.ht, 0.02, '#3a2a1e', 0.13, 0.03)
  }
  // 下屋の庇
  if (floors > 1) penRoof(k, f, -0.2, L + 0.2, groundH + 0.2, 0.9, g.roof.color, g.roof.mat, 0.42, g.roof.aux ?? 0)
  else canopy(k, f, 0.2, L - 0.2, 2.75, 0.8, '#3b3027', NM.wood, 0.1)
  // 看板（下屋の上に立つ板）
  const st = signText(rec)
  const sign = o.sign === undefined ? { text: st.main, sub: st.sub, fg: akari ? '#f3e6c8' : '#2a211a', bg: akari ? '#2a1f17' : '#efe7d6', border: akari ? '#a8874a' : '#6a5440', font: 'serif' as const, finish: 'wood' as const, icon: iconOf(rec) } : o.sign
  if (sign && floors > 1) {
    const sw = Math.min(L * 0.62, 3.6)
    k.sign(f, L / 2 - sw / 2, groundH + 0.12, sw, 0.62, -0.62, sign, 2)
    fbox(b, f, L / 2 - sw / 2 - 0.05, L / 2 + sw / 2 + 0.05, -0.6, -0.56, groundH + 0.08, groundH + 0.78, '#2a1f17', NM.wood)
  } else if (sign) {
    const sw = Math.min(L * 0.7, 3.2)
    k.sign(f, L / 2 - sw / 2, 2.85, sw, 0.5, -0.82, sign, 2)
  }
  if (o.blade) bladeSign(k, f, L - 0.35, groundH + 0.6, 0.55, 1.6, o.blade)
  if (o.round) hangingRound(k, f, Math.min(L - 0.5, ds + doorW / 2 + 0.6), 2.55, 0.6, o.round)
  // 暖簾・提灯
  if (o.noren) noren(k, f, door.s + 0.05, door.s + door.w - 0.05, 2.28, 0.75, o.noren)
  if (o.lanterns) {
    lantern(k, f, door.s - 0.3, 2.0, o.lanterns)
    lantern(k, f, door.s + door.w + 0.3, 2.0, o.lanterns, 0.18, 0.45, false)
  } else wallLamp(k, f, door.s + door.w + 0.35, 2.25, akari ? 'lantern' : 'bulb')
  if (o.awning) awning(k, f, 0.3, L - 0.3, 2.65, 1.0, 0.22, o.awning.color, o.awning.stripes ?? 0)
  // 入口の石段（地面が低いとき）
  const n = stepsFor(rec.z, ff.ground)
  if (n > 0) steps(k, f, door.s - 0.2, door.s + door.w + 0.2, n, 0.16, 0.3, '#8f8a80')
  else fbox(b, f, door.s - 0.1, door.s + door.w + 0.1, -0.35, 0.05, -0.3, 0.06, '#8f8a80', NM.granite)
  // 店の前の物
  for (const it of o.front ?? ['pots']) {
    if (it === 'pots') {
      pot(k, f, 0.35, -0.35, 0, 0.42)
      pot(k, f, L - 0.35, -0.35, 0, 0.36, '#6d5a4a')
    } else if (it === 'barrel') barrel(k, f, Math.max(0.4, door.s - 0.7), -0.45, 0)
    else if (it === 'produce') {
      // 野菜の台（斜めの台に色の箱）
      for (let i = 0; i < 3; i++) {
        const s0 = 0.4 + i * ((L - 0.8) / 3)
        const s1 = s0 + (L - 0.8) / 3 - 0.1
        if (s1 > door.s - 0.1 && s0 < door.s + door.w + 0.1) continue
        fbox(b, f, s0, s1, -1.1, -0.2, 0, 0.75, '#6b4a2e', NM.wood)
        const cols = ['#c0392b', '#e67e22', '#4f8a2f', '#f1c40f', '#7d3c98']
        for (let j = 0; j < 4; j++) {
          const a = s0 + 0.05 + (j / 4) * (s1 - s0)
          fbox(b, f, a, a + (s1 - s0) / 4 - 0.08, -1.05, -0.3, 0.75, 0.92, cols[(i * 4 + j) % cols.length], NM.leaf)
        }
      }
    } else if (it === 'bench') {
      fbox(b, f, L - 1.9, L - 0.5, -0.9, -0.5, 0.42, 0.47, '#7a5a3a', NM.wood)
      for (const s of [L - 1.8, L - 0.6]) fbox(b, f, s - 0.04, s + 0.04, -0.85, -0.55, 0, 0.42, '#3a2a1e', NM.wood)
    } else if (it === 'post') {
      // 郵便ポスト（赤い円筒）
      const p = f.p(L - 0.6, -0.8, 0)
      b.cylinder(p, 0.22, 1.25, 14, '#c0281f', NM.paint, 0.6, true)
      b.cylinder([p[0], p[1] + 1.25, p[2]], 0.24, 0.08, 14, '#a8221a', NM.paint, 0.6, true)
    }
  }
  if (isOpenLab(rec)) hirakiFuda(k, f, door.s + door.w + 0.25, 1.35, rec)
  return { g, f, L, door }
}

/* -------------------------------------------------------------------------- */
/* 小野寺時計店                                                                  */
/* -------------------------------------------------------------------------- */

/** 深緑の木の店構え・金の縁取りのショーウィンドウ（時計がぎっしり）・歯車の吊り看板・蔦・鉢植えと樽・店先の石段 */
export function onodera(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const green = '#2f5d46'
  const gold = '#c9a046'
  const groundH = 3.3
  const doorW = 1.0
  const ds = Math.min(L - 0.9, Math.max(L * 0.72, ff.doorS))
  const show: Opening = { s: 0.5, h: 0.75, w: ds - doorW / 2 - 0.9, ht: 1.85, depth: 0.12, glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, cols: 3, rows: 3, bar: 0.025, frame: green, depth: 3.2 } }
  const door: Opening = { s: ds - doorW / 2, h: 0, w: doorW, ht: 2.35, depth: 0.16, fill: 'door', door: { kind: 'glass', color: green, transom: 0.35, glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, cols: 1, rows: 3, bar: 0.03, frame: green } } }
  const g = generic(k, {
    floors: 2,
    groundH,
    wall: { color: '#d9cfbb', mat: NM.plaster },
    wallLower: { color: green, mat: NM.paint, aux: 0.35, h: groundH },
    frontGround: 'none',
    frontOpenings: [show, door],
    noFrontDoor: true,
    win: { w: 1.1, ht: 1.25, sill: 0.75, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 3, bar: 0.03, frame: '#f1ede2' }, depth: 0.14, sillTrim: { color: '#efe8d8', mat: NM.paint }, shutters: '#2f5d46' },
    roof: { eave: 0.65, soffit: '#3d3229', fascia: '#2f2620', gutter: '#3a3a36' },
    sign: null,
  })
  const b = k.solid
  // 店構え: 金の縁取り（ショーウィンドウの額）・付け柱・幕板・腰板
  fbox(b, f, show.s - 0.1, show.s + show.w + 0.1, -0.1, 0.02, show.h - 0.1, show.h, gold, NM.gold)
  fbox(b, f, show.s - 0.1, show.s + show.w + 0.1, -0.1, 0.02, show.h + show.ht, show.h + show.ht + 0.08, gold, NM.gold)
  for (const s of [show.s - 0.1, show.s + show.w]) fbox(b, f, s, s + 0.1, -0.1, 0.02, show.h, show.h + show.ht, gold, NM.gold)
  for (const [s0, s1] of spansExcept(0.25, L - 0.25, [[door.s, door.s + door.w]])) fbox(b, f, s0, s1, -0.1, 0.02, 0, show.h - 0.1, '#264c39', NM.paint, 0.4)
  for (const s of [0.25, door.s - 0.2, door.s + door.w + 0.05, L - 0.4]) pilaster(k, f, s + 0.075, 0.18, 0, groundH - 0.1, 0.13, green, NM.paint, 0.5)
  // 幕板（店名）と、その上の小さな蛇腹
  fbox(b, f, 0.15, L - 0.15, -0.16, 0.02, groundH - 0.75, groundH - 0.1, green, NM.paint, 0.5)
  fbox(b, f, 0.05, L - 0.05, -0.24, 0.02, groundH - 0.1, groundH + 0.02, '#244a37', NM.paint, 0.5)
  k.sign(f, 0.5, groundH - 0.68, L - 1.0, 0.5, -0.165, { text: '小野寺時計店', sub: 'ONODERA  WATCH & CLOCK  since 1931', fg: '#e3c46c', bg: '#2a5440', font: 'serif', bold: true }, 2)
  // 歯車の吊り看板（木）と、壁の掛け時計
  hangingRound(k, f, 0.45, groundH + 0.25, 0.8, { text: '', fg: '#3a2a1a', bg: '#b68a55', border: '#5a3e24', icon: 'gear', finish: 'wood' }, 2)
  const clockC = f.p(door.s + door.w + 0.42, -0.2, groundH - 1.15)
  b.beam(f.p(door.s + door.w + 0.42, 0.02, groundH - 0.75), f.p(door.s + door.w + 0.42, -0.2, groundH - 0.75), 0.04, '#1e1e1e', NM.iron)
  b.cylinder([clockC[0], clockC[1] - 0.02, clockC[2]], 0.24, 0.04, 20, gold, NM.gold, 0, true)
  k.clocks.push({ center: f.p(door.s + door.w + 0.42, -0.23, groundH - 1.15), out: f.out, radius: 0.2 })
  const r = signAtlasClock()
  if (r) k.signs.quad(f.p(door.s + door.w + 0.22, -0.225, groundH - 1.35), f.p(door.s + door.w + 0.62, -0.225, groundH - 1.35), f.p(door.s + door.w + 0.62, -0.225, groundH - 0.95), f.p(door.s + door.w + 0.22, -0.225, groundH - 0.95), r, 3)
  // 蔦（壁の左の上の方に、葉のかたまり）
  for (let i = 0; i < 9; i++) {
    const s = 0.1 + k.rnd() * 1.2
    const h = groundH - 0.2 + k.rnd() * 3.2
    fbox(b, f, s, s + 0.5 + k.rnd() * 0.6, -0.12, 0.0, h, h + 0.4 + k.rnd() * 0.7, '#3f6430', NM.leaf)
  }
  // 店先の石段・鉢植え・樽・灯り
  fbox(b, f, door.s - 0.4, door.s + door.w + 0.4, -0.5, 0.05, -0.4, 0.14, '#8d877c', NM.granite)
  const n = stepsFor(rec.z, ff.ground)
  if (n > 0) steps(k, f, door.s - 0.3, door.s + door.w + 0.3, n, 0.15, 0.3, '#8d877c')
  pot(k, f, show.s + 0.3, -0.45, 0, 0.5)
  pot(k, f, show.s + 0.9, -0.4, 0, 0.36, '#6d5a4a', '#5a7f3a')
  barrel(k, f, L - 0.35, -0.5, 0)
  wallLamp(k, f, door.s - 0.25, 2.55, 'lantern')
  void g
  void canopy
}

function signAtlasClock() {
  return signAtlas.clockRegion(256)
}

/* -------------------------------------------------------------------------- */
/* 星図珈琲                                                                      */
/* -------------------------------------------------------------------------- */

/** 古い赤煉瓦の平屋・木の格子戸と大きなガラス窓・扉の上の星の看板ランプ（夜に路地の奥で光る） */
export function seizu(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const eave = rec.height ?? 3.6
  const doorW = 0.95
  const ds = Math.min(L - doorW / 2 - 0.35, Math.max(doorW / 2 + 0.35, ff.doorS))
  const big: Opening = { s: 0.4, h: 0.55, w: ds - doorW / 2 - 0.75, ht: 2.0, depth: 0.22, glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.shop, cols: 3, rows: 2, bar: 0.035, frame: '#3a2618', depth: 6, yC: 2.6 } }
  const door: Opening = { s: ds - doorW / 2, h: 0, w: doorW, ht: 2.25, depth: 0.22, fill: 'door', door: { kind: 'lattice', color: '#4a3020', operable: ff.doorIndex, glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.shop } } }
  const opens = [door]
  if (big.w > 0.6) opens.push(big)
  const right: Opening = { s: ds + doorW / 2 + 0.3, h: 0.55, w: L - 0.35 - (ds + doorW / 2 + 0.3), ht: 2.0, depth: 0.22, glass: big.glass }
  if (right.w > 0.6) opens.push(right)
  const g = generic(k, {
    floors: 1,
    eave,
    wall: { color: '#8e4a36', mat: NM.brick },
    frontGround: 'none',
    frontOpenings: opens,
    noFrontDoor: true,
    win: { w: 0.9, ht: 1.3, sill: 0.95, shape: 'segment', glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.shop, cols: 2, rows: 2, bar: 0.03, frame: '#3a2618' }, depth: 0.2, sillTrim: { color: '#6e4c3a', mat: NM.brick } },
    roof: { eave: 0.5, soffit: '#3a2c22', fascia: '#2c221b', gutter: '#3d3a36' },
    plinth: { ht: 0.35, color: '#6b6560', mat: NM.stone, proj: 0.04 },
    sign: null,
  })
  const b = k.solid
  // 窓と扉の木の枠・まぐさの煉瓦の欠円アーチ
  for (const o of opens) {
    if (o.fill === 'door') continue
    fbox(b, f, o.s - 0.08, o.s + o.w + 0.08, -0.12, 0.02, o.h - 0.1, o.h, '#4a3020', NM.wood)
    fbox(b, f, o.s - 0.12, o.s + o.w + 0.12, -0.06, 0.02, o.h + o.ht, o.h + o.ht + 0.24, '#7a3c2c', NM.brick)
  }
  fbox(b, f, door.s - 0.1, door.s + door.w + 0.1, -0.06, 0.02, door.ht, door.ht + 0.26, '#7a3c2c', NM.brick)
  // 星の看板ランプ（扉の上）。夜は路地の奥でぽつんと光る
  const sc = f.p(ds, -0.32, door.ht + 0.5)
  b.beam(f.p(ds, 0.02, door.ht + 0.55), f.p(ds, -0.3, door.ht + 0.55), 0.03, '#1e1e1e', NM.iron)
  const star = signAtlas.region({ text: '', fg: '#ffd27a', bg: null, icon: 'star', w: 0.6, h: 0.6 } as SignStyle)
  if (star) {
    const A = (ds2: number, dh: number) => f.p(ds + ds2, -0.33, door.ht + 0.2 + dh)
    k.signs.quad(A(-0.3, 0), A(0.3, 0), A(0.3, 0.6), A(-0.3, 0.6), star, 1)
  }
  k.lamp(sc, 6.5, '#ffd08a', 2.0, 0.6, 3)
  // 小さな表札の看板（窓の上）
  k.sign(f, big.s + 0.1, big.h + big.ht + 0.32, Math.min(2.2, big.w - 0.2), 0.36, -0.04, { text: '星図珈琲', sub: 'SEIZU COFFEE', fg: '#e8d29a', bg: '#1d2440', border: '#c9a046', font: 'serif' }, 2)
  // 星見石段（扉の前の踊り場から路地へ下りる。地面は named/grade.ts が段の下まで均す）・袖の石積み・足元の行灯
  const sf = f.shift(ds - STAIRS.width / 2, -STAIRS.landing)
  fbox(b, f, ds - STAIRS.width / 2, ds + STAIRS.width / 2, -STAIRS.landing, 0.02, -1.2, 0.04, '#8f8a80', NM.granite)
  steps(k, sf, 0, STAIRS.width, STAIRS.steps, STAIRS.rise, STAIRS.run, '#8f8a80', NM.granite)
  for (const side of [-0.35, STAIRS.width]) {
    for (let i = 0; i < STAIRS.steps; i += 2) {
      const t0 = -i * STAIRS.run
      const h = -i * STAIRS.rise
      fbox(b, sf, side, side + 0.35, t0 - STAIRS.run * 2, t0, h - 1.8, h + 0.45, '#7d786e', NM.stone, 0.3)
    }
    for (const i of [3, 9, 15]) {
      const p = sf.p(side + 0.17, -i * STAIRS.run - 0.2, -i * STAIRS.rise + 0.45)
      k.glow.box([p[0], p[1] + 0.22, p[2]], [0.22, 0.34, 0.22], '#ffd9a0', 0, 1.8)
      b.box([p[0], p[1] + 0.42, p[2]], [0.3, 0.05, 0.3], '#2a2a28', NM.iron)
    }
  }
  // 石段を照らす灯り（照らすだけ。光の点を出すと石段の真ん中の宙に浮いた光の玉に見えた。足元の行灯が光って見える）
  k.lamp(sf.p(STAIRS.width / 2, -STAIRS.run * 9, -STAIRS.rise * 9 + 0.8), 6, '#ffc890', 1.2, 0.4, 3, false)
  // 店の前（石段を上りきった所）: 鉢植え・小さな黒板
  pot(k, f, 0.25, -0.4, 0, 0.45)
  pot(k, f, L - 0.3, -0.4, 0, 0.4, '#6d5a4a')
  fbox(b, f, ds + doorW / 2 + 0.25, ds + doorW / 2 + 0.75, -0.75, -0.55, 0, 0.95, '#2a2a2a', NM.paint, 0.2)
  // 暗い奥（扉の中）。中を作ったら隠す仮の物（kit.temp）
  fbox(k.temp, f, door.s, door.s + door.w, 0.25, 1.4, 0, door.ht, '#141210', NM.dark)
  void g
}

/* -------------------------------------------------------------------------- */
/* 煉瓦の洋風の店・石の店                                                         */
/* -------------------------------------------------------------------------- */

export function brickShop(k: Kit, look: 'teishajo' | 'harbor' | 'gakuen') {
  const rec = k.rec
  const hexes = hexesIn(rec.wallText)
  const stone = look === 'teishajo' ? (hexes[1] ?? '#efe6d2') : '#d8d0c0'
  const brick = cssOf(rec.wallColor)
  const st = signText(rec)
  const eatery = isEatery(rec) || /カフェ|喫茶/.test(rec.kind ?? '')
  const glassKind = eatery ? GLASS.cafe : GLASS.shop
  const accent = look === 'gakuen' ? (hexes[1] ?? '#5fa8a0') : look === 'harbor' ? '#2c3e50' : '#2f5d46'
  const g = generic(k, {
    shop: {
      glass: { kind: glassKind, cls: LIGHT_CLASS.shop, depth: 6 },
      frame: accent,
      kick: { color: look === 'gakuen' ? '#3a3a3a' : '#5a3a2a', mat: look === 'gakuen' ? NM.tileClad : NM.paint },
      fascia: { color: look === 'gakuen' ? '#2b2b2b' : accent, mat: NM.paint },
      sign: { text: st.main, sub: st.sub, fg: look === 'gakuen' ? '#ffffff' : '#f0e2b8', bg: look === 'gakuen' ? '#2b2b2b' : accent, font: look === 'gakuen' ? 'sans' : 'serif', icon: iconOf(rec), bold: look === 'gakuen' },
      awning: look === 'gakuen' ? null : { color: accent, stripes: look === 'harbor' ? 6 : 0 },
      door: { kind: 'glass', color: accent, glass: { kind: glassKind, cls: LIGHT_CLASS.shop } },
    },
    wall: { color: brick, mat: NM.brick },
    groundH: 3.6,
    win: { w: 1.0, ht: 1.7, sill: 0.8, shape: look === 'gakuen' ? 'rect' : 'arch', glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 3, bar: 0.03, frame: '#f2efe6' }, depth: 0.22, sillTrim: { color: stone, mat: NM.stone }, lintel: look === 'gakuen' ? { color: '#9a958c', mat: NM.concrete } : { color: stone, mat: NM.stone, keystone: true } },
    bands: look === 'gakuen' ? undefined : { hs: [3.6], ht: 0.22, proj: 0.06, color: stone, mat: NM.stone },
    cornice: { ht: 0.45, proj: 0.18, color: look === 'gakuen' ? '#9a958c' : stone, mat: NM.stone },
    plinth: { ht: 0.4, color: '#7d776e', mat: NM.granite, proj: 0.05 },
    quoins: look === 'teishajo' ? { color: stone, mat: NM.stone } : undefined,
    roof: { eave: 0.35, verge: 0.25, soffit: '#4a4642', fascia: '#3a3a38', gutter: '#3d4a44' },
  })
  if (isOpenLab(rec)) hirakiFuda(k, g.body[g.frontEdge].f, 0.25, 1.4, rec)
  return g
}

export function stoneShop(k: Kit, look: 'canal' | 'bunko') {
  const rec = k.rec
  const hexes = hexesIn(rec.wallText)
  const st = signText(rec)
  const eatery = isEatery(rec) || /カフェ|喫茶|レストラン|バー/.test(rec.kind ?? '')
  const isShop = rec.use === 2
  const glassKind = eatery ? GLASS.cafe : GLASS.shop
  const accent = look === 'canal' ? ['#2f4f6f', '#6b2f2a', '#2f5d46', '#4a3a5a'][k.seed % 4] : ['#3a3a3a', '#5a4632', '#2f4f4f'][k.seed % 3]
  const g = generic(k, {
    shop: isShop
      ? {
          glass: { kind: glassKind, cls: LIGHT_CLASS.shop, depth: 6 },
          frame: accent,
          kick: { color: '#6f6a62', mat: NM.granite },
          fascia: { color: accent, mat: NM.paint },
          sign: { text: st.main, sub: st.sub, fg: '#f3ecd8', bg: accent, font: look === 'canal' ? 'serif' : 'sans', icon: iconOf(rec) },
          awning: { color: accent, stripes: k.seed % 2 ? 7 : 0 },
          door: { kind: 'glass', color: accent, glass: { kind: glassKind, cls: LIGHT_CLASS.shop } },
        }
      : null,
    wall: { color: hexes[0] ?? cssOf(rec.wallColor), mat: NM.stone, aux: 0.5 },
    wallLower: look === 'canal' ? undefined : undefined,
    groundH: isShop ? 3.5 : 3.1,
    win: { w: 1.0, ht: 1.55, sill: 0.85, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 2, bar: 0.03, frame: '#ece8de' }, depth: 0.2, surround: { color: hexes[1] ?? '#efebe2', mat: NM.plaster, w: 0.14 }, sillTrim: { color: '#c9c2b4', mat: NM.stone }, flowers: look === 'canal' && k.rnd() < 0.5 },
    cornice: { ht: 0.4, proj: 0.16, color: hexes[1] ?? '#efebe2', mat: NM.plaster },
    plinth: { ht: 0.45, color: '#8a8478', mat: NM.granite, proj: 0.05 },
    roof: { eave: 0.4, verge: 0.3, soffit: '#5a5048', fascia: '#4a4038', gutter: '#4a4a46' },
    sign: isShop ? null : undefined,
  })
  if (isOpenLab(rec)) hirakiFuda(k, g.body[g.frontEdge].f, 0.25, 1.4, rec)
  return g
}

/* -------------------------------------------------------------------------- */
/* 旧商館（喫茶 錨）・島の石の家・銭湯・茶屋                                       */
/* -------------------------------------------------------------------------- */

export function merchantHouse(k: Kit) {
  const rec = k.rec
  const st = signText(rec)
  const g = generic(k, {
    wall: { color: cssOf(rec.wallColor), mat: NM.stone, aux: 0.5 },
    shop: { glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.shop, depth: 7 }, frame: '#2c3e50', kick: { color: '#6f6a62', mat: NM.granite }, fascia: { color: '#2c3e50', mat: NM.paint }, sign: { text: st.main, sub: '旧商館 1889', fg: '#e8d9b0', bg: '#2c3e50', font: 'serif', icon: 'anchor' }, awning: { color: '#7a2a24', stripes: 0 } },
    groundH: 3.8,
    win: { w: 1.1, ht: 2.0, sill: 0.6, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 3, bar: 0.03, frame: '#f0ece2' }, depth: 0.26, surround: { color: '#d8d0c0', mat: NM.stone, w: 0.16 }, lintel: { color: '#d8d0c0', mat: NM.stone, keystone: true }, sillTrim: { color: '#d8d0c0', mat: NM.stone }, shutters: '#3b5a4a' },
    bands: { hs: [3.8, 7.0], ht: 0.2, proj: 0.07, color: '#d8d0c0', mat: NM.stone },
    cornice: { ht: 0.5, proj: 0.22, color: '#d8d0c0', mat: NM.stone },
    quoins: { color: '#cfc6b4', mat: NM.stone },
    plinth: { ht: 0.5, color: '#7d776e', mat: NM.granite },
    roof: { eave: 0.4, soffit: '#4a4642', gutter: '#3d3a36' },
  })
  return g
}

export function islandStone(k: Kit) {
  const rec = k.rec
  const shop = rec.use === 2
  const st = signText(rec)
  return generic(k, {
    wall: { color: '#e8e4d8', mat: NM.stone, aux: 0.42 },
    shop: shop ? { glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop }, frame: '#2c4a6a', kick: { color: '#6f6a62', mat: NM.stone }, fascia: { color: '#2c4a6a', mat: NM.paint }, sign: { text: st.main, sub: st.sub, fg: '#ffffff', bg: '#2c4a6a', font: 'sans' }, awning: null, door: { kind: 'glass', color: '#2c4a6a' } } : null,
    win: { w: 0.9, ht: 1.4, sill: 0.9, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 2, bar: 0.035, frame: '#f4f2ec' }, depth: 0.32, sillTrim: { color: '#cfc8b8', mat: NM.stone }, shutters: '#2c4a6a' },
    plinth: { ht: 0.45, color: '#8a857a', mat: NM.stone },
    roof: { eave: 0.35, verge: 0.25, soffit: '#e8e4d8', fascia: '#e8e4d8', gutter: '#6a6a66' },
    door: { style: { kind: 'panel', color: '#2c4a6a' }, lamp: 'lantern' },
    sign: shop ? null : { text: rec.name.replace(/（.*）/, ''), sub: '灯台資料館', fg: '#2a2a2a', bg: '#f2efe6', border: '#8a7a5a', font: 'serif', h: 0.45 },
  })
}

/** 銭湯（入母屋の大屋根・唐破風の玄関のかわりに大きな庇・暖簾「ゆ」・煙突は建物の部分） */
export function sento(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const doorW = 2.2
  const ds = Math.min(L - doorW / 2 - 0.5, Math.max(doorW / 2 + 0.5, ff.doorS))
  const door: Opening = { s: ds - doorW / 2, h: 0, w: doorW, ht: 2.4, depth: 0.3, fill: 'door', door: { kind: 'sliding', color: '#3a2a1e', glass: { kind: GLASS.frosted, cls: LIGHT_CLASS.night } } }
  const g = generic(k, {
    floors: 1,
    eave: rec.height ?? 7.1,
    ridge: (rec.height ?? 7.1) + 3.6,
    roofKind: 'irimoya',
    wall: { color: '#e9e1cf', mat: NM.plaster },
    wallLower: { color: '#5b4033', mat: NM.boardV, aux: 0.2, h: 1.6 },
    frontGround: 'none',
    frontOpenings: [door],
    noFrontDoor: true,
    win: { w: 1.6, ht: 1.0, sill: 3.4, glass: { kind: GLASS.frosted, cls: LIGHT_CLASS.night, cols: 4, rows: 1, bar: 0.04, frame: '#3a2a1e' }, depth: 0.14 },
    groundWin: { w: 1.6, ht: 1.0, sill: 3.4, glass: { kind: GLASS.frosted, cls: LIGHT_CLASS.night, cols: 4, rows: 1, bar: 0.04, frame: '#3a2a1e' }, depth: 0.14 },
    roof: { eave: 0.9, soffit: '#3b3027', fascia: '#2e261f' },
    sign: null,
  })
  // 玄関の大きな庇（瓦）と暖簾「ゆ」・木の看板
  penRoof(k, f, door.s - 1.2, door.s + door.w + 1.2, 3.4, 1.6, g.roof.color, g.roof.mat, 0.5, g.roof.aux ?? 0)
  noren(k, f, door.s + 0.1, door.s + door.w - 0.1, 2.38, 0.85, { text: 'ゆ', fg: '#ffffff', bg: '#1f3f6a', font: 'serif', bold: true })
  k.sign(f, L / 2 - 1.6, 4.0, 3.2, 0.8, -0.08, { text: '灯の湯', sub: '銭湯', fg: '#f3e6c8', bg: '#2a1f17', border: '#a8874a', font: 'serif', bold: true, finish: 'wood' }, 2)
  wallLamp(k, f, door.s - 0.4, 2.3, 'lantern')
  wallLamp(k, f, door.s + door.w + 0.4, 2.3, 'lantern')
  banner(k, f, door.s - 1.6, -1.2, 0, '#1f3f6a', 'ゆ  灯の湯')
  return g
}

/** 茶屋（平屋・縁台・暖簾・木の柱の開いた店先） */
export function teahouse(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const open: Opening = { s: 0.4, h: 0, w: L - 0.8, ht: 2.2, depth: 0.25, fill: 'glass', glass: { kind: GLASS.cafe, cls: LIGHT_CLASS.shop, cols: Math.round((L - 0.8) / 0.9), rows: 1, bar: 0.04, frame: '#3a2a1e', depth: 4 } }
  const g = generic(k, {
    floors: 1,
    wall: { color: '#4a3526', mat: NM.boardV, aux: 0.2 },
    frontGround: 'none',
    frontOpenings: [open],
    noFrontDoor: true,
    win: { w: 1.0, ht: 0.9, sill: 0.9, glass: { kind: GLASS.shoji, cls: LIGHT_CLASS.shop, cols: 1, rows: 1, bar: 0 }, depth: 0.1 },
    roof: { eave: 0.9, verge: 0.5, soffit: '#3b3027', fascia: '#2e261f' },
    sign: null,
  })
  const b = k.solid
  // 縁台（緋毛氈の長椅子）2 つと野点の傘
  for (const s0 of [0.6, L / 2 + 0.4]) {
    fbox(b, f, s0, s0 + 1.6, -1.6, -1.0, 0.42, 0.48, '#b5302a', NM.cloth)
    for (const s of [s0 + 0.1, s0 + 1.5]) fbox(b, f, s - 0.04, s + 0.04, -1.55, -1.05, 0, 0.42, '#3a2a1e', NM.wood)
  }
  const umb = f.p(L / 2, -2.2, 0)
  b.beam(umb, [umb[0], umb[1] + 2.3, umb[2]], 0.05, '#c9b48a', NM.wood)
  b.cylinder([umb[0], umb[1] + 2.1, umb[2]], 1.4, 0.5, 16, '#b5302a', NM.cloth, 0, true, 0.05)
  noren(k, f, L / 2 - 0.9, L / 2 + 0.9, 2.2, 0.6, { text: '見晴らし茶屋', fg: '#ffffff', bg: '#2f4f3a', font: 'serif' })
  k.sign(f, L / 2 - 1.3, 2.45, 2.6, 0.5, -0.06, { text: '茶屋', sub: '見晴らし', fg: '#f3e6c8', bg: '#2a1f17', font: 'serif', finish: 'wood' }, 2)
  wallLamp(k, f, 0.2, 2.2, 'lantern')
  return g
}

export { canopy }
