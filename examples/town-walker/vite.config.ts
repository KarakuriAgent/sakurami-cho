import react from '@vitejs/plugin-react'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

/**
 * 例のアプリ town-walker の Vite の設定（kanon-lab の docs/design/map-split.md §8）。
 *
 * - ページは 2 つ（複数ページ。build.rolldownOptions.input）: 入口 index.html（`/`。素の HTML と CSS だけで、アプリのスクリプト・three・React・
 *   フォントを読まない。画は landing/ の 2 枚を相対で読み、ビルドで assets/ へ名前に hash を付けて出す）と、アプリ walk/index.html（`/walk/`。src/main.tsx）
 * - アセット: publicDir を地図のパッケージの assets/（この例のアプリから ../../assets）に向ける。町の地図データ・テクスチャ・.vrma を写さずに、
 *   アセットの根（Vite の base）として出す（ビルドでは出力へ写す）。createTown の assetBase は import.meta.env.BASE_URL（src/town.ts）。
 *   base は `/` のままなので、`/walk/` のページからもアセットは `/town/…`・`/textures/…` で読む。入口の画は地図の assets/ に混ぜない（landing/）
 * - three・React・R3F は 1 つだけ読む（パッケージからも同じ物。three が 2 つ読まれると console に Multiple instances of Three.js が出る）
 * - 読み込み中の進み具合（src/loading.ts）のテクスチャの数の分母 __WALKER_TEXTURE_FILES__: アセットの根の textures/ の下の画像の数（どれもラボと町が読む）
 */

/** 出す所（共有の画像 og:image・twitter:image は絶対の URL が要る） */
const SITE = 'https://sakurami-cho.0235.app'

/** アセットの根の textures/ の下の画像（.jpg・.png・.webp）の数 */
function textureFiles(): number {
  const dir = fileURLToPath(new URL('../../assets/textures', import.meta.url))
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(?:jpe?g|png|webp)$/.test(f)).length
}

/**
 * 入口の共有の画像（og:image・twitter:image）を絶対の URL にする（ビルドだけ）。Vite は meta の画像を出力の名前（/assets/…）に書き換えるので、
 * 書き出したあとの HTML で頭に SITE を付ける
 */
function absoluteShareImage(): Plugin {
  return {
    name: 'town-walker:absolute-share-image',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const page = bundle['index.html']
      if (!page || page.type !== 'asset' || typeof page.source !== 'string') return
      page.source = page.source.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")\//g, `$1${SITE}/`)
    },
  }
}

export default defineConfig({
  plugins: [react(), absoluteShareImage()],
  publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
  resolve: { dedupe: ['three', 'react', 'react-dom', '@react-three/fiber'] },
  define: { __WALKER_TEXTURE_FILES__: JSON.stringify(textureFiles()) },
  server: { port: 5174 },
  build: {
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        walk: fileURLToPath(new URL('./walk/index.html', import.meta.url)),
      },
    },
  },
})
