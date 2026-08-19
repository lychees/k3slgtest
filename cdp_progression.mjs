// CDP 养成系统 E2E:
// 清存档 -> 战斗结算(经验/科技点) -> 连打至有人升级(抓 LEVEL UP 飘字截图)
// -> 整备: 编队改动 -> 研究科技(科技点断言) -> 重进关卡断言属性加成生效
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9340;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile10',
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
async function nav(url, wait = 3500) {
  await send('Page.navigate', { url });
  await sleep(wait);
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`D:/dev/k3/zq/verify10_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify10_${name}.png`);
}
const R = [];
const check = (cond, msg) => { R.push(`${cond ? 'OK' : 'FAIL'} ${msg}`); console.log(R[R.length - 1]); };
const armyState = () => evaljs(`JSON.parse(localStorage.getItem('sow_army'))`);
// 第一场战斗: 轮询 LEVEL UP 飘字, 出现即截图
async function watchLevelUp(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const found = await evaljs(`[...document.querySelectorAll('.bu-float')].some(f => f.textContent === 'LEVEL UP!')`);
    if (found) { await shot('levelup'); return true; }
    await sleep(150);
  }
  return false;
}

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
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleErrs.push(text); console.log('CONSOLE ERROR:', text);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');

  // 0. 清存档, 保证默认军队
  await nav(`${BASE}?map=rm004&debug=clean`);
  await evaljs(`localStorage.removeItem('sow_army')`);

  // 1-2. 连打数场 (最多 4 场) 直到有人升级; 每场都抓 LEVEL UP 飘字
  let leveled = false, gotShot = false, expAfter = 0, tpAfter = 0;
  for (let round = 1; round <= 4 && !leveled; round++) {
    await nav(`${BASE}?map=rm004&debug=combatsettle`, 1500);
    const got = await watchLevelUp(25000);
    gotShot = gotShot || got;
    // 等战斗结束
    for (let i = 0; i < 40; i++) {
      if (await evaljs(`window.__tactics && !window.__tactics.state.battle`)) break;
      await sleep(500);
    }
    const st = await evaljs(`(() => {
      const T = window.__tactics;
      const ps = T.squads().filter(s => s.team === 0);
      const members = ps.flatMap(s => s.members);
      return { maxLevel: Math.max(...members.map(m => m.level)),
        totalExp: members.reduce((n, m) => n + m.level * 100 + m.exp, 0),
        army: !!localStorage.getItem('sow_army') };
    })()`);
    const a = await armyState();
    expAfter = st.totalExp;
    tpAfter = a ? a.techPoints : 0;
    leveled = st.maxLevel > 5;
    console.log(`  round ${round}: maxLevel=${st.maxLevel} techPoints=${tpAfter}`);
  }
  check(expAfter > 500, `战斗结算有经验 (总经验 ${expAfter}, 初始 5 级基线)`);
  check(tpAfter > 0, `击杀得科技点 (${tpAfter})`);
  check(leveled, '有人升到 6 级');
  check(gotShot, '抓到 LEVEL UP 飘字');

  // 3. 研究前记录属性 (rm003)
  await nav(`${BASE}?map=rm003&debug=clean`);
  const strBefore = await evaljs(`(() => {
    const s = window.__tactics.squads().find(s => s.team === 0);
    return s.eff(s.leader, 'str');
  })()`);

  // 4. 整备: 编队 tab 截图 + 上阵一个后备单位
  await nav(`${BASE}?map=rm004&debug=army`);
  await sleep(1000);
  await shot('formation');
  const sizeBefore = await evaljs(`Object.keys(JSON.parse(localStorage.getItem('sow_army')).rosters.zelos_guard.members).length`);
  // 点第一个后备单位 -> 点第一个空格
  await evaljs(`(() => {
    const pool = document.querySelector('.au-pool-grid .au-cell');
    pool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(300);
  await evaljs(`(() => {
    const cells = [...document.querySelectorAll('.au-grid .au-cell')];
    const empty = cells.find(c => !c.querySelector('img'));
    empty.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(300);
  const sizeAfter = await evaljs(`Object.keys(JSON.parse(localStorage.getItem('sow_army')).rosters.zelos_guard.members).length`);
  check(sizeAfter === sizeBefore + 1, `编队: 上阵后备单位 (${sizeBefore}->${sizeAfter})`);
  await shot('formation_placed');

  // 5. 科技 tab: 研究 军事训练 I (cost 3)
  await evaljs(`document.querySelector('.au-tab[data-tab="tech"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await shot('tech');
  const tpBefore = (await armyState()).techPoints;
  const researched = await evaljs(`(() => {
    const rows = [...document.querySelectorAll('#au-body .au-row')];
    const row = rows.find(r => r.textContent.includes('军事训练 I'));
    const btn = row && row.querySelector('.au-btn:not(.disabled)');
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  const a2 = await armyState();
  check(researched && a2.tech.includes('mil1'), '研究 军事训练 I 成功');
  check(a2.techPoints === tpBefore - 3, `科技点 ${tpBefore}->${a2.techPoints} (扣 3)`);

  // 6. 重进 rm003, 断言 str 加成 +1 生效
  await nav(`${BASE}?map=rm003&debug=clean`);
  const strAfter = await evaljs(`(() => {
    const s = window.__tactics.squads().find(s => s.team === 0);
    return s.eff(s.leader, 'str');
  })()`);
  check(strAfter === strBefore + 1, `科技加成生效: str ${strBefore}->${strAfter}`);

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
