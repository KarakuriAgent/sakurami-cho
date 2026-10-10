import * as THREE from 'three'

/**
 * 町の太陽の影（建物・木・地形・構造物が、地面・建物・木に落とす影）。
 *
 * - 近くと遠くの 2 枚の影の地図（正射影。太陽の向きから見た深さ）。近く = 細かさの中心のまわり（配信はラボのまわり、撮影はカメラのまわり）、
 *   遠く = 窓から見える町の範囲。どちらも見ている向きの側へずらして置く
 * - 町は動かず、太陽はゆっくりしか動かないので、**太陽の向きが少し変わったとき・細かさの中心が動いたときだけ描き直す**（ふだんのコマは読むだけ。
 *   描き直すのは 0.12° ごと = 約 30 秒に 1 回。近くと遠くを別のコマで描く）
 * - 影を落とす物は、ふだんの形と同じ頂点の計算をする「深さだけのシェーダー」（userData.shadowMaterial）で描く
 * - 読む側（シェーダー）: townShadow(位置, 法線) が 0（影）〜 1（日なた）。法線の向きへ少しずらして読み、ハードウェアの比較で縁をなめらかに（PCF）
 */

export const townShadowUniforms = {
  uShadowNear: { value: null as THREE.DepthTexture | null },
  uShadowFar: { value: null as THREE.DepthTexture | null },
  uShadowM0: { value: new THREE.Matrix4() },
  uShadowM1: { value: new THREE.Matrix4() },
  /** x, y = 近く・遠くの地図の 1 画素の大きさ（m）、z = 影を使うか（0 / 1）、w = 遠くの地図の範囲の半径 */
  uShadowInfo: { value: new THREE.Vector4(1, 1, 0, 1) },
  /** 花音のまわりの細かい影の地図（花音・KB-001・ラボの外観・まわりのセット。毎コマ描く） */
  uShadowLocal: { value: null as THREE.DepthTexture | null },
  uShadowM2: { value: new THREE.Matrix4() },
  /** x = 1 画素の大きさ（m）、y = 使うか（0 / 1） */
  uShadowLocalInfo: { value: new THREE.Vector2(0.02, 0) },
}

/**
 * 細かい影の地図に入れる物（花音の VRM・KB-001・ラボの外観とまわりのセット）。形を持つ物は userData.shadowMaterial があればそれで、
 * 無ければ（花音のスキンのある形など）深さだけの共有のマテリアルで描く
 */
export const localShadowCasters = new Set<THREE.Object3D>()

/** GLSL: townShadow(ワールドの位置, 法線) → 0〜1 */
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
  // 4 点の PCF（ハードウェアの比較の双一次と合わせて、縁と木漏れ日をやわらかく）
  vec2 t = vec2(0.6 / float(textureSize(map, 0).x));
  return 0.25 * (texture(map, vec3(q.xy + vec2(t.x, t.y * 0.4), q.z)) + texture(map, vec3(q.xy + vec2(-t.x * 0.4, t.y), q.z)) + texture(map, vec3(q.xy - vec2(t.x, t.y * 0.4), q.z)) + texture(map, vec3(q.xy + vec2(t.x * 0.4, -t.y), q.z)));
}
float townShadow(vec3 wp, vec3 N) {
  if (uShadowInfo.z < 0.5 || uSunDir.y < -0.02) return 1.0;
  float ndl = dot(N, uSunDir);
  if (ndl <= 0.0) return 0.0;
  // 法線の向きへずらす（自分の面の影のしま模様を消す。斜めに光が当たる面ほど大きく）
  // ndl はわずかに 1 を超えることがある（負の sqrt は NaN）
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
  // 花音のまわりの細かい影（花音・手すりなど細い物の影）。町の影と重ねる
  if (uShadowLocalInfo.y > 0.5) {
    float in2;
    vec3 p2 = wp + N * uShadowLocalInfo.x * (1.5 + 1.0 * slope) + uSunDir * uShadowLocalInfo.x * 1.5;
    float s2 = shadowTap(uShadowLocal, uShadowM2, p2, in2);
    s *= mix(1.0, s2, in2);
  }
  // 太陽が地平線に近いほど影は薄く（空の光に溶ける）
  return mix(1.0, s, smoothstep(-0.02, 0.06, uSunDir.y));
}
`

interface Cascade {
  target: THREE.WebGLRenderTarget
  camera: THREE.OrthographicCamera
  radius: number
  center: THREE.Vector2
  sun: THREE.Vector3
  dirty: boolean
}

/** 細かい影の地図の範囲の半径（m）と大きさ（px） */
const LOCAL_RADIUS = 13
/** 細かい影の地図に入れない物（ガラス・光る物）に一時的に付けるマテリアル（何も描かない） */
const HIDDEN = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

/** 町の影の地図（Landscape が作って、毎コマ update を呼ぶ） */
export class TownShadows {
  private cascades: Cascade[]
  private swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = []
  readonly enabled: boolean
  private initialized = false

  constructor(size: number, nearRadius: number, farRadius: number, nearMax = 4096, LOCAL_SIZE = 2048) {
    this.enabled = size > 0
    const make = (radius: number, sz: number): Cascade => {
      const depth = new THREE.DepthTexture(sz, sz, THREE.UnsignedIntType)
      depth.compareFunction = THREE.LessEqualCompare
      depth.minFilter = THREE.LinearFilter
      depth.magFilter = THREE.LinearFilter
      const target = new THREE.WebGLRenderTarget(sz, sz, { depthBuffer: true, depthTexture: depth, format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false })
      const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1, 1)
      return { target, camera, radius, center: new THREE.Vector2(1e9, 1e9), sun: new THREE.Vector3(), dirty: true }
    }
    const sz = Math.max(16, size)
    this.cascades = [make(nearRadius, Math.min(sz, nearMax)), make(farRadius, sz)]
    this.local = make(LOCAL_RADIUS, LOCAL_SIZE)
    const u = townShadowUniforms
    u.uShadowNear.value = this.cascades[0].target.depthTexture
    u.uShadowFar.value = this.cascades[1].target.depthTexture
    u.uShadowLocal.value = this.local.target.depthTexture
    u.uShadowInfo.value.set((2 * nearRadius) / Math.min(sz, nearMax), (2 * farRadius) / sz, 0, farRadius)
    u.uShadowLocalInfo.value.set((2 * LOCAL_RADIUS) / LOCAL_SIZE, 0)
  }

  private local: Cascade
  private localDepth = new THREE.MeshDepthMaterial({ colorWrite: false, side: THREE.DoubleSide })

  /**
   * 花音のまわりの細かい影の地図を描く（毎コマ。center = 中心のシーンの x, z。null なら使わない）。
   * 描くのは localShadowCasters の物だけ（町の建物・木は近く・遠くの地図のまま）
   */
  updateLocal(gl: THREE.WebGLRenderer, center: THREE.Vector2 | null, sun: THREE.Vector3, centerY = 0) {
    const u = townShadowUniforms
    if (!this.enabled || !center || sun.y < -0.02 || localShadowCasters.size === 0) {
      u.uShadowLocalInfo.value.y = 0
      return
    }
    const c = this.local
    c.center.copy(center)
    c.sun.copy(sun)
    const cam = c.camera
    const r = c.radius
    // 中心の高さは花音の足元（遠くのセットはラボの床より何十 m も低い）
    const target = new THREE.Vector3(center.x, centerY, center.y)
    const far = 160
    cam.position.copy(target).addScaledVector(sun, far * 0.5)
    cam.up.set(0, 1, 0)
    if (Math.abs(sun.y) > 0.99) cam.up.set(0, 0, -1)
    cam.lookAt(target)
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 1
    cam.far = far
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    cam.layers.enableAll()
    const prevTarget = gl.getRenderTarget()
    const prevAuto = gl.autoClear
    gl.setRenderTarget(c.target)
    gl.clear(true, true, false)
    gl.autoClear = false
    for (const root of localShadowCasters) {
      if (!root.visible || !root.parent) continue
      const swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = []
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const sm = o.userData.shadowMaterial as THREE.Material | undefined
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        if (o.userData.noLocalShadow || (!sm && mats.some((m) => m.transparent))) {
          swapped.push({ mesh, material: mesh.material })
          mesh.material = HIDDEN
          return
        }
        swapped.push({ mesh, material: mesh.material })
        mesh.material = sm ?? this.localDepth
      })
      gl.render(root, cam)
      for (const sw of swapped) sw.mesh.material = sw.material
    }
    gl.setRenderTarget(prevTarget)
    gl.autoClear = prevAuto
    u.uShadowM2.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).premultiply(_bias)
    u.uShadowLocalInfo.value.y = 1
  }

  /**
   * 必要なら影の地図を描き直す（1 コマに 1 枚まで）。center = 細かさの中心（シーンの x, z）、view = 見ている向き（シーンの x, z の単位ベクトル）、
   * sun = 太陽の向き、objects = 影を落とす物（userData.shadowMaterial を持つ物）
   */
  /** 影の地図を一度は描き先にしておく（読む前に深さのテクスチャとして作られていないと、シェーダーの比較の sampler と合わずに描けない）。遠景が見えていないコマでも呼ぶ */
  ensureInit(gl: THREE.WebGLRenderer) {
    if (!this.initialized) {
      this.initialized = true
      const prev = gl.getRenderTarget()
      for (const c of [...this.cascades, this.local]) {
        gl.setRenderTarget(c.target)
        gl.clear(true, true, false)
      }
      gl.setRenderTarget(prev)
    }
  }

  update(gl: THREE.WebGLRenderer, root: THREE.Object3D, center: THREE.Vector2, view: THREE.Vector2, sun: THREE.Vector3) {
    const u = townShadowUniforms
    this.ensureInit(gl)
    if (!this.enabled || sun.y < -0.02) {
      u.uShadowInfo.value.z = 0
      return
    }
    // 近くは中心から見ている向きへ 0.55 × 半径、遠くは 0.75 × 半径だけずらした所を中心にする
    const want = this.cascades.map((c, i) => new THREE.Vector2(center.x + view.x * c.radius * (i === 0 ? 0.55 : 0.75), center.y + view.y * c.radius * (i === 0 ? 0.55 : 0.75)))
    let drawn = false
    this.cascades.forEach((c, i) => {
      const moved = c.center.distanceTo(want[i]) > c.radius * 0.18
      const turned = c.sun.angleTo(sun) > THREE.MathUtils.degToRad(0.12)
      if (moved || turned || c.dirty) {
        if (drawn) return
        c.center.copy(want[i])
        c.sun.copy(sun)
        c.dirty = false
        this.render(gl, root, c)
        drawn = true
      }
    })
    this.cascades.forEach((c, i) => {
      const m = i === 0 ? u.uShadowM0.value : u.uShadowM1.value
      m.multiplyMatrices(c.camera.projectionMatrix, c.camera.matrixWorldInverse).premultiply(_bias)
    })
    u.uShadowInfo.value.z = 1
  }

  /** 次のコマで描き直す（町を組み立て直したとき） */
  invalidate() {
    for (const c of this.cascades) c.dirty = true
  }

  private render(gl: THREE.WebGLRenderer, root: THREE.Object3D, c: Cascade) {
    const cam = c.camera
    const r = c.radius
    // 太陽の向きから、範囲の中心（地面の高さ ≒ -100m）を見る。奥行きは影が長く伸びる朝夕でも足りるように
    const far = r * 2 + 3000
    const target = new THREE.Vector3(c.center.x, -90, c.center.y)
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
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    cam.layers.enableAll()
    // 影を落とす物だけ、深さだけのシェーダーで描く
    const hidden: THREE.Object3D[] = []
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh && !(o as THREE.Points).isPoints) return
      const sm = o.userData.shadowMaterial as THREE.Material | undefined
      if (sm && o.visible) {
        this.swapped.push({ mesh, material: mesh.material })
        mesh.material = sm
      } else if (o.visible) {
        o.visible = false
        hidden.push(o)
      }
    })
    const prevTarget = gl.getRenderTarget()
    const prevAuto = gl.autoClear
    const prevBg = (root as THREE.Scene).background
    gl.autoClear = true
    gl.setRenderTarget(c.target)
    gl.clear(true, true, false)
    gl.render(root, cam)
    gl.setRenderTarget(prevTarget)
    gl.autoClear = prevAuto
    if ((root as THREE.Scene).isScene) (root as THREE.Scene).background = prevBg
    for (const s of this.swapped) s.mesh.material = s.material
    this.swapped = []
    for (const o of hidden) o.visible = true
  }

  dispose() {
    for (const c of this.cascades) c.target.dispose()
    this.local.target.dispose()
  }
}

/** 深さだけのシェーダー（形の頂点のシェーダーをそのまま使う）。alphaTest の物は葉の形で抜く */
export function depthMaterial(vertexShader: string, opts: { defines?: Record<string, string>; uniforms?: Record<string, THREE.IUniform>; fragment?: string; side?: THREE.Side } = {}) {
  return new THREE.ShaderMaterial({
    name: 'townShadowDepth',
    defines: opts.defines ?? {},
    uniforms: opts.uniforms ?? {},
    vertexShader,
    fragmentShader: opts.fragment ?? 'void main() { gl_FragColor = vec4(1.0); }',
    side: opts.side ?? THREE.DoubleSide,
    colorWrite: false,
  })
}

/** ふつうの形（とインスタンス）の深さだけの頂点のシェーダー */
export const PLAIN_DEPTH_VERTEX = /* glsl */ `
void main() {
  #ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
  vec4 wp = modelMatrix * vec4(position, 1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
