import { CABLE_STATIONS } from './cableStations'
import { CAFE_FRAME, DOME_FRAME, headingOf, SEIZU_FRAME, SORANOWA_NORIBA_FRAME, stopAt, THOMPSON_FRAME, type InteriorZoneId } from './interiors'
import { RIDE_SPOTS, wheelHeading, wheelToScene } from './soranowa'
import { PLACE, type Vec3 } from './lab/plan'

/**
 * 町の立ち寄り先の表（地図の側のデータ。docs/design/map-split.md §7 の「段 5」・5-1b）。立ち寄り先の場所の部分（名前・位置・向き・行動・
 * ゾーン・階・外か・椅子）だけを持つ。three・React・アプリの側を読まない。
 *
 * - 使う側は、これに自分の立ち寄り先と欄（kanon-lab は配信の立ち位置 stage と、カメラ camera・KB-001 の位置 kb・見せている物 subject）を
 *   足した自分の表を作り、configurePlaces で渡す（4-10 の置き場所の表 PLACEMENTS と同じ考え。kanon-lab は config/layout.ts の STOPS）。
 *   キャラクターの側と中のある建物の通り道（interior/interiors.ts）は townPlaces() でその表を読む。渡さなければ TOWN_PLACES のまま
 * - 表の並びは、通り道のグラフの点の順と、自分で巡るときに行き先を乱数で選ぶ順に効く。使う側の表も、この表の物を省かずに同じ並びで入れる
 * - 座標はシーンの座標（ラボの床の中心が原点、x = 東、y = 上、z = 南。単位 m）。位置は床の上で、x と z だけ使う
 */

/**
 * 立ち寄り先での行動（キャラクターの側の character/avatar/body.ts に姿勢の作り方がある）
 * - present: 立ち位置で配信（待機）
 * - holo: ホログラムを見ながら手を動かす
 * - work: 両手を前に出して作業する
 * - type: 立ったままキーボードを打つ
 * - look: 後ろで手を組んで展示を眺める
 * - gaze: 窓の前に立って外を眺める（左手は胸のペンダントに添える。窓までの距離は場所ごとに違うので、窓には触れない）
 * - pet: KB-001 をなでる
 * - sit: 椅子に座る（立ち寄り先の seat の高さ。机・カウンターに手を置く。町の段階 4 の後半）
 */
export type PlaceAction = 'present' | 'holo' | 'work' | 'type' | 'look' | 'gaze' | 'pet' | 'sit'

/** 立ち寄り先の名前（使う側の表の名前も入るので、地図の側では文字列） */
export type PlaceId = string

export interface TownPlace {
  /** 表示名（操作パネル） */
  label: string
  /** 立つ位置（床の上、x と z だけ使う） */
  position: Vec3
  /** 向き（Y 軸まわり、0 = +Z 向き、π/2 = +X 向き） */
  heading: number
  action: PlaceAction
  /**
   * 任意: ラボの外の立ち寄り先（町の段階 3。docs/design/town.md §11）。使う側の欄（カメラの位置と注視点の y・KB-001 の高さなど）は
   * 「その場所の地面から」の高さ（地面の高さは site/siteModel.ts の groundY）。自分で歩き回る（wander）ときは行かない
   */
  outdoor?: boolean
  /**
   * 任意: 遠くのゾーン（中のある建物とその前。core/interiors.ts）。省けばラボとそのまわり。ゾーンをまたぐ移動は歩かずに置く（kanon.place）。
   * 中の立ち寄り先の使う側の欄の高さは、その階（level）の床から
   */
  zone?: InteriorZoneId
  /** 任意: 建物の中の階（core/interiors.ts の levels の番号。0 = 1 階）。外の立ち寄り先は省く */
  level?: number
  /** 任意: 座る椅子（sit）。座面の高さ（床から m）と、立つ位置から座面の中心まで前へ（m）。desk = 前の机・カウンターの天板の高さ（床から m。手を置く高さ） */
  seat?: { height: number; shift: number; desk?: number }
  /**
   * 任意: 立つ所の台（kanon-lab の配信の立ち位置の台など。docs/design/map-split.md §7 の 5-1c）。top = 台の天面の高さ（床・地面から m）、
   * radius = 立つ位置から台の外の縁までの半径（m）、edge = 縁の内側で高さがなめらかに変わる幅（m）。キャラクターの側（character/avatar/locomotion.ts）は、
   * 足元の高さに台の分（top × なめらかな段 k。k = (radius − 立つ位置からの距離) / edge を 0〜1 に）を足し、ここへ置くとき・ここから始めるときは天面に立たせる
   */
  lift?: { top: number; radius: number; edge: number }
}

/** ガーデンドームの局所の極座標（r m・角度 a 度。0 = 東、90 = 北）→ 局所の s, t（使う側のカメラの位置もこれで出す） */
export const domePolar = (r: number, a: number): [number, number] => [Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r]
/** ガーデンドームの、角度 a 度の外向き（out = 1）・内向き（-1）の向き */
const dh = (a: number, out: 1 | -1) => headingOf(DOME_FRAME, Math.cos((a * Math.PI) / 180) * out, Math.sin((a * Math.PI) / 180) * out)

/** ソラノワのホイールの局所（x, z）の立ち寄り先の位置（y は 0） */
const wstop = (x: number, z: number): [number, number, number] => {
  const p = wheelToScene(x, 0, z)
  return [p[0], 0, p[2]]
}

/**
 * 町の立ち寄り先（ラボの中・ラボのまわり・遠くのゾーン。42 か所）。並びは今のまま（使う側の表もこの並び。kanon-lab は先に stage を置く）。
 * 足すときは、ここに 1 つ足し、使う側の表にも足す（ラボの通り道は core/lab/navData.ts の点と障害物から自動でつながる）。
 * ラボの中の位置が家具に近すぎると経路が見つからないので、障害物から 0.35m 以上離すこと。
 */
export const TOWN_PLACES = {
  // ホロテーブルの西の手前から、北東（テーブルの中心）を向く
  holotable: {
    label: 'ホロテーブル',
    position: [-1.1, 0, 2.95],
    heading: 1.99,
    action: 'holo',
  },
  // 西の壁の作業台の前。西を向く
  workshop: {
    label: '工作台',
    position: [-7.05, 0, 1.6],
    heading: -Math.PI / 2,
    action: 'work',
  },
  // 開発デスク（窓際の L 字）の長辺の前。南（モニタと窓）を向く
  desk: {
    label: '開発デスク',
    position: [5.0, 0, 3.4],
    heading: 0,
    action: 'type',
  },
  // 東の壁のギャラリーの前。東を向く
  gallery: {
    label: 'ギャラリー',
    position: [6.85, 0, PLACE.gallery.position[2]],
    heading: Math.PI / 2,
    action: 'look',
  },
  // 南のガラス壁の前（観葉植物の間）。南（+Z）を向いて町を眺める（ラボの窓際の補助光の位置の元。world/lab/lighting/lightTable.ts の WINDOW_STOP）
  window: {
    label: '窓際',
    position: [-0.5, 0, 4.6],
    heading: 0,
    action: 'gaze',
  },
  // KB-001 のドックの西南西。ドックを向く
  dock: {
    label: 'KB-001',
    position: [5.75, 0, 2.0],
    heading: 1.13,
    action: 'pet',
  },
  // --- ラボの外（見学エントランスの扉を通って出る。通り道は core/site.ts） ---
  // エントランスの外（テラスの扉の前）。南（町の方）を向いて立つ
  front: {
    label: 'ラボの前',
    position: [-6.6, 0, 7.2],
    heading: 0,
    action: 'present',
    outdoor: true,
  },
  // テラスの手すりの前。南を向いて町を見下ろす
  terrace: {
    label: 'テラス',
    position: [2.4, 0, 8.35],
    heading: 0,
    action: 'look',
    outdoor: true,
  },
  // 大パラボラの前の砂利の広場。東の皿を見上げる
  parabola: {
    label: '大パラボラ',
    position: [24.0, 0, -1.4],
    heading: Math.PI / 2,
    action: 'look',
    outdoor: true,
  },
  // ひらき見晴らし台（標高 110m の石畳の台）の南の縁。町と海を見下ろす
  lookout: {
    label: 'ひらき見晴らし台',
    position: [66.0, 0, 54.2],
    heading: 0,
    action: 'look',
    outdoor: true,
  },
  // --- 遠くのセット（町の段階 4 の後半。ラボからは歩かずに kanon.place で置く。docs/design/town.md の §13） ---
  // トンプソン家（楓坂三丁目）。局所の座標 u = 東・v = 北（母屋の南西の角が原点）
  // 家の前（敷地の塀の門の外、百段石段の側）。東（ポーチの階段と玄関）を向く
  'thompson-front': {
    label: 'トンプソン家の前',
    position: stopAt(THOMPSON_FRAME, -4.7, 8.3),
    heading: Math.PI / 2,
    action: 'present',
    outdoor: true,
    zone: 'thompson',
  },
  // リビング・ダイニング（1 階）。南の大きな窓の前で、湾と町を眺める
  'thompson-living': {
    label: 'トンプソン家のリビング',
    position: stopAt(THOMPSON_FRAME, 6.15, 0.78),
    heading: 0,
    action: 'gaze',
    zone: 'thompson',
    level: 0,
  },
  // 花音の部屋（2 階の南西）。ロフトベッドの下の作業机に向かって座る
  'thompson-desk': {
    label: '花音の部屋の作業机',
    position: stopAt(THOMPSON_FRAME, 1.3, 2.5),
    heading: Math.PI,
    action: 'sit',
    zone: 'thompson',
    level: 1,
    seat: { height: 0.5, shift: 0.33, desk: 0.755 },
  },
  // バルコニー（2 階の南、花音の部屋のガラス戸の外）。湾を眺める（小さな天体望遠鏡）
  'thompson-balcony': {
    label: '花音の部屋のバルコニー',
    position: stopAt(THOMPSON_FRAME, 1.95, -0.72),
    heading: 0,
    action: 'look',
    zone: 'thompson',
    level: 1,
  },
  // 屋根裏（2 階の廊下の天井の折りたたみ梯子から。歩いては上がらない。kanon.place で置く）。季節の物と子どものころの作品の箱
  'thompson-attic': {
    label: 'トンプソン家の屋根裏',
    position: stopAt(THOMPSON_FRAME, 4.6, 3.75),
    heading: -Math.PI / 2,
    action: 'look',
    zone: 'thompson',
    level: 2,
  },
  // ガレージの家庭工房（キッチンの勝手口から）。作業台に向かう
  'thompson-garage': {
    label: 'トンプソン家のガレージ（家庭工房）',
    position: stopAt(THOMPSON_FRAME, 5.6, 8.78),
    heading: 0,
    action: 'work',
    zone: 'thompson',
    level: 0,
  },
  // 星図珈琲（灯町三丁目 星見横丁）。局所の座標 s = 正面に沿って右へ・t = 奥へ（正面の北東の面の東の角が原点）
  // 店の前（星見石段の下の路地）。石段の上の店を見上げる
  'seizu-front': {
    label: '星図珈琲の前（星見石段の下）',
    position: stopAt(SEIZU_FRAME, 3.55, -7.35),
    heading: headingOf(SEIZU_FRAME, 0, 1),
    action: 'present',
    outdoor: true,
    zone: 'seizu',
  },
  // カウンターの C4（花音の定位置。ラテアートがいちばんよく見える席）
  'seizu-counter': {
    label: '星図珈琲のカウンター（C4）',
    position: stopAt(SEIZU_FRAME, 3.8, 2.5),
    heading: headingOf(SEIZU_FRAME, 0, 1),
    action: 'sit',
    zone: 'seizu',
    level: 0,
    seat: { height: 0.72, shift: 0.32, desk: 1.02 },
  },
  // 窓際（入口の右の大きな窓の前）。路地の灯りを眺める
  'seizu-window': {
    label: '星図珈琲の窓際',
    position: stopAt(SEIZU_FRAME, 4.65, 0.72),
    heading: headingOf(SEIZU_FRAME, 0, -1),
    action: 'gaze',
    zone: 'seizu',
    level: 0,
  },
  // Café Platform 1872（桜見駅の右翼の角。駅前広場に面する）。局所の座標 s = 正面に沿って右へ（南西へ）・t = 奥へ（南東へ）
  // 店の前（駅前広場。テラスの柵の切れ目の前）。店を向く
  'cafe-front': {
    label: 'Café Platform 1872 の前（駅前広場）',
    position: stopAt(CAFE_FRAME, 8.06, -12.0),
    heading: headingOf(CAFE_FRAME, 0, 1),
    action: 'present',
    outdoor: true,
    zone: 'cafe',
  },
  // テラス（入口の左のテーブルのそば）。広場を眺める（緑電の発着）
  'cafe-terrace': {
    label: 'Café Platform 1872 のテラス',
    position: stopAt(CAFE_FRAME, 4.4, -3.7),
    heading: headingOf(CAFE_FRAME, 0, -1),
    action: 'look',
    outdoor: true,
    zone: 'cafe',
  },
  // 入口の内（扉を入ったところ）。店の中を見る
  'cafe-entrance': {
    label: 'Café Platform 1872 の入口',
    position: stopAt(CAFE_FRAME, 8.06, 1.75),
    heading: headingOf(CAFE_FRAME, 0, 1),
    action: 'look',
    zone: 'cafe',
    level: 0,
  },
  // カウンター（6 席の 3 つ目。古いレールのカウンター）
  'cafe-counter': {
    label: 'Café Platform 1872 のカウンター',
    position: stopAt(CAFE_FRAME, 6.9, 4.25),
    heading: headingOf(CAFE_FRAME, 0, 1),
    action: 'sit',
    zone: 'cafe',
    level: 0,
    seat: { height: 0.74, shift: 0.35, desk: 1.05 },
  },
  // 窓際の 2 番テーブル（花音の定位置）。窓に向いたベンチに座る。窓のやや右に、まるの森の向こうのガーデンドーム
  'cafe-window': {
    label: 'Café Platform 1872 の窓際（2 番テーブル）',
    position: stopAt(CAFE_FRAME, 6.05, 2.33),
    heading: headingOf(CAFE_FRAME, 0, -1),
    action: 'sit',
    zone: 'cafe',
    level: 0,
    seat: { height: 0.46, shift: 0.33, desk: 0.72 },
  },
  // ガーデンドーム（まるの森の中心。直径 120m・高さ 48m）。局所の座標 s = 東・t = 北（原点はドームの中心）。層: 0 根の階・1 幹の回廊・2 枝の回廊・
  // 3 梢のテラス・4 種の間（地下）。層の間はスロープ・らせん階段・階段を歩いて上り下りする
  // 南門の前（噴水広場の側の石段の下）。ドームを見上げる
  'dome-gate': {
    label: 'ガーデンドームの南門の前',
    position: stopAt(DOME_FRAME, 0, -72.4),
    heading: headingOf(DOME_FRAME, 0, 1),
    action: 'present',
    outdoor: true,
    zone: 'dome',
  },
  // 根の階の中央（池の南の広場）。大滝「天の水」と核の岩の塔を見上げる
  'dome-root': {
    label: 'ガーデンドームの根の階（大滝の前）',
    position: stopAt(DOME_FRAME, 0, -15.7),
    heading: headingOf(DOME_FRAME, 0, 1),
    action: 'look',
    zone: 'dome',
    level: 0,
  },
  // 幹の回廊（1 層。南東、スロープ A を上がったところ）。手すりの前で核と大滝を眺める
  'dome-gallery': {
    label: 'ガーデンドームの幹の回廊（1 層）',
    position: stopAt(DOME_FRAME, ...domePolar(46.55, -14)),
    heading: dh(-14, -1),
    action: 'look',
    zone: 'dome',
    level: 1,
  },
  // 喫茶 こもれび（1 層の南東の張り出し）。手すりの眺めのカウンターの丸椅子に座る（葉っぱラテ）
  'dome-komorebi': {
    label: 'ガーデンドームの喫茶 こもれび',
    position: stopAt(DOME_FRAME, ...domePolar(46.4, -45)),
    heading: dh(-45, -1),
    action: 'sit',
    zone: 'dome',
    level: 1,
    seat: { height: 0.72, shift: 0.35, desk: 1.07 },
  },
  // 光脈管制室（1 層の東。ガラス張り）。葉脈ライティングの制御ソフト「ベイン」の画面に向かう（花音は保守の担当）
  'dome-control': {
    label: 'ガーデンドームの光脈管制室',
    position: stopAt(DOME_FRAME, ...domePolar(54.15, 16)),
    heading: dh(16, 1),
    action: 'type',
    zone: 'dome',
    level: 1,
  },
  // 枝の回廊（2 層）から核へ渡る南のつり橋の上。大滝を正面に見る
  'dome-bridge': {
    label: 'ガーデンドームのつり橋（2 層。大滝の前）',
    position: stopAt(DOME_FRAME, ...domePolar(17.5, -90)),
    heading: dh(-90, -1),
    action: 'look',
    zone: 'dome',
    level: 2,
  },
  // 梢のテラス（3 層。核の上）。西の縁の手すりの前で、ガラス越しの町と夕焼けを眺める
  'dome-terrace': {
    label: 'ガーデンドームの梢のテラス（3 層）',
    position: stopAt(DOME_FRAME, ...domePolar(11.25, 186)),
    heading: dh(186, 1),
    action: 'look',
    zone: 'dome',
    level: 3,
  },
  // 種の間（地下）。ガラスの壁の前で、種子保存庫と紫の増殖室を眺める
  'dome-seeds': {
    label: 'ガーデンドームの種の間（地下）',
    position: stopAt(DOME_FRAME, 1.2, 32.35),
    heading: headingOf(DOME_FRAME, 0, 1),
    action: 'look',
    zone: 'dome',
    level: 4,
  },
  // 大観覧車ソラノワ（汐見港の帆柱町。直径 100m・ゴンドラ 60 基）。乗り場の建物の局所の座標 s = 正面に沿って右へ（東南東へ）・t = 奥へ（北北東へ。ホイールの側）。
  // 乗り場の台の立ち寄り先はホイールの局所の座標（core/soranowa.ts。x = ホイールの面に沿って、z = 軸の向き。−z が台の側）
  // 乗り場の前（建物の正面の入口の前の広場）。建物を向く
  'soranowa-front': {
    label: 'ソラノワの乗り場の前',
    position: stopAt(SORANOWA_NORIBA_FRAME, 8.95, -4.4),
    heading: headingOf(SORANOWA_NORIBA_FRAME, 0, 1),
    action: 'present',
    outdoor: true,
    zone: 'soranowa',
  },
  // 改札の前（建物の中。券売機と案内の板）。改札を向く
  'soranowa-gate': {
    label: 'ソラノワの乗り場の改札',
    position: stopAt(SORANOWA_NORIBA_FRAME, 11.2, 4.2),
    heading: headingOf(SORANOWA_NORIBA_FRAME, 0, 1),
    action: 'look',
    zone: 'soranowa',
    level: 0,
  },
  // 乗り場の台の乗車位置（黄色い枠）。ゴンドラの通る所（+z）を向いて待つ
  'soranowa-platform': {
    label: 'ソラノワの乗車位置',
    position: wstop(RIDE_SPOTS.boardX, RIDE_SPOTS.boardZ),
    heading: wheelHeading(0, 1),
    action: 'present',
    zone: 'soranowa',
    level: 1,
  },
  // 乗り場の台の降車位置（降りたゴンドラの上流の側）。出口のスロープ（+x）を向く
  'soranowa-exit': {
    label: 'ソラノワの降車位置',
    position: wstop(RIDE_SPOTS.exitX, RIDE_SPOTS.exitZ),
    heading: wheelHeading(1, -0.35),
    action: 'present',
    zone: 'soranowa',
    level: 1,
  },
  // 丘ノ上ケーブルの 3 駅（core/cableStations.ts。駅の局所の座標 s = 線路に沿って山の側へ・t = 北西へ）。町の中の移動（kanon.travel）は駅の入口から
  // ホームの扉の前まで歩き、来た便に乗る。ここは kanon.place で置く・駅の中を kanon.goto で歩くための立ち寄り先
  // 頂上駅の出口の前（天文台の擁壁沿いの小径の端。駅舎を向く）
  'cable-summit-front': {
    label: 'ケーブルの頂上駅の前',
    position: stopAt(CABLE_STATIONS['cable-summit'].frame, 39.2, 0.4),
    heading: headingOf(CABLE_STATIONS['cable-summit'].frame, -1, 0),
    action: 'present',
    outdoor: true,
    zone: 'cable-summit',
  },
  // 頂上駅のホーム（山から 3 つ目の区画の扉の前。線路を向いて待つ）
  'cable-summit-platform': {
    label: 'ケーブルの頂上駅のホーム',
    position: stopAt(CABLE_STATIONS['cable-summit'].frame, CABLE_STATIONS['cable-summit'].comps[2].door, -2.07),
    heading: headingOf(CABLE_STATIONS['cable-summit'].frame, 0, 1),
    action: 'present',
    zone: 'cable-summit',
    level: 0,
  },
  // 楓坂駅の西口の前（楓坂四丁目の横道。上屋を向く）
  'cable-kaedezaka-front': {
    label: 'ケーブルの楓坂駅の西口の前',
    position: stopAt(CABLE_STATIONS['cable-kaedezaka'].frame, 4.6, 9.0),
    heading: headingOf(CABLE_STATIONS['cable-kaedezaka'].frame, 0, -1),
    action: 'present',
    outdoor: true,
    zone: 'cable-kaedezaka',
  },
  // 楓坂駅の北西のホーム（谷から 2 つ目の区画の扉の前。線路を向く）
  'cable-kaedezaka-platform': {
    label: 'ケーブルの楓坂駅のホーム',
    position: stopAt(CABLE_STATIONS['cable-kaedezaka'].frame, CABLE_STATIONS['cable-kaedezaka'].comps[1].door, 4.26),
    heading: headingOf(CABLE_STATIONS['cable-kaedezaka'].frame, 0, -1),
    action: 'present',
    zone: 'cable-kaedezaka',
    level: 0,
  },
  // 麓駅の入口の前（ふもとの道の側。駅舎の入口を向く）
  'cable-fumoto-front': {
    label: 'ケーブルの麓駅の前',
    position: stopAt(CABLE_STATIONS['cable-fumoto'].frame, 7.42, 1.24),
    heading: headingOf(CABLE_STATIONS['cable-fumoto'].frame, 0.6, 0.8),
    action: 'present',
    outdoor: true,
    zone: 'cable-fumoto',
  },
  // 麓駅のホーム（谷から 2 つ目の区画の扉の前。線路を向く）
  'cable-fumoto-platform': {
    label: 'ケーブルの麓駅のホーム',
    position: stopAt(CABLE_STATIONS['cable-fumoto'].frame, CABLE_STATIONS['cable-fumoto'].comps[1].door, 2.07),
    heading: headingOf(CABLE_STATIONS['cable-fumoto'].frame, 0, -1),
    action: 'present',
    zone: 'cable-fumoto',
    level: 0,
  },
} as const satisfies Record<string, TownPlace>

export type TownPlaceId = keyof typeof TOWN_PLACES

/** 使う側が渡した立ち寄り先の表（渡さなければ地図の表） */
let places: Readonly<Record<PlaceId, TownPlace>> = TOWN_PLACES

/**
 * 使う側の立ち寄り先の表を渡す（TOWN_PLACES に自分の立ち寄り先と欄を足した物。地図の表の物は省かずに、同じ並びで入れる）。
 * 表を読む物（キャラクター・中のある建物の通り道）を作る前に呼ぶ。kanon-lab は config/layout.ts の読み込みの時に STOPS を渡す
 */
export function configurePlaces(table: Readonly<Record<PlaceId, TownPlace>>) {
  places = table
}

/** 立ち寄り先の表（configurePlaces で渡した物。渡していなければ TOWN_PLACES）。並びは表の並び */
export function townPlaces(): Readonly<Record<PlaceId, TownPlace>> {
  return places
}
