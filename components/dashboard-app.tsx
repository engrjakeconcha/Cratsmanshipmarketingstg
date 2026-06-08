"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DashboardMetricKey,
  DashboardPayload,
  DashboardRow,
  MetricSnapshot,
} from "@/lib/dashboard";

type DashboardAppProps = {
  initialPayload: DashboardPayload;
};

type DateRange = {
  from: string;
  to: string;
};

type SortKey =
  | "service"
  | "leads"
  | "booked"
  | "spend"
  | "cpl"
  | "costPerAppt"
  | "leadToBooking";

const ALL_LOCATIONS = "All Locations";

const CARD_CONFIG: Array<{
  title: string;
  key: DashboardMetricKey;
  format: (value: number) => string;
  group: "pipeline" | "spend" | "conversion";
}> = [
  { title: "Leads", key: "leads", format: numberFormat, group: "pipeline" },
  {
    title: "Booked Appts",
    key: "booked",
    format: numberFormat,
    group: "pipeline",
  },
  {
    title: "Amount Spent",
    key: "spend",
    format: currencyFormat0,
    group: "spend",
  },
  {
    title: "Cost per Lead",
    key: "cpl",
    format: currencyFormat2,
    group: "spend",
  },
  {
    title: "Cost per Appt",
    key: "costPerAppt",
    format: currencyFormat2,
    group: "spend",
  },
  {
    title: "Lead → Booking %",
    key: "leadToBooking",
    format: percentFormat,
    group: "conversion",
  },
];

const SORT_COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "service", label: "Service" },
  { key: "leads", label: "Leads", numeric: true },
  { key: "booked", label: "Appts", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
  { key: "cpl", label: "CPL", numeric: true },
  { key: "costPerAppt", label: "CPA", numeric: true },
  { key: "leadToBooking", label: "Lead → Book %", numeric: true },
];

export function DashboardApp({ initialPayload }: DashboardAppProps) {
  const [payload, setPayload] = useState(initialPayload);
  const [selectedLocation, setSelectedLocation] = useState(ALL_LOCATIONS);
  const [selectedService, setSelectedService] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    getDefaultDateRange(initialPayload.rows),
  );
  const [sortKey, setSortKey] = useState<SortKey>("booked");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const refreshMs = Number(process.env.NEXT_PUBLIC_REFRESH_MS ?? 300000);
    const interval = window.setInterval(async () => {
      setIsRefreshing(true);
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const nextPayload = (await response.json()) as DashboardPayload;
        setPayload(nextPayload);
      } finally {
        setIsRefreshing(false);
      }
    }, refreshMs);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (
      selectedLocation !== ALL_LOCATIONS &&
      !payload.meta.locations.includes(selectedLocation)
    ) {
      setSelectedLocation(ALL_LOCATIONS);
    }
  }, [payload.meta.locations, selectedLocation]);

  const services = useMemo(() => {
    const options = new Set<string>();
    payload.rows.forEach((row) => {
      if (
        selectedLocation === ALL_LOCATIONS ||
        row.location === selectedLocation
      ) {
        options.add(row.service);
      }
    });
    return ["all", ...Array.from(options).sort((a, b) => a.localeCompare(b))];
  }, [payload.rows, selectedLocation]);

  useEffect(() => {
    if (!services.includes(selectedService)) {
      setSelectedService("all");
    }
  }, [services, selectedService]);

  const filteredRows = useMemo(
    () =>
      payload.rows.filter((row) => {
        if (
          selectedLocation !== ALL_LOCATIONS &&
          row.location !== selectedLocation
        ) {
          return false;
        }
        if (selectedService !== "all" && row.service !== selectedService) {
          return false;
        }
        return row.date >= dateRange.from && row.date <= dateRange.to;
      }),
    [payload.rows, selectedLocation, selectedService, dateRange],
  );

  const previousRange = useMemo(() => shiftDateRange(dateRange), [dateRange]);

  const previousRows = useMemo(
    () =>
      payload.rows.filter((row) => {
        if (
          selectedLocation !== ALL_LOCATIONS &&
          row.location !== selectedLocation
        ) {
          return false;
        }
        if (selectedService !== "all" && row.service !== selectedService) {
          return false;
        }
        return row.date >= previousRange.from && row.date <= previousRange.to;
      }),
    [payload.rows, selectedLocation, selectedService, previousRange],
  );

  const currentMetrics = useMemo(
    () => summarizeMetrics(filteredRows),
    [filteredRows],
  );
  const previousMetrics = useMemo(
    () => summarizeMetrics(previousRows),
    [previousRows],
  );

  const rowsByService = useMemo(() => {
    const serviceMap = new Map<string, DashboardRow[]>();

    filteredRows.forEach((row) => {
      const current = serviceMap.get(row.service) ?? [];
      current.push(row);
      serviceMap.set(row.service, current);
    });

    const summaries = Array.from(serviceMap.entries()).map(([service, rows]) => ({
      service,
      ...summarizeMetrics(rows),
    }));

    summaries.sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];

      if (sortKey === "service") {
        return sortDirection === "asc"
          ? left.service.localeCompare(right.service)
          : right.service.localeCompare(left.service);
      }

      return sortDirection === "asc"
        ? Number(leftValue) - Number(rightValue)
        : Number(rightValue) - Number(leftValue);
    });

    return summaries;
  }, [filteredRows, sortDirection, sortKey]);

  const statusMessage = useMemo(() => {
    if (payload.meta.source === "sample-fallback") {
      return "Showing sample fallback data until Google Sheets credentials are connected.";
    }
    if (payload.meta.warning) {
      return payload.meta.warning;
    }
    return `Last synced ${new Date(payload.meta.fetchedAt).toLocaleString()}`;
  }, [payload.meta]);

  const rangeLabel = formatRangeLabel(dateRange);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="header-topline">
          <a className="site-logo-link" href="https://craftsmanshipmarketing.com/">
            <img
              src="/craftsmanship-logo-horizontal-reversed.png"
              alt="Craftsmanship Marketing"
              className="header-logo"
            />
          </a>
          <nav className="site-nav" aria-label="Craftsmanship Marketing">
            <a href="https://craftsmanshipmarketing.com/">Home</a>
            <a href="https://craftsmanshipmarketing.com/services/">Services</a>
            <a href="https://craftsmanshipmarketing.com/blog/">Blog</a>
            <a href="https://funnels.craftsmanshipmarketing.com/">Contact</a>
          </nav>
          <div className="header-controls">
            <label className="inline-select">
              <span>Location</span>
              <select
                value={selectedLocation}
                onChange={(event) => setSelectedLocation(event.target.value)}
              >
                <option value={ALL_LOCATIONS}>{ALL_LOCATIONS}</option>
                {payload.meta.locations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>
            <div className="header-date-filters">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={(event) =>
                    setDateRange((current) => ({
                      ...current,
                      from: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={(event) =>
                    setDateRange((current) => ({
                      ...current,
                      to: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={async () => {
                await fetch("/api/auth", { method: "DELETE" });
                window.location.href = "/login";
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="toolbar">
          <div className="service-pills">
            {services.map((service) => (
              <button
                key={service}
                type="button"
                onClick={() => setSelectedService(service)}
                className={service === selectedService ? "pill active" : "pill"}
              >
                {service === "all" ? "All Services" : service}
              </button>
            ))}
          </div>
        </section>

        <section className="status-bar">
          <span>{statusMessage}</span>
          <span>{isRefreshing ? "Refreshing..." : rangeLabel}</span>
        </section>

        <MetricSection
          title="Pipeline"
          cards={CARD_CONFIG.filter((card) => card.group === "pipeline")}
          metrics={currentMetrics}
          previous={previousMetrics}
        />
        <MetricSection
          title="Spend & Efficiency"
          cards={CARD_CONFIG.filter((card) => card.group === "spend")}
          metrics={currentMetrics}
          previous={previousMetrics}
        />
        <MetricSection
          title="Conversion"
          cards={CARD_CONFIG.filter((card) => card.group === "conversion")}
          metrics={currentMetrics}
          previous={previousMetrics}
          compact
        />

        {selectedService === "all" ? (
          <section className="table-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Performance by Service</p>
                <h2>Service breakdown</h2>
              </div>
              <p className="section-meta">Click any column header to sort</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {SORT_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        className={column.numeric ? "numeric" : ""}
                      >
                        <button
                          type="button"
                          className="sort-button"
                          onClick={() => {
                            if (sortKey === column.key) {
                              setSortDirection((current) =>
                                current === "asc" ? "desc" : "asc",
                              );
                              return;
                            }
                            setSortKey(column.key);
                            setSortDirection(
                              column.key === "service" ? "asc" : "desc",
                            );
                          }}
                        >
                          <span>{column.label}</span>
                          <span className="sort-indicator">
                            {sortKey === column.key
                              ? sortDirection === "asc"
                                ? "↑"
                                : "↓"
                              : "↕"}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsByService.map((row) => (
                    <tr key={row.service}>
                      <td>{row.service}</td>
                      <td className="numeric">{numberFormat(row.leads)}</td>
                      <td className="numeric">{numberFormat(row.booked)}</td>
                      <td className="numeric">{currencyFormat0(row.spend)}</td>
                      <td className="numeric">{currencyFormat2(row.cpl)}</td>
                      <td className="numeric">
                        {currencyFormat2(row.costPerAppt)}
                      </td>
                      <td className="numeric">{percentFormat(row.leadToBooking)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </main>
      <footer className="dashboard-footer">
        <div className="footer-inner">
          <div>
            <img
              src="/craftsmanship-logo-horizontal-reversed.png"
              alt="Craftsmanship Marketing"
              className="footer-logo"
            />
            <p>
              Grow your business with an all-in-one marketing solution for home
              remodelers.
            </p>
          </div>
          <nav className="footer-links" aria-label="Footer">
            <a href="https://craftsmanshipmarketing.com/privacy-policy/">Privacy</a>
            <a href="https://craftsmanshipmarketing.com/terms-and-conditions/">
              Terms and Conditions
            </a>
            <a href="https://www.youtube.com/@craftsmanshipmarketing">
              @craftsmanshipmarketing
            </a>
          </nav>
          <address>
            716 Main St, Martinez, CA 94553
            <br />
            <a href="mailto:keone.moore@craftsmanshipmarketing.com">
              keone.moore@craftsmanshipmarketing.com
            </a>
            <br />
            <a href="tel:9256334431">925.633.4431</a>
          </address>
        </div>
        <p className="footer-fineprint">
          © Craftsmanship Marketing 2022. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

function MetricSection({
  title,
  cards,
  metrics,
  previous,
  compact = false,
}: {
  title: string;
  cards: Array<{
    title: string;
    key: DashboardMetricKey;
    format: (value: number) => string;
    group: "pipeline" | "spend" | "conversion";
  }>;
  metrics: MetricSnapshot;
  previous: MetricSnapshot;
  compact?: boolean;
}) {
  return (
    <section className="metrics-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{title}</p>
        </div>
      </div>
      <div className={compact ? "metric-grid compact" : "metric-grid"}>
        {cards.map((card) => (
          <article key={card.key} className="metric-card">
            <div className="metric-topline">
              <span>{card.title}</span>
            </div>
            <div className="metric-value">{card.format(metrics[card.key])}</div>
            <MetricDelta
              current={metrics[card.key]}
              previous={previous[card.key]}
              metricKey={card.key}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function MetricDelta({
  current,
  previous,
  metricKey,
}: {
  current: number;
  previous: number;
  metricKey: DashboardMetricKey;
}) {
  if (previous === 0 && current === 0) {
    return <p className="metric-delta neutral">No change vs prior period</p>;
  }

  if (previous === 0) {
    return <p className="metric-delta positive">New activity vs prior period</p>;
  }

  const percent = ((current - previous) / previous) * 100;
  const increasingIsGood = !["spend", "cpl", "costPerAppt"].includes(metricKey);
  const isPositive = percent === 0 ? null : increasingIsGood ? percent > 0 : percent < 0;

  return (
    <p
      className={
        isPositive === null
          ? "metric-delta neutral"
          : isPositive
            ? "metric-delta positive"
            : "metric-delta negative"
      }
    >
      {percent > 0 ? "+" : ""}
      {percent.toFixed(1)}% vs prior period
    </p>
  );
}

function summarizeMetrics(rows: DashboardRow[]): MetricSnapshot {
  const totals = rows.reduce(
    (accumulator, row) => {
      accumulator.leads += row.leads;
      accumulator.booked += row.booked;
      accumulator.spend += row.spend;
      return accumulator;
    },
    { leads: 0, booked: 0, spend: 0 },
  );

  return {
    leads: totals.leads,
    booked: totals.booked,
    spend: totals.spend,
    cpl: totals.leads ? totals.spend / totals.leads : 0,
    costPerAppt: totals.booked ? totals.spend / totals.booked : 0,
    leadToBooking: totals.leads ? totals.booked / totals.leads : 0,
  };
}

function getDefaultDateRange(rows: DashboardRow[]): DateRange {
  if (rows.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return { from: today, to: today };
  }

  const sortedDates = rows.map((row) => row.date).sort();
  const latest = new Date(`${sortedDates.at(-1)}T00:00:00`);
  const earliest = new Date(`${sortedDates[0]}T00:00:00`);
  const defaultFrom = new Date(latest);
  defaultFrom.setDate(defaultFrom.getDate() - 29);

  return {
    from: formatDateInput(defaultFrom < earliest ? earliest : defaultFrom),
    to: formatDateInput(latest),
  };
}

function shiftDateRange(range: DateRange): DateRange {
  const from = new Date(`${range.from}T00:00:00`);
  const to = new Date(`${range.to}T00:00:00`);
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const previousTo = new Date(from);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - (spanDays - 1));

  return {
    from: formatDateInput(previousFrom),
    to: formatDateInput(previousTo),
  };
}

function formatRangeLabel(range: DateRange): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${formatter.format(new Date(`${range.from}T00:00:00`))} – ${formatter.format(
    new Date(`${range.to}T00:00:00`),
  )}`;
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function currencyFormat0(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function currencyFormat2(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function percentFormat(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function numberFormat(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
