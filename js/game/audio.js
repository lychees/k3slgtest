// audio.js — BGM/SFX (Audio 元素; 首次用户手势后解锁; 主音量存 localStorage)
// BGM: 选关 title / 地图 map1|2 / 战斗 battle1|2 / 胜利 victory(不循环, 播完回地图) / 失败 defeat
// SFX: cursor(节流80ms) confirm cancel sword hit bow magic miss heal levelup equip
// 测试: window.__audio 暴露当前 BGM 与 SFX 播放记录 (CDP 断言用)

const BGM_PATH = n => `assets/audio/bgm/${n}`;
const SE_PATH = n => `assets/audio/se/${n}.wav`;

let volume = parseFloat(localStorage.getItem('sow_volume') ?? '0.7');
if (!(volume > 0 && volume <= 1)) volume = 0.7;
let unlocked = false;
let pendingBgm = null;      // 解锁前请求的 BGM
let current = null;         // { name, el, loop, mapReturn }
let duck = 1;               // 剧情时 0.4
let lastCursorSfx = 0;

// 测试钩子
const log = { bgm: [], sfx: [] };
if (typeof window !== 'undefined') window.__audio = log;

export function initAudio() {
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    if (pendingBgm) {
      const p = pendingBgm;
      pendingBgm = null;
      bgm(p.name, p.opts);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  try { localStorage.setItem('sow_volume', String(volume)); } catch {}
  if (current) current.el.volume = volume * duck;
}
export function getVolume() { return volume; }

function applyVolume() {
  if (current) current.el.volume = volume * duck;
}

// 0.5s 线性淡入淡出切换
function fadeTo(el, target, done) {
  const steps = 10;
  const from = el.volume;
  let i = 0;
  const t = setInterval(() => {
    i++;
    el.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
    if (i >= steps) { clearInterval(t); done && done(); }
  }, 50);
  return t;
}

// name: 'title'|'map1'|'map2'|'battle1'|'battle2'|'victory'|'defeat'
// opts: { loop=true, onEnded }
export function bgm(name, opts = {}) {
  const loop = opts.loop !== false;
  log.bgm.push(name);
  if (!unlocked) { pendingBgm = { name, opts }; return; }
  if (current && current.name === name) return;
  const file = BGM_PATH(name) + (name === 'defeat' ? '.mp3' : '.ogg');
  const el = new Audio(file);
  el.loop = loop;
  el.volume = 0;
  if (current) {
    const old = current;
    fadeTo(old.el, 0, () => { old.el.pause(); old.el.src = ''; });
  }
  current = { name, el, loop };
  el.play().catch(() => {});
  fadeTo(el, volume * duck);
  if (!loop) {
    el.onended = () => {
      if (current && current.el === el) {
        current = null;
        opts.onEnded && opts.onEnded();
      }
    };
  }
}

// 剧情等场景压低 BGM (40%)
export function duckBgm(on) {
  duck = on ? 0.4 : 1;
  applyVolume();
}

export function sfx(name) {
  if (name === 'cursor') {   // 光标音节流
    const now = performance.now();
    if (now - lastCursorSfx < 80) return;
    lastCursorSfx = now;
  }
  log.sfx.push(name);
  if (!unlocked) return;
  const el = new Audio(SE_PATH(name));
  el.volume = volume;
  el.play().catch(() => {});
}
