// 地形（out/heightmap の高さ画像と水面マスク）を読み、world で使う形に直す。
// 直すこと（docs/design/town.md の「整合性の決めごと」）:
//   - 川・運河・池の水面の画素は、水底の深さだけ下げる（水面の形は water.json の多角形で描くので、地面が水面と重ならないように）
//   - 埠頭・桟橋・防波堤は陸にして、天端の高さまで上げる（高さ画像では海の画素のものがあるため）
//   - ラボ（中は 16m × 12m、北の部屋と南のテラスを含む）の下は、床より 1m 下までに抑える（地面が床を突き抜けないように）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng } from './png.mjs'
import { Grid } from './geo.mjs'
import { writeContainer } from './container.mjs'

/** 水の種類（高さ画像の水面マスクの値） */
export const WATER = { land: 0, sea: 1, river: 2, canal: 3, pond: 4 }
/** 水底の深さ（m）。out/heightmap/*.json の bed_depth_below_surface_m（非正式）に合わせる */
const BED_DEPTH = { [WATER.river]: 1.5, [WATER.canal]: 3.0, [WATER.pond]: 1.0 }

function loadLayer(src, name) {
  const meta = JSON.parse(readFileSync(join(src, 'out/heightmap', `${name}_height.json`), 'utf8'))
  const hp = decodePng(readFileSync(join(src, 'out/heightmap', meta.files.height)))
  const wp = decodePng(readFileSync(join(src, 'out/heightmap', meta.files.water_mask)))
  const ext = meta.extent_lab
  if (hp.width !== ext.width || hp.height !== ext.height || hp.depth !== 16) throw new Error(`${name} の高さ画像の大きさ・形式が説明と合いません`)
  const n = ext.width * ext.height
  const height = new Float32Array(n)
  for (let i = 0; i < n; i++) height[i] = hp.data[i] / 100 - 50
  return { name, meta, grid: new Grid(ext), height, water: new Uint8Array(wp.data) }
}

export class Terrain {
  constructor(src) {
    this.center = loadLayer(src, 'center')
    this.overview = loadLayer(src, 'overview')
    this.layers = [this.center, this.overview]
  }

  /** その点を受け持つ層（中心の 1m が優先。外は全体の 5m。全体の外は null） */
  layerAt(x, y) {
    if (this.center.grid.contains(x, y, 1)) return this.center
    if (this.overview.grid.contains(x, y, 1)) return this.overview
    return null
  }

  /** 地面の標高（m）。全体の範囲の外は、端の値をそのまま伸ばす */
  height(x, y) {
    const l = this.layerAt(x, y) ?? this.overview
    return l.grid.sample(l.height, x, y)
  }

  /** 水の種類（WATER。いちばん近い画素） */
  water(x, y) {
    const l = this.layerAt(x, y)
    if (!l) return WATER.sea
    const c = Math.min(l.grid.width - 1, Math.max(0, Math.floor(l.grid.col(x))))
    const r = Math.min(l.grid.height - 1, Math.max(0, Math.floor(l.grid.row(y))))
    return l.water[r * l.grid.width + c]
  }

  /** 川・運河・池の水面の画素を、水底まで下げる */
  carveWater() {
    for (const l of this.layers) {
      for (let i = 0; i < l.height.length; i++) {
        const d = BED_DEPTH[l.water[i]]
        if (d) l.height[i] -= d
      }
    }
  }

  /** 多角形（輪の配列）の中を陸にし、標高を z 以上にする（埠頭・桟橋・防波堤） */
  raiseLand(rings, z) {
    for (const l of this.layers) {
      l.grid.fill(rings, (i, cov) => {
        if (cov < 0.5) return
        if (l.water[i] === WATER.sea) l.water[i] = WATER.land
        if (l.height[i] < z) l.height[i] = z
      })
    }
  }

  /** 長方形の範囲（x0, y0, x1, y1）の地面を maxZ 以下にする（ラボの下） */
  clampBox([x0, y0, x1, y1], maxZ) {
    for (const l of this.layers) {
      const g = l.grid
      const c0 = Math.max(0, Math.floor(g.col(x0)) - 1)
      const c1 = Math.min(g.width - 1, Math.ceil(g.col(x1)) + 1)
      const r0 = Math.max(0, Math.floor(g.row(y1)) - 1)
      const r1 = Math.min(g.height - 1, Math.ceil(g.row(y0)) + 1)
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const i = r * g.width + c
          if (l.height[i] > maxZ) l.height[i] = maxZ
        }
    }
  }

  /**
   * world 用の高さの入れ物（u16: v = round((z + 50) * 100)。行ごとに左との差にして gzip を効かせる）。
   * 水面マスクも同じ入れ物に入れる
   */
  export(layer) {
    const g = layer.grid
    const n = g.width * g.height
    const delta = new Uint16Array(n)
    for (let r = 0; r < g.height; r++) {
      let prev = 0
      for (let c = 0; c < g.width; c++) {
        const i = r * g.width + c
        const v = Math.max(0, Math.min(65535, Math.round((layer.height[i] + 50) * 100)))
        delta[i] = (v - prev) & 0xffff
        prev = v
      }
    }
    return writeContainer(
      {
        kind: 'terrain',
        name: layer.name,
        extent: { xmin: g.xmin, ymax: g.ymax, pixel_m: g.px, width: g.width, height: g.height },
        encoding: 'u16-row-delta',
        decode: 'z = v / 100 - 50（v は行ごとに左からの差を足し戻した値）',
        water: '0 陸・1 海・2 川・3 運河・4 池と小川',
      },
      { height: delta, water: layer.water },
    )
  }
}
