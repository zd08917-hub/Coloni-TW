// Проверка разбора IRC: логин должен извлекаться из префикса строки.
import { TwitchChat } from '../src/server/twitch.js';

let captured = null;
const chat = new TwitchChat({
  channel: 'h1rdwell',
  log: () => {},
  onChat: (m) => { captured = m; },
});

const line = ':vogteam55!vogteam55@vogteam55.tmi.twitch.tv PRIVMSG #h1rdwell :!Join';
chat.handle(line);

console.log(JSON.stringify({
  login: captured?.login,
  name: captured?.name,
  text: captured?.text,
  isSub: captured?.isSub,
}, null, 2));

if (captured?.login !== 'vogteam55') {
  console.error('ОШИБКА: логин не извлёкся');
  process.exit(1);
}
console.log('ок: логин извлекается');
process.exit(0);
