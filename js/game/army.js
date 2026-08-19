// army.js — 战役养成状态: 单位实例 / 编队 / 科技 / 科技点 / 神器库存 (SPEC「养成系统」)
// 持久化: localStorage 'sow_army'。无存档时按 data/squads.json 模板初始化。
// 敌人部队不走此模块 (无养成, 维持模板)。

const KEY = 'sow_army';
const CLEARED_KEY = 'sow_cleared';

// 初始已解锁职业 (其余需科技解锁; 只影响后备池/转职/招募, 不影响模板初始编队)
const INITIAL_CLASSES = ['soldier', 'fighter', 'archer', 'scout', 'spearman', 'mercenary', 'medic'];
// 初始神器库存 (模板编队中已装备者也算持有)
const INITIAL_ARTIFACTS = ['banner_of_valor', 'ward_charm'];
const PLAYER_SQUADS = ['zelos_guard', 'diana_squad', 'knight_wall'];
const UNIT_LEVEL = 5;   // 新单位初始等级
const INITIAL_GOLD = 2000;

export let army = null;

let uidCounter = 0;
function newUid() { return `u${Date.now().toString(36)}_${++uidCounter}`; }

function newUnit(classId, level = UNIT_LEVEL) {
  return { uid: newUid(), classId, level, exp: 0, gains: {}, hp: null };   // hp null = 满血
}

function defaultArmy(db) {
  const a = { units: {}, rosters: {}, tech: [], techPoints: 0, gold: INITIAL_GOLD, inventory: INITIAL_ARTIFACTS.slice() };
  for (const ref of PLAYER_SQUADS) {
    const tpl = db.squadsById[ref];
    if (!tpl) continue;
    const members = {};
    let leader = null;
    for (const m of tpl.members) {
      const u = newUnit(m.unit);
      a.units[u.uid] = u;
      members[m.slot] = u.uid;
      if (m.unit === tpl.leader) leader = u.uid;
    }
    a.rosters[ref] = { leader, members, artifacts: (tpl.artifacts || []).slice(0, 2) };
  }
  // 后备池: 每个已解锁职业 2 个单位
  for (const cls of INITIAL_CLASSES) {
    for (let i = 0; i < 2; i++) {
      const u = newUnit(cls);
      a.units[u.uid] = u;
    }
  }
  return a;
}

// 校验存档与当前数据的相容性 (职业/部队模板被删时回退默认)
function validate(a, db) {
  if (!a || !a.units || !a.rosters || !Array.isArray(a.tech)) return false;
  for (const ref of PLAYER_SQUADS) {
    const r = a.rosters[ref];
    if (!r || !r.members) return false;
    const uids = Object.values(r.members);
    if (!uids.length || !uids.every(id => a.units[id] && db.unitsById[a.units[id].classId])) return false;
    if (!r.leader || !uids.includes(r.leader)) return false;
  }
  return true;
}

export function loadArmy(db) {
  let a = null;
  try {
    a = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch { a = null; }
  army = validate(a, db) ? a : defaultArmy(db);
  if (typeof army.gold !== 'number') army.gold = INITIAL_GOLD;   // 旧存档迁移
  saveArmy();
  return army;
}

export function saveArmy() {
  try { localStorage.setItem(KEY, JSON.stringify(army)); } catch {}
}

export function resetArmy() {
  try { localStorage.removeItem(KEY); } catch {}
  army = null;
}

// ---- 科技 ----
export function techBonuses(techDb) {
  // techDb: data/tech.json 的 techs 数组 (或已建索引)
  const out = {};
  if (!army) return out;
  for (const id of army.tech) {
    const t = techDb.find(n => n.id === id);
    if (t && t.effect && t.effect.stat) out[t.effect.stat] = (out[t.effect.stat] || 0) + t.effect.mod;
  }
  return out;
}

export function isClassUnlocked(classId, techDb) {
  if (INITIAL_CLASSES.includes(classId)) return true;
  if (!army) return false;
  return army.tech.some(id => {
    const t = techDb.find(n => n.id === id);
    return t && t.unlockClass === classId;
  });
}

export function isT2Unlocked(techDb) {
  if (!army) return false;
  return army.tech.some(id => {
    const t = techDb.find(n => n.id === id);
    return t && t.unlockClass === 'T2';
  });
}

// 研究: 前置满足 + 科技点足够 -> 扣点, 解锁职业则补 2 个后备单位
export function research(id, techDb) {
  const t = techDb.find(n => n.id === id);
  if (!t || !army || army.tech.includes(id)) return false;
  if (!(t.requires || []).every(r => army.tech.includes(r))) return false;
  if (army.techPoints < t.cost) return false;
  army.techPoints -= t.cost;
  army.tech.push(id);
  if (t.unlockClass && t.unlockClass !== 'T2') {
    for (let i = 0; i < 2; i++) {
      const u = newUnit(t.unlockClass);
      army.units[u.uid] = u;
    }
  }
  saveArmy();
  return true;
}

// ---- 战斗奖励 ----
export function addKills(n) {   // 击杀: +1 科技点, +50 金币
  if (army && n > 0) { army.techPoints += n; army.gold += 50 * n; saveArmy(); }
}
export function addVictory() {  // 胜利: +5 科技点, +1000 金币
  if (army) { army.techPoints += 5; army.gold += 1000; saveArmy(); }
}

// ---- 经济 ----
export function hireUnit(classId, cost) {   // 招募 -> 后备池
  if (!army || army.gold < cost) return false;
  army.gold -= cost;
  const u = newUnit(classId);
  army.units[u.uid] = u;
  saveArmy();
  return true;
}
export function buyArtifact(id, price) {   // 商店 -> 库存
  if (!army || army.gold < price) return false;
  army.gold -= price;
  army.inventory.push(id);
  saveArmy();
  return true;
}

// ---- 通关记录 ----
export function markCleared(mapId) {
  try {
    const s = new Set(JSON.parse(localStorage.getItem(CLEARED_KEY) || '[]'));
    s.add(mapId);
    localStorage.setItem(CLEARED_KEY, JSON.stringify([...s]));
  } catch {}
}
export function clearedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(CLEARED_KEY) || '[]')); }
  catch { return new Set(); }
}
export function clearCleared() {
  try { localStorage.removeItem(CLEARED_KEY); } catch {}
}

// 战后把成员状态写回实例 (exp/level 在战斗结算时已改, 这里同步 HP)
export function syncMemberHp(ref, slot, hp) {
  const r = army && army.rosters[ref];
  const uid = r && r.members[slot];
  const u = uid && army.units[uid];
  if (u) u.hp = hp;
}

// 每次进图满血复活 (战役间休整; 死亡不永久减员)
export function healAll() {
  if (!army) return;
  for (const u of Object.values(army.units)) u.hp = null;
  saveArmy();
}

// ---- 编队 ----
export function rosterOf(ref) { return army ? army.rosters[ref] : null; }

// 后备池 = 未被任何编队引用的单位
export function poolUnits() {
  if (!army) return [];
  const used = new Set();
  for (const r of Object.values(army.rosters)) {
    for (const id of Object.values(r.members)) used.add(id);
    if (r.leader) used.add(r.leader);
  }
  return Object.values(army.units).filter(u => !used.has(u.uid));
}

// 容量: min(9, 2 + 队长 ldr) — ldr = base + 成长 + 自身 passive
export function capacityOf(ref, db) {
  const r = rosterOf(ref);
  const u = r && army.units[r.leader];
  if (!u) return 0;
  const def = db.unitsById[u.classId];
  let ldr = (def.base.ldr || 0) + (u.gains.ldr || 0);
  for (const sid of def.skills || []) {
    const s = db.skillsById[sid];
    if (s && s.type === 'passive' && s.effect && s.effect.stat === 'ldr') ldr += s.effect.mod;
  }
  return Math.min(9, 2 + ldr);
}
