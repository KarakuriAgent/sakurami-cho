/**
 * 遠景（空・星・地形・海・建物・木・構造物・灯り）のレイヤー。ふだんのカメラ（landscape.ts の attach がこのレイヤーを足す）だけが見て、
 * 床の映り込み（MeshReflectorMaterial）の描画には入れない（遠景の三角形を 2 回描かずに済む。昼に床が空の色で明るくなりすぎず、
 * 暗い床と光のラインの見た目を保つ。窓の明るさは反射用の環境（world/lab/lighting/environment.ts）で床にも少し映る）
 */
export const OUTDOOR_LAYER = 6
