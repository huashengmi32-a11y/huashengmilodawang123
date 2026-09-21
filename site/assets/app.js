/* ==========================================================================
   新浪财经历史分红数据获取与预处理 · 页面交互
   数据来自 assets/data.js（由 scripts/build_site.py 生成），页面不发起任何网络请求。
   ========================================================================== */

(function () {
  "use strict";

  var DATA = window.DIVIDEND_LAB_DATA;

  if (!DATA || !Array.isArray(DATA.dividends) || !DATA.dividends.length) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<p class="container">未找到数据集，请先执行 <code>python scripts/preprocess.py</code> 与 ' +
        "<code>python scripts/build_site.py</code>。</p>"
    );
    return;
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  var PAGE_SIZE = 8;
  var DERIVED_HINT = "派生字段：";

  var state = {
    stockCode: DATA.stocks.length ? DATA.stocks[0].stock_code : DATA.dividends[0].stock_code,
    search: "",
    filters: [],
    sortKey: "announce_date",
    sortDirection: "desc",
    page: 1
  };

  /* ------------------------------------------------------------ 基础工具 */

  function pick(name) {
    return document.querySelector('[data-bind="' + name + '"]');
  }

  function pickAll(name) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-bind="' + name + '"]'));
  }

  function el(tag, options, children) {
    var node = document.createElement(tag);
    var opts = options || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
    Object.keys(opts.attrs || {}).forEach(function (key) {
      var value = opts.attrs[key];
      if (value === null || value === undefined || value === false) return;
      node.setAttribute(key, value === true ? "" : String(value));
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, String(attrs[key]));
    });
    return node;
  }

  function svgIcon(paths, className) {
    var svg = svgEl("svg", {
      class: className || "icon",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    });
    paths.forEach(function (d) {
      svg.appendChild(svgEl("path", { d: d }));
    });
    return svg;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || value === "") return "—";
    var number = Number(value);
    if (!isFinite(number)) return "—";
    var text = number.toFixed(digits === undefined ? 4 : digits);
    if (text.indexOf(".") >= 0) text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text;
  }

  function formatInt(value) {
    if (value === null || value === undefined || value === "") return "—";
    var number = Number(value);
    if (!isFinite(number)) return "—";
    return new Intl.NumberFormat("zh-CN").format(number);
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    var parsed = new Date(iso);
    if (isNaN(parsed.getTime())) return String(iso);
    var pad = function (value) {
      return String(value).padStart(2, "0");
    };
    return (
      parsed.getFullYear() +
      "-" +
      pad(parsed.getMonth() + 1) +
      "-" +
      pad(parsed.getDate()) +
      " " +
      pad(parsed.getHours()) +
      ":" +
      pad(parsed.getMinutes())
    );
  }

  var STATUS_STYLES = [
    { pattern: /实施/, className: "badge badge-ok" },
    { pattern: /预案|董事会|股东大会/, className: "badge badge-pending" },
    { pattern: /不分配/, className: "badge badge-muted" },
    { pattern: /取消|终止|失效/, className: "badge badge-error" }
  ];

  function statusBadge(status) {
    var text = status || "—";
    var style = null;
    STATUS_STYLES.forEach(function (item) {
      if (!style && item.pattern.test(text)) style = item.className;
    });
    return el("span", { className: style || "badge badge-hint", text: text });
  }

  var LEVEL_CLASS = { "错误": "badge badge-error", "警告": "badge badge-warn", "提示": "badge badge-hint" };

  function levelBadge(level) {
    return el("span", { className: LEVEL_CLASS[level] || "badge badge-muted", text: level });
  }

  function stockByCode(code) {
    var found = null;
    DATA.stocks.forEach(function (stock) {
      if (stock.stock_code === code) found = stock;
    });
    return found;
  }

  function recordsOf(code) {
    return DATA.dividends.filter(function (row) {
      return row.stock_code === code;
    });
  }

  /* ---------------------------------------------------------- 页面基础信息 */

  function renderMeta() {
    var meta = DATA.meta;
    pickAll("sourceName").forEach(function (node) {
      node.textContent = meta.source.name;
    });
    pickAll("generatedAt").forEach(function (node) {
      node.textContent = formatDateTime(meta.generated_at);
    });

    var sampleCode = DATA.stocks.length ? DATA.stocks[0].stock_code : "";
    var listLink = pick("sourceListUrl");
    listLink.href = meta.source.list_url.replace("{code}", sampleCode);
    listLink.textContent = "vip.stock.finance.sina.com.cn/corp/go.php/vISSUE_ShareBonus";
    listLink.setAttribute("target", "_blank");

    var detailLink = pick("sourceDetailUrl");
    detailLink.href = meta.source.detail_url;
    detailLink.textContent = "vip.stock.finance.sina.com.cn/corp/view/vISSUE_ShareBonusDetail.php";
    detailLink.setAttribute("target", "_blank");
  }

  function metricCard(metric) {
    var value = el("dd", {}, [el("span", { text: metric.value })]);
    if (metric.unit) value.appendChild(el("span", { className: "unit", text: metric.unit }));
    return el("div", { className: "metric" }, [
      el("dt", { text: metric.label }),
      value,
      metric.hint ? el("p", { className: "metric-hint", text: metric.hint }) : null
    ]);
  }

  function renderMetrics(targetName, metrics) {
    var container = pick(targetName);
    if (!container) return;
    clear(container);
    metrics.forEach(function (metric) {
      container.appendChild(metricCard(metric));
    });
  }

  function renderOverview() {
    var counts = DATA.quality.counts || {};
    var fetchInfo = DATA.meta.fetch || {};
    var dates = DATA.dividends
      .map(function (row) {
        return row.announce_date;
      })
      .filter(Boolean)
      .sort();
    var industries = {};
    DATA.stocks.forEach(function (stock) {
      industries[stock.industry] = true;
    });
    var dictionary = (DATA.quality.field_dictionary || {});
    var derivedCount = Object.keys(dictionary).filter(function (key) {
      return String(dictionary[key].description || "").indexOf(DERIVED_HINT) === 0;
    }).length;
    var rightsStocks = {};
    DATA.rights.forEach(function (row) {
      rightsStocks[row.stock_code] = true;
    });

    renderMetrics("overviewMetrics", [
      {
        label: "目标股票",
        value: formatInt(DATA.stocks.length),
        unit: "只",
        hint: "覆盖 " + Object.keys(industries).length + " 个行业"
      },
      {
        label: "分红记录",
        value: formatInt(counts.dividend_records || DATA.dividends.length),
        unit: "条",
        hint: dates.length ? dates[0] + " 至 " + dates[dates.length - 1] : "—"
      },
      {
        label: "配股记录",
        value: formatInt(counts.rights_records || DATA.rights.length),
        unit: "条",
        hint: "涉及 " + Object.keys(rightsStocks).length + " 只股票"
      },
      {
        label: "抓取页面",
        value: formatInt(fetchInfo.pages),
        unit: "个",
        hint: "列表页 " + (fetchInfo.list_pages || 0) + " · 明细页 " + (fetchInfo.detail_pages || 0)
      },
      {
        label: "质量规则",
        value: formatInt((DATA.quality.checks || []).length),
        unit: "条",
        hint: "命中 " + formatInt(counts.issues || 0) + " 条问题记录"
      },
      {
        label: "输出字段",
        value: formatInt(Object.keys(dictionary).length),
        unit: "个",
        hint: "其中派生字段 " + derivedCount + " 个"
      }
    ]);
  }

  function fillFacts(name, facts) {
    var container = pick(name);
    if (!container) return;
    clear(container);
    facts.forEach(function (fact) {
      container.appendChild(el("li", { text: fact }));
    });
  }

  function renderPipelineFacts() {
    var fetchInfo = DATA.meta.fetch || {};
    fillFacts("fetchFacts", [
      "列表页 " + (fetchInfo.list_pages || 0),
      "明细页 " + (fetchInfo.detail_pages || 0),
      "限速 " + fetchInfo.delay_seconds + "s",
      "重试 " + fetchInfo.retries + " 次"
    ]);

    var dictionary = DATA.quality.field_dictionary || {};
    var derivedCount = Object.keys(dictionary).filter(function (key) {
      return String(dictionary[key].description || "").indexOf(DERIVED_HINT) === 0;
    }).length;
    fillFacts("cleanFacts", [
      "占位符 → 缺失值",
      "日期归一 ISO",
      "派生字段 " + derivedCount + " 个",
      "交叉校验容差 0.01 元"
    ]);

    var counts = DATA.quality.counts || {};
    fillFacts("checkFacts", [
      "规则 " + (DATA.quality.checks || []).length + " 条",
      "命中 " + formatInt(counts.issues || 0) + " 条",
      "去重 " + formatInt(counts.duplicates_removed || 0) + " 条"
    ]);
  }

  /* -------------------------------------------------------------- 概览表格 */

  function renderStockTable() {
    var table = pick("stockTable");
    clear(table);

    var columns = [
      { key: "stock_code", label: "股票代码", num: true },
      { key: "stock_name", label: "股票名称" },
      { key: "market", label: "上市板块" },
      { key: "industry", label: "行业" },
      { key: "dividend_records", label: "分红记录", num: true },
      { key: "rights_records", label: "配股记录", num: true },
      { key: "cash_total_pretax", label: "累计每股派息(元)", num: true },
      { key: "latest_announce_date", label: "最近公告" },
      { key: "latest_status", label: "最近进度" }
    ];

    var head = el("tr", {}, columns.map(function (column) {
      return el("th", { className: column.num ? "num" : "", attrs: { scope: "col" }, text: column.label });
    }));
    table.appendChild(el("thead", {}, [head]));

    var body = el("tbody");
    DATA.stocks.forEach(function (stock) {
      body.appendChild(
        el("tr", {}, columns.map(function (column) {
          var value = stock[column.key];
          var cell = el("td", { className: column.num ? "num" : "" });
          if (column.key === "latest_status") {
            cell.appendChild(statusBadge(value));
          } else if (column.key === "cash_total_pretax") {
            cell.textContent = formatNumber(value, 4);
          } else if (column.num) {
            cell.textContent = formatInt(value);
          } else {
            cell.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
          }
          return cell;
        }))
      );
    });
    table.appendChild(body);
  }

  /* ---------------------------------------------------------- 股票选择器 */

  function renderStockSelector() {
    var wrap = pick("stockSelector");
    clear(wrap);
    DATA.stocks.forEach(function (stock, index) {
      var input = el("input", {
        attrs: {
          type: "radio",
          name: "stock-selector",
          value: stock.stock_code,
          id: "stock-" + stock.stock_code,
          checked: index === 0
        }
      });
      input.checked = index === 0;
      if (index === 0) input.checked = state.stockCode === stock.stock_code;
      input.addEventListener("change", function () {
        state.stockCode = stock.stock_code;
        state.page = 1;
        renderDataset();
      });
      wrap.appendChild(
        el("label", { attrs: { for: "stock-" + stock.stock_code } }, [
          input,
          el("span", { text: stock.stock_name + " " + stock.stock_code })
        ])
      );
    });
  }

  /* ------------------------------------------------------------ 股票指标 */

  function renderStockMetrics(records) {
    var stock = stockByCode(state.stockCode) || {};
    var cashRecords = records.filter(function (row) {
      return row.has_cash;
    });
    var totalCash = records.reduce(function (sum, row) {
      return sum + (row.cash_per_share_pretax || 0);
    }, 0);
    var latest = records[0];

    renderMetrics("stockMetrics", [
      { label: "分红记录", value: formatInt(records.length), unit: "条", hint: stock.industry || "" },
      {
        label: "含现金分红",
        value: formatInt(cashRecords.length),
        unit: "次",
        hint: "占比 " + (records.length ? Math.round((cashRecords.length / records.length) * 100) : 0) + "%"
      },
      {
        label: "累计每股派息",
        value: formatNumber(totalCash, 4),
        unit: "元",
        hint: "税前口径，未考虑除权调整"
      },
      {
        label: "最近公告",
        value: latest ? latest.announce_date : "—",
        hint: latest ? "方案进度：" + (latest.status || "—") : "—"
      }
    ]);
  }

  /* ---------------------------------------------------------------- 图表 */

  function aggregateByYear(records) {
    var bucket = {};
    records.forEach(function (row) {
      if (!row.dividend_year) return;
      if (!bucket[row.dividend_year]) bucket[row.dividend_year] = { year: row.dividend_year, cash: 0, count: 0 };
      bucket[row.dividend_year].cash += row.cash_per_share_pretax || 0;
      bucket[row.dividend_year].count += 1;
    });
    return Object.keys(bucket)
      .map(function (key) {
        return bucket[key];
      })
      .sort(function (a, b) {
        return a.year - b.year;
      });
  }

  function niceCeil(value) {
    if (value <= 0) return 1;
    var power = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
    var scaled = value / power;
    var factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
    return factor * power;
  }

  function renderChart(records) {
    var canvas = pick("chart");
    clear(canvas);

    var stock = stockByCode(state.stockCode) || {};
    var items = aggregateByYear(records);
    var sub = pick("chartSub");

    if (!items.length) {
      sub.textContent = "当前股票没有可绘制的年度数据";
      canvas.appendChild(el("p", { className: "chart-sub", text: "该股票暂无分红记录。" }));
      return;
    }

    var totalYears = items.length;
    var firstYear = items[0].year;
    var lastYear = items[totalYears - 1].year;
    var maxCash = items.reduce(function (max, item) {
      return Math.max(max, item.cash);
    }, 0);
    sub.textContent =
      (stock.stock_name || "") + " " + (stock.stock_code || "") + " · " + firstYear + "–" + lastYear +
      " 共 " + totalYears + " 个分红年度 · 峰值 " + formatNumber(maxCash, 4) + " 元/股";

    var margin = { top: 16, right: 12, bottom: 32, left: 48 };
    var band = 34;
    var height = 250;
    var width = Math.max((canvas.clientWidth || 760), items.length * band + margin.left + margin.right);
    var plotWidth = width - margin.left - margin.right;
    var plotHeight = height - margin.top - margin.bottom;
    var axisMax = niceCeil(maxCash * 1.08);

    var svg = svgEl("svg", {
      width: width,
      height: height,
      viewBox: "0 0 " + width + " " + height,
      role: "img",
      "aria-label":
        "按分红年度汇总的每股派息柱状图，" + totalYears + " 个年度，最高 " + formatNumber(maxCash, 4) + " 元每股"
    });

    [0, 0.25, 0.5, 0.75, 1].forEach(function (ratio) {
      var y = margin.top + plotHeight - ratio * plotHeight;
      svg.appendChild(
        svgEl("line", {
          class: ratio === 0 ? "chart-zero-line" : "chart-grid-line",
          x1: margin.left,
          x2: width - margin.right,
          y1: y,
          y2: y
        })
      );
      var label = svgEl("text", {
        class: "chart-axis-label",
        x: margin.left - 8,
        y: y + 3,
        "text-anchor": "end"
      });
      label.textContent = formatNumber(axisMax * ratio, 2);
      svg.appendChild(label);
    });

    var labelStep = Math.ceil(totalYears / 14);
    var tooltip = el("div", { className: "chart-tooltip", attrs: { role: "status", "aria-live": "polite" } });
    tooltip.hidden = true;

    function showTooltip(item) {
      clear(tooltip);
      tooltip.appendChild(el("div", { text: item.year + " 分红年度" }));
      tooltip.appendChild(el("div", { className: "tt-value", text: formatNumber(item.cash, 4) + " 元/股" }));
      tooltip.appendChild(el("div", { text: "税前合计 · " + item.count + " 次分红" }));
      tooltip.hidden = false;
    }

    items.forEach(function (item, index) {
      var barWidth = Math.min(20, band - 12);
      var x = margin.left + index * band + (band - barWidth) / 2;
      var barHeight = axisMax > 0 ? (item.cash / axisMax) * plotHeight : 0;
      var y = margin.top + plotHeight - barHeight;

      var bar = svgEl("rect", {
        class: "chart-bar",
        x: x,
        y: y,
        width: barWidth,
        height: Math.max(barHeight, 1),
        rx: 2,
        tabindex: "0",
        role: "img",
        "aria-label": item.year + " 年度，每股派息合计 " + formatNumber(item.cash, 4) + " 元，共 " + item.count + " 次分红"
      });
      bar.addEventListener("mouseenter", function () {
        showTooltip(item);
      });
      bar.addEventListener("focus", function () {
        showTooltip(item);
      });
      svg.appendChild(bar);

      if (index % labelStep === 0 || index === totalYears - 1) {
        var xLabel = svgEl("text", {
          class: "chart-axis-label",
          x: x + barWidth / 2,
          y: height - 12,
          "text-anchor": "middle"
        });
        xLabel.textContent = item.year;
        svg.appendChild(xLabel);
      }
    });

    svg.addEventListener("mouseleave", function () {
      tooltip.hidden = true;
    });

    var scroller = el("div", { className: "chart-scroll" }, [svg]);
    canvas.appendChild(scroller);
    canvas.appendChild(tooltip);
  }

  /* ---------------------------------------------------------------- 表格 */

  function sharePlanText(row) {
    var parts = [];
    if (row.has_bonus_share) parts.push("送 " + formatNumber(row.bonus_share_per10, 2));
    if (row.has_transfer_share) parts.push("转 " + formatNumber(row.transfer_share_per10, 2));
    return parts.length ? parts.join(" · ") : "—";
  }

  var DIVIDEND_COLUMNS = [
    { key: "announce_date", label: "公告日期", sortable: true },
    { key: "dividend_year", label: "分红年度", sortable: true, num: true },
    { key: "allocation_type", label: "分配类型" },
    { key: "cash_per10_pretax", label: "派息(元/10股)", sortable: true, num: true, format: formatNumber },
    { key: "cash_per_share_pretax", label: "每股派息(元)", sortable: true, num: true, format: formatNumber },
    { key: "share_plan", label: "送转(股/10股)" },
    { key: "ex_dividend_date", label: "除权除息日" },
    { key: "record_date", label: "股权登记日" },
    { key: "status", label: "方案进度", render: function (row) { return statusBadge(row.status); } }
  ];

  function compareRows(a, b, key, direction) {
    var left = a[key];
    var right = b[key];
    var factor = direction === "asc" ? 1 : -1;
    var leftEmpty = left === null || left === undefined || left === "";
    var rightEmpty = right === null || right === undefined || right === "";
    if (leftEmpty && rightEmpty) return 0;
    if (leftEmpty) return 1;
    if (rightEmpty) return -1;
    if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
    return String(left).localeCompare(String(right), "zh-CN") * factor;
  }

  function filteredRecords() {
    var rows = recordsOf(state.stockCode);
    var keyword = state.search.trim();

    if (keyword) {
      rows = rows.filter(function (row) {
        var date = row.announce_date || "";
        var year = row.dividend_year ? String(row.dividend_year) : "";
        return date.indexOf(keyword) >= 0 || year.indexOf(keyword) >= 0;
      });
    }

    if (state.filters.length) {
      rows = rows.filter(function (row) {
        var isDeclined = (row.status || "") === "不分配";
        var hasShare = row.has_bonus_share || row.has_transfer_share;
        return (
          (state.filters.indexOf("cash") >= 0 && row.has_cash) ||
          (state.filters.indexOf("share") >= 0 && hasShare) ||
          (state.filters.indexOf("none") >= 0 && isDeclined)
        );
      });
    }

    return rows.slice().sort(function (a, b) {
      return compareRows(a, b, state.sortKey, state.sortDirection);
    });
  }

  function sortIcon(direction, active) {
    var icon = svgIcon(["m7 14 5-5 5 5"], "sort-icon");
    if (active && direction === "desc") icon.setAttribute("transform", "rotate(180 12 12)");
    return icon;
  }

  function renderDividendTable() {
    var table = pick("dividendTable");
    var rows = filteredRecords();
    var pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > pageCount) state.page = pageCount;
    var start = (state.page - 1) * PAGE_SIZE;
    var pageRows = rows.slice(start, start + PAGE_SIZE);

    clear(table);

    var headRow = el("tr");
    DIVIDEND_COLUMNS.forEach(function (column) {
      var th = el("th", {
        className: column.num ? "num" : "",
        attrs: { scope: "col" }
      });

      if (column.sortable) {
        var active = state.sortKey === column.key;
        var button = el("button", {
          className: "sort-button",
          attrs: { type: "button" },
          text: column.label
        });
        button.setAttribute("data-active", String(active));
        button.appendChild(sortIcon(state.sortDirection, active));
        button.addEventListener("click", function () {
          if (state.sortKey === column.key) {
            state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
          } else {
            state.sortKey = column.key;
            state.sortDirection = column.num ? "desc" : "asc";
          }
          state.page = 1;
          renderDividendTable();
        });
        th.setAttribute(
          "aria-sort",
          active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none"
        );
        th.appendChild(button);
      } else {
        th.textContent = column.label;
      }
      headRow.appendChild(th);
    });
    table.appendChild(el("thead", {}, [headRow]));

    var body = el("tbody");
    if (!pageRows.length) {
      body.appendChild(
        el("tr", {}, [
          el("td", {
            className: "cell-muted",
            attrs: { colspan: DIVIDEND_COLUMNS.length },
            text: "没有符合当前筛选条件的记录。"
          })
        ])
      );
    }

    pageRows.forEach(function (row) {
      var tr = el("tr");
      DIVIDEND_COLUMNS.forEach(function (column) {
        var cell = el("td", { className: column.num ? "num" : "" });
        if (column.render) {
          cell.appendChild(column.render(row));
        } else if (column.key === "share_plan") {
          cell.textContent = sharePlanText(row);
          if (cell.textContent === "—") cell.className = "cell-muted";
        } else {
          var value = row[column.key];
          if (value === null || value === undefined || value === "") {
            cell.textContent = "—";
            cell.className += " cell-muted";
          } else if (column.format) {
            cell.textContent = column.format(value, 4);
          } else {
            cell.textContent = String(value);
          }
        }
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);

    var countNode = pick("tableCount");
    countNode.textContent =
      "共 " + rows.length + " 条记录" + (rows.length !== recordsOf(state.stockCode).length
        ? "（全部 " + recordsOf(state.stockCode).length + " 条）"
        : "") +
      " · 第 " + (rows.length ? start + 1 : 0) + "–" + (start + pageRows.length) + " 条";

    pick("pageStatus").textContent = state.page + " / " + pageCount;
    pick("prevPage").disabled = state.page <= 1;
    pick("nextPage").disabled = state.page >= pageCount;
  }

  function renderRights() {
    var block = pick("rightsBlock");
    var table = pick("rightsTable");
    var rows = DATA.rights.filter(function (row) {
      return row.stock_code === state.stockCode;
    });

    if (!rows.length) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    clear(table);

    var columns = [
      { key: "announce_date", label: "公告日期" },
      { key: "rights_per10", label: "配股(股/10股)", num: true },
      { key: "rights_price", label: "配股价(元)", num: true },
      { key: "base_share_capital", label: "基准股本(股)", num: true },
      { key: "ex_rights_date", label: "除权日" },
      { key: "record_date", label: "股权登记日" },
      { key: "payment_start", label: "缴款起始" },
      { key: "payment_end", label: "缴款终止" },
      { key: "listing_date", label: "配股上市日" }
    ];

    table.appendChild(
      el("thead", {}, [
        el("tr", {}, columns.map(function (column) {
          return el("th", { className: column.num ? "num" : "", attrs: { scope: "col" }, text: column.label });
        }))
      ])
    );

    var body = el("tbody");
    rows.forEach(function (row) {
      body.appendChild(
        el("tr", {}, columns.map(function (column) {
          var value = row[column.key];
          var cell = el("td", { className: column.num ? "num" : "" });
          if (value === null || value === undefined || value === "") {
            cell.textContent = "—";
            cell.className = "cell-muted";
          } else if (column.num) {
            cell.textContent = formatNumber(value, 2);
          } else {
            cell.textContent = String(value);
          }
          return cell;
        }))
      );
    });
    table.appendChild(body);
  }

  function renderDataset() {
    var rows = recordsOf(state.stockCode);
    renderStockMetrics(rows);
    renderChart(rows);
    renderDividendTable();
    renderRights();
  }

  /* ------------------------------------------------------------ 质量报告 */

  function renderQuality() {
    var quality = DATA.quality || {};

    var checkTable = pick("checkTable");
    clear(checkTable);
    checkTable.appendChild(
      el("thead", {}, [
        el("tr", {}, [
          el("th", { attrs: { scope: "col" }, text: "规则" }),
          el("th", { attrs: { scope: "col" }, text: "校验内容" }),
          el("th", { className: "num", attrs: { scope: "col" }, text: "命中" }),
          el("th", { attrs: { scope: "col" }, text: "状态" })
        ])
      ])
    );
    var checkBody = el("tbody");
    (quality.checks || []).forEach(function (check) {
      checkBody.appendChild(
        el("tr", {}, [
          el("td", {}, [
            el("span", { className: "badge badge-primary", text: check.id }),
            el("span", { text: " " + check.name })
          ]),
          el("td", { className: "cell-muted", text: check.description }),
          el("td", { className: "num", text: formatInt(check.hits) }),
          el("td", {}, [
            el("span", {
              className: check.passed ? "badge badge-ok" : "badge badge-warn",
              text: check.passed ? "通过" : "命中"
            })
          ])
        ])
      );
    });
    checkTable.appendChild(checkBody);

    var summary = pick("issueSummary");
    clear(summary);
    var summaryData = quality.issue_summary || {};
    var keys = Object.keys(summaryData);
    if (!keys.length) {
      summary.appendChild(el("li", {}, [el("span", { text: "无问题记录" }), el("span", { className: "count", text: "0" })]));
    } else {
      keys.forEach(function (level) {
        summary.appendChild(
          el("li", {}, [
            levelBadge(level),
            el("span", { className: "count", text: formatInt(summaryData[level]) })
          ])
        );
      });
    }

    var notes = pick("notes");
    clear(notes);
    (quality.notes || []).forEach(function (note) {
      notes.appendChild(el("li", { text: note }));
    });

    var COVERAGE_KEYS = [
      "stock_code",
      "announce_date",
      "dividend_year",
      "status",
      "cash_per10_pretax",
      "ex_dividend_date",
      "record_date",
      "bonus_listing_date",
      "detail_cash_pretax",
      "shareholders_meeting_date"
    ];
    var coverage = quality.field_coverage || {};
    var coverageList = pick("coverage");
    clear(coverageList);
    COVERAGE_KEYS.forEach(function (key) {
      var item = coverage[key];
      if (!item) return;
      var rate = Math.round((item.rate || 0) * 100);
      var level = rate >= 99 ? "full" : rate >= 60 ? "partial" : "low";
      coverageList.appendChild(
        el("li", {}, [
          el("span", { className: "coverage-label", text: item.label || key }),
          el("span", { className: "coverage-value", text: rate + "% · " + item.non_null + "/" + item.total }),
          el("span", { className: "coverage-track" }, [
            el("span", { className: "coverage-fill", attrs: { "data-level": level, style: "width:" + rate + "%" } })
          ])
        ])
      );
    });

    var issueTable = pick("issueTable");
    clear(issueTable);
    issueTable.appendChild(
      el("thead", {}, [
        el("tr", {}, [
          el("th", { attrs: { scope: "col" }, text: "股票代码" }),
          el("th", { attrs: { scope: "col" }, text: "记录编号" }),
          el("th", { attrs: { scope: "col" }, text: "规则" }),
          el("th", { attrs: { scope: "col" }, text: "级别" }),
          el("th", { attrs: { scope: "col" }, text: "说明" })
        ])
      ])
    );
    var issueBody = el("tbody");
    if (!DATA.issues.length) {
      issueBody.appendChild(
        el("tr", {}, [
          el("td", { className: "cell-muted", attrs: { colspan: 5 }, text: "全部规则通过，无问题记录。" })
        ])
      );
    }
    DATA.issues.forEach(function (issue) {
      issueBody.appendChild(
        el("tr", {}, [
          el("td", { text: issue.stock_code }),
          el("td", { text: issue.record_id }),
          el("td", {}, [el("span", { className: "badge badge-primary", text: issue.rule })]),
          el("td", {}, [levelBadge(issue.level)]),
          el("td", { className: "cell-muted", text: issue.message })
        ])
      );
    });
    issueTable.appendChild(issueBody);
  }

  /* ------------------------------------------------------------ 交付物表 */

  function renderFileTable() {
    var rows = [
      ["scripts/config.py", "数据源、目标股票、字段字典与抓取参数配置"],
      ["scripts/fetch_sina.py", "抓取列表页与明细页，限速重试并落地原始 HTML"],
      ["scripts/preprocess.py", "解析、清洗、校验并导出数据集与质量报告"],
      ["scripts/build_site.py", "把数据集打包成本页加载的 data.js"],
      ["data/dividends.csv", "分红明细，中文表头，UTF-8 BOM，可直接用 Excel 打开"],
      ["data/rights.csv", "配股明细"],
      ["data/stocks.csv", "股票维度汇总：记录数、累计每股派息、最近公告"],
      ["data/issues.csv", "逐条数据质量问题日志"],
      ["data/quality_report.json", "字段覆盖率、规则执行结果与口径说明"],
      ["data/raw/", "原始 HTML 缓存，用于离线复现与追溯（不纳入版本库）"],
      ["site/index.html", "本页面，展示实现过程、数据结果与质量报告"],
      ["tests/site.spec.js", "Playwright 端到端测试用例"],
      ["docs/", "需求确认单、测试报告与 Agent 对话记录"],
      ["design-system/", "ui-ux-pro-max 生成的设计系统与适配说明"]
    ];

    var table = pick("fileTable");
    clear(table);
    table.appendChild(
      el("thead", {}, [
        el("tr", {}, [
          el("th", { attrs: { scope: "col" }, text: "路径" }),
          el("th", { attrs: { scope: "col" }, text: "说明" })
        ])
      ])
    );
    var body = el("tbody");
    rows.forEach(function (row) {
      body.appendChild(
        el("tr", {}, [
          el("td", {}, [el("code", { text: row[0] })]),
          el("td", { className: "cell-muted", text: row[1] })
        ])
      );
    });
    table.appendChild(body);
  }

  function renderTestNote() {
    var node = pick("testNote");
    var quality = DATA.quality || {};
    var counts = quality.counts || {};
    node.textContent =
      "端到端用例覆盖首屏渲染、股票切换、方案筛选、排序、分页、键盘可达与移动端布局；" +
      "被测数据集为 " + (counts.dividend_records || DATA.dividends.length) + " 条分红记录与 " +
      (counts.rights_records || DATA.rights.length) + " 条配股记录，完整结果见 docs/测试报告.md。";
  }

  /* ---------------------------------------------------------------- 事件 */

  function bindEvents() {
    var search = pick("searchInput");
    search.addEventListener("input", function () {
      state.search = search.value;
      state.page = 1;
      renderDividendTable();
    });

    pickAll("filter").forEach(function (input) {
      input.addEventListener("change", function () {
        state.filters = pickAll("filter")
          .filter(function (item) {
            return item.checked;
          })
          .map(function (item) {
            return item.value;
          });
        state.page = 1;
        renderDividendTable();
      });
    });

    pick("prevPage").addEventListener("click", function () {
      state.page = Math.max(1, state.page - 1);
      renderDividendTable();
    });

    pick("nextPage").addEventListener("click", function () {
      state.page += 1;
      renderDividendTable();
    });

    window.addEventListener("resize", function () {
      renderChart(recordsOf(state.stockCode));
    });
  }

  function init() {
    renderMeta();
    renderOverview();
    renderPipelineFacts();
    renderStockTable();
    renderStockSelector();
    renderDataset();
    renderQuality();
    renderFileTable();
    renderTestNote();
    bindEvents();
    document.body.setAttribute("data-ready", "true");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
