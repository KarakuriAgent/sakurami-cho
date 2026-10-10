import * as THREE from 'three'
import type { P2 } from '../../town/townData'
import { Frame, isRect, rectFrame } from '../frame'
import { fbox, gableRoof, type Kit, type Opening, shedRoof, steps, wallLamp } from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import { acUnit, chimney, column, pot, railing } from '../parts'
import { buildBody, cssOf, frontEdgeOf, type WinSpec } from '../shell'
import { generic, hirakiFuda, isOpenLab, signText } from './common'
import { frontFace } from './shops'

/**
 * 家の組み立ての型: トンプソン家（白い下見板・黒瓦の切妻・ポーチ・ガレージ・煉瓦の煙突・太陽光瓦）、和の木造の家、
 * 明晴期の洋館（旧鉄道官舎）、木の小屋、古民家、木造の校舎
 */

const LAB = 116

/* -------------------------------------------------------------------------- */
/* トンプソン家                                                                 */
/* -------------------------------------------------------------------------- */

const WHITE = '#f3f1ea'
const TRIM = '#fbfaf6'

/** 白い枠の上げ下げ窓（額縁と窓台つき） */
function whiteWin(w: number, ht: number, sill: number, kind: number = GLASS.house): WinSpec {
  return { w, ht, sill, glass: { kind, cls: LIGHT_CLASS.window, cols: 2, rows: 2, bar: 0.035, frame: TRIM, depth: 4.2 }, depth: 0.12, surround: { color: TRIM, mat: NM.paint, w: 0.1 }, sillTrim: { color: TRIM, mat: NM.paint } }
}

/** トンプソン家の開く扉の番号（データの入口の番号に無いものは 100 番から）。interior/ の中の組み立てが同じ番号を使う */
export const THOMPSON_DOORS = { front: 0, balcony: 101 } as const

/** 塀の辺 ef（長さ L）のうち、ポーチの階段の前の門のすき間（s の範囲）。かからなければ null */
function gateOn(ef: Frame, L: number): [number, number] | null {
  // 階段の中心（平面）から辺へ下ろした位置
  const [s, t] = ef.local(-655.0, -367.35)
  if (s < 0.6 || s > L - 0.6 || Math.abs(t) > 4) return null
  return [s - 0.85, s + 0.85]
}

/**
 * トンプソン家（楓坂三丁目12番7号）。データの外形（母屋 9.6m × 7.5m・北のガレージ 7m × 4m）・部屋（間取り）の窓の位置・
 * 玄関（西のポーチ。百段石段へ木の階段 4 段）・煙突（南の壁・頂 9.4m）・バルコニー（2 階の南西）・敷地（石積みの塀と生け垣・緑の郵便受け・ハーブの花壇）
 */
export function thompson(k: Kit, heightAt: (x: number, y: number) => number) {
  const rec = k.rec
  const z = rec.z
  const b = k.solid
  const x0 = -652.3
  const x1 = -642.7
  const y0 = -375.6
  const y1 = -368.1
  const eave = rec.height ?? 6.0
  const ridge = rec.roofHeight ?? 8.6
  const groundH = 2.9
  const bottom = Math.min(rec.gLow, rec.zMin ?? z) - z - 0.4
  const ring: P2[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
  const ent = rec.entrances.find((e) => e.kind === 'main')
  k.mass.st = { wall: rec.wallColor, facade: 0, roof: [43, 43, 43], roofKind: 1, use: 0, flags: 1, seed: k.seed, style: 1, floors: 2 }
  // 面: 0 南（s = 西→東）・1 東・2 北（s = 東→西）・3 西（s = 北→南。正面）
  const f2 = (sill: number) => sill
  const winS = whiteWin(1.0, 1.35, 0.85)
  const big = whiteWin(2.1, 1.7, 0.55, GLASS.house)
  big.glass = { ...big.glass!, cols: 3, rows: 2 }
  const faces = [
    // 南: 1 階はリビングの湾を見る大きな窓 2 つ、2 階は花音の部屋のガラス戸（バルコニーへ）と窓、両親の寝室の窓
    {
      win: null,
      bay: 3,
      openings: [
        { s: 0.9, h: 0.5, w: 1.9, ht: 1.75, depth: 0.12, glass: big.glass },
        { s: 5.0, h: 0.5, w: 2.3, ht: 1.75, depth: 0.12, glass: big.glass },
        { s: 0.5, h: groundH + 0.05, w: 1.0, ht: 2.05, depth: 0.12, fill: 'door' as const, door: { kind: 'glass' as const, color: TRIM, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window }, operable: THOMPSON_DOORS.balcony } },
        { s: 1.75, h: groundH + 0.75, w: 1.3, ht: 1.35, depth: 0.12, glass: { ...winS.glass!, cols: 3 } },
        { s: 6.8, h: groundH + 0.8, w: 1.1, ht: 1.3, depth: 0.12, glass: winS.glass },
      ],
    },
    // 東: 1 階のキッチンの窓・2 階のトイレの小窓と寝室の窓
    { win: null, bay: 3, openings: [{ s: 1.2, h: 0.95, w: 1.0, ht: 1.1, depth: 0.12, glass: winS.glass }, { s: 4.8, h: 0.6, w: 1.2, ht: 1.55, depth: 0.12, glass: winS.glass }, { s: 1.3, h: groundH + 0.85, w: 1.1, ht: 1.25, depth: 0.12, glass: winS.glass }, { s: 5.2, h: groundH + 1.3, w: 0.6, ht: 0.7, depth: 0.12, glass: { kind: GLASS.frosted, cls: LIGHT_CLASS.window, cols: 1, rows: 1, bar: 0.03, frame: TRIM } }] },
    // 北（ガレージの無い西の端だけ）: 書斎の窓・美咲の書斎の窓
    // 1 階の窓は書斎の北の壁の、ガレージにかからない所（u 2.4〜3.2）。勝手口（キッチンからガレージへ。u 7.95〜8.75）は穴だけ（中を作るとき通る）
    {
      win: null,
      bay: 3,
      openings: [
        { s: 6.4, h: 0.95, w: 0.8, ht: 1.2, depth: 0.12, glass: winS.glass },
        { s: 6.9, h: groundH + 0.8, w: 1.1, ht: 1.3, depth: 0.12, glass: winS.glass },
        { s: 2.6, h: groundH + 0.8, w: 1.0, ht: 1.25, depth: 0.12, glass: winS.glass },
        { s: 0.85, h: 0.15, w: 0.8, ht: 2.0, depth: 0.15, fill: 'void' as const },
      ],
    },
    // 西（正面。ポーチの奥）: 玄関・1 階のリビングの窓・2 階の 2 つの窓
    {
      win: null,
      bay: 3,
      openings: [
        { s: 0.98, h: 0, w: 0.95, ht: 2.15, depth: 0.16, fill: 'door' as const, door: { kind: 'panel' as const, color: '#355e4a', operable: rec.entrances.indexOf(ent!) } },
        { s: 3.4, h: 0.6, w: 1.6, ht: 1.6, depth: 0.12, glass: { ...big.glass!, cols: 2 } },
        { s: 1.0, h: groundH + 0.75, w: 1.0, ht: 1.35, depth: 0.12, glass: winS.glass },
        { s: 5.2, h: groundH + 0.75, w: 1.0, ht: 1.35, depth: 0.12, glass: winS.glass },
      ],
    },
  ]
  const body = buildBody(k, {
    ring,
    z,
    bottom,
    floors: 2,
    floorH: eave - groundH,
    groundH,
    top: eave,
    wall: { color: WHITE, mat: NM.siding, aux: 0.2 },
    plinth: { ht: 0.45, color: '#8a8378', mat: NM.stone, aux: 0.3, proj: 0.04 },
    faces: faces.map((f) => ({ ...f, minLen: 0 })),
    frontEdge: 3,
    windowTop: eave - 0.5,
  })
  void f2
  // 窓の額縁と窓台（白）
  for (const face of body) for (const o of face.openings) if (o.fill !== 'door') {
    fbox(b, face.f, o.s - 0.1, o.s, -0.04, 0.02, o.h, o.h + o.ht, TRIM, NM.paint, 0.4)
    fbox(b, face.f, o.s + o.w, o.s + o.w + 0.1, -0.04, 0.02, o.h, o.h + o.ht, TRIM, NM.paint, 0.4)
    fbox(b, face.f, o.s - 0.12, o.s + o.w + 0.12, -0.05, 0.02, o.h + o.ht, o.h + o.ht + 0.12, TRIM, NM.paint, 0.4)
    fbox(b, face.f, o.s - 0.12, o.s + o.w + 0.12, -0.09, 0.03, o.h - 0.06, o.h, TRIM, NM.paint, 0.4)
  }
  // 隅板（白）と、1 階と 2 階のあいだの帯
  for (const face of body) {
    fbox(b, face.f, -0.03, 0.12, -0.05, 0.02, 0.4, eave, TRIM, NM.paint, 0.3)
    fbox(b, face.f, face.L - 0.12, face.L + 0.03, -0.05, 0.02, 0.4, eave, TRIM, NM.paint, 0.3)
    fbox(b, face.f, 0, face.L, -0.04, 0.02, groundH - 0.05, groundH + 0.12, TRIM, NM.paint, 0.3)
  }
  // 屋根（切妻・棟は東西）: 南の面の Frame（s = 西→東、t = 北へ）。西の妻に屋根裏の窓
  const fs = Frame.edge([x0, y0], [x1, y0], z)
  const roofSt = { color: '#36383b', mat: NM.kawara, eave: 0.55, verge: 0.4, thick: 0.2, soffit: TRIM, fascia: TRIM, gutter: '#e8e6e0' }
  const D = y1 - y0
  const attic: Opening = { s: D / 2 - 0.45, h: eave + 0.6, w: 0.9, ht: 0.9, depth: 0.1, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 2, bar: 0.03, frame: TRIM } }
  gableRoof(k, fs, x1 - x0, D, eave, ridge, { ...roofSt, gable: { color: WHITE, mat: NM.siding, aux: 0.2, openings: [[attic], [{ ...attic, s: D / 2 - 0.4, w: 0.8, ht: 0.8 }]] } })
  // 太陽光瓦（南の斜面の東寄り。濃い紺のパネルの列）
  const slope = (ridge - eave) / (D / 2)
  for (let row = 0; row < 2; row++) {
    const t0 = 0.6 + row * 1.15
    const t1 = t0 + 1.05
    const h0 = eave + t0 * slope + 0.04
    const h1 = eave + t1 * slope + 0.04
    b.quad(fs.p(4.2, t0, h0), fs.p(9.0, t0, h0), fs.p(9.0, t1, h1), fs.p(4.2, t1, h1), '#1b2433', NM.glassDark)
    for (let i = 0; i <= 6; i++) {
      const s = 4.2 + (i / 6) * 4.8
      b.beam(fs.p(s, t0, h0 + 0.01), fs.p(s, t1, h1 + 0.01), 0.02, '#8a8f96', NM.paint, 0.8, 0.01)
    }
  }
  // 煉瓦の煙突（南の壁の外。頂 9.4m）
  const ch = rec.extra.chimney as { x: number; y: number; top_height_m: number } | undefined
  const cx = ch?.x ?? -649.3
  chimney(k, cx, y0 - 0.32, 0.95, 0.62, z + bottom, z + (ch?.top_height_m ?? 9.4), 0, '#8a4632')
  // バルコニー（2 階の南西。データ: x −652.3〜−648.3、奥行き 1.5m。煙突の手前まで）
  const balS1 = Math.min(4.0, cx - 0.55 - x0)
  fbox(b, fs, 0, balS1, -1.5, 0.02, groundH - 0.12, groundH + 0.05, '#c9c2b4', NM.wood, 0)
  railing(k, fs, 0.05, balS1 - 0.05, -1.45, groundH + 0.05, 1.0, TRIM, NM.paint, 1.2, 0.11)
  for (const s of [0.05, balS1 - 0.05]) b.beam(fs.p(s, -1.45, groundH + 1.05), fs.p(s, 0, groundH + 1.05), 0.05, TRIM, NM.paint, 0.4)
  // 望遠鏡（バルコニーの小さな天体望遠鏡）
  const tp = fs.p(1.3, -0.9, groundH + 0.05)
  for (const a of [0, 2.1, 4.2]) b.beam(tp, [tp[0] + Math.sin(a) * 0.3, tp[1] + 0, tp[2] + Math.cos(a) * 0.3], 0.02, '#2a2a2a', NM.iron)
  b.beam([tp[0], tp[1] + 0.05, tp[2]], [tp[0], tp[1] + 1.0, tp[2]], 0.03, '#2a2a2a', NM.iron)
  b.beam([tp[0] - 0.2, tp[1] + 1.0, tp[2] + 0.1], [tp[0] + 0.35, tp[1] + 1.35, tp[2] - 0.2], 0.09, '#e8e6e0', NM.paint, 0.6)
  // ガレージ（北。7m × 4m・切妻・北のシャッター）
  const gx0 = -649.0
  const gx1 = -642.0
  const gy0 = y1
  const gy1 = -364.1
  const gH = 3.0
  const gring: P2[] = [
    [gx0, gy0],
    [gx1, gy0],
    [gx1, gy1],
    [gx0, gy1],
  ]
  k.mass.st = { ...k.mass.st, floors: 1 }
  const gfaces = buildBody(k, {
    ring: gring,
    z,
    bottom,
    floors: 1,
    floorH: gH,
    top: gH,
    wall: { color: WHITE, mat: NM.siding, aux: 0.2 },
    plinth: { ht: 0.3, color: '#8a8378', mat: NM.concrete },
    faces: [
      // 南（母屋の北の壁と重なる）: 勝手口の穴だけ（u 7.95〜8.75。s = 西から）
      { win: null, bay: 3, openings: [{ s: 7.95 - 3.3, h: 0.15, w: 0.8, ht: 2.0, depth: 0.15, fill: 'void' as const }], minLen: 2 },
      { win: { w: 0.9, ht: 0.9, sill: 1.2, glass: winS.glass }, bay: 3, minLen: 2 },
      { win: null, bay: 3, openings: [{ s: (gx1 - (rec.entrances.find((e) => e.kind === 'service')?.x ?? -645.5)) - 1.3, h: 0, w: 2.6, ht: 2.25, depth: 0.14, fill: 'door' as const, door: { kind: 'shutter' as const, color: '#c9cbc8' } }], minLen: 2 },
      { win: { w: 0.9, ht: 1.0, sill: 1.1, glass: winS.glass }, bay: 3, minLen: 2 },
    ],
    frontEdge: 2,
  })
  for (const face of gfaces) {
    fbox(b, face.f, -0.03, 0.12, -0.05, 0.02, 0.3, gH, TRIM, NM.paint, 0.3)
    fbox(b, face.f, face.L - 0.12, face.L + 0.03, -0.05, 0.02, 0.3, gH, TRIM, NM.paint, 0.3)
  }
  const gf = Frame.edge([gx0, gy1], [gx0, gy0], z) // 西の面（s = 北→南）
  void gf
  const gfs = Frame.edge([gx0, gy0], [gx1, gy0], z) // 南の面（s = 西→東、t = 北へ）
  gableRoof(k, gfs, gx1 - gx0, gy1 - gy0, gH, gH + 1.2, { ...roofSt, eave: 0.45, gable: { color: WHITE, mat: NM.siding, aux: 0.2 } })
  // シャッターの上の灯り
  const gn = Frame.edge([gx1, gy1], [gx0, gy1], z) // 北の面
  wallLamp(k, gn, 0.6, 2.4, 'bulb')
  // ポーチ（西。木のデッキ・白い柱と手すり・黒瓦の片流れの屋根・木の階段 4 段）
  const fw = Frame.edge([x0, y1], [x0, y0], z) // 西の面（s = 北→南、t = 東へ）
  const pd = 2.4
  const pS0 = -1.6
  const pS1 = 4.6
  const deckH = 0.0
  fbox(b, fw, pS0, pS1, -pd, -0.02, deckH - 0.12, deckH, '#b08a62', NM.wood, 1)
  // デッキの下の格子（スカート）
  fbox(b, fw, pS0, pS1, -pd + 0.02, -pd + 0.06, bottom, deckH - 0.12, TRIM, NM.lattice, 0.08)
  fbox(b, fw, pS0 + 0.02, pS0 + 0.06, -pd, 0, bottom, deckH - 0.12, TRIM, NM.lattice, 0.08)
  fbox(b, fw, pS1 - 0.06, pS1 - 0.02, -pd, 0, bottom, deckH - 0.12, TRIM, NM.lattice, 0.08)
  // 柱と手すり（階段の所は空ける）
  const posts = [pS0 + 0.1, pS0 + 1.6, pS0 + 3.6, pS1 - 0.1]
  for (const s of posts) {
    fbox(b, fw, s - 0.08, s + 0.08, -pd + 0.02, -pd + 0.18, deckH, 2.62, TRIM, NM.paint, 0.4)
  }
  const stepS0 = pS0 + 0.25
  const stepS1 = pS0 + 1.45
  railing(k, fw, pS0 + 1.6, pS1 - 0.1, -pd + 0.1, deckH, 0.92, '#8a6a48', NM.wood, 1.0, 0.13)
  for (const s of [pS0 + 0.1, pS1 - 0.1]) railing(k, new Frame(...fw.plan(s, -pd + 0.1), -fw.nx, -fw.ny, z), 0, pd - 0.15, 0, deckH, 0.92, '#8a6a48', NM.wood, 1.0, 0.13)
  // 屋根（片流れ。壁の 2.95m から外へ 2.75m で下がる）
  const roofF = new Frame(...fw.plan(pS0 - 0.3, -pd - 0.3), fw.ax, fw.ay, z) // 低い側（t = 0）がポーチの外の縁、高い側が壁
  shedRoof(k, roofF, pS1 - pS0 + 0.6, pd + 0.3, 2.62, 2.95, { ...roofSt, eave: 0.25, verge: 0.05, thick: 0.15 })
  // 階段（北西へ。設計どおり 4 段・蹴上げ 0.12m で、床の 0.48m 下の庭へ下りる）。段の下の庭の地面は地形の高さ画像より 0.4m ほど高いので、
  // named/grade.ts が段の前を下げる（core/interiors.ts の THOMPSON の approaches。中の歩ける所 interior/briefs/thompson.ts の porch と同じ高さ。§7 の 143）
  steps(k, new Frame(...fw.plan(stepS0, -pd), fw.ax, fw.ay, z), 0, stepS1 - stepS0, 4, 0.12, 0.3, '#9a7a56', NM.wood)
  // ポーチの椅子 2 脚と小さなテーブル・鉢植え
  for (const s of [2.2, 3.4]) {
    const c = fw.p(s, -1.3, deckH)
    fbox(b, fw, s - 0.25, s + 0.25, -1.55, -1.05, deckH + 0.4, deckH + 0.45, '#7a5432', NM.wood)
    fbox(b, fw, s - 0.25, s + 0.25, -1.08, -1.03, deckH + 0.45, deckH + 0.95, '#7a5432', NM.wood)
    void c
  }
  fbox(b, fw, 2.65, 2.95, -1.5, -1.1, deckH + 0.5, deckH + 0.55, '#7a5432', NM.wood)
  pot(k, fw, 4.2, -1.9, deckH, 0.42, '#9a5a3a', '#4f7a34')
  pot(k, fw, 0.0, -0.4, deckH, 0.36, '#9a5a3a', '#6a8a3a')
  // 玄関の灯り
  wallLamp(k, fw, 0.55, 2.0, 'lantern')
  // 敷地: 石積みの低い塀と生け垣（西の縁）・緑の郵便受け・ハーブの花壇
  const site = rec.sites[0]
  if (site) {
    const sr = site.ring
    for (let i = 0; i < sr.length; i++) {
      const p = sr[i]
      const q = sr[(i + 1) % sr.length]
      // 西（石段の側）の辺だけ
      if (Math.min(p[0], q[0]) > x0 - 1.5) continue
      const ef = Frame.edge(p, q, z)
      const L = Math.hypot(q[0] - p[0], q[1] - p[1])
      // 門: ポーチの木の階段（v 7.65〜8.85）から百段石段へ出る所は塀を切り、門柱を立てる
      const gate = gateOn(ef, L)
      // 塀の高さは、塀の下の地面から（区切って地面に沿わせる）
      const n = Math.max(1, Math.ceil(L / 2))
      for (let j = 0; j < n; j++) {
        let s0 = (j / n) * L
        let s1 = ((j + 1) / n) * L
        if (gate && s1 > gate[0] && s0 < gate[1]) {
          // 門のすき間にかかる区切りは、すき間の外の分だけ
          if (s0 < gate[0]) s1 = gate[0]
          else if (s1 > gate[1]) s0 = gate[1]
          else continue
        }
        const pm = ef.plan((s0 + s1) / 2, 0.25)
        const gz = heightAt(pm[0], pm[1]) - z
        fbox(b, ef, s0, s1 + 0.02, 0, 0.5, gz - 0.6, gz + 0.55, '#8d867a', NM.stone, 0.25)
        fbox(b, ef, s0 + 0.05, s1 - 0.05, 0.05, 0.45, gz + 0.55, gz + 1.15, '#3c5e2c', NM.leaf)
      }
      if (gate) {
        for (const gs of gate) {
          const pm = ef.plan(gs, 0.25)
          const gz = heightAt(pm[0], pm[1]) - z
          fbox(b, ef, gs - 0.2, gs + 0.2, 0.05, 0.45, gz - 0.6, gz + 1.3, '#8d867a', NM.stone, 0.25)
          fbox(b, ef, gs - 0.24, gs + 0.24, 0.01, 0.49, gz + 1.3, gz + 1.38, '#9a958c', NM.granite)
        }
      }
    }
  }
  const mb = (rec.sites[0]?.mailbox as [number, number] | undefined) ?? [-653.73, -364.39]
  const mz = heightAt(mb[0], mb[1])
  b.box([mb[0], mz + 0.55 - LAB, -mb[1]], [0.08, 1.1, 0.08], '#5a4632', NM.wood)
  b.box([mb[0], mz + 1.2 - LAB, -mb[1]], [0.32, 0.26, 0.44], '#2f6b45', NM.paint, 0.6)
  b.box([mb[0], mz + 1.34 - LAB, -mb[1]], [0.34, 0.04, 0.46], '#2a5e3c', NM.paint, 0.6)
  k.sign(new Frame(mb[0] - 0.165, mb[1] + 0.2, 0, -1, mz), 0.02, 1.12, 0.36, 0.14, -0.005, { text: 'THOMPSON', fg: '#f2efe6', bg: '#2f6b45', font: 'latin' }, 0)
  // ハーブの花壇（石で囲んだ。前庭）
  const hbp = fw.plan(2.4, -3.6)
  const hb = fw.p(2.4, -3.6, heightAt(hbp[0], hbp[1]) - z - 0.1)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    b.box([hb[0] + Math.cos(a) * 1.0, hb[1] + 0.1, hb[2] + Math.sin(a) * 0.7], [0.32, 0.26, 0.24], '#9a9387', NM.stone, 0.2, -a)
  }
  b.box([hb[0], hb[1] + 0.22, hb[2]], [1.7, 0.3, 1.2], '#6b5a3e', NM.soil)
  for (const [dx, dz, c] of [
    [-0.4, -0.2, '#7d6fa8'],
    [0.2, 0.15, '#5f7f4a'],
    [0.45, -0.25, '#4f7a3a'],
    [-0.1, 0.3, '#6a8a4a'],
  ] as [number, number, string][])
    b.box([hb[0] + dx, hb[1] + 0.48, hb[2] + dz], [0.4, 0.32, 0.4], c, NM.leaf, 0, k.rnd())
  acUnit(k, Frame.edge([x1, y0], [x1, y1], z), 3.0, -0.05, 0.05)
}

/* -------------------------------------------------------------------------- */
/* 和の木造の家・洋館・小屋・古民家・木造の校舎                                       */
/* -------------------------------------------------------------------------- */

/** 和の木造の家（白い板張り・黒瓦の切妻・玄関の小さな庇と表札） */
export function houseJp(k: Kit) {
  const rec = k.rec
  const g = generic(k, {
    win: { w: 1.4, ht: 1.15, sill: 0.8, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 1, bar: 0.03, frame: '#8a8a88' }, depth: 0.1, sillTrim: { color: '#d8d4c8', mat: NM.paint } },
    door: { style: { kind: 'sliding', color: '#4a3a2c', glass: { kind: GLASS.frosted, cls: LIGHT_CLASS.window } }, w: 1.5, ht: 2.0, canopy: { color: '#36383b', mat: NM.kawara, depth: 0.9 } },
    roof: { eave: 0.65, soffit: '#4a3f35', fascia: '#3a3028', gutter: '#8a8a86' },
    sign: null,
  })
  const ff = frontFace(rec)
  k.sign(ff.f, ff.doorS + 1.0, 1.5, 0.22, 0.5, -0.03, { text: rec.name.replace(/の家$/, '').replace(/^桐生.*/, '桐生'), fg: '#1a1a1a', bg: '#e8dcc0', vertical: true, font: 'serif', finish: 'wood' }, 0)
  pot(k, ff.f, ff.doorS - 1.2, -0.4, 0, 0.4)
  return g
}

/** 明晴期の洋館（白い下見板・緑のトタンの寄棟・縦長の上げ下げ窓と鎧戸・玄関の柱廊・煙突） */
export function yokan(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const st = signText(rec)
  const hotel = rec.use === 2
  const g = generic(k, {
    wall: { color: '#ece6d6', mat: NM.siding, aux: 0.18 },
    groundH: 3.2,
    win: { w: 0.9, ht: 1.75, sill: 0.7, glass: { kind: GLASS.house, cls: hotel ? LIGHT_CLASS.night : LIGHT_CLASS.window, cols: 2, rows: 3, bar: 0.03, frame: '#f8f6f0' }, depth: 0.12, surround: { color: '#f8f6f0', mat: NM.paint, w: 0.1 }, sillTrim: { color: '#f8f6f0', mat: NM.paint }, shutters: '#3f6a52' },
    door: { style: { kind: 'double', color: '#5a3a26' }, w: 1.5, ht: 2.4, lamp: 'gas' },
    plinth: { ht: 0.6, color: '#8a8378', mat: NM.stone },
    bands: { hs: [3.2], ht: 0.16, proj: 0.04, color: '#f8f6f0', mat: NM.paint },
    roof: { eave: 0.6, soffit: '#f2efe6', fascia: '#f2efe6', gutter: '#4f6f5a', color: '#4f6f5a', mat: NM.metalRoof, aux: 0 },
    sign: null,
  })
  const b = k.solid
  // 玄関の柱廊（2 本の柱と小さな屋根とバルコニー）
  const { f } = ff
  const s0 = ff.doorS - 1.4
  const s1 = ff.doorS + 1.4
  for (const s of [s0 + 0.15, s1 - 0.15]) column(k, f, s, -1.6, 0, 3.0, 0.13, '#f8f6f0', NM.paint)
  fbox(b, f, s0 - 0.1, s1 + 0.1, -1.9, 0.02, 3.0, 3.25, '#f8f6f0', NM.paint, 0.4)
  railing(k, f, s0, s1, -1.8, 3.25, 0.85, '#f8f6f0', NM.paint, 0.9, 0.12)
  fbox(b, f, s0, s1, -1.9, 0.0, -0.4, 0.12, '#9a958c', NM.granite)
  // 煙突
  const rf = rectFrame(rec.ring, rec.front, rec.z)
  const cpt = rf.frame.plan(rf.W * 0.75, rf.D * 0.5)
  chimney(k, cpt[0], cpt[1], 0.7, 0.7, rec.z + g.eave, rec.z + g.ridge + 1.2, 0, '#8a4a36')
  // 看板・表札
  k.sign(f, ff.L / 2 - 1.2, 3.35, 2.4, 0.45, -1.92, { text: st.main.replace(/^汽笛町\s*/, ''), sub: hotel ? 'HOTEL TETSURO-SO' : st.sub, fg: '#f3ecd8', bg: '#3f5a4a', font: 'serif' }, 2)
  if (isOpenLab(rec)) hirakiFuda(k, f, s1 + 0.3, 1.3, rec)
  return g
}

/** 木の小屋（公園の売店・養蜂の建屋・観測小屋・管理事務所・直売所） */
export function hut(k: Kit) {
  const rec = k.rec
  const st = signText(rec)
  const shop = rec.use === 2
  const g = generic(k, {
    wall: { color: cssOf(rec.wallColor), mat: NM.boardV, aux: 0.16 },
    win: { w: 0.9, ht: 0.9, sill: 0.95, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 1, bar: 0.035, frame: '#5a4632' }, depth: 0.08, sillTrim: { color: '#5a4632', mat: NM.wood } },
    shop: shop ? { glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, depth: 3 }, frame: '#5a4632', kick: { color: '#5a4632', mat: NM.wood }, fascia: { color: '#5a4632', mat: NM.wood }, sign: { text: st.main, sub: st.sub, fg: '#f2e6c8', bg: '#4a3a2a', font: 'serif', finish: 'wood' }, awning: { color: '#3f6a3a', stripes: 0 }, door: { kind: 'glass', color: '#5a4632' }, windowTop: 2.4 } : null,
    door: { style: { kind: 'panel', color: '#6b4a2e' }, w: 0.9, ht: 2.0 },
    roof: { eave: 0.6, verge: 0.4, soffit: '#5a4632', fascia: '#4a3a2a' },
    plinth: { ht: 0.25, color: '#7d776e', mat: NM.concrete },
    sign: shop ? null : { text: st.main, sub: st.sub, fg: '#f2e6c8', bg: '#4a3a2a', font: 'serif', finish: 'wood', h: 0.42 },
  })
  const ff = frontFace(rec)
  if (isOpenLab(rec)) hirakiFuda(k, ff.f, ff.doorS + 0.7, 1.2, rec)
  if ((rec.kind ?? '').includes('養蜂')) {
    // 巣箱
    for (let i = 0; i < 4; i++) {
      const p = ff.f.p(-2 - (i % 2) * 1.2, -2.5 - Math.floor(i / 2) * 1.0, 0)
      k.solid.box([p[0], p[1] + 0.35, p[2]], [0.5, 0.7, 0.4], '#e8dcb8', NM.paint, 0.3)
      k.solid.box([p[0], p[1] + 0.75, p[2]], [0.58, 0.08, 0.48], '#6a5a3a', NM.wood)
    }
  }
  return g
}

/** 古民家（入母屋の黒瓦・板と漆喰の壁・縁側） */
export function kominka(k: Kit) {
  const rec = k.rec
  const g = generic(k, {
    roofKind: 'irimoya',
    eave: 3.0,
    ridge: 6.2,
    floors: 1,
    wall: { color: '#e6dcc6', mat: NM.plaster },
    wallLower: { color: '#5b4033', mat: NM.boardV, aux: 0.2, h: 1.0 },
    win: { w: 1.6, ht: 1.6, sill: 0.4, glass: { kind: GLASS.shoji, cls: LIGHT_CLASS.window, cols: 2, rows: 1, bar: 0 }, depth: 0.1 },
    door: { style: { kind: 'sliding', color: '#4a3a2c', glass: { kind: GLASS.shoji, cls: LIGHT_CLASS.window } }, w: 1.8, ht: 1.9 },
    roof: { color: '#2e2f31', mat: NM.kawara, eave: 0.9, soffit: '#3b3027', fascia: '#2e261f' },
    sign: { text: '北谷 里山研究会', fg: '#f2e6c8', bg: '#3a2a1e', font: 'serif', finish: 'wood', vertical: false, h: 0.4 },
  })
  const ff = frontFace(rec)
  // 縁側
  fbox(k.solid, ff.f, 0.3, ff.L - 0.3, -0.9, 0.02, 0.32, 0.4, '#8a6a48', NM.wood, 0)
  for (const s of [0.4, ff.L / 2, ff.L - 0.4]) fbox(k.solid, ff.f, s - 0.06, s + 0.06, -0.86, -0.74, -0.4, 0.32, '#4a3a2a', NM.wood)
  if (isOpenLab(rec)) hirakiFuda(k, ff.f, ff.doorS + 1.2, 1.2, rec)
  return g
}

/** 木造の校舎（白い漆喰と板張り・連なる窓・低い寄棟の黒瓦・玄関の庇） */
export function schoolWood(k: Kit) {
  const rec = k.rec
  const g = generic(k, {
    roofKind: 'hip',
    eave: rec.height ?? 12,
    ridge: (rec.height ?? 12) + 2.6,
    wall: { color: '#ede8dc', mat: NM.plaster },
    wallLower: { color: '#6b5640', mat: NM.siding, aux: 0.18, h: 1.0 },
    win: { w: 2.2, ht: 1.7, sill: 0.9, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 4, rows: 2, bar: 0.04, frame: '#5a4632' }, depth: 0.12, sillTrim: { color: '#5a4632', mat: NM.wood } },
    bay: 3.0,
    door: { style: { kind: 'doubleGlass', color: '#5a4632', glass: { kind: GLASS.office, cls: LIGHT_CLASS.office } }, w: 2.4, ht: 2.5, canopy: { color: '#3a3b3d', mat: NM.kawara, depth: 1.8 } },
    roof: { color: '#333436', mat: NM.kawara, eave: 0.8, soffit: '#e8e2d4', fascia: '#5a4632' },
    sign: { text: '町立丘ノ上中学校', fg: '#1a1a1a', bg: '#e8dcc0', vertical: true, font: 'serif', finish: 'wood', h: 1.6, w: 0.36, at: 0.6 },
    bands: { hs: [4.0, 8.0], ht: 0.14, proj: 0.05, color: '#5a4632', mat: NM.wood },
  })
  return g
}

/** 長方形でなくても使える: データの外形のまま generic */
export function plainHouse(k: Kit) {
  if (!isRect(k.rec.ring)) return generic(k)
  return houseJp(k)
}

void THREE
void frontEdgeOf
