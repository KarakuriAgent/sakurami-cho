import { WebGPURenderer } from 'three/webgpu'
import { extend } from '@react-three/fiber'
import * as THREE_WEBGPU from 'three/webgpu'

/**
 * 描画の土台（WebGPURenderer。kanon-claire-thompson/kanon-stream-video#25 の第 1 段）。
 *
 * - R3F の Canvas の gl に渡す、非同期で WebGPURenderer を作る関数（gpuRenderer）。R3F の JSX の要素（<mesh> など）は three/webgpu のクラスで作る（extend）
 * - 起動時の確かめ: renderer.init() のあと、WebGPU のバックエンドで（WebGL2 に黙って落ちていない）、アダプターが実の GPU（fallback でない・
 *   SwiftShader でない）かを見る。外れたら console に出し、画面の上に案内を出す（gpuState。ui/ の案内と __walker.state().gpu が読む）
 */

/** 描画の土台の様子 */
export interface GpuState {
  /** null = まだ確かめていない、true = WebGPU・実の GPU、false = 外れた（reason） */
  ok: boolean | null
  reason: string | null
  backend: 'webgpu' | 'webgl2' | null
  adapter: { vendor: string; architecture: string; fallback: boolean } | null
}

export const gpuState: GpuState = { ok: null, reason: null, backend: null, adapter: null }

extend(THREE_WEBGPU as unknown as Parameters<typeof extend>[0])

interface AdapterInfoLike {
  vendor?: string
  architecture?: string
  isFallbackAdapter?: boolean
}

/** 確かめ（init のあと）。外れた理由を返す（null なら良い） */
function check(r: WebGPURenderer): string | null {
  const backend = r.backend as { isWebGPUBackend?: boolean; device?: { adapterInfo?: AdapterInfoLike } }
  gpuState.backend = backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  if (!backend.isWebGPUBackend) return 'WebGPU が使えず、WebGL2 のバックエンドに切り替わりました（このアプリは WebGPU が要ります）'
  const info = backend.device?.adapterInfo ?? {}
  gpuState.adapter = { vendor: info.vendor ?? '', architecture: info.architecture ?? '', fallback: !!info.isFallbackAdapter }
  if (info.isFallbackAdapter) return `WebGPU のアダプターが代わりの物（fallback）です（${info.vendor ?? '?'} / ${info.architecture ?? '?'}）`
  if ((info.architecture ?? '').toLowerCase() === 'swiftshader') return 'WebGPU が CPU（SwiftShader）で動いています（実の GPU が使えていません）'
  return null
}

/** 外れたときの画面の案内（React の木の外。いちばん上に重ねる） */
function showNotice(reason: string) {
  const el = document.createElement('div')
  el.className = 'gpu-notice'
  el.setAttribute('role', 'alert')
  el.textContent = `描画の準備ができていません: ${reason}`
  Object.assign(el.style, { position: 'fixed', left: '50%', top: '12px', transform: 'translateX(-50%)', zIndex: '1000', padding: '8px 14px', background: '#5a1010e6', color: '#fff', font: '14px sans-serif', borderRadius: '6px', maxWidth: '90vw' })
  document.body.appendChild(el)
}

/** R3F の Canvas の gl（非同期）。WebGPURenderer を作って init し、確かめる */
export function gpuRenderer(antialias: boolean) {
  return async (props: { canvas: unknown }) => {
    const r = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias, powerPreference: 'high-performance', stencil: false })
    await r.init()
    const reason = check(r)
    gpuState.ok = reason === null
    gpuState.reason = reason
    if (reason) {
      console.error(`[town-walker] 描画の土台: ${reason}`)
      showNotice(reason)
    }
    else console.info(`[town-walker] 描画の土台: WebGPU（${gpuState.adapter?.vendor} / ${gpuState.adapter?.architecture}）`)
    return r
  }
}
