# 組み込む人向けの資料

`sakurami-cho` を自分のアプリに組み込むときに引く資料。入れ方と最小のコードは根の [README](../README.md) の「自分のアプリに入れる」、道具は [tools.md](tools.md)。

依存の向きは core ← world ← character ← react の一方向。パッケージは使う側のファイルを読まない（使う側の物は、下の「公開の口」の差し込み口と表の差し替えで渡す）。

入るのは `files` の物（`core`・`world`・`character`・`react`・`tools`・`assets`・README・LICENSE・LICENSE-CODE・LICENSE-DATA）。例のアプリとテストは入らない。
ビルドせず `.ts` のまま読ませる（`exports` の深いパス `sakurami-cho/core/…`・`world/…`・`character/…` と、入口の index。react は入口の index だけ）。

コードのコメントにある `docs/design/*.md`・`§…` は、作った時の設計メモを指す（このリポジトリには入れていない）。

## 公開の口

使う側は入口の index（`sakurami-cho/core`・`world`・`character`・`react`）から読む。core・world・character の index は、選んだ名前だけを出す
（`export *` はしない。名前がぶつからないように・出す名前が公開の口になるので）。出すのは、例のアプリ（[examples/town-walker](../examples/town-walker/README.md)）が使う物と、地図の表・
差し込み口を差し替える・読む口、それらの引数・返り値・欄の型（この表と index の一致は `test/map-boundary.test.ts` が見る。足す・消すときは、
index・この表・見張りの一覧 `PUBLIC_API` を一緒に直す）。

深いパス（`sakurami-cho/core/…`・`world/…`・`character/…`）も読めるが、公開の口ではない。名前・形・置き場所は変わることがあり、ファイルを動かしたら
minor の版を上げる。

| 入口 | 名前 | 中身 |
|---|---|---|
| core | `TOWN_PLACES`・`townPlaces`・`configurePlaces`・型 `TownPlace`・`PlaceId`・`TownPlaceId`・`PlaceAction` | 立ち寄り先の表（地図の既定の 42 か所・今の表・使う側が欄を足した表に差し替える） |
| core | `INTERIOR_ZONES`・`zoneOfPoint`・型 `InteriorZoneId`・`ZoneId` | 中のある建物のゾーンの表と、点がどのゾーンか |
| core | `TRAVEL_PLACES`・型 `TravelPlaceId`・`TRAVEL_ROUTES`・`TRAVEL_ROUTE_IDS` | 町の中の移動の行き先（立ち寄り先のほか）と道順 A〜G |
| core | `SPOT_KINDS`・型 `SpotKind` | ワープ先の種類と一覧の組の名前 |
| core | `parseTimeOfDay`・`parseDate`・`timeOfDayName`・型 `DateParts`・`LabTime` | 時刻（`HH:MM`）と日付（`YYYY-MM-DD`）を読む・時間帯の名前。町の時刻 `town.sun.time` の形 |
| core | `TOWN_DATA`・`TOWN_QUALITY`・型 `TownQualityName` | 町の地図データの形の版（下の「データの形の版」）・町の画質の段（low・high・film・final） |
| core | `LAB_PLACEMENTS`・型 `LabPlacement`・`labAnchor`・型 `LabAnchorData` | ラボの置き場所の表（地図の既定。使う側が足した表を react の `TownRoot` の `placements` に渡す）とアンカーを引く |
| world | `createTown`・型 `Town`・`TownCreateOptions`・`TownStatus`・`TownClock`・`TownFocus`・`TownFrame`・`TownEventMap` | 町の口（1 ページに 1 つ。根の [README](../README.md) の「自分のアプリに入れる」）と、その引数・読み込みの状態・時計・注目点・毎コマの段（`begin`・`update`・`view` の引数）・出来事 |
| world | `PALETTE`・`FONTS` | 背景と霧の色・ラボの看板と画面のフォント（下の「フォント」） |
| world | `configureLab` | ラボの差し込み口（什器の入力の値・差し込み口の中身・画面の描き方） |
| world | `createFollowCamera`・型 `FollowCamera`・`FollowCameraOptions`・`FollowTarget` | 人を追うカメラ（下の「カメラ・直接の操作・ワープ」） |
| character | `createCharacter`・型 `Character`・`CharacterOptions`・`CharacterSpawnPoint`・`CharacterDriver` | キャラクター（1 人ずつのインスタンス）と、毎コマ動かす所（`ch.drivers.motion`・`travel`）の型 |
| character | `createCharacterVisual`・型 `CharacterVisual`・`CharacterVisualOptions`・`CharacterVisualStatus`・`CharacterVisualClip`・`VISUAL_DEFAULTS`・型 `VisualConfig` | 見た目（VRM と待機・歩き・身ぶりの `.vrma`）と既定の値。`CharacterVisual` の `start()`・`stop()`・`update()`・片付ける `dispose()` |
| character | `updateLocomotion`・`placeAt`・`goTo`・`stopWalking`・`configureNav`・型 `NavConfig` | 歩きを毎コマ進める・立ち寄り先へ置く・歩かせる・止める・ラボのまわりの通り道（点と障害物）を差し替える |
| character | `driveRides`・`setWarpPermit`・型 `RideTime`・`wheelBoardProblem`・`beginWheelBoarding`・`cancelWheelBoarding`・`requestWheelAlight`・`advanceWheelTo`・`WHEEL_EXIT_OPEN_DEG`・型 `WheelProblem`・`wheelProblemText` | 乗り物に乗っている間に人を動かす標準の順・町の時計を早送り・カットで進めてよい人・観覧車ソラノワに乗る・降りる。乗れない理由は種類（`code`）と値で返し、`wheelProblemText` が地図の既定の字を作る（使う側は種類ごとに自分の字にしてよい） |
| character | `startTravel`・`driveTravel`・`cancelTravel`・`traveling`・`travelState`・型 `TravelRequest`・`TravelPlan`・`TravelTime`・`TravelCut`・`TravelRouteId`・型 `TravelProblem`・`isTravelProblem`・`travelProblemText` | 町の中の移動（旅程: ゾーンを出て町の道を歩き、乗り物にも乗る）を始める・毎コマ進める・取り消す・様子。作れない理由は種類（`code`）と値で返し（`isTravelProblem` で分ける）、`travelProblemText` が地図の既定の字を作る |
| character | `setDirectInput`・`driveDirect`・`walkToPoint`・`pickGround`・`canStand`・`stopDirect`・`directState` | 人を直接動かす（WASD・クリック。下の「カメラ・直接の操作・ワープ」） |
| character | `townSpots`・`teleport`・`placeAtPoint`・型 `TownSpot` | ワープ（下の「カメラ・直接の操作・ワープ」） |
| react | `TownClock`・`TownRoot`・`TownView`・`TownExposure`・`LabAtmosphere`・`LabSlot`・`CharacterView`・`RideDriver`・`useLab` などの hooks | R3F の薄い包み（`export *`） |

## 毎コマの順

毎コマの順（R3F の `useFrame` の優先度。小さい方が先。例のアプリの `src/scene/Scene.tsx`）: 町の時計 `<TownClock>`（−90）→ 乗る仕組み `<RideDriver>`（−79）→
歩きを進める `updateLocomotion(ch, t, min(dt, 0.1))`（−58）→ 遠景と外の光 `<TownView>` の `town.update`（−50）→ 追うカメラ `cam.update(ch, 目の高さ, dt)`（−1）→
ラボ・殻・什器 `<TownView>` の `town.view` と見た目 `<CharacterView>`（0）→ 露出 `<TownExposure>`（0.95）→ 描く（1。0 より大きい優先度の購読があると R3F は自分で描かないので、
使う側が `gl.render` する）。ラボの形はテクスチャを読み終えてから `<Suspense>` の中の `<TownRoot town={town}>` が作る（`placements` を省けば地図の既定の置き場所の表）。
`town.frame(f)`（4 つの段を続けて呼ぶ）は人を動かさない使い方だけ（乗る仕組みと歩きは `begin` と `update` の間、カメラは `view` の前でないといけないため）。

## フォント

ラボの看板・画面は Canvas に字を描く（`FONTS` の Orbitron・Share Tech Mono・Noto Sans JP が頭のフォント）。Web フォントは字の範囲（unicode-range）ごとに届き、
Canvas に描いても範囲は読み込まれないので、使う側がフォントを読み込んで（`document.fonts.load(フォント, 描く字)`）から描き始める（一度だけ描くラベルは
代わりのフォントのまま残る）。例のアプリは `walk/index.html` で Google Fonts を読み、`src/main.tsx` がラボで描く字（ラボの字を変えたら数え直す）と
Orbitron の 500・700・900 を最大 3 秒待つ。町の看板・名前のある建物・中のある建物の絵の字は、頭のフォントが OS の `"Noto Sans CJK JP"` なので待たない。

## 落とした VRM（blob:）

キャラクターの見た目の `url` に、使う人が選んだ・落としたファイルの `blob:` の URL（`URL.createObjectURL`）をそのまま渡せる（絶対の URL には `assetBase` を付けず、
`blob:`・`data:` は HEAD で確かめずに読む）。`stop()` は読んだ VRM を片付けないので、入れ替えるときは使う側が、前の見た目の `dispose()` を呼んで
（`stop()` をして、読んだ VRM の形・素材・テクスチャを片付け（`VRMUtils.deepDispose`）、縁の光の素材の一覧 `ch.rim.tuned` から外す。読み込みの途中なら、
あとで届いた VRM もすぐ片付ける）、前の `blob:` の URL を取り消す（例のアプリの `src/vrm.ts`）。

## カメラ・直接の操作・ワープ

例のアプリのように、使う人が町を自由に動き回るための部品:

| 部品 | 中身 |
|---|---|
| `world/followCamera.ts` | 人を追うカメラ `createFollowCamera(camera, { distance, minDistance, maxDistance, yaw, pitch, labObstacles })`。毎コマ `update(人, 目の高さ, dt)`（人の位置が決まったあと・町の `view` の前）。注視点は足元 ＋ 目の高さ、町の建物・木・擁壁・中のある建物の壁や家具・部屋の無い建物（楓坂駅の上屋とホーム）の外形の線・ラボの壁と家具と殻・地面と草むらにさえぎられたら手前へ寄せ、すぐ近くなら上から見下ろす向きへ逃がす。地面・床の 0.3m 上より下へ行かず、草むらの生える地形の上では地形の 0.65m 上より下へ行かない（土手に埋まったホームの上のように、カメラの床より少し上に地形があれば地形を床にする）。追う物の `ride`（Character をそのまま渡す）が車室の中なら、カメラを車室の壁・天井・床の内に収め（狭ければ向きも回す）、車室と一緒に運ぶ。`snap()`（次のコマで一度に置く。人の `'place'` で呼ぶ）・`orbit`・`zoom`・`connect(要素)`（ドラッグで回す・ホイールで寄る）。乗り物の車体はさえぎる物に入れていない |
| `character/ride/drive.ts` | 乗り物に乗っている間に人を動かす標準の順 `driveRides`（観覧車 → ケーブル → 緑電 → 運河バス → ホバー。`ch.drivers.motion = driveRides`） |
| `character/avatar/direct.ts` | 人を直接動かす（WASD・クリック）。`ch.drivers.travel = (c, t, dt) => driveTravel(c, t, dt) \|\| driveDirect(c, t, dt)`（旅程が先）。`setDirectInput(ch, 世界の向き \| null, 走る)`（カメラの向きから直すのは使う側）・`pickGround(線)`（地面・床の高さの関数でたどって拾う。建物・壁に当たれば null）・`walkToPoint(ch, x, z, y?)`（今いる所のグラフの中で道を作る。ゾーンをまたぐ・立てない所なら理由の字）・`canStand(ch, x, z, y?)`・`stopDirect`・`directState`。歩けるのは道・石段・橋・広場・ホームと乗り場・ラボの中と敷地・中のある建物の今の階の床と段・ゾーンの出入口の間で、建物・木の幹・擁壁で止まって沿ってすべる（段は 0.45m まで）。状態は Character ごとにこの中に持つ |
| `core/spots.ts` | ワープ先の名前の表（座標は写さない）: 種類 `SpotKind` と一覧の組の名前 `SPOT_KINDS`（建物・ケーブルの駅・観覧車・ホバーの乗り場・緑電の停留所・運河バスの乗り場）、立ち寄り先の手前 `PLACE_SPOTS`（ラボの前・中のある建物 4 つの前・ケーブルの 3 駅の前・ソラノワの乗り場の前）、ホバーの乗り場 `HOVER_SPOTS` |
| `character/avatar/teleport.ts` | ワープ（コードでは teleport。warp は時刻の早送り・カットの名前）。`townSpots()`（名前の表の 11 と、町を組み立てたあとの地図データの緑電の停留所 37（ホームの上。地形に埋まっていない・木などにかからない所）・運河バスの乗り場 18（石段の上の陸の側の敷石）。位置・向き・ゾーン・足元の高さの目安）・`teleport(ch, spot)`（旅程の取り消し → 乗り物の早送り・カットをやめる → 旅程の早送りの倍率と歩幅を戻す → WASD・クリックの歩きをやめる → 立ち寄り先なら `placeAt`、点なら `placeAtPoint`。乗っている途中でもよく、乗る仕組みが次のコマで降りたことにする（ホバーは飛ぶ途中なら行き先の乗り場に置く））・`placeAtPoint(ch, x, z, heading, refY?)`（点へすぐ置く。`placeSerial` を増やして `'place'`） |

## データの形の版（今は 10）

町の地図データ（`assets/town/`）の形の版は `core/town.ts` の `TOWN_DATA.format`（今は **10**）。これがパッケージと地図データの約束:

- `tools/sync-town.mjs` は書き出す目録（`town/manifest.json`）の `format` にこの版を書く
- 町（`world/outdoor/town/townData.ts`）は、目録の版が違うデータを読まずに、状態を `outdated` にする（使う側が書き出し直しの案内を出す）
- 書き出す形を変えたら版を上げる（版ごとの中身は `TOWN_DATA.format` のコメント）

## assetBase の約束

アセットは「アセットの根」（Web の public の根に当たる所）の下に、いつも同じ並びで置く:

```
<アセットの根>/
  town/                 町の地図データ（manifest.json・walk.json・named.json・infra.json・terrain/・ground/・tiles/）
  textures/             町・ラボ・敷地のテクスチャ（town/・lab_exterior/・concrete_floor/ など）
  models/animations/    待機・歩きの .vrma（使う側の身ぶりなどの .vrma も、使う側のアセットの根のここに置ける）
```

- 町は `createTown({ assetBase, … })` で、アセットの根に当たる URL を受ける（末尾は `/`。既定は `'/'`）。読むのは `${assetBase}town/…`・`${assetBase}textures/…`
  （置き場は初めて使うときに 1 回決めて覚える。描き始める前に 1 回渡す）
- キャラクターの見た目（`createCharacterVisual`）の `assetBase` は別の引数（キャラクターは町の口を読まずに使えるように）。`.vrma` と VRM の `url` はその下からの相対パス
  （`character/avatar/visualConfig.ts` の `animations` は `models/animations/idle.vrma` など）。絶対の URL（`blob:`・`data:`・`http(s):`・`/` で始まる物）なら `assetBase` を付けない
- パッケージは Vite の `import.meta.env` を読まない。Vite のアプリなら `import.meta.env.BASE_URL` を渡す
- アセットの根はページの置き場所と別でよい。例のアプリは、アプリのページを `/walk/`（`walk/index.html`）に置き、Vite の base（アセットの根）は `/` のまま
  （`/walk/` のページも `/town/…`・`/textures/…` を読む）

## アセット

`assets/` はアセットの根と同じ並び。使う側が自分の public の根と同じ URL で出す（Vite のアプリなら、例のアプリのように `publicDir` をここに向けるか、
開発ではここから出してビルドでは出力へ写す）。

どれも git に入れてある（このリポジトリだけで町が出るように）。書き出す物（`town/`・`models/animations/`）は、道具で書き出し直したら差としてコミットする。

| 置き場 | git | 作り方 |
|---|---|---|
| `assets/textures/` | 入れる | CC0 の PBR テクスチャ（Poly Haven・ambientCG）。出典は [assets/textures/CREDITS.md](../assets/textures/CREDITS.md) |
| `assets/town/` | 入れる | `tools/sync-town.mjs` が、設定資料の町の地図データ（このリポジトリには入れていない元のデータ）から書き出す（151 ファイル・約 25MB） |
| `assets/models/animations/` | 入れる | `tools/sync-anim.mjs` が自由に使える素材から作る（キャラクターの見た目が既定で使う待機 `idle.vrma`・歩き `walk.vrma` の 2 つ）。出典は [assets/models/animations/CREDITS.md](../assets/models/animations/CREDITS.md) |

ここに置くのは、パッケージのコードが既定で使う物と、例のアプリで使う物まで（使う側のキャラクターに固有の物は、使う側の public に置く）。

`.vrma` の素材（`tools/anim/convert.mjs` の `SOURCES`）: 待機は StayStill（MIT ライセンス。Copyright (c) 2026 Eneko Atxa Landa。作った `.vrma` の
glTF の `asset.copyright` にも著作権の表示を入れる）、歩きは Quaternius の Universal Animation Library の Standard 版（CC0）。
`SOURCES` には Universal Animation Library 2 の Standard 版（CC0）もあり、使う側が自分の `.vrma`（腕組みの身ぶりなど）を作るときに使える。
ファイルごとの素材と MIT の全文は `assets/models/animations/CREDITS.md`。取ってきたライセンスの文書に MIT / CC0 と書いてあるかは、道具が作るときに確かめる。
