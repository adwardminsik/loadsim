// 백엔드 없이 프론트만 확인하고 싶을 때 쓰는 가짜 서버입니다. (npm run mock)
// 실제 FastAPI 백엔드의 응답 모양(명세서 기준)을 흉내 냅니다. 데이터는 메모리에만 저장됩니다.
import http from 'node:http';
import { readSheet } from 'read-excel-file/node';

const PORT = Number(process.env.PORT || 8000);
const norm = (s) => String(s).replace(/[\s.\-]/g, '').toUpperCase();

const PARTS = [
  ['0 420 201 638', 'GOVERNOR', 5, [200, 130, 100], '정밀/파손주의'],
  ['0 440 003 241', 'PUMP,FEED', 1.17, [145, 100, 90], '정밀/파손주의'],
  ['150102-01220', 'CRANKSHAFT;INTEGRATED', 310, [1100, 300, 260], '중량물'],
  ['400404-00260', 'GASKET,CYLINDER HEAD', 0.04, [120, 90, 3], '일반'],
  ['65.11120-5002', 'BOLT,HEX', 0.08, [60, 20, 20], '일반'],
  ['440211-00187C', 'RADIATOR ASSY', 38, [900, 700, 120], '중량물'],
  ['65.09100-7188', 'SENSOR,PRESSURE', 0.2, [70, 40, 40], '정밀/파손주의'],
  ['140103-00156', 'FILTER,OIL', 0.9, [110, 110, 140], '일반'],
].map(([part_no, name, w, d, cat], i) => ({
  id: `part_mock${String(i).padStart(4, '0')}`,
  part_no, name, engine_model: 'MOCK', net_weight_kg: w,
  raw_length_mm: d[0], raw_width_mm: d[1], raw_height_mm: d[2], packaging_category: cat,
}));
const byNo = new Map(PARTS.map((p) => [norm(p.part_no), p]));

const sims = new Map(); // id -> { id, name, parts: Map(partId -> qty) }
let seq = 1;

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

// multipart에서 파일 바이트만 꺼냅니다. (목 서버 전용의 단순 구현)
function extractFile(buf, contentType) {
  const m = /boundary=(.+)$/.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from(`--${m[1]}`);
  const start = buf.indexOf(boundary);
  const headerEnd = buf.indexOf('\r\n\r\n', start);
  const end = buf.indexOf(boundary, headerEnd);
  if (start < 0 || headerEnd < 0 || end < 0) return null;
  return buf.subarray(headerEnd + 4, end - 2);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const body = await readBody(req);

  try {
    if (req.method === 'GET' && path === '/part-types') {
      const q = (url.searchParams.get('search') || '').trim().toLowerCase();
      if (!q) return send(res, 400, { detail: 'search 파라미터가 필요합니다.' });
      const page = Number(url.searchParams.get('page') || 1);
      const size = Number(url.searchParams.get('size') || 20);
      const hit = PARTS.filter((p) => p.part_no.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
      return send(res, 200, { items: hit.slice((page - 1) * size, page * size), total: hit.length, page, size });
    }

    if (req.method === 'POST' && path === '/simulations') {
      const { name } = JSON.parse(body.toString() || '{}');
      if (!name) return send(res, 422, { detail: [{ msg: 'name 은 필수입니다.' }] });
      const id = `sim_mock${String(seq++).padStart(4, '0')}`;
      sims.set(id, { id, name, parts: new Map() });
      return send(res, 200, { id, name, status: 'CREATED' });
    }

    let m = /^\/simulations\/([^/]+)\/parts$/.exec(path);
    if (m) {
      const sim = sims.get(m[1]);
      if (!sim) return send(res, 404, { detail: '시뮬레이션을 찾을 수 없습니다.' });
      if (req.method === 'POST') {
        // 실제 백엔드/프론트(api.js의 addPart)는 부품을 { part_id, quantity } 한 건씩 보냅니다.
        const { part_id, quantity } = JSON.parse(body.toString() || '{}');
        if (!PARTS.some((x) => x.id === part_id)) return send(res, 404, { detail: `부품 ${part_id} 없음` });
        if (!Number.isInteger(quantity) || quantity <= 0) {
          return send(res, 422, { detail: [{ msg: 'quantity 는 1 이상의 정수여야 합니다.' }] });
        }
        sim.parts.set(part_id, (sim.parts.get(part_id) || 0) + quantity);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET') {
        const list = [...sim.parts].map(([partId, quantity]) => {
          const p = PARTS.find((x) => x.id === partId);
          return { part_id: partId, quantity, part_no: p.part_no, name: p.name, net_weight_kg: p.net_weight_kg,
            raw_length_mm: p.raw_length_mm, raw_width_mm: p.raw_width_mm, raw_height_mm: p.raw_height_mm };
        });
        return send(res, 200, list);
      }
    }

    m = /^\/simulations\/([^/]+)\/parts\/bulk-upload$/.exec(path);
    if (m && req.method === 'POST') {
      const sim = sims.get(m[1]);
      if (!sim) return send(res, 404, { detail: '시뮬레이션을 찾을 수 없습니다.' });
      const fileBuf = extractFile(body, req.headers['content-type']);
      if (!fileBuf) return send(res, 400, { detail: '파일이 없습니다.' });
      const rows = await readSheet(fileBuf);
      const failed = [];
      let total = 0, added = 0;
      rows.slice(1).forEach((r, i) => {
        const partNo = r[1] == null ? '' : String(r[1]).trim();
        if (!partNo && r[2] == null) return;
        total++;
        const qty = Number(r[2]);
        const part = byNo.get(norm(partNo));
        if (!part) return failed.push({ row: i + 2, part_no: partNo, reason: '부품마스터에 없는 품번' });
        if (!Number.isInteger(qty) || qty <= 0) return failed.push({ row: i + 2, part_no: partNo, reason: '수량 오류' });
        sim.parts.set(part.id, (sim.parts.get(part.id) || 0) + qty);
        added++;
      });
      return send(res, 200, { total_rows: total, added_count: added, added: [], failed });
    }

    send(res, 404, { detail: 'Not Found' });
  } catch (e) {
    send(res, 500, { detail: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock backend: http://127.0.0.1:${PORT}`));
