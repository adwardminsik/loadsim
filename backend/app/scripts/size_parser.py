"""
부품마스터 Size(mm) 필드 정규화 유틸리티.

원본 데이터는 자유텍스트라 구분자가 '*', 'X', 'x', '×'(곱셈기호)로
혼재되어 있고, 'Φ'(지름기호) 같은 부가기호가 붙는 경우도 있다.

축 개수별 처리 규칙 (명세서 확정):
- 3축 (74.6%): 그대로 (length, width, height)
- 2축 (25.4%, 대부분 지름×길이): 원통형으로 간주해 (지름, 지름, 길이)
- 1축 (0.03%, 지름만): 구형으로 간주해 (지름, 지름, 지름)
- 4축 이상 (0.01%, 6건): 자동 파싱 불가 - None 반환, 수작업 검토 대상
"""

import re
from typing import Optional, Tuple

_DELIMITER_PATTERN = re.compile(r"[*x×χ]", re.IGNORECASE)
_NUMBER_PATTERN = re.compile(r"\d+\.\d+|\d+")


def parse_size(raw: Optional[str]) -> Optional[Tuple[float, float, float]]:
    """Size(mm) 원본 텍스트를 (length, width, height) mm 튜플로 정규화한다."""
    if not raw:
        return None

    text = str(raw).upper().replace("Φ", "").replace(",", "").strip()
    if not text:
        return None

    tokens = [t.strip() for t in _DELIMITER_PATTERN.split(text) if t.strip() != ""]

    numeric_values = []
    for token in tokens:
        m = _NUMBER_PATTERN.search(token)
        if not m:
            return None
        numeric_values.append(float(m.group()))

    if len(numeric_values) == 3:
        length, width, height = numeric_values
        return (length, width, height)

    if len(numeric_values) == 2:
        diameter, length = numeric_values
        return (diameter, diameter, length)

    if len(numeric_values) == 1:
        d = numeric_values[0]
        return (d, d, d)

    return None


# ── 카테고리별 실측 비율 기반 치수 재추정 ──
#
# 부품마스터의 '신뢰도 하' 항목 중 상당수(4.53%, 2,412건)는 실측이 아니라
# '정육면체(1:1:1)로 가정'해서 역산된 값이다. 하지만 실제 검증해보면
# GASKET은 249:113:1, HOUSING은 23:19:1 처럼 카테고리마다 전혀 다른
# 비율을 갖는다. 그래서 '신뢰도 상'(실측) 데이터의 평균 비율을 카테고리별로
# 미리 계산해두고, 정육면체로 잘못 추정된 값을 같은 부피를 유지하면서
# 그 비율로 재배분한다.

CATEGORY_KEYWORDS = [
    "GASKET", "BOLT", "RING", "SPRING", "BLOCK", "HOUSING", "BRACKET",
    "VALVE", "SENSOR", "PUMP", "HOSE", "SCREW", "NUT", "WASHER",
]


def match_category(name):
    """품명에서 카테고리 키워드를 찾는다 (리스트 순서대로 첫 매칭)"""
    name_upper = (name or "").upper()
    for kw in CATEGORY_KEYWORDS:
        if kw in name_upper:
            return kw
    return None


def is_cube_placeholder(dims):
    """가로=세로=높이가 완전히 같으면 '정육면체 가정 추정치'로 간주"""
    if not dims:
        return False
    l, w, h = dims
    return l == w == h


def rescale_to_ratio(dims, ratio):
    """
    dims의 부피(= 무게/밀도 역산값, 신뢰할 수 있는 부분)는 그대로 유지하면서,
    ratio=(a,b,c) 비율로 가로/세로/높이를 재배분한다.
    """
    l, w, h = dims
    volume = l * w * h
    a, b, c = ratio
    if a <= 0 or b <= 0 or c <= 0 or volume <= 0:
        return dims
    k = (volume / (a * b * c)) ** (1 / 3)
    return (a * k, b * k, c * k)
