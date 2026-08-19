// battlescene.js — 全屏战斗场景 (对标原版 SoW 战斗画面)
// 绘制风多层背景(视差) + 双方 3x3 阵型大图单位 + 刀光/抛射 + 闪白/震屏 + 飘字 + 顶部 HP 条。
// 播放 combat.js 的 playback 事件序列; 点击/按键加速跳过。
import * as THREE from '../../lib/three.module.js';
import { loadTex, loadTexSmooth } from './gfx.js';
import { makeUnitTexture } from './sprites.js';

const W = 960, H = 540;
const SIDE_X = { atk: 240, def: 720 };   // 双方阵型中心 (屏幕 px)
const COL_GAP = 88, ROW_GAP = 78;
const UNIT = 96;                          // 成员 sprite 边长 (px, 32 -> 正好 3x 整数倍, Nearest)
const ROW_Y = 345;                        // 中间 row 的 sprite 中心 y

// 主题 -> [skybox, backdrop/background, ground, foreground] (远 -> 近)
const THEMES = {
  plains:    ['plains_skybox', 'plains_backdrop', 'plains_ground', 'plains_foreground'],
  grassland: ['grassland_skybox', 'grassland_backdrop', 'grassland_ground', 'grassland_foreground'],
  fort:      [null, 'fort_background', 'fort_ground', 'fort_foreground'],
  dungeon:   [null, 'dungeon_background', 'dungeon_ground', null],
};
// 各层水平视差幅度 (px)
const PARALLAX = [2, 5, 1.5, 8];

const RANGED_WEAPONS = new Set(['bow', 'fire', 'ice', 'lightning', 'heal', 'gun']);
const easeOut = k => 1 - (1 - k) * (1 - k);

export class BattleScene {
  constructor(renderer) {
    this.renderer = renderer;
    this.active = false;
    this.time = 0;
    this.shake = 0;
    this.skip = false;
    this.ui = {
      root: document.getElementById('battle-ui'),
      fade: document.getElementById('battle-fade'),
      floats: document.getElementById('battle-floats'),
    };
    // 刀光帧 (普通 = 左向右挥, f = 镜像); 像素素材用 Nearest
    this.slashTex = [1, 2, 3].map(i => loadTex(`hero_slash${i}`));
    this.slashTexF = [1, 2, 3].map(i => loadTex(`hero_slash${i}f`));
  }

  _initScene(theme) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e1e);
    this.camera = new THREE.OrthographicCamera(0, W, 0, -H, 0.1, 100);
    this.camera.position.set(0, 0, 10);
    this.layers = [];
    this.members = { atk: [], def: [] };

    // ---- 背景层 (480 高 -> 540, 宽按比例, 超出部分用于视差移动) ----
    const names = THEMES[theme] || THEMES.plains;
    const SCALE = H / 480;
    names.forEach((n, i) => {
      if (!n) return;
      const tex = loadTexSmooth(n);
      const imgW = n.includes('skybox') ? 854 : n.includes('foreground') ? 1200 : 1000;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(imgW * SCALE, H),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
      );
      m.position.set(W / 2, -H / 2, i);
      m.userData.parallax = PARALLAX[i] || 0;
      this.scene.add(m);
      this.layers.push(m);
    });

    // ---- 石台 (431x151 原生 1x, Nearest) + 成员 ----
    const platTex = loadTex('platform');
    for (const side of ['atk', 'def']) {
      const plat = new THREE.Mesh(
        new THREE.PlaneGeometry(431, 151),
        new THREE.MeshBasicMaterial({ map: platTex, transparent: true, opacity: 0.92, color: 0xb8c0c8 })
      );
      plat.position.set(SIDE_X[side], -(ROW_Y + 125), 2.4);
      this.scene.add(plat);
    }

    // ---- 刀光 / 抛射体 (复用); 刀光 150x61 -> 300x122 正好 2x ----
    this.slashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 122),
      new THREE.MeshBasicMaterial({ transparent: true })
    );
    this.slashMesh.visible = false;
    this.slashMesh.position.z = 6;
    this.scene.add(this.slashMesh);

    this.orb = new THREE.Group();
    const orbCore = new THREE.Mesh(
      new THREE.CircleGeometry(5, 12),
      new THREE.MeshBasicMaterial({ color: 0xd8f4ff })
    );
    const orbGlow = new THREE.Mesh(
      new THREE.CircleGeometry(11, 12),
      new THREE.MeshBasicMaterial({ color: 0x66c8ff, transparent: true, opacity: 0.45 })
    );
    this.orb.add(orbGlow, orbCore);
    this.orb.visible = false;
    this.orb.position.z = 6;
    this.scene.add(this.orb);
  }

  _buildMembers(side, snapshotArr) {
    const sign = side === 'atk' ? 1 : -1;
    // 素材全部朝左: 攻方(左侧)镜像朝右, 守方保持朝左 — 相向而立
    const flip = side === 'atk' ? -1 : 1;
    for (const s of snapshotArr) {
      if (!s.alive) continue;
      const anim = makeUnitTexture(s.sprite);
      anim.setFrame(0);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(UNIT, UNIT),
        new THREE.MeshBasicMaterial({ map: anim.texture, transparent: true, alphaTest: 0.1 })
      );
      mesh.scale.x = flip;
      const col = s.slot % 3, row = Math.floor(s.slot / 3);
      const x = SIDE_X[side] + sign * (col - 1) * COL_GAP;
      const y = ROW_Y + (row - 1) * ROW_GAP;
      mesh.position.set(x, -y, 2.5 + row * 0.1);   // 石台(2.4)之上, 前景草丛(3)之下
      // 脚下椭圆影
      const sh = new THREE.Mesh(
        BattleScene.shadowGeo,
        BattleScene.shadowMat
      );
      sh.position.set(0, UNIT * 0.44, -0.5);
      mesh.add(sh);
      this.scene.add(mesh);
      this.members[side].push({
        slot: s.slot, mesh, anim,
        phase: (s.slot * 1.3) % (Math.PI * 2),
        ranged: RANGED_WEAPONS.has(s.weaponKind) || (s.range || 1) >= 2,
      });
    }
  }

  memberOf(side, slot) {
    return this.members[side].find(m => m.slot === slot) || null;
  }

  // ---------------------------------------------------------------- 时基工具
  // 用固定步数驱动, 保证 headless 虚拟时间下也能完整播放
  sleepD(ms) {
    return new Promise(r => setTimeout(r, this.skip ? Math.min(ms, 30) : ms));
  }
  tweenD(ms, fn) {
    const steps = this.skip ? 2 : Math.max(1, Math.round(ms / 16));
    return new Promise(res => {
      let i = 0;
      const tick = () => {
        i++;
        fn(Math.min(1, i / steps));
        if (i < steps) setTimeout(tick, this.skip ? 8 : 16);
        else res();
      };
      setTimeout(tick, this.skip ? 8 : 16);
    });
  }

  addShake(mag) { this.shake = Math.max(this.shake, mag); }

  flash(m) {
    m.mesh.material.color.setScalar(2.6);
    setTimeout(() => m.mesh.material.color.setScalar(1), this.skip ? 40 : 130);
  }

  fadeOut(m) {
    this.tweenD(420, k => { m.mesh.material.opacity = 1 - k; })
      .then(() => { m.mesh.visible = false; });   // 连脚下落影一起隐藏
  }

  float(m, text, cls) {
    const s = document.createElement('span');
    s.className = 'bu-float' + (cls ? ' ' + cls : '');
    s.textContent = text;
    s.style.left = m.mesh.position.x + 'px';
    s.style.top = (-m.mesh.position.y - UNIT * 0.55) + 'px';
    this.ui.floats.appendChild(s);
    if (!this.frozen) setTimeout(() => s.remove(), 1100);
  }

  updateBars() {
    for (const side of ['atk', 'def']) {
      const arr = this.state[side];
      const hp = arr.reduce((s, m) => s + (m.alive ? m.hp : 0), 0);
      const max = arr.reduce((s, m) => s + m.maxhp, 0);
      const el = this.ui.root.querySelector(`.bu-side.${side}`);
      el.querySelector('.bu-bar i').style.width = (max ? hp / max * 100 : 0) + '%';
      el.querySelector('.bu-hp-num').textContent = `${hp}/${max}`;
    }
  }

  // ---------------------------------------------------------------- 事件播放
  async playEvent(ev) {
    const other = ev.side === 'atk' ? 'def' : 'atk';
    const actor = this.memberOf(ev.side, ev.actorSlot);
    if (!actor) return;

    if (ev.kind === 'levelup') {
      this.float(actor, 'LEVEL UP!', 'kill');
      this.addShake(2);
      await this.sleepD(650);
      return;
    }

    if (ev.kind === 'heal') {
      const target = this.memberOf(ev.side, ev.targetSlot);
      const st = this.state[ev.side].find(m => m.slot === ev.targetSlot);
      if (st) st.hp = ev.hpAfter;
      if (target) {
        this.float(target, `+${ev.amount}`, 'heal');
        const s0 = target.mesh.scale.x;
        await this.tweenD(300, k => {
          const p = Math.sin(k * Math.PI) * 0.18;
          target.mesh.scale.set(s0 * (1 + p), s0 * (1 + p), 1);
        });
        target.mesh.scale.set(s0, s0, 1);
      }
      this.updateBars();
      await this.sleepD(260);
      return;
    }

    const targets = ev.targets
      .map(t => ({ t, m: this.memberOf(other, t.slot) }))
      .filter(x => x.m);
    if (!targets.length) return;
    const sign = ev.side === 'atk' ? 1 : -1;
    const applyHits = () => this.applyHits(ev, other, targets);

    if (actor.ranged) {
      // 弓/法: 抛射光点
      const from = actor.mesh.position;
      const to = targets[0].m.mesh.position;
      this.orb.visible = true;
      await this.tweenD(220, k => {
        this.orb.position.x = from.x + (to.x - from.x) * k;
        this.orb.position.y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 46;
      });
      this.orb.visible = false;
      applyHits();
      await this.sleepD(420);
    } else {
      // 近战: 前冲 -> 刀光 -> 退回
      const ax = actor.mesh.position.x;
      const lungeTo = targets[0].m.mesh.position.x - sign * (UNIT + 14);
      await this.tweenD(160, k => { actor.mesh.position.x = ax + (lungeTo - ax) * easeOut(k); });
      await this.playSlash(actor, sign, applyHits);
      await this.tweenD(160, k => { actor.mesh.position.x = lungeTo + (ax - lungeTo) * easeOut(k); });
      actor.mesh.position.x = ax;
      await this.sleepD(140);
    }
  }

  async playSlash(actor, sign, onHit) {
    const frames = sign > 0 ? this.slashTex : this.slashTexF;
    const m = this.slashMesh;
    m.material.map = frames[0];
    m.material.needsUpdate = true;
    m.position.set(actor.mesh.position.x + sign * 26, actor.mesh.position.y, 6);
    m.visible = true;
    actor.mesh.visible = false;
    for (let i = 0; i < 3; i++) {
      m.material.map = frames[i];
      m.material.needsUpdate = true;
      if (i === 1 && onHit) onHit();
      await this.sleepD(85);
    }
    if (this.frozen) await new Promise(() => {});   // freeze 模式: 保持刀光画面
    m.visible = false;
    actor.mesh.visible = true;
  }

  applyHits(ev, other, targets) {
    for (const { t, m } of targets) {
      const st = this.state[other].find(mm => mm.slot === t.slot);
      if (t.miss) {
        this.float(m, 'MISS', 'miss');
      } else {
        if (st) { st.hp = t.hpAfter; if (t.killed) st.alive = false; }
        this.float(m, `-${t.dmg}`, t.killed ? 'kill' : '');
        this.flash(m);
        this.addShake(t.killed ? 7 : 4);
        if (t.killed) this.fadeOut(m);
      }
    }
    this.updateBars();
  }

  // ---------------------------------------------------------------- 主流程
  // freezeAt: debug 用 — 播放到第 N 个事件时冻结画面 (不清理不关闭), 便于截图
  play(playback, theme = 'plains', freezeAt = null) {
    return new Promise(async resolve => {
      this.skip = false;
      this.frozen = false;
      this._initScene(theme);
      this._buildMembers('atk', playback.sides.atk);
      this._buildMembers('def', playback.sides.def);
      this.state = {
        atk: playback.sides.atk.map(m => ({ ...m })),
        def: playback.sides.def.map(m => ({ ...m })),
      };

      // DOM: 队名 + HP 条
      const root = this.ui.root;
      root.querySelector('.bu-side.atk .bu-name').textContent = playback.atkName;
      root.querySelector('.bu-side.def .bu-name').textContent = playback.defName;
      this.updateBars();
      const onSkip = () => { this.skip = true; };
      root.addEventListener('click', onSkip);
      window.addEventListener('keydown', onSkip);

      this.active = true;
      document.getElementById('stage').classList.add('in-battle');
      this.ui.fade.style.opacity = 1;
      await new Promise(r => setTimeout(r, 320));
      root.style.display = 'block';
      this.ui.floats.style.display = 'block';
      this.ui.fade.style.opacity = 0;
      await this.sleepD(360);

      for (let i = 0; i < playback.events.length; i++) {
        if (freezeAt !== null && i === freezeAt) this.frozen = true;
        await this.playEvent(playback.events[i]);
        if (this.frozen) await new Promise(() => {});   // 冻结: 保持当前画面
      }
      await this.sleepD(700);

      // 收场
      root.removeEventListener('click', onSkip);
      window.removeEventListener('keydown', onSkip);
      this.ui.fade.style.opacity = 1;
      await new Promise(r => setTimeout(r, 320));
      root.style.display = 'none';
      this.ui.floats.innerHTML = '';
      this.ui.floats.style.display = 'none';
      this.active = false;
      document.getElementById('stage').classList.remove('in-battle');
      this.ui.fade.style.opacity = 0;
      resolve();
    });
  }

  // 每帧 (主渲染循环调用): 视差 / 待机动画 / 震屏
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const t = this.time;
    for (const layer of this.layers) {
      const p = layer.userData.parallax;
      layer.position.x = W / 2 + Math.sin(t * 0.16 + p) * p;
    }
    for (const side of ['atk', 'def']) {
      for (const m of this.members[side]) {
        if (!m.mesh.visible) continue;
        m.anim.setFrame(Math.floor(t * 6 + m.phase) % 4);   // 行走序列 0,1,2,1
      }
    }
    if (this.shake > 0.2) {
      this.camera.position.x = (Math.random() - 0.5) * this.shake;
      this.camera.position.y = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.001, dt);   // 快速衰减
    } else {
      this.camera.position.x = 0;
      this.camera.position.y = 0;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// 共享落影
BattleScene.shadowGeo = new THREE.CircleGeometry(30, 16);
BattleScene.shadowGeo.scale(1, 0.36, 1);
BattleScene.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
