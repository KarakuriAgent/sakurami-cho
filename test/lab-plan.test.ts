/**
 * ラボの間取りのデータの側（core/lab/plan.ts・placements.ts・anchors.ts・navData.ts・kits/*.plan.ts。docs/design/map-split.md §6 の 4-1）の見張り:
 *   - データの側は three・React・使う側を import しない（読めるのは core/lab/ の中と、設定資料の間取り core/labPlan だけ）
 *   - 地図の既定の表のアンカーの値（基地局の投影元・作業の見出し）が前の値と最後の桁まで同じ
 *   - 置き場所の表から外した什器は、障害物もアンカーも無くなる。障害物の並び（labNavObstacles）はキットの plan と殻の障害物の今の並び
 *   - 展示棚の段の数: 地図の既定は GALLERY_SHELVES。表の opts で段の数を変えても障害物は同じ（4-10）
 *   - ラボの外のアンカー（registerLabAnchor。4-12）
 * kanon-lab の表（config/layout.ts・world/places.ts など）との突き合わせは、kanon-lab の server/test/lab-plan.test.ts（8-4 で分けた）
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const LAB = 'core/lab'

type V3 = [number, number, number]
interface Anchor {
  name: string
  p: V3
  yaw: number
  at?: { position: V3; rotationY: number }
  local?: { p: V3; yaw: number }
}
interface Placement {
  id: string
  kit: string
  at: { position: V3; rotationY: number }
  opts?: object
}
interface AnchorsMod {
  registerLabAnchor(name: string, at: { position: V3; rotationY: number }): () => void
  labAnchor(name: string, placements?: readonly Placement[]): Anchor
  findLabAnchor(name: string, placements?: readonly Placement[]): Anchor | undefined
  labAnchorNames(placements?: readonly Placement[]): string[]
}
interface PlacementsMod {
  LAB_PLACEMENTS: readonly Placement[]
  labObstacles(id: string, placements?: readonly Placement[]): readonly { name: string }[]
}
interface NavDataMod {
  LAB_NAV_POINTS: [number, number][]
  labNavObstacles(placements?: readonly Placement[]): { name: string }[]
}

const load = async <T>(path: string): Promise<T> => (await import(path)) as T

/** データの側のファイル（パッケージの根からのパス） */
function dataFiles(): string[] {
  const kits = readdirSync(join(ROOT, LAB, 'kits'))
    .filter((f) => f.endsWith('.plan.ts') || f === 'plans.ts')
    .map((f) => `${LAB}/kits/${f}`)
  return [`${LAB}/plan.ts`, `${LAB}/placements.ts`, `${LAB}/anchors.ts`, `${LAB}/navData.ts`, ...kits].sort()
}

describe('ラボの間取りのデータ（段 4 の 4-1）', () => {
  test('データの側は three・React・使う側を import しない', () => {
    const files = dataFiles()
    expect(files.length).toBeGreaterThan(10)
    const bad: string[] = []
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), 'utf8')
      for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^'"`;]*?from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!
        const t = spec.startsWith('.') ? posix.normalize(posix.join(dirname(f), spec)) : spec
        if (!(t.startsWith(`${LAB}/`) || t === 'core/labPlan')) bad.push(`${f} -> ${t}`)
      }
    }
    expect(bad).toEqual([])
  })

  test('地図の既定の表のアンカー: 基地局の投影元と作業の見出しが前の値と同じ（最後の桁まで）', async () => {
    const { labAnchor } = await load<AnchorsMod>(`../${LAB}/anchors.ts`)
    // ON AIR の投影元はアンカー baseStation.pollux.top から出す（4-12）。前の手で書いた数と同じ
    expect(labAnchor('baseStation.pollux.top').p).toEqual([2.0, 2.62, -0.8])
    // 作業の見出し: デスクの群 → モニタの群（x 0.3）→ [0, DESK_H + 1.5, 0.95]・向き 0.3 を、置き場所の中のローカル 1 段で持つ（4-0 で行列が同じと確かめた形）
    expect(labAnchor('devDesk.taskSign').local).toEqual({ p: [0.3, 0.74 + 1.5, 0.95], yaw: 0.3 })
  })

  test('展示棚の段の数: 地図の既定は GALLERY_SHELVES。表の opts で段の数を変えても障害物は同じ（4-10）', async () => {
    const { labAnchorNames } = await load<AnchorsMod>(`../${LAB}/anchors.ts`)
    const { LAB_PLACEMENTS, labObstacles } = await load<PlacementsMod>(`../${LAB}/placements.ts`)
    const { GALLERY_SHELVES } = await load<{ GALLERY_SHELVES: number }>(`../${LAB}/kits/gallery.plan.ts`)
    const shelvesOf = (table?: readonly Placement[]) => labAnchorNames(table).filter((n) => n.startsWith('gallery.shelf.')).length
    expect(shelvesOf()).toBe(GALLERY_SHELVES)
    // 段の数を変えても、障害物は同じ
    const eight = LAB_PLACEMENTS.map((p) => (p.id === 'gallery' ? { ...p, opts: { shelves: 8 } } : p))
    expect(shelvesOf(eight)).toBe(8)
    expect(labObstacles('gallery', eight)).toEqual(labObstacles('gallery'))
  })

  test('障害物は、キットの plan と殻の障害物の今の並び。表から外した什器は障害物もアンカーも無い', async () => {
    const { LAB_PLACEMENTS, labObstacles } = await load<PlacementsMod>(`../${LAB}/placements.ts`)
    const { findLabAnchor } = await load<AnchorsMod>(`../${LAB}/anchors.ts`)
    const N = await load<NavDataMod>(`../${LAB}/navData.ts`)
    const OBSTACLES = N.labNavObstacles()
    expect(OBSTACLES.map((o) => o.name)).toEqual([
      '基地局',
      '危険線の内側',
      'KB-001 のドック',
      'ホロテーブル',
      '作業台',
      '3D プリンタ',
      'ロボットアームの作業範囲',
      'CNC・パーツケース',
      '中二階への階段',
      'サーバラック',
      'ギャラリー',
      '開発デスク（長辺）',
      '開発デスク（短辺）',
      '椅子',
      '観葉植物',
      '観葉植物',
      '観葉植物',
      '観葉植物',
    ])
    const without = LAB_PLACEMENTS.filter((p) => p.id !== 'gallery')
    expect(labObstacles('gallery', without)).toEqual([])
    expect(N.labNavObstacles(without).map((o) => o.name)).toEqual(OBSTACLES.map((o) => o.name).filter((n) => n !== 'ギャラリー'))
    expect(findLabAnchor('gallery.shelf.1', without)).toBeUndefined()
    expect(findLabAnchor('gallery', without)).toBeUndefined()
    expect(findLabAnchor('devDesk.desk.a', without)).toBeDefined()
  })

  test('ラボの外のアンカー（4-12）: 表の名前を隠さず、外す関数で外れる。名前の一覧には入らない', async () => {
    const { registerLabAnchor, findLabAnchor, labAnchor, labAnchorNames } = await load<AnchorsMod>(`../${LAB}/anchors.ts`)
    const { LAB_PLACEMENTS } = await load<PlacementsMod>(`../${LAB}/placements.ts`)
    const names = labAnchorNames()
    const at = { position: [1, 0, 2] as V3, rotationY: 0.5 }
    const off = registerLabAnchor('test.outside', at)
    expect(labAnchor('test.outside')).toEqual({ name: 'test.outside', p: [1, 0, 2], yaw: 0.5, at, local: { p: [0, 0, 0], yaw: 0 } })
    // 表を変えても引ける。引くたびに新しい配列（使う側が書き換えても登録の値は変わらない）
    expect(findLabAnchor('test.outside', LAB_PLACEMENTS.filter((p) => p.id !== 'gallery'))?.p).toEqual([1, 0, 2])
    expect(labAnchor('test.outside').p).not.toBe(labAnchor('test.outside').p)
    // 表の置き場所の id で始まる名前は表の方を引く（ラボの外のアンカーは表の名前を隠さない）
    const offShadow = registerLabAnchor('gallery.shelf.99', at)
    const offOrigin = registerLabAnchor('devDesk', at)
    expect(findLabAnchor('gallery.shelf.99')).toBeUndefined()
    expect(labAnchor('devDesk').p).toEqual([...LAB_PLACEMENTS.find((p) => p.id === 'devDesk')!.at.position])
    expect(labAnchorNames()).toEqual(names)
    off()
    offShadow()
    offOrigin()
    expect(findLabAnchor('test.outside')).toBeUndefined()
    // 差し替えたあとで前の登録の外す関数を呼んでも、新しい登録は外れない
    const at2 = { position: [3, 0, 4] as V3, rotationY: 0 }
    const offA = registerLabAnchor('test.replace', at)
    const offB = registerLabAnchor('test.replace', at2)
    offA()
    expect(labAnchor('test.replace').p).toEqual([3, 0, 4])
    offB()
    expect(findLabAnchor('test.replace')).toBeUndefined()
  })
})
