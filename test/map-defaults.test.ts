/**
 * 例のアプリの下ごしらえ（docs/design/map-split.md §8 と、段 5 の案の §8「例のアプリの下ごしらえ」。5-10）:
 * kanon-lab の表を渡さない（configurePlaces・configureNav・configureLab・configureTown を呼ばない）ときも、地図のデータの口が既定の値で動く。
 *
 * ほかのテストが同じプロセスで使う側の表を入れても（kanon-lab の server/test にあった時は、config/layout.ts を読むと configurePlaces(STOPS) が入った）変わらないよう、
 * まっさらな bun のプロセスで読んで確かめる
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

/** まっさらなプロセスで地図の既定の値を読んで、JSON で返す */
const PROBE = `
const P = ${JSON.stringify(PKG)}
const places = await import(P + '/core/places.ts')
const anchors = await import(P + '/core/lab/anchors.ts')
const placements = await import(P + '/core/lab/placements.ts')
const navData = await import(P + '/core/lab/navData.ts')
const nav = await import(P + '/character/avatar/nav.ts')
const host = await import(P + '/world/townHost.ts')
const T = places.TOWN_PLACES
const ids = Object.keys(T)
const at = (id) => [T[id].position[0], T[id].position[2]]
const names = anchors.labAnchorNames()
const graph = nav.navGraph()
console.log(JSON.stringify({
  placesSame: places.townPlaces() === T,
  placeCount: ids.length,
  hasStage: ids.includes('stage'),
  anchorNames: names.length,
  anchorsSameAsTable: names.every((n) => JSON.stringify(anchors.labAnchor(n)) === JSON.stringify(anchors.labAnchor(n, placements.LAB_PLACEMENTS))),
  obstaclesSameAsTable: JSON.stringify(navData.labNavObstacles()) === JSON.stringify(navData.labNavObstacles(placements.LAB_PLACEMENTS)),
  graphNodes: graph.nodes.length,
  minNodes: ids.length + navData.LAB_NAV_POINTS.length,
  path: nav.findPath(at('holotable'), at('window'))?.length ?? 0,
  assetBase: host.townOptions().assetBase,
}))
`

describe('例のアプリの下ごしらえ: kanon-lab の表を渡さなくても、地図のデータの口が既定の値で動く', () => {
  test('立ち寄り先は地図の表 TOWN_PLACES、ラボのアンカーと障害物は既定の置き場所の表、通り道のグラフは既定の点と障害物で作れて道が引ける', () => {
    const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
    expect(r.exitCode).toBe(0)
    const v = JSON.parse(r.stdout.toString().trim().split('\n').pop()!) as Record<string, unknown>
    expect(v.placesSame).toBe(true)
    // kanon-lab の stage（配信の立ち位置）は地図の表に無い
    expect(v.hasStage).toBe(false)
    expect(v.placeCount).toBe(42)
    expect(v.anchorNames as number).toBeGreaterThan(0)
    expect(v.anchorsSameAsTable).toBe(true)
    expect(v.obstaclesSameAsTable).toBe(true)
    expect(v.graphNodes as number).toBeGreaterThanOrEqual(v.minNodes as number)
    expect(v.path as number).toBeGreaterThan(1)
    // アセットの置き場の既定は根（configureTown の前に読むと注意を 1 回出す）
    expect(v.assetBase).toBe('/')
  })
})
