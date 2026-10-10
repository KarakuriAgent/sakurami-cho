// 名前のある建物の外観を作るための記録（named.json。形の版 5）。
// 建物（named: true）・建物の部分（塔・ドーム・煙突・尖塔・大庇・車庫・本館）・中の店（看板の手がかり）・敷地・構造物を、
// world（world/outdoor/named/）が組み立ての型（駅・倉庫・町家の店など）を選んで形を作れるように、地図データの値をほぼそのまま渡す。
// 外形は反時計回りに直し、まわりの地面の低い所・高い所（地形を直した後の高さ）を足す。
import { centroid, openRing, ringArea } from './geo.mjs'
import { facadeOf, purposeOf, roofColorOf, styleOf, wallColorOf } from './buildings.mjs'

/** 渡さない属性（出典・判断の記録）。部屋の間取り（rooms）は rooms の項目に直して渡す（形の版 5。中を作る建物の床・壁・天井） */
const DROP = new Set(['source', 'basis', 'decisions', 'conflicts', 'generated_by', 'address_basis', 'chome_id', 'rooms', 'layer', 'named'])

const r2 = (v) => Math.round(v * 100) / 100
const ringOf = (coords) => {
  const ring = openRing(coords).map(([x, y]) => [r2(x), r2(y)])
  if (ringArea(ring) < 0) ring.reverse()
  return ring
}

/** 属性のうち、決まった項目以外をそのまま */
function extras(p, used) {
  const out = {}
  for (const [k, v] of Object.entries(p)) {
    if (DROP.has(k) || used.has(k) || v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

const USED_BUILDING = new Set(['id', 'name', 'kind', 'use', 'district', 'floors', 'height_m', 'roof_height_m', 'roof_type', 'roof_color', 'wall_color', 'material', 'ground_z_m', 'ground_z_min_m', 'ground_z_max_m', 'front_bearing_deg', 'front_edge', 'entrances'])

/**
 * L = 地図データの層、groundAt(x, y) = 地形の標高（直した後）、profileAt(x, y) = 街区の profile、exclude = 描かない id
 */
export function namedRecords(L, groundAt, profileAt, exclude) {
  const features = L.buildings.building ?? []
  const parts = new Map()
  for (const f of L.buildings.building_part ?? []) {
    const p = f.properties
    if (!parts.has(p.building_id)) parts.set(p.building_id, [])
    const ring = ringOf(f.geometry.coordinates[0])
    parts.get(p.building_id).push({
      id: p.id,
      name: p.name ?? null,
      partKind: p.part_kind ?? null,
      ring,
      z: p.ground_z_m ?? null,
      height: p.height_m ?? null,
      roofType: p.roof_type ?? null,
      roofColor: p.roof_color ?? null,
      ...extras(p, new Set(['id', 'name', 'part_kind', 'ground_z_m', 'height_m', 'roof_type', 'roof_color', 'building_id'])),
    })
  }
  const tenants = new Map()
  for (const f of L.buildings.tenant ?? []) {
    const p = f.properties
    if (!tenants.has(p.building_id)) tenants.set(p.building_id, [])
    const c = f.geometry.type === 'Point' ? f.geometry.coordinates : centroid(f.geometry.coordinates[0])
    tenants.get(p.building_id).push({ id: p.id, name: p.name, kind: p.kind ?? null, floor: p.floor ?? null, x: r2(c[0]), y: r2(c[1]), ...extras(p, new Set(['id', 'name', 'kind', 'floor', 'building_id'])) })
  }
  const sites = new Map()
  for (const f of L.buildings.site ?? []) {
    const p = f.properties
    if (!p.building_id) continue
    if (!sites.has(p.building_id)) sites.set(p.building_id, [])
    sites.get(p.building_id).push({ id: p.id, name: p.name ?? null, kind: p.kind ?? null, ring: ringOf(f.geometry.coordinates[0]), z: p.ground_z_m ?? null, ...extras(p, new Set(['id', 'name', 'kind', 'ground_z_m', 'building_id'])) })
  }

  const buildings = []
  for (const f of features) {
    const p = f.properties
    if (!p.named || f.geometry.type !== 'Polygon') continue
    const ring = ringOf(f.geometry.coordinates[0])
    const [cx, cy] = centroid(ring)
    let gLow = Infinity
    let gHigh = -Infinity
    for (const [x, y] of ring) {
      const g = groundAt(x, y)
      gLow = Math.min(gLow, g)
      gHigh = Math.max(gHigh, g)
    }
    const facade = facadeOf(p.wall_color, p.material)
    buildings.push({
      id: p.id,
      name: p.name,
      kind: p.kind ?? null,
      use: purposeOf(p.use),
      useText: p.use ?? null,
      district: p.district ?? null,
      style: styleOf(profileAt(cx, cy), p.district),
      drawn: !exclude.has(p.id),
      ring,
      z: p.ground_z_m ?? r2(groundAt(cx, cy)),
      zMin: p.ground_z_min_m ?? null,
      zMax: p.ground_z_max_m ?? null,
      gLow: r2(gLow),
      gHigh: r2(gHigh),
      floors: p.floors ?? null,
      height: p.height_m ?? null,
      roofHeight: p.roof_height_m ?? null,
      roofType: p.roof_type ?? null,
      roofText: p.roof_color ?? null,
      roofColor: roofColorOf(p.roof_color),
      wallText: p.wall_color ?? null,
      wallColor: wallColorOf(p.wall_color, facade),
      material: p.material ?? null,
      facade,
      front: p.front_bearing_deg ?? null,
      frontEdge: p.front_edge ?? null,
      entrances: (p.entrances ?? []).map((e) => ({ ...e, ground: r2(groundAt(e.x, e.y)) })),
      parts: parts.get(p.id) ?? [],
      tenants: tenants.get(p.id) ?? [],
      sites: sites.get(p.id) ?? [],
      // 部屋の間取り（中を作る建物。名前・階・平面の多角形（反時計回り）・説明）
      rooms: (p.rooms ?? []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3).map((r) => ({ name: r.name, floor: r.floor ?? 1, position: r.position ?? null, ring: ringOf(r.polygon), note: r.note ?? null })),
      extra: extras(p, USED_BUILDING),
    })
  }

  const structures = []
  for (const f of L.buildings.structure ?? []) {
    const p = f.properties
    if (exclude.has(p.id)) continue
    const g = f.geometry
    let geom
    let c
    if (g.type === 'Point') {
      geom = { type: 'point', at: [r2(g.coordinates[0]), r2(g.coordinates[1])] }
      c = g.coordinates
    } else if (g.type === 'LineString') {
      geom = { type: 'line', pts: g.coordinates.map(([x, y]) => [r2(x), r2(y)]) }
      c = g.coordinates[Math.floor(g.coordinates.length / 2)]
    } else if (g.type === 'MultiLineString') {
      geom = { type: 'lines', lines: g.coordinates.map((l) => l.map(([x, y]) => [r2(x), r2(y)])) }
      c = g.coordinates[0][0]
    } else {
      const ring = ringOf(g.coordinates[0])
      geom = { type: 'ring', ring }
      c = centroid(ring)
    }
    structures.push({
      id: p.id,
      name: p.name ?? null,
      kind: p.kind ?? null,
      geom,
      z: p.ground_z_m ?? r2(groundAt(c[0], c[1])),
      ground: r2(groundAt(c[0], c[1])),
      height: p.height_m ?? null,
      ...extras(p, new Set(['id', 'name', 'kind', 'ground_z_m', 'height_m'])),
    })
  }
  return { buildings, structures }
}
