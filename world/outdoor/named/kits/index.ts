import type { TownInfra } from '../../town/townData'
import { Kit } from '../kit'
import type { NamedRecord } from '../namedData'
import { generic } from './common'
import { brickShop, machiya, merchantHouse, islandStone, onodera, seizu, sento, stoneShop, teahouse } from './shops'
import { cableStation } from './cableStation'
import { cafePlatform, smallStation, station, stationHall } from './station'
import { houseJp, hut, kominka, schoolWood, thompson, yokan } from './houses'
import { church, shrine, temple } from './religious'
import { gardenDome, observatory } from './observatory'
import { akarenga, archShop, brickFactory, factory, glassWorks, stoneWorkshop } from './industrial'
import { brickBlock, cityHall, curvedHotel, glassLab, gym, harborTower, modern, pavilion, roundLibrary, school, stoneBlock, terminal } from './blocks'
import { soranowaNoriba } from './soranowa'

/**
 * 名前のある建物ごとに、組み立ての型を選んで形を作る（近くの形と遠くの形の両方）。
 * 型と建物の割り当ては ASSIGN（id）と、無ければ種類・用途・外壁・屋根の言葉から（assignKit）。型の一覧は docs/design/town.md の §12
 */

export interface KitContext {
  infra: TownInfra
  /** 地面の標高（平面座標） */
  heightAt: (x: number, y: number) => number
}

export type KitFn = (k: Kit, ctx: KitContext) => void

const AKARI = { look: 'akari' as const }
const KAEDE = { look: 'kaede' as const }

/** 型の名前 → 作る関数 */
export const KITS: Record<string, KitFn> = {
  generic: (k) => {
    generic(k)
  },
  // 町家の店（灯町）
  'machiya:nejimaki': (k) => machiya(k, { ...AKARI, round: { text: 'ネジマキ', fg: '#2a1d14', bg: '#d9c7a4', border: '#3a2a1e', icon: 'cup', finish: 'wood' }, front: ['pots', 'bench'], door: 'glass' }),
  'machiya:yotaka': (k) => machiya(k, { ...AKARI, blade: { text: '古時計 夜鷹', fg: '#e9d9b0', bg: '#2a1f17', vertical: true, font: 'serif', finish: 'wood' }, front: ['barrel', 'pots'], door: 'lattice' }),
  'machiya:automata': (k) => machiya(k, { ...AKARI, blade: { text: 'オートマタ研究所', fg: '#e9d9b0', bg: '#3a2a1e', vertical: true, font: 'serif' }, door: 'glass' }),
  'machiya:izakaya': (k) => machiya(k, { ...AKARI, noren: { text: 'ちょうちん', fg: '#ffffff', bg: '#7a1f1a', font: 'serif' }, lanterns: '#d63b2a', door: 'lattice', front: ['barrel'] }),
  'machiya:shiosai': (k) => machiya(k, { ...AKARI, noren: { text: 'しおさい', fg: '#ffffff', bg: '#1f3f6a', font: 'serif' }, lanterns: '#f2ead8', door: 'lattice', front: ['pots'] }),
  'machiya:toroudo': (k) => machiya(k, { ...AKARI, blade: { text: '古書 灯籠堂', fg: '#e9d9b0', bg: '#2a1f17', vertical: true, font: 'serif', finish: 'wood' }, door: 'sliding', front: ['pots'] }),
  'machiya:kai': (k) => machiya(k, { ...AKARI, sign: { text: '刻の会 会所', sub: '時計・計器職人組合 1925', fg: '#f3e6c8', bg: '#2a1f17', border: '#a8874a', font: 'serif', finish: 'wood' }, door: 'lattice', front: [] }),
  // 町家の店（楓坂の白い板張り）
  'machiya:yaoya': (k) => machiya(k, { ...KAEDE, awning: { color: '#2f6b3a', stripes: 8 }, front: ['produce'], door: 'glass' }),
  'machiya:pan': (k) => machiya(k, { ...KAEDE, awning: { color: '#7a4a2a', stripes: 0 }, round: { text: 'さかのうえ', fg: '#5a3a1e', bg: '#efe0c0', border: '#7a4a2a', icon: 'bread' }, front: ['pots'], door: 'glass' }),
  'machiya:post': (k) => machiya(k, { ...KAEDE, sign: { text: '〒 楓坂郵便局', fg: '#ffffff', bg: '#c0281f', font: 'sans', bold: true }, front: ['post'], door: 'glass' }),
  'machiya:dagashi': (k) => machiya(k, { ...KAEDE, awning: { color: '#b5302a', stripes: 8 }, front: ['pots', 'bench'], door: 'sliding' }),
  'machiya:hidamari': (k) => machiya(k, { ...KAEDE, round: { text: 'ひだまり', fg: '#4a3020', bg: '#f2e6c8', border: '#4a3020', icon: 'cup' }, front: ['pots', 'bench'], door: 'glass' }),
  onodera: (k) => onodera(k),
  seizu: (k) => seizu(k),
  'brickShop:teishajo': (k) => brickShop(k, 'teishajo'),
  'brickShop:harbor': (k) => brickShop(k, 'harbor'),
  'brickShop:gakuen': (k) => brickShop(k, 'gakuen'),
  'stoneShop:canal': (k) => stoneShop(k, 'canal'),
  'stoneShop:bunko': (k) => stoneShop(k, 'bunko'),
  merchantHouse: (k) => merchantHouse(k),
  islandStone: (k) => islandStone(k),
  sento: (k) => sento(k),
  teahouse: (k) => teahouse(k),
  station: (k) => station(k),
  cafePlatform: (k) => cafePlatform(k),
  stationHall: (k) => stationHall(k),
  smallStation: (k) => smallStation(k),
  cableStation: (k, ctx) => cableStation(k, ctx),
  thompson: (k, ctx) => thompson(k, ctx.heightAt),
  houseJp: (k) => houseJp(k),
  yokan: (k) => yokan(k),
  hut: (k) => hut(k),
  kominka: (k) => kominka(k),
  schoolWood: (k) => schoolWood(k),
  shrine: (k) => shrine(k),
  temple: (k) => temple(k),
  church: (k) => church(k),
  observatory: (k) => observatory(k),
  gardenDome: (k, ctx) => gardenDome(k, ctx),
  akarenga: (k) => akarenga(k),
  brickFactory: (k) => brickFactory(k),
  stoneWorkshop: (k) => stoneWorkshop(k),
  factory: (k) => factory(k),
  glassWorks: (k) => glassWorks(k),
  archShop: (k, ctx) => archShop(k, ctx),
  stoneBlock: (k) => stoneBlock(k),
  cityHall: (k) => cityHall(k),
  brickBlock: (k) => brickBlock(k),
  'modern:glass': (k) => modern(k, 'glass'),
  'modern:stoneGrid': (k) => modern(k, 'stoneGrid'),
  'modern:brickTeal': (k) => modern(k, 'brickTeal'),
  'modern:store': (k) => modern(k, 'store'),
  'modern:hotel': (k) => modern(k, 'hotel'),
  'modern:hospital': (k) => modern(k, 'hospital'),
  'modern:department': (k) => modern(k, 'department'),
  'school:white': (k) => school(k, 'white'),
  'school:brick': (k) => school(k, 'brick'),
  'school:brickTeal': (k) => school(k, 'brickTeal'),
  'school:dorm': (k) => school(k, 'dorm'),
  gym: (k) => gym(k),
  glassLab: (k) => glassLab(k),
  roundLibrary: (k) => roundLibrary(k),
  terminal: (k) => terminal(k),
  pavilion: (k) => pavilion(k),
  soranowaNoriba: (k) => soranowaNoriba(k),
  harborTower: (k) => harborTower(k),
  curvedHotel: (k) => curvedHotel(k),
}

/** id → 型の名前 */
export const ASSIGN: Record<string, string> = {
  'building.akarimachi.kissa-nejimaki': 'machiya:nejimaki',
  'building.akarimachi.yotaka': 'machiya:yotaka',
  'building.akarimachi.automata-kenkyusho': 'machiya:automata',
  'building.akarimachi.izakaya-chochin': 'machiya:izakaya',
  'building.akarimachi.shiosai': 'machiya:shiosai',
  'building.akarimachi.toroudo': 'machiya:toroudo',
  'building.akarimachi.toki-no-kai': 'machiya:kai',
  'building.kaedezaka.yaoya-kaede': 'machiya:yaoya',
  'building.kaedezaka.pan-sakanoue': 'machiya:pan',
  'building.kaedezaka.yubinkyoku': 'machiya:post',
  'building.kaedezaka.dagashi-momijiya': 'machiya:dagashi',
  'building.kaedezaka.kissa-hidamari': 'machiya:hidamari',
  'building.akarimachi.onodera-tokeiten': 'onodera',
  'building.akarimachi.seizu-coffee': 'seizu',
  'building.ekimae.kitchen-kiteki': 'brickShop:teishajo',
  'building.ekimae.parts-shuchakueki': 'brickShop:teishajo',
  'building.ekimae.hanaya-gasutou': 'brickShop:teishajo',
  'building.shiomiko.shiomi-shokudo': 'brickShop:harbor',
  'building.shiomiko.shiomi-marine': 'brickShop:harbor',
  'building.gakuen.teishoku-kousen': 'brickShop:gakuen',
  'building.gakuen.lab-supply': 'brickShop:gakuen',
  'building.gakuen.layer': 'brickShop:gakuen',
  'building.gakuen.logbook': 'brickShop:gakuen',
  'building.gakuen.koubo-lab': 'brickShop:gakuen',
  'building.gakuen.kanegaoka-shobo': 'brickShop:gakuen',
  'building.unga.yanagi-no-shita': 'stoneShop:canal',
  'building.unga.minamo-bistro': 'stoneShop:canal',
  'building.unga.palette': 'stoneShop:canal',
  'building.unga.furugi-suiro': 'stoneShop:canal',
  'building.unga.high-step': 'stoneShop:canal',
  'building.unga.hotarubi': 'stoneShop:canal',
  'building.unga.shiraishi': 'stoneShop:canal',
  'building.chuo.enkan-shorin': 'stoneShop:bunko',
  'building.chuo.hotarudo': 'stoneShop:bunko',
  'building.chuo.hirakido': 'stoneShop:bunko',
  'building.chuo.marunomori-bakery': 'stoneShop:bunko',
  'building.shiomiko.ikari': 'merchantHouse',
  'building.shiomijima.taisokusho': 'islandStone',
  'building.shiomijima.tomoshibi': 'islandStone',
  'building.akarimachi.akari-no-yu': 'sento',
  'building.sakuragioka.miharashi-chaya': 'teahouse',
  'building.ekimae.sakurami-station': 'station',
  'building.ekimae.cafe-platform-1872': 'cafePlatform',
  'building.ekimae.sakurami-station-kitaguchi': 'stationHall',
  'building.gakuen.kanegaoka-station': 'smallStation',
  'building.sakuragioka.cable-summit': 'cableStation',
  'building.kaedezaka.cable-kaedezaka': 'cableStation',
  'building.chuo.cable-fumoto': 'cableStation',
  'building.kaedezaka.thompson': 'thompson',
  'building.kaedezaka.kiryu-tae': 'houseJp',
  'building.ekimae.kyu-kansha-1': 'yokan',
  'building.ekimae.tetsurosou': 'yokan',
  'building.ekimae.kyu-kansha-3': 'yokan',
  'building.chuo.youhou-lab': 'hut',
  'building.chuo.doujou-kansokusho': 'hut',
  'building.chuo.kanri-jimusho': 'hut',
  'building.chuo.donguri-sha': 'hut',
  'building.sakuragioka.kitadani-chokubaisho': 'hut',
  'building.sakuragioka.satoyama-kenkyukai': 'kominka',
  'building.sakuragioka.okanoue-chugakko': 'schoolWood',
  'building.akarimachi.akarimachi-inari': 'shrine',
  'building.shiomiko.myojinsha': 'shrine',
  'building.shiomijima.himori-jinja': 'shrine',
  'building.shiomijima.okumiya': 'shrine',
  'building.gakuen.kanegaoka-tera': 'temple',
  'building.unga.daiseido': 'church',
  'building.sakuragioka.observatory': 'observatory',
  'building.chuo.garden-dome': 'gardenDome',
  'building.shiomiko.akarenga-1': 'akarenga',
  'building.shiomiko.akarenga-2': 'akarenga',
  'building.shiomiko.akarenga-3': 'akarenga',
  'building.shiomiko.akarenga-4': 'akarenga',
  'building.gakuen.akarenga-kan': 'brickFactory',
  'building.unga.geidai': 'brickFactory',
  'building.unga.seibi-koubou': 'stoneWorkshop',
  'building.unga.uoichi': 'stoneWorkshop',
  'building.shiomiko.butsuryu-robo': 'factory',
  'building.shiomiko.zousen-koubou': 'factory',
  'building.shiomijima.shiokaze-hatsudensho': 'factory',
  'building.gakuen.hiraki-kousakutou': 'glassWorks',
  'building.ekimae.arch-03-nejito-haguruma': 'archShop',
  'building.ekimae.arch-05-kisha-poppo': 'archShop',
  'building.akarimachi.arch-08-shinkukan-tomoshibi': 'archShop',
  'building.akarimachi.arch-12-junkdo': 'archShop',
  'building.akarimachi.arch-15-tekkyoshita-robo': 'archShop',
  'building.akarimachi.arch-17-handaya-goro': 'archShop',
  'building.akarimachi.arch-21-chochin-kougaku': 'archShop',
  'building.akarimachi.arch-26-guard-record': 'archShop',
  'building.akarimachi.akari-shobo': 'stoneBlock',
  'building.unga.suishitsu': 'stoneBlock',
  'building.unga.mizukurage': 'stoneBlock',
  'building.unga.sekkou-hozonkai': 'stoneBlock',
  'building.unga.glass-minamo': 'stoneBlock',
  'building.chuo.yakuba-honchosha': 'cityHall',
  'building.ekimae.shingo-center': 'brickBlock',
  'building.shiomiko.choui-lab': 'brickBlock',
  'building.shiomiko.shionami': 'brickBlock',
  'building.chuo.yakuba-shinchosha': 'modern:glass',
  'building.gakuen.science-hall': 'modern:brickTeal',
  'building.gakuen.sakurami-keisoku': 'modern:brickTeal',
  'building.gakuen.higashino-mart': 'modern:store',
  'building.chuo.ryokuju-hyakka': 'modern:department',
  'building.chuo.lumiere-sakurami': 'modern:hotel',
  'building.chuo.shimin-byoin': 'modern:hospital',
  'building.kaedezaka.kaedezaka-shogakko': 'school:white',
  'building.gakuen.honkan': 'school:white',
  'building.gakuen.kosen-library': 'school:white',
  'building.shiomiko.shiomi-koko': 'school:brick',
  'building.gakuen.hiraki-shochu': 'school:brickTeal',
  'building.gakuen.kanegaoka-ryo': 'school:dorm',
  'building.gakuen.kosen-gym': 'gym',
  'building.gakuen.q-lab': 'glassLab',
  'building.gakuen.float': 'glassLab',
  'building.gakuen.lightfield': 'glassLab',
  'building.gakuen.battery': 'glassLab',
  'building.gakuen.kaiwa': 'glassLab',
  'building.gakuen.gishi': 'glassLab',
  'building.gakuen.hakkou': 'glassLab',
  'building.gakuen.oto-lab': 'glassLab',
  'building.chuo.chuo-toshokan': 'roundLibrary',
  'building.shiomiko.ferry-terminal': 'terminal',
  'building.shiomiko.soranowa-noriba': 'soranowaNoriba',
  'building.shiomiko.seafood-hobashira': 'pavilion',
  'building.shiomiko.harbor-tower': 'harborTower',
  'building.shiomiko.honokaze': 'curvedHotel',
}

/** 建物の型の名前 */
export function assignKit(rec: NamedRecord): string {
  const a = ASSIGN[rec.id]
  if (a && KITS[a]) return a
  return 'generic'
}

/** 1 棟を作る */
export function buildKit(rec: NamedRecord, ctx: KitContext) {
  const k = new Kit(rec)
  const name = assignKit(rec)
  try {
    KITS[name](k, ctx)
  } catch (e) {
    console.error(`[named] ${rec.id}（${name}）を作れませんでした`, e)
  }
  return { kit: k, kitName: name }
}
