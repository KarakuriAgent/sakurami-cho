// 町の地図データを、地図（world）が速く読める形に直して、アセットの根（--out）の town/ に書く（書き出した物は git に入れる。書き出し直したら差としてコミットする）。
// 使い方: node tools/sync-town.mjs --out <アセットの根> --src <町の地図データのフォルダ> [--root <根>]
//   使う側（kanon-lab）は自分の package.json の script（pnpm sync:town）で、--root・--src・--out を渡す（読み元の置き場所は使う側が知っている）。
//   相対のパスは根（--root。既定は作業ディレクトリ）から。読み元は環境変数 SAKURAMI_TOWN_SRC で上書きできる（--src より先）。
//   書き出す前に <アセットの根>/town/ を消して作り直す。読み元は読むだけで書き換えない。形は docs/design/town.md の「データの取り込み」。
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { TOWN_DATA } from '../core/town.ts'
import { toolArgs } from './args.mjs'
import { FLAG, buildingRecord, facadeOf, roofColorOf, purposeOf, styleOf, wallColorOf } from './town/buildings.mjs'
import { fillBlock, viewLimitedBlocks } from './town/autofill.mjs'
import { bboxOf, centroid, insidePolygon, openRing, rectOf, ringArea, seedOf } from './town/geo.mjs'
import { paintGround } from './town/ground.mjs'
import { buildInfra, buildStructures, sitePaths } from './town/infra.mjs'
import { buildTransit } from './town/transit.mjs'
import { encodePng } from './town/png.mjs'
import { LIGHT, cafeViewCeiling, placeLights, placeTrees, viewCeiling } from './town/scatter.mjs'
import { Terrain, WATER } from './town/terrain.mjs'
import { byLayer, readGeojson, sourceSignature } from './town/data.mjs'
import { packTile, tileKey } from './town/tiles.mjs'
import { namedRecords } from './town/named.mjs'
import { RoadStrips, buildWalkGraph, roadBuildingCheck, walkFile } from './town/walkgraph.mjs'

const USAGE = 'node tools/sync-town.mjs --out <アセットの根> --src <町の地図データのフォルダ> [--root <根>]（読み元は環境変数 SAKURAMI_TOWN_SRC でも）'
const { values, at } = toolArgs('sync:town', USAGE, { out: { type: 'string' }, src: { type: 'string' } }, ['out'])
const srcSetting = process.env.SAKURAMI_TOWN_SRC || values.src
if (!srcSetting) {
  console.error('[sync:town] 町の地図データの読み元がありません。--src か環境変数 SAKURAMI_TOWN_SRC で渡してください。')
  console.error(`  使い方: ${USAGE}`)
  process.exit(1)
}
const src = at(srcSetting)
const dest = resolve(at(values.out), TOWN_DATA.dir)
const t0 = Date.now()
const log = (msg) => console.log(`[sync:town] ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s ${msg}`)

for (const need of ['town_meta.json', 'data/buildings.geojson', 'out/heightmap/center_height.png', 'out/heightmap/overview_height.png']) {
  if (!existsSync(join(src, need))) {
    console.error(`[sync:town] 町の地図データが見つかりません: ${join(src, need)}`)
    console.error('  --src（使う側の package.json の script などで渡す）か、環境変数 SAKURAMI_TOWN_SRC を確認してください。')
    console.error('  高さ画像（out/heightmap）が無いときは、地図データのフォルダで tools/build_all.py を実行してください（地図データの README の「作り直し方」）。')
    process.exit(1)
  }
}

const meta = JSON.parse(readFileSync(join(src, 'town_meta.json'), 'utf8'))
if (Math.abs(meta.origin.elev_m - 116) > 1e-6) console.warn(`[sync:town] 注意: 原点の標高が ${meta.origin.elev_m} m（core/town.ts の SITE.labFloorElevation と合わせる）`)
const signature = sourceSignature(src)

/* 1. 地図データ */
log(`読み元: ${src}`)
const L = {}
for (const name of ['coast', 'water', 'railway', 'roads', 'areas', 'transit', 'buildings', 'blocks']) L[name] = byLayer(readGeojson(src, name))
let viewsLos = null
try {
  viewsLos = JSON.parse(readFileSync(join(src, 'out/check/views_los.json'), 'utf8'))
} catch {
  console.warn('[sync:town] 注意: out/check/views_los.json が無いので、眺めの線の下に抑える街区（D-085）を使いません')
}
log('地図データを読みました')

/* 2. 地形 */
const terrain = new Terrain(src)
// 町の歩く道のグラフ（形の版 9。水面を下げる前の高さ画像で、町の地図データの道順の計算 routegraph.py と同じ時間にする）
const walk = buildWalkGraph(L, (x, y) => terrain.height(x, y))
log(`歩く道のグラフ: 節点 ${walk.nodes.length}・辺 ${walk.edges.length}・石段 ${walk.stairs.length}・道の上の橋 ${walk.decks.length}`)
// 道の面（中心線と幅）。街区の自動の建物を道にかけない（autofill.mjs。§7 の 169）
const roadStrips = new RoadStrips(walk)
terrain.carveWater()
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates.map(openRing)] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p.map(openRing)) : [])
for (const f of [...(L.coast.wharf ?? []), ...(L.coast.pier ?? [])]) for (const rings of polysOf(f.geometry)) terrain.raiseLand(rings, f.properties.crest_elev_m ?? 2.8)
for (const f of L.coast.breakwater ?? []) {
  const w = f.properties.width_m ?? 10
  const line = f.geometry.coordinates
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = (-(b[1] - a[1]) / len) * (w / 2)
    const ny = ((b[0] - a[0]) / len) * (w / 2)
    terrain.raiseLand(
      [
        [
          [a[0] + nx, a[1] + ny],
          [b[0] + nx, b[1] + ny],
          [b[0] - nx, b[1] - ny],
          [a[0] - nx, a[1] - ny],
        ],
      ],
      f.properties.crest_elev_m ?? 3,
    )
  }
}
// 船溜まりは海に戻す（埠頭の多角形の切り欠きの中にあるものがあるため）
for (const f of L.water.basin ?? []) {
  if (f.properties.surface_id && f.properties.surface_id.startsWith('canal')) continue
  for (const rings of polysOf(f.geometry))
    for (const l of terrain.layers)
      l.grid.fill(rings, (i, cov) => {
        if (cov < 0.5) return
        l.water[i] = WATER.sea
        l.height[i] = Math.min(l.height[i], -3)
      })
}
terrain.clampBox(TOWN_DATA.labClearance.box, TOWN_DATA.labClearance.maxGround)
const groundAt = (x, y) => terrain.height(x, y)
log('地形を直しました（水面を水底へ・埠頭と防波堤を陸に・ラボの下を床の 1m 下まで）')

/* 3. 建物 */
const exclude = new Set(TOWN_DATA.exclude)
const [cx0, cy0, cx1, cy1] = TOWN_DATA.labClearance.box
const clear = (x, y, r = 0) => !(x + r > cx0 && x - r < cx1 && y + r > cy0 && y - r < cy1)
const named = []
const namedIndexOf = new Map()
const interiorPlanned = new Set(['building.sakuragioka.lab', 'building.kaedezaka.thompson', 'building.chuo.garden-dome', 'building.ekimae.cafe-platform-1872', 'building.akarimachi.seizu-coffee'])
const buildingFeatures = L.buildings.building ?? []
for (const f of buildingFeatures) {
  const p = f.properties
  if (!p.named) continue
  const [x, y] = centroid(f.geometry.coordinates[0])
  namedIndexOf.set(p.id, named.length)
  named.push({
    id: p.id,
    name: p.name,
    kind: p.kind ?? null,
    district: p.district ?? null,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    z: p.ground_z_m ?? null,
    height: p.roof_height_m ?? p.height_m ?? null,
    interior: interiorPlanned.has(p.id) ? 'planned' : 'exterior',
    drawn: !exclude.has(p.id),
  })
}
// 点の街区の profile（町並みの型を決める）。街区の外接長方形を 100m の格子に登録して引く
const PROFILE_CELL = 100
const profileGrid = new Map()
for (const f of L.blocks.block ?? []) {
  if (!f.properties.profile || f.geometry.type !== 'Polygon') continue
  const rings = f.geometry.coordinates.map(openRing)
  const [x0, y0, x1, y1] = bboxOf(rings)
  const item = { rings, profile: f.properties.profile }
  for (let gx = Math.floor(x0 / PROFILE_CELL); gx <= Math.floor(x1 / PROFILE_CELL); gx++)
    for (let gy = Math.floor(y0 / PROFILE_CELL); gy <= Math.floor(y1 / PROFILE_CELL); gy++) {
      const k = `${gx}_${gy}`
      if (!profileGrid.has(k)) profileGrid.set(k, [])
      profileGrid.get(k).push(item)
    }
}
const profileAt = (x, y) => (profileGrid.get(`${Math.floor(x / PROFILE_CELL)}_${Math.floor(y / PROFILE_CELL)}`) ?? []).find((b) => insidePolygon(x, y, b.rings))?.profile ?? null
const buildings = []
let gardenDome = null
let cafeCapped = 0
for (const f of buildingFeatures) {
  const p = f.properties
  if (exclude.has(p.id) || f.geometry.type !== 'Polygon') continue
  if (p.id === 'building.chuo.garden-dome') {
    const ring = openRing(f.geometry.coordinates[0])
    const [x, y] = centroid(ring)
    const r = ring.reduce((s, q) => s + Math.hypot(q[0] - x, q[1] - y), 0) / ring.length
    gardenDome = { type: 'gardenDome', id: p.id, x, y, z: p.ground_z_m ?? groundAt(x, y), r, height: p.height_m ?? 48 }
    continue
  }
  const rec = buildingRecord(f, groundAt, namedIndexOf.get(p.id), profileAt)
  const [bx, by] = rec.shape === 'rect' ? [rec.cx, rec.cy] : centroid(rec.ring)
  if (!clear(bx, by)) continue
  // Café Platform 1872 の窓からガーデンドームを見る線より上に出る、名前の無い建物は階を減らす（1 階は残す）
  if (!rec.named) {
    const cap = cafeViewCeiling(bx, by)
    if (rec.floorZ + rec.ridge > cap) {
      const rise = rec.ridge - rec.eave
      const fh = Math.max(2.6, (rec.eave - 0.4) / Math.max(1, rec.floors))
      let floors = rec.floors
      while (floors > 1 && rec.floorZ + floors * fh + 0.4 + rise > cap) floors--
      rec.floors = floors
      rec.eave = floors * fh + 0.4
      rec.ridge = rec.eave + rise
      cafeCapped++
    }
  }
  buildings.push(rec)
}
log(`Café Platform 1872 の窓からドームを見る線の下に抑えた建物: ${cafeCapped} 棟`)
// 建物の部分（塔・ドーム・尖塔・煙突・大庇・車庫）
const parentOf = new Map(buildingFeatures.map((f) => [f.properties.id, f.properties]))
for (const f of L.buildings.building_part ?? []) {
  const p = f.properties
  const parent = parentOf.get(p.building_id) ?? {}
  const ring = openRing(f.geometry.coordinates[0])
  if (ringArea(ring) < 0) ring.reverse()
  const name = p.name ?? ''
  const roofType = p.roof_type ?? ''
  const special = roofType.includes('ドーム') || name.includes('ドーム') || name.includes('星の間') ? 'dome' : name.includes('尖塔') ? 'spire' : name.includes('煙突') ? 'chimney' : name.includes('大庇') ? 'canopy' : name.includes('時計塔') ? 'clocktower' : null
  const facade = special === 'chimney' ? 3 : facadeOf(parent.wall_color, parent.material)
  const gz = p.ground_z_m ?? parent.ground_z_m ?? groundAt(...centroid(ring))
  const top = p.height_m ?? parent.height_m ?? 10
  const rec = {
    id: p.id,
    name: p.name ?? null,
    named: true,
    namedIndex: namedIndexOf.get(p.building_id) ?? -1,
    roof: name.includes('車庫') ? 1 : 0,
    special: special === 'clocktower' && roofType.includes('ドーム') ? 'clocktower' : special,
    facade,
    use: purposeOf(parent.use),
    flags: FLAG.named | ((top >= 40 ? FLAG.tall : 0)),
    floors: p.floors ?? Math.max(1, Math.round(top / 3.6)),
    floorZ: gz,
    base: 0.5,
    eave: top,
    ridge: top,
    wall: special === 'chimney' ? [0x8e, 0x4a, 0x36] : wallColorOf(parent.wall_color, facade),
    roofColor: roofColorOf(p.roof_color ?? parent.roof_color),
    seed: seedOf(p.id),
    style: styleOf(profileAt(...centroid(ring)), parent.district),
  }
  const rect = rectOf(ring)
  if (rect && !special && rec.roof === 0) buildings.push({ ...rec, shape: 'rect', cx: rect.cx, cy: rect.cy, w: rect.w, d: rect.d, yaw: rect.axis, front: 0 })
  else buildings.push({ ...rec, shape: 'poly', ring })
}
const dataCount = buildings.length
log(`地図データの建物: ${dataCount} 棟（長方形 ${buildings.filter((b) => b.shape === 'rect').length}・形のある ${buildings.filter((b) => b.shape !== 'rect').length}）`)
// 街区までの範囲（auto_fill）に建てる
const viewLimited = viewLimitedBlocks(viewsLos)
let autoCount = 0
const autoStats = { shifted: 0, dropped: 0 }
for (const f of L.blocks.block ?? []) {
  if (!f.properties.auto_fill) continue
  const list = fillBlock(f, terrain, { viewLimited, clear, viewCap: viewCeiling, roads: roadStrips, stats: autoStats })
  autoCount += list.length
  for (const b of list) buildings.push(b)
}
log(`街区までの範囲に建てた建物: ${autoCount} 棟（眺めの線の下に抑えた街区 ${viewLimited.size}。道の面にかかるのでずらした ${autoStats.shifted}・建てなかった ${autoStats.dropped}）`)

/* 4. 地面の色 */
const footprints = buildings.map((b) => {
  if (b.shape !== 'rect') return b.ring
  const ux = [Math.cos(b.yaw), Math.sin(b.yaw)]
  const uy = [-Math.sin(b.yaw), Math.cos(b.yaw)]
  return [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([sx, sy]) => [b.cx + ux[0] * sx * b.w + uy[0] * sy * b.d, b.cy + ux[1] * sx * b.w + uy[1] * sy * b.d])
})
const groundData = {
  blocks: L.blocks.block ?? [],
  parks: L.areas.park ?? [],
  sites: L.buildings.site ?? [],
  plazas: L.roads.plaza ?? [],
  beaches: L.coast.beach ?? [],
  coastlines: L.coast.coastline ?? [],
  wharves: L.coast.wharf ?? [],
  piers: L.coast.pier ?? [],
  breakwaters: L.coast.breakwater ?? [],
  waterSurfaces: [...(L.water.canal_surface ?? []), ...(L.water.pond ?? [])],
  riverSurfaces: L.water.river_surface ?? [],
  streams: L.water.stream ?? [],
  rivers: L.water.river_centerline ?? [],
  rails: L.railway.railway ?? [],
  tracks: L.railway.railway_track ?? [],
  roads: L.roads.road ?? [],
  stairs: L.roads.stairs ?? [],
}
const ground = paintGround(terrain, groundData, footprints)
log('地面の色を塗りました')
// 検算: 歩く道の中心線に建物がかからないか（名前のある建物の外形も見る）
const namedFootprints = buildingFeatures.filter((f) => f.properties.named && f.geometry.type === 'Polygon' && !exclude.has(f.properties.id)).map((f) => openRing(f.geometry.coordinates[0]))
const roadHits = roadBuildingCheck(walk, [...footprints, ...namedFootprints]).map((h) => ({ ...h, auto: h.building >= dataCount && h.building < buildings.length }))
log(`検算: 歩く道の中心線にかかる建物 ${roadHits.length} か所（うち自動の建物 ${roadHits.filter((h) => h.auto).length}）${roadHits.length ? `（例: ${roadHits.slice(0, 4).map((h) => `${h.name ?? h.feat} (${h.at.join(', ')})`).join('・')}）` : ''}`)
// 検算: 街区の自動の建物が道の面（中心線と幅）にかからないか（§7 の 169。0 のはず）。地図データの建物は数えるだけ（入口へ入る道など）
const autoOnRoads = []
let dataOnStrips = 0
footprints.forEach((ring, i) => {
  const hit = roadStrips.hit(ring, 0)
  if (!hit) return
  if (i >= dataCount) autoOnRoads.push({ id: buildings[i].id, feat: hit.feat, name: hit.name, at: [Math.round(buildings[i].cx * 10) / 10, Math.round(buildings[i].cy * 10) / 10], depth: Math.round(hit.move * 100) / 100 })
  else dataOnStrips++
})
log(`検算: 道の面にかかる自動の建物 ${autoOnRoads.length} 棟${autoOnRoads.length ? `（例: ${autoOnRoads.slice(0, 4).map((h) => `${h.name ?? h.feat} (${h.at.join(', ')})`).join('・')}）` : ''}・地図データの建物 ${dataOnStrips} 棟`)

/* 5. 木と灯り */
const trees = placeTrees(terrain, ground, { districts: L.areas.district ?? [], roads: L.roads.road ?? [], structures: L.buildings.structure ?? [] }, {
  treeMaxDistance: TOWN_DATA.trees.maxDistance,
  treeNorthRadius: TOWN_DATA.trees.northRadius,
  treeSpacing: TOWN_DATA.trees.spacing,
  treeSpacingGrowth: TOWN_DATA.trees.spacingGrowth,
}).filter((t) => clear(t.x, t.y, 2))
const lights = placeLights(terrain, { roads: L.roads.road ?? [], stairs: L.roads.stairs ?? [], plazas: L.roads.plaza ?? [], wharves: L.coast.wharf ?? [], piers: L.coast.pier ?? [], outside: L.areas.outside ?? [] }, {}).filter((l) => clear(l.x, l.y))
// 高い建物の上の航空障害灯（60m 以上）と、駅の時計塔の文字盤
for (const b of buildings) {
  const top = b.floorZ + b.ridge
  if (b.ridge >= 60) {
    const [x, y] = b.shape === 'rect' ? [b.cx, b.cy] : centroid(b.ring)
    lights.push({ x, y, z: top + 1.5, kind: LIGHT.aviation, color: '#ff3a2a', size: 1.8, power: 1.6, seed: 0.1 })
  }
  if (b.special === 'clocktower') {
    const [x, y] = centroid(b.ring)
    const half = Math.sqrt(Math.abs(ringArea(b.ring))) / 2
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      lights.push({ x: x + dx * (half + 0.3), y: y + dy * (half + 0.3), z: b.floorZ + b.eave - half * 2 - 2.5, kind: LIGHT.clock, color: '#fff1d6', size: 2.6, power: 1.4, seed: 0 })
  }
}
log(`木 ${trees.length} 本・灯り ${lights.length}`)

/* 6. 水面・岸壁・鉄道・橋・ケーブル・構造物 */
const coastLights = (L.coast.light ?? []).map((f) => ({ id: f.properties.id, name: f.properties.name, x: f.geometry.coordinates[0], y: f.geometry.coordinates[1], focal: f.properties.focal_elev_m, character: f.properties.character ?? null, range: f.properties.range_km ?? null }))
const infra = buildInfra(terrain, L)
const structures = buildStructures(terrain, L, coastLights).filter((s) => !exclude.has(s.id))
if (gardenDome) structures.push(gardenDome)
// ラボのまわりの道と広場（ラボの前のセット。形の版 3）
const site = sitePaths(L, 340)
// 交通（緑電・ヒノテツ・運河バス・連絡船・浮遊レーン）と信号のある交差点（形の版 7）
const transit = buildTransit(terrain, L)
log(`交通: 緑電 ${transit.trams.length} 系統・停留所 ${transit.tramStops.length}・ヒノテツ ${transit.rail ? Math.round(transit.rail.length) + 'm' : 'なし'}・運河バス ${transit.waterbus.length} 航路・浮遊レーン ${transit.lanes.length}・信号 ${transit.signals.length}`)
log(`水面の三角形 ${infra.water.idx.length / 3}・壁 ${infra.walls.length}・線路 ${infra.rails.length}・橋 ${infra.bridges.length}・構造物 ${structures.length}`)

/* 7. 書き出し */
rmSync(dest, { recursive: true, force: true })
mkdirSync(join(dest, 'tiles'), { recursive: true })
mkdirSync(join(dest, 'terrain'), { recursive: true })
mkdirSync(join(dest, 'ground'), { recursive: true })
const files = {}
const write = (rel, buf) => {
  writeFileSync(join(dest, rel), buf)
  files[rel] = buf.length
}
write('terrain/center.bin', terrain.export(terrain.center))
write('terrain/overview.bin', terrain.export(terrain.overview))
for (const name of ['center', 'overview']) {
  const gd = ground[name]
  write(`ground/${name}.png`, encodePng(gd.grid.width, gd.grid.height, 4, gd.albedo))
  write(`ground/${name}-aux.png`, encodePng(gd.auxGrid.width, gd.auxGrid.height, 4, gd.aux))
}
log('地形と地面の画像を書きました')
// タイル
const size = TOWN_DATA.tileSize
const tiles = new Map()
const tileOf = (x, y) => {
  const k = tileKey(x, y, size)
  if (!tiles.has(k)) tiles.set(k, { buildings: [], trees: [], lights: [] })
  return tiles.get(k)
}
for (const b of buildings) {
  const [x, y] = b.shape === 'rect' ? [b.cx, b.cy] : centroid(b.ring)
  tileOf(x, y).buildings.push(b)
}
for (const t of trees) tileOf(t.x, t.y).trees.push(t)
for (const l of lights) tileOf(l.x, l.y).lights.push(l)
const tileList = []
for (const [key, items] of [...tiles.entries()].sort()) {
  const rel = `tiles/${key}.bin`
  write(rel, packTile(key, size, items))
  const [tx, ty] = key.split('_').map(Number)
  tileList.push({ key, file: rel, bounds: [tx * size, ty * size, (tx + 1) * size, (ty + 1) * size], buildings: items.buildings.length, trees: items.trees.length, lights: items.lights.length, bytes: files[rel] })
}
const json = (obj) => Buffer.from(JSON.stringify(obj))
write('infra.json', json({ ...infra, structures, coastLights, site, transit }))
// 名前のある建物の外観の記録（形の版 4。読むのは world/outdoor/named/）
const namedFile = namedRecords(L, groundAt, profileAt, exclude)
write('named.json', json(namedFile))
write('walk.json', json(walkFile(walk, { format: TOWN_DATA.format, check: { buildingsOnRoads: roadHits.length, examples: roadHits.slice(0, 40), autoOnRoads: autoOnRoads.length, autoExamples: autoOnRoads.slice(0, 40) } })))
log(`名前のある建物の記録: ${namedFile.buildings.length} 棟・構造物 ${namedFile.structures.length}`)
log(`タイル ${tileList.length} 個を書きました`)

const station = named.find((n) => n.id === 'building.ekimae.sakurami-station')
const manifest = {
  format: TOWN_DATA.format,
  generatedAt: new Date().toISOString(),
  source: { path: src, ...signature, name: meta.name },
  origin: meta.origin,
  threejs: meta.threejs,
  terrain: {
    center: { file: 'terrain/center.bin', extent: terrain.center.meta.extent_lab },
    overview: { file: 'terrain/overview.bin', extent: terrain.overview.meta.extent_lab },
  },
  ground: {
    center: { albedo: 'ground/center.png', aux: 'ground/center-aux.png', extent: terrain.center.meta.extent_lab, auxPixel: ground.center.auxGrid.px },
    overview: { albedo: 'ground/overview.png', aux: 'ground/overview-aux.png', extent: terrain.overview.meta.extent_lab, auxPixel: ground.overview.auxGrid.px },
  },
  infra: 'infra.json',
  namedFile: 'named.json',
  walkFile: 'walk.json',
  tiles: { size, list: tileList },
  landmarks: {
    station: station ? [station.x, station.y] : [-667, -1390],
    townCenter: station ? [(station.x - 800) / 2, (station.y - 945) / 2] : [-730, -1170],
  },
  named,
  stats: {
    buildings: buildings.length,
    buildingsFromData: dataCount,
    buildingsAutoFill: autoCount,
    trees: trees.length,
    lights: lights.length,
    bytes: Object.values(files).reduce((s, v) => s + v, 0),
  },
}
write('manifest.json', json(manifest))
const mb = (n) => (n / 1024 / 1024).toFixed(1)
log(`できました: ${dest}（${mb(manifest.stats.bytes)} MB。建物 ${buildings.length}・木 ${trees.length}・灯り ${lights.length}・タイル ${tileList.length}）`)
for (const [rel, n] of Object.entries(files).filter(([r]) => !r.startsWith('tiles/'))) console.log(`        ${rel.padEnd(26)} ${mb(n).padStart(6)} MB`)
console.log(`        tiles/（${tileList.length} 個）          ${mb(tileList.reduce((s, t) => s + t.bytes, 0)).padStart(6)} MB`)
void statSync
