// gfx.js — 纹理加载缓存 + 确定性伪随机
import * as THREE from '../../lib/three.module.js';

const texLoader = new THREE.TextureLoader();
const cache = {};

export function loadTex(name) {
  if (cache[name]) return cache[name];
  const t = texLoader.load(`assets/${name}.png`);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  cache[name] = t;
  return t;
}

// pseudo-random but deterministic
export function hash(x, y) { return (x * 7349 + y * 15487 + 97) % 100; }

// 绘制风大图用线性过滤 (非整数倍缩放不糊)
export function loadTexSmooth(name) {
  const key = name + '#smooth';
  if (cache[key]) return cache[key];
  const t = texLoader.load(`assets/${name}.png`);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  cache[key] = t;
  return t;
}
