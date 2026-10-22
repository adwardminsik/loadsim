// 화면 표시용 포맷/라벨 모음

export const fmt = (n, digits = 0) =>
  n == null || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const CONTAINER_LABEL = {
  CONTAINER_20FT: '20ft',
  CONTAINER_40FT: '40ft',
  CONTAINER_40HC: '40HC',
};
export const containerLabel = (type) => CONTAINER_LABEL[type] || type || '—';


const RULE_LABEL = {
  GENERAL: '일반',
  part_override: '품번 규칙',
  category_override: '카테고리 규칙',
};
export const ruleLabel = (r) => RULE_LABEL[r] || r;

// 박스 규격 ID마다 서로 구분되는 색을 줍니다 (같은 ID는 항상 같은 색).
export function buildColorMap(boxTypeIds) {
  const ids = [...new Set(boxTypeIds)].sort();
  const map = {};
  ids.forEach((id, i) => {
    const hue = (i * 137.508) % 360; // 황금각: 인접한 색이 겹치지 않게 분산
    const light = 52 + (i % 3) * 7;
    map[id] = `hsl(${hue.toFixed(0)}, 58%, ${light}%)`;
  });
  return map;
}

// 실행용 시뮬레이션 이름의 '[적재] ' 접두어는 화면에 보이지 않게 합니다.
export const displayName = (name) => (name || '').replace(/^\[적재\]\s*/, '');

/**
 * 적재 결과 제목: 포함된 오더 이름들 + 오더에 속하지 않은 낱개 부품("부품이름x개수").
 * parts: 이번 적재의 전체 부품 [{id, name, partNo, quantity}], orders: [{name, rows}]
 */
export function buildRunTitle(orders, parts) {
  const inOrders = new Map();
  orders.forEach((o) => (o.rows || []).forEach((r) => inOrders.set(r.id, (inOrders.get(r.id) || 0) + (r.quantity || 0))));
  const total = new Map();
  parts.forEach((p) => {
    const cur = total.get(p.id);
    if (cur) cur.quantity += p.quantity || 0;
    else total.set(p.id, { name: p.name || p.partNo, quantity: p.quantity || 0 });
  });
  const loose = [];
  total.forEach((v, id) => {
    const extra = v.quantity - (inOrders.get(id) || 0);
    if (extra > 0) loose.push(`${v.name}x${extra}`);
  });
  return [...orders.map((o) => o.name), ...loose].join(' + ');
}

/**
 * 백엔드가 박스(placement)별로 보내는 내용물(parts)을 [{ partNo, name, quantity }] 로 정리합니다.
 * 배열(객체/문자열) 또는 { 품번: 수량 } 형태를 모두 받아들이고, 없으면 null 을 돌려줍니다.
 */
export function normalizeBoxParts(placement) {
  const raw = placement?.parts ?? placement?.Parts;
  if (raw == null) return null;
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  let list;
  if (Array.isArray(raw)) {
    list = raw.map((x) => {
      if (x == null) return null;
      if (typeof x !== 'object') return { partNo: String(x), name: '', quantity: null };
      return {
        partNo: String(x.part_no ?? x.partNo ?? x.PartNo ?? x.part_id ?? x.id ?? ''),
        name: x.desc ?? x.part_name ?? x.partName ?? x.name ?? '',
        quantity: num(x.quantity ?? x.qty ?? x.count ?? x.Quantity),
      };
    }).filter(Boolean);
  } else if (typeof raw === 'object') {
    list = Object.entries(raw).map(([k, v]) => ({ partNo: k, name: '', quantity: num(v) }));
  } else {
    return null;
  }
  // 같은 품번이 여러 줄이면 합산
  const m = new Map();
  list.forEach((p) => {
    const cur = m.get(p.partNo);
    if (cur) cur.quantity = (cur.quantity ?? 0) + (p.quantity ?? 0);
    else m.set(p.partNo, { ...p });
  });
  return [...m.values()];
}
