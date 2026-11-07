import { World } from './world.js';
import { Hud } from './ui.js';
import { Net } from './net.js';
import { Sound } from './audio.js';

const LOG_SOUND = {
  ship: 'ship',
  build: 'build',
  death: 'death',
  vote: 'vote',
  danger: 'alarm',
  level: 'level',
  event: 'chime',
  fight: 'fight',
};

function dayPhase(progress) {
  const h = progress * 24;
  if (h < 5.5 || h >= 21) return 'night';
  if (h < 8.5) return 'dawn';
  if (h < 18) return 'day';
  return 'dusk';
}

const canvas = document.getElementById('scene');
const world = new World(canvas);
const params = new URLSearchParams(location.search);
const isStream = params.get('stream') === '1';
if (isStream) {
  document.body.classList.add('stream');
  world.labelScale = 1.25;
  world.viewHeight = 26;
}
const sound = new Sound();
let state = null;
let prevResources = null;
let lastPhase = null;
let lastPhaseSent = -1;
let lastEventId = null;

const hud = new Hud({
  onVote: (key) => {
    net.vote(key);
    sound.play('vote');
    if (state?.vote) hud.registerVote(state.vote.number, key);
  },
  onFocus: (x, z) => world.focusOn(x, z),
  onLabels: (on) => world.setLabels(on),
  onSound: () => {
    const enabled = sound.toggle();
    hud.syncSound(enabled);
  },
  onDev: (kind) => {
    fetch(`/api/dev/${kind}`, { method: 'POST' }).catch(() => {});
  },
});

const net = new Net({
  onInit: (msg) => {
    world.setMap(msg.map);
    hud.setMode(msg.mode);
    apply(msg.state);
    hud.pushLog(msg.state.log ?? []);
    hud.syncSound(sound.enabled);
    hud.ready();
  },
  onState: (next) => {
    apply(next);
    if (next.log?.length) {
      hud.pushLog(next.log);
      for (const entry of next.log) {
        const cue = LOG_SOUND[entry.kind];
        if (cue) sound.play(cue);
      }
    }
  },
  onMap: (map) => world.setMap(map),
  onFocus: (msg) => {
    const ok = world.focusPawnFor(msg.pawnId, msg.seconds ?? 30);
    if (ok) {
      world.select('pawn', msg.pawnId);
      hud.select('pawn', msg.pawnId);
    }
  },
});

function apply(next) {
  if (prevResources) {
    const gained = ['wood', 'stone', 'food'].some((k) => (next.resources[k] ?? 0) > (prevResources[k] ?? 0));
    if (gained) sound.play('coin');
  }
  prevResources = { ...next.resources };

  if (next.day) {
    const phase = dayPhase(next.day.progress);
    if (lastPhase && phase !== lastPhase) {
      if (phase === 'dawn') sound.play('dawn');
      if (phase === 'dusk') sound.play('dusk');
    }
    lastPhase = phase;
    if (Math.abs(next.day.progress - lastPhaseSent) > 0.012) {
      lastPhaseSent = next.day.progress;
      sound.setPhase(next.day.progress);
    }
  }

  const ev = next.events?.[0];
  if (ev && ev.id !== lastEventId) {
    lastEventId = ev.id;
    if (ev.kind === 'zombies') sound.play('zombie');
    else if (ev.kind === 'raid') sound.play('alarm');
  }

  state = next;
  world.applyState(next);
  hud.update(next);
}

world.onSelect = (kind, id) => {
  world.select(kind, id);
  hud.select(kind, id);
  sound.play('click');
};

world.onGround = (point) => {
  if (!point) return;
  if (hud.movePawnId) {
    net.move(hud.movePawnId, point.x, point.z);
    world.showMoveMarker(point.x, point.z);
    hud.movePawnId = null;
    hud.signatures.detail = '';
    hud.renderDetail(state);
    return;
  }
  world.select(null);
  hud.clearSelection();
};

world.onHover = (hit, x, y) => {
  if (!hit || !state) {
    hud.showTooltip(null);
    return;
  }
  if (hit.kind === 'pawn') {
    const p = state.pawns.find((pp) => pp.id === hit.id);
    if (!p) return hud.showTooltip(null);
    const role = { builder: 'Строитель', lumberjack: 'Лесоруб', miner: 'Шахтёр', blacksmith: 'Кузнец', farmer: 'Фермер', herder: 'Животновод', priest: 'Священник', guard: 'Стражник', idle: 'Без должности' }[p.role] ?? p.role;
    hud.showTooltip(`${p.name} · ${role} · ${p.months} мес.`, x, y);
  } else {
    const b = state.buildings.find((bb) => bb.id === hit.id);
    if (!b) return hud.showTooltip(null);
    const name = b.name || 'Постройка';
    hud.showTooltip(b.occupant ? `${name} · живёт ${b.occupant}` : name, x, y);
  }
};

window.addEventListener('pointerdown', () => sound.init(), { once: true });
window.addEventListener('keydown', () => sound.init(), { once: true });

window.__colony = { world, hud, sound, get state() { return state; } };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    world.select(null);
    hud.clearSelection();
  }
  if (e.code === 'KeyN') hud.toggleLabels();
});
