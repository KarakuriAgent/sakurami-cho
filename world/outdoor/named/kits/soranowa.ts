import { DECK_H, PLATFORM, RIDE_SPOTS, SORANOWA } from '../../../../core/soranowa'
import { ROOF } from '../../town/buildingKit'
import { Frame, type V3 } from '../frame'
import { fbox, flatRoof, type GlassSpec, type Kit, type Opening } from '../kit'
import { GLASS, LIGHT_CLASS, NM } from '../namedMaterial'
import { buildBody, frontEdgeOf } from '../shell'
import { signAtlas, type SignStyle } from '../signs'
import { frontFace } from './shops'

/**
 * 大観覧車ソラノワの乗り場（building.shiomiko.soranowa-noriba。白い鉄骨とガラスの平屋。docs/design/town.md §17）と、
 * ホイールの下の乗り場の台（ゴンドラが下を通る所）・階段・スロープ・ガラスの屋根・手すり・案内。
 *
 * - 建物: ガラスのカーテンウォール。正面（南南西）に両開きのガラスの自動扉（データの入口）、奥（ホイールの側）に改札を出た所の裏口（開く扉 100）。
 *   中は interior/briefs/soranowa.ts（券売機・改札・案内）
 * - 乗り場の台はホイールの局所の座標で作る（core/soranowa.ts の PLATFORM。x = ホイールの面に沿って、z = 軸の向き。−z が台の側）。
 *   台の高さは一番下に来たゴンドラの中の床と同じ（DECK_H = 1.33m）。ゴンドラは台と向かいの通路の間の溝を、止まらずに 0.35m/s で通る
 * - 台・屋根の灯りは町の灯り（k.lamp。夜に台と花音を照らし、遠くの光の点にもなる）
 */

const WHITE = '#f4f4f2'
const STEEL = '#c9ced2'
const DECK = '#8e9194'
const YELLOW = '#e2b62a'
const NAVY = '#2c4a6a'

/** 開く扉の番号（データの入口に無い裏口）。interior/briefs/soranowa.ts が同じ番号を使う */
export const NORIBA_DOORS = { back: 100 } as const

/** 裏口（改札を出た所）の建物の局所の s（台の階段の下の真正面） */
export const NORIBA_BACK_S = 11.2

export function soranowaNoriba(k: Kit) {
  building(k)
  platform(k)
}

/* -------------------------------------------------------------------------- */
/* 乗り場の建物（白い鉄骨とガラス）                                                  */
/* -------------------------------------------------------------------------- */

/** ガラスのカーテンウォールの開口（扉の所を除いて、だいたい 2.2m ごとの縦の方立て。中の窓の光は 1 棟 28 枚まで） */
function curtain(L: number, doors: { s: number; w: number }[], glass: GlassSpec, h0 = 0.12, ht = 3.3): Opening[] {
  const out: Opening[] = []
  let segs: [number, number][] = [[0.35, L - 0.35]]
  for (const d of doors) {
    const a = d.s - 0.18
    const b = d.s + d.w + 0.18
    segs = segs.flatMap(([s0, s1]): [number, number][] => (b <= s0 || a >= s1 ? [[s0, s1]] : ([[s0, a], [b, s1]] as [number, number][]).filter(([x0, x1]) => x1 - x0 > 0.5)))
  }
  for (const [s0, s1] of segs) {
    const n = Math.max(1, Math.round((s1 - s0) / 2.2))
    const w = (s1 - s0) / n
    for (let i = 0; i < n; i++) out.push({ s: s0 + i * w + 0.05, h: h0, w: w - 0.1, ht, depth: 0.1, glass })
  }
  return out
}

function building(k: Kit) {
  const rec = k.rec
  const ring = rec.ring
  const z = rec.z
  const eave = rec.height ?? 4.5
  const ff = frontFace(rec)
  const front = frontEdgeOf(ring, rec.front)
  const back = (front + 2) % ring.length
  const gl: GlassSpec = { kind: GLASS.office, cls: LIGHT_CLASS.shop, cols: 1, rows: 1, bar: 0.035, frame: '#eef1f2', depth: 7 }
  const doorGlass = { kind: GLASS.office, cls: LIGHT_CLASS.shop }
  const doorW = 2.0
  const frontDoor: Opening = { s: ff.doorS - doorW / 2, h: 0, w: doorW, ht: 3.42, depth: 0.1, fill: 'door', door: { kind: 'doubleGlass', color: '#e3e8ea', transom: 0.86, operable: ff.doorIndex, glass: doorGlass } }
  // 裏口: 面 back の s（外から見て左の端から）。面の向きは建物の局所の s と逆（奥の面は右から左へ）
  const bp = ring[back]
  const bq = ring[(back + 1) % ring.length]
  const backL = Math.hypot(bq[0] - bp[0], bq[1] - bp[1])
  const backS = backL - NORIBA_BACK_S
  const backDoor: Opening = { s: backS - doorW / 2, h: 0, w: doorW, ht: 3.42, depth: 0.1, fill: 'door', door: { kind: 'doubleGlass', color: '#e3e8ea', transom: 0.86, operable: NORIBA_DOORS.back, glass: doorGlass } }
  const faces = ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    const doors = i === front ? [frontDoor] : i === back ? [backDoor] : []
    return { win: null, bay: 3, openings: [...curtain(L, doors, gl), ...doors], minLen: 1 }
  })
  k.mass.st = { wall: [233, 238, 240], facade: 1, roof: [244, 244, 242], roofKind: ROOF.flat, use: 2, flags: 1 | 16, seed: k.seed, style: rec.style, floors: 1 }
  const body = buildBody(k, {
    ring,
    z,
    bottom: Math.min(rec.gLow, z) - z - 0.4,
    floors: 1,
    floorH: eave,
    groundH: eave,
    top: eave,
    wall: { color: WHITE, mat: NM.paint, aux: 0.4 },
    faces,
    frontEdge: front,
    windowTop: 3.5,
  })
  // 陸屋根（パラペット 0.6m）と、まわりに張り出す白い軒の板（ガラスの上。下に足元を照らす灯り）
  const b = k.solid
  for (const fc of body) {
    fbox(b, fc.f, -1.2, fc.L + 1.2, -1.25, 0.02, eave - 0.95, eave - 0.62, WHITE, NM.paint, 0.4)
    fbox(b, fc.f, -1.2, fc.L + 1.2, -1.25, -1.17, eave - 1.0, eave - 0.6, '#dfe3e5', NM.paint, 0.5)
    // 白い鉄骨の柱（方立ての外。軒の先の下）
    for (let s = 0.0; s <= fc.L + 0.01; s += fc.L / Math.max(1, Math.round(fc.L / 6))) fbox(b, fc.f, s - 0.09, s + 0.09, -1.15, -0.97, 0, eave - 0.95, WHITE, NM.paint, 0.5)
  }
  flatRoof(k, ring, z, eave + 0.5, 0.5, WHITE, NM.paint, '#d8d8d4', WHITE, 0.4)
  const f = body[front].f
  // 屋根の上の看板（正面）と、入口の上の小さな看板
  k.sign(f, ff.L / 2 - 4.2, eave + 0.72, 8.4, 0.95, 0.4, { text: '大観覧車 ソラノワ', sub: 'SORANOWA  GIANT WHEEL', fg: NAVY, bg: '#ffffff', font: 'sans', bold: true }, 1)
  for (const s of [ff.L / 2 - 4.25, ff.L / 2 + 4.15]) fbox(b, f, s, s + 0.1, 0.4, 0.5, eave + 0.5, eave + 1.7, '#d8dcde', NM.steel, 0.5)
  k.sign(f, ff.doorS - 1.3, 3.72, 2.6, 0.42, -1.27, { text: 'のりば・きっぷ', sub: 'TICKETS & BOARDING', fg: '#ffffff', bg: NAVY, font: 'sans', bold: true }, 1)
  // 入口のわきの案内の板（一周約 15 分・900 円・営業時間）と、植え込みの箱
  const stand = (s: number) => {
    fbox(b, f, s - 0.04, s + 0.04, -1.6, -1.52, 0, 1.05, '#9aa0a4', NM.steel, 0.5)
    fbox(b, f, s - 0.42, s + 0.42, -1.62, -1.56, 0.95, 1.85, '#ffffff', NM.paint, 0.4)
    k.sign(f, s - 0.4, 0.97, 0.8, 0.86, -1.625, { text: '一周 約15分\n900円', sub: '営業 11:00〜22:00', fg: NAVY, bg: '#ffffff', font: 'sans', bold: true }, 2)
  }
  stand(ff.doorS + 2.2)
  for (const s of [ff.doorS - 3.2, ff.doorS + 3.6]) {
    fbox(b, f, s - 0.55, s + 0.55, -1.0, -0.45, 0, 0.55, '#cfd3d4', NM.concrete)
    fbox(b, f, s - 0.48, s + 0.48, -0.95, -0.5, 0.55, 0.85, '#4e7a3a', NM.leaf)
  }
  // 入口の上の軒の下の灯り（町の灯り）
  for (const s of [ff.doorS - 1.6, ff.doorS + 1.6]) {
    k.glowBox(f.p(s, -0.7, eave - 0.97), [0.5, 0.04, 0.5], '#fff2dc', 0, 2.2, f.yaw)
    k.lamp(f.p(s, -0.7, eave - 1.0), 7, '#ffe8c8', 1.3, 0.35, 1)
  }
  // 裏口の上の灯りと看板（台の側から見える「のりば」）
  const bf = body[back].f
  k.sign(bf, backS - 1.3, 3.72, 2.6, 0.42, -1.27, { text: 'のりば →', sub: 'BOARDING', fg: '#ffffff', bg: NAVY, font: 'sans', bold: true }, 1)
  k.glowBox(bf.p(backS, -0.7, eave - 0.97), [0.5, 0.04, 0.5], '#fff2dc', 0, 2.2, bf.yaw)
  k.lamp(bf.p(backS, -0.7, eave - 1.0), 7, '#ffe8c8', 1.2, 0.35, 1)
  // 中は暗い仮の奥（扉の中。中を作ったら隠す）
  fbox(k.temp, f, frontDoor.s, frontDoor.s + frontDoor.w, 0.4, 2.0, 0, 2.5, '#141210', NM.dark)
  fbox(k.temp, bf, backDoor.s, backDoor.s + backDoor.w, 0.4, 2.0, 0, 2.5, '#141210', NM.dark)
}

/* -------------------------------------------------------------------------- */
/* 乗り場の台                                                                    */
/* -------------------------------------------------------------------------- */

/** ホイールの局所の面（s = ホイールの x、t = −z、h = 地面から） */
const W = new Frame(SORANOWA.x, SORANOWA.y, Math.cos(SORANOWA.axis), Math.sin(SORANOWA.axis), SORANOWA.ground)
/** ホイールの局所の点（x, z, 地面からの高さ）→ シーン */
const P = (x: number, z: number, h: number): V3 => W.p(x, -z, h)

/** ホイールの局所の箱 */
function wbox(k: Kit, x0: number, x1: number, z0: number, z1: number, h0: number, h1: number, color: string, mat: number, aux = 0, b = k.solid) {
  fbox(b, W, x0, x1, -z1, -z0, h0, h1, color, mat, aux)
}

/** ステンレスの手すりとガラスの手すり壁（a → b。高さは各点の床から ht）。posts = 柱の間隔の上限 */
function glassRail(k: Kit, a: V3, bb: V3, ht = 1.1, posts = 1.35, glass = true) {
  const b = k.solid
  const len = Math.hypot(bb[0] - a[0], bb[1] - a[1])
  const n = Math.max(1, Math.ceil(len / posts))
  const pt = (u: number, h: number): V3 => P(a[0] + (bb[0] - a[0]) * u, a[1] + (bb[1] - a[1]) * u, a[2] + (bb[2] - a[2]) * u + h)
  for (let i = 0; i <= n; i++) b.beam(pt(i / n, 0), pt(i / n, ht - 0.02), 0.045, STEEL, NM.steel, 0.6)
  b.tube(pt(0, ht), pt(1, ht), 0.026, 10, '#d9dde0', NM.steel, 0.8)
  b.tube(pt(0, 0.04), pt(1, 0.04), 0.02, 8, '#9aa0a4', NM.steel, 0.5)
  // 手でつかむ低い手すり（0.85m）
  b.tube(pt(0, 0.85), pt(1, 0.85), 0.018, 8, '#d9dde0', NM.steel, 0.8)
  if (!glass) return
  for (let i = 0; i < n; i++) {
    const u0 = i / n + 0.004
    const u1 = (i + 1) / n - 0.004
    k.clear.quad(pt(u0, 0.08), pt(u1, 0.08), pt(u1, ht - 0.1), pt(u0, ht - 0.1), '#ffffff', 0)
  }
}

/** 床に描いた字（乗車位置・降車位置） */
function floorText(k: Kit, x: number, z: number, w: number, d: number, style: Omit<SignStyle, 'w' | 'h'>) {
  const r = signAtlas.region({ ...style, w, h: d } as SignStyle)
  const h = DECK_H + 0.006
  // 台の外（−z）から見て読める向き（字の下が −z）
  k.signs.quad(P(x + w / 2, z - d / 2, h), P(x - w / 2, z - d / 2, h), P(x - w / 2, z + d / 2, h), P(x + w / 2, z + d / 2, h), r, 2)
}

function platform(k: Kit) {
  const b = k.solid
  const D = PLATFORM.deck
  const H = DECK_H
  // --- 台（コンクリートの台に灰色の滑りにくいタイル。ゴンドラの側の縁は黄色い点字の帯と白い線・黒いゴムの縁） ---
  wbox(k, D.x0, D.x1, D.z0, D.z1, -0.3, H - 0.04, '#b7b4ad', NM.concrete)
  wbox(k, D.x0, D.x1, D.z0, D.z1 - 0.34, H - 0.04, H, DECK, NM.tileClad, 0.3)
  wbox(k, D.x0, D.x1, D.z1 - 0.34, D.z1 - 0.05, H - 0.04, H + 0.004, YELLOW, NM.tileClad, 0.06)
  wbox(k, D.x0, D.x1, D.z1 - 0.05, D.z1, H - 0.04, H + 0.004, '#f2f2ee', NM.paint, 0.3)
  wbox(k, D.x0, D.x1, D.z1 - 0.01, D.z1 + 0.04, H - 0.32, H - 0.06, '#1c1c1c', NM.dark, 0.2)
  // 台の外の面（白い鋼板の化粧）
  wbox(k, D.x0 - 0.04, D.x1 + 0.04, D.z0 - 0.05, D.z0, -0.02, H - 0.02, WHITE, NM.paint, 0.45)
  for (const x of [D.x0 - 0.04, D.x1]) wbox(k, x, x + 0.04, D.z0, D.z1, -0.02, H - 0.02, WHITE, NM.paint, 0.45)
  // 台の縁の灯り（夜。ゴンドラの側の縁の下の電球色の線）
  k.glowBox(P((D.x0 + D.x1) / 2, D.z1 + 0.03, H - 0.1), [D.x1 - D.x0, 0.03, 0.02], '#ffd48a', 0, 1.4, W.yaw)
  // --- 乗車位置・降車位置の黄色い枠と床の字 ---
  const frameBox = (x: number, z: number, w: number, d: number) => {
    const h0 = H
    const h1 = H + 0.005
    wbox(k, x - w / 2, x + w / 2, z - d / 2, z - d / 2 + 0.06, h0, h1, YELLOW, NM.paint, 0.3)
    wbox(k, x - w / 2, x + w / 2, z + d / 2 - 0.06, z + d / 2, h0, h1, YELLOW, NM.paint, 0.3)
    wbox(k, x - w / 2, x - w / 2 + 0.06, z - d / 2, z + d / 2, h0, h1, YELLOW, NM.paint, 0.3)
    wbox(k, x + w / 2 - 0.06, x + w / 2, z - d / 2, z + d / 2, h0, h1, YELLOW, NM.paint, 0.3)
  }
  frameBox(RIDE_SPOTS.boardX, -2.2, 1.6, 1.1)
  floorText(k, RIDE_SPOTS.boardX, -3.05, 1.5, 0.42, { text: '乗車位置', sub: 'BOARDING', fg: YELLOW, bg: null, font: 'sans', bold: true })
  frameBox(RIDE_SPOTS.exitX, -2.2, 1.6, 1.1)
  floorText(k, RIDE_SPOTS.exitX, -3.05, 1.5, 0.42, { text: '降車位置', sub: 'EXIT', fg: '#f2f2ee', bg: null, font: 'sans', bold: true })
  // 進む向きの矢印（ゴンドラの来る向き。上流 +x → 下流 −x）
  for (const x of [-6.2, -3.2, 1.6, 4.9]) {
    wbox(k, x - 0.5, x + 0.2, -1.95, -1.88, H, H + 0.005, '#f2f2ee', NM.paint, 0.3)
    b.quad(P(x - 0.5, -1.78, H + 0.006), P(x - 0.2, -1.78, H + 0.006), P(x - 0.2, -2.05, H + 0.006), P(x - 0.5, -1.92, H + 0.006), '#f2f2ee', NM.paint, 0.3)
  }
  // --- ゴンドラが通る溝（底のコンクリートと排水の溝）と、向かいの係員の通路 ---
  const T = PLATFORM.pit
  wbox(k, T.x0, T.x1, -T.halfZ, T.halfZ, -0.3, 0.12, '#8d8b85', NM.concrete)
  wbox(k, T.x0, T.x1, -0.12, 0.12, 0.12, 0.125, '#2a2b2c', NM.iron, 0.3)
  const S = PLATFORM.service
  wbox(k, S.x0, S.x1, S.z0, S.z1, -0.3, H - 0.04, '#b7b4ad', NM.concrete)
  wbox(k, S.x0, S.x1, S.z0 + 0.3, S.z1, H - 0.04, H, DECK, NM.tileClad, 0.3)
  wbox(k, S.x0, S.x1, S.z0, S.z0 + 0.3, H - 0.04, H + 0.004, YELLOW, NM.tileClad, 0.06)
  wbox(k, S.x0, S.x1, S.z0 - 0.04, S.z0 + 0.01, H - 0.32, H - 0.06, '#1c1c1c', NM.dark, 0.2)
  glassRail(k, [S.x0, S.z1 - 0.05, H], [S.x1, S.z1 - 0.05, H], 1.1, 1.4, false)
  for (const x of [S.x0 + 0.05, S.x1 - 0.05]) glassRail(k, [x, S.z0 + 0.35, H], [x, S.z1 - 0.05, H], 1.1, 1.4, false)
  // 台の外の溝の続き（ゴンドラが地面の上を通る所）は、白い鋼の柵で囲う（柱と 3 段の横棒。向こうが透けて見える）
  const fence = (x0: number, x1: number, z: number) => {
    const n = Math.max(1, Math.round(Math.abs(x1 - x0) / 1.6))
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n
      b.beam(P(x, z, 0), P(x, z, 1.2), 0.06, '#d9dcde', NM.paint, 0.5)
    }
    for (const h of [0.12, 0.62, 1.18]) b.beam(P(x0, z, h), P(x1, z, h), h > 1 ? 0.05 : 0.035, '#d9dcde', NM.paint, 0.5)
  }
  for (const z of [-2.2, 2.4]) {
    fence(T.x0 - 6.5, T.x0, z)
    fence(T.x1, T.x1 + 6.5, z)
  }
  // --- 階段（台の縁から −z へ。踏み面の先に黄色い滑り止め）と、両側の手すり ---
  const ST = PLATFORM.stairs
  const rise = H / ST.risers
  for (let i = 1; i < ST.risers; i++) {
    // 段 i（下から）: 蹴上げ i の線から台の縁まで（下の段の上に重ねて、段の下も埋まる）
    const zf = D.z0 - (ST.risers - i) * ST.run
    wbox(k, ST.x0, ST.x1, zf, zf + ST.run, i === 1 ? -0.2 : (i - 1) * rise, i * rise, '#b9b6ae', NM.granite)
    wbox(k, ST.x0, ST.x1, zf, zf + 0.05, i * rise - 0.01, i * rise + 0.004, YELLOW, NM.paint, 0.4)
  }
  const zBottom = D.z0 - (ST.risers - 1) * ST.run
  for (const x of [ST.x0 - 0.12, ST.x1]) {
    // 側桁（白い鋼板）
    b.quad(P(x + (x < ST.x0 ? 0 : 0.12), zBottom - 0.02, 0), P(x + (x < ST.x0 ? 0 : 0.12), D.z0, 0), P(x + (x < ST.x0 ? 0 : 0.12), D.z0, H + 0.08), P(x + (x < ST.x0 ? 0 : 0.12), zBottom - 0.02, rise + 0.08), WHITE, NM.paint, 0.45)
    wbox(k, x, x + 0.12, zBottom - 0.02, D.z0, -0.02, 0.12, WHITE, NM.paint, 0.45)
    glassRail(k, [x + 0.06, zBottom - 0.15, rise * 0.5], [x + 0.06, D.z0 - 0.05, H], 1.0, 1.2, true)
  }
  // 階段の下の床（石の敷物）
  wbox(k, ST.x0 - 0.6, ST.x1 + 0.6, zBottom - 1.6, zBottom, -0.2, 0.02, '#c6c0b4', NM.paving)
  // --- スロープ（降り口。台の縁から −z へ 16.5m。両側にガラスの手すり） ---
  const R = PLATFORM.ramp
  const zR = D.z0 - R.len
  const seg = 12
  for (let i = 0; i < seg; i++) {
    const za = D.z0 - (R.len * i) / seg
    const zb = D.z0 - (R.len * (i + 1)) / seg
    const ha = H * (1 - i / seg)
    const hb = H * (1 - (i + 1) / seg)
    // 上の面（灰色のタイル）と、下の白い鋼板の側面
    b.quad(P(R.x0, za, ha), P(R.x1, za, ha), P(R.x1, zb, hb), P(R.x0, zb, hb), DECK, NM.tileClad, 0.3)
    b.quad(P(R.x0 - 0.06, za, -0.05), P(R.x0 - 0.06, zb, -0.05), P(R.x0 - 0.06, zb, hb + 0.06), P(R.x0 - 0.06, za, ha + 0.06), WHITE, NM.paint, 0.45)
    b.quad(P(R.x1 + 0.06, zb, -0.05), P(R.x1 + 0.06, za, -0.05), P(R.x1 + 0.06, za, ha + 0.06), P(R.x1 + 0.06, zb, hb + 0.06), WHITE, NM.paint, 0.45)
  }
  wbox(k, R.x0 - 0.06, R.x1 + 0.06, D.z0 - 0.4, D.z0, -0.05, H - 0.04, '#b7b4ad', NM.concrete)
  for (const x of [R.x0 - 0.03, R.x1 + 0.03]) glassRail(k, [x, D.z0 - 0.02, H], [x, zR + 0.2, 0.02], 1.1, 1.4, true)
  // スロープの下の石の敷物
  wbox(k, R.x0 - 0.6, R.x1 + 0.6, zR - 1.6, zR, -0.2, 0.02, '#c6c0b4', NM.paving)
  // --- 台の手すり（ガラス）: 建物の側の縁（階段とスロープの口を除く）・両端・ゴンドラの側の両端の短い柵 ---
  const zr = D.z0 + 0.06
  glassRail(k, [D.x0 + 0.06, zr, H], [ST.x0 - 0.12, zr, H])
  glassRail(k, [ST.x1 + 0.12, zr, H], [R.x0 - 0.06, zr, H])
  glassRail(k, [R.x1 + 0.06, zr, H], [D.x1 - 0.06, zr, H])
  glassRail(k, [D.x0 + 0.06, zr, H], [D.x0 + 0.06, D.z1 - 0.4, H])
  glassRail(k, [D.x1 - 0.06, zr, H], [D.x1 - 0.06, D.z1 - 0.4, H])
  glassRail(k, [D.x0 + 0.06, D.z1 - 0.4, H], [D.x0 + 2.0, D.z1 - 0.4, H])
  glassRail(k, [D.x1 - 1.6, D.z1 - 0.4, H], [D.x1 - 0.06, D.z1 - 0.4, H])
  // --- ガラスの屋根（白い鋼の柱と片持ちの梁。台の外の柱から、ゴンドラの手前まで張り出す） ---
  const C = PLATFORM.canopy
  const hTop = H + C.rise
  const roofH = (z: number) => hTop + 0.1 * ((z - C.z0) / (C.z1 - C.z0))
  const cols = [-8.0, -2.6, 2.4, 7.0]
  const zc = C.z0 + 0.15
  for (const x of cols) {
    b.cylinder(P(x, zc, 0), 0.11, hTop - 0.05, 14, WHITE, NM.paint, 0.5, false)
    wbox(k, x - 0.28, x + 0.28, zc - 0.28, zc + 0.28, -0.05, 0.12, '#bdb9b1', NM.concrete)
  }
  // 片持ちの梁（2.6m ごと。柱の上から、先ほど細く）
  const ribs: number[] = []
  for (let x = C.x0; x <= C.x1 + 0.01; x += (C.x1 - C.x0) / 6) ribs.push(x)
  for (const x of ribs) {
    b.quad(P(x - 0.06, C.z0, roofH(C.z0) - 0.32), P(x - 0.06, C.z1, roofH(C.z1) - 0.08), P(x - 0.06, C.z1, roofH(C.z1)), P(x - 0.06, C.z0, roofH(C.z0)), WHITE, NM.paint, 0.5)
    b.quad(P(x + 0.06, C.z1, roofH(C.z1) - 0.08), P(x + 0.06, C.z0, roofH(C.z0) - 0.32), P(x + 0.06, C.z0, roofH(C.z0)), P(x + 0.06, C.z1, roofH(C.z1)), WHITE, NM.paint, 0.5)
    b.quad(P(x - 0.06, C.z1, roofH(C.z1) - 0.08), P(x - 0.06, C.z0, roofH(C.z0) - 0.32), P(x + 0.06, C.z0, roofH(C.z0) - 0.32), P(x + 0.06, C.z1, roofH(C.z1) - 0.08), '#e6e8e8', NM.paint, 0.5)
  }
  // 縁の梁（建物の側は雨どいと看板の帯、ゴンドラの側は細い縁）
  wbox(k, C.x0 - 0.1, C.x1 + 0.1, C.z0 - 0.08, C.z0 + 0.22, roofH(C.z0) - 0.42, roofH(C.z0) + 0.04, WHITE, NM.paint, 0.5)
  wbox(k, C.x0 - 0.1, C.x1 + 0.1, C.z1 - 0.12, C.z1, roofH(C.z1) - 0.12, roofH(C.z1) + 0.04, WHITE, NM.paint, 0.5)
  // ガラスの屋根の板
  for (let i = 0; i + 1 < ribs.length; i++) {
    const x0 = ribs[i] + 0.06
    const x1 = ribs[i + 1] - 0.06
    k.clear.quad(P(x0, C.z0 + 0.22, roofH(C.z0 + 0.22) + 0.01), P(x0, C.z1 - 0.12, roofH(C.z1 - 0.12) + 0.01), P(x1, C.z1 - 0.12, roofH(C.z1 - 0.12) + 0.01), P(x1, C.z0 + 0.22, roofH(C.z0 + 0.22) + 0.01), '#ffffff', 0)
  }
  // 看板の帯（建物の側。階段の上に「のりば」、スロープの上に「出口」）
  const signZ = C.z0 - 0.09
  const bandSign = (x: number, w: number, style: Omit<SignStyle, 'w' | 'h'>) => {
    const r = signAtlas.region({ ...style, w, h: 0.4 } as SignStyle)
    const h0 = roofH(C.z0) - 0.41
    k.signs.quad(P(x + w / 2, signZ, h0), P(x - w / 2, signZ, h0), P(x - w / 2, signZ, h0 + 0.4), P(x + w / 2, signZ, h0 + 0.4), r, 1)
  }
  bandSign((ST.x0 + ST.x1) / 2, 4.6, { text: '大観覧車ソラノワ のりば', sub: 'SORANOWA BOARDING', fg: '#ffffff', bg: NAVY, font: 'sans', bold: true })
  bandSign((R.x0 + R.x1) / 2, 2.4, { text: '出口 →', sub: 'EXIT', fg: '#1e1e1e', bg: YELLOW, font: 'sans', bold: true })
  // 屋根の下の灯り（台を照らす町の灯りと、梁の下の光る板）
  for (let i = 0; i + 1 < ribs.length; i++) {
    const x = (ribs[i] + ribs[i + 1]) / 2
    const z = (C.z0 + C.z1) / 2 + 0.2
    k.glowBox(P(x, z, roofH(z) - 0.16), [1.3, 0.04, 0.16], '#fff4e2', 0, 2.0, W.yaw)
    b.box(P(x, z, roofH(z) - 0.1), [1.4, 0.08, 0.22], '#d9dcdc', NM.paint, 0.5, W.yaw)
    k.lamp(P(x, z, roofH(z) - 0.2), 6.5, '#ffe9cc', 1.25, 0.3, 1)
  }
  // --- 台の上の案内（動いているゴンドラへの注意・一周の時間）と係員の操作盤 ---
  const sign = (x: number, z: number, w: number, h: number, style: Omit<SignStyle, 'w' | 'h'>, facing: 1 | -1) => {
    // 柱と板（facing = +1 なら +z（ゴンドラの側）、-1 なら −z（建物の側）を向く）
    b.beam(P(x, z, H), P(x, z, H + 1.35), 0.06, '#9aa0a4', NM.steel, 0.5)
    wbox(k, x - w / 2 - 0.03, x + w / 2 + 0.03, z - 0.03, z + 0.03, H + 1.32, H + 1.36 + h, '#ffffff', NM.paint, 0.4)
    const r = signAtlas.region({ ...style, w, h } as SignStyle)
    const zz = z + facing * 0.035
    const h0 = H + 1.34
    if (facing > 0) k.signs.quad(P(x - w / 2, zz, h0), P(x + w / 2, zz, h0), P(x + w / 2, zz, h0 + h), P(x - w / 2, zz, h0 + h), r, 2)
    else k.signs.quad(P(x + w / 2, zz, h0), P(x - w / 2, zz, h0), P(x - w / 2, zz, h0 + h), P(x + w / 2, zz, h0 + h), r, 2)
  }
  sign(-2.4, D.z0 + 0.35, 1.1, 0.62, { text: 'ゴンドラは止まりません\n足もとにご注意ください', sub: 'GONDOLAS KEEP MOVING', fg: NAVY, bg: '#ffffff', font: 'sans', bold: true }, -1)
  sign(1.9, D.z0 + 0.35, 1.1, 0.62, { text: '一周 約15分', sub: 'ONE TURN · ABOUT 15 MIN', fg: NAVY, bg: '#ffffff', font: 'sans', bold: true }, -1)
  // 係員の操作盤（台の下流の端。押しボタンと非常停止）
  wbox(k, D.x0 + 0.4, D.x0 + 1.0, D.z1 - 1.25, D.z1 - 0.75, H, H + 1.05, '#e9ebeb', NM.paint, 0.5)
  wbox(k, D.x0 + 0.38, D.x0 + 1.02, D.z1 - 1.27, D.z1 - 0.73, H + 1.05, H + 1.12, '#5a6066', NM.paint, 0.6)
  k.glowBox(P(D.x0 + 0.62, D.z1 - 0.74, H + 0.92), [0.08, 0.08, 0.02], '#ff3a2a', 1, 1.8, W.yaw)
  k.glowBox(P(D.x0 + 0.82, D.z1 - 0.74, H + 0.92), [0.06, 0.06, 0.02], '#3dff8a', 1, 1.4, W.yaw)
}
