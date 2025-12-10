// src/pages/KycRequests.jsx
import React, { useEffect, useState, useMemo } from "react";
import toast from "react-hot-toast";
import "./KycRequests.css";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  PieChart as PieI,
  BarChart as BarI,
  LineChart as LineI,
  ChevronDown,
  ChevronUp,
  Search
} from "lucide-react";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RTooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

import "./KycRequests.css";


const PIE_COLORS = ["#7c3aed", "#f59e0b"];
const BAR_COLORS = ["#10B981", "#F59E0B", "#EF4444"];

/* helper functions kept same as earlier — getFirstField, formatDob, maskNumber, formatRisk ... */
function getFirstField(obj = {}, keys = []) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}
function formatDob(obj) {
  return (
    getFirstField(obj, ["dob", "DOB", "date_of_birth", "DateOfBirth", "birth_date", "birthDate"]) ||
    "N/A"
  );
}
function maskNumber(numStr = "", visibleFront = 4, visibleBack = 4) {
  if (!numStr) return "N/A";
  const s = String(numStr).replace(/\s+/g, "");
  if (s.length <= visibleFront + visibleBack) return s;
  const middle = "X".repeat(Math.max(0, s.length - visibleFront - visibleBack));
  return s.slice(0, visibleFront) + middle + s.slice(s.length - visibleBack);
}
function formatRisk(val) {
  if (val === undefined || val === null || val === "") return "Low";
  if (typeof val === "string") {
    const v = val.toLowerCase();
    if (v.includes("high")) return "High";
    if (v.includes("medium") || v.includes("med")) return "Medium";
    if (v.includes("low")) return "Low";
    const num = parseFloat(val.replace(/[^\d.]/g, ""));
    if (!isNaN(num)) {
      if (num > 70) return "High";
      if (num > 30) return "Medium";
      return "Low";
    }
    return "Low";
  }
  const n = Number(val);
  if (isNaN(n)) return "Low";
  if (n > 70) return "High";
  if (n > 30) return "Medium";
  return "Low";
}

export default function KycRequests() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [agg, setAgg] = useState(null);

  // NEW: search and expanded state
  const [searchQ, setSearchQ] = useState("");
  const [expandedIds, setExpandedIds] = useState(new Set());

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadAggregate(), loadRecords()]);
    setLoading(false);
  }

  async function loadRecords() {
    try {
      const res = await fetch("http://127.0.0.1:5000/get_kyc_data");
      const json = await res.json();
      setRecords(json.records || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load KYC records");
      setRecords([]);
    }
  }

  async function loadAggregate() {
    try {
      const res = await fetch("http://127.0.0.1:8000/fraud-aggregate");
      if (!res.ok) throw new Error("agg not found");
      const json = await res.json();
      setAgg(json);
    } catch (err) {
      setAgg(null);
    }
  }

  async function doAction(id, action) {
    try {
      await fetch(`http://127.0.0.1:5000/${action}/${id}`, { method: "POST" });
      toast.success(`${action} done`);
      setRecords((prev) => prev.map((r) => (r._id === id ? { ...r, status: action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Flagged" } : r)));
    } catch (err) {
      console.error(err);
      toast.error("Action failed");
    }
  }

  function computeFallback(recordsList = []) {
    const buckets = { Low: 0, Medium: 0, High: 0 };
    const verified = { verified: 0, unverified: 0 };
    recordsList.forEach((r) => {
      const fs = Number(r?.fraud_result?.fraud_score || 0);
      if (fs > 70) buckets.High++;
      else if (fs > 30) buckets.Medium++;
      else buckets.Low++;
      if (fs > 30) verified.unverified++;
      else verified.verified++;
    });
    return {
      riskScore: recordsList.length ? Math.round(recordsList.reduce((a, b) => a + Number(b?.fraud_result?.fraud_score || 0), 0) / recordsList.length) : 0,
      riskBuckets: buckets,
      verifiedDocs: verified,
    };
  }

  const derived = agg || computeFallback(records);
  const pieData = [{ name: "Verified", value: Number(derived.verifiedDocs?.verified || 0) }, { name: "Unverified", value: Number(derived.verifiedDocs?.unverified || 0) }];
  const barData = [{ name: "Low", value: Number(derived.riskBuckets?.Low || 0) }, { name: "Medium", value: Number(derived.riskBuckets?.Medium || 0) }, { name: "High", value: Number(derived.riskBuckets?.High || 0) }];

  function buildLineData(recordsList) {
    const count = {};
    recordsList.forEach((r) => {
      const t = r.timestamp || r.createdAt || r.created_at;
      if (!t) return;
      const dateStr = new Date(t).toISOString().slice(0, 10);
      count[dateStr] = (count[dateStr] || 0) + 1;
    });
    const arr = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      arr.push({ date: k, value: count[k] || 0 });
    }
    return arr;
  }
  const lineData = buildLineData(records);

  // NEW: derived filtered list based on search query
  const filtered = useMemo(() => {
    if (!searchQ || !searchQ.trim()) return records;
    const q = searchQ.trim().toLowerCase();
    return records.filter((r) => {
      const name = (r.user_name || "").toString().toLowerCase();
      const id = (r._id || "").toString().toLowerCase();
      const aad = (r.aadhaar_masked || "").toString().toLowerCase();
      const pan = (r.pan_masked || "").toString().toLowerCase();
      const raw = JSON.stringify(r).toLowerCase();
      return name.includes(q) || id.includes(q) || aad.includes(q) || pan.includes(q) || raw.includes(q);
    });
  }, [records, searchQ]);

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  return (
    <div className="kyc-requests-page">
      <div className="kyc-topbar">
        <div className="brand">
          <div className="shield">🛡</div>
          <div className="brand-text">SecureKYC</div>
        </div>

        <nav className="top-nav" style={{ alignItems: "center" }}>
          <div className="search-box" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Search size={16} />
            <input
              className="search-input"
              placeholder="Search name / id / aadhaar / pan"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searchQ && <button className="btn" onClick={() => setSearchQ("")}>Clear</button>}
          </div>

          <a className="nav-link" href="/">Home</a>
          <a className="nav-link active">KYC Requests</a>
          <a className="nav-link" href="/fraud">Fraud Alerts</a>
          <a className="nav-link" href="/audit-trail">Audit Trail</a>
          <button className="btn logout" onClick={() => (window.location.href = "/")}>Logout</button>
        </nav>
      </div>

      <header className="kyc-hero">
        <div className="hero-icon">🔍</div>
        <h1>Monitor and manage identity verification with deep fraud analysis</h1>
      </header>

      {/* charts same as before */}
      <section className="top-cards">
        <div className="card chart-card">
          <div className="card-title"><PieI size={16} /> KYC Status Distribution</div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} label>
                  {pieData.map((_, i) => (<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
                </Pie>
                <RTooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title"><BarI size={16} /> Fraud Score Distribution</div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.06} />
                <XAxis dataKey="name" stroke="#bfeffd" />
                <YAxis stroke="#bfeffd" allowDecimals={false} />
                <RTooltip />
                <Legend />
                <Bar dataKey="value" barSize={36} isAnimationActive={false}>
                  {barData.map((_, i) => (<Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="line-card card">
        <div className="card-title"><LineI size={16} /> KYC Requests Over Time</div>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.06} />
              <XAxis dataKey="date" stroke="#bfeffd" />
              <YAxis stroke="#bfeffd" allowDecimals={false} />
              <RTooltip />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="list-section">
        <h2 className="section-heading">Recent Verifications</h2>

        {loading && <div className="loading">Loading…</div>}
        {!loading && filtered.length === 0 && <div className="no-data">No records found</div>}

        {!loading && filtered.map((r) => {
          const fr = r.fraud_result || {};
          const fs = Number(fr.fraud_score) || 0;
          const risk = fs > 70 ? "High" : fs > 30 ? "Medium" : "Low";
          const aad = r.aadhaar_ocr || {};
          const pan = r.pan_ocr || {};
          const aad_name = getFirstField(aad, ["name", "Name", "full_name"]) || r.user_name || "N/A";
          const aad_num = getFirstField(aad, ["aadhaar_number", "AadhaarNumber", "aadhaar_no"]) || r.aadhaar_masked || "N/A";
          const aad_dob = formatDob(aad) || "N/A";
          const aad_gender = getFirstField(aad, ["gender", "Gender", "sex"]) || "N/A";
          const pan_name = getFirstField(pan, ["name", "Name", "full_name"]) || r.user_name || "N/A";
          const pan_num = getFirstField(pan, ["pan_number", "PANNumber", "pan_no"]) || r.pan_masked || "N/A";
          const pan_dob = formatDob(pan) || "N/A";
          const pan_father = getFirstField(pan, ["father_name", "FatherName", "father"]) || "N/A";
          const aadRiskLabel = formatRisk(fr?.aadhaar_risk ?? fr?.aad_risk ?? null);
          const panRiskLabel = formatRisk(fr?.pan_risk ?? fr?.pan_risk ?? null);

          const isExpanded = expandedIds.has(r._id);

          return (
            <div key={r._id} className={`kyc-card ${isExpanded ? "expanded" : ""}`}>
              <div className="col user" onClick={() => toggleExpand(r._id)} style={{ cursor: "pointer" }}>
                <div className="col-title">User Info</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div className="user-name">{r.user_name || "Unknown"}</div>
                    <div className="user-meta mono">ID: {r._id}</div>
                  </div>
                  <div style={{ marginLeft: 12 }}>
                    {isExpanded ? <ChevronUp /> : <ChevronDown />}
                  </div>
                </div>
              </div>

              <div className="col extracted">
                <div className="col-title">Extracted Aadhaar</div>
                <div className="ex-scroll">
                  <div><strong>Name:</strong> {aad_name}</div>
                  <div><strong>Aadhaar No:</strong> {aad_num === "N/A" ? "N/A" : maskNumber(String(aad_num))}</div>
                  <div><strong>Date of Birth:</strong> {aad_dob}</div>
                  <div><strong>Gender:</strong> {aad_gender}</div>
                </div>

                <hr style={{ margin: "12px 0", borderColor: "rgba(255,255,255,0.04)" }} />

                <div className="col-title">Extracted PAN</div>
                <div className="ex-scroll">
                  <div><strong>Name:</strong> {pan_name}</div>
                  <div><strong>PAN No:</strong> {pan_num === "N/A" ? "N/A" : maskNumber(String(pan_num), 3, 2)}</div>
                  <div><strong>Date of Birth:</strong> {pan_dob}</div>
                  <div><strong>Father Name:</strong> {pan_father}</div>
                </div>
              </div>

              <div className="col fraud">
                <div className="col-title">Fraud Analysis</div>
                <div className="fraud-grid">
                  <div className="fraud-item">
                    <div className="label">Aadhaar Risk</div>
                    <div className={`value risk-${aadRiskLabel.toLowerCase()}`}>{aadRiskLabel}</div>
                  </div>

                  <div className="fraud-item">
                    <div className="label">PAN Risk</div>
                    <div className={`value risk-${panRiskLabel.toLowerCase()}`}>{panRiskLabel}</div>
                  </div>

                  <div className="fraud-item">
                    <div className={`score ${risk.toLowerCase()}`}>{fs}%</div>
                  </div>
                </div>

                <details className="fraud-details">
                  <summary>Flags / Reasons</summary>
                  <pre>{JSON.stringify(fr.flags || fr, null, 2)}</pre>
                </details>
              </div>

              <div className="col actions">
                <div className="col-title">Actions</div>
                <div className="status">{r.status || "Pending"}</div>
                <div className="action-row">
                  <button className="btn approve" onClick={() => doAction(r._id, "approve")}><CheckCircle /> Approve</button>
                  <button className="btn reject" onClick={() => doAction(r._id, "reject")}><XCircle /> Reject</button>
                  <button className="btn flag" onClick={() => doAction(r._id, "flag")}><AlertTriangle /> Flag</button>
                </div>
                <button className="btn view" onClick={() => setSelected(r)}>View</button>
              </div>
            </div>
          );
        })}
      </section>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>KYC Detail — {selected.user_name}</h3>
              <button className="btn small" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="modal-body">
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </div>
            <div className="modal-footer">
              <button className="btn approve" onClick={() => { doAction(selected._id, "approve"); setSelected(null); }}>Approve</button>
              <button className="btn reject" onClick={() => { doAction(selected._id, "reject"); setSelected(null); }}>Reject</button>
              <button className="btn flag" onClick={() => { doAction(selected._id, "flag"); setSelected(null); }}>Flag</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}