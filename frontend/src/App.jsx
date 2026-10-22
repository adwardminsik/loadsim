import React, { useRef, useState } from 'react';
import StartScreen from './components/StartScreen.jsx';
import ExcelImport from './components/ExcelImport.jsx';
import PartSearch from './components/PartSearch.jsx';
import OrderList from './components/OrderList.jsx';
import Registered from './components/Registered.jsx';
import RunView from './components/RunView.jsx';
import { dropRunSimulation, isRunName } from './api.js';
import { buildRunTitle } from './format.js';
import logo from './assets/logo.png';

const STEPS = ['입력 방식', '오더 입력', '적재 오더 확인', '등록 확인', '적재 결과'];
// 화면 → 현재 단계 번호
const STEP_OF = { start: 0, excel: 1, search: 1, orders: 2, registered: 3, edit: 3, run: 4 };

export default function App() {
  // view: 'start' | 'excel' | 'search' | 'orders' | 'registered' | 'edit' | 'run'
  const [view, setView] = useState('start');
  const [selectedIds, setSelectedIds] = useState([]); // 적재할 오더로 체크해 둔 id
  const [importNotice, setImportNotice] = useState(null); // 엑셀에서 등록 못 한 행
  const [registered, setRegistered] = useState(null); // 실행용(합산) 시뮬레이션 { simulation, parts, orders }
  const registeredRef = useRef(null);
  registeredRef.current = registered;

  // 새 실행용 시뮬레이션으로 바뀌면 이전 것은 정리합니다(서버가 지원하지 않아도 목록에는 나오지 않음).
  const setRun = (payload) => {
    const prev = registeredRef.current;
    if (prev && prev.simulation.id !== payload.simulation.id && isRunName(prev.simulation.name)) {
      dropRunSimulation(prev.simulation.id);
    }
    setRegistered(payload);
  };

  const goStart = () => setView('start');

  // 부품 입력(엑셀/검색)으로 새 오더가 저장되면 오더 확인 화면으로 가서, 새 오더를 체크해 둡니다.
  const onOrderSaved = (saved) => {
    const list = Array.isArray(saved) ? saved : [saved]; // 엑셀은 여러 오더가 한 번에 저장됩니다
    setSelectedIds((prev) => [...new Set([...prev, ...list.map((p) => p.simulation.id)])]);
    const notices = list
      .filter((p) => p.failed?.length || p.runError)
      .map((p) => ({ orderName: p.simulation.name, failed: p.failed || [], runError: p.runError }));
    setImportNotice(notices.length > 0 ? notices : null);
    setView('orders');
  };
  const onRunReady = (payload) => {
    setRun(payload);
    setView('registered');
  };
  const onEdited = (payload) => {
    const removed = new Set(payload.removedOrderIds || []);
    const prevOrders = (registeredRef.current?.orders || []).filter((o) => !removed.has(o.id));
    const orders = [...prevOrders, ...(payload.addedOrders || [])];
    // 결과 제목: 수정 후의 오더 이름들 + 낱개 부품(부품이름x개수)
    setRun({ ...payload, orders, title: buildRunTitle(orders, payload.parts) || undefined });
    setView('registered');
  };

  const cur = STEP_OF[view];

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={goStart} aria-label="처음으로">
          <img className="brand-mark" src={logo} alt="" aria-hidden="true" />
          <span className="brand-text">
            <strong>컨테이너 적재 시뮬레이터</strong>
            <span>HD건설기계 엔진부품</span>
          </span>
        </button>
        <nav className="crumbs" aria-label="진행 단계">
          {STEPS.map((label, i) => (
            <span key={label} className={i === cur ? 'on' : i < cur ? 'done' : ''}>
              {i + 1} {label}
            </span>
          ))}
        </nav>
      </header>

      <main className="stage">
        {view === 'start' && <StartScreen onPick={setView} />}
        {view === 'excel' && <ExcelImport onBack={goStart} onRegistered={onOrderSaved} />}
        {view === 'search' && <PartSearch onBack={goStart} onRegistered={onOrderSaved} />}
        {view === 'orders' && (
          <OrderList
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            notice={importNotice}
            onDismissNotice={() => setImportNotice(null)}
            onAdd={goStart}
            onNext={onRunReady}
          />
        )}
        {view === 'registered' && registered && (
          <Registered
            data={registered}
            onRestart={goStart}
            onBackToOrders={() => setView('orders')}
            onRun={() => setView('run')}
          />
        )}
        {view === 'edit' && registered && (
          <PartSearch
            edit={{ simulation: registered.simulation, parts: registered.parts, orders: registered.orders }}
            onBack={() => setView('run')}
            onRegistered={onEdited}
          />
        )}
        {view === 'run' && registered && (
          <RunView simulation={registered.simulation} title={registered.title} onBack={() => setView('edit')} onRestart={goStart} />
        )}
      </main>
    </div>
  );
}
