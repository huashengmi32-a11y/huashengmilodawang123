"""项目级配置：数据源、目标股票、目录与抓取参数。

所有路径均以项目根目录为基准，脚本可以在任意工作目录下执行。
"""

from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
SITE_DIR = PROJECT_ROOT / "site"
ASSETS_DIR = SITE_DIR / "assets"
DOCS_DIR = PROJECT_ROOT / "docs"

# 数据源：新浪财经个股「分红送转」页与「分红明细」页
SOURCE = {
    "name": "新浪财经",
    "list_url": "http://vip.stock.finance.sina.com.cn/corp/go.php/vISSUE_ShareBonus/stockid/{code}.phtml",
    "detail_url": "http://vip.stock.finance.sina.com.cn/corp/view/vISSUE_ShareBonusDetail.php",
    "referer": "http://vip.stock.finance.sina.com.cn/",
    "encoding": "gb2312",
    "note": "数据仅用于课程作业与学习演示，版权归新浪财经所有。",
}

# 目标股票：覆盖白酒与银行业，兼顾「只派现」与「含配股」两类形态
TARGET_STOCKS = [
    {"code": "600519", "market": "上交所主板", "industry": "白酒"},
    {"code": "000001", "market": "深交所主板", "industry": "股份制银行"},
    {"code": "601398", "market": "上交所主板", "industry": "国有大型银行"},
]

FETCH = {
    "delay_seconds": 0.6,
    "timeout": 20,
    "retries": 3,
    "user_agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}

# 清洗阶段视为缺失值的占位符
NULL_TOKENS = {"", "-", "--", "---", "—", "――", "暂无", "暂无数据", "不适用", "null", "None", "NaN"}

# 生成 CSV 时使用中文表头，便于直接用 Excel 打开检查
FIELD_LABELS: dict[str, str] = {
    "stock_code": "股票代码",
    "stock_name": "股票名称",
    "record_id": "记录编号",
    "announce_date": "公告日期",
    "announce_date_suspect": "公告日期存疑",
    "dividend_year": "分红年度",
    "allocation_type": "分配类型",
    "implement_year": "实施年度",
    "status": "方案进度",
    "bonus_share_per10": "送股(股/10股)",
    "transfer_share_per10": "转增(股/10股)",
    "cash_per10_pretax": "派息税前(元/10股)",
    "cash_per_share_pretax": "每股派息税前(元)",
    "ex_dividend_date": "除权除息日",
    "record_date": "股权登记日",
    "bonus_listing_date": "红股上市日",
    "detail_cash_pretax": "明细页税前红利(元)",
    "detail_cash_aftertax": "明细页税后红利(元)",
    "shareholders_meeting_date": "股东大会决议公告日",
    "dividend_pay_date": "红利到账日",
    "has_cash": "含现金分红",
    "has_bonus_share": "含送股",
    "has_transfer_share": "含转增",
    "source_url": "数据来源",
}

RIGHTS_LABELS: dict[str, str] = {
    "stock_code": "股票代码",
    "stock_name": "股票名称",
    "record_id": "记录编号",
    "announce_date": "公告日期",
    "rights_per10": "配股方案(股/10股)",
    "rights_price": "配股价格(元)",
    "base_share_capital": "基准股本(股)",
    "ex_rights_date": "除权日",
    "record_date": "股权登记日",
    "payment_start": "缴款起始日",
    "payment_end": "缴款终止日",
    "listing_date": "配股上市日",
    "raised_funds": "募集资金合计(元)",
    "source_url": "数据来源",
}

STOCKS_LABELS: dict[str, str] = {
    "stock_code": "股票代码",
    "stock_name": "股票名称",
    "market": "上市板块",
    "industry": "行业",
    "dividend_records": "分红记录数",
    "rights_records": "配股记录数",
    "cash_total_pretax": "累计每股派息税前(元)",
    "latest_announce_date": "最近公告日期",
    "latest_status": "最近方案进度",
}

ISSUES_LABELS: dict[str, str] = {
    "stock_code": "股票代码",
    "record_id": "记录编号",
    "rule": "规则",
    "field": "字段",
    "level": "级别",
    "message": "说明",
}

FIELD_DESCRIPTIONS: dict[str, str] = {
    "stock_code": "6 位证券代码，来源于目标清单",
    "stock_name": "证券简称，从数据源页面标题解析",
    "record_id": "派生字段：记录主键，格式 {股票代码}-{公告日期}",
    "announce_date": "分红方案公告日期，统一为 ISO 格式 yyyy-mm-dd；源站未知日期会以 1900-01-01 占位",
    "announce_date_suspect": "派生字段：公告日期早于 1990-01-01，判定为源站占位日期，该行不参与年度派生与区间统计",
    "dividend_year": "派生字段：按公告月份推断的利润所属年度",
    "allocation_type": "派生字段：年度分配 / 中期分配（按公告月份推断）",
    "implement_year": "派生字段：除权除息日所在年份，缺失时回退到公告年份",
    "status": "数据源给出的方案进度，如「实施」",
    "bonus_share_per10": "每 10 股送股数，缺失按 0 处理",
    "transfer_share_per10": "每 10 股转增数，缺失按 0 处理",
    "cash_per10_pretax": "每 10 股税前派息金额，单位为元",
    "cash_per_share_pretax": "派生字段：每 10 股税前派息 ÷ 10",
    "ex_dividend_date": "除权除息日",
    "record_date": "股权登记日",
    "bonus_listing_date": "红股上市日，未送股时为缺失",
    "detail_cash_pretax": "分红明细页给出的税前红利，用于交叉校验",
    "detail_cash_aftertax": "分红明细页给出的税后红利",
    "shareholders_meeting_date": "股东大会决议公告日",
    "dividend_pay_date": "红利/送转股到账日",
    "has_cash": "派生字段：本次方案是否包含现金分红",
    "has_bonus_share": "派生字段：本次方案是否包含送股",
    "has_transfer_share": "派生字段：本次方案是否包含转增",
    "source_url": "该条记录对应的数据源页面地址",
}
