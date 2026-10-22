// 백엔드(FastAPI) 호출 모음. 엔드포인트는 '적재시뮬레이터_API명세서'를 따릅니다.
const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// 공통 응답 포맷({success, data, error})이든 평문 JSON이든 모두 받아냅니다.
function unwrap(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'success' in body) {
    if (body.success === false) {
      throw new ApiError(body.error?.message || '요청에 실패했습니다.', { code: body.error?.code });
    }
    return body.data;
  }
  return body;
}

function messageFromDetail(detail) {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg || JSON.stringify(d)).join(', ');
  return detail.message || JSON.stringify(detail);
}

async function request(path, { method = 'GET', json, formData, signal } = {}) {
  const init = { method, signal, headers: {} };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (formData) {
    init.body = formData; // Content-Type(boundary)은 브라우저가 지정
  }

  let res;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.');
  }

  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const msg =
      body?.error?.message || messageFromDetail(body?.detail) || `요청 실패 (HTTP ${res.status})`;
    throw new ApiError(msg, { status: res.status, code: body?.error?.code });
  }
  return unwrap(body);
}

// 백엔드 응답 필드명(snake/camel, 평탄/중첩)이 달라도 화면에서 같은 모양으로 쓰도록 맞춥니다.
export function normalizePart(p) {
  const dims = p.dimensions || {};
  return {
    id: p.id ?? p.partId ?? p.part_id,
    partNo: p.part_no ?? p.partNo ?? '',
    name: p.name ?? p.part_name ?? '',
    engineModel: p.engine_model ?? p.engineModel ?? '',
    weight: p.net_weight_kg ?? p.weight ?? p.netWeight ?? null,
    packagingCategory: p.packaging_category ?? p.packagingCategory ?? '',
    confidence: p.confidence_level ?? p.confidenceLevel ?? '',
    dims: [
      dims.length ?? p.raw_length_mm,
      dims.width ?? p.raw_width_mm,
      dims.height ?? p.raw_height_mm,
    ],
  };
}

export async function searchParts(search, { page = 1, size = 20, signal } = {}) {
  const qs = new URLSearchParams({ search, page: String(page), size: String(size) });
  const data = await request(`/part-types?${qs}`, { signal });
  const list = Array.isArray(data) ? data : (data?.items ?? data?.results ?? data?.parts ?? []);
  const total = Array.isArray(data) ? list.length : (data?.total ?? data?.totalCount ?? list.length);
  return { items: list.map(normalizePart), total, page, size };
}

export async function createSimulation(name) {
  const data = await request('/simulations', { method: 'POST', json: { name } });
  return { id: data.id ?? data.simulation_id ?? data.simulationId, name: data.name ?? name };
}

// 백엔드의 POST /simulations/{id}/parts 는 부품 1건({part_id, quantity})씩만 받습니다.
export async function addPart(simulationId, partId, quantity) {
  return request(`/simulations/${simulationId}/parts`, {
    method: 'POST',
    json: { part_id: partId, quantity },
  });
}

export async function bulkUploadParts(simulationId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const d = await request(`/simulations/${simulationId}/parts/bulk-upload`, {
    method: 'POST',
    formData: fd,
  });
  return {
    totalRows: d.total_rows ?? d.totalRows ?? 0,
    addedCount: d.added_count ?? d.addedCount ?? 0,
    failed: (d.failed ?? []).map((f) => ({
      row: f.row,
      partNo: f.part_no ?? f.partNo ?? '',
      reason: f.reason ?? '',
    })),
  };
}

export async function getSimulationParts(simulationId) {
  const data = await request(`/simulations/${simulationId}/parts`);
  const list = Array.isArray(data) ? data : (data?.parts ?? data?.items ?? []);
  // 같은 부품이 여러 줄로 등록될 수 있어(엑셀에 품번이 중복된 경우 등) 줄 자체의 id를 rowId로 따로 둡니다.
  return list.map((row) => ({
    ...normalizePart(row.part || row),
    id: row.part_id ?? row.partId ?? row.id,
    rowId: row.id,
    quantity: row.quantity,
  }));
}

// ---------------------------------------------------------------------------
// 파이프라인 (1~4단계) — 응답은 백엔드(snake_case) 모양 그대로 돌려줍니다.
// ---------------------------------------------------------------------------
export const getContainers = async () => {
  const d = await request('/containers');
  return Array.isArray(d) ? d : [];
};
// 1단계: 계산 없이 조회만 합니다.
export const getPackagedParts = (id) => request(`/simulations/${id}/package-parts/result`);
// 2~4단계: 순서대로 실행해야 하고(앞 단계 결과가 있어야 다음 단계가 열림), 다시 실행하면 결과를 덮어씁니다.
export const runBundleParts = (id) => request(`/simulations/${id}/bundle-parts`, { method: 'POST' });
export const runPackParts = (id) => request(`/simulations/${id}/pack-parts`, { method: 'POST' });
export const runContainerLoading = (id) => request(`/simulations/${id}/run`, { method: 'POST' });
export const getVisualization = (id) => request(`/simulations/${id}/visualization`);

// ---------------------------------------------------------------------------
// 오더 관리 — 백엔드의 '시뮬레이션' 하나가 오더 하나입니다(이름 = 오더 이름).
// 적재를 돌릴 때는 선택한 오더들의 부품을 합쳐 '[적재] …' 이름의 실행용 시뮬레이션을 따로 만들고,
// 오더 목록에서는 이 접두어가 붙은 것을 숨깁니다.
// ---------------------------------------------------------------------------
export const RUN_PREFIX = '[적재] ';
export const isRunName = (name) => typeof name === 'string' && name.startsWith('[적재]');

export async function listSimulations(limit = 200) {
  const d = await request(`/simulations?limit=${limit}`);
  return (Array.isArray(d) ? d : []).map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.created_at,
  }));
}

// 백엔드에 삭제 API가 없을 때를 위해, 이 브라우저에서만 숨기는 목록을 둡니다.
const HIDDEN_KEY = 'loadsim.hiddenOrders';
export function getHiddenOrders() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function hideOrderLocally(id) {
  try {
    const set = getHiddenOrders();
    set.add(id);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
  } catch {
    /* 저장소를 못 쓰는 환경이면 숨김 없이 넘어갑니다 */
  }
}

/** 오더 삭제. 서버에서 지웠으면 'server', 서버가 삭제를 지원하지 않아 이 브라우저에서만 숨겼으면 'local'. */
export async function deleteOrder(id) {
  try {
    await request(`/simulations/${id}`, { method: 'DELETE' });
    return 'server';
  } catch (e) {
    if (e.status === 404) return 'server'; // 이미 없음
    if (e.status === 405) {
      hideOrderLocally(id);
      return 'local';
    }
    throw e;
  }
}

// 실행용 시뮬레이션 정리(실패해도 무시)
export async function dropRunSimulation(id) {
  try {
    await request(`/simulations/${id}`, { method: 'DELETE' });
  } catch {
    /* 서버가 삭제를 지원하지 않아도 '[적재]' 접두어 때문에 목록에는 나오지 않습니다 */
  }
}

/** 선택한 오더들의 부품을 품번(part_id)별로 합산해 실행용 시뮬레이션을 만듭니다. */
export async function buildRunSimulation(orders, onProgress) {
  const merged = new Map();
  orders.forEach((o) =>
    o.rows.forEach((r) => {
      const cur = merged.get(r.id);
      if (cur) cur.quantity += r.quantity || 0;
      else merged.set(r.id, { partId: r.id, quantity: r.quantity || 0 });
    }),
  );
  const list = [...merged.values()].filter((m) => m.quantity > 0);
  const name = (RUN_PREFIX + orders.map((o) => o.name).join(' + ')).slice(0, 120);
  const simulation = await createSimulation(name);
  try {
    let done = 0;
    onProgress?.(0, list.length);
    for (const m of list) {
      await addPart(simulation.id, m.partId, m.quantity);
      onProgress?.(++done, list.length);
    }
  } catch (e) {
    dropRunSimulation(simulation.id);
    throw e;
  }
  const parts = await getSimulationParts(simulation.id);
  return { simulation, parts };
}

// 동시에 size개씩 처리하는 작은 풀
export async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// 오더 단위 적재 시뮬레이션 (3D 없이 요약만 쓸 때)
// ---------------------------------------------------------------------------
/** 2→3→4단계를 차례로 실행하고 4단계 결과를 돌려줍니다. */
export async function runOrderPipeline(id) {
  await runBundleParts(id);
  await runPackParts(id);
  return runContainerLoading(id);
}

async function getOrNull(path) {
  try {
    return await request(path);
  } catch (e) {
    if (e.status === 404) return null; // 아직 실행하지 않음
    throw e;
  }
}
export const getRunResultOrNull = (id) => getOrNull(`/simulations/${id}/result`);

/** 목록에 쓸 요약: { status, containerType, count, rate, unpacked } */
export async function getOrderRunSummary(id) {
  const run = await getRunResultOrNull(id);
  if (!run) return null;
  // 박스에 못 담았거나 마스터에 없어 계산에서 빠진 품번 수
  const unpacked = new Set([...(run.oversized_parts || []), ...(run.unmatched_parts || [])]).size;
  return {
    status: run.status,
    failureReason: run.failure_reason,
    containerType: run.recommended_container_type,
    count: run.container_count,
    rate: run.overall_load_rate_pct, // 전체(평균) 적재율 — 정렬용
    rates: (run.containers || []).map((c) => c.load_rate_pct), // 컨테이너별 적재율
    unpacked,
  };
}

/** 같은 이름의 오더가 이미 있는지(대소문자·앞뒤 공백 무시). 이 브라우저에서 삭제(숨김)한 오더는 없는 것으로 봅니다. */
export async function isOrderNameTaken(name) {
  const key = (name || '').trim().toLowerCase();
  const hidden = getHiddenOrders();
  const sims = await listSimulations();
  return sims.some((s) => !isRunName(s.name) && !hidden.has(s.id) && (s.name || '').trim().toLowerCase() === key);
}
