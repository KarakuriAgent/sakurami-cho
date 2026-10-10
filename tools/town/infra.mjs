// 水面（川・運河・池・小川）、岸壁と防波堤、鉄道（地平・築堤・高架・石造アーチ・橋）とホーム、道の橋、ケーブル、
// 形の決まった構造物（観覧車・クレーン・灯台・大パラボラ・記念塔・鐘楼・灯柱・門・ガーデンドーム）を、world が組み立てる数字にする
import { ShapeUtils, Vector2 } from 'three'
import { centroid, minAreaRect, openRing, ringArea, segDist } from './geo.mjs'

const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100

/** 多角形を三角形に（穴あり）。zAt(x, y) で頂点の標高 */
function triangulate(rings, zAt, kind, out) {
  const outer = openRing(rings[0])
  if (ringArea(outer) < 0) outer.reverse()
  const holes = rings.slice(1).map((r) => {
    const h = openRing(r)
    if (ringArea(h) > 0) h.reverse()
    return h
  })
  const tris = ShapeUtils.triangulateShape(
    outer.map((p) => new Vector2(p[0], p[1])),
    holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))),
  )
  const base = out.pos.length / 3
  for (const p of [...outer, ...holes.flat()]) {
    out.pos.push(r1(p[0]), r1(p[1]), r2(zAt(p[0], p[1])))
    out.kind.push(kind)
  }
  for (const t of tris) out.idx.push(base + t[0], base + t[1], base + t[2])
}

/** 折れ線（3D）にいちばん近い点の z */
export function nearestZ(line, x, y) {
  let best = Infinity
  let z = line[0][2]
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const d = segDist(x, y, a[0], a[1], b[0], b[1])
    if (d < best) {
      best = d
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
      z = a[2] + (b[2] - a[2]) * t
    }
  }
  return z
}

const WATER_KIND = { river: 2, canal: 3, pond: 4, stream: 5 }

/** 川の中心線（3D。z = 水面）と頂点ごとの川幅から、水面の帯（岸へ 0.6m ずつはみ出す。岸の地面の方が高いので隠れる） */
function riverRibbon(f, out) {
  const c = f.geometry.coordinates
  const widths = Array.isArray(f.properties.width_m) ? f.properties.width_m : c.map(() => f.properties.width_m ?? 8)
  const pts = []
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]
    const b = c[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8))
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, widths[i - 1] + (widths[i] - widths[i - 1]) * t])
    }
  }
  const base = out.pos.length / 3
  pts.forEach((p, i) => {
    const q0 = pts[Math.max(0, i - 1)]
    const q1 = pts[Math.min(pts.length - 1, i + 1)]
    const dx = q1[0] - q0[0]
    const dy = q1[1] - q0[1]
    const l = Math.hypot(dx, dy) || 1
    const h = p[3] / 2 + 0.6
    for (const s of [1, -1]) {
      out.pos.push(r1(p[0] + (-dy / l) * h * s), r1(p[1] + (dx / l) * h * s), r2(p[2]))
      out.kind.push(WATER_KIND.river)
    }
  })
  for (let i = 1; i < pts.length; i++) {
    const a = base + (i - 1) * 2
    out.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
}
const lineOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])
const pts2 = (line) => line.map((c) => [r1(c[0]), r1(c[1])])
const pts3 = (line) => line.map((c) => [r1(c[0]), r1(c[1]), r2(c[2] ?? 0)])

export function buildInfra(terrain, L) {
  // 水面
  const water = { pos: [], idx: [], kind: [] }
  // 川: 水面の多角形は長い三角形になって水面の高さがずれるので、中心線（頂点ごとの水面の標高と川幅）から帯を作る
  for (const f of L.water.river_centerline ?? []) riverRibbon(f, water)
  for (const f of L.water.canal_surface ?? []) triangulate(f.geometry.coordinates, () => f.properties.water_elev_m ?? 0, WATER_KIND.canal, water)
  for (const f of L.water.pond ?? []) triangulate(f.geometry.coordinates, () => f.properties.water_elev_m ?? 5, WATER_KIND.pond, water)
  const streams = (L.water.stream ?? []).map((f) => ({ pts: pts3(f.geometry.coordinates), width: f.properties.width_m ?? 2 }))

  // 岸壁・護岸・運河の石積み・擁壁（縦の壁）。top / bottom は標高。follow は地面からの高さ
  const walls = []
  for (const f of L.coast.coastline ?? []) {
    const k = f.properties.kind
    if (k !== 'quay' && k !== 'seawall') continue
    for (const ln of lineOf(f.geometry)) walls.push({ pts: pts2(ln), top: f.properties.crest_elev_m ?? 2.5, bottom: -2.5, kind: k })
  }
  for (const f of [...(L.coast.wharf ?? []), ...(L.coast.pier ?? [])]) {
    const ring = openRing(f.geometry.coordinates[0])
    walls.push({ pts: pts2([...ring, ring[0]]), top: f.properties.crest_elev_m ?? 2.8, bottom: -2.5, kind: 'quay' })
  }
  for (const f of L.water.canal_surface ?? []) {
    const ring = openRing(f.geometry.coordinates[0])
    walls.push({ pts: pts2([...ring, ring[0]]), top: f.properties.bank_elev_m ?? 1.8, bottom: (f.properties.water_elev_m ?? 0) - 1, kind: 'canal' })
  }
  for (const f of L.water.pond ?? []) {
    const ring = openRing(f.geometry.coordinates[0])
    walls.push({ pts: pts2([...ring, ring[0]]), top: f.properties.bank_elev_m ?? 6, bottom: (f.properties.water_elev_m ?? 5) - 0.6, kind: 'pond' })
  }
  for (const f of L.buildings.structure ?? []) {
    if (f.properties.kind !== '擁壁') continue
    for (const ln of lineOf(f.geometry)) walls.push({ pts: pts2(ln), follow: f.properties.height_m ?? 2.4, kind: 'retaining' })
  }
  const breakwaters = (L.coast.breakwater ?? []).flatMap((f) => lineOf(f.geometry).map((ln) => ({ pts: pts2(ln), width: f.properties.width_m ?? 10, crest: f.properties.crest_elev_m ?? 3 })))

  // 鉄道
  const rails = (L.railway.railway ?? []).map((f) => {
    const p = f.properties
    return { id: p.id, pts: pts3(f.geometry.coordinates), structure: p.structure, tracks: p.tracks ?? 2, arches: p.arches ?? 0, archSpan: p.arch_span_m ?? null }
  })
  const tracks = (L.railway.railway_track ?? []).map((f) => ({ id: f.properties.id, pts: pts3(f.geometry.coordinates) }))
  const platforms = (L.railway.platform ?? []).map((f) => ({ ring: pts2(openRing(f.geometry.coordinates[0])), top: f.properties.top_elev_m ?? 7.5, roof: f.properties.roof ?? null }))
  const bridges = (L.roads.bridge ?? []).map((f) => ({
    pts: pts3(f.geometry.coordinates),
    width: f.properties.width_m ?? 6,
    deck: f.properties.deck_z_m ?? null,
    stone: `${f.properties.structure ?? ''}${f.properties.structure_form ?? ''}`.includes('石'),
  }))
  const cableLine = L.railway.cable_railway?.[0]
  const cable = cableLine
    ? {
        pts: pts3(cableLine.geometry.coordinates),
        loops: (L.railway.cable_passing_loop ?? []).map((f) => pts3(f.geometry.coordinates)),
        cars: (L.transit.cable_car ?? []).filter((f) => f.properties.car_name).map((f) => ({ name: f.properties.car_name, role: f.properties.role, color: f.properties.color ?? null, at: pts3([f.geometry.coordinates])[0] })),
        service: cableLine.properties.operation ?? null,
      }
    : null

  return { water, streams, walls, breakwaters, rails, tracks, platforms, bridges, cable }
}

/**
 * ラボのまわり（radius m）の道と広場（world がラボの前のセットを作るとき、縁石つきの舗装の形と花音の通り道にする。形の版 3）。
 * 道は中心線・幅・種類・路面、広場は外形と路面
 */
export function sitePaths(L, radius) {
  const near = (pts) => pts.some((c) => Math.hypot(c[0], c[1]) < radius)
  const paths = []
  for (const f of L.roads.road ?? []) {
    const p = f.properties
    for (const ln of lineOf(f.geometry)) {
      if (ln.length < 2 || !near(ln)) continue
      paths.push({ id: p.id, name: p.name ?? null, cls: p.class ?? null, width: p.width_m ?? 3, surface: p.surface ?? null, pts: pts2(ln) })
    }
  }
  const plazas = []
  for (const f of L.roads.plaza ?? []) {
    if (f.geometry.type !== 'Polygon') continue
    const ring = openRing(f.geometry.coordinates[0])
    if (!near(ring)) continue
    plazas.push({ id: f.properties.id, name: f.properties.name ?? null, surface: f.properties.surface ?? null, ring: pts2(ring) })
  }
  return { paths, plazas }
}

/** 多角形の中心と半径（円に近い多角形） */
function circleOf(ring) {
  const r = openRing(ring)
  const [cx, cy] = centroid(r)
  const rad = r.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cy), 0) / r.length
  return { cx: r1(cx), cy: r1(cy), r: r2(rad) }
}

/** 形の決まった構造物 */
export function buildStructures(terrain, L, coastLights) {
  const out = []
  const groundOf = (p, x, y) => p.ground_z_m ?? terrain.height(x, y)
  for (const f of L.buildings.structure ?? []) {
    const p = f.properties
    const k = p.kind ?? ''
    const g = f.geometry
    if (k === '観覧車') {
      const mr = minAreaRect(openRing(g.coordinates[0]))
      const axis = mr.w >= mr.d ? mr.axis : mr.axis + Math.PI / 2
      out.push({ type: 'soranowa', id: p.id, x: r1(mr.cx), y: r1(mr.cy), z: groundOf(p, mr.cx, mr.cy), axis, height: p.height_m ?? 107.5, diameter: p.diameter_m ?? Math.max(mr.w, mr.d), gondolas: p.gondolas ?? 60 })
    } else if (k === 'ガントリークレーン') {
      const mr = minAreaRect(openRing(g.coordinates[0]))
      // 腕は海の側へ（長い辺に直角な 2 つの向きのうち、水のある方）
      const long = mr.w >= mr.d ? mr.axis : mr.axis + Math.PI / 2
      let boom = long + Math.PI / 2
      const probe = (a) => {
        let n = 0
        for (let d = 20; d <= 60; d += 10) if (terrain.water(mr.cx + Math.cos(a) * d, mr.cy + Math.sin(a) * d) !== 0) n++
        return n
      }
      if (probe(boom + Math.PI) > probe(boom)) boom += Math.PI
      out.push({ type: 'crane', id: p.id, x: r1(mr.cx), y: r1(mr.cy), z: groundOf(p, mr.cx, mr.cy), axis: long, w: Math.max(mr.w, mr.d), d: Math.min(mr.w, mr.d), height: p.height_m ?? 48, boom })
    } else if (k.startsWith('灯台')) {
      const c = circleOf(g.coordinates[0])
      const light = coastLights.find((l) => Math.hypot(l.x - c.cx, l.y - c.cy) < 60)
      const red = (p.name ?? '').includes('赤')
      out.push({ type: 'lighthouse', id: p.id, x: c.cx, y: c.cy, z: groundOf(p, c.cx, c.cy), r: Math.max(1.6, c.r), height: p.height_m ?? 14, color: red ? 'red' : 'white', focal: light?.focal ?? (p.ground_z_m ?? 3) + (p.height_m ?? 14) - 1, character: light?.character ?? null, main: (p.name ?? '').includes('汐見島') })
    } else if (k === 'パラボラアンテナ') {
      const c = circleOf(g.coordinates[0])
      out.push({ type: 'parabola', id: p.id, x: c.cx, y: c.cy, z: groundOf(p, c.cx, c.cy), dish: c.r * 2, top: p.height_m ?? 15, center: 9, azimuth: 250, elevation: 30 })
    } else if (k === '塔') {
      const c = circleOf(g.coordinates[0])
      out.push({ type: 'monument', id: p.id, x: c.cx, y: c.cy, z: groundOf(p, c.cx, c.cy), r: c.r, height: p.height_m ?? 20 })
    } else if (k === '鐘楼') {
      const mr = minAreaRect(openRing(g.coordinates[0]))
      out.push({ type: 'belfry', id: p.id, x: r1(mr.cx), y: r1(mr.cy), z: groundOf(p, mr.cx, mr.cy), axis: mr.axis, w: mr.w, d: mr.d, height: p.height_m ?? 9 })
    } else if (k.startsWith('灯柱')) {
      const c = g.coordinates
      out.push({ type: 'lamppost', id: p.id, x: r1(c[0]), y: r1(c[1]), z: groundOf(p, c[0], c[1]), height: p.height_m ?? 6 })
    } else if (k === '門' && g.type === 'LineString') {
      out.push({ type: 'gate', id: p.id, pts: pts2(g.coordinates), z: p.ground_z_m ?? terrain.height(g.coordinates[0][0], g.coordinates[0][1]), height: p.height_m ?? 2.4 })
    } else if (k === '銅像') {
      const c = circleOf(g.coordinates[0])
      out.push({ type: 'statue', id: p.id, x: c.cx, y: c.cy, z: groundOf(p, c.cx, c.cy), r: Math.min(2.5, c.r), height: p.height_m ?? 4.5 })
    }
  }
  return out
}
