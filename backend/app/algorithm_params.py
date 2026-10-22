"""
알고리즘 전역 파라미터 및 오버라이드 규칙.

명세서 '알고리즘파라미터', '품번오버라이드', '카테고리오버라이드' 시트의
값을 그대로 코드 상수로 옮겨왔다. MVP 범위에서는 이 값들을 관리하는
API(GET/PUT /algorithm-parameters, 오버라이드 CRUD)를 만들지 않고
코드에 직접 두기로 했다(명세서 'MVP범위' 시트 참고) - 값이 바뀌면
이 파일만 고치면 된다.
"""

# ── 묶음포장(2단계) 파라미터 ──
TARGET_BUNDLE_WEIGHT_KG = 8.0
TARGET_BUNDLE_VOL_M3 = 0.03
MAX_BUNDLE_QTY = 100
PACKING_INEFFICIENCY = 1.3  # 묶음 내부 여유공간(포장재 포함) 반영 배율

# ── 부품마스터 무게 보정 (1단계) ──
WEIGHT_CALIBRATION_FACTOR = 1.27

# ── 우든박스 적재(3단계) 파라미터 ──
FILL_TARGET = 0.9
MAX_BOX_WEIGHT_KG = 700.0
NEW_BOX_CANDIDATE_MIN_VOL_M3 = 1.0
BOX_SELECTION_RANDOM_SEED = 42

# [2026-10 실측검증] 최소크기 결정적 선택 시, 순수 바운딩박스 치수 그대로
# 맞춰버리면(여유 0%) 실제보다 더 작은 박스를 고르는 경향이 확인됨(완충재/
# 보강재 여유 없이 너무 타이트하게 끼워맞춤). 실제 오더 27건(513박스) 중
# 단일품목 박스 29개 품번 분석 결과, 약 20% 여유를 줬을 때 실측 박스와
# 가장 근접(오차 3.9%) - 최소크기선택 시 치수에 이 마진을 추가로 곱한다.
BOX_FIT_MARGIN = 0.20

# ── 컨테이너 적재(4단계) 파라미터 ──
COMPACTION_MERGE_THRESHOLD = 0.9

# ── 개별포장(1단계) 폴백 마진 (부품마스터에 없는 신규 부품용) ──
PACKAGING_MARGIN_GENERAL = 0.15
PACKAGING_MARGIN_HEAVY = 0.08
PACKAGING_MARGIN_FRAGILE = 0.25
HEAVY_WEIGHT_THRESHOLD_KG = 15.0
FRAGILE_CATEGORY_KEYWORDS = ["GOVERNOR", "SENSOR", "VALVE", "PUMP,INJECTION"]


# ── 품번오버라이드 (품번 → 규칙) ──
PART_OVERRIDES = {
    "210101-00738A": {"ruleType": "NOT_BUNDLE", "assignedBoxTypeId": "31-2010"},
    "400508-00191": {"ruleType": "FIXED_BUNDLE", "fixedQty": 840, "assignedBoxTypeId": "31-2121"},
    "400504-00612": {"ruleType": "FIXED_BUNDLE", "fixedQty": 32, "assignedBoxTypeId": "31-2121"},
    "440211-00195": {"ruleType": "NOT_BUNDLE", "assignedBoxTypeId": "31-1374"},
}

# ── 카테고리오버라이드 (품명 키워드 → 규칙) ──
CATEGORY_OVERRIDES = [
    {"keyword": "RADIATOR ASSY", "ruleType": "NOT_BUNDLE_SMALLEST_FIT"},
]


def find_override(part_no: str, part_name: str) -> dict | None:
    """
    부품번호/부품명에 적용되는 오버라이드를 찾는다.
    우선순위: 품번오버라이드 > 카테고리오버라이드 > None(일반 알고리즘)
    """
    if part_no in PART_OVERRIDES:
        return {**PART_OVERRIDES[part_no], "source": "part_override"}

    name_upper = (part_name or "").upper()
    for rule in CATEGORY_OVERRIDES:
        if rule["keyword"] in name_upper:
            return {**rule, "source": "category_override"}

    return None
