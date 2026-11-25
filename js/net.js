/* Online rooms: direct browser-to-browser play (WebRTC data channels via PeerJS).
   The host owns the room and relays; whoever's turn it is plays on their own device and
   publishes the resulting game state. No server of our own. */
(function (G) {
  const PEER_SRC = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const MAP_ID = G.DATA.MAP_ID;
  const PREFIX = MAP_ID ? `mearth-wotr-${MAP_ID}-` : 'mearth-wotr-';
  const HOST_KEY = MAP_ID ? `mearth.hosting.${MAP_ID}` : 'mearth.hosting';
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const uid = () => 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const newCode = () => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };

  const N = {
    role: null, code: null, started: false, room: null, you: -1, status: 'idle', error: '',
    cid: ls.get('mearth.cid') || (() => { const c = uid(); ls.set('mearth.cid', c); return c; })(),
    name: ls.get('mearth.name') || '',
    handlers: {},
  };
  let peer = null, hostConn = null, conns = new Map(), pingTimer = null, retryTimer = null, wantOpen = false;
  const emit = (ev, data) => { const f = N.handlers[ev]; if (f) try { f(data); } catch (e) { console.error(e); } };
  const setStatus = (s, err) => { N.status = s; N.error = err || ''; emit('status', { status: s, error: N.error }); };

  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return Promise.reject(new Error('Online play needs the game to be opened from a web address.'));
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = PEER_SRC; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the connection library. Check your internet connection.'));
      document.head.appendChild(s);
    });
  }
  function setName(n) { N.name = String(n || '').trim().slice(0, 24); ls.set('mearth.name', N.name); }
  function link(code) { return location.origin + location.pathname + '#room-' + (code || N.code); }
  function codeFromHash() { const m = /^#room-([A-Za-z0-9]{4,8})$/.exec(location.hash || ''); return m ? m[1].toUpperCase() : null; }

  /* ---------- host ---------- */
  function publicRoom() {
    const r = N.room; return { code: N.code, hostName: r.hostName, started: N.started, seats: r.seats.map(s => ({ faction: s.faction, kind: s.kind, diff: s.diff, name: s.name || '', taken: !!s.cid, online: s.kind === 'host' ? true : !!s.online, ai: !!s.ai })) };
  }
  function sendLobby() {
    const pub = publicRoom();
    for (const [, c] of conns) if (c.open) { const you = N.room.seats.findIndex(s => s.cid && s.cid === c.cid); c.send({ t: 'lobby', room: pub, you, cid: c.cid }); }
    N.you = N.room.seats.findIndex(s => s.kind === 'host');
    emit('lobby', pub); persistHost();
  }
  function persistHost(stateJson) {
    if (N.role !== 'host' || !N.room) return;
    if (stateJson !== undefined) N.room.state = stateJson;
    ls.set(HOST_KEY, JSON.stringify({ code: N.code, started: N.started, room: N.room, at: Date.now() }));
  }
  function savedHosting() { try { return JSON.parse(ls.get(HOST_KEY) || 'null'); } catch (e) { return null; } }
  function clearHosting() { ls.del(HOST_KEY); }

  async function host(opts) {
    // opts: { cfg, seats:[{faction, kind:'host'|'open'|'ai', diff}] } for a new room, or { resume: savedHosting() }
    leave(true); await loadPeer();
    if (opts.resume) { N.code = opts.resume.code; N.room = opts.resume.room; N.started = !!opts.resume.started; N.room.seats.forEach(s => { s.online = false; }); }
    else { N.code = newCode(); N.started = false; N.room = { hostName: N.name || 'Host', cfg: opts.cfg, seats: opts.seats.map(s => ({ faction: s.faction, kind: s.kind, diff: s.diff || 'normal', cid: s.kind === 'host' ? N.cid : null, name: s.kind === 'host' ? (N.name || 'Host') : '', online: false, ai: false })), state: null }; }
    N.role = 'host'; wantOpen = true; setStatus('connecting');
    return new Promise((res, rej) => {
      peer = new window.Peer(PREFIX + N.code.toLowerCase(), { debug: 1 });
      let opened = false;
      peer.on('open', () => { opened = true; setStatus('open'); sendLobby(); startPing(); res(N.code); });
      peer.on('connection', conn => {
        conn.on('open', () => { conns.set(conn.connectionId || conn.peer, conn); });
        conn.on('data', d => hostOnData(conn, d));
        const gone = () => { conns.delete(conn.connectionId || conn.peer); const s = N.room && N.room.seats.find(x => x.cid && x.cid === conn.cid); if (s) { s.online = false; if (!N.started && s.kind === 'open') { s.cid = null; s.name = ''; } } if (N.room) sendLobby(); };
        conn.on('close', gone); conn.on('error', gone);
      });
      peer.on('disconnected', () => { if (wantOpen && peer && !peer.destroyed) { setStatus('reconnecting'); setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 1500); } });
      peer.on('error', e => {
        const msg = e.type === 'unavailable-id' ? 'This room is already open in another tab or device.' : e.type === 'browser-incompatible' ? 'This browser cannot make direct connections.' : 'Connection problem: ' + (e.type || e.message);
        if (!opened) { setStatus('error', msg); rej(new Error(msg)); } else if (e.type !== 'peer-unavailable') setStatus('reconnecting', msg);
      });
    });
  }
  function hostOnData(conn, d) {
    if (!d || typeof d !== 'object' || !N.room) return;
    if (d.t === 'hello') {
      conn.cid = String(d.cid || '').slice(0, 40); if (conn.cid === N.cid) conn.cid += '-b'; // a second tab of the host's own browser
      const name = String(d.name || 'Guest').slice(0, 24);
      let seat = N.room.seats.find(s => s.cid === conn.cid && s.kind !== 'host');
      if (!seat && !N.started) seat = N.room.seats.find(s => s.kind === 'open' && !s.cid);
      if (seat) { seat.cid = conn.cid; seat.name = name; seat.online = true; }
      conn.lastSeen = Date.now();
      sendLobby();
      if (N.started && N.room.state) conn.send({ t: 'state', s: N.room.state, sync: true });
      emit('guest', { name, seated: !!seat });
    } else if (d.t === 'state') {
      conn.lastSeen = Date.now();
      emit('remoteState', { json: d.s, from: conn.cid });
    } else if (d.t === 'pong' || d.t === 'ping') { conn.lastSeen = Date.now(); if (d.t === 'ping') conn.send({ t: 'pong' }); }
  }
  function startPing() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (N.role === 'host') {
        let changed = false;
        for (const [, c] of conns) { if (c.open) c.send({ t: 'ping' }); const s = N.room.seats.find(x => x.cid && x.cid === c.cid); if (s) { const on = Date.now() - (c.lastSeen || 0) < 16000; if (s.online !== on) { s.online = on; changed = true; } } }
        if (changed) sendLobby();
      } else if (N.role === 'guest' && hostConn && hostConn.open) hostConn.send({ t: 'ping' });
    }, 5000);
  }
  function startGameAsHost() { N.started = true; sendLobby(); }
  // host: seats → game players. Empty open seats and absent players are filled by the AI.
  function playersForGame() {
    return N.room.seats.map(s => {
      if (s.kind === 'host') return { faction: s.faction, type: 'human', cid: N.cid, pname: N.room.hostName };
      if (s.kind === 'open' && s.cid) return { faction: s.faction, type: 'human', cid: s.cid, pname: s.name };
      return { faction: s.faction, type: 'ai', diff: s.kind === 'ai' ? s.diff : 'normal' };
    });
  }

  /* ---------- guest ---------- */
  async function join(code) {
    leave(true); await loadPeer();
    N.role = 'guest'; N.code = code.toUpperCase(); N.started = false; N.room = null; N.you = -1; wantOpen = true; setStatus('connecting');
    ls.set('mearth.lastRoom', N.code);
    return new Promise((res, rej) => {
      let settled = false; const fail = msg => { setStatus('error', msg); if (!settled) { settled = true; rej(new Error(msg)); } };
      peer = new window.Peer({ debug: 1 });
      const dial = () => {
        if (!wantOpen || !peer || peer.destroyed) return;
        const conn = peer.connect(PREFIX + N.code.toLowerCase(), { reliable: true }); hostConn = conn;
        const timer = setTimeout(() => { if (!conn.open) { try { conn.close(); } catch (e) {} if (!settled) fail('Could not reach the host. Ask them to keep the room open and try again.'); else scheduleRetry(); } }, 12000);
        conn.on('open', () => { clearTimeout(timer); setStatus('open'); conn.send({ t: 'hello', cid: N.cid, name: N.name || 'Guest' }); startPing(); if (!settled) { settled = true; res(N.code); } });
        conn.on('data', d => guestOnData(d));
        conn.on('close', () => { clearTimeout(timer); if (wantOpen) { setStatus('reconnecting'); scheduleRetry(); } });
        conn.on('error', () => { clearTimeout(timer); if (wantOpen) scheduleRetry(); });
      };
      const scheduleRetry = () => { clearTimeout(retryTimer); retryTimer = setTimeout(dial, 3000); };
      peer.on('open', dial);
      peer.on('disconnected', () => { if (wantOpen && peer && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 1500); });
      peer.on('error', e => {
        if (e.type === 'peer-unavailable') { if (!settled) fail('That room is not open right now. The host has to open it first.'); else { setStatus('reconnecting'); scheduleRetry(); } }
        else if (!settled) fail('Connection problem: ' + (e.type || e.message));
      });
    });
  }
  function guestOnData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'lobby') { if (d.cid) N.cid = d.cid; N.room = d.room; N.you = d.you; N.started = !!d.room.started; emit('lobby', d.room); }
    else if (d.t === 'state') emit('remoteState', { json: d.s, from: 'host', sync: !!d.sync });
    else if (d.t === 'ping' && hostConn && hostConn.open) hostConn.send({ t: 'pong' });
    else if (d.t === 'closed') { emit('closed'); leave(); }
  }

  /* ---------- state traffic ---------- */
  function pushState(json) {
    if (N.role === 'host') { persistHost(json); for (const [, c] of conns) if (c.open) c.send({ t: 'state', s: json }); }
    else if (N.role === 'guest' && hostConn && hostConn.open) hostConn.send({ t: 'state', s: json });
  }
  // host only: forward a guest's state to everyone else
  function relay(json, fromCid) { persistHost(json); for (const [, c] of conns) if (c.open && c.cid !== fromCid) c.send({ t: 'state', s: json }); }

  function leave(silent) {
    wantOpen = false; clearInterval(pingTimer); clearTimeout(retryTimer);
    if (N.role === 'host' && !silent) for (const [, c] of conns) { try { if (c.open) c.send({ t: 'closed' }); } catch (e) {} }
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null; hostConn = null; conns = new Map();
    N.role = null; N.code = null; N.started = false; N.room = null; N.you = -1;
    if (!silent) setStatus('idle');
  }
  const on = () => !!N.role && N.started;
  const peersOnline = () => N.role === 'host' ? [...conns.values()].filter(c => c.open).length : (hostConn && hostConn.open ? 1 : 0);

  Object.assign(N, { host, join, leave, on, pushState, relay, startGameAsHost, playersForGame, setName, link, codeFromHash, savedHosting, clearHosting, persistHost, peersOnline, publicRoom,
    lastRoom: () => ls.get('mearth.lastRoom') });
  G.NET = N;
})(window);
