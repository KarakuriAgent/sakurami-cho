import type * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { BodyPose } from './body'
import type { Character } from './character'

/**
 * 姿勢の層（character.layers。docs/design/map-split.md §5 の「段 3 の作りの決めごと」）。
 * キャラクターに固有の身ぶり・反応・視線・表情・飾りを、見た目（character/avatar/characterVisual.ts）の毎コマの計算の段ごとに足す口。
 * 見た目は段ごとに、付けた順（list の順）で層を呼ぶ。毎コマの段の順:
 *
 * 1. begin … そのコマの計算を 1 回（ほかの段より先。反応の強さなど）
 * 2. clip … 待機の上に重ねる全身のクリップ（最初に null 以外を返した層の物）
 * 3. pose … 待機 → 立ち寄り先での行動 → 歩き の後に、共通の姿勢（character/avatar/body.ts）へ重ねる
 * 4. overlay・lower … .vrma の再生の上にコードの姿勢を重ねる強さ（上半身と手・腰から下）。立ち寄り先での行動の強さとの max
 * 5. look … 視線の先（入りはカメラの位置）を書き換え、注意の強さ（0〜1）を返す。強さは層の max（首の追従・カメラを見る強さに使う）
 * 6. nod … 首を前に倒す角度（rad）。0 から層の分を足す
 * 7. adjust … 姿勢の仕上げ（首・視線まで入れた後、表情と vrm.update の前）。正規化ボーンを直接直してよい（顔に手を届かせる IK など。
 *    骨の位置を読むなら、先に f.vrm.scene.updateMatrixWorld(true)）
 * 8. face … 表情を書く（ch.expressions。共通のまばたきの前。まばたきの強さは ch.expressions.blinkScale）
 * 9. after … 揺れもの・vrm.update と体の位置（ch.anchors）を書いた後
 * steady … 待機（.vrma）の体の揺れ（左右の体重移動など）を弱める強さ（0〜1。層の max。見た目は顔のアップなどの寄りの画で、これとは別に弱める）
 *
 * 読み込んだときは onLoad を付けた順に呼ぶ（共通の物を作った後）。
 * 層は毎コマの閉包を作らない（段の関数は付けるときに 1 回作る）。層の中で乱数や壁の時計を使わない（撮影で毎回同じ画にする）。
 */

/** 毎コマ層へ渡す物（見た目が 1 つ持ち、毎コマ書き直す。層は持ち続けない） */
export interface VisualFrame {
  /** 動かしているキャラクター */
  readonly ch: Character
  /** 読み込んだ VRM */
  readonly vrm: VRM
  /** シーンの経過秒 */
  readonly t: number
  /** 前のコマからの秒（丸めない） */
  readonly dt: number
  /** 見ているカメラ */
  readonly camera: THREE.Camera
}

/** 待機の上に重ねる全身のクリップ（見た目が読み込んだ同じ名前のクリップを再生する） */
export interface MotionClipFrame {
  name: string
  /** 始まってからの秒 */
  time: number
  /** 重ねる強さ（0〜1。歩き出したら見た目の側で弱める） */
  weight: number
  /** 身ぶりの長さ（秒）。クリップよりはっきり長ければ（+0.5 秒より）クリップを繰り返し、そうでなければ最後の姿勢で止める */
  length: number
}

export interface CharacterLayer {
  /** 名前（確かめ・デバッグ用） */
  readonly name: string
  /** VRM を読み込んだとき（付けた順）。visual は見た目の中の入れ物（?debug でコンソールから見る用。形は決めない） */
  onLoad?(vrm: VRM, ch: Character, visual: object): void
  /** 待機の上に重ねる全身のクリップ（無ければ null） */
  clip?(f: VisualFrame): MotionClipFrame | null
  /** そのコマの計算を 1 回 */
  begin?(f: VisualFrame): void
  /** 共通の姿勢に重ねる */
  pose?(p: BodyPose, f: VisualFrame): void
  /** .vrma の上にコードの姿勢を重ねる強さ（上半身と手。0〜1） */
  overlay?(f: VisualFrame): number
  /** 腰から下も重ねる強さ（0〜1） */
  lower?(f: VisualFrame): number
  /** 視線の先 target（入りはカメラの位置）を書き換え、注意の強さ（0〜1）を返す */
  look?(target: THREE.Vector3, f: VisualFrame): number
  /** 首を前に倒す角度（rad。足す） */
  nod?(f: VisualFrame): number
  /** 待機の体の揺れを弱める強さ（0〜1。話している間など） */
  steady?(f: VisualFrame): number
  /** 姿勢の仕上げ（首・視線の後、表情と vrm.update の前） */
  adjust?(f: VisualFrame): void
  /** 表情を書く（f.ch.expressions） */
  face?(f: VisualFrame): void
  /** vrm.update と体の位置を書いた後 */
  after?(f: VisualFrame): void
}

/** 姿勢の層の一覧（Character が 1 つずつ持つ。一覧は付け外しのたびに作り直すので、呼んでいる途中に外しても崩れない） */
export class CharacterLayers {
  private items: readonly CharacterLayer[] = []

  /** 付けた順の一覧（段の中の順） */
  get list(): readonly CharacterLayer[] {
    return this.items
  }

  /** 層を付ける（外す関数を返す） */
  add(l: CharacterLayer): () => void {
    this.items = [...this.items, l]
    return () => {
      const i = this.items.indexOf(l)
      if (i >= 0) this.items = this.items.filter((_, j) => j !== i)
    }
  }
}
