import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { HandShape } from './hands'

/**
 * 手の形（character/avatar/hands.ts）を VRM の骨に入れる: 指（thumb / index / middle / ring / little の各関節）・前腕のひねり・手首。
 *
 * 回転の軸は、読み込んだモデルの T ポーズの骨の位置から求める（指の向き・親指の向きはモデルごとに違うので、座標を書かない）。
 * VRM の T ポーズは手のひらが下（-Y）向き。指は「骨の向き × 手のひらの向き」の軸まわりに曲げると手のひら側へ曲がる。
 * 親指は、手のひらの方と、人差し指・中指の方の間へ寄せて曲げる。
 */

type Side = 'left' | 'right'
type FingerName = 'index' | 'middle' | 'ring' | 'little'

/** 指の関節ごとの最大の曲げ（ラジアン。曲げ 1 = 握りこぶし）: 付け根・第二関節・指先 */
const CURL_MAX = [1.45, 1.72, 1.05] as const
/** 指を開くときの付け根の振り（ラジアン。開き 1 のとき。+ で親指の側へ） */
const SPREAD_MAX: Record<FingerName, number> = { index: 0.2, middle: 0.04, ring: -0.1, little: -0.26 }
/** 親指: 付け根（中手骨）を寄せる最大の角度と、関節（基節・末節）の最大の曲げ（ラジアン） */
const THUMB_IN_MAX = 0.8
const THUMB_CURL_MAX = [0.85, 1.0] as const
/** 親指を寄せる向き（手のひらの方 : 指の方）と、関節を曲げる向き */
const THUMB_IN_MIX = { palm: 0.7, across: 0.7 }
const THUMB_CURL_MIX = { palm: 0.55, across: 0.85 }

const PALM = new THREE.Vector3(0, -1, 0)
const FINGERS: FingerName[] = ['index', 'middle', 'ring', 'little']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

interface Joint {
  node: THREE.Object3D
  /** 曲げる軸（正の角度で手のひら側へ） */
  curl: THREE.Vector3
}

interface HandRig {
  /** 前腕（ひねりの軸は腕の向き。正の角度で回内） */
  forearm: { node: THREE.Object3D; axis: THREE.Vector3 } | null
  /** 手首（正の角度で手のひら側へ曲げる） */
  hand: { node: THREE.Object3D; axis: THREE.Vector3 } | null
  fingers: { name: FingerName; joints: Joint[]; spreadAxis: THREE.Vector3 | null }[]
  /** 親指: 付け根（寄せる）と、関節（曲げる） */
  thumbBase: Joint | null
  thumbJoints: Joint[]
}

export interface HandsRig {
  L: HandRig | null
  R: HandRig | null
}

const bone = (vrm: VRM, name: string) => vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName)

/** 正規化ボーンの T ポーズでの位置（手首からの相対）。正規化ボーンは回転 0 で、position は親からのワールドの差 */
function offsetFromHand(node: THREE.Object3D, hand: THREE.Object3D, out: THREE.Vector3) {
  out.set(0, 0, 0)
  let n: THREE.Object3D | null = node
  while (n && n !== hand) {
    out.add(n.position)
    n = n.parent
  }
  return out
}

/** 骨の向き d を手のひらの方へ倒す軸（d × 手のひら） */
const curlAxis = (d: THREE.Vector3) => new THREE.Vector3().crossVectors(d, PALM).normalize()

/** v から d と手のひらの向きの成分を除いて正規化（手のひらの面の中で、d に直交する向き） */
function acrossDir(v: THREE.Vector3, d: THREE.Vector3) {
  const u = v.clone()
  u.addScaledVector(d, -u.dot(d))
  u.addScaledVector(PALM, -u.dot(PALM))
  return u.lengthSq() > 1e-10 ? u.normalize() : null
}

function createHandRig(vrm: VRM, side: Side, sign: 1 | -1): HandRig | null {
  const hand = bone(vrm, `${side}Hand`)
  if (!hand) return null
  const lowerArm = bone(vrm, `${side}LowerArm`)
  const v = new THREE.Vector3()

  // 前腕: 肘から手首の向きを軸に、左右で同じ向き（回内）になるよう符号をそろえる（本人の左 = +X）
  const forearm = lowerArm && hand.position.lengthSq() > 1e-10 ? { node: lowerArm, axis: hand.position.clone().normalize().multiplyScalar(sign) } : null

  // 指
  const fingers: HandRig['fingers'] = []
  const indexBase = bone(vrm, `${side}IndexProximal`)
  const littleBase = bone(vrm, `${side}LittleProximal`)
  // 親指の側（人差し指の付け根 − 小指の付け根）
  const towardThumb = indexBase && littleBase ? offsetFromHand(indexBase, hand, new THREE.Vector3()).sub(offsetFromHand(littleBase, hand, v)) : null
  for (const name of FINGERS) {
    const nodes = ['Proximal', 'Intermediate', 'Distal'].map((j) => bone(vrm, `${side}${cap(name)}${j}`))
    const joints: Joint[] = []
    let dir: THREE.Vector3 | null = null
    nodes.forEach((node, i) => {
      if (!node) return
      const child = nodes[i + 1]
      // 骨の向き = 次の関節への向き（指先の関節は 1 つ前の向き）
      if (child && child.position.lengthSq() > 1e-10) dir = child.position.clone().normalize()
      if (dir) joints.push({ node, curl: curlAxis(dir) })
    })
    const first = joints[0]
    let spreadAxis: THREE.Vector3 | null = null
    if (first && towardThumb && nodes[1]) {
      const d = nodes[1].position.clone().normalize()
      const u = acrossDir(towardThumb, d)
      if (u) spreadAxis = new THREE.Vector3().crossVectors(d, u).normalize()
    }
    if (joints.length) fingers.push({ name, joints, spreadAxis })
  }

  // 親指（three-vrm では VRM 0.x の親指も metacarpal / proximal / distal にそろう）
  const middleBase = bone(vrm, `${side}MiddleProximal`) ?? indexBase
  const thumbNodes = ['Metacarpal', 'Proximal', 'Distal'].map((j) => bone(vrm, `${side}Thumb${j}`))
  const thumbAxes: (Joint | null)[] = []
  let tdir: THREE.Vector3 | null = null
  thumbNodes.forEach((node, i) => {
    if (!node) {
      thumbAxes.push(null)
      return
    }
    const child = thumbNodes[i + 1]
    if (child && child.position.lengthSq() > 1e-10) tdir = child.position.clone().normalize()
    if (!tdir || !middleBase) {
      thumbAxes.push(null)
      return
    }
    // 寄せる先 = 手のひらの方と、中指の付け根の方（手のひらの面の中）を混ぜた向き
    const toMiddle = offsetFromHand(middleBase, hand, new THREE.Vector3()).sub(offsetFromHand(node, hand, v))
    const across = acrossDir(toMiddle, tdir) ?? new THREE.Vector3()
    const mix = i === 0 ? THUMB_IN_MIX : THUMB_CURL_MIX
    const target = PALM.clone().multiplyScalar(mix.palm).addScaledVector(across, mix.across)
    target.addScaledVector(tdir, -target.dot(tdir))
    const axis = new THREE.Vector3().crossVectors(tdir, target)
    thumbAxes.push(axis.lengthSq() > 1e-10 ? { node, curl: axis.normalize() } : null)
  })

  // 手首: 手首から中指の付け根への向きを、手のひら側へ曲げる軸
  const handDir = middleBase ? offsetFromHand(middleBase, hand, new THREE.Vector3()) : null
  const wrist = handDir && handDir.lengthSq() > 1e-10 ? { node: hand, axis: curlAxis(handDir.normalize()) } : null

  return {
    forearm,
    hand: wrist,
    fingers,
    thumbBase: thumbAxes[0] ?? null,
    thumbJoints: thumbAxes.slice(1).filter((j): j is Joint => j !== null),
  }
}

/** 読み込んだ VRM から手の骨と回転の軸を用意する（指の骨が無いモデルでは、その指は動かさない） */
export function createHandsRig(vrm: VRM): HandsRig {
  return { L: createHandRig(vrm, 'left', 1), R: createHandRig(vrm, 'right', -1) }
}

const _q = new THREE.Quaternion()
const _qs = new THREE.Quaternion()
const _id = new THREE.Quaternion()

/** 回転を重ねる（今の回転 · 軸まわりの angle の回転）。weight で強さを変える */
function addRotation(node: THREE.Object3D, axis: THREE.Vector3, angle: number, weight: number) {
  _q.setFromAxisAngle(axis, angle)
  if (weight < 1) _q.slerpQuaternions(_id, _q, weight)
  node.quaternion.multiply(_q)
}

/** 回転を設定する（weight < 1 なら今の回転から近づける） */
function setRotation(node: THREE.Object3D, q: THREE.Quaternion, weight: number) {
  if (weight >= 1) node.quaternion.copy(q)
  else node.quaternion.slerp(q, weight)
}

function applyHand(rig: HandRig, s: HandShape, weight: number, what: 'fingers' | 'arm') {
  if (what === 'arm') {
    // 前腕のひねりと手首の曲げは、腕の回転（コード or .vrma）に重ねる
    if (rig.forearm) addRotation(rig.forearm.node, rig.forearm.axis, s.pronate, weight)
    if (rig.hand) addRotation(rig.hand.node, rig.hand.axis, s.wrist, weight)
    return
  }
  // 指: 付け根で開き（手のひらの面の中で振る）、各関節を手のひら側へ曲げる
  for (const f of rig.fingers) {
    const curl = THREE.MathUtils.clamp(s[f.name], -0.15, 1.1)
    f.joints.forEach((j, i) => {
      _q.setFromAxisAngle(j.curl, curl * CURL_MAX[i])
      if (i === 0 && f.spreadAxis) {
        // 曲げるほど開きは小さく（握ると指がそろう）
        const spread = s.spread * SPREAD_MAX[f.name] * (1 - Math.min(1, Math.max(0, curl)) * 0.7)
        _q.premultiply(_qs.setFromAxisAngle(f.spreadAxis, spread))
      }
      setRotation(j.node, _q, weight)
    })
  }
  // 親指
  if (rig.thumbBase) setRotation(rig.thumbBase.node, _q.setFromAxisAngle(rig.thumbBase.curl, s.thumbIn * THUMB_IN_MAX), weight)
  rig.thumbJoints.forEach((j, i) => {
    setRotation(j.node, _q.setFromAxisAngle(j.curl, THREE.MathUtils.clamp(s.thumbCurl, -0.2, 1.1) * THUMB_CURL_MAX[i]), weight)
  })
}

/**
 * 指の骨に手の形を入れる。weight = 1 で置き換え、それより小さければ今の回転（.vrma の指など）から近づける。
 * weightR = 右手の強さ（省けば weight。片方の腕だけを重ねる行動。body.ts の ACTION_PART）
 */
export function applyHandFingers(rig: HandsRig, L: HandShape, R: HandShape, weight = 1, weightR = weight) {
  if (rig.L && weight > 0.001) applyHand(rig.L, L, weight, 'fingers')
  if (rig.R && weightR > 0.001) applyHand(rig.R, R, weightR, 'fingers')
}

/**
 * 前腕のひねりと手首の曲げを、今の腕の回転に重ねる（腕の姿勢を入れた後に呼ぶ）。weight は腕の姿勢と同じ強さ（weightR は右手。省けば weight）
 */
export function applyHandTwist(rig: HandsRig, L: HandShape, R: HandShape, weight = 1, weightR = weight) {
  if (rig.L && weight > 0.001) applyHand(rig.L, L, weight, 'arm')
  if (rig.R && weightR > 0.001) applyHand(rig.R, R, weightR, 'arm')
}
