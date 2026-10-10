import type * as THREE from 'three'
import type { InteriorZoneId } from '../../../core/interiors'
import type { InteriorBuilder } from './builder'
import type { InteriorUniforms } from './interiorMaterial'
import type { InteriorModel } from './model'

/**
 * 中のある建物の「中の決まり」（brief）。建物ごとに briefs/ に 1 つ書くと、共通の仕組み（model.ts・builder.ts・interiors.ts）が
 * 部屋の床・壁・天井・扉・階段・窓の透けるガラス・灯り・通り道・立ち寄り先の高さを作る。座標は建物の局所の座標（core/interiors.ts の
 * LocalFrame の s, t と、建物の床からの高さ h。m）
 */

/** 2D の点（局所の s, t） */
export type L2 = [number, number]

/** 面の仕上げ（namedMaterial の NM と interiorMaterial の IM の質感の番号・色・値） */
export interface Finish {
  color: string
  mat: number
  aux?: number
}

/** 勾配の天井（切妻の屋根の下。屋根裏）。高さは ridge（局所の h）から、棟の線（axis の座標 = at）から離れるほど slope で下がる */
export interface SlopedCeiling {
  /** 棟の線の向き（'s' なら棟は s に沿い、高さは t で変わる） */
  axis: 's' | 't'
  at: number
  ridge: number
  slope: number
}

export interface RoomDef {
  id: string
  /** 表示の名前（地図データの部屋の名前） */
  name: string
  level: number
  /** 平面の多角形（局所の s, t。反時計回り）。省けば地図データの部屋（dataName）の多角形 */
  poly?: L2[]
  dataName?: string
  /** 床・天井の高さ（建物の床から）。省けば階の値 */
  floor?: number
  ceiling?: number
  sloped?: SlopedCeiling
  /** 灯りと窓の光を分ける組（同じ組の部屋は、窓の光・灯り・まわりの明るさを分け合う。省けば id） */
  group?: string
  floorFinish: Finish
  wallFinish: Finish
  ceilingFinish: Finish
  /** 腰板（壁の下の方の仕上げ）: 高さ m と仕上げ */
  wainscot?: { h: number; finish: Finish }
  /** 巾木（壁の足元の板）の色（省けば付けない） */
  baseboard?: string
  /** 壁の無い（ひと続きの）部屋 */
  open?: string[]
  /** 歩かない部屋（押し入れ・吹き抜けの上など）。壁は作る */
  noWalk?: boolean
  /** 床を作らない（吹き抜け） */
  noFloor?: boolean
  noCeiling?: boolean
  /** 壁を作らない（ガーデンドームの大きな空間。床・回廊・ガラスは furnish・decorate で作る）。となりの部屋からは部屋として見える */
  noWalls?: boolean
  /** ドームの天井（カメラの確かめ・部屋の中か）: 中心（局所）からの距離 d で、高さ base + height × √(1 − (d / radius)²)（局所の h） */
  domeCeil?: { center: L2; radius: number; height: number; base: number }
}

export type DoorKind = 'swing' | 'open' | 'named' | 'void'

export interface DoorDef {
  id: string
  level: number
  /** 壁の線の上の扉の中心（局所の s, t） */
  at: L2
  /** 壁の向き（'s' なら壁は s に沿う） */
  axis: 's' | 't'
  width: number
  height: number
  /** swing = 開き戸（中の扉。近づくと開く）、open = 開口（扉なし）、named = 外観の開く扉（namedDoors。玄関など）、void = 外観の穴だけ（勝手口の外の壁など） */
  kind: DoorKind
  /** 外観の開く扉の番号（named。DoorSpec.entrance） */
  entrance?: number
  /** 開き戸の蝶番の端（-1 = 座標の小さい端、1 = 大きい端）と、開く側（-1 / 1 = 壁の法線の負 / 正の側） */
  hinge?: -1 | 1
  side?: -1 | 1
  /** 壁の厚み（省けば仕切りの厚み。外壁の勝手口などは外壁の厚み） */
  thickness?: number
  /** 扉の板の色と形 */
  color?: string
  style?: 'panel' | 'flush' | 'glass' | 'lattice'
  /** 枠の色（省けば白） */
  frame?: string
  /** 床の高さ（局所の h）。扉の両側で違う（上がり框・勝手口の段）なら [負の側, 正の側] */
  floor?: number | [number, number]
  /** 壁の厚みの見込みの枠を作らない（外観の開口がすでに見込みを作っている勝手口など） */
  jambs?: boolean
}

/** 階段（直階段）。start = 1 段目の蹴上げの中心線の点、dir = 上る向き（局所の単位ベクトル） */
export interface StairDef {
  id: string
  /** 下の階・上の階（同じなら、外の石段のように同じ階の中の段） */
  from: number
  to: number
  start: L2
  dir: L2
  width: number
  risers: number
  /** 踏み面（m） */
  run: number
  /** 下と上の床の高さ（局所の h） */
  y0: number
  y1: number
  /** 形を作るか（外観の型がすでに作っている外の段は false） */
  build?: boolean
  finish?: Finish
  /** 手すりの側（-1 = 左・1 = 右・0 = なし・2 = 両側。上る向きから見て） */
  rail?: -1 | 0 | 1 | 2
  /** 通り道の下の点・上の点の、1 段目の蹴上げ・最後の蹴上げからの距離（m。省けば 0.42・0.45） */
  landing?: [number, number]
  /** 側の壁（-1 = 左・1 = 右・2 = 両側。壁に沿った階段の側桁の見え方） */
  wall?: -1 | 1 | 2
  /**
   * 弧の階段・スロープ（ドームの回廊のスロープ・核のまわりのらせん階段）。start・dir の代わりに、中心（局所）・半径（幅の中心）・
   * 角度 a0 → a1（局所の角度。0 = +s、反時計回りが正。a1 < a0 なら時計回りに上る）。width は半径の向きの幅。形は作らない（build: false。furnish で作る）
   */
  arc?: { center: L2; radius: number; a0: number; a1: number }
  /** 下の階で、段の下を通れなくする（省けば true。弧のスロープの下を花を植えた所にするなら false にして、障害物は furnish で） */
  blockUnder?: boolean
}

/** 外の歩ける所（ポーチ・家の前・石段の上の踊り場など）。高さは h（局所）か、地形（terrain） */
export interface OutdoorArea {
  id: string
  poly: L2[]
  h: number | 'terrain'
  /** 階（省けば 0。2 階のバルコニーなら 1） */
  level?: number
  /** 縁の手すり・塀などで、ここから外へは出ない */
}

/** 灯り（部屋の照明）。kind: bulb = 裸電球・全方向、pendant = 傘のある吊り下げ（下へ強く）、ceiling = 天井の照明（下の半球）、
 * floor = フロアスタンド（傘の上下）、spot = スポット（dir の向きへ）、fire = 薪ストーブの火（揺れる） */
export interface LampDef {
  id: string
  room: string
  /** 位置（局所の s, t と、部屋の床からの高さ） */
  at: [number, number, number]
  color: string
  power: number
  range: number
  kind: 'bulb' | 'pendant' | 'ceiling' | 'floor' | 'spot' | 'fire' | 'screen'
  /** spot の向き（局所の s, t, h） */
  dir?: [number, number, number]
  /** 点く時刻の決まり（interiors.ts の LAMP_SCHEDULES の名前） */
  schedule: LampSchedule
  /** 店の営業時間（schedule = shop のとき。省けば 11〜22 時） */
  hours?: [number, number]
}

/**
 * 灯りの点き方: evening = 夕方から夜（家族のいる部屋）、late = 夜おそくまで（書斎）、presence = 花音がその部屋か隣にいるとき、
 * shop = 店の営業時間（昼も点く）、always = いつも、night = 夜だけ（足元灯）、fire = 夜の薪ストーブ（秋冬）、
 * dusk = 夕方の日の入り前から夜の閉館まで（ガーデンドームの回廊の灯り。葉脈ライティングと同じ o.dome）
 */
export type LampSchedule = 'evening' | 'late' | 'presence' | 'shop' | 'always' | 'night' | 'fire' | 'dusk'

export interface NavPointDef {
  at: L2
  level: number
}

/** 決まり（brief）が足す、共通の形の外の物（ドームの植物・水・霧・ガラスのドームなど。自分のシェーダーを持つ） */
export interface InteriorDecor {
  objects: THREE.Object3D[]
  /** 毎コマ（dt 秒・カメラ） */
  update?: (dt: number, camera: THREE.Camera) => void
  /** 壊すとき（形・マテリアルを捨てる） */
  dispose?: () => void
}

/** decorate に渡すもの（中の形と同じマテリアル・uniform・影の深さのマテリアル） */
export interface DecorContext {
  model: InteriorModel
  uniforms: InteriorUniforms
  surface: THREE.ShaderMaterial
  glow: THREE.ShaderMaterial
  glass: THREE.ShaderMaterial
  depth: THREE.Material
}

export interface InteriorBrief {
  zone: InteriorZoneId
  /** 仕切りの壁の厚み（m） */
  wallT: number
  /** 外壁の中の面の、外形の線からの奥行き（m。データの部屋はこの分だけ内側） */
  inset: number
  rooms: RoomDef[]
  doors: DoorDef[]
  stairs: StairDef[]
  outdoor: OutdoorArea[]
  lamps: LampDef[]
  navPoints: NavPointDef[]
  /** 家具と小物（dry のときは障害物だけ記録する。model を作るときと、形を作るときの 2 回呼ぶ） */
  furnish: (ib: InteriorBuilder, m: InteriorModel) => void
  /** 共通の形の外の物（中を作るときに 1 回。省けばなし） */
  decorate?: (ctx: DecorContext) => InteriorDecor
  /** 通り道の点どうしを結ぶいちばん長い線（m。省けば 6.5。広いドームは長く） */
  maxEdge?: number
  /** 外観の窓のガラスを面光源にしない（ガラスの温室。光は空と太陽から） */
  noWindowLights?: boolean
}
