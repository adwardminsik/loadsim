"""
마스터 데이터 시딩 스크립트.

우든박스카탈로그(32종)와 컨테이너 규격(3종)은 자주 바뀌지 않는 데이터라
API로 등록하지 않고 이 스크립트로 한 번에 넣는다.

실행 (프로젝트 루트에서):
    python -m app.scripts.seed_master_data
"""

from app.database import Base, engine, SessionLocal
from app.models import BoxType, Container

BOX_TYPES = [
    ("31-2342", 1870, 1670, 1100, 3.435, 4, True),
    ("31-2177", 1400, 1400, 1400, 2.744, 6, True),
    ("31-2121", 2200, 1100, 1100, 2.662, 157, True),
    ("31-2032", 1420, 1050, 1780, 2.654, 3, True),
    ("31-2043", 1670, 1170, 1345, 2.628, 10, True),
    ("31-2408", 2270, 1170, 980, 2.603, 6, True),
    ("31-2399", 3900, 870, 760, 2.579, 5, True),
    ("31-2315", 1520, 1520, 1100, 2.541, 4, True),
    ("31-1374", 2470, 970, 1050, 2.516, 38, True),
    ("31-1859", 1600, 1300, 1200, 2.496, 10, True),
    ("31-4189", 1500, 1050, 1550, 2.441, 9, True),
    ("31-2334", 1710, 1570, 870, 2.336, 7, True),
    ("31-2201", 3300, 1100, 600, 2.178, 3, True),
    ("31-2023", 1370, 1170, 1340, 2.148, 5, True),
    ("31-2026", 1420, 1070, 1080, 1.641, 3, True),
    ("31-2017", 1220, 1220, 1070, 1.593, 24, True),
    ("31-2009", 2240, 1240, 530, 1.534, 4, True),
    ("31-4057", 2500, 1200, 500, 1.5, 4, True),
    ("31-2407", 1100, 1220, 1100, 1.476, 18, True),
    ("31-1676", 1350, 1050, 1030, 1.46, 53, True),
    ("31-1303", 2850, 600, 800, 1.368, 3, True),
    ("31-2122", 1100, 1100, 1100, 1.331, 23, True),
    ("31-2033", 1590, 1300, 540, 1.116, 20, True),
    ("31-2306", 1230, 1230, 710, 1.072, 20, True),
    ("31-2011", 1170, 1170, 740, 1.013, 12, True),
    ("31-2123", 1070, 770, 1020, 0.84, 5, False),
    ("31-2406", 1020, 920, 820, 0.769, 4, False),
    ("31-2010", 1020, 1020, 570, 0.593, 10, False),
    ("31-1752", 750, 600, 800, 0.36, 3, False),
    ("31-1821", 750, 650, 720, 0.351, 5, False),
    ("31-2164", 2540, 240, 340, 0.216, 3, False),
    ("31-2209", 530, 380, 440, 0.089, 13, False),
]

CONTAINERS = [
    ("CONTAINER_20FT", "CONTAINER_20FT", 5950, 2340, 2250, 31.327, 28200),
    ("CONTAINER_40FT", "CONTAINER_40FT", 11960, 2320, 2250, 62.431, 26500),
    ("CONTAINER_40HC", "CONTAINER_40HC", 11960, 2320, 2550, 70.755, 28700),
]


def seed_box_types(db) -> int:
    count = 0
    for code, length, width, height, volume, freq, priority in BOX_TYPES:
        existing = db.get(BoxType, code)
        if existing:
            existing.length_mm = length
            existing.width_mm = width
            existing.height_mm = height
            existing.volume_m3 = volume
            existing.usage_frequency = freq
            existing.priority_use = priority
        else:
            db.add(BoxType(
                id=code, length_mm=length, width_mm=width, height_mm=height,
                volume_m3=volume, usage_frequency=freq, priority_use=priority,
            ))
        count += 1
    return count


def seed_containers(db) -> int:
    count = 0
    for cid, ctype, length, width, height, volume, max_weight in CONTAINERS:
        existing = db.get(Container, cid)
        if existing:
            existing.length_mm = length
            existing.width_mm = width
            existing.height_mm = height
            existing.volume_m3 = volume
            existing.max_weight_kg = max_weight
        else:
            db.add(Container(
                id=cid, type=ctype, length_mm=length, width_mm=width,
                height_mm=height, volume_m3=volume, max_weight_kg=max_weight,
            ))
        count += 1
    return count


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        box_count = seed_box_types(db)
        container_count = seed_containers(db)
        db.commit()
        print(f"박스마스터 시딩 완료: {box_count}종")
        print(f"컨테이너 시딩 완료: {container_count}종")

        true_count = sum(1 for b in BOX_TYPES if b[6])
        print(f"신규박스개설 우선사용(priority_use=True): {true_count}종 (기대값 25종)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
