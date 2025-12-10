// src/pages/AuditTrail.jsx
import React, { useEffect, useState } from "react";
import "./AuditTrail.css";
import { Link } from "react-router-dom";

/**
 * AuditTrail page — fetches audit events from backend and shows them.
 * - Polls backend every 5s to pick up new events
 * - Re-renders every 1s so timestamps update live
 */

const SAMPLE = [
  {
    id: "evt-1",
    type: "error",
    title: "Fraud Verification",
    message: "Fraud Score: 70% | Risk: Medium | AML Auto Flag triggered: duplicate_aadhaar",
    source: "System",
    timestamp: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
    meta: { user: "System", count: 1 }
  },
  {
    id: "evt-2",
    type: "warning",
    title: "KYC Submission",
    message: "Name mismatch between Aadhaar and PAN — manual review advised",
    source: "KYC Engine",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    meta: { user: "operator" }
  },
  {
    id: "evt-3",
    type: "success",
    title: "KYC Uploaded",
    message: "KYC uploaded by operator John — Aadhaar & PAN verified",
    source: "Operator",
    timestamp: new Date().toISOString(),
    meta: { user: "operator" }
  }
];

// ✅ FINAL TIMESTAMP FORMATTER — EXACT FORMAT:
// "09/12/2025 05:33:21 PM"
function formatExact(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours || 12;
  hours = String(hours).padStart(2, "0");

  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds} ${ampm}`;
}

export default function AuditTrail() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [, forceRerender] = useState(0);

  const loadAudit = async () => {
    try {
      const res = await fetch("http://127.0.0.1:5000/audit-trail");
      if (!res.ok) throw new Error("no-audit");

      const json = await res.json();

      if (json.audit && Array.isArray(json.audit)) {
        setEvents(json.audit);
      } else if (json.events && Array.isArray(json.events)) {
        setEvents(json.events);
      } else if (Array.isArray(json)) {
        setEvents(json);
      } else {
        console.warn("AuditTrail: unexpected payload, using sample", json);
        setEvents(SAMPLE);
      }
    } catch (err) {
      console.warn("AuditTrail load failed — using sample data:", err);
      setEvents((prev) => (prev.length ? prev : SAMPLE));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    loadAudit();

    const poll = setInterval(() => {
      if (mounted) loadAudit();
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      forceRerender((x) => x + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const visible = events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "success") return e.type === "success";
    if (filter === "warnings") return e.type === "warning";
    if (filter === "errors") return e.type === "error";
    return true;
  });

  return (
    <div className="audit-trail-page">
      <div className="audit-topbar">
        <div className="brand">
          <div className="shield">🛡</div>
          <div className="brand-text">SecureKYC</div>
        </div>

        <nav className="top-nav" aria-label="Audit navigation">
          <Link className="nav-link" to="/">Home</Link>
          <Link className="nav-link" to="/kyc-requests">KYC Requests</Link>
          <Link className="nav-link" to="/fraud">Fraud Alerts</Link>
          <Link className="nav-link" to="/audit-trail">Audit Trail</Link>
          <Link className="logout" to="/">Logout</Link>
        </nav>
      </div>

      <header className="audit-hero">
        <div className="audit-icon">📁</div>
        <h1>Complete verification history and compliance tracking</h1>

        <div className="audit-filters">
          <button className={`filter-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All Events</button>
          <button className={`filter-btn ${filter === "success" ? "active" : ""}`} onClick={() => setFilter("success")}>Success</button>
          <button className={`filter-btn ${filter === "warnings" ? "active" : ""}`} onClick={() => setFilter("warnings")}>Warnings</button>
          <button className={`filter-btn ${filter === "errors" ? "active" : ""}`} onClick={() => setFilter("errors")}>Errors</button>
        </div>
      </header>

      <main className="audit-main container">
        <div className="events-grid">
          {loading && <div className="loading">Loading events…</div>}

          {!loading && visible.length === 0 && <div className="no-events">No events found for this filter.</div>}

          {visible.map((evt) => (
            <article key={evt.id || evt._id} className={`event-card ${evt.type || "info"}`}>
              <div className="event-left">
                <div className="event-icon">
                  {evt.type === "error" ? "⛔" :
                   evt.type === "warning" ? "⚠️" :
                   evt.type === "success" ? "✅" :
                   "ℹ️"}
                </div>
              </div>

              <div className="event-body">
                <div className="event-head">
                  <h3 className="event-title">{evt.title || "Event"}</h3>
                  <span className={`pill ${evt.type || "info"}`}>{(evt.type || "INFO").toUpperCase()}</span>
                </div>

                <p className="event-message">{evt.message || "No message provided."}</p>

                <div className="event-meta">
                  <div className="meta-item">👤 <span className="meta-text">{evt.source || "System"}</span></div>

                  {/* ⏱ EXACT FORMAT */}
                  <div className="meta-item">🕒 <span className="meta-text">{formatExact(evt.timestamp)}</span></div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
