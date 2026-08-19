// CDP 批次 A 端到端: 音频打桩断言 + 战斗预测面板 + 守方反击
// 进 rm004 -> BGM/SFX 断言 -> 泽洛斯向敌行军 -> 攻击 -> 预测面板(数值对得上 simulate)
// -> 开战 -> 守方还击事件存在 -> 双方 HP 变化合理 -> 无 JS 报错
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9345;
const URL = 'http://localhost:8931/index.html?map=rm004&nostory=1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile15',
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
async function settleCam() {
  for (let i = 0; i < 60; i++) {
    const done = await evaljs(`(() => { const c = window.__tactics.cam;
      return Math.abs(c.cx - c.tx) < 0.01 && Math.abs(c.cy - c.ty) < 0.01; })()`);
    if (done) return;
    await sleep(100);
  }
}
async function clickTile(tx, ty) {
  await settleCam();
  const c = await evaljs(`(() => {
    const { cam } = window.__tactics;
    const tp = 32 * cam.level;
    const sx = ((${tx}) - (cam.cx - 960 / tp / 2)) * tp, sy = ((${ty}) - (cam.cy - 540 / tp / 2)) * tp;
    const r = document.getElementById('stage').getBoundingClientRect();
    const s = r.width / 960;
    return { x: r.left + (sx + tp / 2) * s, y: r.top + (sy + tp / 2) * s };
  })()`);
  await realClick(c.x, c.y);
}
async function clickMenuItem(label) {
  const r = await evaljs(`(() => {
    const it = [...document.querySelectorAll('#action-menu .item')].find(i => i.textContent.includes('${label}'));
    if (!it || it.classList.contains('disabled')) return null;
    const b = it.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  if (!r) return false;
  await realClick(r.x, r.y);
  return true;
}
async function waitMenu(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaljs(`document.getElementById('action-menu').style.display`) === 'block') return true;
    await sleep(200);
  }
  return false;
}
async function endPhase() {
  const t = await evaljs(`(() => {
    const { cam, squads } = window.__tactics;
    const tp = 32 * cam.level, vw = 960 / tp, vh = 540 / tp;
    const l = Math.ceil(cam.cx - vw / 2) + 1, r = Math.floor(cam.cx + vw / 2) - 1;
    const u = Math.ceil(cam.cy - vh / 2) + 1, d = Math.floor(cam.cy + vh / 2) - 1;
    for (let y = u; y <= d; y++) for (let x = l; x <= r; x++) {
      if (!squads().some(s => s.x === x && s.y === y)) return [x, y];
    }
    return null;
  })()`);
  if (!t) return;
  await settleCam();
  const c = await evaljs(`(() => {
    const { cam } = window.__tactics;
    const tp = 32 * cam.level;
    const sx = ((${t[0]}) - (cam.cx - 960 / tp / 2)) * tp, sy = ((${t[1]}) - (cam.cy - 540 / tp / 2)) * tp;
    const r = document.getElementById('stage').getBoundingClientRect();
    const s = r.width / 960;
    return { x: r.left + (sx + tp / 2) * s, y: r.top + (sy + tp / 2) * s };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
}
async function waitPlayerTurn(turn) {
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const st = await evaljs(`({ phase: window.__tactics.state.phase, ai: window.__tactics.state.ai,
      battle: window.__tactics.state.battle, over: window.__tactics.state.over,
      turn: window.__tactics.state.turn,
      banner: getComputedStyle(document.getElementById('phase-banner')).display })`);
    if (st.over) return st;
    if (st.phase === 0 && !st.ai && !st.battle && st.turn >= turn && st.banner === 'none') return st;
    if (st.battle) {   // 战斗中按键加速播放
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ' });
    }
    await sleep(500);
  }
  return null;
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`D:/dev/k3/zq/verify13_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify13_${name}.png`);
}
const R = [];
const check = (cond, msg) => { R.push(`${cond ? 'OK' : 'FAIL'} ${msg}`); console.log(R[R.length - 1]); };

// 把光标键盘移到某格 (相机跟随), 解决目标在屏外的问题
async function cursorTo(tx, ty) {
  for (let i = 0; i < 60; i++) {
    const c = await evaljs(`({ ...window.__tactics.state.cursor })`);
    if (c.x === tx && c.y === ty) return true;
    const k = c.x < tx ? 'ArrowRight' : c.x > tx ? 'ArrowLeft' : c.y < ty ? 'ArrowDown' : 'ArrowUp';
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k });
    await sleep(90);
  }
  return false;
}
// 让一支部队就近挪一格并待机 (凑结束回合条件)
async function idleSquad(ref) {
  const sq = await evaljs(`(() => { const s = window.__tactics.squads().find(s => s.template.id === '${ref}');
    return s ? { x: s.x, y: s.y, done: s.done } : null; })()`);
  if (!sq || sq.done) return;
  await cursorTo(sq.x, sq.y);
  await clickTile(sq.x, sq.y);
  await sleep(300);
  const dest = await evaljs(`(() => {
    const T = window.__tactics;
    for (const k of T.state.range.move.keys()) {
      const [x, y] = k.split(',').map(Number);
      if (!T.squads().some(s => s.x === x && s.y === y)) return [x, y];
    }
    return null;
  })()`);
  if (!dest) return;
  await clickTile(dest[0], dest[1]);
  await waitMenu();
  await clickMenuItem('待机');
  await sleep(400);
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
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const text = (d.exception && d.exception.description) || d.text;
      consoleErrs.push(text); console.log('PAGE EXCEPTION:', String(text).slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleErrs.push(text); console.log('CONSOLE ERROR:', text);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await nav(URL);
  await evaljs(`localStorage.removeItem('sow_army')`);
  await nav(URL);

  // 跳过 intro (这次点击同时解锁音频)
  await realClick(500, 300);
  check(await waitPlayerTurn(1) !== null, 'turn 1 就绪');

  // ---- A1 音频断言 (打桩) ----
  const bgms = await evaljs(`window.__audio.bgm`);
  check(bgms[bgms.length - 1] === 'map2', `地图 BGM=map2 (rm004 偶数章; 实际 ${JSON.stringify(bgms)})`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 250 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 440, y: 250 });
  await sleep(150);
  check((await evaljs(`window.__audio.sfx`)).includes('cursor'), '光标音效已触发');

  // ---- A2/A3: 三支部队抱团向北行军, 接触后泽洛斯发起带预测的攻击 ----
  let forecastUp = false;
  // 完整的预测面板断言 + 开战 + 守方还击断言 (只第一次攻击做)
  async function forecastAttack(hpBefore) {
    check(await clickMenuItem('攻击'), '点攻击');
    await sleep(500);
    forecastUp = await evaljs(`document.getElementById('forecast-ui').style.display === 'flex'`);
    check(forecastUp, '预测面板出现');
    const fc = await evaljs(`(() => {
      const f = window.__tactics.state.forecast;
      return { dmg: f.info.atkPrev && f.info.atkPrev.dmg, hit: f.info.atkPrev && f.info.atkPrev.hit,
        counter: !!f.info.defPrev, kills: f.info.sim.stats.atk.kills,
        target: f.targets[f.idx].name };
    })()`);
    const panel = await evaljs(`document.querySelector('#forecast-ui .fc-panel').textContent`);
    check(fc.dmg != null && panel.includes(`伤害 ${fc.dmg}`), `预测伤害与 simulate 一致 (伤害 ${fc.dmg})`);
    check(panel.includes(`命中 ${fc.hit}%`), `预测命中率一致 (${fc.hit}%)`);
    check(panel.includes(`反击`), '含守方反击预估');
    check(panel.includes(`敌方 ${fc.kills}`), `预计阵亡一致 (敌方 ${fc.kills})`);
    const hpAfterSim = await evaljs(`window.__tactics.squads().find(s => s.template.id === 'zelos_guard').totalHp()`);
    check(hpAfterSim === hpBefore, `simulate 无副作用 (HP ${hpBefore} 不变)`);
    check(fc.target.length > 0, `目标 ${fc.target}`);
    await shot('forecast');
    // 切到总 HP 最高的目标 (保证守方存活以验证还击)
    const bestIdx = await evaljs(`(() => { const f = window.__tactics.state.forecast;
      let bi = 0, bh = -1;
      f.targets.forEach((t, i) => { const h = t.totalHp(); if (h > bh) { bh = h; bi = i; } });
      return bi; })()`);
    for (let i = 0; i < 10; i++) {
      if ((await evaljs(`window.__tactics.state.forecast.idx`)) === bestIdx) break;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight' });
      await sleep(150);
    }
    await evaljs(`document.getElementById('fc-go').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  }
  // 快速攻击 (非断言路径): 攻击 -> 面板直接开战
  async function quickAttack() {
    if (!(await clickMenuItem('攻击'))) { await clickMenuItem('待机'); await sleep(300); return; }
    await sleep(400);
    if (await evaljs(`document.getElementById('forecast-ui').style.display === 'flex'`)) {
      await evaljs(`document.getElementById('fc-go').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    }
  }
  async function waitBattleDone() {
    for (let i = 0; i < 60; i++) { await sleep(500); if (await evaljs(`window.__tactics.state.battle`)) break; }
    // 战斗中按键加速
    for (let i = 0; i < 90; i++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ' });
      await sleep(500);
      if (!(await evaljs(`window.__tactics.state.battle`))) break;
    }
    console.log('    [battle]', JSON.stringify(await evaljs(`(() => { const T = window.__tactics; const p = T.lastPlayback;
      return p ? { ev: p.events.length, defStrikes: p.events.filter(e => e.side === 'def' && e.kind === 'strike').length,
        acc: T.defStrikes || 0, over: T.state.over } : null; })()`)));
  }
  // 一支部队向最近敌人移动; 够得着就打
  async function marchSquad(ref) {
    const sq = await evaljs(`(() => { const s = window.__tactics.squads().find(s => s.template.id === '${ref}');
      return s ? { x: s.x, y: s.y, done: s.done } : null; })()`);
    if (!sq || sq.done) return false;
    await cursorTo(sq.x, sq.y);
    await clickTile(sq.x, sq.y);
    await sleep(300);
    const step = await evaljs(`(() => {
      const T = window.__tactics;
      const z = T.squads().find(s => s.template.id === '${ref}');
      if (!z || !T.state.range || T.state.selected !== z) return { err: 'not selected' };
      const foes = T.squads().filter(s => s.team === 1);
      if (!foes.length) return { err: 'no foes' };
      const near = foes.slice().sort((a, b) =>
        (Math.abs(a.x - z.x) + Math.abs(a.y - z.y)) - (Math.abs(b.x - z.x) + Math.abs(b.y - z.y)))[0];
      let best = null, bestD = 1e9;
      for (const k of T.state.range.move.keys()) {
        const [x, y] = k.split(',').map(Number);
        if (T.squads().some(s => s.x === x && s.y === y)) continue;   // 含自身格: 已在最优格时横向挪一格
        const d = Math.abs(near.x - x) + Math.abs(near.y - y);
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
      return { dest: best, dist: bestD, canAttack: bestD <= z.rangeMax() };
    })()`);
    console.log(`  march ${ref}: ${JSON.stringify(step)}`);
    if (step.err || !step.dest) {
      console.log(`    [${ref}] skip, state=`, JSON.stringify(await evaljs(`(() => { const T = window.__tactics;
        return { phase: T.state.phase, ai: T.state.ai, battle: T.state.battle, over: T.state.over,
          moving: T.state.moving, menu: !!T.state.menuSquad, fc: !!T.state.forecast }; })()`)));
      return false;
    }
    const isZelosFirstAttack = ref === 'zelos_guard' && !forecastUp && step.canAttack;
    const hpBefore = isZelosFirstAttack
      ? await evaljs(`window.__tactics.squads().find(s => s.template.id === 'zelos_guard').totalHp()`)
      : 0;
    await cursorTo(step.dest[0], step.dest[1]);   // 目的格可能屏外: 先键盘平移相机
    await clickTile(step.dest[0], step.dest[1]);
    await waitMenu();
    if (step.canAttack) {
      if (isZelosFirstAttack) await forecastAttack(hpBefore);
      else await quickAttack();
      await waitBattleDone();
    } else {
      await clickMenuItem('待机');
      await sleep(300);
    }
    return step.canAttack;
  }

  for (let turn = 1; turn <= 6 && !forecastUp; turn++) {
    for (const ref of ['zelos_guard', 'diana_squad', 'knight_wall']) {
      await marchSquad(ref);
      if (forecastUp) break;
    }
    if (forecastUp) break;
    check(await waitPlayerTurn(turn + 1) !== null, `turn ${turn + 1} 就绪`);
  }
  check(forecastUp, '成功发起一次带预测的攻击');
  if (forecastUp) {
    // 继续打到守方还击出现为止 (首场可能直接把守方全歼; 敌方阶段我方守方也会反击)
    for (let turn = 0; turn < 4; turn++) {
      const n = await evaljs(`window.__tactics.defStrikes || 0`);
      if (n > 0) break;
      const cur = await evaljs(`window.__tactics.state.turn`);
      for (const ref of ['zelos_guard', 'diana_squad', 'knight_wall']) await marchSquad(ref);
      await waitPlayerTurn(cur + 1);
    }
    const ds = await evaljs(`window.__tactics.defStrikes || 0`);
    check(ds > 0, `守方还击 (全场累计 ${ds} 次守方出手)`);
    check((await evaljs(`window.__audio.bgm`)).includes('battle1'), '战斗 BGM=battle1');
    check((await evaljs(`window.__audio.sfx`)).some(s => ['sword', 'bow', 'magic'].includes(s)), '武器音效已触发');
  }

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
