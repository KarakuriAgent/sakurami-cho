/**
 * 緑電の停留所のホーム（world/outdoor/transit/trams.ts の setupTramNet・placeTramPlatforms・tramPlatformGrade、形は transitInfra.ts）:
 *
 * - ホームの面（歩ける面）は、向かいの線路の標高 + 0.3m に沿う（車両の床と同じ高さ。前は真ん中の線路の高さで平らにしていたので、
 *   坂の停留所では端で線路と 1m 余り食い違った）。両端のスロープの下の端は線路の高さ
 * - ホームの面の下に地形が出ない（上の平らな所は面の 4cm 下より下）。ホームと線路の間（線の中心まで）の地形は線路より上に出ない。
 *   前は坂の停留所（楓坂二丁目・楓坂中・楓坂上・見晴らし台口・丘ノ上貝塚・丘ノ上など）で、山の側のホームが土手に 1〜2m 埋まっていた
 * - 地形を下げても線路の高さは変わらない（線路の高さは地形から決めるので、下げたあとに作り直しても同じ）
 *
 * 町の地図データ（地形の高さ・道・交通）を読む。ほかのテストの表が混ざらないよう、まっさらな bun のプロセスで確かめる
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

const PROBE = `
const P = ${JSON.stringify(PKG)}
console.info = () => undefined
console.warn = () => undefined
const fs = await import('node:fs')
const { townWalk } = await import(P + '/world/walk/townWalk.ts')
const { townData, HeightLayer } = await import(P + '/world/outdoor/town/townData.ts')
const { parseContainer, gunzip } = await import(P + '/world/outdoor/town/container.ts')
const { site } = await import(P + '/world/outdoor/site/siteModel.ts')
const { terrainHeight } = await import(P + '/world/outdoor/town/terrain.ts')
const { SITE } = await import(P + '/core/town.ts')
const TR = await import(P + '/world/outdoor/transit/trams.ts')
const read = (f) => JSON.parse(fs.readFileSync(P + '/assets/town/' + f, 'utf8'))
const bin = async (f) => {
  const b = fs.readFileSync(P + '/assets/town/' + f)
  return parseContainer(await gunzip(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
}
const infra = read('infra.json')
townWalk.init(read('walk.json'), infra)
townData.center = new HeightLayer(await bin('terrain/center.bin'))
townData.overview = new HeightLayer(await bin('terrain/overview.bin'))
townData.infra = infra
site.build()
const lines = TR.setupTramNet(infra.transit)
const PL = TR.TRAM_PLATFORM
const REACH = TR.TRAM_PLATFORM_REACH
const LAB = SITE.labFloorElevation
const pp = { x: 0, y: 0, z: 0, dx: 1, dy: 0, grade: 0 }
const out = { stops: [], rebuilt: 0 }
const all = TR.tramNet.stops.flatMap((st) => st.platforms)
const inside = (x, y) => all.filter((q) => Math.abs((x - q.x) * q.dx + (y - q.y) * q.dy) <= REACH && Math.abs(-(x - q.x) * q.dy + (y - q.y) * q.dx) <= PL.width / 2).length
// どの系統でも、いちばん近い線の上の点の標高と距離（segs = ホームのまわりの線の細かい区間）
const nearRails = (cx, cy) => {
  const segs = []
  for (const l of lines) {
    const p = l.path
    for (let i = 1; i < p.s.length; i++) if (Math.hypot(p.x[i] - cx, p.y[i] - cy) < 45) segs.push([p.x[i - 1], p.y[i - 1], p.z[i - 1], p.x[i], p.y[i], p.z[i]])
  }
  return segs
}
const nearest = (segs, x, y) => {
  let best = Infinity
  let z = 0
  for (const [ax, ay, az, bx, by, bz] of segs) {
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
    const e = Math.hypot(ax + dx * t - x, ay + dy * t - y)
    if (e < best) {
      best = e
      z = az + (bz - az) * t
    }
  }
  return { z, dist: best }
}
for (const st of TR.tramNet.stops) {
  for (const [k, pf] of st.platforms.entries()) {
    // 沿う系統の線と、ホームの真ん中の向かいの線の上の長さ
    const line = lines.find((l) => l.data.no === pf.no)
    const d0 = pf.d
    const nx = -pf.dy * pf.side
    const ny = pf.dx * pf.side
    const at = (a, b) => [pf.x + pf.dx * a + nx * b, pf.y + pf.dy * a + ny * b]
    const segs = nearRails(pf.x, pf.y)
    let floor = 0
    let walk = 0
    let buried = -Infinity
    let track = -Infinity
    let onRail = 0
    for (let a = -REACH; a <= REACH + 1e-9; a += 0.5) {
      const top = TR.tramPlatformTop(pf, a)
      const z = line.path.at(d0 + a, pp).z
      if (Math.abs(a) <= PL.length / 2) floor = Math.max(floor, Math.abs(top - (z + PL.height)))
      if (Math.abs(a) >= REACH - 1e-9) floor = Math.max(floor, Math.abs(top - z))
      // 歩ける面（足元の高さ。面の少し上から拾う。スロープの下の端の外は地面。ほかのホームと重なる所は見ない）
      const [wx, wy] = at(a, 0)
      if (Math.abs(a) < REACH - 0.1 && inside(wx, wy) === 1) walk = Math.max(walk, Math.abs(townWalk.groundY(wx, -wy, top - LAB + 0.2) + LAB - top))
      // ホームの下: 上の平らな所は面の 4cm 下より下、スロープは面より下。線路（線の中心から 2.65m）にかかる所は、地形を線路の標高に残すので見ない
      // （曲がりの停留所で、まっすぐのホームの端が線路に寄る所）
      for (let b = -PL.width / 2 + 0.05; b <= PL.width / 2 - 0.05 + 1e-9; b += 0.25) {
        const [x, y] = at(a, b)
        if (nearest(segs, x, y).dist <= 2.65) {
          onRail++
          continue
        }
        buried = Math.max(buried, terrainHeight(x, y) - top - (Math.abs(a) <= PL.length / 2 ? 0 : 0.04))
      }
      // ホームと線路の間（ホームの内の縁から線の中心まで。ホームの向きの横）の地形と、いちばん近い線路の標高
      if (Math.abs(a) <= PL.length / 2)
        for (let b = -pf.toTrack; b < -PL.width / 2 - 0.05; b += 0.25) {
          const [x, y] = at(a, b)
          track = Math.max(track, terrainHeight(x, y) - nearest(segs, x, y).z)
        }
    }
    out.stops.push({ id: st.name + '#' + k, floor, walk, buried, track, onRail })
  }
}
// 地形を下げたあとに線路を作り直しても、線路の高さは同じ
const again = TR.buildTramLines(infra.transit.trams)
for (const [i, l] of again.entries()) for (let j = 0; j < l.path.z.length; j++) out.rebuilt = Math.max(out.rebuilt, Math.abs(l.path.z[j] - lines[i].path.z[j]))
out.count = [infra.transit.tramStops.length, TR.tramNet.stops.length, TR.tramNet.stops.reduce((n, s) => n + s.platforms.length, 0)]
console.log(JSON.stringify(out))
`

interface Row {
  id: string
  floor: number
  walk: number
  buried: number
  track: number
  onRail: number
}

describe('緑電の停留所のホーム（world/outdoor/transit/trams.ts）', () => {
  const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
  const v = (r.exitCode === 0 ? JSON.parse(r.stdout.toString().trim().split('\n').pop()!) : {}) as { stops: Row[]; rebuilt: number; count: number[] }

  test('まっさらなプロセスで動く', () => {
    expect(r.stderr.toString()).not.toMatch(/Error/)
    expect(r.exitCode).toBe(0)
    expect(v.stops.length).toBe(v.count[2])
    expect(v.stops.length).toBeGreaterThan(0)
  })

  test('ホームの面は向かいの線路 + 0.3m に沿い（スロープの下の端は線路の高さ）、歩ける面もそれと同じ', () => {
    expect(v.stops.filter((s) => s.floor > 0.005).map((s) => `${s.id} ${s.floor.toFixed(3)}`)).toEqual([])
    expect(v.stops.filter((s) => s.walk > 0.005).map((s) => `${s.id} ${s.walk.toFixed(3)}`)).toEqual([])
  })

  test('ホームの面の下に地形が出ない（上の平らな所は面の 4cm 下より下、スロープは面より下）。ホームと線路の間の地形は線路より上に出ない', () => {
    expect(v.stops.filter((s) => s.buried > -0.04).map((s) => `${s.id} ${s.buried.toFixed(3)}`)).toEqual([])
    expect(v.stops.filter((s) => s.track > 0.005).map((s) => `${s.id} ${s.track.toFixed(3)}`)).toEqual([])
  })

  test('地形を下げたあとに線路を作り直しても、線路の高さは変わらない', () => {
    expect(v.rebuilt).toBeLessThan(1e-6)
  })
})
