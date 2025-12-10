import React, { useEffect, useState, useMemo } from "react";
import { saveAs } from "file-saver";
import toast from "react-hot-toast";
import "./FraudAlerts.css";

// ⭐ UPDATED — EXACT FORMAT: 09/12/2025 05:33:21 PM
function formatDate(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);

    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();

    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");

    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    hours = String(hours).padStart(2, "0");

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds} ${ampm}`;
  } catch {
    return ts;
  }
}

function riskBadgeLabel(score) {
  const n = Number(score) || 0;
  if (n > 70) return { label: "High", cls: "badge-high" };
  if (n > 30) return { label: "Medium", cls: "badge-medium" };
  return { label: "Low", cls: "badge-low" };
}

// Detect document type from various possible fields
function detectDocType(r) {
  const fraud = r.fraud_result || {};

  if (fraud.document_type) return String(fraud.document_type).toLowerCase();
  if (r.document_type) return String(r.document_type).toLowerCase();
  if (r.doc_type) return String(r.doc_type).toLowerCase();
  if (r.aadhaar_ocr) return "aadhaar";
  if (r.pan_ocr) return "pan";
  return "document";
}

// Extract confidence safely
function extractConfidence(r) {
  const fraud = r.fraud_result || {};
  let c =
    fraud.confidence ??
    fraud.confidence_score ??
    fraud.risk_score ??
    fraud.match_score ??
    fraud.similarity ??
    r.confidence ??
    r.score ??
    null;

  if (c === null || c === undefined || c === "" || isNaN(Number(c))) {
    const fs = Number(fraud.fraud_score ?? r.fraud_score ?? 0);

    if (fs > 70) return 90;
    if (fs > 30) return 75;
    return 60;
  }

  c = Number(c);
  if (c > 0 && c <= 1) c = c * 100;

  c = Math.min(100, Math.max(0, c));

  if (c <= 1) {
    const fs = Number(fraud.fraud_score ?? r.fraud_score ?? 0);
    if (fs > 70) return 90;
    if (fs > 30) return 75;
    return 60;
  }

  return Math.round(c);
}

// Build readable fraud reasons
function buildRiskReason(r) {
  const fraud = r.fraud_result || {};
  const reasons = [];

  // 0) backend flags_text if meaningful
  if (fraud.flags_text && fraud.flags_text.trim()) {
    const txt = fraud.flags_text.trim().toLowerCase();
    if (!["low", "medium", "high"].includes(txt)) {
      return fraud.flags_text.trim();
    }
  }

  // 1) raw flags
  let flags = [];
  const flagsRaw =
    fraud.flags ||
    fraud.flag_codes ||
    fraud.reasons ||
    fraud.reason_codes ||
    r.flags;

  if (Array.isArray(flagsRaw)) {
    flags = flagsRaw.map((f) => String(f).toLowerCase());
  }

  const add = (msg) => {
    if (msg && !reasons.includes(msg)) reasons.push(msg);
  };

  if (flags.includes("duplicate_submission"))
    add("Duplicate submission detected");
  if (flags.includes("name_mismatch"))
    add("Name on document does not closely match user input");
  if (flags.includes("duplicate_aadhaar"))
    add("Duplicate Aadhaar detected");
  if (flags.includes("duplicate_pan")) add("Duplicate PAN detected");
  if (flags.includes("aadhaar_pan_duplicate"))
    add("Aadhaar/PAN matches an existing record (duplicate)");

  if (reasons.length > 0) return reasons.join(", ");

  // 2) fallback textual fields
  const texts = [
    fraud.reason,
    fraud.reason_text,
    fraud.description,
    fraud.message,
    r.reason,
    r.reason_text,
    r.description,
    r.message,
    r.notes,
  ].filter((x) => typeof x === "string" && x.trim().length > 0);

  if (texts.length) return texts.join(", ");

  // 3) last fallback
  return "No anomalies detected for this KYC submission";
}

export default function FraudAlerts() {
  const [agg, setAgg] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRisk, setFilterRisk] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadAggregate(), loadRecords()]);
    setLoading(false);
  }

  async function loadAggregate() {
    try {
      const res = await fetch("http://127.0.0.1:8000/fraud-aggregate");
      const json = await res.json();
      setAgg(json);
    } catch {
      setAgg(null);
    }
  }

  async function loadRecords() {
    try {
      const res = await fetch("http://127.0.0.1:5000/get_kyc_data");
      const json = await res.json();

      const rows = (json.records || []).map((r) => {
        const fs = Number(r.fraud_result?.fraud_score ?? r.fraud_score ?? 0);

        return {
          id: r._id || r.id || r.case_id,
          user_name: r.user_name || r.customer_name,
          reason: buildRiskReason(r),
          doc_type: detectDocType(r),
          timestamp: r.timestamp || r.createdAt,
          fraud_score: fs,
          confidence: extractConfidence(r),
        };
      });

      setRecords(rows);
    } catch (err) {
      console.log(err);
      toast.error("Failed to load alerts");
      setRecords([]);
    }
  }

  const filtered = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    return records.filter((r) => {
      if (filterRisk !== "all") {
        if (filterRisk === "high" && r.fraud_score <= 70) return false;
        if (filterRisk === "medium" && (r.fraud_score <= 30 || r.fraud_score > 70))
          return false;
        if (filterRisk === "low" && r.fraud_score > 30) return false;
      }

      if (!q) return true;

      return (
        String(r.id).toLowerCase().includes(q) ||
        String(r.reason).toLowerCase().includes(q) ||
        String(r.doc_type).toLowerCase().includes(q) ||
        String(r.user_name).toLowerCase().includes(q)
      );
    });
  }, [records, filterRisk, query]);

  function exportCSV() {
    const header = [
      "Case ID",
      "Risk Level",
      "Reason",
      "Document Type",
      "Timestamp",
      "Confidence",
    ].join(",");

    const lines = filtered.map((r) =>
      [
        `"${r.id}"`,
        `"${riskBadgeLabel(r.fraud_score).label}"`,
        `"${String(r.reason).replace(/"/g, '""')}"`,
        `"${r.doc_type}"`,
        `"${formatDate(r.timestamp)}"`,
        `"${r.confidence}"`,
      ].join(",")
    );

    const csv = [header, ...lines].join("\n");
    saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "fraud_alerts.csv");
  }

  return (
    <div className="fraud-alerts-page">
      <div className="topbar">
        <div className="brand">
          <div className="shield">🛡</div>
          <div className="brand-text">SecureKYC</div>
        </div>

        <nav className="nav-row">
          <a className="nav-link" href="/">Home</a>
          <a className="nav-link" href="/kyc-requests">KYC Requests</a>
          <a className="nav-link active" href="/fraud">Fraud Alerts</a>
          <a className="nav-link" href="/audit-trail">Audit Trail</a>
          <button className="logout" onClick={() => (window.location.href = "/")}>
            Logout
          </button>
        </nav>
      </div>

      <header className="hero">
        <div className="hero-icon">⚠️</div>
        <div className="hero-text">
          <h1>Monitor and manage security incidents in real time</h1>
          <p className="muted">Quickly triage suspicious KYC submissions and export reports.</p>
        </div>
      </header>

      <section className="stat-cards">
        <div className="stat-card">
          <div className="stat-title">High Risk</div>
          <div className="stat-value">
            {agg?.riskBuckets?.High ?? records.filter((r) => r.fraud_score > 70).length}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Medium Risk</div>
          <div className="stat-value">
            {agg?.riskBuckets?.Medium ??
              records.filter((r) => r.fraud_score > 30 && r.fraud_score <= 70).length}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Low Risk</div>
          <div className="stat-value">
            {agg?.riskBuckets?.Low ?? records.filter((r) => r.fraud_score <= 30).length}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Total Alerts</div>
          <div className="stat-value">{records.length}</div>
        </div>
      </section>

      <section className="controls">
        <div className="search-box">
          <input
            placeholder="Search case ID, reason, user or doc..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="filters">
          <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)}>
            <option value="all">All Risk Levels</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <button className="btn export" onClick={exportCSV}>
            Export CSV
          </button>
        </div>
      </section>

      <section className="alerts-table">
        <div className="table-head">
          <div className="th case">Case ID</div>
          <div className="th risk">Risk Level</div>
          <div className="th reason">Reason</div>
          <div className="th doc">Document Type</div>
          <div className="th time">Timestamp</div>
          <div className="th conf">Confidence</div>
        </div>

        <div className="table-body">
          {loading && <div className="row loading">Loading…</div>}

          {!loading && filtered.length === 0 && (
            <div className="row empty">No alerts found</div>
          )}

          {!loading &&
            filtered.map((r) => {
              const risk = riskBadgeLabel(r.fraud_score);
              return (
                <div className="row" key={r.id}>
                  <div className="cell case mono">{r.id}</div>
                  <div className="cell risk">
                    <span className={`badge ${risk.cls}`}>{risk.label}</span>
                  </div>
                  <div className="cell reason">
                    {String(r.reason).length > 180
                      ? String(r.reason).slice(0, 180) + "…"
                      : r.reason}
                  </div>
                  <div className="cell doc">{r.doc_type}</div>
                  <div className="cell time">{formatDate(r.timestamp)}</div>
                  <div className="cell conf">{r.confidence}%</div>
                </div>
              );
            })}
        </div>
      </section>
    </div>
  );
}
