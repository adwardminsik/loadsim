import React from 'react';

export default function StartScreen({ onPick }) {
  return (
    <section className="start">
      <div className="start-head">
        <p className="eyebrow">오더 별 적재 예측</p>
        <h1>어떤 방식으로 오더를 입력할까요?</h1>
        <p className="lede">
          오더리스트 엑셀을 올리거나, 품번을 검색해서 직접 담을 수 있습니다.
          입력한 부품은 하나의 오더로 저장되고, 저장된 오더를 골라 함께 적재할 수 있습니다.
        </p>
      </div>

      <div className="choice-grid">
        <button className="choice" onClick={() => onPick('excel')}>
          <span className="choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
              <path d="M9 13h6M9 17h6M9 9h2" />
            </svg>
          </span>
          <span className="choice-title">오더 엑셀 첨부</span>
          <span className="choice-desc">
            품번과 수량이 적힌 오더리스트(.xlsx)를 올리면 한 번에 가져옵니다.
          </span>
          <span className="choice-meta">1행 헤더 · B열 품번 · C열 수량</span>
          <span className="choice-go">파일 선택하기 →</span>
        </button>

        <button className="choice" onClick={() => onPick('search')}>
          <span className="choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.2-4.2" />
              <path d="M11 8.5v5M8.5 11h5" />
            </svg>
          </span>
          <span className="choice-title">부품 직접 첨부</span>
          <span className="choice-desc">
            품번이나 품명으로 부품을 찾아서 수량을 입력하고 목록에 담습니다.
          </span>
          <span className="choice-meta">등록된 부품 5만여 건 검색</span>
          <span className="choice-go">부품 검색하기 →</span>
        </button>

        <button className="choice" onClick={() => onPick('orders')}>
          <span className="choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <path d="m8.5 12 2.5 2.5 4.5-5" />
            </svg>
          </span>
          <span className="choice-title">저장된 오더 확인</span>
          <span className="choice-desc">
            이전에 입력해 둔 오더를 선택해 부품을 합산하고 바로 적재 시뮬레이션을 실행합니다.
          </span>
          <span className="choice-meta">여러 오더 선택 · 삭제 가능</span>
          <span className="choice-go">오더 목록 보기 →</span>
        </button>
      </div>
    </section>
  );
}
