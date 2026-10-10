// 木と夜の灯り（街灯・広場・港の作業灯・町の外の灯り）を置く。決まった乱数なので、同じデータなら同じ所に置く
import { Grid, circleRing, insidePolygon, openRing, rng, samplePolyline, seedOf } from './geo.mjs'
import { WATER } from './terrain.mjs'

/** 木の種類（world/outdoor/town/trees.ts の TREE と同じ番号） */
export const TREE = { broadleaf: 0, maple: 1, sakura: 2, conifer: 3 }
/** 灯りの種類（world/outdoor/town/lights.ts の LIGHT_KIND と同じ番号） */
export const LIGHT = { window: 0, street: 1, port: 2, path: 3, far: 4, cable: 5, aviation: 6, clock: 7, lighthouse: 8, beacon: 9 }

const SPECIES = {
  楓坂: [
    [TREE.maple, 0.42],
    [TREE.broadleaf, 0.36],
    [TREE.conifer, 0.16],
    [TREE.sakura, 0.06],
  ],
  桜木丘: [
    [TREE.broadleaf, 0.46],
    [TREE.conifer, 0.4],
    [TREE.sakura, 0.08],
    [TREE.maple, 0.06],
  ],
  汐見島: [
    [TREE.conifer, 0.7],
    [TREE.broadleaf, 0.3],
  ],
  学園地区: [
    [TREE.broadleaf, 0.55],
    [TREE.sakura, 0.25],
    [TREE.conifer, 0.14],
    [TREE.maple, 0.06],
  ],
  中央地区: [
    [TREE.broadleaf, 0.72],
    [TREE.sakura, 0.14],
    [TREE.maple, 0.1],
    [TREE.conifer, 0.04],
  ],
  default: [
    [TREE.broadleaf, 0.66],
    [TREE.sakura, 0.14],
    [TREE.conifer, 0.14],
    [TREE.maple, 0.06],
  ],
}

function pick(rnd, entries) {
  let x = rnd()
  for (const [v, w] of entries) {
    x -= w
    if (x <= 0) return v
  }
  return entries[0][0]
}

/** 地区の名前を引く粗い格子（20m） */
function districtLookup(districts, extent) {
  const g = new Grid({ xmin: extent.xmin, ymax: extent.ymax, pixel_m: 20, width: Math.ceil((extent.width * extent.px) / 20), height: Math.ceil((extent.height * extent.px) / 20) })
  const map = new Uint8Array(g.width * g.height)
  const names = ['']
  for (const f of districts) {
    names.push(f.properties.name)
    const k = names.length - 1
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const p of polys)
      g.fill(
        p.map((r) => openRing(r)),
        (i, cov) => {
          if (cov > 0.5) map[i] = k
        },
      )
  }
  return (x, y) => {
    const c = Math.floor(g.col(x))
    const r = Math.floor(g.row(y))
    if (c < 0 || r < 0 || c >= g.width || r >= g.height) return ''
    return names[map[r * g.width + c]]
  }
}

/**
 * ラボの窓（目の高さ 117.6m）から南の町を見る線より、木の頂が上に出ないようにする（眺めを木でふさがない。D-085 の注意）。
 * 町は窓から俯角 2〜7°（1〜3km）に見えるので、窓の前の斜面の木は俯角 7.5° の線より下に抑える（台地の縁は低い植え込みだけになる）
 */
const EYE = { x: 0, y: -5.4, z: 117.6 }
const VIEW_TAN = Math.tan((7.5 * Math.PI) / 180)
/**
 * Café Platform 1872 の窓際の 2 番テーブルの席（目の高さ）から、まるの森の木々の向こうのガーデンドームを見る線（地図データの窓の説明
 * 「窓際のテーブル席から、まるの森の木々の向こうにガーデンドームが見える」。docs/design/town.md §7）。ドームの方角 ±8.5°・ドームの手前まで、
 * ドームの手前の面の高さ 22m を見る線より、建物（名前の無いもの）と木の頂を低く抑える
 */
const CAFE_EYE = { x: -699.6, y: -1407.0, z: 6.1 }
const CAFE_DOME = { x: -800, y: -945, front: 410, z: 7.75 + 22, half: (8.5 * Math.PI) / 180 }
const CAFE_SLOPE = (CAFE_DOME.z - CAFE_EYE.z) / CAFE_DOME.front
const CAFE_BEARING = Math.atan2(CAFE_DOME.x - CAFE_EYE.x, CAFE_DOME.y - CAFE_EYE.y)

/** その点で、Café Platform 1872 の窓からドームを見る線を越えない頂の標高（m。線の外は Infinity） */
export function cafeViewCeiling(x, y) {
  const dx = x - CAFE_EYE.x
  const dy = y - CAFE_EYE.y
  const d = Math.hypot(dx, dy)
  if (d < 20 || d > CAFE_DOME.front - 5) return Infinity
  const diff = Math.abs(((Math.atan2(dx, dy) - CAFE_BEARING + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
  if (diff > CAFE_DOME.half) return Infinity
  return CAFE_EYE.z + d * CAFE_SLOPE - 0.3
}

/** その点で、窓から町を見る線を越えない頂の標高（m。眺めの範囲の外は Infinity）。Café Platform 1872 からドームを見る線も */
export function viewCeiling(x, y) {
  const cafe = cafeViewCeiling(x, y)
  const dx = x - EYE.x
  const dy = y - EYE.y
  const d = Math.hypot(dx, dy)
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  if (d > 650 || bearing < 90 || bearing > 290) return cafe
  return Math.min(cafe, EYE.z - d * VIEW_TAN)
}

function capUnderView(x, y, z, h) {
  return Math.min(h, viewCeiling(x, y) - z)
}

/**
 * 木を置く。ground は paintGround の結果（植生・置いてはいけない所）。
 * 近くは 1 本ずつ、遠くは木のかたまり（間隔と樹冠を大きく）。北側（窓から見えない）は近くだけ
 */
export function placeTrees(terrain, ground, data, cfg) {
  const out = []
  const district = districtLookup(data.districts, terrain.overview.grid)
  const rnd = rng(seedOf('trees'))
  const auxAt = (x, y) => {
    const L = terrain.center.grid.contains(x, y, 2) ? ground.center : ground.overview
    const a = L.auxGrid
    const c = Math.floor(a.col(x))
    const r = Math.floor(a.row(y))
    if (c < 0 || r < 0 || c >= a.width || r >= a.height) return null
    const i = r * a.width + c
    return { veg: L.aux[i * 4 + 1] / 255, blocked: L.blocked[i] }
  }
  const add = (x, y, h, r, kind, flags = 0) => {
    const z = terrain.height(x, y)
    if (z < 0.4 || terrain.water(x, y) !== WATER.land) return false
    const hh = capUnderView(x, y, z, h)
    if (hh < 2.2) return false
    out.push({ x, y, z, h: hh, r: r * Math.min(1, 0.5 + (0.5 * hh) / h), kind, tint: Math.floor(rnd() * 256), flags })
    return true
  }
  // 森・公園・庭（植生の値から）
  const ext = terrain.overview.grid
  const MACRO = 60
  for (let my = ext.ymax - ext.height * ext.px; my < ext.ymax; my += MACRO) {
    for (let mx = ext.xmin; mx < ext.xmin + ext.width * ext.px; mx += MACRO) {
      const cx = mx + MACRO / 2
      const cy = my + MACRO / 2
      const d = Math.hypot(cx, cy)
      const bearing = ((Math.atan2(cx, cy) * 180) / Math.PI + 360) % 360
      if (d > cfg.treeMaxDistance) continue
      if (d > cfg.treeNorthRadius && (bearing < 60 || bearing > 300)) continue
      const s = cfg.treeSpacing + d / cfg.treeSpacingGrowth
      for (let y = my; y < my + MACRO; y += s)
        for (let x = mx; x < mx + MACRO; x += s) {
          const px = x + rnd() * s
          const py = y + rnd() * s
          const a = auxAt(px, py)
          if (!a || a.blocked) {
            rnd()
            continue
          }
          const prob = a.veg > 0.8 ? 0.92 : a.veg > 0.5 ? a.veg * 0.75 : a.veg * 0.35
          if (rnd() > prob) continue
          const dn = district(px, py)
          const kind = pick(rnd, SPECIES[dn] ?? SPECIES.default)
          // 遠くの「木」は何本かのかたまり（樹冠を間隔に合わせて広げる）
          const clump = Math.max(1, s / 9)
          const h = (kind === TREE.conifer ? 11 : 8.5) + rnd() * 7
          const r = (kind === TREE.conifer ? 2.4 : 3.2 + rnd() * 1.6) * Math.min(2.6, clump)
          add(px, py, h * Math.min(1.25, 0.9 + clump * 0.1), r, kind)
        }
    }
  }
  // 並木（道の表面の説明に「並木」がある道。楓坂の楓並木は structure）
  for (const f of data.roads) {
    const p = f.properties
    const text = `${p.surface ?? ''}${p.note ?? ''}`
    if (!text.includes('並木')) continue
    const kind = text.includes('楓') ? TREE.maple : text.includes('桜') ? TREE.sakura : TREE.broadleaf
    const w = p.width_m ?? 8
    for (const pt of samplePolyline(f.geometry.coordinates, 11)) {
      const nx = -Math.sin(pt[2])
      const ny = Math.cos(pt[2])
      for (const side of [-1, 1]) add(pt[0] + nx * side * (w / 2 - 1.3), pt[1] + ny * side * (w / 2 - 1.3), 8 + rnd() * 3, 2.6 + rnd(), kind, 1)
    }
  }
  for (const f of data.structures) {
    const p = f.properties
    if (!(p.kind ?? '').startsWith('樹木')) continue
    const g = f.geometry
    if (g.type === 'MultiLineString' || g.type === 'LineString') {
      const ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates
      const total = ls.reduce((s, l) => s + l.length, 0)
      const spacing = p.tree_spacing_m ?? 8
      for (const l of ls) for (const pt of samplePolyline(l, spacing)) add(pt[0], pt[1], p.height_m ?? 8, p.crown_radius_m ?? 3, TREE.maple, 1)
      void total
    } else if (g.type === 'Polygon') {
      const ring = openRing(g.coordinates[0])
      const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length
      const cy = ring.reduce((s, q) => s + q[1], 0) / ring.length
      const r = ring.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cy), 0) / ring.length
      const kind = (p.kind ?? '').includes('桜') ? TREE.sakura : (p.kind ?? '').includes('楓') ? TREE.maple : TREE.broadleaf
      // 名前のある大木（千年桜・大楠・大楓）は眺めの高さで削らない
      const z = terrain.height(cx, cy)
      out.push({ x: cx, y: cy, z, h: p.height_m ?? 14, r, kind, tint: 128, flags: 2 })
    }
  }
  return out
}

/** 道の種類ごとの街灯: [間隔 m, 灯りの高さ m, 両側か, 大きさ m, 明るさ] */
const LAMP = {
  trunk: [26, 8, true, 0.45, 2.2],
  arterial: [28, 7, true, 0.42, 2.1],
  local: [34, 5.5, false, 0.35, 1.8],
  alley: [42, 4.2, false, 0.3, 1.4],
  pedestrian: [22, 4.5, true, 0.32, 1.65],
  path: [26, 3.2, false, 0.25, 1.2],
}

/** 足元灯の間隔（m。道の両わきに互い違いに置くので、片側はこの 2 倍）・道の縁からの外への距離・地面からの高さ（§7 の 173） */
const FOOT = { spacing: 8, out: 0.18, height: 0.55 }

/** 道の属性に「足元灯」があるか（その道の上端の区間を兼ねる道 upper_section_of も、元の道の足元灯を継ぐ） */
function footLit(p, byId) {
  if (`${p.lights ?? ''}`.includes('足元灯')) return true
  const up = `${p.upper_section_of ?? ''}`.split(/[（(\s]/)[0]
  return !!up && `${byId.get(up)?.properties.lights ?? ''}`.includes('足元灯')
}

/** 線の上の点の距離（始めから） */
function along(pts, x, y) {
  let best = Infinity
  let at = 0
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const dx = pts[i][0] - ax
    const dy = pts[i][1] - ay
    const l2 = dx * dx + dy * dy
    const l = Math.sqrt(l2)
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y)
    if (d < best) {
      best = d
      at = acc + t * l
    }
    acc += l
  }
  return at
}

/** 足元灯のある道の足元灯（両わきに互い違い。乱数は道ごと） */
function footLights(f, p, byId, terrain) {
  const out = []
  const rnd = rng(seedOf(`foot:${p.id}`))
  let pts = f.geometry.coordinates.map((c) => [c[0], c[1]])
  // 上端の区間を兼ねる道は、元の道の上の端（合流点）から先だけ
  if (!`${p.lights ?? ''}`.includes('足元灯')) {
    const ref = byId.get(`${p.upper_section_of}`.split(/[（(\s]/)[0]).geometry.coordinates
    const top = ref[ref.length - 1]
    const bottom = ref[0]
    const a = along(pts, top[0], top[1])
    const towardEnd = Math.hypot(pts[pts.length - 1][0] - bottom[0], pts[pts.length - 1][1] - bottom[1]) > Math.hypot(pts[0][0] - bottom[0], pts[0][1] - bottom[1])
    const cut = []
    let acc = 0
    for (let i = 0; i < pts.length; i++) {
      if (i) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      if (towardEnd ? acc >= a : acc <= a) cut.push(pts[i])
    }
    if (cut.length < 2) return out
    pts = cut
  }
  const w = p.width_m ?? 2.5
  let k = 0
  for (const pt of samplePolyline(pts, FOOT.spacing, FOOT.spacing / 2)) {
    const side = k++ % 2 === 0 ? 1 : -1
    const nx = -Math.sin(pt[2])
    const ny = Math.cos(pt[2])
    const x = pt[0] + nx * side * (w / 2 + FOOT.out)
    const y = pt[1] + ny * side * (w / 2 + FOOT.out)
    if (terrain.water(x, y) !== WATER.land) continue
    out.push({ x, y, z: terrain.height(x, y) + FOOT.height, kind: LIGHT.path, color: '#ffb866', size: 0.2, power: 1.1, seed: rnd() * 0.6 })
  }
  return out
}

/**
 * 夜の灯り（街灯・広場・港の作業灯・町の外の灯り）。足元灯のある道（つづら道。データの lights「足元灯（等間隔）」）は、街灯の代わりに
 * 道の両わきへ互い違いに FOOT.spacing m ごとの足元灯。町の石段の足元灯は world が石段の形と一緒に置く（world/outdoor/town/townStairsMesh.ts）
 */
export function placeLights(terrain, data, cfg) {
  const out = []
  const rnd = rng(seedOf('lights'))
  const push = (x, y, z, kind, color, size, power, seed = rnd()) => out.push({ x, y, z, kind, color, size, power, seed })
  const byId = new Map(data.roads.map((f) => [f.properties.id, f]))
  for (const f of data.roads) {
    const p = f.properties
    if (p.underground || p.class === 'tram_row') continue
    // 足元灯のある道は街灯の代わりに足元灯（街灯の乱数は前と同じだけ引いて、ほかの道の灯りの並びを変えない）
    const foot = footLit(p, byId)
    if (foot) for (const q of footLights(f, p, byId, terrain)) out.push(q)
    const lamp = LAMP[p.class]
    if (!lamp) continue
    const [spacing, height, both, size, power] = lamp
    const w = p.width_m ?? 6
    const lantern = (p.name ?? '').includes('提灯') || (p.name ?? '').includes('横丁')
    const color = lantern ? '#ff9a52' : p.class === 'path' ? '#ffb866' : p.class === 'alley' ? '#ffbe78' : '#ffc275'
    for (const pt of samplePolyline(f.geometry.coordinates, lantern ? 9 : spacing, rnd() * spacing)) {
      const nx = -Math.sin(pt[2])
      const ny = Math.cos(pt[2])
      const sides = both ? [-1, 1] : [Math.floor(pt[3] / spacing) % 2 === 0 ? -1 : 1]
      for (const side of sides) {
        const off = both || p.class === 'local' ? w / 2 - 0.6 : 0
        const x = pt[0] + nx * side * off + (both ? (side * spacing) / 4 : 0) * Math.cos(pt[2])
        const y = pt[1] + ny * side * off + (both ? (side * spacing) / 4 : 0) * Math.sin(pt[2])
        if (terrain.water(x, y) !== WATER.land) continue
        const z = terrain.height(x, y)
        if (z < 0.3) continue
        const seed = rnd()
        if (!foot) push(x, y, z + (lantern ? 3.2 : height), lantern ? LIGHT.path : p.class === 'path' ? LIGHT.path : LIGHT.street, color, lantern ? 0.3 : size, lantern ? 1.5 : power, seed)
      }
    }
  }
  // 石段の足元灯は world が石段の形と一緒に置く（townStairsMesh.ts）。ここは前と同じだけ乱数を引いて、ほかの灯りの並びを変えない
  for (const f of data.stairs) for (let i = samplePolyline(f.geometry.coordinates.map((c) => [c[0], c[1]]), 12).length; i > 0; i--) rnd()
  // 広場のまわりの灯り
  for (const f of data.plazas) {
    const ring = openRing(f.geometry.coordinates[0])
    for (const pt of samplePolyline([...ring, ring[0]], 16)) {
      const z = terrain.height(pt[0], pt[1])
      push(pt[0], pt[1], z + 4.5, LIGHT.street, '#ffc98a', 0.35, 1.75)
    }
  }
  // 港の作業灯（埠頭・桟橋の上の高い柱。深夜も点いている）
  for (const f of [...data.wharves, ...data.piers]) {
    const rings = [openRing(f.geometry.coordinates[0])]
    const xs = rings[0].map((q) => q[0])
    const ys = rings[0].map((q) => q[1])
    const step = 70
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step)
      for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
        if (!insidePolygon(x, y, rings)) continue
        push(x, y, (f.properties.crest_elev_m ?? 2.8) + 20, LIGHT.port, '#ffdcae', 1.0, 2.0, rnd() * 0.9)
      }
  }
  // 町の外の灯り（町の外の陸の海辺に、ぽつぽつと集落）
  for (const f of data.outside) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const poly of polys) {
      const rings = poly.map(openRing)
      const xs = rings[0].map((q) => q[0])
      const ys = rings[0].map((q) => q[1])
      const step = 90
      for (let y = Math.min(...ys); y < Math.max(...ys); y += step)
        for (let x = Math.min(...xs); x < Math.max(...xs); x += step) {
          const px = x + rnd() * step
          const py = y + rnd() * step
          if (!insidePolygon(px, py, rings)) continue
          const z = terrain.height(px, py)
          if (z < 1 || z > 70 || terrain.water(px, py) !== WATER.land) continue
          // 集落はかたまる（ゆっくり変わる乱数の模様）
          const cluster = Math.sin(px * 0.0021 + 1.3) * Math.cos(py * 0.0017 - 0.4) + Math.sin(px * 0.0007 - py * 0.0009)
          if (cluster < 0.55 || rnd() > 0.55) continue
          push(px, py, z + 5, LIGHT.far, '#ffcf96', 3.5, 1.0)
        }
    }
  }
  void cfg
  return out
}

export { circleRing }
