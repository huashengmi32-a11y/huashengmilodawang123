"""第二步：解析并清洗新浪财经历史分红与配股数据。

处理流程：读取原始 HTML → 抽取表格 → 清洗与类型转换 → 派生字段 →
校验与去重 → 输出 CSV / JSON / 数据质量报告。

所有清洗规则都在 ``CHECKS`` 与 ``NOTES`` 中显式声明，脚本本身就是处理说明书。
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from bs4 import BeautifulSoup

from config import (
    DATA_DIR,
    FIELD_DESCRIPTIONS,
    FIELD_LABELS,
    ISSUES_LABELS,
    NULL_TOKENS,
    RAW_DIR,
    RIGHTS_LABELS,
    SOURCE,
    STOCKS_LABELS,
    TARGET_STOCKS,
)

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NUMBER_PATTERN = re.compile(r"^-?\d+(\.\d+)?$")

# 列表页表头与字段的对应关系（分红表为 9 列，配股表为 11 列）
DIVIDEND_LIST_FIELDS = [
    "announce_date",
    "bonus_share_per10",
    "transfer_share_per10",
    "cash_per10_pretax",
    "status",
    "ex_dividend_date",
    "record_date",
    "bonus_listing_date",
    "__detail__",  # 列表末尾的「查看」链接列，仅用于提取明细页地址
]
RIGHTS_LIST_FIELDS = [
    "announce_date",
    "rights_per10",
    "rights_price",
    "base_share_capital",
    "ex_rights_date",
    "record_date",
    "payment_start",
    "payment_end",
    "listing_date",
    "raised_funds",
    "__detail__",
]

# 明细页中文标签 → 目标字段
DETAIL_KEY_MAP = {
    "税前红利（报价币种）": "detail_cash_pretax",
    "税后红利（报价币种）": "detail_cash_aftertax",
    "股东大会决议公告日期": "shareholders_meeting_date",
    "红利/配股起始日（送、转股到账日）": "dividend_pay_date",
    "登记日": "detail_record_date",
    "除息日": "detail_ex_date",
    "上市日": "detail_listing_date",
}

DIVIDEND_COLUMNS = [
    "stock_code",
    "stock_name",
    "record_id",
    "announce_date",
    "dividend_year",
    "allocation_type",
    "implement_year",
    "status",
    "bonus_share_per10",
    "transfer_share_per10",
    "cash_per10_pretax",
    "cash_per_share_pretax",
    "ex_dividend_date",
    "record_date",
    "bonus_listing_date",
    "detail_cash_pretax",
    "detail_cash_aftertax",
    "shareholders_meeting_date",
    "dividend_pay_date",
    "has_cash",
    "has_bonus_share",
    "has_transfer_share",
    "source_url",
]

RIGHTS_COLUMNS = [
    "stock_code",
    "stock_name",
    "record_id",
    "announce_date",
    "rights_per10",
    "rights_price",
    "base_share_capital",
    "ex_rights_date",
    "record_date",
    "payment_start",
    "payment_end",
    "listing_date",
    "raised_funds",
    "source_url",
]

BOOLEAN_FIELDS = ("has_cash", "has_bonus_share", "has_transfer_share")

# 六条数据质量规则：既用于逐条打标，也汇总进质量报告
CHECKS = [
    {
        "id": "R1",
        "name": "关键字段完整性",
        "description": "股票代码与公告日期必须存在且可解析",
    },
    {
        "id": "R2",
        "name": "方案内容有效性",
        "description": "送股、转增、派息三项至少一项大于 0，排除空方案",
    },
    {
        "id": "R3",
        "name": "除权除息日不早于公告日",
        "description": "实施类方案的除权除息日必须晚于或等于公告日",
    },
    {
        "id": "R4",
        "name": "股权登记日不晚于除权除息日",
        "description": "先登记后除权，跨字段日期顺序校验",
    },
    {
        "id": "R5",
        "name": "数值非负",
        "description": "送股、转增、派息等比例字段不允许出现负值",
    },
    {
        "id": "R6",
        "name": "明细页与列表页交叉校验",
        "description": "明细页税前红利与列表页派息差额不超过 0.01 元（舍入容差）",
    },
    {
        "id": "R7",
        "name": "主键唯一",
        "description": "同一股票下 (公告日期) 不重复，重复记录清理后保留一条",
    },
]

NOTES = [
    "字段「分红年度」「分配类型」为推断字段：公告月份 ≤ 8 归入上一年度分配，"
    "≥ 9 归入本期中期/特别分配，用于分组统计，不代表公司官方口径。",
    "「派息(税前)(元/10股)」与明细页「税前红利」均为每 10 股口径，"
    "派生字段「每股派息税前」按 ÷10 折算。",
    "明细页中存在大量「--」占位符，统一按缺失值处理，不计入字段覆盖率分子。",
    "原始 HTML 保存在 data/raw/ 并被 .gitignore 忽略，可通过 fetch_sina.py 复现。",
]


# --------------------------------------------------------------------- 工具
def normalize_text(value: str) -> str:
    """折叠空白、统一全角空格，便于后续取值。"""
    return re.sub(r"\s+", " ", str(value).replace("\u3000", " ").replace("\xa0", " ")).strip()


def blank_to_none(value: Any) -> str | None:
    """把「--」「暂无」等占位符统一成缺失值。"""
    if value is None:
        return None
    text = normalize_text(value)
    return None if text in NULL_TOKENS else text


def to_number(value: Any) -> float | None:
    """去掉千分位与单位后转为浮点数，无法解析时返回缺失。"""
    text = blank_to_none(value)
    if text is None:
        return None
    cleaned = re.sub(r"[,，\s元股]", "", text)
    if not NUMBER_PATTERN.match(cleaned):
        return None
    return float(cleaned)


def to_iso_date(value: Any) -> str | None:
    """把 2024/06/12、2024.6.12 等写法统一成 ISO 日期。"""
    text = blank_to_none(value)
    if text is None:
        return None
    normalized = text.replace("/", "-").replace(".", "-")
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", normalized)
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


class IssueLog:
    """逐条质量问题记录，最终导出为 issues.csv。"""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []

    def add(
        self,
        *,
        stock_code: str,
        record_id: str,
        rule: str,
        field: str,
        level: str,
        message: str,
    ) -> None:
        self.items.append(
            {
                "stock_code": stock_code,
                "record_id": record_id,
                "rule": rule,
                "field": field,
                "level": level,
                "message": message,
            }
        )

    def count_by(self, key: str) -> dict[str, int]:
        result: dict[str, int] = {}
        for item in self.items:
            result[item[key]] = result.get(item[key], 0) + 1
        return result


def parse_stock_name(soup: BeautifulSoup, code: str) -> str:
    """页面标题形如「贵州茅台(600519)分红送转_新浪财经_新浪网」。"""
    if soup.title:
        match = re.match(r"^(.*?)\(\d{6}\)", soup.title.get_text(strip=True))
        if match:
            return match.group(1).strip()
    return code


def row_cells(row: Any) -> list[str]:
    return [normalize_text(cell.get_text(" ", strip=True)) for cell in row.find_all(["th", "td"])]


def row_detail_url(row: Any, base_url: str) -> str | None:
    from urllib.parse import urljoin

    anchor = row.find("a", href=True)
    return urljoin(base_url, anchor["href"]) if anchor else None


# ----------------------------------------------------------------- 解析阶段
def parse_list_page(
    html: str,
    code: str,
    source_url: str,
    issues: IssueLog,
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    """解析分红送转列表页，返回 (股票名称, 分红记录, 配股记录)。"""
    soup = BeautifulSoup(html, "lxml")
    stock_name = parse_stock_name(soup, code)
    dividends: list[dict[str, Any]] = []
    rights: list[dict[str, Any]] = []

    table = soup.find("table", id="sharebonus_1")
    if table is None:
        issues.add(
            stock_code=code,
            record_id="-",
            rule="R1",
            field="分红送转表",
            level="错误",
            message="页面中未找到 sharebonus_1 表格，可能页面结构变更或抓取失败",
        )
    else:
        for row in table.find_all("tr"):
            cells = row_cells(row)
            if len(cells) != len(DIVIDEND_LIST_FIELDS) or not DATE_PATTERN.match(cells[0]):
                continue
            record = dict(zip(DIVIDEND_LIST_FIELDS, cells))
            record["stock_code"] = code
            record["stock_name"] = stock_name
            record["source_url"] = row_detail_url(row, source_url)
            dividends.append(record)

    table = soup.find("table", id="sharebonus_2")
    if table is not None:
        for row in table.find_all("tr"):
            cells = row_cells(row)
            if len(cells) != len(RIGHTS_LIST_FIELDS) or not DATE_PATTERN.match(cells[0]):
                continue
            record = dict(zip(RIGHTS_LIST_FIELDS, cells))
            record["stock_code"] = code
            record["stock_name"] = stock_name
            record["source_url"] = row_detail_url(row, source_url)
            rights.append(record)

    return stock_name, dividends, rights


def parse_detail_page(html: str) -> dict[str, str]:
    """解析分红明细页的键值表，只保留关心的字段。"""
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id="sharebonusdetail")
    if table is None:
        return {}
    pairs: dict[str, str] = {}
    for row in table.find_all("tr"):
        cells = row_cells(row)
        if len(cells) >= 2 and cells[0] in DETAIL_KEY_MAP:
            pairs[DETAIL_KEY_MAP[cells[0]]] = cells[1]
    return pairs


def detail_cache_name(code: str, announce_date: str) -> str:
    return f"detail_{code}_{announce_date}.html"


# ----------------------------------------------------------------- 清洗阶段
def derive_dividend_fields(record: dict[str, Any]) -> dict[str, Any]:
    """把公告日期换算成统计口径，并派生布尔标记与每股口径。"""
    announce = record.get("announce_date")
    if announce:
        year, month = int(announce[:4]), int(announce[5:7])
        if month <= 8:
            record["dividend_year"] = year - 1
            record["allocation_type"] = "年度分配（推断）"
        else:
            record["dividend_year"] = year
            record["allocation_type"] = "中期/特别分配（推断）"
    else:
        record["dividend_year"] = None
        record["allocation_type"] = None

    implement_date = record.get("ex_dividend_date") or announce
    record["implement_year"] = int(implement_date[:4]) if implement_date else None

    cash = record.get("cash_per10_pretax")
    record["cash_per_share_pretax"] = round(cash / 10, 6) if cash is not None else None
    record["has_cash"] = bool(cash)
    record["has_bonus_share"] = bool(record.get("bonus_share_per10"))
    record["has_transfer_share"] = bool(record.get("transfer_share_per10"))
    return record


def clean_dividend(
    raw: dict[str, Any],
    detail: dict[str, str],
    issues: IssueLog,
) -> dict[str, Any]:
    """单条分红记录的类型转换与校验。"""
    code = raw["stock_code"]
    record: dict[str, Any] = {
        "stock_code": code,
        "stock_name": raw["stock_name"],
        "announce_date": to_iso_date(raw.get("announce_date")),
        "status": blank_to_none(raw.get("status")),
        "bonus_share_per10": to_number(raw.get("bonus_share_per10")),
        "transfer_share_per10": to_number(raw.get("transfer_share_per10")),
        "cash_per10_pretax": to_number(raw.get("cash_per10_pretax")),
        "ex_dividend_date": to_iso_date(raw.get("ex_dividend_date")),
        "record_date": to_iso_date(raw.get("record_date")),
        "bonus_listing_date": to_iso_date(raw.get("bonus_listing_date")),
        "source_url": raw.get("source_url"),
    }
    record["record_id"] = f"{code}-{record['announce_date'] or '未知日期'}"
    record = derive_dividend_fields(record)

    for field in ("detail_cash_pretax", "detail_cash_aftertax"):
        record[field] = to_number(detail.get(field))
    for field in ("shareholders_meeting_date", "dividend_pay_date"):
        record[field] = to_iso_date(detail.get(field))

    # R1 关键字段完整性
    if not record["announce_date"]:
        issues.add(
            stock_code=code,
            record_id=record["record_id"],
            rule="R1",
            field="announce_date",
            level="错误",
            message=f"公告日期无法解析：{raw.get('announce_date')!r}",
        )
    if not record["stock_code"]:
        issues.add(
            stock_code=code,
            record_id=record["record_id"],
            rule="R1",
            field="stock_code",
            level="错误",
            message="缺少股票代码",
        )

    # R2 方案内容有效性
    plan_values = [
        record["bonus_share_per10"] or 0,
        record["transfer_share_per10"] or 0,
        record["cash_per10_pretax"] or 0,
    ]
    if not any(value > 0 for value in plan_values):
        declined = (record.get("status") or "").strip() == "不分配"
        issues.add(
            stock_code=code,
            record_id=record["record_id"],
            rule="R2",
            field="派息/送股/转增",
            level="提示" if declined else "警告",
            message=(
                "该年度方案为「不分配」，保留记录以保证年度序列完整"
                if declined
                else "送股、转增、派息均为 0 或缺失，方案内容为空"
            ),
        )

    # R3 日期先后顺序：除权除息日不得早于公告日
    if record["announce_date"] and record["ex_dividend_date"]:
        if record["ex_dividend_date"] < record["announce_date"]:
            issues.add(
                stock_code=code,
                record_id=record["record_id"],
                rule="R3",
                field="ex_dividend_date",
                level="警告",
                message=f"除权除息日 {record['ex_dividend_date']} 早于公告日 {record['announce_date']}",
            )

    # R4 先登记后除权
    if record["record_date"] and record["ex_dividend_date"]:
        if record["record_date"] > record["ex_dividend_date"]:
            issues.add(
                stock_code=code,
                record_id=record["record_id"],
                rule="R4",
                field="record_date",
                level="警告",
                message=f"股权登记日 {record['record_date']} 晚于除权除息日 {record['ex_dividend_date']}",
            )

    # R5 比例字段非负
    for field in ("bonus_share_per10", "transfer_share_per10", "cash_per10_pretax"):
        value = record[field]
        if value is not None and value < 0:
            issues.add(
                stock_code=code,
                record_id=record["record_id"],
                rule="R5",
                field=field,
                level="警告",
                message=f"{field} 为负值：{value}",
            )

    # R6 明细页与列表页交叉校验
    detail_cash = record["detail_cash_pretax"]
    if detail_cash is not None and record["cash_per10_pretax"] is not None:
        if abs(detail_cash - record["cash_per10_pretax"]) > 0.01:
            issues.add(
                stock_code=code,
                record_id=record["record_id"],
                rule="R6",
                field="cash_per10_pretax",
                level="警告",
                message=(
                    f"明细页税前红利 {detail_cash} 与列表页 {record['cash_per10_pretax']} 不一致"
                ),
            )
    elif record["has_cash"] and detail_cash is None:
        issues.add(
            stock_code=code,
            record_id=record["record_id"],
            rule="R6",
            field="detail_cash_pretax",
            level="提示",
            message="未取到明细页税前红利，跳过交叉校验",
        )

    return record


def clean_rights(
    raw: dict[str, Any],
    detail: dict[str, str],
    issues: IssueLog,
) -> dict[str, Any]:
    """配股记录清洗。"""
    code = raw["stock_code"]
    record: dict[str, Any] = {
        "stock_code": code,
        "stock_name": raw["stock_name"],
        "announce_date": to_iso_date(raw.get("announce_date")),
        "rights_per10": to_number(raw.get("rights_per10")),
        "rights_price": to_number(raw.get("rights_price")),
        "base_share_capital": to_number(raw.get("base_share_capital")),
        "ex_rights_date": to_iso_date(raw.get("ex_rights_date")),
        "record_date": to_iso_date(raw.get("record_date")),
        "payment_start": to_iso_date(raw.get("payment_start")),
        "payment_end": to_iso_date(raw.get("payment_end")),
        "listing_date": to_iso_date(raw.get("listing_date")),
        "raised_funds": to_number(raw.get("raised_funds")),
        "source_url": raw.get("source_url"),
    }
    record["record_id"] = f"{code}-{record['announce_date'] or '未知日期'}-配股"

    if record["announce_date"] is None:
        issues.add(
            stock_code=code,
            record_id=record["record_id"],
            rule="R1",
            field="announce_date",
            level="错误",
            message=f"配股公告日期无法解析：{raw.get('announce_date')!r}",
        )
    if record["rights_per10"] is None and record["rights_price"] is None:
        issues.add(
            stock_code=code,
            record_id=record["record_id"],
            rule="R2",
            field="rights_per10",
            level="警告",
            message="配股比例与配股价格均缺失",
        )
    return record


# ----------------------------------------------------------------- 输出阶段
def build_coverage(frame: pd.DataFrame, columns: list[str]) -> dict[str, dict[str, Any]]:
    coverage: dict[str, dict[str, Any]] = {}
    total = len(frame)
    for column in columns:
        series = frame[column]
        non_null = int(series.notna().sum())
        coverage[column] = {
            "label": FIELD_LABELS.get(column, RIGHTS_LABELS.get(column, column)),
            "description": FIELD_DESCRIPTIONS.get(column, ""),
            "non_null": non_null,
            "total": total,
            "rate": round(non_null / total, 4) if total else 0.0,
        }
    return coverage


def frame_to_chinese(frame: pd.DataFrame, labels: dict[str, str], booleans: tuple[str, ...]) -> pd.DataFrame:
    output = frame.copy()
    for column in booleans:
        if column in output.columns:
            output[column] = output[column].map(lambda value: "是" if value else "否")
    return output.rename(columns=labels)


def write_csv(frame: pd.DataFrame, path: Path) -> None:
    frame.to_csv(path, index=False, encoding="utf-8-sig", lineterminator="\n")


def run(
    raw_dir: Path = RAW_DIR,
    data_dir: Path = DATA_DIR,
    codes: list[str] | None = None,
) -> dict[str, Any]:
    data_dir.mkdir(parents=True, exist_ok=True)
    issues = IssueLog()
    dividends: list[dict[str, Any]] = []
    rights: list[dict[str, Any]] = []
    stock_rows: list[dict[str, Any]] = []
    duplicates_removed = 0
    missing_cache: list[str] = []

    targets = [item for item in TARGET_STOCKS if not codes or item["code"] in codes]
    for target in targets:
        code = target["code"]
        list_file = raw_dir / f"list_{code}.html"
        if not list_file.exists():
            missing_cache.append(str(list_file))
            continue

        list_html = list_file.read_text(encoding="utf-8")
        list_url = SOURCE["list_url"].format(code=code)
        stock_name, raw_dividends, raw_rights = parse_list_page(list_html, code, list_url, issues)

        for raw in raw_dividends:
            cache = raw_dir / detail_cache_name(code, raw["announce_date"])
            detail = parse_detail_page(cache.read_text(encoding="utf-8")) if cache.exists() else {}
            dividends.append(clean_dividend(raw, detail, issues))

        for raw in raw_rights:
            cache = raw_dir / detail_cache_name(code, raw["announce_date"]).replace(".html", "_t2.html")
            detail = parse_detail_page(cache.read_text(encoding="utf-8")) if cache.exists() else {}
            rights.append(clean_rights(raw, detail, issues))

        stock_rows.append(
            {
                "stock_code": code,
                "stock_name": stock_name,
                "market": target["market"],
                "industry": target["industry"],
                "dividend_records": len(raw_dividends),
                "rights_records": len(raw_rights),
            }
        )

    if missing_cache:
        raise FileNotFoundError(
            "缺少原始抓取文件，请先运行 fetch_sina.py：\n  " + "\n  ".join(missing_cache)
        )

    dividend_frame = pd.DataFrame(dividends)
    dividend_frame = dividend_frame.reindex(columns=DIVIDEND_COLUMNS)
    dividend_frame = dividend_frame.sort_values(
        ["stock_code", "announce_date"], ascending=[True, False]
    ).reset_index(drop=True)

    # R7 主键去重：同一股票同一公告日期只保留首条
    before = len(dividend_frame)
    duplicated = dividend_frame.duplicated(subset=["stock_code", "announce_date"], keep="first")
    for _, row in dividend_frame[duplicated].iterrows():
        issues.add(
            stock_code=row["stock_code"],
            record_id=row["record_id"],
            rule="R7",
            field="record_id",
            level="警告",
            message="同一股票同一公告日期出现重复记录，已保留首条",
        )
    dividend_frame = dividend_frame[~duplicated].reset_index(drop=True)
    duplicates_removed = before - len(dividend_frame)

    rights_frame = pd.DataFrame(rights).reindex(columns=RIGHTS_COLUMNS)
    if not rights_frame.empty:
        rights_frame = rights_frame.sort_values(
            ["stock_code", "announce_date"], ascending=[True, False]
        ).reset_index(drop=True)

    stocks_frame = pd.DataFrame(stock_rows)
    if not stocks_frame.empty:
        cash_summary = (
            dividend_frame.groupby("stock_code")["cash_per_share_pretax"]
            .agg(累计每股派息税前="sum")
            .reset_index()
        )
        latest = (
            dividend_frame.sort_values("announce_date")
            .groupby("stock_code")
            .tail(1)[["stock_code", "announce_date", "status"]]
            .rename(columns={"announce_date": "最近公告日期", "status": "最近方案进度"})
        )
        stocks_frame = stocks_frame.merge(cash_summary, on="stock_code", how="left").merge(
            latest, on="stock_code", how="left"
        )
        stocks_frame["累计每股派息税前"] = stocks_frame["累计每股派息税前"].round(4)
        stocks_frame = stocks_frame.rename(
            columns={
                "累计每股派息税前": "cash_total_pretax",
                "最近公告日期": "latest_announce_date",
                "最近方案进度": "latest_status",
            }
        )

    issues_frame = pd.DataFrame(
        issues.items,
        columns=["stock_code", "record_id", "rule", "field", "level", "message"],
    )
    if issues_frame.empty:
        issues_frame = pd.DataFrame(
            columns=["stock_code", "record_id", "rule", "field", "level", "message"]
        )

    rule_hits = {check["id"]: 0 for check in CHECKS}
    for item in issues.items:
        rule_hits[item["rule"]] = rule_hits.get(item["rule"], 0) + 1

    quality_report = {
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "source": SOURCE,
        "counts": {
            "stocks": len(stocks_frame),
            "dividend_records": len(dividend_frame),
            "rights_records": len(rights_frame),
            "issues": len(issues.items),
            "duplicates_removed": duplicates_removed,
            "detail_pages": len(list(raw_dir.glob("detail_*.html"))),
        },
        "checks": [
            {
                **check,
                "hits": rule_hits.get(check["id"], 0),
                "passed": rule_hits.get(check["id"], 0) == 0,
            }
            for check in CHECKS
        ],
        "issue_summary": issues.count_by("level"),
        "issue_by_rule": {key: value for key, value in rule_hits.items() if value},
        "field_coverage": build_coverage(dividend_frame, DIVIDEND_COLUMNS),
        "rights_field_coverage": build_coverage(rights_frame, RIGHTS_COLUMNS)
        if not rights_frame.empty
        else {},
        "field_dictionary": {
            column: {
                "label": FIELD_LABELS.get(column, RIGHTS_LABELS.get(column, column)),
                "description": FIELD_DESCRIPTIONS.get(column, ""),
            }
            for column in DIVIDEND_COLUMNS
        },
        "notes": NOTES,
    }

    # 落盘：CSV 用中文表头，JSON 保留英文字段名供网页使用
    write_csv(frame_to_chinese(dividend_frame, FIELD_LABELS, BOOLEAN_FIELDS), data_dir / "dividends.csv")
    write_csv(frame_to_chinese(rights_frame, RIGHTS_LABELS, ()), data_dir / "rights.csv")
    write_csv(stocks_frame.rename(columns=STOCKS_LABELS), data_dir / "stocks.csv")
    write_csv(issues_frame.rename(columns=ISSUES_LABELS), data_dir / "issues.csv")

    (data_dir / "dividends.json").write_text(
        json.dumps(dividend_frame.to_dict(orient="records"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (data_dir / "rights.json").write_text(
        json.dumps(rights_frame.to_dict(orient="records"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (data_dir / "stocks.json").write_text(
        json.dumps(stocks_frame.to_dict(orient="records"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (data_dir / "issues.json").write_text(
        json.dumps(issues_frame.to_dict(orient="records"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (data_dir / "quality_report.json").write_text(
        json.dumps(quality_report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return quality_report


def main() -> None:
    parser = argparse.ArgumentParser(description="解析并清洗新浪财经历史分红数据")
    parser.add_argument("--codes", nargs="*", help="仅处理指定股票代码")
    args = parser.parse_args()

    report = run(codes=args.codes)
    counts = report["counts"]
    print(f"[解析] 股票 {counts['stocks']} 只，分红记录 {counts['dividend_records']} 条，"
          f"配股记录 {counts['rights_records']} 条")
    print(f"[质量] 问题 {counts['issues']} 条，去重 {counts['duplicates_removed']} 条，"
          f"明细页 {counts['detail_pages']} 个")
    for check in report["checks"]:
        flag = "通过" if check["passed"] else f"命中 {check['hits']}"
        print(f"  {check['id']} {check['name']}：{flag}")
    print(f"[输出] {DATA_DIR}")


if __name__ == "__main__":
    main()
