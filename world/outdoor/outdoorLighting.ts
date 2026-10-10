import * as THREE from 'three'
import { ROOM } from '../../core/lab/plan'
import { outdoor } from '../environment/daylight'
import { SUN_SHADOW_LAYER, setSunOnlyCasters } from '../environment/sunShadow'
import { setExteriorGlassOpacity } from './exteriorGlass'
import { site } from './site/siteModel'
import { lampHeads } from './site/siteMeshes'
import { interiorLight } from './interior/interiors'
import { namedUniforms } from './named/namedMaterial'
import { LAMP, lampNear, lampNearInfo } from './town/lamps'
import { townEvents, townFocus, townHighQuality, townOptions, type TownFrame } from '../townHost'

/**
 * 部屋に入る外の光（時刻で変わる）。配信中（live）に部屋の照明を落とす仕組み（ラボの明るさ labLight）はかけない。
 *
 * - 太陽の直射（DirectionalLight）: 南のガラス壁・西と東のハイサイドの窓から差し込み、床に方立ての影の縞を落とす。
 *   影は「部屋の殻（天井・ガラス壁の枠・西と東の壁・柱・見学エントランスの枠）と花音」（SUN_SHADOW_LAYER）だけで描く。
 *   影の無い ?quality=low では、天井を突き抜けて部屋じゅうを照らしてしまうので使わない
 * - 空からの光（HemisphereLight）: 昼の部屋全体のわずかな明るさ。窓の明るさの映り込みは、反射用の環境（world/lab/lighting/
 *   environment.ts）のガラス壁の板が受け持つ。窓の面光源（RectAreaLight）は使わない（基地局のリングの金属が窓を映して銀色に光り、
 *   「暗い部屋に光のライン」の見た目から離れるのと、画素ごとの計算が重いため）。花音の VRM（MToon）の正面は白く平らに飛ばない
 * - 外に面したガラスの不透明度（昼は少し暗くして、外が明るすぎないように）
 *
 * 太陽が地平線の下に沈んで空の光も無くなる間（夜）は、太陽と空の光のライトを消す（画素ごとの影の計算をしない）。
 * ライトの数が変わるとシェーダーが変わるので、起動のあとで「もう一方」の組み合わせのシェーダーも先に作っておく（夕方・朝に止まらないように）
 *
 * three の形（5-5。前の OutdoorLighting.tsx）: 光は outdoorLights() でモジュールに 1 つだけ作り（作り直さず、捨てない）、objects（太陽 → 太陽の target →
 * 空の光 → trigger）をこの順で場面の直下に置く（ラボの照明のあと）。毎コマ update(f) を呼ぶ（町の毎コマの段
 * town.update（world/createTown.ts）の中で、遠景の update のあと。外にいる度合い outsideness を同じコマの中で知らせる）
 */

/** 影の計算に入れる範囲（部屋の箱） */
const ROOM_CORNERS = [-1, 1].flatMap((sx) =>
  [-0.6, ROOM.height + 0.6].flatMap((y) => [-1, 1].map((sz) => new THREE.Vector3(sx * (ROOM.halfWidth + 0.6), y, sz < 0 ? ROOM.north - 0.6 : ROOM.south + 0.6))),
)
const ROOM_CENTER = new THREE.Vector3(0, ROOM.height / 2, ROOM.centerZ)

const _view = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _lastDir = new THREE.Vector3()

/**
 * このコマで太陽の影を描き直すか（pending）、太陽を点ける前に影の地図を作るか（create）と、ふだんの描画のカメラ
 * （床の映り込みなど別のカメラの描画では描かない）
 */
const sunShadow: { pending: boolean; create: boolean; camera: THREE.Camera | null } = { pending: false, create: false, camera: null }

/** 外の光を作る（最初の 1 回だけ） */
function createLights() {
  const sun = new THREE.DirectionalLight('#ffffff', 0)
  sun.castShadow = townHighQuality()
  // 影の地図の大きさ（撮影の本番の書き出しは細かく。部屋の窓の方立ての影・外の花音の影の縁）
  const size = townOptions().sunShadowMapSize
  sun.shadow.mapSize.set(size, size)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.035
  sun.shadow.autoUpdate = false
  sun.target.position.copy(ROOM_CENTER)
  const hemi = new THREE.HemisphereLight('#ffffff', '#000000', 0)

  // 太陽の影の地図を描くためのカメラと 1px の描き先。three.js は描くときのカメラのレイヤーで、ライトと影を落とす物を選ぶので、
  // このカメラ（SUN_SHADOW_LAYER だけ）で描くと「太陽の影」だけが「部屋の殻と花音」で描かれる。
  // カメラはシーンから遠く離して何も写らない向きにする（色は何も描かない）
  sun.layers.enable(SUN_SHADOW_LAYER)
  const shadowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1)
  shadowCamera.position.set(0, -1e5, 0)
  shadowCamera.lookAt(0, -2e5, 0)
  shadowCamera.updateMatrixWorld()
  shadowCamera.layers.set(SUN_SHADOW_LAYER)
  const shadowTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })

  // 太陽の影は、ふだんのカメラの描画の中で（最初に描く空の形の onBeforeRender で）描く。
  // 描画の中で描くと three.js がライトの状態を別に持つので、ふだんの描画のライトの設定を崩さない
  const trigger = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
  trigger.frustumCulled = false
  trigger.renderOrder = -1000
  trigger.onBeforeRender = (renderer, scene, camera) => {
    if (!(sunShadow.pending || sunShadow.create) || camera !== sunShadow.camera) return
    // 太陽を点ける前の影の地図づくりでは、この描画の中でだけ太陽を点ける
    const visible = sun.visible
    if (sunShadow.create) sun.visible = true
    sunShadow.pending = false
    sunShadow.create = false
    sun.shadow.needsUpdate = true
    const prev = renderer.getRenderTarget()
    const autoUpdate = scene.matrixWorldAutoUpdate
    scene.matrixWorldAutoUpdate = false
    renderer.setRenderTarget(shadowTarget)
    setSunOnlyCasters(true)
    renderer.render(scene, shadowCamera)
    setSunOnlyCasters(false)
    renderer.setRenderTarget(prev)
    scene.matrixWorldAutoUpdate = autoUpdate
    sun.visible = visible
  }
  return {
    sun,
    hemi,
    trigger,
    shadowTarget,
    state: { frames: 0, precompiled: false },
    /** 場面に置く物（この順で場面の直下に） */
    objects: [sun, sun.target, hemi, trigger] as readonly THREE.Object3D[],
    /** 毎コマ */
    update: updateLights,
  }
}

/** 花音がラボの外にいる度合い（0〜1。なめらかに） */
const outside = { value: 0 }
const _center = new THREE.Vector3()
const LAMP_COLOR = new THREE.Color('#ffb874')
const NIGHT_SKY = new THREE.Color('#6d86b8')
/**
 * 夜に外にいる花音の空の光の色（段階 5 の色の仕上げ）。部屋の夜の色（NIGHT_SKY）は青が強く、外の街灯の下の花音が青緑に寄ったので、
 * 外にいる度合いで、彩度を落とした月夜の灰青へ寄せる（ラボの中の夜は空の光の強さが 0 なので変わらない）
 */
const NIGHT_SKY_OUT = new THREE.Color('#8e90a4')

/**
 * 夜、外にいる花音を照らす街灯（いちばん近い灯具。太陽の光のライトを使う。ライトの数を変えずに済み、シェーダーを作り直さない）
 */
const lamp = { active: false, intensity: 0, dir: new THREE.Vector3(0, 1, 0), heads: [] as THREE.Vector3[], version: -1 }
function updateLamp(o: number) {
  if (lamp.version !== site.version) {
    lamp.heads = lampHeads()
    lamp.version = site.version
  }
  lamp.active = false
  const on = outdoor.lights.path
  // 中のある建物の部屋の中では、部屋の灯りと窓の光（interiorLight）で照らす
  if (o < 0.01 || on < 0.01 || outdoor.interior.sun > 0.02 || interiorLight.active > 0.5) return
  const k = townFocus().position
  let best: THREE.Vector3 | null = null
  let bd = Infinity
  for (const h of lamp.heads) {
    const d = h.distanceToSquared(k)
    if (d < bd) {
      bd = d
      best = h
    }
  }
  // 名前のある建物の入口の灯り（遠くのセットの玄関・店の前）
  const nl = namedUniforms.uNLamps.value
  for (let i = 0; i < namedUniforms.uNLampCount.value; i++) {
    const v = nl[i]
    if (v.w <= 0) continue
    _nl.set(v.x, v.y, v.z)
    const d = _nl.distanceToSquared(k) * 0.7
    if (d < bd) {
      bd = d
      best = _nlBest.copy(_nl)
    }
  }
  // 町の中の灯り（街灯・提灯・店先・停留所など。夜の灯りの表 town/lamps.ts の升の灯りのうち、いちばん明るく照らすもの。kanon.travel で町を歩くとき）
  if (lampNear(k.x, k.y + 1.2, k.z, _tl) > 0) {
    // 足元灯（つづら道・町の石段。§7 の 173）と提灯は街灯より弱いので、同じ距離でも遠い灯りとして照らす
    const reach = lampNearInfo.kind === LAMP.foot ? 0.6 : lampNearInfo.kind === LAMP.lantern ? 0.8 : 1
    const d = _tl.distanceToSquared(k) / (reach * reach)
    if (d < bd) {
      bd = d
      best = _tlBest.copy(_tl)
    }
  }
  // 近くに街灯が無いときも、ラボのガラス壁の光（扉の前）を弱く
  const glass = _glass.set(Math.min(7, Math.max(-5.5, k.x)), 2.5, 6.0)
  const dg = glass.distanceToSquared(k)
  const lampI = best ? (3.0 / (1 + bd * 0.1)) : 0
  const glassI = 0.9 / (1 + dg * 0.25)
  const src = best && lampI >= glassI ? best : glass
  lamp.dir.copy(src).sub(k).normalize()
  if (lamp.dir.y < 0.25) lamp.dir.y = 0.25
  lamp.dir.normalize()
  lamp.intensity = Math.max(lampI, glassI) * on * o
  lamp.active = lamp.intensity > 0.01
}
const _glass = new THREE.Vector3()
const _tl = new THREE.Vector3()
const _tlBest = new THREE.Vector3()
const _nl = new THREE.Vector3()
const _nlBest = new THREE.Vector3()

/** 花音がラボから遠いか（遠くのセットにいる） */
function farFromLab() {
  const k = townFocus().position
  return Math.hypot(k.x, k.z) > 60
}

const _ic = new THREE.Color()
const _id = new THREE.Vector3()

let lightsCache: ReturnType<typeof createLights> | null = null
/** 外の光（初めて呼んだときに作る。あとは同じ物） */
export const outdoorLights = () => (lightsCache ??= createLights())

/** 外にいる花音のまわりの影の箱（足元から ±3m・高さ 3m） */
const FOCUS_CORNERS = Array.from({ length: 8 }, () => new THREE.Vector3())
const _lastFocus = new THREE.Vector3(1e9, 0, 0)

/**
 * 影のカメラを部屋の箱にぴったり合わせる（太陽の向きが変わったときだけ）。花音がラボの外にいる間は、花音のまわりの箱も入れる
 * （外の花音にラボの建物の影が落ち、花音の体にも自分の影が付く）
 */
function fitShadowCamera(sun: THREE.DirectionalLight, center: THREE.Vector3, outside: boolean) {
  const k = townFocus().position
  // 花音がラボから遠い（遠くのセット）ときは、花音のまわりだけ（部屋の箱を入れると影の地図が何百 m にも広がって粗くなる）
  const far = farFromLab()
  _p.copy(sun.position).sub(center).normalize()
  const turned = _lastDir.distanceToSquared(_p) > 1e-8
  const moved = outside ? _lastFocus.distanceToSquared(k) > 0.04 : _lastFocus.x < 1e8
  if (!turned && !moved) return
  _lastDir.copy(_p)
  if (outside) _lastFocus.copy(k)
  else _lastFocus.set(1e9, 0, 0)
  _view.lookAt(sun.position, center, THREE.Object3D.DEFAULT_UP).setPosition(sun.position).invert()
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let n = 0
  if (outside) for (const sx of [-3, 3]) for (const sy of [-0.5, 3]) for (const sz of [-3, 3]) FOCUS_CORNERS[n++].set(k.x + sx, k.y + sy, k.z + sz)
  for (const c of far ? FOCUS_CORNERS.slice(0, n) : [...ROOM_CORNERS, ...FOCUS_CORNERS.slice(0, n)]) {
    _p.copy(c).applyMatrix4(_view)
    minX = Math.min(minX, _p.x)
    maxX = Math.max(maxX, _p.x)
    minY = Math.min(minY, _p.y)
    maxY = Math.max(maxY, _p.y)
    minZ = Math.min(minZ, _p.z)
    maxZ = Math.max(maxZ, _p.z)
  }
  const cam = sun.shadow.camera
  cam.left = minX
  cam.right = maxX
  cam.bottom = minY
  cam.top = maxY
  cam.near = Math.max(0.1, -maxZ - 1)
  cam.far = -minZ + 1
  cam.updateProjectionMatrix()
}

/** 毎コマ（遠景の更新のあと）: 外にいる度合い・街灯・光の強さと色・ガラスの不透明度・太陽の影 */
function updateLights(f: TownFrame): void {
  const { renderer: gl, scene, camera, dt } = f
  const { sun, hemi, shadowTarget, state } = outdoorLights()
  const I = outdoor.interior
  const focus = townFocus()
  const high = townHighQuality()
  // 花音がラボの外にいる度合い（なめらかに）と、夜に外の花音を照らす街灯
  outside.value += ((focus.outside ? 1 : 0) - outside.value) * (1 - Math.exp(-Math.min(dt, 0.1) * 2.5))
  updateLamp(outside.value)
  // 昼（空の光がある間）だけライトを点ける。高画質でなければ太陽の直射は使わない。夜でも外の花音を街灯が照らす間は点ける
  // 中のある建物の部屋の中にいる度合い（部屋の灯りと窓の光で照らす）
  const ia = interiorLight.active
  // 外にいる度合い（町・中のある建物の中）を知らせる（使う側が人物の縁の光に反映する。同じコマの中で）
  townEvents.emit('outsideness', Math.max(outside.value, ia))
  const on = I.ambient > 0.0005 || I.sun > 0.0005 || lamp.active || ia > 0.01
  const wantSun = on && high
  // 太陽を初めて点けるときは、先に影の地図を作る（地図が無いまま描くと、three.js が仮に使う空のテクスチャが
  // 影の比べ方を持たず、WebGL のエラーになる）。このコマは点けずに、trigger の描画の中で地図だけ作る。
  // ライトの組み合わせは「昼（太陽と空の光）」と「夜（どちらも消す）」の 2 つだけにする（3 つ目の組み合わせのシェーダーを作らない）
  sunShadow.camera = camera
  if (wantSun && !sun.shadow.map) {
    sunShadow.create = true
    sun.visible = false
    hemi.visible = false
  } else {
    sun.visible = wantSun
    hemi.visible = on
  }
  const o = outside.value
  let k = high ? (lamp.active ? lamp.intensity : I.sun) : 0
  sun.color.copy(lamp.active ? LAMP_COLOR : I.sunColor)
  // 空の光: 外にいる花音には、部屋の中より強い空の光（ガラス越しでない）。夜は街の灯りと月のほのかな光
  hemi.intensity = I.ambient + o * (0.3 + 0.45 * outdoor.daylight - 0.12 * outdoor.night)
  hemi.color.copy(I.ambientSky)
  if (outdoor.daylight < 0.05) hemi.color.copy(NIGHT_SKY).lerp(NIGHT_SKY_OUT, o)
  hemi.groundColor.copy(I.ambientGround)
  if (ia > 0.001) {
    // 中: いちばん明るい窓・灯りの向きから、その色の光。まわりは部屋の照り返し
    const ik = Math.min(2.6, interiorLight.intensity * 2.4)
    k = THREE.MathUtils.lerp(k, high ? ik : 0, ia)
    _ic.copy(interiorLight.color).multiplyScalar(1 / Math.max(1e-3, Math.max(interiorLight.color.r, interiorLight.color.g, interiorLight.color.b)))
    sun.color.lerp(_ic, ia)
    const amb = interiorLight.ambient
    const lum = amb.r * 0.2126 + amb.g * 0.7152 + amb.b * 0.0722
    hemi.intensity = THREE.MathUtils.lerp(hemi.intensity, Math.min(1.4, 0.12 + lum * 9), ia)
    _ic.copy(amb).multiplyScalar(1 / Math.max(1e-4, Math.max(amb.r, amb.g, amb.b)))
    hemi.color.lerp(_ic, ia)
    hemi.groundColor.lerp(_ic.multiplyScalar(0.55), ia)
  }
  sun.intensity = k
  setExteriorGlassOpacity(I.glassOpacity)

  // 起動して少したったら、もう一方のライトの組み合わせ（昼 ↔ 夜）のシェーダーも裏で作っておく（夕方・朝の切り替えで止まらないように）。
  // シェーダーは描き先で変わる（画面か、ポストエフェクトの描き先か）ので、ふだんと同じく描き先を付けて作る
  state.frames++
  if (!state.precompiled && state.frames === 20) {
    state.precompiled = true
    const was = [sun.visible, hemi.visible]
    sun.visible = !on && high
    hemi.visible = !on
    const prev = gl.getRenderTarget()
    if (townOptions().postEffects) gl.setRenderTarget(shadowTarget)
    void gl.compileAsync(scene, camera).catch(() => undefined)
    gl.setRenderTarget(prev)
    sun.visible = was[0]
    hemi.visible = was[1]
  }

  if (!wantSun) return
  // 太陽（夜に外にいる花音を照らす街灯の代わりのときは、いちばん近い街灯の向き）
  let dir = lamp.active ? lamp.dir : outdoor.sunDir
  if (ia > 0.001) dir = _id.copy(dir).lerp(interiorLight.dir, ia).normalize()
  const center = farFromLab() ? _center.copy(focus.position).setY(focus.position.y + 1) : outside.value > 0.01 ? _center.copy(ROOM_CENTER).lerp(focus.position, 0.5) : ROOM_CENTER
  sun.position.copy(center).addScaledVector(dir, 60)
  sun.target.position.copy(center)
  sun.target.updateMatrixWorld()
  fitShadowCamera(sun, center, outside.value > 0.01)
  // 太陽の影の地図: 太陽が出ている間は毎コマ、部屋の殻と花音（SUN_SHADOW_LAYER）だけで描く（trigger の onBeforeRender）。
  // ふだんの描画の影のパスでは描き直さない（autoUpdate = false。そこで描くと、影を落とす物すべて（家具も）が入って重い）
  if (k > 0.0005) sunShadow.pending = true
}
