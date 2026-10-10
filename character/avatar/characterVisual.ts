import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { actionPose, applyGait, blendPose, createPose, restPose, setBodyMetrics, type BodyMetrics, type BodyPose } from './body'
import { blendHand, createHand, HAND_SMOOTHING, HANDS, setHand } from './hands'
import { applyHandFingers, applyHandTwist, createHandsRig, type HandsRig } from './vrmHands'
import { stepLength, WALK_SPEED } from './locomotion'
import type { Character, CharacterAnchors, CharacterVisualLike } from './character'
import type { MotionClipFrame, VisualFrame } from './layers'
import { localShadowCasters } from '../../world/outdoor/town/shadows'
import { VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation'
import { estimateHeight, getBone, loadVrm, measureLowestPoint, releaseVrm } from './loadVrm'
import { addBoneRotation, idleBasePose, poseQuaternion, setBone, type Pose } from './pose'
import { applyFootIk, type FootIkState } from './footIk'
import { loadVrmAnimation } from './vrmAnimation'
import { VISUAL_DEFAULTS, type VisualConfig } from './visualConfig'
import type { Car } from '../../world/outdoor/transit/vehicle'

/**
 * キャラクター（VRM）の見た目（three の形。docs/design/map-split.md §5 の「段 3 の作りの決めごと」）。
 * Character の動き（ch.motion）に合わせて立たせ、待機の動き・歩き・立ち寄り先での行動・視線・まばたきを付ける。
 * キャラクターに固有の身ぶり・反応・視線・表情・飾りは姿勢の層（ch.layers。character/avatar/layers.ts）と表情（ch.expressions。character/avatar/expressions.ts）から
 * 段ごとに入れる（kanon-lab の花音は src/kanon/KanonAvatar.tsx が付ける）。
 * VRM（url。assetBase からの相対パス。落としたファイルの blob: の URL など、絶対の URL ならそのまま）が無い・読み込めないときは、
 * 読み込みの状態（onStatus）を missing / error にする（案内は使う側）。
 *
 * 使い方: createCharacterVisual(ch, opts) で作り、object をシーンに置いて start() で読み込む。毎コマ update(t, dt, camera)
 * （Character に付けたら ch.updateVisual）。やめるときは stop()（読み込みの取り消しと、VRM をシーンから外す）。React（R3F）からは react/CharacterView.tsx。
 *
 * - 身長と足元の高さは読み込んだモデルから測る（height と比べて必要なら拡大縮小）
 * - 腕を下ろした待機姿勢 + 呼吸・体重移動・まばたき・カメラへの視線
 * - 手の形: 行動・反応ごとの手の形（character/avatar/hands.ts）を、指の骨・前腕のひねり・手首に入れる（character/avatar/vrmHands.ts）。
 *   切り替えは毎フレーム少しずつ近づけて、急に変わらないようにする。
 *   .vrma の再生中は腕と同じ決まりにそろえる: アニメーションの指（無ければコードの手の形）の上に、
 *   行動・反応の手の形を腕の姿勢と同じ強さ（overlay）で重ねる
 * - 待機・歩きの .vrma（`pnpm sync:anim` で作る）があれば、それを再生し、行動・反応の身ぶりはコードの姿勢をその強さで上に重ねる。
 *   立ち寄り先での行動（立ち位置の待機 present を除く）と層の lower の身ぶりは全身、ほかの身ぶりは上半身だけ
 *   （足は .vrma の待機の立ち方のまま、床を滑らないように）。どちらも強さ 1 なら、上半身の向きはコードだけのときと同じになる
 * - 立ったままの全身の身ぶり（clips。花音は kanon.gesture の look_around など）: 読み込んだクリップを、層の clip が返す強さ・時刻で
 *   待機の上に重ねる（腰から下もモーションのまま）。その間は首・目のカメラへの追従を弱めて、モーションの頭の動きを打ち消さないようにする。
 *   待機の .vrma が無いとき（コードの動き）は読み込まない
 */

/** 読み込みの状態（idle = まだ読み込んでいない・やめた。使う側へは loading 以降を知らせる） */
export type CharacterVisualStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

/** 待機の上に重ねる全身のクリップ（.vrma） */
export interface CharacterVisualClip {
  /** 名前（層の clip が返す名前） */
  name: string
  /** assetBase からの相対パス（絶対の URL ならそのまま。assetUrl） */
  url: string
  /** 身ぶりの長さ（秒）。クリップがこれより長いと終わりが切れるので、読み込んだときに警告を出す */
  length?: number
}

/** createCharacterVisual の引数（共通の設定 character/avatar/visualConfig.ts の欄も、ここで置き換えられる） */
export interface CharacterVisualOptions extends Partial<VisualConfig> {
  /** 読み込む VRM（assetBase からの相対パス。落としたファイルの blob: の URL など、絶対の URL ならそのまま。assetUrl） */
  url: string
  /** 設定上の身長（m）。読み込んだモデルの実測値とこれを比べて、必要なら拡大縮小する */
  height: number
  /** VRM・.vrma の置き場（url・animations・clips の相対パスの前に付ける。絶対の URL には付けない。kanon-lab は import.meta.env.BASE_URL） */
  assetBase: string
  /** 待機の上に重ねる全身のクリップ（待機の .vrma があるときだけ、この順で読み込む） */
  clips?: readonly CharacterVisualClip[]
  /** 読み込みの状態が変わったとき（missing・error は error に読み込めなかった理由） */
  onStatus?: (status: Exclude<CharacterVisualStatus, 'idle'>, error?: unknown) => void
}

/** 読み込んだ VRM に付けた物（層の onLoad へ渡す。?debug でコンソールから見る用） */
export interface CharacterVisualRig {
  springReady: boolean
  /** 手の骨と回転の軸 */
  hands: HandsRig
  /** .vrma があれば、待機と歩きのアニメーション */
  mixer: THREE.AnimationMixer | null
  idle: THREE.AnimationAction | null
  walk: THREE.AnimationAction | null
  /** 歩きの .vrma を 1 倍の速さで再生したときに、足が滑らない進む速さ（m/s） */
  walkSpeed: number
  /** 腰の骨の元の位置（.vrma は腰を動かすので、コードの姿勢を重ねるときに戻す先） */
  hipsRest: THREE.Vector3
  /** 立った待機姿勢の足首（足の骨）の、靴底からの高さ（m。歩く間の立脚の膝の直し） */
  ankleRest: number
  /** 行動・反応を重ねるときの、コードの姿勢（animatedBones の回転） */
  codePose: THREE.Quaternion[]
  /** 立ったままの全身の身ぶり（読み込めたものだけ） */
  motions: Map<string, THREE.AnimationAction>
}

/** キャラクターの見た目（Character の visual に付けると ch.updateVisual で進む） */
export interface CharacterVisual extends CharacterVisualLike {
  /** シーンに置く物（位置・向きは毎コマ ch.motion から。VRM はこの下に入れる。VRM が届くまでは動かさない） */
  readonly object: THREE.Group
  /** 読み込みの状態 */
  readonly status: CharacterVisualStatus
  /** 読み込んだ VRM（読み込むまで null） */
  readonly vrm: VRM | null
  /** 読み込んだ VRM に付けた物（読み込むまで null） */
  readonly rig: CharacterVisualRig | null
  /** 使っている共通の設定（既定値と引数を合わせた物） */
  readonly config: Readonly<VisualConfig>
  /** 読み込みを始める（読み込みの状態は loading → ready / missing / error） */
  start(): void
  /** 読み込みを取り消し、VRM をシーンから外す（もう一度 start() で読み込み直せる）。読んだ VRM は片付けない（片付けるのは dispose()） */
  stop(): void
  /**
   * 片付ける: stop() をして、この見た目が読んだ VRM の形・素材・テクスチャを片付け（VRMUtils.deepDispose）、Character の縁の光の素材の一覧
   * （ch.rim.tuned）から外す。読み込みの途中なら、あとで届いた VRM もすぐ片付ける。キャラクターの表情がこの VRM につないであれば外す。
   * VRM を入れ替える使う側は、前の見た目の dispose() を呼んでから新しい見た目を作る（層の onLoad で VRM に付けた物は、層が片付ける）
   */
  dispose(): void
  /** 毎コマ（t = シーンの経過秒、dt = 前のコマからの秒（丸めない）、camera = 見ているカメラ） */
  update(t: number, dt: number, camera: THREE.Camera): void
}

/** 腰から下のボーン（脚を使わない身ぶりでは .vrma のままにする） */
const LOWER_BONES = new Set<VRMHumanBoneName>(['hips', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes'])

/**
 * 毎フレーム回転を作り直すボーン（基本姿勢 + 手続き的な動き。指は vrmHands.ts が毎フレーム入れる）。
 * .vrma の再生中に行動・反応の姿勢を重ねるときも、このボーンをコードの姿勢に近づける
 */
function animatedBones(basePose: Pose): VRMHumanBoneName[] {
  return Array.from(
    new Set<VRMHumanBoneName>([
      ...(Object.keys(basePose) as VRMHumanBoneName[]),
      'hips',
      'spine',
      'chest',
      'upperChest',
      'neck',
      'head',
      'leftUpperLeg',
      'rightUpperLeg',
      'leftLowerLeg',
      'rightLowerLeg',
      'leftFoot',
      'rightFoot',
      'leftToes',
      'rightToes',
    ]),
  )
}

/** 腕を「下ろした状態」の向きから T ポーズの向きへ直す回転（体の左 = +1） */
const R0 = { L: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), R: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)) }
const R0inv = { L: R0.L.clone().invert(), R: R0.R.clone().invert() }
const _e = new THREE.Euler()
const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()

/** 共通の姿勢（character/avatar/body.ts）を VRM の正規化ボーンに入れる */
function applyBodyPose(vrm: VRM, pose: BodyPose) {
  const set = (name: VRMHumanBoneName, q: THREE.Quaternion) => {
    vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.copy(q)
  }
  for (const [armKey, sideKey, side] of [
    ['armL', 'L', 1],
    ['armR', 'R', -1],
  ] as const) {
    const a = pose[armKey]
    // 上腕: 下ろした腕の向きで作った回転 Qp を、T ポーズの向きに直す（Qp · R0⁻¹）
    _qa.setFromEuler(_e.set(-a.raise, -side * a.twist, side * a.out, 'XZY'))
    set(side === 1 ? 'leftUpperArm' : 'rightUpperArm', _qb.copy(_qa).multiply(R0inv[sideKey]))
    // 前腕: 肘の曲げを T ポーズの向きに直す（R0 · E · R0⁻¹）
    _qa.setFromEuler(_e.set(-a.elbow, 0, side * a.elbowSide))
    set(side === 1 ? 'leftLowerArm' : 'rightLowerArm', _qb.copy(R0[sideKey]).multiply(_qa).multiply(R0inv[sideKey]))
  }
  // 脚（T ポーズでも下向きなので、そのまま前後に振る）
  set('leftUpperLeg', _qa.setFromEuler(_e.set(-pose.thighL, 0, 0.02)))
  set('rightUpperLeg', _qa.setFromEuler(_e.set(-pose.thighR, 0, -0.02)))
  set('leftLowerLeg', _qa.setFromEuler(_e.set(pose.kneeL, 0, 0)))
  set('rightLowerLeg', _qa.setFromEuler(_e.set(pose.kneeR, 0, 0)))
  // 背骨: 前傾・傾き・ひねりを 2 か所に分ける
  set('spine', _qa.setFromEuler(_e.set(pose.lean * 0.5 + 0.02, pose.twist * 0.5, pose.tilt * 0.5)))
  set('chest', _qa.setFromEuler(_e.set(pose.lean * 0.5 - 0.02, pose.twist * 0.5, pose.tilt * 0.5)))
}

/** 揺れもの（three-vrm の spring bone）の今と前の先の位置（シーンの座標。center が無いもの）を、車室 car の動きと一緒に運ぶ */
function carrySprings(vrm: VRM, car: Car, weight: number) {
  const mgr = vrm.springBoneManager
  if (!mgr) return
  for (const j of mgr.joints) {
    const jj = j as unknown as { center: THREE.Object3D | null; _currentTail?: THREE.Vector3; _prevTail?: THREE.Vector3 }
    if (jj.center || !jj._currentTail || !jj._prevTail) continue
    car.carry(jj._currentTail, weight)
    car.carry(jj._prevTail, weight)
  }
}

/** 絶対の URL（スキームで始まる blob:・data:・http(s): など、か / で始まる物） */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:|^\//i

/**
 * VRM・.vrma の URL（url が絶対の URL ならそのまま、ほかは assetBase の後ろに付ける）。使う側が落としたファイル（URL.createObjectURL の blob:）を
 * そのまま渡せるように（段 6 の例のアプリ。docs/design/map-split.md §8）。kanon-lab の URL は相対なので、前と同じ URL になる
 */
function assetUrl(base: string, url: string) {
  return ABSOLUTE_URL.test(url) ? url : `${base}${url}`
}

/**
 * キャラクターの見た目を作る（まだ読み込まない。start() で読み込む）。Character に付けるのは使う側（ch.visual = createCharacterVisual(ch, …)）。
 * 共通の設定は character/avatar/visualConfig.ts の既定値に、opts の同じ名前の欄を上書きした物（欄ごと。mtoon の既定は ch.rim の物）
 */
export function createCharacterVisual(ch: Character, opts: CharacterVisualOptions): CharacterVisual {
  return new VrmCharacterVisual(ch, opts)
}

class VrmCharacterVisual implements CharacterVisual {
  readonly object = new THREE.Group()
  readonly config: Readonly<VisualConfig>
  status: CharacterVisualStatus = 'idle'
  vrm: VRM | null = null
  rig: CharacterVisualRig | null = null

  private readonly ch: Character
  private readonly url: string
  private readonly height: number
  private readonly assetBase: string
  private readonly clips: readonly CharacterVisualClip[] | undefined
  private readonly onStatus: CharacterVisualOptions['onStatus']
  /** 待機の基本姿勢と、毎フレーム回転を作り直すボーン */
  private readonly basePose: Pose
  private readonly animatedBones: VRMHumanBoneName[]
  /** 読み込みの回（start・stop で進める。古い読み込みの結果は捨てる） */
  private run = 0
  /** dispose() をした時の読み込みの回（この回までに始めた読み込みの VRM は、届いたらすぐ片付ける） */
  private disposedRun = 0
  /** 読み込んで置いた VRM のうち、まだ片付けていない物（stop() では片付けない。dispose() で片付ける） */
  private readonly owned = new Set<VRM>()

  // 揺れものの先を最後に運んだ車室の動き（車室の serial）
  private springCarry = -1
  // 足の高さ合わせの状態（足ごとのなめらかにした高さの差）
  private readonly footIk: FootIkState = { dL: 0, dR: 0, drop: 0, lift: 0, applied: 0, lastY: null }
  // アニメーションの状態
  private readonly anim = { nextBlink: 2, blinkAt: -100, headYaw: 0, headPitch: 0 }
  private readonly poses = { rest: createPose(), action: createPose(), out: createPose() }
  /** 今の手の形（姿勢の手の形へ少しずつ近づける） */
  private readonly hands = { L: createHand(), R: createHand() }
  private readonly lookProxy = new THREE.Object3D()
  private readonly tmp = {
    q: new THREE.Quaternion(),
    v: new THREE.Vector3(),
    head: new THREE.Vector3(),
    target: new THREE.Vector3(),
    inv: new THREE.Quaternion(),
    fwd: new THREE.Vector3(),
  }
  // 層へ渡す物（毎コマ書き直す。vrm・camera はそのコマの物）
  private readonly frame: { -readonly [K in keyof VisualFrame]: VisualFrame[K] }

  constructor(ch: Character, opts: CharacterVisualOptions) {
    const { url, height, assetBase, clips, onStatus, ...over } = opts
    this.ch = ch
    this.url = url
    this.height = height
    this.assetBase = assetBase
    this.clips = clips
    this.onStatus = onStatus
    this.config = { ...VISUAL_DEFAULTS, mtoon: ch.rim.mtoon, ...over }
    this.basePose = idleBasePose(this.config.idle)
    this.animatedBones = animatedBones(this.basePose)
    this.frame = { ch, vrm: null as unknown as VRM, t: 0, dt: 0, camera: null as unknown as THREE.Camera }
  }

  start() {
    const run = ++this.run
    const character = this.ch
    const cfg = this.config
    const base = this.assetBase
    const height = this.height
    const clips = this.clips
    const onStatus = this.onStatus
    // 読み込むたびに初めから（揺れもの・足・まばたき・首・手の形）
    this.springCarry = -1
    Object.assign(this.footIk, { dL: 0, dR: 0, drop: 0, lift: 0, applied: 0, lastY: null })
    Object.assign(this.anim, { nextBlink: 2, blinkAt: -100, headYaw: 0, headPitch: 0 })
    setHand(this.hands.L, HANDS.relaxed)
    setHand(this.hands.R, HANDS.relaxed)
    this.status = 'loading'
    onStatus?.('loading')
    loadVrm(assetUrl(base, this.url), character.rim, { mtoon: cfg.mtoon, castShadow: cfg.castShadow }).then(async (result) => {
      if (run !== this.run) {
        if (result.status === 'ready') this.dropStale(run, result.vrm)
        return
      }
      if (result.status !== 'ready') {
        this.status = result.status
        onStatus?.(result.status, result.status === 'error' ? result.error : undefined)
        return
      }
      const loaded = result.vrm
      // 待機姿勢にしてから測る（腕を下ろした状態の足元・身長）
      applyPose(loaded, this.basePose)
      loaded.update(0)
      loaded.scene.updateMatrixWorld(true)
      // 身長は「靴底から目の高さ」で推定する（ボーンの原点と靴底のずれを含めないため）
      const sole = measureLowestPoint(loaded.scene)
      const estimated = estimateHeight(loaded, sole, cfg.eyeHeightRatio)
      if (estimated && cfg.normalizeHeight && Math.abs(estimated - height) / height > cfg.allowedHeightError) {
        loaded.scene.scale.setScalar(height / estimated)
        loaded.scene.updateMatrixWorld(true)
      }
      const lowest = measureLowestPoint(loaded.scene)
      loaded.scene.position.y = -lowest
      loaded.scene.updateMatrixWorld(true)
      const finalHeight = estimateHeight(loaded, 0, cfg.eyeHeightRatio) ?? 0
      character.anchors.measuredHeight = finalHeight
      // 体の寸法（座る姿勢の腰の高さ・机に手を置く高さ。character/avatar/body.ts）
      measureBody(loaded, character.body)
      console.info(
        `[sakurami-cho] VRM を読み込みました: 推定身長 ${(estimated ?? 0).toFixed(3)}m → ${finalHeight.toFixed(3)}m（設定 ${height}m）、足元の補正 ${(-lowest).toFixed(3)}m`,
      )
      // 腰の元の位置は、アニメーションが動かす前に覚えておく
      const hipsRest = loaded.humanoid.getNormalizedBoneNode('hips')?.position.clone() ?? new THREE.Vector3()
      const ankleRest = loaded.humanoid.getRawBoneNode('leftFoot')?.getWorldPosition(new THREE.Vector3()).y ?? 0.08
      // 視線のアニメーション用の入れ物（無いと createVRMAnimationClip が警告を出して自分で作る）
      if (loaded.lookAt && !loaded.scene.children.some((o) => o instanceof VRMLookAtQuaternionProxy)) {
        const proxy = new VRMLookAtQuaternionProxy(loaded.lookAt)
        proxy.name = 'VRMLookAtQuaternionProxy'
        loaded.scene.add(proxy)
      }
      // 待機・歩きのアニメーション（.vrma）があれば使う
      const [idleClip, walkClip] = await Promise.all([
        loadVrmAnimation(assetUrl(base, cfg.animations.idle), loaded),
        loadVrmAnimation(assetUrl(base, cfg.animations.walk), loaded),
      ])
      // 立ったままの全身の身ぶり（待機の .vrma があるときだけ。無ければコードの待機の上には重ねない）
      const motionClips = idleClip && clips ? await Promise.all(clips.map(async (c) => [c, await loadVrmAnimation(assetUrl(base, c.url), loaded)] as const)) : []
      if (run !== this.run) {
        this.dropStale(run, loaded)
        return
      }
      const mixer = idleClip || walkClip ? new THREE.AnimationMixer(loaded.scene) : null
      const idle = mixer && idleClip ? mixer.clipAction(idleClip.clip) : null
      const walk = mixer && walkClip ? mixer.clipAction(walkClip.clip) : null
      idle?.play()
      walk?.play()
      const motions = new Map<string, THREE.AnimationAction>()
      for (const [spec, loadedClip] of motionClips) {
        if (!mixer || !loadedClip) continue
        // 再生する位置は毎フレーム直接入れる（mixer には進めさせない）
        const action = mixer.clipAction(loadedClip.clip).setEffectiveWeight(0).setEffectiveTimeScale(0)
        action.play()
        motions.set(spec.name, action)
        if (spec.length !== undefined && loadedClip.clip.duration > spec.length + 0.15) {
          console.warn(`[sakurami-cho] 身ぶり ${spec.name} の .vrma（${loadedClip.clip.duration.toFixed(1)} 秒）が、身ぶりの長さ（GESTURE_MS）より長いので、終わりが切れます`)
        }
      }
      // 速さの情報が無い .vrma は、決まり（WALK_SPEED で歩くループ）どおりとみなす
      const walkSpeed = walkClip?.walkSpeed ?? WALK_SPEED
      if (mixer) {
        const speedNote = walkClip ? `（1 倍で ${walkSpeed.toFixed(2)} m/s）` : ''
        console.info(`[sakurami-cho] VRM アニメーション: 待機 ${idle ? 'あり' : 'なし'} / 歩き ${walk ? 'あり' : 'なし'}${speedNote} / 身ぶり ${motions.size} 本`)
      }
      const r: CharacterVisualRig = {
        hands: createHandsRig(loaded),
        springReady: false,
        mixer,
        idle,
        walk,
        walkSpeed,
        hipsRest,
        ankleRest,
        codePose: this.animatedBones.map(() => new THREE.Quaternion()),
        motions,
      }
      this.rig = r
      // シーンに置き、表情を読み込んだ VRM につなぎ、層の読み込み時の準備を付けた順に（花音はペンダント → 表情 → 工具 → ?debug の道具。Object3D・material を作る順）
      this.object.add(loaded.scene)
      character.expressions.bind(loaded)
      const layers = character.layers.list
      for (let i = 0; i < layers.length; i++) layers[i].onLoad?.(loaded, character, r)
      // 次のコマから動かす
      this.vrm = loaded
      this.owned.add(loaded)
      this.status = 'ready'
      onStatus?.('ready')
    })
    // 外にいるとき、まわりの細かい影の地図に入れる（地面・テラスにキャラクターの影が落ちる）
    localShadowCasters.add(this.object)
  }

  stop() {
    this.run++
    localShadowCasters.delete(this.object)
    this.vrm?.scene.removeFromParent()
    this.vrm = null
    this.rig = null
    this.status = 'idle'
  }

  dispose() {
    const current = this.vrm
    this.stop()
    this.disposedRun = this.run
    // キャラクターの表情が今の VRM につないであれば外す（ほかの見た目が読んだ VRM につなぎ替えていれば、そのまま）
    if (current && this.ch.visual === this) this.ch.expressions.bind(null)
    for (const vrm of this.owned) releaseVrm(vrm, this.ch.rim)
    this.owned.clear()
  }

  /** 取り消した読み込みの VRM が届いた: dispose() のあとなら、すぐ片付ける（stop() だけなら今までどおり何もしない） */
  private dropStale(run: number, vrm: VRM) {
    if (run <= this.disposedRun) releaseVrm(vrm, this.ch.rim)
  }

  update(t: number, delta: number, camera: THREE.Camera) {
    const vrm = this.vrm
    const r = this.rig
    if (!vrm || !r) return
    const character = this.ch
    const cfg = this.config
    const group = this.object
    const a = this.anim
    const poses = this.poses
    const hands = this.hands
    const tmp = this.tmp
    const lookProxy = this.lookProxy
    const ANIMATED_BONES = this.animatedBones
    const m = character.motion
    const layers = character.layers.list
    const f = this.frame
    f.vrm = vrm
    f.t = t
    f.dt = delta
    f.camera = camera
    // 層のそのコマの計算（反応の強さなど）
    for (let i = 0; i < layers.length; i++) layers[i].begin?.(f)
    // 立ったままの全身の身ぶり（読み込めていれば。最初に返した層の物）。歩き出したら抜ける
    let clip: MotionClipFrame | null = null
    for (let i = 0; i < layers.length && !clip; i++) clip = layers[i].clip?.(f) ?? null
    const motion = clip ? r.motions.get(clip.name) : undefined
    const mw = motion && clip ? clip.weight * (1 - m.walk) : 0

    // --- 位置と向き（共通の歩きの制御から） ---
    group.position.copy(m.position)
    group.rotation.y = m.heading

    // 最初のフレーム: 立ち位置に置いた状態で揺れもの（おさげ・ペンダント）を初期化する
    if (!r.springReady) {
      vrm.scene.updateMatrixWorld(true)
      vrm.springBoneManager?.setInitState()
      vrm.springBoneManager?.reset()
      r.springReady = true
    }

    // --- 姿勢: 待機 → 行動 → 歩き → 層（反応・身ぶり。character/avatar/body.ts の共通の姿勢） ---
    const pose = poses.out
    restPose(poses.rest, t)
    if (m.action && m.actionBlend > 0.001) {
      actionPose(m.action, t, poses.action, m.seat, character.body)
      blendPose(poses.rest, poses.action, m.actionBlend * m.actionBlend * (3 - 2 * m.actionBlend), pose)
    } else blendPose(poses.rest, poses.rest, 0, pose)
    const bobBeforeGait = pose.bob
    applyGait(pose, m.gait, m.walk, m.speed)
    // 歩きの .vrma は腰の上下の揺れを含むので、コードの歩きの上下の揺れは足さない
    if (r.walk) pose.bob = bobBeforeGait
    // 層の身ぶり（付けた順に重ねる）
    for (let i = 0; i < layers.length; i++) layers[i].pose?.(pose, f)
    group.position.y += pose.bob
    // 座るときは体ごと前（座面の上）へ
    if (Math.abs(pose.shift) > 1e-4) {
      group.position.x += Math.sin(m.heading) * pose.shift
      group.position.z += Math.cos(m.heading) * pose.shift
    }
    // 手の形: 行動の切り替え（kanon.activity など）でも急に変わらないよう、少しずつ近づける
    const kh = 1 - Math.exp(-delta * HAND_SMOOTHING)
    blendHand(hands.L, pose.handL, kh, hands.L)
    blendHand(hands.R, pose.handR, kh, hands.R)

    for (const name of ANIMATED_BONES) setBone(vrm, name, tmp.q.identity())
    applyPose(vrm, this.basePose)
    // 指はまずコードの手の形にする（.vrma に指が無ければ、これがそのまま残る）
    applyHandFingers(r.hands, hands.L, hands.R)
    if (r.mixer) {
      // .vrma があれば: 行動・反応（身ぶりを含む）はその上に重ねる。立ち位置の待機（present）は .vrma の待機そのものなので重ねない。
      // 腰から下は、行動と層の lower の身ぶり（花音はスパチャで跳ねる cheer）のときだけ。ほかの身ぶりは上半身だけに重ねる
      // 立ったままの全身の身ぶりの間は、立ち寄り先での行動の姿勢より身ぶりを優先する
      const actionW = (m.action === 'present' ? 0 : m.actionBlend) * (1 - mw)
      let overlay = actionW
      let lower = actionW
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i]
        if (l.overlay) overlay = Math.max(overlay, l.overlay(f))
        if (l.lower) lower = Math.max(lower, l.lower(f))
      }
      const hips = vrm.humanoid.getNormalizedBoneNode('hips')
      if (overlay > 0.001) {
        // 重ねる先 = コードだけのときの姿勢（腰は元の位置）を覚えておく
        applyBodyPose(vrm, pose)
        ANIMATED_BONES.forEach((name, i) => {
          const node = vrm.humanoid.getNormalizedBoneNode(name)
          if (node) r.codePose[i].copy(node.quaternion)
        })
      }
      // 待機と歩きを歩きの強さで混ぜ、進む速さに合わせて再生の速さを変える（足が床を滑らないように）。
      // 立ったままの全身の身ぶりは、その上にその強さで重ねる（1 回だけ。繰り返すアニメーション（腕組み）は身ぶりの長さだけ繰り返す）
      r.idle?.setEffectiveWeight((r.walk ? 1 - m.walk : 1) * (1 - mw))
      if (r.walk) {
        r.walk.setEffectiveWeight(m.walk * (1 - mw))
        // 町の中の移動の早送り（timeScale）では、その倍で。町の石段の上は踏面ごとに 1 歩（stride）になるよう、歩幅の比で速める
        r.walk.setEffectiveTimeScale(Math.max(0.2, m.speed / r.walkSpeed) * m.timeScale * (m.stride ? stepLength(m.speed) / m.stride : 1))
      }
      for (const action of r.motions.values()) {
        if (action !== motion) {
          action.setEffectiveWeight(0)
          continue
        }
        // 身ぶりの長さより明らかに短いアニメーション（腕組み）は繰り返し、それ以外は最後の姿勢で止める
        const d = action.getClip().duration
        const loops = clip!.length > d + 0.5
        action.time = loops ? clip!.time % d : Math.min(clip!.time, d - 1e-4)
        action.setEffectiveWeight(mw)
      }
      r.mixer.update(delta)
      if (overlay > 0.001) {
        ANIMATED_BONES.forEach((name, i) => {
          if (LOWER_BONES.has(name)) vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.slerp(r.codePose[i], lower)
        })
        hips?.position.lerp(r.hipsRest, lower)
        ANIMATED_BONES.forEach((name, i) => {
          if (LOWER_BONES.has(name)) return
          // 背骨の付け根では腰の回り（.vrma の待機の腰のひねりなど）を打ち消し、上半身の向きをコードの姿勢（腰は回さない）と同じにする。
          // 対象の位置に合わせた身ぶり（物に触る・画面を示す）の向きがずれないように
          const target = name === 'spine' && hips ? tmp.q.copy(hips.quaternion).invert().multiply(r.codePose[i]) : r.codePose[i]
          vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.slerp(target, overlay)
        })
        // 手の形も腕と同じ強さで
        applyHandFingers(r.hands, hands.L, hands.R, overlay)
        applyHandTwist(r.hands, hands.L, hands.R, overlay)
      }
    } else {
      applyBodyPose(vrm, pose)
      applyHandTwist(r.hands, hands.L, hands.R)
    }

    // --- 足を地面の高さに合わせる（ラボの外の坂・石段。中の平らな床では何もしない） ---
    applyFootIk(character, vrm, this.footIk, delta, r.ankleRest)

    // --- 視線と首: 行動の視線とカメラの方を混ぜ、層が見る先を書き換える（花音はコメントが来たらパネルを見る） ---
    const headBone = getBone(vrm, 'head')
    if (headBone) headBone.getWorldPosition(tmp.head)
    else tmp.head.copy(character.anchors.head)
    camera.getWorldPosition(tmp.target)
    // 層の見る先（付けた順に書き換える）と、注意の強さ（層の max）
    let attend = 0
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      if (l.look) attend = Math.max(attend, l.look(tmp.target, f))
    }
    const L = cfg.lookAt
    tmp.v.subVectors(tmp.target, tmp.head)
    group.getWorldQuaternion(tmp.inv)
    tmp.v.applyQuaternion(tmp.inv.invert())
    const camYaw = THREE.MathUtils.clamp(Math.atan2(tmp.v.x, tmp.v.z), -L.maxYaw, L.maxYaw)
    const camPitch = THREE.MathUtils.clamp(Math.atan2(tmp.v.y, Math.hypot(tmp.v.x, tmp.v.z)), -L.maxPitchDown, L.maxPitchUp)
    const lookCam = Math.max(pose.lookCamera * (1 - m.walk * 0.7), attend)
    const follow = THREE.MathUtils.lerp(L.headFollow, 0.75, attend)
    // 立ったままの全身の身ぶりの間は、首の追従を弱めて、モーションの頭の動き（見回す・見上げるなど）を打ち消さない
    const yawT = THREE.MathUtils.lerp(pose.headYaw, camYaw * follow, lookCam) * (1 - mw)
    const pitchT = THREE.MathUtils.lerp(-pose.headPitch, camPitch * follow, lookCam) * (1 - mw)
    const k = 1 - Math.exp(-delta * L.damping)
    a.headYaw += (yawT - a.headYaw) * k
    a.headPitch += (pitchT - a.headPitch) * k
    // うなずき（層の分を 0 から足す）
    let nod = 0
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      if (l.nod) nod += l.nod(f)
    }
    addBoneRotation(vrm, 'neck', -a.headPitch * 0.4, a.headYaw * 0.4, 0)
    addBoneRotation(vrm, 'head', -a.headPitch * 0.6 + nod, a.headYaw * 0.6, pose.headRoll)
    // 目は vrm.lookAt で（モデルの可動域の設定に従う）。見る先は首と同じ範囲に収める
    if (vrm.lookAt) {
      const dist = tmp.v.length() || 1
      tmp.v.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch)).multiplyScalar(dist)
      group.getWorldQuaternion(tmp.q)
      lookProxy.position.copy(tmp.v.applyQuaternion(tmp.q)).add(tmp.head)
      // 立ったままの全身の身ぶりの間は、目も頭の向き（顔の正面）へ寄せる（VRM 0.x の正規化したボーンは -Z が前）
      const headNode = mw > 0.001 ? vrm.humanoid.getNormalizedBoneNode('head') : null
      if (headNode) {
        tmp.fwd.set(0, 0, vrm.meta.metaVersion === '0' ? -1 : 1).applyQuaternion(headNode.getWorldQuaternion(tmp.q))
        lookProxy.position.lerp(tmp.fwd.multiplyScalar(dist).add(tmp.head), mw)
      }
      lookProxy.updateMatrixWorld()
      vrm.lookAt.target = lookProxy
    }

    // --- 表情（モデルに無い表情は ch.expressions が飛ばす）: 層の表情 → まばたき ---
    const ex = character.expressions
    for (let i = 0; i < layers.length; i++) layers[i].face?.(f)
    // まばたき（ランダムな間隔。強さは層が決める blinkScale を掛ける（花音は笑顔のときは閉じない））
    if (t > a.nextBlink) {
      a.blinkAt = t
      const [lo, hi] = cfg.idle.blinkInterval
      a.nextBlink = t + lo + ((t * 7.31) % 1) * (hi - lo)
    }
    const bt = t - a.blinkAt
    const blink = bt < 0.16 ? Math.sin((bt / 0.16) * Math.PI) : 0
    ex.set(cfg.blink, blink * ex.blinkScale)

    // 乗り物の車室の中: 揺れもの（おさげ・ペンダント）の先を車室と一緒に運ぶ（車室の動きを慣性で受けない。早送りの緑電・運河バスで、
    // 1 コマに大きく動く車室の分だけおさげが横へ流れていた。§7 の 219）
    const ride = character.ride
    const rideCar = ride.lastCar
    if (ride.attach > 0 && rideCar && this.springCarry !== rideCar.serial) {
      this.springCarry = rideCar.serial
      carrySprings(vrm, rideCar, ride.attach)
    }
    vrm.update(delta)

    // --- 共有する位置と、層の最後（花音はペンダント） ---
    writeAnchors(character.anchors, headBone, getBone(vrm, 'upperChest', 'chest'))
    for (let i = 0; i < layers.length; i++) layers[i].after?.(f)
  }
}

/** 体の位置（頭・胸）を Character の anchors へ書く（頭は頭のボーンの 6cm 上。カメラ・被写界深度・KB-001 などが読む） */
function writeAnchors(an: CharacterAnchors, head: THREE.Object3D | null, chest: THREE.Object3D | null) {
  if (head) {
    head.getWorldPosition(an.head)
    an.head.y += 0.06
  }
  if (chest) chest.getWorldPosition(an.chest)
  an.ready = true
}

const _ma = new THREE.Vector3()
const _mb = new THREE.Vector3()

/** 立った待機姿勢の VRM（足元を床に合わせたあと）から、股関節の高さと腕の長さを測る（character/avatar/body.ts の体の寸法。Character の body へ） */
function measureBody(vrm: VRM, body: BodyMetrics) {
  const node = (n: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(n)
  const leg = node('leftUpperLeg')
  const ua = node('leftUpperArm')
  const la = node('leftLowerArm')
  const hand = node('leftHand')
  if (!leg || !ua || !la || !hand) return
  const sceneY = vrm.scene.parent ? vrm.scene.parent.getWorldPosition(_mb).y : 0
  leg.getWorldPosition(_ma)
  const hipHeight = _ma.y - sceneY
  const shoulderAboveHip = ua.getWorldPosition(_mb).y - _ma.y
  const upperArm = ua.getWorldPosition(_ma).distanceTo(la.getWorldPosition(_mb))
  const foreArm = la.getWorldPosition(_ma).distanceTo(hand.getWorldPosition(_mb))
  if (hipHeight > 0.4 && hipHeight < 1.4 && upperArm > 0.1 && foreArm > 0.1 && shoulderAboveHip > 0.15 && shoulderAboveHip < 0.7) {
    setBodyMetrics(body, { hipHeight, upperArm, foreArm, shoulderAboveHip })
    console.info(`[sakurami-cho] 体の寸法: 股関節 ${hipHeight.toFixed(3)}m・肩は股関節の ${shoulderAboveHip.toFixed(3)}m 上・上腕 ${upperArm.toFixed(3)}m・前腕 ${foreArm.toFixed(3)}m`)
  }
}

const _poseQ = new THREE.Quaternion()

/** ポーズ（正規化ボーンの回転）を設定する */
function applyPose(vrm: VRM, pose: Pose) {
  const q = _poseQ
  for (const name of Object.keys(pose) as VRMHumanBoneName[]) {
    const node = vrm.humanoid.getNormalizedBoneNode(name)
    if (node) node.quaternion.copy(poseQuaternion(pose[name]!, q))
  }
}
