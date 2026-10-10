// 町の歩く道のグラフ（アセットの根の town/walk.json）の確かめ。bun で動かす（先に sync-town で書き出す）。
// 使い方: bun tools/check-walk.mjs --assets <アセットの根> [--root <根>]（使う側（kanon-lab）は pnpm check:walk で --root・--assets を渡す）
//   1. 道順 A〜G の区間の長さと時間を、町の地図データの計算（report.json の routes。core/routes.ts の ref）と ±5% で比べる
//   2. ゾーンの出入口・町の行き先のすべての組で、歩く道（ケーブルなし）が見つかるか
//   3. 道の中心線に建物がかかる所（sync で数えた数と例。駅舎・門の中へ入る道など、地図データの建物だけのはず）と、
//      道の面（中心線と幅）にかかる街区の自動の建物（0 のはず。§7 の 169）
// 地図の経路探索（core/walk/townNav.ts）と道順（core/routes.ts）をそのまま使う。だめな所があれば終了コード 1
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TOWN_DATA } from '../core/town.ts'
import { TownNav } from '../core/walk/townNav.ts'
import { TRAVEL_ROUTES, WAYPOINTS } from '../core/routes.ts'
import { TRAVEL_PLACES, ZONE_PORTALS } from '../core/travel.ts'
import { toolArgs } from './args.mjs'

const { values, at } = toolArgs('check:walk', 'bun tools/check-walk.mjs --assets <アセットの根> [--root <根>]', { assets: { type: 'string' } }, ['assets'])
const walkPath = resolve(at(values.assets), TOWN_DATA.dir, 'walk.json')
let data
try {
  data = JSON.parse(readFileSync(walkPath, 'utf8'))
} catch {
  console.error(`[check:walk] ${walkPath} がありません。先に sync-town（pnpm sync:town）で書き出してください`)
  process.exit(1)
}
const nav = new TownNav(data)
const TOL = 0.05
let bad = 0
const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0)

const target = (w) => ('station' in w ? nav.station(w.station).street : 'plaza' in w ? { nodes: nav.plazaNodes(w.plaza) } : w.at)

console.log('1. 道順 A〜G（区間ごと。ref = 町の地図データの計算）')
console.log('   区間    分（ref）            長さ m（ref）           通る道')
for (const r of Object.values(TRAVEL_ROUTES)) {
  let cur = null
  let sumMin = 0
  let sumLen = 0
  for (const leg of r.legs) {
    let res
    if (leg.mode === 'cable') res = nav.route(nav.station(WAYPOINTS[leg.from].station).street, nav.station(WAYPOINTS[leg.to].station).street, { cable: true })
    else if (leg.mode === 'tram') res = { minutes: leg.minutes ?? 0, length: 0, steps: [], endNode: null }
    else res = nav.route(cur ?? target(WAYPOINTS[leg.from]), target(WAYPOINTS[leg.to]))
    if (!res) {
      console.log(`   ${leg.id.padEnd(6)} 道が見つかりません`)
      bad++
      cur = null
      continue
    }
    cur = res.endNode ?? null
    sumMin += res.minutes
    sumLen += res.length
    const ref = leg.ref
    const dm = ref ? pct(res.minutes, ref.minutes) : null
    const dl = ref && ref.length ? pct(res.length, ref.length) : null
    const ng = (dm !== null && Math.abs(dm) > TOL * 100) || (dl !== null && Math.abs(dl) > TOL * 100)
    if (ng) bad++
    const f = (v, w) => (v === null ? '—'.padStart(w) : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`.padStart(w))
    console.log(`   ${leg.id.padEnd(6)} ${res.minutes.toFixed(2).padStart(6)}（${ref ? ref.minutes.toFixed(2) : '  —  '}）${f(dm, 7)}  ${res.length.toFixed(1).padStart(7)}（${ref && ref.length ? ref.length.toFixed(1) : '  —  '}）${f(dl, 7)}  ${ng ? 'NG ' : ''}${leg.mode === 'tram' ? `（緑電 ${leg.line} 系統に乗る。本文の「乗って約7分」）` : nav.namesOn(res).join('→')}`)
  }
  console.log(`   ${r.id} 全体: ${sumMin.toFixed(1)} 分・${Math.round(sumLen)} m（本文 約 ${r.bookMinutes} 分。${r.label}）`)
}

console.log('\n2. 出入口・町の行き先のすべての組（歩く道。ケーブルなし）')
const points = {}
for (const [zone, list] of Object.entries(ZONE_PORTALS)) for (const p of list) points[`${zone}:${p.id}`] = p.town
for (const [id, p] of Object.entries(TRAVEL_PLACES)) points[id] = p.at
let pairs = 0
let found = 0
const names = Object.keys(points)
for (const a of names)
  for (const b of names) {
    if (a === b) continue
    pairs++
    const r = nav.route(points[a], points[b])
    if (r) found++
    else {
      console.log(`   ${a} → ${b}: 道が見つかりません`)
      bad++
    }
  }
console.log(`   ${found} / ${pairs} 組で見つかりました`)

console.log('\n3. 道の中心線にかかる建物・道の面にかかる自動の建物（pnpm sync:town の検算）')
const chk = data.check ?? { buildingsOnRoads: null, examples: [] }
console.log(`   中心線にかかる建物 ${chk.buildingsOnRoads ?? '?'} か所（地図データの建物。駅舎・門の中へ入る道）`)
for (const e of chk.examples ?? []) {
  console.log(`   - ${e.name ?? e.feat}（${e.feat}）: (${e.at.join(', ')})${e.auto ? ' NG 自動の建物' : ''}`)
  if (e.auto) bad++
}
console.log(`   道の面にかかる自動の建物 ${chk.autoOnRoads ?? '?'} 棟`)
for (const e of chk.autoExamples ?? []) console.log(`   - NG ${e.id}: ${e.name ?? e.feat}（${e.feat}）(${e.at.join(', ')})`)
if (chk.autoOnRoads === undefined) {
  console.log('   NG 検算の数がありません（pnpm sync:town をやり直してください）')
  bad++
} else bad += chk.autoOnRoads

console.log(bad ? `\n[check:walk] だめな所が ${bad} 件あります` : '\n[check:walk] すべて合っています')
process.exit(bad ? 1 : 0)
