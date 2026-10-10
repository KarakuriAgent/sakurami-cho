import * as THREE from 'three'
import type { P2 } from '../town/townData'
import { Frame, type V3 } from './frame'
import {
  awning,
  band,
  canopy,
  fbox,
  flowerBox,
  type DoorStyle,
  type GlassSpec,
  type Kit,
  lintel,
  type Opening,
  type OpeningShape,
  pilaster,
  rectWall,
  ringBand,
  shutters,
  sill,
  spansExcept,
  steps,
  surround,
  wallLamp,
} from './kit'
import { GLASS, LIGHT_CLASS, NM } from './namedMaterial'
import type { NamedRecord } from './namedData'
import type { SignStyle } from './signs'

/**
 * 建物の胴（外形の壁・窓・扉・店先・帯・基壇）を、面ごとの決まり（FaceSpec）から作る。組み立ての型（kits/）の多くはこれを使い、
 * 屋根と建物ごとの飾りを足す。遠くの形（mass）の壁もここで書く
 */

export interface Trim {
  color: string
  mat: number
}

export interface WinSpec {
  w: number
  ht: number
  /** 階の床からの窓の下端（m） */
  sill: number
  shape?: OpeningShape
  depth?: number
  glass?: GlassSpec
  sillTrim?: Trim | null
  lintel?: (Trim & { keystone?: boolean }) | null
  surround?: (Trim & { w?: number }) | null
  shutters?: string | null
  flowers?: boolean
  revealColor?: string
}

export interface ShopSpec {
  glass: GlassSpec
  /** 枠・付け柱の色 */
  frame: string
  /** 腰板（窓の下）の色・質感 */
  kick?: Trim
  /** 看板の帯（ひさしの上） */
  fascia?: Trim
  sign?: Omit<SignStyle, 'w' | 'h'> | null
  /** 看板の光り方（signs の mode） */
  signMode?: number
  awning?: { color: string; stripes?: number } | null
  door?: DoorStyle
  /** ショーウィンドウの高さ（床から） */
  windowTop?: number
}

export interface DoorAt {
  /** 面に沿った扉の中心 */
  s: number
  w: number
  ht: number
  style: DoorStyle
  shape?: OpeningShape
  /** 扉の前の段の数（地面が低いとき） */
  steps?: number
  lamp?: 'lantern' | 'bulb' | 'gas' | null
  canopy?: Trim & { depth: number } | null
  surround?: Trim | null
}

export interface FaceSpec {
  win: WinSpec | null
  /** 窓の間口の目安（m） */
  bay: number
  /** 1 階の扱い（windows = 上の階と同じ窓、shop = 店先、none = 窓なし） */
  ground?: 'windows' | 'shop' | 'none'
  groundWin?: WinSpec | null
  shop?: ShopSpec
  doors?: DoorAt[]
  /** そのまま足す開口（組み立ての型が自分で並べる店先など） */
  openings?: Opening[]
  /** これより短い面には窓を付けない */
  minLen?: number
}

export interface BodySpec {
  ring: P2[]
  z: number
  /** 壁の下端（床からの高さ。地面の低い所より下） */
  bottom: number
  floors: number
  floorH: number
  groundH?: number
  /** 壁の上端（床から） */
  top: number
  wall: Trim & { aux?: number }
  /** 下の方の壁（h より下を別の質感に。町家の 1 階の板張りなど） */
  wallLower?: Trim & { aux?: number; h: number }
  plinth?: Trim & { ht: number; proj?: number; aux?: number }
  bands?: Trim & { hs: number[]; ht: number; proj: number }
  cornice?: Trim & { ht: number; proj: number }
  quoins?: Trim
  faces: (FaceSpec | null)[]
  /** 正面の辺（遠くの形の店先） */
  frontEdge: number
  /** 遠くの形の窓のある高さ（無ければ top − 0.9） */
  windowTop?: number
}

/** 階の床の高さ（床から） */
export function storeyBase(spec: { groundH?: number; floorH: number }, i: number) {
  const g = spec.groundH ?? spec.floorH
  return i === 0 ? 0 : g + (i - 1) * spec.floorH
}

/** 胴を作る。戻り値は面ごとの Frame と長さ */
export function buildBody(k: Kit, spec: BodySpec) {
  const ring = spec.ring
  const n = ring.length
  const faces: { f: Frame; L: number; openings: Opening[] }[] = []
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    const f = Frame.edge(p, q, spec.z)
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    const face = spec.faces[i] ?? null
    const openings: Opening[] = []
    const trims: (() => void)[] = []
    if (face && L >= (face.minLen ?? 2.2)) {
      const doors = face.doors ?? []
      const doorAt = (s0: number, s1: number) => doors.some((d) => s1 > d.s - d.w / 2 - 0.25 && s0 < d.s + d.w / 2 + 0.25)
      for (let fl = 0; fl < spec.floors; fl++) {
        const hb = storeyBase(spec, fl)
        const fh = fl === 0 ? (spec.groundH ?? spec.floorH) : spec.floorH
        if (hb + 0.5 > spec.top) break
        if (fl === 0 && face.ground === 'shop' && face.shop) {
          shopFront(k, f, L, fh, face.shop, doors, openings, trims)
          continue
        }
        if (fl === 0 && face.ground === 'none') continue
        const win = fl === 0 && face.groundWin !== undefined ? face.groundWin : face.win
        if (!win) continue
        const nb = Math.max(1, Math.round(L / face.bay))
        const bw = L / nb
        for (let bi = 0; bi < nb; bi++) {
          const c = (bi + 0.5) * bw
          const w = Math.min(win.w, bw - 0.35)
          if (w < 0.3) continue
          // 桟の数が負なら「この幅ごとに 1 本」（連窓・カーテンウォール）
          const glass = win.glass && (win.glass.cols ?? 2) < 0 ? { ...win.glass, cols: Math.max(1, Math.round(w / -(win.glass.cols ?? -1.5))) } : win.glass
          const o: Opening = { s: c - w / 2, h: hb + win.sill, w, ht: Math.min(win.ht, spec.top - hb - win.sill - 0.15), shape: win.shape, depth: win.depth ?? 0.16, glass, revealColor: win.revealColor }
          if (o.ht < 0.3) continue
          if (fl === 0 && doorAt(o.s, o.s + o.w)) continue
          openings.push(o)
          trims.push(() => windowTrims(k, f, o, win))
        }
      }
      if (face.openings) openings.push(...face.openings)
      for (const d of doors) {
        const o: Opening = { s: d.s - d.w / 2, h: 0, w: d.w, ht: d.ht, shape: d.shape, depth: 0.22, fill: 'door', door: d.style }
        openings.push(o)
        trims.push(() => doorTrims(k, f, o, d))
      }
    }
    if (spec.wallLower) {
      const wl = spec.wallLower
      // 開口は下端が wl.h より下なら下の壁、それ以外は上の壁（境をまたぐ開口は下の壁の上端を開口の上まで上げずに、上の壁にも穴をあける）
      const lower = openings.filter((o) => o.h < wl.h - 0.01)
      const upper = openings.filter((o) => o.h >= wl.h - 0.01)
      const cut = Math.max(wl.h, ...lower.map((o) => o.h + o.ht + 0.02))
      rectWall(k, f, 0, L, spec.bottom, cut, lower, wl.color, wl.mat, wl.aux ?? 0)
      rectWall(k, f, 0, L, cut, spec.top, upper, spec.wall.color, spec.wall.mat, spec.wall.aux ?? 0)
    } else rectWall(k, f, 0, L, spec.bottom, spec.top, openings, spec.wall.color, spec.wall.mat, spec.wall.aux ?? 0)
    for (const t of trims) t()
    faces.push({ f, L, openings })
    // 遠くの形の壁
    const hasWindows = !!face && L >= (face.minLen ?? 2.2) && !!(face.win || face.ground === 'shop')
    k.mass.wallQuad(p, q, spec.z + spec.bottom, spec.z + spec.top, spec.z, hasWindows ? (spec.windowTop ?? Math.max(1.5, spec.top - 0.9)) : 0, i === spec.frontEdge)
  }
  // 基壇・帯・軒蛇腹・隅石（基壇と帯は、扉・店先などの開口の所を切る）
  if (spec.plinth) bandAround(k, faces, spec.bottom, spec.plinth.ht - spec.bottom, spec.plinth.proj ?? 0.06, spec.plinth.color, spec.plinth.mat, spec.plinth.aux ?? 0)
  if (spec.bands) for (const h of spec.bands.hs) bandAround(k, faces, h, spec.bands.ht, spec.bands.proj, spec.bands.color, spec.bands.mat)
  if (spec.cornice) {
    ringBand(k, ring, spec.z, spec.top - spec.cornice.ht, spec.cornice.ht * 0.45, spec.cornice.proj * 0.5, spec.cornice.color, spec.cornice.mat)
    ringBand(k, ring, spec.z, spec.top - spec.cornice.ht * 0.55, spec.cornice.ht * 0.55, spec.cornice.proj, spec.cornice.color, spec.cornice.mat)
  }
  if (spec.quoins) {
    for (let i = 0; i < n; i++) {
      const f = faces[i].f
      const L = faces[i].L
      const fp = faces[(i + n - 1) % n].f
      const Lp = faces[(i + n - 1) % n].L
      void fp
      void Lp
      // 開口（角の近くの扉・窓）にかかる石は置かない
      const free = (s0: number, s1: number, h0: number, h1: number) => !faces[i].openings.some((o) => o.s < s1 && o.s + o.w > s0 && o.h < h1 && o.h + o.ht > h0)
      for (let h = Math.max(spec.bottom, (spec.plinth?.ht ?? 0)), j = 0; h < spec.top - 0.6; h += 0.6, j++) {
        const w = j % 2 === 0 ? 0.55 : 0.32
        if (free(-0.04, w, h + 0.02, h + 0.56)) fbox(k.solid, f, -0.04, w, -0.04, 0.02, h + 0.02, h + 0.56, spec.quoins.color, spec.quoins.mat, 0)
        if (free(L - w, L + 0.04, h + 0.02, h + 0.56)) fbox(k.solid, f, L - w, L + 0.04, -0.04, 0.02, h + 0.02, h + 0.56, spec.quoins.color, spec.quoins.mat, 0)
      }
    }
  }
  return faces
}

/**
 * 外周の帯（基壇・階の帯）を面ごとに巻く。帯の高さ（h〜h + ht）にかかる開口（扉・店先・低い窓）の幅は、開口の下端より上を切る
 * （基壇なら、扉の下の地面より下の部分は残る）。角は面の外へ proj だけ張り出して、となりの面の帯と重ねる。
 * 前は外周に一周巻いていたので、扉の開口の下を膝〜腰の高さの基壇がふさぎ、花音がそこを突き抜けて出入りしていた（docs/design/town.md §7 の 129）
 */
function bandAround(k: Kit, faces: readonly { f: Frame; L: number; openings: Opening[] }[], h: number, ht: number, proj: number, color: string, mat: number, aux = 0) {
  const top = h + ht
  for (const { f, L, openings } of faces) {
    const cuts = openings
      .filter((o) => o.h < top - 0.005 && o.h + o.ht > h + 0.005 && o.s + o.w > -proj && o.s < L + proj)
      .map((o) => ({ s0: o.s, s1: o.s + o.w, bottom: Math.max(h, o.h) }))
      .sort((a, b) => a.s0 - b.s0)
    let s = -proj
    for (const c of cuts) {
      if (c.s0 > s + 0.005) fbox(k.solid, f, s, c.s0, -proj, 0.02, h, top, color, mat, aux)
      // 開口の下端より下（扉の下の地面より下・窓の下の腰）は残す
      if (c.bottom > h + 0.005 && c.s1 > Math.max(s, c.s0)) fbox(k.solid, f, Math.max(s, c.s0), c.s1, -proj, 0.02, h, c.bottom, color, mat, aux)
      s = Math.max(s, c.s1)
    }
    if (L + proj > s + 0.005) fbox(k.solid, f, s, L + proj, -proj, 0.02, h, top, color, mat, aux)
  }
}

/** 窓のまわりの飾り */
export function windowTrims(k: Kit, f: Frame, o: Opening, win: WinSpec) {
  if (win.sillTrim) sill(k, f, o, win.sillTrim.color, win.sillTrim.mat)
  if (win.lintel) lintel(k, f, o, win.lintel.color, win.lintel.mat, 0.22, 0.04, 0.1, win.lintel.keystone)
  if (win.surround) surround(k, f, o, win.surround.color, win.surround.mat, win.surround.w ?? 0.12)
  if (win.shutters) shutters(k, f, o, win.shutters)
  if (win.flowers) flowerBox(k, f, o)
}

/** 扉のまわり（額縁・段・ひさし・灯り） */
function doorTrims(k: Kit, f: Frame, o: Opening, d: DoorAt) {
  if (d.surround) surround(k, f, o, d.surround.color, d.surround.mat, 0.14, 0.06)
  if (d.steps && d.steps > 0) steps(k, f, o.s - 0.25, o.s + o.w + 0.25, d.steps, 0.16, 0.32, '#9a958c')
  else fbox(k.solid, f, o.s - 0.15, o.s + o.w + 0.15, -0.45, 0.05, -0.4, 0.04, '#9a958c', NM.granite)
  if (d.canopy) canopy(k, f, o.s - 0.4, o.s + o.w + 0.4, o.ht + 0.45, d.canopy.depth, d.canopy.color, d.canopy.mat)
  if (d.lamp) wallLamp(k, f, o.s + o.w + 0.35, Math.min(o.ht + 0.1, 2.3), d.lamp)
}

/**
 * 店先（1 階の正面）: 腰板・ショーウィンドウ・ガラスの扉・看板の帯・日よけ。開口は openings に足す
 */
function shopFront(k: Kit, f: Frame, L: number, fh: number, sp: ShopSpec, doors: DoorAt[], openings: Opening[], trims: (() => void)[]) {
  const top = Math.min(sp.windowTop ?? fh - 0.55, fh - 0.3)
  const kickH = 0.45
  const margin = 0.35
  const nb = Math.max(1, Math.round((L - margin * 2) / 2.4))
  const bw = (L - margin * 2) / nb
  const doorList = doors.length ? doors : [{ s: L / 2, w: Math.min(1.6, bw - 0.3), ht: Math.min(2.3, top), style: sp.door ?? { kind: 'glass', color: sp.frame, glass: sp.glass } }]
  if (!doors.length) doors.push(doorList[0] as DoorAt)
  for (let i = 0; i < nb; i++) {
    const s0 = margin + i * bw + 0.08
    const s1 = margin + (i + 1) * bw - 0.08
    const hitDoor = doorList.find((d) => s1 > d.s - d.w / 2 - 0.1 && s0 < d.s + d.w / 2 + 0.1)
    if (hitDoor) {
      // 扉の横の残り
      const segs: [number, number][] = []
      if (hitDoor.s - hitDoor.w / 2 - 0.12 - s0 > 0.5) segs.push([s0, hitDoor.s - hitDoor.w / 2 - 0.12])
      if (s1 - (hitDoor.s + hitDoor.w / 2 + 0.12) > 0.5) segs.push([hitDoor.s + hitDoor.w / 2 + 0.12, s1])
      for (const [a, b] of segs) openings.push({ s: a, h: kickH, w: b - a, ht: top - kickH, depth: 0.14, glass: { ...sp.glass, cols: Math.max(1, Math.round((b - a) / 1.2)), rows: 1, bar: 0.04, frame: sp.frame } })
      continue
    }
    openings.push({ s: s0, h: kickH, w: s1 - s0, ht: top - kickH, depth: 0.14, glass: { ...sp.glass, cols: Math.max(1, Math.round((s1 - s0) / 1.2)), rows: 1, bar: 0.04, frame: sp.frame } })
  }
  trims.push(() => {
    const b = k.solid
    // 腰板（扉の所は切る）
    const kick = sp.kick ?? { color: sp.frame, mat: NM.paint }
    for (const [s0, s1] of spansExcept(margin - 0.05, L - margin + 0.05, doorList.map((d) => [d.s - d.w / 2, d.s + d.w / 2] as const)))
      fbox(b, f, s0, s1, -0.06, 0.02, 0, kickH, kick.color, kick.mat, 0.3)
    // 付け柱
    for (let i = 0; i <= nb; i++) pilaster(k, f, margin + i * bw, 0.16, 0, top + 0.1, 0.07, sp.frame, NM.paint, 0.35)
    // 看板の帯
    const fascia = sp.fascia ?? { color: sp.frame, mat: NM.paint }
    const fb0 = top + 0.12
    const fb1 = Math.min(fh - 0.05, top + 0.62)
    if (fb1 - fb0 > 0.2) {
      fbox(b, f, margin - 0.1, L - margin + 0.1, -0.12, 0.02, fb0, fb1, fascia.color, fascia.mat, 0.3)
      fbox(b, f, margin - 0.16, L - margin + 0.16, -0.16, 0.02, fb1, fb1 + 0.06, fascia.color, fascia.mat, 0.3)
      if (sp.sign) {
        const sw = Math.min(L - margin * 2 - 0.4, Math.max(1.6, (fb1 - fb0) * 7))
        k.sign(f, L / 2 - sw / 2, fb0 + 0.05, sw, fb1 - fb0 - 0.1, -0.125, sp.sign, sp.signMode ?? 2)
      }
    }
    if (sp.awning) awning(k, f, margin, L - margin, top + 0.06, 1.1, 0.22, sp.awning.color, sp.awning.stripes ?? 0)
  })
}

/* -------------------------------------------------------------------------- */
/* データから                                                                   */
/* -------------------------------------------------------------------------- */

/** データの色（0〜255）を CSS の色に。k を掛けて明るさを変える */
export function cssOf(rgb: readonly number[], k = 1) {
  const c = new THREE.Color(Math.min(1, (rgb[0] / 255) * k), Math.min(1, (rgb[1] / 255) * k), Math.min(1, (rgb[2] / 255) * k))
  return `#${c.getHexString()}`
}

/** 文字の中の #rrggbb の色（順に）を CSS の色の列で */
export function hexesIn(text: string | null | undefined) {
  return [...(text ?? '').matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase())
}

/** 入口のうち、外形の辺 i（p → q）に近いものの、辺に沿った位置（面の s） */
export function doorsOnEdge(rec: NamedRecord, p: P2, q: P2, z: number, maxDist = 2.5) {
  const f = Frame.edge(p, q, z)
  const L = Math.hypot(q[0] - p[0], q[1] - p[1])
  const out: { s: number; e: (typeof rec.entrances)[number]; index: number }[] = []
  rec.entrances.forEach((e, index) => {
    const [s, t] = f.local(e.x, e.y)
    if (s > -0.5 && s < L + 0.5 && Math.abs(t) < maxDist) out.push({ s: Math.min(L - 0.6, Math.max(0.6, s)), e, index })
  })
  return out
}

/** 外形の各辺が向く方位（度） */
export function edgeBearing(p: P2, q: P2) {
  const nx = q[1] - p[1]
  const ny = -(q[0] - p[0])
  return ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360
}

/** 正面の辺の番号（データの正面の向きに最も近い外向きの辺） */
export function frontEdgeOf(ring: P2[], front: number | null) {
  if (front === null) {
    let best = 0
    let bl = 0
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length]
      const l = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (l > bl) {
        bl = l
        best = i
      }
    })
    return best
  }
  let best = 0
  let bd = Infinity
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]
    const l = Math.hypot(q[0] - p[0], q[1] - p[1])
    let d = Math.abs(((edgeBearing(p, q) - front + 540) % 360) - 180)
    d -= Math.min(l, 30) * 0.15
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

/** 段の数（入口の地面と床の差から） */
export function stepsFor(z: number, ground: number) {
  return Math.max(0, Math.min(12, Math.round((z - ground) / 0.16)))
}

export const DEFAULT_GLASS = { kind: GLASS.house, cls: LIGHT_CLASS.window } as const
export { band }
export type { V3 }
