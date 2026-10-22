import React, { useMemo } from 'react';
import { containerLabel, fmt } from '../format.js';
import { estimateLoad } from '../estimate.js';

/** 오더들의 적재율을 단순 합산한 대략적인 컨테이너별 적재율. orders: [{ run }], pending: 아직 불러오는 중 */
export default function LoadEstimate({ orders, pending = false }) {
  const est = useMemo(() => estimateLoad(orders), [orders]);
  if (orders.length === 0) return null;
  if (pending) {
    return (
      <span className="est">
        <span className="est-label">예상 적재율 약</span>
        <span className="dim">계산 중…</span>
      </span>
    );
  }
  if (est.groups.length === 0) return null;
  return (
    <span className="est" title="오더 각각의 적재율을 단순 합산한 추정치입니다. 실제 적재 결과와 다를 수 있습니다.">
      <span className="est-label">예상 적재율 약</span>
      {est.groups.map((g) => (
        <span className="est-chip" key={g.type}>
          <span className="est-type">{containerLabel(g.type)}</span>
          {g.slots.map((v, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="est-sep">/</span>}
              <b className={v > 100 ? 'over' : ''}>{fmt(v, 1)}%</b>
            </React.Fragment>
          ))}
        </span>
      ))}
      {est.excluded > 0 && <span className="dim est-note">(적재 결과가 없는 {est.excluded}개 오더 제외)</span>}
    </span>
  );
}
