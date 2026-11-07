// Проверка: приходят ли USERNOTICE (подписки) на анонимное IRC-подключение.
// Подключается к чужому большому каналу и 45 секунд считает события.
import WebSocket from 'ws';

const channel = (process.argv[2] || 'twitch').toLowerCase();
const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
const stats = { privmsg: 0, usernotice: 0, ids: {} };
let joined = false;

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
    if (line.includes('JOIN #')) joined = true;
    if (line.includes('PRIVMSG')) stats.privmsg++;
    if (line.includes('USERNOTICE')) {
      stats.usernotice++;
      const id = (line.match(/msg-id=([^;]+)/) || [])[1] || '?';
      stats.ids[id] = (stats.ids[id] || 0) + 1;
    }
  }
});

setTimeout(() => {
  console.log(JSON.stringify({ channel, joined, ...stats }, null, 2));
  ws.close();
  process.exit(0);
}, 45000);
