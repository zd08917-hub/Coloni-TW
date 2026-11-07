// Канал связи с сервером.

export class Net {
  constructor({ onInit, onState, onMap, onFocus }) {
    this.onInit = onInit;
    this.onState = onState;
    this.onMap = onMap;
    this.onFocus = onFocus;
    this.ws = null;
    this.retry = 0;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.retry = 0;
      this.send({ type: 'hello', name: this.name });
    };
    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'init') this.onInit?.(msg);
      else if (msg.type === 'state') this.onState?.(msg.state);
      else if (msg.type === 'map') this.onMap?.(msg.map);
      else if (msg.type === 'focus') this.onFocus?.(msg);
    };
    this.ws.onclose = () => {
      this.retry += 1;
      setTimeout(() => this.connect(), Math.min(5000, 600 * this.retry));
    };
    this.ws.onerror = () => this.ws.close();
  }

  send(payload) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(payload));
  }

  vote(option) {
    this.send({ type: 'vote', option });
  }

  move(pawnId, x, y) {
    this.send({ type: 'move', pawnId, x, y });
  }
}
