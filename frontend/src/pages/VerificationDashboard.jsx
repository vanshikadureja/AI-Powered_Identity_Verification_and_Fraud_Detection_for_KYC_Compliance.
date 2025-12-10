// src/pages/VerificationDashboard.jsx
import React, { useEffect, useState } from "react";
import "./VerificationDashboard.css";
import { useNavigate } from "react-router-dom";
import toast, { Toaster } from "react-hot-toast";

const SAMPLE_DASHBOARD = {
  summary: {
    total_docs: 2,
    valid_docs: 0,
    high_risk: 0,
    avg_fraud_score: 70,
    risk_distribution: {
      valid: 0,
      medium: 2,
      high: 0,
    },
    overall_risk: "Medium Risk - Manual review recommended",
  },
  aadhaar: {
    title: "Aadhaar Verification",
    status: "Invalid Document",
    fraud_score: 70,
    risk_level: "Medium",
    reasons: [
      "Duplicate submission detected.",
      "Name on document does not closely match user input.",
    ],
  },
  pan: {
    title: "PAN Verification",
    status: "Invalid Document",
    fraud_score: 70,
    risk_level: "Medium",
    reasons: [
      "Duplicate submission detected.",
      "Name on document does not closely match user input.",
    ],
  },
};

const riskClass = (level) => {
  if (!level) return "risk-chip low";
  const lv = String(level).toUpperCase();
  if (lv.includes("HIGH")) return "risk-chip high";
  if (lv.includes("MED")) return "risk-chip med";
  return "risk-chip low";
};

export default function VerificationDashboard() {
  const navigate = useNavigate();

  const [data, setData] = useState(SAMPLE_DASHBOARD);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(
          "http://127.0.0.1:5000/verification-dashboard"
        );
        if (!res.ok) {
          setData(SAMPLE_DASHBOARD);
          return;
        }
        const json = await res.json();
        setData({
          summary: json.summary || SAMPLE_DASHBOARD.summary,
          aadhaar: json.aadhaar || SAMPLE_DASHBOARD.aadhaar,
          pan: json.pan || SAMPLE_DASHBOARD.pan,
        });
      } catch (err) {
        console.error("dashboard load error:", err);
        toast.error("Using sample dashboard data (backend not reachable)");
        setData(SAMPLE_DASHBOARD);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const goHome = () => navigate("/home" || "/");
  const goUpload = () => navigate("/upload");
  const goDocs = () => navigate("/documents");
  const doLogout = () => navigate("/login" || "/");

  const { summary, aadhaar, pan } = data;

  const totalRiskSlices =
    (summary?.risk_distribution?.valid || 0) +
      (summary?.risk_distribution?.medium || 0) +
      (summary?.risk_distribution?.high || 0) || 1;

  const validPct =
    ((summary?.risk_distribution?.valid || 0) / totalRiskSlices) * 100;
  const medPct =
    ((summary?.risk_distribution?.medium || 0) / totalRiskSlices) * 100;
  const highPct =
    ((summary?.risk_distribution?.high || 0) / totalRiskSlices) * 100;

  const ringStyle = {
    background: `conic-gradient(
      #16a34a 0 ${validPct}%,
      #facc15 ${validPct}% ${validPct + medPct}%,
      #ef4444 ${validPct + medPct}% 100%
    )`,
  };

  return (
    <div className="verify-page">
      <Toaster position="top-right" />

      <nav className="verify-nav">
        <div className="logo">🟡 SecureKYC</div>
        <div className="nav-links">
          <button className="nav-link" onClick={goHome}>Home</button>
          <button className="nav-link" onClick={goUpload}>KYC Upload</button>
          <button className="nav-link" onClick={goDocs}>My Documents</button>
          <button className="btn-logout" onClick={doLogout}>Logout</button>
        </div>
      </nav>

      <main className="verify-container">
        <section className="verify-row">
          <VerificationCard data={aadhaar} loading={loading} />
          <VerificationCard data={pan} loading={loading} />
        </section>

        <section className="summary-card">
          <h2 className="summary-title">Overall Fraud Risk Dashboard</h2>

          <div className="summary-grid">
            <div className="summary-metrics">
              <MetricTile label="Total Documents" value={summary?.total_docs ?? "-"} />
              <MetricTile label="Valid Documents" value={summary?.valid_docs ?? "-"} />
              <MetricTile label="High Risk" value={summary?.high_risk ?? "-"} />
              <MetricTile
                label="Avg. Fraud Score"
                value={
                  summary?.avg_fraud_score != null
                    ? `${summary.avg_fraud_score.toFixed(1)}%`
                    : "-"
                }
              />
            </div>

            <div className="summary-chart">
              <h3>Risk Distribution</h3>
              <div className="ring-wrapper">
                <div className="risk-ring" style={ringStyle}>
                  <div className="risk-ring-inner">
                    <span className="ring-value">
                      {summary?.avg_fraud_score != null
                        ? `${summary.avg_fraud_score.toFixed(0)}%`
                        : "--"}
                    </span>
                    <span className="ring-label">Avg Fraud</span>
                  </div>
                </div>
              </div>

              <div className="ring-legend">
                <div className="leg-item"><span className="dot valid" /> Valid</div>
                <div className="leg-item"><span className="dot medium" /> Medium Risk</div>
                <div className="leg-item"><span className="dot high" /> High Risk</div>
              </div>
            </div>
          </div>

          <div className="risk-assessment">
            <div className="risk-assessment-icon">⚠</div>
            <div>
              <div className="risk-assessment-title">Risk Assessment</div>
              <div className="risk-assessment-text">
                {summary?.overall_risk || "Medium Risk – Manual review recommended"}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ========== UPDATED VERIFICATION CARD ONLY ========== */

function VerificationCard({ data, loading }) {
  if (!data) return null;

  // ⭐ NEW: Dynamic validity graph (green = verified, red = unverified)
  const rawFraud = Number(data.fraud_score || 0);
  const fraudScore = Math.max(0, Math.min(100, rawFraud));
  const verifiedPct = 100 - fraudScore;

  const validityStyle = {
    background: `conic-gradient(
      #16a34a 0 ${verifiedPct}%,
      #ef4444 ${verifiedPct}% 100%
    )`,
  };
  // ⭐ END NEW

  const statusClass =
    data.status && String(data.status).toLowerCase().includes("valid")
      ? "status-valid"
      : "status-invalid";

  const barHeight = Math.max(
    5,
    Math.min(100, Number(data.fraud_score || 0))
  );

  return (
    <article className="verify-card">
      <header className="verify-card-header">
        <h2>{data.title}</h2>
      </header>

      <div className="verify-body">
        <p className="status-row">
          <span className="status-label">Status:</span>{" "}
          <span className={statusClass}>
            {loading ? "Loading…" : data.status || "Unknown"}
          </span>
        </p>

        <p className="metric-row">
          <span className="metric-label">Fraud Score:</span>
          <span className="metric-value">
            {data.fraud_score != null ? `${data.fraud_score}%` : "--"}
          </span>
        </p>

        <p className="metric-row">
          <span className="metric-label">Risk Level:</span>
          <span className={riskClass(data.risk_level)}>
            {data.risk_level || "Unknown"}
          </span>
        </p>

        {Array.isArray(data.reasons) && data.reasons.length > 0 && (
          <div className="reasons-block">
            <div className="reasons-title">Reasons:</div>
            <ul>
              {data.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mini-charts">
          <div className="mini-card">
            <div className="mini-title">Fraud Risk Score</div>
            <div className="bar-chart">
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ height: `${barHeight}%` }}
                />
              </div>
              <div className="bar-scale">
                <span>Low</span>
                <span>Medium</span>
                <span>High</span>
              </div>
            </div>
          </div>

          <div className="mini-card">
            <div className="mini-title">Document Validity</div>
            <div className="validity-pie">
              <div className="validity-pie-outer" style={validityStyle}>
                <div className="validity-pie-inner" />
              </div>
              <div className="validity-legend">
                <span className="dot valid" /> Verified
                <span className="dot unverified" /> Unverified
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function MetricTile({ label, value }) {
  return (
    <div className="metric-tile">
      <div className="metric-tile-label">{label}</div>
      <div className="metric-tile-value">{value}</div>
    </div>
  );
}
