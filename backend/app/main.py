"""
적재시뮬레이터 백엔드 진입점.

로컬 프로그램(설치형) 방식이므로 127.0.0.1(로컬호스트)에서만 서비스합니다.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import Base, engine
from app.routers import containers, simulations, part_types, pipeline

app = FastAPI(
    title="적재시뮬레이터 API",
    description="엔진 AM 부품 사전 적재 시뮬레이터 - 부품→개별포장→묶음포장→우든박스적재→컨테이너적재(자동선택)",
    version="0.2.0-mvp",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:*", "http://localhost:*"],
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "적재시뮬레이터", "version": app.version}


app.include_router(containers.router)
app.include_router(simulations.router)
app.include_router(part_types.router)
app.include_router(pipeline.router)

# --- exe(PyInstaller) 패키징용: 프론트엔드 빌드 결과(dist)가 같이 들어있으면
# 백엔드가 그 정적파일도 같이 서빙한다 (frontend/dist를 npm run build로 만든 뒤
# backend/app/frontend_dist 에 복사해두면 자동으로 켜짐). 평소 개발(vite dev
# 서버 사용) 중에는 이 폴더가 없으니 이 블록은 조용히 무시됨 — 기존 API
# 라우터들을 전부 등록한 "다음"에 두어야 "/", "/assets/..." 같은 정적 경로가
# 위 API 경로들을 가리지 않는다.
_FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend_dist")
if os.path.isdir(_FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
