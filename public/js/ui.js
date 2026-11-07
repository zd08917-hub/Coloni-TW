// Интерфейс: ресурсы, карточки, голосование, хроника.

const ROLE_INFO = {
  builder: { label: 'Строитель', color: '#e2b45a' },
  lumberjack: { label: 'Лесоруб', color: '#8a6a45' },
  miner: { label: 'Шахтёр', color: '#a3a3a3' },
  blacksmith: { label: 'Кузнец', color: '#c0743a' },
  farmer: { label: 'Фермер', color: '#8fc46b' },
  herder: { label: 'Животновод', color: '#c98d5a' },
  priest: { label: 'Священник', color: '#d9d2ea' },
  guard: { label: 'Стражник', color: '#8d9bb5' },
  idle: { label: 'Без должности', color: '#cfc6b8' },
};

const STATE_LABELS = {
  walk: 'в пути',
  work: 'работает',
  build: 'строит',
  home: 'дома',
  idle: 'отдыхает',
  wait: 'сходит с корабля',
  fight: 'в бою',
  wounded: 'ранен, лечится',
  dead: 'покинул колонию',
};

const RES = [
  { key: 'wood', label: 'дерево', color: '#b08850' },
  { key: 'stone', label: 'камень', color: '#9aa0a6' },
  { key: 'food', label: 'еда', color: '#8fc46b' },
  { key: 'faith', label: 'вера', color: '#c9b0e8' },
  { key: 'gold', label: 'золото', color: '#e2b45c' },
  { key: 'tools', label: 'инстр.', color: '#d9a06a', extra: true },
  { key: 'weapons', label: 'оружие', color: '#c96a5a', extra: true },
  { key: 'ore', label: 'руда', color: '#8b8578', extra: true },
  { key: 'grain', label: 'зерно', color: '#d9c07a', extra: true },
  { key: 'flour', label: 'мука', color: '#e8dcc0', extra: true },
];

const COST_RU = { wood: 'дерево', stone: 'камень', food: 'еда', gold: 'золото', faith: 'вера' };
const TYPE_RU = {
  house: 'Дом', field: 'Поле', pasture: 'Пастбище', lumbercamp: 'Лагерь лесорубов',
  mine: 'Шахта', forge: 'Кузница', mill: 'Мельница', bakery: 'Пекарня', warehouse: 'Склад',
  barracks: 'Казармы', church: 'Церковь', tavern: 'Таверна', well: 'Колодец',
  wall: 'Стена', wallring: 'Стена по периметру', fence: 'Забор',
  townhall: 'Ратуша', port: 'Порт', grave: 'Могила', road: 'Дорога',
};

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '—'; }
};

const costText = (cost = {}) => {
  const parts = Object.entries(cost).filter(([, v]) => v).map(([k, v]) => `${COST_RU[k] ?? k} ${v}`);
  return parts.length ? parts.join(' · ') : 'бесплатно';
};

const fmtClock = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = String(Math.max(0, Math.floor(seconds % 60))).padStart(2, '0');
  return `${m}:${s}`;
};

export class Hud {
  constructor(handlers = {}) {
    this.h = handlers;
    this.selected = null;
    this.movePawnId = null;
    this.myVotes = new Map();
    this.logCount = 0;
    this.signatures = {};

    this.el = {
      boot: document.getElementById('boot'),
      subs: document.getElementById('subCount'),
      level: document.getElementById('levelNum'),
      levelFill: document.getElementById('levelFill'),
      levelHint: document.getElementById('levelHint'),
      resources: document.getElementById('resources'),
      detail: document.getElementById('detailBody'),
      jobs: document.getElementById('jobsBody'),
      log: document.getElementById('log'),
      vote: document.getElementById('voteCard'),
      voteNumber: document.getElementById('voteNumber'),
      voteTimer: document.getElementById('voteTimer'),
      voteOptions: document.getElementById('voteOptions'),
      devbar: document.getElementById('devbar'),
      labelToggle: document.getElementById('labelToggle'),
      soundToggle: document.getElementById('soundToggle'),
      clock: document.getElementById('clock'),
      eventCard: document.getElementById('eventCard'),
      eventIcon: document.getElementById('eventIcon'),
      eventTitle: document.getElementById('eventTitle'),
      eventText: document.getElementById('eventText'),
      eventTimer: document.getElementById('eventTimer'),
      tooltip: document.getElementById('tooltip'),
    };

    this.labelsOn = true;
    this.el.labelToggle.classList.add('on');
    this.el.labelToggle.textContent = 'ники: вкл';
    this.el.labelToggle.addEventListener('click', () => this.toggleLabels());
    this.el.soundToggle.addEventListener('click', () => this.h.onSound?.());
    this.el.detail.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'focus') this.focusSelected();
      if (act === 'move') this.toggleMove(btn);
    });

    this.el.voteOptions.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-key]');
      if (!btn) return;
      this.h.onVote?.(btn.dataset.key);
    });

    this.el.devbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-dev]');
      if (!btn) return;
      this.h.onDev?.(btn.dataset.dev);
    });
  }

  ready() {
    this.el.boot.classList.add('hidden');
  }

  toggleLabels(force) {
    this.labelsOn = force === undefined ? !this.labelsOn : !!force;
    this.el.labelToggle.classList.toggle('on', this.labelsOn);
    this.el.labelToggle.textContent = this.labelsOn ? 'ники: вкл' : 'ники: выкл';
    this.h.onLabels?.(this.labelsOn);
  }

  syncSound(enabled) {
    this.el.soundToggle.classList.toggle('on', enabled);
    this.el.soundToggle.textContent = enabled ? 'звук: вкл' : 'звук: выкл';
  }

  setMode(mode) {
    const stream = document.body.classList.contains('stream');
    this.el.devbar.hidden = mode !== 'demo' || stream;
  }

  select(kind, id) {
    this.selected = { kind, id };
    this.movePawnId = null;
    this.signatures.detail = '';
    this.renderDetail(this.state);
  }

  clearSelection() {
    this.selected = null;
    this.movePawnId = null;
    this.signatures.detail = '';
    this.renderDetail(this.state);
  }

  focusSelected() {
    if (!this.selected || !this.state) return;
    if (this.selected.kind === 'pawn') {
      const p = this.state.pawns.find((x) => x.id === this.selected.id);
      if (p) this.h.onFocus?.(p.x, p.y);
    } else {
      const b = this.state.buildings.find((x) => x.id === this.selected.id);
      if (b) this.h.onFocus?.(b.x + b.w / 2, b.y + b.h / 2);
    }
  }

  toggleMove(btn) {
    if (!this.selected || this.selected.kind !== 'pawn') return;
    if (this.movePawnId) {
      this.movePawnId = null;
      btn.classList.remove('active');
      btn.textContent = 'Вести';
    } else {
      this.movePawnId = this.selected.id;
      btn.classList.add('active');
      btn.textContent = 'Кликните по карте';
    }
  }

  update(state) {
    this.state = state;
    this.renderTop(state);
    this.renderClock(state);
    this.renderEvents(state);
    this.renderDetail(state);
    this.renderJobs(state);
    this.renderVote(state);
  }

  renderClock(state) {
    const day = state.day;
    if (!day) return;
    const totalMin = day.progress * 24 * 60;
    const h = Math.floor(totalMin / 60) % 24;
    const m = Math.floor(totalMin % 60);
    const night = h < 6 || h >= 20;
    const icon = night ? '☾' : (h < 9 ? '☀' : (h < 17 ? '☀' : '☀'));
    const label = night ? 'ночь' : (h < 9 ? 'рассвет' : (h < 17 ? 'день' : 'закат'));
    const text = `${icon} День ${day.number} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${label}`;
    if (this.el.clock.textContent !== text) this.el.clock.textContent = text;
  }

  renderEvents(state) {
    const ev = state.events?.[0];
    if (!ev) {
      if (!this.el.eventCard.hidden) this.el.eventCard.hidden = true;
      this.signatures.event = '';
      return;
    }
    this.el.eventCard.hidden = false;
    const boon = ev.kind === 'trade' || ev.kind === 'harvest';
    this.el.eventCard.classList.toggle('boon', boon);
    const sig = `${ev.id}`;
    if (this.signatures.event !== sig) {
      this.signatures.event = sig;
      this.el.eventTitle.textContent = ev.title;
      this.el.eventText.textContent = ev.text;
      this.el.eventIcon.textContent = ev.kind === 'zombies' ? '☠' : (ev.kind === 'barbarians' || ev.kind === 'raid') ? '⚔' : ev.kind === 'trade' ? '⚖' : '❖';
    }
    this.el.eventTimer.textContent = fmtClock(ev.left);
  }

  renderTop(state) {
    const sig = `${state.subs}|${state.level}|${state.next?.need}|${JSON.stringify(state.resources)}`;
    if (this.signatures.top === sig) return;
    this.signatures.top = sig;

    this.el.subs.textContent = state.subs;
    this.el.level.textContent = state.level;
    const next = state.next;
    if (next) {
      const from = state.levelFrom ?? 0;
      const at = state.subs + next.need;
      const span = Math.max(1, at - from);
      const pct = Math.max(0, Math.min(100, ((state.subs - from) / span) * 100));
      this.el.levelFill.style.width = `${pct}%`;
      this.el.levelHint.textContent = `до ${next.level} ур. — ${next.need} подп.`;
    } else {
      this.el.levelFill.style.width = '100%';
      this.el.levelHint.textContent = 'максимальный уровень ратуши';
    }

    this.el.resources.innerHTML = RES
      .filter((r) => !r.extra || (state.resources[r.key] ?? 0) > 0)
      .map((r) => {
        const value = state.resources[r.key] ?? 0;
        const low = (r.key === 'food' || r.key === 'wood') && value < 15;
        return `<div class="res ${low ? 'low' : ''}${r.extra ? ' extra' : ''}" title="${r.label}"><i style="background:${r.color}"></i>${value}<span>${r.label}</span></div>`;
      }).join('');
  }

  renderDetail(state) {
    if (!this.selected) {
      const orders = state.orders ?? [];
      const orderText = orders.length
        ? orders.map((o) => `${TYPE_RU[o.type] ?? o.type}${o.status === 'building' ? ' (строится)' : ''}`).join(', ')
        : 'нет';
      const rate = state.foodRate ?? 0;
      const rateText = `${rate > 0 ? '+' : ''}${rate}/мин`;
      const rateClass = rate > 0 ? 'up' : rate < 0 ? 'down' : '';
      const html = `
        <dl class="kv">
          <dt>Население</dt><dd>${state.population}</dd>
          <dt>Без дома</dt><dd>${state.homeless}</dd>
          <dt>Настрой</dt><dd>${state.morale}%</dd>
          <dt>Еда</dt><dd>${state.resources.food} / ${state.storageCap} <span class="rate ${rateClass}">${rateText}</span></dd>
          <dt>Безопасность</dt><dd>${state.safety}%</dd>
          <dt>Стройки</dt><dd>${orderText}</dd>
        </dl>
        <p class="empty-note" style="margin-top:12px">
          Нажмите на поселенца, чтобы увидеть его должность, дату подписки и число сообщений.
        </p>`;
      if (this.signatures.detail !== html) {
        this.el.detail.innerHTML = html;
        this.signatures.detail = html;
      }
      return;
    }

    let html = '';
    if (this.selected.kind === 'pawn') {
      const p = state.pawns.find((x) => x.id === this.selected.id);
      if (!p) {
        this.selected = null;
        this.renderDetail(state);
        return;
      }
      const info = ROLE_INFO[p.role] ?? ROLE_INFO.idle;
      const home = p.homeId ? state.buildings.find((b) => b.id === p.homeId) : null;
      const work = p.workplaceId ? state.buildings.find((b) => b.id === p.workplaceId) : null;
      html = `
        <h3 class="pawn-name"><span class="role-dot" style="background:${info.color};color:${info.color}"></span>${escapeHtml(p.name)}</h3>
        <div class="role-line">${info.label} · ${STATE_LABELS[p.state] ?? p.state}</div>
        <dl class="kv">
          <dt>Подписан с</dt><dd>${fmtDate(p.since)}</dd>
          <dt>Месяцев подписки</dt><dd>${p.months}</dd>
          <dt>Сообщений в чате</dt><dd>${p.messages}</dd>
          <dt>Дом</dt><dd>${home ? `№${home.id}` : 'нет'}</dd>
          <dt>Работа</dt><dd>${work ? `${TYPE_RU[work.type] ?? work.type} №${work.id}` : (p.role === 'builder' ? 'стройплощадка' : p.role === 'idle' ? '—' : 'нет места')}</dd>
          <dt>Подписка</dt><dd>${p.gifted ? 'подарок' : `Tier ${p.tier}`}</dd>
          <dt>Смена профессии</dt><dd>${p.roleReadyIn > 0 ? `через ${fmtClock(p.roleReadyIn)}` : 'готова'}</dd>
          <dt>Сытость</dt><dd>${100 - Math.min(100, p.hunger)}%</dd>
          ${p.role === 'guard' ? `<dt>Оружие</dt><dd>${p.armed ? 'в руках' : 'нет'}</dd>` : ''}
          ${(p.wounded || p.hp < 100) ? `<dt>Здоровье</dt><dd>${p.wounded ? 'ранен, в лазарете' : `${p.hp}/100`}</dd>` : ''}
        </dl>
        <div class="chips">
          <span class="chip">${p.dead ? 'покинул колонию' : 'в колонии'}</span>
          ${p.role === 'idle' ? '<span class="chip">ждёт должность</span>' : ''}
        </div>
        <div class="action-row">
          <button data-act="focus">Показать</button>
          <button data-act="move" class="${this.movePawnId === p.id ? 'active' : ''}">
            ${this.movePawnId === p.id ? 'Кликните по карте' : 'Вести'}
          </button>
        </div>`;
    } else {
      const b = state.buildings.find((x) => x.id === this.selected.id);
      if (!b) {
        this.selected = null;
        this.renderDetail(state);
        return;
      }
      const status = b.built ? 'построено' : `строится · ${Math.round(b.progress * 100)}%`;
      html = `
        <h3 class="pawn-name">${TYPE_RU[b.type] ?? b.type} №${b.id}</h3>
        <div class="role-line">${status}</div>
        <dl class="kv">
          <dt>Размер</dt><dd>${b.w}×${b.h}</dd>
          ${b.occupant ? `<dt>Жилец</dt><dd>${escapeHtml(b.occupant)}</dd>` : ''}
          ${b.type === 'grave' ? `<dt>Память</dt><dd>${escapeHtml(b.name)}</dd>` : ''}
        </dl>
        <div class="action-row"><button data-act="focus">Показать</button></div>`;
    }

    if (this.signatures.detail !== html) {
      this.el.detail.innerHTML = html;
      this.signatures.detail = html;
    }
  }

  renderJobs(state) {
    const html = Object.keys(ROLE_INFO)
      .filter((k) => k !== 'idle')
      .map((role) => {
        const info = ROLE_INFO[role];
        const have = state.jobs[role] ?? 0;
        const cap = state.caps[role] ?? 0;
        const cls = have >= cap ? 'full' : (have === 0 ? 'none' : '');
        return `<div class="job-row">
          <span class="dot" style="background:${info.color}"></span>
          <span class="lbl">${info.label}</span>
          <span class="num ${cls}">${have}/${cap}</span>
        </div>`;
      }).join('');
    if (this.signatures.jobs !== html) {
      this.el.jobs.innerHTML = html;
      this.signatures.jobs = html;
    }
  }

  renderVote(state) {
    const vote = state.vote;
    if (!vote) {
      this.el.vote.hidden = true;
      this.signatures.vote = '';
      return;
    }
    this.el.vote.hidden = false;
    const total = vote.options.reduce((s, o) => s + o.votes.length, 0);
    const mine = this.myVotes.get(vote.number);
    const html = vote.options.map((o) => {
      const count = o.votes.length;
      const pct = total ? Math.round((count / total) * 100) : 0;
      return `<button class="vote-opt ${mine === o.key ? 'voted' : ''}" data-key="${o.key}">
        <span class="bar" style="width:${pct}%"></span>
        <span class="key">${o.key}</span>
        <span class="name">${TYPE_RU[o.type] ?? o.name}</span>
        <span class="cost">${costText(o.cost)}</span>
        <span class="votes">${count}</span>
      </button>`;
    }).join('');

    const sig = html;
    if (this.signatures.vote !== sig) {
      this.el.voteOptions.innerHTML = html;
      this.signatures.vote = sig;
    }
    this.el.voteNumber.textContent = `#${vote.number}`;
    const m = Math.floor(vote.left / 60);
    const s = String(vote.left % 60).padStart(2, '0');
    this.el.voteTimer.textContent = `${m}:${s}`;
  }

  registerVote(number, key) {
    this.myVotes.set(number, key);
    this.signatures.vote = '';
  }

  pushLog(entries) {
    if (!entries?.length) return;
    for (const entry of entries) {
      const div = document.createElement('div');
      div.className = `log-entry ${entry.kind}`;
      const mm = String(Math.floor(entry.t / 60)).padStart(2, '0');
      const ss = String(entry.t % 60).padStart(2, '0');
      div.innerHTML = `<span class="t">${mm}:${ss}</span>${escapeHtml(entry.text)}`;
      this.el.log.appendChild(div);
    }
    while (this.el.log.children.length > 70) this.el.log.firstChild.remove();
    this.el.log.scrollTop = this.el.log.scrollHeight;
  }

  showTooltip(text, x, y) {
    if (!text) {
      this.el.tooltip.hidden = true;
      return;
    }
    this.el.tooltip.hidden = false;
    this.el.tooltip.textContent = text;
    this.el.tooltip.style.left = `${x}px`;
    this.el.tooltip.style.top = `${y}px`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
