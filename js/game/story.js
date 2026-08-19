// story.js — 剧情播放器 (视觉小说式): 进图后、开场横幅前播放 data/story/rmNNN.json
// 底部对话框 + 名字牌 + 左侧大头像 + 打字机; 点击/Z/Enter 前进, 点击加速, 按钮/Esc 跳过。
// 文本优先 zh, 空则回退 en; 无脸行 = 旁白 (居中无头像)。播放时 BGM 降到 40%。
import { duckBgm } from './audio.js';

const $ = id => document.getElementById(id);

// 有剧情文件的地图 (data/story/ 目录快照, 138 张)
export const STORY_MAPS = new Set([
  'rm002', 'rm003', 'rm004', 'rm006', 'rm007', 'rm012', 'rm013', 'rm014', 'rm015', 'rm016', 'rm017', 'rm018',
  'rm019', 'rm020', 'rm021', 'rm022', 'rm024', 'rm025', 'rm026', 'rm027', 'rm028', 'rm029', 'rm030', 'rm034',
  'rm035', 'rm036', 'rm037', 'rm039', 'rm040', 'rm041', 'rm042', 'rm043', 'rm044', 'rm045', 'rm046', 'rm048',
  'rm050', 'rm053', 'rm054', 'rm055', 'rm056', 'rm057', 'rm060', 'rm062', 'rm064', 'rm065', 'rm066', 'rm080',
  'rm089', 'rm091', 'rm092', 'rm094', 'rm096', 'rm097', 'rm099', 'rm100', 'rm101', 'rm139', 'rm141', 'rm142',
  'rm144', 'rm145', 'rm174', 'rm175', 'rm176', 'rm177', 'rm178', 'rm179', 'rm180', 'rm181', 'rm184', 'rm185',
  'rm187', 'rm188', 'rm191', 'rm192', 'rm193', 'rm194', 'rm195', 'rm196', 'rm197', 'rm198', 'rm199', 'rm201',
  'rm202', 'rm203', 'rm204', 'rm205', 'rm207', 'rm208', 'rm209', 'rm210', 'rm211', 'rm213', 'rm214', 'rm215',
  'rm222', 'rm229', 'rm230', 'rm233', 'rm235', 'rm238', 'rm239', 'rm241', 'rm243', 'rm244', 'rm245', 'rm246',
  'rm248', 'rm249', 'rm250', 'rm260', 'rm261', 'rm262', 'rm269', 'rm281', 'rm282', 'rm283', 'rm287', 'rm288',
  'rm289', 'rm290', 'rm291', 'rm292', 'rm295', 'rm299', 'rm301', 'rm303', 'rm306', 'rm310', 'rm311', 'rm312',
  'rm315', 'rm324', 'rm329', 'rm335', 'rm336', 'rm337',
]);

export function hasStory(mapId) { return STORY_MAPS.has(mapId); }
export function isPlaying() { return playing; }

let playing = false;
const lineCache = {};   // mapId -> Promise<lines|null>

// 覆盖层事件不穿透到舞台 (剧情播放时地图输入由 main.js 的 isPlaying 检查一并屏蔽)
{
  const ov = $('story-ui');
  for (const t of ['mousemove', 'wheel', 'contextmenu']) ov.addEventListener(t, e => e.stopPropagation());
}

function loadLines(mapId) {
  if (!lineCache[mapId]) {
    lineCache[mapId] = fetch(`data/story/${mapId}.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d && Array.isArray(d.lines) && d.lines.length ? d.lines : null))
      .catch(() => null);
  }
  return lineCache[mapId];
}

// startOpt: undefined=从头; 数字=起始行; 'end'=最后一行
export async function playStory(mapId, startOpt) {
  if (!hasStory(mapId)) return false;
  const lines = await loadLines(mapId);
  if (!lines) return false;

  const overlay = $('story-ui');
  const faceBox = $('story-face');
  const faceImg = $('story-face-img');
  const nameEl = $('story-name');
  const textEl = $('story-text');

  playing = true;
  duckBgm(true);
  overlay.style.display = 'block';
  let i = startOpt === 'end' ? lines.length - 1 : Math.max(0, startOpt | 0);

  return new Promise(resolve => {
    let timer = null, fullText = '', typing = false;

    function showLine(idx) {
      const ln = lines[idx];
      fullText = ln.zh || ln.en || '';
      // 头像: 4x2 网格裁 128x128 (文件名可能含 [] 等, 需编码)
      if (ln.face) {
        faceBox.style.display = 'block';
        faceImg.src = `assets/faces/${encodeURIComponent(ln.face)}.png`;
        faceImg.style.left = `${-(ln.idx % 4) * 128}px`;
        faceImg.style.top = `${-Math.floor(ln.idx / 4) * 128}px`;
      } else {
        faceBox.style.display = 'none';
      }
      nameEl.textContent = ln.name || '';
      nameEl.style.display = ln.name ? 'block' : 'none';
      overlay.classList.toggle('narrate', !ln.face);
      // 打字机
      textEl.textContent = '';
      typing = true;
      let c = 0;
      clearInterval(timer);
      timer = setInterval(() => {
        c++;
        textEl.textContent = fullText.slice(0, c);
        if (c >= fullText.length) { typing = false; clearInterval(timer); timer = null; }
      }, 18);
    }

    function cleanup() {
      clearInterval(timer);
      duckBgm(false);
      overlay.style.display = 'none';
      overlay.classList.remove('narrate');
      window.removeEventListener('keydown', onKey, true);
      playing = false;
      resolve(true);
    }
    function next() {
      if (typing) {   // 点击加速: 直接显示全行
        clearInterval(timer);
        timer = null;
        textEl.textContent = fullText;
        typing = false;
        return;
      }
      i++;
      if (i >= lines.length) cleanup();
      else showLine(i);
    }
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') { e.stopPropagation(); cleanup(); }
      else if (e.key === 'Enter' || e.key === 'z' || e.key === 'Z' || e.key === ' ') { e.stopPropagation(); next(); }
    }

    overlay.onclick = e => { e.stopPropagation(); next(); };   // 幂等赋值, 重复播放不叠加
    $('story-skip').onclick = e => { e.stopPropagation(); cleanup(); };
    window.addEventListener('keydown', onKey, true);
    showLine(i);
  });
}
