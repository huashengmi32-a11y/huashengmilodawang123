"""第三步：把清洗后的数据集打包成网页可直接加载的 ``site/assets/data.js``。

网页只用 ``window.DIVIDEND_LAB_DATA`` 一个全局变量取数，因此：

* 双击 ``site/index.html`` 即可离线打开，不受浏览器 localfile 跨域限制；
* 不需要任何后端服务或前端构建工具。
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import ASSETS_DIR, DATA_DIR, FETCH, PROJECT_ROOT, RAW_DIR, SITE_DIR, SOURCE


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_summary() -> dict[str, Any]:
    """汇总抓取清单，用于在网页上展示抓取规模与限速策略。"""
    manifest = load_json(RAW_DIR / "manifest.json", {})
    requests = manifest.get("requests", [])
    pages = sorted(RAW_DIR.glob("*.html"))
    return {
        "generated_at": manifest.get("generated_at"),
        "pages": len(pages),
        "list_pages": len(list(RAW_DIR.glob("list_*.html"))),
        "detail_pages": len(list(RAW_DIR.glob("detail_*.html"))),
        "last_run_requests": len(requests),
        "network_requests": sum(1 for item in requests if not item.get("from_cache")),
        "cache_hits": sum(1 for item in requests if item.get("from_cache")),
        "total_bytes": sum(int(item.get("bytes", 0)) for item in requests),
        "delay_seconds": FETCH["delay_seconds"],
        "retries": FETCH["retries"],
        "timeout": FETCH["timeout"],
    }


def build_payload() -> dict[str, Any]:
    stocks = load_json(DATA_DIR / "stocks.json", [])
    dividends = load_json(DATA_DIR / "dividends.json", [])
    rights = load_json(DATA_DIR / "rights.json", [])
    issues = load_json(DATA_DIR / "issues.json", [])
    quality = load_json(DATA_DIR / "quality_report.json", {})

    if not dividends:
        raise SystemExit("data/dividends.json 为空，请先运行 scripts/preprocess.py")

    return {
        "meta": {
            "title": "新浪财经历史分红数据获取与预处理",
            "subtitle": "从网页抓取到结构化数据集的完整链路复现",
            "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "source": SOURCE,
            "fetch": fetch_summary(),
        },
        "stocks": stocks,
        "dividends": dividends,
        "rights": rights,
        "issues": issues,
        "quality": quality,
    }


def run() -> Path:
    payload = build_payload()
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    target = ASSETS_DIR / "data.js"
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    target.write_text(
        "/* 本文件由 scripts/build_site.py 自动生成，请勿手工修改。 */\n"
        f"window.DIVIDEND_LAB_DATA = {body};\n",
        encoding="utf-8",
    )
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="生成网页数据集")
    parser.parse_args()
    target = run()
    print(f"[生成] 网页数据文件：{target.relative_to(PROJECT_ROOT)}")
    print(f"[提示] 直接打开 {SITE_DIR / 'index.html'} 即可查看结果")


if __name__ == "__main__":
    main()
