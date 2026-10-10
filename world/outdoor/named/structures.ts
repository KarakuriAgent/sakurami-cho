import * as THREE from 'three'
import type { P2 } from '../town/townData'
import { Frame, rectFrame, ringCenter, type V3 } from './frame'
import { dome, fbox, gableRoof, hipRoof, type Kit, Kit as KitClass, spire, steps } from './kit'
import type { KitContext } from './kits'
import { stoneLantern } from './kits/religious'
import { GLASS, LIGHT_CLASS, NM } from './namedMaterial'
import type { NamedRecord, NamedStructure } from './namedData'
import { railing } from './parts'

/**
 * 構造物（ガントリークレーン・灯台・記念塔・鐘楼・アーク灯・門・銅像・墓・貝塚・塩釜の石組み・天文台の擁壁・名前のある大木のまわり）の外観。
 * 名前のある建物と同じ Kit で作り、近くは細かい形、遠くは安い形にする。観覧車ソラノワのホイール・大パラボラ（site/）・屋内の滝は別
 */

const LAB = 116

export interface StructureEntry {
  kit: Kit
  name: string
  center: [number, number]
  radius: number
}

/** 構造物から、Kit の仮の記録 */
export function pseudoRecord(s: NamedStructure): NamedRecord {
  const ring = s.geom.type === 'ring' ? s.geom.ring : s.geom.type === 'point' ? [s.geom.at] : s.geom.type === 'line' ? s.geom.pts : []
  return {
    id: s.id,
    name: s.name ?? s.id,
    kind: s.kind,
    use: 6,
    useText: null,
    district: null,
    style: 0,
    drawn: true,
    ring,
    z: s.z,
    zMin: null,
    zMax: null,
    gLow: s.ground,
    gHigh: s.ground,
    floors: 1,
    height: s.height,
    roofHeight: s.height,
    roofType: null,
    roofText: null,
    roofColor: [120, 120, 120],
    wallText: null,
    wallColor: [200, 200, 200],
    material: null,
    facade: 5,
    front: (s.front_bearing_deg as number | undefined) ?? null,
    frontEdge: null,
    entrances: [],
    parts: [],
    tenants: [],
    sites: [],
    rooms: [],
    extra: {},
  }
}

/** 構造物の種類 → 作る関数（無い種類は作らない） */
const BUILDERS: { test: (s: NamedStructure) => boolean; name: string; fn: (k: Kit, s: NamedStructure, ctx: KitContext) => void }[] = [
  { name: 'crane', test: (s) => (s.kind ?? '').includes('クレーン'), fn: crane },
  { name: 'lighthouse', test: (s) => (s.kind ?? '').startsWith('灯台'), fn: lighthouse },
  { name: 'tower', test: (s) => s.kind === '塔', fn: memorialTower },
  { name: 'belfry', test: (s) => (s.kind ?? '').includes('鐘楼'), fn: belfry },
  { name: 'arcLamp', test: (s) => (s.kind ?? '').includes('アーク灯'), fn: arcLamp },
  { name: 'gate', test: (s) => s.kind === '門', fn: gate },
  { name: 'statue', test: (s) => (s.kind ?? '').includes('銅像'), fn: statue },
  { name: 'grave', test: (s) => (s.kind ?? '').startsWith('墓'), fn: grave },
  { name: 'marker', test: (s) => (s.kind ?? '').includes('貝塚'), fn: kaizuka },
  { name: 'stones', test: (s) => (s.kind ?? '').includes('石組み'), fn: shiogama },
  { name: 'wall', test: (s) => s.kind === '擁壁' && s.geom.type === 'line', fn: retainingWall },
  { name: 'bigTree', test: (s) => (s.kind ?? '').startsWith('樹木（') && s.geom.type === 'ring', fn: bigTree },
]

/** 構造物を作る */
export function buildStructureKits(list: NamedStructure[], ctx: KitContext): StructureEntry[] {
  const out: StructureEntry[] = []
  for (const s of list) {
    const b = BUILDERS.find((x) => x.test(s))
    if (!b) continue
    const k = new KitClass(pseudoRecord(s))
    try {
      b.fn(k, s, ctx)
    } catch (e) {
      console.error(`[named] 構造物 ${s.id} を作れませんでした`, e)
      continue
    }
    const pts = k.rec.ring.length ? k.rec.ring : [[0, 0] as P2]
    const c = ringCenter(pts.length >= 3 ? pts : [...pts, ...pts, ...pts])
    const radius = pts.reduce((m, q) => Math.max(m, Math.hypot(q[0] - c[0], q[1] - c[1])), 0)
    out.push({ kit: k, name: `structure:${b.name}`, center: c, radius })
  }
  return out
}

/** 構造物の作る種類（infraMeshes が形を作らない種類の判定に使う） */
export const NAMED_STRUCTURE_TYPES = ['crane', 'lighthouse', 'monument', 'belfry', 'lamppost', 'gate', 'statue'] as const

/* -------------------------------------------------------------------------- */
/* ガントリークレーン                                                             */
/* -------------------------------------------------------------------------- */

/** ガントリークレーン（赤と白。4 本の脚と横の梁・筋かい・海へ張り出す腕とトラス・機械室・運転室・ワイヤー） */
function crane(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'ring') return
  const ring = s.geom.ring
  const rf = rectFrame(ring, null, s.z)
  const { frame: f, W, D } = rf
  const H = s.height ?? 48
  const red = '#c62828'
  const white = '#eeeeec'
  const b = k.solid
  k.solid.groundY = s.z - LAB
  k.mass.st = { wall: [198, 40, 40], facade: 6, roof: [238, 238, 236], roofKind: 0, use: 4, flags: 1, seed: k.seed, style: 6, floors: 1 }
  const gh = H - 10
  // 脚（4 本）と、脚の下の走行台車
  const legs: [number, number][] = [
    [0.8, 0.8],
    [W - 0.8, 0.8],
    [W - 0.8, D - 0.8],
    [0.8, D - 0.8],
  ]
  for (const [ls, lt] of legs) {
    fbox(b, f, ls - 0.8, ls + 0.8, lt - 0.8, lt + 0.8, 0.8, gh, red, NM.paint, 0.5)
    fbox(b, f, ls - 1.8, ls + 1.8, lt - 1.0, lt + 1.0, 0, 1.0, '#3a3a38', NM.iron)
  }
  // 横の梁（脚の中ほどと上）と筋かい
  for (const h of [gh * 0.45, gh - 1.4]) {
    fbox(b, f, 0, W, 0.2, 1.4, h - 0.7, h + 0.7, red, NM.paint, 0.5)
    fbox(b, f, 0, W, D - 1.4, D - 0.2, h - 0.7, h + 0.7, red, NM.paint, 0.5)
    fbox(b, f, 0.2, 1.4, 0, D, h - 0.6, h + 0.6, red, NM.paint, 0.5)
    fbox(b, f, W - 1.4, W - 0.2, 0, D, h - 0.6, h + 0.6, red, NM.paint, 0.5)
  }
  for (const t of [0.8, D - 0.8]) {
    b.beam(f.p(0.8, t, 1.2), f.p(W - 0.8, t, gh * 0.45 - 0.7), 0.35, red, NM.paint, 0.5)
    b.beam(f.p(W - 0.8, t, 1.2), f.p(0.8, t, gh * 0.45 - 0.7), 0.35, red, NM.paint, 0.5)
  }
  // 腕（海の側へ長く、陸の側へ短く）のトラス: 上弦・下弦と斜め材
  const boomDeg = (s.boom_bearing_deg as number | undefined) ?? 270
  const bv = [Math.sin((boomDeg * Math.PI) / 180), Math.cos((boomDeg * Math.PI) / 180)]
  const c = f.plan(W / 2, D / 2)
  const reach = 50
  const back = 22
  const zb = s.z + gh
  const P = (dist: number, side: number, h: number): V3 => [c[0] + bv[0] * dist - bv[1] * side, zb + h - LAB, -(c[1] + bv[1] * dist + bv[0] * side)]
  for (const side of [-1.4, 1.4]) {
    b.beam(P(-back, side, 0), P(reach, side, 0), 0.5, white, NM.paint, 0.5, 0.6)
    b.beam(P(-back, side, 3.2), P(reach * 0.92, side, 2.6), 0.4, white, NM.paint, 0.5)
    for (let d = -back; d < reach - 4; d += 4) b.beam(P(d, side, 0), P(d + 4, side, 3.2 - (Math.max(0, d) / reach) * 0.6), 0.18, white, NM.paint, 0.5)
  }
  for (let d = -back; d < reach; d += 4) b.beam(P(d, -1.4, 0), P(d, 1.4, 0), 0.18, white, NM.paint, 0.5)
  // 頂のマスト（A 形）と引っ張りの棒
  b.beam(P(0, -2.5, 0), P(2, 0, 10), 0.6, red, NM.paint, 0.5)
  b.beam(P(0, 2.5, 0), P(2, 0, 10), 0.6, red, NM.paint, 0.5)
  b.beam(P(2, 0, 10), P(reach * 0.75, 0, 3), 0.12, '#2a2a2a', NM.iron)
  b.beam(P(2, 0, 10), P(-back + 2, 0, 3), 0.12, '#2a2a2a', NM.iron)
  // 機械室（白い箱）・運転室・トロリーとワイヤー・つり具
  const mc = P(-back + 6, 0, 1.2)
  b.box([mc[0], mc[1] + 1.6, mc[2]], [8, 3.2, 6], white, NM.paint, 0.4, -Math.atan2(bv[1], bv[0]))
  const tr = P(reach * 0.55, 0, -0.8)
  b.box([tr[0], tr[1], tr[2]], [3, 1.6, 4], '#d0d0cc', NM.paint, 0.4, -Math.atan2(bv[1], bv[0]))
  b.box([tr[0], tr[1] - 2.2, tr[2]], [2.2, 2.0, 2.0], '#d8d8d4', NM.paint, 0.4, -Math.atan2(bv[1], bv[0]))
  k.glass.add([[tr[0] - 1.0, tr[1] - 2.0, tr[2] + 1.01], [tr[0] + 1.0, tr[1] - 2.0, tr[2] + 1.01], [tr[0] + 1.0, tr[1] - 1.4, tr[2] + 1.01], [tr[0] - 1.0, tr[1] - 1.4, tr[2] + 1.01]], [new THREE.Vector2(0, 0), new THREE.Vector2(2, 0), new THREE.Vector2(2, 0.6), new THREE.Vector2(0, 0.6)], [[0, 1, 2], [0, 2, 3]], 2, 0.6, [0, 0, 1], { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 1, bar: 0.04 })
  for (const dx of [-0.8, 0.8]) b.beam([tr[0] + dx * bv[1], tr[1] - 0.8, tr[2] + dx * bv[0]], [tr[0] + dx * bv[1], tr[1] - 22, tr[2] + dx * bv[0]], 0.05, '#2a2a2a', NM.iron)
  b.box([tr[0], tr[1] - 22.6, tr[2]], [2.4, 1.0, 6.5], '#e0b020', NM.paint, 0.4, -Math.atan2(bv[1], bv[0]))
  // 夜の灯り（腕の先の航空障害灯・作業灯）
  const tip = P(reach, 0, 3)
  k.lights.push({ x: tip[0], y: -tip[2], z: tip[1] + LAB, kind: 6, color: '#ff3a2a', size: 1.6, power: 1.4, seed: 0.15 })
  const lamp = P(0, 0, -2)
  k.lights.push({ x: lamp[0], y: -lamp[2], z: lamp[1] + LAB, kind: 2, color: '#ffdcae', size: 2.6, power: 1.8, seed: 0.1 })
  k.glow.box([tip[0], tip[1] + 0.4, tip[2]], [0.4, 0.4, 0.4], '#ff3a2a', 0, 4)
  // 遠くの形
  const m = k.mass
  for (const [ls, lt] of legs) m.prism([f.plan(ls - 0.8, lt - 0.8), f.plan(ls + 0.8, lt - 0.8), f.plan(ls + 0.8, lt + 0.8), f.plan(ls - 0.8, lt + 0.8)], s.z, s.z + gh, s.z, 0)
  const bp = (d: number, side: number): P2 => [c[0] + bv[0] * d - bv[1] * side, c[1] + bv[1] * d + bv[0] * side]
  m.prism([bp(-back, -1.5), bp(reach, -1.5), bp(reach, 1.5), bp(-back, 1.5)], zb - 0.3, zb + 3, s.z, 0)
}

/* -------------------------------------------------------------------------- */
/* 灯台                                                                         */
/* -------------------------------------------------------------------------- */

/** 灯台（防波堤の赤・白の灯台と、汐見島の白い石の灯塔。回廊と手すり・灯室のガラス・黒い屋根） */
function lighthouse(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'ring') return
  const c = ringCenter(s.geom.ring)
  const r = s.geom.ring.reduce((m, q) => m + Math.hypot(q[0] - c[0], q[1] - c[1]), 0) / s.geom.ring.length
  const H = s.height ?? 14
  const main = (s.name ?? '').includes('汐見島')
  const colorText = (s.color as string | undefined) ?? ''
  const red = colorText.startsWith('赤')
  const body = red ? '#c0392b' : '#f2f1ec'
  const z = s.z
  const b = k.solid
  k.mass.st = { wall: red ? [192, 57, 43] : [242, 241, 236], facade: main ? 2 : 5, roof: [28, 30, 34], roofKind: 0, use: 6, flags: 1, seed: k.seed, style: 7, floors: 1 }
  const towerH = H - (main ? 4.6 : 3.4)
  const rTop = r * (main ? 0.78 : 0.7)
  // 台（石・コンクリート）と塔（上ほど細い）
  b.cylinder([c[0], z - 1.5 - LAB, -c[1]], r * 1.35, 2.3, 24, '#9a9890', main ? NM.stone : NM.concrete, 0.4, true)
  b.cylinder([c[0], z + 0.8 - LAB, -c[1]], r, towerH - 0.8, 28, body, main ? NM.stone : NM.paint, main ? 0.0 : 0.5, false, rTop)
  if (main) {
    // 石の灯塔の小さな窓と入口
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1
      const h = 3 + i * 3.5
      const rr = r - ((r - rTop) * h) / towerH + 0.02
      k.glass.add(
        [
          [c[0] + Math.cos(a - 0.08) * rr, z + h - LAB, -(c[1] + Math.sin(a - 0.08) * rr)],
          [c[0] + Math.cos(a + 0.08) * rr, z + h - LAB, -(c[1] + Math.sin(a + 0.08) * rr)],
          [c[0] + Math.cos(a + 0.08) * rr, z + h + 0.9 - LAB, -(c[1] + Math.sin(a + 0.08) * rr)],
          [c[0] + Math.cos(a - 0.08) * rr, z + h + 0.9 - LAB, -(c[1] + Math.sin(a - 0.08) * rr)],
        ],
        [new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 0.9), new THREE.Vector2(0, 0.9)],
        [[0, 1, 2], [0, 2, 3]],
        0.5,
        0.9,
        [Math.cos(a), 0, -Math.sin(a)],
        { kind: GLASS.dark, cls: LIGHT_CLASS.none, cols: 1, rows: 2, bar: 0.03 },
      )
    }
  } else {
    // 防波堤灯台の白い帯（赤い塔）・赤い帯（白い塔は無し）
    if (red) b.cylinder([c[0], z + towerH * 0.55 - LAB, -c[1]], r - ((r - rTop) * 0.55) + 0.02, 0.8, 28, '#f2f1ec', NM.paint, 0.5, false, r - ((r - rTop) * 0.6) + 0.02)
  }
  // 回廊（張り出した床と手すり）
  const gz = z + towerH
  b.cylinder([c[0], gz - LAB, -c[1]], rTop + 0.9, 0.3, 28, '#2a2c2e', NM.iron, 0.4, true, rTop + 0.9, true)
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2
    const a1 = ((i + 1) / 24) * Math.PI * 2
    const Q = (a: number, h: number): V3 => [c[0] + Math.cos(a) * (rTop + 0.85), gz + 0.3 + h - LAB, -(c[1] + Math.sin(a) * (rTop + 0.85))]
    b.beam(Q(a0, 1.0), Q(a1, 1.0), 0.05, '#2a2c2e', NM.iron)
    b.beam(Q(a0, 0), Q(a0, 1.0), 0.04, '#2a2c2e', NM.iron)
  }
  // 灯室（ガラスの円筒・中の光）・黒い屋根・風見
  const lr = rTop * 0.75
  b.cylinder([c[0], gz + 0.3 - LAB, -c[1]], lr, 0.6, 16, '#2a2c2e', NM.iron, 0.4, false)
  k.glow.cylinder([c[0], gz + 0.9 - LAB, -c[1]], lr * 0.98, main ? 2.0 : 1.4, 16, main ? '#fff4d8' : red ? '#ff6a5a' : '#8affb0', 0, main ? 2.4 : 1.6, false)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    b.beam([c[0] + Math.cos(a) * lr, gz + 0.9 - LAB, -(c[1] + Math.sin(a) * lr)], [c[0] + Math.cos(a) * lr, gz + 0.9 + (main ? 2.0 : 1.4) - LAB, -(c[1] + Math.sin(a) * lr)], 0.06, '#1c1e22', NM.iron)
  }
  const rz = gz + 0.9 + (main ? 2.0 : 1.4)
  dome(k, c[0], c[1], rz, lr * 1.15, lr * 0.9, '#1c1e22', NM.iron, 0.6, 16, 5)
  b.beam([c[0], rz + lr * 0.9 - LAB, -c[1]], [c[0], rz + lr * 0.9 + 0.9 - LAB, -c[1]], 0.05, '#1c1e22', NM.iron)
  k.mass.prism(
    Array.from({ length: 12 }, (_, i) => [c[0] + Math.cos((i / 12) * Math.PI * 2) * r, c[1] + Math.sin((i / 12) * Math.PI * 2) * r] as P2),
    z,
    z + towerH,
    z,
    0,
  )
}

/* -------------------------------------------------------------------------- */
/* 記念塔・鐘楼・アーク灯・門                                                       */
/* -------------------------------------------------------------------------- */

/** 緑光博記念塔（白い細い塔・上の風向計と風速計） */
function memorialTower(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'ring') return
  const c = ringCenter(s.geom.ring)
  const r = 2.6
  const H = s.height ?? 24
  const z = s.z
  const b = k.solid
  k.mass.st = { wall: [240, 240, 236], facade: 5, roof: [240, 240, 236], roofKind: 0, use: 6, flags: 1, seed: k.seed, style: 0, floors: 1 }
  b.cylinder([c[0], z - 0.5 - LAB, -c[1]], r + 0.8, 1.3, 20, '#c8c4bc', NM.granite, 0, true)
  // 3 枚の白い羽根の柱（三角の配置）
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const p0: V3 = [c[0] + Math.cos(a) * r * 0.75, z + 0.8 - LAB, -(c[1] + Math.sin(a) * r * 0.75)]
    const p1: V3 = [c[0] + Math.cos(a) * 0.4, z + H - 3 - LAB, -(c[1] + Math.sin(a) * 0.4)]
    b.beam(p0, p1, 0.7, '#f2f2ee', NM.paint, 0.6, 0.22, a)
  }
  b.cylinder([c[0], z + H - 3.2 - LAB, -c[1]], 0.6, 1.2, 12, '#e8e8e4', NM.paint, 0.5, true)
  b.beam([c[0], z + H - 2 - LAB, -c[1]], [c[0], z + H + 0.5 - LAB, -c[1]], 0.08, '#c8ccd0', NM.steel)
  // 風速計（3 つのカップ）と風向計（矢羽根）
  const top = z + H - 0.6
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const q: V3 = [c[0] + Math.cos(a) * 0.5, top - LAB, -(c[1] + Math.sin(a) * 0.5)]
    b.beam([c[0], top - LAB, -c[1]], q, 0.03, '#c8ccd0', NM.steel)
    b.cylinder([q[0], q[1] - 0.06, q[2]], 0.09, 0.12, 8, '#e8e8e4', NM.paint, 0.5, true)
  }
  b.beam([c[0] - 0.7, top + 0.6 - LAB, -c[1]], [c[0] + 0.7, top + 0.6 - LAB, -c[1]], 0.04, '#c8ccd0', NM.steel)
  b.box([c[0] + 0.7, top + 0.6 - LAB, -c[1]], [0.3, 0.25, 0.02], '#e8e8e4', NM.paint, 0.5)
  k.sign(Frame.facing(c[0], c[1] - r - 0.81, 180, z), -0.9, 0.0, 1.8, 0.6, 0, { text: '緑光博記念塔', sub: "'02", fg: '#2a2a2a', bg: '#d8d4ca', font: 'serif' }, 0)
  k.lights.push({ x: c[0], y: c[1], z: z + H + 0.6, kind: 6, color: '#ff3a2a', size: 1.2, power: 1.2, seed: 0.3 })
  k.mass.prism(Array.from({ length: 6 }, (_, i) => [c[0] + Math.cos((i / 6) * Math.PI * 2) * 1.6, c[1] + Math.sin((i / 6) * Math.PI * 2) * 1.6] as P2), z, z + H - 2, z, 0)
}

/** 鐘楼（石の基壇・4 本の柱・入母屋の瓦屋根・梵鐘） */
function belfry(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'ring') return
  const rf = rectFrame(s.geom.ring, null, s.z)
  const { frame: f, W, D } = rf
  const H = s.height ?? 9
  const b = k.solid
  k.mass.st = { wall: [74, 58, 44], facade: 0, roof: [125, 128, 133], roofKind: 6, use: 9, flags: 1, seed: k.seed, style: 1, floors: 1 }
  fbox(b, f, -0.3, W + 0.3, -0.3, D + 0.3, -1.2, 1.2, '#8f8a80', NM.stone, 0.45)
  steps(k, f, W / 2 - 1, W / 2 + 1, 6, 0.2, 0.3, '#8f8a80')
  const top = H - 3.4
  for (const [ps, pt] of [
    [0.5, 0.5],
    [W - 0.5, 0.5],
    [W - 0.5, D - 0.5],
    [0.5, D - 0.5],
  ])
    b.cylinder(f.p(ps, pt, 1.2), 0.18, top - 1.2, 10, '#4a3a2c', NM.wood, 0, false, 0.15)
  fbox(b, f, 0.3, W - 0.3, 0.3, 0.7, top - 0.5, top, '#4a3a2c', NM.wood)
  fbox(b, f, 0.3, W - 0.3, D - 0.7, D - 0.3, top - 0.5, top, '#4a3a2c', NM.wood)
  hipRoof(k, f.shift(0.5, 0.5, 0), W - 1, D - 1, top, H - 0.4, { color: '#6f7378', mat: NM.kawara, eave: 1.4, thick: 0.35, soffit: '#5a4232', fascia: '#3a2a1e' })
  // 梵鐘（青銅）と撞木
  const bc = f.p(W / 2, D / 2, top - 0.6)
  b.cylinder([bc[0], bc[1] - 1.6, bc[2]], 0.75, 1.5, 20, '#4a5a48', NM.copper, 0.3, true, 0.55, true)
  b.cylinder([bc[0], bc[1] - 0.1, bc[2]], 0.3, 0.35, 12, '#4a5a48', NM.copper, 0.3, true, 0.2)
  b.beam(f.p(0.6, D / 2, top - 1.6), f.p(W / 2 - 0.9, D / 2, top - 1.6), 0.22, '#7a5e42', NM.wood)
}

/** 初代アーク灯「さん」の灯柱（黒い鋳鉄の装飾の柱・灯具） */
function arcLamp(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'point') return
  const [x, y] = s.geom.at
  const z = s.z
  const H = s.height ?? 6
  const b = k.solid
  const p: V3 = [x, z - LAB, -y]
  b.cylinder([p[0], p[1] - 0.3, p[2]], 0.5, 0.9, 12, '#2a2c2e', NM.iron, 0.4, true, 0.35)
  b.cylinder([p[0], p[1] + 0.6, p[2]], 0.16, H - 1.6, 12, '#2a2c2e', NM.iron, 0.4, false, 0.1)
  for (const h of [1.4, 2.6, H - 1.2]) b.cylinder([p[0], p[1] + h, p[2]], 0.22, 0.15, 12, '#2a2c2e', NM.iron, 0.4, true)
  b.beam([p[0], p[1] + H - 1.0, p[2]], [p[0] + 0.7, p[1] + H - 0.8, p[2]], 0.06, '#2a2c2e', NM.iron)
  b.beam([p[0], p[1] + H - 1.0, p[2]], [p[0] - 0.7, p[1] + H - 0.8, p[2]], 0.06, '#2a2c2e', NM.iron)
  k.glow.cylinder([p[0], p[1] + H - 1.0, p[2]], 0.32, 0.7, 12, '#fff2dc', 1, 2.6, true, 0.38, true)
  b.cylinder([p[0], p[1] + H - 0.3, p[2]], 0.45, 0.25, 12, '#2a2c2e', NM.iron, 0.4, true, 0.08)
  k.sign(Frame.facing(x, y - 0.36, 180, z), -0.25, 0.1, 0.5, 0.42, 0, { text: 'アーク灯\nさん', sub: '1890', fg: '#e8d29a', bg: '#2a2c2e', font: 'serif' }, 0)
  k.lights.push({ x, y, z: z + H - 0.65, kind: 1, color: '#fff1d6', size: 1.1, power: 1.8, seed: 0.05 })
  k.lamp([x, z + H - 0.65 - LAB, -y], 8, '#ffe0b0', 1.6, 0.6, 1)
}

/** 門（石の門柱 2 本・鉄の門扉・表札） */
function gate(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'line') return
  const [a, c] = [s.geom.pts[0], s.geom.pts[s.geom.pts.length - 1]]
  const f = Frame.edge(a, c, s.z)
  const L = Math.hypot(c[0] - a[0], c[1] - a[1])
  const H = s.height ?? 2.4
  const b = k.solid
  for (const ps of [0, L]) {
    fbox(b, f, ps - 0.4, ps + 0.4, -0.4, 0.4, -0.3, H, '#a8a296', NM.stone, 0.4)
    fbox(b, f, ps - 0.48, ps + 0.48, -0.48, 0.48, H, H + 0.2, '#9a948a', NM.stone, 0.4)
  }
  // 門扉（開いている。左右に寄せた鉄の格子）
  for (const [s0, s1] of [
    [0.4, 1.6],
    [L - 1.6, L - 0.4],
  ]) {
    railing(k, f, s0, s1, 0, 0, 1.8, '#2a2c2e', NM.iron, 0.6, 0.12)
  }
  k.sign(f, L + 0.42, 0.9, 0.5, 1.2, -0.41, { text: '桜見高専', fg: '#1a1a1a', bg: '#d8d4ca', vertical: true, font: 'serif' }, 0)
  k.sign(f, -0.42 - 0.5, 0.9, 0.5, 1.2, -0.41, { text: '国立桜見工業高等専門学校', fg: '#1a1a1a', bg: '#d8d4ca', vertical: true, font: 'serif' }, 0)
}

/* -------------------------------------------------------------------------- */
/* 銅像・墓・史跡・擁壁・大木                                                       */
/* -------------------------------------------------------------------------- */

/** 銅像（石の台座と、指さす人の像。像は円柱と箱で） */
function statue(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'ring') return
  const c = ringCenter(s.geom.ring)
  const H = s.height ?? 4.5
  const z = s.z
  const b = k.solid
  const bronze = '#4a5e4a'
  const point = ((s.pointing_bearing_deg as number | undefined) ?? 200) * (Math.PI / 180)
  const ped = H * 0.5
  b.box([c[0], z + 0.2 - LAB, -c[1]], [2.4, 0.4, 2.4], '#a8a296', NM.granite)
  b.box([c[0], z + 0.4 + (ped - 0.4) / 2 - LAB, -c[1]], [1.5, ped - 0.4, 1.5], '#b9b2a4', NM.granite)
  b.box([c[0], z + ped + 0.06 - LAB, -c[1]], [1.7, 0.12, 1.7], '#a8a296', NM.granite)
  const base = z + ped + 0.12
  const fig = H - ped - 0.12
  // 脚・胴・頭・腕（指す腕は方位 pointing へ）
  const fx = Math.sin(point)
  const fy = Math.cos(point)
  for (const side of [-0.15, 0.15]) b.cylinder([c[0] - fy * side, base - LAB, -(c[1] + fx * side)], 0.12, fig * 0.46, 8, bronze, NM.copper, 0.15, true, 0.11)
  b.cylinder([c[0], base + fig * 0.46 - LAB, -c[1]], 0.27, fig * 0.36, 10, bronze, NM.copper, 0.15, true, 0.22)
  b.cylinder([c[0], base + fig * 0.62 - LAB, -c[1]], 0.36, fig * 0.2, 10, bronze, NM.copper, 0.15, true, 0.3)
  b.cylinder([c[0], base + fig * 0.84 - LAB, -c[1]], 0.13, fig * 0.14, 10, bronze, NM.copper, 0.15, true, 0.12)
  const sh: V3 = [c[0] + fy * 0.3, base + fig * 0.78 - LAB, -(c[1] - fx * 0.3)]
  b.beam(sh, [sh[0] + fx * 0.85, sh[1] + 0.35, sh[2] - fy * 0.85], 0.1, bronze, NM.copper, 0.15)
  const sh2: V3 = [c[0] - fy * 0.3, base + fig * 0.78 - LAB, -(c[1] + fx * 0.3)]
  b.beam(sh2, [sh2[0] - fy * 0.1, sh2[1] - 0.6, sh2[2] - fx * 0.1], 0.1, bronze, NM.copper, 0.15)
  const name = (s.name ?? '').replace(/^銅像/, '').replace(/「|」/g, '')
  k.sign(Frame.facing(c[0] + fx * 0.76, c[1] + fy * 0.76, (point * 180) / Math.PI, z), -0.5, ped - 1.2, 1.0, 0.4, -0.01, { text: name, fg: '#e8d29a', bg: '#3a3a36', font: 'serif' }, 0)
}

/** 伊吹灯の墓（小さな石の墓・台・花立て） */
function grave(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'ring') return
  const c = ringCenter(s.geom.ring)
  const fb = (s.front_bearing_deg as number | undefined) ?? 60
  const f = Frame.facing(c[0], c[1], fb, s.z).shift(-0.8, -0.8)
  const b = k.solid
  fbox(b, f, 0, 1.6, 0, 1.6, -0.3, 0.2, '#8f8a80', NM.stone, 0.4)
  fbox(b, f, 0.35, 1.25, 0.5, 1.2, 0.2, 0.45, '#9a948a', NM.granite)
  fbox(b, f, 0.5, 1.1, 0.65, 1.05, 0.45, (s.height ?? 1.1) + 0.2, '#a8a296', NM.granite)
  for (const ps of [0.35, 1.25]) b.cylinder(f.p(ps, 0.3, 0.2), 0.06, 0.3, 8, '#7a756c', NM.stone, 0, true)
  k.sign(f, 0.62, 0.55, 0.36, (s.height ?? 1.1) - 0.2, -0.65, { text: '伊吹灯', fg: '#2a2a2a', bg: '#a8a296', vertical: true, font: 'serif' }, 0)
}

/** 丘ノ上貝塚（碑と説明板・貝の散らばる土の広がり） */
function kaizuka(k: Kit, s: NamedStructure) {
  const at = (s.marker as P2 | undefined) ?? (s.geom.type === 'ring' ? ringCenter(s.geom.ring) : [0, 0])
  const f = Frame.facing(at[0], at[1], 180, s.z)
  const b = k.solid
  fbox(b, f, -0.4, 0.4, -0.25, 0.25, -0.2, 1.5, '#8f8a80', NM.stone, 0.4)
  k.sign(f, -0.12, 0.3, 0.24, 1.0, -0.26, { text: '丘ノ上貝塚', fg: '#1a1a1a', bg: '#8f8a80', vertical: true, font: 'serif' }, 0)
  // 説明板
  b.beam(f.p(1.0, -0.3, 0), f.p(1.0, -0.3, 1.0), 0.06, '#5a4632', NM.wood)
  b.beam(f.p(2.0, -0.3, 0), f.p(2.0, -0.3, 1.0), 0.06, '#5a4632', NM.wood)
  k.sign(f, 0.9, 0.9, 1.2, 0.7, -0.35, { text: '丘ノ上貝塚', sub: '縄文時代の貝塚（範囲は半径 9m）', fg: '#2a2a2a', bg: '#efe8d6', border: '#5a4632', font: 'sans' }, 0)
}

/** 塩田跡の塩釜の石組み（低い石の輪） */
function shiogama(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'ring') return
  const c = ringCenter(s.geom.ring)
  const r = s.geom.ring.reduce((m, q) => m + Math.hypot(q[0] - c[0], q[1] - c[1]), 0) / s.geom.ring.length
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2
    k.solid.box([c[0] + Math.cos(a) * r * 0.85, s.z + 0.3 - LAB, -(c[1] + Math.sin(a) * r * 0.85)], [1.0, 0.7 + 0.3 * k.rnd(), 0.7], '#8a857a', NM.stone, 0.3, -a)
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    k.solid.box([c[0] + Math.cos(a) * r * 0.45, s.z + 0.2 - LAB, -(c[1] + Math.sin(a) * r * 0.45)], [0.8, 0.4, 0.6], '#7d786e', NM.stone, 0.3, -a)
  }
  k.sign(Frame.facing(c[0], c[1] - r - 1.5, 180, s.z), -0.6, 0.6, 1.2, 0.6, 0, { text: '塩釜の石組み', sub: '塩田跡', fg: '#2a2a2a', bg: '#efe8d6', font: 'sans' }, 0)
}

/** 天文台の白い擁壁（石積み。線に沿って、低い側の地面から上の地面まで） */
function retainingWall(k: Kit, s: NamedStructure, ctx: KitContext) {
  if (s.geom.type !== 'line') return
  const pts = s.geom.pts
  const H = s.height ?? 2.4
  const th = (s.thickness_m as number | undefined) ?? 0.6
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const c = pts[i]
    const f = Frame.edge(a, c, 0)
    const L = Math.hypot(c[0] - a[0], c[1] - a[1])
    if (L < 0.05) continue
    // 低い側（外向きの側）の地面と、その 2.4m 上
    const m = f.plan(L / 2, -1.0)
    const g0 = ctx.heightAt(m[0], m[1])
    const ff = f.at(g0)
    fbox(k.solid, ff, -0.02, L + 0.02, -th / 2, th / 2, -0.6, H, '#e8e4da', NM.stone, 0.42)
    fbox(k.solid, ff, -0.04, L + 0.04, -th / 2 - 0.06, th / 2 + 0.06, H, H + 0.14, '#d8d4ca', NM.stone)
    k.mass.prism([ff.plan(0, -th / 2), ff.plan(L, -th / 2), ff.plan(L, th / 2), ff.plan(0, th / 2)], g0 - 0.6, g0 + H, g0, 0)
  }
}

/** 名前のある大木のまわり（低い石の囲い・名札。木そのものは trees.ts） */
function bigTree(k: Kit, s: NamedStructure) {
  if (s.geom.type !== 'ring') return
  const trunk = (s.trunk as P2 | undefined) ?? ringCenter(s.geom.ring)
  const z = s.z
  const r = 2.4
  const b = k.solid
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * Math.PI * 2
    const a1 = ((i + 1) / 20) * Math.PI * 2
    const P = (a: number, h: number): V3 => [trunk[0] + Math.cos(a) * r, z + h - LAB, -(trunk[1] + Math.sin(a) * r)]
    b.beam(P(a0, 0.18), P(a1, 0.18), 0.35, '#8f8a80', NM.stone, 0, 0.36)
    if (i % 2 === 0) b.beam(P(a0, 0), P(a0, 0.7), 0.08, '#5a4632', NM.wood)
    b.beam(P(a0, 0.68), P(a1, 0.68), 0.05, '#5a4632', NM.wood)
  }
  const name = (s.name ?? '').replace(/^楓坂の/, '')
  const f = Frame.facing(trunk[0], trunk[1] - r - 0.4, 180, z)
  b.beam(f.p(0, 0, 0), f.p(0, 0, 1.1), 0.08, '#5a4632', NM.wood)
  k.sign(f, -0.45, 0.85, 0.9, 0.45, -0.05, { text: name, sub: (s.age_text as string | undefined)?.replace(/（.*）/, '') ?? '', fg: '#2a2a2a', bg: '#efe8d6', border: '#5a4632', font: 'serif' }, 0)
}

void gableRoof
void spire
void stoneLantern
