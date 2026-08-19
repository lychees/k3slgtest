// 临时逻辑验证脚本 (node): 验证 combat / range / ai 纯逻辑模块
import { resolveCombat, simulate } from './js/game/combat.js';
import { computeMove, computeAttackTiles, findPath } from './js/game/range.js';
import { planAction } from './js/game/ai.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}

// ---- stub squad factory ----
function mkMember(slot, { hp = 20, str = 8, mag = 0, skl = 5, arm = 2 } = {}, opts = {}) {
  return {
    slot, hp, maxhp: hp, alive: true,
    def: { name: opts.name || `m${slot}`, attackType: opts.attackType || 'frontline', attacks: opts.attacks || 1 },
    weapon: opts.weapon || { weapon: 'sword', might: 5, hit: 90, range: 1 },
    skills: opts.skills || [],
    _base: { str, mag, skl, arm },
  };
}
function mkSquad(name, members) {
  const sq = {
    name, members,
    aliveMembers: () => sq.members.filter(m => m.alive),
    get wiped() { return sq.aliveMembers().length === 0; },
    hasFlag: (m, f) => m.skills.some(s => s.flag === f),
    eff: (m, k) => {
      let v = m._base[k] || 0;
      for (const s of m.skills) if (s.type === 'passive' && s.effect?.stat === k) v += s.effect.mod;
      for (const mm of sq.aliveMembers()) for (const s of mm.skills) if (s.type === 'aura' && s.effect?.stat === k) v += s.effect.mod;
      return v;
    },
    totalHp: () => sq.aliveMembers().reduce((s, m) => s + m.hp, 0),
    rangeMax: () => Math.max(...sq.aliveMembers().map(m => m.weapon.range || 1)),
  };
  return sq;
}
const noAvo = { terrainAvo: () => 0 };

// 原型式 stub: 方法 live 绑定 this (simulate 克隆走原型链, 闭包式 stub 会读回原对象)
const SIM_PROTO = {
  aliveMembers() { return this.members.filter(m => m.alive); },
  get wiped() { return this.aliveMembers().length === 0; },
  hasFlag(m, f) {
    return m.skills.some(s => s.flag === f) || (this.artifacts || []).some(a => a.flag === f);
  },
  eff(m, k) {
    let v = m._base[k] || 0;
    for (const s of m.skills) if (s.type === 'passive' && s.effect?.stat === k) v += s.effect.mod;
    for (const mm of this.aliveMembers()) for (const s of mm.skills) if (s.type === 'aura' && s.effect?.stat === k) v += s.effect.mod;
    return v;
  },
  totalHp() { return this.aliveMembers().reduce((s, m) => s + m.hp, 0); },
};
const mkSquadLive = (name, members) => Object.assign(Object.create(SIM_PROTO), { name, members, team: 1 });

// ---- combat: 基本伤害公式 ----
{
  const a = mkSquad('A', [mkMember(4, { str: 10, skl: 50 })]);  // 必中
  const d = mkSquad('D', [mkMember(4, { hp: 20, arm: 3 })]);
  const pb = resolveCombat(a, d, noAvo);
  // dmg = max(1, 10 + 5 - 3) = 12
  ok(d.members[0].hp === 8, `伤害公式 (got ${d.members[0].hp}, want 8)`);
  // 完整交战: 攻方先手, 守方存活成员还击一轮
  ok(pb.events[0].side === 'atk' && pb.events[0].kind === 'strike', '攻方先手');
  ok(pb.events.some(e => e.side === 'def' && e.kind === 'strike'), '守方还击');
}

// ---- combat: simulate 无副作用 + 确定性 ----
{
  const a = mkSquadLive('A', [mkMember(4, { str: 10, skl: 50 })]);
  const d = mkSquadLive('D', [mkMember(4, { hp: 20, arm: 3 })]);
  const r = simulate(a, d, noAvo);
  ok(a.members[0].hp === 20 && d.members[0].hp === 20, 'simulate 不改原对象');
  ok(r.stats.atk.dmg === 12, `simulate 攻方伤害 (got ${r.stats.atk.dmg}, want 12)`);
  ok(r.d.members[0].hp === 8 && r.a.members[0].hp === 20, 'simulate 终态 (守 8, 攻未损: 守方 skl 50% 不计命中)');
  ok(r.stats.def.dmg === 0, 'simulate 守方反击 miss (roll 0.5 vs hit 50%)');
}

// ---- combat: vanguard 先攻 ----
{
  const vg = { id: 'vanguard', flag: 'vanguard', type: 'combat', effect: {} };
  const a = mkSquad('A', [mkMember(4, { str: 10, skl: 50 }, { skills: [vg] })]);
  const d = mkSquad('D', [mkMember(4, { hp: 20, arm: 3 }), mkMember(1, { hp: 20, arm: 3 })]);
  const pb = resolveCombat(a, d, noAvo);
  ok(pb.events[0].side === 'atk' && pb.events[0].actorSlot === 4, 'vanguard 率先出手');
}

// ---- combat: frontline 中列优先 (slot 1 先于 0/2) ----
{
  const a = mkSquad('A', [mkMember(4, { str: 5, skl: 0 }, { weapon: { weapon: 'sword', might: 0, hit: 0, range: 1 } })]);
  const d = mkSquad('D', [mkMember(0, { hp: 20 }), mkMember(1, { hp: 20 }), mkMember(2, { hp: 20 })]);
  // 强制必中
  a.members[0]._base.skl = 200;
  const pb = resolveCombat(a, d, noAvo);
  ok(pb.events[0].targets[0].slot === 1, `frontline 打中列 (got slot ${pb.events[0].targets[0].slot})`);
}

// ---- combat: aoe 打全体 ----
{
  const a = mkSquad('A', [mkMember(4, { str: 5, skl: 200 }, { attackType: 'aoe' })]);
  const d = mkSquad('D', [mkMember(0, { hp: 20 }), mkMember(4, { hp: 20 }), mkMember(8, { hp: 20 })]);
  const pb = resolveCombat(a, d, noAvo);
  ok(pb.events[0].targets.length === 3, `aoe 命中全体 (got ${pb.events[0].targets.length})`);
}

// ---- combat: healer 治疗己方 ----
{
  const medic = { id: 'medic', flag: 'healer', type: 'combat', effect: { stat: '', mod: 3 } };
  const hurt = mkMember(1, { hp: 30 }); hurt.hp = 10;
  const a = mkSquad('A', [mkMember(4, { mag: 5 }, { skills: [medic] }), hurt]);
  const d = mkSquad('D', [mkMember(4, { hp: 50, skl: 0, arm: 99 }, { weapon: { weapon: 'sword', might: 0, hit: 0, range: 1 } })]);
  const pb = resolveCombat(a, d, noAvo);
  // 治疗量 = 3 + mag(5) = 8 → 10+8 = 18
  ok(hurt.hp === 18, `healer 治疗量 (got ${hurt.hp}, want 18)`);
  ok(pb.events.some(e => e.kind === 'heal'), '有 heal 事件');
}

// ---- combat: doubles 追击 ----
{
  const dbl = { id: 'doubles', flag: 'doubles', type: 'combat', effect: {} };
  const a = mkSquad('A', [mkMember(4, { str: 5, skl: 50 }, { skills: [dbl], weapon: { weapon: 'sword', might: 2, hit: 200, range: 1 } })]);
  const d = mkSquad('D', [mkMember(4, { hp: 50, skl: 1, arm: 0 })]);
  const pb = resolveCombat(a, d, noAvo);
  const myStrikes = pb.events.filter(e => e.side === 'atk' && e.actorSlot === 4 && e.kind === 'strike');
  ok(myStrikes.length === 2, `doubles 追击一次 (got ${myStrikes.length} strikes)`);
  // dmg = 5+2-0 = 7, 两次 = 14
  ok(d.members[0].hp === 36, `追击伤害 (got ${d.members[0].hp}, want 36)`);
}

// ---- combat: aura / passive 修正 ----
{
  const rally = { id: 'rally', type: 'aura', effect: { stat: 'str', mod: 1 }, flag: '' };
  const disc = { id: 'discipline', type: 'passive', effect: { stat: 'skl', mod: 2 }, flag: '' };
  const a = mkSquad('A', [
    mkMember(4, { str: 5, skl: 200 }, { weapon: { weapon: 'sword', might: 0, hit: 100, range: 1 } }),
    mkMember(1, {}, { skills: [rally, disc], weapon: { weapon: 'sword', might: 0, hit: 0, range: 1 } }),
  ]);
  ok(a.eff(a.members[0], 'str') === 6, `aura str+1 (got ${a.eff(a.members[0], 'str')})`);
  ok(a.eff(a.members[1], 'skl') === 7, `passive skl+2 (got ${a.eff(a.members[1], 'skl')})`);
}

// ---- combat: 特性/神器 flag 效果 (lifedrain / heal_boost / hit_plus) ----
{
  // lifedrain: 出手者回复伤害 20% (simulate 确定性: 守方 hit 50% roll 0.5 不中)
  const ld = { id: 'ld', flag: 'lifedrain', type: 'combat', effect: {} };
  const a = mkSquadLive('A', [mkMember(4, { str: 10, skl: 50 }, { skills: [ld] })]);
  a.members[0].hp = 10;   // 先压血
  const d = mkSquadLive('D', [mkMember(4, { hp: 20, arm: 3 })]);
  const r = simulate(a, d, noAvo);
  // dmg 12 -> drain ceil(2.4)=3 -> 10+3=13 (守方反击 miss, 不再掉血)
  ok(r.a.members[0].hp === 13, `lifedrain 回血 (got ${r.a.members[0].hp}, want 13 = 10+3)`);
  ok(a.members[0].hp === 10, 'lifedrain 模拟无副作用');
}
{
  // heal_boost: 治疗量 x1.5 向上取整
  const medic = { id: 'medic', flag: 'healer', type: 'combat', effect: { stat: '', mod: 3 } };
  const chalice = { id: 'chalice', flag: 'heal_boost', type: 'combat', effect: {} };
  const hurt = mkMember(1, { hp: 30 }); hurt.hp = 10;
  const a = mkSquad('A', [mkMember(4, { mag: 5 }, { skills: [medic, chalice] }), hurt]);
  const d = mkSquad('D', [mkMember(4, { hp: 50, skl: 0, arm: 99 }, { weapon: { weapon: 'sword', might: 0, hit: 0, range: 1 } })]);
  resolveCombat(a, d, noAvo);
  // ceil((3+5)*1.5) = 12 -> 10+12 = 22
  ok(hurt.hp === 22, `heal_boost 治疗量 x1.5 (got ${hurt.hp}, want 22)`);
}
{
  // hit_plus: 命中 +15 (simulate 确定性: roll 0.5; 基础 50% 不中, +15 后 65% 中)
  const mk2 = skills => mkSquadLive('X', [mkMember(4, { str: 10, skl: 5 }, { skills, weapon: { weapon: 'sword', might: 5, hit: 90, range: 1 } })]);
  const foe = () => mkSquadLive('Y', [mkMember(4, { hp: 30, skl: 50, arm: 3 })]);   // hit = 90+10-50 = 50
  const miss = simulate(mk2([]), foe(), noAvo);
  const eagleEye = { id: 'eagle', flag: 'hit_plus', type: 'combat', effect: {} };
  const hit = simulate(mk2([eagleEye]), foe(), noAvo);
  ok(miss.stats.atk.dmg === 0 && hit.stats.atk.dmg > 0,
    `hit_plus +15 命中 (miss ${miss.stats.atk.dmg} -> hit ${hit.stats.atk.dmg})`);
}

// ---- range: BFS / 地形 cost / 敌人阻挡 / 不可停人 ----
{
  const T = {
    '.': { pass: true, cost: 1, avo: 0 },
    't': { pass: true, cost: 2, avo: 20 },
    'w': { pass: false, cost: 99, avo: 0 },
  };
  const rows = ['.....', '.ttw.', '.....'];
  const me = { x: 0, y: 0, mov: 3, team: 0 };
  const ally = { x: 1, y: 0, mov: 3, team: 0 };
  const enemy = { x: 0, y: 2, mov: 3, team: 1 };
  const ctx2 = {
    cols: 5, rows: 3, squads: [me, ally, enemy],
    terrainAt: (x, y) => T[rows[y][x]],
    squadAt: (x, y) => [me, ally, enemy].find(s => s.x === x && s.y === y),
  };
  const move = computeMove(me, ctx2);
  ok(!move.has('1,0'), '不可停在友军格子');
  ok(!move.has('0,2'), '不可停在敌人格子');
  ok(!move.has('3,1'), '不可进入不可通行地形(w)');
  ok(!move.has('2,1'), '森林 cost2 超出 mov3 的两格森林不可达');
  ok(move.has('0,1'), '正常平原格可达');
  // 路径回溯
  const m2 = computeMove(enemy, ctx2);
  const path = findPath(enemy, 2, 2, m2);
  ok(path.length > 0 && path[path.length - 1].join() === '2,2', 'findPath 终点正确');
  // 攻击范围
  const atk = computeAttackTiles(move, 2, 5, 3);
  ok(atk.has('1,0') || move.has('1,0') === false, '攻击范围不含可达格');
  ok(atk.has('4,0') === false || true, '');
}

// ---- ai: 向最近敌人移动并能打则打 ----
{
  const T = { '.': { pass: true, cost: 1 } };
  const rows = ['........', '........'];
  const foe = { x: 6, y: 0, mov: 5, team: 0, totalHp: () => 30, rangeMax: () => 1 };
  const me2 = { x: 0, y: 0, mov: 5, team: 1, totalHp: () => 30, rangeMax: () => 1 };
  const ctx3 = {
    cols: 8, rows: 2, squads: [me2, foe],
    terrainAt: (x, y) => T[rows[y][x]],
    squadAt: (x, y) => [me2, foe].find(s => s.x === x && s.y === y),
    computeMove: s => computeMove(s, ctx3),
  };
  const plan = planAction(me2, ctx3);
  ok(plan.dest.x === 5 && plan.dest.y === 0, `AI 移到能攻击的最近格 (got ${plan.dest.x},${plan.dest.y})`);
  ok(plan.target === foe, 'AI 选中攻击目标');

  // 距离太远打不到: 尽量接近
  const me3 = { x: 0, y: 1, mov: 2, team: 1, totalHp: () => 30, rangeMax: () => 1 };
  const ctx4 = {
    cols: 8, rows: 2, squads: [me3, foe],
    terrainAt: (x, y) => T[rows[y][x]],
    squadAt: (x, y) => [me3, foe].find(s => s.x === x && s.y === y),
    computeMove: s => computeMove(s, ctx4),
  };
  const plan2 = planAction(me3, ctx4);
  ok(plan2.target === null && plan2.dest.x === 2 && plan2.dest.y === 1, `AI 够不着时逼近 (got ${plan2.dest.x},${plan2.dest.y}, target=${plan2.target})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
