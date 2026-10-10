import * as THREE from 'three'
import { ROOF } from '../../town/buildingKit'
import { densify, pointAt } from '../../town/infraMeshes'
import { Frame } from '../frame'
import { awning, canopy, fbox, type GlassSpec, type Kit, type Opening, wall, wallLamp } from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import { bladeSign, pot, railing } from '../parts'
import { cssOf, windowTrims } from '../shell'
import { generic, hirakiFuda, isOpenLab, signText } from './common'
import { frontFace } from './shops'
import type { KitContext } from './index'

/**
 * 港と工房の組み立ての型: 赤レンガ工房棟（3 階の煉瓦倉庫・白い石の窓まわりの縦長のアーチ窓・1 階の両開きのガラス扉・鉄の庇）、
 * 煉瓦の工場（赤煉瓦館・芸大ののこぎり屋根）、石の工房と市場、鉄骨の工場・倉庫・造船所・発電所、ガラス張りの工作棟、高架の下のアーチの店
 */

const LAB = 116

/* -------------------------------------------------------------------------- */
/* 赤レンガ工房棟                                                                */
/* -------------------------------------------------------------------------- */

export function akarenga(k: Kit) {
  const rec = k.rec
  const brick = '#8e3a2c'
  const stone = '#e6dfd0'
  const no = (rec.name.match(/(\d)号館/) ?? [])[1] ?? '1'
  const ff = frontFace(rec)
  const { f, L } = ff
  // 1 階: 大きな荷物の出入口だった両開きのガラス扉（天気のいい日は開け放つ。3 つに 1 つを開いた形に）
  const nb = Math.max(3, Math.round(L / 8))
  const bw = L / nb
  const ops: Opening[] = []
  for (let i = 0; i < nb; i++) {
    const c = (i + 0.5) * bw
    const opened = i % 3 === 1
    ops.push(
      opened
        ? { s: c - 1.9, h: 0, w: 3.8, ht: 4.1, shape: 'segment', depth: 0.5, glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop, cols: 1, rows: 1, bar: 0, depth: 10, frame: '#2b2f2c' } }
        : { s: c - 1.9, h: 0, w: 3.8, ht: 4.1, shape: 'segment', depth: 0.5, fill: 'door', door: { kind: 'doubleGlass', color: '#2b2f2c', transom: 0.9, glass: { kind: GLASS.shop, cls: LIGHT_CLASS.shop } } },
    )
  }
  const g = generic(k, {
    wall: { color: brick, mat: NM.brick },
    floors: 3,
    groundH: 5.0,
    floorH: 4.25,
    eave: rec.height ?? 13.5,
    win: { w: 1.3, ht: 2.8, sill: 0.8, shape: 'arch', depth: 0.42, glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: 2, rows: 4, bar: 0.04, frame: '#ece6da', depth: 8 }, sillTrim: { color: stone, mat: NM.stone }, lintel: { color: stone, mat: NM.stone, keystone: true }, surround: { color: stone, mat: NM.stone, w: 0.12 } },
    sideWin: { w: 1.2, ht: 2.6, sill: 0.8, shape: 'arch', depth: 0.42, glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: 2, rows: 4, bar: 0.04, frame: '#ece6da', depth: 8 }, sillTrim: { color: stone, mat: NM.stone }, lintel: { color: stone, mat: NM.stone, keystone: true } },
    groundWin: null,
    frontGround: 'none',
    frontOpenings: ops,
    noFrontDoor: true,
    bay: 4.0,
    plinth: { ht: 0.6, color: '#7d776e', mat: NM.granite, proj: 0.08 },
    bands: { hs: [5.0, 9.25], ht: 0.25, proj: 0.06, color: stone, mat: NM.stone },
    cornice: { ht: 0.7, proj: 0.28, color: '#7a2f24', mat: NM.brick },
    roof: { color: '#6c6b68', mat: NM.tileRoof, eave: 0.5, verge: 0.35, soffit: '#5a4a42', fascia: '#4a3a32', gutter: '#3d3a36' },
    sign: null,
  })
  for (const o of ops) {
    windowTrims(k, f, o, { w: o.w, ht: o.ht, sill: 0, shape: 'segment', lintel: { color: stone, mat: NM.stone, keystone: true } })
    if (!o.fill) {
      // 開け放った扉: 左右に開いた扉の板
      fbox(k.solid, f, o.s - 1.9, o.s - 0.02, -0.08, -0.02, 0, 3.2, '#2b2f2c', NM.paint, 0.4)
      fbox(k.solid, f, o.s + o.w + 0.02, o.s + o.w + 1.9, -0.08, -0.02, 0, 3.2, '#2b2f2c', NM.paint, 0.4)
    }
  }
  canopy(k, f, 0.4, L - 0.4, 4.8, 1.8, '#2f3532', NM.iron, 0.14, true)
  // 号館の大きな字（正面の上）と、中の店の看板（1 階の扉の上）
  k.sign(f, L / 2 - 2.2, 10.2, 4.4, 1.1, -0.05, { text: `${no}号館`, sub: 'AKARENGA KOBO', fg: '#f2ecdc', bg: null, font: 'serif', bold: true }, 2)
  rec.tenants
    .filter((t) => String(t.floor).startsWith('1'))
    .forEach((t, i) => {
      const o = ops[Math.min(ops.length - 1, i * 2)]
      k.sign(f, o.s + 0.2, 4.25, o.w - 0.4, 0.45, -0.08, { text: t.name.replace(/^赤レンガ工房棟 \d号館 /, '').replace(/^カフェ「(.*)」$/, 'カフェ $1').replace(/^ビアホール「(.*)」$/, '$1'), fg: '#f2ead6', bg: '#2b2f2c', font: 'serif' }, 2)
    })
  for (let i = 0; i < nb; i++) wallLamp(k, f, (i + 0.5) * bw + 2.3, 3.4, 'gas')
  for (let i = 0; i < nb; i += 2) k.flood(f.p((i + 0.5) * bw, -4.5, 0), 20, '#ffcf98', 1.3)
  // プロムナードの木のプランター
  for (let i = 0; i < nb; i++) {
    const s = (i + 0.5) * bw + (i % 2 ? 2.6 : -2.6)
    fbox(k.solid, f, s - 0.8, s + 0.8, -3.6, -2.6, 0, 0.6, '#6b4a2e', NM.wood)
    fbox(k.solid, f, s - 0.7, s + 0.7, -3.5, -2.7, 0.6, 1.0, '#4f7a34', NM.leaf)
  }
  void g
}

/* -------------------------------------------------------------------------- */
/* 煉瓦の工場・石の工房・市場                                                     */
/* -------------------------------------------------------------------------- */

export function brickFactory(k: Kit) {
  const rec = k.rec
  const stone = '#d8d0c0'
  const saw = (rec.roofType ?? '').includes('のこぎり')
  const g = generic(k, {
    wall: { color: cssOf(rec.wallColor), mat: NM.brick },
    win: { w: 1.6, ht: saw ? 2.6 : 3.0, sill: 0.9, shape: 'arch', depth: 0.4, glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: 3, rows: 4, bar: 0.04, frame: '#3a3d3a', depth: 10 }, sillTrim: { color: stone, mat: NM.stone }, lintel: { color: stone, mat: NM.stone } },
    bay: 3.6,
    door: { style: { kind: 'doubleGlass', color: '#2b2f2c', glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office } }, w: 2.6, ht: 3.2, shape: 'segment', lamp: 'gas' },
    plinth: { ht: 0.5, color: '#7d776e', mat: NM.granite },
    cornice: { ht: 0.5, proj: 0.2, color: '#7a3020', mat: NM.brick },
    roof: { eave: 0.5, soffit: '#4a4642', gutter: '#3d3a36' },
    sign: { text: signText(rec).main, sub: signText(rec).sub, fg: '#f0e6cc', bg: '#2b2f2c', font: 'serif', h: 0.55 },
  })
  // 蔦（壁のところどころ）
  if ((rec.wallText ?? '').includes('蔦')) {
    for (const face of g.body) {
      const n = Math.round(face.L / 4)
      for (let i = 0; i < n; i++) {
        const s = k.rnd() * face.L
        const h0 = k.rnd() * 2
        fbox(k.solid, face.f, s, s + 1.2 + k.rnd() * 2.5, -0.15, 0, -0.3, h0 + 3 + k.rnd() * 6, '#3f6430', NM.leaf)
      }
    }
  }
  if (isOpenLab(rec)) hirakiFuda(k, g.body[g.frontEdge].f, 0.4, 1.4, rec)
  return g
}

export function stoneWorkshop(k: Kit) {
  const rec = k.rec
  const market = (rec.kind ?? '').includes('市場')
  const ff = frontFace(rec)
  const { f, L } = ff
  const open: Opening = { s: L * 0.12, h: 0, w: L * 0.76, ht: market ? 3.6 : 4.8, depth: 0.4, fill: market ? 'none' : 'door', door: { kind: 'shutter', color: '#8a8f94' } }
  const g = generic(k, {
    wall: { color: '#d9d6cf', mat: NM.stone, aux: 0.55 },
    floors: 1,
    frontGround: 'none',
    frontOpenings: [open],
    noFrontDoor: true,
    win: { w: 1.4, ht: 2.0, sill: 1.6, shape: 'segment', depth: 0.35, glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: 3, rows: 2, bar: 0.04, frame: '#3a3d3a', depth: 10 }, sillTrim: { color: '#c9c2b4', mat: NM.stone } },
    plinth: { ht: 0.5, color: '#8a8478', mat: NM.granite },
    roof: { eave: 0.6, soffit: '#5a5048', gutter: '#4a4a46' },
    sign: null,
  })
  const st = signText(rec)
  k.sign(f, L / 2 - 2.6, open.ht + 0.4, 5.2, 0.8, -0.06, { text: st.main, sub: st.sub, fg: '#f3ecd8', bg: '#2f4f6f', font: 'serif', bold: true }, 2)
  if (market) {
    // 市場: 中の台（魚の箱）と、上の電灯
    for (let i = 0; i < 4; i++) {
      const s = open.s + 0.6 + i * ((open.w - 1.2) / 4)
      fbox(k.solid, f, s, s + (open.w - 1.2) / 4 - 0.4, 0.8, 2.4, 0, 0.85, '#7a8a96', NM.steel)
      fbox(k.solid, f, s + 0.1, s + (open.w - 1.2) / 4 - 0.5, 0.9, 2.3, 0.85, 1.0, '#c8d8e0', NM.paint, 0.8)
      k.glow.box(f.p(s + 0.8, 1.6, 3.0), [0.5, 0.1, 0.2], '#fff4e0', 1, 2.5)
    }
    awning(k, f, open.s - 0.3, open.s + open.w + 0.3, open.ht + 0.15, 1.6, 0.3, '#2f4f6f', 7)
  }
  wallLamp(k, f, open.s - 0.5, 3.0, 'gas')
  if (isOpenLab(rec)) hirakiFuda(k, f, open.s + open.w + 0.3, 1.4, rec)
  return g
}

/* -------------------------------------------------------------------------- */
/* 鉄骨の工場・倉庫・造船所・発電所                                                 */
/* -------------------------------------------------------------------------- */

export function factory(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const eave = rec.height ?? 11
  const shipyard = (rec.kind ?? '').includes('造船')
  const nb = Math.max(1, Math.round(L / 12))
  const ops: Opening[] = []
  for (let i = 0; i < nb; i++) {
    const c = (i + 0.5) * (L / nb)
    const w = shipyard ? Math.min(L * 0.8, 18) : Math.min(7, L / nb - 2)
    ops.push({ s: c - w / 2, h: 0, w, ht: Math.min(eave - 1.6, shipyard ? 9 : 5.5), depth: 0.3, fill: shipyard ? 'none' : 'door', door: { kind: 'shutter', color: '#b9bdc0' } })
    if (shipyard) break
  }
  const g = generic(k, {
    wall: { color: cssOf(rec.wallColor), mat: NM.metalRoof, aux: 0.09 },
    floors: rec.floors ?? 1,
    frontGround: 'none',
    frontOpenings: ops,
    noFrontDoor: true,
    win: { w: 3.2, ht: 1.4, sill: Math.max(0.9, eave - 2.6), depth: 0.12, glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: 4, rows: 1, bar: 0.05, frame: '#5a5e62', depth: 12 } },
    groundWin: (rec.floors ?? 1) > 1 ? { w: 1.6, ht: 1.4, sill: 1.0, depth: 0.12, glass: { kind: GLASS.office, cls: LIGHT_CLASS.office, cols: 2, rows: 1, bar: 0.04, frame: '#5a5e62' } } : undefined,
    bay: 6,
    plinth: { ht: 0.8, color: '#9a9890', mat: NM.concrete },
    roof: { eave: 0.4, verge: 0.3, soffit: '#6a6e72', fascia: '#5a5e62', gutter: '#5a5e62', color: cssOf(rec.roofColor, 0.9), mat: NM.metalRoof, aux: 0.2 },
    parapet: 0.6,
    sign: null,
  })
  const st = signText(rec)
  k.sign(f, L / 2 - Math.min(5, L / 2 - 0.5), eave - 1.8, Math.min(10, L - 1), 1.2, -0.06, { text: st.main, sub: st.sub, fg: '#ffffff', bg: '#2c4a6a', font: 'sans', bold: true }, 2)
  // 横の小さな扉と灯り
  const side = g.body[(g.frontEdge + 1) % g.body.length]
  fbox(k.solid, side.f, 2, 3.0, -0.06, 0.02, 0, 2.2, '#5a5e62', NM.paint, 0.4)
  wallLamp(k, f, ops[0].s - 0.6, 4.0, 'bulb')
  if (shipyard) {
    // 船台（水際へ下りる斜路）と、作りかけの船の骨
    const pb = f.p(L / 2, -2, -0.5)
    void pb
    fbox(k.solid, f, L / 2 - 3, L / 2 + 3, -18, 1, -1.5, -0.2, '#7a7670', NM.concrete)
    for (let i = 0; i < 7; i++) {
      const t = -1 - i * 2.2
      const p0 = f.p(L / 2 - 2.2, t, 0.2)
      const p1 = f.p(L / 2 + 2.2, t, 0.2)
      const top = f.p(L / 2, t, 3.6)
      k.solid.beam(p0, top, 0.18, '#8d4b3a', NM.iron, 0.3)
      k.solid.beam(p1, top, 0.18, '#8d4b3a', NM.iron, 0.3)
    }
    k.solid.beam(f.p(L / 2, 0, 3.6), f.p(L / 2, -15, 3.6), 0.25, '#8d4b3a', NM.iron, 0.3)
  }
  if (isOpenLab(rec)) hirakiFuda(k, f, ops[0].s + ops[0].w + 0.4, 1.4, rec)
  return g
}

/** ガラス張りの工作棟（ひらき工作棟）: 通りに面した大きなガラスの壁の中に、学生が作るロボット・人型ロボットの試作機 */
export function glassWorks(k: Kit) {
  const rec = k.rec
  const ff = frontFace(rec)
  const { f, L } = ff
  const eave = rec.height ?? 9
  const glass: GlassSpec = { kind: GLASS.workshop, cls: LIGHT_CLASS.office, cols: Math.round(L / 1.8), rows: 3, bar: 0.06, frame: '#3d4144', depth: 14, yC: eave - 1 }
  const front: Opening = { s: 0.6, h: 0.4, w: L - 1.2, ht: eave - 1.6, depth: 0.25, glass }
  const g = generic(k, {
    wall: { color: '#c8ccce', mat: NM.metalRoof, aux: 0.1 },
    floors: 1,
    frontGround: 'none',
    frontOpenings: [front],
    noFrontDoor: true,
    win: { w: 3.0, ht: eave - 3, sill: 1.0, depth: 0.15, glass: { ...glass, cols: 2 } },
    bay: 4,
    parapet: 0.8,
    sign: null,
  })
  // ガラスの壁の方立て（外の縦のアルミ）
  for (let i = 0; i <= Math.round(L / 3.6); i++) fbox(k.solid, f, 0.6 + (i * (L - 1.2)) / Math.round(L / 3.6) - 0.08, 0.6 + (i * (L - 1.2)) / Math.round(L / 3.6) + 0.08, -0.25, 0.0, 0.3, eave - 1.1, '#8f9599', NM.steel)
  // 中の人型ロボットの試作機（ガラスの向こうの中央）
  const rb = f.p(L / 2, 4.5, 0)
  const b = k.solid
  b.box([rb[0], rb[1] + 0.9, rb[2]], [0.7, 1.8, 0.5], '#e8e8e4', NM.paint, 0.6, f.yaw)
  b.box([rb[0], rb[1] + 2.55, rb[2]], [1.1, 1.3, 0.6], '#e8e8e4', NM.paint, 0.6, f.yaw)
  b.box([rb[0], rb[1] + 3.5, rb[2]], [0.55, 0.55, 0.5], '#d0d4d8', NM.paint, 0.6, f.yaw)
  k.glow.box([rb[0] - f.out[0] * 0.26, rb[1] + 3.55, rb[2] - f.out[2] * 0.26], [0.35, 0.08, 0.02], '#7fdcff', 2, 3)
  for (const sd of [-0.75, 0.75]) {
    const a = f.p(L / 2 + sd, 4.5, 3.0)
    b.beam(a, [a[0], a[1] - 1.4, a[2]], 0.22, '#c0c4c8', NM.steel)
  }
  // 作業台
  for (let i = 0; i < 4; i++) fbox(b, f, 2 + i * ((L - 4) / 4), 2 + i * ((L - 4) / 4) + 2.2, 2.0, 3.0, 0, 0.9, '#6a5a44', NM.wood)
  k.sign(f, L / 2 - 4, eave - 1.0, 8, 0.8, -0.06, { text: 'ひらき工作棟', sub: '桜見高専  HIRAKI WORKSHOP', fg: '#ffffff', bg: '#2b2f33', font: 'sans', bold: true }, 1)
  hirakiFuda(k, f, 0.2, 1.4, rec)
  return g
}

/* -------------------------------------------------------------------------- */
/* 高架の下のアーチの店                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 灯町高架の石造アーチの下の店: 高架の形（infraMeshes の addArchViaduct と同じ計算）からアーチの開口を求め、
 * 正面の開口にガラスの店先（扉・方立て・腰板）を、裏の開口に煉瓦の壁と小さな扉を入れる。アーチの外に張り出した日よけと看板
 */
export function archShop(k: Kit, ctx: KitContext) {
  const rec = k.rec
  const railId = rec.extra.rail_id as string | undefined
  const rail = ctx.infra.rails.find((r) => r.id === railId && r.structure === 'stone_arch_viaduct') ?? ctx.infra.rails.filter((r) => r.structure === 'stone_arch_viaduct').sort((a, b) => dist(a.pts, rec) - dist(b.pts, rec))[0]
  k.mass.st = { wall: [138, 90, 68], facade: 7, roof: [138, 90, 68], roofKind: ROOF.arch, use: rec.use, flags: 1 | 2 | 16, seed: k.seed, style: 2, floors: 1 }
  if (!rail) {
    generic(k)
    return
  }
  const width = rail.tracks * 4.0 + 1.6 + 1.4
  const pts = densify(rail.pts, 4)
  const total = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)
  const arches = Math.max(1, rail.arches)
  const bay = total / arches
  const pier = Math.min(2.6, bay * 0.22)
  // 店の正面の辺の中点にいちばん近いアーチ
  const fe = rec.frontEdge ?? [rec.ring[0], rec.ring[1]]
  const mx = (fe[0][0] + fe[1][0]) / 2
  const my = (fe[0][1] + fe[1][1]) / 2
  let best = 0
  let bd = Infinity
  for (let i = 0; i < arches; i++) {
    const m = pointAt(pts, (i + 0.5) * bay)
    const d = Math.hypot(m.x - mx, m.y - my)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  const s0 = best * bay + pier / 2
  const s1 = (best + 1) * bay - pier / 2
  const open = s1 - s0
  const mid = (s0 + s1) / 2
  const am = pointAt(pts, mid)
  const deckBottom = am.z - 1.3
  const spring = deckBottom - open / 2 - 0.7
  const ground = rec.z
  const dir = am.dir
  // 正面の側（高架の中心線から、店の正面の向きの側）
  const fb = ((rec.front ?? 0) * Math.PI) / 180
  const fv = [Math.sin(fb), Math.cos(fb)]
  const side = [-dir[1], dir[0]]
  const sgn = side[0] * fv[0] + side[1] * fv[1] >= 0 ? 1 : -1
  const h = width / 2
  const b = k.solid
  for (const face of [1, -1]) {
    const front = face === sgn
    // 面: 高架の面から 0.35m 奥。外から見て左 → 右
    const off = (h - 0.35) * face
    const pa = pointAt(pts, s0)
    const pb = pointAt(pts, s1)
    const A: [number, number] = [pa.x + side[0] * off, pa.y + side[1] * off]
    const B: [number, number] = [pb.x + side[0] * off, pb.y + side[1] * off]
    const f = face > 0 ? Frame.edge(B, A, ground) : Frame.edge(A, B, ground)
    const L = Math.hypot(B[0] - A[0], B[1] - A[1])
    // 開口の外形（地面からアーチの頂まで）
    const outline: THREE.Vector2[] = []
    const springH = spring - ground
    const r = open / 2
    outline.push(new THREE.Vector2(0, -0.5), new THREE.Vector2(L, -0.5))
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI
      outline.push(new THREE.Vector2(L / 2 + Math.cos(a) * (L / 2), springH + Math.sin(a) * r))
    }
    if (front) {
      // 店先: 下は扉と窓、上のアーチの中は欄間のガラス
      const doorS = L * 0.62
      const ops: Opening[] = [
        { s: doorS - 0.9, h: 0, w: 1.8, ht: Math.min(2.4, springH - 0.2), depth: 0.12, fill: 'door', door: { kind: 'doubleGlass', color: '#2a2d2b', glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.shop } } },
        { s: 0.5, h: 0.6, w: doorS - 1.4 - 0.5, ht: Math.min(2.2, springH - 0.6), depth: 0.12, glass: { kind: rec.use === 2 ? GLASS.shop : GLASS.workshop, cls: LIGHT_CLASS.shop, cols: 3, rows: 2, bar: 0.05, frame: '#2a2d2b', depth: 9 } },
      ]
      const rightW = L - 0.5 - (doorS + 1.4)
      if (rightW > 0.6) ops.push({ s: doorS + 1.4, h: 0.6, w: rightW, ht: Math.min(2.2, springH - 0.6), depth: 0.12, glass: { kind: rec.use === 2 ? GLASS.shop : GLASS.workshop, cls: LIGHT_CLASS.shop, cols: 2, rows: 2, bar: 0.05, frame: '#2a2d2b', depth: 9 } })
      const tH = Math.min(2.6, springH - 0.1)
      const fan: Opening = { s: 0.4, h: tH + 0.25, w: L - 0.8, ht: springH + r - tH - 0.6, shape: 'arch', depth: 0.1, glass: { kind: GLASS.workshop, cls: LIGHT_CLASS.shop, cols: 6, rows: 1, bar: 0.05, frame: '#2a2d2b', depth: 9 } }
      if (fan.ht > 0.6) ops.push(fan)
      wall(k, f, outline, ops, '#4a3a30', NM.wood, 0)
      fbox(b, f, 0, L, -0.05, 0.02, tH, tH + 0.25, '#2a2d2b', NM.paint, 0.4)
      // 日よけと看板（アーチの外へ張り出す）
      const st = signText(rec)
      const fo = f.shift(0, -0.36)
      awning(k, fo, 0.6, L - 0.6, Math.min(springH + r * 0.35, 3.5), 2.2, 0.32, ['#7a2a24', '#2f4f3a', '#2c3e50', '#5a3a2a'][k.seed % 4], k.seed % 2 ? 0 : 8)
      k.sign(fo, L / 2 - Math.min(2.4, L / 2 - 0.4), Math.min(springH + r * 0.35, 3.5) + 0.2, Math.min(4.8, L - 0.8), 0.55, -0.02, { text: st.main, sub: st.sub, fg: '#f3ecd8', bg: '#2a2622', font: 'serif' }, 2)
      bladeSign(k, fo, 0.25, 2.0, 0.5, 1.2, { text: st.main.slice(0, 6), fg: '#f3ecd8', bg: '#7a2a24', vertical: true, font: 'serif' })
      wallLamp(k, fo, doorS + 1.2, 2.3, 'bulb')
      pot(k, fo, 0.5, -0.5, 0, 0.45)
      if (isOpenLab(rec)) hirakiFuda(k, f, doorS - 1.3, 1.3, rec)
    } else {
      // 裏: 煉瓦の壁と小さな扉
      wall(k, f, outline, [{ s: L * 0.3, h: 0, w: 0.9, ht: 2.0, depth: 0.1, fill: 'door', door: { kind: 'panel', color: '#3a3a38' } }], '#7a4a38', NM.brick, 0)
    }
  }
  void railing
  void canopy
}

function dist(pts: number[][], rec: { ring: [number, number][] }) {
  const c = rec.ring[0]
  return Math.min(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))
}

void LAB
