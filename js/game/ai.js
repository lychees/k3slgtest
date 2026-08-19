// ai.js — 敌方阶段简单 AI (SPEC「玩法规则」第 4 条):
// 每支敌部队向最近的玩家部队移动, 能打到就打。

const dist = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

// ctx: { squads, computeMove(squad) }
// 返回 { dest: {x,y}, move, target } 或 null (没有可打的目标)
export function planAction(squad, ctx) {
  const foes = ctx.squads.filter(s => s.team !== squad.team);
  if (!foes.length) return null;

  const range = squad.rangeMax();
  const nearest = foes.slice().sort((a, b) => dist(squad.x, squad.y, a.x, a.y) - dist(squad.x, squad.y, b.x, b.y))[0];
  const move = ctx.computeMove(squad);

  // 选落脚点: 优先能打到目标的格子 (距离越近越好), 否则尽量接近
  let best = { x: squad.x, y: squad.y }, bestScore = Infinity;
  for (const key of move.keys()) {
    const [x, y] = key.split(',').map(Number);
    const d = dist(x, y, nearest.x, nearest.y);
    const score = d <= range ? d : 100 + d;
    if (score < bestScore) { bestScore = score; best = { x, y }; }
  }

  // 在落脚点上选一个射程内的目标 (HP 最少者优先)
  const target = foes
    .filter(f => dist(f.x, f.y, best.x, best.y) <= range)
    .sort((a, b) => a.totalHp() - b.totalHp())[0] || null;

  return { dest: best, move, target };
}
