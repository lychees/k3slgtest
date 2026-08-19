// range.js — BFS 移动范围 / 攻击范围 / 寻路 (SPEC「玩法规则」第 2 条)
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ctx: { cols, rows, terrainAt(x,y), squadAt(x,y), squads }
export function computeMove(squad, ctx) {
  const move = new Map();   // "x,y" -> 剩余移动力
  move.set(`${squad.x},${squad.y}`, squad.mov);
  const queue = [[squad.x, squad.y, squad.mov]];
  while (queue.length) {
    const [cx, cy, rem] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= ctx.cols || ny >= ctx.rows) continue;
      const ter = ctx.terrainAt(nx, ny);
      if (!ter.pass) continue;
      const occ = ctx.squadAt(nx, ny);
      if (occ && occ.team !== squad.team) continue;   // 不可穿越敌人
      const nrem = rem - ter.cost;
      if (nrem < 0) continue;
      const key = `${nx},${ny}`;
      if (move.has(key) && move.get(key) >= nrem) continue;
      move.set(key, nrem);
      queue.push([nx, ny, nrem]);
    }
  }
  // 不可停在他人格子
  for (const s of ctx.squads) {
    if (s !== squad) move.delete(`${s.x},${s.y}`);
  }
  return move;
}

// 攻击范围 = 所有可达格向外扩展 range 的曼哈顿圆环 (不含可达格本身)
export function computeAttackTiles(move, range, cols, rows) {
  const atk = new Set();
  for (const k of move.keys()) {
    const [mx, my] = k.split(',').map(Number);
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 0 || d > range) continue;
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
