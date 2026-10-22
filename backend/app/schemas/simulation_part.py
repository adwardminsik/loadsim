"""시뮬레이션에 등록되는 부품 스키마 - 명세서 API 상세 No.16, 26 참고"""

from typing import List

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.part_type import PartTypeResponse


class SimulationPartCreate(BaseModel):
    """POST /simulations/{id}/parts 요청 본문 - partId + quantity만 입력"""
    part_id: str = Field(..., description="부품마스터에 등록된 부품 ID (PartType.id)")
    quantity: int = Field(..., gt=0, description="수량")


class SimulationPartResponse(BaseModel):
    """등록된 부품 1건 - 치수/무게는 부품마스터에서 조인해서 함께 반환"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    part_id: str
    quantity: int
    part: PartTypeResponse


class BulkUploadRowError(BaseModel):
    """엑셀 일괄등록 중 실패한 행 1건"""
    row: int  # 엑셀 행 번호 (헤더 제외, 실제 엑셀 상의 행)
    part_no: str
    reason: str


class BulkUploadResult(BaseModel):
    """
    POST /simulations/{id}/parts/bulk-upload 응답.
    양식: A열=번호(참고용, 미사용) / B열=품번 / C열=수량, 1행은 헤더로 간주하고 2행부터 읽음.
    """
    total_rows: int
    added_count: int
    added: List[SimulationPartResponse]
    failed: List[BulkUploadRowError]
