// range.js — BFS 移动范围 / 攻击范围 / 寻路 (SPEC「玩法规则」第 2 条)
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ctx: { cols, rows, terrainAt(x,y), squadAt(x,y), squads }
// movOverride: 骑兵再移动时传剩余移动力; squad.flying: 无视地形 cost (恒 1), 可穿越但不可停墙格
export function computeMove(squad, ctx, movOverride) {
  const mov = movOverride ?? squad.mov;
  const fly = !!squad.flying;
  const move = new Map();   // "x,y" -> 剩余移动力
  move.set(`${squad.x},${squad.y}`, mov);
  const queue = [[squad.x, squad.y, mov]];
  while (queue.length) {
    const [cx, cy, rem] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= ctx.cols || ny >= ctx.rows) continue;
      const ter = ctx.terrainAt(nx, ny);
      if (!ter.pass && !fly) continue;
      const occ = ctx.squadAt(nx, ny);
      if (occ && occ.team !== squad.team) continue;   // 不可穿越敌人
      const nrem = rem - (fly ? 1 : ter.cost);
      if (nrem < 0) continue;
      const key = `${nx},${ny}`;
      if (move.has(key) && move.get(key) >= nrem) continue;
      move.set(key, nrem);
      queue.push([nx, ny, nrem]);
    }
  }
  if (fly) {   // 飞行: 可过任何格, 但不可停墙格 (水面可停)
    for (const k of [...move.keys()]) {
      const [x, y] = k.split(',').map(Number);
      if (ctx.terrainAt(x, y).id === 'wall') move.delete(k);
    }
  }
  // 友军格可穿越: 保留在 map 中供 findPath 回溯 (在此删除会导致"穿过友军才可达"的格子回溯死循环);
  // "不可停在他人格子"由落点选择处过滤 (点击/键盘 !squadAt, AI 在 planAction 过滤)
  return move;
}

// 攻击范围 = 所有可达格向外扩展 [rangeMin, range] 的曼哈顿圆环 (不含可达格本身)
export function computeAttackTiles(move, range, cols, rows, rangeMin = 1) {
  const atk = new Set();
  for (const k of move.keys()) {
    const [mx, my] = k.split(',').map(Number);
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 0 || d > range || d < rangeMin) continue;
        const ax = mx + dx, ay = my + dy;
        if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
        const key = `${ax},${ay}`;
        if (!move.has(key)) atk.add(key);
      }
    }
  }
  return atk;
}

// 沿剩余移动力回溯路径
export function findPath(squad, tx, ty, move) {
  const path = [[tx, ty]];
  let cx = tx, cy = ty, guard = 400;
  while ((cx !== squad.x || cy !== squad.y) && guard-- > 0) {
    let best = null, bestRem = -1;
    for (const [dx, dy] of DIRS) {
      const k = `${cx + dx},${cy + dy}`;
      if (move.has(k) && move.get(k) > bestRem) { bestRem = move.get(k); best = [cx + dx, cy + dy]; }
    }
    if (!best) break;
    path.unshift(best);
    [cx, cy] = best;
  }
  return path;
}
