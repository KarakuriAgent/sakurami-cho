/**
 * ラボの外の町（桜見町）の場所と、町の地図データの読み込みの設定。
 *
 * 町の形（地形・海・川と運河・道・鉄道・建物・木・灯り）は、正式な町の地図データ（setting-book/town）から作る。
 * sync-town（tools/sync-town.mjs。kanon-lab は `pnpm sync:town`）が地図データを読みやすい形に直してアセットの根の town/ に書き（書き出した物はパッケージの git に入れる）、
 * world（world/outdoor/town/）がそれを読んで組み立てる。設計は docs/design/town.md。
 *
 * このファイルは Node（tools/sync-town.mjs）と bun（tools/check-walk.mjs）からも読むので、ほかのファイルを import しない。
 *
 * 座標の決まり（町の地図データと同じ平面座標）:
 * - 原点 = 桜木丘ラボ 1 階の床の中心。x = 東 [m]、y = 北 [m]（原点での真北）、標高 = 平均海面から [m]
 * - シーンの座標へは townToScene(): three.x = x、three.y = 標高 - 116.0、three.z = -y（ラボの -z が真北）
 */

/** 町の平面座標（m）: ラボの床の中心から 東へ x、北へ y */
export type PlanXY = readonly [number, number]

/** 方位（北から時計回りの度）と距離（m）から、町の平面座標 [x, y] */
export function polar(bearingDeg: number, distance: number): PlanXY {
  const b = (bearingDeg * Math.PI) / 180
  return [Math.sin(b) * distance, Math.cos(b) * distance]
}

/**
 * 場所（太陽・星の位置の計算と、ラボの高さ）。地図データの town_meta.json の原点（D-002・D-003）のとおり
 */
export const SITE = {
  /** 北緯（度）。こちらの世界の逗子市北東部・池子の丘陵のあたり（借りるのは位置だけ） */
  latitude: 35.3051,
  /** 東経（度） */
  longitude: 139.5888,
  /** 日之本標準時（UTC+9。こちらの世界の日本と秒単位で一致する。夏時間は無い） */
  utcOffsetHours: 9,
  /** ラボの 1 階の床の標高（m）。シーンの y = 0 */
  labFloorElevation: 116.0,
  /**
   * ラボの -z と真北のずれ（度、時計回り）。地図データでラボの壁は東西南北にそろっている（D-002）ので 0
   */
  northOffsetDeg: 0,
} as const

/** 町の平面座標と標高から、シーンの座標（ラボの床の中心が原点、y が上） */
export function townToScene(at: PlanXY, elevation: number): [number, number, number] {
  const r = (SITE.northOffsetDeg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  // 北のずれの分だけ、平面座標を反時計回りに回してからシーンへ（x = 東、z = -北）
  const e = at[0] * c - at[1] * s
  const n = at[0] * s + at[1] * c
  return [e, elevation - SITE.labFloorElevation, -n]
}

/** シーンの x, z から、町の平面座標 [x, y]（townToScene の逆） */
export function sceneToPlan(x: number, z: number): [number, number] {
  const r = (SITE.northOffsetDeg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const n0 = -z
  return [x * c + n0 * s, -x * s + n0 * c]
}

/* -------------------------------------------------------------------------- */
/* 地図データの取り込み（pnpm sync:town）                                          */
/* -------------------------------------------------------------------------- */

export const TOWN_DATA = {
  /**
   * 書き出し先（アセットの根（createTown の assetBase が指す所）の下。sync-town（tools/sync-town.mjs）が --out の下に書く。書き出した物はパッケージの git に入れる）。
   * 読み元（町の地図データのフォルダ）は、使う側が sync-town の --src か環境変数 SAKURAMI_TOWN_SRC で渡す（5-9 で、ここの syncSource をやめた）
   */
  dir: 'town',
  /** 書き出す形の版（形を変えたら上げる。アプリは違う版のデータを読まずに `pnpm sync:town` の案内を出す。3 = ラボのまわりの道と広場 infra.site、4 = 名前のある建物の記録 named.json、5 = 名前のある建物の部屋の間取り rooms、6 = Café Platform 1872 の窓からガーデンドームを見る線の下に建物と木を抑えた、7 = 交通（緑電・ヒノテツ・運河バス・連絡船・浮遊レーン）と信号の交差点 infra.transit、8 = ラボを設定資料の外形（17.2m × 10.8m）にして、ラボのまわりの空ける範囲と小道を合わせた、9 = 町全体の歩く道のグラフ walk.json（tools/town/walkgraph.mjs）、10 = 街区の自動の建物を道の面（中心線と幅）から離した・つづら道の足元灯（街灯の代わり）・町の石段の足元灯をアプリへ移した（docs/design/town.md §7 の 169・173）） */
  format: 10,
  /** 建物・木・灯りの区画（タイル）の一辺（m） */
  tileSize: 1000,
  /**
   * 町には描かないもの（アプリが自分で持っているもの）。ラボの建物はアプリのラボ（world/lab/）があるので描かない。
   * 水冷放熱器は地図の位置のまま、アプリのラボの外観（site/labShell.ts）が細かく作る
   */
  exclude: ['building.sakuragioka.lab', 'structure.sakuragioka.lab-radiator-1', 'structure.sakuragioka.lab-radiator-2'],
  /**
   * アプリのラボ（設定資料の外形 17.2m × 10.8m・西の通用口の前の踊り場・南のテラス）が占める範囲（町の平面座標 [西, 南, 東, 北]）。
   * 町の側はここに建物・木を置かず、地面を床より maxGround まで下げる（整合性の決めごと: docs/design/town.md §7 の 132〜）
   */
  labClearance: { box: [-10.6, -9.6, 9.0, 6.0] as [number, number, number, number], maxGround: 115.0 },
  /** 木を置く範囲と間隔（m）。近くは 1 本ずつ、遠くは間隔を広げて木のかたまりにする */
  trees: { maxDistance: 3600, northRadius: 380, spacing: 6.5, spacingGrowth: 190 },
} as const

/* -------------------------------------------------------------------------- */
/* 描き方の細かさ（画質ごと）                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 画質ごとの町の描き方。`?quality=low` は low、配信（ふだん）は high、撮影モード（`?mode=film`）は film。`?town=low|high|film` で直接選べる
 * （runtime.ts の RUNTIME.townQuality）。配信の high は 1920×1080 で 60fps を保つ範囲、film は撮影の本番用（1 コマずつ撮るので重くてよい）。
 * - terrainBearingStep: 地形の格子の方位の刻み（度。ラボを中心にした放射状の格子で、遠くほど半径の刻みを広げる）
 * - terrainRadius: 地形の格子の半径（m。その外は粗い遠景の格子）
 * - treeShare: 木を描く割合（0〜1）
 * - windowSprites: 遠くの窓明かりを光の点でも描くか（夜の町の灯りのきらめき）
 * - nearTreeDistance: 枝と葉の板で描く木の距離（m。その先は板 1 枚の木（インポスター））
 * - interior: 窓の奥の部屋（インテリアマッピング）を描くか
 * - detailRadius: ベランダ・ひさし・看板・室外機などの小物を形で描く距離（m。細かさの中心から。その先は外壁のシェーダーの模様）
 * - roofPropsRadius: 屋上の小物（室外機・給水塔・塔屋・アンテナ・手すり）を形で描く距離（m）
 * - shadowSize: 町の太陽の影の地図の大きさ（px。0 で影なし）。近く（半径 shadowNear m。4096 まで）と遠く（半径 shadowFar m）の 2 枚。太陽が動いたときだけ描き直す
 * - groundDetail: 地面の近くの質感（芝・土・石畳・アスファルトの写真の質感と凹凸）を描く距離（m）
 * - namedNear: 名前のある建物を細かい形（質感・窓の奥・看板・灯具）で描く距離（m。細かさの中心から建物の外形まで。その先は安い形）
 * - transitNear: 線路・架線・停留所・信号・街灯の柱を形で描く距離（m。細かさの中心から。車両は町じゅう）
 * - grassRadius: 草むら（草の葉の株）を描く半径（m。カメラから。0 で描かない）
 * - lampFade: 夜の灯りの表で壁と地面を照らす距離（m。カメラから [うすめ始め, 消える]）
 * - shadowNearMax: 近くの影の地図の大きさの上限（px）・localShadow: 花音のまわりの細かい影の地図の大きさ（px）
 *
 * final は撮影の本番の書き出し（`?final=1`。record:script の `--final`。docs/design/film-mode.md §9）: film をもとに、細かく描く距離を広げ、影の地図を細かくする
 */
export const TOWN_QUALITY = {
  low: { terrainBearingStep: 0.5, terrainRadius: 9000, treeShare: 0.45, windowSprites: true, nearTreeDistance: 90, interior: false, detailRadius: 120, roofPropsRadius: 500, shadowSize: 2048, shadowNear: 350, shadowFar: 2400, groundDetail: 120, namedNear: 250, transitNear: 450, grassRadius: 0, lampFade: [100, 250] as [number, number], shadowNearMax: 4096, localShadow: 2048 },
  high: { terrainBearingStep: 0.25, terrainRadius: 12000, treeShare: 1, windowSprites: true, nearTreeDistance: 260, interior: true, detailRadius: 450, roofPropsRadius: 2200, shadowSize: 4096, shadowNear: 450, shadowFar: 2800, groundDetail: 260, namedNear: 520, transitNear: 700, grassRadius: 22, lampFade: [140, 380] as [number, number], shadowNearMax: 4096, localShadow: 2048 },
  film: { terrainBearingStep: 0.2, terrainRadius: 14000, treeShare: 1, windowSprites: true, nearTreeDistance: 420, interior: true, detailRadius: 600, roofPropsRadius: 2600, shadowSize: 8192, shadowNear: 500, shadowFar: 3200, groundDetail: 400, namedNear: 900, transitNear: 900, grassRadius: 40, lampFade: [260, 700] as [number, number], shadowNearMax: 4096, localShadow: 2048 },
  final: { terrainBearingStep: 0.15, terrainRadius: 16000, treeShare: 1, windowSprites: true, nearTreeDistance: 620, interior: true, detailRadius: 900, roofPropsRadius: 3200, shadowSize: 8192, shadowNear: 500, shadowFar: 3400, groundDetail: 600, namedNear: 1300, transitNear: 1300, grassRadius: 60, lampFade: [420, 1100] as [number, number], shadowNearMax: 8192, localShadow: 4096 },
} as const

export type TownQualityName = keyof typeof TOWN_QUALITY

/* -------------------------------------------------------------------------- */
/* 動くもの・夜の光                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 丘ノ上ケーブル（頂上駅 ⇔ 楓坂駅 ⇔ 麓駅）。線路の形は地図データ（railway.geojson の cable_railway）。
 * 2 両（さくら号・かえで号）が綱でつながって、行き違い線ですれ違う
 */
export const CABLE = {
  /** 片道の時間（秒）・発車の間隔（秒）と、運転の時間（JST の時。最後の発車）。vol3 4-4: 6:00〜23:30、10 分間隔、所要約 4 分 */
  tripSeconds: 240,
  interval: 600,
  service: [6, 23.5] as [number, number],
}

/** 夜の光の色（電球色。設定: 街灯は全町で暖色に統一。シアンの光はラボと一部のラボだけ） */
export const TOWN_LIGHT_COLORS = {
  window: ['#ffd49a', '#ffc988', '#ffe2b8', '#ffbf7a', '#fff0d8'],
  street: '#ffc275',
  port: '#ffdcae',
  path: '#ffb866',
  far: '#ffcf96',
} as const
