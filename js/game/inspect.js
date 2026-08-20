// inspect.js — 部队详情查看 (C 键/Tab): 敌我均可查看 (FE 传统)
// 有效属性走 squad.eff() (含科技/神器/技能加成), 超过 基础+成长 的数值金色标 ↑。
import * as Army from './army.js';

const $ = id => document.getElementById(id);
let open_ = false;

export function isOpen() { return open_; }

// 覆盖层输入隔离: 点空白关闭, 鼠标事件不穿透到舞台
{
  const ov = $('inspect-ui');
  for (const t of ['mousemove', 'wheel', 'contextmenu']) ov.addEventListener(t, e => e.stopPropagation());
  ov.addEventListener('click', e => {
    e.stopPropagation();
    if (e.target === ov) close();
  });
}

const STATS = [['str', '力'], ['mag', '魔'], ['skl', '技'], ['arm', '防']];

export function open(squad, db) {
  if (open_) return;
  open_ = true;
  const overlay = $('inspect-ui');
  render(squad, db);
  overlay.style.display = 'flex';
  window.addEventListener('keydown', onKey, true);
}

export function close() {
  if (!open_) return;
  open_ = false;
  $('inspect-ui').style.display = 'none';
  window.removeEventListener('keydown', onKey, true);
}

function onKey(e) {
  e.stopPropagation();
  if (['Escape', 'x', 'X', 'c', 'C', 'Tab'].includes(e.key)) {
    e.preventDefault();
    close();
  }
}

function statCell(squad, m, key, label) {
  const base = (m.def.base[key] || 0) + (m.gains[key] || 0);
  const v = squad.eff(m, key);
  return `<span class="in-stat${v > base ? ' up' : ''}">${label}${v}${v > base ? '↑' : ''}</span>`;
}

function render(squad, db) {
  const p = $('in-panel');
  const isPlayer = squad.team === 0;
  const isBoss = squad.isBoss;
  const hp = squad.totalHp(), max = squad.totalMaxHp();

  // 头部
  let capTxt = `${squad.members.length}`;
  if (isPlayer && Army.army && Army.rosterOf(squad.template.id)) {
    capTxt = `${squad.members.length}/${Army.capacityOf(squad.template.id, db)}`;
  }
  let h = `<div class="in-head">
    <span class="in-name">${squad.name}</span>
    <span class="in-team${isPlayer ? '' : ' enemy'}">${isPlayer ? '我军' : '敌军'}</span>
    <span class="in-head-sub">队长 ${squad.leader.def.name} Lv.${squad.leader.level}</span>
    <span class="in-head-sub">人数 ${capTxt}</span>
    <span class="in-head-sub${isBoss ? ' in-boss-score' : ''}">威胁 ${squad.score()}</span>
  </div>
  <div class="in-hp"><div class="in-hp-outer"><div class="in-hp-inner" style="width:${max ? hp / max * 100 : 0}%"></div></div><span>${hp}/${max}</span></div>`;

  // 神器区 (有才显示)
  if (squad.artifacts.length) {
    h += `<div class="in-sec">神器</div><div class="in-arts">`;
    for (let i = 0; i < 2; i++) {
      const a = squad.artifacts[i];
      if (a) {
        const bonus = Object.entries(a.bonuses || {}).map(([k, v]) => `${k}+${v}`).join(' ');
        h += `<span class="in-art" title="${bonus}">◆ ${a.name}<i>${a.description || ''}</i></span>`;
      } else {
        h += `<span class="in-art empty">（空）</span>`;
      }
    }
    h += `</div>`;
  }

  // 成员 (3x3 阵型)
  h += `<div class="in-sec">成员</div><div class="in-grid">`;
  for (let slot = 0; slot < 9; slot++) {
    const m = squad.members.find(mm => mm.slot === slot);
    if (!m) { h += `<div class="in-cell empty"></div>`; continue; }
    const stats = STATS.map(([k, lb]) => statCell(squad, m, k, lb)).join('')
      + `<span class="in-stat">移${m.def.base.mov}</span>`;
    const traits = (m.traits || []).map(t =>
      `<span class="in-skill in-trait" title="${t.name}: ${t.description || ''}"><img src="assets/${t.icon}.png" onerror="this.style.visibility='hidden'">${t.name}</span>`
    ).join('');
    const skills = m.skills.map(s =>
      `<span class="in-skill" title="${s.name}: ${s.description || ''}"><img src="assets/${s.icon}.png" onerror="this.style.visibility='hidden'">${s.name}</span>`
    ).join('');
    const dead = m.alive ? '' : ' dead';
    h += `<div class="in-cell${dead}">
      <div class="in-mem-top"><img class="in-sprite" src="assets/${m.def.sprite}.png">
        <div><div class="in-cls${m.def.boss ? ' in-boss' : ''}">${m.def.name} Lv.${m.level}</div>
        <div class="in-memhp">HP ${m.hp}/${m.maxhp}</div></div>
        ${squad.leader === m ? '<span class="in-crown">★</span>' : ''}
      </div>
      <div class="in-stats">${stats}</div>
      ${traits || skills ? `<div class="in-skills">${traits}${skills}</div>` : ''}
    </div>`;
  }
  h += `</div><div class="in-foot">C/Esc 关闭</div>`;
  p.innerHTML = h;
}
