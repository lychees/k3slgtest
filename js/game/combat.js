// combat.js — 自动战斗结算 (SPEC「玩法规则」第 3 条)
// 完整交战: 攻方全员先出手一轮, 守方存活成员再按同样规则还手一轮
// (frontline/any/aoe/heal/vanguard/doubles 双方全适用)。
// resolveCombat 直接结算整场战斗并修改双方成员 HP, 返回 playback 供回放;
// simulate 是无副作用的确定性模拟 (深拷贝 + 固定 rng), 供攻击前的预测面板。

const MAGIC_WEAPONS = new Set(['fire', 'ice', 'lightning', 'heal']);
// frontline 目标优先中列 (slot 1/4/7), 再按阵型顺序
const FRONTLINE_PREF = [1, 4, 7, 0, 2, 3, 5, 6, 8];

function snapshot(squad) {
  return squad.members.map(m => ({
    slot: m.slot, name: m.def.name, sprite: m.def.sprite,
    hp: m.hp, maxhp: m.maxhp, alive: m.alive,
    weaponKind: m.weapon.weapon, range: m.weapon.range || 1,
  }));
}

// 出手顺序: 攻方全员一轮 -> 守方全员一轮; 每方内部 vanguard 先, 再按阵型前排->后排, 左->右
function strikeOrder(atk, def) {
  const rowOf = m => (m.slot / 3) | 0;
  const cmp = sq => (a, b) =>
    (sq.hasFlag(b, 'vanguard') ? 1 : 0) - (sq.hasFlag(a, 'vanguard') ? 1 : 0) ||
    rowOf(a) - rowOf(b) || (a.slot % 3) - (b.slot % 3);
  const order = [];
  for (const m of atk.aliveMembers().sort(cmp(atk))) order.push({ side: 'atk', squad: atk, member: m, foe: def });
  for (const m of def.aliveMembers().sort(cmp(def))) order.push({ side: 'def', squad: def, member: m, foe: atk });
  return order;
}

// 共享引擎: rng 可注入 (simulate 用固定值), hook 收每个事件 (回放/经验/统计)
function runCombat(atk, def, ctx, rng, hook) {
  for (const turn of strikeOrder(atk, def)) {
    const { squad, member, foe, side } = turn;
    if (!member.alive || foe.wiped) continue;

    // 治疗者: 不攻击, 治疗己方 HP 比例最低者
    if (member.def.attackType === 'heal' || squad.hasFlag(member, 'healer')) {
      const ev = doHeal(squad, member, side);
      if (ev) hook(side, squad, member, ev);
      continue;
    }

    const attacks = member.def.attacks || 1;
    let usedDouble = false;
    for (let n = 0; n < attacks; n++) {
      if (foe.wiped) break;
      const r = doStrike(squad, member, foe, side, ctx, rng);
      if (r) hook(side, squad, member, r.ev);
      // doubles: 技巧高于对手时立即追击一次
      if (!usedDouble && r && r.primary && r.primary.alive &&
          squad.hasFlag(member, 'doubles') &&
          squad.eff(member, 'skl') > foe.eff(r.primary, 'skl')) {
        usedDouble = true;
        n--;
      }
    }
  }
}

// ctx: { terrainAvo(squad) }
export function resolveCombat(atk, def, ctx) {
  const playback = {
    atkName: atk.name, defName: def.name,
    atkTeam: atk.team,
    sides: { atk: snapshot(atk), def: snapshot(def) },
    events: [],
  };
  runCombat(atk, def, ctx, Math.random, (side, squad, member, ev) => {
    playback.events.push(ev);
    // 玩家实例出手即得经验 (攻击或反击都算: 命中+10/击杀+30)
    if (ev.kind === 'strike' && squad.team === 0 && squad.grantStrikeExp) {
      squad.grantStrikeExp(member, ev.targets, playback, side);
    }
  });
  return playback;
}

// 深拷贝部队 (原型链保留方法, members 换成副本) — 模拟不碰原对象
function cloneSquad(s) {
  const c = Object.create(Object.getPrototypeOf(s));
  Object.assign(c, s);
  c.members = s.members.map(m => ({ ...m }));
  return c;
}

// 无副作用模拟: 固定 rng (roll 恒 0.5, 即命中率 >50% 视为命中), 返回双方终态与统计
export function simulate(atk, def, ctx) {
  const a = cloneSquad(atk), d = cloneSquad(def);
  const stats = { atk: { dmg: 0, kills: 0 }, def: { dmg: 0, kills: 0 } };
  runCombat(a, d, ctx, () => 0.5, (side, squad, member, ev) => {
    if (ev.kind !== 'strike') return;
    for (const t of ev.targets) {
      if (!t.miss) stats[side].dmg += t.dmg;
      if (t.killed) stats[side].kills++;
    }
  });
  return { a, d, stats };
}

// 面板单发预览: 某方第一个出手成员 (跳过治疗者) 对其 frontline 目标的伤害/命中
// 反击预览 = previewStrike(守, 攻, ctx)
export function previewStrike(atk, def, ctx) {
  const turn = strikeOrder(atk, def)
    .find(t => t.side === 'atk' && t.member.def.attackType !== 'heal' && !atk.hasFlag(t.member, 'healer'));
  if (!turn) return null;
  const foes = def.aliveMembers();
  if (!foes.length) return null;
  const target = FRONTLINE_PREF.map(s => foes.find(x => x.slot === s)).find(Boolean);
  const member = turn.member, weapon = member.weapon;
  let hit = weapon.hit + atk.eff(member, 'skl') * 2 - def.eff(target, 'skl') - ctx.terrainAvo(def);
  if (atk.hasFlag(member, 'hit_plus')) hit += 15;
  hit = Math.max(0, Math.min(100, hit));
  const atkStat = MAGIC_WEAPONS.has(weapon.weapon)
    ? atk.eff(member, 'mag') : atk.eff(member, 'str');
  const dmg = Math.max(1, atkStat + weapon.might - def.eff(target, 'arm'));
  return { dmg, hit: Math.round(hit) };
}

function doHeal(squad, member, side) {
  const allies = squad.aliveMembers()
    .filter(m => m.hp < m.maxhp)
    .sort((a, b) => a.hp / a.maxhp - b.hp / b.maxhp);
  if (!allies.length) return null;
  const target = allies[0];
  const skill = member.skills.find(s => s.flag === 'healer');
  const base = skill && skill.effect && skill.effect.mod ? skill.effect.mod : 3;
  let amount = base + squad.eff(member, 'mag');
  if (squad.hasFlag(member, 'heal_boost')) amount = Math.ceil(amount * 1.5);   // 天使圣杯
  target.hp = Math.min(target.maxhp, target.hp + amount);
  return {
    kind: 'heal', side, actorSlot: member.slot,
    targetSlot: target.slot, amount, hpAfter: target.hp,
  };
}

function doStrike(squad, member, foe, side, ctx, rng) {
  const foes = foe.aliveMembers();
  if (!foes.length) return null;

  let targets;
  const type = member.def.attackType;
  if (type === 'aoe') {
    targets = foes;   // 全体
  } else if (type === 'any') {
    targets = [foes[(rng() * foes.length) | 0]];   // 任意目标
  } else {
    // frontline: 中列优先
    targets = [FRONTLINE_PREF.map(s => foes.find(m => m.slot === s)).find(Boolean)];
  }

  const weapon = member.weapon;
  const avo = ctx.terrainAvo(foe);
  const results = [];
  let totalDmg = 0;
  for (const t of targets) {
    // 命中 = 武器 hit + skl*2 - 对方 skl - 地形 avo (+鹰眼特性/戒指 15)
    let hitPct = weapon.hit + squad.eff(member, 'skl') * 2 - foe.eff(t, 'skl') - avo;
    if (squad.hasFlag(member, 'hit_plus')) hitPct += 15;
    const hit = rng() * 100 < hitPct;
    let dmg = 0, killed = false;
    if (hit) {
      // 伤害 = max(1, str/mag + 武器 might - 对方 arm)
      const atkStat = MAGIC_WEAPONS.has(weapon.weapon)
        ? squad.eff(member, 'mag') : squad.eff(member, 'str');
      dmg = Math.max(1, atkStat + weapon.might - foe.eff(t, 'arm'));
      t.hp = Math.max(0, t.hp - dmg);
      if (t.hp === 0) { t.alive = false; killed = true; }
      totalDmg += dmg;
    }
    results.push({ slot: t.slot, dmg, miss: !hit, killed, hpAfter: t.hp });
  }
  const ev = { kind: 'strike', side, actorSlot: member.slot, targets: results };
  // 嗜血/血饮坠: 出手者回复伤害 20% 的 HP (不超上限)
  if (totalDmg > 0 && member.alive && squad.hasFlag(member, 'lifedrain')) {
    const drain = Math.min(member.maxhp - member.hp, Math.ceil(totalDmg * 0.2));
    if (drain > 0) {
      member.hp += drain;
      ev.drain = { amount: drain, hpAfter: member.hp };
    }
  }
  return { ev, primary: targets[0] };
}
