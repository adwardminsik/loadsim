"""
부품마스터 검색 API.

명세서 'API 목록' No.21 GET /part-types 에 대응.
53,271건이 등록되어 있어 전체 목록 조회는 지원하지 않고, 품번/품명
검색(부분일치) + 페이지네이션만 제공한다.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PartType
from app.schemas.part_type import PartTypeSearchResponse

router = APIRouter(prefix="/part-types", tags=["part-types"])


@router.get("", response_model=PartTypeSearchResponse)
def search_part_types(
    search: str = Query(..., min_length=1, description="품번 또는 품명 키워드 (부분일치, 필수)"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """품번 또는 품명으로 부품마스터를 검색한다."""
    like_pattern = f"%{search}%"
    query = db.query(PartType).filter(
        or_(
            PartType.part_no.ilike(like_pattern),
            PartType.name.ilike(like_pattern),
        )
    )

    total = query.count()
    items = (
        query.order_by(PartType.part_no)
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    return PartTypeSearchResponse(items=items, total=total, page=page, size=size)
