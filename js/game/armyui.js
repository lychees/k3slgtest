// armyui.js — 整备界面: 编队 / 转职 / 神器 / 科技树 (SPEC「养成系统」)
// 操作 army.js 的战役状态, 每次变更即持久化; UI 沿用 .fe-panel 风。
import * as Army from './army.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);

let db = null, techDb = null;
let onTechChange = null, onCloseCb = null, onArenaCb = null;
let selSquad = 'zelos_guard';
let selPool = null;    // 后备池选中的 uid
let selSlot = null;    // 阵型中选中的格子

const SQUAD_REFS = ['zelos_guard', 'diana_squad', 'knight_wall'];
const unitImg = u => `assets/${db.unitsById[u.classId].sprite}.png`;
const unitName = u => u.name || db.unitsById[u.classId].name;   // 传说随从头名优先

async function ensureTechDb() {
  if (!techDb) {
    const t = await fetch('data/tech.json').then(r => r.json());
    techDb = t.techs || t;
  }
  return techDb;
}

export async function openArmyUI(dbArg, opts = {}) {
  db = dbArg;
  onTechChange = opts.onTechChange || null;
  onCloseCb = opts.onClose || null;
  onArenaCb = opts.onArena || null;
  await ensureTechDb();
  Army.loadArmy(db);
  db.army = Army.army;   // loadArmy 每次重建对象, 同步引用避免游戏内 Squad 持有旧实例
  selPool = null;
  selSlot = null;
  const overlay = $('army-ui');
  overlay.style.display = 'flex';
  // 不穿透到舞台/键盘
  for (const t of ['click', 'mousemove', 'wheel', 'contextmenu', 'keydown']) {
    overlay.addEventListener(t, e => e.stopPropagation());
  }
  for (const tab of overlay.querySelectorAll('.au-tab')) {
    tab.onclick = () => showTab(tab.dataset.tab);
  }
  overlay.querySelector('.au-close').onclick = () => {
    overlay.style.display = 'none';
    if (onCloseCb) onCloseCb();
  };
  showTab('formation');
}

function showTab(name) {
  for (const tab of $('army-ui').querySelectorAll('.au-tab')) {
    tab.classList.toggle('sel', tab.dataset.tab === name);
  }
  selPool = null;
  selSlot = null;
  if (name === 'formation') renderFormation();
  else if (name === 'promote') renderPromote();
  else if (name === 'recruit') renderRecruit();
  else if (name === 'weapon') renderWeapon();
  else if (name === 'artifact') renderArtifact();
  else if (name === 'shop') renderShop();
  else if (name === 'tech') renderTech();
  else if (name === 'arena') renderArena();
}

const el = (tag, cls, text) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
};

// ---------------------------------------------------------------- 单位属性卡
const ATK_TYPE_LABEL = { frontline: '前排', any: '任意', aoe: '全体', heal: '治疗' };
const WEAPON_LABEL = { sword: '剑', lance: '枪', axe: '斧', bow: '弓', fire: '火', ice: '冰', lightning: '雷', heal: '治疗', claw: '爪', gun: '铳' };
const STAT_LABEL = { hp: 'HP', str: '力', mag: '魔', skl: '技', arm: '防', ldr: '统率', mov: '移动' };

// squadRef 非空时算有效值 (基础+成长+自身 passive+科技+神器; 不含队友 aura — 那是战时状态)
function cardStats(u, squadRef) {
  const def = db.unitsById[u.classId];
  const tech = squadRef ? Army.techBonuses(techDb) : {};
  const arts = squadRef
    ? (Army.rosterOf(squadRef).artifacts || []).map(id => db.itemsById[id]).filter(Boolean)
    : [];
  const out = {};
  for (const k of ['hp', 'str', 'mag', 'skl', 'arm', 'ldr']) {
    const base = (def.base[k] || 0) + (u.gains[k] || 0);
    let v = base;
    for (const tid of u.traits || []) {   // 特性加成
      const t = db.traitsById[tid];
      if (t && t.effect && t.effect.stat === k) v += t.effect.mod;
    }
    for (const sid of def.skills || []) {
      const s = db.skillsById[sid];
      if (s && s.type === 'passive' && s.effect && s.effect.stat === k) v += s.effect.mod;
    }
    v += tech[k] || 0;
    for (const a of arts) if (a.bonuses && a.bonuses[k]) v += a.bonuses[k];
    out[k] = { v, boosted: v > base };
  }
  out.mov = { v: def.base.mov, boosted: false };
  return out;
}

function unitCardHtml(u, squadRef) {
  const def = db.unitsById[u.classId];
  const st = cardStats(u, squadRef);
  const tier = def.tier || (def.promotesTo ? 1 : 2);
  const stat = k => `<span class="card-stat${st[k].boosted ? ' up' : ''}">${STAT_LABEL[k]}${st[k].v}${st[k].boosted ? '↑' : ''}</span>`;
  const traits = (u.traits || []).map(id => db.traitsById[id]).filter(Boolean)
    .map(t => `<span class="card-skill card-trait" title="${t.name}: ${t.description || ''}"><img src="assets/${t.icon}.png" onerror="this.style.visibility='hidden'">${t.name}</span>`).join('');
  const skills = (def.skills || []).map(id => db.skillsById[id]).filter(Boolean)
    .map(s => `<span class="card-skill"><img src="assets/${s.icon}.png" onerror="this.style.visibility='hidden'">${s.name}</span>`).join('');
  const growth = Object.entries(def.growth || {}).filter(([, v]) => v > 0)
    .map(([k, v]) => `${STAT_LABEL[k]}${v}%`).join(' ');
  return `<div class="card-head"><img src="assets/${def.sprite}.png">
    <div><div class="card-title">${u.name ? `<span class="legend">${u.name}</span> · ` : ''}${def.name} <span class="card-sub">T${tier} Lv.${u.level}</span></div>
    <div class="card-sub">${WEAPON_LABEL[def.weapon] || def.weapon} · ${ATK_TYPE_LABEL[def.attackType] || def.attackType}${def.promotesTo ? ` · →${db.unitsById[def.promotesTo].name}` : ''}</div></div></div>
  <div class="card-stats">${['hp', 'str', 'mag', 'skl', 'arm', 'ldr', 'mov'].map(stat).join('')}</div>
  ${traits ? `<div class="card-skills">${traits}</div>` : ''}
  ${skills ? `<div class="card-skills">${skills}</div>` : ''}
  <div class="card-growth">成长 ${growth}</div>`;
}

function attachCard(elm, u, squadRef) {
  elm.addEventListener('mouseenter', () => {
    const c = $('au-card');
    c.innerHTML = unitCardHtml(u, squadRef);
    c.style.display = 'block';
  });
  elm.addEventListener('mouseleave', () => { $('au-card').style.display = 'none'; });
}

// ---------------------------------------------------------------- 编队
function renderFormation() {
  const body = $('au-body');
  body.innerHTML = '';

  // 部队选择
  const sqRow = el('div', 'au-squads');
  for (const ref of SQUAD_REFS) {
    const r = Army.rosterOf(ref);
    const n = Object.keys(r.members).length;
    const b = el('span', 'au-sqbtn' + (ref === selSquad ? ' sel' : ''),
      `${db.squadsById[ref].name} ${n}/${Army.capacityOf(ref, db)}`);
    b.onclick = () => { selSquad = ref; selPool = null; selSlot = null; renderFormation(); };
    sqRow.appendChild(b);
  }
  body.appendChild(sqRow);

  const wrap = el('div', 'au-form-wrap');
  // 左: 3x3 阵型
  const roster = Army.rosterOf(selSquad);
  const grid = el('div', 'au-grid');
  for (let slot = 0; slot < 9; slot++) {
    const cell = el('div', 'au-cell' + (selSlot === slot ? ' sel' : ''));
    const uid = roster.members[slot];
    if (uid) {
      const u = Army.army.units[uid];
      const img = el('img'); img.src = unitImg(u);
      cell.appendChild(img);
      cell.appendChild(el('span', 'au-lv', `Lv.${u.level}`));
      if (roster.leader === uid) cell.appendChild(el('span', 'au-crown', '★'));
      attachCard(cell, u, selSquad);   // 悬停属性卡 (有效值)
    }
    cell.onclick = () => clickCell(slot);
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);

  // 中: 操作按钮
  const ops = el('div', 'au-ops');
  const size = Object.keys(roster.members).length;
  const cap = Army.capacityOf(selSquad, db);
  ops.appendChild(el('div', 'au-hint', `容量 ${size}/${cap} (2+队长统率)`));
  const btnLeader = el('div', 'au-btn' + (selSlot != null && roster.members[selSlot] ? '' : ' disabled'), '设为队长');
  btnLeader.onclick = () => {
    const uid = selSlot != null && roster.members[selSlot];
    if (!uid) return;
    roster.leader = uid;
    Army.saveArmy();
    renderFormation();
  };
  ops.appendChild(btnLeader);
  const btnRemove = el('div', 'au-btn' + (selSlot != null && roster.members[selSlot] && size > 1 ? '' : ' disabled'), '移回后备');
  btnRemove.onclick = () => {
    const uid = selSlot != null && roster.members[selSlot];
    if (!uid || size <= 1) return;
    delete roster.members[selSlot];
    if (roster.leader === uid) roster.leader = Object.values(roster.members)[0];
    selSlot = null;
    Army.saveArmy();
    renderFormation();
  };
  ops.appendChild(btnRemove);
  ops.appendChild(el('div', 'au-hint', '点后备单位再点空格=上阵; 点阵中人再点其他格=移动/交换'));
  wrap.appendChild(ops);

  // 右: 后备池
  const pool = el('div', 'au-pool');
  pool.appendChild(el('div', 'au-hint', `后备 (${Army.poolUnits().length})`));
  const pgrid = el('div', 'au-pool-grid');
  for (const u of Army.poolUnits()) {
    const c = el('div', 'au-cell sm' + (selPool === u.uid ? ' sel' : ''));
    const img = el('img'); img.src = unitImg(u);
    c.appendChild(img);
    c.appendChild(el('span', 'au-lv', `${unitName(u)} Lv.${u.level}`));
    c.onclick = () => { selPool = selPool === u.uid ? null : u.uid; selSlot = null; renderFormation(); };
    attachCard(c, u, null);   // 悬停属性卡 (基础+成长)
    pgrid.appendChild(c);
  }
  pool.appendChild(pgrid);
  wrap.appendChild(pool);
  body.appendChild(wrap);
}

function clickCell(slot) {
  const roster = Army.rosterOf(selSquad);
  const uid = roster.members[slot];
  if (selPool) {
    // 后备 -> 上阵 (空格) 或交换 (占格)
    if (!uid && Object.keys(roster.members).length >= Army.capacityOf(selSquad, db)) return;
    if (uid) {   // 交换: 阵中人回池
      roster.members[slot] = selPool;
      if (roster.leader === uid) roster.leader = selPool;
    } else {
      roster.members[slot] = selPool;
    }
    selPool = null;
    sfx('equip');
    Army.saveArmy();
    renderFormation();
    return;
  }
  if (selSlot == null) {
    if (uid) selSlot = slot;
  } else if (selSlot === slot) {
    selSlot = null;
  } else {
    // 移动/交换
    const a = roster.members[selSlot];
    if (uid) roster.members[selSlot] = uid;
    else delete roster.members[selSlot];
    roster.members[slot] = a;
    selSlot = null;
    sfx('equip');
    Army.saveArmy();
  }
  renderFormation();
}

// ---------------------------------------------------------------- 转职
function renderPromote() {
  const body = $('au-body');
  body.innerHTML = '';
  const t2 = Army.isT2Unlocked(techDb);
  body.appendChild(el('div', 'au-hint',
    t2 ? 'T1 职业 10 级可晋升为上级职业 (属性取两者较高)' : '需要先研究科技「晋升仪式」解锁二转'));
  const list = el('div', 'au-list');
  for (const ref of SQUAD_REFS) {
    const roster = Army.rosterOf(ref);
    for (const [slot, uid] of Object.entries(roster.members)) {
      const u = Army.army.units[uid];
      const def = db.unitsById[u.classId];
      const row = el('div', 'au-row');
      const img = el('img'); img.src = unitImg(u);
      row.appendChild(img);
      row.appendChild(el('span', 'au-row-name', `${def.name} Lv.${u.level}`));
      row.appendChild(el('span', 'au-row-sub', db.squadsById[ref].name));
      const target = def.promotesTo ? db.unitsById[def.promotesTo] : null;
      row.appendChild(el('span', 'au-row-sub', target ? `→ ${target.name}` : '（无上级职业）'));
      const can = target && u.level >= 10 && t2;
      const btn = el('span', 'au-btn' + (can ? '' : ' disabled'),
        target ? (u.level >= 10 ? '晋升' : `需 Lv.10`) : '—');
      if (can) {
        btn.onclick = () => {
          // 属性取 max(当前, 新职业 base): 折算为新职业下的 gains
          const nd = target;
          const ng = {};
          for (const k of ['hp', 'str', 'mag', 'skl', 'arm', 'ldr', 'mov']) {
            const cur = (def.base[k] || 0) + (u.gains[k] || 0);
            ng[k] = Math.max(0, cur - (nd.base[k] || 0));
          }
          u.gains = ng;
          u.classId = nd.id;
          // 武器类型不匹配新职业 -> 卸下回库存
          if (u.weapon && db.itemsById[u.weapon] && db.itemsById[u.weapon].weapon !== nd.weapon) {
            Army.unequipWeapon(u.uid);
          }
          sfx('levelup');
          Army.saveArmy();
          renderPromote();
        };
      }
      row.appendChild(btn);
      attachCard(row, u, ref);   // 悬停属性卡
      list.appendChild(row);
    }
  }
  body.appendChild(list);
}

// ---------------------------------------------------------------- 武器
// 每成员 1 件 weapon 类物品 (职业武器类型必须匹配); 库存 = weaponStock
let weaponPickerUid = null;
const weaponDesc = item => item ? `${item.name} 威${item.might} 命${item.hit} 射${item.range}` : '（职业默认武器）';

function renderWeapon() {
  const body = $('au-body');
  body.innerHTML = '';
  body.appendChild(el('div', 'au-hint', '点「更换」选库存武器; 类型必须匹配职业 (医护兵仅限治疗系)'));
  const list = el('div', 'au-list');
  for (const ref of SQUAD_REFS) {
    const roster = Army.rosterOf(ref);
    for (const [slot, uid] of Object.entries(roster.members)) {
      const u = Army.army.units[uid];
      const def = db.unitsById[u.classId];
      const row = el('div', 'au-row');
      const img = el('img'); img.src = unitImg(u);
      row.appendChild(img);
      row.appendChild(el('span', 'au-row-name', `${unitName(u)} Lv.${u.level}`));
      row.appendChild(el('span', 'au-row-sub', `${def.name} · ${WEAPON_LABEL[def.weapon] || def.weapon}系`));
      const cur = u.weapon ? db.itemsById[u.weapon] : null;
      row.appendChild(el('span', 'au-row-desc', weaponDesc(cur)));
      const btn = el('span', 'au-btn', weaponPickerUid === uid ? '收起' : '更换');
      btn.onclick = () => { weaponPickerUid = weaponPickerUid === uid ? null : uid; renderWeapon(); };
      row.appendChild(btn);
      list.appendChild(row);
      if (weaponPickerUid === uid) {
        const picker = el('div', 'au-row au-picker');
        const opts = Object.entries(Army.army.weaponStock)
          .filter(([id, n]) => n > 0 && db.itemsById[id] && db.itemsById[id].weapon === def.weapon);
        if (!opts.length) picker.appendChild(el('span', 'au-row-sub', '库存没有匹配武器 (去商店买)'));
        for (const [id, n] of opts) {
          const item = db.itemsById[id];
          const b = el('span', 'au-btn', `${weaponDesc(item)} ×${n}`);
          b.onclick = () => {
            if (Army.equipWeapon(uid, id, db)) {
              sfx('equip');
              weaponPickerUid = null;
              renderWeapon();
            }
          };
          picker.appendChild(b);
        }
        if (u.weapon) {
          const un = el('span', 'au-btn', '卸下');
          un.onclick = () => { Army.unequipWeapon(uid); sfx('equip'); weaponPickerUid = null; renderWeapon(); };
          picker.appendChild(un);
        }
        list.appendChild(picker);
      }
    }
  }
  body.appendChild(list);
}

// ---------------------------------------------------------------- 竞技场
let arenaResult = null;
function renderArena() {
  const body = $('au-body');
  body.innerHTML = '';
  body.appendChild(el('div', 'au-hint',
    `金币: ${Army.army.gold} · 报名费 200 金 · 3 波连战, 每胜一场 +300 金 +30 经验, 全胜 +1 科技点 · 不致命 (留 1 HP)`));
  const row = el('div', 'au-squads');
  for (const ref of SQUAD_REFS) {
    const b = el('span', 'au-sqbtn' + (ref === selSquad ? ' sel' : ''), db.squadsById[ref].name);
    b.onclick = () => { selSquad = ref; renderArena(); };
    row.appendChild(b);
  }
  body.appendChild(row);
  const can = Army.army.gold >= 200 && onArenaCb;
  const btn = el('div', 'au-btn' + (can ? '' : ' disabled'), `挑战 (${db.squadsById[selSquad].name})`);
  if (can) {
    btn.onclick = async () => {
      arenaResult = await onArenaCb(selSquad);
      $('army-ui').style.display = 'flex';   // runArena 期间整备层被战斗画面临时隐藏
      renderArena();
    };
  }
  body.appendChild(btn);
  if (arenaResult) {
    body.appendChild(el('div', 'au-hint',
      `上场战绩: 胜 ${arenaResult.wins}/3 场, 得金 ${arenaResult.gold}${arenaResult.wins === 3 ? ' +1 科技点' : ''}`));
  }
}

// ---------------------------------------------------------------- 神器
function renderArtifact() {
  const body = $('au-body');
  body.innerHTML = '';
  body.appendChild(el('div', 'au-hint', '每支部队最多装备 2 件神器; 点库存装备到有空位的部队, 点已装备卸下'));
  const list = el('div', 'au-list');
  for (const ref of SQUAD_REFS) {
    const roster = Army.rosterOf(ref);
    const row = el('div', 'au-row');
    row.appendChild(el('span', 'au-row-name', db.squadsById[ref].name));
    for (let i = 0; i < 2; i++) {
      const aid = roster.artifacts[i];
      const slot = el('span', 'au-art-slot' + (aid ? '' : ' empty'), aid ? db.itemsById[aid].name : '（空）');
      if (aid) {
        slot.title = JSON.stringify(db.itemsById[aid].bonuses || {});
        slot.onclick = () => {
          roster.artifacts.splice(i, 1);
          Army.saveArmy();
          renderArtifact();
        };
      }
      row.appendChild(slot);
    }
    list.appendChild(row);
  }
  list.appendChild(el('div', 'au-hint', '—— 库存 ——'));
  for (const aid of Army.army.inventory) {
    const item = db.itemsById[aid];
    if (!item) continue;
    const equippedBy = SQUAD_REFS.find(ref => Army.rosterOf(ref).artifacts.includes(aid));
    const row = el('div', 'au-row');
    row.appendChild(el('span', 'au-row-name', item.name));
    row.appendChild(el('span', 'au-row-sub',
      Object.entries(item.bonuses || {}).map(([k, v]) => `${k}+${v}`).join(' ')));
    row.appendChild(el('span', 'au-row-sub', equippedBy ? `已装备: ${db.squadsById[equippedBy].name}` : '未装备'));
    if (!equippedBy) {
      const btn = el('span', 'au-btn', '装备');
      btn.onclick = () => {
        const target = SQUAD_REFS.find(ref => Army.rosterOf(ref).artifacts.length < 2);
        if (!target) return;
        Army.rosterOf(target).artifacts.push(aid);
        sfx('equip');
        Army.saveArmy();
        renderArtifact();
      };
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
  body.appendChild(list);
}

// ---------------------------------------------------------------- 招募
// T1 (初始+科技解锁) 500 金; T2 (研究晋升仪式后) 1500 金 -> Lv.5 进后备池
function renderRecruit() {
  const body = $('au-body');
  body.innerHTML = '';
  body.appendChild(el('div', 'au-hint', `金币: ${Army.army.gold} · 雇佣进后备池 (Lv.5)`));
  const list = el('div', 'au-list');

  // 传说随从 (橙色名, Lv.8, 2 rare + 1 common 特性, 胜利后刷新)
  const legend = Army.legendaryCandidate();
  const lrow = el('div', 'au-row au-legend-row');
  if (legend) {
    const ldef = db.unitsById[legend.classId];
    const img = el('img'); img.src = `assets/${ldef.sprite}.png`;
    lrow.appendChild(img);
    lrow.appendChild(el('span', 'au-row-name legend', legend.name));
    const traitChips = legend.traits.map(id => db.traitsById[id]).filter(Boolean)
      .map(t => t.name).join(' · ');
    lrow.appendChild(el('span', 'au-row-desc',
      `${ldef.name} Lv.${legend.level} · 特性: ${traitChips}`));
    const can = Army.army.gold >= legend.cost;
    const btn = el('span', 'au-btn' + (can ? '' : ' disabled'), `雇佣 (${legend.cost} 金)`);
    if (can) {
      btn.onclick = () => {
        if (Army.hireLegendary()) {
          sfx('gold');
          renderRecruit();
        }
      };
    }
    lrow.appendChild(btn);
    const pseudo = { classId: legend.classId, level: legend.level, gains: {}, traits: legend.traits, name: legend.name };
    attachCard(lrow, pseudo, null);   // 悬停看 3 条特性
  } else {
    lrow.appendChild(el('span', 'au-row-name legend', '传说随从'));
    lrow.appendChild(el('span', 'au-row-desc', '已加入 — 下一场胜利后出现新候选人'));
  }
  list.appendChild(lrow);

  const offers = [];
  for (const u of Object.values(db.unitsById)) {
    if (Army.isClassUnlocked(u.id, techDb)) offers.push({ def: u, cost: 500 });
  }
  if (Army.isT2Unlocked(techDb)) {
    const t2 = new Set(Object.values(db.unitsById).map(u => u.promotesTo).filter(Boolean));
    for (const id of t2) offers.push({ def: db.unitsById[id], cost: 1500 });
  }
  for (const { def, cost } of offers) {
    const row = el('div', 'au-row');
    const img = el('img'); img.src = `assets/${def.sprite}.png`;
    row.appendChild(img);
    row.appendChild(el('span', 'au-row-name', `${def.name} T${def.tier || 1}`));
    // inline 基础属性 (让人看清楚再买)
    const mid = el('span', 'au-row-desc');
    const skills = (def.skills || []).map(id => db.skillsById[id]).filter(Boolean).map(s => s.name).join('/');
    mid.innerHTML =
      `HP${def.base.hp} 力${def.base.str} 魔${def.base.mag} 技${def.base.skl} 防${def.base.arm} 统率${def.base.ldr} 移动${def.base.mov}` +
      ` · ${WEAPON_LABEL[def.weapon] || def.weapon} · ${ATK_TYPE_LABEL[def.attackType] || def.attackType}` +
      (skills ? ` · ${skills}` : '') +
      `<br><span class="au-growth">成长 ${Object.entries(def.growth || {}).filter(([, v]) => v > 0)
        .map(([k, v]) => `${STAT_LABEL[k]}${v}%`).join(' ')}</span>`;
    row.appendChild(mid);
    const can = Army.army.gold >= cost;
    const btn = el('span', 'au-btn' + (can ? '' : ' disabled'), `雇佣 (${cost} 金)`);
    if (can) {
      btn.onclick = () => {
        if (Army.hireUnit(def.id, cost)) {
          sfx('gold');
          renderRecruit();
        }
      };
    }
    row.appendChild(btn);
    list.appendChild(row);
  }
  body.appendChild(list);
}

// ---------------------------------------------------------------- 商店
// items.json 里 price>0 的神器 (武器暂不进商店, 避免装备链改动)
function renderShop() {
  const body = $('au-body');
  body.innerHTML = '';
  body.appendChild(el('div', 'au-hint', `金币: ${Army.army.gold} · 购买进神器/武器库存`));
  const list = el('div', 'au-list');
  for (const item of db.itemList.filter(i => i.type === 'weapon' && i.price > 0)) {
    const row = el('div', 'au-row');
    row.appendChild(el('span', 'au-row-name', item.name));
    row.appendChild(el('span', 'au-row-sub',
      `${WEAPON_LABEL[item.weapon] || item.weapon}系 威${item.might} 命${item.hit} 射${item.range} · 库存 ${Army.army.weaponStock[item.id] || 0}`));
    row.appendChild(el('span', 'au-row-desc', item.description || ''));
    const can = Army.army.gold >= item.price;
    const btn = el('span', 'au-btn' + (can ? '' : ' disabled'), `购买 (${item.price} 金)`);
    if (can) {
      btn.onclick = () => {
        if (Army.buyWeapon(item.id, item.price)) {
          sfx('gold');
          renderShop();
        }
      };
    }
    row.appendChild(btn);
    list.appendChild(row);
  }
  list.appendChild(el('div', 'au-hint', '—— 神器 ——'));
  for (const item of db.itemList.filter(i => i.type === 'artifact' && i.price > 0)) {
    const row = el('div', 'au-row');
    row.appendChild(el('span', 'au-row-name', item.name));
    row.appendChild(el('span', 'au-row-sub',
      Object.entries(item.bonuses || {}).map(([k, v]) => `${k}+${v}`).join(' ')));
    row.appendChild(el('span', 'au-row-desc', item.description || ''));
    const can = Army.army.gold >= item.price;
    const btn = el('span', 'au-btn' + (can ? '' : ' disabled'), `购买 (${item.price} 金)`);
    if (can) {
      btn.onclick = () => {
        if (Army.buyArtifact(item.id, item.price)) {
          sfx('gold');
          renderShop();
        }
      };
    }
    row.appendChild(btn);
    list.appendChild(row);
  }
  body.appendChild(list);
}

// ---------------------------------------------------------------- 科技树
function renderTech() {
  const body = $('au-body');
  body.innerHTML = '';
  body.appendChild(el('div', 'au-hint', `科技点: ${Army.army.techPoints} (战斗胜利 +5, 击杀 +1)`));
  const list = el('div', 'au-list');
  for (const t of techDb) {
    const done = Army.army.tech.includes(t.id);
    const reqMet = (t.requires || []).every(r => Army.army.tech.includes(r));
    const afford = Army.army.techPoints >= t.cost;
    const row = el('div', 'au-row' + (done ? ' done' : ''));
    const img = el('img', 'au-tech-icon');
    img.src = `assets/${t.icon}.png`;
    img.onerror = () => { img.style.visibility = 'hidden'; };
    row.appendChild(img);
    row.appendChild(el('span', 'au-row-name', t.name));
    const reqNames = (t.requires || []).map(r => (techDb.find(n => n.id === r) || {}).name || r).join('、');
    row.appendChild(el('span', 'au-row-sub', reqNames ? `前置: ${reqNames}` : '无前置'));
    row.appendChild(el('span', 'au-row-desc', t.description));
    const btn = el('span', 'au-btn' + (!done && reqMet && afford ? '' : ' disabled'),
      done ? '已研究' : `研究 (${t.cost})`);
    if (!done && reqMet && afford) {
      btn.onclick = () => {
        if (Army.research(t.id, techDb)) {
          sfx('confirm');
          if (onTechChange) onTechChange();
          renderTech();
        }
      };
    }
    row.appendChild(btn);
    list.appendChild(row);
  }
  body.appendChild(list);
}
