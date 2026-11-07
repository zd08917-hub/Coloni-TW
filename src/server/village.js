// Деревня: поселенцы, постройки, экономика, голосования, корабли и смерть подписчиков.

import { GameMap, findPath, TERRAIN } from './map.js';
import {
  BUILDINGS, ROLES, ROLE_ORDER, CONFIG, LEVELS, levelForSubs, nextLevelFor, VOTABLE,
} from './defs.js';

const MAX_BUILDINGS = {
  house: 400, field: 10, pasture: 8, lumbercamp: 6, mine: 5, mill: 6, bakery: 6,
  warehouse: 6, barracks: 4, church: 3, tavern: 3, well: 4, wall: 60, fence: 80,
};

const BUILD_SLOTS = { church: 1, barracks: 4, field: 3, pasture: 3, mine: 3, lumbercamp: 2, townhall: 0 };

const round = (n) => Math.round(n * 100) / 100;

export class Village {
  constructor(seed = CONFIG.mapSeed) {
    this.map = new GameMap(CONFIG.map.w, CONFIG.map.h, seed);
    this.resources = { ...CONFIG.startingResources };
    this.buildings = new Map();
    this.pawns = [];
    this.ships = [];
    this.subs = new Map();
    this.orders = [];
    this.roads = this.map.roads;
    this.solidIds = new Set();
    this.feed = [];
    this.feedCursor = 0;
    this.vote = null;
    this.voteNumber = 0;
    this.voteTimer = CONFIG.vote.firstDelaySec;
    this.timeSec = 0;
    this.nextId = 1;
    this.level = 1;
    this.safety = 40;
    this.events = [];
    this.raiders = [];
    this.nextEventAt = CONFIG.event.firstDelaySec;
    this.expandAt = 10;
    this.onAnnounce = null;
    this.arrivalQueue = [];
    this.arrivalTimer = 0;
    this.joinCooldown = new Map();
    this.quietChat = false;
    this.allowAllJoin = false;
    this.followCheckAvailable = false;
    this.audience = null;
    this.excludeLogins = new Set();
    this.morale = 60;
    this.foodIn = 0;
    this.foodOut = 0;
    this.foodRate = 0;
    this.rateTimer = 0;
    this.capWarnAt = -999;
    this._jobTimer = 0;
    this._placeInitial();
    this.workSpots = this.collectWorkSpots();
    this.logEvent('Колония основана. Ратуша ждёт первых подписчиков', 'info');
  }

  // ---------------------------------------------------------------- начальная сцена

  _placeInitial() {
    const thX = Math.floor(this.map.w / 2) - 1;
    const thY = Math.floor(this.map.h / 2) - 1;
    this.townhall = this.createBuilding('townhall', thX, thY, { built: 1 });
    const shore = this.shoreAt(thY + 1);
    this.port = this.createBuilding('port', Math.max(1, shore - 2), thY - 1, { built: 1 });
    this.portX = shore + 1;
    this.portY = thY + 1;
    this.buildMainRoad();
  }

  layRoad(x, y) {
    if (this.map.occAt(x, y) !== 0) return;
    const kind = this.map.terrainAt(x, y);
    if (kind === TERRAIN.WATER || kind === TERRAIN.ROCK) return;
    this.map.addRoad(x, y);
  }

  // главная улица: от причала вниз, затем вдоль ратуши
  buildMainRoad() {
    const th = this.townhall;
    const tx = th.x + 1;
    const ty = th.y + th.h + 1;
    let x = this.portX;
    let y = this.portY;
    let guard = 0;
    this.layRoad(x, y);
    while (y !== ty && guard++ < 40) { y += Math.sign(ty - y); this.layRoad(x, y); }
    while (x !== tx && guard++ < 120) { x += Math.sign(tx - x); this.layRoad(x, y); }
  }

  shoreAt(y) {
    for (let x = 0; x < this.map.w; x++) if (this.map.terrainAt(x, y) !== TERRAIN.WATER) return x;
    return 0;
  }

  // клетки, рядом с которыми можно работать: опушка леса и подножие скал
  collectWorkSpots() {
    const forest = [];
    const rock = [];
    for (let y = 1; y < this.map.h - 1; y++) {
      for (let x = 1; x < this.map.w - 1; x++) {
        if (!this.map.walkable(x, y)) continue;
        let nearForest = false;
        let nearRock = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const kind = this.map.terrainAt(x + dx, y + dy);
            if (kind === TERRAIN.FOREST) nearForest = true;
            if (kind === TERRAIN.ROCK) nearRock = true;
          }
        }
        if (nearForest) forest.push({ x: x + 0.5, y: y + 0.5 });
        if (nearRock) rock.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
    return { forest, rock };
  }

  nearestSpot(pawn, list) {
    let best = null;
    for (const spot of list) {
      const d = Math.hypot(spot.x - pawn.x, spot.y - pawn.y);
      if (!best || d < best.d) best = { x: spot.x, y: spot.y, d };
    }
    return best;
  }

  spotFor(p) {
    if (p.workplaceId) {
      const b = this.buildings.get(p.workplaceId);
      if (b && b.built >= 1) return { x: b.x + b.w / 2, y: b.y + b.h / 2, r: Math.max(1.6, b.w) };
    }
    if (p.role === 'lumberjack') {
      const spot = this.nearestSpot(p, this.workSpots.forest);
      if (spot) return { x: spot.x, y: spot.y, r: 1.3 };
    }
    if (p.role === 'miner') {
      const spot = this.nearestSpot(p, this.workSpots.rock);
      if (spot) return { x: spot.x, y: spot.y, r: 1.3 };
    }
    // у кого нет своего здания — своя точка вокруг ратуши, чтобы не сбиваться в кучу
    const th = this.townhall;
    const cx = th.x + 1.5;
    const cy = th.y + 1.5;
    const angle = (p.id * 2.399963) % (Math.PI * 2);
    const radius = 5 + (p.id % 6) * 1.5;
    // перебираем углы, пока не найдём свободную клетку — иначе точка схлопывается к краю ратуши
    for (let k = 0; k < 10; k++) {
      const a = angle + k * 0.63;
      const x = Math.round(cx + Math.cos(a) * radius);
      const y = Math.round(cy + Math.sin(a) * radius);
      if (this.map.walkable(x, y, this.solidIds)) return { x: x + 0.5, y: y + 0.5, r: 1.2, relax: true };
    }
    return { x: cx, y: cy + 3, r: 2, relax: true };
  }

  // ---------------------------------------------------------------- утилиты

  get(id) { return this.buildings.get(id); }

  list(type) {
    const out = [];
    for (const b of this.buildings.values()) if (b.type === type) out.push(b);
    return out;
  }

  count(type) { return this.list(type).length; }

  slotsOf(b) { return BUILD_SLOTS[b.type] ?? 2; }

  costSum(cost = {}) { return Object.values(cost).reduce((s, v) => s + v, 0); }

  canAfford(cost = {}) {
    return Object.entries(cost).every(([k, v]) => (this.resources[k] ?? 0) >= v);
  }

  spend(cost = {}) {
    for (const [k, v] of Object.entries(cost)) this.resources[k] = Math.max(0, (this.resources[k] ?? 0) - v);
  }

  addRes(kind, amount) {
    this.resources[kind] = (this.resources[kind] ?? 0) + amount;
    if (kind === 'food') this.foodIn += amount;
  }

  // вместимость склада: база + каждый склад
  storageCap() {
    return 200 + 200 * this.count('warehouse');
  }

  // настроение: еда, вера, таверны, бездомные
  updateMorale(dt) {
    const alive = this.pawns.filter((p) => !p.dead).length;
    const need = Math.max(20, alive * 6);
    const foodRatio = Math.min(1, (this.resources.food ?? 0) / need);
    const faithBonus = Math.min(10, (this.resources.faith ?? 0) / 20);
    const taverns = Math.min(3, this.count('tavern'));
    const homeless = this.homelessCount();
    const target = 30 + foodRatio * 40 + faithBonus + taverns * 4 - Math.min(20, homeless * 1.2);
    this.morale += (target - this.morale) * Math.min(1, dt * 0.08);
    this.morale = Math.max(0, Math.min(100, this.morale));
  }

  // склад не резиновый: излишки портятся
  enforceStorage() {
    const cap = this.storageCap();
    let spoiled = false;
    for (const key of ['wood', 'stone', 'food', 'grain', 'flour', 'ore', 'tools', 'weapons']) {
      if ((this.resources[key] ?? 0) > cap) {
        this.resources[key] = cap;
        spoiled = true;
      }
    }
    if (spoiled && this.timeSec - this.capWarnAt > 60) {
      this.capWarnAt = this.timeSec;
      this.logEvent(`Склад переполнен (${cap}): излишки портятся. Постройте склад`, 'warn');
    }
  }

  announce(text) {
    if (text && this.onAnnounce) this.onAnnounce(text);
  }

  statusLine() {
    const alive = this.pawns.filter((p) => !p.dead).length;
    let vote = 'голосования нет';
    if (this.vote) {
      vote = `голосование #${this.vote.number}: ${this.vote.options.map((o) => `${o.key}) ${o.name}`).join(', ')} — голосуйте !1 !2 !3`;
    }
    return `Колония: ${alive} жителей, ${this.subs.size} подписчиков, ратуша ${this.level} ур., домов ${this.count('house')}. Дерево ${Math.floor(this.resources.wood)}, камень ${Math.floor(this.resources.stone)}, еда ${Math.floor(this.resources.food)}. ${vote}`;
  }

  logEvent(text, kind = 'info') {
    this.feed.push({ id: ++this.nextId, text, kind, t: Math.round(this.timeSec) });
    if (this.feed.length > 120) this.feed.shift();
  }

  drainFeed() {
    const fresh = this.feed.filter((e) => e.id > this.feedCursor);
    if (fresh.length) this.feedCursor = fresh[fresh.length - 1].id;
    return fresh;
  }

  capacity() {
    const caps = {};
    for (const role of ROLE_ORDER) caps[role] = this.level;
    // дома профессий дают +1 слот своей специальности
    for (const b of this.buildings.values()) {
      if (b.built < 1) continue;
      const bonus = BUILDINGS[b.type].jobBonus;
      if (!bonus) continue;
      for (const [role, n] of Object.entries(bonus)) caps[role] = (caps[role] ?? 0) + n;
    }
    return caps;
  }

  jobCounts() {
    const counts = { idle: 0 };
    for (const role of ROLE_ORDER) counts[role] = 0;
    for (const p of this.pawns) if (!p.dead) counts[p.role] = (counts[p.role] ?? 0) + 1;
    return counts;
  }

  computeSafety() {
    const guards = this.jobCounts().guard ?? 0;
    const weapons = Math.floor(this.resources.weapons ?? 0);
    return Math.min(100, Math.round(28 + guards * 6 + weapons * 1.5));
  }

  canSwitchRole(p) {
    if (p.roleChangedAt === undefined) return true;
    return this.timeSec - p.roleChangedAt >= CONFIG.roleChangeCooldownSec;
  }

  homelessCount() {
    return this.pawns.filter((p) => !p.dead && !p.homeId).length;
  }

  // ---------------------------------------------------------------- постройки

  createBuilding(type, x, y, opts = {}) {
    const def = BUILDINGS[type];
    const id = this.nextId++;
    const b = {
      id, type, x, y, w: def.w, h: def.h,
      built: opts.built ?? 0, progress: opts.built ? 1 : 0,
      occupantId: null, workers: [], name: opts.name ?? def.name,
      orderId: opts.orderId ?? null, createdAt: this.timeSec, timer: 0,
    };
    for (let ty = y; ty < y + def.h; ty++) {
      for (let tx = x; tx < x + def.w; tx++) this.map.setOcc(tx, ty, id);
    }
    if (def.solid) this.solidIds.add(id);
    this.buildings.set(id, b);
    return b;
  }

  removeBuilding(id) {
    const b = this.buildings.get(id);
    if (!b) return;
    const def = BUILDINGS[b.type];
    for (let ty = b.y; ty < b.y + def.h; ty++) {
      for (let tx = b.x; tx < b.x + def.w; tx++) if (this.map.occAt(tx, ty) === id) this.map.setOcc(tx, ty, 0);
    }
    this.solidIds.delete(id);
    this.buildings.delete(id);
  }

  isSiteFree(x, y, def, strict = true) {
    if (x < 9 || y < 2 || x + def.w > this.map.w - 1 || y + def.h > this.map.h - 1) return false;
    for (let ty = y; ty < y + def.h; ty++) {
      for (let tx = x; tx < x + def.w; tx++) {
        const kind = this.map.terrainAt(tx, ty);
        if (kind !== TERRAIN.GRASS && kind !== TERRAIN.SAND) return false;
        if (this.map.occAt(tx, ty) !== 0) return false;
        if (this.map.isRoad(tx, ty)) return false;
      }
    }
    // двор: минимум одна свободная клетка вокруг дома, иначе деревня слипается
    if (strict && def.type !== 'wall' && def.type !== 'fence') {
      for (let ty = y - 1; ty <= y + def.h; ty++) {
        for (let tx = x - 1; tx <= x + def.w; tx++) {
          const inside = tx >= x && tx < x + def.w && ty >= y && ty < y + def.h;
          if (inside) continue;
          if (this.map.occAt(tx, ty) !== 0) return false;
        }
      }
    }
    // не ставим постройку на головы поселенцам
    for (const p of this.pawns) {
      if (p.dead) continue;
      if (p.x > x - 0.6 && p.x < x + def.w + 0.6 && p.y > y - 0.6 && p.y < y + def.h + 0.6) return false;
    }
    return true;
  }

  hasNear(x, y, def, terrainKind) {
    for (let ty = y - 2; ty < y + def.h + 2; ty++) {
      for (let tx = x - 2; tx < x + def.w + 2; tx++) {
        if (this.map.terrainAt(tx, ty) === terrainKind) return true;
      }
    }
    return false;
  }

  touchesRoad(x, y, def) {
    for (let ty = y - 1; ty <= y + def.h; ty++) {
      for (let tx = x - 1; tx <= x + def.w; tx++) {
        if (tx >= x && tx < x + def.w && ty >= y && ty < y + def.h) continue;
        if (this.map.isRoad(tx, ty)) return true;
        if (this.map.occAt(tx, ty) === this.townhall?.id) return true;
      }
    }
    return false;
  }

  findSite(def) {
    const th = this.townhall;
    const cx = th.x + 1, cy = th.y + 1;
    // ищем по всей карте, но ближние места выгоднее по очкам
    const span = Math.min(this.map.w, this.map.h) * 0.85;
    const pick = (strict) => {
      let best = null;
      for (let y = 3; y < this.map.h - def.h - 1; y++) {
        for (let x = 9; x < this.map.w - def.w - 1; x++) {
          const d = Math.hypot(x + def.w / 2 - cx, y + def.h / 2 - cy);
          if (d > span) continue;
          if (best && d > best.score + 4) continue;
          if (!this.isSiteFree(x, y, def, strict)) continue;
          if (def.near === 'forest' && !this.hasNear(x, y, def, TERRAIN.FOREST)) continue;
          if (def.near === 'rock' && !this.hasNear(x, y, def, TERRAIN.ROCK)) continue;
          let score = d;
          if (this.touchesRoad(x, y, def)) score -= 3.5;
          if (def.near) score -= 1.5;
          // не лепим постройки друг к другу: так появляются улицы
          for (const other of this.buildings.values()) {
            if (other.type === 'road') continue;
            const ox = other.x + other.w / 2;
            const oy = other.y + other.h / 2;
            const dd = Math.hypot(ox - (x + def.w / 2), oy - (y + def.h / 2));
            if (dd < 3.4) score += (3.4 - dd) * 0.9;
          }
          if (def.type === 'house' || def.housing) score += Math.random() * 2;
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      return best;
    };
    // сначала с двором, а если места кончились — плотная застройка
    return pick(true) ?? pick(false);
  }

  nearestRoadTile(b) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    for (let r = 1; r <= 16; r++) {
      let best = null;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = Math.floor(cx + dx), y = Math.floor(cy + dy);
          if (!this.map.inBounds(x, y)) continue;
          if (!this.map.isRoad(x, y) && this.map.occAt(x, y) !== this.townhall?.id) continue;
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      if (best) return best;
    }
    return null;
  }

  connectRoads(b) {
    const target = this.nearestRoadTile(b);
    if (!target) return;
    const start = this.freeEdgeTile(b, target);
    if (!start) return;
    let x = start.x, y = start.y;
    let guard = 0;
    while ((x !== target.x || y !== target.y) && guard++ < 80) {
      const kind = this.map.terrainAt(x, y);
      if (this.map.occAt(x, y) === 0 && (kind === TERRAIN.GRASS || kind === TERRAIN.SAND)) this.map.addRoad(x, y);
      if (x !== target.x) x += Math.sign(target.x - x);
      else y += Math.sign(target.y - y);
    }
  }

  // разворот входом к ближайшей дороге
  orientBuilding(b) {
    const target = this.nearestRoadTile(b);
    if (!target) { b.rot = b.rot ?? 0; return; }
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = target.x + 0.5 - cx;
    const dy = target.y + 0.5 - cy;
    if (Math.abs(dx) > Math.abs(dy)) b.rot = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
    else b.rot = dy > 0 ? 0 : Math.PI;
  }

  freeEdgeTile(b, target) {
    let best = null;
    for (let ty = b.y - 1; ty <= b.y + b.h; ty++) {
      for (let tx = b.x - 1; tx <= b.x + b.w; tx++) {
        const inside = tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h;
        if (inside) continue;
        const kind = this.map.terrainAt(tx, ty);
        if (kind === TERRAIN.WATER || kind === TERRAIN.ROCK) continue;
        if (this.map.occAt(tx, ty) !== 0) continue;
        const d = Math.hypot(tx - target.x, ty - target.y);
        if (!best || d < best.d) best = { x: tx, y: ty, d };
      }
    }
    return best;
  }

  completeBuilding(b, builder) {
    b.built = 1;
    b.progress = 1;
    const def = BUILDINGS[b.type];
    const order = b.orderId ? this.orders.find((o) => o.id === b.orderId) : null;
    const ringPart = !!(order && order.ring);
    if (b.type !== 'wall') {
      this.connectRoads(b);
      this.orientBuilding(b);
    }
    if (!ringPart) this.logEvent(`${def.name} достроен${builder ? ` (${builder.name})` : ''}`, 'build');
    if (order) {
      order.status = 'done';
    }
    const homeless = this.pawns.filter((p) => !p.dead && !p.homeId);
    for (const p of homeless) this.assignHousing(p);
    if (builder) {
      builder.buildTargetId = null;
      builder.state = 'idle';
      builder.stateTimer = 0.4;
    }
  }

  // клетки для стены: снаружи застройки, без дорог (там ворота)
  ringSegments() {
    const th = this.townhall;
    const cx = th.x + 1.5;
    const cy = th.y + 1.5;
    // радиус по основной массе зданий (80-й перцентиль), порт и могилы не учитываем
    const dists = [];
    for (const b of this.buildings.values()) {
      if (b.type === 'wall' || b.type === 'grave' || b.type === 'port') continue;
      dists.push(Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) + Math.max(b.w, b.h) / 2);
    }
    dists.sort((a, b) => a - b);
    const base = dists.length ? dists[Math.floor((dists.length - 1) * 0.8)] : 9;
    const radius = Math.max(9, Math.min(20, Math.round(base) + 2));
    const pts = [];
    const seen = new Set();
    for (let a = 0; a < 360; a += 4) {
      const rad = (a * Math.PI) / 180;
      const x = Math.round(cx + Math.cos(rad) * radius);
      const y = Math.round(cy + Math.sin(rad) * radius);
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const kind = this.map.terrainAt(x, y);
      if (kind !== TERRAIN.GRASS && kind !== TERRAIN.SAND) continue;
      if (this.map.occAt(x, y) !== 0) continue;
      if (this.map.isRoad(x, y)) continue;
      // не пристраиваем стену к домам: минимум одна свободная клетка
      let nearBuilding = false;
      for (let dy = -1; dy <= 1 && !nearBuilding; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (this.map.occAt(x + dx, y + dy) !== 0) { nearBuilding = true; break; }
        }
      }
      if (nearBuilding) continue;
      pts.push({ x, y });
    }
    pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    return pts;
  }

  // ---------------------------------------------------------------- поселенцы

  createPawn(data) {
    return {
      id: this.nextId++,
      login: data.login,
      name: data.name || data.login,
      role: 'idle',
      x: this.portX + 0.5,
      y: this.portY + 0.5,
      dir: 1.57,
      path: [],
      state: 'wait',
      stateTimer: 0,
      workTimer: 0,
      walkPhase: Math.random() * 6,
      homeId: null,
      workplaceId: null,
      buildTargetId: null,
      carrying: null,
      hunger: Math.random() * 40,
      armed: false,
      toolWear: 0,
      hp: 100,
      maxHp: 100,
      wounded: 0,
      repathTimer: 0,
      cycles: 0,
      dead: false,
      deadTimer: 0,
      months: data.months ?? 1,
      tier: data.tier ?? 1,
      gifted: !!data.gifted,
      since: data.since ?? new Date().toISOString(),
      messages: data.messages ?? 0,
      arrivedAt: this.timeSec,
    };
  }

  addSubscriber(data) {
    const login = String(data.login || data.name || 'viewer').toLowerCase();
    // уже плывёт — второй корабль не нужен
    if (this.ships.some((s) => s.pending?.login === login)) return null;
    const existing = this.subs.get(login);
    const alive = this.pawns.find((p) => p.login === login && !p.dead);
    if (existing && alive) {
      existing.months = Math.max(existing.months, data.months ?? 1);
      existing.messages = data.messages ?? existing.messages;
      alive.months = existing.months;
      this.logEvent(`${alive.name} продлил подписку — ${existing.months} мес.`, 'sub');
      return alive;
    }
    const sub = {
      login,
      name: data.name || login,
      months: data.months ?? 1,
      tier: data.tier ?? 1,
      gifted: !!data.gifted,
      since: data.since ?? new Date().toISOString(),
      messages: data.messages ?? 0,
    };
    this.subs.set(login, sub);
    const ship = {
      id: this.nextId++,
      x: -8,
      y: this.portY + 0.2,
      tx: this.portX - 1.2,
      phase: 'in',
      timer: 0,
      name: sub.name,
      pending: sub,
    };
    this.ships.push(ship);
    this.logEvent(`Корабль вышел за ${sub.name} — новый подписчик`, 'ship');
    return null;
  }

  landPawn(sub) {
    const pawn = this.createPawn(sub);
    this.pawns.push(pawn);
    this.logEvent(`${pawn.name} сошёл на берег. Ищем дом…`, 'ship');
    this.arrivalQueue.push(pawn.name);
    const th = this.townhall;
    this.goTo(pawn, th.x + 1.5, th.y + 3.6, 'town', 2.2);
  }

  removeSubscriber(loginRaw) {
    const login = String(loginRaw).toLowerCase();
    const ship = this.ships.find((s) => s.pending?.login === login);
    if (ship) {
      ship.done = true;
      this.subs.delete(login);
      this.logEvent(`Корабль с ${ship.name} повернул назад — подписка отменена`, 'death');
      return true;
    }
    const p = this.pawns.find((pp) => pp.login === login && !pp.dead);
    this.subs.delete(login);
    if (!p) return false;
    p.dead = true;
    p.deadTimer = 5;
    p.state = 'dead';
    p.path = [];
    if (p.homeId) {
      const h = this.buildings.get(p.homeId);
      if (h) h.occupantId = null;
      p.homeId = null;
    }
    const grave = this.placeGrave(p);
    this.logEvent(
      `${p.name} отписался. Поселенец похоронен${grave ? ' на кладбище' : ''}, дом освобождён`,
      'death',
    );
    return true;
  }

  placeGrave(p) {
    const church = this.list('church').find((c) => c.built >= 1);
    const anchor = church || this.townhall;
    for (let r = 2; r < 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = Math.floor(anchor.x + anchor.w / 2 + dx);
          const y = Math.floor(anchor.y + anchor.h / 2 + dy);
          const kind = this.map.terrainAt(x, y);
          if (kind !== TERRAIN.GRASS && kind !== TERRAIN.SAND) continue;
          if (this.map.occAt(x, y) !== 0) continue;
          if (this.map.isRoad(x, y)) continue;
          return this.createBuilding('grave', x, y, { built: 1, name: `Могила ${p.name}` });
        }
      }
    }
    return null;
  }

  assignHousing(p) {
    if (p.homeId) return true;
    const free = [...this.buildings.values()].filter((b) => b.type === 'house' && b.built >= 1 && !b.occupantId);
    if (!free.length) return false;
    free.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    const house = free[0];
    house.occupantId = p.id;
    p.homeId = house.id;
    return true;
  }

  setRole(p, role) {
    if (p.role === role) return;
    p.role = role;
    p.roleChangedAt = this.timeSec;
    p.workplaceId = null;
    p.state = 'idle';
    p.stateTimer = 0;
    p.path = [];
    if (role !== 'idle') {
      const label = ROLES[role]?.label ?? role;
      this.logEvent(`${p.name} назначен: ${label}`, 'job');
    }
  }

  rebalanceJobs() {
    const caps = this.capacity();
    const counts = this.jobCounts();
    for (const role of ROLE_ORDER) {
      while (counts[role] > caps[role]) {
        const candidate = [...this.pawns].reverse().find((p) => !p.dead && p.role === role);
        if (!candidate) break;
        this.setRole(candidate, 'idle');
        counts[role]--;
        counts.idle++;
      }
    }
    // свободные жители занимают самую «голодную» профессию, строитель в приоритете
    const priority = { builder: -0.7 };
    for (;;) {
      const free = this.pawns.find((p) => !p.dead && p.role === 'idle' && this.canSwitchRole(p));
      if (!free) break;
      let bestRole = null;
      let bestScore = Infinity;
      for (const role of ROLE_ORDER) {
        if (counts[role] >= caps[role]) continue;
        const score = counts[role] + (priority[role] ?? 0);
        if (score < bestScore) { bestScore = score; bestRole = role; }
      }
      if (!bestRole) break;
      this.setRole(free, bestRole);
      counts[bestRole]++;
      counts.idle--;
    }
    this.assignWorkplaces();
  }

  assignWorkplaces() {
    const used = new Map();
    for (const p of this.pawns) {
      if (p.dead || !p.workplaceId) continue;
      const b = this.buildings.get(p.workplaceId);
      if (!b || b.built < 1 || BUILDINGS[b.type].workplace !== p.role) {
        p.workplaceId = null;
        continue;
      }
      used.set(b.id, (used.get(b.id) ?? 0) + 1);
    }
    for (const p of this.pawns) {
      if (p.dead || p.role === 'idle' || p.role === 'builder' || p.workplaceId) continue;
      const candidate = [...this.buildings.values()].find((b) => (
        b.built >= 1
        && BUILDINGS[b.type].workplace === p.role
        && (used.get(b.id) ?? 0) < this.slotsOf(b)
      ));
      if (candidate) {
        p.workplaceId = candidate.id;
        used.set(candidate.id, (used.get(candidate.id) ?? 0) + 1);
      }
    }
  }

  // ---------------------------------------------------------------- движение

  goTo(p, tx, ty, arriveAs, spread = 1.2) {
    const gx = Math.floor(tx + (Math.random() - 0.5) * spread);
    const gy = Math.floor(ty + (Math.random() - 0.5) * spread);
    const path = findPath(this.map, Math.floor(p.x), Math.floor(p.y), gx, gy, this.solidIds);
    if (!path.length) {
      p.state = 'idle';
      p.stateTimer = 1.5 + Math.random() * 2;
      return false;
    }
    p.path = path;
    p.arriveAs = arriveAs;
    p.state = 'walk';
    return true;
  }

  wander(p, radius = 6) {
    for (let i = 0; i < 12; i++) {
      const tx = Math.floor(p.x + (Math.random() - 0.5) * radius * 2);
      const ty = Math.floor(p.y + (Math.random() - 0.5) * radius * 2);
      if (!this.map.walkable(tx, ty, this.solidIds)) continue;
      const path = findPath(this.map, Math.floor(p.x), Math.floor(p.y), tx, ty, this.solidIds, 2500);
      if (path.length >= 2) {
        p.path = path;
        p.arriveAs = 'idle';
        p.state = 'walk';
        return true;
      }
    }
    p.state = 'idle';
    p.stateTimer = 3 + Math.random() * 4;
    return false;
  }

  // интересные места для прогулок: порт, таверна, церковь, колодец, ратуша
  randomLandmark(p) {
    const types = ['port', 'tavern', 'church', 'well', 'townhall'];
    const spots = [...this.buildings.values()]
      .filter((b) => b.built >= 1 && types.includes(b.type))
      .map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, r: Math.max(1.6, b.w) }));
    if (!spots.length) return null;
    for (let i = 0; i < 4; i++) {
      const spot = spots[Math.floor(Math.random() * spots.length)];
      if (Math.hypot(spot.x - p.x, spot.y - p.y) > 7) return spot;
    }
    return null;
  }

  step(p, dt) {
    const t = p.path[0];
    const dx = t.x - p.x, dy = t.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) { p.path.shift(); return; }
    const onRoad = this.map.isRoad(Math.floor(p.x), Math.floor(p.y));
    const speed = CONFIG.pawnSpeed * (onRoad ? CONFIG.roadSpeedBonus : 1);
    const stepLen = speed * dt;
    p.dir = Math.atan2(dx, dy);
    p.walkPhase += dt * 9;
    if (dist <= stepLen) {
      p.x = t.x;
      p.y = t.y;
      p.path.shift();
    } else {
      p.x += (dx / dist) * stepLen;
      p.y += (dy / dist) * stepLen;
    }
  }

  onArrive(p) {
    switch (p.arriveAs) {
      case 'work':
        p.state = 'work';
        p.workTimer = 1.5;
        break;
      case 'fight':
        p.state = 'fight';
        p.stateTimer = 0.6;
        break;
      case 'build':
        p.state = 'build';
        break;
      case 'home':
        p.state = 'home';
        p.stateTimer = 12 + Math.random() * 8;
        break;
      case 'town':
        this.assignHousing(p);
        p.state = 'idle';
        p.stateTimer = 0.5;
        break;
      case 'deposit':
        this.deposit(p);
        break;
      case 'eat':
        this.eatAt(p);
        break;
      default:
        p.state = 'idle';
        p.stateTimer = 4 + Math.random() * 5;
    }
  }

  // ---------------------------------------------------------------- поведение

  // ближайшее место, где можно поесть: таверна, иначе ратуша
  eatSpot(p) {
    const taverns = [...this.buildings.values()].filter((b) => b.type === 'tavern' && b.built >= 1);
    let best = null;
    for (const b of taverns) {
      const d = Math.hypot(b.x + b.w / 2 - p.x, b.y + b.h / 2 - p.y);
      if (!best || d < best.d) best = { b, d };
    }
    if (best) return best.b;
    return this.townhall;
  }

  eatAt(p) {
    if ((this.resources.food ?? 0) >= 3) {
      this.resources.food -= 3;
      this.foodOut += 3;
      p.hunger = 0;
      p.state = 'idle';
      p.stateTimer = 1.2;
    } else {
      p.hunger = Math.min(110, p.hunger + 10);
      p.state = 'idle';
      p.stateTimer = 5;
    }
  }

  // надеть оружие на стражников перед боем (оружие расходуется)
  armGuards() {
    for (const g of this.pawns) {
      if (g.dead || g.role !== 'guard') continue;
      if ((this.resources.weapons ?? 0) > 0) {
        this.resources.weapons--;
        g.armed = true;
      } else {
        g.armed = false;
      }
    }
  }

  plan(p) {
    if (p.dead) return;
    if (p.carrying) {
      const store = this.storageFor(p);
      const cx = store.x + store.w / 2;
      const cy = store.y + store.h / 2;
      if (Math.hypot(p.x - cx, p.y - cy) < Math.max(2.4, store.w)) {
        this.deposit(p);
        return;
      }
      if (!this.goTo(p, cx, cy, 'deposit', 1.2)) this.deposit(p);
      return;
    }
    // голодный идёт в таверну (или к ратуше), если есть еда
    if (p.hunger > 75 && (this.resources.food ?? 0) >= 3) {
      const spot = this.eatSpot(p);
      if (spot) {
        const ex = spot.x + spot.w / 2;
        const ey = spot.y + spot.h / 2;
        if (Math.hypot(p.x - ex, p.y - ey) < Math.max(2.2, spot.w)) {
          this.eatAt(p);
          return;
        }
        if (this.goTo(p, ex, ey, 'eat', 1.2)) return;
      }
    }
    if (p.role === 'guard' && this.raiders.length) {
      const target = this.nearestRaider(p, 16);
      if (target) {
        if (Math.hypot(target.x - p.x, target.y - p.y) < 1.7) {
          p.state = 'fight';
          p.stateTimer = 0.6;
          return;
        }
        if (this.goTo(p, target.x, target.y, 'fight', 0.8)) return;
      }
    }
    if (p.role === 'builder' && this.tryClaimOrder(p)) return;
    if (!p.homeId) this.assignHousing(p);

    if (p.role !== 'idle' && p.role !== 'builder') {
      const spot = this.spotFor(p);
      if (spot) {
        // у кого работа у ратуши — часто берут перерыв и идут гулять
        if (spot.relax && Math.random() < 0.5) {
          const lm = this.randomLandmark(p);
          if (lm && this.goTo(p, lm.x, lm.y, 'idle', lm.r)) return;
        }
        if (Math.hypot(p.x - spot.x, p.y - spot.y) < Math.max(2.2, spot.r)) {
          p.state = 'work';
          p.workTimer = 1.5;
          return;
        }
        if (this.goTo(p, spot.x, spot.y, 'work', Math.max(2.4, spot.r + 1.2))) return;
      }
    }

    if (p.homeId && Math.random() < 0.35) {
      const h = this.buildings.get(p.homeId);
      if (h && this.goTo(p, h.x + h.w / 2, h.y + h.h / 2, 'home', 1.2)) return;
    }

    // прогулки: к порту/таверне/церкви или в случайную точку карты
    const strollChance = p.role === 'idle' ? 0.55 : 0.18;
    if (Math.random() < strollChance) {
      const spot = this.randomLandmark(p);
      if (spot && this.goTo(p, spot.x, spot.y, 'idle', spot.r)) return;
    }
    this.wander(p, 8 + Math.random() * 8);
  }

  work(p, dt) {
    p.workTimer -= dt;
    if (p.workTimer > 0) return;
    const b = p.workplaceId ? this.buildings.get(p.workplaceId) : null;
    const bonus = b ? 1.35 : 1;
    const hungry = (this.resources.food <= 0 ? 0.5 : 1) * (p.hunger > 90 ? 0.7 : 1);
    const moraleMult = 0.7 + (this.morale / 100) * 0.5;
    const hasTools = (this.resources.tools ?? 0) > 0;
    const toolMult = hasTools ? 1 : 0.75;
    const mult = bonus * hungry * moraleMult * toolMult;
    const gearBonus = 1 + Math.min(0.6, (this.resources.tools ?? 0) * 0.01);
    // инструменты изнашиваются у добывающих профессий
    if (p.role === 'lumberjack' || p.role === 'miner') {
      p.toolWear = (p.toolWear ?? 0) + 1;
      if (p.toolWear >= 15) {
        p.toolWear = 0;
        if ((this.resources.tools ?? 0) > 0) this.resources.tools--;
      }
    }

    switch (p.role) {
      case 'lumberjack':
        this.harvestNear(p, TERRAIN.FOREST, TERRAIN.GRASS);
        this.produce(p, { wood: Math.max(2, Math.round(3 * mult * gearBonus)) });
        break;
      case 'miner':
        this.harvestNear(p, TERRAIN.ROCK, TERRAIN.SAND);
        this.produce(p, { stone: Math.max(2, Math.round(3 * mult * gearBonus)), ore: 2 });
        break;
      case 'blacksmith': {
        // сначала нужна руда: без неё инструментов и оружия не будет
        if ((this.resources.ore ?? 0) < 1) {
          if (!this._noOreLogged) {
            this._noOreLogged = true;
            this.logEvent('Кузнецу не хватает руды — шахтёрам нужно добыть больше', 'warn');
          }
          break;
        }
        this._noOreLogged = false;
        this.resources.ore -= 1;
        const hasForge = [...this.buildings.values()].some((b) => b.type === 'forge' && b.built >= 1);
        if (hasForge && p.cycles % 2 === 1) this.produce(p, { weapons: 1 });
        else this.produce(p, { tools: 1 });
        break;
      }
      case 'farmer': {
        const mills = this.count('mill');
        this.produce(p, {
          food: Math.max(2, Math.round(3 * mult * (1 + Math.min(2, mills) * 0.2))),
          grain: Math.max(1, Math.round(2 * mult)),
        });
        break;
      }
      case 'herder':
        this.produce(p, { food: Math.max(1, Math.round(3 * mult)), gold: 1 });
        break;
      case 'priest': this.addRes('faith', Math.max(1, Math.round(1 * mult))); break;
      case 'guard': break;
      default: break;
    }
    p.cycles++;
    p.workTimer = 9 + Math.random() * 5;
    const breakEvery = p.workplaceId ? 3 : 2;
    if (p.cycles % breakEvery === 0) {
      p.state = 'idle';
      p.stateTimer = 3 + Math.random() * 4;
    }
  }

  // переноска добычи на склад (или в ратушу, если склада нет)
  storageFor(p) {
    const candidates = [...this.buildings.values()].filter(
      (b) => b.built >= 1 && (b.type === 'warehouse' || b.type === 'townhall'),
    );
    let best = null;
    for (const b of candidates) {
      const d = Math.hypot(b.x + b.w / 2 - p.x, b.y + b.h / 2 - p.y);
      if (!best || d < best.d) best = { b, d };
    }
    return best ? best.b : this.townhall;
  }

  produce(p, items) {
    if (p.carrying) return;
    if (!items || !Object.keys(items).length) return;
    p.carrying = { items };
    p.state = 'idle';
    p.stateTimer = 0;
  }

  deposit(p) {
    if (!p.carrying) return;
    for (const [kind, amount] of Object.entries(p.carrying.items)) this.addRes(kind, amount);
    p.carrying = null;
    p.state = 'idle';
    p.stateTimer = 0.8;
  }

  // лесоруб/шахтёр расходуют ресурс на карте: дерево и жила исчезают
  harvestNear(p, from, to) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    for (let rad = 0; rad <= 2; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const x = px + dx;
          const y = py + dy;
          if (this.map.terrainAt(x, y) !== from) continue;
          if (this.map.occAt(x, y) !== 0) continue;
          this.map.setTerrain(x, y, to);
          this.workSpots = this.collectWorkSpots();
          p.state = 'idle';
          p.stateTimer = 1.2;
          return true;
        }
      }
    }
    return false;
  }

  tryClaimOrder(p) {
    if (p.buildTargetId) {
      const current = this.buildings.get(p.buildTargetId);
      if (current && current.built < 1) {
        const cx = current.x + current.w / 2, cy = current.y + current.h / 2;
        if (Math.hypot(p.x - cx, p.y - cy) > Math.max(2.2, current.w)) {
          if (this.goTo(p, cx, cy, 'build', 1.5)) return true;
        }
        p.state = 'build';
        return true;
      }
      p.buildTargetId = null;
    }
    // перебираем заказы: один «застрявший» не должен блокировать остальные
    // оплаченные сегменты стены идут вперёд очереди
    const queue = this.orders
      .filter((o) => o.status === 'queued')
      .sort((a, b) => (b.prepaid ? 1 : 0) - (a.prepaid ? 1 : 0) || a.id - b.id);
    let attempts = 0;
    for (const order of queue) {
      if (order.status !== 'queued') continue;
      if (attempts >= 6) break;
      attempts++;
      if (order.type === 'wallring') {
        const cost = { stone: 20, wood: 8 };
        if (!this.canAfford(cost)) { order.reason = 'не хватает ресурсов'; continue; }
        const segments = this.ringSegments();
        if (!segments.length) { order.reason = 'нет места для стены'; continue; }
        this.spend(cost);
        const chosen = segments.slice(0, 32);
        order.status = 'done';
        order.reason = '';
        // каждый сегмент — отдельный заказ: несколько строителей работают параллельно
        for (const seg of chosen) this.addOrder('wall', { site: seg, prepaid: true });
        this.logEvent(`Проект стены: ${chosen.length} сегментов вокруг колонии, строители разбирают участки`, 'build');
        continue;
      }
      const def = BUILDINGS[order.type];
      if (!this.canAfford(def.cost)) {
        order.reason = 'не хватает ресурсов';
        continue;
      }
      const site = order.site ?? this.findSite(def);
      if (!site) {
        order.reason = 'нет свободного места';
        continue;
      }
      if (order.site && !this.isSiteFree(site.x, site.y, def, true)) {
        order.status = 'done';
        continue;
      }
      if (!order.prepaid) this.spend(def.cost);
      const b = this.createBuilding(order.type, site.x, site.y, { built: 0, orderId: order.id });
      order.status = 'building';
      order.buildingId = b.id;
      order.reason = '';
      p.buildTargetId = b.id;
      this.logEvent(`${p.name} начал стройку: ${def.name}`, 'build');
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if (!this.goTo(p, cx, cy, 'build', 1.4)) {
        p.state = 'build';
        p.buildTargetId = b.id;
      }
      return true;
    }
    return false;
  }

  buildTick(p, dt) {
    const b = this.buildings.get(p.buildTargetId);
    if (!b || b.built >= 1) {
      p.buildTargetId = null;
      p.state = 'idle';
      p.stateTimer = 0.5;
      return;
    }
    const def = BUILDINGS[b.type];
    const duration = CONFIG.buildTimeBase + this.costSum(def.cost) * CONFIG.buildTimePerCost;
    b.progress = Math.min(1, b.progress + dt / duration);
    if (b.progress >= 1) this.completeBuilding(b, p);
  }

  // ---------------------------------------------------------------- сутки и события

  dayInfo() {
    const length = CONFIG.dayLengthSec;
    return {
      progress: round((this.timeSec % length) / length),
      number: Math.floor(this.timeSec / length) + 1,
    };
  }

  setHour(hour) {
    const length = CONFIG.dayLengthSec;
    const target = ((Number(hour) || 0) / 24) * length;
    const current = this.timeSec % length;
    this.timeSec += (target - current + length) % length;
  }

  startRandomEvent() {
    const roll = Math.random();
    const graves = this.count('grave');
    if (roll < 0.42) this.startRaid('barbarians');
    else if (roll < 0.68 && graves > 0) this.startRaid('zombies');
    else if (roll < 0.86) this.startBoon('trade');
    else this.startBoon('harvest');
  }

  raiderLabel(kind, lower = false) {
    const label = kind === 'zombies' ? 'Зомби' : kind === 'raid' ? 'Рейдер' : 'Варвар';
    return lower ? label.toLowerCase() : label;
  }

  // Рейд на канал: зрители с чужого стрима штурмуют колонию
  startStreamerRaid({ name, viewers } = {}) {
    const viewerCount = Math.max(1, Number(viewers) || 1);
    const count = Math.max(2, Math.min(14, 2 + Math.floor(viewerCount / 10)));
    const ev = {
      id: this.nextId++,
      kind: 'raid',
      title: `Рейд: ${name || 'стример'}`,
      text: `${viewerCount} зрителей с рейда идут на колонию`,
      left: 60,
      total: 60,
      count,
      spawned: 0,
      spawnTimer: 1.2,
    };
    this.events.push(ev);
    this.armGuards();
    this.logEvent(`Рейд с канала ${name || '—'}: ${viewerCount} зрителей, ${count} рейдеров на подходе!`, 'danger');
    this.announce(`Рейд с канала ${name || '—'}: ${viewerCount} зрителей идут на колонию! Стражники, в бой`);
  }

  startRaid(kind) {
    const isZombie = kind === 'zombies';
    const count = isZombie
      ? Math.min(7, 2 + Math.floor(this.count('grave') / 2))
      : Math.min(8, 2 + Math.floor(this.level / 2));
    const ev = {
      id: this.nextId++,
      kind,
      title: isZombie ? 'Восстание мертвецов' : 'Набег варваров',
      text: isZombie
        ? `С кладбища поднялись ${count} зомби. Стражники вышли на защиту.`
        : `${count} варваров идут к ратуше. Стражники вступили в бой.`,
      left: 50,
      total: 50,
      count,
      spawned: 0,
      spawnTimer: 2,
    };
    this.events.push(ev);
    this.armGuards();
    this.logEvent(`${ev.title}! ${ev.text}`, 'danger');
    this.announce(`${ev.title}! ${ev.text}`);
  }

  startBoon(kind) {
    const trade = kind === 'trade';
    if (trade) {
      this.addRes('gold', 40);
      this.addRes('tools', 3);
    } else {
      this.addRes('grain', 40);
      this.addRes('wood', 15);
    }
    const ev = {
      id: this.nextId++,
      kind,
      title: trade ? 'Торговый караван' : 'Богатый урожай',
      text: trade ? 'Караван привёз золото и инструменты' : 'Амбары пополнились едой и деревом',
      left: 10,
      total: 10,
      count: 0,
      spawned: 0,
    };
    this.events.push(ev);
    this.logEvent(`${ev.title}: ${ev.text}`, 'event');
  }

  spawnRaider(kind) {
    const th = this.townhall;
    let pos = null;
    for (let i = 0; i < 40 && !pos; i++) {
      const side = Math.floor(Math.random() * 4);
      let x, y;
      if (side === 0) { x = 2 + Math.floor(Math.random() * 4); y = 2 + Math.floor(Math.random() * (this.map.h - 4)); }
      else if (side === 1) { x = this.map.w - 3 - Math.floor(Math.random() * 4); y = 2 + Math.floor(Math.random() * (this.map.h - 4)); }
      else if (side === 2) { x = 2 + Math.floor(Math.random() * (this.map.w - 4)); y = 2 + Math.floor(Math.random() * 4); }
      else { x = 2 + Math.floor(Math.random() * (this.map.w - 4)); y = this.map.h - 3 - Math.floor(Math.random() * 4); }
      if (!this.map.walkable(x, y, this.solidIds)) continue;
      if (Math.hypot(x - th.x, y - th.y) < 13) continue;
      pos = { x, y };
    }
    if (!pos) return;
    const hp = kind === 'zombies' ? 55 : kind === 'raid' ? 90 : 75;
    this.raiders.push({
      id: this.nextId++,
      kind,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      dir: 0,
      hp,
      maxHp: hp,
      retreat: false,
      path: [],
      pathTimer: 0,
      speed: kind === 'zombies' ? 1.0 : kind === 'raid' ? 1.55 : 1.4,
    });
  }

  updateEvents(dt) {
    if (this.events.length === 0) {
      this.nextEventAt -= dt;
      if (this.nextEventAt <= 0) this.startRandomEvent();
    }
    for (const ev of this.events) {
      ev.left -= dt;
      if (ev.count > 0) {
        ev.spawnTimer -= dt;
        if (ev.spawned < ev.count && ev.spawnTimer <= 0) {
          ev.spawnTimer = 3.2;
          this.spawnRaider(ev.kind);
          ev.spawned++;
        }
      }
      if (ev.left <= 0 && !ev.done) {
        ev.done = true;
        const raiders = this.events.find((e) => e.id === ev.id);
        if (raiders) for (const r of this.raiders) r.retreat = true;
        if (ev.count > 0) this.logEvent(`${ev.title}: враги отступили`, 'event');
        for (const p of this.pawns) p.armed = false;
        this.nextEventAt = CONFIG.event.minGapSec + Math.random() * (CONFIG.event.maxGapSec - CONFIG.event.minGapSec);
      }
    }
    this.events = this.events.filter((e) => !e.done);
    this.updateCombat(dt);
    this.updateRaiders(dt);
  }

  // ближний бой: стражники бьют рейдеров, рейдеры бьют стражников
  updateCombat(dt) {
    if (!this.raiders.length) return;
    const guards = this.pawns.filter((p) => !p.dead && p.role === 'guard' && p.wounded <= 0);
    if (guards.length) {
      for (const r of this.raiders) {
        if (r.dead) continue;
        let guard = null;
        let best = 1.9;
        for (const g of guards) {
          const d = Math.hypot(g.x - r.x, g.y - r.y);
          if (d < best) { best = d; guard = g; }
        }
        if (guard) {
          r.hp -= dt * (guard.armed ? 26 : 12);
          guard.hp -= dt * 9;
          if (!r.engaged) {
            r.engaged = true;
            this.logEvent(`${guard.name} вступил в бой с ${this.raiderLabel(r.kind, true)}`, 'fight');
          }
          guard.state = 'fight';
          guard.stateTimer = Math.max(guard.stateTimer ?? 0, 0.4);
        } else {
          r.engaged = false;
        }
      }
      for (const g of guards) {
        if (g.hp <= 0) {
          g.hp = 0;
          g.wounded = 55;
          g.state = 'wounded';
          g.path = [];
          this.logEvent(`${g.name} тяжело ранен и отправлен на лечение`, 'danger');
        }
      }
    }
  }

  nearestRaider(pawn, range) {
    let best = null;
    for (const r of this.raiders) {
      const d = Math.hypot(r.x - pawn.x, r.y - pawn.y);
      if (d < range && (!best || d < best.d)) best = { r, d };
    }
    return best ? best.r : null;
  }

  updateRaiders(dt) {
    const th = this.townhall;
    for (const r of this.raiders) {
      if (r.dead) continue;
      if (r.hp <= 0) {
        r.dead = true;
        this.logEvent(`${this.raiderLabel(r.kind)} повержен стражей`, 'fight');
        continue;
      }

      if (r.retreat) {
        r.x += Math.sign(r.x - th.x || 1) * dt * r.speed;
        r.y += Math.sign(r.y - th.y || 1) * dt * r.speed;
        if (r.x < 0 || r.y < 0 || r.x > this.map.w || r.y > this.map.h) r.dead = true;
        continue;
      }

      r.pathTimer -= dt;
      if (r.pathTimer <= 0 || !r.path.length) {
        r.pathTimer = 2.5;
        r.path = findPath(this.map, Math.floor(r.x), Math.floor(r.y), th.x + 1, th.y + 1, this.solidIds, 2500);
      }
      if (r.path.length) {
        const t = r.path[0];
        const dx = t.x - r.x;
        const dy = t.y - r.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.05) {
          r.path.shift();
        } else {
          const step = Math.min(dist, r.speed * dt);
          r.x += (dx / dist) * step;
          r.y += (dy / dist) * step;
          r.dir = Math.atan2(dx, dy);
        }
      }

      if (Math.hypot(r.x - (th.x + 1.5), r.y - (th.y + 1.5)) < 3) {
        const amount = 8 + Math.floor(Math.random() * 8);
        const kinds = r.kind === 'zombies' ? ['food'] : ['wood', 'stone', 'food'];
        for (const key of kinds) this.resources[key] = Math.max(0, (this.resources[key] ?? 0) - amount);
        this.logEvent(
          `${this.raiderLabel(r.kind)} прорвались к ратуше: −${amount} ${r.kind === 'zombies' ? 'еды' : 'дерева, камня и еды'}`,
          'danger',
        );
        r.dead = true;
      }
    }
    this.raiders = this.raiders.filter((r) => !r.dead);
  }

  // мельница и пекарня работают сами: сырьё со склада → готовый продукт
  runConverters(dt) {
    for (const b of this.buildings.values()) {
      if (b.built < 1) continue;
      const conv = BUILDINGS[b.type].converter;
      if (!conv) continue;
      b.timer = (b.timer ?? 0) + dt;
      if (b.timer < conv.every) continue;
      const ok = Object.entries(conv.in).every(([k, v]) => (this.resources[k] ?? 0) >= v);
      if (!ok) {
        b.timer = conv.every * 0.4;
        continue;
      }
      for (const [k, v] of Object.entries(conv.in)) this.resources[k] -= v;
      for (const [k, v] of Object.entries(conv.out)) this.addRes(k, v);
      b.timer = 0;
    }
  }

  // ---------------------------------------------------------------- корабли и события

  updateShips(dt) {
    const speed = CONFIG.ship.approachSpeed;
    for (const s of this.ships) {
      if (s.phase === 'in') {
        s.x += dt * speed;
        if (s.x >= s.tx) {
          s.x = s.tx;
          s.phase = 'dock';
          s.timer = CONFIG.ship.dockTimeSec;
          if (s.pending) this.landPawn(s.pending);
        }
      } else if (s.phase === 'dock') {
        s.timer -= dt;
        if (s.timer <= 0) s.phase = 'out';
      } else if (s.phase === 'out') {
        s.x -= dt * speed * 1.3;
        if (s.x < -10) s.done = true;
      }
    }
    this.ships = this.ships.filter((s) => !s.done);
  }

  // ---------------------------------------------------------------- голосование

  atLimit(type) {
    const def = BUILDINGS[type];
    if (!def) return false;
    if (def.unique) return this.count(type) > 0;
    const max = MAX_BUILDINGS[type] ?? 20;
    return this.count(type) >= max;
  }

  openVote() {
    const pool = VOTABLE
      .filter((b) => !this.atLimit(b.type))
      .filter((b) => !b.requires || this.count(b.requires) > 0);
    // стена по периметру — отдельный проект, а не один сегмент
    if (this.count('wall') < 12 && this.canAfford({ stone: 20 })) {
      pool.push({ type: 'wallring', name: 'Стена по периметру', cost: { stone: 24, wood: 10 }, vote: 16 });
    }
    if (!pool.length) {
      this.voteTimer = 30;
      return;
    }
    const weighted = pool.map((b) => {
      let weight = b.vote ?? 10;
      if (b.type === 'house' && this.homelessCount() > 0) weight += 140;
      if (b.workplace && p_need_workplace(this, b.workplace)) weight += 45;
      return [b, weight];
    });
    const options = [];
    for (let i = 0; i < CONFIG.vote.options && weighted.length; i++) {
      const total = weighted.reduce((s, [, w]) => s + w, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < weighted.length; idx++) {
        r -= weighted[idx][1];
        if (r <= 0) break;
      }
      idx = Math.min(idx, weighted.length - 1);
      const entry = weighted.splice(idx, 1)[0];
      const b = entry[0];
      options.push({ key: String(i + 1), type: b.type, name: b.name, cost: b.cost, votes: [] });
    }
    this.voteNumber++;
    this.vote = {
      id: this.nextId++,
      number: this.voteNumber,
      options,
      endsAt: this.timeSec + CONFIG.vote.durationSec,
    };
    this.logEvent(
      `Голосование #${this.voteNumber}: что строим? ${options.map((o) => `${o.key}) ${o.name}`).join(' · ')}`,
      'vote',
    );
    if (!this.quietChat) this.announce(`Голосование #${this.voteNumber}: ${options.map((o) => `${o.key}) ${o.name}`).join(' · ')} — пишите в чат !1, !2 или !3`);
  }

  closeVote() {
    const vote = this.vote;
    if (!vote) return;
    let best = vote.options[0];
    for (const o of vote.options) if (o.votes.length > best.votes.length) best = o;
    if (best.votes.length === 0) {
      this.logEvent('Голосование провалилось: никто не проголосовал', 'vote');
      if (!this.quietChat) this.announce('Голосование провалилось: никто не проголосовал');
    } else {
      this.addOrder(best.type, { votes: best.votes.length });
      this.logEvent(`Выбрано: ${best.name} (${best.votes.length} голосов). Строители приступают`, 'vote');
      if (!this.quietChat) this.announce(`Выбрано: ${best.name} (${best.votes.length} голосов). Строители приступают`);
    }
    this.vote = null;
    this.voteTimer = CONFIG.vote.cooldownSec;
  }

  castVote(userKey, optionKey, displayName) {
    if (!this.vote) return false;
    const option = this.vote.options.find((o) => o.key === String(optionKey));
    if (!option) return false;
    for (const o of this.vote.options) o.votes = o.votes.filter((v) => v.key !== userKey);
    option.votes.push({ key: userKey, name: displayName || userKey });
    return true;
  }

  addOrder(type, meta = {}) {
    this.orders.push({
      id: this.nextId++,
      type,
      status: 'queued',
      reason: '',
      votes: meta.votes ?? 0,
      site: meta.site ?? null,
      prepaid: !!meta.prepaid,
      createdAt: this.timeSec,
    });
    return this.orders[this.orders.length - 1];
  }

  // ---------------------------------------------------------------- чат и подписки

  handleChat({ login, name, text, isSub, badges }) {
    const key = String(login || '').toLowerCase();
    const rawBadges = String(badges || '');
    const knownSub = this.subs.has(key);
    const byBadge = /(^|,)(subscriber|founder|premium)\//.test(rawBadges);
    // списки подписчиков/фолловеров обновляются раз в минуту — сравнение мгновенное
    const inAudience = this.audience
      ? (this.audience.hasSubscriber(key) || this.audience.hasFollower(key))
      : false;
    const subscribed = !!isSub || byBadge || knownSub || inAudience;
    const subRec = this.subs.get(key);
    if (subRec) subRec.messages++;
    const p = this.pawns.find((pp) => pp.login === key);
    if (p) p.messages++;

    const t = (text || '').trim().toLowerCase();
    if (!t) return null;
    const voteMatch = t.match(/^!([1-3])$/);
    if (voteMatch && this.vote) {
      this.castVote(key, voteMatch[1], name);
      return { type: 'vote', option: voteMatch[1] };
    }
    if (t === '!прийти' || t === '!поселиться' || t === '!въехать' || t === '!join') {
      return this.joinByCommand(key, name, subscribed);
    }
    // страховка для стримера/модераторов: добавить любого зрителя вручную
    const addMatch = t.match(/^!(?:поселить|добавить|add)\s+@?([a-z0-9_]{2,25})$/);
    if (addMatch) {
      const isMod = /(^|,)(broadcaster|moderator)\//.test(rawBadges);
      if (!isMod) return { type: 'reply', text: `${name}, команда только для стримера и модераторов` };
      return this.forceAdd(addMatch[1], name);
    }
    // пересинхронизация аудитории по команде стримера
    if (/^!(?:синхро|синхронизировать|sync)$/.test(t)) {
      const isMod = /(^|,)(broadcaster|moderator)\//.test(rawBadges);
      if (!isMod) return { type: 'reply', text: `${name}, команда только для стримера и модераторов` };
      return { type: 'sync-audience' };
    }
    if (t === '!я' || t === '!me') {
      const self = this.pawns.find((x) => x.login === key && !x.dead);
      if (!self) return { type: 'reply', text: `${name}, тебя нет в колонии — напиши !join` };
      return { type: 'focus', pawnId: self.id, name: self.name };
    }
    if (t === '!колония' || t === '!colony' || t === '!статус') return { type: 'status' };
    if (t === '!команды' || t === '!help') {
      return { type: 'reply', text: 'Команды: !1 !2 !3 — голос за стройку · !join — переехать в колонию · !я — показать себя на карте · !дом · !профессия · !колония' };
    }
    if (t === '!дом') {
      const res = p && p.homeId ? this.buildings.get(p.homeId) : null;
      return { type: 'reply', text: res ? `${p.name}, твой дом №${res.id}` : `${name}, у тебя пока нет дома` };
    }
    if (t === '!профессия' || t === '!job') {
      return { type: 'reply', text: p ? `${p.name}: ${ROLES[p.role]?.label}` : `${name}, ты ещё не в колонии — напиши !прийти` };
    }
    return null;
  }

  forceAdd(login, by) {
    const target = String(login || '').toLowerCase();
    const alive = this.pawns.find((p) => p.login === target && !p.dead);
    if (alive) return { type: 'reply', text: `${target} уже в колонии` };
    this.addSubscriber({ login: target, name: target, months: 1 });
    return { type: 'reply', text: `${target} добавлен в колонию (${by})` };
  }

  // добавляет всех, кого видит в списках аудитории, но кого нет в колонии
  syncMissing({ includeFollowers = true, limit = 40 } = {}) {
    if (!this.audience) return { added: 0, total: 0 };
    const names = new Set(this.audience.subs);
    if (includeFollowers) for (const n of this.audience.followers) names.add(n);
    let added = 0;
    for (const login of names) {
      if (added >= limit) break;
      if (!login) continue;
      if (this.excludeLogins.has(login)) continue;
      if (this.pawns.some((p) => p.login === login && !p.dead)) continue;
      if (this.ships.some((s) => s.pending?.login === login)) continue;
      this.addSubscriber({ login, name: login, months: 1 });
      added++;
    }
    return { added, total: names.size };
  }

  // ужe подписанные зрители переезжают по команде, а не только в момент подписки
  joinByCommand(login, name, isSub) {
    const alive = this.pawns.find((p) => p.login === login && !p.dead);
    if (alive) return { type: 'reply', text: `${name}, ты уже живёшь в колонии` };
    if (this.ships.some((s) => s.pending?.login === login)) {
      return { type: 'reply', text: `${name}, корабль уже плывёт за тобой — подожди немного` };
    }
    if (!isSub && !this.allowAllJoin) {
      // фолловеров в чате не видно — спрашиваем API
      if (this.followCheckAvailable) return { type: 'need-follow-check', login, name };
      return { type: 'reply', text: `${name}, не вижу тебя среди подписчиков или фолловеров — напиши стримеру, он добавит командой !поселить твой_ник` };
    }
    const last = this.joinCooldown.get(login) ?? -999;
    if (this.timeSec - last < 40) return { type: 'reply', text: `${name}, подожди немного перед переездом` };
    this.joinCooldown.set(login, this.timeSec);
    this.addSubscriber({ login, name, months: 1 });
    return { type: 'reply', text: `${name}, корабль уже вышел за тобой — смотри на порт` };
  }

  // ---------------------------------------------------------------- основной цикл

  tick(dt) {
    this.timeSec += dt;
    this.updateShips(dt);
    this.updateEvents(dt);
    this.runConverters(dt);

    // прибытия в чат — одним сообщением, чтобы не спамить
    this.arrivalTimer -= dt;
    if (this.arrivalTimer <= 0) {
      this.arrivalTimer = 7;
      if (this.arrivalQueue.length) {
        const names = this.arrivalQueue.splice(0, this.arrivalQueue.length);
        const head = names.slice(0, 4).join(', ');
        const tail = names.length > 4 ? ` и ещё ${names.length - 4}` : '';
        this.announce(`${names.length > 1 ? 'Новые жители' : 'Новый житель'}: ${head}${tail}`);
      }
    }

    if (this.vote) {
      if (this.timeSec >= this.vote.endsAt) this.closeVote();
    } else {
      this.voteTimer -= dt;
      if (this.voteTimer <= 0) this.openVote();
    }

    this._jobTimer -= dt;
    if (this._jobTimer <= 0) {
      this._jobTimer = 1.5;
      this.rebalanceJobs();
    }

    // авто-заказы домов: по одному на каждых двух бездомных, чтобы строители не простаивали
    const homeless = this.homelessCount();
    const houseOrders = this.orders.filter((o) => o.type === 'house' && o.status !== 'done').length;
    const wantHouses = Math.min(4, Math.ceil(homeless / 2));
    if (homeless > 0 && houseOrders < wantHouses) this.addOrder('house');

    for (const p of this.pawns) {
      if (p.dead) { p.deadTimer -= dt; continue; }
      // голод растёт, у раненых медленнее
      p.hunger = Math.min(120, p.hunger + dt * (p.wounded > 0 ? 0.25 : 0.8));
      if (p.wounded > 0) {
        p.wounded -= dt;
        p.state = 'wounded';
        p.path = [];
        if (p.wounded <= 0) {
          p.wounded = 0;
          p.hp = p.maxHp;
          p.state = 'idle';
          p.stateTimer = 1;
        }
        continue;
      }
      if (p.path.length) {
        this.step(p, dt);
        if (p.path.length) continue;
        this.onArrive(p);
        continue;
      }
      switch (p.state) {
        case 'wait':
          p.state = 'idle';
          p.stateTimer = 0.5;
          break;
        case 'idle':
          p.stateTimer -= dt;
          if (p.stateTimer <= 0) this.plan(p);
          break;
        case 'work':
          this.work(p, dt);
          break;
        case 'fight':
          p.stateTimer -= dt;
          if (p.stateTimer <= 0) this.plan(p);
          break;
        case 'build':
          this.buildTick(p, dt);
          break;
        case 'home':
          p.stateTimer -= dt;
          if (p.stateTimer <= 0) this.plan(p);
          break;
        default:
          p.state = 'idle';
          p.stateTimer = 1;
      }
    }
    this.pawns = this.pawns.filter((p) => !p.dead || p.deadTimer > 0);

    this.updateMorale(dt);
    this.enforceStorage();
    this.rateTimer -= dt;
    if (this.rateTimer <= 0) {
      this.rateTimer = 15;
      this.foodRate = Math.round((this.foodIn - this.foodOut) * (60 / 15));
      this.foodIn = 0;
      this.foodOut = 0;
    }

    const count = this.subs.size;
    const level = levelForSubs(count);
    if (level !== this.level) {
      this.level = level;
      this.logEvent(`Ратуша улучшена до ${level} уровня: +1 слот каждой профессии`, 'level');
      this.announce(`Ратуша ${level} уровня! Появились новые слоты профессий`);
    }

    // каждые 10 подписчиков граница колонии расширяется
    if (count >= this.expandAt) {
      this.expandMap();
      this.expandAt += 10;
    }
  }

  expandMap() {
    this.map.grow(8);
    this.workSpots = this.collectWorkSpots();
    this.logEvent(`Колония разрослась: карта ${this.map.w}×${this.map.h}, новые земли на юге и востоке`, 'level');
  }

  // ---------------------------------------------------------------- сохранение

  exportState() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      timeSec: this.timeSec,
      nextId: this.nextId,
      level: this.level,
      morale: this.morale,
      safety: this.safety,
      resources: this.resources,
      townhallId: this.townhall?.id ?? null,
      portX: this.portX,
      portY: this.portY,
      map: {
        w: this.map.w,
        h: this.map.h,
        seed: this.map.seed,
        tiles: Buffer.from(this.map.t).toString('base64'),
        roads: [...this.map.roads],
      },
      buildings: [...this.buildings.values()].map((b) => ({ ...b })),
      pawns: this.pawns.map((p) => ({ ...p, path: [] })),
      subs: [...this.subs.entries()],
      ships: this.ships.map((s) => ({ ...s })),
      orders: this.orders.map((o) => ({ ...o })),
      vote: this.vote ? { ...this.vote } : null,
      voteNumber: this.voteNumber,
      voteTimer: this.voteTimer,
      expandAt: this.expandAt,
      nextEventAt: this.nextEventAt,
      feed: this.feed.slice(-30),
      feedCursor: this.feedCursor,
    };
  }

  restore(data) {
    this.map.w = data.map.w;
    this.map.h = data.map.h;
    this.map.t = new Uint8Array(Buffer.from(data.map.tiles, 'base64'));
    this.map.occ = new Int32Array(data.map.w * data.map.h);
    this.map.roads = new Set(data.map.roads || []);
    this.map.version++;

    this.buildings = new Map();
    this.solidIds = new Set();
    this.pawns = [];
    this.ships = [];
    this.orders = [];
    this.subs = new Map(data.subs || []);
    this.vote = data.vote || null;
    this.timeSec = data.timeSec ?? 0;
    this.nextId = data.nextId ?? 1;
    this.level = data.level ?? 1;
    this.morale = data.morale ?? 60;
    this.safety = data.safety ?? 40;
    this.resources = { ...CONFIG.startingResources, ...(data.resources || {}) };
    this.voteNumber = data.voteNumber ?? 0;
    this.voteTimer = data.voteTimer ?? 30;
    this.expandAt = data.expandAt ?? 10;
    this.nextEventAt = data.nextEventAt ?? 60;
    this.feed = data.feed || [];
    this.feedCursor = data.feedCursor ?? 0;

    for (const b of data.buildings || []) {
      const def = BUILDINGS[b.type];
      if (!def) continue;
      b.timer = b.timer ?? 0;
      this.buildings.set(b.id, b);
      if (def.solid) this.solidIds.add(b.id);
      for (let ty = b.y; ty < b.y + def.h; ty++) {
        for (let tx = b.x; tx < b.x + def.w; tx++) this.map.setOcc(tx, ty, b.id);
      }
    }
    this.townhall = this.buildings.get(data.townhallId) || this.list('townhall')[0];
    this.port = this.list('port')[0];
    this.portX = data.portX ?? this.portX;
    this.portY = data.portY ?? this.portY;

    for (const p of data.pawns || []) {
      this.pawns.push({
        ...p,
        path: [],
        hunger: p.hunger ?? 20,
        armed: !!p.armed,
        toolWear: p.toolWear ?? 0,
        wounded: p.wounded ?? 0,
      });
    }
    this.ships = (data.ships || []).map((s) => ({ ...s }));
    this.orders = data.orders || [];
    this.workSpots = this.collectWorkSpots();
    this.rebalanceJobs();
    return this;
  }

  // ---------------------------------------------------------------- снимки состояния

  mapSnapshot() {
    return {
      w: this.map.w,
      h: this.map.h,
      version: this.map.version,
      tiles: Array.from(this.map.t),
    };
  }

  snapshot() {
    const buildings = [];
    for (const b of this.buildings.values()) {
      buildings.push({
        id: b.id, type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, rot: round(b.rot ?? 0),
        built: b.built, progress: round(b.progress),
        occupant: b.occupantId ? (this.pawns.find((p) => p.id === b.occupantId)?.name ?? null) : null,
        name: b.name,
      });
    }
    const pawns = [];
    for (const p of this.pawns) {
      pawns.push({
        id: p.id, name: p.name, login: p.login, role: p.role,
        x: round(p.x), y: round(p.y), dir: round(p.dir),
        state: p.state, dead: p.dead,
        homeId: p.homeId, workplaceId: p.workplaceId,
        months: p.months, messages: p.messages, since: p.since,
        gifted: p.gifted, tier: p.tier, walkPhase: round(p.walkPhase),
        carry: p.carrying ? Object.keys(p.carrying.items)[0] : null,
        hp: Math.round(p.hp),
        wounded: p.wounded > 0,
        hunger: Math.round(p.hunger),
        armed: !!p.armed,
        roleReadyIn: p.roleChangedAt === undefined
          ? 0
          : Math.max(0, Math.ceil(CONFIG.roleChangeCooldownSec - (this.timeSec - p.roleChangedAt))),
      });
    }
    const roads = [];
    for (const key of this.roads) {
      const [x, y] = key.split(',').map(Number);
      roads.push(x, y);
    }
    const next = nextLevelFor(this.subs.size);
    const currentLevel = LEVELS.find((l) => l.level === this.level);
    return {
      time: Math.round(this.timeSec),
      level: this.level,
      levelFrom: currentLevel ? currentLevel.subs : 0,
      subs: this.subs.size,
      next: next ? { level: next.level, need: next.subs - this.subs.size } : null,
      resources: {
        wood: Math.floor(this.resources.wood),
        stone: Math.floor(this.resources.stone),
        food: Math.floor(this.resources.food),
        faith: Math.floor(this.resources.faith),
        gold: Math.floor(this.resources.gold),
        tools: Math.floor(this.resources.tools ?? 0),
        weapons: Math.floor(this.resources.weapons ?? 0),
        ore: Math.floor(this.resources.ore ?? 0),
        grain: Math.floor(this.resources.grain ?? 0),
        flour: Math.floor(this.resources.flour ?? 0),
      },
      caps: this.capacity(),
      jobs: this.jobCounts(),
      population: pawns.filter((p) => !p.dead).length,
      homeless: this.homelessCount(),
      safety: this.computeSafety(),
      morale: Math.round(this.morale),
      foodRate: this.foodRate,
      storageCap: this.storageCap(),
      mapVersion: this.map.version,
      mapSize: { w: this.map.w, h: this.map.h },
      roleCooldown: CONFIG.roleChangeCooldownSec,
      day: this.dayInfo(),
      events: this.events.map((e) => ({
        id: e.id, kind: e.kind, title: e.title, text: e.text,
        left: Math.max(0, Math.ceil(e.left)), total: e.total,
      })),
      raiders: this.raiders.map((r) => ({
        id: r.id, kind: r.kind, x: round(r.x), y: round(r.y), dir: round(r.dir),
        hp: Math.max(0, Math.round((r.hp / r.maxHp) * 100)),
      })),
      pawns,
      buildings,
      roads,
      ships: this.ships.map((s) => ({ id: s.id, x: round(s.x), y: round(s.y), phase: s.phase })),
      orders: this.orders.filter((o) => o.status !== 'done').map((o) => ({
        id: o.id, type: o.type, status: o.status, reason: o.reason,
      })),
      vote: this.vote ? {
        number: this.vote.number,
        left: Math.max(0, Math.ceil(this.vote.endsAt - this.timeSec)),
        options: this.vote.options.map((o) => ({
          key: o.key, type: o.type, name: o.name, cost: o.cost, votes: o.votes.map((v) => v.name),
        })),
      } : null,
    };
  }
}

function p_need_workplace(village, role) {
  const has = [...village.buildings.values()].some((b) => b.built >= 1 && BUILDINGS[b.type].workplace === role);
  return !has && village.jobCounts()[role] > 0;
}
