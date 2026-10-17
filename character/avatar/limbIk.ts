import * as THREE from 'three'

/**
 * 2 本の骨の IK（脚・腕。three の Object3D のまま解く）。
 *
 * solveTwoBone: 上の骨 up（太もも・上腕）・下の骨 mid（すね・前腕）・先 end（足首・手首）の先を、ワールドの点 target へ届かせる
 * （届かなければ target の方へ伸ばし、近すぎれば曲げきった所まで）。膝・肘は pole（ワールドの点）の側へ曲げる。
 * 回すのは up と mid の回転（親の座標の quaternion）だけで、どちらも今の向きから最も小さい回転で動かす（骨のひねりは変えない）。
 * 骨の長さは今の位置から測る。シーンの行列（matrixWorld）は呼ぶ前に新しくしておくこと（呼んだ後は、up から下を新しくしてある）
 */

const _h = new THREE.Vector3()
const _k = new THREE.Vector3()
const _p = new THREE.Vector3()
const _t = new THREE.Vector3()
const _d = new THREE.Vector3()
const _b = new THREE.Vector3()
const _kt = new THREE.Vector3()
const _u = new THREE.Vector3()
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _pq = new THREE.Quaternion()
const _rq = new THREE.Quaternion()
const _up0 = new THREE.Quaternion()
const _mid0 = new THREE.Quaternion()

/** node をワールドで q だけ回す（親の座標の quaternion に直して掛ける） */
export function rotateWorld(node: THREE.Object3D, q: THREE.Quaternion) {
  if (node.parent) {
    node.parent.getWorldQuaternion(_pq)
    node.quaternion.premultiply(_rq.copy(_pq).invert().multiply(q).multiply(_pq))
  } else node.quaternion.premultiply(q)
}

/** node のワールドの向きを q にする（親の座標の quaternion に直して入れる） */
export function setWorldQuaternion(node: THREE.Object3D, q: THREE.Quaternion) {
  if (node.parent) {
    node.parent.getWorldQuaternion(_pq)
    node.quaternion.copy(_pq.invert().multiply(q))
  } else node.quaternion.copy(q)
}

/**
 * 先 end を target へ（weight で今の姿勢と混ぜる。0 なら何もしない）。届いたか（target までの距離が骨の長さの内）を返す
 */
export function solveTwoBone(up: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, weight = 1): boolean {
  if (weight <= 1e-4) return true
  up.getWorldPosition(_h)
  mid.getWorldPosition(_k)
  end.getWorldPosition(_p)
  const a = _k.distanceTo(_h)
  const b = _p.distanceTo(_k)
  if (a < 1e-5 || b < 1e-5) return false
  _d.subVectors(target, _h)
  const len = _d.length()
  if (len < 1e-6) return false
  const d = THREE.MathUtils.clamp(len, Math.abs(a - b) + 1e-4, (a + b) * 0.9999)
  _d.divideScalar(len)
  // 膝・肘の行き先: 股関節（肩）から target への線の上 along の所から、pole の側へ h
  const along = (a * a - b * b + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, a * a - along * along))
  _b.subVectors(pole, _h)
  _b.addScaledVector(_d, -_b.dot(_d))
  if (_b.lengthSq() < 1e-10) {
    // pole が線の上: 今の膝・肘の側へ
    _b.subVectors(_k, _h)
    _b.addScaledVector(_d, -_b.dot(_d))
    if (_b.lengthSq() < 1e-10) _b.set(0, 0, 1).addScaledVector(_d, -_d.z)
  }
  _b.normalize()
  _kt.copy(_h).addScaledVector(_d, along).addScaledVector(_b, h)
  _up0.copy(up.quaternion)
  _mid0.copy(mid.quaternion)
  // 上の骨: 股関節（肩）→ 膝（肘）を行き先へ
  _u.subVectors(_k, _h).normalize()
  _v.subVectors(_kt, _h).normalize()
  rotateWorld(up, _q.setFromUnitVectors(_u, _v))
  up.updateMatrixWorld(true)
  // 下の骨: 膝（肘）→ 先を、届く所の target へ
  mid.getWorldPosition(_k)
  end.getWorldPosition(_p)
  _t.copy(_h).addScaledVector(_d, d)
  _u.subVectors(_p, _k).normalize()
  _v.subVectors(_t, _k).normalize()
  rotateWorld(mid, _q.setFromUnitVectors(_u, _v))
  if (weight < 1) {
    up.quaternion.copy(_up0.slerp(up.quaternion, weight))
    mid.quaternion.copy(_mid0.slerp(mid.quaternion, weight))
  }
  up.updateMatrixWorld(true)
  return len <= (a + b) * 0.9999
}
