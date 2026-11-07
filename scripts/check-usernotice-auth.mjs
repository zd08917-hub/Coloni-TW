// Проверка USERNOTICE на авторизованном подключении (только чтение, ничего не пишем).
import fs from 'node:fs';
import WebSocket from 'ws';

const envPath = new URL('../.env', import.meta.url);
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const token = (env.TWITCH_BOT_TOKEN || env.TWITCH_USER_TOKEN || '').replace(/^oauth:/, '');
const login = (env.TWITCH_BOT_LOGIN || 'h1rdwell').toLowerCase();
const channel = (process.argv[2] || 'kaicenat').toLowerCase();

const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
const stats = { channel, login, privmsg: 0, usernotice: 0, ids: {} };
ws.on('open', () => {
  ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
  ws.send(`PASS oauth:${token}`);
  ws.send(`NICK ${login}`);
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
