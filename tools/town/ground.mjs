// 地面の色の画像（地面の色 RGB ＋ 陸か海か A）と、補助の画像（R 夜の街灯の照り返し・G 植生・B 舗装・A 川・運河・池でないか）を塗る。
// 中心（1m/画素。補助は 2m）と全体（5m）の 2 組。塗る順: 森 → 地区・街区の用途 → 公園・広場・校庭 → 海辺 → 水面 → 線路 → 道 → 建物の足元の陰
import { Grid, openRing } from './geo.mjs'
import { WATER } from './terrain.mjs'

/** 地面の色（sRGB） */
export const GROUND = {
  forest: [46, 58, 35],
  forestDark: [38, 49, 31],
  lawn: [80, 100, 54],
  field: [112, 120, 70],
  garden: [96, 98, 80],
  gardenGreen: [80, 94, 62],
  paving: [158, 152, 140],
  stone: [138, 132, 122],
  stoneDark: [92, 90, 88],
  asphalt: [66, 67, 70],
  sidewalk: [146, 142, 134],
  concrete: [138, 136, 130],
  sand: [194, 180, 146],
  rock: [118, 112, 102],
  ballast: [100, 93, 86],
  waterBed: [38, 44, 42],
  schoolyard: [172, 156, 124],
  parking: [92, 92, 94],
  tramGrass: [84, 110, 58],
  underViaduct: [58, 56, 54],
}

/** 用途ごとの街区の地面の色と植生（0〜1） */
const BLOCK_USE = {
  residential: [GROUND.garden, 0.45],
  commercial: [GROUND.paving, 0.1],
  office: [GROUND.paving, 0.15],
  port: [GROUND.concrete, 0.02],
  school: [GROUND.schoolyard, 0.25],
  lab: [GROUND.paving, 0.2],
  workshop: [GROUND.concrete, 0.05],
  civic: [GROUND.paving, 0.2],
  forest: [GROUND.forest, 1],
  farm: [GROUND.field, 0.3],
  open_green: [GROUND.lawn, 0.6],
  park: [GROUND.lawn, 0.7],
  parking: [GROUND.parking, 0],
}

/** 道の種類ごと: [幅の既定, 色, 歩道の幅, 街灯の照り返しの強さ] */
const ROAD_STYLE = {
  trunk: [24, GROUND.asphalt, 4, 1.0],
  arterial: [14, GROUND.asphalt, 3, 0.9],
  local: [6, GROUND.asphalt, 0, 0.6],
  alley: [3, GROUND.stone, 0, 0.35],
  pedestrian: [8, GROUND.paving, 0, 0.7],
  path: [3, GROUND.stone, 0, 0.3],
  tram_row: [6.5, GROUND.tramGrass, 0, 0.3],
}

class Layer {
  constructor(extent, auxPx) {
    this.grid = new Grid(extent)
    const n = this.grid.width * this.grid.height
    this.rgb = new Float32Array(n * 3)
    this.aux = new Grid({ xmin: extent.xmin, ymax: extent.ymax, pixel_m: auxPx, width: Math.round((extent.width * extent.pixel_m) / auxPx), height: Math.round((extent.height * extent.pixel_m) / auxPx) })
    const m = this.aux.width * this.aux.height
    this.glow = new Float32Array(m)
    this.veg = new Float32Array(m)
    this.paved = new Float32Array(m)
    this.bldg = new Float32Array(n)
    /** 川・運河・池・小川・船溜まりの水面（補助の格子。地面のシェーダーはここを描かず、下の水面の形を見せる） */
    this.wet = new Float32Array(m)
    /** 置いてはいけない所（補助の格子。ビット: 1 建物、2 道、4 水、8 線路、16 広場・舗装） */
    this.blocked = new Uint8Array(m)
  }
  paint(rings, color, opts = {}) {
    const rgb = this.rgb
    this.grid.fill(rings, (i, cov) => {
      const k = cov * (opts.alpha ?? 1)
      rgb[i * 3] += (color[0] - rgb[i * 3]) * k
      rgb[i * 3 + 1] += (color[1] - rgb[i * 3 + 1]) * k
      rgb[i * 3 + 2] += (color[2] - rgb[i * 3 + 2]) * k
    })
    this.auxFill(rings, opts)
  }
  auxFill(rings, opts) {
    if (opts.veg === undefined && opts.paved === undefined && !opts.block && !opts.wet) return
    this.aux.fill(rings, (i, cov) => {
      if (opts.wet) this.wet[i] = Math.max(this.wet[i], cov)
      if (opts.veg !== undefined) this.veg[i] += (opts.veg - this.veg[i]) * cov
      if (opts.paved !== undefined) this.paved[i] += (opts.paved - this.paved[i]) * cov
      if (opts.block && cov > 0.35) this.blocked[i] |= opts.block
    })
  }
  stroke(points, width, color, opts = {}) {
    const rgb = this.rgb
    this.grid.stroke(points, width, (i, cov) => {
      rgb[i * 3] += (color[0] - rgb[i * 3]) * cov
      rgb[i * 3 + 1] += (color[1] - rgb[i * 3 + 1]) * cov
      rgb[i * 3 + 2] += (color[2] - rgb[i * 3 + 2]) * cov
    })
    if (opts.veg !== undefined || opts.paved !== undefined || opts.block || opts.wet)
      this.aux.stroke(points, width, (i, cov) => {
        if (opts.wet) this.wet[i] = Math.max(this.wet[i], cov)
        if (opts.veg !== undefined) this.veg[i] += (opts.veg - this.veg[i]) * cov
        if (opts.paved !== undefined) this.paved[i] += (opts.paved - this.paved[i]) * cov
        if (opts.block && cov > 0.35) this.blocked[i] |= opts.block
      })
  }
  glowStroke(points, width, k) {
    this.aux.stroke(points, width, (i, cov) => {
      const v = cov * k
      if (v > this.glow[i]) this.glow[i] = v
    })
  }
  glowFill(rings, k) {
    this.aux.fill(rings, (i, cov) => {
      const v = cov * k
      if (v > this.glow[i]) this.glow[i] = v
    })
  }
}

/** 箱ぼかし（横と縦を 2 回ずつ。ガウスぼかしに近い） */
function blur(data, w, h, r) {
  if (r < 1) return
  const tmp = new Float32Array(data.length)
  const pass = (src, dst, horizontal) => {
    const n = horizontal ? w : h
    const m = horizontal ? h : w
    for (let j = 0; j < m; j++) {
      let acc = 0
      const at = (i) => (horizontal ? j * w + i : i * w + j)
      for (let i = -r; i <= r; i++) acc += src[at(Math.min(n - 1, Math.max(0, i)))]
      for (let i = 0; i < n; i++) {
        dst[at(i)] = acc / (2 * r + 1)
        acc += src[at(Math.min(n - 1, i + r + 1))] - src[at(Math.max(0, i - r))]
      }
    }
  }
  for (let k = 0; k < 2; k++) {
    pass(data, tmp, true)
    pass(tmp, data, false)
  }
}

const polyRings = (g) => (g.type === 'Polygon' ? [g.coordinates.map(openRing)] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p.map(openRing)) : [])
const lines = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])

/**
 * 地面を塗る。layers: { center: {albedo extent}, overview: {...} }。data: 層ごとに分けた地図データ。buildings: 建物の記録（足元の陰）
 */
export function paintGround(terrain, data, buildingFootprints) {
  const out = {}
  for (const [name, auxPx] of [
    ['center', 2],
    ['overview', 5],
  ]) {
    const t = terrain[name]
    const L = new Layer({ xmin: t.grid.xmin, ymax: t.grid.ymax, pixel_m: t.grid.px, width: t.grid.width, height: t.grid.height }, auxPx)
    const g = L.grid
    // 1. 陸はいったん森（町の外の丘・斜面）。海辺の低い所は少し明るい草地
    for (let i = 0; i < g.width * g.height; i++) {
      const c = GROUND.forest
      L.rgb.set(c, i * 3)
    }
    L.veg.fill(0.85)
    // 2. 街区の用途
    for (const f of data.blocks) {
      const p = f.properties
      let [c, veg] = BLOCK_USE[p.use] ?? BLOCK_USE.residential
      // 街区の緑（greenery）の言葉を先に見る: 芝生 → 芝、林・森・里山 → 森、棚田 → 田、庭木・生け垣・楓 → 緑の多い庭
      const green = p.greenery ?? ''
      if (green.includes('芝生')) [c, veg] = [GROUND.lawn, 0.65]
      else if (/林|森|里山/.test(green) && (p.use === 'forest' || p.use === 'farm' || (p.coverage ?? 0.3) < 0.3)) [c, veg] = [GROUND.forest, 0.85]
      else if (green.includes('棚田')) [c, veg] = [GROUND.field, 0.35]
      else if (p.use === 'residential' && /庭|生け垣|林|楓/.test(green)) [c, veg] = [GROUND.gardenGreen, 0.6]
      else if ((p.use === 'civic' || p.use === 'school' || p.use === 'lab') && /桜|緑|庭/.test(green)) [c, veg] = [GROUND.gardenGreen, 0.5]
      for (const rings of polyRings(f.geometry)) L.paint(rings, c, { veg, paved: p.use === 'forest' || p.use === 'farm' ? 0 : 0.3 })
    }
    // 3. 公園・広場・校庭
    for (const f of data.parks) {
      const forest = f.properties.id === 'park.marunomori'
      for (const rings of polyRings(f.geometry)) L.paint(rings, forest ? GROUND.forestDark : GROUND.lawn, { veg: forest ? 1 : 0.7, paved: 0 })
    }
    for (const f of data.sites) for (const rings of polyRings(f.geometry)) L.paint(rings, GROUND.schoolyard, { veg: 0.05, paved: 0.2 })
    for (const f of data.plazas) {
      const lawn = (f.properties.surface ?? '').startsWith('芝生')
      for (const rings of polyRings(f.geometry)) {
        L.paint(rings, lawn ? GROUND.lawn : GROUND.paving, { veg: lawn ? 0.5 : 0, paved: lawn ? 0.3 : 1, block: 16 })
        L.glowFill(rings, 0.75)
      }
    }
    // 4. 海辺（砂浜・岩の海岸・埠頭と桟橋・防波堤）
    for (const f of data.beaches) for (const rings of polyRings(f.geometry)) L.paint(rings, GROUND.sand, { veg: 0, paved: 0 })
    for (const f of data.coastlines) {
      const k = f.properties.kind
      const color = k === 'beach' ? GROUND.sand : k === 'sea_cliff' || k === 'rocky_shore' ? GROUND.rock : GROUND.concrete
      for (const ln of lines(f.geometry)) L.stroke(ln, k === 'sea_cliff' ? 10 : 5, color, { veg: 0 })
    }
    for (const f of [...data.wharves, ...data.piers]) for (const rings of polyRings(f.geometry)) {
      L.paint(rings, GROUND.concrete, { veg: 0, paved: 1 })
      L.glowFill(rings, 0.35)
    }
    for (const f of data.breakwaters) for (const ln of lines(f.geometry)) L.stroke(ln, f.properties.width_m ?? 10, GROUND.concrete, { veg: 0, paved: 1 })
    // 5. 水面（川・運河・池・船溜まり）の底
    for (const f of data.waterSurfaces) for (const rings of polyRings(f.geometry)) L.paint(rings, GROUND.waterBed, { veg: 0, paved: 0, block: 4, wet: true })
    // 川: 水面の多角形は底の色だけ。水面（と地面を描かない所）は中心線の川幅（水面の形も infra.json の中心線の帯なので、そろえる）
    for (const f of data.riverSurfaces) for (const rings of polyRings(f.geometry)) L.paint(rings, GROUND.waterBed, { veg: 0, paved: 0, block: 4 })
    for (const f of data.rivers) {
      const c = f.geometry.coordinates
      const widths = Array.isArray(f.properties.width_m) ? f.properties.width_m : c.map(() => f.properties.width_m ?? 8)
      for (let i = 1; i < c.length; i++) L.stroke([c[i - 1], c[i]], (widths[i - 1] + widths[i]) / 2, GROUND.waterBed, { veg: 0, block: 4, wet: true })
    }
    for (const f of data.streams) for (const ln of lines(f.geometry)) L.stroke(ln, (f.properties.width_m ?? 2) + 1, GROUND.waterBed, { veg: 0.2, block: 4, wet: true })
    // 6. 線路（地平・築堤・橋は砂利。高架は下の地面を少し暗く）
    for (const f of data.rails) {
      const st = f.properties.structure
      if (st === 'tunnel') continue
      const w = (f.properties.tracks ?? 2) * 4.6 + 1.5
      const viaduct = st === 'concrete_viaduct' || st === 'stone_arch_viaduct'
      for (const ln of lines(f.geometry)) L.stroke(ln, w, viaduct ? GROUND.underViaduct : GROUND.ballast, { veg: 0, block: viaduct ? 0 : 8 })
    }
    for (const f of data.tracks) for (const ln of lines(f.geometry)) L.stroke(ln, 4.6, GROUND.ballast, { veg: 0, block: 8 })
    // 7. 道（細い道から。広い道は歩道を塗ってから車道）
    const order = ['path', 'alley', 'tram_row', 'local', 'pedestrian', 'arterial', 'trunk']
    const roads = [...data.roads].sort((a, b) => order.indexOf(a.properties.class) - order.indexOf(b.properties.class))
    for (const f of roads) {
      const p = f.properties
      if (p.underground) continue
      const st = ROAD_STYLE[p.class] ?? ROAD_STYLE.local
      const w = p.width_m ?? st[0]
      const surface = p.surface ?? ''
      let color = st[1]
      if (p.class === 'alley' || p.class === 'local') color = surface.startsWith('石畳') ? GROUND.stone : surface.startsWith('アスファルト') ? GROUND.asphalt : st[1]
      if (p.class === 'tram_row' && surface.includes('石畳')) color = GROUND.stone
      if (p.class === 'path' && surface.startsWith('土')) color = [112, 100, 82]
      for (const ln of lines(f.geometry)) {
        if (st[2] > 0 && w > st[2] * 2 + 3) {
          L.stroke(ln, w, GROUND.sidewalk, { veg: 0, paved: 1, block: 2 })
          L.stroke(ln, w - st[2] * 2, surface.includes('芝生軌道') ? GROUND.asphalt : color, {})
          if (surface.includes('芝生軌道')) L.stroke(ln, 6, GROUND.tramGrass, {})
        } else L.stroke(ln, w, color, { veg: 0, paved: 1, block: 2 })
        L.glowStroke(ln, w + 10, st[3])
      }
    }
    for (const f of data.stairs) for (const ln of lines(f.geometry)) {
      L.stroke(ln, f.properties.width_m ?? 3, GROUND.stone, { veg: 0, paved: 1, block: 2 })
      L.glowStroke(ln, (f.properties.width_m ?? 3) + 4, 0.4)
    }
    // 8. 建物の足元（屋根に隠れる所は暗い灰色）と、まわりの地面の陰
    for (const ring of buildingFootprints) {
      g.fill([ring], (i, cov) => {
        L.bldg[i] = Math.max(L.bldg[i], cov)
      })
      L.aux.fill([ring], (i, cov) => {
        if (cov > 0.3) L.blocked[i] |= 1
      })
    }
    const ao = L.bldg.slice()
    blur(ao, g.width, g.height, Math.max(1, Math.round(2.5 / g.px)))
    // 9. 画像に（A = 陸 255 / 海 0）
    const n = g.width * g.height
    const albedo = new Uint8Array(n * 4)
    for (let i = 0; i < n; i++) {
      const b = L.bldg[i]
      const shade = 1 - 0.5 * Math.min(1, ao[i] * 1.6) * (1 - b)
      for (let k = 0; k < 3; k++) {
        const v = L.rgb[i * 3 + k] * shade * (1 - b) + 78 * b
        albedo[i * 4 + k] = Math.max(0, Math.min(255, Math.round(v)))
      }
      albedo[i * 4 + 3] = t.water[i] === WATER.sea ? 0 : 255
    }
    // 補助: 街灯の照り返しはぼかす。建物の陰も補助に（ぼかしの値）
    const a = L.aux
    blur(L.glow, a.width, a.height, Math.max(1, Math.round(6 / auxPx)))
    const m = a.width * a.height
    const aux = new Uint8Array(m * 4)
    for (let i = 0; i < m; i++) {
      aux[i * 4] = Math.round(Math.min(1, L.glow[i] * 1.25) * 255)
      aux[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, L.veg[i])) * 255)
      aux[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, L.paved[i])) * 255)
      // A: 水面の所は 0（地面を描かない）。岸の 1 画素ぶんは少し狭めて、岸の壁と地面のすき間が出ないように
      aux[i * 4 + 3] = Math.round((1 - Math.min(1, L.wet[i] * 1.15)) * 255)
    }
    out[name] = { grid: g, albedo, auxGrid: a, aux, blocked: L.blocked, layer: L }
  }
  return out
}
