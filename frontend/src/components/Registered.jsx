import React from 'react';
import { displayName, fmt } from '../format.js';

export default function Registered({ data, onRestart, onRun, onBackToOrders }) {
  const { simulation, parts, orders = [], title } = data;
  const totalQty = parts.reduce((s, p) => s + (p.quantity || 0), 0);

  return (
    <section className="panel-page">
      <div className="page-head">
        <button className="link-btn" onClick={onBackToOrders}>← 적재 오더 확인으로</button>
        <p className="eyebrow">등록 확인</p>
        <h2>적재할 부품 확인</h2>
        <p className="lede">
          {orders.length > 0 ? `선택한 ${orders.length}개 오더의 부품을 합산했습니다.` : title || displayName(simulation.name)} 아래 내용으로 적재 시뮬레이션을 실행합니다.
        </p>
      </div>

      <div className="stat-row">
        <div className="stat"><span>오더</span><b>{orders.length || 1}</b></div>
        <div className="stat"><span>부품 종류</span><b>{fmt(parts.length)}</b></div>
        <div className="stat"><span>총 수량</span><b>{fmt(totalQty)}</b></div>
      </div>

      {orders.length > 0 && (
        <div className="chips">
          {orders.map((o) => (
            <div className="chip" key={o.id}><b>{o.name}</b><span>{fmt(o.types)}종 · {fmt(o.qty)}개</span></div>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr><th>품번</th><th>품명</th><th className="num">수량</th></tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.rowId ?? p.id}>
                <td className="mono">{p.partNo}</td>
                <td>{p.name}</td>
                <td className="num mono">{p.quantity?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="commit">
        <button className="btn ghost" onClick={onRestart}>새 오더 입력</button>
        <button className="btn primary" onClick={onRun} disabled={parts.length === 0}>
          적재 시뮬레이션 실행
        </button>
      </div>
    </section>
  );
}
