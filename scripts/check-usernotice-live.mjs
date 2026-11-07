// Ищет живой канал с активным чатом и проверяет, приходят ли USERNOTICE анонимно.
import fs from 'node:fs';
import WebSocket from 'ws';

const envPath = new URL('../.env', import.meta.url);
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const token = (env.TWITCH_USER_TOKEN || '').replace(/^oauth:/, '');
const clientId = env.TWITCH_CLIENT_ID;

const res = await fetch('https://api.twitch.tv/helix/streams?first=5', {
  headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
});
const data = await res.json();
if (!res.ok) {
  console.log('helix:', res.status, data.message || '');
  process.exit(1);
}
const live = (data.data || []).map((s) => s.user_login);
console.log('живые каналы:', live.join(', ') || 'нет');
if (!live.length) process.exit(1);

const channel = live[0];
const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
const stats = { channel, privmsg: 0, usernotice: 0, ids: {} };
ws.on('open', () => {
  ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
  ws.send('PASS SCHMOOZE');
  ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
  ws.send(`JOIN #${channel}`);
});
ws.on('message', (raw) => {
  for (const line of String(raw).split('\r\n')) {
    if (!line) continue;
    if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); continue; }
    if (line.includes('PRIVMSG')) stats.privmsg++;
    if (line.includes('USERNOTICE')) {
      stats.usernotice++;
      const id = (line.match(/msg-id=([^;]+)/) || [])[1] || '?';
      stats.ids[id] = (stats.ids[id] || 0) + 1;
    }
  }
});
setTimeout(() => {
  console.log(JSON.stringify(stats, null, 2));
  ws.close();
  process.exit(0);
}, 40000);
