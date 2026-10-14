# 道具（tools/）

地図データ・アニメーションを書き出す道具（Node・bun で動かす）。入れ方と使い方は根の [README](../README.md)、組み込む人向けの資料は [usage.md](usage.md)。

根（`--root`）は、道具の置き場所からではなく、使う側の作業ディレクトリ（既定）か `--root` で決める。相対のパスは根から。書き出し先・読み元も使う側が渡す
（パッケージの中に使う側の置き場所を書かない）。知らない引数は誤りにして止める。`pnpm <script> -- <引数>` の `--` は読み飛ばす。

## 道具と引数

| 道具 | 動かし方 | 引数 |
|---|---|---|
| `tools/sync-town.mjs` | Node（型を外して `core/town.ts` を読む。`--disable-warning=ExperimentalWarning`・`--max-old-space-size=8192` を付ける） | `--out <アセットの根>`（必ず。`<アセットの根>/town/` を消して書き直す）・`--src <町の地図データのフォルダ>`（環境変数 `SAKURAMI_TOWN_SRC` が先）・`--root <根>` |
| `tools/sync-anim.mjs` | Node（`tools/anim/convert.mjs` は `.ts` を読まない。待機・歩き・跳ぶの置き場所は `character/avatar/visualConfig.ts` の `animations` の写しで、食い違うとテストが落ちる。`--disable-warning=ExperimentalWarning` を付ける） | `--out <アセットの根>`（必ず。`<アセットの根>/models/animations/` に待機・歩き・跳ぶを書く）・`--root <根>`（素材の置き場 `<根>/.cache/anim/`） |
| `tools/check-walk.mjs` | bun（`core/` の経路探索と道順を読む） | `--assets <アセットの根>`（必ず。`<アセットの根>/town/walk.json` を確かめる）・`--root <根>` |

## sync-town の部品

`tools/town/*.mjs` は sync-town の部品（PNG・幾何と塗り・地形・建物・街区の自動の建物・地面の色・木と灯り・構造物・交通・歩く道のグラフ・タイル）。`tools/args.mjs` は引数を読む所。
町の地図データの元は公開していないので、ふつうは sync-town を動かさずに、git に入っている `assets/town/` をそのまま使う。

## 素材から .vrma を作る変換（tools/anim）

素材から `.vrma` を作る変換 `tools/anim/convert.mjs` は、使う側の道具からも名前で読める（`exports` の `./tools/anim`。道具そのものの `sync-*.mjs` は出さない）:

```js
import { convertAnimations, IDLE_OUTPUT, SOURCES, WALK_OUTPUT } from 'sakurami-cho/tools/anim'

await convertAnimations({
  cacheDir: '<素材の置き場>',        // 取り出した素材と zip を置く（git に入れない）。sync-anim と同じ置き場なら素材を取り直さない
  assetRoot: '<アセットの根>',        // outputs の dest はここからの相対
  outputs: [{ dest: 'models/animations/think.vrma', source: 'staystill', gesture: { clip: 't_fac_2_32', from: 0.2, to: 4.7, smooth: 0.07 } }],
  generator: '<作った道具の名前>',     // .vrma の glTF の asset.generator
  // standing: 身ぶりの立つ場所を決める待機（既定 IDLE_OUTPUT。書き出さずに作る）・userAgent・tag（ログの頭）
})
```

作る物の形（`clip`・`loop`・`gesture`）と置き換えの決まりは `tools/anim/convert.mjs` のコメント。作った `.vrma` の出典（素材とライセンス）は、書き出した所に使う側が書く。

## script

`package.json` の script（リポジトリの根で `pnpm <名前>`）:

```bash
pnpm sync:town --src <町の地図データのフォルダ>   # sync-town --root . --out assets（読み元は --src か環境変数 SAKURAMI_TOWN_SRC）
pnpm sync:anim     # sync-anim --root . --out assets（素材の置き場は .cache/anim/）
pnpm check:walk    # check-walk --root . --assets assets
pnpm test          # bun test test/（地図のテストと境目の見張り test/map-boundary.test.ts）
pnpm typecheck     # tsc -p tsconfig.json（入口）と tsc -p test/tsconfig.json（テスト）
pnpm example:dev   # 例のアプリ（pnpm --filter town-walker dev。入口は http://localhost:5174/、アプリは /walk/。example:build はビルド）
```
