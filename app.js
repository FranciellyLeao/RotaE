/* app.js — interface: lista, mapa, leitor de código, não entregue, resumo. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const waze = (la, lo) => `https://waze.com/ul?ll=${la},${lo}&navigate=yes`;
  const gmaps = (la, lo) => `https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving`;
  const KEY = 'rota-entregas:v1';
  const REASONS = ['Cliente ausente', 'Endereço não encontrado', 'Recusado pelo cliente', 'Local fechado', 'Pacote avariado', 'Outro motivo'];

  let S = null; // { name, created, source, stops, total, status:{tn:{s:'ok'|'fail', r, t}}, started }
  const MK = new Map();
  let tab = 'lista', map = null, layers = null, meMarker = null, lastPos = null;

  // ---------- armazenamento ----------
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Não consegui salvar no celular', 'bad'); } }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  const st = tn => S.status[tn] && S.status[tn].s;
  const isDone = tn => !!st(tn);
  const ct = p => { const m = (S.contacts || {})[p.tn] || {}; return { name: m.name || p.name || '', phone: m.phone || p.phone || '' }; };
  const digits = s => String(s || '').replace(/\D/g, '');
  const wa = s => { let d = digits(s); if (d.length <= 11) d = '55' + d; return 'https://wa.me/' + d; };
  const allPkgs = () => S.stops.flatMap(s => s.a.flatMap(a => a.p));

  // ---------- GPS ----------
  function getPos(timeout = 9000) {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(p => { lastPos = { lat: p.coords.latitude, lon: p.coords.longitude }; res(lastPos); }, () => res(null), { enableHighAccuracy: true, timeout, maximumAge: 60000 });
    });
  }

  // ---------- carregar planilha ----------
  async function readFile(f) {
    $('err').hidden = true; busy('Lendo a planilha…');
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      let rows = null;
      for (const n of wb.SheetNames) { const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }); if (r.some(x => x.some(c => /spx|address|latitude/i.test(String(c))))) { rows = r; break; } }
      if (!rows) throw new Error('Não achei as colunas da Shopee nessa planilha.');
      const pkgs = Rota.parseRows(rows);
      await build(pkgs, { name: f.name });
    } catch (e) { busy(''); showErr(e.message || String(e)); }
  }
  async function build(pkgs, meta, keepStatus) {
    let start = null;
    if ($('optGps').checked) { busy('Pegando sua localização…'); start = await getPos(); }
    busy('Calculando a melhor rota pelas ruas…');
    const res = await Rota.plan(pkgs, { start, fetch: window.fetch.bind(window), keepStreets: $('optStreet').checked });
    const old = keepStatus ? S.status : {};
    S = { name: meta.name, created: Date.now(), source: res.source, stops: res.stops, total: res.total, status: old, started: keepStatus ? S.started : null, allTotal: keepStatus ? S.allTotal : res.total };
    if (keepStatus) S.extra = meta.extra;
    save(); busy(''); show(); render();
    toast(res.source === 'ruas' ? 'Rota calculada pelas ruas de verdade' : 'Sem internet pro cálculo de ruas: usei a distância no mapa', res.source === 'ruas' ? 'good' : '');
  }
  function busy(t) { $('busy').hidden = !t; $('busy').textContent = t; }
  function showErr(t) { $('err').hidden = false; $('err').textContent = t; }

  // recalcular só os pendentes, a partir de onde estou
  async function recalc() {
    const pend = allPkgs().filter(p => !isDone(p.tn));
    if (!pend.length) return toast('Tudo entregue, nada pra recalcular');
    const doneList = S.stops.map(s => ({ ...s, a: s.a.map(a => ({ ...a, p: a.p.filter(p => isDone(p.tn)) })).filter(a => a.p.length) })).filter(s => s.a.length);
    toast('Recalculando…');
    const clean = pend.map(p => ({ tn: p.tn, lat: p.lat, lon: p.lon, full: p.full, rua: p.rua, num: p.num, comp: p.comp, bairro: p.bairro, city: p.city, stop: p.stop, seq: p.seq, phone: p.phone, name: p.name }));
    const saved = S.status, contacts = S.contacts, started = S.started, name = S.name, allTotal = S.allTotal || S.total;
    let start = await getPos();
    const res = await Rota.plan(clean, { start, fetch: window.fetch.bind(window), keepStreets: $('optStreet').checked });
    // entregues vão para o fim, numa parada "Já feitas", para o resumo continuar certo
    const stops = res.stops;
    if (doneList.length) stops.push({ n: stops.length + 1, feitas: true, lat: doneList[0].lat, lon: doneList[0].lon, park: '', ruas: ['Já feitas'], a: doneList.flatMap(s => s.a) });
    let i = 0; stops.forEach(s => s.a.forEach(a => a.p.forEach(p => { p.i = ++i; })));
    S = { name, created: Date.now(), source: res.source, stops, total: i, status: saved, contacts, started, allTotal };
    save(); render(); toast('Rota refeita a partir de onde vocês estão', 'good');
  }

  // ---------- telas ----------
  function show() {
    const has = !!S;
    $('loadView').hidden = has; $('top').hidden = !has; $('foot').hidden = !has || tab !== 'lista';
    $('listView').hidden = !has || tab !== 'lista';
    $('mapView').hidden = !has || tab !== 'mapa';
    $('sumView').hidden = !has || tab !== 'resumo';
    $('tools').hidden = !has || tab === 'resumo';
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
    if (has && tab === 'mapa') setTimeout(drawMap, 30);
    if (has && tab === 'resumo') renderSum();
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; show(); window.scrollTo(0, 0); }));

  function render() {
    const html = S.stops.map(s => {
      const n = s.a.reduce((t, a) => t + a.p.length, 0);
      const ruas = s.ruas.map(r => r.replace(/^(Rua|Av\.|Avenida|Servidão|Travessa) /, '')).join(', ');
      return `<section class="stop" id="s${s.n}" data-n="${s.n}">
        <div class="sh"><div class="num">${s.feitas ? '✓' : s.n}</div><div class="st"><b>${esc(ruas)}</b>
          <span data-left>${n} pacotes</span> · <span class="t" data-t></span>${s.a.length > 1 && s.park ? `<span> · estacione na ${esc(s.park)}</span>` : ''}</div></div>
        ${s.feitas ? '' : `<div class="nav"><a class="waze" href="${waze(s.lat, s.lon)}" target="_blank" rel="noopener">Ir no Waze</a><a href="${gmaps(s.lat, s.lon)}" target="_blank" rel="noopener">Ir no Maps</a></div>`}
        ${s.a.map(a => `<div class="addr">
          <div class="ah"><div><b>${esc(a.rua)}, ${esc(a.num)}</b>
            <span class="meta">${a.stops ? 'Parada ' + esc(a.stops) + ' no app' : '<span class="flag">Sem parada no app</span>'} · ${a.p.length} ${a.p.length > 1 ? 'pacotes' : 'pacote'}</span></div>
            <div class="pin"><a href="${waze(a.lat, a.lon)}" target="_blank" rel="noopener">Waze</a><a href="${gmaps(a.lat, a.lon)}" target="_blank" rel="noopener">Maps</a></div></div>
          ${a.p.map(p => `<div class="pkg" data-tn="${esc(p.tn)}" data-s="${esc((p.tn + ' ' + a.rua + ' ' + a.num + ' ' + (p.comp || '') + ' ' + (p.name || '')).toLowerCase())}">
            <button class="tap" data-act="tap" aria-label="Marcar ${esc(p.tn)}">
              <span class="box" aria-hidden="true">✓</span>
              <span class="pt"><span class="code">${esc(p.tn.slice(0, -4))}<em>${esc(p.tn.slice(-4))}</em></span>${p.comp ? `<span class="c">${esc(p.comp)}</span>` : ''}<span class="why" data-why></span></span>
              <span class="pn">${p.i}</span></button>
            <button class="more" data-act="more" aria-label="Mais opções">⋯</button><div class="ctc" data-ct></div></div>`).join('')}
        </div>`).join('')}
      </section>`;
    }).join('') + '<p class="empty" id="empty" hidden>Nenhum pacote encontrado.</p>';
    $('list').innerHTML = html;
    $('infoTxt').textContent = `${S.name || 'Planilha'} · ${S.stops.filter(s => !s.feitas).length} paradas`;
    $('src').textContent = S.source === 'ruas' ? 'Rota pelas ruas' : 'Rota por distância';
    paintContacts(); update();
    if (map) drawMap();
  }

  $('list').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || e.target.closest('a')) return;
    const tn = b.closest('.pkg').dataset.tn;
    if (b.dataset.act === 'tap') { setStatus(tn, st(tn) ? null : 'ok'); }
    else openReasons(tn);
  });

  function setStatus(tn, s, r) {
    if (s) { S.status[tn] = { s, r: r || '', t: Date.now() }; if (!S.started) S.started = Date.now(); }
    else delete S.status[tn];
    save(); update();
    if (navigator.vibrate) navigator.vibrate(s === 'ok' ? 30 : s === 'fail' ? [40, 60, 40] : 10);
  }

  function update() {
    let ok = 0, fail = 0, next = null;
    document.querySelectorAll('.pkg').forEach(el => {
      const x = S.status[el.dataset.tn];
      el.classList.toggle('ok', !!x && x.s === 'ok'); el.classList.toggle('fail', !!x && x.s === 'fail');
      el.querySelector('.box').textContent = x && x.s === 'fail' ? '✕' : '✓';
      el.querySelector('[data-why]').textContent = x && x.s === 'fail' ? 'Não entregue: ' + x.r : '';
      if (x && x.s === 'ok') ok++; else if (x) fail++;
    });
    S.stops.forEach(s => {
      const el = $('s' + s.n); if (!el) return;
      const tot = s.a.reduce((t, a) => t + a.p.length, 0), left = s.a.reduce((t, a) => t + a.p.filter(p => !isDone(p.tn)).length, 0);
      el.classList.toggle('done', left === 0); el.classList.remove('next');
      el.querySelector('[data-left]').textContent = left === 0 ? 'Parada concluída' : left === tot ? `${tot} ${tot > 1 ? 'pacotes' : 'pacote'}` : `Faltam ${left} de ${tot}`;
      if (left > 0 && !next && !s.feitas) next = s;
    });
    if (next) $('s' + next.n).classList.add('next');
    const T = S.total;
    $('count').innerHTML = `${ok + fail}<small> / ${T}</small>`;
    $('barOk').style.width = (ok / T * 100) + '%'; $('barFail').style.width = (fail / T * 100) + '%';
    $('next').textContent = next ? `Próxima: parada ${next.n}` : 'Rota concluída';
    updateEta();
    if (map && tab === 'mapa') paintMarkers();
    if (tab === 'resumo') renderSum();
  }

  // ---------- tempo estimado ----------
  function fmt(m) { m = Math.max(0, Math.round(m)); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + 'h' + (r ? String(r).padStart(2, '0') : ''); }
  function pace() {
    const ts = Object.values(S.status).map(x => x.t).filter(Boolean).sort((a, b) => a - b);
    if (ts.length < 8) return 1;
    const real = (ts[ts.length - 1] - ts[0]) / 60000;
    const full = S.stops.reduce((m, s) => m + Rota.stopMinutes(s, () => false), 0);
    const left = S.stops.reduce((m, s) => m + Rota.stopMinutes(s, isDone), 0);
    const doneModel = full - left;
    if (real < 5 || doneModel < 5) return 1;
    return Math.min(1.7, Math.max(0.55, real / doneModel));
  }
  function updateEta() {
    const f = pace(); let rest = 0;
    S.stops.forEach(s => { const m = Rota.stopMinutes(s, isDone); rest += m; const el = document.querySelector('#s' + s.n + ' [data-t]'); if (el) el.textContent = m ? '~' + fmt(m * f) : ''; });
    rest *= f;
    if (rest <= 0) { $('eta').textContent = 'Rota concluída 🎉'; return; }
    const end = new Date(Date.now() + rest * 60000);
    $('eta').textContent = `Faltam ~${fmt(rest)} · termina ~${end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  setInterval(() => { if (S) updateEta(); }, 60000);

  // ---------- busca e filtro ----------
  $('toggle').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); $('list').classList.toggle('hide-done', on); });
  $('q').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase(); let any = false;
    document.querySelectorAll('.pkg').forEach(b => { const m = !q || b.dataset.s.includes(q); b.style.display = m ? '' : 'none'; b.classList.toggle('hit', !!q && m); if (m) any = true; });
    document.querySelectorAll('.addr').forEach(a => { a.style.display = [...a.querySelectorAll('.pkg')].some(b => b.style.display !== 'none') ? '' : 'none'; });
    document.querySelectorAll('.stop').forEach(s => { s.style.display = [...s.querySelectorAll('.addr')].some(a => a.style.display !== 'none') ? '' : 'none'; });
    $('empty').hidden = any;
    if (q && tab !== 'lista') { tab = 'lista'; show(); }
  });

  // ---------- não entregue ----------
  function openReasons(tn) {
    const p = allPkgs().find(x => x.tn === tn), cur = S.status[tn];
    const el = document.createElement('div'); el.className = 'sheet';
    el.innerHTML = `<div class="in" role="dialog" aria-modal="true"><h3>Pacote ${p.i}</h3><p>${esc(p.tn)} · ${esc(p.rua)}, ${esc(p.num)}${p.comp ? ' · ' + esc(p.comp) : ''}</p>
      <div class="reasons"><button class="okb" data-r="__ok">✓ Entregue</button>
      ${REASONS.map(r => `<button class="danger" data-r="${esc(r)}">✕ ${esc(r)}</button>`).join('')}
      <button data-r="__ct">👤 Nome e telefone</button>${cur ? '<button data-r="__clear">Desmarcar</button>' : ''}<button data-r="__x">Cancelar</button></div></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', async e => {
      if (e.target === el) return el.remove();
      const b = e.target.closest('[data-r]'); if (!b) return;
      let r = b.dataset.r;
      if (r === '__ok') setStatus(tn, 'ok');
      else if (r === '__clear') setStatus(tn, null);
      else if (r === '__ct') { const c = ct(p); const n = prompt('Nome do cliente:', c.name); if (n === null) return el.remove(); const f = prompt('Telefone (com DDD):', c.phone); if (f === null) return el.remove(); S.contacts = S.contacts || {}; S.contacts[tn] = { name: n.trim(), phone: f.trim() }; save(); paintContacts(); toast('Contato salvo', 'good'); }
      else if (r === 'Outro motivo') { const t = prompt('Qual o motivo?'); if (t) setStatus(tn, 'fail', t.trim()); }
      else if (r !== '__x') setStatus(tn, 'fail', r);
      el.remove();
    });
  }

  // ---------- leitor de código de barras ----------
  let scanning = false, stream = null, zx = null;
  $('scanBtn').addEventListener('click', startScan);
  async function startScan() {
    if (scanning) return;
    const el = document.createElement('div'); el.className = 'cam';
    el.innerHTML = '<video playsinline muted></video><div class="frame"></div><div class="cb"><span id="camMsg">Aponte para o código de barras da etiqueta</span><button id="camClose">Fechar</button></div>';
    document.body.appendChild(el);
    const video = el.querySelector('video'); scanning = true;
    const close = () => { scanning = false; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; if (zx) { try { zx.reset(); } catch (e) { } zx = null; } el.remove(); };
    el.querySelector('#camClose').onclick = close;
    let cool = 0;
    const onCode = raw => {
      if (Date.now() < cool) return;
      const code = String(raw || '').trim().toUpperCase().replace(/\s/g, '');
      const p = allPkgs().find(x => x.tn.toUpperCase() === code) || allPkgs().find(x => code.length >= 8 && (code.includes(x.tn.toUpperCase()) || x.tn.toUpperCase().includes(code)));
      cool = Date.now() + 1800;
      if (!p) { toast('Esse código não está na rota: ' + code.slice(-8), 'bad'); if (navigator.vibrate) navigator.vibrate([80, 60, 80]); return; }
      if (st(p.tn) === 'ok') { toast(`Pacote ${p.i} já estava entregue`); return; }
      setStatus(p.tn, 'ok');
      toast(`✓ Pacote ${p.i} entregue · ${p.rua}, ${p.num}${p.comp ? ' · ' + p.comp : ''}`, 'good');
      const row = document.querySelector(`.pkg[data-tn="${CSS.escape(p.tn)}"]`); if (row) { row.classList.remove('hl'); void row.offsetWidth; row.classList.add('hl'); }
    };
    try {
      if ('BarcodeDetector' in window) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = stream; await video.play();
        const det = new BarcodeDetector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'data_matrix', 'itf'] });
        const loop = async () => {
          if (!scanning) return;
          try { const r = await det.detect(video); if (r.length) onCode(r[0].rawValue); } catch (e) { }
          setTimeout(loop, 180);
        };
        loop();
      } else {
        el.querySelector('#camMsg').textContent = 'Carregando leitor…';
        await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js');
        zx = new ZXing.BrowserMultiFormatReader();
        el.querySelector('#camMsg').textContent = 'Aponte para o código de barras da etiqueta';
        await zx.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => { if (res && scanning) onCode(res.getText()); });
      }
    } catch (e) {
      el.querySelector('#camMsg').textContent = 'Não consegui abrir a câmera. Libere a permissão de câmera pro site e tente de novo.';
    }
  }
  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Sem internet para o leitor')); document.head.appendChild(s); }); }

  // ---------- mapa ----------
  function drawMap() {
    if (!window.L) { $('map').innerHTML = '<p class="empty">O mapa precisa de internet na primeira vez.</p>'; return; }
    if (!map) {
      map = L.map('map', { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      layers = L.layerGroup().addTo(map);
    }
    $('map').style.height = Math.max(360, window.innerHeight - $('top').offsetHeight - 36) + 'px';
    map.invalidateSize();
    layers.clearLayers(); MK.clear();
    const stops = S.stops.filter(s => !s.feitas);
    const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lon]));
    stops.forEach(s => {
      const m = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="mk" data-mk="${s.n}">${s.n}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }) });
      m.bindPopup(() => popupHtml(s)); m.addTo(layers); MK.set(s.n, m);
    });
    drawLine(stops);
    if (!map._fitted) { map._fitted = true; requestAnimationFrame(() => { map.invalidateSize(); map.fitBounds(bounds.pad(0.12)); }); }
    paintMarkers();
    watchMe();
  }
  function popupHtml(s) {
    const left = s.a.reduce((t, a) => t + a.p.filter(p => !isDone(p.tn)).length, 0);
    return `<div class="pop"><b>Parada ${s.n}</b> · ${left ? 'faltam ' + left : 'concluída'}<br>${s.a.map(a => `${esc(a.rua)}, ${esc(a.num)} (${a.p.length})`).join('<br>')}
      <div class="nav"><a class="waze" href="${waze(s.lat, s.lon)}" target="_blank" rel="noopener">Waze</a><a href="${gmaps(s.lat, s.lon)}" target="_blank" rel="noopener">Maps</a><a href="#s${s.n}" data-golist="${s.n}">Lista</a></div></div>`;
  }
  document.addEventListener('click', e => { const g = e.target.closest('[data-golist]'); if (g) { e.preventDefault(); tab = 'lista'; show(); setTimeout(() => $('s' + g.dataset.golist).scrollIntoView({ behavior: 'smooth' }), 50); } });
  function paintMarkers() {
    let nextSet = false;
    S.stops.forEach(s => {
      const mk = MK.get(s.n); if (!mk || s.feitas) return;
      const left = s.a.some(a => a.p.some(p => !isDone(p.tn)));
      const isNext = left && !nextSet; if (isNext) nextSet = true;
      mk.setIcon(L.divIcon({ className: '', html: `<div class="mk ${left ? (isNext ? 'next' : '') : 'done'}">${left ? s.n : '✓'}</div>`, iconSize: isNext ? [42, 42] : [34, 34], iconAnchor: isNext ? [21, 21] : [17, 17] }));
      mk.setZIndexOffset(isNext ? 1000 : left ? 0 : -500);
    });
  }
  async function drawLine(stops) {
    const pts = stops.flatMap(s => s.a.map(a => [a.lat, a.lon]));
    const key = pts.map(p => p.join(',')).join(';');
    if (S._line && S._lineKey === key) { L.polyline(S._line, { color: '#EE4D2D', weight: 5, opacity: .75 }).addTo(layers); return; }
    let line = pts;
    if (pts.length > 1 && pts.length <= 100) {
      try {
        const url = 'https://router.project-osrm.org/route/v1/driving/' + pts.map(p => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(';') + '?overview=full&geometries=geojson';
        const js = await (await fetch(url)).json();
        if (js.code === 'Ok') line = js.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      } catch (e) { }
    }
    S._line = line; S._lineKey = key; save();
    L.polyline(line, { color: '#EE4D2D', weight: 5, opacity: .75 }).addTo(layers);
  }
  let watching = false;
  function watchMe() {
    if (watching || !navigator.geolocation) return; watching = true;
    navigator.geolocation.watchPosition(p => {
      lastPos = { lat: p.coords.latitude, lon: p.coords.longitude };
      if (!map) return;
      if (!meMarker) meMarker = L.marker([lastPos.lat, lastPos.lon], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 2000 }).addTo(map);
      else meMarker.setLatLng([lastPos.lat, lastPos.lon]);
    }, () => { }, { enableHighAccuracy: true, maximumAge: 15000 });
  }
  $('locate').addEventListener('click', async () => { const p = lastPos || await getPos(); if (p && map) map.setView([p.lat, p.lon], 17); else toast('Não consegui pegar sua localização'); });
  $('goNext').addEventListener('click', () => { const s = S.stops.find(s => !s.feitas && s.a.some(a => a.p.some(p => !isDone(p.tn)))); if (s && map) { map.setView([s.lat, s.lon], 18); MK.get(s.n) && MK.get(s.n).openPopup(); } });

  // ---------- resumo ----------
  function renderSum() {
    const all = allPkgs();
    const ok = all.filter(p => st(p.tn) === 'ok'), fail = all.filter(p => st(p.tn) === 'fail'), pend = all.filter(p => !isDone(p.tn));
    const byR = {}; fail.forEach(p => { const r = S.status[p.tn].r; (byR[r] = byR[r] || []).push(p); });
    const dur = S.started ? Math.round((Math.max(...Object.values(S.status).map(x => x.t)) - S.started) / 60000) : 0;
    $('sum').innerHTML = `<div class="kpis"><div class="kpi ok"><b>${ok.length}</b><span>Entregues</span></div><div class="kpi fail"><b>${fail.length}</b><span>Não entregues</span></div><div class="kpi"><b>${pend.length}</b><span>Faltam</span></div></div>
      <div>Total da rota: <b>${all.length}</b> pacotes${dur ? ` · tempo até agora: <b>${fmt(dur)}</b>` : ''}</div>
      ${fail.length ? `<h2>Não entregues</h2>${Object.entries(byR).map(([r, l]) => `<b>${esc(r)} (${l.length})</b><ul>${l.map(p => `<li>${esc(p.tn)} · ${esc(p.rua)}, ${esc(p.num)}${p.comp ? ' · ' + esc(p.comp) : ''}</li>`).join('')}</ul>`).join('')}` : ''}
      ${pend.length ? `<h2>Ainda faltam</h2><ul>${pend.map(p => `<li>${p.i}. ${esc(p.tn)} · ${esc(p.rua)}, ${esc(p.num)}</li>`).join('')}</ul>` : ''}
      <div class="acts"><button id="share">Compartilhar resumo</button><button id="csv" class="ghost">Baixar planilha (CSV)</button><button id="reset" class="ghost">Desmarcar tudo</button></div>`;
    $('share').onclick = shareSum; $('csv').onclick = downloadCsv;
    $('reset').onclick = () => { if (confirm('Desmarcar todos os pacotes?')) { S.status = {}; S.started = null; save(); update(); renderSum(); } };
  }
  function sumText() {
    const all = allPkgs(), ok = all.filter(p => st(p.tn) === 'ok'), fail = all.filter(p => st(p.tn) === 'fail'), pend = all.filter(p => !isDone(p.tn));
    const d = new Date().toLocaleDateString('pt-BR');
    let t = `Resumo da rota ${d}\nTotal: ${all.length} · Entregues: ${ok.length} · Não entregues: ${fail.length} · Faltam: ${pend.length}\n`;
    if (fail.length) t += '\nNão entregues:\n' + fail.map(p => `- ${p.tn}${ct(p).name ? ' · ' + ct(p).name : ''} · ${p.rua}, ${p.num}${p.comp ? ' ' + p.comp : ''} · ${S.status[p.tn].r}`).join('\n') + '\n';
    if (pend.length) t += '\nPendentes:\n' + pend.map(p => `- ${p.tn} · ${p.rua}, ${p.num}`).join('\n') + '\n';
    return t;
  }
  async function shareSum() {
    const t = sumText();
    if (navigator.share) { try { await navigator.share({ title: 'Resumo da rota', text: t }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(t); toast('Resumo copiado', 'good'); } catch (e) { prompt('Copie o resumo:', t); }
  }
  function downloadCsv() {
    const rows = [['Ordem', 'Parada', 'SPX TN', 'Nome', 'Telefone', 'Endereço', 'Complemento', 'Status', 'Motivo', 'Horário']];
    S.stops.forEach(s => s.a.forEach(a => a.p.forEach(p => { const x = S.status[p.tn]; rows.push([p.i, s.feitas ? '' : s.n, p.tn, ct(p).name, ct(p).phone, `${a.rua}, ${a.num}`, p.comp || '', x ? (x.s === 'ok' ? 'Entregue' : 'Não entregue') : 'Pendente', x && x.r || '', x ? new Date(x.t).toLocaleTimeString('pt-BR') : '']); })));
    const csv = '\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `rota-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- diversos ----------
  let tt = null;
  function toast(t, kind) { let el = document.querySelector('.toast'); if (!el) { el = document.createElement('div'); el.setAttribute('role', 'status'); document.body.appendChild(el); } el.className = 'toast ' + (kind || ''); el.textContent = t; clearTimeout(tt); tt = setTimeout(() => el.remove(), 2600); }
  $('file').addEventListener('change', e => e.target.files[0] && readFile(e.target.files[0]));
  const drop = $('drop');
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  $('newFile').addEventListener('click', () => { if (!confirm('Carregar outra planilha? A rota atual será apagada deste celular.')) return; S = null; try { localStorage.removeItem(KEY); } catch (e) { } if (map) { map.remove(); map = null; } tab = 'lista'; show(); });
  $('recalc').addEventListener('click', () => { if (confirm('Refazer a ordem dos pacotes que faltam, a partir de onde vocês estão agora?')) recalc(); });
  function paintContacts() {
    document.querySelectorAll('.pkg').forEach(el => {
      const p = allPkgs().find(x => x.tn === el.dataset.tn); if (!p) return; const c = ct(p), box = el.querySelector('[data-ct]');
      box.innerHTML = (c.name ? `<span class="c nm">👤 ${esc(c.name)}</span>` : '') + (c.phone ? `<span class="c ph"><a href="tel:${esc(digits(c.phone))}">📞 ${esc(c.phone)}</a> <a href="${wa(c.phone)}" target="_blank" rel="noopener">WhatsApp</a></span>` : '');
    });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  S = load(); show(); if (S) render();
})();
