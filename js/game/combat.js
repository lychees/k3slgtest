// combat.js — 自动战斗结算 (SPEC「玩法规则」第 3 条)
// resolveCombat 直接结算整常战斗并修改双方成员 HP,
// 同时返回 playback (战前快照 + 事件序列) 供 battleui.js 回放。

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

// ctx: { terrainAvo(squad) }
export function resolveCombat(atk, def, ctx) {
  const playback = {
    atkName: atk.name, defName: def.name,
    atkTeam: atk.team,
    sides: { atk: snapshot(atk), def: snapshot(def) },
    events: [],
  };

  // 出手顺序: vanguard 先攻, 其余按阵型位置 (前排先); 双方交替
  const rowOf = m => (m.slot / 3) | 0;
  const cmp = sq => (a, b) =>
    (sq.hasFlag(b, 'vanguard') ? 1 : 0) - (sq.hasFlag(a, 'vanguard') ? 1 : 0) ||
    rowOf(a) - rowOf(b) || (a.slot % 3) - (b.slot % 3);
  const listA = atk.aliveMembers().sort(cmp(atk));
  const listD = def.aliveMembers().sort(cmp(def));
  const order = [];
  for (let i = 0; i < Math.max(listA.length, listD.length); i++) {
    if (listA[i]) order.push({ side: 'atk', squad: atk, member: listA[i], foe: def });
    if (listD[i]) order.push({ side: 'def', squad: def, member: listD[i], foe: atk });
  }

  for (const turn of order) {
    const { squad, member, foe, side } = turn;
    if (!member.alive || foe.wiped) continue;

    // 治疗者: 不攻击, 治疗己方 HP 比例最低者
    if (member.def.attackType === 'heal' || squad.hasFlag(member, 'healer')) {
      doHeal(playback, squad, member, side);
      continue;
    }

    const attacks = member.def.attacks || 1;
    let usedDouble = false;
    for (let n = 0; n < attacks; n++) {
      if (foe.wiped) break;
      const primary = doStrike(playback, squad, member, foe, side, ctx);
      // doubles: 技巧高于对手时立即追击一次
      if (!usedDouble && primary && primary.alive &&
          squad.hasFlag(member, 'doubles') &&
          squad.eff(member, 'skl') > foe.eff(primary, 'skl')) {
        usedDouble = true;
        n--;
      }
    }
  }
  return playback;
}

function doHeal(playback, squad, member, side) {
  const allies = squad.aliveMembers()
    .filter(m => m.hp < m.maxhp)
    .sort((a, b) => a.hp / a.maxhp - b.hp / b.maxhp);
  if (!allies.length) return;
  const target = allies[0];
  const skill = member.skills.find(s => s.flag === 'healer');
  const base = skill && skill.effect && skill.effect.mod ? skill.effect.mod : 3;
  const amount = base + squad.eff(member, 'mag');
  target.hp = Math.min(target.maxhp, target.hp + amount);
  playback.events.push({
    kind: 'heal', side, actorSlot: member.slot,
    targetSlot: target.slot, amount, hpAfter: target.hp,
  });
}

function doStrike(playback, squad, member, foe, side, ctx) {
  const foes = foe.aliveMembers();
  if (!foes.length) return null;

  let targets;
  const type = member.def.attackType;
  if (type === 'aoe') {
    targets = foes;   // 全体
  } else if (type === 'any') {
    targets = [foes[(Math.random() * foes.length) | 0]];   // 任意目标
  } else {
    // frontline: 中列优先
    targets = [FRONTLINE_PREF.map(s => foes.find(m => m.slot === s)).find(Boolean)];
  }

  const weapon = member.weapon;
  const avo = ctx.terrainAvo(foe);
  const results = [];
  for (const t of targets) {
    // 命中 = 武器 hit + skl*2 - 对方 skl - 地形 avo
    const hitPct = weapon.hit + squad.eff(member, 'skl') * 2 - foe.eff(t, 'skl') - avo;
    const hit = Math.random() * 100 < hitPct;
    let dmg = 0, killed = false;
    if (hit) {
      // 伤害 = max(1, str/mag + 武器 might - 对方 arm)
      const atkStat = MAGIC_WEAPONS.has(weapon.weapon)
        ? squad.eff(member, 'mag') : squad.eff(member, 'str');
      dmg = Math.max(1, atkStat + weapon.might - foe.eff(t, 'arm'));
      t.hp = Math.max(0, t.hp - dmg);
      if (t.hp === 0) { t.alive = false; killed = true; }
    }
    results.push({ slot: t.slot, dmg, miss: !hit, killed, hpAfter: t.hp });
  }
  playback.events.push({ kind: 'strike', side, actorSlot: member.slot, targets: results });
  return targets[0];
}
