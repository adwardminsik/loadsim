"""
박스 1개에 특정 크기의 물건이 몇 개나 들어가는지 계산하는 유틸리티.

6가지 회전 방향을 모두 시도해서(자유 회전 허용, 명세서 확정 사항)
가장 많이 들어가는 조합을 찾는다. 개별포장 단위를 우든박스에 넣을 때,
묶음(Bundle)을 우든박스에 넣을 때 공통으로 쓴다.
"""

from itertools import permutations


def items_per_container(
    item_dims: tuple[float, float, float],
    container_dims: tuple[float, float, float],
) -> int:
    """
    item_dims 크기의 물건이 container_dims 크기의 공간에 최대 몇 개 들어가는지
    계산한다 (6방향 회전 모두 시도, floor 나눗셈 기반의 단순 격자 배치 근사치).
    """
    cl, cw, ch = container_dims
    best = 0
    for l, w, h in permutations(item_dims):
        if l <= 0 or w <= 0 or h <= 0:
            continue
        count = int(cl // l) * int(cw // w) * int(ch // h)
        if count > best:
            best = count
    return best


def items_per_box_with_weight_cap(
    item_dims: tuple[float, float, float],
    item_weight_kg: float,
    box_dims: tuple[float, float, float],
    max_box_weight_kg: float,
) -> int:
    """공간 기준 최대개수와 무게상한 기준 최대개수 중 더 작은 값을 반환한다."""
    by_space = items_per_container(item_dims, box_dims)
    if item_weight_kg and item_weight_kg > 0:
        by_weight = int(max_box_weight_kg // item_weight_kg)
    else:
        by_weight = by_space
    return max(0, min(by_space, by_weight))


def box_volume_m3(dims_mm: tuple[float, float, float]) -> float:
    l, w, h = dims_mm
    return (l * w * h) / 1_000_000_000.0
