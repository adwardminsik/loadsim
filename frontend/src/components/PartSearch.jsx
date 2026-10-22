import React, { useEffect, useMemo, useRef, useState } from 'react';
import ExcelImport from './ExcelImport.jsx';
import OrderPicker from './OrderPicker.jsx';
import { searchParts, createSimulation, addPart, getSimulationParts, runOrderPipeline, isOrderNameTaken } from '../api.js';
import NoticeModal from './NoticeModal.jsx';

const DEFAULT_NAME = '제목 없는 오더';
const PAGE_SIZE = 20;
const MIN_QUERY = 2;

function fmtDims(d) {
  return d.every((v) => v != null) ? d.map((v) => Math.round(v)).join(' × ') + ' mm' : '치수 정보 없음';
}

// edit: 이미 등록된 오더에 부품을 더 담을 때 { simulation, parts }를 넘깁니다.
// 같은 부품이 여러 줄로 등록돼 있으면 한 줄로 합산합니다.
function mergeExisting(parts) {
  const map = new Map();
  parts.forEach((p) => {
    const cur = map.get(p.id);
    if (cur) cur.quantity += p.quantity || 0;
    else map.set(p.id, { part: p, quantity: p.quantity || 0 });
  });
  return [...map.values()].map((b) => ({ ...b, original: b.quantity }));
}

export default function PartSearch({ onBack, onRegistered, edit }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ items: [], total: 0, page: 1 });
  const [searched, setSearched] = useState(''); // 마지막으로 검색에 쓴 검색어
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [qtyDraft, setQtyDraft] = useState({}); // partId -> 입력 중인 수량(문자열)
  const [basket, setBasket] = useState(() => (edit ? mergeExisting(edit.parts) : [])); // [{part, quantity, original?}]
  const originalIds = useRef(edit ? mergeExisting(edit.parts).map((b) => b.part.id) : []);
  const [name, setName] = useState(edit ? edit.simulation.name : DEFAULT_NAME);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState('register'); // 'register' | 'run'
  const [error, setError] = useState('');
  const reqRef = useRef(0);
  // 등록 도중 실패해도 같은 시뮬레이션에 이어서 등록할 수 있도록 보관합니다.
  const simRef = useRef(null);
  const modeRef = useRef(null); // 'create' | 'append' | 'rebuild'
  // 적재 부품 수정 화면에서 부품을 더하는 방법: 'search' | 'orders' | 'excel'
  const [addTab, setAddTab] = useState('search');
  const [addedOrders, setAddedOrders] = useState([]); // 이번에 추가한 오더 [{id,name,types,qty}]
  const [excelKey, setExcelKey] = useState(0);
  const [dupName, setDupName] = useState(''); // 이미 있는 오더 이름이면 팝업
  const [removedOrderIds, setRemovedOrderIds] = useState([]); // 이번에 뺀 오더 id
  const [addInfo, setAddInfo] = useState('');
  const [addFailed, setAddFailed] = useState(null); // [{ orderName, failed[] }]
  const [registeredIds, setRegisteredIds] = useState(() => new Set());

  // 입력이 멈추고 300ms 뒤에 검색합니다. 이전 요청은 취소합니다.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults({ items: [], total: 0, page: 1 });
      setSearched('');
      setSearchError('');
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const myReq = ++reqRef.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setSearchError('');
      try {
        const r = await searchParts(q, { page: 1, size: PAGE_SIZE, signal: ctrl.signal });
        if (myReq !== reqRef.current) return;
        setResults(r);
        setSearched(q);
      } catch (e) {
        if (e.name === 'AbortError') return;
        setSearchError(e.message);
        setResults({ items: [], total: 0, page: 1 });
      } finally {
        if (myReq === reqRef.current) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  async function loadMore() {
    setLoading(true);
    try {
      const next = results.page + 1;
      const r = await searchParts(searched, { page: next, size: PAGE_SIZE });
      setResults((prev) => ({ ...r, items: [...prev.items, ...r.items], page: next }));
    } catch (e) {
      setSearchError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function addToBasket(part) {
    const inBasket = basket.find((b) => b.part.id === part.id);
    const raw = qtyDraft[part.id] ?? (edit && inBasket ? String(inBasket.quantity) : '1');
    const qty = Number(raw);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('수량은 1 이상의 정수로 입력해 주세요.');
      return;
    }
    if (registeredIds.has(part.id)) {
      setError('방금 등록한 부품입니다. 수량을 바꾸려면 새 오더를 만들어 주세요.');
      return;
    }
    setError('');
    setBasket((prev) => {
      const idx = prev.findIndex((b) => b.part.id === part.id);
      if (idx === -1) return [...prev, { part, quantity: qty }];
      const copy = [...prev];
      // 수정 화면에서는 입력한 숫자가 곧 최종 수량(등록된 개수를 늘리거나 줄임), 새로 입력할 때는 누적합니다.
      copy[idx] = { ...copy[idx], quantity: edit ? qty : copy[idx].quantity + qty };
      return copy;
    });
    setQtyDraft((d) => ({ ...d, [part.id]: undefined }));
  }

  function changeBasketQty(id, value) {
    const qty = Math.max(1, Math.floor(Number(value) || 1));
    setBasket((prev) => prev.map((b) => (b.part.id === id ? { ...b, quantity: qty } : b)));
  }

  // 오더/엑셀의 부품을 적재 부품에 더합니다. 같은 부품은 수량을 합산합니다.
  function addRows(rows) {
    setBasket((prev) => {
      const copy = [...prev];
      rows.forEach((r) => {
        const i = copy.findIndex((b) => b.part.id === r.id);
        if (i === -1) copy.push({ part: r, quantity: r.quantity });
        else copy[i] = { ...copy[i], quantity: copy[i].quantity + r.quantity };
      });
      return copy;
    });
  }
  const orderSummary = (id, name, rows) => ({
    id,
    name,
    types: new Set(rows.map((r) => r.id)).size,
    qty: rows.reduce((s, r) => s + (r.quantity || 0), 0),
    rows: rows.map((r) => ({ id: r.id, partNo: r.partNo, name: r.name, quantity: r.quantity })),
  });
  // 적재 부품에서 수량만큼 뺍니다. 수량이 0 이하가 되면 목록에서 제거합니다.
  // entries: [{ partNo 또는 id, quantity }]
  function subtractRows(entries, by) {
    const copy = basket.map((b) => ({ ...b }));
    const missing = [];
    let reduced = 0;
    let removed = 0;
    entries.forEach((e) => {
      const i = copy.findIndex((b) => (by === 'id' ? b.part.id === e.id : b.part.partNo === e.partNo));
      if (i === -1) {
        missing.push(e.partNo);
        return;
      }
      const left = copy[i].quantity - e.quantity;
      if (left > 0) {
        copy[i].quantity = left;
        reduced += 1;
      } else {
        copy.splice(i, 1);
        removed += 1;
      }
    });
    setBasket(copy);
    return { reduced, removed, missing };
  }
  const originalOrderIds = new Set((edit?.orders || []).map((o) => o.id));
  // 오더 체크박스: 체크하면 그 오더의 부품을 더하고, 해제하면 그 수량만큼 뺍니다.
  function onToggleOrder(o, checked) {
    if (checked) {
      addRows(o.rows);
      setRemovedOrderIds((prev) => prev.filter((id) => id !== o.id));
      if (!originalOrderIds.has(o.id)) setAddedOrders((prev) => (prev.some((x) => x.id === o.id) ? prev : [...prev, orderSummary(o.id, o.name, o.rows)]));
      setAddFailed(null);
      setAddInfo(`‘${o.name}’ 오더의 부품 ${o.rows.length}종을 추가했습니다. 오른쪽 목록을 확인하고 '변경사항 적용'을 눌러 주세요.`);
    } else {
      const r = subtractRows(o.rows.map((x) => ({ id: x.id, partNo: x.partNo, quantity: x.quantity })), 'id');
      setRemovedOrderIds((prev) => [...new Set([...prev, o.id])]);
      setAddedOrders((prev) => prev.filter((x) => x.id !== o.id));
      setAddFailed(null);
      setAddInfo(`‘${o.name}’ 오더를 뺐습니다. (부품 ${r.reduced + r.removed}종 반영${r.removed ? `, ${r.removed}종은 수량이 0이 되어 목록에서 제거` : ''}) 오른쪽 목록을 확인하고 '변경사항 적용'을 눌러 주세요.`);
    }
  }
  function onExcelSaved(saved) {
    const list = Array.isArray(saved) ? saved : [saved]; // 엑셀 여러 개가 한 번에 저장됩니다
    list.forEach((payload) => addRows(payload.parts));
    setAddedOrders((prev) => [...prev, ...list.map((pl) => orderSummary(pl.simulation.id, pl.simulation.name, pl.parts))]);
    const fails = list.filter((pl) => pl.failed?.length).map((pl) => ({ orderName: pl.simulation.name, failed: pl.failed }));
    setAddFailed(fails.length > 0 ? fails : null);
    const names = list.map((pl) => `‘${pl.simulation.name}’`).join(', ');
    const typeCount = new Set(list.flatMap((pl) => pl.parts.map((x) => x.id))).size;
    setAddInfo(`${names} ${list.length > 1 ? `${list.length}개 오더` : '오더'}로 저장하고 ${typeCount}종을 추가했습니다. 빼려면 '저장된 오더에서 추가' 탭에서 그 오더의 체크를 해제하세요. 오른쪽 목록을 확인하고 '변경사항 적용'을 눌러 주세요.`);
    setExcelKey((k) => k + 1); // 엑셀 입력 칸을 비워 다른 파일도 올릴 수 있게 함
  }

  async function submit() {
    // 수정 화면에서 아무것도 바꾸지 않았다면 등록할 것이 없으므로, 같은 부품 그대로 다음 단계(등록 확인)로 갑니다.
    if (edit && !dirty) {
      onRegistered({
        simulation: edit.simulation,
        parts: edit.parts,
        runError: null,
        failed: [],
        summary: { source: 'search' },
        addedOrders: [],
        removedOrderIds: [],
      });
      return;
    }
    setSubmitting(true);
    setError('');
    let current = null;
    try {
      if (!simRef.current) {
        if (edit) {
          // 백엔드에는 등록된 부품을 고치거나 지우는 API가 없습니다.
          // 새 부품만 추가하면 같은 오더에 이어서 등록하고, 기존 부품의 수량을 바꾸거나 뺀 경우에는 같은 이름의 새 오더로 다시 등록합니다.
          const keptSame = originalIds.current.every((id) => {
            const b = basket.find((x) => x.part.id === id);
            return b && b.quantity === b.original;
          });
          if (keptSame) {
            modeRef.current = 'append';
            simRef.current = edit.simulation;
          } else {
            modeRef.current = 'rebuild';
            simRef.current = await createSimulation(edit.simulation.name);
          }
        } else {
          modeRef.current = 'create';
          const finalName = name.trim() || DEFAULT_NAME;
          if (await isOrderNameTaken(finalName)) {
            setDupName(finalName); // 같은 이름의 오더가 있으면 저장하지 않습니다
            setSubmitting(false);
            return;
          }
          simRef.current = await createSimulation(finalName);
        }
      }
      const simulation = simRef.current;
      const targets = modeRef.current === 'append' ? basket.filter((b) => b.original == null) : basket;
      // 백엔드가 부품을 1건씩만 받으므로 순서대로 등록합니다. 이미 등록된 건은 건너뜁니다.
      for (const b of targets) {
        if (registeredIds.has(b.part.id)) continue;
        current = b;
        await addPart(simulation.id, b.part.id, b.quantity);
        setRegisteredIds((prev) => new Set(prev).add(b.part.id));
      }
      const parts = await getSimulationParts(simulation.id);
      // 새 오더를 등록할 때는 바로 적재 시뮬레이션을 돌려 오더 목록에 컨테이너/적재율을 보여 줍니다.
      // (적재 부품 수정 화면의 변경은 '실행' 단계에서 돌리므로 여기서는 돌리지 않습니다)
      let runError = null;
      if (!edit && parts.length > 0) {
        setPhase('run');
        try {
          await runOrderPipeline(simulation.id);
        } catch (e) {
          runError = e.message;
        }
      }
      onRegistered({
        simulation,
        parts,
        runError,
        failed: [],
        summary: { totalRows: basket.length, addedCount: parts.length, source: 'search' },
        addedOrders,
        removedOrderIds,
      });
    } catch (e) {
      const which = current ? `${current.part.partNo} 등록 중 오류: ` : '';
      const resume = current ? ' 이미 등록된 부품은 다시 등록되지 않으니, 버튼을 다시 누르면 남은 부품부터 이어서 등록합니다.' : '';
      setError(`${which}${e.message}.${resume}`);
      setSubmitting(false);
    }
  }

  const basketIds = new Set(basket.map((b) => b.part.id));
  // 수정 화면에서 이미 등록된 부품의 현재 수량(같은 부품이 여러 줄이면 합산)
  const basketQty = new Map(basket.map((b) => [b.part.id, b.quantity]));
  const existingQty = new Map();
  (edit?.parts || []).forEach((p) => existingQty.set(p.id, (existingQty.get(p.id) || 0) + (p.quantity || 0)));
  const totalQty = basket.reduce((s, b) => s + b.quantity, 0);
  const dirty =
    !edit ||
    basket.some((b) => b.original == null || b.quantity !== b.original) ||
    originalIds.current.some((id) => !basket.find((b) => b.part.id === id));
  const canLoadMore = results.items.length < results.total;
  const shortQuery = query.trim().length > 0 && query.trim().length < MIN_QUERY;

  return (
    <section className="panel-page wide">
      <div className="page-head">
        <button className="link-btn" onClick={onBack}>{edit ? '← 적재 결과로 돌아가기' : '← 입력 방식 다시 선택'}</button>
        <h2>{edit ? '적재 부품 수정' : '부품 직접 첨부'}</h2>
        <p className="lede">
          {edit
            ? `이번 적재의 부품을 수정합니다. 저장된 오더는 바뀌지 않고 이번 적재에만 반영됩니다. 이미 등록된 부품은 검색 결과나 오른쪽 목록에서 수량을 늘리거나 줄일 수 있습니다.`
            : '품번이나 품명(예: GOVERNOR)을 입력하고, 수량을 정해 목록에 담으세요.'}
        </p>
      </div>

      <div className="split">
        <div className="col-search">
          {edit && (
            <div className="tabs add-tabs" role="tablist">
              {[['search', '부품 직접 첨부'], ['orders', '저장된 오더에서 추가'], ['excel', '오더 엑셀 첨부']].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={addTab === k} className={addTab === k ? 'on' : ''} onClick={() => setAddTab(k)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {edit && addInfo && addTab !== 'search' && <div className="info-box" role="status">{addInfo}</div>}
          {edit && addFailed && addTab === 'excel' && (
            <div className="notice">
              {addFailed.map((af, idx) => (
                <React.Fragment key={`${af.orderName}-${idx}`}>
                  <h3>‘{af.orderName}’에서 등록하지 못한 행 {af.failed.length}건</h3>
                  <ul>
                    {af.failed.map((f, i) => (
                      <li key={`${f.row}-${i}`}>
                        <span className="mono">{f.row}행</span>
                        <span className="mono">{f.partNo || '—'}</span>
                        <span className="tag err">{f.reason}</span>
                      </li>
                    ))}
                  </ul>
                </React.Fragment>
              ))}
            </div>
          )}
          {edit && addTab === 'orders' && (
            <OrderPicker
              includedIds={new Set([...(edit.orders || []).map((o) => o.id).filter((id) => !removedOrderIds.includes(id)), ...addedOrders.map((o) => o.id)])}
              onToggle={onToggleOrder}
            />
          )}
          {edit && addTab === 'excel' && <ExcelImport key={excelKey} embedded onRegistered={onExcelSaved} />}
          {(!edit || addTab === 'search') && (<>
          <div className="searchbox">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="품번 또는 품명 검색"
              aria-label="부품 검색"
            />
            {loading && <span className="spinner" aria-label="검색 중" />}
          </div>

          <div className="results" aria-live="polite">
            {!query.trim() && <div className="empty">검색어를 입력하면 결과가 여기에 표시됩니다.</div>}
            {shortQuery && <div className="empty">{MIN_QUERY}글자 이상 입력해 주세요.</div>}
            {searchError && <div className="error-box">{searchError}</div>}
            {searched && !loading && !searchError && results.items.length === 0 && (
              <div className="empty">‘{searched}’에 해당하는 부품이 없습니다.</div>
            )}

            {results.items.length > 0 && (
              <div className="result-meta">
                ‘{searched}’ 검색 결과 {results.total.toLocaleString()}건
              </div>
            )}
            {results.items.map((p) => (
              <div className="part-row" key={p.id}>
                <div className="part-main">
                  <div className="part-no mono">{p.partNo}</div>
                  <div className="part-name">{p.name}</div>
                  <div className="part-sub">
                    {fmtDims(p.dims)}
                    {p.weight != null && ` · ${p.weight} kg`}
                    {p.packagingCategory && <span className="tag">{p.packagingCategory}</span>}
                    {existingQty.has(p.id) && <span className="tag ok">등록됨 {existingQty.get(p.id).toLocaleString()}개</span>}
                  </div>
                </div>
                <div className="part-add">
                  <input
                    className="qty"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={qtyDraft[p.id] ?? (edit && basketQty.has(p.id) ? String(basketQty.get(p.id)) : '1')}
                    onChange={(e) => setQtyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && addToBasket(p)}
                    aria-label={`${p.partNo} 수량`}
                  />
                  <button className={`btn ${basketIds.has(p.id) ? 'ghost' : 'primary'} small`} onClick={() => addToBasket(p)}>
                    {edit && basketQty.has(p.id) ? '수량 적용' : basketIds.has(p.id) ? '더 담기' : '담기'}
                  </button>
                </div>
              </div>
            ))}
            {canLoadMore && (
              <button className="btn ghost more" onClick={loadMore} disabled={loading}>
                더 보기 ({results.items.length.toLocaleString()} / {results.total.toLocaleString()})
              </button>
            )}
          </div>
          </>)}
        </div>

        <aside className="col-basket">
          <div className="basket">
            <div className="basket-head">
              <h3>{edit ? '적재 부품' : '담은 부품'}</h3>
              <span className="count">{basket.length}종 · {totalQty.toLocaleString()}개</span>
            </div>

            {basket.length === 0 ? (
              <div className="empty small">아직 담은 부품이 없습니다.</div>
            ) : (
              <ul className="basket-list">
                {basket.map((b) => (
                  <li key={b.part.id}>
                    <div className="b-info">
                      <div className="mono b-no">{b.part.partNo}</div>
                      <div className="b-name">{b.part.name}</div>
                      {b.original != null && (
                        <div className={`b-orig${b.quantity !== b.original ? ' chg' : ''}`}>
                          등록 {b.original.toLocaleString()}개{b.quantity !== b.original && ` → ${b.quantity.toLocaleString()}개`}
                        </div>
                      )}
                      {edit && b.original == null && <div className="b-orig chg">새로 추가</div>}
                    </div>
                    <input
                      className="qty"
                      type="number"
                      min="1"
                      step="1"
                      value={b.quantity}
                      onChange={(e) => changeBasketQty(b.part.id, e.target.value)}
                      disabled={registeredIds.has(b.part.id) || submitting}
                      aria-label={`${b.part.partNo} 수량`}
                    />
                    {registeredIds.has(b.part.id) ? (
                      <span className="tag ok" title="이미 시뮬레이션에 등록됨">등록됨</span>
                    ) : (
                      <button
                        className="icon-btn"
                        onClick={() => setBasket((prev) => prev.filter((x) => x.part.id !== b.part.id))}
                        disabled={submitting}
                        aria-label={`${b.part.partNo} 제거`}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {error && <div className="error-box">{error}</div>}

            {!edit && (
              <label className="field">
                <span>오더 이름</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={submitting || registeredIds.size > 0} />
              </label>
            )}
            <button className="btn primary block" onClick={submit} disabled={submitting || basket.length === 0 || (!edit && !dirty)}>
              {submitting ? (phase === 'run' ? '적재 시뮬레이션 실행 중…' : '등록 중…') : (edit ? (dirty ? '변경사항 적용' : '변경 없이 계속') : `${basket.length}종 등록하기`)}
            </button>
          </div>
        </aside>
      </div>
      {dupName && (
        <NoticeModal title="이미 존재하는 오더" onClose={() => setDupName('')}>
          ‘{dupName}’ 오더가 이미 존재합니다. 오더 이름을 바꿔서 다시 저장해 주세요. (저장하지 않았습니다)
        </NoticeModal>
      )}
    </section>
  );
}
