"""
1~4단계 파이프라인 API.

명세서 'API 목록' No.38(1단계), 28/29(2단계), 18/19(3단계), 7·8·9(4단계+결과+시각화) 에 대응.

[2026-10, 알고리즘 교체] 2~4단계는 팀원이 개발한 app/sim_engine.py(실적
27건 기준 대수/종류 일치율 92.6%)로 교체됨. 기존 자체구현(py3dbp 기반,
대수85%/종류30%)은 폐기 - py3dbp 의존성도 더 이상 필요 없음(순수 파이썬
3D Extreme-Point 알고리즘으로 대체).

1단계(개별포장조회)는 부품마스터 조인 조회만 하는 독립 기능이라 그대로 둠.
"""

import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Simulation, SimulationPart, PartType
from app import algorithm_params as params
from app import sim_engine
from app.schemas.pipeline import (
    PackagePartsResult, PackagedPartItem,
    BundlePartsResult, BundleItem,
    PackPartsResult, PackedBox, PackedBoxPart,
    RunResult, Placement, PlacementPart, ContainerLoadResult, ScenarioSummary,
    VisualizationResponse,
)

router = APIRouter(prefix="/simulations", tags=["pipeline"])

# [2026-10 추가] 실적 학습(learn_rules) 결과 반영.
# 27개 오더 513건 + 신규 3건(EPX2026080018/EPX2026010036/EPX2025090020) 38건 =
# 551건 실측 박스 데이터로 학습한 규칙(70개 품번). 기존에는 Engine(learned=None)으로
# 항상 공식(묶음목표무게/부피) 추정만 쓰고 있었는데, 이 학습 규칙을 적용해 실측이
# 있는 품번은 그 실측 박스를 우선 사용하도록 변경.
_LEARNED_RULES_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "learned_rules.json")
try:
    with open(_LEARNED_RULES_PATH, "r", encoding="utf-8") as _f:
        LEARNED_RULES = json.load(_f)
except FileNotFoundError:
    LEARNED_RULES = {}

ENGINE_TYPE_TO_DB = {"20ft": "CONTAINER_20FT", "40ft": "CONTAINER_40FT", "40HC": "CONTAINER_40HC"}
DB_TYPE_TO_ENGINE = {v: k for k, v in ENGINE_TYPE_TO_DB.items()}


def _get_simulation_or_404(simulation_id: str, db: Session) -> Simulation:
    simulation = db.get(Simulation, simulation_id)
    if simulation is None:
        raise HTTPException(status_code=404, detail="시뮬레이션을 찾을 수 없습니다.")
    return simulation


# ============================================================
# 1단계: 개별포장 조회 (참고용 조회, 엔진 계산과는 별개 경로)
# ============================================================

def _packaging_is_plausible(part: PartType) -> bool:
    """[2026-10 추가] 포장치수예측(Sheet2) 데이터 중 실제 치수보다 작은(=포장이 부품보다
    작아 물리적으로 불가능한) 값을 걸러낸다. 실측 검증 중 엔진/라디에이터/머플러 등
    대형 부품 2,461건이 102.6×102.6×102.6mm 플레이스홀더로 잘못 들어와 있는 것을 확인함
    (예: 440211-00457B RADIATOR ASSY, 실제 1700×1500×820mm → 예측치 102.6mm 큐브).
    포장 부피가 원본(raw) 부피보다 작으면 예측치를 신뢰하지 않고 raw_dims+여유율 보정으로 대체한다."""
    raw_l = part.raw_length_mm or 0
    raw_w = part.raw_width_mm or 0
    raw_h = part.raw_height_mm or 0
    raw_vol = raw_l * raw_w * raw_h
    if raw_vol <= 0:
        return True  # raw 치수 자체가 없으면 비교 불가 - 예측치를 그대로 사용
    pkg_vol = (part.packaging_length_mm or 0) * (part.packaging_width_mm or 0) * (part.packaging_height_mm or 0)
    return pkg_vol >= raw_vol


def _resolve_packaging(part: PartType) -> tuple[dict, bool]:
    if (part.packaging_length_mm and part.packaging_width_mm and part.packaging_height_mm
            and _packaging_is_plausible(part)):
        return {
            "category": part.packaging_category,
            "length": part.packaging_length_mm,
            "width": part.packaging_width_mm,
            "height": part.packaging_height_mm,
            "cushioning": part.cushioning_material,
        }, False

    raw_l = part.raw_length_mm or 0
    raw_w = part.raw_width_mm or 0
    raw_h = part.raw_height_mm or 0
    weight = part.net_weight_kg or 0
    name_upper = (part.name or "").upper()

    if weight >= params.HEAVY_WEIGHT_THRESHOLD_KG:
        category, margin, cushioning = "중량물", params.PACKAGING_MARGIN_HEAVY, "목재 팔레트/각재 프레임 + 하단 고무패드"
    elif any(k in name_upper for k in params.FRAGILE_CATEGORY_KEYWORDS):
        category, margin, cushioning = "정밀/파손주의", params.PACKAGING_MARGIN_FRAGILE, "스티로폼 전체 감싸기 + 모서리 보강"
    else:
        category, margin, cushioning = "일반", params.PACKAGING_MARGIN_GENERAL, "뽁뽁이 + 표준 골판지 박스"

    return {
        "category": category,
        "length": raw_l * (1 + margin),
        "width": raw_w * (1 + margin),
        "height": raw_h * (1 + margin),
        "cushioning": cushioning,
    }, True


@router.get("/{simulation_id}/package-parts/result", response_model=PackagePartsResult)
def get_package_parts_result(simulation_id: str, db: Session = Depends(get_db)):
    """1단계: 등록된 부품들의 개별포장 정보 조회 (부품마스터 조인, 실행 불필요)"""
    _get_simulation_or_404(simulation_id, db)
    sim_parts = (
        db.query(SimulationPart)
        .filter(SimulationPart.simulation_id == simulation_id)
        .all()
    )

    items = []
    for sp in sim_parts:
        pack_info, is_fallback = _resolve_packaging(sp.part)
        items.append(PackagedPartItem(
            part_id=sp.part_id,
            part_no=sp.part.part_no,
            quantity=sp.quantity,
            packaging_category=pack_info["category"],
            packaging_length_mm=pack_info["length"],
            packaging_width_mm=pack_info["width"],
            packaging_height_mm=pack_info["height"],
            cushioning_material=pack_info["cushioning"],
            is_fallback_calculated=is_fallback,
        ))
    return PackagePartsResult(packaged_parts=items)


# ============================================================
# 공통: DB -> 엔진 입력 변환
# ============================================================

def _build_master_and_qty(db: Session, simulation_id: str):
    """시뮬레이션에 등록된 부품들을 엔진이 요구하는 (master dict, part_qty list) 로 변환"""
    sim_parts = (
        db.query(SimulationPart)
        .filter(SimulationPart.simulation_id == simulation_id)
        .all()
    )
    master = {}
    part_qty = []
    for sp in sim_parts:
        part = sp.part
        key = part.part_no.replace(" ", "")
        pack_info, _ = _resolve_packaging(part)
        dims = [pack_info["length"], pack_info["width"], pack_info["height"]]
        master[key] = sim_engine.Part(dims, part.net_weight_kg or 0, part.confidence_level, part.name)
        part_qty.append((key, sp.quantity))
    sim_engine.apply_corrections(master)
    return master, part_qty


def _item_to_raw(item) -> dict:
    return {
        "part_no": item.part_no, "base_part_no": item.base_part_no, "dims_mm": list(item.dims_mm),
        "weight_kg": item.weight_kg, "bundle_qty": item.bundle_qty, "desc": item.desc, "conf": item.conf,
        "box_code": item.box_code, "override": item.override,
    }


def _raw_to_item(d: dict):
    return sim_engine.Item(
        part_no=d["part_no"], base_part_no=d["base_part_no"], dims_mm=d["dims_mm"],
        weight_kg=d["weight_kg"], bundle_qty=d["bundle_qty"], override=d.get("override"),
        desc=d.get("desc"), conf=d.get("conf"), box_code=d.get("box_code"),
    )


# ============================================================
# 2단계: 포장단위 전개 (묶음)
# ============================================================

@router.post("/{simulation_id}/bundle-parts", response_model=BundlePartsResult)
def run_bundle_parts(simulation_id: str, db: Session = Depends(get_db)):
    """2단계 실행 - 엔진의 expand_order() 로 품번+수량을 포장단위로 전개"""
    simulation = _get_simulation_or_404(simulation_id, db)
    master, part_qty = _build_master_and_qty(db, simulation_id)
    if not part_qty:
        raise HTTPException(status_code=400, detail="등록된 부품이 없습니다. 먼저 부품을 등록해주세요.")

    engine = sim_engine.Engine(learned=LEARNED_RULES)
    items, unmatched = engine.expand_order(part_qty, master)

    # 내부 저장용(다음 단계에서 복원): 응답 스키마보다 풍부한 raw 데이터 보관
    simulation.bundle_parts_result = {
        "raw_items": [_item_to_raw(it) for it in items],
        "unmatched": unmatched,
    }
    simulation.status = "BUNDLED"
    db.commit()

    response_items = [
        BundleItem(
            part_no=it.part_no, base_part_no=it.base_part_no, desc=it.desc,
            dims_mm=list(it.dims_mm), weight_kg=round(it.weight_kg, 3), bundle_qty=it.bundle_qty,
            confidence=it.conf, override_note=(it.override or {}).get("note") if it.override else None,
        ) for it in items
    ]
    return BundlePartsResult(items=response_items, unmatched=unmatched)


@router.get("/{simulation_id}/bundle-parts/result", response_model=BundlePartsResult)
def get_bundle_parts_result(simulation_id: str, db: Session = Depends(get_db)):
    """2단계 결과 조회"""
    simulation = _get_simulation_or_404(simulation_id, db)
    if simulation.bundle_parts_result is None:
        raise HTTPException(status_code=404, detail="아직 2단계(묶음포장)를 실행하지 않았습니다.")
    raw = simulation.bundle_parts_result
    items = [
        BundleItem(
            part_no=d["part_no"], base_part_no=d["base_part_no"], desc=d.get("desc"),
            dims_mm=d["dims_mm"], weight_kg=round(d["weight_kg"], 3), bundle_qty=d["bundle_qty"],
            confidence=d.get("conf"), override_note=(d.get("override") or {}).get("note") if d.get("override") else None,
        ) for d in raw["raw_items"]
    ]
    return BundlePartsResult(items=items, unmatched=raw["unmatched"])


# ============================================================
# 3단계: 우든박스 적재 (혼재 포함)
# ============================================================

@router.post("/{simulation_id}/pack-parts", response_model=PackPartsResult)
def run_pack_parts(simulation_id: str, db: Session = Depends(get_db)):
    """3단계 실행 - 엔진의 pack_wooden() 으로 우든박스에 적재 (서로 다른 품번도 한 박스에 섞일 수 있음)"""
    simulation = _get_simulation_or_404(simulation_id, db)
    if simulation.bundle_parts_result is None:
        raise HTTPException(status_code=409, detail="먼저 2단계(묶음포장)를 실행해주세요.")

    items = [_raw_to_item(d) for d in simulation.bundle_parts_result["raw_items"]]
    engine = sim_engine.Engine(learned=LEARNED_RULES)
    wooden_boxes, oversized = engine.pack_wooden(items)

    raw_boxes = []
    for i, b in enumerate(wooden_boxes):
        part_counts = {}
        for it in b.items:
            key = it.base_part_no
            part_counts.setdefault(key, {"desc": it.desc, "qty": 0})
            part_counts[key]["qty"] += it.bundle_qty
        raw_boxes.append({
            "box_no": i + 1, "box_code": b.box_code, "dims_mm": list(b.dims_mm),
            "weight_kg": round(b.used_weight, 3),
            "fill_pct": round(b.used_volume / (sim_engine.vol3(b.dims_mm) / 1e9) * 100, 2) if sim_engine.vol3(b.dims_mm) else 0.0,
            "parts": [{"part_no": k, "desc": v["desc"], "qty": v["qty"]} for k, v in part_counts.items()],
            # [2026-10 추가] 4단계(컨테이너 적재)에서 "병합된 박스 재분할" 보강 로직이 쓸 수
            # 있도록, 위 parts 요약(품번+수량)과 별개로 품목별 실제 치수/중량까지 담은 원본을
            # 같이 저장해둔다. 이게 없으면 4단계는 요약 정보만 보고 재분할을 시도하다가
            # dims_mm/weight_kg가 없어서 조용히 실패(= 보강 효과 없음)하게 된다.
            "raw_items": [_item_to_raw(it) for it in b.items],
        })

    simulation.pack_parts_result = {
        "raw_boxes": raw_boxes,
        "oversized": list({it.base_part_no for it in oversized}),
    }
    simulation.status = "BOXED"
    db.commit()

    return PackPartsResult(
        boxes=[PackedBox(**{**rb, "parts": [PackedBoxPart(**p) for p in rb["parts"]]}) for rb in raw_boxes],
        oversized=simulation.pack_parts_result["oversized"],
        total_box_count=len(raw_boxes),
    )


@router.get("/{simulation_id}/pack-parts/result", response_model=PackPartsResult)
def get_pack_parts_result(simulation_id: str, db: Session = Depends(get_db)):
    """3단계 결과 조회"""
    simulation = _get_simulation_or_404(simulation_id, db)
    if simulation.pack_parts_result is None:
        raise HTTPException(status_code=404, detail="아직 3단계(박스적재)를 실행하지 않았습니다.")
    raw = simulation.pack_parts_result
    boxes = [PackedBox(**{**rb, "parts": [PackedBoxPart(**p) for p in rb["parts"]]}) for rb in raw["raw_boxes"]]
    return PackPartsResult(boxes=boxes, oversized=raw["oversized"], total_box_count=len(boxes))


# ============================================================
# 4단계: 컨테이너 적재
# ============================================================

def _bounded_fallback_positions(boxes, container_dims_mm):
    """
    [버그수정, 2026-10] approx(위치 미확정) 박스를 재배치 시도해도 끝까지 안 들어가는
    극소수를 위한 최후 수단. 기존엔 x축으로 끝없이 일렬로 이어붙여서 컨테이너 '밖으로'
    삐져나가는 문제가 있었음 - 이제는 선반(shelf) 쌓기 방식으로 컨테이너 가로/세로/높이
    범위 '안'에서만 움직이도록 강제한다 (이미 배치된 박스와 약간 겹쳐 보일 수는 있지만,
    최소한 컨테이너 밖으로 나가지는 않는다).
    """
    cl, cw, ch = container_dims_mm
    positions = []
    x = y = z = 0.0
    row_w = 0.0
    layer_h = 0.0
    for box in boxes:
        bl, bw, bh = box.dims_mm
        if x + bl > cl:
            x = 0.0
            y += row_w
            row_w = 0.0
        if y + bw > cw:
            y = 0.0
            z += layer_h
            layer_h = 0.0
        if z + bh > ch:
            z = 0.0  # 그래도 넘치면 바닥부터 다시 (겹침 감수, 컨테이너 밖으로는 안 나감)
        positions.append((x, y, z))
        x += bl
        row_w = max(row_w, bw)
        layer_h = max(layer_h, bh)
    return positions


def _raw_box_to_loadbox(d: dict, idx: int):
    # [수정] parts 정보도 같이 복원해서 4단계 결과(Placement)에 '이 박스 안의 부품'을 담을 수 있게 함
    box = sim_engine.LoadBox(idx + 1, d["box_code"], d["dims_mm"], d["weight_kg"], d["fill_pct"], d.get("parts", []))
    # [2026-10 추가] "병합된 박스 재분할" 보강 로직(_resplit_box)이 쓸 품목별 원본(치수/중량
    # 포함)을 .items와 별도의 속성에 둔다 - .items는 위에서 이미 화면표시용 parts 요약으로
    # 쓰고 있어서 덮어쓰면 안 됨. 원본이 없는 옛날 시뮬레이션 데이터일 수도 있으니 get으로 방어.
    raw_items = d.get("raw_items")
    if raw_items:
        try:
            box.raw_items = [sim_engine.Item(**ri) for ri in raw_items]
        except Exception:
            box.raw_items = None
    return box


def _containers_to_scenario(engine, containers, ctype: str) -> dict:
    total_vol = sum(c["used_volume_m3"] for c in containers)
    total_weight = sum(c["used_weight_kg"] for c in containers)
    count = len(containers)
    cvol = engine.c_vol(ctype)
    rate = round(total_vol / (count * cvol) * 100, 2) if count > 0 else 0.0
    return {"containers": containers, "count": count, "rate": rate,
            "total_vol": round(total_vol, 3), "total_weight": round(total_weight, 1)}


@router.post("/{simulation_id}/run", response_model=RunResult)
def run_container_loading(simulation_id: str, db: Session = Depends(get_db)):
    """
    4단계 실행 - 엔진의 auto_pack()으로 실제 추천 종류(20ft 또는 40HC)를 정하고,
    비교를 위해 나머지 종류(40ft 포함)의 시나리오도 같이 계산해서 반환한다.
    """
    simulation = _get_simulation_or_404(simulation_id, db)
    if simulation.pack_parts_result is None:
        raise HTTPException(status_code=409, detail="먼저 3단계(박스적재)를 실행해주세요.")

    raw_boxes = simulation.pack_parts_result["raw_boxes"]
    if not raw_boxes:
        result = RunResult(
            status="FAILED", scenarios=[], recommended_container_type=None,
            container_count=0, containers=[], total_loaded_volume_m3=0.0, total_loaded_weight_kg=0.0,
            overall_load_rate_pct=0.0, failure_reason="적재할 박스가 없습니다 (3단계 결과가 비어있음)",
        )
        simulation.run_result = result.model_dump()
        simulation.status = "FAILED"
        simulation.failure_reason = result.failure_reason
        simulation.run_count += 1
        db.commit()
        return result

    boxes = [_raw_box_to_loadbox(d, i) for i, d in enumerate(raw_boxes)]
    engine = sim_engine.Engine(learned=LEARNED_RULES)

    rec_type, rec_containers = engine.auto_pack(boxes)  # 엔진의 실제 추천 (20ft 또는 40HC)

    scenario_raw = {}
    for ctype in ("20ft", "40ft", "40HC"):
        containers = rec_containers if ctype == rec_type else engine.pack_containers(boxes, ctype)
        scenario_raw[ctype] = _containers_to_scenario(engine, containers, ctype)

    others = [t for t in scenario_raw if t != rec_type]
    others.sort(key=lambda t: (scenario_raw[t]["count"], -scenario_raw[t]["rate"]))
    rank_order = [rec_type] + others
    rank_by_type = {t: i + 1 for i, t in enumerate(rank_order)}

    scenarios = [
        ScenarioSummary(
            container_type=ENGINE_TYPE_TO_DB[t], container_count=d["count"],
            overall_load_rate_pct=d["rate"], total_loaded_volume_m3=d["total_vol"],
            total_loaded_weight_kg=d["total_weight"], rank=rank_by_type[t],
        ) for t, d in scenario_raw.items()
    ]
    scenarios.sort(key=lambda s: s.rank)

    best = scenario_raw[rec_type]
    containers_detail = []
    for i, c in enumerate(best["containers"]):
        def _box_parts(box) -> list:
            # box.items는 3단계에서 저장해둔 [{part_no,desc,qty}, ...] (혼재 가능)
            return [PlacementPart(**p) for p in (box.items or [])]

        placements = [
            Placement(box_type_id=box.code, position=list(pos), dims_mm=list(dims), parts=_box_parts(box))
            for pos, dims, box in c["placed"]
        ]
        # [버그수정] approx(compaction 과정에서 위치를 못 찾은 박스)는 이 박스들끼리만
        # 모아서 한 번 더 배치를 시도한다 - 전체를 합쳐서 시도했을 때는 실패했어도,
        # 이 서브셋만 따로 시도하면 대부분 정상적으로 들어갈 자리를 찾는다.
        approx_list = c.get("approx", [])
        if approx_list:
            cdims = sim_engine.CONTAINERS[rec_type]["dims"]
            sub_placed, sub_unplaced, _, _ = sim_engine.pack_container_ep(approx_list, cdims)
            for pos, dims, box in sub_placed:
                placements.append(Placement(
                    box_type_id=box.code, position=list(pos), dims_mm=list(dims), parts=_box_parts(box)
                ))
            if sub_unplaced:
                # 그래도 못 넣은 극소수만 컨테이너 범위 안에서 격자식으로 배치 (밖으로 안 나감)
                for box, pos in zip(sub_unplaced, _bounded_fallback_positions(sub_unplaced, cdims)):
                    placements.append(Placement(
                        box_type_id=box.code, position=list(pos), dims_mm=list(box.dims_mm), parts=_box_parts(box)
                    ))

        containers_detail.append(ContainerLoadResult(
            index=i + 1, placements=placements,
            load_rate_pct=c["volume_util_pct"], loaded_volume_m3=c["used_volume_m3"],
            loaded_weight_kg=c["used_weight_kg"],
        ))

    note = None
    if any(c.get("approx") for c in best["containers"]):
        note = "일부 박스는 컨테이너 병합(compaction) 과정에서 정확한 좌표 없이 근사 배치되었습니다 (합계 중량/부피는 반영됨)."

    result = RunResult(
        status="COMPLETED",
        scenarios=scenarios,
        recommended_container_type=ENGINE_TYPE_TO_DB[rec_type],
        container_count=best["count"],
        containers=containers_detail,
        total_loaded_volume_m3=best["total_vol"],
        total_loaded_weight_kg=best["total_weight"],
        overall_load_rate_pct=best["rate"],
        unmatched_parts=simulation.bundle_parts_result.get("unmatched", []) if simulation.bundle_parts_result else [],
        oversized_parts=simulation.pack_parts_result.get("oversized", []),
        note=note,
    )

    simulation.run_result = result.model_dump()
    simulation.container_type = ENGINE_TYPE_TO_DB[rec_type]
    simulation.status = "COMPLETED"
    simulation.run_count += 1
    db.commit()
    return result


@router.get("/{simulation_id}/result", response_model=RunResult)
def get_result(simulation_id: str, db: Session = Depends(get_db)):
    """4단계(최종) 결과 조회"""
    simulation = _get_simulation_or_404(simulation_id, db)
    if simulation.run_result is None:
        raise HTTPException(status_code=404, detail="아직 4단계(컨테이너적재)를 실행하지 않았습니다.")
    return simulation.run_result


@router.get("/{simulation_id}/visualization", response_model=VisualizationResponse)
def get_visualization(simulation_id: str, db: Session = Depends(get_db)):
    """3D 시각화 데이터 - 추천된 컨테이너 치수 + 대수별 박스 배치 목록"""
    simulation = _get_simulation_or_404(simulation_id, db)
    if simulation.run_result is None:
        raise HTTPException(status_code=404, detail="아직 4단계(컨테이너적재)를 실행하지 않았습니다.")

    engine_type = DB_TYPE_TO_ENGINE[simulation.container_type]
    cdims = sim_engine.CONTAINERS[engine_type]["dims"]
    run_result = RunResult(**simulation.run_result)

    return VisualizationResponse(
        container={
            "type": simulation.container_type,
            "length_mm": cdims[0], "width_mm": cdims[1], "height_mm": cdims[2],
        },
        containers=run_result.containers,
    )
