// 建物・木・灯りを 1km の区画（タイル）に分けて、区画ごとの入れ物に詰める
import { writeContainer } from './container.mjs'

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)))

export function tileKey(x, y, size) {
  return `${Math.floor(x / size)}_${Math.floor(y / size)}`
}

export function packTile(key, size, items) {
  const [tx, ty] = key.split('_').map(Number)
  const rects = items.buildings.filter((b) => b.shape === 'rect')
  const polys = items.buildings.filter((b) => b.shape !== 'rect')
  const n = rects.length
  const bPos = new Float32Array(n * 4)
  const bDim = new Float32Array(n * 4)
  const bExt = new Float32Array(n * 4)
  const bWall = new Uint8Array(n * 4)
  const bRoof = new Uint8Array(n * 4)
  const bMeta = new Uint8Array(n * 4)
  const bNamed = new Int32Array(n)
  rects.forEach((b, i) => {
    bPos.set([b.cx, b.cy, b.floorZ, b.yaw], i * 4)
    bDim.set([b.w, b.d, b.eave, b.ridge], i * 4)
    bExt.set([b.base, b.floors, b.front ?? 0, b.style ?? 0], i * 4)
    bWall.set([...b.wall, b.facade], i * 4)
    bRoof.set([...b.roofColor, b.roof], i * 4)
    bMeta.set([b.use, b.flags, b.seed & 255, (b.seed >>> 8) & 255], i * 4)
    bNamed[i] = b.namedIndex ?? -1
  })
  const t = items.trees
  const tPos = new Float32Array(t.length * 4)
  const tAttr = new Uint8Array(t.length * 4)
  t.forEach((q, i) => {
    tPos.set([q.x, q.y, q.z, q.h], i * 4)
    tAttr.set([clamp255(q.r * 10), q.kind, q.tint, q.flags ?? 0], i * 4)
  })
  const l = items.lights
  const lPos = new Float32Array(l.length * 4)
  const lCol = new Uint8Array(l.length * 4)
  const lKind = new Uint8Array(l.length * 2)
  l.forEach((q, i) => {
    lPos.set([q.x, q.y, q.z, q.size], i * 4)
    const c = parseInt(q.color.slice(1), 16)
    lCol.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, clamp255(q.power * 50)], i * 4)
    lKind.set([q.kind, clamp255(Math.min(1, q.seed) * 255)], i * 2)
  })
  const round = (v) => Math.round(v * 100) / 100
  const meta = {
    kind: 'tile',
    key,
    bounds: [tx * size, ty * size, (tx + 1) * size, (ty + 1) * size],
    counts: { rects: n, polys: polys.length, trees: t.length, lights: l.length },
    polys: polys.map((b) => ({
      id: b.id,
      name: b.name ?? null,
      ring: b.ring.map((p) => [round(p[0]), round(p[1])]),
      floorZ: round(b.floorZ),
      base: round(b.base),
      eave: round(b.eave),
      ridge: round(b.ridge),
      roof: b.roof,
      special: b.special ?? null,
      facade: b.facade,
      use: b.use,
      flags: b.flags,
      floors: b.floors,
      wall: b.wall,
      roofColor: b.roofColor,
      seed: b.seed,
      style: b.style ?? 0,
      namedIndex: b.namedIndex ?? -1,
    })),
  }
  return writeContainer(meta, {
    b_pos: { array: bPos, itemSize: 4 },
    b_dim: { array: bDim, itemSize: 4 },
    b_ext: { array: bExt, itemSize: 4 },
    b_wall: { array: bWall, itemSize: 4 },
    b_roof: { array: bRoof, itemSize: 4 },
    b_meta: { array: bMeta, itemSize: 4 },
    b_named: { array: bNamed, itemSize: 1 },
    t_pos: { array: tPos, itemSize: 4 },
    t_attr: { array: tAttr, itemSize: 4 },
    l_pos: { array: lPos, itemSize: 4 },
    l_col: { array: lCol, itemSize: 4 },
    l_kind: { array: lKind, itemSize: 2 },
  })
}
