import type { VRM } from '@pixiv/three-vrm'

/**
 * 表情（character.expressions。docs/design/map-split.md §5 の「段 3 の作りの決めごと」）。
 * 見た目が VRM を読み込んだら bind し、層（姿勢の層の face。character/avatar/layers.ts）と共通のまばたきが set で書く。
 * VRM に無い表情の名前は飛ばす（あるかは名前ごとに 1 回だけ引いて覚える）。set はすぐ VRM の expressionManager へ入れる
 * （値をしまうだけなので、書く順によらない。効くのは vrm.update）。
 */
export class CharacterExpressions {
  /** まばたきに掛ける強さ（既定 1。笑顔の間は閉じないなど、層が毎コマ書く） */
  blinkScale = 1
  private vrm: VRM | null = null
  /** 名前ごとの「VRM にあるか」 */
  private readonly has = new Map<string, boolean>()

  /** 読み込んだ VRM につなぐ（覚えた結果は捨てる） */
  bind(vrm: VRM | null) {
    this.vrm = vrm
    this.has.clear()
  }

  /** 表情の強さを書く（VRM がまだ無い・VRM に無い名前なら何もしない） */
  set(name: string, weight: number) {
    const vrm = this.vrm
    if (!vrm) return
    let ok = this.has.get(name)
    if (ok === undefined) {
      ok = !!vrm.expressionManager?.getExpression(name)
      this.has.set(name, ok)
    }
    if (ok) vrm.expressionManager?.setValue(name, weight)
  }
}
