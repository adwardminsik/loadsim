"""
SQLAlchemy ORM 모델.

MVP 범위(명세서 'MVP범위' 시트, 핵심 15개 API)에 맞춰
- PartType (부품마스터, 53,271건 임포트 대상)
- BoxType (우든박스카탈로그, 32종 시드 대상)
- Simulation (시뮬레이션 1건)
- SimulationPart (시뮬레이션에 등록된 부품, partId+quantity)
만 관계형 테이블로 두고, 1~4단계(개별포장/묶음포장/박스적재/컨테이너적재)의
결과는 각 단계마다 별도 테이블을 만드는 대신 Simulation에 JSON 컬럼으로
저장합니다.

[중요변경, 2026-10] 컨테이너 종류는 더 이상 시뮬레이션 생성 시 입력받지
않습니다. 사용자는 부품만 입력하고, 4단계(run) 실행 시 20ft/40ft/40HC를
전부 시도해서 시스템이 자동으로 최적 종류+대수를 결정합니다.
Simulation.container_type은 이제 '입력값'이 아니라 '결과값'(4단계 실행
후 추천된 컨테이너 종류가 저장됨)이라 nullable로 바뀌었습니다.
"""

from sqlalchemy import (
    Column, String, Integer, Float, Boolean, ForeignKey, JSON, DateTime
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from app.database import Base


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class PartType(Base):
    """부품마스터 (Engine_parts_data_filled_v2.xlsx '치수Data' + 'Sheet2_포장박스예측' 조인 결과)"""
    __tablename__ = "part_types"

    id = Column(String, primary_key=True, default=lambda: _new_id("part"))
    part_no = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    engine_model = Column(String, nullable=True)
    net_weight_kg = Column(Float, nullable=True)
    gross_weight_kg = Column(Float, nullable=True)
    raw_length_mm = Column(Float, nullable=True)
    raw_width_mm = Column(Float, nullable=True)
    raw_height_mm = Column(Float, nullable=True)
    confidence_level = Column(String, nullable=True)
    evidence = Column(String, nullable=True)

    packaging_category = Column(String, nullable=True)
    packaging_length_mm = Column(Float, nullable=True)
    packaging_width_mm = Column(Float, nullable=True)
    packaging_height_mm = Column(Float, nullable=True)
    cushioning_material = Column(String, nullable=True)


class BoxType(Base):
    """우든박스카탈로그 (32종, 시드 스크립트로 등록)"""
    __tablename__ = "box_types"

    id = Column(String, primary_key=True)
    length_mm = Column(Float, nullable=False)
    width_mm = Column(Float, nullable=False)
    height_mm = Column(Float, nullable=False)
    volume_m3 = Column(Float, nullable=False)
    usage_frequency = Column(Integer, nullable=False, default=0)
    priority_use = Column(Boolean, nullable=False, default=False)


class Container(Base):
    """컨테이너 규격 (20ft/40ft/40HC, 고정값 3건 시드)"""
    __tablename__ = "containers"

    id = Column(String, primary_key=True)
    type = Column(String, nullable=False)
    length_mm = Column(Float, nullable=False)
    width_mm = Column(Float, nullable=False)
    height_mm = Column(Float, nullable=False)
    volume_m3 = Column(Float, nullable=False)
    max_weight_kg = Column(Float, nullable=False)


class Simulation(Base):
    """
    시뮬레이션 1건. 1~4단계 결과는 JSON 컬럼에 저장.

    [중요변경] container_type은 생성 시 입력값이 아니라, 4단계(run)
    실행 후 자동 결정된 추천 컨테이너 종류가 채워지는 결과값.
    생성 시점에는 None.
    """
    __tablename__ = "simulations"

    id = Column(String, primary_key=True, default=lambda: _new_id("sim"))
    name = Column(String, nullable=False)
    container_type = Column(String, nullable=True)  # [변경] nullable - 4단계 실행 후 채워짐
    status = Column(String, nullable=False, default="CREATED")

    package_parts_result = Column(JSON, nullable=True)
    bundle_parts_result = Column(JSON, nullable=True)
    pack_parts_result = Column(JSON, nullable=True)
    run_result = Column(JSON, nullable=True)
    failure_reason = Column(String, nullable=True)

    run_count = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))

    parts = relationship("SimulationPart", back_populates="simulation", cascade="all, delete-orphan")


class SimulationPart(Base):
    """시뮬레이션에 등록된 부품 (partId + quantity)"""
    __tablename__ = "simulation_parts"

    id = Column(String, primary_key=True, default=lambda: _new_id("simpart"))
    simulation_id = Column(String, ForeignKey("simulations.id"), nullable=False)
    part_id = Column(String, ForeignKey("part_types.id"), nullable=False)
    quantity = Column(Integer, nullable=False)

    simulation = relationship("Simulation", back_populates="parts")
    part = relationship("PartType")
