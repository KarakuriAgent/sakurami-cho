import { LightingModel, type Node, type NodeBuilder } from 'three/webgpu'
import { BRDF_Lambert, context, diffuseColor, float, materialReference, mix, modelViewPosition, normalView, vec3 } from 'three/tsl'
import { MToonNodeMaterial } from '@pixiv/three-vrm/nodes'

/**
 * VRM の MToon の WebGPU（TSL）の材質（WebGPU への移行の第 2 段）。three-vrm 3.5.5 の MToonNodeMaterial を土台に、WebGL の MToonMaterial と
 * 同じ見た目・同じ振る舞いにする所だけを直した物。読み込み（loadVrm.ts の MToonMaterialLoaderPlugin の materialType）で使う。
 *
 * 1. 影の当たり方（VrmMToonLightingModel）: WebGL の MToon は、ライトの影を「明暗の境（shading）」に掛ける（影の中も shadeColor × ライトの色で照らす。
 *    リムの光も影の外と同じ）。three-vrm の node 版は、three の決まりどおりライトの色に影を掛けてしまうので、影の中はライトの光が 0 になり、
 *    空の光（ラボでは青緑）だけになって、花音の顔・首の影が青く沈んでいた。そこで材質の contextNode の getShadow で影を掛けない色をもらい、
 *    影の値（ライトの shadowNode）は光の式の中で shading に掛ける（WebGL の getShading と同じ）
 * 2. リムの光（parametric rim・matcap）の明るさ: WebGL は mix(1, (ライトの色の和 + 空の光) / π, rimLightingMix) を掛ける。node 版は空の光の分が無い
 *    ので、間接光の項に足す
 * 3. 法線は normalView（three-vrm の node 版は非推奨の transformedNormalView を読み、組み立てのたびに警告が出ていた。中身は同じ）
 * 4. 複製で alphaTest が落ちない: three r186 の NodeMaterial.copy は Material.copy を呼ばず、自分の欄（名前が _ で始まる物を除く）と自分の class の
 *    prototype の setter だけを写す。alphaTest は Material.prototype の getter / setter（中身は _alphaTest）なので写らず、0 になる。読み込み（GLTFLoader と
 *    three-vrm）は材質を複製するので、kanon.vrm の白目・虹彩・ハイライト・まつ毛・眉（MASK）の切り抜きが消え、ハイライトの板の透けた所が虹彩を覆って
 *    瞳が灰色の板に見え、まつ毛・眉の縁も四角く出ていた（WebGL の MToonMaterial は ShaderMaterial の copy で写る）
 *
 * three-vrm の private な組み立ての部品（_setupShadeColorNode など）を使う。three-vrm を上げたら確かめる
 */

type F = Node<'float'>
type V3 = Node<'vec3'>

/** three-vrm の MToonNodeMaterial の、組み立ての部品（private。型の上だけ見えるようにする） */
interface MToonParts {
  _setupShadeColorNode(): V3
  _setupShadingShiftNode(): F
  _setupShadingToonyNode(): F
  _setupRimLightingMixNode(): F
  _setupRimMultiplyNode(): V3
  _setupMatcapNode(): V3
  parametricRimColorNode: unknown
  parametricRimLiftNode: unknown
  parametricRimFresnelPowerNode: unknown
}

/** 光の式が読む材質の値（材質の setupVariants で 1 回だけ計算して変数にした物） */
interface Variants {
  shadeColor: V3
  shadingShift: F
  shadingToony: F
  rimLightingMix: F
  /** (parametric rim + matcap) × rim の掛け算のテクスチャ */
  rim: V3
}

/** BRDF_Lambert（色 / π。型の上だけ vec3 にする） */
const lambert = (c: V3) => BRDF_Lambert({ diffuseColor: c }) as unknown as V3

/** ライトの影の値（AnalyticLightNode が作る shadowNode。影を落とさないライト・影を受けない物は無い） */
interface ShadowedLightNode {
  light?: { castShadow?: boolean }
  shadowNode?: Node | null
  baseColorNode?: Node | null
  colorNode?: Node
}

/** MToon の光の式（WebGL の MToonMaterial と同じ式。影は shading に掛ける） */
class VrmMToonLightingModel extends LightingModel {
  private readonly v: Variants

  constructor(v: Variants) {
    super()
    this.v = v
  }

  /** 明暗の度合い（WebGL の getShading。影 shadow を掛ける） */
  private shading(dotNL: F, shadow: F) {
    const feather = float(1).sub(this.v.shadingToony)
    return dotNL.add(this.v.shadingShift).sub(feather.negate()).div(feather.mul(2)).clamp().mul(shadow)
  }

  direct(lightData: Parameters<LightingModel['direct']>[0], builder: NodeBuilder) {
    const { lightDirection, lightColor, lightNode, reflectedLight } = lightData as unknown as {
      lightDirection: V3
      lightColor: V3
      lightNode?: ShadowedLightNode
      reflectedLight: { directDiffuse: V3; directSpecular: V3 }
    }
    // 影はライトが影を落とし、この物が影を受けるときだけ（ライトの node はほかの材質と共有なので、shadowNode があっても受けない物には掛けない）
    const receives = (builder as unknown as { object?: { receiveShadow?: boolean } }).object?.receiveShadow === true && lightNode?.light?.castShadow === true
    const shadow = receives && lightNode?.shadowNode ? float(lightNode.shadowNode as F) : float(1)
    const dotNL = normalView.dot(lightDirection).clamp(-1, 1)
    const shading = this.shading(dotNL, shadow)
    reflectedLight.directDiffuse.addAssign(lightColor.mul(lambert(mix(this.v.shadeColor, diffuseColor.rgb, shading))))
    // リムの光（WebGL: リムに掛ける明るさは、影を掛けないライトの色の和 / π を rimLightingMix で混ぜた物）
    reflectedLight.directSpecular.addAssign(this.v.rim.mul(lambert(lightColor)).mul(this.v.rimLightingMix))
  }

  indirect(builder: NodeBuilder) {
    const { irradiance, reflectedLight } = (builder as unknown as { context: { irradiance: V3; reflectedLight: { indirectDiffuse: V3; indirectSpecular: V3 } } }).context
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(lambert(diffuseColor.rgb)))
    // リムの光の残り: (1 − rimLightingMix) と、空の光の分（rimLightingMix × 空の光 / π）
    reflectedLight.indirectSpecular.addAssign(this.v.rim.mul(this.v.rimLightingMix.oneMinus().add(lambert(irradiance).mul(this.v.rimLightingMix))))
  }
}

/** parametric rim（WebGL の MToon と同じ式。法線は normalView） */
function parametricRim(color: V3, lift: F, power: F) {
  const viewDir = modelViewPosition.normalize()
  const dotNV = normalView.dot(viewDir.negate())
  return float(1).sub(dotNV).add(lift).clamp().pow(power).mul(color)
}

/** WebGL の MToonMaterial と同じ見た目にした MToonNodeMaterial（上の 1〜4） */
export class VrmMToonNodeMaterial extends MToonNodeMaterial {
  private variants: Variants | null = null

  constructor(parameters?: ConstructorParameters<typeof MToonNodeMaterial>[0]) {
    super(parameters)
    // ライトの色に影を掛けない（影は光の式の中で shading に掛ける。AnalyticLightNode.setupShadow の getShadow）
    this.contextNode = context({ getShadow: (lightNode: ShadowedLightNode) => lightNode.baseColorNode ?? lightNode.colorNode })
    // three-vrm の setupVariants が呼ぶ parametric rim の部品（private）を、normalView で組む物に替える（元は transformedNormalView を読む）
    ;(this as unknown as { _setupParametricRimNode: () => V3 })._setupParametricRimNode = () => this.rimNode()
  }

  override copy(source: MToonNodeMaterial): this {
    super.copy(source)
    this.alphaTest = source.alphaTest
    return this
  }

  override setupVariants() {
    super.setupVariants()
    const p = this as unknown as MToonParts
    this.variants = {
      shadeColor: p._setupShadeColorNode().toVar('VrmShadeColor'),
      shadingShift: p._setupShadingShiftNode().toVar('VrmShadingShift'),
      shadingToony: p._setupShadingToonyNode().toVar('VrmShadingToony'),
      rimLightingMix: p._setupRimLightingMixNode().toVar('VrmRimLightingMix'),
      rim: this.rimNode().add(p._setupMatcapNode()).mul(p._setupRimMultiplyNode()).toVar('VrmRim'),
    }
  }

  /** parametric rim（three-vrm の _setupParametricRimNode と同じ値の選び方。法線だけ normalView） */
  private rimNode() {
    const p = this as unknown as MToonParts
    const color = p.parametricRimColorNode != null ? vec3(p.parametricRimColorNode as V3) : (materialReference('parametricRimColorFactor', 'color') as unknown as V3)
    const lift = p.parametricRimLiftNode != null ? float(p.parametricRimLiftNode as F) : (materialReference('parametricRimLiftFactor', 'float') as unknown as F)
    const power = p.parametricRimFresnelPowerNode != null ? float(p.parametricRimFresnelPowerNode as F) : (materialReference('parametricRimFresnelPowerFactor', 'float') as unknown as F)
    return parametricRim(color, lift, power)
  }

  override setupLightingModel() {
    if (!this.variants) throw new Error('VrmMToonNodeMaterial: setupVariants より前に光の式を組み立てた')
    return new VrmMToonLightingModel(this.variants) as unknown as ReturnType<MToonNodeMaterial['setupLightingModel']>
  }
}
