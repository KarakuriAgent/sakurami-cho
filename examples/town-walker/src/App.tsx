import { Canvas } from '@react-three/fiber'
import { QUALITY } from './quality'
import { Scene } from './scene/Scene'
import { TownNotice } from './ui/TownNotice'
import { TownPanel } from './ui/TownPanel'
import { TravelPanel } from './ui/TravelPanel'
import { VrmPanel } from './ui/VrmPanel'
import { WalkNotice } from './ui/WalkNotice'
import { WarpFade } from './ui/WarpFade'
import './index.css'

/**
 * 例のアプリのルート（3D の Canvas と、上に重ねる UI。6-2: VRM を選ぶ・落とす。6-3: 歩き方の案内。6-4: 行き先の一覧と旅程。6-5: ワープ（一覧は右上のパネルの札、暗転の幕は 3D の画とパネルの間）。
 * 6-6: 時刻と画質（左、VRM のつまみの下）・町の地図データの案内（上の真ん中））。
 * Canvas の設定は kanon-lab と同じ考え方: 影は percentage（PCF）、near 0.05・far 40000（外の遠景は湾の向こうの山並み 26km・空の球 30km まで）。
 * 後処理を使わないので、縁は Canvas の antialias でなめらかにする。?quality=low では描く細かさ（dpr）を 1 にし、antialias も切る（kanon-lab の low が MSAA を落とすのと同じ考え。仮）
 */
export default function App() {
  return (
    <div className="app">
      <Canvas
        shadows="percentage"
        dpr={QUALITY.lab === 'high' ? [1, 1.5] : 1}
        gl={{ antialias: QUALITY.lab === 'high', powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 50, near: 0.05, far: 40000 }}
      >
        <Scene />
      </Canvas>
      <WarpFade />
      <div className="left-column">
        <VrmPanel />
        <TownPanel />
      </div>
      <TravelPanel />
      <TownNotice />
      <WalkNotice />
    </div>
  )
}
