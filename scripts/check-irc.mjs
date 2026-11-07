// Проверка входа в Twitch IRC с токеном из .env (ничего не отправляет в чат).
import fs from 'node:fs';
import WebSocket from 'ws';

const envPath = new URL('../.env', import.meta.url);
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const token = (env.TWITCH_BOT_TOKEN || env.TWITCH_USER_TOKEN || '').replace(/^oauth:/, '');
const login = (env.TWITCH_BOT_LOGIN || env.TWITCH_USERNAME || 'h1rdwell').toLowerCase();
if (!token) {
  console.log('нет токена в .env');
  process.exit(1);
}

const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
const done = (text, code) => {
  console.log(text);
  try { ws.close(); } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 50);
};

ws.on('open', () => {
  ws.send(`PASS oauth:${token}`);
  ws.send(`NICK ${login}`);
  ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
});

ws.on('message', (raw) => {
  const text = String(raw);
  if (text.includes('Login authentication failed')) done('IRC: токен не принят (истёк или неверный)', 1);
  else if (text.includes('Welcome, GLHF')) done('IRC: вход выполнен, токен рабочий', 0);
  else if (text.includes('improperly formatted auth')) done('IRC: некорректный формат токена', 1);
});

ws.on('error', (err) => done(`IRC: ошибка ${err.message}`, 1));
setTimeout(() => done('IRC: нет ответа за 8 секунд', 1), 8000);
