// 入口: 加载数据, 初始化五个编辑器, tab/hash 路由
import { loadAll, toast } from './common.js';
import { initMapEditor } from './mapEditor.js';
import { initSquadEditor } from './squadEditor.js';
import { initUnitEditor } from './unitEditor.js';
import { initSkillEditor } from './skillEditor.js';
import { initItemEditor } from './itemEditor.js';

const TABS = ['map', 'squad', 'unit', 'skill', 'item'];

function activate(tab) {
  if (!TABS.includes(tab)) tab = 'map';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
}

async function boot() {
  try {
    await loadAll();
  } catch (e) {
    toast(e.message, false);
    return;
  }
  initMapEditor(document.getElementById('page-map'));
  initSquadEditor(document.getElementById('page-squad'));
  initUnitEditor(document.getElementById('page-unit'));
  initSkillEditor(document.getElementById('page-skill'));
  initItemEditor(document.getElementById('page-item'));

  document.querySelectorAll('.tab-btn').forEach(b =>
    b.addEventListener('click', () => activate(b.dataset.tab)));
  window.addEventListener('hashchange', () => activate(location.hash.slice(1)));
  activate(location.hash.slice(1) || 'map');
}

boot();

