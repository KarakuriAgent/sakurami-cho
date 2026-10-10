import * as THREE from 'three'
import { COMMON, SKY, TONE, outdoorUniforms } from '../../materials'
import { TOWN_SHADOW, townShadowUniforms } from '../../town/shadows'

/**
 * ガーデンドームの水（池の水面・大滝「天の水」と回廊から落ちる細い滝・滝つぼのしぶき）と、雲霧林の霧（噴霧装置）。
 * どれも自分のシェーダー（空を映す水面、流れ落ちる筋の滝、やわらかい霧の粒）
 */

type V3 = [number, number, number]

/* -------------------------------------------------------------------------- */
/* 水面                                                                         */
/* -------------------------------------------------------------------------- */

const WATER_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
attribute vec2 aUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vUv = aUv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

/** 水面（空とドームの緑を映す・さざ波・深さの色・滝の落ちる所の白い泡・夜は葉脈の光を映す） */
export function createPoolMaterial() {
  return new THREE.ShaderMaterial({
    name: 'domePool',
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, uVein: { value: 0 }, uFoam: { value: new THREE.Vector4(0, 0, 0, 0) }, uNightAmb: { value: new THREE.Vector3() } },
    vertexShader: WATER_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      ${TOWN_SHADOW}
      uniform float uVein;
      uniform vec4 uFoam;
      uniform vec3 uNightAmb;
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vec2 p = vWorld.xz;
        float t = uTime;
        // さざ波の法線（2 方向の流れ）
        vec2 g = vec2(oNoise(p * 1.7 + vec2(t * 0.35, t * 0.2)) - oNoise(p * 1.7 + vec2(0.37, 0.0) + vec2(t * 0.35, t * 0.2)), oNoise(p * 1.7 + vec2(t * 0.35, t * 0.2)) - oNoise(p * 1.7 + vec2(0.0, 0.37) + vec2(t * 0.35, t * 0.2)));
        g += 0.5 * vec2(oNoise(p * 4.3 - vec2(t * 0.6, -t * 0.4)) - 0.5, oNoise(p * 4.3 + vec2(t * 0.5, t * 0.7) + 3.1) - 0.5);
        // 滝の落ちる所（uFoam: x, z = 中心、w = 半径）のまわりは波立つ
        float df = length(p - uFoam.xy);
        float foamK = 1.0 - smoothstep(uFoam.w * 0.3, uFoam.w * 1.6, df);
        g *= 0.35 + 1.6 * foamK;
        vec3 N = normalize(vec3(-g.x * 0.5, 1.0, -g.y * 0.5));
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
        vec3 R = reflect(-V, N);
        // 映り込み: 上の空と、ドームの中の木々（水平に近いほど濃い緑）
        vec3 sky = skyColor(vec3(R.x, max(R.y, 0.02), R.z));
        vec3 green = vec3(0.025, 0.05, 0.025) * (0.6 + uDaylight) + uNightAmb * 0.4;
        vec3 refl = mix(green, sky * 0.85, smoothstep(0.15, 0.7, R.y));
        float sun = pow(max(dot(R, uSunDir), 0.0), 400.0) * 18.0 * townShadow(vWorld + vec3(0.0, 0.2, 0.0), vec3(0.0, 1.0, 0.0));
        // 深さの色（底の石が透ける・縁は浅い）
        float shallow = vUv.y;
        vec3 deep = mix(vec3(0.012, 0.03, 0.03), vec3(0.04, 0.075, 0.06), shallow) * (uSkyLight * 2.0 + uNightAmb * 2.0 + 0.02);
        vec3 col = mix(deep, refl, fres) + uSunLight * sun;
        // 葉脈の光の映り込み（夕方から）
        float breath = 0.62 + 0.38 * sin(uTime * 0.55);
        col += vec3(0.55, 1.0, 0.32) * uVein * breath * 0.06 * (0.5 + 0.5 * oNoise(p * 0.8 + vec2(0.0, t * 0.1))) * fres * 4.0;
        // 白い泡
        float foam = foamK * smoothstep(0.35, 0.75, oNoise(p * 3.0 + vec2(t * 0.9, -t * 0.7)) * 0.6 + oNoise(p * 9.0 - t * 1.3) * 0.4 + foamK * 0.3);
        col = mix(col, vec3(0.75, 0.8, 0.8) * (uSkyLight * 1.2 + uSunLight * 0.35 + uNightAmb * 2.0 + 0.02), foam * 0.85);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/** 輪の水面（中心・内と外の半径・高さ。v = 外ほど深い → aUv.y = 浅さ） */
export function poolGeometry(S: (s: number, t: number, h: number) => V3, r0: number, r1: number, h: number, seg = 96, rings = 6) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= rings; i++) {
    const r = r0 + ((r1 - r0) * i) / rings
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2
      const p = S(Math.cos(a) * r, Math.sin(a) * r, h)
      pos.push(...p)
      const edge = Math.min(i / rings, 1 - i / rings) * 2
      uv.push(j / seg, 1 - edge)
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j
      const b = a + 1
      const d = a + seg + 1
      idx.push(a, d, b, b, d, d + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/* -------------------------------------------------------------------------- */
/* 滝                                                                           */
/* -------------------------------------------------------------------------- */

/** 滝（流れ落ちる白い筋・透ける縁・下の泡。aUv = (横 0〜1, 落ちた割合 0〜1, 長さ m)） */
export function createFallMaterial() {
  return new THREE.ShaderMaterial({
    name: 'domeFalls',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, uNightAmb: { value: new THREE.Vector3() }, uVein: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aUv;
      varying vec3 vWorld;
      varying vec3 vUv;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vUv = aUv;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uNightAmb;
      uniform float uVein;
      varying vec3 vWorld;
      varying vec3 vUv;
      void main() {
        float u = vUv.x;
        float v = vUv.y;
        float L = vUv.z;
        float t = uTime;
        // 下へ流れる筋（縦に長い筋。落ちるほど速く、ほどけて白くなる）
        float y = v * L;
        float speed = 1.6 + 2.6 * v;
        float w1 = u * 18.0 + 0.6 * sin(y * 0.7 + u * 5.0);
        float s1 = oNoise(vec2(w1, y * 0.18 - t * speed * 0.18));
        float s2 = oNoise(vec2(u * 47.0 + 3.0, y * 0.5 - t * speed * 0.5));
        float s3 = oNoise(vec2(u * 110.0 + 7.0, y * 1.6 - t * speed * 1.6));
        float streak = smoothstep(0.42, 0.9, s1 * 0.55 + s2 * 0.3 + s3 * 0.15);
        float edge = smoothstep(0.0, 0.18, u) * smoothstep(1.0, 0.82, u);
        float ragged = smoothstep(0.0, 0.35, (s2 - 0.25) + (0.5 - abs(u - 0.5)) * 1.6);
        float a = (0.12 + 0.7 * streak) * edge * mix(1.0, ragged, 0.6);
        a = mix(a, a * 0.7 + 0.15 * edge, v);
        a *= smoothstep(0.0, 0.05, v);
        vec3 base = vec3(0.84, 0.9, 0.93);
        vec3 light = uSkyLight * 1.1 + uSunLight * 0.35 + uNightAmb * 2.5 + vec3(0.008);
        vec3 col = base * light * (0.7 + 0.5 * streak);
        float breath = 0.62 + 0.38 * sin(uTime * 0.55);
        col += vec3(0.55, 1.0, 0.32) * uVein * breath * 0.12 * streak;
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
        ${TONE}
      }
    `,
  })
}

/**
 * 滝の幕（上の口から下へ、外へ少し張り出して落ちる）。center = 核の中心（局所）・a = 角度・r0 = 口の距離・w = 幅・h0 → h1（上 → 下）。
 * 局所の点の列で書いて S で変える
 */
export function fallCurtain(out: { pos: number[]; uv: number[]; idx: number[] }, S: (s: number, t: number, h: number) => V3, cx: number, cy: number, a: number, r0: number, w: number, h0: number, h1: number, throwOut: number) {
  const nu = 6
  const nv = 10
  const base = out.pos.length / 3
  const L = h0 - h1
  for (let j = 0; j <= nv; j++) {
    const v = j / nv
    const r = r0 + throwOut * Math.sqrt(v) + 0.2 * v
    const h = h0 - L * v
    const ww = w * (1 + 0.25 * v)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu
      const da = ((u - 0.5) * ww) / Math.max(r, 0.5)
      const p = S(cx + Math.cos(a + da) * r, cy + Math.sin(a + da) * r, h)
      out.pos.push(...p)
      out.uv.push(u, v, L)
    }
  }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const p = base + j * (nu + 1) + i
      out.idx.push(p, p + 1, p + nu + 2, p, p + nu + 2, p + nu + 1)
    }
}

/** 平らな幕の滝（回廊の縁から下へまっすぐ。p = 上の口の中心（局所）・along = 幅の向き（局所の角度）） */
export function fallSheet(out: { pos: number[]; uv: number[]; idx: number[] }, S: (s: number, t: number, h: number) => V3, s: number, t: number, along: number, outward: number, w: number, h0: number, h1: number) {
  const nu = 3
  const nv = 10
  const base = out.pos.length / 3
  const L = h0 - h1
  for (let j = 0; j <= nv; j++) {
    const v = j / nv
    const off = 0.5 * Math.sqrt(v)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu
      const d = (u - 0.5) * w * (1 + 0.6 * v)
      const p = S(s + Math.cos(along) * d + Math.cos(outward) * off, t + Math.sin(along) * d + Math.sin(outward) * off, h0 - L * v)
      out.pos.push(...p)
      out.uv.push(u, v, L)
    }
  }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const p = base + j * (nu + 1) + i
      out.idx.push(p, p + 1, p + nu + 2, p, p + nu + 2, p + nu + 1)
    }
}

export function fallGeometry(out: { pos: number[]; uv: number[]; idx: number[] }) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(out.uv, 3))
  g.setIndex(out.idx)
  g.computeBoundingSphere()
  return g
}

/* -------------------------------------------------------------------------- */
/* 霧・しぶき（やわらかい粒）                                                      */
/* -------------------------------------------------------------------------- */

/** 霧の粒（点。aMist = (大きさ m, 種, 濃さ, 種類 0 = 霧・1 = しぶき)） */
export function createMistMaterial() {
  return new THREE.ShaderMaterial({
    name: 'domeMist',
    transparent: true,
    depthWrite: false,
    uniforms: { ...outdoorUniforms, uPx: { value: 600 }, uNightAmb: { value: new THREE.Vector3() }, uMist: { value: 1 } },
    vertexShader: /* glsl */ `
      ${COMMON}
      attribute vec4 aMist;
      uniform float uPx;
      varying float vA;
      varying float vKind;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        float t = uTime;
        float ph = aMist.y * 6.2831;
        // 漂う（霧は横へゆっくり・しぶきは上へ舞う）
        if (aMist.w < 0.5) {
          p.x += sin(t * 0.07 + ph) * 1.6;
          p.z += cos(t * 0.05 + ph * 1.3) * 1.6;
          p.y += sin(t * 0.11 + ph) * 0.4;
        } else {
          float k = fract(t * 0.25 + aMist.y);
          p.y += k * 2.2;
          p.x += sin(ph) * k * 1.2;
          p.z += cos(ph) * k * 1.2;
          vA = 1.0 - k;
        }
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aMist.x * uPx / max(-mv.z, 0.5), 1.0, 900.0);
        float pulse = aMist.w < 0.5 ? (0.6 + 0.4 * sin(t * 0.18 + ph)) : vA;
        vA = aMist.z * pulse * smoothstep(0.8, 6.0, -mv.z);
        vKind = aMist.w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uNightAmb;
      uniform float uMist;
      varying float vA;
      varying float vKind;
      varying vec3 vWorld;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float a = (1.0 - r2) * (1.0 - r2) * vA * uMist;
        vec3 col = vec3(0.86, 0.9, 0.92) * (uSkyLight * 1.1 + uSunLight * 0.25 + uNightAmb * 2.2 + 0.01);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, a);
        ${TONE}
      }
    `,
  })
}
