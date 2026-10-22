import React, { useEffect, useMemo, useState } from 'react';
import ContainerViewer from './ContainerViewer.jsx';
import { buildColorMap, containerLabel, displayName, fmt, normalizeBoxParts } from '../format.js';

const RUN_STAGES = ['부품 정리', '박스 적입', '박스 포장', '컨테이너 적재'];

export default function Results({ simulation, title, data, onBack, onRestart }) {
  const { packed, run, containers, viz } = data;
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(null);
  const [stage, setStage] = useState(null); // { activeIdx:[...], caption, hint, progress } | null

  const specOf = (type) => containers.find((c) => c.type === type || c.id === type);
  const failed = run.status !== 'COMPLETED';
  const recType = run.recommended_container_type;
  const spec = viz?.container || specOf(recType) || null;
  const maxWeight = specOf(recType)?.max_weight_kg;

  const loadedContainers = viz?.containers?.length ? viz.containers : run.containers || [];
  const current = loadedContainers[tab] || loadedContainers[0];
  const placements = current?.placements || [];

  useEffect(() => {
    setSelected(null);
  }, [tab]);

  const colorMap = useMemo(
    () => buildColorMap(loadedContainers.flatMap((c) => c.placements.map((p) => p.box_type_id))),
    [loadedContainers],
  );

  // 선택한 칸의 박스와, 그 박스 안에 실제로 담긴 부품(백엔드 parts)
  const selectedPlacement = selected != null ? placements[selected] : null;
  const boxParts = normalizeBoxParts(selectedPlacement) || [];

  // 범례: 이 컨테이너에 실린 박스 규격별 개수
  const legend = useMemo(() => {
    const m = new Map();
    placements.forEach((p) => m.set(p.box_type_id, (m.get(p.box_type_id) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [placements]);

  // 결과에 반영되지 못한 품번(품번 문자열 목록)
  const unmatched = [...new Set(run.unmatched_parts || [])]; // 부품마스터에 없는 품번
  const oversized = [...new Set([...(run.oversized_parts || []), ...(packed.oversized || [])])]; // 어떤 박스에도 안 들어간 품번
  const hasWarning = unmatched.length > 0 || oversized.length > 0;

  return (
    <section className="panel-page wide results">
      <div className="page-head">
        <p className="eyebrow">적재 결과</p>
        <h2>{title || displayName(simulation.name)}</h2>
        <p className="lede mono">{simulation.id}</p>
      </div>

      {failed ? (
        <div className="notice">
          <h3>컨테이너 적재에 실패했습니다</h3>
          <p className="notice-text">{run.failure_reason || '사유가 전달되지 않았습니다.'}</p>
        </div>
      ) : (
        <div className="banner">
          <div className="banner-main">
            <span className="banner-label">추천 컨테이너</span>
            <b className="banner-value">
              {containerLabel(recType)} <small>×</small> {run.container_count}대
            </b>
          </div>
          <div className="banner-stats">
            <div>
              <span>{run.container_count > 1 ? '컨테이너별 적재율' : '적재율'}</span>
              <b>
                {run.container_count > 1 && run.containers?.length
                  ? run.containers.map((c) => `${fmt(c.load_rate_pct, 1)}%`).join(' / ')
                  : `${fmt(run.overall_load_rate_pct, 1)}%`}
              </b>
            </div>
            <div><span>적재 부피</span><b>{fmt(run.total_loaded_volume_m3, 1)} m³</b></div>
            <div><span>적재 중량</span><b>{fmt(run.total_loaded_weight_kg, 0)} kg</b></div>
            <div><span>박스 수</span><b>{fmt(packed.total_box_count)}개</b></div>
          </div>
        </div>
      )}

      {hasWarning && (
        <div className="notice warn">
          <h3>일부 부품은 결과에 반영되지 않았습니다</h3>
          <p className="notice-text">
            아래 품번은 적재 계산에서 제외되었습니다. 제외된 부품만큼 실제 필요한 컨테이너 용량이 더 클 수 있습니다.
          </p>
          {oversized.length > 0 && (
            <>
              <h4>어떤 박스에도 들어가지 않아 제외 ({oversized.length}건)</h4>
              <ul>
                {oversized.map((no) => (
                  <li key={`o-${no}`}><span className="mono">{no}</span></li>
                ))}
              </ul>
            </>
          )}
          {unmatched.length > 0 && (
            <>
              <h4>부품마스터에서 찾지 못해 제외 ({unmatched.length}건)</h4>
              <ul>
                {unmatched.map((no) => (
                  <li key={`u-${no}`}><span className="mono">{no}</span></li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {run.note && <p className="note-line">{run.note}</p>}

      {!failed && current && (
        <>
          <h3 className="sec-title">적재 배치도</h3>
          <div className="loadview">
            <div className="tabs" role="tablist">
              {loadedContainers.map((c, i) => (
                <button
                  key={c.index ?? i}
                  role="tab"
                  aria-selected={i === tab}
                  className={i === tab ? 'on' : ''}
                  onClick={() => setTab(i)}
                >
                  컨테이너 {i + 1}
                  <em>{fmt(c.load_rate_pct, 1)}%</em>
                </button>
              ))}
            </div>

            <div className="viewer-grid">
              <div>
                {stage && (
                  <>
                    <ol className="run-stage-pills">
                      {RUN_STAGES.map((label, i) => (
                        <li
                          key={label}
                          className={stage.activeIdx.includes(i) ? 'now' : stage.activeIdx.length && i < Math.min(...stage.activeIdx) ? 'done' : ''}
                        >
                          {i + 1}단계 · {label}
                        </li>
                      ))}
                    </ol>
                    {stage.hint && <p className="run-stage-hint">{stage.hint}</p>}
                    <div className="run-caption-row">
                      <p className="run-caption">{stage.caption}</p>
                    </div>
                    <div className="run-progress">
                      <div className="run-progress-bar" style={{ width: `${stage.progress ?? 0}%` }} />
                    </div>
                  </>
                )}
                {spec ? (
                  <ContainerViewer
                    container={spec}
                    placements={placements}
                    colorMap={colorMap}
                    selectedIndex={selected}
                    onSelect={setSelected}
                    onStage={setStage}
                  />
                ) : (
                  <div className="viewer viewer-fallback">컨테이너 규격을 불러오지 못해 3D 화면을 표시할 수 없습니다.</div>
                )}
                <p className="hint">드래그: 회전 · 휠: 확대/축소 · 우클릭 드래그: 이동 · 박스를 클릭하면 상세가 표시됩니다.</p>
              </div>

              <aside className="side">
                <dl className="kv big">
                  <div><dt>적재율</dt><dd>{fmt(current.load_rate_pct, 1)}%</dd></div>
                  <div><dt>적재 부피</dt><dd>{fmt(current.loaded_volume_m3, 1)} m³</dd></div>
                  <div>
                    <dt>적재 중량</dt>
                    <dd>
                      {fmt(current.loaded_weight_kg, 0)} kg
                      {maxWeight ? <small> / {fmt(maxWeight, 0)}</small> : null}
                    </dd>
                  </div>
                  <div><dt>박스 수</dt><dd>{fmt(placements.length)}개</dd></div>
                </dl>

                {selectedPlacement ? (
                  <div className="pick">
                    <div className="pick-head">
                      <span className="sw" style={{ background: colorMap[selectedPlacement.box_type_id] }} />
                      <b className="mono">{selectedPlacement.box_type_id}</b>
                      <button className="icon-btn" onClick={() => setSelected(null)} aria-label="선택 해제">×</button>
                    </div>
                    <p className="pick-dims mono">
                      {selectedPlacement.dims_mm.map((v) => fmt(v)).join(' × ')} mm
                    </p>
                    <p className="pick-note">이 박스에 담긴 부품 ({fmt(boxParts.length)}종)</p>
                    {boxParts.length === 0 ? (
                      <p className="pick-note">이 박스의 내용물 정보가 없습니다.</p>
                    ) : (
                      <ul className="pick-list">
                        {boxParts.map((p) => (
                          <li key={p.partNo}>
                            <span className="mono">{p.partNo}</span>
                            {p.name && <span>{p.name}</span>}
                            {p.quantity != null && <span className="mono">{fmt(p.quantity)}개</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="legend">
                    <h4 className="legend-head"><span>박스 규격</span><span>박스 개수</span></h4>
                    <ul>
                      {legend.map(([id, n]) => (
                        <li key={id}>
                          <span className="sw" style={{ background: colorMap[id] }} />
                          <span className="mono">{id}</span>
                          <b>{fmt(n)}</b>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </>
      )}

      <div className="commit">
        <button className="btn ghost" onClick={onBack}>적재 부품 수정</button>
        <button className="btn primary" onClick={onRestart}>새 오더 입력</button>
      </div>
    </section>
  );
}
