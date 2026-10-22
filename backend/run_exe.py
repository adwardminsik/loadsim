"""
exe(PyInstaller onefile)로 패키징했을 때의 실행 진입점.

평소 개발 중에는 `uvicorn app.main:app`을 직접 쓰지만, 더블클릭 exe는
아래 세 가지를 추가로 해줘야 한다:

1) DB 파일을 "영구적인" 위치에 둔다 — PyInstaller onefile은 실행될 때마다
   임시폴더(sys._MEIPASS)에 압축을 풀고, 그 폴더는 프로그램이 끝나면 삭제된다.
   거기에 DB를 두면 매번 실행할 때마다 저장된 오더가 전부 사라진다. 그래서
   exe 파일 "옆"(실행파일이 있는 폴더)에 DB를 두도록 DATABASE_URL을
   `app.database`를 import하기 "전에" 먼저 설정해둔다.
2) 최초 실행이면(= 부품마스터가 비어있으면) 같이 들어있는 엑셀로 자동 임포트한다
   — 사용자가 따로 명령어를 칠 필요 없게.
3) 백엔드가 뜨면 기본 브라우저로 자동으로 열어준다.
"""

import os
import sys
import threading
import time
import webbrowser


def _app_dir() -> str:
    """영구 저장 위치로 쓸 폴더: exe로 묶였으면 '실행파일이 있는 폴더',
    아니면(평소 python run_exe.py로 실행) 이 스크립트가 있는 폴더."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def _resource_dir() -> str:
    """읽기 전용 리소스(부품마스터 엑셀 등)가 들어있는 폴더: exe로 묶였으면
    PyInstaller가 풀어놓은 임시폴더(sys._MEIPASS), 아니면 이 스크립트 폴더."""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", _app_dir())
    return os.path.dirname(os.path.abspath(__file__))


def main():
    app_dir = _app_dir()
    res_dir = _resource_dir()

    data_dir = os.path.join(app_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "loadsim.db")
    # app.database를 import하기 전에 반드시 먼저 설정해야 함(모듈 로드 시점에 읽음).
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{db_path}")

    from app.database import Base, engine, SessionLocal
    from app.models import PartType
    import app.main as backend_app  # noqa: E402  (DATABASE_URL 설정 이후에 import)

    Base.metadata.create_all(bind=engine)

    # 최초 실행 자동 세팅: 부품마스터가 비어있으면, 같이 들어있는 엑셀로 자동 임포트.
    db = SessionLocal()
    try:
        existing = db.query(PartType).count()
    finally:
        db.close()

    if existing == 0:
        master_xlsx = os.path.join(res_dir, "master_data", "Engine_parts_data_filled_v2.xlsx")
        exclude_xlsx = os.path.join(res_dir, "app", "data", "EG_PARTSEXCLUDE_NOT_SERVICE.xlsx")
        if os.path.isfile(master_xlsx):
            print(f"[최초 실행] 부품마스터 임포트 중: {master_xlsx}")
            from app.scripts.import_part_master import import_part_master, load_valid_service_parts

            valid_parts = None
            if os.path.isfile(exclude_xlsx):
                valid_parts = load_valid_service_parts(exclude_xlsx)
            db = SessionLocal()
            try:
                stats = import_part_master(master_xlsx, db, valid_parts=valid_parts)
                print(f"[최초 실행] 부품마스터 임포트 완료: {stats}")
            finally:
                db.close()
        else:
            print(f"[경고] 부품마스터 엑셀을 찾을 수 없음: {master_xlsx} (수동 임포트 필요)")

    port = int(os.environ.get("PORT", "8000"))
    url = f"http://127.0.0.1:{port}"

    def _open_browser():
        time.sleep(1.5)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=_open_browser, daemon=True).start()

    import uvicorn
    print(f"적재시뮬레이터 서버 시작: {url}  (이 창을 닫으면 프로그램이 종료됩니다)")
    uvicorn.run(backend_app.app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
