// 町の地図データ（data/*.geojson）を読む。名前のない建物の共通の属性（property_defaults）を足して読む（README の「buildings.geojson の読み方」）
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export const DATA_FILES = ['coast', 'water', 'railway', 'roads', 'areas', 'transit', 'buildings', 'blocks', 'views']

export function readGeojson(src, name) {
  const fc = JSON.parse(readFileSync(join(src, 'data', `${name}.geojson`), 'utf8'))
  const defaults = fc.property_defaults ?? {}
  for (const f of fc.features) {
    const p = f.properties
    const g = p._defaults
    if (g && defaults[g]) {
      for (const [k, v] of Object.entries(defaults[g])) if (!(k in p)) p[k] = v
      delete p._defaults
    }
  }
  return fc
}

/** 層ごとに分ける */
export function byLayer(fc) {
  const out = {}
  for (const f of fc.features) (out[f.properties.layer] ??= []).push(f)
  return out
}

/** 元データの印（ファイルの大きさと更新時刻から。変わったかを見る用） */
export function sourceSignature(src) {
  const h = createHash('sha1')
  const files = {}
  for (const name of [...DATA_FILES.map((n) => `data/${n}.geojson`), 'town_meta.json', 'out/heightmap/center_height.png', 'out/heightmap/overview_height.png', 'out/heightmap/center_water.png', 'out/heightmap/overview_water.png', 'out/check/views_los.json']) {
    try {
      const s = statSync(join(src, name))
      files[name] = { bytes: s.size, mtime: s.mtime.toISOString() }
      h.update(`${name}:${s.size}:${s.mtimeMs}\n`)
    } catch {
      files[name] = null
    }
  }
  return { signature: h.digest('hex').slice(0, 16), files }
}
