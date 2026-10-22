# LoadSim 프론트엔드 (React + Vite)

첫 화면에서 **오더 엑셀 첨부** 또는 **부품 직접 첨부**으로 부품을 입력하고, 시뮬레이션에 등록하는 단계까지 구현되어 있습니다.

## 실행

```bash
npm install
npm run dev          # http://localhost:5173  (/api/* 는 127.0.0.1:8000 FastAPI로 프록시)
```

- 백엔드 주소가 다르면: `VITE_BACKEND_URL=http://호스트:포트 npm run dev`
- 백엔드 없이 화면만 보려면 터미널을 하나 더 열어 `npm run mock` (부품 8종짜리 가짜 서버)
- 빌드: `npm run build` → `dist/` (정적 파일)

## 호출하는 API (적재시뮬레이터_API명세서 기준)

| 용도 | 호출 |
|---|---|
| 부품 검색 | `GET /part-types?search=&page=&size=` |
| 시뮬레이션 생성 | `POST /simulations` `{name}` |
| 직접 담기 등록 | `POST /simulations/{id}/parts` `{part_id, quantity}` — **부품 1건씩** 순서대로 호출 |
| 엑셀 등록 | `POST /simulations/{id}/parts/bulk-upload` (multipart, `file`) |
| 등록 확인 | `GET /simulations/{id}/parts` |

응답은 `{success,data,error}` 래퍼든 평문 JSON이든 `src/api.js`가 모두 처리하고,
필드명(snake/camel)이 달라도 `normalizePart()`에서 맞춥니다. 백엔드 응답이 다르면 이 파일만 고치면 됩니다.

## 실제 백엔드(loadsim-backend)와의 호환

프로젝트에 올라온 `loadsim-backend`의 `part_types.py`, `simulations.py`, 스키마, `models.py`를 그대로 실행해
아래를 확인했습니다. (테스트 엑셀 3종 업로드, 직접 담기, 등록 중 실패 후 이어서 등록)

- 백엔드 DB는 `loadsim-backend/data/loadsim.db` 입니다. 첨부해 주신 `loadsim.db`를 이 위치에 두면 부품 5만여 건이 바로 검색됩니다.
- 엑셀 품번은 DB의 `part_no`와 **정확히 일치**해야 등록됩니다. (공백·점·하이픈 차이도 다른 품번으로 취급)
- 부품 등록은 줄 단위로 쌓입니다. 같은 부품을 두 번 등록하면 두 줄이 생깁니다.

## 구조

```
src/App.jsx                  화면 전환 (start → excel | search → registered)
src/api.js                   백엔드 호출 + 응답 정규화
src/excel.js                 엑셀 미리보기 파싱 (B열 품번, C열 수량, 1행 헤더)
src/components/StartScreen   첫 화면 (선택지 2개)
src/components/ExcelImport   파일 첨부, 미리보기, 등록
src/components/PartSearch    검색(300ms 디바운스), 수량 입력, 담은 부품 목록
src/components/Registered    등록 결과 (건너뛴 행 포함)
```

## 적재 시뮬레이션 실행/결과 (추가)

등록 완료 화면의 **적재 시뮬레이션 실행**을 누르면 1→4단계(`package-parts/result` → `bundle-parts` → `pack-parts` → `run`)를 순서대로 호출하고,
`/containers`, `/visualization`을 조회해 추천 컨테이너, 종류별 비교, 컨테이너별 3D 배치도(Three.js), 단계별 상세, 제외된 부품 경고를 보여줍니다.

## 오더 관리 (적재 오더 확인)

- 오더 = 백엔드의 시뮬레이션 1건(이름 = 오더 이름, 엑셀은 파일 이름이 기본값). 부품 입력이 끝나면 '적재 오더 확인'으로 이동해 새 오더가 체크된 상태로 보입니다.
- 선택한 오더의 부품을 품번별로 합산해 `[적재] 오더A + 오더B` 이름의 실행용 시뮬레이션을 새로 만들고, 그것으로 1~4단계를 실행합니다. `[적재]`로 시작하는 시뮬레이션은 오더 목록에 나오지 않습니다.
- 오더 삭제는 `DELETE /simulations/{id}`를 호출합니다. 백엔드에 이 API가 없으면(405) 이 브라우저에서만 숨김 처리합니다.
  백엔드 `app/routers/simulations.py` 맨 아래에 추가하세요(부품은 cascade로 함께 삭제됨):

```python
@router.delete("/{simulation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_simulation(simulation_id: str, db: Session = Depends(get_db)):
    simulation = _get_simulation_or_404(simulation_id, db)
    db.delete(simulation)
    db.commit()
```
