// 建物を、地図（world）が組み立てる「記録」に直す（形の種類・大きさ・向き・色・外壁の種類・用途）。
// 形の組み立て（屋根・外壁・窓）は world（world/outdoor/town/buildingKit.ts・facades.ts とシェーダー）がする。ここでは数字をそろえるだけ。
import { centroid, hexIn, openRing, rectOf, ringArea, seedOf } from './geo.mjs'

/** 屋根の形（world/outdoor/town/buildingKit.ts の ROOF と同じ番号） */
export const ROOF = { flat: 0, gable: 1, hip: 2, mansard: 3, shed: 4, sawtooth: 5, irimoya: 6, arch: 7 }
/** 外壁の種類（world/outdoor/town/buildingKit.ts の FACADE と同じ番号） */
export const FACADE = { wood: 0, plaster: 1, stone: 2, brick: 3, glass: 4, concrete: 5, metal: 6, archGlass: 7 }
/** 用途（world の USE と同じ番号） */
export const USE = { residential: 0, mixed: 1, commercial: 2, office: 3, port: 4, workshop: 5, civic: 6, lab: 7, school: 8, religious: 9 }
/** 印（ビット） */
export const FLAG = { named: 1, viaduct: 2, roofGarden: 4, flowers: 8, shop: 16, warehouse: 32, tall: 64, hedge: 128 }

/**
 * 町並みの型（街区の profile・地区から。world の STYLE と同じ番号）。外壁の型（窓・ベランダ・店先・汚れ方）を選ぶのに使う
 * 0 ふつう / 1 和の木造の町 / 2 洋風の古い町（煉瓦・石の商館と商店） / 3 中層の町 / 4 新しい高層 / 5 郊外の新しい住宅 / 6 港と工房 / 7 島の石の家
 */
export const STYLE = { general: 0, wooden: 1, oldWestern: 2, midrise: 3, modern: 4, suburban: 5, port: 6, island: 7 }

/** 街区の profile（blocks.geojson）→ 町並みの型 */
const PROFILE_STYLE = {
  'kaede.1': STYLE.wooden,
  'kaede.outer': STYLE.wooden,
  'kaede.res': STYLE.wooden,
  'akari.2': STYLE.wooden,
  'akari.4': STYLE.wooden,
  'akari.5': STYLE.wooden,
  'oka.kitadani': STYLE.wooden,
  'shiomi.old': STYLE.oldWestern,
  'shiomi.akarenga': STYLE.oldWestern,
  'ekimae.teishajo': STYLE.oldWestern,
  'ekimae.kiteki': STYLE.oldWestern,
  'unga.sakura': STYLE.oldWestern,
  'unga.suiro': STYLE.oldWestern,
  'chuo.bunko': STYLE.oldWestern,
  'chuo.enkan': STYLE.midrise,
  'chuo.yakuba': STYLE.midrise,
  'chuo.ryokuju': STYLE.midrise,
  'shiomi.mid': STYLE.midrise,
  'unga.yanagi': STYLE.midrise,
  'ekimae.ekiura': STYLE.midrise,
  'shiomi.shin': STYLE.modern,
  'gakuen.school': STYLE.modern,
  'gakuen.higashino': STYLE.suburban,
  'gakuen.kanegaoka': STYLE.suburban,
  'gakuen.outer': STYLE.suburban,
  'oka.upper': STYLE.suburban,
  'oka.summit': STYLE.suburban,
  'chuo.park': STYLE.suburban,
  'shiomi.kitafuto': STYLE.port,
  'shiomi.hobashira': STYLE.port,
  'unga.funadamari': STYLE.port,
  'gakuen.kobo': STYLE.port,
  shima: STYLE.island,
}
/** 地区（district）→ 街区の分からない建物の町並みの型 */
const DISTRICT_STYLE = {
  楓坂: STYLE.wooden,
  灯町: STYLE.wooden,
  桜木丘: STYLE.suburban,
  中央地区: STYLE.midrise,
  駅前地区: STYLE.oldWestern,
  運河地区: STYLE.oldWestern,
  汐見港地区: STYLE.midrise,
  学園地区: STYLE.suburban,
  汐見島: STYLE.island,
}

/** 街区の profile か地区から、町並みの型 */
export function styleOf(profile, district) {
  if (profile && profile in PROFILE_STYLE) return PROFILE_STYLE[profile]
  if (district && district in DISTRICT_STYLE) return DISTRICT_STYLE[district]
  return STYLE.general
}

/** 屋根の形の名前（データの roof_type）→ [形, 妻入りか] */
export function roofOf(roofType) {
  const t = roofType ?? ''
  if (t.includes('アーチ')) return [ROOF.arch, false]
  if (t.includes('マンサード')) return [ROOF.mansard, false]
  if (t.includes('のこぎり')) return [ROOF.sawtooth, false]
  if (t.includes('片流れ')) return [ROOF.shed, false]
  if (t.includes('入母屋')) return [ROOF.irimoya, false]
  if (t.startsWith('寄棟')) return [ROOF.hip, false]
  if (t.startsWith('切妻')) return [ROOF.gable, t.includes('妻入り')]
  return [ROOF.flat, false]
}

const FACADE_WORDS = [
  [FACADE.archGlass, ['アーチの開口']],
  [FACADE.brick, ['煉瓦']],
  [FACADE.glass, ['ガラス張り', 'カーテンウォール', '曲面ガラス', '鉄骨とガラス', '鋼板とガラス', 'ガラス']],
  [FACADE.metal, ['波板', '鋼板', 'トタン']],
  [FACADE.concrete, ['コンクリート', '打ち放し']],
  [FACADE.stone, ['花崗岩', '石張り', '石造', '白石', '白い石', '灰白の石', '石の灰', '石畳のグレーベージュ', '石']],
  [FACADE.wood, ['板張り', '下見板', '板', '白木', '木']],
  [FACADE.plaster, ['漆喰', 'クリーム', '白']],
]

/** 外壁の種類（壁の色の名前の最初に出てくる言葉。無ければ材料から） */
export function facadeOf(wallText, material) {
  const t = wallText ?? ''
  let best = null
  let bestAt = Infinity
  for (const [code, words] of FACADE_WORDS) {
    for (const w of words) {
      const at = t.indexOf(w)
      if (at >= 0 && at < bestAt) {
        best = code
        bestAt = at
      }
    }
  }
  if (best !== null) return best
  const m = material ?? ''
  if (m.startsWith('煉瓦')) return FACADE.brick
  if (m.startsWith('石')) return FACADE.stone
  if (m.startsWith('RC') || m.startsWith('鉄筋')) return FACADE.plaster
  if (m.startsWith('鉄骨')) return FACADE.metal
  return FACADE.wood
}

export function purposeOf(use) {
  if (use === 'industrial') return USE.workshop
  return USE[use] ?? USE.residential
}

/** 外壁の種類ごとの、色が無いときの色 */
const FACADE_COLOR = {
  [FACADE.wood]: [0x5b, 0x40, 0x33],
  [FACADE.plaster]: [0xe9, 0xe1, 0xcf],
  [FACADE.stone]: [0xc9, 0xbf, 0xae],
  [FACADE.brick]: [0xa5, 0x52, 0x3a],
  [FACADE.glass]: [0x6f, 0xa3, 0xb8],
  [FACADE.concrete]: [0x8e, 0x90, 0x93],
  [FACADE.metal]: [0x9a, 0x9a, 0x9a],
  [FACADE.archGlass]: [0x8a, 0x5a, 0x44],
}

/** 屋根の色の名前（# が無いもの）→ 色 */
const ROOF_NAMES = [
  ['黒瓦', [0x2b, 0x2b, 0x2b]],
  ['銀鼠', [0x8d, 0x90, 0x96]],
  ['緑青', [0x4f, 0x8f, 0x7a]],
  ['屋上', [0x6b, 0x8f, 0x4e]],
  ['白', [0xf4, 0xf4, 0xf2]],
  ['灰', [0x8a, 0x8a, 0x8a]],
  ['緑', [0x2e, 0x7d, 0x32]],
]

export function roofColorOf(text) {
  const hex = hexIn(text)
  if (hex) return hex
  for (const [w, c] of ROOF_NAMES) if ((text ?? '').includes(w)) return c
  return [0x5a, 0x5a, 0x5c]
}

export function wallColorOf(text, facade) {
  return hexIn(text) ?? FACADE_COLOR[facade]
}

/** 方位（真北から時計回りの度）→ 平面の単位ベクトル [東, 北] */
export const bearingVec = (deg) => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]

/**
 * 長方形の建物の向きを決める（局所の x = 棟の向き。gable の平入りは正面の辺に沿う、妻入りは正面に直角、寄棟は長い辺）。
 * 返す front: 正面の側（0 = 局所 +y、1 = 局所 -y、2 = 局所 +x、3 = 局所 -x）
 */
export function orientRect(rect, roof, tsuma, frontBearing, ridgeEW = false) {
  const a1 = rect.axis
  const a2 = rect.axis + Math.PI / 2
  const f = frontBearing == null ? null : bearingVec(frontBearing)
  // 正面の辺の向き（正面の向きに直角な方の軸）
  let along = a1
  let alongLen = rect.w
  let acrossLen = rect.d
  if (f) {
    const d1 = Math.abs(Math.cos(a1) * f[0] + Math.sin(a1) * f[1])
    const d2 = Math.abs(Math.cos(a2) * f[0] + Math.sin(a2) * f[1])
    if (d2 < d1) {
      along = a2
      alongLen = rect.d
      acrossLen = rect.w
    }
  }
  let yaw = along
  let w = alongLen
  let d = acrossLen
  if (roof === ROOF.gable && tsuma) {
    yaw = along + Math.PI / 2
    w = acrossLen
    d = alongLen
  } else if (roof === ROOF.hip || roof === ROOF.irimoya || (roof === ROOF.gable && !f)) {
    if (w < d) {
      yaw += Math.PI / 2
      ;[w, d] = [d, w]
    }
  }
  if (ridgeEW) {
    // 棟を東西に（局所の x を東西に近い方へ）
    if (Math.abs(Math.cos(yaw)) < Math.abs(Math.sin(yaw))) {
      yaw += Math.PI / 2
      ;[w, d] = [d, w]
    }
  }
  // 向きを -π〜π に
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
  let front = 0
  if (f) {
    const ux = [Math.cos(yaw), Math.sin(yaw)]
    const uy = [-Math.sin(yaw), Math.cos(yaw)]
    const dx = ux[0] * f[0] + ux[1] * f[1]
    const dy = uy[0] * f[0] + uy[1] * f[1]
    front = Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? 0 : 1) : dx >= 0 ? 2 : 3
  }
  return { yaw, w, d, front }
}

/** 1 階の高さの目安（用途と外壁から） */
export function floorHeightOf(use, facade, floors, eave) {
  if (floors > 0 && eave > 0) return eave / floors
  if (use === USE.office || use === USE.school || use === USE.civic) return 3.8
  if (facade === FACADE.glass) return 3.8
  return 3.0
}

/** 外壁・用途の言葉から印 */
export function flagsOf(p) {
  let f = 0
  if (p.named) f |= FLAG.named
  if (p.under_viaduct) f |= FLAG.viaduct
  const roof = `${p.roof_color ?? ''}`
  if (roof.includes('屋上') || (p.greenery ?? '').includes('屋上')) f |= FLAG.roofGarden
  if ((p.greenery ?? '').includes('バルコニー')) f |= FLAG.flowers
  if ((p.greenery ?? '').includes('生け垣') || (p.greenery ?? '').includes('庭木')) f |= FLAG.hedge
  const kind = p.kind ?? ''
  if (kind.includes('店') || kind.includes('商') || kind.includes('喫茶') || kind.includes('カフェ') || kind.includes('食') || kind.includes('屋') || p.use === 'commercial' || p.use === 'mixed') f |= FLAG.shop
  if (kind.includes('倉庫') || p.use === 'port') f |= FLAG.warehouse
  if ((p.roof_height_m ?? p.height_m ?? 0) >= 40) f |= FLAG.tall
  return f
}

/**
 * データの建物 1 棟（building）を記録に。長方形は rect（world で型のインスタンスにする）、それ以外は poly（world で押し出す）。
 * groundAt(x, y) は地面の標高、profileAt(x, y) はその点の街区の profile（町並みの型を決める）
 */
export function buildingRecord(f, groundAt, namedIndex, profileAt = () => null) {
  const p = f.properties
  const ring = openRing(f.geometry.coordinates[0])
  if (ringArea(ring) < 0) ring.reverse()
  const [roof, tsuma] = roofOf(p.roof_type)
  const facade = facadeOf(p.wall_color, p.material)
  const use = purposeOf(p.use)
  const eave = Math.max(2.2, p.height_m ?? 6)
  let ridge = Math.max(eave, p.roof_height_m ?? eave)
  const floors = Math.max(1, p.floors ?? Math.round(eave / 3.1))
  // 地面: データの ground_z_m（斜面は低い側と高い側）。四隅の地面より低い所まで壁を下ろす
  const gz = p.ground_z_m ?? groundAt(...centroid(ring))
  let low = Math.min(p.ground_z_min_m ?? gz, gz)
  for (const q of ring) low = Math.min(low, groundAt(q[0], q[1]))
  const floorZ = gz
  const base = Math.max(0, floorZ - low + 0.3)
  if (roof === ROOF.flat) ridge = eave
  const rec = {
    id: p.id,
    named: !!p.named,
    namedIndex: namedIndex ?? -1,
    roof,
    facade,
    use,
    flags: flagsOf(p),
    floors,
    floorZ,
    base,
    eave,
    ridge,
    wall: wallColorOf(p.wall_color, facade),
    roofColor: roofColorOf(p.roof_color),
    seed: seedOf(p.id),
    style: styleOf(profileAt(...centroid(ring)), p.district),
  }
  const rect = rectOf(ring)
  if (rect && rect.w > 0.5 && rect.d > 0.5) {
    const o = orientRect(rect, roof, tsuma, p.front_bearing_deg, (p.roof_type ?? '').includes('東西'))
    return { ...rec, shape: 'rect', cx: rect.cx, cy: rect.cy, ...o }
  }
  return { ...rec, shape: 'poly', ring, roofType: p.roof_type ?? null, name: p.name ?? null }
}
