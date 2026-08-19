// 部队编辑器: 左侧部队列表 / 中间 3x3 阵型 / 右侧单位列表(点击或拖放)
import {
  h, DB, unitById, weaponItems, artifactItems,
  saveJSON, downloadJSON, toast, assetImg,
} from './common.js';

export function initSquadEditor(root) {
  let cur = null;       // 当前部队(引用 DB)
  let armed = null;     // 点击单位列表后"拿起"的单位 id
  let filter = '';

  const search = h('input', { type: 'text', placeholder: '搜索部队…', style: 'width:100%' });
  search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); renderList(); });

  const listEl = h('div', { class: 'item-list' });
  const midEl = h('div', { class: 'panel fe-panel col', style: 'flex:1' });
  const palEl = h('div', { class: 'item-list' });
  const armedHint = h('div', { class: 'fe-dim', style: 'font-size:12px;padding:4px 0' }, '点击单位后点击阵型格放置; 也可直接拖放。');

  const btnNew = h('button', { class: 'btn', onclick: addSquad }, '新增');
  const btnDup = h('button', { class: 'btn', onclick: dupSquad }, '复制');
  const btnDel = h('button', { class: 'btn danger', onclick: delSquad }, '删除');
  const btnSave = h('button', { class: 'btn gold', onclick: () => saveJSON('data/squads.json', DB.squads) }, '保存到服务器');
  const btnDl = h('button', { class: 'btn', onclick: () => downloadJSON('squads.json', DB.squads) }, '下载 JSON');

  root.append(
    h('div', { class: 'col', style: 'width:230px;flex:none' },
      h('div', { class: 'panel fe-panel col', style: 'flex:1' },
        h('h3', {}, '部队列表'), search, listEl)),
    h('div', { class: 'col', style: 'flex:1' },
      h('div', { class: 'btn-row' }, btnNew, btnDup, btnDel, btnSave, btnDl),
      midEl),
    h('div', { class: 'col', style: 'width:230px;flex:none' },
      h('div', { class: 'panel fe-panel col', style: 'flex:1' },
        h('h3', {}, '单位列表'), armedHint, palEl)),
  );

  function memberAt(slot) { return cur ? cur.members.find(m => m.slot === slot) : null; }

  function renderList() {
    listEl.innerHTML = '';
    for (const sq of DB.squads.squads) {
      if (filter && !sq.id.toLowerCase().includes(filter) && !sq.name.toLowerCase().includes(filter)) continue;
      const lu = unitById(sq.leader);
      const row = h('div', { class: 'row' + (sq === cur ? ' sel' : '') },
        lu ? assetImg(lu.sprite) : null,
        h('span', {}, sq.name), h('span', { class: 'fe-dim' }, `${sq.id} (${sq.members.length}人)`));
      row.addEventListener('click', () => { cur = sq; armed = null; renderList(); renderMid(); });
      listEl.append(row);
    }
  }

  function renderPalette() {
    palEl.innerHTML = '';
    for (const u of DB.units.units) {
      const row = h('div', { class: 'row' + (armed === u.id ? ' sel' : ''), draggable: 'true' },
        assetImg(u.sprite), h('span', {}, u.name), h('span', { class: 'fe-dim' }, u.id));
      row.addEventListener('click', () => {
        armed = armed === u.id ? null : u.id;
        armedHint.textContent = armed ? `已拿起「${u.name}」— 点击阵型格放置` : '点击单位后点击阵型格放置; 也可直接拖放。';
        renderPalette();
      });
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/unit', u.id); });
      palEl.append(row);
    }
  }

  function renderMid() {
    midEl.innerHTML = '';
    if (!cur) { midEl.append(h('h3', {}, '部队编成'), h('p', { class: 'fe-dim' }, '从左侧选择一支部队, 或点击「新增」。')); return; }
    const sq = cur;

    // 基本信息
    const grid = h('div', { class: 'form-grid' });
    const idInp = h('input', { type: 'text', value: sq.id });
    idInp.addEventListener('change', () => {
      const nid = idInp.value.trim();
      if (!nid) { toast('id 不能为空', false); idInp.value = sq.id; return; }
      if (DB.squads.squads.some(x => x !== sq && x.id === nid)) { toast('id 已存在', false); idInp.value = sq.id; return; }
      sq.id = nid; renderList();
    });
    const nameInp = h('input', { type: 'text', value: sq.name });
    nameInp.addEventListener('change', () => { sq.name = nameInp.value; renderList(); renderMid(); });
    grid.append(h('label', {}, 'ID'), idInp, h('label', {}, '名称'), nameInp);

    // 队长(限阵内单位)
    const memberUnits = [...new Set(sq.members.map(m => m.unit))];
    const lSel = h('select', {},
      memberUnits.length
        ? memberUnits.map(id => {
            const u = unitById(id);
            return h('option', { value: id }, u ? `${u.name} (${id})` : id);
          })
        : h('option', { value: '' }, '(阵内无单位)'));
    lSel.value = memberUnits.includes(sq.leader) ? sq.leader : (memberUnits[0] || '');
    sq.leader = lSel.value;
    lSel.addEventListener('change', () => { sq.leader = lSel.value; renderList(); renderMid(); });
    grid.append(h('label', {}, '队长'), lSel);
    midEl.append(h('h3', {}, `部队编成 — ${sq.name}`), grid);

    // 3x3 阵型
    const form = h('div', { class: 'formation' });
    for (let slot = 0; slot < 9; slot++) {
      const m = memberAt(slot);
      const u = m ? unitById(m.unit) : null;
      const cell = h('div', { class: 'fcell' + (m ? ' filled' : '') + (m && m.unit === sq.leader ? ' leader-cell' : '') },
        h('span', { class: 'slot-no' }, slot),
        u ? assetImg(u.sprite) : null,
        u ? h('span', { class: 'uname' }, u.name) : h('span', { class: 'fe-dim' }, '空'));
      cell.title = m ? `点击移除 ${m.unit}` : (armed ? `点击放置 ${armed}` : '空格');
      cell.addEventListener('click', () => {
        if (armed) {
          if (m) m.unit = armed;
          else sq.members.push({ unit: armed, slot });
          if (!sq.members.some(x => x.unit === sq.leader)) sq.leader = armed;
        } else if (m) {
          sq.members = sq.members.filter(x => x !== m);
          if (!sq.members.some(x => x.unit === sq.leader)) sq.leader = sq.members[0]?.unit || '';
        }
        renderMid(); renderList();
      });
      cell.addEventListener('dragover', e => e.preventDefault());
      cell.addEventListener('drop', e => {
        e.preventDefault();
        const uid = e.dataTransfer.getData('text/unit');
        if (!uid || !unitById(uid)) return;
        if (m) m.unit = uid;
        else sq.members.push({ unit: uid, slot });
        if (!sq.members.some(x => x.unit === sq.leader)) sq.leader = uid;
        renderMid(); renderList();
      });
      form.append(cell);
    }
    midEl.append(h('h3', { style: 'margin-top:8px' }, '阵型 (0=左上, 4=中心, 8=右下)'), form);

    // 神器多选
    const artBox = h('div', { class: 'check-list' });
    for (const a of artifactItems()) {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = sq.artifacts.includes(a.id);
      cb.addEventListener('change', () => {
        if (cb.checked) { if (!sq.artifacts.includes(a.id)) sq.artifacts.push(a.id); }
        else sq.artifacts = sq.artifacts.filter(x => x !== a.id);
      });
      artBox.append(h('label', {}, cb, `${a.name} (${a.id})`));
    }
    midEl.append(h('h3', { style: 'margin-top:8px' }, '神器 artifacts'), artBox);

    // weapon_items 映射表
    const wTbl = h('table', { class: 'kv' });
    wTbl.append(h('tr', {}, h('th', {}, '单位'), h('th', {}, '武器物品')));
    const wopts = weaponItems();
    for (const uid of memberUnits) {
      const u = unitById(uid);
      const sel = h('select', {},
        h('option', { value: '' }, '(无)'),
        wopts.map(w => h('option', { value: w.id }, `${w.name} (${w.id})`)));
      sel.value = sq.weapon_items[uid] || '';
      sel.addEventListener('change', () => {
        if (sel.value) sq.weapon_items[uid] = sel.value;
        else delete sq.weapon_items[uid];
      });
      wTbl.append(h('tr', {}, h('td', {}, u ? `${u.name} (${uid})` : uid), h('td', {}, sel)));
    }
    midEl.append(h('h3', { style: 'margin-top:8px' }, '武器配置 weapon_items'), wTbl);
  }

  function addSquad() {
    let id = 'new_squad';
    let n = 1;
    while (DB.squads.squads.some(s => s.id === id)) id = `new_squad_${++n}`;
    const first = DB.units.units[0]?.id || '';
    const sq = { id, name: '新部队', leader: first, members: [{ unit: first, slot: 4 }], artifacts: [], weapon_items: {} };
    DB.squads.squads.push(sq);
    cur = sq; armed = null; renderList(); renderMid();
    toast(`已新增部队 ${id}`);
  }

  function dupSquad() {
    if (!cur) { toast('请先选择部队', false); return; }
    let id = cur.id + '_copy';
    let n = 1;
    while (DB.squads.squads.some(s => s.id === id)) id = `${cur.id}_copy${++n}`;
    const sq = JSON.parse(JSON.stringify(cur));
    sq.id = id; sq.name = cur.name + '·副本';
    DB.squads.squads.push(sq);
    cur = sq; renderList(); renderMid();
    toast(`已复制为 ${id}`);
  }

  function delSquad() {
    if (!cur) { toast('请先选择部队', false); return; }
    if (!confirm(`确定删除部队「${cur.name} (${cur.id})」?`)) return;
    DB.squads.squads = DB.squads.squads.filter(s => s !== cur);
    cur = null; renderList(); renderMid();
    toast('已删除(记得保存)');
  }

  cur = DB.squads.squads[0] || null;
  renderList();
  renderPalette();
  renderMid();
}

