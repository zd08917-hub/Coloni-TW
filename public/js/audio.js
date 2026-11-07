// Звук без внешних файлов: синтез через Web Audio + процедурный эмбиент.

const MIN_GAP = {
  ship: 1500,
  build: 300,
  death: 1200,
  vote: 900,
  alarm: 2500,
  level: 600,
  click: 90,
  chime: 700,
  fight: 260,
  coin: 700,
  zombie: 2000,
  dawn: 4000,
  dusk: 4000,
  deposit: 900,
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.last = new Map();
    this.ambience = null;
    this.dayness = 1;
    try {
      const saved = localStorage.getItem('colony.sound');
      if (saved === 'off') this.enabled = false;
    } catch { /* приватный режим */ }
  }

  init() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.startAmbience();
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('colony.sound', this.enabled ? 'on' : 'off'); } catch { /* ignore */ }
    if (this.enabled) {
      this.init();
      this.setPhase(this.dayness);
    } else if (this.ambience) {
      this.ambience.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    }
    this.play('click');
    return this.enabled;
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  // ------------------------------------------------------------ синтез

  tone(freq, dur, { type = 'sine', gain = 0.18, slide = 0, delay = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise(dur, { gain = 0.12, freq = 1400, q = 1.2, delay = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t0);
  }

  // ------------------------------------------------------------ эмбиент

  startAmbience() {
    if (!this.ctx || this.ambience) return;
    const ctx = this.ctx;
    const seconds = 4;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    this.ambience = { gain, filter };
    gain.gain.setTargetAtTime(0.045, ctx.currentTime, 2.5);
  }

  // день/ночь: ночью тише и глуше
  setPhase(progress) {
    this.dayness = progress;
    if (!this.ambience || !this.ctx || !this.enabled) return;
    const angle = (progress - 0.25) * Math.PI * 2;
    const dayness = Math.max(0, Math.min(1, (Math.sin(angle) + 0.12) / 0.45));
    const t = this.ctx.currentTime;
    this.ambience.gain.gain.setTargetAtTime(0.022 + dayness * 0.03, t, 1.2);
    this.ambience.filter.frequency.setTargetAtTime(300 + dayness * 420, t, 1.2);
  }

  // ------------------------------------------------------------ эффекты

  play(kind) {
    if (!this.ready()) return;
    const now = performance.now();
    const gap = MIN_GAP[kind] ?? 300;
    if (now - (this.last.get(kind) ?? 0) < gap) return;
    this.last.set(kind, now);

    switch (kind) {
      case 'ship':
        this.tone(104, 1.7, { type: 'sawtooth', gain: 0.1, slide: 92 });
        this.tone(156, 1.7, { type: 'triangle', gain: 0.06, slide: 138, delay: 0.04 });
        break;
      case 'build':
        this.noise(0.09, { gain: 0.13, freq: 1900, q: 0.8 });
        this.noise(0.09, { gain: 0.1, freq: 1500, q: 0.8, delay: 0.17 });
        this.noise(0.09, { gain: 0.11, freq: 1750, q: 0.8, delay: 0.34 });
        break;
      case 'death':
        this.tone(196, 2.4, { type: 'sine', gain: 0.16, slide: 168 });
        this.tone(146, 2.8, { type: 'sine', gain: 0.08, slide: 130, delay: 0.12 });
        break;
      case 'vote':
        this.tone(660, 0.22, { type: 'triangle', gain: 0.1 });
        this.tone(880, 0.22, { type: 'triangle', gain: 0.08, delay: 0.09 });
        this.tone(1100, 0.3, { type: 'triangle', gain: 0.06, delay: 0.18 });
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this.tone(520, 0.3, { type: 'square', gain: 0.07, delay: i * 0.36 });
          this.tone(700, 0.3, { type: 'square', gain: 0.06, delay: i * 0.36 + 0.18 });
        }
        break;
      case 'fight':
        this.noise(0.05, { gain: 0.1, freq: 3400, q: 2.4 });
        this.tone(1560, 0.12, { type: 'square', gain: 0.05, slide: 900 });
        this.noise(0.05, { gain: 0.07, freq: 2800, q: 2.4, delay: 0.11 });
        break;
      case 'zombie':
        this.tone(92, 1.4, { type: 'sawtooth', gain: 0.06, slide: 68 });
        this.tone(138, 1.1, { type: 'triangle', gain: 0.04, slide: 96, delay: 0.1 });
        break;
      case 'coin':
        this.tone(1320, 0.07, { type: 'triangle', gain: 0.05 });
        this.tone(1760, 0.08, { type: 'triangle', gain: 0.04, delay: 0.05 });
        break;
      case 'level':
        [523, 659, 784, 1046].forEach((f, i) => {
          this.tone(f, 0.4, { type: 'triangle', gain: 0.09, delay: i * 0.11 });
        });
        break;
      case 'dawn':
        this.tone(523, 0.9, { type: 'sine', gain: 0.06 });
        this.tone(784, 1.2, { type: 'sine', gain: 0.05, delay: 0.15 });
        break;
      case 'dusk':
        this.tone(440, 1.0, { type: 'sine', gain: 0.055 });
        this.tone(330, 1.4, { type: 'sine', gain: 0.045, delay: 0.18 });
        break;
      case 'chime':
        this.tone(784, 0.35, { type: 'sine', gain: 0.07 });
        break;
      case 'click':
        this.tone(920, 0.05, { type: 'square', gain: 0.04 });
        break;
      default:
        break;
    }
  }
}
