/*
 * drei（@react-three/drei 10.7.9）の materials/ConvolutionMaterial.js を写した物（床の映り込みのぼかし。段 4 の 4-4）。
 * 中身はそのままで、型を付けただけ（drei の helpers/constants.js の version も、ここに同じ式で書いた）。
 *
 * MIT License
 *
 * Copyright (c) 2020 react-spring
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import * as THREE from 'three'

const getVersion = () => parseInt(THREE.REVISION.replace(/\D+/g, ''))
const version = /* @__PURE__ */ getVersion()

export class ConvolutionMaterial extends THREE.ShaderMaterial {
  kernel: Float32Array

  constructor(texelSize = new THREE.Vector2()) {
    super({
      uniforms: {
        inputBuffer: new THREE.Uniform(null),
        depthBuffer: new THREE.Uniform(null),
        resolution: new THREE.Uniform(new THREE.Vector2()),
        texelSize: new THREE.Uniform(new THREE.Vector2()),
        halfTexelSize: new THREE.Uniform(new THREE.Vector2()),
        kernel: new THREE.Uniform(0.0),
        scale: new THREE.Uniform(1.0),
        cameraNear: new THREE.Uniform(0.0),
        cameraFar: new THREE.Uniform(1.0),
        minDepthThreshold: new THREE.Uniform(0.0),
        maxDepthThreshold: new THREE.Uniform(1.0),
        depthScale: new THREE.Uniform(0.0),
        depthToBlurRatioBias: new THREE.Uniform(0.25),
      },
      fragmentShader: `#include <common>
        #include <dithering_pars_fragment>
        uniform sampler2D inputBuffer;
        uniform sampler2D depthBuffer;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform float minDepthThreshold;
        uniform float maxDepthThreshold;
        uniform float depthScale;
        uniform float depthToBlurRatioBias;
        varying vec2 vUv;
        varying vec2 vUv0;
        varying vec2 vUv1;
        varying vec2 vUv2;
        varying vec2 vUv3;

        void main() {
          float depthFactor = 0.0;

          #ifdef USE_DEPTH
            vec4 depth = texture2D(depthBuffer, vUv);
            depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));
            depthFactor *= depthScale;
            depthFactor = max(0.0, min(1.0, depthFactor + 0.25));
          #endif

          vec4 sum = texture2D(inputBuffer, mix(vUv0, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv1, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv2, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv3, vUv, depthFactor));
          gl_FragColor = sum * 0.25 ;

          #include <dithering_fragment>
          #include <tonemapping_fragment>
          #include <${version >= 154 ? 'colorspace_fragment' : 'encodings_fragment'}>
        }`,
      vertexShader: `uniform vec2 texelSize;
        uniform vec2 halfTexelSize;
        uniform float kernel;
        uniform float scale;
        varying vec2 vUv;
        varying vec2 vUv0;
        varying vec2 vUv1;
        varying vec2 vUv2;
        varying vec2 vUv3;

        void main() {
          vec2 uv = position.xy * 0.5 + 0.5;
          vUv = uv;

          vec2 dUv = (texelSize * vec2(kernel) + halfTexelSize) * scale;
          vUv0 = vec2(uv.x - dUv.x, uv.y + dUv.y);
          vUv1 = vec2(uv.x + dUv.x, uv.y + dUv.y);
          vUv2 = vec2(uv.x + dUv.x, uv.y - dUv.y);
          vUv3 = vec2(uv.x - dUv.x, uv.y - dUv.y);

          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,
      blending: THREE.NoBlending,
      depthWrite: false,
      depthTest: false,
    })
    this.toneMapped = false
    this.setTexelSize(texelSize.x, texelSize.y)
    this.kernel = new Float32Array([0.0, 1.0, 2.0, 2.0, 3.0])
  }

  setTexelSize(x: number, y: number) {
    this.uniforms.texelSize.value.set(x, y)
    this.uniforms.halfTexelSize.value.set(x, y).multiplyScalar(0.5)
  }

  setResolution(resolution: THREE.Vector2) {
    this.uniforms.resolution.value.copy(resolution)
  }
}
