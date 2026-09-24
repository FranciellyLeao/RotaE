/* core.js — lê a planilha, agrupa endereços e otimiza a rota.
   Funciona no navegador (window.Rota) e no Node (module.exports) para testes. */
(function (root) {
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  function dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  // ---------- 1. Planilha ----------
  const COLS = {
    tn: ['spx tn', 'tracking', 'codigo', 'código', 'tn', 'pedido'],
    addr: ['destination address', 'endereco', 'endereço', 'address', 'destino'],
    bairro: ['bairro', 'neighborhood', 'district'],
    city: ['city', 'cidade'],
    lat: ['latitude', 'lat'],
    lon: ['longitude', 'lon', 'lng'],
    stop: ['stop', 'parada'],
    seq: ['sequence', 'sequencia', 'sequência'],
    phone: ['phone', 'telefone', 'celular', 'contato', 'whatsapp', 'fone'],
    name: ['recipient name', 'recipient', 'destinatario', 'destinatário', 'nome', 'name', 'cliente', 'buyer']
  };
  function findCol(headers, keys) {
    const h = headers.map(norm);
    for (const k of keys) { const i = h.indexOf(norm(k)); if (i >= 0) return i; }
    for (const k of keys) { const i = h.findIndex(x => x.includes(norm(k))); if (i >= 0) return i; }
    return -1;
  }
  // rows: array de arrays (primeira linha = cabeçalho)
  function parseRows(rows) {
    const head = rows.findIndex(r => r && r.some(c => /spx|address|endere|latitude/i.test(String(c))));
    if (head < 0) throw new Error('Não achei o cabeçalho da planilha (SPX TN, Destination Address, Latitude, Longitude).');
    const H = rows[head].map(c => String(c || ''));
    const idx = {}; for (const k in COLS) idx[k] = findCol(H, COLS[k]);
    for (const k of ['tn', 'addr', 'lat', 'lon']) if (idx[k] < 0) throw new Error('Faltou a coluna: ' + ({ tn: 'SPX TN', addr: 'Destination Address', lat: 'Latitude', lon: 'Longitude' })[k]);
    const out = [], seen = new Set();
    for (const r of rows.slice(head + 1)) {
      if (!r) continue;
      const tn = String(r[idx.tn] || '').trim();
      const lat = parseFloat(String(r[idx.lat]).replace(',', '.')), lon = parseFloat(String(r[idx.lon]).replace(',', '.'));
      if (!tn || !isFinite(lat) || !isFinite(lon) || seen.has(tn)) continue;
      seen.add(tn);
      const full = String(r[idx.addr] || '').trim();
      const parts = full.split(',').map(s => s.trim());
      const cell = k => idx[k] >= 0 && r[idx[k]] != null ? String(r[idx[k]]).trim() : '';
      out.push({
        tn, lat, lon, full,
        rua: tidyStreet(parts[0] || full),
        num: (parts[1] || 's/n').replace(/^0+(?=\d)/, ''),
        comp: tidyComp(parts.slice(2).join(', ')),
        bairro: cell('bairro'), city: cell('city'),
        stop: cell('stop') === '-' ? '' : cell('stop'),
        seq: cell('seq') === '-' ? '' : cell('seq'),
        phone: cell('phone'), name: cell('name')
      });
    }
    if (!out.length) throw new Error('A planilha não tem pacotes com coordenadas.');
    return out;
  }
  function tidyStreet(s) {
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^(r|r\.)\s+/i, 'Rua ').replace(/^av\.?\s+/i, 'Av. ').replace(/^serv\.?\s+/i, 'Servidão ').replace(/^tv\.?\s+/i, 'Travessa ');
    return s.replace(/\b([a-zà-ú])([a-zà-ú]*)/gi, (m, a, b) => (/^(de|da|do|dos|das|e)$/i.test(m) ? m.toLowerCase() : a.toUpperCase() + b.toLowerCase()));
  }
  function tidyComp(c) {
    return c.replace(/\b(ap|apt|apot|apto|apartamento)\.?\s*/gi, 'Apto ').replace(/\s+/g, ' ').trim();
  }
  function streetKey(rua) {
    return norm(rua).replace(/^(rua|av\.?|avenida|servidao|travessa|tv\.?|r\.?)\s+/, '')
      .replace(/\b(dep|deputado|ver|vereador|vereadora|dr|doutor|jornalista)\.?\s+/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }

  // ---------- 2. Endereços ----------
  // nomes da mesma rua escritos diferente ("Sebastião J dos Santos", "José G Chaves"...)
  const CONN = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
  const toks = k => k.split(' ').filter(t => t && !CONN.has(t));
  function sameStreet(a, b) {
    if (a === b) return true;
    const A = toks(a), B = toks(b);
    if (!A.length || !B.length) return false;
    const tokEq = (x, y) => x === y || (x.length === 1 && y[0] === x) || (y.length === 1 && x[0] === y);
    if (A.length === B.length) return A.every((t, i) => tokEq(t, B[i]));
    const [S, L] = A.length < B.length ? [A, B] : [B, A];
    if (S.length < 2 || !tokEq(S[0], L[0]) || !tokEq(S[S.length - 1], L[L.length - 1])) return false;
    let j = 0; for (const t of L) if (j < S.length && tokEq(S[j], t)) j++;
    return j === S.length;
  }
  function unifyStreets(pkgs) {
    const canon = []; // {key, names:Map}
    for (const p of pkgs) {
      const k = streetKey(p.rua);
      let c = canon.find(x => sameStreet(x.key, k));
      if (!c) { c = { key: k, names: new Map() }; canon.push(c); }
      c.names.set(p.rua, (c.names.get(p.rua) || 0) + 1);
      p._c = c;
    }
    for (const c of canon) {
      // nome mais completo (mais letras), desempate pelo mais usado
      c.name = [...c.names.entries()].sort((x, y) => y[0].length - x[0].length || y[1] - x[1])[0][0];
      c.sk = streetKey(c.name);
    }
    for (const p of pkgs) { p.rua = p._c.name; p.sk = p._c.sk; delete p._c; }
  }
  function groupAddresses(pkgs) {
    unifyStreets(pkgs);
    const map = new Map();
    for (const p of pkgs) {
      const key = p.sk + '|' + norm(p.num);
      let a = map.get(key);
      if (!a) { a = { id: 'a' + map.size, key, rua: p.rua, sk: p.sk, num: p.num, lat: p.lat, lon: p.lon, p: [] }; map.set(key, a); }
      a.p.push(p);
    }
    for (const a of map.values()) {
      a.lat = a.p.reduce((s, x) => s + x.lat, 0) / a.p.length;
      a.lon = a.p.reduce((s, x) => s + x.lon, 0) / a.p.length;
      a.p.sort((x, y) => (x.comp || '').localeCompare(y.comp || '', 'pt', { numeric: true }));
      a.stops = [...new Set(a.p.map(x => x.stop).filter(Boolean))].join(', ');
    }
    return [...map.values()];
  }

  // ---------- 3. Blocos (uma rua = um bloco, a não ser que ela seja muito longa) ----------
  function makeBlocks(addrs, keepStreets, splitM = 450) {
    if (!keepStreets) return addrs.map(a => [a]);
    const byStreet = new Map();
    for (const a of addrs) { if (!byStreet.has(a.sk)) byStreet.set(a.sk, []); byStreet.get(a.sk).push(a); }
    const blocks = [];
    for (const list of byStreet.values()) {
      // agrupamento por ligação simples: endereços da mesma rua a menos de splitM ficam juntos
      const left = list.slice();
      while (left.length) {
        const g = [left.shift()];
        for (let i = 0; i < g.length; i++) for (let j = left.length - 1; j >= 0; j--) if (dist(g[i], left[j]) < splitM) g.push(left.splice(j, 1)[0]);
        blocks.push(g);
      }
    }
    return blocks;
  }
  function orderInside(block) {
    if (block.length < 3) return block;
    // ordem ao longo da rua: começa numa ponta, vai pelo mais perto
    let far = block[0], best = -1;
    for (const a of block) for (const b of block) { const d = dist(a, b); if (d > best) { best = d; far = a; } }
    const out = [far], rest = block.filter(x => x !== far);
    while (rest.length) { const c = out[out.length - 1]; let k = 0; rest.forEach((x, i) => { if (dist(c, x) < dist(c, rest[k])) k = i; }); out.push(rest.splice(k, 1)[0]); }
    return out;
  }

  // ---------- 4. Matriz de custos ----------
  // points: [{lat,lon}] ; retorna função cost(i,j) em segundos
  async function roadMatrix(points, fetchFn) {
    const n = points.length;
    const fallback = () => (i, j) => dist(points[i], points[j]) * 1.35 / 6.5; // ~23 km/h no bairro, fator de ruas
    if (!fetchFn || n > 100 || n < 2) return { cost: fallback(), source: 'reta' };
    try {
      const coords = points.map(p => p.lon.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
      const url = 'https://router.project-osrm.org/table/v1/driving/' + coords + '?annotations=duration';
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctrl && setTimeout(() => ctrl.abort(), 12000);
      const res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (t) clearTimeout(t);
      const js = await res.json();
      if (js.code !== 'Ok' || !js.durations) throw new Error(js.code);
      const D = js.durations, fb = fallback();
      return { cost: (i, j) => (D[i] && D[i][j] != null ? D[i][j] : fb(i, j)), source: 'ruas' };
    } catch (e) { return { cost: fallback(), source: 'reta' }; }
  }

  // ---------- 5. Otimização (ordem dos blocos + sentido de cada bloco) ----------
  function optimize(blocks, idxOf, cost, startIdx) {
    const B = blocks.map(orderInside);
    const n = B.length;
    const first = (b, r) => idxOf(r ? B[b][B[b].length - 1] : B[b][0]);
    const last = (b, r) => idxOf(r ? B[b][0] : B[b][B[b].length - 1]);
    const inner = (b, r) => { let s = 0; const L = r ? B[b].slice().reverse() : B[b]; for (let i = 0; i + 1 < L.length; i++) s += cost(idxOf(L[i]), idxOf(L[i + 1])); return s; };
    const innerC = B.map((_, b) => [inner(b, 0), inner(b, 1)]);
    function total(o, r) {
      let s = startIdx == null ? 0 : cost(startIdx, first(o[0], r[0]));
      for (let i = 0; i < o.length; i++) { s += innerC[o[i]][r[i]]; if (i + 1 < o.length) s += cost(last(o[i], r[i]), first(o[i + 1], r[i + 1])); }
      return s;
    }
    function improve(o, r) {
      let cur = total(o, r), imp = true, guard = 0;
      while (imp && guard++ < 200) {
        imp = false;
        for (let i = 0; i < n; i++) for (let j = i + 1; j <= n; j++) {
          const no = o.slice(0, i).concat(o.slice(i, j).reverse(), o.slice(j));
          const nr = r.slice(0, i).concat(r.slice(i, j).reverse().map(x => 1 - x), r.slice(j));
          const t = total(no, nr); if (t < cur - 0.5) { o = no; r = nr; cur = t; imp = true; }
        }
        for (let k = 0; k < n; k++) { const nr = r.slice(); nr[k] ^= 1; const t = total(o, nr); if (t < cur - 0.5) { r = nr; cur = t; imp = true; } }
        // mover um bloco para outra posição (or-opt)
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const no = o.slice(), nr = r.slice(); const [b] = no.splice(i, 1), [x] = nr.splice(i, 1); no.splice(j, 0, b); nr.splice(j, 0, x);
          const t = total(no, nr); if (t < cur - 0.5) { o = no; r = nr; cur = t; imp = true; }
        }
      }
      return { o, r, cur };
    }
    // vizinho mais próximo + várias partidas aleatórias
    let best = null, seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const tries = Math.max(4, Math.min(40, Math.floor(4000 / (n * n + 1))));
    for (let t = 0; t < tries; t++) {
      const rest = [...Array(n).keys()], o = [], r = [];
      let curIdx = startIdx;
      if (curIdx == null || t > 0) { const k = t === 0 ? 0 : Math.floor(rnd() * rest.length); o.push(rest.splice(k, 1)[0]); r.push(0); curIdx = last(o[0], 0); }
      while (rest.length) {
        let bk = 0, br = 0, bc = Infinity;
        rest.forEach((b, k) => [0, 1].forEach(rr => { const c = cost(curIdx, first(b, rr)); if (c < bc) { bc = c; bk = k; br = rr; } }));
        const b = rest.splice(bk, 1)[0]; o.push(b); r.push(br); curIdx = last(b, br);
      }
      const res = improve(o, r);
      if (!best || res.cur < best.cur) best = res;
    }
    return { seq: best.o.map((b, i) => best.r[i] ? B[b].slice().reverse() : B[b]), seconds: best.cur };
  }

  // ---------- 6. Paradas da van: junta blocos seguidos e bem perto ----------
  function toStops(seq, walkM = 140, maxSpan = 260, maxAddr = 8) {
    const stops = [];
    for (const blk of seq) {
      const cur = stops[stops.length - 1];
      const all = cur ? cur.a.concat(blk) : null;
      const ok = cur && all.length <= maxAddr && blk.every(x => cur.a.some(y => dist(x, y) < walkM)) && span(all) < maxSpan;
      if (ok) cur.a.push(...blk); else stops.push({ a: blk.slice() });
    }
    stops.forEach((s, i) => {
      s.n = i + 1;
      // estacionar no endereço com mais pacotes (ou no centro)
      const park = s.a.slice().sort((x, y) => y.p.length - x.p.length)[0];
      s.lat = park.lat; s.lon = park.lon; s.park = park.rua + ', ' + park.num;
      s.ruas = [...new Set(s.a.map(a => a.rua))];
    });
    return stops;
    function span(list) { let m = 0; for (const a of list) for (const b of list) m = Math.max(m, dist(a, b)); return m; }
  }

  // ---------- 7. Tudo junto ----------
  async function plan(pkgs, opts = {}) {
    const addrs = groupAddresses(pkgs);
    const pts = addrs.map(a => ({ lat: a.lat, lon: a.lon }));
    let startIdx = null;
    if (opts.start) { pts.push({ lat: opts.start.lat, lon: opts.start.lon }); startIdx = pts.length - 1; }
    const m = await roadMatrix(pts, opts.fetch);
    const index = new Map(addrs.map((a, i) => [a, i]));
    const blocks = makeBlocks(addrs, opts.keepStreets !== false);
    const res = optimize(blocks, a => index.get(a), m.cost, startIdx);
    const stops = toStops(res.seq);
    let i = 0; stops.forEach(s => s.a.forEach(a => a.p.forEach(p => { p.i = ++i; })));
    return { stops, source: m.source, driveSeconds: res.seconds, total: i };
  }

  // tempo de entrega estimado (minutos) para os pacotes que faltam
  function stopMinutes(s, isDone) {
    let m = 0;
    for (const a of s.a) {
      const pend = a.p.filter(p => !isDone(p.tn)); if (!pend.length) continue;
      const predio = pend.some(p => /apto|bloco|kitnet|sala|loja|ed\.|edif|residencial|torre|condom/i.test(p.comp || ''));
      m += (predio ? 3 : 1.5) + 0.3 * (pend.length - 1);
    }
    return m > 0 ? m + 1.5 : 0;
  }

  const api = { parseRows, groupAddresses, plan, stopMinutes, dist, streetKey, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Rota = api;
})(typeof window !== 'undefined' ? window : globalThis);
