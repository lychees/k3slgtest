// ui.js — FE 风面板 / 阶段横幅 / 开场 / 终局横幅
const $ = id => document.getElementById(id);

let bannerBusy = false;
let introOn = false;
let endOn = false;

// 横幅/开场/终局期间锁定输入
export function locked() { return bannerBusy || introOn || endOn; }

export function updateTerrainPanel(t) {
  const p = $('terrain-panel');
  p.querySelector('.tname').textContent = t.name;
  p.querySelector('.t-avo').textContent = '+' + t.avo;
  p.querySelector('.t-def').textContent = '+' + t.def;
  p.querySelector('.t-cost').textContent = t.pass ? t.cost : '—';
}

// 部队信息面板: 队名 / 队长 / 成员九宫格 / 总 HP / 威胁度
export function updateSquadPanel(squad) {
  const p = $('unit-panel');
  if (!squad) { p.style.display = 'none'; return; }
  p.style.display = 'block';
  p.querySelector('.uname').textContent = squad.name;
  const tag = p.querySelector('.uteam');
  tag.textContent = squad.team === 0 ? '我军' : '敌军';
  tag.classList.toggle('enemy', squad.team !== 0);
  p.querySelector('.uleader').textContent = `${squad.leader.def.name} Lv.${squad.leader.level}`;
  p.querySelector('.ucount').textContent = `${squad.aliveMembers().length}/${squad.members.length}`;
  p.querySelector('.umov').textContent = squad.mov;
  p.querySelector('.urange').textContent = squad.rangeMax();
  p.querySelector('.uscore').textContent = squad.score();
  const hp = squad.totalHp(), max = squad.totalMaxHp();
  p.querySelector('.hp-num').textContent = `${hp}/${max}`;
  p.querySelector('.hp-bar-inner').style.width = (max ? hp / max * 100 : 0) + '%';
  const cells = p.querySelectorAll('.mg-cell');
  cells.forEach((c, slot) => {
    const m = squad.members.find(mm => mm.slot === slot);
    c.innerHTML = m ? `<img src="assets/${m.def.sprite}.png">` : '';
    c.classList.toggle('dead', !!m && !m.alive);
  });
}

export function showPhaseBanner(text, enemy, cb) {
  const b = $('phase-banner');
  b.querySelector('.inner').textContent = text;
  b.className = enemy ? 'enemy' : '';
  b.style.display = 'flex';
  b.style.opacity = 0;
  bannerBusy = true;
  let t0 = null;
  function anim(ts) {
    if (!t0) t0 = ts;
    const t = (ts - t0) / 1000;
    b.style.opacity = Math.min(1, t * 3);
    if (t > 1.2) b.style.opacity = Math.max(0, 1 - (t - 1.2) * 3);
    if (t < 1.6) requestAnimationFrame(anim);
    else { b.style.display = 'none'; bannerBusy = false; cb && cb(); }
  }
  requestAnimationFrame(anim);
}

// 开场: 地图名 + intro 文本, 自动淡出, 可点击/按键跳过
export function showIntro(map) {
  return new Promise(resolve => {
    const b = $('intro-banner');
    b.querySelector('.map-name').textContent = map.name;
    b.querySelector('.intro-text').textContent = map.intro || '';
    b.style.display = 'flex';
    b.style.opacity = 0;
    introOn = true;
    let done = false;
    const finish = e => {
      if (done) return;
      done = true;
      if (e && e.stopPropagation) e.stopPropagation();   // 跳过开场的点击不再穿透成地图点击
      window.removeEventListener('keydown', finish);
      b.removeEventListener('click', finish);
      b.style.display = 'none';
      introOn = false;
      resolve();
    };
    window.addEventListener('keydown', finish);
    b.addEventListener('click', finish);
    let t0 = null;
    function anim(ts) {
      if (done) return;
      if (!t0) t0 = ts;
      const t = (ts - t0) / 1000;
      b.style.opacity = Math.min(1, t * 2.5);
      if (t > 2.4) b.style.opacity = Math.max(0, 1 - (t - 2.4) * 2.5);
      if (t < 3.0) requestAnimationFrame(anim);
      else finish();
    }
    requestAnimationFrame(anim);
  });
}

// 胜负横幅: 胜利 -> [整备] [下一章/回选关]; 败北 -> 点击或 Enter 刷新重开
export function showEnd(win, opts = {}) {
  const b = $('end-banner');
  b.className = win ? 'win' : 'lose';
  b.querySelector('.end-title').textContent = win ? '胜 利' : '败 北';
  const hint = b.querySelector('.end-hint');
  const btns = b.querySelector('.end-btns');
  b.style.display = 'flex';
  endOn = true;
  if (win) {
    hint.textContent = opts.hint || '';
    btns.style.display = 'flex';
    $('end-army').onclick = e => {
      e.stopPropagation();
      endOn = false;
      b.style.display = 'none';
      opts.onArmy && opts.onArmy();
    };
    const nextBtn = $('end-next');
    nextBtn.textContent = opts.nextLabel || '下一章 »';
    nextBtn.onclick = e => { e.stopPropagation(); opts.onNext && opts.onNext(); };
    return;
  }
  btns.style.display = 'none';
  hint.textContent = '点击或按 Enter 重新开始';
  const reload = () => location.reload();
  b.onclick = reload;
  window.addEventListener('keydown', e => {
    if (endOn && (e.key === 'Enter' || e.key === 'z' || e.key === 'Z')) reload();
  });
}
