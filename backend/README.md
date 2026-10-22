# 적재시뮬레이터 백엔드 (MVP) — 설치 가이드

엔진 AM 부품 사전 적재 시뮬레이터의 백엔드입니다.
로컬 프로그램(설치형) 방식 — **127.0.0.1에서만** 서비스하며, 로그인이 없고,
부품/오더 데이터가 외부로 나가지 않습니다.

> 이 문서는 새로 합류하는 백엔드 작업자를 위한 설치 가이드입니다.
> Windows 환경에서 실제로 겪었던 문제들을 모두 반영했으니, 설치 중 에러가 나면
> 먼저 아래 "자주 겪는 문제" 섹션을 확인하세요.

---

## 0. 포함된 것 / 포함되지 않은 것

| 항목 | 포함 여부 |
|---|---|
| 이 zip (소스코드 전체) | ✅ 포함됨 |
| `master_data/Engine_parts_data_filled_v2.xlsx` (부품마스터 원본, 회사 데이터) | ✅ **포함됨** (사내 전달용이라 같이 넣음) |
| `data/loadsim.db` (SQLite DB 파일) | ❌ 포함 안 됨 — 최초 실행 시 자동 생성, 이후 아래 2-5단계로 부품마스터를 임포트해야 함 |
| `.venv/` | ❌ 포함 안 됨 — 로컬에서 새로 생성 |

**주의**: `master_data/Engine_parts_data_filled_v2.xlsx`는 회사 부품 데이터입니다. 사내 인원끼리의
전달이라 이 zip에 포함했지만, **이 zip을 git에 올리거나 사외로 전달하지는 마세요**
(`.gitignore`에 `master_data/`를 추가해서 git 커밋에서 제외하는 것을 권장합니다).

---

## 1. 사전 준비물

- **Python 3.11 ~ 3.13** (3.14는 아직 pandas 등 일부 패키지와 호환 문제가 있었음 — 3.13 권장)
- Windows라면 PowerShell 또는 cmd (둘 다 가능, 아래 트러블슈팅 참고)
- 인터넷 연결 (pip install 시 1회 필요, 설치 후에는 오프라인으로도 동작)

Python 버전 확인:
```bash
python --version
```
`3.14.x`가 나오면 3.13을 따로 설치해서 사용하세요 (아래 트러블슈팅 참고).

---

## 2. 설치 순서

### 2-1. 압축 해제
zip을 통째로 원하는 폴더에 풀어주세요. **"파일 선택해서 추출" 대신 "모두 추출"을 사용**하세요 —
개별 선택 추출 시 `scripts/`, `routers/`, `requirements.txt` 등 서브폴더/파일이 누락되는
경우가 실제로 있었습니다. 압축 해제 후 아래 구조가 전부 보이는지 확인:

```
loadsim-backend/
  app/
    main.py, database.py, models.py, algorithm_params.py, sim_engine.py, services_packing.py
    schemas/  (5개 파일 + __init__.py)
    routers/  (4개 파일 + __init__.py)
    scripts/  (3개 파일 + __init__.py)
  requirements.txt
  README.md
```

### 2-2. 가상환경 생성 및 활성화

```bash
cd loadsim-backend
python -m venv .venv
```

**Windows (PowerShell)**:
```powershell
.venv\Scripts\Activate.ps1
```
위 명령이 "실행할 수 없습니다"(실행 정책 오류)로 막히면:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
실행 후 다시 Activate.ps1을 실행하세요. (또는 cmd를 쓰면 이 문제 자체가 없음: `.venv\Scripts\activate.bat`)

**macOS/Linux**:
```bash
source .venv/bin/activate
```

활성화되면 터미널 앞에 `(.venv)`가 붙습니다. **이후 모든 명령은 이 가상환경이 활성화된 상태에서
실행**해야 합니다 — 새 터미널을 열 때마다 다시 activate 필요.

### 2-3. 패키지 설치

```bash
pip install -r requirements.txt
```

### 2-4. 서버 실행

```bash
python -m app.main
```

정상 실행되면 `http://127.0.0.1:8000/health` 접속 시 `{"status":"ok",...}` 응답.
API 문서(Swagger)는 `http://127.0.0.1:8000/docs`에서 확인 가능합니다.

### 2-5. 초기 데이터 적재 (최초 1회, 서버는 꺼진 상태에서)

부품마스터 원본은 이 zip의 `master_data/Engine_parts_data_filled_v2.xlsx`에 이미 들어있습니다.

```bash
python -m app.scripts.seed_master_data
python -m app.scripts.import_part_master "master_data/Engine_parts_data_filled_v2.xlsx"
```

- `seed_master_data`: 우든박스 32종 + 컨테이너 3종(20ft/40ft/40HC) 시딩
- `import_part_master`: 부품마스터(약 53,000행) 임포트 — 중복 품번 안전 제거, 치수 보정 포함.
  경로에 공백이 있으면 반드시 `"큰따옴표"`로 감싸세요.
  (경로를 옮겼다면 `master_data/` 대신 실제 경로를 넣으면 됩니다.)

이 두 스크립트는 `data/loadsim.db`를 생성/갱신합니다. 이후 서버(`python -m app.main`)를
다시 실행하면 바로 사용 가능합니다.

---

## 3. [2026-10 변경사항] 프론트엔드 연동 시 꼭 알아야 할 것

### 3-1. 컨테이너 자동선택 (가장 큰 변경)
이전 버전까지는 시뮬레이션을 만들 때 컨테이너 종류(20ft/40ft/40HC)를 직접 골라야 했지만,
이제는 **부품만 등록하면 4단계(run) 실행 시 세 가지를 전부 시도해서 최적 종류+대수를
자동으로 추천**합니다.

- `POST /simulations` 요청 본문에서 `container_type` 삭제됨 (이름만 입력)
- `POST /simulations/{id}/run` 응답에 `scenarios`(3종 비교표), `recommended_container_type`
  필드가 새로 생김
- 추천 기준: "필요 대수 최소화 우선, 동률이면 평균 적재율 최대" (임시 구현,
  실측 데이터로 추가 검증 중)

### 3-2. 박스 클릭 시 내용물 표시
3D 뷰어에서 박스를 클릭하면 그 안에 어떤 품번이 몇 개씩 들어있는지 보여주기 위해,
`Placement` 응답에 `parts` 필드가 추가됨 (박스 하나에 여러 품번이 혼재될 수 있음):
```json
{ "box_type_id": "31-2011", "position": [...], "dims_mm": [...],
  "parts": [ { "part_no": "ABC123", "desc": "...", "qty": 4 } ] }
```
자세한 지시사항은 `프론트엔드_지시사항_박스클릭.md` 참고.

### 3-3. 컨테이너 밖 적재 버그 수정
부품 수가 많을 때 컨테이너를 합치는 과정(compaction)에서 위치를 못 찾은 박스가
컨테이너 밖으로 튀어나오듯 보이는 문제가 있었음 — 서브셋 재시도 + 컨테이너 범위 내
격자 배치(fallback)로 수정되어, 이제 모든 박스가 항상 컨테이너 범위 안에 배치됨.

전체 변경 내역은 `프론트엔드_반영필요사항_2026-10.md` 참고.

---

## 4. 자주 겪는 문제 (Windows 기준, 전부 실제로 겪었던 문제)

### "ModuleNotFoundError: No module named 'sqlalchemy'" (또는 fastapi 등)
→ 가상환경이 활성화되지 않은 상태에서 실행한 것입니다. 터미널 앞에 `(.venv)`가
있는지 확인하고, 없으면 2-2 단계를 다시 수행하세요. 새 터미널 창을 열면 매번
다시 activate해야 합니다.

### PowerShell에서 venv 활성화가 "스크립트 실행 불가"로 막힘
→ 위 2-2 단계의 `Set-ExecutionPolicy` 명령 참고. 또는 cmd 사용.

### `python`/`pip` 명령이 새 터미널에서 "찾을 수 없음"
→ Python/Node PATH가 세션에 영구 등록되지 않은 경우입니다. 임시 해결:
```powershell
$env:PATH = "C:\Path\To\Python;" + $env:PATH
```
영구 해결: 시스템 환경 변수(제어판 → 시스템 → 고급 시스템 설정 → 환경 변수)에
Python/Node 설치 경로를 직접 추가.

### zip 압축 해제 후 일부 폴더(scripts, routers 등)가 안 보임
→ "선택 항목 추출"이 아니라 "모두 추출"을 사용하세요. 안 되면 이 zip을 다시
받아서 재시도하세요.

### 서버는 켜지는데 API가 500 에러를 냄 (스키마 변경 이후)
→ DB 스키마가 이전 버전 그대로 남아있는 경우입니다. **서버를 끄고** `data/loadsim.db`
파일을 삭제한 뒤, 2-5 단계(seed + import)를 다시 실행하세요. 기존 시뮬레이션
이력은 사라지므로, 테스트는 항상 새로 만든 시뮬레이션으로 하세요 — 예전 시뮬레이션을
불러와서 테스트하면 스키마가 안 맞아 에러가 날 수 있습니다.

### CORS 에러 / 프론트에서 연결이 안 됨
→ 백엔드가 여러 개 중복 실행 중일 수 있습니다. 모든 python 프로세스를 종료하고
서버를 하나만 다시 실행하세요. (`main.py`의 CORS는 `127.0.0.1`/`localhost`의
모든 포트를 허용하도록 이미 설정되어 있습니다.)

### 부품마스터 임포트 시 경로 에러
→ 경로에 공백이 있으면 반드시 큰따옴표로 감싸세요: `python -m app.scripts.import_part_master "master_data/Engine_parts_data_filled_v2.xlsx"`

---

## 5. 폴더 구조

```
app/
  main.py              FastAPI 앱 진입점, /health, CORS 설정
  database.py          SQLite 연결 (DATABASE_URL 환경변수로 교체 가능하게 추상화)
  models.py            SQLAlchemy ORM 모델 (PartType, BoxType, Container, Simulation, SimulationPart)
  algorithm_params.py  1단계(개별포장 참고용) 전역 파라미터 + 품번/카테고리 오버라이드
  sim_engine.py        [핵심] 적재 알고리즘 엔진 — 묶음포장/우든박스적재/컨테이너적재/자동선택
  services_packing.py  박스 피팅 계산 유틸 (레거시, 일부 참고용으로 남겨둠)
  schemas/             Pydantic 요청/응답 스키마
    container.py, part_type.py, pipeline.py, simulation.py, simulation_part.py
  routers/
    containers.py      GET /containers
    simulations.py     시뮬레이션 생성/조회/이력, 부품 등록/조회, 엑셀 일괄 업로드
    part_types.py       부품마스터 검색
    pipeline.py         1~4단계 파이프라인 (4단계: 컨테이너 자동선택 + 3D 배치 좌표)
  scripts/
    size_parser.py            치수 텍스트 정규화 + 카테고리 비율 재추정
    import_part_master.py     부품마스터 임포트 (중복제거/치수보정 포함)
    seed_master_data.py       박스마스터 32종 + 컨테이너 3종 시딩
master_data/
  Engine_parts_data_filled_v2.xlsx  부품마스터 원본 (회사 데이터 — git 커밋/사외 전달 금지)
data/
  loadsim.db            SQLite DB 파일 (최초 실행 시 자동 생성 — zip에는 없음)
```

## 6. 핵심 알고리즘 참고

`sim_engine.py`는 5단계 파이프라인 중 2~5단계(묶음포장 → 우든박스적재 → 컨테이너적재 →
자동선택)를 담당합니다. 팀원이 작성한 Extreme-Point 3D 배치 알고리즘을 포팅한 것으로,
외부 3D 빈패킹 라이브러리 의존성이 없습니다(순수 Python).

- `Engine.expand_order()`: 품번+수량 → 개별 Item 리스트
- `Engine.pack_wooden()`: Item들을 우든박스에 담음 (품번 혼재 가능, 열려있는 박스부터 탐색)
- `Engine.pick_container_type()`: 부피/무게 기준으로 20ft 또는 40HC 선택
- `Engine.pack_containers()` / `auto_pack()`: 실제 3D 배치 + 컨테이너 대수 산출
- `pack_container_ep()`: Extreme-Point 휴리스틱 배치 (핵심 로직)

**알려진 한계**: 팀원의 원본 엔진에는 과거 실적을 학습해 박스 선택 정확도를 높이는
`learn_rules`(실적 학습) 기능이 있었는데, 아직 포팅하지 않았습니다. 현재 정확도는
박스 종류 일치 85% / 대수 일치 80% 수준이며, 원본은 92.6%/92.6%로 보고되어 있어
이 기능을 포팅하면 추가 개선 여지가 있습니다. 실측 PDF 인보이스에서 추출한
검증 데이터(`적재시뮬레이터_API명세서.xlsx`의 `실측검증이력` 시트, 27건)를
학습 입력(cases)으로 쓸 수 있을 것으로 보입니다.

## 7. 관련 문서

같이 전달된 아래 문서들도 참고하세요:
- `적재시뮬레이터_API명세서.xlsx` — 전체 API 명세, 데이터 모델, 알고리즘 파라미터,
  실측 검증 이력
- `프론트엔드_반영필요사항_2026-10.md` — 프론트엔드가 반영해야 할 스키마 변경사항
- `프론트엔드_지시사항_박스클릭.md` — 박스 클릭 기능 상세 스펙
