import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getContainers,
  getPackagedParts,
  getVisualization,
  runBundleParts,
  runContainerLoading,
  runPackParts,
} from '../api.js';
import Results from './Results.jsx';
import { displayName } from '../format.js';

const STEPS = [
  { key: 'package', label: '1단계 · 포장 규격 확인' },
  { key: 'bundle', label: '2단계 · 부품 묶음' },
  { key: 'pack', label: '3단계 · 박스 포장' },
  { key: 'load', label: '4단계 · 컨테이너 적재' },
];

/** 1→4단계를 순서대로 실행하고 결과를 보여줍니다. */
export default function RunView({ simulation, title, onBack, onRestart }) {
  const [step, setStep] = useState(0); // 진행 중인 단계 index
  const [error, setError] = useState(null); // { stepIndex, message }
  const [result, setResult] = useState(null);
  const runningRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return; // 중복 실행 방지
    runningRef.current = true;
    setError(null);
    setResult(null);
    let current = 0;
    const go = (i) => {
      current = i;
      if (aliveRef.current) setStep(i);
    };
    try {
      go(0);
      const packaged = await getPackagedParts(simulation.id);
      go(1);
      const bundled = await runBundleParts(simulation.id);
      go(2);
      const packed = await runPackParts(simulation.id);
      go(3);
      const run = await runContainerLoading(simulation.id);

      let containers = [];
      try {
        containers = await getContainers();
      } catch {
        containers = []; // 컨테이너 사양 조회 실패는 결과 표시에 치명적이지 않음
      }
      let viz = null;
      if (run.status === 'COMPLETED' && run.containers?.length) {
        try {
          viz = await getVisualization(simulation.id);
        } catch {
          viz = null;
        }
      }
      if (aliveRef.current) {
        setResult({ packaged, bundled, packed, run, containers, viz });
        setStep(4);
      }
    } catch (e) {
      if (aliveRef.current) setError({ stepIndex: current, message: e.message || '알 수 없는 오류' });
    } finally {
      runningRef.current = false;
    }
  }, [simulation.id]);

  useEffect(() => {
    run();
  }, [run]);

  if (result) {
    return (
      <Results simulation={simulation} title={title} data={result} onBack={onBack} onRestart={onRestart} />
    );
  }

  // 백엔드 계산(포장→묶음→포장→적재)이 끝나기 전까지는 별도 로딩 화면을 보여주지 않는다.
  // 오류가 났을 때만 안내와 재시도 버튼을 보여준다. 계산이 끝나면 바로 위에서 결과(3D 애니메이션)
  // 화면으로 전환된다.
  if (!error) return null;

  return (
    <section className="panel-page wide run-loading">
      <div className="page-head">
        <p className="eyebrow">적재 시뮬레이션</p>
        <h2>{title || displayName(simulation.name)}</h2>
        <p className="lede">시뮬레이션을 완료하지 못했습니다.</p>
      </div>

      <div className="error-box" role="alert">
        <b>{STEPS[error.stepIndex].label}</b>에서 오류가 발생했습니다.
        <div className="error-detail">{error.message}</div>
      </div>

      <div className="commit">
        <button className="btn ghost" onClick={onBack}>적재 부품 수정</button>
        <button className="btn primary" onClick={run}>다시 시도</button>
      </div>
    </section>
  );
}
