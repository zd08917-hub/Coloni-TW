// Игровые константы: профессии, постройки, уровни ратуши, экономика.

export const CONFIG = {
  tickMs: 100,
  snapshotMs: 200,
  mapSeed: 20261106,
  map: { w: 52, h: 52 },
  startingResources: { wood: 70, stone: 45, food: 60, faith: 0, gold: 15, tools: 0, weapons: 0, ore: 0, grain: 0, flour: 0 },
  // сколько еды съедает один поселенец за игровую минуту
  foodPerPawnPerMin: 2.2,
  vote: { durationSec: 60, cooldownSec: 45, firstDelaySec: 25, options: 3 },
  dayLengthSec: 240,
  event: { firstDelaySec: 75, minGapSec: 100, maxGapSec: 190 },
  pawnSpeed: 1.9,
  roadSpeedBonus: 1.45,
  buildTimeBase: 4.5,
  buildTimePerCost: 0.05,
  roleChangeCooldownSec: 300,
  ship: { dockTimeSec: 5, approachSpeed: 4.2 },
};

// Порядок важен: так распределяются свободные слоты профессий.
export const ROLE_ORDER = ['builder', 'lumberjack', 'miner', 'blacksmith', 'farmer', 'herder', 'priest', 'guard'];

export const ROLES = {
  builder:    { label: 'Строитель',   short: 'стр', color: '#e2b45a', desc: 'Возводит постройки и тянет дороги' },
  lumberjack: { label: 'Лесоруб',     short: 'лес', color: '#8a6a45', desc: 'Заготавливает дерево в лесу' },
  miner:      { label: 'Шахтёр',      short: 'шах', color: '#a3a3a3', desc: 'Добывает камень в скалах' },
  blacksmith: { label: 'Кузнец',      short: 'куз', color: '#c0743a', desc: 'Кует инструменты и оружие для стражников' },
  farmer:     { label: 'Фермер',      short: 'фер', color: '#8fc46b', desc: 'Выращивает еду на полях' },
  herder:     { label: 'Животновод',  short: 'жив', color: '#c98d5a', desc: 'Даёт еду и немного золота с пастбища' },
  priest:     { label: 'Священник',   short: 'свщ', color: '#d9d2ea', desc: 'Повышает веру и настроение колонии' },
  guard:      { label: 'Стражник',    short: 'стр', color: '#8d9bb5', desc: 'Патрулирует колонию, повышает безопасность' },
  idle:       { label: 'Поселенец',   short: 'житель', color: '#cfc6b8', desc: 'Свободный житель без должности' },
};

// w/h — размер в клетках, cost — ресурсы, solid — блокирует проход,
// workplace — какую профессию обеспечивает, near — требование к местности.
export const BUILDINGS = {
  townhall: {
    name: 'Ратуша', w: 3, h: 3, solid: true, unique: true, cost: {},
    desc: 'Сердце колонии. Каждый уровень даёт по одному слоту каждой профессии.',
  },
  port: {
    name: 'Порт', w: 3, h: 3, solid: false, unique: true, cost: {},
    desc: 'Причал, куда приплывают корабли с новыми подписчиками.',
  },
  house: {
    name: 'Дом', w: 2, h: 2, solid: true, cost: { wood: 12 }, housing: 1, vote: 100,
    desc: 'Жильё для одного поселенца. Освобождается, если подписчик ушёл.',
  },
  field: {
    name: 'Поле', w: 3, h: 3, solid: false, cost: { wood: 6 }, workplace: 'farmer', jobBonus: { farmer: 1 }, vote: 75,
    desc: 'Фермер выращивает здесь еду. +1 слот фермера.',
  },
  pasture: {
    name: 'Пастбище', w: 3, h: 3, solid: false, cost: { wood: 10 }, workplace: 'herder', jobBonus: { herder: 1 }, vote: 62,
    desc: 'Животновод пасёт скот: еда и немного золота. +1 слот животновода.',
  },
  lumbercamp: {
    name: 'Лагерь лесорубов', w: 2, h: 2, solid: true, cost: { wood: 15 }, workplace: 'lumberjack', jobBonus: { lumberjack: 1 }, vote: 68, near: 'forest',
    desc: 'Ставится у леса. +1 слот лесоруба.',
  },
  mine: {
    name: 'Шахта', w: 2, h: 2, solid: true, cost: { wood: 20, stone: 5 }, workplace: 'miner', jobBonus: { miner: 1 }, vote: 66, near: 'rock',
    desc: 'Ставится у скал. +1 слот шахтёра.',
  },
  forge: {
    name: 'Кузница', w: 2, h: 2, solid: true, cost: { wood: 25, stone: 20 }, workplace: 'blacksmith', jobBonus: { blacksmith: 1 }, vote: 48,
    desc: 'Кузнец куёт инструменты и оружие из руды. +1 слот кузнеца.',
  },
  mill: {
    name: 'Мельница', w: 2, h: 2, solid: true, cost: { wood: 30, stone: 10 },
    converter: { in: { grain: 3 }, out: { flour: 2 }, every: 5 },
    vote: 52,
    desc: 'Мелит зерно в муку, ускоряет фермеров. Нужна пекарне.',
  },
  bakery: {
    name: 'Пекарня', w: 2, h: 2, solid: true, cost: { wood: 30, stone: 20 },
    converter: { in: { flour: 2 }, out: { food: 8 }, every: 6 },
    requires: 'mill', vote: 46,
    desc: 'Печёт хлеб из муки. Нужна мельница.',
  },
  warehouse: {
    name: 'Склад', w: 2, h: 2, solid: true, cost: { wood: 25, stone: 10 }, vote: 40,
    desc: 'Расширяет вместимость ресурсов.',
  },
  barracks: {
    name: 'Казармы', w: 3, h: 3, solid: true, cost: { wood: 40, stone: 30 }, workplace: 'guard', jobBonus: { guard: 1 }, vote: 34,
    desc: 'Дом для стражников, повышает безопасность. +1 слот стражника.',
  },
  church: {
    name: 'Церковь', w: 3, h: 3, solid: true, cost: { wood: 35, stone: 25 }, workplace: 'priest', jobBonus: { priest: 1 }, vote: 34,
    desc: 'Священник служит здесь, рядом появляется кладбище. +1 слот священника.',
  },
  tavern: {
    name: 'Таверна', w: 2, h: 2, solid: true, cost: { wood: 25, food: 10 }, vote: 22,
    desc: 'Место отдыха: колония дольше остаётся довольной.',
  },
  well: {
    name: 'Колодец', w: 1, h: 1, solid: true, cost: { stone: 10 }, vote: 16,
    desc: 'Чистая вода, небольшой бонус к производству.',
  },
  wall: {
    name: 'Стена', w: 1, h: 1, solid: true, cost: { stone: 8 }, vote: 12,
    desc: 'Каменный сегмент стены по периметру.',
  },
  fence: {
    name: 'Забор', w: 1, h: 1, solid: true, cost: { wood: 3 }, vote: 8,
    desc: 'Деревянный сегмент забора: размечает участки.',
  },
  road: {
    name: 'Дорога', w: 1, h: 1, solid: false, cost: {}, hidden: true,
    desc: 'Ускоряет передвижение поселенцев.',
  },
  grave: {
    name: 'Могила', w: 1, h: 1, solid: false, cost: {}, hidden: true,
    desc: 'Здесь покоится ушедший подписчик.',
  },
};

// Порог по числу подписчиков. Уровень = 1 слот каждой профессии за уровень.
export const LEVELS = [
  { level: 1, subs: 0 },
  { level: 2, subs: 6 },
  { level: 3, subs: 15 },
  { level: 4, subs: 30 },
  { level: 5, subs: 50 },
  { level: 6, subs: 80 },
  { level: 7, subs: 120 },
  { level: 8, subs: 170 },
];

export function levelForSubs(count) {
  let level = 1;
  for (const l of LEVELS) if (count >= l.subs) level = l.level;
  return level;
}

export function nextLevelFor(count) {
  for (const l of LEVELS) if (count < l.subs) return l;
  return null;
}

export const VOTABLE = Object.entries(BUILDINGS)
  .filter(([, b]) => !b.hidden && !b.unique)
  .map(([type, b]) => ({ type, ...b }));

export function costLabel(cost) {
  const names = { wood: 'дерево', stone: 'камень', food: 'еда', gold: 'золото', faith: 'вера' };
  const parts = Object.entries(cost).filter(([, v]) => v).map(([k, v]) => `${names[k] ?? k} ${v}`);
  return parts.length ? parts.join(' · ') : 'бесплатно';
}
