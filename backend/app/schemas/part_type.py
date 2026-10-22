"""부품마스터 조회 스키마 - 명세서 API 상세 No.21 참고"""

from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class PartTypeResponse(BaseModel):
    """부품마스터 검색 결과 1건"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    part_no: str
    name: str
    engine_model: Optional[str] = None
    net_weight_kg: Optional[float] = None
    gross_weight_kg: Optional[float] = None
    raw_length_mm: Optional[float] = None
    raw_width_mm: Optional[float] = None
    raw_height_mm: Optional[float] = None
    confidence_level: Optional[str] = None
    packaging_category: Optional[str] = None
    packaging_length_mm: Optional[float] = None
    packaging_width_mm: Optional[float] = None
    packaging_height_mm: Optional[float] = None
    cushioning_material: Optional[str] = None


class PartTypeSearchResponse(BaseModel):
    """GET /part-types 응답. 53,271건이라 검색+페이지 단위로 자른다."""
    items: List[PartTypeResponse]
    total: int
    page: int
    size: int
