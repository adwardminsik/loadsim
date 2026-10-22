import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getHiddenOrders, getOrderRunSummary, getSimulationParts, isRunName, listSimulations, pool } from '../api.js';
import { containerLabel, fmt } from '../format.js';
import LoadEstimate from './LoadEstimate.jsx';

const sumQty = (rows) => rows.reduce((s, r) => s + (r.quantity || 0), 0);

/**
 * 저장된 오더 목록. 이번 적재에 포함된 오더는 체크되어 있고,
 * 체크하면 그 오더의 부품을 더하고, 체크를 해제하면 그 수량만큼 뺍니다.
 */
export default function OrderPicker({ includedIds, onToggle }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const hidden = getHiddenOrders();
        const sims = (await listSimulations()).filter((s) => !isRunName(s.name) && !hidden.has(s.id));
        if (!alive.current) return;
        setOrders(sims.map((s) => ({ ...s, state: 'loading', rows: [], run: { status: 'loading' } })));
        setLoading(false);
        await pool(sims, 6, async (s) => {
          const [partsRes, runRes] = await Promise.allSettled([getSimulationParts(s.id), getOrderRunSummary(s.id)]);
          const patch = partsRes.status === 'fulfilled' ? { state: 'ok', rows: partsRes.value } : { state: 'fail' };
          patch.run = runRes.status === 'fulfilled' ? runRes.value || { status: 'NONE' } : { status: 'ERROR', message: runRes.reason?.message };
          if (alive.current) setOrders((prev) => prev.map((o) => (o.id === s.id ? { ...o, ...patch } : o)));
        });
      } catch (e) {
        if (!alive.current) return;
        setError(e.message);
        setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
    };
  }, []);

  const usable = (o) => o.state === 'ok' && o.rows.length > 0;
  const includedList = orders.filter((o) => includedIds.has(o.id));
  const includedCount = includedList.length;
  const estOrders = useMemo(() => includedList.map((o) => ({ id: o.id, run: o.run })), [orders, includedIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const estPending = includedList.some((o) => o.run?.status === 'loading');

  return (
    <div className="order-picker">
      <p className="lede embedded-lede">
        체크한 오더가 이번 적재에 포함됩니다. 체크하면 그 오더의 부품과 수량이 오른쪽 적재 부품에 더해지고, 체크를 해제하면 그 수량만큼 빠집니다. 아래 예상 적재율은 체크한 오더의 적재 결과만 합산한 값입니다.
      </p>
      {error && <div className="error-box" role="alert">{error}</div>}
      {loading ? (
        <div className="empty">오더를 불러오는 중입니다…</div>
      ) : orders.length === 0 ? (
        <div className="empty">저장된 오더가 없습니다.</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl orders">
            <thead>
              <tr>
                <th className="chk" />
                <th>오더 이름</th>
                <th className="num">부품 종류</th>
                <th className="num">총 수량</th>
                <th>사용 컨테이너</th>
                <th className="num">적재율</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const ok = usable(o);
                const on = includedIds.has(o.id);
                const r = o.run || { status: 'loading' };
                const done = r.status === 'COMPLETED';
                return (
                  <tr key={o.id} className={on ? 'sel' : ''}>
                    <td className="chk">
                      <input type="checkbox" checked={on} disabled={!ok} onChange={(e) => onToggle(o, e.target.checked)} aria-label={`${o.name} 포함`} />
                    </td>
                    <td>
                      <span className={`order-name${ok ? ' click' : ''}`} onClick={() => ok && onToggle(o, !on)}>{o.name}</span>
                      {o.state === 'ok' && o.rows.length === 0 && <span className="tag">부품 없음</span>}
                      {o.state === 'fail' && <span className="tag err">불러오기 실패</span>}
                    </td>
                    <td className="num mono">{o.state === 'ok' ? fmt(new Set(o.rows.map((r) => r.id)).size) : '…'}</td>
                    <td className="num mono">{o.state === 'ok' ? fmt(sumQty(o.rows)) : '…'}</td>
                    <td>
                      {done && <span className="mono">{containerLabel(r.containerType)} × {r.count}대</span>}
                      {r.status === 'loading' && <span className="dim">…</span>}
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
                            <span className="tag warn" title={`계산에서 제외된 품번이 ${r.unpacked}건 있습니다(어떤 박스에도 안 들어가거나 부품마스터에 없음).`}>제외 {r.unpacked}</span>
                          )}
                        </>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="commit">
        <span className="sel-summary">
          <span><b>{includedCount}</b>개 오더 포함</span>
          <LoadEstimate orders={estOrders} pending={estPending} />
        </span>
      </div>
    </div>
  );
}
