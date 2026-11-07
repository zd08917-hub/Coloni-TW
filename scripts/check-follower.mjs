// Проверка isFollower для нескольких логинов через тот же путь, что и в игре.
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

const names = process.argv.slice(2);
if (!names.length) names.push('ksusha__sher', 'treebals', 'definitely_not_a_follower_zzz');

for (const name of names) {
  const u = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(name)}`, { headers });
  const uj = await u.json();
  const id = uj.data?.[0]?.id;
  if (!id) { console.log(`${name}: пользователь не найден (${u.status})`); continue; }
  const f = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&user_id=${id}`, { headers });
  const fj = await f.json();
  console.log(`${name}: status=${f.status} data=${(fj.data || []).length} ${fj.message || ''}`);
}
