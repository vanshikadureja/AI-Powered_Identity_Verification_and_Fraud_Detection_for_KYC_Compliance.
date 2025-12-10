// src/pages/FraudDashboard.jsx (PATCHED + FULLY THEMED)
import React, { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import "./FraudDashboard.css";

const Badge = ({ children, tone = "yellow" }) => {
  const cls =
    tone === "green"
      ? "badge badge-green"
      : tone === "red"
      ? "badge badge-red"
      : "badge badge-yellow";
  return <span className={cls}>{children}</span>;
};

export default function FraudDashboard() {
  const [loading, setLoading] = useState(true);
  const [aggregate, setAggregate] = useState(null);
  const [records, setRecords] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState("all");

  useEffect(() => {
    loadAggregate();
    loadRecords();
  }, []);

  // -----------------------
  // AGGREGATE STATS
  // -----------------------
  const loadAggregate = async () => {
    try {
      const res = await fetch("http://127.0.0.1:5000/fraud-aggregate");
      const json = await res.json();
      setAggregate(json);
    } catch (e) {
      console.error("Failed to fetch aggregate:", e);
      setAggregate(null);
    } finally {
      setLoading(false);
    }
  };

  // -----------------------
  // RECORD DATA
  // -----------------------
  const loadRecords = async () => {
    try {
      const res = await fetch("http://127.0.0.1:5000/get_kyc_data");
      const json = await res.json();

      const rows = (json.records || []).map((r) => ({
        id: r._id,
        user_name: r.user_name,
        aadhaar_masked: r.aadhaar_masked,
        pan_masked: r.pan_masked,
        similarity_score: r.similarity_score,
        similarity_status: r.similarity_status,
        fraud_result: r.fraud_result || {},
        aadhaar_ocr: r.aadhaar_ocr || {},
        pan_ocr: r.pan_ocr || {},
        status: r.status || "Pending",
        timestamp: r.timestamp,
      }));

      setRecords(rows);
    } catch (e) {
      console.error("Failed to fetch records:", e);
      setRecords([]);
    }
  };

  if (loading) {
    return (
      <div className="fraud-page">
        <div className="container">Loading dashboard…</div>
      </div>
    );
  }

  // Fallback aggregate if API missing
  const agg = aggregate || {
    riskScore: computeAvg(records),
    riskBuckets: { Low: 0, Medium: 0, High: 0 },
    verifiedDocs: { verified: 0, unverified: 0 },
  };

  const platformRisk = computeAvg(records); // dynamic

  const pieData = [
    { name: "Verified", value: agg.verifiedDocs?.verified || 0 },
    { name: "Unverified", value: agg.verifiedDocs?.unverified || 0 },
  ];

  const barData = [
    { name: "Low", value: agg.riskBuckets?.Low || 0 },
    { name: "Medium", value: agg.riskBuckets?.Medium || 0 },
    { name: "High", value: agg.riskBuckets?.High || 0 },
  ];

  // -----------------------
  // FILTERING
  // -----------------------
  const visible = records.filter((r) => {
    if (selectedFilter === "all") return true;
    const map = {
      verified: "Verified",
      review: "Review",
      mismatch: "Mismatch",
    };
    return r.similarity_status === map[selectedFilter];
  });

  return (
    <div className="fraud-page">
      <div className="max-w-6xl mx-auto">
        {/* -------------------------------- HEADER -------------------------------- */}
        <header className="fraud-header">
          <div>
            <h1>⚡ Fraud Detection Dashboard</h1>
            <p className="muted">
              Realtime identity verification & fraud analytics
            </p>
          </div>

          <div className="risk-box">
            <div className="risk-label">Platform Risk Score</div>
            <div className="score-large">{platformRisk}%</div>
            <div className="muted small">Lower is better</div>
          </div>
        </header>

        {/* -------------------------------- CHART GRID -------------------------------- */}
        <main className="fraud-grid">
          {/* ----- Bar Chart ----- */}
          <section className="chart-box lg-2">
            <h2 className="chart-title">Risk Categories</h2>

            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={barData}>
                  <XAxis dataKey="name" stroke="#00e6e6" />
                  <YAxis stroke="#00e6e6" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value">
                    <Cell fill="#10B981" /> {/* Low */}
                    <Cell fill="#F59E0B" /> {/* Medium */}
                    <Cell fill="#EF4444" /> {/* High */}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ----- Pie Chart ----- */}
          <aside className="chart-box">
            <h2 className="chart-title">Document Verification</h2>

            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={pieData}
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                    label
                  >
                    <Cell fill="#3B82F6" />
                    <Cell fill="#A78BFA" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-meta">
              Verified: {pieData[0].value} | Unverified: {pieData[1].value}
            </div>
          </aside>
        </main>

        {/* -------------------------------- RECORD TABLE -------------------------------- */}
        <section className="records-section">
          <div className="records-header">
            <h3>Recent Verifications</h3>

            {/* FILTER BUTTONS */}
            <div className="filters">
              {["all", "verified", "review", "mismatch"].map((f) => (
                <button
                  key={f}
                  className={`filter-btn ${
                    selectedFilter === f ? "active" : ""
                  }`}
                  onClick={() => setSelectedFilter(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* TABLE */}
          <div className="records-table">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Aadhaar</th>
                  <th>PAN</th>
                  <th>Similarity</th>
                  <th>Fraud Score</th>
                  <th>Risk</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {visible.map((r) => {
                  const fs = r.fraud_result.fraud_score || 0;
                  const risk =
                    fs >= 71 ? "High" : fs >= 31 ? "Medium" : "Low";

                  return (
                    <tr key={r.id}>
                      <td>{r.user_name}</td>
                      <td>{r.aadhaar_masked}</td>
                      <td>{r.pan_masked}</td>
                      <td>{r.similarity_score || "No OCR"}</td>

                      <td>
                        <Badge
                          tone={
                            fs >= 71
                              ? "red"
                              : fs >= 31
                              ? "yellow"
                              : "green"
                          }
                        >
                          {fs}
                        </Badge>
                      </td>

                      <td>
                        <Badge
                          tone={
                            risk === "High"
                              ? "red"
                              : risk === "Medium"
                              ? "yellow"
                              : "green"
                          }
                        >
                          {risk}
                        </Badge>
                      </td>

                      <td>
                        <Badge
                          tone={
                            r.status === "Approved"
                              ? "green"
                              : r.status === "Rejected"
                              ? "red"
                              : "yellow"
                          }
                        >
                          {r.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function computeAvg(records = []) {
  if (!records.length) return 0;
  const sum = records.reduce(
    (acc, r) => acc + (r.fraud_result.fraud_score || 0),
    0
  );
  return Math.round(sum / records.length);
}