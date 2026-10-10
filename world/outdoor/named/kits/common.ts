import * as THREE from 'three'
import { ROOF } from '../../town/buildingKit'
import type { P2 } from '../../town/townData'
import { Frame, isRect, rectFrame, ringCenter } from '../frame'
import {
  dome,
  fbox,
  flatRoof,
  gableRoof,
  hipRoof,
  irimoyaRoof,
  type DoorStyle,
  type Kit,
  type RoofStyle,
  shedRoof,
  spire,
} from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import type { NamedPart, NamedRecord } from '../namedData'
import { buildBody, cssOf, doorsOnEdge, frontEdgeOf, hexesIn, stepsFor, type BodySpec, type DoorAt, type FaceSpec, type ShopSpec, type Trim, type WinSpec } from '../shell'
import type { SignStyle } from '../signs'

/**
 * 組み立ての型の共通の部品: データの色・材料・屋根の言葉から質感を選ぶ・看板の字・ふつうの長方形の建物（generic）
 */

/* -------------------------------------------------------------------------- */
/* データの言葉から                                                               */
/* -------------------------------------------------------------------------- */

/** 外壁の質感（データの外壁の言葉と外壁の種類から） */
export function wallTrimOf(rec: NamedRecord): Trim & { aux: number } {
  const t = rec.wallText ?? ''
  const c = cssOf(rec.wallColor)
  if (t.startsWith('白い板張り') || t.includes('下見板')) return { color: c, mat: NM.siding, aux: 0.2 }
  if (rec.facade === 0) return { color: c, mat: NM.boardV, aux: 0.18 }
  if (rec.facade === 1) return { color: c, mat: NM.plaster, aux: 0 }
  if (rec.facade === 2) return { color: c, mat: NM.stone, aux: 0.55 }
  if (rec.facade === 3 || rec.facade === 7) return { color: c, mat: NM.brick, aux: 0 }
  if (rec.facade === 5) return { color: c, mat: NM.concrete, aux: 0 }
  if (rec.facade === 6) return { color: c, mat: NM.metalRoof, aux: 0.09 }
  return { color: c, mat: NM.plaster, aux: 0 }
}

/** 屋根の質感（屋根の色の言葉から） */
export function roofStyleOf(rec: NamedRecord, base: Partial<RoofStyle> = {}): RoofStyle {
  const t = rec.roofText ?? ''
  let mat: number = NM.slate
  let color = cssOf(rec.roofColor, 0.85)
  let aux = 0
  if (t.includes('銅') || t.includes('緑青')) {
    mat = NM.copper
    aux = 0.45
    color = cssOf(rec.roofColor, 0.95)
  } else if (t.includes('黒瓦') || t.includes('銀鼠')) {
    mat = NM.kawara
    color = t.includes('黒瓦') ? '#3a3b3d' : '#6f7378'
  } else if (t.includes('茶色の瓦')) {
    mat = NM.kawara
    color = '#5e4537'
  } else if (t.includes('赤茶の瓦') || t.includes('赤い屋根')) {
    mat = NM.tileRoof
  } else if (t.includes('灰色の瓦')) {
    mat = NM.tileRoof
    color = '#6c6b68'
  } else if (t.includes('スレート')) {
    mat = NM.slate
  } else if (t.includes('トタン') || t.includes('赤錆')) {
    mat = NM.metalRoof
    aux = 0.12
  } else if (t.includes('板葺')) {
    mat = NM.wood
    color = cssOf(rec.roofColor, 0.8)
  } else if (t.includes('緑 #2e7d32') || t.startsWith('緑')) {
    mat = NM.metalRoof
    aux = 0
    color = '#2f6b3a'
  } else if (t.includes('白')) {
    mat = NM.metalRoof
    color = '#d8d8d4'
  }
  return { color, mat, aux, eave: 0.55, verge: 0.35, thick: 0.18, soffit: '#5d5248', ...base }
}

/** 屋根の形（データの屋根の言葉から） */
export function roofKindOf(rec: NamedRecord): 'gable' | 'gableT' | 'hip' | 'irimoya' | 'mansard' | 'shed' | 'flat' | 'sawtooth' | 'arch' {
  const t = rec.roofType ?? ''
  if (t.includes('アーチ')) return 'arch'
  if (t.includes('のこぎり')) return 'sawtooth'
  if (t.includes('マンサード')) return 'mansard'
  if (t.includes('片流れ')) return 'shed'
  if (t.includes('入母屋')) return 'irimoya'
  if (t.startsWith('寄棟')) return 'hip'
  if (t.startsWith('切妻')) return t.includes('妻入') ? 'gableT' : 'gable'
  return 'flat'
}

/** 遠くの形の屋根の番号 */
export function massRoofKind(kind: ReturnType<typeof roofKindOf>) {
  return { gable: ROOF.gable, gableT: ROOF.gable, hip: ROOF.hip, irimoya: ROOF.irimoya, mansard: ROOF.mansard, shed: ROOF.shed, flat: ROOF.flat, sawtooth: ROOF.sawtooth, arch: ROOF.arch }[kind]
}

/** 外壁の言葉の 2 つ目の色（「白い石の帯と窓枠 #efe6d2」など）。無ければ fallback */
export function accentOf(rec: NamedRecord, fallback: string) {
  const hs = hexesIn(rec.wallText)
  return hs[1] ?? fallback
}

/** 看板の字: 名前を、主な字と小さな字（店の種類・英字）に分ける */
export function signText(rec: NamedRecord): { main: string; sub?: string } {
  const name = rec.name
  const br = name.match(/^(.*)「(.+)」(.*)$/)
  if (br) return { main: br[2], sub: (br[1] + br[3]).trim() || undefined }
  const paren = name.match(/^(.+?)（(.+)）$/)
  if (paren) return { main: paren[1].trim(), sub: paren[2] }
  const parts = name.split(/\s+/)
  if (parts.length >= 2 && name.length > 7) return { main: parts.slice(1).join(' '), sub: parts[0] }
  return { main: name }
}

/** 公開ラボか（ひらき札を付ける） */
export function isOpenLab(rec: NamedRecord) {
  return (rec.kind ?? '').includes('公開ラボ')
}

/** ひらき札（若葉色の小さな札。公開ラボの入口の横） */
export function hirakiFuda(k: Kit, f: Frame, s: number, h: number, rec: NamedRecord) {
  const m = (rec.kind ?? '').match(/第(.)種/)
  const kind = m ? `第${m[1]}種` : ''
  fbox(k.solid, f, s - 0.02, s + 0.34, -0.03, 0.01, h - 0.02, h + 0.5, '#7fbf3f', NM.paint, 0.5)
  k.sign(f, s, h, 0.32, 0.46, -0.035, { text: 'ひらき\n公開ラボ', sub: kind, fg: '#ffffff', bg: '#6aa832', font: 'sans', bold: true }, 0)
}

/* -------------------------------------------------------------------------- */
/* ふつうの長方形の建物                                                           */
/* -------------------------------------------------------------------------- */

export interface GenericOpts {
  ring?: P2[]
  wall?: Trim & { aux?: number }
  wallLower?: BodySpec['wallLower']
  roofKind?: ReturnType<typeof roofKindOf>
  roof?: Partial<RoofStyle>
  floors?: number
  groundH?: number
  floorH?: number
  /** 壁の上端（床から）・棟の高さ（床から） */
  eave?: number
  ridge?: number
  win?: WinSpec | null
  groundWin?: WinSpec | null
  sideWin?: WinSpec | null
  backWin?: WinSpec | null
  shop?: ShopSpec | null
  /** 正面の 1 階（windows・shop・none）と、正面にそのまま足す開口 */
  frontGround?: 'windows' | 'shop' | 'none'
  frontOpenings?: import('../kit').Opening[]
  /** 正面に扉を付けない（組み立ての型が開口で作る） */
  noFrontDoor?: boolean
  /** 正面の窓の間口 */
  bay?: number
  plinth?: BodySpec['plinth']
  bands?: BodySpec['bands']
  cornice?: BodySpec['cornice']
  quoins?: Trim
  parapet?: number
  coping?: string
  roofDeck?: string
  door?: Partial<DoorAt> & { style?: DoorStyle }
  /** 名前の看板（正面の壁。shop の時は店先の帯） */
  sign?: (Omit<SignStyle, 'w' | 'h'> & { h?: number; w?: number; at?: number; mode?: number }) | null
  /** 遠くの形の外壁の種類・屋根の番号 */
  massFacade?: number
  /** 建物の部分（塔・ドーム・煙突など）を作るか（false なら作らない。関数なら、その部分を作るか） */
  parts?: boolean | ((p: NamedPart) => boolean)
}

/** 外形の各辺の扉（データの入口から） */
export function doorsFor(rec: NamedRecord, ring: P2[], z: number, style: DoorStyle, w = 1.0, ht = 2.2, extra: Partial<DoorAt> = {}): DoorAt[][] {
  return ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length]
    return doorsOnEdge(rec, p, q, z).map(({ s, e, index }) => ({
      s,
      w,
      ht,
      style: style.operable !== undefined ? { ...style, operable: index } : style,
      steps: stepsFor(z, e.ground),
      lamp: 'lantern' as const,
      ...extra,
    }))
  })
}

/**
 * ふつうの長方形の建物（壁・窓・扉・店先・屋根・看板）。戻り値の frame は正面の面（s = 正面の左から、t = 奥へ）
 */
export function generic(k: Kit, o: GenericOpts = {}) {
  const rec = k.rec
  const ring = o.ring ?? rec.ring
  const z = rec.z
  const floors = Math.max(1, o.floors ?? rec.floors ?? 1)
  const eave = o.eave ?? Math.max(2.4, rec.height ?? floors * 3)
  let ridge = o.ridge ?? Math.max(eave, rec.roofHeight ?? eave)
  const roofKind = o.roofKind ?? roofKindOf(rec)
  if (roofKind === 'flat') ridge = eave
  const groundH = o.groundH ?? (floors === 1 ? eave : Math.min(4.2, Math.max(2.7, eave / floors + (o.shop ? 0.4 : 0))))
  const floorH = o.floorH ?? (floors > 1 ? (eave - groundH) / (floors - 1) : eave)
  const wall = o.wall ?? wallTrimOf(rec)
  const frontEdge = frontEdgeOf(ring, rec.front)
  const bottom = Math.min(rec.gLow, rec.zMin ?? rec.z) - z - 0.4
  const style = (o.door?.style ?? { kind: 'panel', color: '#4a3324' }) as DoorStyle
  const doors = doorsFor(rec, ring, z, style, o.door?.w ?? 1.0, o.door?.ht ?? Math.min(2.3, groundH - 0.3), o.door)
  // 正面に入口が無ければ、正面の中央に扉
  if (!doors[frontEdge].length && !o.noFrontDoor) {
    const p = ring[frontEdge]
    const q = ring[(frontEdge + 1) % ring.length]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    doors[frontEdge].push({ s: L / 2, w: o.door?.w ?? 1.0, ht: o.door?.ht ?? Math.min(2.3, groundH - 0.3), style, steps: 0, lamp: 'lantern', ...o.door })
  }
  const parapet = roofKind === 'flat' ? (o.parapet ?? 0.9) : 0
  const top = eave + (roofKind === 'flat' ? 0 : 0)
  const winDefault: WinSpec = { w: 1.1, ht: Math.min(1.6, floorH * 0.55), sill: 0.85, glass: { kind: GLASS.house, cls: LIGHT_CLASS.window, cols: 2, rows: 1 } }
  const win = o.win === undefined ? winDefault : o.win
  const faces: (FaceSpec | null)[] = ring.map((_, i) => {
    const isFront = i === frontEdge
    const w = isFront ? win : (i - frontEdge + ring.length) % ring.length === 2 ? (o.backWin === undefined ? win : o.backWin) : o.sideWin === undefined ? win : o.sideWin
    return {
      win: w,
      bay: isFront ? (o.bay ?? 2.6) : 3.0,
      ground: isFront ? (o.frontGround ?? (o.shop ? 'shop' : 'windows')) : 'windows',
      groundWin: o.groundWin,
      shop: isFront && o.shop ? o.shop : undefined,
      doors: isFront && o.noFrontDoor ? [] : doors[i],
      openings: isFront ? o.frontOpenings : undefined,
    }
  })
  k.mass.st = {
    wall: rec.wallColor,
    facade: o.massFacade ?? rec.facade,
    roof: rec.roofColor,
    roofKind: massRoofKind(roofKind),
    use: rec.use,
    flags: 1 | (o.shop ? 16 : 0),
    seed: k.seed,
    style: rec.style,
    floors,
  }
  const body = buildBody(k, {
    ring,
    z,
    bottom,
    floors,
    floorH,
    groundH,
    top: top + (roofKind === 'flat' ? parapet : 0),
    wall,
    wallLower: o.wallLower,
    plinth: o.plinth,
    bands: o.bands,
    cornice: o.cornice,
    quoins: o.quoins,
    faces,
    frontEdge,
    windowTop: eave - 0.4,
  })
  // 屋根
  const rf = rectFrame(ring, rec.front, z)
  const st = roofStyleOf(rec, o.roof)
  const rect = isRect(ring)
  if (roofKind === 'flat' || !rect) {
    flatRoof(k, ring, z, top + parapet, roofKind === 'flat' ? parapet : 0.5, wall.color, wall.mat, o.roofDeck ?? (rec.roofText?.includes('緑化') || rec.roofText?.includes('庭園') ? '#5d7a3e' : '#7d7b76'), o.coping ?? '#b8b3a8', wall.aux ?? 0)
    if (!rect && roofKind !== 'flat') {
      // 長方形でない勾配の屋根は、低い寄せ棟の帽子（重心へ）
      const c = ringCenter(ring)
      const r = Math.sqrt(Math.abs(areaOf(ring)) / Math.PI)
      spire(k, c[0], c[1], z + top + 0.5, r * 0.9, Math.min(ridge - eave, r * 0.5), Math.max(4, ring.length), st.color, st.mat, st.aux ?? 0)
    }
  } else {
    roofOnRect(k, rf.frame, rf.W, rf.D, eave, ridge, roofKind, st, wall)
  }
  // 看板（正面の壁の上の方。店先のある建物は店先の帯）
  if (o.sign !== null && !o.shop) {
    const sg = o.sign ?? { text: signText(rec).main, sub: signText(rec).sub, fg: '#f5f1e6', bg: '#2a2622', font: 'serif' as const }
    const f = body[frontEdge].f
    const L = body[frontEdge].L
    const sh = sg.h ?? 0.55
    const sw = Math.min(L - 0.6, sg.w ?? Math.max(1.4, sh * Math.max(3, [...sg.text].length * 0.9)))
    const at = sg.at ?? Math.min(groundH + 0.1, eave - sh - 0.3)
    k.sign(f, L / 2 - sw / 2, at, sw, sh, -0.06, sg, sg.mode ?? 2)
  }
  if (o.parts !== false) for (const p of rec.parts) if (typeof o.parts !== 'function' || o.parts(p)) buildPart(k, p, wall)
  return { frame: rf.frame, W: rf.W, D: rf.D, eave, ridge, groundH, floorH, floors, body, frontEdge, wall, roof: st }
}

/**
 * 建物の部分のふつうの形: ドーム（円筒の胴と半球）・煙突（円筒）・尖塔（角の塔と角錐）・塔（窓のある角の塔と低い屋根）・上屋（切妻）・ほかは箱
 */
export function buildPart(k: Kit, p: NamedPart, wall: Trim & { aux?: number }) {
  const z = p.z ?? k.rec.z
  const H = p.height ?? 10
  const c = ringCenter(p.ring)
  const r = p.ring.reduce((m, q) => m + Math.hypot(q[0] - c[0], q[1] - c[1]), 0) / p.ring.length
  const kind = `${p.partKind ?? ''}${p.name ?? ''}${p.roofType ?? ''}`
  const st = roofStyleOf(k.rec)
  const LABY = (zz: number) => zz - 116
  if (kind.includes('煙突')) {
    const rr = Math.max(0.5, r)
    k.solid.cylinder([c[0], LABY(z - 0.5), -c[1]], rr, H + 0.5, 16, '#8e4a36', NM.brick, 0, true, rr * 0.82)
    k.solid.cylinder([c[0], LABY(z + H - 0.4), -c[1]], rr * 0.9, 0.45, 16, '#5a3a2e', NM.concrete, 0, true)
    massCylinder(k, c, rr, z, z + H)
    return
  }
  if (kind.includes('ドーム')) {
    const base = (p.base_height_m as number | undefined) ?? Math.max(0, H - r * 1.05)
    const drum = (p.drum_height_m as number | undefined) ?? 0
    const rr = r
    if (base + drum > 0.2) {
      k.solid.cylinder([c[0], LABY(z - 0.5), -c[1]], rr, base + drum + 0.5, 32, wall.color, wall.mat, wall.aux ?? 0, false)
      massCylinder(k, c, rr, z, z + base + drum)
    }
    const white = (p.roofType ?? '').includes('白') || (p.roofColor ?? '').includes('白') || (k.rec.roofText ?? '').includes('白')
    dome(k, c[0], c[1], z + base + drum, rr, Math.max(0.6, H - base - drum), white ? '#e8e6e0' : st.color, white ? NM.paint : st.mat, white ? 0.5 : (st.aux ?? 0))
    return
  }
  const ring = p.ring
  const top = kind.includes('尖塔') ? H * 0.45 : kind.includes('塔') ? H - Math.min(4, r * 1.2) : H
  k.mass.st = { ...k.mass.st, floors: Math.max(1, Math.round(top / 3.6)) }
  buildBody(k, {
    ring,
    z,
    bottom: -0.6,
    floors: Math.max(1, Math.round(top / 3.6)),
    floorH: 3.6,
    top,
    wall,
    faces: ring.map(() => ({ win: kind.includes('上屋') || kind.includes('車庫') ? null : { w: 0.9, ht: 1.5, sill: 1.0, glass: { kind: GLASS.dark, cls: LIGHT_CLASS.office, cols: 1, rows: 2 } }, bay: 3 })),
    frontEdge: -1,
  })
  if (kind.includes('尖塔')) spire(k, c[0], c[1], z + top, r * 1.05, H - top, Math.max(4, ring.length), st.color, st.mat, st.aux ?? 0, Math.atan2(ring[0][1] - c[1], ring[0][0] - c[0]))
  else if (kind.includes('塔')) spire(k, c[0], c[1], z + top, r * 1.05, H - top, Math.max(4, ring.length), st.color, st.mat, st.aux ?? 0, Math.atan2(ring[0][1] - c[1], ring[0][0] - c[0]))
  else if (isRect(ring) && (kind.includes('上屋') || kind.includes('車庫'))) {
    const rf = rectFrame(ring, null, z)
    gableRoof(k, rf.frame, rf.W, rf.D, top, top + 1.2, { ...st, gable: { color: wall.color, mat: wall.mat } })
  } else flatRoof(k, ring, z, top, 0.4, wall.color, wall.mat)
}

/** 遠くの形の円筒（12 角） */
export function massCylinder(k: Kit, c: P2, r: number, z0: number, z1: number) {
  const n = 12
  const ring: P2[] = []
  for (let i = 0; i < n; i++) ring.push([c[0] + Math.cos((i / n) * Math.PI * 2) * r, c[1] + Math.sin((i / n) * Math.PI * 2) * r])
  k.mass.prism(ring, z0, z1, z0, 0, true)
}

function areaOf(ring: P2[]) {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

/** 長方形の屋根（屋根の形の言葉の種類で） */
export function roofOnRect(k: Kit, f: Frame, W: number, D: number, eave: number, ridge: number, kind: ReturnType<typeof roofKindOf>, st: RoofStyle, wall: Trim & { aux?: number }) {
  const gable = st.gable ?? { color: wall.color, mat: wall.mat, aux: wall.aux }
  const r = Math.max(ridge, eave + 0.6)
  if (kind === 'gable') gableRoof(k, f, W, D, eave, r, { ...st, gable })
  else if (kind === 'gableT') {
    // 妻入り: 棟は奥への向き（右の側面から見た切妻）
    const g = f.turnRight(W)
    gableRoof(k, g, D, W, eave, r, { ...st, gable })
  } else if (kind === 'hip') hipRoof(k, f, W, D, eave, r, st)
  else if (kind === 'irimoya') irimoyaRoof(k, f, W, D, eave, r, { ...st, gable: st.gable ?? { color: '#3b2e22', mat: NM.wood } })
  else if (kind === 'mansard') {
    hipRoof(k, f, W, D, eave, eave + (r - eave) * 0.7, st)
  } else if (kind === 'shed') shedRoof(k, f, W, D, eave, r, { ...st, gable })
  else if (kind === 'sawtooth') sawtoothRoof(k, f, W, D, eave, r, st, wall)
}

/** のこぎり屋根（北向きの明かり取りの窓）。棟は s の向き、山は t の向きに並ぶ */
export function sawtoothRoof(k: Kit, f: Frame, W: number, D: number, eave: number, ridge: number, st: RoofStyle, wall: Trim & { aux?: number }) {
  const n = Math.max(2, Math.round(D / 7))
  const dd = D / n
  const b = k.solid
  for (let i = 0; i < n; i++) {
    const t0 = i * dd
    const t1 = t0 + dd
    // 斜面（t0 の高い所から t1 の低い所へ）と、縦の明かり取り（t0 の面。ガラス）
    b.quad(f.p(-0.2, t1, eave), f.p(W + 0.2, t1, eave), f.p(W + 0.2, t0, ridge), f.p(-0.2, t0, ridge), st.color, st.mat, st.aux ?? 0)
    b.quad(f.p(W, t0, eave), f.p(0, t0, eave), f.p(0, t0, ridge), f.p(W, t0, ridge), wall.color, wall.mat, wall.aux ?? 0)
    for (const sx of [0, W]) b.polygon(sx === 0 ? [f.p(0, t1, eave), f.p(0, t0, eave), f.p(0, t0, ridge)] : [f.p(W, t0, eave), f.p(W, t1, eave), f.p(W, t0, ridge)], wall.color, wall.mat, wall.aux ?? 0)
    // 明かり取りのガラス（裏向きの縦の面に帯）
    const fb = f.shift(0, t0 - 0.03)
    k.glass.add(
      [fb.p(0.4, 0, eave + 0.3), fb.p(W - 0.4, 0, eave + 0.3), fb.p(W - 0.4, 0, ridge - 0.3), fb.p(0.4, 0, ridge - 0.3)],
      [new THREE.Vector2(0, 0), new THREE.Vector2(W - 0.8, 0), new THREE.Vector2(W - 0.8, ridge - eave - 0.6), new THREE.Vector2(0, ridge - eave - 0.6)],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
      W - 0.8,
      ridge - eave - 0.6,
      fb.out,
      { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: Math.round(W / 1.5), rows: 2, bar: 0.05, frame: '#3d4144', depth: 8 },
    )
    const P = (s: number, t: number, h: number) => [...f.plan(s, t), f.z0 + h]
    k.mass.roofQuad(P(-0.2, t1, eave), P(W + 0.2, t1, eave), P(W + 0.2, t0, ridge), P(-0.2, t0, ridge))
    k.mass.wallQuad(f.plan(0, t0), f.plan(W, t0), f.z0 + eave, f.z0 + ridge, f.z0, 0)
  }
}
