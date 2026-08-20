// CDP 收尾包 C: 自定义图(rx_demo) / 武器链 / 竞技场
// 选关自定义组进 rx_demo -> 买银剑装备 -> 伤害对比断言 -> 长弓 2..3 -> 竞技场扣款/奖励/HP 保留 -> 无报错
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9358;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile27',
  '--window-size=1000,600', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const consoleErrs = [];
function send(method, params = {}) {
  return new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function nav(url, wait = 3500) { await send('Page.navigate', { url }); await sleep(wait); }
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`D:/dev/k3/zq/verify18_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify18_${name}.png`);
}
async function skipIntro() {
  await realClick(500, 300);
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await evaljs(`getComputedStyle(document.getElementById('phase-banner')).display`) === 'none') break;
  }
}
const armyState = () => evaljs(`JSON.parse(localStorage.getItem('sow_army'))`);
const patchArmy = fn => evaljs(`(() => { const a = JSON.parse(localStorage.getItem('sow_army'));
  (${fn})(a); localStorage.setItem('sow_army', JSON.stringify(a)); })()`);
const R = [];
const check = (cond, msg) => { R.push(`${cond ? 'OK' : 'FAIL'} ${msg}`); console.log(R[R.length - 1]); };

async function main() {
  let targets = null;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const text = String((d.exception && d.exception.description) || d.text);
      consoleErrs.push(text); console.log('PAGE EXCEPTION:', text.slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleErrs.push(text); console.log('CONSOLE ERROR:', text.slice(0, 300));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await nav(`${BASE}?notitle=1`, 3000);
  await evaljs(`localStorage.clear()`);
  await nav(`${BASE}?notitle=1`, 3000);

  // 1. 选关自定义组 + rx_demo 可进
  const custom = await evaljs(`[...document.querySelectorAll('#ls-list .ls-item')]
    .filter(d => d.textContent.includes('自定义')).map(d => d.querySelector('span').textContent)`);
  check(custom.length >= 1 && custom.some(t => t.includes('湖畔')), `选关自定义组 (${JSON.stringify(custom)})`);
  await evaljs(`(() => {
    const it = [...document.querySelectorAll('#ls-list .ls-item')].find(d => d.textContent.includes('湖畔'));
    it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(4000);
  check(await evaljs(`(() => { const T = window.__tactics; const rm = T.realMap();
    return rm && rm.mapMeta.id === 'rx_demo' && T.squads().length >= 3; })()`), 'rx_demo 加载并有部队');
  await skipIntro();
  await shot('rx_demo');

  // 2. 武器: 给够钱 -> 商店买银剑 -> 给士兵装备
  await patchArmy(`a => { a.gold = 9999; }`);
  await nav(`${BASE}?map=rm004&debug=army`);
  await sleep(1000);
  await evaljs(`document.querySelector('.au-tab[data-tab="shop"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await shot('weapon_shop');
  await evaljs(`(() => { const row = [...document.querySelectorAll('#au-body .au-row')].find(r => r.textContent.includes('银剑'));
    row.querySelector('.au-btn:not(.disabled)').dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  check((await armyState()).weaponStock.silver_sword === 1, '买到银剑入库');
  await evaljs(`document.querySelector('.au-tab[data-tab="weapon"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  // 领主 (sword 系) 更换 -> 银剑
  await evaljs(`(() => { const row = [...document.querySelectorAll('#au-body .au-row')]
    .find(r => r.textContent.includes('领主') && !r.classList.contains('au-picker'));
    [...row.querySelectorAll('.au-btn')].find(b => b.textContent.includes('更换'))
      .dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  await evaljs(`(() => { const btn = [...document.querySelectorAll('.au-picker .au-btn')]
    .find(b => b.textContent.includes('银剑'));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  const soldier = await evaljs(`(() => { const a = JSON.parse(localStorage.getItem('sow_army'));
    const uid = a.rosters.zelos_guard.members[4];
    return a.units[uid]; })()`);
  check(soldier.weapon === 'silver_sword', `领主装备银剑 (${soldier.weapon})`);
  await shot('weapon_tab');

  // 4. 长弓: 买并给弓兵 -> 射程 2..3
  await evaljs(`document.querySelector('.au-tab[data-tab="shop"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await evaljs(`(() => { const row = [...document.querySelectorAll('#au-body .au-row')].find(r => r.textContent.includes('长弓'));
    row.querySelector('.au-btn:not(.disabled)').dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  await evaljs(`document.querySelector('.au-tab[data-tab="weapon"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await evaljs(`(() => { const row = [...document.querySelectorAll('#au-body .au-row')]
    .find(r => r.textContent.includes('弓兵') && !r.classList.contains('au-picker'));
    [...row.querySelectorAll('.au-btn')].find(b => b.textContent.includes('更换'))
      .dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  await evaljs(`(() => { const btn = [...document.querySelectorAll('.au-picker .au-btn')]
    .find(b => b.textContent.includes('长弓'));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  await nav(`${BASE}?map=rm004&debug=clean`);
  // 重新进图后: 装备生效 — 领主银剑 might8 (vs 铁剑 5), 弓手长弓 range 3
  const dmgCmp = await evaljs(`(() => { const T = window.__tactics;
    const z = T.squads().find(s => s.template.id === 'zelos_guard');
    const m = z.members.find(m => m.slot === 4);
    return { equipped: m.weapon.id, might: m.weapon.might }; })()`);
  check(dmgCmp.equipped === 'silver_sword' && dmgCmp.might === 8, `战斗成员武器=银剑 might8 (${JSON.stringify(dmgCmp)})`);
  const bow = await evaljs(`(() => { const T = window.__tactics;
    const z = T.squads().find(s => s.template.id === 'zelos_guard');
    const archer = z.members.find(m => m.def.id === 'archer');
    return { max: z.rangeMax(), archerRange: archer.weapon.range, archerIsBow: archer.weapon.weapon }; })()`);
  check(bow.max === 3 && bow.archerRange === 3 && bow.archerIsBow === 'bow',
    `长弓射程: 弓手武器 range ${bow.archerRange}, 队最大 ${bow.max} (弓系 min 恒 2)`);

  // 5. 竞技场: 报名费/胜利奖励/HP 保留
  await patchArmy(`a => { a.gold = 5000; }`);
  const tpBefore = (await armyState()).techPoints;
  await nav(`${BASE}?map=rm004&debug=army`);
  await sleep(1000);
  await evaljs(`document.querySelector('.au-tab[data-tab="arena"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await shot('arena');
  const expBefore = await evaljs(`(() => { const a = JSON.parse(localStorage.getItem('sow_army'));
    return Object.values(a.units).reduce((s, u) => s + u.exp + u.level * 100, 0); })()`);
  await evaljs(`(() => { const btn = [...document.querySelectorAll('#au-body .au-btn')]
    .find(b => b.textContent.includes('挑战'));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  // 等竞技场打完 (最多 3 场, 每场几秒; 按键加速)
  for (let i = 0; i < 180; i++) {
    await sleep(500);
    if (await evaljs(`getComputedStyle(document.getElementById('army-ui')).display`) === 'flex') break;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ' });
  }
  const a2 = await armyState();
  const expAfter = await evaljs(`(() => { const a = JSON.parse(localStorage.getItem('sow_army'));
    return Object.values(a.units).reduce((s, u) => s + u.exp + u.level * 100, 0); })()`);
  check(a2.gold > 5000 - 200, `竞技场后金币 > 4800 (实际 ${a2.gold}, 说明有胜场奖金)`);
  check(expAfter > expBefore, `竞技场经验增加 (${expBefore}->${expAfter})`);
  const minHp = Math.min(...Object.values(a2.units).filter(u => u.hp != null).map(u => u.hp));
  check(minHp >= 1, `竞技场不致命 (最低 HP ${minHp} >= 1)`);
  const arenaTxt = await evaljs(`document.getElementById('au-body').textContent`);
  check(arenaTxt.includes('上场战绩'), `竞技场战绩显示 (${arenaTxt.match(/上场战绩[^。]*/)?.[0]})`);
  check(a2.techPoints >= tpBefore, `科技点不减 (${tpBefore}->${a2.techPoints})`);

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
