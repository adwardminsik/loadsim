"""
시뮬레이션 생성/조회 + 부품 등록/조회 API.

[중요변경, 2026-10] 시뮬레이션 생성 시 컨테이너 종류를 더 이상 입력받지
않는다. 이름만 입력해서 생성하고, 부품 등록 후 4단계(run)를 실행하면
그때 컨테이너 종류가 자동으로 결정된다.
"""

import io
from typing import List

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Simulation, PartType, SimulationPart
from app.schemas.simulation import SimulationCreate, SimulationResponse
from app.schemas.simulation_part import (
    SimulationPartCreate, SimulationPartResponse, BulkUploadResult, BulkUploadRowError,
)

router = APIRouter(prefix="/simulations", tags=["simulations"])


def _get_simulation_or_404(simulation_id: str, db: Session) -> Simulation:
    simulation = db.get(Simulation, simulation_id)
    if simulation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="시뮬레이션을 찾을 수 없습니다.",
        )
    return simulation


@router.post("", response_model=SimulationResponse, status_code=status.HTTP_201_CREATED)
def create_simulation(payload: SimulationCreate, db: Session = Depends(get_db)):
    """
    시뮬레이션 생성.

    [변경] 컨테이너 종류를 입력받지 않는다 - 이름만으로 생성한다.
    컨테이너 종류는 4단계(run) 실행 후 자동으로 결정되어 채워진다.
    """
    simulation = Simulation(
        name=payload.name,
        container_type=None,
        status="CREATED",
    )
    db.add(simulation)
    db.commit()
    db.refresh(simulation)
    return simulation


@router.get("", response_model=List[SimulationResponse])
def list_simulations(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    시뮬레이션 이력 목록 조회 (최신순).

    [신규] 쌓인 시뮬레이션들을 다시 볼 수 있도록 추가된 API -
    명세서 'MVP범위' 시트의 확장(2차) 항목이었으나, 이력이 계속
    쌓이길 원하는 요구로 당겨서 구현함.
    """
    return (
        db.query(Simulation)
        .order_by(Simulation.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/{simulation_id}", response_model=SimulationResponse)
def get_simulation(simulation_id: str, db: Session = Depends(get_db)):
    """시뮬레이션 단건 조회"""
    return _get_simulation_or_404(simulation_id, db)


@router.post(
    "/{simulation_id}/parts",
    response_model=SimulationPartResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_simulation_part(
    simulation_id: str, payload: SimulationPartCreate, db: Session = Depends(get_db)
):
    """시뮬레이션에 부품 등록. partId(부품마스터 참조) + quantity만 입력한다."""
    simulation = _get_simulation_or_404(simulation_id, db)

    part = db.get(PartType, payload.part_id)
    if part is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"등록되지 않은 부품입니다: {payload.part_id}",
        )

    sim_part = SimulationPart(
        simulation_id=simulation.id,
        part_id=payload.part_id,
        quantity=payload.quantity,
    )
    db.add(sim_part)
    db.commit()
    db.refresh(sim_part)
    return sim_part


@router.post("/{simulation_id}/parts/bulk-upload", response_model=BulkUploadResult)
async def bulk_upload_parts(
    simulation_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    엑셀로 부품 일괄 등록.

    양식 (현재 버전, 추후 확장 가능):
        A열: 번호 (참고용, 등록에는 안 쓰임)
        B열: 품번 (부품마스터와 정확히 일치해야 함)
        C열: 수량

    1행은 헤더로 간주하고 2행부터 데이터로 읽는다. 품번이 부품마스터에
    없거나 수량이 비어있/0 이하인 행은 등록하지 않고 failed 목록으로 반환한다
    - 일부 행이 실패해도 나머지 정상 행은 등록된다(부분 성공 허용).
    """
    simulation = _get_simulation_or_404(simulation_id, db)

    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="엑셀 파일(.xlsx)만 업로드할 수 있습니다.")

    contents = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
        ws = wb.active
    except Exception:
        raise HTTPException(status_code=400, detail="엑셀 파일을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해주세요.")

    added: List[SimulationPart] = []
    failed: List[BulkUploadRowError] = []
    total_rows = 0

    for excel_row_num, row in enumerate(ws.iter_rows(min_row=2, max_col=3, values_only=True), start=2):
        _no, part_no, quantity = (list(row) + [None, None, None])[:3]
        if part_no is None and quantity is None:
            continue  # 완전히 빈 행은 건너뜀 (카운트 안 함)
        total_rows += 1

        part_no_str = str(part_no).strip() if part_no is not None else ""
        if not part_no_str:
            failed.append(BulkUploadRowError(row=excel_row_num, part_no="", reason="품번(B열)이 비어있음"))
            continue

        try:
            qty = int(quantity)
        except (TypeError, ValueError):
            failed.append(BulkUploadRowError(row=excel_row_num, part_no=part_no_str, reason="수량(C열)이 숫자가 아님"))
            continue
        if qty <= 0:
            failed.append(BulkUploadRowError(row=excel_row_num, part_no=part_no_str, reason="수량(C열)은 1 이상이어야 함"))
            continue

        part = db.query(PartType).filter(PartType.part_no == part_no_str).first()
        if part is None:
            failed.append(BulkUploadRowError(row=excel_row_num, part_no=part_no_str, reason="부품마스터에 없는 품번"))
            continue

        sim_part = SimulationPart(simulation_id=simulation.id, part_id=part.id, quantity=qty)
        db.add(sim_part)
        added.append(sim_part)

    db.commit()
    for sp in added:
        db.refresh(sp)

    return BulkUploadResult(
        total_rows=total_rows,
        added_count=len(added),
        added=added,
        failed=failed,
    )


@router.get("/{simulation_id}/parts", response_model=List[SimulationPartResponse])
def list_simulation_parts(simulation_id: str, db: Session = Depends(get_db)):
    """시뮬레이션에 등록된 부품 목록 조회 - 부품마스터 정보 조인 포함"""
    _get_simulation_or_404(simulation_id, db)
    return (
        db.query(SimulationPart)
        .filter(SimulationPart.simulation_id == simulation_id)
        .all()
    )
