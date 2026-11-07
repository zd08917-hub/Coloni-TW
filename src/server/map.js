// Карта деревни: генерация рельефа, занятость клеток постройками, поиск пути A*.

export const TERRAIN = { GRASS: 0, WATER: 1, SAND: 2, FOREST: 3, ROCK: 4 };
export const TERRAIN_LABEL = { 0: 'grass', 1: 'water', 2: 'sand', 3: 'forest', 4: 'rock' };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameMap {
  constructor(w, h, seed = 1) {
    this.w = w;
    this.h = h;
    this.t = new Uint8Array(w * h);
    this.occ = new Int32Array(w * h); // id постройки, занимающей клетку
    this.roads = new Set(); // "x,y" — проложенные дороги
    this.version = 1;
    this.seed = seed;
    this.generate(seed);
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  terrainAt(x, y) { return this.inBounds(x, y) ? this.t[this.idx(x, y)] : TERRAIN.WATER; }
  setTerrain(x, y, value) {
    if (!this.inBounds(x, y)) return;
    this.t[this.idx(x, y)] = value;
    this.version++;
  }
  occAt(x, y) { return this.inBounds(x, y) ? this.occ[this.idx(x, y)] : -1; }
  setOcc(x, y, id) { if (this.inBounds(x, y)) this.occ[this.idx(x, y)] = id; }
  isRoad(x, y) { return this.roads.has(`${x},${y}`); }
  addRoad(x, y) { this.roads.add(`${x},${y}`); }

  generate(seed) {
    const rnd = mulberry32(seed);
    const { w, h, t } = this;

    for (let y = 0; y < h; y++) {
      const shore = Math.round(7 + 2.4 * Math.sin(y * 0.24) + 1.5 * Math.sin(y * 0.09 + 1.7));
      for (let x = 0; x < w; x++) {
        let kind = TERRAIN.GRASS;
        if (x < shore) kind = TERRAIN.WATER;
        else if (x < shore + 2) kind = TERRAIN.SAND;
        t[this.idx(x, y)] = kind;
      }
    }

    // скалы на севере — там будет шахта
    for (let i = 0; i < 70; i++) {
      const cx = 22 + Math.floor(rnd() * (w - 24));
      const cy = 2 + Math.floor(rnd() * 13);
      const r = 1 + rnd() * 2;
      this.blob(cx, cy, r, TERRAIN.ROCK, rnd);
    }
    // лес кластерами
    for (let i = 0; i < 110; i++) {
      const cx = 12 + Math.floor(rnd() * (w - 14));
      const cy = 8 + Math.floor(rnd() * (h - 12));
      const r = 1 + rnd() * 1.9;
      this.blob(cx, cy, r, TERRAIN.FOREST, rnd);
    }

    // центр под ратушу — расчищаем
    this.clearRect(20, 21, 11, 11, TERRAIN.GRASS);
    // коридор от порта к ратуше
    const portY = 26;
    for (let x = 5; x < 24; x++) {
      for (let dy = 0; dy <= 1; dy++) {
        const y = portY + dy;
        if (this.terrainAt(x, y) !== TERRAIN.WATER) this.t[this.idx(x, y)] = x < 11 ? TERRAIN.SAND : TERRAIN.GRASS;
      }
    }
    for (let y = 22; y <= portY + 1; y++) this.t[this.idx(23, y)] = TERRAIN.GRASS;
    // площадка порта: аккуратный берег, вода остаётся водой
    for (let y = 19; y <= 34; y++) {
      const shore = Math.round(7 + 2.4 * Math.sin(y * 0.24) + 1.5 * Math.sin(y * 0.09 + 1.7));
      for (let x = 0; x < 14; x++) {
        this.t[this.idx(x, y)] = x < shore
          ? TERRAIN.WATER
          : (x < shore + 3 ? TERRAIN.SAND : TERRAIN.GRASS);
      }
    }
    this.version++;
  }

  blob(cx, cy, radius, kind, rnd) {
    const r = Math.ceil(radius);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!this.inBounds(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > radius + rnd() * 0.6) continue;
        if (this.terrainAt(x, y) === TERRAIN.WATER) continue;
        this.t[this.idx(x, y)] = kind;
      }
    }
  }

  clearRect(x0, y0, w0, h0, kind) {
    for (let y = y0; y < y0 + h0; y++) {
      for (let x = x0; x < x0 + w0; x++) {
        if (this.inBounds(x, y)) this.t[this.idx(x, y)] = kind;
      }
    }
  }

  // расширение карты: старые земли сохраняются, новые генерируются процедурно
  grow(add = 8) {
    const oldW = this.w;
    const oldH = this.h;
    const newW = oldW + add;
    const newH = oldH + add;
    const t = new Uint8Array(newW * newH);
    const occ = new Int32Array(newW * newH);
    for (let y = 0; y < oldH; y++) {
      for (let x = 0; x < oldW; x++) {
        t[y * newW + x] = this.t[y * oldW + x];
        occ[y * newW + x] = this.occ[y * oldW + x];
      }
    }
    this.t = t;
    this.occ = occ;
    this.w = newW;
    this.h = newH;
    this.generateExpansion(oldW, oldH);
    this.version++;
  }

  generateExpansion(oldW, oldH) {
    const rnd = mulberry32(this.seed ^ (this.w * 31 + this.h));
    const addW = this.w - oldW;
    const addH = this.h - oldH;

    // новая земля по умолчанию — трава
    for (let y = 0; y < this.h; y++) {
      for (let x = oldW; x < this.w; x++) this.t[this.idx(x, y)] = TERRAIN.GRASS;
    }
    for (let y = oldH; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) this.t[this.idx(x, y)] = TERRAIN.GRASS;
      // береговая линия продолжается на юг
      const shore = Math.round(7 + 2.4 * Math.sin(y * 0.24) + 1.5 * Math.sin(y * 0.09 + 1.7));
      for (let x = 0; x < Math.min(shore + 3, this.w); x++) {
        this.t[this.idx(x, y)] = x < shore ? TERRAIN.WATER : TERRAIN.SAND;
      }
    }

    // сохраняем старую часть, чтобы кластеры не залезли на готовую деревню
    const backup = new Uint8Array(oldW * oldH);
    for (let y = 0; y < oldH; y++) {
      for (let x = 0; x < oldW; x++) backup[y * oldW + x] = this.t[this.idx(x, y)];
    }

    for (let i = 0; i < addW * 5; i++) {
      const cx = oldW + Math.floor(rnd() * addW);
      const cy = Math.floor(rnd() * this.h);
      this.blob(cx, cy, 1.2 + rnd() * 2.2, rnd() < 0.72 ? TERRAIN.FOREST : TERRAIN.ROCK, rnd);
    }
    for (let i = 0; i < addH * 5; i++) {
      const cx = 2 + Math.floor(rnd() * (this.w - 4));
      const cy = oldH + Math.floor(rnd() * addH);
      this.blob(cx, cy, 1.2 + rnd() * 2.2, rnd() < 0.72 ? TERRAIN.FOREST : TERRAIN.ROCK, rnd);
    }

    for (let y = 0; y < oldH; y++) {
      for (let x = 0; x < oldW; x++) this.t[this.idx(x, y)] = backup[y * oldW + x];
    }
  }

  // проходимость: вода и скалы закрыты, постройки — по флагу solid
  walkable(x, y, solidIds) {
    if (!this.inBounds(x, y)) return false;
    const kind = this.t[this.idx(x, y)];
    if (kind === TERRAIN.WATER || kind === TERRAIN.ROCK) return false;
    const id = this.occ[this.idx(x, y)];
    if (id && solidIds && solidIds.has(id)) return false;
    return true;
  }

  stepCost(x, y) {
    if (!this.inBounds(x, y)) return Infinity;
    const kind = this.t[this.idx(x, y)];
    if (kind === TERRAIN.WATER || kind === TERRAIN.ROCK) return Infinity;
    if (this.isRoad(x, y)) return 0.6;
    if (kind === TERRAIN.FOREST) return 2.1;
    if (kind === TERRAIN.SAND) return 1.15;
    return 1;
  }

  nearestWalkable(x, y, solidIds, maxRadius = 8) {
    if (this.walkable(x, y, solidIds)) return { x, y };
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (this.walkable(nx, ny, solidIds)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }
}

// Двоичная куча для A*
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node, priority) {
    const a = this.a;
    a.push({ node, priority });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= a[i].priority) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority < a[m].priority) m = l;
        if (r < a.length && a[r].priority < a[m].priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export function findPath(map, sx, sy, tx, ty, solidIds, maxNodes = 6000) {
  if (!map.inBounds(sx, sy) || !map.inBounds(tx, ty)) return [];
  if (sx === tx && sy === ty) return [];
  if (!map.walkable(tx, ty, solidIds)) {
    const alt = map.nearestWalkable(tx, ty, solidIds, 6);
    if (!alt) return [];
    tx = alt.x; ty = alt.y;
  }
  const w = map.w;
  const start = sy * w + sx;
  const goal = ty * w + tx;
  const open = new Heap();
  const gScore = new Float32Array(map.w * map.h).fill(Infinity);
  const cameFrom = new Int32Array(map.w * map.h).fill(-1);
  const closed = new Uint8Array(map.w * map.h);
  gScore[start] = 0;
  open.push(start, 0);

  const hEst = (i) => {
    const x = i % w, y = (i / w) | 0;
    return Math.hypot(x - tx, y - ty) * 0.9;
  };

  let visited = 0;
  while (open.size) {
    const current = open.pop().node;
    if (current === goal) {
      const path = [];
      let node = current;
      while (node !== start && node !== -1) {
        path.push({ x: (node % w) + 0.5, y: ((node / w) | 0) + 0.5 });
        node = cameFrom[node];
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;
    if (++visited > maxNodes) break;

    const cx = current % w, cy = (current / w) | 0;
    for (const [dx, dy, mult] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!map.walkable(nx, ny, solidIds)) continue;
      if (dx && dy && (!map.walkable(cx + dx, cy, solidIds) || !map.walkable(cx, cy + dy, solidIds))) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const cost = map.stepCost(nx, ny) * mult;
      const tentative = gScore[current] + cost;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        cameFrom[ni] = current;
        open.push(ni, tentative + hEst(ni));
      }
    }
  }
  return [];
}
