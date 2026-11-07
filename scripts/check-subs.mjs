// Проверка доступа к подпискам через Helix (список и проверка одного пользователя).
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
const broadcasterId = users.data?.[0]?.id;
console.log('broadcaster_id:', broadcasterId);

const list = await fetch(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}&first=20`, { headers });
const listBody = await list.json();
console.log('список подписок:', list.status, listBody.message || '', 'total=', listBody.total);
if (listBody.data?.length) {
  console.log('примеры:', listBody.data.slice(0, 5).map((s) => `${s.user_login}(t${s.tier})`).join(', '));
}

const names = process.argv.slice(2);
for (const name of names) {
  const u = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(name)}`, { headers }).then((r) => r.json());
  const id = u.data?.[0]?.id;
  if (!id) { console.log(`${name}: пользователь не найден`); continue; }
  const one = await fetch(`https://api.twitch.tv/helix/subscriptions/user?broadcaster_id=${broadcasterId}&user_id=${id}`, { headers });
  const body = await one.json();
  console.log(`${name}: status=${one.status} ${body.data?.length ? `подписан tier ${body.data[0].tier}` : 'не подписан'} ${body.message || ''}`);
}
