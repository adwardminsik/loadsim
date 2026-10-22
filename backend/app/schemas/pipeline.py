"""
1~4단계 파이프라인 응답 스키마.

[2026-10, 알고리즘 교체] 팀원이 개발한 engine.py(실적 27건 기준 대수/종류
일치율 92.6%)를 이식하면서 스키마도 그에 맞춰 재설계했다. 기존(자체개발,
대수85%/종류30%) 스키마를 대체한다.

핵심 변경:
- 묶음(Bundle) 대신 '포장단위(Item)' 용어 사용 (엔진 원본 용어 유지)
- 3단계 결과는 '박스 1개 = 그 안에 담긴 품번들' 구조 (혼재 자연 반영)
- 4단계는 20ft 또는 40HC 중 하나를 결정적으로 고르는 엔진 로직을 따르되,
  비교를 위해 3종 전부의 시나리오도 같이 계산해서 반환한다
"""

from typing import Optional, List
from pydantic import BaseModel


# ── 1단계: 개별포장 (참고용 조회, 엔진 계산과는 별개) ──
class PackagedPartItem(BaseModel):
    part_id: str
    part_no: str
    quantity: int
    packaging_category: Optional[str] = None
    packaging_length_mm: Optional[float] = None
    packaging_width_mm: Optional[float] = None
    packaging_height_mm: Optional[float] = None
    cushioning_material: Optional[str] = None
    is_fallback_calculated: bool = False


class PackagePartsResult(BaseModel):
    packaged_parts: List[PackagedPartItem]


# ── 2단계: 포장단위 전개 (묶음) ──
class BundleItem(BaseModel):
    part_no: str          # 분할된 경우 "품번-1", "품번-2"...
    base_part_no: str      # 원래 품번
    desc: Optional[str] = None
    dims_mm: List[float]
    weight_kg: float
    bundle_qty: int        # 이 포장단위에 들어간 개수
    confidence: Optional[str] = None
    override_note: Optional[str] = None


class BundlePartsResult(BaseModel):
    items: List[BundleItem]
    unmatched: List[str]   # 부품마스터에 없는 품번


# ── 3단계: 우든박스 적재 (혼재 포함) ──
class PackedBoxPart(BaseModel):
    part_no: str
    desc: Optional[str] = None
    qty: int


class PackedBox(BaseModel):
    box_no: int
    box_code: str
    dims_mm: List[float]
    weight_kg: float
    fill_pct: float
    parts: List[PackedBoxPart]   # 이 박스 안에 들어간 품번들 (여러 종류 가능 = 혼재)


class PackPartsResult(BaseModel):
    boxes: List[PackedBox]
    oversized: List[str]   # 어떤 박스에도 안 들어간 품번(참고: 엔진 자체 치수가 과대한 경우)
    total_box_count: int


# ── 4단계: 컨테이너 적재 ──
class PlacementPart(BaseModel):
    part_no: str
    desc: Optional[str] = None
    qty: int


class Placement(BaseModel):
    box_type_id: str       # 박스 코드 (엔진의 box_code)
    position: List[float]
    dims_mm: List[float]
    parts: List[PlacementPart] = []   # [신규] 이 박스 안에 실제로 들어간 품번들 (혼재 가능)


class ContainerLoadResult(BaseModel):
    index: int
    placements: List[Placement]
    load_rate_pct: float
    loaded_volume_m3: float
    loaded_weight_kg: float


class ScenarioSummary(BaseModel):
    container_type: str
    container_count: int
    overall_load_rate_pct: float
    total_loaded_volume_m3: float
    total_loaded_weight_kg: float
    rank: int   # 1=엔진이 실제로 고르는 시나리오. 20ft가 용적/중량 임계치를
                # 만족하면 1순위=20ft, 아니면 1순위=40HC (40ft는 엔진 규칙상
                # 거의 선택되지 않음 - 실측 데이터상 40HC 선호 경향 반영)


class RunResult(BaseModel):
    status: str
    scenarios: List[ScenarioSummary]
    recommended_container_type: Optional[str] = None
    container_count: int
    containers: List[ContainerLoadResult]
    total_loaded_volume_m3: float
    total_loaded_weight_kg: float
    overall_load_rate_pct: float
    unmatched_parts: List[str] = []
    oversized_parts: List[str] = []
    note: Optional[str] = None
    failure_reason: Optional[str] = None


class VisualizationResponse(BaseModel):
    container: dict
    containers: List[ContainerLoadResult]
