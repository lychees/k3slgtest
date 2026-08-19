// 技能编辑器: 列表 + 表单
import {
  h, DB, ICONS, STATS,
  saveJSON, downloadJSON, toast, imgSelect, assetImg,
} from './common.js';

const TYPES = ['passive', 'aura', 'combat'];
const TARGETS = ['self', 'squad', 'allies_adjacent'];
const FLAGS = ['', 'vanguard', 'doubles', 'healer'];

export function initSkillEditor(root) {
  let cur = null;
  let filter = '';

  const search = h('input', { type: 'text', placeholder: '搜索 id / 名称…', style: 'width:100%' });
  search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); renderList(); });

  const listEl = h('div', { class: 'item-list' });
  const formEl = h('div', { class: 'panel fe-panel', style: 'flex:1' });

  const btnNew = h('button', { class: 'btn', onclick: addSkill }, '新增');
  const btnDup = h('button', { class: 'btn', onclick: dupSkill }, '复制');
  const btnDel = h('button', { class: 'btn danger', onclick: delSkill }, '删除');
  const btnSave = h('button', { class: 'btn gold', onclick: () => saveJSON('data/skills.json', DB.skills) }, '保存到服务器');
  const btnDl = h('button', { class: 'btn', onclick: () => downloadJSON('skills.json', DB.skills) }, '下载 JSON');

  root.append(
    h('div', { class: 'col', style: 'width:260px;flex:none' },
      h('div', { class: 'panel fe-panel col', style: 'flex:1' },
        h('h3', {}, '技能列表'), search, listEl)),
    h('div', { class: 'col', style: 'flex:1' },
      h('div', { class: 'btn-row' }, btnNew, btnDup, btnDel, btnSave, btnDl),
      formEl),
  );

  function renderList() {
    listEl.innerHTML = '';
    for (const s of DB.skills.skills) {
      if (filter && !s.id.toLowerCase().includes(filter) && !s.name.toLowerCase().includes(filter)) continue;
      const row = h('div', { class: 'row' + (s === cur ? ' sel' : '') },
        assetImg(s.icon), h('span', {}, s.name), h('span', { class: 'fe-dim' }, s.id));
      row.addEventListener('click', () => { cur = s; renderList(); renderForm(); });
      listEl.append(row);
    }
  }

  function mkSelect(options, value, onch, labelFn = v => v) {
    const sel = h('select', {}, options.map(o => h('option', { value: o }, labelFn(o) || '(无)')));
    sel.value = value;
    sel.addEventListener('change', () => onch(sel.value));
    return sel;
  }

  function renderForm() {
    formEl.innerHTML = '';
    if (!cur) { formEl.append(h('h3', {}, '技能属性'), h('p', { class: 'fe-dim' }, '从左侧选择一个技能, 或点击「新增」。')); return; }
    const s = cur;

    formEl.append(h('h3', {}, `技能属性 — ${s.name}`));
    const grid = h('div', { class: 'form-grid' });

    const idInp = h('input', { type: 'text', value: s.id });
    idInp.addEventListener('change', () => {
      const nid = idInp.value.trim();
      if (!nid) { toast('id 不能为空', false); idInp.value = s.id; return; }
      if (DB.skills.skills.some(x => x !== s && x.id === nid)) { toast('id 已存在', false); idInp.value = s.id; return; }
      s.id = nid; renderList();
    });
    const nameInp = h('input', { type: 'text', value: s.name });
    nameInp.addEventListener('change', () => { s.name = nameInp.value; renderList(); renderForm(); });

    const ic = imgSelect(ICONS, s.icon);
    ic.sel.addEventListener('change', () => { s.icon = ic.sel.value; renderList(); });

    grid.append(
      h('label', {}, 'ID'), idInp,
      h('label', {}, '名称'), nameInp,
      h('label', {}, '图标'), h('div', { style: 'display:flex;gap:8px;align-items:center' }, ic.img, ic.sel),
      h('label', {}, '类型 type'), mkSelect(TYPES, s.type, v => s.type = v),
      h('label', {}, '目标 target'), mkSelect(TARGETS, s.target, v => s.target = v),
      h('label', {}, 'Flag'), mkSelect(FLAGS, s.flag || '', v => s.flag = v),
      h('label', {}, '效果属性'), mkSelect(['', ...STATS], s.effect.stat || '', v => s.effect.stat = v),
      h('label', {}, '效果数值'), (() => {
        const inp = h('input', { type: 'number', value: s.effect.mod });
        inp.addEventListener('change', () => s.effect.mod = parseInt(inp.value || '0', 10) || 0);
        return inp;
      })(),
    );
    formEl.append(grid);

    formEl.append(h('h3', { style: 'margin-top:10px' }, '描述'));
    const desc = h('textarea', {}, s.description);
    desc.addEventListener('change', () => s.description = desc.value);
    formEl.append(desc);
  }

  function addSkill() {
    let id = 'new_skill';
    let n = 1;
    while (DB.skills.skills.some(s => s.id === id)) id = `new_skill_${++n}`;
    const s = { id, name: '新技能', icon: ICONS[0], type: 'passive', target: 'self', effect: { stat: '', mod: 0 }, flag: '', description: '' };
    DB.skills.skills.push(s);
    cur = s; renderList(); renderForm();
    toast(`已新增技能 ${id}`);
  }

  function dupSkill() {
    if (!cur) { toast('请先选择技能', false); return; }
    let id = cur.id + '_copy';
    let n = 1;
    while (DB.skills.skills.some(s => s.id === id)) id = `${cur.id}_copy${++n}`;
    const s = JSON.parse(JSON.stringify(cur));
    s.id = id; s.name = cur.name + '·副本';
    DB.skills.skills.push(s);
    cur = s; renderList(); renderForm();
    toast(`已复制为 ${id}`);
  }

  function delSkill() {
    if (!cur) { toast('请先选择技能', false); return; }
    if (!confirm(`确定删除技能「${cur.name} (${cur.id})」?`)) return;
    DB.skills.skills = DB.skills.skills.filter(s => s !== cur);
    cur = null; renderList(); renderForm();
    toast('已删除(记得保存)');
  }

  cur = DB.skills.skills[0] || null;
  renderList();
  renderForm();
}
