import * as THREE from 'three/webgpu'
import { Fn, If, clamp, dot, float, max, min, mix, smoothstep, sqrt, step, texture, uniform, vec2, vec4 } from 'three/tsl'

/**
 * 町の太陽の影（建物・木・地形・構造物が、地面・建物・木に落とす影）。
 *
 * - 近くと遠くの 2 枚の影の地図（正射影。太陽の向きから見た深さ）。近く = 細かさの中心のまわり（配信はラボのまわり、撮影はカメラのまわり）、
 *   遠く = 窓から見える町の範囲。どちらも見ている向きの側へずらして置く
 * - 町は動かず、太陽はゆっくりしか動かないので、**太陽の向きが少し変わったとき・細かさの中心が動いたときだけ描き直す**（ふだんのコマは読むだけ。
 *   描き直すのは 0.12° ごと = 約 30 秒に 1 回。近くと遠くを別のコマで描く）
 * - 影を落とす物は、ふだんの形と同じ頂点の計算をする「深さだけの材質」（userData.shadowMaterial）で描く
 * - 読む側: townShadow(位置, 法線)（TSL の Fn）が 0（影）〜 1（日なた）。法線の向きへ少しずらして読み、ハードウェアの比較で縁をなめらかに（PCF）
 *
 * WebGPU（WebGPURenderer＋TSL）への移行（第 1 段。kanon-claire-thompson/sakurami-cho#31 の試作「町の影の仕組み」）:
 * - 描き先は RenderTarget＋比較つきの DepthTexture。読むのは texture(depth).sample(uv).compare(z)（WGSL の textureSampleCompare）
 * - 材質の差し替えは renderer.setRenderObjectFunction で（形ごとに userData.shadowMaterial を使う。traverse で材質や visible を書き換えない）
 * - 影の座標の行列の前に掛ける bias の行列は renderer.coordinateSystem で切り替える（WebGPU は NDC の z が 0〜1、テクスチャの v が下向き）
 * - 描く前に読んでも誤りにならないので、前の ensureInit（一度描き先にしておく）は無くした
 * - GLSL の TOWN_SHADOW は、まだ TSL にしていない ShaderMaterial のためだけに残す（WebGPU では描けない。第 2 段でそれぞれを TSL にしたら消す）
 */

/** 比べの設定のある、まだ描いていない深さのテクスチャ（影の地図を作る前に、読む側の材質を組み立てる時の仮の物） */
function placeholderDepth() {
  const t = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
  t.compareFunction = THREE.LessEqualCompare
  return t
}

/**
 * 影の uniform（ノード）。影の地図の深さのテクスチャは TextureNode で、TownShadows を作ると value が替わる（読む側の材質は作り直さない）。
 * 名前は前の GLSL の uniform と同じ（まだ TSL にしていない ShaderMaterial が uniforms に広げて使う）
 */
export const townShadowUniforms = {
  uShadowNear: texture(placeholderDepth()),
  uShadowFar: texture(placeholderDepth()),
  uShadowM0: uniform(new THREE.Matrix4()),
  uShadowM1: uniform(new THREE.Matrix4()),
  /** x, y = 近く・遠くの地図の 1 画素の大きさ（m）、z = 影を使うか（0 / 1）、w = 遠くの地図の範囲の半径 */
  uShadowInfo: uniform(new THREE.Vector4(1, 1, 0, 1)),
  /** 花音のまわりの細かい影の地図（花音・KB-001・ラボの外観・まわりのセット。毎コマ描く） */
  uShadowLocal: texture(placeholderDepth()),
  uShadowM2: uniform(new THREE.Matrix4()),
  /** x = 1 画素の大きさ（m）、y = 使うか（0 / 1） */
  uShadowLocalInfo: uniform(new THREE.Vector2(0.02, 0)),
  /** 近く・遠く・細かい地図の 1 画素の大きさ（テクスチャの座標。前の GLSL は textureSize で読んでいた） */
  uShadowTexel: uniform(new THREE.Vector3(1, 1, 1)),
  /** 太陽の向き（遠景の共有の uSunDir と同じ物を outdoor/materials.ts が入れる。ここは影の計算だけが読む写し） */
  uShadowSunDir: uniform(new THREE.Vector3(0, 1, 0)),
}

/**
 * 細かい影の地図に入れる物（花音の VRM・KB-001・ラボの外観とまわりのセット）。形を持つ物は userData.shadowMaterial があればそれで、
 * 無ければ（花音のスキンのある形など）深さだけの共有の材質で描く
 */
export const localShadowCasters = new Set<THREE.Object3D>()

/** GLSL: townShadow(ワールドの位置, 法線) → 0〜1（まだ TSL にしていない ShaderMaterial のためだけ。WebGPU では描けない。第 2 段で消す） */
export const TOWN_SHADOW = /* glsl */ `
uniform highp sampler2DShadow uShadowNear;
uniform highp sampler2DShadow uShadowFar;
uniform mat4 uShadowM0;
uniform mat4 uShadowM1;
uniform vec4 uShadowInfo;
uniform highp sampler2DShadow uShadowLocal;
uniform mat4 uShadowM2;
uniform vec2 uShadowLocalInfo;
float shadowTap(highp sampler2DShadow map, mat4 m, vec3 wp, out float inside) {
  vec4 p = m * vec4(wp, 1.0);
  vec3 q = p.xyz;
  vec2 e = min(q.xy, 1.0 - q.xy);
  inside = smoothstep(0.0, 0.04, min(e.x, e.y)) * step(q.z, 1.0);
  if (inside <= 0.0) return 1.0;
  vec2 t = vec2(0.6 / float(textureSize(map, 0).x));
  return 0.25 * (texture(map, vec3(q.xy + vec2(t.x, t.y * 0.4), q.z)) + texture(map, vec3(q.xy + vec2(-t.x * 0.4, t.y), q.z)) + texture(map, vec3(q.xy - vec2(t.x, t.y * 0.4), q.z)) + texture(map, vec3(q.xy + vec2(t.x * 0.4, -t.y), q.z)));
}
float townShadow(vec3 wp, vec3 N) {
  if (uShadowInfo.z < 0.5 || uSunDir.y < -0.02) return 1.0;
  float ndl = dot(N, uSunDir);
  if (ndl <= 0.0) return 0.0;
  float slope = clamp(sqrt(max(1.0 - ndl * ndl, 0.0)) / max(ndl, 0.05), 0.0, 6.0);
  float in0;
  vec3 p0 = wp + N * uShadowInfo.x * (2.0 + 1.0 * slope) + uSunDir * uShadowInfo.x * 0.8;
  float s0 = shadowTap(uShadowNear, uShadowM0, p0, in0);
  float s = s0;
  if (in0 < 1.0) {
    float in1;
    vec3 p1 = wp + N * uShadowInfo.y * (2.0 + 1.0 * slope) + uSunDir * uShadowInfo.y * 0.8;
    float s1 = shadowTap(uShadowFar, uShadowM1, p1, in1);
    s1 = mix(1.0, s1, in1);
    s = mix(s1, s0, in0);
  }
  if (uShadowLocalInfo.y > 0.5) {
    float in2;
    vec3 p2 = wp + N * uShadowLocalInfo.x * (1.5 + 1.0 * slope) + uSunDir * uShadowLocalInfo.x * 1.5;
    float s2 = shadowTap(uShadowLocal, uShadowM2, p2, in2);
    s *= mix(1.0, s2, in2);
  }
  return mix(1.0, s, smoothstep(-0.02, 0.06, uSunDir.y));
}
`

type ShadowMapNode = typeof townShadowUniforms.uShadowNear
type V3 = THREE.Node<'vec3'>

/** 1 枚の影の地図を読む: [影 0〜1, 範囲の内側 0〜1]。4 点の PCF（ハードウェアの比較の双一次と合わせて、縁と木漏れ日をやわらかく） */
function shadowTap(map: ShadowMapNode, m: THREE.Node<'mat4'>, wp: V3, texel: THREE.Node<'float'>) {
  const q = m.mul(vec4(wp, 1.0)).xyz.toVar()
  const e = min(q.xy, q.xy.oneMinus())
  const inside = smoothstep(0.0, 0.04, min(e.x, e.y)).mul(step(q.z, 1.0)).toVar()
  const s = float(1).toVar()
  If(inside.greaterThan(0.0), () => {
    const t = texel.mul(0.6)
    const tap = (dx: THREE.Node<'float'>, dy: THREE.Node<'float'>) => map.sample(q.xy.add(vec2(dx, dy))).compare(q.z).r
    s.assign(tap(t, t.mul(0.4)).add(tap(t.mul(-0.4), t)).add(tap(t.negate(), t.mul(-0.4))).add(tap(t.mul(0.4), t.negate())).mul(0.25))
  })
  return { s, inside }
}

/** townShadow(ワールドの位置, 法線) → 0〜1（前の GLSL の TOWN_SHADOW と同じ分岐） */
export const townShadow = Fn(([wp, N]: [V3, V3]) => {
  const u = townShadowUniforms
  const sun = u.uShadowSunDir
  const res = float(1).toVar()
  If(u.uShadowInfo.z.greaterThan(0.5).and(sun.y.greaterThanEqual(-0.02)), () => {
    const ndl = dot(N, sun).toVar()
    If(ndl.lessThanEqual(0.0), () => {
      res.assign(0.0)
    }).Else(() => {
      // 法線の向きへずらす（自分の面の影のしま模様を消す。斜めに光が当たる面ほど大きく）。ndl はわずかに 1 を超えることがある（負の sqrt は NaN）
      const slope = clamp(sqrt(max(ndl.mul(ndl).oneMinus(), 0.0)).div(max(ndl, 0.05)), 0.0, 6.0).toVar()
      const p0 = wp.add(N.mul(u.uShadowInfo.x.mul(slope.add(2.0)))).add(sun.mul(u.uShadowInfo.x.mul(0.8)))
      const t0 = shadowTap(u.uShadowNear, u.uShadowM0, p0, u.uShadowTexel.x)
      const s = t0.s.toVar()
      If(t0.inside.lessThan(1.0), () => {
        const p1 = wp.add(N.mul(u.uShadowInfo.y.mul(slope.add(2.0)))).add(sun.mul(u.uShadowInfo.y.mul(0.8)))
        const t1 = shadowTap(u.uShadowFar, u.uShadowM1, p1, u.uShadowTexel.y)
        s.assign(mix(mix(1.0, t1.s, t1.inside), t0.s, t0.inside))
      })
      // 花音のまわりの細かい影（花音・手すりなど細い物の影）。町の影と重ねる
      If(u.uShadowLocalInfo.y.greaterThan(0.5), () => {
        const p2 = wp.add(N.mul(u.uShadowLocalInfo.x.mul(slope.add(1.5)))).add(sun.mul(u.uShadowLocalInfo.x.mul(1.5)))
        const t2 = shadowTap(u.uShadowLocal, u.uShadowM2, p2, u.uShadowTexel.z)
        s.mulAssign(mix(1.0, t2.s, t2.inside))
      })
      // 太陽が地平線に近いほど影は薄く（空の光に溶ける）
      res.assign(mix(1.0, s, smoothstep(-0.02, 0.06, sun.y)))
    })
  })
  return res
})

interface Cascade {
  target: THREE.RenderTarget
  camera: THREE.OrthographicCamera
  radius: number
  size: number
  center: THREE.Vector2
  sun: THREE.Vector3
  dirty: boolean
}

/** 細かい影の地図の範囲の半径（m） */
const LOCAL_RADIUS = 13

/**
 * 影の座標の行列の前に掛ける行列（クリップ空間 → テクスチャの座標と深さ）。
 * WebGPU: NDC の x, y は −1〜1、z は 0〜1。テクスチャの v は下向き → v = 0.5 − 0.5y、z はそのまま。
 * WebGL のバックエンド（使わないが念のため）: z は −1〜1（→ 0.5z + 0.5）。v は描き先のテクスチャを読むとき three が反転するので WebGPU と同じ向き
 */
export function shadowBiasMatrix(coordinateSystem: THREE.CoordinateSystem) {
  const m = new THREE.Matrix4()
  if (coordinateSystem === THREE.WebGPUCoordinateSystem) m.set(0.5, 0, 0, 0.5, 0, -0.5, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 1)
  else m.set(0.5, 0, 0, 0.5, 0, -0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
  return m
}

/** 影の地図を描く renderer の口（WebGPURenderer の、ここで使う所だけ） */
type ShadowRenderer = Pick<THREE.WebGPURenderer, 'getRenderTarget' | 'setRenderTarget' | 'clear' | 'render' | 'autoClear' | 'getRenderObjectFunction' | 'setRenderObjectFunction' | 'renderObject' | 'coordinateSystem'>
type RenderObjectFn = Parameters<THREE.WebGPURenderer['setRenderObjectFunction']>[0]

/** 町の影の地図（Landscape が作って、毎コマ update を呼ぶ） */
export class TownShadows {
  private cascades: Cascade[]
  readonly enabled: boolean
  private local: Cascade
  /** 細かい影の地図で、userData.shadowMaterial の無い物（花音のスキンのある形など）を描く深さだけの材質 */
  private localDepth = depthMaterial()

  constructor(size: number, nearRadius: number, farRadius: number, nearMax = 4096, LOCAL_SIZE = 2048) {
    this.enabled = size > 0
    const make = (radius: number, sz: number): Cascade => {
      const depth = new THREE.DepthTexture(sz, sz, THREE.UnsignedIntType)
      depth.compareFunction = THREE.LessEqualCompare
      depth.minFilter = THREE.LinearFilter
      depth.magFilter = THREE.LinearFilter
      const target = new THREE.RenderTarget(sz, sz, { depthBuffer: true, depthTexture: depth, format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false })
      const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1, 1)
      return { target, camera, radius, size: sz, center: new THREE.Vector2(1e9, 1e9), sun: new THREE.Vector3(), dirty: true }
    }
    const sz = Math.max(16, size)
    this.cascades = [make(nearRadius, Math.min(sz, nearMax)), make(farRadius, sz)]
    this.local = make(LOCAL_RADIUS, LOCAL_SIZE)
    const u = townShadowUniforms
    u.uShadowNear.value = this.cascades[0]!.target.depthTexture!
    u.uShadowFar.value = this.cascades[1]!.target.depthTexture!
    u.uShadowLocal.value = this.local.target.depthTexture!
    u.uShadowInfo.value.set((2 * nearRadius) / Math.min(sz, nearMax), (2 * farRadius) / sz, 0, farRadius)
    u.uShadowLocalInfo.value.set((2 * LOCAL_RADIUS) / LOCAL_SIZE, 0)
    u.uShadowTexel.value.set(1 / Math.min(sz, nearMax), 1 / sz, 1 / LOCAL_SIZE)
  }

  /**
   * 描き先・自動の消去・描き物の関数を保って、root を cam で描いて戻す。形ごとに userData.shadowMaterial（無ければ fallback。fallback も無ければ描かない）。
   * fallback を使うとき（細かい影の地図）は、userData.noLocalShadow の物と、shadowMaterial の無い透明な物（ガラス・光る物）を描かない
   */
  private draw(gl: ShadowRenderer, root: THREE.Object3D, cam: THREE.Camera, target: THREE.RenderTarget, fallback: THREE.Material | null, clear: boolean) {
    const prevTarget = gl.getRenderTarget()
    const prevAuto = gl.autoClear
    const prevFn = gl.getRenderObjectFunction()
    gl.setRenderTarget(target)
    if (clear) gl.clear(true, true, false)
    gl.autoClear = false
    const fn: RenderObjectFn = (object, scene, camera, geometry, material, group, lightsNode, clippingContext, passId) => {
      const o = object as THREE.Mesh
      if (!o.isMesh && !(object as THREE.Points).isPoints) return
      const sm = object.userData.shadowMaterial as THREE.Material | undefined
      if (!sm && (!fallback || object.userData.noLocalShadow || material.transparent)) return
      gl.renderObject(object, scene, camera, geometry, sm ?? fallback!, group, lightsNode, clippingContext, passId)
    }
    gl.setRenderObjectFunction(fn)
    try {
      gl.render(root, cam)
    } finally {
      gl.setRenderObjectFunction(prevFn)
      gl.setRenderTarget(prevTarget)
      gl.autoClear = prevAuto
    }
  }

  /** 太陽の向きから target を見る正射影のカメラに合わせる（描く renderer の座標系にそろえる） */
  private fit(gl: ShadowRenderer, c: Cascade, target: THREE.Vector3, far: number) {
    const cam = c.camera
    const r = c.radius
    cam.position.copy(target).addScaledVector(c.sun, far * 0.5)
    cam.up.set(0, 1, 0)
    if (Math.abs(c.sun.y) > 0.99) cam.up.set(0, 0, -1)
    cam.lookAt(target)
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 1
    cam.far = far
    cam.coordinateSystem = gl.coordinateSystem
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    cam.layers.enableAll()
  }

  /** 影の座標の行列（ワールド → テクスチャの座標と深さ） */
  private matrix(gl: ShadowRenderer, c: Cascade, out: THREE.Matrix4) {
    out.multiplyMatrices(c.camera.projectionMatrix, c.camera.matrixWorldInverse).premultiply(shadowBiasMatrix(gl.coordinateSystem))
  }

  /**
   * 花音のまわりの細かい影の地図を描く（毎コマ。center = 中心のシーンの x, z。null なら使わない）。
   * 描くのは localShadowCasters の物だけ（町の建物・木は近く・遠くの地図のまま）
   */
  updateLocal(gl: ShadowRenderer, center: THREE.Vector2 | null, sun: THREE.Vector3, centerY = 0) {
    const u = townShadowUniforms
    if (!this.enabled || !center || sun.y < -0.02 || localShadowCasters.size === 0) {
      u.uShadowLocalInfo.value.y = 0
      return
    }
    const c = this.local
    c.center.copy(center)
    c.sun.copy(sun)
    // 中心の高さは花音の足元（遠くのセットはラボの床より何十 m も低い）
    this.fit(gl, c, new THREE.Vector3(center.x, centerY, center.y), 160)
    let first = true
    for (const root of localShadowCasters) {
      if (!root.visible || !root.parent) continue
      this.draw(gl, root, c.camera, c.target, this.localDepth, first)
      first = false
    }
    if (first) {
      // 描く物が無いコマも、前の中身を残さない
      const prev = gl.getRenderTarget()
      gl.setRenderTarget(c.target)
      gl.clear(true, true, false)
      gl.setRenderTarget(prev)
    }
    this.matrix(gl, c, u.uShadowM2.value)
    u.uShadowLocalInfo.value.y = 1
  }

  /**
   * 必要なら影の地図を描き直す（1 コマに 1 枚まで）。center = 細かさの中心（シーンの x, z）、view = 見ている向き（シーンの x, z の単位ベクトル）、
   * sun = 太陽の向き、root = 影を落とす物（userData.shadowMaterial を持つ物）の根
   */
  update(gl: ShadowRenderer, root: THREE.Object3D, center: THREE.Vector2, view: THREE.Vector2, sun: THREE.Vector3) {
    const u = townShadowUniforms
    u.uShadowSunDir.value.copy(sun)
    if (!this.enabled || sun.y < -0.02) {
      u.uShadowInfo.value.z = 0
      return
    }
    // 近くは中心から見ている向きへ 0.55 × 半径、遠くは 0.75 × 半径だけずらした所を中心にする
    const want = this.cascades.map((c, i) => new THREE.Vector2(center.x + view.x * c.radius * (i === 0 ? 0.55 : 0.75), center.y + view.y * c.radius * (i === 0 ? 0.55 : 0.75)))
    let drawn = false
    this.cascades.forEach((c, i) => {
      const moved = c.center.distanceTo(want[i]!) > c.radius * 0.18
      const turned = c.sun.angleTo(sun) > THREE.MathUtils.degToRad(0.12)
      if (moved || turned || c.dirty) {
        if (drawn) return
        c.center.copy(want[i]!)
        c.sun.copy(sun)
        c.dirty = false
        // 太陽の向きから、範囲の中心（地面の高さ ≒ -100m）を見る。奥行きは影が長く伸びる朝夕でも足りるように
        this.fit(gl, c, new THREE.Vector3(c.center.x, -90, c.center.y), c.radius * 2 + 3000)
        this.draw(gl, root, c.camera, c.target, null, true)
        drawn = true
      }
    })
    this.cascades.forEach((c, i) => this.matrix(gl, c, i === 0 ? u.uShadowM0.value : u.uShadowM1.value))
    u.uShadowInfo.value.z = 1
  }

  /** 次のコマで描き直す（町を組み立て直したとき） */
  invalidate() {
    for (const c of this.cascades) c.dirty = true
  }

  dispose() {
    for (const c of this.cascades) c.target.dispose()
    this.local.target.dispose()
    this.localDepth.dispose()
  }
}

/**
 * 深さだけの材質（影の地図に描く）。positionNode を渡すと、本体の材質と同じ頂点の計算（インスタンス・風の揺れなど）をする。
 * maskNode を渡すと、その値が偽の画素を描かない（葉の形で抜く）。インスタンスの行列・スキンは NodeMaterial が自分で扱う
 */
export function depthMaterial(o: { positionNode?: THREE.Node | null; maskNode?: THREE.Node | null; side?: THREE.Side } = {}) {
  const m = new THREE.MeshBasicNodeMaterial({ colorWrite: false, side: o.side ?? THREE.DoubleSide, fog: false })
  m.name = 'townShadowDepth'
  if (o.positionNode) m.positionNode = o.positionNode
  if (o.maskNode) m.maskNode = o.maskNode
  return m
}
