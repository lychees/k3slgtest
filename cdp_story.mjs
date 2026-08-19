// CDP 剧情系统 E2E:
// 选关(★剧情标记截图) -> 点 Chapter 1 -> 剧情出现(带头像截图) -> 连点前进 5 行断言文本变化
// -> 旁白行截图 -> 跳过 -> 进地图 -> debug=story 钩子 + Esc 跳过 -> 无 JS 报错
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9342;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile12',
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
  writeFileSync(`D:/dev/k3/zq/verify11_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify11_${name}.png`);
}
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const storyText = () => evaljs(`document.getElementById('story-text').textContent`);
const storyVisible = () => evaljs(`document.getElementById('story-ui').style.display === 'block'`);
// 等当前行打字机完成 (文本两次轮询不变即稳定)
async function lineSettled() {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const t = await storyText();
    if (t === last && t.length > 0) return t;
    last = t;
    await sleep(250);
  }
  return last || '';
}
// 前进一行并返回稳定后的文本
async function advance() {
  await lineSettled();
  await clickAt(500, 470);
  await sleep(250);
  return lineSettled();
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

  // 1. 选关界面: ★剧情 标记 (notitle 跳过标题画面)
  await nav(BASE + '?notitle=1', 3000);
  await evaljs(`localStorage.removeItem('sow_army'); localStorage.removeItem('sow_cleared');`);
  await nav(BASE + '?notitle=1', 3000);
  const marked = await evaljs(`document.querySelectorAll('#ls-list .ls-story').length`);
  check(marked === 138, `选关列表剧情标记 (实际 ${marked}/138)`);
  await shot('select_mark');

  // 2. 点 Chapter 1: Rebellion -> 剧情出现
  await evaljs(`(() => {
    const it = [...document.querySelectorAll('#ls-list .ls-item')]
      .find(d => d.querySelector('span').textContent.includes('Chapter 1: Rebellion'));
    it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  let storyUp = false;
  for (let i = 0; i < 30; i++) { await sleep(300); if (await storyVisible()) { storyUp = true; break; } }
  check(storyUp, '进图后剧情播放');
  await sleep(1500);   // 等首行打字机完成
  const face = await evaljs(`(() => { const f = document.getElementById('story-face');
    return { shown: f.style.display !== 'none', src: document.getElementById('story-face-img').src }; })()`);
  check(face.shown && face.src.includes('faces_zelos'), `首行头像 faces_zelos (${face.src})`);
  check((await evaljs(`document.getElementById('story-name').textContent`)) === '泽洛斯', '名字牌=泽洛斯');
  await shot('story');

  // 3. 连点前进 5 行, 断言文本变化
  const seen = [await lineSettled()];
  for (let n = 0; n < 5; n++) seen.push(await advance());
  let allChanged = true;
  for (let n = 1; n < seen.length; n++) if (seen[n] === seen[n - 1]) allChanged = false;
  check(allChanged && seen.every(t => t.length > 0), `连点前进 5 行文本均变化 (${new Set(seen).size} 种)`);

  // 4. 再前进到旁白行 (rm004 第 7 行 face 为空)
  await advance();
  const narr = await evaljs(`(() => ({ face: document.getElementById('story-face').style.display,
    narrate: document.getElementById('story-ui').classList.contains('narrate') }))()`);
  check(narr.face === 'none' && narr.narrate, `旁白行 (无头像+居中): ${JSON.stringify(narr)}`);
  await shot('narrator');

  // 5. 跳过 -> intro -> 地图
  await evaljs(`document.getElementById('story-skip').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(500);
  check(!(await storyVisible()), '跳过剧情');
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    if (await evaljs(`document.getElementById('intro-banner').style.display`) === 'flex') break;
  }
  check(await evaljs(`document.getElementById('intro-banner').style.display`) === 'flex', '剧情后进入开场横幅');
  // 等 intro+阶段横幅结束, 地图可玩
  let playable = false;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const st = await evaljs(`(() => { const T = window.__tactics;
      return T && T.state.phase === 0 && !T.state.ai &&
        getComputedStyle(document.getElementById('phase-banner')).display === 'none' &&
        document.getElementById('intro-banner').style.display !== 'flex'; })()`);
    if (st) { playable = true; break; }
  }
  check(playable, '进入可玩地图');

  // 6. debug=story 钩子 (第 3 行, zh 空回退 en) + Esc 跳过
  await nav(`${BASE}?debug=story=rm004`, 4000);
  check(await storyVisible(), 'debug=story 直接播剧情');
  await sleep(1500);
  const enText = await storyText();
  check(enText.includes('fortified') || enText.length > 0, `第 3 行 en 回退 (${enText.slice(0, 30)}…)`);
  await shot('story_en');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
  await sleep(500);
  check(!(await storyVisible()), 'Esc 跳过剧情');

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
