// CDP 选关界面交互测试:
// 无参数启动 -> 选关覆盖层 -> 搜索过滤 -> 点击条目原地 boot -> 游戏内选关按钮返回
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9339;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-profile9',
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
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleErrs.push(text); console.log('CONSOLE ERROR:', text);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(3000);

  // 1. 覆盖层显示, 209+1 条目, ch1 在首位
  check(await evaljs(`getComputedStyle(document.getElementById('level-select')).display`) === 'flex', '选关覆盖层显示');
  const count = await evaljs(`document.querySelectorAll('#ls-list .ls-item').length`);
  check(count === 210, `条目数 210 (实际 ${count})`);
  check((await evaljs(`document.querySelector('#ls-list .ls-item span').textContent`)).includes('手绘'), 'ch1 手绘演示在首位');
  // 未 boot 时游戏 UI 隐藏
  check(await evaljs(`getComputedStyle(document.getElementById('turn-panel')).visibility`) === 'hidden', '选关时回合面板隐藏');

  // 2. 搜索过滤
  await evaljs(`(() => { const s = document.getElementById('ls-search');
    s.value = 'wild card'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  const filtered = await evaljs(`[...document.querySelectorAll('#ls-list .ls-item')].map(d => d.querySelector('span').textContent)`);
  check(filtered.length === 2 && filtered.every(t => t.includes('Wild Card')), `搜索过滤 (实际 ${filtered.length} 条, 均含关键词: ${filtered.every(t => t.includes('Wild Card'))})`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('D:/dev/k3/zq/verify9_select_search.png', Buffer.from(shot.data, 'base64'));

  // 3. 点击条目 -> 原地 boot (不刷新)
  await evaljs(`document.querySelector('#ls-list .ls-item').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(4000);
  check(await evaljs(`getComputedStyle(document.getElementById('level-select')).display`) === 'none', '选关层已关闭');
  const booted = await evaljs(`(() => { const T = window.__tactics; const rm = T.realMap && T.realMap();
    return rm ? { id: rm.mapMeta.id, name: rm.mapMeta.name, n: T.squads().length } : null; })()`);
  check(booted && booted.id === 'rm020', `原地 boot rm020 (实际 ${booted && booted.id})`);
  check(booted && booted.n >= 4, `部队已摆位 (${booted && booted.n} 支)`);
  // intro 显示章节名
  check((await evaljs(`document.querySelector('#intro-banner .map-name').textContent`)).includes('Wild Card'), 'intro 显示章节名');
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('D:/dev/k3/zq/verify9_select_booted.png', Buffer.from(shot2.data, 'base64'));

  // 4. 游戏内选关按钮 -> 回到选关 (location 跳转)
  await evaljs(`document.getElementById('level-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(3000);
  check(await evaljs(`location.search`) === '', '选关按钮回到无参数地址');
  check(await evaljs(`getComputedStyle(document.getElementById('level-select')).display`) === 'flex', '选关覆盖层再次显示');

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
