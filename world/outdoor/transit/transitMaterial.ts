import * as THREE from 'three'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { TOWN_LIGHT } from '../town/facades'
import { TOWN_SHADOW, townShadowUniforms } from '../town/shadows'
import { TEXTURE_DECL, townTextureUniforms } from '../town/townTextures'
import { TOWN_LAMPS, lampUniforms } from '../town/lamps'

/**
 * 交通の物（車両・船・線路・架線柱・停留所・信号・街灯の柱）のシェーダー。町と同じ光（太陽・空・町の影・空気遠近・夜の灯りの表）。
 *
 * 頂点: 位置・法線・色（質感を染める色。リニア）・aMat（x = 質感の種類 TM、y = 種類ごとの値）。site/builder.ts の GeoBuilder で作る。
 * 車両はインスタンス（instanceMatrix と iInfo = (x: 前照灯 +1 / 尾灯 -1 / なし 0, y: 車内の灯り 0〜1, z: 系統の色の番号, w: 種)）。
 *
 * - 塗装: 太陽のハイライトと空の映り込み（つや）、下ほど汚れ
 * - 客室の窓: 車内の箱（床・天井と灯り・向かいの窓と座席・手すり）を視差で描く（インテリアマッピング）。夜は車内の灯りで光る
 * - 行き先の表示: 系統の色の帯と、橙の点の文字（いつも光る）
 */

export const TM = {
  paint: 0,
  /** 窓（y < 0.5 客室（床の高さ = y × 10 m）・1 停留所や建物のガラス・2 運転台の前面） */
  glass: 1,
  metal: 2,
  /** 黒い物（台車・床下・ゴム。y = つや） */
  dark: 3,
  /** 屋根庭（多肉植物と苔） */
  garden: 4,
  /** 行き先の表示（y = 表示の左の端の局所の座標） */
  sign: 5,
  head: 6,
  tail: 7,
  /** 木（y = 色の濃さ） */
  wood: 8,
  /** 光る物（y = 強さ。灯りの点き具合 uLampOn に従う） */
  lamp: 9,
  /** コンクリート（y = 目地の間隔 m） */
  concrete: 10,
  /** 石（砂利・御影石） */
  stone: 11,
  /** 系統の色で塗る（停留所の標識。y = 系統の番号） */
  line: 12,
  /** 信号の灯（y = 色（0 赤・1 黄・2 青）+ 4 × 組（0 / 1）+ 8 × 位相の秒（0〜79）） */
  signal: 13,
  /** 布・座席（y = 色の番号） */
  cloth: 14,
  /** 観覧車のゴンドラの屋根の色（インスタンスの種で 5 色。y = つや） */
  tint: 15,
} as const

export const transitUniforms = {
  /** 系統の色（0 = なし、1〜4 = 緑電、5 = ヒノテツ、6 = 運河バス、7 = 連絡船） */
  uLineColors: { value: Array.from({ length: 8 }, () => new THREE.Color(0.5, 0.5, 0.5)) },
  /** 街灯・停留所の灯り・車内の灯りの点き具合（0〜1）と、夜の明るさの倍率 */
  uLampOn: { value: 0 },
  uLightGain: { value: 1 },
  /** 信号の時計（交通の時計の秒） */
  uSignalT: { value: 0 },
}

const VERTEX = /* glsl */ `
  attribute vec2 aMat;
  #ifdef USE_INSTANCING
  attribute vec4 iInfo;
  #endif
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec3 vLocalView;
  varying vec4 vInfo;
  void main() {
    #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
    vInfo = iInfo;
    #else
    mat4 m = modelMatrix;
    vInfo = vec4(0.0, 0.0, 0.0, 0.5);
    #endif
    vec4 wp = m * vec4(position, 1.0);
    vWorld = wp.xyz;
    mat3 r = mat3(m);
    vNormal = normalize(r * normal);
    vColor = color;
    vMat = aMat;
    vLocal = position;
    vLocalN = normal;
    // 視線を形の局所の座標へ（回転だけ。大きさは 1）
    vLocalView = transpose(r) * (wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAGMENT = /* glsl */ `
  ${COMMON}
  ${SKY}
  ${TOWN_LIGHT}
  ${TOWN_SHADOW}
  ${TEXTURE_DECL}
  ${TOWN_LAMPS}
  uniform vec3 uLineColors[8];
  uniform float uLampOn;
  uniform float uLightGain;
  uniform float uSignalT;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec3 vLocalView;
  varying vec4 vInfo;
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 layerAlb(highp sampler2DArray s, vec2 uv, float layer) { return pow(max(texture(s, vec3(uv, layer)).rgb * 2.0, 0.0), vec3(2.2)); }

  /** 映り込み（地平線より下は町と地面の暗い色） */
  vec3 envRefl(vec3 R) {
    return R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.22 + uSunLight * 0.03, smoothstep(0.0, -0.25, R.y));
  }

  /**
   * 客室の中（局所の座標: x = 横、y = 上、z = 前後。床の高さ floorY）。窓の面の点 p と、局所の視線 rd（窓へ向かう向き）。
   * 戻り値は光を当てたあとの色
   */
  vec3 cabin(vec3 p, vec3 rd, float lit, float seed, float floorY) {
    float hw = abs(p.x) + 0.04;
    float side = sign(p.x);
    vec3 o = p;
    vec3 r = rd;
    r.x = abs(r.x) < 1e-3 ? -side * 1e-3 : r.x;
    float ceilY = floorY + 2.05;
    // 向かいの壁（x = -side * hw）・床・天井
    float tx = (-side * hw - o.x) / r.x;
    float ty = r.y < 0.0 ? (floorY - o.y) / r.y : (ceilY - o.y) / max(r.y, 1e-3);
    float t = max(min(tx, ty), 0.0);
    vec3 h = o + r * t;
    // 車内の灯り（LED の電球色。夜の窓が明るく見えるよう強め）
    vec3 lamp = vec3(1.0, 0.86, 0.66) * 3.2;
    vec3 dayAmb = uSkyLight * 0.35 + uSunLight * 0.05;
    vec3 col;
    if (ty < tx && r.y < 0.0) {
      // 床（灰色の床材）
      col = vec3(0.12, 0.12, 0.115) * (0.9 + 0.2 * oNoise(h.xz * 3.0));
      col *= dayAmb * 1.4 + lamp * lit * 1.1;
    } else if (ty < tx) {
      // 天井（白い板と、まんなかの灯りの帯）
      float strip = 1.0 - smoothstep(0.08, 0.14, abs(h.x));
      col = vec3(0.6) * (dayAmb + lamp * lit * 0.6) + lamp * strip * lit * 2.5;
    } else {
      // 向かいの壁: 腰の高さの長い座席（モケット）・その上の窓（外）・手すりの柱
      float y = h.y - floorY;
      vec3 seatC = mix(vec3(0.08, 0.16, 0.12), vec3(0.18, 0.08, 0.06), step(0.5, fract(seed * 7.0)));
      if (y < 0.85) col = (y > 0.42 ? seatC : vec3(0.05)) * (dayAmb * 1.2 + lamp * lit);
      else if (y < 0.95) col = vec3(0.25) * (dayAmb + lamp * lit);
      else if (y < 1.9) col = mix(uSkyLight * 0.55 + uSunLight * 0.08, vec3(0.03, 0.035, 0.05), 0.6 * lit + 0.25);
      else col = vec3(0.5) * (dayAmb + lamp * lit * 0.8);
      float pole = 1.0 - smoothstep(0.015, 0.03, abs(fract(h.z / 1.6) - 0.5) * 1.6);
      col = mix(col, vec3(0.6) * (dayAmb + lamp * lit) + 0.05, pole * 0.8);
      col *= 0.75 + 0.25 * exp(-t * 0.3);
    }
    return col;
  }

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    float id = floor(vMat.x + 0.5);
    float aux = vMat.y;
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);
    vec3 albedo = vColor;
    float gloss = 0.1;
    float metal = 0.0;
    vec3 emit = vec3(0.0);
    float ao = 1.0;
    // 局所の座標の投影（質感・模様）
    vec3 an = abs(vLocalN);
    vec2 uv = an.y > 0.7 ? vLocal.xz : an.x > an.z ? vLocal.zy : vLocal.xy;
    vec2 wuv = abs(N.y) > 0.7 ? vWorld.xz : abs(N.x) > abs(N.z) ? vWorld.zy : vWorld.xy;
    float n1 = oNoise(uv * 1.3 + vInfo.w * 17.0);
    // 車両の下ほど暗い（床下・台車のまわり）
    #ifdef USE_INSTANCING
    ao = mix(0.55, 1.0, smoothstep(0.1, 1.0, vLocal.y));
    #endif
    if (id < 0.5) {
      // 塗装（aux = つや）: 下ほど汚れ
      gloss = 0.25 + 0.6 * aux;
      #ifdef USE_INSTANCING
      float grime = (1.0 - smoothstep(0.3, 1.4, vLocal.y)) * (0.5 + 0.5 * n1);
      albedo *= 1.0 - 0.28 * grime;
      #endif
      albedo *= 0.96 + 0.08 * oNoise(uv * 0.4);
    } else if (id < 1.5) {
      // 窓
      vec3 Nl = normalize(vLocalN);
      vec3 rd = normalize(vLocalView);
      float fres = 0.06 + 0.94 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
      vec3 R = reflect(-V, N);
      vec3 refl = envRefl(R) + uSunLight * pow(max(dot(R, uSunDir), 0.0), 600.0) * 20.0 * smoothstep(-0.02, 0.05, uSunDir.y);
      vec3 inside;
      float lit = vInfo.y * uLampOn;
      if (aux < 0.5 && abs(Nl.x) > 0.5 && dot(rd, Nl) < 0.0) inside = cabin(vLocal, rd, lit, vInfo.w, aux * 10.0);
      else if (aux > 1.5) inside = vec3(0.02, 0.022, 0.025) + vec3(1.0, 0.86, 0.66) * lit * 0.15;
      else inside = vec3(0.025, 0.028, 0.03) * (uSkyLight * 2.0 + 0.2) + vec3(1.0, 0.86, 0.66) * lit * (aux < 0.5 ? 0.6 : 0.0);
      vec3 col = mix(inside, refl, clamp(fres * 0.85 + 0.06, 0.0, 0.9));
      col = outdoorHaze(col, vWorld);
      gl_FragColor = vec4(col, 1.0);
      ${TONE}
      return;
    } else if (id < 2.5) {
      // ステンレス・アルミ（細かい筋）
      metal = 1.0;
      gloss = 0.55;
      albedo *= 0.9 + 0.1 * oNoise(vec2(uv.x * 0.5, uv.y * 40.0));
    } else if (id < 3.5) {
      gloss = 0.05 + 0.4 * aux;
      albedo *= 0.85 + 0.15 * n1;
    } else if (id < 4.5) {
      // 屋根庭: 多肉植物と苔のまだら（芝の質感の層を緑と赤茶にまぜる）
      vec3 g = layerAlb(uGndAlb, uv / 1.6, 0.0);
      float m = oNoise(uv * 2.7 + 3.0);
      albedo = mix(vec3(0.035, 0.07, 0.022), vec3(0.09, 0.07, 0.03), smoothstep(0.55, 0.8, m)) * (0.7 + 0.6 * clamp(lum(g) / 0.2, 0.0, 1.5));
      albedo = mix(albedo, vec3(0.2, 0.06, 0.08), smoothstep(0.78, 0.9, oNoise(uv * 6.0)) * 0.6);
      gloss = 0.03;
      ao *= 0.8 + 0.2 * m;
    } else if (id < 5.5) {
      // 行き先の表示（aux = 表示の左の端の局所の座標）: 系統の色の四角と、橙の点の文字（いつも光る。昼はうすく見える）
      vec3 lc = uLineColors[int(vInfo.z + 0.5)];
      float along = an.x > an.z ? vLocal.z : vLocal.x;
      float u = abs(along - aux);
      vec2 q = vec2(along, vLocal.y) * 28.0;
      vec2 cellId = floor(q);
      float dotm = 1.0 - smoothstep(0.25, 0.42, length(fract(q) - 0.5));
      float ch = step(0.4, oHash(floor(cellId / vec2(5.0, 7.0)) + vInfo.z * 3.1)) * step(0.3, oHash(cellId + vInfo.z));
      albedo = vec3(0.01);
      emit = vec3(1.0, 0.55, 0.12) * dotm * ch * 1.4 * step(0.26, u);
      emit += lc * 1.3 * (1.0 - step(0.22, u)) * step(0.03, u);
      gloss = 0.6;
    } else if (id < 6.5) {
      // 前照灯（前の車両だけ）
      float on = step(0.5, vInfo.x);
      albedo = vec3(0.6);
      emit = vec3(1.0, 0.95, 0.85) * on * (1.5 + 6.0 * uLampOn);
      gloss = 0.9;
    } else if (id < 7.5) {
      float on = step(vInfo.x, -0.5);
      albedo = vec3(0.12, 0.01, 0.01);
      emit = vec3(1.0, 0.06, 0.04) * on * (0.6 + 2.4 * uLampOn);
      gloss = 0.9;
    } else if (id < 8.5) {
      vec3 t = layerAlb(uBldAlb, vec2(uv.x * 0.5, uv.y * 0.5), 0.0);
      albedo *= mix(vec3(1.0), t, 0.7);
      gloss = 0.15;
    } else if (id < 9.5) {
      // 光る物（灯具・提灯）
      emit = vColor * aux * uLampOn * uLightGain;
      albedo = vColor * 0.4;
      gloss = 0.3;
    } else if (id < 10.5) {
      vec3 t = layerAlb(uBldAlb, wuv / 3.2, 4.0);
      albedo *= mix(vec3(1.0), vec3(lum(t)) * 2.0, 0.7);
      if (aux > 0.01) {
        vec2 g = abs(fract(wuv / aux + 0.5) - 0.5) * aux;
        float joint = 1.0 - smoothstep(0.004, 0.012 + fwidth(wuv.x), min(g.x, g.y));
        albedo *= 1.0 - 0.35 * joint * (1.0 - smoothstep(30.0, 120.0, dist));
      }
      gloss = 0.06;
    } else if (id < 11.5) {
      vec3 t = layerAlb(uGndAlb, wuv / 1.2, 2.0);
      albedo *= mix(vec3(1.0), t * 2.0, 0.8);
      gloss = 0.04;
    } else if (id < 12.5) {
      albedo = uLineColors[int(aux + 0.5)] * 0.8;
      gloss = 0.4;
    } else if (id < 13.5) {
      // 信号の灯: 80 秒の周期で、組 0 は 0〜35 秒が青・35〜38 秒が黄、組 1 は 40 秒ずれる
      float colorId = mod(aux, 4.0);
      float group = mod(floor(aux / 4.0), 2.0);
      float tt = mod(uSignalT + floor(aux / 8.0) + group * 40.0, 80.0);
      float state = tt < 35.0 ? 2.0 : tt < 38.0 ? 1.0 : 0.0;
      float on = 1.0 - step(0.5, abs(state - colorId));
      vec3 c = colorId < 0.5 ? vec3(1.0, 0.08, 0.04) : colorId < 1.5 ? vec3(1.0, 0.6, 0.05) : vec3(0.05, 1.0, 0.55);
      albedo = c * 0.08;
      emit = c * on * (1.6 + 3.0 * uLampOn);
      gloss = 0.8;
    } else if (id < 14.5) {
      // 布
      albedo *= 0.85 + 0.3 * oNoise(uv * 30.0);
      gloss = 0.03;
    } else {
      // ゴンドラの屋根（パステルの 5 色）
      float k = floor(fract(vInfo.w * 5.0 + 0.01) * 5.0);
      albedo = k < 0.5 ? vec3(0.62, 0.16, 0.14) : k < 1.5 ? vec3(0.14, 0.3, 0.52) : k < 2.5 ? vec3(0.62, 0.5, 0.12) : k < 3.5 ? vec3(0.16, 0.42, 0.26) : vec3(0.55, 0.3, 0.42);
      gloss = 0.25 + 0.6 * aux;
    }
    float sh = townShadow(vWorld, N);
    vec3 col = townLight(albedo * (1.0 - metal * 0.6), N, ao, sh);
    vec3 H = normalize(V + uSunDir);
    float pw = mix(10.0, 260.0, gloss);
    float fres = mix(0.04, 0.9, metal) + (1.0 - mix(0.04, 0.9, metal)) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
    col += uSunLight * pow(max(dot(N, H), 0.0), pw) * (pw + 2.0) / 8.0 * fres * sh * max(dot(N, uSunDir), 0.0) * gloss;
    vec3 R = reflect(-V, N);
    col += envRefl(R) * fres * mix(gloss * 0.5, 0.9, metal) * mix(vec3(1.0), albedo * 2.0, metal) * ao;
    // 夜: 町の灯り
    col += albedo * townLamps(vWorld, N);
    col = outdoorHaze(col, vWorld);
    col += emit * exp(-dist / (uHazeDist * 1.5));
    gl_FragColor = vec4(col, 1.0);
    ${TONE}
  }
`

/** 交通の物のシェーダー（車両はインスタンス。動かない物は 1 つの形） */
export function createTransitMaterial() {
  return new THREE.ShaderMaterial({
    name: 'transit',
    vertexColors: true,
    side: THREE.FrontSide,
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...townTextureUniforms, ...lampUniforms, ...transitUniforms },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
}

/**
 * 細い線（架線・吊架線・観覧車のスポークの綱・ケーブルカーの綱・提灯の綱）。線分ごとの四角を、画面で 1.2px より細くならない太さに広げ、
 * 本当の太さが細い所はうすくする（遠くの線がちらつかない）。頂点: position = 端の点、aOther = もう一方の端、aSide = ±1、aWidth = 太さ（m）
 */
export function createWireMaterial(color: THREE.ColorRepresentation) {
  return new THREE.ShaderMaterial({
    name: 'transitWire',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, uColor: { value: new THREE.Color(color) }, uPx: { value: 500 }, uGlow: { value: 0 }, uGlowColor: { value: new THREE.Color(1, 0.8, 0.5) } },
    vertexShader: /* glsl */ `
      attribute vec3 aOther;
      attribute float aSide;
      attribute float aWidth;
      uniform float uPx;
      varying float vAlpha;
      varying vec3 vWorld;
      varying float vAlong;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 wo = modelMatrix * vec4(aOther, 1.0);
        vWorld = wp.xyz;
        vec4 cp = viewMatrix * wp;
        float d = max(-cp.z, 0.1);
        // 画面の太さ（px）
        float px = aWidth * uPx / d;
        float w = max(px, 1.2) / uPx * d;
        vAlpha = clamp(px / 1.2, 0.0, 1.0);
        vec3 dir = normalize(wo.xyz - wp.xyz);
        vec3 toCam = normalize(cameraPosition - wp.xyz);
        vec3 side = normalize(cross(dir, toCam));
        wp.xyz += side * aSide * w * 0.5;
        vAlong = aSide;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uColor;
      uniform float uGlow;
      uniform vec3 uGlowColor;
      varying float vAlpha;
      varying vec3 vWorld;
      varying float vAlong;
      void main() {
        vec3 col = uColor * (uSkyLight * 0.8 + uSunLight * 0.35) + uGlowColor * uGlow;
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, vAlpha * (1.0 - 0.3 * abs(vAlong)));
        ${TONE}
      }
    `,
  })
}

/** 細い線の形を作る道具（線分を足して、最後に 1 つの形に） */
export class WireBatch {
  private pos: number[] = []
  private other: number[] = []
  private side: number[] = []
  private width: number[] = []
  private idx: number[] = []
  /** シーンの座標の 2 点 */
  seg(a: readonly number[], b: readonly number[], width: number) {
    const i0 = this.pos.length / 3
    // 4 つの角: a の左右・b の左右（横の向きは端から見たもう一方の端への向きで決まるので、b の側は符号を反対にしてそろえる）
    const corners: [readonly number[], readonly number[], number][] = [
      [a, b, -1],
      [a, b, 1],
      [b, a, 1],
      [b, a, -1],
    ]
    for (const [p, q, s] of corners) {
      this.pos.push(p[0], p[1], p[2])
      this.other.push(q[0], q[1], q[2])
      this.side.push(s)
      this.width.push(width)
    }
    this.idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2)
  }
  get empty() {
    return this.pos.length === 0
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('aOther', new THREE.Float32BufferAttribute(this.other, 3))
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(this.side, 1))
    g.setAttribute('aWidth', new THREE.Float32BufferAttribute(this.width, 1))
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    return g
  }
}

/** 車両の下の丸い影（地面・高架の上。昼は濃く、夜はうすく）。InstancedMesh の 1 枚の板 */
export function createBlobMaterial() {
  return new THREE.ShaderMaterial({
    name: 'transitBlob',
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    uniforms: { uStrength: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec2 q = vUv;
        // 長い車両の下: 横は狭く、前後は端だけうすく
        float a = (1.0 - smoothstep(0.55, 1.0, abs(q.x))) * (1.0 - smoothstep(0.85, 1.0, abs(q.y)));
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * uStrength);
      }
    `,
  })
}
