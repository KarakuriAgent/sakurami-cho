/**
 * 名前のある建物の型の割り当て（world/outdoor/named/kits/index.ts の ASSIGN）と、書き出した町の地図データ（assets/town/named.json）の突き合わせ（8-5d）。
 * 町の地図データの id が替わったのに割り当ての表を直し忘れると、その建物は専用の型でなく generic で作られる（8-5d の町の名前の変更で、駅舎・北口駅舎・
 * ホテル・計測の id が替わった）。DOM なし（表を読むだけで、型は組み立てない）。
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ASSIGN, KITS } from '../world/outdoor/named/kits/index'

const named = JSON.parse(readFileSync(join(import.meta.dir, '..', 'assets', 'town', 'named.json'), 'utf8')) as { buildings: { id: string; drawn: boolean }[] }

describe('名前のある建物の型の割り当て（8-5d）', () => {
  test('割り当ての表の id は、どれも町の地図データの描く建物にあり、型の名前は KITS にある', () => {
    const drawn = new Set(named.buildings.filter((b) => b.drawn).map((b) => b.id))
    expect(Object.keys(ASSIGN).length).toBeGreaterThan(0)
    expect(Object.keys(ASSIGN).filter((id) => !drawn.has(id))).toEqual([])
    expect(Object.entries(ASSIGN).filter(([, kit]) => !KITS[kit]).map(([id]) => id)).toEqual([])
  })
})
