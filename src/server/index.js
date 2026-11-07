// HTTP + WebSocket сервер: раздаёт клиент, крутит симуляцию и слушает Twitch.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Village } from './village.js';
import { CONFIG } from './defs.js';
import { TwitchChat, TwitchEventSub, TwitchChatWriter, Audience, DemoSource } from './twitch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_BUILD = path.join(ROOT, 'node_modules/three/build');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 8787);
const LOG_DIR = path.join(ROOT, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }
const LOG_FILE = path.join(LOG_DIR, 'colony.log');

const log = (...args) => {
  const line = `[${new Date().toLocaleTimeString('ru-RU')}] ${args.join(' ')}`;
  console.log(line);
  try {
    if (fs.statSync(LOG_FILE).size > 3_000_000) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
  } catch { /* файла ещё нет */ }
  try { fs.appendFileSync(LOG_FILE, `${line}\n`); } catch { /* ignore */ }
};

let village = (() => {
  const saveFile = path.join(ROOT, 'data', 'save.json');
  if (process.env.RESET !== '1' && fs.existsSync(saveFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
      const v = new Village(data.map?.seed ?? CONFIG.mapSeed);
      v.restore(data);
      log(`сохранение загружено: ${v.pawns.length} жителей, ${v.buildings.size} построек`);
      return v;
    } catch (err) {
      log(`сохранение не загрузилось (${err.message}), начинаем заново`);
    }
  }
  return new Village(Number(process.env.MAP_SEED || CONFIG.mapSeed));
})();

const DATA_DIR = path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'save.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }

function saveNow() {
  try {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(village.exportState()));
  } catch (err) {
    log(`не удалось сохранить: ${err.message}`);
  }
}
setInterval(saveNow, 20000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Не найдено');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': file.includes('node_modules') ? 'public, max-age=3600' : 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      pawns: village.pawns.length,
      subs: village.subs.size,
      mode: sourceMode(),
      followersCheck: audience ? audience.ready : false,
      allowAllJoin: village.allowAllJoin,
      audienceSubs: audience ? audience.subs.size : 0,
      audienceFollowers: audience ? audience.followers.size : 0,
    }));
    return;
  }
  if (pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(village.snapshot()));
    return;
  }
  if (pathname.startsWith('/api/dev/')) {
    const name = url.searchParams.get('name') || `гость${Math.floor(Math.random() * 900 + 100)}`;
    let result = { ok: true };
    if (pathname === '/api/dev/sub') {
      village.addSubscriber({ login: name.toLowerCase(), name, months: 1 + Math.floor(Math.random() * 12) });
      log(`dev: +подписчик ${name}`);
    } else if (pathname === '/api/dev/unsub') {
      const target = url.searchParams.get('name')
        || village.pawns.filter((p) => !p.dead)[0]?.login;
      result = { ok: target ? village.removeSubscriber(target) : false, target };
      log(`dev: -подписчик ${target}`);
    } else if (pathname === '/api/dev/vote') {
      village.vote = null;
      village.voteTimer = 0;
      village.openVote();
    } else if (pathname === '/api/dev/order') {
      const type = url.searchParams.get('type') || 'forge';
      village.addOrder(type);
      result = { ok: true, type };
      log(`dev: заказ на ${type}`);
    } else if (pathname === '/api/dev/event') {
      const kind = url.searchParams.get('kind') || 'barbarians';
      if (kind === 'trade' || kind === 'harvest') village.startBoon(kind);
      else if (kind === 'raid') {
        village.startStreamerRaid({
          name: url.searchParams.get('name') || 'bigstreamer',
          viewers: Number(url.searchParams.get('viewers') || 120),
        });
      } else village.startRaid(kind);
      result = { ok: true, kind };
      log(`dev: событие ${kind}`);
    } else if (pathname === '/api/dev/time') {
      const hour = Number(url.searchParams.get('hour') ?? 12);
      village.setHour(hour);
      result = { ok: true, hour };
    } else if (pathname === '/api/dev/give') {
      for (const key of ['wood', 'stone', 'food', 'gold', 'faith', 'tools', 'weapons', 'ore', 'grain', 'flour']) {
        const value = Number(url.searchParams.get(key) ?? 0);
        if (value) village.addRes(key, value);
      }
      result = { ok: true, resources: village.resources };
    } else if (pathname === '/api/dev/chat') {
      const name = url.searchParams.get('name') || 'гость';
      const text = url.searchParams.get('text') || '';
      const isSub = url.searchParams.get('sub') === '1';
      const badges = url.searchParams.get('badges') || '';
      let res = village.handleChat({ login: name.toLowerCase(), name, text, isSub, badges });
      if (res?.type === 'need-follow-check') {
        const ok = followersApi ? await followersApi.isFollower(name) : false;
        res = ok
          ? village.joinByCommand(name.toLowerCase(), name, true)
          : { type: 'reply', text: `${name}, не вижу тебя среди подписчиков или фолловеров канала` };
      }
      result = { ok: true, res };
    } else if (pathname === '/api/dev/ring') {
      const pts = village.ringSegments();
      result = { ok: true, houses: village.count('house'), walls: village.count('wall'), count: pts.length, sample: pts.slice(0, 6) };
    } else if (pathname === '/api/dev/reset') {
      try { fs.rmSync(SAVE_FILE, { force: true }); } catch { /* ignore */ }
      village = new Village(Number(process.env.MAP_SEED || CONFIG.mapSeed));
      village.onAnnounce = say;
      village.quietChat = process.env.QUIET_CHAT === '1';
      village.allowAllJoin = process.env.ALLOW_ALL_JOIN === '1';
      village.followCheckAvailable = audience ? audience.ready : false;
      village.audience = audience;
      village.excludeLogins.add(channel);
      mapVersionSeen = -1;
      log('dev: колония перезапущена');
    } else {
      result = { ok: false, error: 'unknown endpoint' };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  let file;
  if (pathname.startsWith('/vendor/')) {
    file = path.join(THREE_BUILD, pathname.slice('/vendor/'.length));
  } else {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    file = path.join(PUBLIC, rel);
  }
  if (!path.resolve(file).startsWith(path.resolve(pathname.startsWith('/vendor/') ? THREE_BUILD : PUBLIC))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  serveFile(res, file);
});

const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, type, payload) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

wss.on('connection', (ws) => {
  const client = { ws, name: `Гость-${Math.floor(Math.random() * 9000 + 1000)}` };
  const initial = village.snapshot();
  initial.log = village.feed.slice(-40);
  send(ws, 'init', { map: village.mapSnapshot(), state: initial, mode: sourceMode() });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'hello' && typeof msg.name === 'string') {
      client.name = msg.name.slice(0, 24) || client.name;
    } else if (msg.type === 'vote' && msg.option) {
      village.castVote(`web:${client.name}`, String(msg.option), `${client.name} (сайт)`);
    } else if (msg.type === 'move' && msg.pawnId) {
      const pawn = village.pawns.find((p) => p.id === Number(msg.pawnId) && !p.dead);
      if (pawn) village.goTo(pawn, Number(msg.x), Number(msg.y), 'move', 0.4);
    } else if (msg.type === 'ping') {
      send(ws, 'pong', { t: Date.now() });
    }
  });
});

let mapVersionSeen = -1;

setInterval(() => {
  if (village.map.version !== mapVersionSeen) {
    mapVersionSeen = village.map.version;
    const mapPayload = JSON.stringify({ type: 'map', map: village.mapSnapshot() });
    for (const ws of wss.clients) if (ws.readyState === 1) ws.send(mapPayload);
  }
  const state = village.snapshot();
  state.log = village.drainFeed();
  const payload = JSON.stringify({ type: 'state', state });
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(payload);
}, CONFIG.snapshotMs);

setInterval(() => {
  village.tick(CONFIG.tickMs / 1000);
}, CONFIG.tickMs);

// ---------------------------------------------------------------- источники событий

let chat = null;
let eventsub = null;
let demo = null;
let chatWriter = null;
let audience = null;

function sourceMode() {
  return channel ? 'twitch' : 'demo';
}

function loadSubsFile() {
  const file = path.join(ROOT, process.env.IMPORT_SUBS || 'subs.txt');
  if (!fs.existsSync(file)) return;
  const names = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean)
    .slice(0, 300);
  for (const name of names) village.addSubscriber({ login: name.toLowerCase(), name });
  log(`импорт подписчиков: ${names.length} из ${path.basename(file)}`);
}

const channel = (process.env.TWITCH_CHANNEL || '').trim().toLowerCase();
const botLogin = (process.env.TWITCH_BOT_LOGIN || '').trim();
const botToken = (process.env.TWITCH_BOT_TOKEN || '').trim();

// сообщения от имени бота: без токена просто пишем в консоль
function say(text) {
  if (!text) return;
  log(`чат → ${text}`);
  chatWriter?.say(text);
}

village.onAnnounce = say;
village.quietChat = process.env.QUIET_CHAT === '1';
village.allowAllJoin = process.env.ALLOW_ALL_JOIN === '1';

loadSubsFile();

if (channel && botLogin && botToken) {
  chatWriter = new TwitchChatWriter({ channel, login: botLogin, token: botToken, log });
  chatWriter.connect();
} else if (channel) {
  log('бот-писатель выключен: укажите TWITCH_BOT_LOGIN и TWITCH_BOT_TOKEN, чтобы игра отвечала в чат');
}

if (channel) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const userToken = process.env.TWITCH_USER_TOKEN;

  if (clientId && botToken) {
    audience = new Audience({ clientId, token: botToken, channel, log });
    village.audience = audience;
    village.excludeLogins.add(channel);
    const autoAdd = Number(process.env.AUTO_ADD_PER_MIN ?? 3);
    // после каждого обновления списков доселяем тех, кого ещё нет в колонии
    audience.onRefresh = () => {
      if (!autoAdd) return;
      const out = village.syncMissing({ includeFollowers: true, limit: autoAdd });
      if (out.added) log(`автозаселение: +${out.added} (всего известно ${out.total})`);
    };
    audience.init().then((ok) => {
      village.followCheckAvailable = ok;
      if (ok) audience.start(60000);
    });
  }

  chat = new TwitchChat({
    channel,
    login: botLogin,
    token: botToken,
    log,
    onSub: (s) => village.addSubscriber(s),
    onUnsub: (s) => village.removeSubscriber(s.login),
    onRaid: (r) => village.startStreamerRaid(r),
    onChat: async (m) => {
      try {
        if (String(m.text || '').startsWith('!')) {
          log(`чат: ${m.name} [${m.badges || 'без бейджей'}] ${m.text}`);
        }
        const res = village.handleChat(m);
        if (res?.type === 'status') { say(village.statusLine()); return; }
        if (res?.type === 'reply') { say(res.text); return; }
        if (res?.type === 'need-follow-check') {
          const ok = audience ? await audience.isFollower(m.login) : false;
          log(`фолловинг ${m.login}: ${ok ? 'да' : 'нет или ошибка'}`);
          if (ok) {
            const out = village.joinByCommand(m.login, m.name, true);
            if (out?.text) say(out.text);
          } else {
            say(`${m.name}, не вижу тебя среди подписчиков или фолловеров. Если только что подписался — напиши !join через минуту`);
          }
          return;
        }
        if (res?.type === 'focus') {
          const payload = JSON.stringify({ type: 'focus', pawnId: res.pawnId, name: res.name, seconds: 30 });
          for (const ws of wss.clients) if (ws.readyState === 1) ws.send(payload);
          say(`${res.name}, показываю твоего персонажа на карте`);
          return;
        }
        if (res?.type === 'vote') return;
        if (res?.type === 'sync-audience') {
          if (audience) {
            await audience.refresh();
            village.audience = audience;
          }
          const out = village.syncMissing({ includeFollowers: true, limit: 40 });
          say(`Синхронизация: добавлено ${out.added} из ${out.total} известных зрителей`);
          log(`синхронизация: +${out.added} из ${out.total}`);
          return;
        }
      } catch (err) {
        log(`ошибка обработки чата: ${err.message}`);
      }
    },
  });
  chat.connect();

  if (clientId && clientSecret) {
    eventsub = new TwitchEventSub({
      channel,
      clientId,
      clientSecret,
      userToken,
      log,
      onSub: (s) => village.addSubscriber(s),
      onUnsub: (s) => village.removeSubscriber(s.login),
      onRaid: (r) => village.startStreamerRaid(r),
    });
    eventsub.start();
  } else {
    log('EventSub выключен: нет TWITCH_CLIENT_ID/SECRET. Отписки не отслеживаются автоматически');
  }

  // тестовые подписчики поверх реального канала (для проверки эфира)
  if (process.env.DEMO_EVENTS === '1') {
    demo = new DemoSource({
      log,
      maxPawns: 8,
      onSub: (s) => village.addSubscriber(s),
      onUnsub: (s) => village.removeSubscriber(s.login),
    });
    demo.start();
  }
} else {
  demo = new DemoSource({
    log,
    onSub: (s) => village.addSubscriber(s),
    onUnsub: (s) => village.removeSubscriber(s.login),
  });
  demo.start();
}

server.listen(PORT, () => {
  log(`Колония запущена: http://localhost:${PORT}`);
  log(channel ? `канал Twitch: #${channel}` : 'режим: демо (без Twitch)');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    saveNow();
    chat?.close();
    eventsub?.close();
    chatWriter?.close();
    demo?.close();
    process.exit(0);
  });
}
