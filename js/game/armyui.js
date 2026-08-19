// armyui.js — 整备界面: 编队 / 转职 / 神器 / 科技树 (SPEC「养成系统」)
// 操作 army.js 的战役状态, 每次变更即持久化; UI 沿用 .fe-panel 风。
import * as Army from './army.js';

const $ = id => document.getElementById(id);

let db = null, techDb = null;
let onTechChange = null, onCloseCb = null;
let selSquad = 'zelos_guard';
let selPool = null;    // 后备池选中的 uid
let selSlot = null;    // 阵型中选中的格子

const SQUAD_REFS = ['zelos_guard', 'diana_squad', 'knight_wall'];
const unitImg = u => `assets/${db.unitsById[u.classId].sprite}.png`;
const unitName = u => db.unitsById[u.classId].name;

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
  await ensureTechDb();
  Army.loadArmy(db);
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
  else if (name === 'artifact') renderArtifact();
  else if (name === 'tech') renderTech();
}

const el = (tag, cls, text) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
};

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
          Army.saveArmy();
          renderPromote();
        };
      }
      row.appendChild(btn);
      list.appendChild(row);
    }
  }
  body.appendChild(list);
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
        Army.saveArmy();
        renderArtifact();
      };
      row.appendChild(btn);
    }
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
