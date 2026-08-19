// sprites.js — 单位精灵表动画
// 1mapsprites1/2.png: 384x256 = 4列x2行 角色块 (每块 96x128)。
// 注意: 块内 4 个 32px 行是同一兵种的 4 个配色变体, 不是方向行!
// 每个变体只有 3 帧行走 (横向 3x32), 全部朝左。单位映射到块, 恒取 row 0 (其所属变体)。
// 行走序列 0,1,2,1; 方向只用于水平镜像 (scale.x), 不参与采样。
import * as THREE from '../../lib/three.module.js';
import { loadTex } from './gfx.js';

export const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 };   // 仅用于镜像/移动方向, 不参与采样

// data/units.json 的 sprite 名 -> (sheet, blockX, blockY)
export const SPRITE_MAP = {
  unit_soldier_blue:  { sheet: '1mapsprites1', bx: 0, by: 0 },
  unit_hood_blue:     { sheet: '1mapsprites1', bx: 1, by: 0 },
  unit_fighter_blue:  { sheet: '1mapsprites1', bx: 2, by: 0 },
  unit_knight_blue:   { sheet: '1mapsprites1', bx: 3, by: 0 },
  unit_risen_dark:    { sheet: '1mapsprites1', bx: 0, by: 1 },
  unit_knight_dark:   { sheet: '1mapsprites1', bx: 1, by: 1 },
  unit_archer_green:  { sheet: '1mapsprites1', bx: 2, by: 1 },   // 龙
  unit_cavalier_teal: { sheet: '1mapsprites1', bx: 3, by: 1 },   // 龙
  unit_mage_teal:     { sheet: '1mapsprites2', bx: 0, by: 0 },
  unit_monk_orange:   { sheet: '1mapsprites2', bx: 3, by: 0 },
  unit_armor_gray:    { sheet: '1mapsprites2', bx: 1, by: 1 },
  unit_sage_green:    { sheet: '1mapsprites2', bx: 3, by: 1 },
};

const SHEET_W = 384, SHEET_H = 256;
const WALK_SEQ = [0, 1, 2, 1];
const sheetLoader = new THREE.TextureLoader();

// 行走序列第 i 步的源矩形 — 恒在块 row0 的 96x32 条带内, 不可能越界到相邻变体/块
export function frameRect(spriteName, seqIdx) {
  const info = SPRITE_MAP[spriteName];
  if (!info) return [0, 0, 32, 32];
  const f = WALK_SEQ[((seqIdx % 4) + 4) % 4];
  return [info.bx * 96 + f * 32, info.by * 128, 32, 32];
}

// 为一个单位 sprite 名创建独立的帧纹理 (独立加载, 用 offset/repeat 选帧)
// 返回 { texture, setFrame(seqIdx) }; 未知名字回退到静态 PNG
export function makeUnitTexture(spriteName) {
  const info = SPRITE_MAP[spriteName];
  if (!info) {
    return { texture: loadTex(spriteName), setFrame() {}, animated: false };
  }
  // 不用 clone: 克隆体在底图未加载完成时不会自动上屏。每实例独立 Texture 由 loader 自己管理 needsUpdate。
  const texture = sheetLoader.load(`assets/${info.sheet}.png`);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(32 / SHEET_W, 32 / SHEET_H);
  const setFrame = seqIdx => {
    const [px, py] = frameRect(spriteName, seqIdx);
    texture.offset.set(px / SHEET_W, 1 - (py + 32) / SHEET_H);
  };
  setFrame(0);
  return { texture, setFrame, animated: true };
}
