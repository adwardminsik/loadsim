import React, { useRef, useState } from 'react';
import { parseOrderExcel } from '../excel.js';
import { createSimulation, bulkUploadParts, getSimulationParts, runOrderPipeline, isOrderNameTaken } from '../api.js';
import NoticeModal from './NoticeModal.jsx';

const DEFAULT_NAME = '제목 없는 오더';
const baseName = (fileName) => fileName.replace(/\.xlsx$/i, '').trim() || DEFAULT_NAME;
const nameKey = (n) => (n || '').trim().toLowerCase();

// 여러 개의 엑셀을 한 번에 올려 각각 하나의 오더로 저장합니다.
// embedded: 적재 부품 수정 화면 안에 끼워 넣을 때(제목/뒤로가기 없이)
// onRegistered(payloads[]): 저장된 오더들의 배열 [{ simulation, parts, runError, failed, summary }]
export default function ExcelImport({ onBack, onRegistered, embedded = false }) {
  const inputRef = useRef(null);
  const seq = useRef(0);
  const [items, setItems] = useState([]); // [{ key, file, rows, name, saved?, error? }]
  const [dupNames, setDupNames] = useState([]); // 이미 있거나 겹치는 오더 이름이면 팝업
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total, phase, name }
  const [error, setError] = useState('');

  const patch = (key, p) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
  const validOf = (it) => it.rows.filter((r) => !r.error);
  const pendingItems = items.filter((it) => !it.saved);
  const payable = pendingItems.filter((it) => validOf(it).length > 0);

  async function handleFiles(fileList) {
    setError('');
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const problems = [];
    const added = [];
    setParsing(true);
    for (const f of files) {
      if (!/\.xlsx$/i.test(f.name)) {
        problems.push(`${f.name}: .xlsx 파일이 아닙니다. (.xls는 .xlsx로 저장해서 올려 주세요)`);
        continue;
      }
      if (items.some((it) => it.file.name === f.name && it.file.size === f.size) || added.some((it) => it.file.name === f.name && it.file.size === f.size)) {
        problems.push(`${f.name}: 이미 목록에 있는 파일입니다.`);
        continue;
      }
      try {
        const rows = await parseOrderExcel(f);
        if (rows.length === 0) {
          problems.push(`${f.name}: 읽을 수 있는 행이 없습니다. (1행은 헤더, B열은 품번, C열은 수량)`);
          continue;
        }
        added.push({ key: ++seq.current, file: f, rows, name: baseName(f.name) });
      } catch {
        problems.push(`${f.name}: 파일을 읽지 못했습니다. 손상되었거나 암호가 걸려 있는지 확인해 주세요.`);
      }
    }
    setParsing(false);
    if (added.length > 0) setItems((prev) => [...prev, ...added]);
    if (problems.length > 0) setError(problems.join('\n'));
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeItem(key) {
    setItems((prev) => prev.filter((it) => it.key !== key));
    setError('');
  }

  async function submit() {
    setError('');
    const targets = payable;
    // 1) 저장 전에 이름을 모두 확인합니다. 하나라도 겹치면 아무것도 저장하지 않습니다.
    const dups = new Set();
    const seen = new Map();
    targets.forEach((it) => {
      const k = nameKey(it.name || DEFAULT_NAME);
      seen.set(k, (seen.get(k) || 0) + 1);
    });
    seen.forEach((n, k) => n > 1 && dups.add(k));
    setSubmitting(true);
    try {
      for (const it of targets) {
        if (await isOrderNameTaken(it.name.trim() || DEFAULT_NAME)) dups.add(nameKey(it.name || DEFAULT_NAME));
      }
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
      return;
    }
    if (dups.size > 0) {
      setDupNames(targets.filter((it) => dups.has(nameKey(it.name || DEFAULT_NAME))).map((it) => it.name.trim() || DEFAULT_NAME));
      setSubmitting(false);
      return;
    }

    // 2) 오더를 하나씩 저장하고, 저장할 때마다 그 오더의 적재 시뮬레이션을 돌려 둡니다.
    const failedItems = [];
    const newSaved = [];
    let done = 0;
    for (const it of targets) {
      const finalName = it.name.trim() || DEFAULT_NAME;
      setProgress({ done, total: targets.length, phase: '등록', name: finalName });
      patch(it.key, { error: null });
      try {
        const simulation = await createSimulation(finalName);
        const result = await bulkUploadParts(simulation.id, it.file);
        const parts = await getSimulationParts(simulation.id);
        let runError = null;
        if (parts.length > 0) {
          setProgress({ done, total: targets.length, phase: '적재 시뮬레이션', name: finalName });
          try {
            await runOrderPipeline(simulation.id);
          } catch (e) {
            runError = e.message;
          }
        }
        const saved = {
          simulation,
          parts,
          runError,
          failed: result.failed,
          summary: { totalRows: result.totalRows, addedCount: result.addedCount, source: 'excel' },
        };
        newSaved.push(saved);
        patch(it.key, { saved });
      } catch (e) {
        failedItems.push(it.key);
        patch(it.key, { error: e.message });
      }
      done += 1;
    }
    setProgress(null);
    setSubmitting(false);
    // 3) 전부 저장되면 다음 화면으로, 실패한 것이 있으면 남겨 두어 다시 시도하게 합니다.
    if (failedItems.length === 0) {
      onRegistered([...items.filter((x) => x.saved).map((x) => x.saved), ...newSaved]);
      return;
    }
    if (failedItems.length > 0) setError(`${failedItems.length}개 오더를 저장하지 못했습니다. 이미 저장된 오더는 다시 저장되지 않으니, 버튼을 다시 누르면 남은 오더만 이어서 저장합니다.`);
  }

  const totalTypes = payable.reduce((s, it) => s + validOf(it).length, 0);
  const totalQty = payable.reduce((s, it) => s + validOf(it).reduce((a, r) => a + r.quantity, 0), 0);
  const savedCount = items.length - pendingItems.length;

  return (
    <section className={embedded ? 'embedded' : 'panel-page'}>
      {embedded ? (
        <p className="lede embedded-lede">
          1행은 헤더, <b>B열은 품번</b>, <b>C열은 수량</b>인 .xlsx를 한 번에 여러 개 올릴 수 있습니다. 파일마다 새 오더로 저장되고, 그 부품이 이 적재에 추가됩니다.
        </p>
      ) : (
        <div className="page-head">
          <button className="link-btn" onClick={onBack}>← 입력 방식 다시 선택</button>
          <h2>오더 엑셀 첨부</h2>
          <p className="lede">
            1행은 헤더, <b>B열은 품번</b>, <b>C열은 수량</b>으로 적힌 .xlsx 파일을 올려 주세요. 여러 파일을 한 번에 올릴 수 있고, 파일마다 하나의 오더로 저장됩니다.
          </p>
        </div>
      )}

      <div
        className={`dropzone${dragging ? ' drag' : ''}${items.length > 0 ? ' compact' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!submitting) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !submitting && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !submitting && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="dz-title">
          {parsing ? '파일을 읽는 중…' : items.length > 0 ? '파일 더 추가하기' : '파일을 여기로 끌어놓거나 클릭해서 선택'}
        </div>
        <div className="dz-sub">.xlsx · 여러 파일 동시 선택 가능 · 품번 / 수량 열 사용</div>
      </div>

      {error && <div className="error-box" role="alert" style={{ whiteSpace: 'pre-line' }}>{error}</div>}

      {items.length > 0 && (
        <>
          <ul className="xl-list">
            {items.map((it) => {
              const valid = validOf(it);
              const errs = it.rows.filter((r) => r.error);
              const qty = valid.reduce((s, r) => s + r.quantity, 0);
              return (
                <li key={it.key} className={`xl-item${it.saved ? ' saved' : ''}${it.error ? ' failed' : ''}`}>
                  <div className="xl-head">
                    <div className="xl-file">
                      <div className="file-name">{it.file.name}</div>
                      <div className="file-sub">
                        총 {it.rows.length}행 · 정상 {valid.length}행 · 총 수량 {qty.toLocaleString()}개
                        {errs.length > 0 && <span className="warn"> · 확인 필요 {errs.length}행</span>}
                      </div>
                    </div>
                    {it.saved ? (
                      <span className="tag ok">저장됨</span>
                    ) : (
                      <button className="icon-btn" onClick={() => removeItem(it.key)} disabled={submitting} aria-label={`${it.file.name} 빼기`}>×</button>
                    )}
                  </div>
                  <label className="field xl-name">
                    <span>오더 이름</span>
                    <input
                      value={it.name}
                      onChange={(e) => patch(it.key, { name: e.target.value })}
                      maxLength={80}
                      disabled={submitting || !!it.saved}
                    />
                  </label>
                  {it.error && <div className="xl-err">저장 실패: {it.error}</div>}
                  <details className="xl-preview">
                    <summary>행 미리보기 ({it.rows.length}행)</summary>
                    <div className="table-wrap">
                      <table className="tbl">
                        <thead>
                          <tr><th className="rowno">행</th><th>품번</th><th className="num">수량</th><th>상태</th></tr>
                        </thead>
                        <tbody>
                          {it.rows.map((r) => (
                            <tr key={r.row} className={r.error ? 'bad' : ''}>
                              <td className="rowno mono">{r.row}</td>
                              <td className="mono">{r.partNo || '—'}</td>
                              <td className="num mono">{r.quantity ?? '—'}</td>
                              <td>{r.error ? <span className="tag err">{r.error}</span> : <span className="tag ok">정상</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>

          <p className="hint">
            미리보기는 형식만 확인합니다. 부품 마스터에 없는 품번은 등록 단계에서 서버가 걸러내고, 건너뛴 행은 다음 화면에 알려 드립니다.
          </p>

          <div className="commit">
            <span className="sel-summary">
              {savedCount > 0 && <span><b>{savedCount}</b>개 저장됨 · </span>}
              <span><b>{payable.length}</b>개 오더 · {totalTypes.toLocaleString()}개 품번 · 총 {totalQty.toLocaleString()}개</span>
            </span>
            <button className="btn primary" onClick={submit} disabled={submitting || payable.length === 0}>
              {submitting
                ? progress
                  ? `${progress.phase} 중… (${Math.min(progress.done + 1, progress.total)}/${progress.total})`
                  : '확인 중…'
                : embedded
                  ? `${payable.length}개 오더 추가하기`
                  : savedCount > 0
                    ? `남은 ${payable.length}개 오더 다시 저장`
                    : `${payable.length}개 오더 등록하기`}
            </button>
          </div>
        </>
      )}
      {dupNames.length > 0 && (
        <NoticeModal title="이미 존재하는 오더" onClose={() => setDupNames([])}>
          {dupNames.map((n) => `‘${n}’`).join(', ')} 오더 이름이 이미 존재하거나 서로 겹칩니다. 오더 이름을 바꿔서 다시 저장해 주세요. (저장하지 않았습니다)
        </NoticeModal>
      )}
    </section>
  );
}
