import { LAB_PLACEMENTS, labObstacles, type LabPlacement } from './placements'
import { SHELL_OBSTACLES, type Obstacle } from './plan'

/**
 * ラボの中の通り道のデータ（データの側。docs/design/map-split.md §7 の「段 5」・5-1b）。手で置いた通り道の点と、通り道とカメラが避ける障害物の並べ方。
 * three・React・アプリの側に依存しない。キャラクターの通り道（character/avatar/nav.ts）は、これと立ち寄り先の表から「見通しのきく点どうし」を結んだ
 * グラフを作る（通り道の点と障害物は使う側が configureNav で渡す。kanon-lab は config/layout.ts の NAV_POINTS・OBSTACLES。渡さなければここの既定。5-1c）。
 */

/**
 * 通り道の点（x, z）。家具を避けて手で置いた点で、立ち寄り先と合わせて「見通しのきく点どうし」を結んだグラフになる
 * （character/avatar/nav.ts）。家具の間を通したいときは、ここに点を足す。
 */
export const LAB_NAV_POINTS: [number, number][] = [
  [1.4, 3.15], // 立ち位置の前
  [2.9, 1.6], // 立ち位置の右（危険線の南東の角の外）
  [-1.5, 1.55], // ホロテーブルの奥（危険線の外）
  [-2.4, 3.6], // ホロテーブルの左手前
  [0, 3.75], // ホロテーブルの手前
  [-3.6, 1.6], // 工作ゾーンの入り口
  [-5.2, 3.0], // 工作ゾーンの手前（ロボットアームの南）
  [-6.85, 3.0], // 3D プリンタの前
  [-6.85, 0.2], // 作業台の北の端の前
  [-5.6, -1.1], // CNC の前
  [4.6, 0.3], // 部屋の右（ギャラリーとサーバラックの間）
  [5.6, 1.2], // ドックの北
  [4.3, 2.55], // ドックの西
  [2.6, 3.6], // 開発デスクの西の端の前
  [6.6, -0.9], // ギャラリーの北の端の前
]

/**
 * 障害物（花音の通り道とカメラが避ける家具）。rect は x/z の範囲、circle は中心と半径、height は高さ（m）。
 * navOnly は花音の通り道だけが避ける範囲（床の線の内側など。カメラは通ってよく、見通しもさえぎらない）。
 * 什器のキットの plan の障害物（ワールドの数のまま）と殻の障害物（中二階への階段）を、今の並びで組み立てる
 * （並びは、カメラの注意の文「家具（…）の中」で最初に当たる物を変えないため）。置き場所の表から外した什器の障害物は入らない。
 * 使う側は自分の置き場所の表を渡す（kanon-lab は config/layout.ts の OBSTACLES）
 */
export function labNavObstacles(placements: readonly LabPlacement[] = LAB_PLACEMENTS): Obstacle[] {
  return [
    ...labObstacles('baseStation', placements), // 基地局・危険線の内側
    ...labObstacles('kb001Dock', placements),
    ...labObstacles('holoTable', placements),
    ...labObstacles('workshop', placements), // 作業台・3D プリンタ
    ...labObstacles('robotArm', placements),
    ...labObstacles('workshopNorth', placements), // CNC・パーツケース
    ...SHELL_OBSTACLES, // 中二階への階段
    ...labObstacles('serverRack', placements),
    ...labObstacles('gallery', placements),
    ...labObstacles('devDesk', placements), // 長辺・短辺・椅子
    ...labObstacles('windowPlants', placements),
  ]
}
