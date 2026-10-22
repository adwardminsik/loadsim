"""
시뮬레이션 생성/조회 스키마.

[중요변경, 2026-10] 컨테이너 종류는 더 이상 생성 시 입력받지 않는다.
이름만 입력해서 시뮬레이션을 만들고, 부품을 등록한 뒤 4단계(run)를
실행하면 그때 20ft/40ft/40HC 중 최적 종류가 자동으로 결정된다.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class SimulationCreate(BaseModel):
    """POST /simulations 요청 본문 - 이름만 입력 (컨테이너 종류는 입력하지 않음)"""
    name: str


class SimulationResponse(BaseModel):
    """GET /simulations, GET /simulations/{id}, POST /simulations 응답"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    container_type: Optional[str] = None  # [변경] 4단계 실행 전까지는 None, 실행 후 추천값이 채워짐
    status: str
    run_count: int
    created_at: datetime
    updated_at: datetime
