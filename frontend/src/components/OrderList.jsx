import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildRunSimulation,
  deleteOrder,
  getHiddenOrders,
  getOrderRunSummary,
  getSimulationParts,
  isRunName,
  listSimulations,
  pool,
  runOrderPipeline,
} from '../api.js';
import { containerLabel, fmt } from '../format.js';
import LoadEstimate from './LoadEstimate.jsx';
import ConfirmModal from './ConfirmModal.jsx';

const TYPE_RANK = { CONTAINER_20FT: 1, CONTAINER_40FT: 2, CONTAINER_40HC: 3 };
const uniqTypes = (o) => new Set(o.rows.map((r) => r.id)).size;
// 정렬 기준값 (없는 값은 null → 항상 맨 뒤)
const SORT_VALUE = {
  name: (o) => o.name,
  types: (o) => (o.state === 'ok' ? uniqTypes(o) : null),
  qty: (o) => (o.state === 'ok' ? o.rows.reduce((s, r) => s + (r.quantity || 0), 0) : null),
  container: (o) => (o.run?.status === 'COMPLETED' ? o.run.count * 10 + (TYPE_RANK[o.run.containerType] || 0) : null),
  rate: (o) => (o.run?.status === 'COMPLETED' ? o.run.rate : null),
  date: (o) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(o.createdAt || '') ? o.createdAt : `${o.createdAt}Z`) || null,
};
function compareOrders(key, dir) {
  const get = SORT_VALUE[key];
  const sign = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y, 'ko', { numeric: true }) : x - y;
    return c * sign;
  };
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`); // 서버 시각은 UTC
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

const sumQty = (rows) => rows.reduce((s, r) => s + (r.quantity || 0), 0);

export default function OrderList({ selectedIds, onSelectionChange, notice, onDismissNotice, onAdd, onNext }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set(selectedIds));
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [info, setInfo] = useState('');
  const [building, setBuilding] = useState(null); // { done, total }
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const alive = useRef(true);
  const allRef = useRef(null);

  const patch = (id, p) => setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } : o)));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const hidden = getHiddenOrders();
      const sims = (await listSimulations()).filter((s) => !isRunName(s.name) && !hidden.has(s.id));
      if (!alive.current) return;
      setOrders(sims.map((s) => ({ ...s, state: 'loading', rows: [], run: { status: 'loading' } })));
      setLoading(false);
      await pool(sims, 4, async (s) => {
        // 부품과 적재 결과 요약(사용 컨테이너/적재율)을 함께 가져옵니다.
        const [partsRes, runRes] = await Promise.allSettled([getSimulationParts(s.id), getOrderRunSummary(s.id)]);
        if (!alive.current) return;
        patch(s.id, {
          ...(partsRes.status === 'fulfilled' ? { state: 'ok', rows: partsRes.value } : { state: 'fail' }),
          run: runRes.status === 'fulfilled' ? runRes.value || { status: 'NONE' } : { status: 'ERROR', message: runRes.reason?.message },
        });
      });
    } catch (e) {
      if (!alive.current) return;
      setError(e.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  useEffect(() => {
    onSelectionChange([...selected]);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectable = (o) => o.state === 'ok' && o.rows.length > 0;
  const selectableOrders = orders.filter(selectable);
  const chosen = orders.filter((o) => selected.has(o.id) && selectable(o));
  const allChecked = selectableOrders.length > 0 && chosen.length === selectableOrders.length;
  const someChecked = chosen.length > 0 && !allChecked;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked;
  }, [someChecked]);

  const sorted = useMemo(() => [...orders].sort(compareOrders(sort.key, sort.dir)), [orders, sort]);
  const mergedTypes = useMemo(() => new Set(chosen.flatMap((o) => o.rows.map((r) => r.id))).size, [chosen]);
  const mergedQty = chosen.reduce((s, o) => s + sumQty(o.rows), 0);

  function toggleSort(key) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  }

  // 아직 적재 시뮬레이션을 돌리지 않은(또는 실패한) 오더를 여기서 실행합니다.
  async function runOne(o) {
    patch(o.id, { run: { status: 'running' } });
    setError('');
    try {
      await runOrderPipeline(o.id);
      const summary = await getOrderRunSummary(o.id);
      if (alive.current) patch(o.id, { run: summary || { status: 'NONE' } });
    } catch (e) {
      if (!alive.current) return;
      patch(o.id, { run: { status: 'ERROR', message: e.message } });
      setError(`‘${o.name}’ 적재 시뮬레이션 실행 중 오류: ${e.message}`);
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(selectableOrders.map((o) => o.id)));
  }

  async function remove(o) {
    setDeletingId(o.id);
    setError('');
    try {
      const how = await deleteOrder(o.id);
      setOrders((prev) => prev.filter((x) => x.id !== o.id));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(o.id);
        return n;
      });
      setConfirmId(null);
      setInfo(
        how === 'local'
          ? `‘${o.name}’ 오더를 목록에서 숨겼습니다. (서버에 삭제 기능이 없어 이 브라우저에서만 숨김 처리되며, 데이터는 서버에 남아 있습니다)`
          : `‘${o.name}’ 오더를 삭제했습니다.`,
      );
    } catch (e) {
      setError(`삭제하지 못했습니다: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  // 체크한 오더를 한 번에 삭제합니다(확인 팝업을 거친 뒤).
  async function removeChosen() {
    const targets = chosen;
    setBulkBusy(true);
    setError('');
    setInfo('');
    const done = [];
    const failed = [];
    let local = false;
    for (const o of targets) {
      try {
        const how = await deleteOrder(o.id);
        done.push(o.id);
        if (how === 'local') local = true;
      } catch (e) {
        failed.push(`${o.name} (${e.message})`);
      }
    }
    if (!alive.current) return;
    setOrders((prev) => prev.filter((x) => !done.includes(x.id)));
    setSelected((prev) => {
      const n = new Set(prev);
      done.forEach((id) => n.delete(id));
      return n;
    });
    setBulkConfirm(false);
    setBulkBusy(false);
    if (done.length > 0) {
      setInfo(
        local
          ? `${done.length}개 오더를 목록에서 숨겼습니다. (서버에 삭제 기능이 없어 이 브라우저에서만 숨김 처리되며, 데이터는 서버에 남아 있습니다)`
          : `${done.length}개 오더를 삭제했습니다.`,
      );
    }
    if (failed.length > 0) setError(`삭제하지 못한 오더 ${failed.length}개: ${failed.join(', ')}`);
  }

  async function next() {
    setError('');
    setBuilding({ done: 0, total: 0 });
    try {
      const r = await buildRunSimulation(chosen, (done, total) => setBuilding({ done, total }));
      onNext({
        ...r,
        failed: [],
        orders: chosen.map((o) => ({
          id: o.id,
          name: o.name,
          types: new Set(o.rows.map((x) => x.id)).size,
          qty: sumQty(o.rows),
          rows: o.rows.map((r) => ({ id: r.id, partNo: r.partNo, name: r.name, quantity: r.quantity })),
        })),
        summary: { source: 'orders' },
      });
    } catch (e) {
      setError(`부품을 합치는 중 오류가 발생했습니다: ${e.message}`);
      setBuilding(null);
    }
  }

  const busy = building != null;

  return (
    <section className="panel-page wide">
      <div className="page-head">
        <p className="eyebrow">적재 오더 확인</p>
        <h2>적재할 오더를 선택하세요</h2>
        <p className="lede">
          저장된 오더 중 함께 적재할 오더를 체크하면, 선택한 오더의 부품이 합산되어 하나의 적재 시뮬레이션으로 실행됩니다.
        </p>
      </div>

      {notice && (
        <div className="notice">
          {(Array.isArray(notice) ? notice : [notice]).map((n, idx) => (
            <React.Fragment key={`${n.orderName}-${idx}`}>
              {n.failed.length > 0 && (
                <>
                  <h3>‘{n.orderName}’ 오더에서 등록하지 못한 행 {n.failed.length}건</h3>
                  <ul>
                    {n.failed.map((f, i) => (
                      <li key={`${f.row}-${i}`}>
                        <span className="mono">{f.row}행</span>
                        <span className="mono">{f.partNo || '—'}</span>
                        <span className="tag err">{f.reason}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {n.runError && (
                <>
                  <h3>‘{n.orderName}’ 오더의 적재 시뮬레이션을 실행하지 못했습니다</h3>
                  <p className="notice-text">{n.runError} — 아래 목록에서 ‘실행’을 눌러 다시 시도할 수 있습니다.</p>
                </>
              )}
            </React.Fragment>
          ))}
          <button className="link-btn" onClick={onDismissNotice}>닫기</button>
        </div>
      )}
      {info && <div className="info-box" role="status">{info}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}

      {loading ? (
        <div className="empty">오더를 불러오는 중입니다…</div>
      ) : orders.length === 0 ? (
        <div className="empty">저장된 오더가 없습니다. 먼저 오더를 입력해 주세요.</div>
      ) : (
        <div className="table-wrap tall">
          <table className="tbl orders">
            <thead>
              <tr>
                <th className="chk">
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    disabled={busy || selectableOrders.length === 0}
                    aria-label="전체 선택"
                  />
                </th>
                {[
                  ['name', '오더 이름', ''],
                  ['types', '부품 종류', 'num'],
                  ['qty', '총 수량', 'num'],
                  ['container', '사용 컨테이너', ''],
                  ['rate', '적재율', 'num'],
                  ['date', '등록일', ''],
                ].map(([k, label, cls]) => (
                  <th key={k} className={cls} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button className={`th-sort${sort.key === k ? ' on' : ''}`} onClick={() => toggleSort(k)}>
                      {label}
                      <i aria-hidden="true">{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</i>
                    </button>
                  </th>
                ))}
                <th className="act" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((o) => {
                const ok = selectable(o);
                const isSel = selected.has(o.id) && ok;
                const r = o.run || { status: 'loading' };
                const done = r.status === 'COMPLETED';
                return (
                  <tr key={o.id} className={isSel ? 'sel' : ''}>
                    <td className="chk">
                      <input
                        type="checkbox"
                        checked={isSel}
                        disabled={!ok || busy}
                        onChange={() => toggle(o.id)}
                        aria-label={`${o.name} 선택`}
                      />
                    </td>
                    <td>
                      <span className={`order-name${ok && !busy ? ' click' : ''}`} onClick={() => ok && !busy && toggle(o.id)}>
                        <span>{o.name}</span>
                        {o.state === 'ok' && o.rows.length === 0 && <span className="tag">부품 없음</span>}
                        {o.state === 'fail' && <span className="tag err">불러오기 실패</span>}
                      </span>
                    </td>
                    <td className="num mono">{o.state === 'ok' ? fmt(uniqTypes(o)) : '…'}</td>
                    <td className="num mono">{o.state === 'ok' ? fmt(o.rows.reduce((s, x) => s + (x.quantity || 0), 0)) : '…'}</td>
                    <td>
                      {done && <span className="mono">{containerLabel(r.containerType)} × {r.count}대</span>}
                      {r.status === 'loading' && <span className="dim">…</span>}
                      {r.status === 'running' && <span className="dim">실행 중…</span>}
                      {r.status === 'NONE' && <span className="tag">미실행</span>}
                      {r.status === 'ERROR' && <span className="tag err" title={r.message}>확인 실패</span>}
                      {r.status === 'FAILED' && <span className="tag err" title={r.failureReason}>적재 실패</span>}
                    </td>
                    <td className="num mono">
                      {done ? (
                        <>
                          <span title={r.count > 1 ? `전체 평균 ${fmt(r.rate, 1)}%` : undefined}>
                            {(r.rates?.length ? r.rates : [r.rate]).map((v) => `${fmt(v, 1)}%`).join(' / ')}
                          </span>
                          {r.unpacked > 0 && (
                            <span className="tag warn" title={`계산에서 제외된 품번이 ${r.unpacked}건 있습니다(어떤 박스에도 안 들어가거나 부품마스터에 없음).`}>
                              제외 {r.unpacked}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="mono dim">{fmtDate(o.createdAt)}</td>
                    <td className="act">
                      {confirmId === o.id ? (
                        <span className="confirm">
                          삭제할까요?
                          <button className="btn danger small" onClick={() => remove(o)} disabled={deletingId === o.id}>
                            {deletingId === o.id ? '삭제 중…' : '삭제'}
                          </button>
                          <button className="btn ghost small" onClick={() => setConfirmId(null)} disabled={deletingId === o.id}>취소</button>
                        </span>
                      ) : (
                        <>
                          {o.state === 'ok' && o.rows.length > 0 && ['NONE', 'ERROR', 'FAILED'].includes(r.status) && (
                            <button className="link-btn run" onClick={() => runOne(o)} disabled={busy}>실행</button>
                          )}
                          <button className="link-btn del" onClick={() => setConfirmId(o.id)} disabled={busy}>삭제</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="commit sticky">
        <div className="sel-summary">
          {chosen.length === 0 ? (
            <span className="dim">선택한 오더가 없습니다.</span>
          ) : (
            <span>
              <b>{chosen.length}</b>개 오더 · 부품 <b>{fmt(mergedTypes)}</b>종 · 총 <b>{fmt(mergedQty)}</b>개
            </span>
          )}
          {chosen.length > 0 && <LoadEstimate orders={chosen} />}
        </div>
        <div className="btn-row">
          <button className="btn danger-ghost" onClick={() => setBulkConfirm(true)} disabled={busy || chosen.length === 0}>
            선택 삭제{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </button>
          <button className="btn ghost" onClick={onAdd} disabled={busy}>오더 추가 입력</button>
          <button className="btn primary" onClick={next} disabled={busy || chosen.length === 0}>
            {busy ? (building.total ? `부품 합산 중… ${building.done}/${building.total}` : '준비 중…') : '선택한 오더로 계속'}
          </button>
        </div>
      </div>
      {bulkConfirm && (
        <ConfirmModal
          title={`선택한 ${chosen.length}개 오더를 삭제할까요?`}
          confirmLabel="삭제"
          busyLabel="삭제 중…"
          busy={bulkBusy}
          danger
          onConfirm={removeChosen}
          onCancel={() => setBulkConfirm(false)}
        >
          <ul className="del-list">
            {chosen.slice(0, 8).map((o) => (
              <li key={o.id}>{o.name}</li>
            ))}
            {chosen.length > 8 && <li className="dim">외 {chosen.length - 8}개</li>}
          </ul>
          <p>삭제한 오더는 되돌릴 수 없습니다.</p>
        </ConfirmModal>
      )}
    </section>
  );
}
