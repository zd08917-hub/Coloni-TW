// Обновляет access token по refresh token и записывает новые значения в .env.
// Секреты не печатаются: выводится только статус и срок жизни.
import fs from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const text = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}

const clientId = env.TWITCH_CLIENT_ID;
const refresh = env.TWITCH_REFRESH_TOKEN || process.env.TWITCH_REFRESH_TOKEN;
if (!clientId || !refresh) {
  console.log('нужны TWITCH_CLIENT_ID и TWITCH_REFRESH_TOKEN');
  process.exit(1);
}

const res = await fetch('https://id.twitch.tv/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: clientId,
  }),
});
const body = await res.json();
if (!res.ok) {
  console.log(`не удалось обновить: ${res.status} ${body.message || ''}`);
  process.exit(1);
}

const setValue = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`);
  } else {
    text += `\n${key}=${value}\n`;
  }
};

let updated = text;
const write = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, 'm');
  updated = re.test(updated) ? updated.replace(re, `${key}=${value}`) : `${updated}\n${key}=${value}`;
};

write('TWITCH_USER_TOKEN', body.access_token);
if (body.refresh_token) write('TWITCH_REFRESH_TOKEN', body.refresh_token);
fs.writeFileSync(envPath, updated, 'utf8');

console.log(JSON.stringify({
  ok: true,
  expires_in_sec: body.expires_in,
  scopes: body.scope,
  refresh_rotated: !!body.refresh_token,
}, null, 2));
