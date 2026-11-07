// Изометрическая сцена: рельеф, постройки, поселенцы, корабли.
import * as THREE from 'three';

const SKY_NIGHT = new THREE.Color(0x2a3a54);
const SKY_DUSK = new THREE.Color(0xd79a6c);
const SKY_DAY = new THREE.Color(0xc3d6df);
const SUN_NIGHT = new THREE.Color(0x6c86b8);
const SUN_DAY = new THREE.Color(0xfff1d4);
const CARRY_COLORS = {
  wood: 0x8a6a45, stone: 0x9aa0a6, food: 0xd9b45a, gold: 0xe2b45c,
  tools: 0xc0743a, weapons: 0xb04a3a, faith: 0xc9b0e8,
  ore: 0x7c7468, grain: 0xd9c07a, flour: 0xe8dcc0,
};

export const ROLE_COLORS = {
  builder: 0xe2b45a,
  lumberjack: 0x8a6a45,
  miner: 0xa3a3a3,
  blacksmith: 0xc0743a,
  farmer: 0x8fc46b,
  herder: 0xc98d5a,
  priest: 0xd9d2ea,
  guard: 0x8d9bb5,
  idle: 0xcfc6b8,
};

const matCache = new Map();
function mat(color, opts = {}) {
  const key = `${color}|${opts.rough ?? 0.9}|${opts.metal ?? 0}|${opts.flat ? 1 : 0}|${opts.opacity ?? 1}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.9,
      metalness: opts.metal ?? 0,
      flatShading: !!opts.flat,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
    }));
  }
  return matCache.get(key);
}

function box(w, h, d, color, x = 0, y = 0, z = 0, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function pyramid(w, h, d, color, x = 0, y = 0, z = 0) {
  const hw = w / 2;
  const hd = d / 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, 0, h, 0,
  ], 3));
  geo.setIndex([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 3, 2, 0, 2, 1]);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat(color, { flat: true }));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const PANTS = [0x3b4a6b, 0x4a3b2f, 0x2f3f35, 0x5a4a6b, 0x3f3f46];
const SKINS = [0xe8c39e, 0xd9a97e, 0xb5835a, 0xf0d0b0, 0x8d5f3d];
const HAIRS = [0x3b2b1f, 0x6b4a2f, 0x1f1a17, 0xa87b3f, 0x8c8c8c];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function shade(color, k = 0.72) {
  return new THREE.Color(color).multiplyScalar(k).getHex();
}

// Спрайт с ником над пешкой
function makeNameSprite(text) {
  const raw = String(text);
  const label = raw.length > 15 ? `${raw.slice(0, 14)}…` : raw;
  const font = 'bold 40px "Segoe UI", system-ui, sans-serif';
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const textWidth = Math.ceil(measure.measureText(label).width);
  const pad = 26;
  const w = textWidth + pad * 2;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(2, 2, w - 4, h - 4, 20);
  else ctx.rect(2, 2, w - 4, h - 4);
  ctx.fillStyle = 'rgba(24, 19, 14, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(226, 180, 92, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f6eddd';
  ctx.fillText(label, w / 2, h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(material);
  const height = 0.38;
  sprite.userData.baseW = height * (w / h);
  sprite.userData.baseH = height;
  sprite.scale.set(height * (w / h), height, 1);
  sprite.renderOrder = 5;
  return sprite;
}

// ---------------------------------------------------------------- модели построек

function houseModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.96, 0.14, h * 0.96, 0x8a7a63, 0, 0, 0));
  g.add(box(w * 0.78, 1.15, h * 0.78, 0xe8d9bd, 0, 0.13, 0));
  g.add(box(w * 0.82, 0.1, h * 0.82, 0xc7b28d, 0, 1.28, 0));
  g.add(pyramid(w * 1.02, 0.8, h * 1.02, 0x9c4a37, 0, 1.34, 0));
  g.add(box(0.3, 0.52, 0.08, 0x6b4a2f, 0, 0.13, h * 0.39));
  g.add(box(0.16, 0.16, 0.06, 0x4a3524, 0, 0.68, h * 0.39 + 0.02));
  g.add(box(0.18, 0.55, 0.18, 0x9c9389, w * 0.22, 1.55, -h * 0.18));
  g.add(box(0.16, 0.16, 0.04, 0x6b7f8c, -w * 0.2, 0.78, h * 0.39 + 0.01));
  return g;
}

function townhallModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.98, 1.05, h * 0.98, 0x9d968c, 0, 0, 0));
  g.add(box(w * 0.88, 0.12, h * 0.88, 0x8b847a, 0, 1.05, 0));
  g.add(box(w * 0.82, 0.95, h * 0.82, 0xeadfc7, 0, 1.17, 0));
  g.add(box(w * 0.86, 0.1, h * 0.86, 0xcbb693, 0, 2.12, 0));
  g.add(pyramid(w * 0.94, 1.2, h * 0.94, 0x7d3f33, 0, 2.22, 0));
  g.add(cyl(0.025, 0.025, 0.85, 0xc9bda6, 0, 3.4, 0, 6));
  g.add(box(0.34, 0.2, 0.03, 0xd9a441, 0.19, 4.02, 0));
  // дверь и окна
  g.add(box(0.42, 0.62, 0.08, 0x5d4630, 0, 0, h * 0.49));
  for (const sx of [-0.28, 0.28]) {
    g.add(box(0.22, 0.3, 0.06, 0x5f7480, sx * w * 0.7, 0.45, h * 0.49));
    g.add(box(0.22, 0.28, 0.06, 0x5f7480, sx * w * 0.6, 1.45, h * 0.41));
  }
  return g;
}

function churchModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.72, 0.18, h * 0.9, 0x9a938a, -w * 0.06, 0, 0));
  g.add(box(w * 0.66, 1.3, h * 0.8, 0xefe6d4, -w * 0.06, 0.17, 0));
  g.add(pyramid(w * 0.72, 0.9, h * 0.86, 0x5d6b7a, -w * 0.06, 1.45, 0));
  g.add(box(w * 0.26, 2.1, h * 0.26, 0xe6dcc8, w * 0.32, 0.17, h * 0.28));
  g.add(pyramid(w * 0.32, 1.1, h * 0.32, 0x5d6b7a, w * 0.32, 2.27, h * 0.28));
  g.add(box(0.05, 0.34, 0.05, 0xd9c07a, w * 0.32, 3.4, h * 0.28));
  g.add(box(0.2, 0.05, 0.05, 0xd9c07a, w * 0.32, 3.55, h * 0.28));
  g.add(box(0.34, 0.6, 0.08, 0x6b4a2f, -w * 0.06, 0.17, h * 0.4 + 0.01));
  return g;
}

function barracksModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.92, 0.16, h * 0.92, 0x8d8578, 0, 0, 0));
  g.add(box(w * 0.82, 1.0, h * 0.78, 0xb9b1a3, 0, 0.15, 0));
  g.add(pyramid(w * 0.9, 0.55, h * 0.88, 0x6b3b30, 0, 1.14, 0));
  g.add(box(0.36, 0.62, 0.08, 0x4d3a28, 0, 0.15, h * 0.4));
  for (const sx of [-1, 1]) {
    g.add(cyl(0.025, 0.025, 1.5, 0x8a7250, sx * w * 0.38, 0.5, h * 0.36, 5));
    g.add(box(0.26, 0.4, 0.02, 0xa8483a, sx * w * 0.38 + 0.14, 1.5, h * 0.36));
  }
  for (let i = 0; i < 3; i++) g.add(box(0.1, 0.55, 0.1, 0x9b8a6d, w * 0.3 + i * 0.14, 0.15, -h * 0.34));
  return g;
}

function millModel(w, h) {
  const g = new THREE.Group();
  g.add(cyl(w * 0.42, w * 0.48, 2.1, 0xd9cbb1, 0, 0, 0, 12));
  g.add(cyl(w * 0.5, w * 0.5, 0.12, 0xbcae94, 0, 2.1, 0, 12));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.56, 0.7, 12), mat(0x7d3f33));
  roof.position.set(0, 2.55, 0);
  roof.castShadow = true;
  g.add(roof);
  g.add(box(0.34, 0.5, 0.1, 0x6b4a2f, 0, 0, w * 0.42));
  const blades = new THREE.Group();
  blades.position.set(0, 1.75, w * 0.55);
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.rotation.z = (i * Math.PI) / 2;
    const blade = box(0.14, 1.2, 0.05, 0xe6d9bf, 0, 0.1, 0);
    holder.add(blade);
    blades.add(holder);
  }
  blades.add(cyl(0.09, 0.09, 0.12, 0x6b4a2f, 0, -0.06, 0, 8));
  g.add(blades);
  g.userData.spin = blades;
  return g;
}

function fieldModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.94, 0.06, h * 0.94, 0x6b5a33, 0, 0, 0));
  for (let i = 0; i < 5; i++) {
    const z = -h * 0.36 + (i * h * 0.72) / 4;
    g.add(box(w * 0.84, 0.04, 0.1, 0x54462a, 0, 0.05, z));
    for (let j = 0; j < 6; j++) {
      const x = -w * 0.36 + (j * w * 0.72) / 5;
      g.add(box(0.06, 0.12, 0.06, 0x8db45a, x, 0.06, z));
    }
  }
  return g;
}

function pastureModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.94, 0.05, h * 0.94, 0x76a057, 0, 0, 0));
  const post = (x, z) => {
    g.add(box(0.07, 0.42, 0.07, 0xb59b74, x, 0.03, z));
  };
  for (let i = 0; i <= 4; i++) {
    const t = -0.45 + i * 0.225;
    post(t * w, -h * 0.44);
    post(t * w, h * 0.44);
    post(-w * 0.44, t * h);
    post(w * 0.44, t * h);
  }
  for (let i = 0; i < 2; i++) {
    const x = (i === 0 ? -1 : 1) * w * 0.16;
    const z = (i === 0 ? -1 : 1) * h * 0.1;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 7), mat(0xf0ece2));
    body.scale.set(1.3, 1, 1.9);
    body.position.set(x, 0.2, z);
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0x3b342c));
    head.position.set(x + 0.16, 0.27, z + 0.2);
    g.add(head);
  }
  return g;
}

function bakeryModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.96, 0.14, h * 0.96, 0x8a7a63, 0, 0, 0));
  g.add(box(w * 0.78, 1.05, h * 0.78, 0xead6b0, 0, 0.13, 0));
  g.add(box(w * 0.82, 0.1, h * 0.82, 0xc9b48d, 0, 1.18, 0));
  g.add(pyramid(w * 1.0, 0.7, h * 1.0, 0x8c5136, 0, 1.24, 0));
  // печная труба
  g.add(box(0.28, 1.0, 0.28, 0x9a8f82, w * 0.24, 1.2, -h * 0.18));
  g.add(box(0.34, 0.12, 0.34, 0x7d736a, w * 0.24, 2.2, -h * 0.18));
  // витрина с хлебом
  g.add(box(0.34, 0.24, 0.06, 0x5f4a2f, 0, 0.55, h * 0.4));
  for (let i = 0; i < 3; i++) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), mat(0xc98d4a));
    bun.scale.set(1.3, 0.8, 1);
    bun.position.set(-0.1 + i * 0.1, 0.84, h * 0.43);
    bun.castShadow = true;
    g.add(bun);
  }
  return g;
}

function warehouseModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.9, 0.16, h * 0.9, 0x8d8578, 0, 0, 0));
  g.add(box(w * 0.84, 1.1, h * 0.84, 0xcbb894, 0, 0.15, 0));
  g.add(pyramid(w * 0.92, 0.5, h * 0.92, 0x6f5641, 0, 1.25, 0));
  g.add(box(0.5, 0.7, 0.08, 0x5d4630, 0, 0.15, h * 0.42));
  for (let i = 0; i < 3; i++) g.add(cyl(0.1, 0.1, 0.26, 0x8a6a44, -w * 0.32 + i * 0.24, 0.05, h * 0.46, 8));
  return g;
}

function lumbercampModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.94, 0.06, h * 0.94, 0x6f5c40, 0, 0, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(box(0.08, 0.9, 0.08, 0x8a6a44, sx * w * 0.34, 0.06, sz * h * 0.34));
  }
  g.add(box(w * 0.82, 0.08, h * 0.82, 0x8b6d47, 0, 0.95, 0));
  for (let i = 0; i < 4; i++) {
    const log = cyl(0.09, 0.09, 0.9, 0x6b4a2f, -w * 0.1, 0.12 + i * 0.02, h * 0.1 + i * 0.19, 7);
    log.rotation.z = Math.PI / 2;
    g.add(log);
  }
  g.add(cyl(0.16, 0.18, 0.22, 0x7a5a38, w * 0.28, 0.06, -h * 0.2, 8));
  return g;
}

function mineModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.94, 0.06, h * 0.94, 0x7c7770, 0, 0, 0));
  const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(w * 0.5, 0), mat(0x8b8b86, { flat: true }));
  mound.scale.set(1.1, 0.7, 1);
  mound.position.set(-w * 0.08, 0.3, -h * 0.08);
  mound.castShadow = true;
  g.add(mound);
  g.add(box(0.42, 0.55, 0.12, 0x231f1a, w * 0.1, 0.06, h * 0.36));
  g.add(box(0.06, 0.6, 0.06, 0x8a6a44, -w * 0.12, 0.06, h * 0.4));
  g.add(box(0.06, 0.6, 0.06, 0x8a6a44, w * 0.3, 0.06, h * 0.4));
  g.add(box(0.5, 0.08, 0.08, 0x8a6a44, w * 0.09, 0.62, h * 0.4));
  g.add(box(0.08, 0.03, 0.5, 0x5a5550, 0, 0.07, h * 0.2));
  return g;
}

function forgeModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.92, 0.14, h * 0.92, 0x8a7a63, 0, 0, 0));
  g.add(box(w * 0.72, 0.95, h * 0.72, 0xa8a19a, 0, 0.13, 0));
  g.add(pyramid(w * 0.82, 0.5, h * 0.82, 0x6b3a30, 0, 1.08, 0));
  g.add(box(0.26, 0.55, 0.26, 0x7d7770, w * 0.26, 1.0, -h * 0.2));
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.22, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xff9a4a }),
  );
  glow.position.set(0, 0.4, h * 0.37);
  g.add(glow);
  g.add(box(0.44, 0.5, 0.1, 0x4a423a, 0, 0.13, h * 0.37));
  g.add(box(0.3, 0.12, 0.16, 0x4a4844, -w * 0.3, 0.2, h * 0.3));
  g.add(box(0.1, 0.14, 0.1, 0x4a4844, -w * 0.3, 0.06, h * 0.3));
  for (let i = 0; i < 3; i++) g.add(box(0.04, 0.5, 0.04, 0x6b6a66, w * 0.34 + i * 0.07, 0.14, h * 0.34));
  return g;
}

function wellModel() {
  const g = new THREE.Group();
  g.add(cyl(0.34, 0.36, 0.42, 0x9a938a, 0, 0, 0, 12));
  g.add(cyl(0.28, 0.28, 0.04, 0x2f4a58, 0, 0.4, 0, 12));
  for (const sx of [-1, 1]) g.add(box(0.06, 0.6, 0.06, 0x8a6a44, sx * 0.28, 0.1, 0));
  g.add(pyramid(0.8, 0.3, 0.5, 0x7d3f33, 0, 0.68, 0));
  g.add(cyl(0.02, 0.02, 0.3, 0x5d5044, 0.06, 0.42, 0, 5));
  return g;
}

function wallModel() {
  const g = new THREE.Group();
  g.add(box(0.9, 0.75, 0.9, 0x9b968d, 0, 0, 0));
  g.add(box(0.96, 0.1, 0.96, 0xaba69c, 0, 0.75, 0));
  g.add(box(0.2, 0.18, 0.2, 0x8d887f, -0.24, 0.85, -0.24));
  g.add(box(0.2, 0.18, 0.2, 0x8d887f, 0.24, 0.85, 0.24));
  return g;
}

function fenceModel() {
  const g = new THREE.Group();
  for (const sx of [-0.34, 0.34]) g.add(box(0.08, 0.62, 0.08, 0x9c7a4e, sx, 0, 0));
  g.add(box(0.86, 0.07, 0.05, 0xb08d5f, 0, 0.26, 0));
  g.add(box(0.86, 0.07, 0.05, 0xb08d5f, 0, 0.48, 0));
  return g;
}

function tavernModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.9, 0.14, h * 0.9, 0x8a7a63, 0, 0, 0));
  g.add(box(w * 0.8, 1.0, h * 0.8, 0xdcc9a5, 0, 0.13, 0));
  g.add(pyramid(w * 0.94, 0.6, h * 0.94, 0x8a5136, 0, 1.13, 0));
  g.add(box(0.3, 0.5, 0.08, 0x5d4630, 0, 0.13, h * 0.4));
  g.add(box(0.34, 0.22, 0.04, 0xc9a24a, w * 0.42, 0.9, h * 0.1));
  g.add(cyl(0.1, 0.1, 0.3, 0x7d5a37, -w * 0.36, 0.06, h * 0.36, 8));
  return g;
}

function graveModel() {
  const g = new THREE.Group();
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), mat(0x5f5238));
  mound.scale.set(1, 0.35, 1.4);
  mound.position.y = 0.06;
  mound.receiveShadow = true;
  g.add(mound);
  g.add(box(0.05, 0.42, 0.05, 0x6f6a60, 0, 0.1, -0.12));
  g.add(box(0.2, 0.05, 0.05, 0x6f6a60, 0, 0.34, -0.12));
  return g;
}

function portModel(w, h) {
  const g = new THREE.Group();
  g.add(box(w * 0.98, 0.16, h * 0.98, 0x9c8358, 0, 0.28, 0));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(0.12, 0.3, 0.12, 0x6b5234, sx * w * 0.4, -0.02, sz * h * 0.4));
    }
  }
  g.add(box(0.8, 0.7, 0.7, 0xcbb894, w * 0.24, 0.44, -h * 0.22));
  g.add(pyramid(0.95, 0.4, 0.85, 0x6f5641, w * 0.24, 1.14, -h * 0.22));
  for (let i = 0; i < 2; i++) g.add(box(0.26, 0.26, 0.26, 0xa98a5f, -w * 0.3 + i * 0.3, 0.44, h * 0.2));
  g.add(cyl(0.05, 0.05, 1.6, 0x6b5234, -w * 0.42, 0.44, -h * 0.36, 6));
  g.add(box(0.7, 0.06, 0.06, 0x6b5234, -w * 0.2, 2.0, -h * 0.36));
  g.add(box(0.03, 0.5, 0.03, 0x4a4038, -w * 0.02, 1.5, -h * 0.36));
  return g;
}

function roadTile() {
  return new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.05, 0.96), mat(0xb8a179));
}

function constructionModel(w, h, progress) {
  const g = new THREE.Group();
  g.add(box(w * 0.94, 0.05, h * 0.94, 0x7a6a4e, 0, 0, 0));
  const p = Math.max(0.08, progress);
  g.add(box(w * 0.72, 0.95 * p, h * 0.72, 0xd8c9ad, 0, 0.05, 0, { opacity: 0.95 }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(box(0.07, 1.15, 0.07, 0x8a6a44, sx * w * 0.4, 0.05, sz * h * 0.4));
  }
  g.add(box(w * 0.86, 0.05, 0.07, 0x8a6a44, 0, 1.2, -h * 0.4));
  // стройматериалы
  for (let i = 0; i < 3; i++) g.add(box(0.34, 0.09, 0.12, 0xb08850, w * 0.28, 0.07 + i * 0.09, h * 0.3));
  for (let i = 0; i < 2; i++) g.add(box(0.16, 0.14, 0.16, 0x9a938a, -w * 0.3, 0.06 + i * 0.14, h * 0.3));
  return g;
}

// ---------------------------------------------------------------- сцена

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc3d6df);
    this.scene.fog = new THREE.Fog(0xc3d6df, 70, 150);

    this.viewHeight = 24;
    this.zoom = 1;
    this.azimuth = Math.PI * 0.25;
    this.azimuthTarget = this.azimuth;
    this.elevation = 0.72;
    this.distance = 70;
    this.target = new THREE.Vector3(26, 0, 26);

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 300);

    this.pawnNodes = new Map();
    this.raiderNodes = new Map();
    this.buildingNodes = new Map();
    this.shipNodes = new Map();
    this.roadsKey = '';
    this.mapVersion = -1;
    this.selected = null;
    this.moveMode = false;
    this.labelsVisible = true;
    this.labelScale = 1;
    this._sky = new THREE.Color();
    this.onSelect = null;
    this.onGround = null;
    this.hovered = null;

    this.initLights();
    this.initMarkers();
    this.initControls();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  initLights() {
    const hemi = new THREE.HemisphereLight(0xdceaf2, 0x5b5340, 1.05);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1d4, 2.1);
    sun.position.set(46, 62, 28);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 180;
    const s = 42;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0009;
    sun.target.position.set(26, 0, 26);
    this.scene.add(sun);
    this.scene.add(sun.target);

    const fill = new THREE.DirectionalLight(0xbcd4e6, 0.35);
    fill.position.set(-30, 20, -20);
    this.scene.add(fill);

    this.hemi = hemi;
    this.sun = sun;
    this.fill = fill;
  }

  initMarkers() {
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.46, 24),
      new THREE.MeshBasicMaterial({ color: 0xe2b45c, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.moveMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.3, 20),
      new THREE.MeshBasicMaterial({ color: 0x8fc46b, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.moveMarker.rotation.x = -Math.PI / 2;
    this.moveMarker.visible = false;
    this.scene.add(this.moveMarker);
    this.moveMarkerLife = 0;
  }

  initControls() {
    let dragging = false;
    let button = 0;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;
    let space = false;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') space = true;
      if (e.code === 'KeyQ') this.azimuthTarget -= Math.PI / 8;
      if (e.code === 'KeyE') this.azimuthTarget += Math.PI / 8;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') space = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !space && !e.shiftKey) button = 0;
      else button = 1;
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) {
        this.hoverAt(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) {
        this.canvas.classList.add('dragging');
        this.pan(dx, dy);
      }
    });

    this.canvas.addEventListener('pointerup', (e) => {
      this.canvas.classList.remove('dragging');
      const wasClick = moved <= 4;
      dragging = false;
      if (!wasClick) return;
      if (button === 0) this.clickAt(e.clientX, e.clientY);
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0012);
      this.zoom = Math.min(3.2, Math.max(0.55, this.zoom * factor));
    }, { passive: false });
  }

  pan(dx, dy) {
    const k = (this.viewHeight / this.zoom) / this.canvas.clientHeight;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    right.y = 0;
    right.normalize();
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    this.target.addScaledVector(right, -dx * k);
    this.target.addScaledVector(fwd, dy * k);
    const m = 10;
    const w = this.map?.w ?? 52;
    const h = this.map?.h ?? 52;
    this.target.x = Math.max(-m, Math.min(w + m, this.target.x));
    this.target.z = Math.max(-m, Math.min(h + m, this.target.z));
  }

  ndc(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  pickAt(clientX, clientY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const groups = [...this.pawnNodes.values(), ...this.buildingNodes.values()];
    const hits = ray.intersectObjects(groups, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData.kind) node = node.parent;
      if (node?.userData.kind) return { kind: node.userData.kind, id: node.userData.id };
    }
    return null;
  }

  groundAt(clientX, clientY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, point)) return null;
    return { x: point.x, z: point.z };
  }

  hoverAt(clientX, clientY) {
    const hit = this.pickAt(clientX, clientY);
    this.canvas.classList.toggle('pointing', !!hit);
    this.hovered = hit;
    if (this.onHover) this.onHover(hit, clientX, clientY);
  }

  clickAt(clientX, clientY) {
    const hit = this.pickAt(clientX, clientY);
    if (hit) {
      this.onSelect?.(hit.kind, hit.id);
      return;
    }
    const ground = this.groundAt(clientX, clientY);
    this.onGround?.(ground);
  }

  select(kind, id) {
    this.selected = kind && id ? { kind, id } : null;
    if (!this.selected) this.selectionRing.visible = false;
  }

  focusOn(x, z, zoom = 1.6) {
    this.target.set(x, 0, z);
    this.zoom = zoom;
  }

  // показать пешку на 30 секунд и вернуть камеру назад
  focusPawnFor(id, seconds = 30) {
    const pawn = this.state?.pawns.find((p) => p.id === id);
    if (!pawn) return false;
    if (!this._savedCam) {
      this._savedCam = { x: this.target.x, z: this.target.z, zoom: this.zoom };
    }
    this.followId = id;
    this.zoom = Math.max(this.zoom, 1.9);
    clearTimeout(this._focusTimer);
    this._focusTimer = setTimeout(() => this.releaseFocus(), seconds * 1000);
    return true;
  }

  releaseFocus() {
    this.followId = null;
    if (this._savedCam) {
      this.target.set(this._savedCam.x, 0, this._savedCam.z);
      this.zoom = this._savedCam.zoom;
      this._savedCam = null;
    }
  }

  showMoveMarker(x, z) {
    this.moveMarker.position.set(x, 0.08, z);
    this.moveMarker.visible = true;
    this.moveMarkerLife = 1.2;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.updateCamera();
  }

  updateCamera() {
    const vh = this.viewHeight / this.zoom;
    const vw = vh * (this.aspect || 1.7);
    this.camera.left = -vw / 2;
    this.camera.right = vw / 2;
    this.camera.top = vh / 2;
    this.camera.bottom = -vh / 2;
    this.camera.updateProjectionMatrix();

    const ce = Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * ce * this.distance,
      this.target.y + Math.sin(this.elevation) * this.distance,
      this.target.z + Math.cos(this.azimuth) * ce * this.distance,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------ карта

  setMap(map) {
    if (this.mapVersion === map.version && this.terrainGroup) return;
    this.map = map;
    this.mapVersion = map.version;
    if (this.terrainGroup) {
      this.scene.remove(this.terrainGroup);
      this.disposeGroup(this.terrainGroup);
    }
    this.terrainGroup = new THREE.Group();
    this.buildTerrain(map);
    this.scene.add(this.terrainGroup);
  }

  buildTerrain(map) {
    const { w, h, tiles } = map;
    const group = this.terrainGroup;
    const palette = {
      0: [0x6f9a52, 0x749f57, 0x679149, 0x79a55c],
      2: [0xd8c590, 0xd2bd86, 0xdccb9b],
      3: [0x4e7740, 0x49703a, 0x547f47],
      4: [0x8b8b86, 0x82827d],
    };
    const positions = [];
    const colors = [];
    const indices = [];
    const color = new THREE.Color();
    let v = 0;
    const trees = [];
    const rocks = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y * w + x];
        if (t === 1) continue;
        const set = palette[t] ?? palette[0];
        const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        color.setHex(set[hash % set.length]);
        color.multiplyScalar(1 + ((hash % 97) / 97 - 0.5) * 0.06);
        const y0 = t === 4 ? 0.1 : 0;
        positions.push(x, y0, y, x, y0, y + 1, x + 1, y0, y + 1, x + 1, y0, y);
        for (let i = 0; i < 4; i++) colors.push(color.r, color.g, color.b);
        indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
        v += 4;
        if (t === 3 && (hash % 100) > 22) trees.push({ x, y, hash });
        if (t === 4 && (hash % 100) > 40) rocks.push({ x, y, hash });
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    ground.receiveShadow = true;
    group.add(ground);

    // вода
    const waterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLight: { value: 1 } },
      transparent: true,
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uLight;
        varying vec3 vWorld;
        void main() {
          float a = sin(vWorld.x * 0.85 + uTime * 0.9);
          float b = sin(vWorld.z * 1.25 - uTime * 0.65);
          float c = sin((vWorld.x + vWorld.z) * 0.5 + uTime * 0.4);
          vec3 deep = vec3(0.09, 0.28, 0.42);
          vec3 light = vec3(0.22, 0.50, 0.62);
          float m = a * 0.3 + b * 0.25 + c * 0.2 + 0.5;
          vec3 col = mix(deep, light, clamp(m, 0.0, 1.0));
          col *= mix(0.4, 1.0, uLight);
          gl_FragColor = vec4(col, 0.95);
        }`,
    });
    this.waterMat = waterMat;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, h), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(w / 2, -0.22, h / 2);
    group.add(water);

    const bed = new THREE.Mesh(new THREE.PlaneGeometry(w + 30, h + 30), mat(0x2b3a34));
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(w / 2, -0.6, h / 2);
    group.add(bed);

    // деревья
    if (trees.length) {
      const trunkIM = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.06, 0.09, 0.42, 5),
        mat(0x6b4a2f), trees.length,
      );
      const leafIM = new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.4, 1.0, 7),
        mat(0x3f6f3a, { flat: true }), trees.length,
      );
      trunkIM.castShadow = true;
      leafIM.castShadow = true;
      leafIM.receiveShadow = true;
      const dummy = new THREE.Object3D();
      const c = new THREE.Color();
      trees.forEach((t, i) => {
        const jx = (t.hash % 60) / 60 - 0.5;
        const jy = ((t.hash >> 6) % 60) / 60 - 0.5;
        const scale = 0.75 + ((t.hash >> 3) % 40) / 100;
        dummy.position.set(t.x + 0.5 + jx * 0.5, 0.21, t.y + 0.5 + jy * 0.5);
        dummy.scale.setScalar(scale);
        dummy.rotation.y = (t.hash % 360) / 57;
        dummy.updateMatrix();
        trunkIM.setMatrixAt(i, dummy.matrix);
        dummy.position.y = 0.42 + 0.5 * scale;
        dummy.updateMatrix();
        leafIM.setMatrixAt(i, dummy.matrix);
        c.setHSL(0.28 + ((t.hash >> 4) % 20) / 400, 0.36, 0.28 + ((t.hash >> 8) % 12) / 100);
        leafIM.setColorAt(i, c);
      });
      if (leafIM.instanceColor) leafIM.instanceColor.needsUpdate = true;
      group.add(trunkIM, leafIM);
    }

    // скалы
    if (rocks.length) {
      const rockIM = new THREE.InstancedMesh(
        new THREE.DodecahedronGeometry(0.34, 0),
        mat(0x8f8f8a, { flat: true }), rocks.length,
      );
      rockIM.castShadow = true;
      rockIM.receiveShadow = true;
      const dummy = new THREE.Object3D();
      rocks.forEach((r, i) => {
        const scale = 0.7 + ((r.hash >> 3) % 50) / 100;
        dummy.position.set(r.x + 0.5, 0.18 + scale * 0.1, r.y + 0.5);
        dummy.scale.set(scale, scale * (0.7 + ((r.hash >> 5) % 30) / 100), scale);
        dummy.rotation.set(r.hash % 3, r.hash % 6, r.hash % 4);
        dummy.updateMatrix();
        rockIM.setMatrixAt(i, dummy.matrix);
      });
      group.add(rockIM);
    }
  }

  // ------------------------------------------------------------ состояние

  applyState(state) {
    this.state = state;
    this.applyDay(state.day);
    this.applyPawns(state.pawns);
    this.applyBuildings(state.buildings);
    this.applyRoads(state.roads);
    this.applyShips(state.ships);
    this.applyRaiders(state.raiders);
    this.updateSelectionRing();
  }

  applyDay(day) {
    if (!day) return;
    this.day = day;
    this.updateDayNight(day.progress);
  }

  updateDayNight(p) {
    const angle = (p - 0.25) * Math.PI * 2;
    const elev = Math.sin(angle);
    const dayness = Math.max(0, Math.min(1, (elev + 0.12) / 0.45));

    this.sunOffset = { x: Math.cos(angle) * 70, z: 30 };
    this.sunHeight = Math.max(18, Math.abs(elev) * 80);
    this.sun.position.set(this.target.x + this.sunOffset.x, this.sunHeight, this.target.z + this.sunOffset.z);
    this.sun.intensity = 0.42 + dayness * 1.68;
    this.sun.color.copy(SUN_NIGHT).lerp(SUN_DAY, dayness);
    this.hemi.intensity = 0.72 + dayness * 0.38;
    this.hemi.color.setHex(dayness > 0.45 ? 0xdceaf2 : 0x6c7f9c);
    this.fill.intensity = 0.25 + dayness * 0.15;

    const sky = this._sky;
    if (elev < 0) sky.copy(SKY_NIGHT).lerp(SKY_DUSK, Math.min(1, (elev + 0.42) / 0.42));
    else sky.copy(SKY_DUSK).lerp(SKY_DAY, Math.min(1, elev / 0.4));
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.renderer.toneMappingExposure = 0.96 + dayness * 0.1;

    if (this.waterMat) this.waterMat.uniforms.uLight.value = dayness;

    const windows = mat(0x6b7f8c);
    windows.emissive.setHex(0xffb45a);
    windows.emissiveIntensity = (1 - dayness) * 0.9;
  }

  applyPawns(pawns) {
    const seen = new Set();
    for (const p of pawns) {
      seen.add(p.id);
      let node = this.pawnNodes.get(p.id);
      if (!node) {
        node = this.makePawn(p);
        this.pawnNodes.set(p.id, node);
        this.scene.add(node);
      }
      node.userData.target.set(p.x, 0, p.y);
      node.userData.dir = p.dir;
      node.userData.dead = p.dead;
      node.userData.wounded = !!p.wounded;
      node.userData.walking = p.state === 'walk' || p.state === 'build';
      if (node.userData.role !== p.role) {
        node.userData.role = p.role;
        this.repaintPawn(node, p.role);
      }
      const carryMesh = node.userData.carryMesh;
      if (carryMesh) {
        carryMesh.visible = !!p.carry;
        if (p.carry && node.userData.carryKind !== p.carry) {
          node.userData.carryKind = p.carry;
          carryMesh.material = mat(CARRY_COLORS[p.carry] ?? 0x8a6a45);
        }
      }
    }
    for (const [id, node] of this.pawnNodes) {
      if (!seen.has(id)) {
        this.scene.remove(node);
        const label = node.userData.label;
        if (label) {
          label.material.map?.dispose();
          label.material.dispose();
        }
        this.disposeGroup(node);
        this.pawnNodes.delete(id);
      }
    }
  }

  makePawn(p) {
    const g = new THREE.Group();
    const hash = hashString(`${p.login || p.name || 'pawn'}${p.id}`);
    const shirt = ROLE_COLORS[p.role] ?? 0xcfc6b8;
    const pants = PANTS[hash % PANTS.length];
    const skin = SKINS[(hash >> 3) % SKINS.length];
    const hair = HAIRS[(hash >> 6) % HAIRS.length];

    // голова и волосы
    const head = box(0.2, 0.2, 0.2, skin, 0, 0.52, 0);
    const hairMesh = box(0.21, 0.06, 0.21, hair, 0, 0.72, 0);
    hairMesh.name = 'hair';

    // туловище (футболка в цвет профессии)
    const body = box(0.22, 0.26, 0.13, shirt, 0, 0.26, 0);
    body.name = 'shirt';

    // руки и ноги — на шарнирах, чтобы качать при ходьбе
    const armL = new THREE.Group();
    armL.position.set(-0.145, 0.5, 0);
    const armLMesh = box(0.07, 0.24, 0.07, shirt, 0, -0.24, 0);
    armLMesh.name = 'shirt';
    armL.add(armLMesh);

    const armR = new THREE.Group();
    armR.position.set(0.145, 0.5, 0);
    const armRMesh = box(0.07, 0.24, 0.07, shirt, 0, -0.24, 0);
    armRMesh.name = 'shirt';
    armR.add(armRMesh);

    const legL = new THREE.Group();
    legL.position.set(-0.06, 0.26, 0);
    legL.add(box(0.09, 0.26, 0.09, pants, 0, -0.26, 0));

    const legR = new THREE.Group();
    legR.position.set(0.06, 0.26, 0);
    legR.add(box(0.09, 0.26, 0.09, pants, 0, -0.26, 0));

    // шляпа/каска в цвете роли
    const hat = box(0.22, 0.06, 0.22, shade(shirt), 0, 0.72, 0);
    hat.name = 'hat';

    const shadowDot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), new THREE.MeshBasicMaterial({ color: 0x1a1a12, transparent: true, opacity: 0.22 }));
    shadowDot.rotation.x = -Math.PI / 2;
    shadowDot.position.y = 0.02;

    g.add(head, hairMesh, body, hat, armL, armR, legL, legR, shadowDot);

    const label = makeNameSprite(p.name);
    label.position.set(0, 1.06, 0);
    label.visible = this.labelsVisible;
    g.add(label);

    const carryMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.24), mat(0x8a6a45));
    carryMesh.position.set(0, 0.34, -0.2);
    carryMesh.castShadow = true;
    carryMesh.visible = false;
    g.add(carryMesh);

    g.position.set(p.x, 0, p.y);
    g.scale.setScalar(1.15);
    g.userData = {
      kind: 'pawn',
      id: p.id,
      label,
      carryMesh,
      armL,
      armR,
      legL,
      legR,
      role: p.role,
      target: new THREE.Vector3(p.x, 0, p.y),
      dir: p.dir,
      phase: Math.random() * 6,
      walking: false,
      dead: false,
    };
    return g;
  }

  repaintPawn(node, role) {
    const color = ROLE_COLORS[role] ?? 0xcfc6b8;
    node.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'shirt') o.material = mat(color);
      else if (o.name === 'hat') o.material = mat(shade(color));
    });
  }

  applyBuildings(buildings) {
    const seen = new Set();
    for (const b of buildings) {
      seen.add(b.id);
      let node = this.buildingNodes.get(b.id);
      const sig = `${b.type}|${b.built}|${b.w}|${b.h}|${b.rot ?? 0}`;
      const progressStep = b.built ? 1 : Math.round(b.progress * 8) / 8;
      if (!node) {
        node = new THREE.Group();
        node.userData = { kind: 'building', id: b.id, sig: '', progress: -1 };
        node.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
        this.buildingNodes.set(b.id, node);
        this.scene.add(node);
      }
      node.rotation.y = b.rot ?? 0;
      if (node.userData.sig !== sig || (!b.built && node.userData.progress !== progressStep)) {
        node.clear();
        const model = b.built
          ? this.buildingModel(b)
          : constructionModel(b.w, b.h, b.progress);
        node.add(model);
        node.userData.sig = sig;
        node.userData.progress = progressStep;
        node.userData.spin = model.userData.spin ?? null;
      }
    }
    for (const [id, node] of this.buildingNodes) {
      if (!seen.has(id)) {
        this.scene.remove(node);
        this.disposeGroup(node);
        this.buildingNodes.delete(id);
      }
    }
  }

  buildingModel(b) {
    switch (b.type) {
      case 'townhall': return townhallModel(b.w, b.h);
      case 'house': return houseModel(b.w, b.h);
      case 'church': return churchModel(b.w, b.h);
      case 'barracks': return barracksModel(b.w, b.h);
      case 'mill': return millModel(b.w, b.h);
      case 'forge': return forgeModel(b.w, b.h);
      case 'bakery': return bakeryModel(b.w, b.h);
      case 'field': return fieldModel(b.w, b.h);
      case 'pasture': return pastureModel(b.w, b.h);
      case 'warehouse': return warehouseModel(b.w, b.h);
      case 'lumbercamp': return lumbercampModel(b.w, b.h);
      case 'mine': return mineModel(b.w, b.h);
      case 'well': return wellModel();
      case 'wall': return wallModel();
      case 'fence': return fenceModel();
      case 'tavern': return tavernModel(b.w, b.h);
      case 'grave': return graveModel();
      case 'port': return portModel(b.w, b.h);
      default: return houseModel(b.w, b.h);
    }
  }

  applyRoads(roads) {
    const key = `${roads.length}`;
    if (key === this.roadsKey) return;
    this.roadsKey = key;
    if (this.roadsGroup) {
      this.scene.remove(this.roadsGroup);
      this.disposeGroup(this.roadsGroup);
    }
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.94, 0.05, 0.94);
    const material = mat(0xb8a179);
    const count = roads.length / 2;
    const inst = new THREE.InstancedMesh(geo, material, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(roads[i * 2] + 0.5, 0.03, roads[i * 2 + 1] + 0.5);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.receiveShadow = true;
    group.add(inst);
    this.roadsGroup = group;
    this.scene.add(group);
  }

  applyShips(ships) {
    const seen = new Set();
    for (const s of ships) {
      seen.add(s.id);
      let node = this.shipNodes.get(s.id);
      if (!node) {
        node = this.makeShip();
        this.shipNodes.set(s.id, node);
        this.scene.add(node);
      }
      node.userData.target.set(s.x, 0, s.y);
    }
    for (const [id, node] of this.shipNodes) {
      if (!seen.has(id)) {
        this.scene.remove(node);
        this.disposeGroup(node);
        this.shipNodes.delete(id);
      }
    }
  }

  applyRaiders(raiders) {
    const seen = new Set();
    for (const r of raiders || []) {
      seen.add(r.id);
      let node = this.raiderNodes.get(r.id);
      if (!node) {
        node = this.makeRaider(r);
        this.raiderNodes.set(r.id, node);
        this.scene.add(node);
      }
      node.userData.target.set(r.x, 0, r.y);
      node.userData.dir = r.dir;
      node.userData.hp = r.hp;
      if (node.userData.hpBar) {
        node.userData.hpBar.scale.x = 0.8 * Math.max(0, Math.min(1, r.hp / 100));
      }
    }
    for (const [id, node] of this.raiderNodes) {
      if (!seen.has(id)) {
        this.scene.remove(node);
        this.disposeGroup(node);
        this.raiderNodes.delete(id);
      }
    }
  }

  makeRaider(r) {
    const g = new THREE.Group();
    const zombie = r.kind === 'zombies';
    const raider = r.kind === 'raid';
    const bodyColor = zombie ? 0x6f8f5a : raider ? 0x6b4fa8 : 0x8c3a2f;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.42, 7), mat(bodyColor));
    body.position.y = 0.22;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 7), mat(zombie ? 0x9ab57c : raider ? 0xd8c8e8 : 0xe0b58e));
    head.position.y = 0.52;
    head.castShadow = true;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.16, 6), mat(zombie ? 0x44513a : raider ? 0x2f2350 : 0x3b342c));
    hat.position.y = 0.64;
    g.add(body, head, hat);
    if (!zombie) {
      const handle = box(0.05, 0.5, 0.05, 0x6b5a44, 0.2, 0.1, 0.05);
      handle.rotation.z = -0.45;
      g.add(handle);
      const blade = box(0.16, 0.14, 0.04, raider ? 0x9fb4e0 : 0xb0b0ac, 0.33, 0.55, 0.05);
      g.add(blade);
    }
    const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x120f0c, transparent: true, opacity: 0.65 }));
    hpBg.center.set(0, 0.5);
    hpBg.scale.set(0.8, 0.08, 1);
    hpBg.position.set(-0.4, 1.02, 0);
    const hpBar = new THREE.Sprite(new THREE.SpriteMaterial({ color: zombie ? 0x8fc46b : 0xd1735f }));
    hpBar.center.set(0, 0.5);
    hpBar.scale.set(0.8, 0.06, 1);
    hpBar.position.set(-0.4, 1.02, 0.001);
    g.add(hpBg, hpBar);
    g.scale.setScalar(1.15);
    g.position.set(r.x, 0, r.y);
    g.userData = {
      kind: 'raider',
      id: r.id,
      target: new THREE.Vector3(r.x, 0, r.y),
      dir: r.dir,
      phase: Math.random() * 6,
      hpBar,
      hp: r.hp,
    };
    return g;
  }

  makeShip() {
    const g = new THREE.Group();
    const hull = box(2.6, 0.42, 0.92, 0x6b4a2f, 0, 0.05, 0);
    g.add(hull);
    g.add(box(2.2, 0.08, 0.8, 0xa98a5f, 0, 0.47, 0));
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.9, 4), mat(0x6b4a2f, { flat: true }));
    bow.rotation.z = -Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.position.set(1.72, 0.26, 0);
    bow.castShadow = true;
    g.add(bow);
    g.add(cyl(0.05, 0.06, 2.0, 0x8a6a44, -0.1, 0.5, 0, 6));
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), mat(0xece3d2, { double: true }));
    sail.position.set(-0.1, 1.6, 0);
    sail.rotation.y = Math.PI / 2;
    sail.castShadow = true;
    g.add(sail);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), mat(0xa8483a, { double: true }));
    flag.position.set(-0.1, 2.55, 0.16);
    g.add(flag);
    g.userData = { target: new THREE.Vector3(), phase: Math.random() * 6 };
    return g;
  }

  updateSelectionRing() {
    const sel = this.selected;
    if (!sel) { this.selectionRing.visible = false; return; }
    if (sel.kind === 'pawn') {
      const node = this.pawnNodes.get(sel.id);
      if (!node) { this.selectionRing.visible = false; return; }
      this.selectionRing.position.set(node.position.x, 0.05, node.position.z);
      this.selectionRing.visible = true;
    } else {
      const node = this.buildingNodes.get(sel.id);
      if (!node) { this.selectionRing.visible = false; return; }
      this.selectionRing.position.set(node.position.x, 0.05, node.position.z);
      this.selectionRing.scale.setScalar(2.2);
      this.selectionRing.visible = true;
    }
    if (sel.kind === 'pawn') this.selectionRing.scale.setScalar(1);
  }

  disposeGroup(group) {
    group.traverse((obj) => {
      if (obj.geometry && !obj.isSprite) obj.geometry.dispose();
    });
  }

  setLabels(visible) {
    this.labelsVisible = visible;
    for (const node of this.pawnNodes.values()) {
      if (node.userData.label) node.userData.label.visible = visible;
    }
  }

  // ------------------------------------------------------------ кадр

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    this.azimuth += (this.azimuthTarget - this.azimuth) * Math.min(1, dt * 8);
    if (this.followId && this.state) {
      const pawn = this.state.pawns.find((p) => p.id === this.followId);
      if (pawn) this.target.lerp(new THREE.Vector3(pawn.x, 0, pawn.y), Math.min(1, dt * 4));
    }
    this.updateCamera();
    if (this.sun && this.sunOffset) {
      this.sun.position.set(this.target.x + this.sunOffset.x, this.sunHeight ?? 60, this.target.z + this.sunOffset.z);
      this.sun.target.position.set(this.target.x, 0, this.target.z);
    }
    if (this.waterMat) this.waterMat.uniforms.uTime.value = t;

    for (const node of this.pawnNodes.values()) {
      const u = node.userData;
      const dx = u.target.x - node.position.x;
      const dz = u.target.z - node.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.01) {
        const k = Math.min(1, dt * 9);
        node.position.x += dx * k;
        node.position.z += dz * k;
        u.phase += dt * 10;
      }
      if (dist > 0.05) {
        const targetRot = Math.atan2(dx, dz);
        let delta = targetRot - node.rotation.y;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        node.rotation.y += delta * Math.min(1, dt * 10);
      }
      const bob = u.walking ? Math.abs(Math.sin(u.phase)) * 0.045 : Math.sin(t * 1.6 + u.phase) * 0.012;
      node.position.y = bob;
      const tilt = u.wounded ? 1.15 : 0;
      node.rotation.z += (tilt - node.rotation.z) * Math.min(1, dt * 4);
      // анимация ходьбы: руки и ноги качаются в противофазе
      const sway = u.walking ? Math.sin(u.phase) * 0.65 : Math.sin(t * 1.4 + u.phase) * 0.06;
      if (u.armL) u.armL.rotation.x = sway;
      if (u.armR) u.armR.rotation.x = -sway;
      if (u.legL) u.legL.rotation.x = -sway * 0.85;
      if (u.legR) u.legR.rotation.x = sway * 0.85;
      const label = u.label;
      if (label && label.visible) {
        const k = (1 / Math.max(0.6, this.zoom)) * (this.labelScale || 1);
        label.scale.set(label.userData.baseW * k, label.userData.baseH * k, 1);
      }
      if (u.dead) {
        node.position.y -= Math.min(0.45, (node.userData.deadTime = (node.userData.deadTime ?? 0) + dt) * 0.4);
        node.rotation.z = Math.min(1.3, (node.userData.deadTime ?? 0) * 1.4);
      }
    }

    for (const node of this.raiderNodes.values()) {
      const u = node.userData;
      const dx = u.target.x - node.position.x;
      const dz = u.target.z - node.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.02) {
        node.position.x += dx * Math.min(1, dt * 7);
        node.position.z += dz * Math.min(1, dt * 7);
        u.phase += dt * 9;
        const targetRot = Math.atan2(dx, dz);
        let delta = targetRot - node.rotation.y;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        node.rotation.y += delta * Math.min(1, dt * 8);
      }
      node.position.y = Math.abs(Math.sin(u.phase)) * 0.05;
      if (u.hpBar) u.hpBar.scale.x = 0.8 * Math.max(0, Math.min(1, u.hp / 100));
    }

    for (const node of this.shipNodes.values()) {      const u = node.userData;
      node.position.x += (u.target.x - node.position.x) * Math.min(1, dt * 4);
      node.position.z += (u.target.z - node.position.z) * Math.min(1, dt * 4);
      node.position.y = Math.sin(t * 1.2 + u.phase) * 0.05;
      node.rotation.z = Math.sin(t * 0.9 + u.phase) * 0.02;
    }

    for (const node of this.buildingNodes.values()) {
      const spin = node.userData.spin;
      if (spin) spin.rotation.z += dt * 0.9;
    }

    if (this.moveMarkerLife > 0) {
      this.moveMarkerLife -= dt;
      const s = 1 + Math.sin(t * 8) * 0.12;
      this.moveMarker.scale.setScalar(s);
      this.moveMarker.material.opacity = Math.max(0, Math.min(1, this.moveMarkerLife));
      if (this.moveMarkerLife <= 0) this.moveMarker.visible = false;
    }

    this.selectionRing.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;

    this.renderer.render(this.scene, this.camera);
  }
}
