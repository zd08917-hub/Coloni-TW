// Список фолловеров канала через Helix (для проверки доступа и наполнения subs.txt).
import fs from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const clientId = env.TWITCH_CLIENT_ID;
const token = (env.TWITCH_BOT_TOKEN || env.TWITCH_USER_TOKEN || '').replace(/^oauth:/, '');
const channel = (env.TWITCH_CHANNEL || '').toLowerCase();
const headers = { 'Client-Id': clientId, Authorization: `Bearer ${token}` };

const users = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, { headers }).then((r) => r.json());
const id = users.data?.[0]?.id;
if (!id) {
  console.log('канал не найден');
  process.exit(1);
}
const res = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${id}&first=20`, { headers });
const data = await res.json();
if (!res.ok) {
  console.log(`фолловеры недоступны: ${res.status} ${data.message || ''}`);
  process.exit(1);
}
console.log(JSON.stringify({
  total: data.total,
  followers: (data.data || []).map((f) => f.user_login),
}, null, 2));
