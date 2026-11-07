// Сырой ответ Helix: подписчики и фолловеры канала.
import fs from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const headers = {
  'Client-Id': env.TWITCH_CLIENT_ID,
  Authorization: `Bearer ${(env.TWITCH_BOT_TOKEN || env.TWITCH_USER_TOKEN || '').replace(/^oauth:/, '')}`,
};
const channel = (env.TWITCH_CHANNEL || '').toLowerCase();

const users = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, { headers }).then((r) => r.json());
const id = users.data?.[0]?.id;

const subsRes = await fetch(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${id}&first=100`, { headers });
const subs = await subsRes.json();
console.log('SUBS', subsRes.status);
console.log(JSON.stringify({ total: subs.total, points: subs.point, count: subs.data?.length, sample: subs.data?.slice(0, 5) }, null, 2));

const folRes = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${id}&first=100`, { headers });
const fol = await folRes.json();
console.log('FOLLOWERS', folRes.status);
console.log(JSON.stringify({ total: fol.total, count: fol.data?.length, sample: fol.data?.slice(0, 5) }, null, 2));
