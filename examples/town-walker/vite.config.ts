import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * 例のアプリ town-walker の Vite の設定（kanon-lab の docs/design/map-split.md §8）。
 *
 * - アセット: publicDir を地図のパッケージの assets/（この例のアプリから ../../assets）に向ける。町の地図データ・テクスチャ・.vrma を写さずに、
 *   アセットの根（Vite の base）として出す（ビルドでは出力へ写す）。createTown の assetBase は import.meta.env.BASE_URL（src/town.ts）
 * - three・React・R3F は 1 つだけ読む（パッケージからも同じ物。three が 2 つ読まれると console に Multiple instances of Three.js が出る）
 */
export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
  resolve: { dedupe: ['three', 'react', 'react-dom', '@react-three/fiber'] },
  server: { port: 5174 },
})
