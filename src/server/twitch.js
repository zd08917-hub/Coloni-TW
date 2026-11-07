// Twitch: чтение чата по IRC (без ключей), EventSub для подписок/отписок, демо-источник.

import WebSocket from 'ws';

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

function parseIrc(line) {
  const out = { tags: {}, prefix: '', command: '', params: [], trailing: '' };
  let rest = line;
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    for (const pair of rest.slice(1, sp).split(';')) {
      const eq = pair.indexOf('=');
      if (eq < 0) out.tags[pair] = '';
      else out.tags[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    rest = rest.slice(sp + 1);
  }
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    out.prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const trailIdx = rest.indexOf(' :');
  if (trailIdx >= 0) {
    out.trailing = rest.slice(trailIdx + 2);
    rest = rest.slice(0, trailIdx);
  }
  const parts = rest.split(' ').filter(Boolean);
  out.command = parts.shift() ?? '';
  out.params = parts;
  return out;
}

// Анонимное чтение чата: ловим USERNOTICE (sub/resub/subgift) и сообщения.
export class TwitchChat {
  constructor({ channel, onSub, onUnsub, onChat, onRaid, login, token, log }) {
    this.channel = channel.replace(/^#/, '').toLowerCase();
    this.onSub = onSub;
    this.onUnsub = onUnsub;
    this.onChat = onChat;
    this.onRaid = onRaid;
    this.login = (login || '').toLowerCase();
    this.token = (token || '').replace(/^oauth:/, '');
    this.log = log;
    this.ws = null;
    this.closed = false;
    this.connected = false;
  }

  connect() {
    if (this.closed) return;
    this.ws = new WebSocket(IRC_URL);
    this.ws.on('open', () => {
      this.ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      // USERNOTICE о подписках приходят только на авторизованное подключение
      if (this.token && this.login) {
        this.ws.send(`PASS oauth:${this.token}`);
        this.ws.send(`NICK ${this.login}`);
      } else {
        this.ws.send('PASS SCHMOOZE');
        this.ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      }
      this.ws.send(`JOIN #${this.channel}`);
      this.connected = true;
      this.log(`чат #${this.channel}: подключён ${this.token ? '(авторизован)' : '(анонимно)'}`);
    });
    this.ws.on('message', (raw) => this.handle(String(raw)));
    this.ws.on('error', (err) => this.log(`чат: ошибка ${err.message}`));
    this.ws.on('close', () => {
      this.connected = false;
      if (!this.closed) setTimeout(() => this.connect(), 5000);
    });
  }

  handle(raw) {
    for (const line of raw.split('\r\n')) {
      if (!line) continue;
      if (line.startsWith('PING')) {
        this.ws.send('PONG :tmi.twitch.tv');
        continue;
      }
      const msg = parseIrc(line);
      const key = (msg.tags.login || msg.prefix.split('!')[0] || '').toLowerCase();
      if (msg.command === 'USERNOTICE') {
        const id = msg.tags['msg-id'];
        this.log(`USERNOTICE: ${id || '?'} от ${msg.tags.login || '?'}`);
        const months = Number(msg.tags['msg-param-cumulative-months'] || 1);
        const tier = msg.tags['msg-param-sub-plan'] === '3000' ? 3 : msg.tags['msg-param-sub-plan'] === '2000' ? 2 : 1;
        if (['sub', 'resub'].includes(id)) {
          this.onSub?.({ login: key.toLowerCase(), name: msg.tags['display-name'] || key, months, tier });
        } else if (id === 'raid') {
          this.onRaid?.({
            name: msg.tags['msg-param-displayname'] || msg.tags['msg-param-displayName'] || msg.tags['display-name'] || '',
            login: msg.tags['msg-param-login'] || '',
            viewers: Number(msg.tags['msg-param-viewerCount'] || 0),
          });
        } else if (['subgift', 'anonsubgift'].includes(id)) {
          const target = (msg.tags['msg-param-recipient-user-name'] || '').toLowerCase();
          if (target) this.onSub?.({ login: target, name: msg.tags['msg-param-recipient-display-name'] || target, months: 1, tier, gifted: true });
        } else if (id === 'submysterygift') {
          this.log(`чат: ${msg.tags['display-name']} подарил ${msg.tags['msg-param-mass-gift-count']} подписок`);
        } else if (['giftpaidupgrade', 'rewardgift'].includes(id)) {
          this.log(`чат: апгрейд подписки у ${msg.tags['display-name']}`);
        }
        continue;
      }
      if (msg.command === 'PRIVMSG') {
        const text = msg.trailing;
        // логин лежит в префиксе строки: :login!login@login.tmi.twitch.tv
        const prefixLogin = (msg.prefix.split('!')[0] || '').toLowerCase();
        const login = prefixLogin || String(msg.tags.login || '').toLowerCase();
        this.onChat?.({
          login,
          name: msg.tags['display-name'] || login,
          text,
          badges: msg.tags.badges || '',
          isSub: /(^|,)(subscriber|founder|premium)\//.test(msg.tags.badges || ''),
        });
      }
    }
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

// EventSub через WebSocket: даёт точные события подписки и окончания подписки.
export class TwitchEventSub {
  constructor({ channel, clientId, clientSecret, userToken, onSub, onUnsub, onRaid, log }) {
    this.channel = channel.replace(/^#/, '').toLowerCase();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.userToken = userToken;
    this.onSub = onSub;
    this.onUnsub = onUnsub;
    this.onRaid = onRaid;
    this.log = log;
    this.ws = null;
    this.sessionId = null;
    this.broadcasterId = null;
    this.keepalive = null;
    this.closed = false;
  }

  async api(pathname, init = {}) {
    const res = await fetch(`https://api.twitch.tv/helix${pathname}`, {
      ...init,
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${this.userToken || this.appToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${pathname}: ${res.status} ${body.message || ''}`);
    return body;
  }

  async start() {
    try {
      if (!this.userToken) {
        const res = await fetch('https://id.twitch.tv/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'client_credentials',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'не удалось получить app token');
        this.appToken = data.access_token;
      }
      const users = await this.api(`/users?login=${encodeURIComponent(this.channel)}`);
      if (!users.data?.length) throw new Error(`канал ${this.channel} не найден`);
      this.broadcasterId = users.data[0].id;
      this.connect();
    } catch (err) {
      this.log(`EventSub недоступен: ${err.message}. Отписки ловим только по чату/вручную`);
    }
  }

  connect() {
    const url = this.userToken
      ? `wss://eventsub.wss.twitch.tv/ws?user_id=${this.broadcasterId}`
      : 'wss://eventsub.wss.twitch.tv/ws';
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => this.handle(JSON.parse(String(raw))));
    this.ws.on('error', (err) => this.log(`EventSub: ${err.message}`));
    this.ws.on('close', () => {
      if (!this.closed) setTimeout(() => this.connect(), 3000);
    });
  }

  async handle(msg) {
    const type = msg.metadata?.message_type;
    if (type === 'session_welcome') {
      this.sessionId = msg.payload.session.id;
      clearInterval(this.keepalive);
      this.keepalive = setInterval(() => {
        if (this.ws?.readyState === 1) this.ws.ping();
      }, 25000);
      for (const [subType, version, condition] of [
        ['channel.subscribe', '1', { broadcaster_user_id: this.broadcasterId }],
        ['channel.subscription.end', '1', { broadcaster_user_id: this.broadcasterId }],
        ['channel.subscription.gift', '1', { broadcaster_user_id: this.broadcasterId }],
        ['channel.raid', '1', { to_broadcaster_user_id: this.broadcasterId }],
      ]) {
        try {
          await this.api('/eventsub/subscriptions', {
            method: 'POST',
            body: JSON.stringify({
              type: subType,
              version,
              condition,
              transport: { method: 'websocket', session_id: this.sessionId },
            }),
          });
          this.log(`EventSub: подписка на ${subType} активна`);
        } catch (err) {
          this.log(`EventSub: ${subType} — ${err.message}`);
        }
      }
      return;
    }
    if (type === 'notification') {
      const sub = msg.metadata.subscription_type;
      const e = msg.payload.event;
      if (sub === 'channel.subscribe') {
        this.onSub?.({ login: e.user_login, name: e.user_name, months: 1, tier: e.tier === '3000' ? 3 : 1 });
      } else if (sub === 'channel.subscription.end') {
        this.onUnsub?.({ login: e.user_login, name: e.user_name });
      } else if (sub === 'channel.subscription.gift') {
        this.log(`EventSub: ${e.user_name} подарил ${e.total} подписок`);
      } else if (sub === 'channel.raid') {
        this.onRaid?.({ name: e.from_broadcaster_user_name, login: e.from_broadcaster_user_login, viewers: e.viewers });
      }
    }
    if (type === 'session_reconnect') {
      this.ws?.close();
      this.ws = null;
      const url = msg.payload.session.reconnect_url;
      setTimeout(() => {
        this.ws = new WebSocket(url);
        this.ws.on('message', (raw) => this.handle(JSON.parse(String(raw))));
      }, 500);
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.keepalive);
    this.ws?.close();
  }
}

// Аудитория канала: раз в минуту тянем списки подписчиков и фолловеров,
// чтобы `!join` отвечал мгновенно и без запроса на каждого зрителя.
export class Audience {
  constructor({ clientId, token, channel, log }) {
    this.clientId = clientId;
    this.token = (token || '').replace(/^oauth:/, '');
    this.channel = channel;
    this.log = log;
    this.broadcasterId = null;
    this.subs = new Set();
    this.followers = new Set();
    this.ready = false;
    this.lastSync = 0;
    this.timer = null;
    this.cache = new Map();
  }

  headers() {
    return { 'Client-Id': this.clientId, Authorization: `Bearer ${this.token}` };
  }

  async init() {
    try {
      const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(this.channel)}`, {
        headers: this.headers(),
      });
      const data = await res.json();
      if (!res.ok || !data.data?.length) throw new Error(data.message || 'канал не найден');
      this.broadcasterId = data.data[0].id;
      this.ready = true;
      await this.refresh();
      return true;
    } catch (err) {
      this.log(`списки аудитории не загружены: ${err.message}`);
      return false;
    }
  }

  async fetchAll(path, key) {
    const out = new Set();
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const url = `https://api.twitch.tv/helix/${path}${path.includes('?') ? '&' : '?'}first=100${cursor ? `&after=${cursor}` : ''}`;
      const res = await fetch(url, { headers: this.headers() });
      const body = await res.json();
      if (!res.ok) throw new Error(`${path}: ${res.status} ${body.message || ''}`);
      for (const row of body.data || []) out.add(String(row[key] || '').toLowerCase());
      cursor = body.pagination?.cursor;
      if (!cursor || !body.data?.length) break;
    }
    return out;
  }

  async refresh() {
    if (!this.ready || !this.broadcasterId) return;
    try {
      const [subs, followers] = await Promise.all([
        this.fetchAll(`subscriptions?broadcaster_id=${this.broadcasterId}`, 'user_login'),
        this.fetchAll(`channels/followers?broadcaster_id=${this.broadcasterId}`, 'user_login'),
      ]);
      subs.delete('');
      followers.delete('');
      this.subs = subs;
      this.followers = followers;
      this.lastSync = Date.now();
      this.log(`аудитория: подписчиков ${subs.size}, фолловеров ${followers.size}`);
      if (this.onRefresh) this.onRefresh();
    } catch (err) {
      this.log(`обновление списков не удалось: ${err.message}`);
    }
  }

  start(intervalMs = 60000) {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), intervalMs);
  }

  hasSubscriber(login) { return this.subs.has(String(login || '').toLowerCase()); }

  hasFollower(login) { return this.followers.has(String(login || '').toLowerCase()); }

  // точечная проверка на случай, если человек подписался только что
  async isFollower(login) {
    if (!this.ready) return false;
    const key = String(login || '').toLowerCase();
    if (this.followers.has(key)) return true;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < cached.ttl) return cached.ok;
    try {
      const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(key)}`, {
        headers: this.headers(),
      });
      const userData = await userRes.json();
      const id = userData.data?.[0]?.id;
      if (!id) return false;
      const res = await fetch(
        `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${this.broadcasterId}&user_id=${id}`,
        { headers: this.headers() },
      );
      if (!res.ok) return false;
      const data = await res.json();
      const ok = (data.data?.length ?? 0) > 0;
      if (ok) this.followers.add(key);
      this.cache.set(key, { ok, at: Date.now(), ttl: ok ? 10 * 60 * 1000 : 60 * 1000 });
      return ok;
    } catch {
      return false;
    }
  }
}

// Отправка сообщений в чат от имени бота (нужен токен с chat:read + chat:edit).
export class TwitchChatWriter {
  constructor({ channel, login, token, log }) {
    this.channel = channel.replace(/^#/, '').toLowerCase();
    this.login = login.toLowerCase();
    this.token = token.replace(/^oauth:/, '');
    this.log = log;
    this.ws = null;
    this.ready = false;
    this.queue = [];
    this.lastSent = 0;
    this.timer = null;
    this.closed = false;
  }

  connect() {
    if (this.closed) return;
    this.ws = new WebSocket(IRC_URL);
    this.ws.on('open', () => {
      this.ws.send(`PASS oauth:${this.token}`);
      this.ws.send(`NICK ${this.login}`);
      this.ws.send(`JOIN #${this.channel}`);
      this.ready = true;
      this.log(`бот ${this.login}: подключён к #${this.channel}`);
      this.pump();
    });
    this.ws.on('message', (raw) => {
      const text = String(raw);
      if (text.startsWith('PING')) this.ws.send('PONG :tmi.twitch.tv');
      if (text.includes('Login authentication failed')) {
        this.ready = false;
        this.log('бот: неверный токен, сообщения в чат отправляться не будут');
      }
    });
    this.ws.on('error', (err) => this.log(`бот: ${err.message}`));
    this.ws.on('close', () => {
      this.ready = false;
      if (!this.closed) setTimeout(() => this.connect(), 5000);
    });
  }

  say(text) {
    const clean = String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 450);
    if (!clean) return;
    this.queue.push(clean);
    if (this.queue.length > 12) this.queue.shift();
    this.pump();
  }

  pump() {
    if (this.timer || !this.ready) return;
    const now = Date.now();
    const wait = Math.max(0, 1600 - (now - this.lastSent));
    this.timer = setTimeout(() => {
      this.timer = null;
      const msg = this.queue.shift();
      if (!msg) return;
      if (this.ws?.readyState === 1) {
        this.ws.send(`PRIVMSG #${this.channel} :${msg}`);
        this.lastSent = Date.now();
      }
      this.pump();
    }, wait);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}

// Демо-режим: имитируем подписчиков, чтобы деревню можно было посмотреть без ключей.
const DEMO_NAMES = [
  'kotleta', 'melnik', 'night_owl', 'danya', 'sova', 'krolik', 'kapitoshka',
  'moroz', 'zmeika', 'barsik', 'tanos', 'pikachu', 'lis', 'volk', 'polyarnik',
  'cheshir', 'shurik', 'bublik', 'kefir', 'zvezda', 'malinka', 'kaban',
];

export class DemoSource {
  constructor({ onSub, onUnsub, log, maxPawns = 26 }) {
    this.onSub = onSub;
    this.onUnsub = onUnsub;
    this.log = log;
    this.used = new Set();
    this.timer = null;
    this.maxPawns = maxPawns;
    this.count = 0;
  }

  start() {
    this.pump();
    this.log('Демо-режим: подписчики приходят сами. Укажите TWITCH_CHANNEL в .env для реального канала');
  }

  pump() {
    const delay = 9000 + Math.random() * 9000;
    this.timer = setTimeout(() => {
      if (this.count < this.maxPawns) {
        const free = DEMO_NAMES.filter((n) => !this.used.has(n));
        if (free.length) {
          const name = free[Math.floor(Math.random() * free.length)];
          this.used.add(name);
          this.count++;
          this.onSub({ login: name, name, months: 1 + Math.floor(Math.random() * 14), tier: 1 });
        }
      } else if (Math.random() < 0.35) {
        const names = [...this.used];
        const victim = names[Math.floor(Math.random() * names.length)];
        this.used.delete(victim);
        this.count = Math.max(0, this.count - 1);
        this.onUnsub({ login: victim, name: victim });
      }
      this.pump();
    }, delay);
  }

  close() { clearTimeout(this.timer); }
}
