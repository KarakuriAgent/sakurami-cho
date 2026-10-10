# テクスチャの出典

`assets/textures/` 以下の画像はすべて **CC0 1.0（パブリックドメイン）** の PBR テクスチャです。
クレジット表記は不要ですが、管理のため出典を記録しています。
ファイル名は使いやすいように変更し、必要なマップ（カラー / 法線(OpenGL) / ラフネス / 不透明度）だけを残しています。

| フォルダ | 元アセット | 配布元 | 解像度 | ライセンス | 用途 |
|---|---|---|---|---|---|
| `concrete_floor/` | Concrete Floor Worn 001（撮影: Dimitrios Savva / 処理: Rico Cilliers） | [Poly Haven](https://polyhaven.com/a/concrete_floor_worn_001) | 2K | CC0 | 床のツヤありコンクリート（color / normal / roughness） |
| `brushed_metal/` | Metal 009 | [ambientCG](https://ambientcg.com/view?id=Metal009) | 1K | CC0 | ヘアライン金属の細かい凹凸（normal / roughness） |
| `panel_metal/` | Metal 032 | [ambientCG](https://ambientcg.com/view?id=Metal032) | 1K | CC0 | 壁パネル・装置外装のムラ（normal / roughness） |
| `perforated_metal/` | Sheet Metal 002 | [ambientCG](https://ambientcg.com/view?id=SheetMetal002) | 1K | CC0 | 有孔ボード・パンチングメタル（opacity / normal） |
| `smudges/` | Surface Imperfections 003 | [ambientCG](https://ambientcg.com/view?id=SurfaceImperfections003) | 1K | CC0 | ガラスの指紋・くもり（ラフネスのマスクとして使用） |
| `lab_exterior/` | Concrete（撮影・処理: Rob Tuytel） | [Poly Haven](https://polyhaven.com/a/concrete) | 2K | CC0 | ラボの外壁の打ち放し（色は AO を掛けて WebP に。法線は GL。`src/scene/outdoor/site/siteMaterial.ts`。取得日: 2026-10-04） |

## 町の質感（`town/`。町の建物・地面・木のシェーダーが使う。`src/scene/outdoor/town/townTextures.ts`）

ambientCG の 1K-JPG を取り込み、層ごとに 1 枚の縦長の画像にまとめて WebP にした（色は明るさの平均を 0.5 にそろえ、AO を少し掛けた。法線は NormalGL）。
建物は 512px、地面は 1024px。並びは townTextures.ts の `BUILDING_LAYER`・`GROUND_LAYER`。取得日: 2026-10-04

| ファイル | 層 | 元アセット（すべて [ambientCG](https://ambientcg.com/)・CC0） |
|---|---|---|
| `town/building-albedo.webp`・`building-normal.webp` | 0 板張り・1 漆喰・2 石・3 煉瓦・4 コンクリート・5 波板・6 タイル・7 瓦・8 スレート | [WoodSiding008](https://ambientcg.com/view?id=WoodSiding008)・[Plaster003](https://ambientcg.com/view?id=Plaster003)・[Bricks066](https://ambientcg.com/view?id=Bricks066)・[Bricks085](https://ambientcg.com/view?id=Bricks085)・[Concrete034](https://ambientcg.com/view?id=Concrete034)・[CorrugatedSteel005](https://ambientcg.com/view?id=CorrugatedSteel005)・[Bricks060](https://ambientcg.com/view?id=Bricks060)・[RoofingTiles006](https://ambientcg.com/view?id=RoofingTiles006)・[RoofingTiles003](https://ambientcg.com/view?id=RoofingTiles003) |
| `town/ground-albedo.webp`・`ground-normal.webp` | 0 芝・1 土・2 砂利・3 石畳・4 敷石・5 アスファルト・6 樹皮・7 草地 | [Grass004](https://ambientcg.com/view?id=Grass004)・[Ground103](https://ambientcg.com/view?id=Ground103)・[Gravel040](https://ambientcg.com/view?id=Gravel040)・[PavingStones070](https://ambientcg.com/view?id=PavingStones070)・[PavingStones128](https://ambientcg.com/view?id=PavingStones128)・[Asphalt031](https://ambientcg.com/view?id=Asphalt031)・[Bark012](https://ambientcg.com/view?id=Bark012)・[Ground037](https://ambientcg.com/view?id=Ground037) |
| `town/foliage.webp` | 葉のかたまりの板（2×2: 広葉樹の密・広葉樹の疎・楓・針葉樹） | 広葉樹の葉は [Leaf001](https://ambientcg.com/view?id=Leaf001) の葉を切り抜いて並べた。楓の葉・針葉樹の葉と小枝は形を描いた（自作。CC0 として扱う） |

- Poly Haven のライセンス: https://polyhaven.com/license （CC0）
- ambientCG のライセンス: https://docs.ambientcg.com/license/ （CC0）
- 取得日: 2026-09-27
