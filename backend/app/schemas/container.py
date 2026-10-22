"""요청/응답 Pydantic 스키마. API 상세 명세서 시트의 필드 정의를 그대로 따른다."""

from pydantic import BaseModel, ConfigDict


class ContainerResponse(BaseModel):
    """GET /containers 응답 항목 - 명세서 'API 상세' 시트 참고"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    length_mm: float
    width_mm: float
    height_mm: float
    volume_m3: float
    max_weight_kg: float
