"""
컨테이너 규격 조회 API.

명세서 'API 목록' No.1 GET /containers 에 대응.
"""

from typing import Optional, List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Container
from app.schemas.container import ContainerResponse

router = APIRouter(prefix="/containers", tags=["containers"])


@router.get("", response_model=List[ContainerResponse])
def list_containers(
    type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """컨테이너 규격 목록 조회. Query: type(선택) - CONTAINER_20FT 등으로 필터링"""
    query = db.query(Container)
    if type:
        query = query.filter(Container.type == type)
    return query.all()
