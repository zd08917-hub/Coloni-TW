// Проверка токена Twitch: показывает логин, скоупы и срок действия, не печатая сам токен.
import fs from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
}

const token = env.TWITCH_BOT_TOKEN || env.TWITCH_USER_TOKEN;
if (!token) {
  console.log('в .env нет TWITCH_USER_TOKEN/TWITCH_BOT_TOKEN');
  process.exit(1);
}

const res = await fetch('https://id.twitch.tv/oauth2/validate', {
  headers: { Authorization: `OAuth ${token}` },
});
const body = await res.json();
if (!res.ok) {
  console.log(`токен недействителен: ${res.status} ${body.message || ''}`);
  process.exit(1);
}
console.log(JSON.stringify({
  login: body.login,
  user_id: body.user_id,
  client_id: body.client_id,
  scopes: body.scopes,
  expires_in_sec: body.expires_in,
}, null, 2));
