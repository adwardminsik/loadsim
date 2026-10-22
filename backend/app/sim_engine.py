# -*- coding: utf-8 -*-
"""
사전 적재 시뮬레이션 엔진.

[2026-10, 알고리즘 교체] 팀원이 별도로 개발한 engine.py(v1.3, 실적 27건
기준 대수/종류 일치율 92.6%)를 이식한 버전. 기존 app/routers/pipeline.py의
자체 구현(py3dbp 기반, 대수 85%/종류 30%)을 대체한다.

원본과의 차이: DB(SQLAlchemy) 연동을 위해 Part/마스터 로딩 부분만 우리
스키마에 맞게 분리했고(app/routers/pipeline.py에서 처리), 핵심 계산
로직(expand_order/pack_wooden/pack_containers 등)은 원본 그대로 유지했다.
"js_round/py_round1/js_object_order"는 원본이 프론트(engine.js)와 소수점
단위로 결과를 맞추기 위해 쓰던 것인데, 우리는 프론트가 별도 JS 엔진을
쓰지 않으므로 몰라도 되지만 반올림 로직 자체는 결과 정밀도에 영향을
주므로 그대로 유지한다.

처리 흐름
  품번+수량 → 포장단위 전개(묶음) → 우든박스 담기(혼재 포함) →
  컨테이너 적재(3D Extreme Point, 20ft 또는 40HC 이분 선택) → 결과
"""
from __future__ import annotations

import math
import random
from bisect import bisect_right

VERSION = "v1.3 (2026-10-07)"
# 이 버전의 실적 검증 점수 (오더마다 자기 실적은 학습에서 빼고 예측). tests/test_parity.py 기준값과 같아야 함
ACCURACY = {"count_match": "25/27", "type_match": "25/27", "weight_err_pct": 7.7, "cbm_err_pct": 11.0}

# ---------------- 보정값 ----------------
TARGET_BUNDLE_WEIGHT_KG = 8.0      # 소형부품 묶음 목표 무게
TARGET_BUNDLE_VOL_M3 = 0.03        # 소형부품 묶음 목표 부피
MAX_BUNDLE_QTY = 100               # 묶음 최대 수량
PACKING_INEFFICIENCY = 1.1         # 묶음 부피 여유율
                                    # [2026-10 수정] 1.3->1.1: 실측 박스별품번상세(27개 오더, 4309행) 기준
                                    # 예측 평균 박스 CBM이 실제보다 1.3~2.2배 크게 나왔는데, 원인을 박스단위
                                    # 적재(컨테이너 패킹) 쪽이 아니라 "여러 품번을 묶어 우든박스 1개로 만드는"
                                    # 이 번들링 단계에서 찾음. 묶음 부피를 30% 여유로 잡다 보니 카탈로그에서
                                    # 실제보다 한 단계 큰 박스를 고르게 되고, 그 결과가 누적되어 컨테이너 대수까지
                                    # 실제보다 많이 나왔음(20개 실측 오더 중 대수일치 10/20=50%).
                                    # 여유율을 10%로 낮추자(1.3->1.1) 대수일치가 10/20->15/20(75%)로 개선,
                                    # 적재율 산정(타입일치 17/20=85%)에는 변화 없음. 1.05, 1.0까지 더 낮춰봐도
                                    # 결과가 동일(15/20)해서, 실제 크레이트에 어느정도 완충재 여유가 있는 것을
                                    # 반영하는 1.1을 채택함(0%까지 깎을 이유는 없음).
NO_OVERRIDE_MAX_BUNDLE_QTY = 15    # [2026-10 추가] 학습규칙/수동규칙이 전혀 없는(ov is None) 소형 품목의
                                    # 묶음 상한. 기존엔 이런 품목도 일반 품목과 같은 MAX_BUNDLE_QTY(100)까지
                                    # 묶여서, "100개를 한 묶음"으로 묶음부피에 꽉 맞는 전용 박스를 새로 열었음.
                                    # 그런데 실측(박스별품번상세) 대조 결과, 이런 소형 체결/개스킷류
                                    # (COTTER,VALVE/BOLT/GASKET/RING/SCREW 등, 수량 수백~수천)는 실측에서
                                    # '실제귀책CBM=0' - 즉 단 한 번도 자기 전용 박스를 차지한 적이 없고
                                    # 항상 다른 품번 박스의 남는 공간에 나눠 담겨서 나감(EPX2024090032 등
                                    # 5개 오더에서 적재율 격차 상위권 공통 원인, 10.7~36.1%p).
                                    # 묶음 수량 상한을 낮추면 묶음 1개의 부피가 작아져 기존에 열려 있는
                                    # 다른 박스의 남는 공간(extreme-point 빈 코너)에 들어갈 확률이 커짐 -
                                    # pack_wooden()의 기존 "다른 박스에 먼저 넣어보기" 로직은 그대로 두고,
                                    # 이 상한만 낮춰서 새 박스를 덜 열게 만드는 방식.
                                    # [검증, 20개 실제오더] 100(기존)/50/30/20/15/10/5 스윕 결과: 대수일치
                                    # 18/20·타입일치 17/20은 전부 동일(회귀 없음), 평균 적재율오차는
                                    # 15에서 최저(10.90%p -> 9.86%p)라 15를 채택. 다만 개선폭은 작고
                                    # 비례적이지 않음(값을 더 낮춰도 항상 좋아지지는 않음) - 이 상한을
                                    # 더 낮추는 식으로는 한계가 있고, EPX2025040009처럼 '수량은 적지만
                                    # (3~10개) 개별 크기가 커서 묶이지도 않고(bq=1) 다른 박스에 비집고
                                    # 들어갈 수도 없는' 품목이 주 원인인 오더에는 이 수정이 전혀 효과가
                                    # 없었음(그 오더 오차는 22.6%p로 모든 상한값에서 불변) - 그런 경우는
                                    # 애초에 여러 개를 한 박스에 같이 넣는 것 자체를 미리 계획해야 하는
                                    # '사전 그룹핑' 문제라 이 상한 조정과는 다른 해법이 필요함(미해결,
                                    # 아래 학습규칙/다음 작업 후보 참고). 학습규칙/수동규칙(PART_OVERRIDES
                                    # 등)이 있는 품목은 이미 실측으로 검증된 값이라 이 상한의 영향을
                                    # 받지 않음(ov is None일 때만 적용).
WEIGHT_CALIBRATION_FACTOR = 1.27   # SAP 무게 → 실측 총중량 보정 (실적 기반)
LOADING_RATE_BENCHMARK_AVG_PCT = 67.4   # 실측 적재율 벤치마크 평균(API명세서 '알고리즘파라미터' 시트에
                                         # 정의돼 있었으나 코드에 미반영 상태였음) - 40ft/40HC 타입 자동선택에 사용
FILL_TARGET = 0.9                  # 우든박스 충전율 상한
MAX_BOX_WEIGHT_KG = 700.0          # 우든박스 1개 무게 상한
LEARN_MIN_RATIO = 1.0              # 오더 수량이 실측 1케이스분 이상일 때만 학습 규칙 적용
LEARN_FILTER = {"minCbm": 0.3, "singleMinKg": 50}   # 소포·자투리 케이스 오학습 방지
BOX_CODE_ACTUAL = "실측포장"        # v1.3 SAP 실측 치수로 학습한 포장의 표시 코드
FIT_TOL = 1.05                     # v1.2 박스 맞춤 여유(각 변 5%): 완충 여유를 뺀 부품 본체가 들어가면 그 박스 사용

# [2026-10 추가] "소모품 그룹" — 27개 오더·513개 박스 실측 데이터 분석 결과, 혼재(여러 품번)
# 박스의 50.1%에서 "A랑 B가 원래 한 세트"라는 1:1 규칙이 아니라 이 카테고리들이 품번과
# 무관하게 서로 자주 같이 묶이는 패턴이 확인됨 (예: BOLT+GASKET 50건, GASKET+HOSE 49건,
# GASKET+PIPE 46건 등). 작고 가벼운 소모성·부속 부품이라 남는 공간에 같이 채워지는 것으로
# 추정. pack_wooden()에서 같은 그룹끼리 먼저 합치도록 가중치로 사용.
CONSUMABLE_CATEGORIES = {
    "GASKET", "VALVE", "ELEMENT", "PUMP ASSY", "HOSE", "BOLT", "PIPE", "RING",
    "BELT", "BEARING", "CHARGER ASSY", "MUFFLER", "CLAMP", "SENSOR", "HARNESS",
}


def _consumable_cat(desc) -> str | None:
    """품명 첫 단어가 소모품 그룹에 속하면 그 카테고리명을, 아니면 None을 반환"""
    if not desc:
        return None
    cat = desc.split(",")[0].strip().upper()
    return cat if cat in CONSUMABLE_CATEGORIES else None

# ---------------- 컨테이너 (포워더 3D툴 내부치수, mm) ----------------
CONTAINERS = {
    "20ft": {"dims": [5950, 2340, 2250], "payload_kg": 28200},
    "40ft": {"dims": [11960, 2320, 2250], "payload_kg": 26500},
    "40HC": {"dims": [11960, 2320, 2550], "payload_kg": 28700},
}

# ---------------- 우든박스 실사용 33종 (코드, L, W, H, ㎥) ----------------
# [2026-10 추가] 신규 실측 3건(EPX2026080018/EPX2026010036/EPX2025090020)에서
# 기존 33종 카탈로그에 없던 고정규격 박스 7종 확인되어 추가함. "31-9999"는
# 카탈로그에 넣지 않음 - 같은 코드인데 실측 10건의 치수가 전부 달라(0.35~4.75㎥)
# 고정규격이 아닌 "비표준/커스텀 크레이트" 코드로 보임(아래 CUSTOM_CRATE_CODES 참고).
CATALOG = [{"code": c, "dims": [l, w, h], "vol": v} for c, l, w, h, v in [
    ("31-2209", 530, 380, 440, 0.089), ("31-2164", 2540, 240, 340, 0.216),
    ("31-1821", 750, 650, 720, 0.351), ("31-1752", 750, 600, 800, 0.36),
    ("31-2010", 1020, 1020, 570, 0.593), ("31-2406", 1020, 920, 820, 0.769),
    ("31-2123", 1070, 770, 1020, 0.84), ("31-2011", 1170, 1170, 740, 1.013),
    ("31-2306", 1230, 1230, 710, 1.072), ("31-2033", 1590, 1300, 540, 1.116),
    ("31-2122", 1100, 1100, 1100, 1.331), ("31-1303", 2850, 600, 800, 1.368),
    ("31-1676", 1350, 1050, 1030, 1.46), ("31-2407", 1100, 1220, 1100, 1.476),
    ("31-4057", 2500, 1200, 500, 1.5), ("31-2009", 2240, 1240, 530, 1.534),
    ("31-2017", 1220, 1220, 1070, 1.593), ("31-2026", 1420, 1070, 1080, 1.641),
    ("31-2023", 1370, 1170, 1340, 2.148), ("31-2201", 3300, 1100, 600, 2.178),
    ("31-2334", 1710, 1570, 870, 2.336), ("31-4189", 1500, 1050, 1550, 2.441),
    ("31-1859", 1600, 1300, 1200, 2.496), ("31-1374", 2470, 970, 1050, 2.516),
    ("31-2315", 1520, 1520, 1100, 2.541), ("31-2399", 3900, 870, 760, 2.579),
    ("31-2408", 2270, 1170, 980, 2.603), ("31-2043", 1670, 1170, 1345, 2.628),
    ("31-2032", 1420, 1050, 1780, 2.654), ("31-2121", 2200, 1100, 1100, 2.662),
    ("31-2177", 1400, 1400, 1400, 2.744), ("31-2342", 1870, 1670, 1100, 3.435),
    # --- 2026-10 신규 추가 7종 (실측 EPX2026080018/EPX2026010036/EPX2025090020) ---
    ("11-1052", 260, 210, 130, 0.007), ("31-2242", 580, 580, 470, 0.158),
    ("31-2237", 950, 580, 620, 0.342), ("31-2238A", 1130, 850, 460, 0.442),
    ("31-2308", 1070, 910, 1070, 1.042), ("31-2243", 1130, 850, 620, 0.596),
    ("31-2330", 1000, 1300, 1610, 2.093),
]]
# [2026-10 추가] 카탈로그 고정규격이 아닌 "비표준/커스텀 크레이트" 코드.
# 품번별 실측 치수(learn_rules의 box_dims)가 있을 때만 그 실측치를 그대로 쓰고,
# 그 외에는 일반 카탈로그 매칭 로직을 그대로 쓴다(이 집합은 참고/표시용).
CUSTOM_CRATE_CODES = {"31-9999"}
PREFERRED_NEW_BOX_CODES = {
    "31-2011", "31-2306", "31-2033", "31-2122", "31-1303", "31-1676", "31-2407",
    "31-4057", "31-2009", "31-2017", "31-2026", "31-2023", "31-2201", "31-2334",
    "31-4189", "31-1859", "31-1374", "31-2315", "31-2399", "31-2408", "31-2043",
    "31-2032", "31-2121", "31-2177", "31-2342",
    "31-2242", "31-2237", "31-2238A", "31-2308", "31-2243", "31-2330",
}
BOX_USAGE_FREQ = {
    "31-2121": 173, "31-1676": 53, "31-1374": 38, "31-2017": 25, "31-2122": 25,
    "31-2306": 21, "31-2033": 20, "31-2407": 27, "31-2209": 13, "31-2011": 12,
    "31-2010": 11, "31-2043": 10, "31-1859": 10, "31-4189": 9, "31-2334": 7,
    "31-2177": 6, "31-2408": 6, "31-1821": 5, "31-2123": 7, "31-2023": 5,
    "31-2399": 5, "31-2342": 4, "31-2315": 4, "31-2009": 4, "31-4057": 4,
    "31-2406": 4, "31-2164": 3, "31-1752": 3, "31-1303": 3, "31-2026": 3,
    "31-2201": 3, "31-2032": 3,
    # --- 2026-10 신규 7종 실측빈도 ---
    "31-2330": 5, "31-2242": 2, "31-2308": 2, "11-1052": 1, "31-2243": 1,
    "31-2237": 1, "31-2238A": 1,
}

# ---------------- 사용자 확인 치수 정정 (최우선) ----------------
DIM_CORRECTIONS = {
    "420211-00668A": {"dims": [41.9, 24.1, 15.7], "weight": 0.06,
                      "note": "SAP 치수 오류 정정(사용자 확인 2026-10): 실제 40×23×15mm, 0.06kg"},
    # (v1.1의 50개 도면 실측값은 v1.2에서 원본 엑셀 치수Data 자동 복구로 대체됨 - 같은 값)
    # [2026-10 발견] 마스터데이터(치수Data) Size(mm)='1301.0*1085.0*874.0'(1.3m 등방형 박스).
    # 원본 엑셀의 '근거' 컬럼을 보면 "'STANDARD CE MODEL' 내 실측 없어 'AUTOMOTIVE ENGINE'
    # 카테고리 253건 축별 중앙값 적용"이라고 명시돼있음 - 즉 엔진블록 등 큰 부품들이 섞인
    # 카테고리 전체의 중앙값이, 30g짜리 오일드레인 플러그(이 품번)에 그대로 적용된 것.
    # 이 '1301x1085x874' 템플릿이 품명에 PLUG/BOLT/WASHER/RING/SCREW 등 소형 하드웨어
    # 키워드가 들어간 품번에 244건이나 재사용되고 있음(마스터 전체 스캔 결과, 비슷한 유형의
    # 등방형 큰 박스 오탈적용이 총 340건) - 이 품번은 그중 실제 오더(EPX2024090032)에 걸려서
    # 발견된 사례. 번들링 시 이 품번 하나(수량5, 1개씩 번들)가 1.42㎥*5=7.1㎥를 혼자 차지해서
    # 해당 오더 전체 예측 CBM의 약 10%를 이 품번 하나가 잡아먹었음.
    # 실측값이 없어 정확한 치수는 모르지만, 무게(0.03kg)로 보아 손가락 크기 플러그이므로
    # 1.3m보다는 훨씬 작은 추정치(30x30x20mm)로 임시 보정 - 추후 실측값 확인 필요.
    # 같은 유형(이름에 소형 하드웨어 키워드 + 치수 세 축이 모두 300mm 이상)의 나머지 339건은
    # 코드 1건씩 고치는 게 아니라 import_part_master.py의 플레이스홀더 판별(is_cube_placeholder,
    # 현재는 완전한 정육면체만 잡음)을 넓혀서 데이터 임포트 단계에서 일괄 처리하는 게 맞음 -
    # 마스터 데이터 53,271건 전체에 영향을 주는 작업이라 여기서 바로 처리하지 않음.
    "K1-E6303-33752": {"dims": [30.0, 30.0, 20.0], "weight": 0.03,
                       "note": "마스터데이터 치수 오류 임시 보정(2026-10, 실측 확인 전): "
                               "원본 1301x1085x874mm(엔진류 카테고리 중앙값 오적용) -> 추정치 30x30x20mm"},
    # [2026-10 발견, 2차] K1-E6303-33752와 동일한 '카테고리 중앙값 오적용' 패턴이
    # MUFFLER/SILENCER(198건)/HOSE,FUEL(71건)/PIPE,INJECTION(84건) 카테고리에도 존재.
    # 근거 컬럼: "'OOO' 모델 내 실측 사이즈 없어 'MUFFLER/SILENCER' 카테고리 전체 198건의
    # 축별 중앙값 적용" 식으로 명시. 이 중 수치로 명확히 이상한 건만(=실측 근거 있는 동일
    # 카테고리 비교 대상과 밀도가 크게 어긋나는 건만) 아래에 보정 - 나머지(예: 240103-01968,
    # 240103-01974 등 같은 890x620x465mm를 쓰는 다른 품번들)는 무게가 정상 범위(수 kg~12kg대)라
    # 그 틀 자체는 그럴듯해서 건드리지 않음. PIPE,INJECTION 카테고리(420208-00549A 등,
    # 350x190x100mm, 0.07kg, 밀도 10.5kg/m³)도 같은 카테고리-중앙값 패턴이지만, 실측(confidence=상)
    # 동종 품번들의 밀도가 23~58kg/m³대로 폭넓게 분포해 10.5kg/m³가 확실한 이상치로 보기엔
    # 근거가 약함 - 이번 라운드는 보정하지 않고 그대로 둠(추후 실측 확인 필요, 보정 보류).
    "240103-01466": {"dims": [460.0, 320.0, 240.0], "weight": 1.6,
                     "note": "마스터데이터 치수 오류 임시 보정(2026-10, 실측 확인 전): "
                             "원본 890x620x465mm는 'MUFFLER/SILENCER' 카테고리(198건) 중앙값 그대로 적용된 것인데, "
                             "이 품번(OUTLET)은 1.6kg로 같은 틀을 쓰는 다른 품번들(최대 12.78kg)보다 8배 가벼움 - "
                             "같은 카테고리 실측 밀도(중앙값 약 45.6kg/m³) 기준 역산한 추정치 460x320x240mm로 축소"},
    # [2026-10 발견] size_parser.py의 parse_size()가 '값1*값2'(2개 숫자) 형식을 전부
    # (지름, 지름, 길이)로 해석하는데, HOSE,FUEL 카테고리의 실제 표기 관례는 (길이, 지름)임
    # (예: 420103-01060은 confidence='상'(실측)인데 "1300.0*40.0"이 1300mm 지름 호스로 해석됨 -
    # 호스 지름이 1.3m일 수 없으므로 축 순서가 반대인 게 명백. 아래 HOSE,FUEL 4건은 카테고리
    # 중앙값(730x40, confidence=중)까지 겹쳐서 전부 730x730x40mm라는 납작하고 큰 박스로 잘못
    # 계산되던 것을 (길이,지름,지름) 순서로 재해석해 보정. parse_size() 자체 수정은 이 2값
    # 포맷을 쓰는 다른 카테고리에도 영향을 줄 수 있어 전체 영향 분석 전까지는 보류, 이 4건만
    # 개별 보정.
    "420103-00115D": {"dims": [730.0, 40.0, 40.0], "weight": 0.08,
                      "note": "마스터데이터 치수 파싱 오류 임시 보정(2026-10, 실측 확인 전): "
                              "'730.0*40.0'(길이*지름)이 parse_size()에서 (지름,지름,길이)=730x730x40mm로 "
                              "잘못 해석됨 -> (길이,지름,지름)=730x40x40mm로 정정"},
    "420103-00471C": {"dims": [730.0, 40.0, 40.0], "weight": 0.106,
                      "note": "마스터데이터 치수 파싱 오류 임시 보정(2026-10, 실측 확인 전): "
                              "'730.0*40.0'(길이*지름)이 parse_size()에서 (지름,지름,길이)=730x730x40mm로 "
                              "잘못 해석됨 -> (길이,지름,지름)=730x40x40mm로 정정"},
    "420103-00505A": {"dims": [730.0, 40.0, 40.0], "weight": 0.042,
                      "note": "마스터데이터 치수 파싱 오류 임시 보정(2026-10, 실측 확인 전): "
                              "'730.0*40.0'(길이*지름)이 parse_size()에서 (지름,지름,길이)=730x730x40mm로 "
                              "잘못 해석됨 -> (길이,지름,지름)=730x40x40mm로 정정"},
    "420103-01060": {"dims": [1300.0, 40.0, 40.0], "weight": 0.276,
                     "note": "마스터데이터 치수 파싱 오류 임시 보정(2026-10, 실측 확인 전, 원본 confidence=상): "
                             "'1300.0*40.0'(길이*지름)이 parse_size()에서 (지름,지름,길이)=1300x1300x40mm로 "
                             "잘못 해석됨(지름 1.3m인 호스는 불가능) -> (길이,지름,지름)=1300x40x40mm로 정정"},
}

# ---------------- 실측 예외 (수동 확정 규칙) ----------------
PART_OVERRIDES = {
    "210101-00738A": {"no_bundle": True, "box_code": "31-2010", "note": "냉각팬: 1개씩 개별 박스 (EPX2026090030 실측)"},
    "400508-00191": {"fixed_bundle_qty": 840, "box_code": "31-2121", "note": "오일필터: 840개 고정 묶음 (EPX2025080040 실측)"},
    "400504-00612": {"fixed_bundle_qty": 32, "box_code": "31-2121", "note": "에어클리너: 32개 고정 묶음 (EPX2025080040 실측)"},
    "440211-00195": {"no_bundle": True, "box_code": "31-1374", "note": "라디에이터: 1개씩 31-1374 (EPX2024090043 실측)"},
}
CATEGORY_OVERRIDES = [
    {"keyword": "RADIATOR ASSY", "rule": {"no_bundle": True, "note": "라디에이터류: 단독 포장 (카테고리 규칙)"}},
]


# ---------------- 부품 마스터 항목 ----------------
class Part:
    __slots__ = ("dims", "weight", "conf", "desc", "autofix", "corrected")

    def __init__(self, dims, weight, conf, desc, autofix=None):
        self.dims, self.weight, self.conf, self.desc = list(dims), weight, conf, desc
        self.autofix, self.corrected = autofix, None


def apply_corrections(master: dict) -> dict:
    """사용자 확인 정정을 마스터에 덮어씀"""
    for k, c in DIM_CORRECTIONS.items():
        m = master.get(k)
        if m is not None and not m.corrected:
            m.dims, m.weight, m.corrected = list(c["dims"]), c["weight"], c["note"]
    return master


# ---------------- JS와 동일한 수치 처리 ----------------
def js_round(x: float, nd: int) -> float:
    """JS Math.round(x * 10^nd) / 10^nd (0.5에서 올림)"""
    f = 10 ** nd
    return math.floor(x * f + 0.5) / f


def py_round1(x: float) -> float:
    """engine.js pyRound1 과 동일 (0.5 경계는 짝수 쪽)"""
    y = x * 10
    f = math.floor(y)
    d = y - f
    if abs(d - 0.5) < 1e-12:
        r = f if f % 2 == 0 else f + 1
    else:
        r = math.floor(y + 0.5)
    return r / 10


def vol3(d) -> float:
    return d[0] * d[1] * d[2]


def js_object_order(d: dict):
    """JS 객체 순회 순서: 정수형 키(0~2^32-2)는 숫자 오름차순 먼저, 나머지는 삽입 순"""
    idx, rest = [], []
    for k in d:
        if k.isdigit() and (k == "0" or not k.startswith("0")) and int(k) <= 4294967294:
            idx.append(k)
        else:
            rest.append(k)
    return sorted(idx, key=int) + rest


# ---------------- 3D Extreme Point 배치 ----------------
def _overlap(p1, d1, p2, d2) -> bool:
    eps = 1e-6
    for i in range(3):
        if p1[i] + d1[i] <= p2[i] + eps or p2[i] + d2[i] <= p1[i] + eps:
            return False
    return True


def _in_any_box(pt, placed) -> bool:
    eps = 1e-6
    for pp, pd, _ in placed:
        if (pp[0] - eps < pt[0] < pp[0] + pd[0] - eps and
                pp[1] - eps < pt[1] < pp[1] + pd[1] - eps and
                pp[2] - eps < pt[2] < pp[2] + pd[2] - eps):
            return True
    return False


def _orientations(d):
    """컨테이너 적재 시 우든박스 회전 허용 범위.
    [2026-10 수정] 기존엔 6가지 회전(옆으로 눕히거나 세우는 것 포함)을 전부 허용했는데,
    실제 우든박스는 뚜껑이 항상 위를 향해야 하고 내부 부품 고정/완충재도 "바닥이 정해진
    상태"를 전제로 포장되므로, 박스를 세우거나 옆으로 눕혀 적재하는 건 현실적으로 불가능함.
    그래서 높이(H)는 항상 그대로 유지하고, 바닥에 놓인 채로 가로/세로만 90도 돌리는
    회전(L<->W 스왑) 2가지만 허용하도록 축소함."""
    L, W, H = d
    out = []
    for o in ([L, W, H], [W, L, H]):
        if o not in out:
            out.append(o)
    return out


def try_place_one(box, points: list, placed: list, C) -> bool:
    """박스 1개를 가장 낮고 안쪽인 점부터 배치 시도. 성공 시 points/placed 갱신"""
    ors = _orientations(box.dims_mm)
    points.sort(key=lambda p: (p[2], p[1], p[0]))
    best = None
    for p in points:
        for o in ors:
            if p[0] + o[0] > C[0] or p[1] + o[1] > C[1] or p[2] + o[2] > C[2]:
                continue
            if any(_overlap(p, o, pp, pd) for pp, pd, _ in placed):
                continue
            best = (p, o)
            break
        if best:
            break
    if not best:
        return False
    pos, dims = best
    placed.append((pos, dims, box))
    box.position, box.placed_dims_mm = pos, dims
    for i, q in enumerate(points):
        if q == pos:
            del points[i]
            break
    nx, ny, nz = pos[0] + dims[0], pos[1] + dims[1], pos[2] + dims[2]
    for np_ in ([nx, pos[1], pos[2]], [pos[0], ny, pos[2]], [pos[0], pos[1], nz],
                [nx, ny, pos[2]], [nx, pos[1], nz], [pos[0], ny, nz], [nx, ny, nz]):
        if np_[0] > C[0] or np_[1] > C[1] or np_[2] > C[2]:
            continue
        if np_ in points or _in_any_box(np_, placed):
            continue
        points.append(np_)
    return True


def _rebuild_points(placed, C):
    """[2026-10 추가] 이미 확정된 placed 목록으로부터, 남아있는 extreme point(후보 배치점)
    목록을 다시 복원한다. 컨테이너 1개를 다 채운 뒤 뒤늦게 추가로 1~2개를 더 끼워 넣어보려 할
    때(예: 재분할된 박스 재시도) try_place_one()이 필요로 하는 points 목록을 얻기 위함."""
    points = [[0, 0, 0]]
    for pos, dims, _ in placed:
        nx, ny, nz = pos[0] + dims[0], pos[1] + dims[1], pos[2] + dims[2]
        for np_ in ([nx, pos[1], pos[2]], [pos[0], ny, pos[2]], [pos[0], pos[1], nz],
                    [nx, ny, pos[2]], [nx, pos[1], nz], [pos[0], ny, nz], [nx, ny, nz]):
            if np_[0] > C[0] or np_[1] > C[1] or np_[2] > C[2]:
                continue
            if np_ not in points:
                points.append(np_)
    return [p for p in points if not _in_any_box(p, placed)]


def pack_container_ep(boxes, C):
    placed, points, unplaced = [], [[0, 0, 0]], []
    for b in sorted(boxes, key=lambda b: -vol3(b.dims_mm)):
        if not try_place_one(b, points, placed, C):
            unplaced.append(b)
    uv = sum(vol3(d) for _, d, _ in placed) / 1e9
    uw = sum(b.weight_kg for _, _, b in placed)
    return placed, unplaced, uv, uw


# ---------------- 실적 학습 ----------------
def learn_rules(case_sets, filt=None) -> dict:
    """과거 실적 케이스 중 단일 품번 케이스에서 '품번별 몇 개당 어떤 박스' 규칙 학습"""
    F = dict(LEARN_FILTER, **(filt or {}))
    obs = {}
    for cases in case_sets:
        for ck in js_object_order(cases):
            c = cases[ck]
            ps = list(c["parts"].items())
            if len(ps) != 1 or c["cbm"] < F["minCbm"]:
                continue
            pn, q = ps[0]
            k = pn.replace(" ", "")
            if q == 1 and c["kg"] < F["singleMinKg"]:
                continue
            if k not in obs or q > obs[k]["q"]:
                obs[k] = {"q": q, "cbm": c["cbm"], "kg": c["kg"], "dims": c.get("dims")}
    rules = {}
    for k, o in obs.items():
        if o.get("dims"):
            # v1.3: SAP Handling Unit 실측 치수가 있는 케이스는 그 포장 모양 그대로 사용
            #       (2m 높이 필터 팔레트, 라디에이터 전용 크레이트 등 표준 박스가 아닌 포장 35%)
            dm = [float(v) for v in o["dims"]]
            tag = "x".join(f"{v:.0f}" for v in dm)
            base = {"box_code": BOX_CODE_ACTUAL, "box_dims": dm, "learned": True}
            if o["q"] == 1:
                rules[k] = dict(base, no_bundle=True, fixed_bundle_qty=1, note=f"실적 학습: 1개당 실측 포장 {tag}mm")
            else:
                rules[k] = dict(base, fixed_bundle_qty=o["q"], note=f"실적 학습: {o['q']}개당 실측 포장 {tag}mm")
            continue
        best, bd = None, math.inf
        for b in CATALOG:
            d = abs(b["vol"] - o["cbm"])
            if d < bd:
                bd, best = d, b
        if o["q"] == 1:
            rules[k] = {"no_bundle": True, "fixed_bundle_qty": 1, "box_code": best["code"], "learned": True,
                        "note": f"실적 학습: 1개당 {best['code']} 박스"}
        else:
            rules[k] = {"fixed_bundle_qty": o["q"], "box_code": best["code"], "learned": True,
                        "note": f"실적 학습: {o['q']}개당 {best['code']} 박스({_js_num(o['cbm'])}㎥)"}
    return rules


def _js_num(v) -> str:
    """JS 템플릿 문자열의 숫자 표기와 같게 (2.0 -> '2')"""
    return str(int(v)) if float(v).is_integer() else repr(float(v))


# ---------------- 포장단위 / 박스 객체 ----------------
class Item:
    __slots__ = ("part_no", "base_part_no", "dims_mm", "weight_kg", "bundle_qty", "override", "desc", "conf",
                 "box_code", "position", "placed_dims_mm")

    def __init__(self, **kw):
        self.position = self.placed_dims_mm = None
        for k, v in kw.items():
            setattr(self, k, v)


class WoodBox:
    def __init__(self, code, dims):
        self.box_code, self.dims_mm = code, dims
        self.items, self.points, self.placed = [], [[0, 0, 0]], []
        self.used_volume = self.used_weight = 0.0


class LoadBox:
    """컨테이너 적재 단위(완성된 우든박스)"""

    def __init__(self, id_, code, dims, weight, fill_pct, items):
        self.id, self.code, self.dims_mm, self.weight_kg = id_, code, dims, weight
        self.fill_pct, self.items = fill_pct, items
        self.position = self.placed_dims_mm = None


class Engine:
    """학습 규칙 상태를 가진 엔진 인스턴스 (요청마다 학습 대상이 달라질 수 있어 인스턴스로 분리)"""

    def __init__(self, learned=None):
        self.learned = learned or {}

    # ---- 예외 규칙 조회: 수동 확정 > 실적 학습 > 카테고리 ----
    def lookup_override(self, part_no, desc, qty):
        if part_no in PART_OVERRIDES:
            return PART_OVERRIDES[part_no]
        L = self.learned.get(part_no)
        if L and qty >= L["fixed_bundle_qty"] * LEARN_MIN_RATIO:
            return L
        d = (desc or "").upper()
        for c in CATEGORY_OVERRIDES:
            if c["keyword"] in d:
                return c["rule"]
        return None

    # ---- 품번+수량 → 포장단위 ----
    @staticmethod
    def _bundle_qty(uw, dims):
        uv = vol3(dims) / 1e9
        by_w = math.trunc(TARGET_BUNDLE_WEIGHT_KG / uw) if uw > 0 else MAX_BUNDLE_QTY
        by_v = math.trunc(TARGET_BUNDLE_VOL_M3 / uv) if uv > 0 else MAX_BUNDLE_QTY
        return max(1, min(by_w, by_v, MAX_BUNDLE_QTY))

    @staticmethod
    def _bundle_dims(dims, q):
        if q <= 1:
            return dims
        s = py_round1(math.cbrt(vol3(dims) * q * PACKING_INEFFICIENCY))
        return [s, s, s]

    def expand_order(self, part_qty, master):
        items, unmatched = [], []
        cat_by_vol = sorted(CATALOG, key=lambda b: b["vol"])
        for part_no, qty in part_qty:
            key = part_no.replace(" ", "")
            info = master.get(key)
            if info is None:
                unmatched.append(part_no)
                continue
            ov = self.lookup_override(key, info.desc, qty)
            uw = info.weight * WEIGHT_CALIBRATION_FACTOR
            ov_dims = None
            if ov and ov.get("box_dims"):
                ov_dims = list(ov["box_dims"])
            elif ov and ov.get("box_code"):
                m = next((b for b in CATALOG if b["code"] == ov["box_code"]), None)
                if m:
                    ov_dims = m["dims"]
            if ov and ov.get("no_bundle"):
                bq = 1
            elif ov and ov.get("fixed_bundle_qty"):
                bq = ov["fixed_bundle_qty"]
            else:
                bq = self._bundle_qty(uw, info.dims)
                if ov is None and bq > NO_OVERRIDE_MAX_BUNDLE_QTY:
                    bq = NO_OVERRIDE_MAX_BUNDLE_QTY
            b_dims = ov_dims or self._bundle_dims(info.dims, bq)
            b_w = uw * bq
            rem, i = qty, 0
            while rem > 0:
                n = min(bq, rem)
                i += 1
                if n == bq:
                    dims, w = b_dims, b_w
                else:
                    dims = ov_dims or (self._bundle_dims(info.dims, n) if n > 1 else info.dims)
                    w = uw * n
                box_code = None
                if ov and ov.get("learned") and n < bq and ov_dims:
                    # 실측 1케이스분보다 적게 남은 자투리: 부피 비율만큼 작은 박스
                    need = (vol3(ov_dims) / 1e9) * (n / bq)
                    pick = next((b for b in cat_by_vol if b["vol"] >= need * 0.95), CATALOG[-1])
                    dims, box_code = pick["dims"], pick["code"]
                items.append(Item(part_no=f"{part_no}-{i}", base_part_no=part_no, dims_mm=dims, weight_kg=w,
                                  bundle_qty=n, override=ov, desc=info.desc, conf=info.conf, box_code=box_code))
                rem -= n
        return items, unmatched

    # ---- 포장단위 → 우든박스 ----
    @staticmethod
    def _fits(pd, bd):
        p, b = sorted(pd), sorted(bd)
        return p[0] <= b[0] * FIT_TOL and p[1] <= b[1] * FIT_TOL and p[2] <= b[2] * FIT_TOL

    @staticmethod
    def _new_box(chosen, item):
        nb = WoodBox(chosen["code"], chosen["dims"])
        if not try_place_one(item, nb.points, nb.placed, nb.dims_mm):
            # 맞춤 여유 범위로 들어간 부품(박스보다 최대 5% 큼): 박스 전체를 차지한 것으로 처리
            nb.placed.append(([0, 0, 0], list(nb.dims_mm), item))
            nb.points = []
        nb.items.append(item)
        nb.used_volume = vol3(item.dims_mm) / 1e9
        nb.used_weight = item.weight_kg
        return nb

    def pack_wooden(self, items):
        catalog = sorted(CATALOG, key=lambda b: b["vol"])
        rng = random.Random(42)
        groups = {}
        for it in items:
            groups.setdefault(it.base_part_no, []).append(it)
        gmax = {k: max(vol3(it.dims_mm) for it in arr) for k, arr in groups.items()}
        order = sorted(groups.keys(), key=lambda k: -gmax[k])
        seq = []
        for k in order:
            seq.extend(sorted(groups[k], key=lambda it: -vol3(it.dims_mm)))

        def forced_of(ov):
            return bool(ov and (ov.get("no_bundle") or ov.get("fixed_bundle_qty")))

        open_, oversized = [], []
        for item in seq:
            iv = vol3(item.dims_mm) / 1e9
            ov = item.override
            forced = forced_of(ov)
            if forced and ov.get("box_code"):
                if ov.get("box_dims") and not item.box_code:
                    ch = {"code": ov["box_code"], "dims": list(ov["box_dims"])}
                else:
                    code = item.box_code or ov["box_code"]
                    ch = next((b for b in catalog if b["code"] == code), None)
                if not ch or not self._fits(item.dims_mm, ch["dims"]):
                    oversized.append(item)
                    continue
                open_.append(self._new_box(ch, item))
                continue
            cands = [] if forced else [
                b for b in open_
                if b.used_volume + iv <= (vol3(b.dims_mm) / 1e9) * FILL_TARGET
                and b.used_weight + item.weight_kg <= MAX_BOX_WEIGHT_KG
                and not (forced_of(b.items[0].override) if b.items else False)]
            item_cat = _consumable_cat(item.desc)

            def _tier(b):
                if any(it.base_part_no == item.base_part_no for it in b.items):
                    return 0
                # [2026-10 추가] 소모품 그룹끼리는 같은 박스에 먼저 합침 (실측 데이터 기반, 위 설명 참고)
                if item_cat and any(_consumable_cat(it.desc) == item_cat for it in b.items):
                    return 1
                return 2

            cands = [b for _, _, b in sorted(
                ((_tier(b), idx, b) for idx, b in enumerate(cands)),
                key=lambda t: (t[0], -t[2].used_volume, t[1]))]
            ok = False
            for box in cands:
                tp, tl = list(box.points), list(box.placed)
                if try_place_one(item, tp, tl, box.dims_mm):
                    box.points, box.placed = tp, tl
                    box.items.append(item)
                    box.used_volume += iv
                    box.used_weight += item.weight_kg
                    ok = True
                    break
            if ok:
                continue
            fitting = [b for b in catalog if b["code"] in PREFERRED_NEW_BOX_CODES and self._fits(item.dims_mm, b["dims"])]
            if not fitting:
                fitting = [b for b in catalog if self._fits(item.dims_mm, b["dims"])]
            if not fitting:
                oversized.append(item)
                continue
            heavy_single = item.weight_kg > MAX_BOX_WEIGHT_KG / 2
            if forced or heavy_single:
                chosen = fitting[0]
            else:  # random.choices(fitting, weights) 와 동일 (engine.js MT.choice)
                cum, t = [], 0
                for b in fitting:
                    t += BOX_USAGE_FREQ.get(b["code"], 1)
                    cum.append(t)
                chosen = fitting[bisect_right(cum, rng.random() * t, 0, len(cum) - 1)]
            open_.append(self._new_box(chosen, item))
        open_ = self._compact_wooden(open_)
        return open_, oversized

    # [2026-10 추가] 우든박스 사후 병합: no_bundle/fixed_bundle_qty 품목이 있는 박스는 건드리지 않고,
    # 나머지 박스끼리만, 합쳤을 때 카탈로그의 어느 박스에 실제 3D 배치가 되고 무게도 상한 이내일 때만
    # 병합한다. 병합이 안 되면 그대로 두므로 박스 수가 늘어나는 경우는 구조적으로 없다(순수 축소 전용
    # 후처리 - pack_containers()의 컨테이너 단계 compaction과 동일한 개념을 박스 단계에도 적용).
    # 20개 실제오더 전체 검증: 15건에서 박스수 감소(최대 39→31개), 늘어난 오더 0건, 컨테이너
    # 대수/종류 일치율은 변화 없음(80%/85% 그대로) - 자세한 내용은 '제약조건' 시트 참고.
    @staticmethod
    def _forced_present(b):
        # [2026-10 시도] fixed_bundle_qty 품목 중 "자투리"(정량을 못 채운 마지막 묶음) 전용박스는
        # 이 사후 병합(compaction) 대상에서 제외하지 않음 - 실측증빙_박스별품번상세 대조 결과,
        # 자투리 수량은 실측에서도 전용박스를 또 열지 않고 다른 품번(들)과 섞어서 나갔음
        # (EPX2024100029의 MUFFLER,CATALYTIC 65개 중 25개는 전용박스 그대로, 남는 40개는 실측에서
        # 전부 다른 품번과 섞인 박스로 나감). no_bundle(수량1 고정, 예: 라디에이터)과 정량을 꽉 채운
        # 덩어리는 실측과 이미 잘 맞으므로(위 11번 항목 참고) 그대로 보호 대상 유지.
        def _forced(it):
            ov = it.override
            if not ov:
                return False
            if ov.get("no_bundle"):
                return True
            bq = ov.get("fixed_bundle_qty")
            if bq and it.bundle_qty < bq:
                return False  # 자투리: 병합 허용
            return bool(bq)  # 정량 꽉 채운 덩어리: 보호
        return any(_forced(it) for it in b.items)

    def _compact_wooden(self, open_, max_iter=500):
        cat_sorted = sorted(CATALOG, key=lambda b: b["vol"])
        it_count = 0
        changed = True
        while changed and it_count < max_iter:
            changed = False
            idxs = sorted(range(len(open_)), key=lambda i: open_[i].used_volume)
            for i in idxs:
                it_count += 1
                src = open_[i]
                if self._forced_present(src):
                    continue
                merged = False
                for j in idxs:
                    if j == i:
                        continue
                    dst = open_[j]
                    if self._forced_present(dst):
                        continue
                    combined_w = src.used_weight + dst.used_weight
                    if combined_w > MAX_BOX_WEIGHT_KG:
                        continue
                    combined_v = src.used_volume + dst.used_volume
                    combined_items = sorted(src.items + dst.items, key=lambda it: -vol3(it.dims_mm))
                    for cb in cat_sorted:
                        if combined_v > cb["vol"] * FILL_TARGET:
                            continue
                        nb = WoodBox(cb["code"], cb["dims"])
                        ok_all = True
                        for it in combined_items:
                            if not try_place_one(it, nb.points, nb.placed, nb.dims_mm):
                                ok_all = False
                                break
                            nb.items.append(it)
                        if ok_all:
                            nb.used_volume, nb.used_weight = combined_v, combined_w
                            open_ = [b for k, b in enumerate(open_) if k != i and k != j]
                            open_.append(nb)
                            merged = True
                            changed = True
                            break
                    if merged:
                        break
                if merged:
                    break
        return open_

    # ---- 우든박스 → 컨테이너 ----
    @staticmethod
    def c_vol(t):
        return vol3(CONTAINERS[t]["dims"]) / 1e9

    def pick_container_type(self, tv, tw, boxes=None):
        # [2026-10] 20ft 기준은 그대로(부피85%/무게90%, 실측 검증상 문제 없음).
        if tv <= self.c_vol("20ft") * 0.85 and tw <= CONTAINERS["20ft"]["payload_kg"] * 0.9:
            return "20ft"
        # --- 40ft vs 40HC 선택: 아래는 시도 순서대로 남긴 기록 ---
        # [1차 시도 - 실패] 40ft도 20ft와 같은 부피/무게 비율 기준(85%/90%)으로 후보에
        # 넣어봤으나, 실측 20개 오더 검증 결과 타입일치가 17/20->14/20으로 악화됨.
        # 원인: 예측 CBM을 40ft 용량(62.43㎥) 대비 비율로 보면 맞는 케이스(69.7%)와
        # 틀리는 케이스(71.8~81.9%)가 너무 가깝게 겹쳐서 "맞으면 40ft" 식의 단순 임계값
        # 자체가 40ft/40HC를 가르는 기준이 못 됨.
        # [2차 시도 - 실패] 비율 대신 "실제로 40ft 치수로 싸봐서(Extreme Point 패킹 그대로
        # 실행) 전부 들어가는지" 직접 검사해봤으나, pack_container_ep가 단독으로는 compaction
        # 병합단계(아래 pack_containers의 merge 로직) 없이 돌기 때문에 원래 40HC로도 1개가
        # 미배치되는 경우(EP 휴리스틱의 한계)가 그대로 "40ft 불가"로 오판됨 - 식별력 없음.
        # [3차 시도 - 채택] 명세서('제약조건'/'알고리즘파라미터' 시트)에 "40ft/40HC 중 어떤
        # 걸 쓸지는 실측 적재율 벤치마크 평균(LOADING_RATE_BENCHMARK_AVG_PCT=67.4%)을
        # 활용한다"는 설계 의도가 있었는데 코드에는 반영이 안 돼 있었음. 부피/무게 비율
        # "통과 여부"로는 구분이 안 됐지만, 벤치마크(67.4%)와의 "거리"로 비교하면 구분됨 -
        # 실측 데이터상 40ft로 나간 오더는 40ft 기준 적재율이 67.4%에 더 가깝고, 40HC로
        # 나간 오더는 40HC 기준 적재율이 67.4%에 더 가까운 패턴을 확인(검증 결과는 코드
        # 주석이 아니라 전달 문서/대화 기록 참조). 1개 컨테이너에 다 들어가는(= 90% 이내)
        # 타입들 중에서 벤치마크와 가장 가까운 쪽을 선택.
        cands = []
        for t in ("40ft", "40HC"):
            if tv <= self.c_vol(t) * 0.9 and tw <= CONTAINERS[t]["payload_kg"] * 0.9:
                rate = tv / self.c_vol(t) * 100
                cands.append((abs(rate - LOADING_RATE_BENCHMARK_AVG_PCT), t))
        if cands:
            cands.sort(key=lambda x: x[0])
            return cands[0][1]
        return "40HC"

    def _resplit_box(self, load_box):
        """[2026-10 추가] 컨테이너에 못 들어간 (병합된) 우든박스 1개를, 압축-병합 단계를
        건너뛰고 원래 품목들로 다시 포장해본다. _compact_wooden()은 박스 "개수"를 줄이려고
        부피만 보고 맞는 카탈로그 중 가장 작은 걸 고르는데, 그 결과로 만들어지는 모양이
        컨테이너의 남는 공간(대개 특정 높이 이하의 좁은 틈)과 안 맞을 수 있다 - 그래서 못
        들어간 박스를 압축 전 상태로 되돌려 다시 만들어보면, 이미 자주 쓰이는 표준 박스
        모양(예: 31-2121)으로 다시 나뉘어 남는 공간에 들어갈 가능성이 생긴다. 실패하면
        원래 박스를 그대로 반환(기존 동작과 동일, 손해 없음).

        [2026-10 보강] 이 재분할은 "되면 좋고 안되면 원래대로"인 순수 보강 로직이므로,
        호출 경로(예: pipeline.py의 추천 비교용 auto_pack)에 따라 load_box.items 안의
        항목이 Item 객체가 아니라 dict로 들어오는 경우가 있어도, 또는 그 밖의 어떤 예상치
        못한 모양이어도 절대 500 에러로 전체 시뮬레이션을 죽이지 않고, 조용히 실패
        처리(= 기존 미배치 상태 유지)한다.

        [2026-10 추가] REST API 경로(pipeline.py)에서는 .items가 "박스 안 부품 요약"
        (품번+수량, 치수/중량 없음) 표시용으로 이미 쓰이고 있어서, 재분할에 필요한 실제
        치수/중량 원본은 .raw_items라는 별도 속성에 들어온다 - 있으면 그걸 우선 쓴다."""
        try:
            raw_items = getattr(load_box, "raw_items", None)
            source_items = raw_items if raw_items else load_box.items

            _item_fields = ("part_no", "base_part_no", "dims_mm", "weight_kg", "bundle_qty",
                           "override", "desc", "conf", "box_code")
            norm_items = []
            for it in source_items:
                if isinstance(it, dict):
                    norm_items.append(Item(**{k: v for k, v in it.items() if k in _item_fields}))
                elif all(hasattr(it, f) for f in ("base_part_no", "dims_mm", "weight_kg")):
                    norm_items.append(it)
                else:
                    return None

            orig_compact = self._compact_wooden
            self._compact_wooden = lambda open_, max_iter=500: open_
            try:
                sub_boxes, oversized = self.pack_wooden(norm_items)
            finally:
                self._compact_wooden = orig_compact
            if oversized or not sub_boxes:
                return None

            # [2026-10 추가] pack_wooden()이 돌려주는 WoodBox.items는 Item 객체 목록이지만,
            # 호출 측(pipeline.py의 run_container_loading → _box_parts)은 LoadBox.items를
            # "화면 표시용 부품 요약" [{part_no, desc, qty}, ...] 형태로 기대한다. 이걸 그대로
            # 안 바꾸면 Item 객체가 그대로 들어가서 "argument after ** must be a mapping"
            # TypeError가 난다 - 일반(비-재분할) 박스를 만들 때(pipeline.py pack-parts
            # 단계)와 동일한 방식으로 품번별 집계해서 넣는다.
            out_boxes = []
            for b in sub_boxes:
                part_counts = {}
                for it in b.items:
                    key = it.base_part_no
                    part_counts.setdefault(key, {"desc": it.desc, "qty": 0})
                    part_counts[key]["qty"] += it.bundle_qty
                items_summary = [{"part_no": k, "desc": v["desc"], "qty": v["qty"]}
                                  for k, v in part_counts.items()]
                out_boxes.append(LoadBox(0, b.box_code, b.dims_mm, b.used_weight,
                                 b.used_volume / (vol3(b.dims_mm) / 1e9) * 100, items_summary))
            return out_boxes
        except Exception:
            return None

    def pack_containers(self, boxes, type_):
        C, payload, cv = CONTAINERS[type_]["dims"], CONTAINERS[type_]["payload_kg"], self.c_vol(type_)
        remaining, result, guard = list(boxes), [], 0
        while remaining and guard < 50:
            guard += 1
            cum, batch = 0, []
            for b in sorted(remaining, key=lambda b: -b.weight_kg):
                if cum + b.weight_kg <= payload:
                    cum += b.weight_kg
                    batch.append(b)
            placed, _, uv, uw = pack_container_ep(batch, C)
            if not placed:
                break
            result.append({"placed": placed, "uv": uv, "uw": uw, "approx": []})
            ids = {id(b) for _, _, b in placed}
            remaining = [b for b in remaining if id(b) not in ids]
        # compaction: 마지막 컨테이너를 앞 컨테이너와 합쳐보기
        merged = True
        while merged and len(result) >= 2:
            merged = False
            last = result[-1]
            last_boxes = [b for _, _, b in last["placed"]] + last["approx"]
            for j in range(len(result) - 1):
                prior = result[j]
                combined = [b for _, _, b in prior["placed"]] + prior["approx"] + last_boxes
                cw = sum(b.weight_kg for b in combined)
                if cw > payload:
                    continue
                placed, unplaced, uv, uw = pack_container_ep(combined, C)
                if not unplaced:
                    result[j] = {"placed": placed, "uv": uv, "uw": uw, "approx": []}
                    result.pop()
                    merged = True
                    break
                cvv = sum(vol3(b.dims_mm) for b in combined) / 1e9
                if cvv <= cv * 0.9 and cw <= payload * 0.9:
                    # 수치는 합계 기준, 3D는 배치 성공분만 좌표 사용(나머지 '위치 미확정')
                    result[j] = {"placed": placed, "uv": cvv, "uw": cw, "approx": unplaced}
                    result.pop()
                    merged = True
                    break
        # [2026-10 추가] 마지막 보강: 그래도 "미배치"로 남은 박스가 있으면, 압축-병합을
        # 건너뛰고 원래 품목들로 다시 포장해본 뒤(_resplit_box), 그 결과로 나온 작은 박스들을
        # 지금 컨테이너의 "남은 공간"(이미 배치된 것들로부터 다시 계산한 extreme point)에
        # 하나씩 더 끼워 넣어본다. 전부 들어가면 그만큼 "미배치"가 줄어들고, 하나라도 안
        # 들어가면 전혀 손대지 않고 원래 상태(approx 그대로) 유지 - 실패해도 손해 없음.
        for r in result:
            if not r["approx"]:
                continue
            try:
                still_approx = []
                for box in r["approx"]:
                    sub_boxes = self._resplit_box(box)
                    if not sub_boxes:
                        still_approx.append(box)
                        continue
                    points = _rebuild_points(r["placed"], C)
                    trial_placed = list(r["placed"])
                    ok_all = True
                    for sb in sub_boxes:
                        if not try_place_one(sb, points, trial_placed, C):
                            ok_all = False
                            break
                    if ok_all:
                        added_v = sum(vol3(sb.dims_mm) for sb in sub_boxes) / 1e9
                        added_w = sum(sb.weight_kg for sb in sub_boxes)
                        r["placed"] = trial_placed
                        r["uv"] += added_v
                        r["uw"] += added_w
                    else:
                        still_approx.append(box)
                r["approx"] = still_approx
            except Exception:
                # 이 보강 단계 전체가 "되면 좋고 안되면 원래대로"이므로, 여기서 무슨 일이
                # 생기든 r을 건드리지 않은 원래 상태로 둔다(손해 없음).
                pass

        out = []
        for i, r in enumerate(result):
            out.append({
                "container_no": i + 1, "type": type_, "n_boxes": len(r["placed"]) + len(r["approx"]),
                "used_weight_kg": js_round(r["uw"], 1), "payload_kg": payload,
                "weight_util_pct": js_round(r["uw"] / payload * 100, 2),
                "used_volume_m3": js_round(r["uv"], 3), "container_volume_m3": js_round(cv, 3),
                "volume_util_pct": js_round(r["uv"] / cv * 100, 2),
                "placed": r["placed"], "approx": r["approx"],
            })
        return out

    def auto_pack(self, boxes, forced_type=None):
        if forced_type:
            return forced_type, self.pack_containers(boxes, forced_type)
        tw = sum(b.weight_kg for b in boxes)
        tv = sum(vol3(b.dims_mm) for b in boxes) / 1e9
        t = self.pick_container_type(tv, tw, boxes)
        cs = self.pack_containers(boxes, t)
        if t in ("20ft", "40ft") and len(cs) > 1:
            t = "40HC"
            cs = self.pack_containers(boxes, t)
        return t, cs

    # ---- 전체 파이프라인 ----
    def simulate(self, part_qty, master, forced_type=None):
        items, unmatched = self.expand_order(part_qty, master)
        wb, oversized = self.pack_wooden(items)
        boxes = [LoadBox(i + 1, b.box_code, b.dims_mm, b.used_weight,
                         b.used_volume / (vol3(b.dims_mm) / 1e9) * 100, b.items) for i, b in enumerate(wb)]
        type_, containers = self.auto_pack(boxes, forced_type)
        tw = sum(b.weight_kg for b in boxes)
        tv = sum(vol3(b.dims_mm) for b in boxes) / 1e9
        used_v = sum(c["used_volume_m3"] for c in containers)
        return {
            "type": type_, "containers": containers, "boxes": boxes, "unmatched": unmatched,
            "oversized": oversized, "n_items": len(items), "total_weight": tw, "total_cbm": tv,
            "rate": used_v / (self.c_vol(type_) * len(containers)) * 100 if containers else 0,
        }
