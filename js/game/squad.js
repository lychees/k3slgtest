// squad.js — 部队: 小队棋子 (SPEC「玩法规则」第 1/2/6 条)
// 战术地图上每支部队只显示队长单人 sprite (完整 32x32 帧, 2x 整数缩放),
// 3x3 阵型只出现在信息面板和战斗场景。
import * as THREE from '../../lib/three.module.js';
import { defaultWeapon } from './data.js';
import { makeUnitTexture, DIR } from './sprites.js';

const SPRITE = 1.0;     // 队长 sprite 尺寸 (世界单位, 1 格 = 64px = 32px 源 2x 整数倍)

// 共享几何/材质
const shadowGeo = new THREE.CircleGeometry(0.34, 20);
shadowGeo.scale(1, 0.4, 1);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const ringGeo = new THREE.CircleGeometry(0.4, 24);
ringGeo.scale(1, 0.46, 1);
const ringMat = [
  new THREE.MeshBasicMaterial({ color: 0x3a66d8, transparent: true, opacity: 0.55, depthWrite: false }),
  new THREE.MeshBasicMaterial({ color: 0xd03428, transparent: true, opacity: 0.6, depthWrite: false }),
];

let counter = 0;

export class Squad {
  constructor(template, placement, db) {
    this.uid = `${template.id}#${++counter}`;
    this.template = template;
    this.db = db;
    this.name = template.name;
    this.team = placement.team;   // 0 = 玩家, 1 = 敌方
    this.x = placement.x;
    this.y = placement.y;
    this.done = false;
    this.artifacts = (template.artifacts || [])
      .map(id => db.itemsById[id])
      .filter(a => a && a.type === 'artifact');
    this.members = template.members.map(m => this._makeMember(m));
    this.leader = this.members.find(m => m.def.id === template.leader) || this.members[0];
    this.mov = this.leader.def.base.mov;   // 移动力 = 队长 MOV
    this.walking = false;
    this._build();
  }

  _makeMember(m) {
    const def = this.db.unitsById[m.unit];
    const wid = (this.template.weapon_items || {})[m.unit];
    const weapon = (wid && this.db.itemsById[wid]) || defaultWeapon(def, this.db);
    const skills = (def.skills || []).map(id => this.db.skillsById[id]).filter(Boolean);
    return {
      def, slot: m.slot, weapon, skills,
      maxhp: def.base.hp, hp: def.base.hp,
      alive: true,
    };
  }

  aliveMembers() { return this.members.filter(m => m.alive); }
  get wiped() { return this.aliveMembers().length === 0; }
  totalHp() { return this.aliveMembers().reduce((s, m) => s + m.hp, 0); }
  totalMaxHp() { return this.members.reduce((s, m) => s + m.maxhp, 0); }

  // 部队射程 = 存活成员武器最大 range
  rangeMax() {
    const alive = this.aliveMembers();
    return alive.length ? Math.max(...alive.map(m => m.weapon.range || 1)) : 1;
  }

  hasFlag(member, flag) { return member.skills.some(s => s.flag === flag); }

  // 有效属性 = 基础 + 自身 passive + 全队 aura + 神器加成
  eff(member, key) {
    let v = member.def.base[key] || 0;
    for (const s of member.skills) {
      if (s.type === 'passive' && s.effect && s.effect.stat === key) v += s.effect.mod;
    }
    for (const m of this.aliveMembers()) {
      for (const s of m.skills) {
        if (s.type === 'aura' && s.effect && s.effect.stat === key) v += s.effect.mod;
      }
    }
    for (const a of this.artifacts) {
      if (a.bonuses && a.bonuses[key]) v += a.bonuses[key];
    }
    return v;
  }

  // 威胁度 = 存活成员战力合计 (SPEC: 暂不影响数值, 仅面板显示)
  score() {
    let total = 0;
    for (const m of this.aliveMembers()) {
      total += m.hp / 2
        + this.eff(m, 'str') * 2 + this.eff(m, 'mag') * 2
        + this.eff(m, 'skl') + this.eff(m, 'arm') * 2
        + (m.weapon.might || 0);
    }
    return Math.round(total);
  }

  // 地图上显示的成员: 队长存活用队长, 否则用第一个存活成员
  displayMember() {
    return this.leader.alive ? this.leader : this.aliveMembers()[0];
  }

  // ---------------------------------------------------------------- 3D 表现
  _build() {
    this.group = new THREE.Group();

    // 队伍色底圈 (蓝 = 我军, 红 = 敌军)
    const ring = new THREE.Mesh(ringGeo, ringMat[this.team === 0 ? 0 : 1]);
    ring.position.set(0, -0.3, -0.02);
    this.group.add(ring);

    // 落影
    const sh = new THREE.Mesh(shadowGeo, shadowMat);
    sh.position.set(0, -0.32, -0.03);
    this.group.add(sh);

    // 队长单人 sprite (完整 32x32 帧)
    const dm = this.displayMember();
    this.anim = makeUnitTexture(dm.def.sprite);
    this.spriteName = dm.def.sprite;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SPRITE, SPRITE),
      new THREE.MeshBasicMaterial({ map: this.anim.texture, transparent: true, alphaTest: 0.1 })
    );
    this.group.add(this.mesh);

    // 总 HP 条 (队伍下方)
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x0a0e24 })
    );
    bg.position.set(0, -0.56, 0.01);
    const fgGeo = new THREE.PlaneGeometry(0.9, 0.06);
    fgGeo.translate(0.45, 0, 0);   // 左端锚定, scale.x 即血条比例
    this.hpFg = new THREE.Mesh(
      fgGeo,
      new THREE.MeshBasicMaterial({ color: this.team === 0 ? 0x46c258 : 0xe04848 })
    );
    this.hpFg.position.set(-0.45, -0.56, 0.02);
    this.group.add(bg, this.hpFg);

    this.setPos(this.x, this.y);
  }

  setPos(x, y) {
    this.x = x; this.y = y;
    this.group.position.set(x + 0.5, -(y + 0.5), 0);
  }

  updateHpBar() {
    const f = this.totalMaxHp() ? this.totalHp() / this.totalMaxHp() : 0;
    this.hpFg.scale.x = Math.max(0.0001, f);
  }

  setDone(v) {
    this.done = v;
    this.mesh.material.color.setScalar(v ? 0.55 : 1.0);
  }

  // 战斗结算后调用: 刷新血条; 队长阵亡则换成存活成员的 sprite
  syncDeadVisuals() {
    const dm = this.displayMember();
    if (dm && dm.def.sprite !== this.spriteName) {
      this.spriteName = dm.def.sprite;
      this.anim = makeUnitTexture(dm.def.sprite);
      this.mesh.material.map = this.anim.texture;
      this.mesh.material.needsUpdate = true;
    }
    this.updateHpBar();
  }

  // 行走方向 (移动动画时调用); null = 回待机。素材全部朝左, 向右走时水平镜像。
  setWalking(dir) {
    this.walking = dir !== null;
    this.mesh.scale.x = (this.walking && dir === DIR.RIGHT) ? -1 : 1;
  }

  // 每帧更新: 待机 ~6fps / 行走 ~10fps, 序列 0,1,2,1 (恒采块 row0, 不会切到别的变体)
  updateAnim(t) {
    if (!this.anim.animated) return;
    const fps = this.walking ? 10 : 6;
    this.anim.setFrame(Math.floor(t * fps) % 4);
  }
}
