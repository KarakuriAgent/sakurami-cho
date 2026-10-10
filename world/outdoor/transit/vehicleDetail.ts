import * as THREE from 'three'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { GeoBuilder } from '../site/builder'
import { TOWN_LIGHT } from '../town/facades'
import { TOWN_LAMPS, lampUniforms } from '../town/lamps'
import { TOWN_SHADOW, townShadowUniforms } from '../town/shadows'

/**
 * 乗れる車両の細かい形（緑電 9100 形 tramCar.ts・運河バス waterbusCar.ts）の共通の部品: シェーダー（町と同じ光、中は窓から入る空と太陽・
 * 天井の灯り）・材質の番号・形を作る道具・インスタンスの入れ物。丘ノ上ケーブルの車両（cableCar.ts）と同じ考えで、車両ごとの
 * 「中か」「窓を通る日なたか」「天井の灯り」だけを GLSL で渡す。docs/design/town.md §20。
 *
 * インスタンスの iInfo = (中の灯り 0〜1, 扉の開き具合 0〜1, 扉の側（局所の x の向き ±1）, 系統の色の番号 + 種 × 0.5)
 */

/** 材質の番号（aMat.x） */
export const VM = {
  /** 外の塗装。aux = つや */
  paint: 0,
  /** 化粧板（壁の腰・仕切り）。aux = 明るさのむら */
  panel: 1,
  /** 座席のモケット。aux = 0 緑の細かい柄（緑電）・1 紺の縞（運河バス） */
  fabric: 2,
  /** ステンレス・真鍮（握り棒・つり革の金具）。aux = 0 ステンレス・1 真鍮 */
  metal: 3,
  /** 床。aux = 0 ゴムの床（粒の滑り止め）・1 木の甲板（板張り） */
  floor: 4,
  /** 天井 */
  ceiling: 5,
  /** 灯り。aux = 0 中の灯り・1 前照灯・2 尾灯・3 舳先のランタン（夜にいつも） */
  lamp: 6,
  /** 黒い物（ゴム・台車・床下）。aux = つや */
  dark: 7,
  /** 屋根（灰色） */
  roof: 8,
  /** 樹脂（つり革の輪・取っ手）。aux = つや */
  plastic: 9,
  /** 案内の表示（橙の点の文字。暗い地）。aux = 種 */
  display: 10,
  /** 屋根庭（多肉植物と苔） */
  garden: 11,
  /** ニスを塗った木。aux = 木目の向き（0 横・1 縦） */
  wood: 12,
} as const

export type V3 = [number, number, number]

/** 2 点を結ぶ管（8 角） */
export function tube(g: GeoBuilder, a: V3, b: V3, r: number, color: string, m: number, aux = 0, seg = 8) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = d.length()
  if (len < 1e-4) return
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  const mtx = new THREE.Matrix4().compose(new THREE.Vector3(...a), q, new THREE.Vector3(1, 1, 1))
  g.lathe(
    [
      [r, 0],
      [r, len],
    ],
    seg,
    mtx,
    color,
    m,
    aux,
  )
}

/** 輪（中心・輪の面の法線の向き（x か z）・半径・太さ） */
export function ring(g: GeoBuilder, c: V3, axis: 'x' | 'z', R: number, r: number, color: string, m: number, aux = 0) {
  const prof: [number, number][] = []
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2
    prof.push([R + Math.cos(a) * r, Math.sin(a) * r])
  }
  const mtx = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  if (axis === 'x') mtx.premultiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
  mtx.setPosition(c[0], c[1], c[2])
  g.lathe(prof, 14, mtx, color, m, aux)
}

/** z0〜z1・y0〜y1 の縦の面（x の位置、表の向き sx） */
export function sideRect(g: GeoBuilder, x: number, sx: number, z0: number, z1: number, y0: number, y1: number, color: string, m: number, aux = 0) {
  if (z1 - z0 < 1e-4 || y1 - y0 < 1e-4) return
  if (sx > 0) g.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], color, m, aux)
  else g.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], color, m, aux)
}

/** x0〜x1・y0〜y1 の z の面（表の向き sz） */
export function endRect(g: GeoBuilder, z: number, sz: number, x0: number, x1: number, y0: number, y1: number, color: string, m: number, aux = 0) {
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return
  if (sz > 0) g.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], color, m, aux)
  else g.quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], color, m, aux)
}

/** 水平の面（y の位置、表の向き sy） */
export function flatRect(g: GeoBuilder, y: number, sy: number, x0: number, x1: number, z0: number, z1: number, color: string, m: number, aux = 0) {
  if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4) return
  if (sy > 0) g.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color, m, aux)
  else g.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], color, m, aux)
}

/**
 * 車両ごとの GLSL（局所の座標で）:
 * - `bool vehInside(vec3 p)`: 中の点か（壁・床・天井の内）
 * - `float vehSunThrough(vec3 p, vec3 L)`: 中の点 p から光の向き L へ、窓を通って外へ出るか（0〜1）
 * - `vec3 vehLamp(vec3 p, vec3 n)`: 天井の灯りの照度（電球色。点き具合を掛ける前。中の点）
 * - `bool vehCamInside(vec3 c)`: ガラスのシェーダーで、カメラ（局所）が中か
 */
export interface VehicleGlsl {
  name: string
  glsl: string
}

const VERTEX = /* glsl */ `
  attribute vec2 aMat;
  attribute vec4 iInfo;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec4 vInfo;
  varying vec3 vSunLocal;
  varying vec3 vCamLocal;
  uniform vec3 uSunDir;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vWorld = wp.xyz;
    mat3 r = mat3(m);
    vNormal = normalize(r * normal);
    vColor = color;
    vMat = aMat;
    vInfo = iInfo;
    mat3 rt = transpose(r);
    vSunLocal = normalize(rt * uSunDir);
    vLocal = position;
    vLocalN = normal;
    vCamLocal = rt * (cameraPosition - m[3].xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const fragment = (v: VehicleGlsl) => /* glsl */ `
  ${COMMON}
  ${SKY}
  ${TOWN_LIGHT}
  ${TOWN_SHADOW}
  ${TOWN_LAMPS}
  ${v.glsl}
  uniform vec3 uLineColors[8];
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec4 vInfo;
  varying vec3 vSunLocal;
  varying vec3 vCamLocal;
  vec3 envRefl(vec3 R) {
    return R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.22 + uSunLight * 0.03, smoothstep(0.0, -0.25, R.y));
  }
  float woodGrain(vec2 uv) {
    float n = oNoise(vec2(uv.x * 2.0, uv.y * 30.0));
    float rings = 0.5 + 0.5 * sin((uv.y * 70.0 + n * 6.0 + oNoise(uv * vec2(0.6, 4.0)) * 9.0));
    return 0.84 + 0.12 * rings + 0.1 * n;
  }
  void main() {
    vec3 N = normalize(vNormal);
    vec3 Nl = normalize(vLocalN);
    if (!gl_FrontFacing) { N = -N; Nl = -Nl; }
    float id = floor(vMat.x + 0.5);
    float aux = vMat.y;
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);
    vec3 albedo = vColor;
    float gloss = 0.12;
    float metal = 0.0;
    vec3 emit = vec3(0.0);
    bool inside = vehInside(vLocal);
    float lampOn = vInfo.x;
    vec3 an = abs(Nl);
    vec2 uv = an.y > 0.7 ? vLocal.xz : an.x > an.z ? vLocal.zy : vLocal.xy;
    if (id < 0.5) {
      gloss = 0.3 + 0.5 * aux;
      albedo *= 0.96 + 0.06 * oNoise(uv * 3.0 + fract(vInfo.w) * 17.0);
      // 下ほど少し汚れる
      albedo *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.9, vLocal.y));
    } else if (id < 1.5) {
      albedo *= 0.96 + 0.05 * oNoise(uv * 4.0) + 0.03 * aux;
      gloss = 0.28;
    } else if (id < 2.5) {
      if (aux < 0.5) {
        // 緑の細かい柄（小さな菱の目と、すこし明るい点）
        vec2 q = uv * 38.0;
        float dia = abs(fract(q.x + q.y * 0.5) - 0.5) + abs(fract(q.y) - 0.5);
        albedo *= 0.82 + 0.16 * smoothstep(0.42, 0.5, dia) + 0.08 * oNoise(uv * 60.0);
      } else {
        float stripe = step(0.5, fract(uv.x * 7.0));
        albedo *= mix(0.86, 1.06, stripe) + 0.06 * oNoise(uv * 50.0);
      }
      gloss = 0.02;
    } else if (id < 3.5) {
      metal = 1.0;
      gloss = aux > 0.5 ? 0.62 : 0.78;
      albedo *= 0.92 + 0.08 * oNoise(vec2(uv.x * 3.0, uv.y * 50.0));
    } else if (id < 4.5) {
      if (aux < 0.5) {
        // ゴムの床（丸い粒の滑り止め）
        vec2 c = fract(vLocal.xz / 0.045) - 0.5;
        float dot2 = 1.0 - smoothstep(0.12, 0.2, length(c));
        albedo *= 0.9 + 0.08 * dot2 + 0.06 * oNoise(vLocal.xz * 3.0);
        gloss = 0.1 + 0.08 * dot2;
      } else {
        // 木の甲板（幅 9cm の板と目地）
        float row = floor(vLocal.x / 0.09);
        float seam = smoothstep(0.0, 0.006, abs(fract(vLocal.x / 0.09) - 0.5) * 0.09 - 0.04 + 0.006);
        albedo *= (0.82 + 0.25 * oHash(vec2(row, floor(vLocal.z / 1.8 + oHash(vec2(row, 7.0)))))) * woodGrain(vec2(vLocal.x * 3.0, vLocal.z));
        albedo *= 0.62 + 0.38 * seam;
        gloss = 0.22;
      }
    } else if (id < 5.5) {
      albedo *= 0.96 + 0.04 * oNoise(uv * 5.0);
      gloss = 0.1;
    } else if (id < 6.5) {
      albedo = vColor * 0.5;
      if (aux < 0.5) emit = vColor * (0.15 + 3.0 * lampOn);
      else if (aux < 1.5) emit = vColor * (0.2 + 2.6 * lampOn);
      else if (aux < 2.5) emit = vColor * (0.4 + 6.0 * lampOn);
      else emit = vColor * (0.3 + 3.5 * max(lampOn, 1.0 - uDaylight));
      gloss = 0.6;
    } else if (id < 7.5) {
      gloss = 0.05 + 0.4 * aux;
      albedo *= 0.9 + 0.1 * oNoise(uv * 20.0);
    } else if (id < 8.5) {
      gloss = 0.12;
      albedo *= 0.9 + 0.12 * oNoise(uv * vec2(2.0, 12.0));
    } else if (id < 9.5) {
      gloss = 0.2 + 0.4 * aux;
    } else if (id < 10.5) {
      // 案内の表示: 暗い地に橙の点の字（5 × 7 の点の字を並べる。4 秒ごとに表示が替わる（日本語と英語のように））
      vec2 q = vec2((an.x > an.z ? vLocal.z : vLocal.x) * 72.0, vLocal.y * 72.0);
      vec2 cell = floor(q);
      float cx = floor(cell.x / 6.0);
      float dx = cell.x - cx * 6.0;
      float row = floor(cell.y / 9.0);
      float dy = cell.y - row * 9.0;
      float page = floor(uTime / 4.0 + aux);
      float glyph = step(0.2, oHash(vec2(cx + page * 5.0, row + aux * 3.0)));
      float on = (dx < 5.0 && dy < 7.0) ? step(0.5, oHash(vec2(cx * 7.0 + dx + page * 31.0 + aux * 17.0, row * 11.0 + dy))) * glyph : 0.0;
      float dot1 = 1.0 - smoothstep(0.28, 0.45, length(fract(q) - 0.5));
      albedo = vec3(0.02);
      emit = vec3(1.0, 0.45, 0.08) * on * dot1 * 2.2 * (0.35 + 0.65 * max(lampOn, 0.6));
      gloss = 0.5;
    } else if (id < 11.5) {
      albedo *= 0.75 + 0.35 * oNoise(vLocal.xz * 9.0);
      gloss = 0.05;
    } else {
      vec2 wuv = aux > 0.5 ? uv.yx : uv;
      albedo *= woodGrain(wuv);
      gloss = 0.32;
    }
    float sh = townShadow(vWorld, N);
    vec3 col;
    if (inside) {
      float ao = (Nl.y < -0.5 ? 0.24 : Nl.y > 0.5 ? 0.32 : 0.36);
      float sun = vehSunThrough(vLocal, vSunLocal) * max(dot(Nl, vSunLocal), 0.0) * sh;
      col = albedo * (uSunLight * sun + (uSkyLight * 0.95 + uSunLight * 0.06) * ao);
    } else {
      col = townLight(albedo * (1.0 - metal * 0.6), N, 1.0, sh);
    }
    vec3 H = normalize(V + uSunDir);
    float pw = mix(10.0, 260.0, gloss);
    float f0 = mix(0.04, 0.9, metal);
    float fres = f0 + (1.0 - f0) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
    if (!inside) col += uSunLight * pow(max(dot(N, H), 0.0), pw) * (pw + 2.0) / 8.0 * fres * sh * max(dot(N, uSunDir), 0.0) * gloss;
    vec3 R = reflect(-V, N);
    vec3 env = envRefl(R);
    if (inside) env = mix(vec3(0.55, 0.5, 0.42) * (uSkyLight * 0.25 + vec3(0.06, 0.05, 0.04) * lampOn), env, 0.3);
    col += env * fres * mix(gloss * 0.5, 0.9, metal) * mix(vec3(1.0), albedo * 2.0, metal);
    if (inside) {
      col += albedo * vehLamp(vLocal, Nl) * lampOn;
      // 夜の町の灯り（停留所・街灯）が窓から入る分（少し）
      col += albedo * townLamps(vWorld, N) * 0.25;
    } else {
      col += albedo * townLamps(vWorld, N) * 0.6;
    }
    col = outdoorHaze(col, vWorld);
    col += emit * exp(-dist / (uHazeDist * 1.5));
    gl_FragColor = vec4(col, 1.0);
    ${TONE}
  }
`

const GLASS_FRAGMENT = (v: VehicleGlsl) => /* glsl */ `
  ${COMMON}
  ${SKY}
  ${v.glsl}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec4 vInfo;
  varying vec3 vSunLocal;
  varying vec3 vCamLocal;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    if (dot(N, V) < 0.0) N = -N;
    float cosv = max(dot(N, V), 0.0);
    float fres = 0.04 + 0.96 * pow(clamp(1.0 - cosv, 0.0, 1.0), 5.0);
    vec3 R = reflect(-V, N);
    vec3 refl = R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.22, smoothstep(0.0, -0.25, R.y));
    refl += uSunLight * pow(max(dot(R, uSunDir), 0.0), 900.0) * 30.0 * smoothstep(-0.02, 0.05, uSunDir.y);
    bool camIn = vehCamInside(vCamLocal);
    float lampOn = vInfo.x;
    vec3 room = vec3(0.95, 0.85, 0.7) * lampOn * 0.3;
    float a = clamp(0.06 + fres * 0.85, 0.0, 0.92);
    vec3 col = refl;
    if (camIn) {
      col = mix(refl, room + refl * 0.4, clamp(lampOn * 0.7 * (1.0 - uDaylight), 0.0, 0.7));
      a = clamp(a + lampOn * 0.1 * (1.0 - uDaylight), 0.0, 0.92);
    } else {
      col += room * 0.6 * (1.0 - uDaylight);
    }
    col = mix(vec3(0.03, 0.035, 0.03), col, 0.92);
    col = outdoorHaze(col, vWorld);
    gl_FragColor = vec4(col, a);
    ${TONE}
  }
`

/** 細かい車両の不透明な面のシェーダー（インスタンス） */
export function createDetailMaterial(v: VehicleGlsl, lineColors: { value: THREE.Color[] }) {
  return new THREE.ShaderMaterial({
    name: `${v.name}Detail`,
    vertexColors: true,
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...lampUniforms, uLineColors: lineColors },
    vertexShader: VERTEX,
    fragmentShader: fragment(v),
  })
}

/** 細かい車両のガラス（透ける。空を映し、夜は中の灯りの色） */
export function createDetailGlassMaterial(v: VehicleGlsl) {
  return new THREE.ShaderMaterial({
    name: `${v.name}DetailGlass`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms },
    vertexShader: VERTEX,
    fragmentShader: GLASS_FRAGMENT(v),
  })
}

/** インスタンスの部品（形 1 つ・iInfo つき）。毎コマ begin → set → end */
export class InstancedPart {
  readonly mesh: THREE.InstancedMesh
  private readonly info: THREE.InstancedBufferAttribute
  count = 0
  readonly capacity: number

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, capacity: number) {
    this.capacity = capacity
    this.info = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    this.info.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('iInfo', this.info)
    const mesh = new THREE.InstancedMesh(geo, mat, capacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.name = name
    this.mesh = mesh
  }

  begin() {
    this.count = 0
  }

  add(m: THREE.Matrix4, info: readonly number[]) {
    const i = this.count
    if (i >= this.capacity) return false
    this.mesh.setMatrixAt(i, m)
    this.info.setXYZW(i, info[0], info[1], info[2], info[3])
    this.count++
    return true
  }

  end() {
    const n = this.count
    const mesh = this.mesh
    mesh.count = n
    mesh.visible = n > 0
    if (!n) return
    mesh.instanceMatrix.clearUpdateRanges()
    mesh.instanceMatrix.addUpdateRange(0, n * 16)
    mesh.instanceMatrix.needsUpdate = true
    this.info.clearUpdateRanges()
    this.info.addUpdateRange(0, n * 4)
    this.info.needsUpdate = true
  }
}
