// 单位编辑器: 左侧可搜索列表 + 右侧全字段表单
import {
  h, DB, SPRITES, PORTRAITS, WEAPON_TYPES, STATS,
  saveJSON, downloadJSON, toast, imgSelect, assetImg,
} from './common.js';

const ATTACK_TYPES = ['frontline', 'any', 'heal', 'aoe'];
const BASE_KEYS = ['hp', 'str', 'mag', 'skl', 'arm', 'ldr', 'mov'];
const GROWTH_KEYS = ['hp', 'str', 'mag', 'skl', 'arm', 'ldr'];

export function initUnitEditor(root) {
  let cur = null; // 当前编辑的单位对象(直接引用 DB)
  let filter = '';

  const search = h('input', { type: 'text', placeholder: '搜索 id / 名称…', style: 'width:100%' });
  search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); renderList(); });

  const listEl = h('div', { class: 'item-list' });
  const formEl = h('div', { class: 'panel fe-panel', style: 'flex:1' });

  const btnNew = h('button', { class: 'btn', onclick: addUnit }, '新增');
  const btnDup = h('button', { class: 'btn', onclick: dupUnit }, '复制');
  const btnDel = h('button', { class: 'btn danger', onclick: delUnit }, '删除');
  const btnSave = h('button', { class: 'btn gold', onclick: () => saveJSON('data/units.json', DB.units) }, '保存到服务器');
  const btnDl = h('button', { class: 'btn', onclick: () => downloadJSON('units.json', DB.units) }, '下载 JSON');

  root.append(
    h('div', { class: 'col', style: 'width:260px;flex:none' },
      h('div', { class: 'panel fe-panel col', style: 'flex:1' },
        h('h3', {}, '单位列表'), search, listEl)),
    h('div', { class: 'col', style: 'flex:1' },
      h('div', { class: 'btn-row' }, btnNew, btnDup, btnDel, btnSave, btnDl),
      formEl),
  );

  function renderList() {
    listEl.innerHTML = '';
    for (const u of DB.units.units) {
      if (filter && !u.id.toLowerCase().includes(filter) && !u.name.toLowerCase().includes(filter)) continue;
      const row = h('div', { class: 'row' + (u === cur ? ' sel' : '') },
        assetImg(u.sprite), h('span', {}, u.name), h('span', { class: 'fe-dim' }, u.id));
      row.addEventListener('click', () => { cur = u; renderList(); renderForm(); });
      listEl.append(row);
    }
  }

  function numInput(val, onch) {
    const inp = h('input', { type: 'number', value: val });
    inp.addEventListener('change', () => onch(parseInt(inp.value || '0', 10) || 0));
    return inp;
  }

  function renderForm() {
    formEl.innerHTML = '';
    if (!cur) { formEl.append(h('h3', {}, '单位属性'), h('p', { class: 'fe-dim' }, '从左侧选择一个单位, 或点击「新增」。')); return; }
    const u = cur;

    formEl.append(h('h3', {}, `单位属性 — ${u.name}`));
    const grid = h('div', { class: 'form-grid' });

    // id / name / tier
    const idInp = h('input', { type: 'text', value: u.id });
    idInp.addEventListener('change', () => {
      const nid = idInp.value.trim();
      if (!nid) { toast('id 不能为空', false); idInp.value = u.id; return; }
      if (DB.units.units.some(x => x !== u && x.id === nid)) { toast('id 已存在', false); idInp.value = u.id; return; }
      u.id = nid; renderList();
    });
    const nameInp = h('input', { type: 'text', value: u.name });
    nameInp.addEventListener('change', () => { u.name = nameInp.value; renderList(); renderForm(); });
    const tierInp = numInput(u.tier, v => u.tier = v);

    grid.append(h('label', {}, 'ID'), idInp, h('label', {}, '名称'), nameInp, h('label', {}, '阶职'), tierInp);

    // sprite / portrait 带预览
    const sp = imgSelect(SPRITES, u.sprite);
    sp.sel.addEventListener('change', () => { u.sprite = sp.sel.value; renderList(); });
    const pf = imgSelect(PORTRAITS, u.portrait, 'preview-img big');
    pf.sel.addEventListener('change', () => u.portrait = pf.sel.value);
    grid.append(h('label', {}, 'Sprite'), h('div', { style: 'display:flex;gap:8px;align-items:center' }, sp.img, sp.sel));
    grid.append(h('label', {}, '头像'), h('div', { style: 'display:flex;gap:8px;align-items:center' }, pf.img, pf.sel));

    // weapon / attackType / attacks / promotesTo
    const wSel = h('select', {}, WEAPON_TYPES.map(w => h('option', { value: w }, w)));
    wSel.value = u.weapon;
    wSel.addEventListener('change', () => u.weapon = wSel.value);
    const atSel = h('select', {}, ATTACK_TYPES.map(a => h('option', { value: a }, a)));
    atSel.value = u.attackType;
    atSel.addEventListener('change', () => u.attackType = atSel.value);
    const atkInp = numInput(u.attacks, v => u.attacks = v);
    const prSel = h('select', {},
      h('option', { value: '' }, '(无)'),
      DB.units.units.filter(x => x !== u).map(x => h('option', { value: x.id }, `${x.name} (${x.id})`)));
    prSel.value = u.promotesTo || '';
    prSel.addEventListener('change', () => u.promotesTo = prSel.value);
    grid.append(
      h('label', {}, '武器类型'), wSel,
      h('label', {}, '攻击方式'), atSel,
      h('label', {}, '出手次数'), atkInp,
      h('label', {}, '晋升'), prSel);

    formEl.append(grid);

    // base / growth
    const mkStats = (obj, keys, title) => h('div', {},
      h('h3', { style: 'margin-top:10px' }, title),
      h('div', { class: 'stat-row' }, keys.map(k =>
        h('div', { class: 'stat-box' }, h('span', {}, k.toUpperCase()),
          numInput(obj[k] ?? 0, v => obj[k] = v)))));
    formEl.append(mkStats(u.base, BASE_KEYS, '基础值 base'), mkStats(u.growth, GROWTH_KEYS, '成长率 growth (%)'));

    // skills 多选
    const skBox = h('div', { class: 'check-list' });
    for (const s of DB.skills.skills) {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = u.skills.includes(s.id);
      cb.addEventListener('change', () => {
        if (cb.checked) { if (!u.skills.includes(s.id)) u.skills.push(s.id); }
        else u.skills = u.skills.filter(x => x !== s.id);
      });
      skBox.append(h('label', {}, cb, assetImg(s.icon), `${s.name} (${s.id})`));
    }
    formEl.append(h('h3', { style: 'margin-top:10px' }, '技能 skills'), skBox);
  }

  function addUnit() {
    let id = 'new_unit';
    let n = 1;
    while (DB.units.units.some(u => u.id === id)) id = `new_unit_${++n}`;
    const u = {
      id, name: '新单位', tier: 1, sprite: SPRITES[0], portrait: PORTRAITS[0], weapon: 'sword',
      base: { hp: 20, str: 5, mag: 0, skl: 5, arm: 2, ldr: 0, mov: 5 },
      growth: { hp: 50, str: 30, mag: 0, skl: 30, arm: 20, ldr: 0 },
      attackType: 'frontline', attacks: 1, skills: [], promotesTo: '',
    };
    DB.units.units.push(u);
    cur = u; renderList(); renderForm();
    toast(`已新增单位 ${id}`);
  }

  function dupUnit() {
    if (!cur) { toast('请先选择单位', false); return; }
    let id = cur.id + '_copy';
    let n = 1;
    while (DB.units.units.some(u => u.id === id)) id = `${cur.id}_copy${++n}`;
    const u = JSON.parse(JSON.stringify(cur));
    u.id = id; u.name = cur.name + '·副本';
    DB.units.units.push(u);
    cur = u; renderList(); renderForm();
    toast(`已复制为 ${id}`);
  }

  function delUnit() {
    if (!cur) { toast('请先选择单位', false); return; }
    if (!confirm(`确定删除单位「${cur.name} (${cur.id})」?`)) return;
    DB.units.units = DB.units.units.filter(u => u !== cur);
    cur = null; renderList(); renderForm();
    toast('已删除(记得保存)');
  }

  cur = DB.units.units[0] || null;
  renderList();
  renderForm();
}
