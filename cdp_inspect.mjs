// CDP 部队详情 E2E:
// 进 rm004 -> 光标移到泽洛斯 -> 按 C -> 断言详情层(部队名/5 成员/勇气战旗) -> Esc 关闭
// -> 键盘移光标到敌方 -> C -> 断言敌军详情 -> Esc -> 无 JS 报错
import { spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9344;
const URL = 'http://localhost:8931/index.html?map=rm004&nostory=1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-profile14',
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
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k });
  await sleep(60);
}
const R = [];
const check = (cond, msg) => { R.push(`${cond ? 'OK' : 'FAIL'} ${msg}`); console.log(R[R.length - 1]); };
const inspectVisible = () => evaljs(`getComputedStyle(document.getElementById('inspect-ui')).display === 'flex'`);

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
  await send('Page.navigate', { url: URL });
  await sleep(3500);
  await evaljs(`localStorage.removeItem('sow_army')`);
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // 跳过 intro, 等阶段横幅结束
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 300, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 300, button: 'left', clickCount: 1 });
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    if (await evaljs(`getComputedStyle(document.getElementById('phase-banner')).display`) === 'none') break;
  }

  // 1. 光标初始在第一支我方部队 (zelos 4,16); 按 C
  const cur = await evaljs(`({ ...window.__tactics.state.cursor })`);
  check(cur.x === 4 && cur.y === 16, `光标在 zelos (${cur.x},${cur.y})`);
  await key('c');
  await sleep(400);
  check(await inspectVisible(), 'C 打开详情层');
  const html = await evaljs(`document.getElementById('in-panel').innerHTML`);
  check(html.includes('泽洛斯亲卫队'), '含部队名');
  check(html.includes('勇气战旗'), '含神器 勇气战旗');
  check((html.match(/in-mem-top/g) || []).length === 5, `5 个成员 (实际 ${(html.match(/in-mem-top/g) || []).length})`);
  check(html.includes('领主 Lv.5'), '队长职业+等级');
  check(html.includes('人数 5/8'), '容量 5/8');
  check(html.includes('威胁'), '威胁度');

  // 2. Esc 关闭
  await key('Escape');
  await sleep(300);
  check(!(await inspectVisible()), 'Esc 关闭');

  // 3. 键盘移光标到敌方 (9,2) risen_pack -> C
  for (let i = 0; i < 14; i++) await key('ArrowUp');
  for (let i = 0; i < 5; i++) await key('ArrowRight');
  const cur2 = await evaljs(`({ ...window.__tactics.state.cursor })`);
  check(cur2.x === 9 && cur2.y === 2, `光标移到敌方 (${cur2.x},${cur2.y})`);
  await key('c');
  await sleep(400);
  check(await inspectVisible(), 'C 打开敌方详情');
  const html2 = await evaljs(`document.getElementById('in-panel').innerHTML`);
  check(html2.includes('复生小队') && html2.includes('敌军'), '含敌军部队名+阵营');
  check((html2.match(/in-mem-top/g) || []).length === 4, `敌方 4 个成员`);
  check(!html2.includes('in-arts'), '敌方无神器区');

  // 4. 再按 C 关闭
  await key('c');
  await sleep(300);
  check(!(await inspectVisible()), '再按 C 关闭');

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
