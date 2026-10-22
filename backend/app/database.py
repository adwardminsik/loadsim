"""
DB 연결 설정.

로컬 프로그램(설치형) 방식이므로 별도 DB 서버 없이 SQLite 파일 하나로 동작합니다.
DB 파일은 실행 위치 기준 data/loadsim.db 에 생성됩니다.
나중에 사내 서버로 전환할 경우, DATABASE_URL 환경변수만 바꾸면
PostgreSQL 등으로 교체 가능하도록 SQLAlchemy로 추상화해두었습니다.
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

DEFAULT_DB_PATH = os.path.join(DATA_DIR, "loadsim.db")
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI 의존성 주입용 DB 세션 제공자"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
