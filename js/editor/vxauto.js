// vxauto.js — VX Ace autotile 刷写/模式重算逻辑 (blob-47)
// 数据表见 blob47.js (从 209 张原版地图反推, 回放一致率 96.3%, 差异为手动摆放的特例)。
// 规则 (与原版编辑器一致):
//   - 同类判定: 同表(A1/A2)且同块号; 地图越界视为同类 (边缘格不外翻边)。
//   - 掩码: 4 边 (N=1,E=2,S=4,W=8) + 4 角 (NE=16,SE=32,SW=64,NW=128),
//     角仅当相邻两边都同类时才参与判定。
//   - 模式索引 = BLOB47[mask]; tileID = 基址 + 块号*48 + 模式 (A1 基址 0x800, A2 基址 0xB00)。
//   - A1 瀑布块 (5/7/9/11/13/15) 仅 4 模式, 只看左右同类: WF_PATTERN[left|right<<1]。
import { BLOB47, WF_PATTERN } from './blob47.js';

export const WF_BLOCKS = new Set([5, 7, 9, 11, 13, 15]);

// tileID -> { table:'A1'|'A2', block, pattern } | null
export function autoInfo(tid) {
  if (tid >= 0x800 && tid < 0xB00) {
    const t = tid - 0x800;
    return { table: 'A1', block: (t / 48) | 0, pattern: t % 48 };
  }
  if (tid >= 0xB00 && tid < 0x1100) {
    const t = tid - 0xB00;
    return { table: 'A2', block: (t / 48) | 0, pattern: t % 48 };
  }
  return null;
}

export function autoBase(table, block) {
  return (table === 'A1' ? 0x800 : 0xB00) + block * 48;
}

// 计算 z0[y*cols+x] 这格应有的模式索引; 不是 autotile 返回 -1
export function patternAt(z0, x, y, cols, rows) {
  const a = autoInfo(z0[y * cols + x]);
  if (!a) return -1;
  const same = (nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return true; // 越界=同类
    const b = autoInfo(z0[ny * cols + nx]);
    return !!b && b.table === a.table && b.block === a.block;
  };
  if (a.table === 'A1' && WF_BLOCKS.has(a.block)) {
    return WF_PATTERN[(same(x - 1, y) ? 1 : 0) | (same(x + 1, y) ? 2 : 0)];
  }
  const n = same(x, y - 1), e = same(x + 1, y), s = same(x, y + 1), w = same(x - 1, y);
  let mask = (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0);
  if (n && e && same(x + 1, y - 1)) mask |= 16;
  if (s && e && same(x + 1, y + 1)) mask |= 32;
  if (s && w && same(x - 1, y + 1)) mask |= 64;
  if (n && w && same(x - 1, y - 1)) mask |= 128;
  return BLOB47[mask];
}

// 重算 (x,y) 及 8 邻格的模式并写回 z0
export function fixAround(z0, x, y, cols, rows) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const a = autoInfo(z0[ny * cols + nx]);
      if (!a) continue;
      z0[ny * cols + nx] = autoBase(a.table, a.block) + patternAt(z0, nx, ny, cols, rows);
    }
  }
}

// 左键刷 autotile: 写入新块后重算 3x3 邻域
export function paintAuto(z0, x, y, cols, rows, table, block) {
  z0[y * cols + x] = autoBase(table, block);
  fixAround(z0, x, y, cols, rows);
}

// 右键擦除: 置 0 (空) 后重算 3x3 邻域
export function eraseAuto(z0, x, y, cols, rows) {
  z0[y * cols + x] = 0;
  fixAround(z0, x, y, cols, rows);
}
