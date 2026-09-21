"""第一步：抓取新浪财经「分红送转」与「分红明细」原始页面。

设计要点：

* 原始 HTML 落地到 ``data/raw/``，抓取与解析解耦，重复运行不再请求数据源；
* 请求之间强制限速，失败按退避策略重试，避免给对方站点造成压力；
* 每次抓取都会写入 ``data/raw/manifest.json``，记录 URL、字节数与抓取时间，
  便于追溯数据来源。
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from config import FETCH, RAW_DIR, SOURCE, TARGET_STOCKS


@dataclass
class FetchLog:
    """单次请求的留痕信息。"""

    url: str
    file: str
    status: int
    bytes: int
    from_cache: bool
    fetched_at: str


class SinaFetcher:
    """带缓存、限速与重试的新浪财经抓取器。"""

    def __init__(
        self,
        raw_dir: Path = RAW_DIR,
        *,
        delay: float = FETCH["delay_seconds"],
        timeout: int = FETCH["timeout"],
        retries: int = FETCH["retries"],
        force: bool = False,
    ) -> None:
        self.raw_dir = Path(raw_dir)
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.force = force
        self.logs: list[FetchLog] = []

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": FETCH["user_agent"],
                "Referer": SOURCE["referer"],
                "Accept-Language": "zh-CN,zh;q=0.9",
            }
        )

    # ---------------------------------------------------------------- helpers
    def _cached(self, name: str) -> Path:
        return self.raw_dir / name

    def fetch(self, url: str, cache_name: str) -> str:
        """抓取单个页面；命中缓存时直接读取本地文件。"""
        path = self._cached(cache_name)
        if path.exists() and not self.force:
            text = path.read_text(encoding="utf-8")
            self._record(url, path, status=200, size=path.stat().st_size, cached=True)
            return text

        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                response = self.session.get(url, timeout=self.timeout)
                response.raise_for_status()
                break
            except requests.RequestException as exc:  # 网络抖动 / 反爬限流
                last_error = exc
                if attempt == self.retries:
                    raise RuntimeError(f"抓取失败：{url}（{exc}）") from exc
                time.sleep(self.delay * attempt)
        else:  # pragma: no cover - 循环必然 break 或 raise
            raise RuntimeError(f"抓取失败：{url}") from last_error

        text = response.content.decode(SOURCE["encoding"], errors="replace")
        path.write_text(text, encoding="utf-8")
        self._record(url, path, status=response.status_code, size=len(response.content), cached=False)
        time.sleep(self.delay)  # 礼貌抓取：请求之间留出间隔
        return text

    def _record(self, url: str, path: Path, *, status: int, size: int, cached: bool) -> None:
        self.logs.append(
            FetchLog(
                url=url,
                file=str(path.relative_to(self.raw_dir.parent.parent)).replace("\\", "/"),
                status=status,
                bytes=size,
                from_cache=cached,
                fetched_at=datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            )
        )

    @staticmethod
    def detail_links(list_html: str, base_url: str) -> list[str]:
        """从列表页提取每条记录对应的明细页链接（分红表 + 配股表）。"""
        soup = BeautifulSoup(list_html, "lxml")
        links: list[str] = []
        seen: set[str] = set()
        for table_id in ("sharebonus_1", "sharebonus_2"):
            table = soup.find("table", id=table_id)
            if table is None:
                continue
            for anchor in table.find_all("a", href=True):
                link = urljoin(base_url, anchor["href"])
                if "ShareBonusDetail" in link and link not in seen:
                    seen.add(link)
                    links.append(link)
        return links

    @staticmethod
    def _detail_cache_name(code: str, url: str, fallback: int) -> str:
        query = parse_qs(urlparse(url).query)
        end_date = query.get("end_date", [f"item{fallback}"])[0]
        kind = query.get("type", ["1"])[0]
        suffix = "" if kind == "1" else f"_t{kind}"
        return f"detail_{code}_{end_date}{suffix}.html"

    # ------------------------------------------------------------------ tasks
    def fetch_stock(self, code: str) -> dict[str, object]:
        """抓取单只股票的分红列表页及其全部分红明细页。"""
        list_url = SOURCE["list_url"].format(code=code)
        list_html = self.fetch(list_url, f"list_{code}.html")

        detail_urls = self.detail_links(list_html, list_url)
        for index, url in enumerate(detail_urls, start=1):
            self.fetch(url, self._detail_cache_name(code, url, index))

        return {
            "code": code,
            "list_url": list_url,
            "list_file": f"data/raw/list_{code}.html",
            "detail_pages": len(detail_urls),
        }

    def write_manifest(self) -> Path:
        manifest = {
            "source": SOURCE["name"],
            "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "requests": [asdict(log) for log in self.logs],
        }
        path = self.raw_dir / "manifest.json"
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return path


def main() -> None:
    parser = argparse.ArgumentParser(description="抓取新浪财经历史分红数据")
    parser.add_argument("--force", action="store_true", help="忽略本地缓存，强制重新抓取")
    parser.add_argument("--codes", nargs="*", help="仅抓取指定股票代码，默认使用配置中的目标清单")
    args = parser.parse_args()

    codes = args.codes or [item["code"] for item in TARGET_STOCKS]
    fetcher = SinaFetcher(force=args.force)

    summary = []
    for code in codes:
        info = fetcher.fetch_stock(code)
        summary.append(info)
        print(f"[抓取] {code}：列表页 1 个，明细页 {info['detail_pages']} 个")

    manifest = fetcher.write_manifest()
    network_hits = sum(1 for log in fetcher.logs if not log.from_cache)
    print(f"[完成] 共 {len(fetcher.logs)} 个页面，其中联网请求 {network_hits} 次")
    print(f"[完成] 抓取清单：{manifest}")


if __name__ == "__main__":
    main()
