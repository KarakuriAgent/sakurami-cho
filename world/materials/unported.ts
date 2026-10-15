import { NodeMaterial, type NodeBuilder, type WebGPURenderer } from 'three/webgpu'
import { Discard, Fn, vec4 } from 'three/tsl'

/**
 * WebGPU（WebGPURenderer＋TSL）への移行の途中の仮の決まり（第 1 段。第 2 段でどの材質も TSL にしたら、このファイルごと消す）。
 *
 * WebGPURenderer は GLSL の ShaderMaterial を描けない。そのままだと three が「Material "ShaderMaterial" is not compatible」の誤りを出し、
 * 中身の無い NodeMaterial で描く（不透明な物は黒、透明な物は白い板になって、移した物の確かめの邪魔になる）。そこで renderer の材質の表に、
 * ShaderMaterial の代わりに「どの画素も捨てる材質」（色も深さも書かない）を入れて、まだ TSL にしていない ShaderMaterial を描かないようにする。
 * 描かない材質の名前は、初めて組み立てるときに 1 回だけ console.warn に出す（unportedShaderNames に溜める）
 */

/** まだ TSL にしていないので描かなかった ShaderMaterial の名前（name が無い物は '(名前なし)'） */
export const unportedShaderNames = new Set<string>()

/** どの画素も捨てる（色も深さも書かない。パイプラインの書き込みの設定は元の ShaderMaterial の物が使われるので、画素のシェーダーで捨てる） */
const discardAll = Fn(() => {
  Discard()
  return vec4(0.0)
})

class UnportedShaderMaterial extends NodeMaterial {

  setup(builder: NodeBuilder) {
    const name = this.name || '(名前なし)'
    if (!unportedShaderNames.has(name)) {
      unportedShaderNames.add(name)
      console.warn(`[sakurami-cho] まだ TSL にしていない ShaderMaterial は描きません（WebGPU への移行の第 2 段で移す）: ${name}`)
    }
    this.fragmentNode = discardAll()
    super.setup(builder)
  }
}

const installed = new WeakSet<object>()

/** renderer の材質の表に、ShaderMaterial の代わりの「何も書かない材質」を入れる（renderer ごとに 1 回。町の毎コマの初めとラボを作るときに呼ぶ） */
export function skipUnportedShaders(renderer: WebGPURenderer | null | undefined) {
  const library = (renderer as { library?: { addMaterial?: (cls: unknown, type: string) => void } } | null | undefined)?.library
  if (!renderer || !library?.addMaterial || installed.has(renderer)) return
  installed.add(renderer)
  library.addMaterial(UnportedShaderMaterial, 'ShaderMaterial')
  library.addMaterial(UnportedShaderMaterial, 'RawShaderMaterial')
}
