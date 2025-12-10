// src/pages/MyDocuments.jsx
import React, { useEffect, useState } from "react";
import "./MyDocuments.css";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { RefreshCw, FileText } from "lucide-react";
import toast from "react-hot-toast";

const DEMO_DOCS = [
  { _id: "demo-1", file_name: "aadhar_sample_1.jpg", uploaded_at: new Date().toISOString(), status: "Approved" },
  { _id: "demo-2", file_name: "pancard_sample_2.jpg", uploaded_at: new Date().toISOString(), status: "Approved" },
  { _id: "demo-3", file_name: "aadhar_sample_3.jpg", uploaded_at: new Date().toISOString(), status: "Rejected - AML Rule Triggered" },
  { _id: "demo-4", file_name: "user_upload_01.jpg", uploaded_at: new Date().toISOString(), status: "Pending" },
];

export default function MyDocuments() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    setLoading(true);
    try {
      // Try the endpoint you used; if it doesn't exist, try the common KYC endpoint
      let res = null;
      try {
        res = await axios.get("http://127.0.0.1:5000/my-uploads");
        console.log("my-uploads response:", res.data);
      } catch (err) {
        console.warn("/my-uploads failed, trying /get_kyc_data", err?.message);
        // try fallback
        const r2 = await axios.get("http://127.0.0.1:5000/get_kyc_data");
        console.log("/get_kyc_data response:", r2.data);
        // map /get_kyc_data records to doc-like shape
        const records = r2.data.records || r2.data || [];

        // 🔹 CHANGE 1: create separate docs for Aadhaar AND PAN inside each record
        const mapped = (records || []).flatMap((r, i) => {
          const baseId = r._id || r.id || `rec-${i}`;
          const baseUploadedAt = r.timestamp || r.createdAt || r.created_at || new Date().toISOString();
          const items = [];

          // Aadhaar document (if present)
          if (r.aadhaar_ocr) {
            items.push({
              _id: `${baseId}-aadhaar`,
              file_name:
                r.aadhaar_ocr.file_name ||
                r.aadhaar_ocr.filename ||
                r.aadhaar_ocr.image_path ||
                "aadhaar_document",
              uploaded_at: baseUploadedAt,
              status: r.aadhaar_status || r.status || "Pending",
            });
          }

          // PAN document (if present)
          if (r.pan_ocr) {
            items.push({
              _id: `${baseId}-pan`,
              file_name:
                r.pan_ocr.file_name ||
                r.pan_ocr.filename ||
                r.pan_ocr.image_path ||
                "pan_document",
              uploaded_at: baseUploadedAt,
              status: r.pan_status || r.status || "Pending",
            });
          }

          // If neither nested doc exists, keep old single-card behaviour
          if (!items.length) {
            items.push({
              _id: baseId,
              file_name:
                r.file_name ||
                r.filename ||
                (r.aadhaar_ocr && "aadhaar") ||
                (r.pan_ocr && "pan") ||
                `record-${i}`,
              uploaded_at: baseUploadedAt,
              status:
                r.status ||
                (r.fraud_result && r.fraud_result.fraud_score > 70
                  ? "Rejected"
                  : "Approved") ||
                "Pending",
            });
          }

          return items;
        });

        setDocs(mapped.length ? mapped : DEMO_DOCS);
        setLoading(false);
        return;
      }

      // If /my-uploads returned successfully, normalize shape
      if (res && res.status === 200) {
        const d = res.data.documents || res.data || [];

        // 🔹 CHANGE 2: also split Aadhaar + PAN if they are nested in /my-uploads response
        const mapped =
          (Array.isArray(d) &&
            d.flatMap((x, i) => {
              const baseId = x._id || x.id || `doc-${i}`;
              const baseUploadedAt = x.uploaded_at || x.created_at || x.timestamp || new Date().toISOString();
              const items = [];

              if (x.aadhaar_ocr) {
                items.push({
                  _id: `${baseId}-aadhaar`,
                  file_name:
                    x.aadhaar_ocr.file_name ||
                    x.aadhaar_ocr.filename ||
                    x.aadhaar_ocr.image_path ||
                    x.file_name ||
                    x.filename ||
                    `doc-${i}-aadhaar`,
                  uploaded_at: baseUploadedAt,
                  status: x.aadhaar_status || x.status || x.state || "Pending",
                });
              }

              if (x.pan_ocr) {
                items.push({
                  _id: `${baseId}-pan`,
                  file_name:
                    x.pan_ocr.file_name ||
                    x.pan_ocr.filename ||
                    x.pan_ocr.image_path ||
                    x.file_name ||
                    x.filename ||
                    `doc-${i}-pan`,
                  uploaded_at: baseUploadedAt,
                  status: x.pan_status || x.status || x.state || "Pending",
                });
              }

              if (!items.length) {
                items.push({
                  _id: baseId,
                  file_name: x.file_name || x.filename || x.name || `doc-${i}`,
                  uploaded_at: baseUploadedAt,
                  status: x.status || x.state || "Pending",
                });
              }

              return items;
            })) ||
          [];

        setDocs(mapped.length ? mapped : DEMO_DOCS);
      } else {
        // fallback: demo
        setDocs(DEMO_DOCS);
      }
    } catch (err) {
      console.error("Failed loading documents:", err);
      toast.error("Failed to load documents (check backend / CORS).");
      setDocs(DEMO_DOCS);
    } finally {
      setLoading(false);
    }
  }

  const filteredDocs = docs.filter((doc) => {
    const statusMatch =
      filterStatus === "all"
        ? true
        : (doc.status || "").toLowerCase().includes(filterStatus.toLowerCase());
    const searchMatch = (doc.file_name || "").toLowerCase().includes(search.toLowerCase());
    return statusMatch && searchMatch;
  });

  return (
    <div className="mydocs-page">
      {/* NAV */}
      <div className="custom-nav">
        <div className="brand-area">
          <span className="shield">🛡</span>
          <span className="brand-text">SecureKYC</span>
        </div>

        <div className="nav-links">
          <a href="/" className="nav-link">Home</a>
          <a href="/kyc-upload" className="nav-link">KYC Upload</a>
          <a href="/my-documents" className="nav-link active">My Documents</a>
          <button className="btn-logout" onClick={() => (window.location.href = "/")}>Logout</button>
        </div>
      </div>

      {/* header */}
      <header className="header-box">
        <h1>Document Management</h1>
        <p>Track and manage your verification process</p>
        <div
          className="docs-count"
          style={{ marginTop: 6, color: "#9aa9ad", fontSize: 13 }}
        >
          Showing {docs.length} documents
        </div>
      </header>

      {/* controls */}
      <div className="controls-row">
        <input
          type="text"
          className="search-bar"
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Status</option>
          <option value="Approved">Approved</option>
          <option value="Pending">Pending</option>
          <option value="Rejected">Rejected</option>
        </select>

        <button className="refresh-btn" onClick={loadDocuments}>
          <RefreshCw size={14} /> Refresh
        </button>

        <button
          className="upload-btn"
          onClick={() => (window.location.href = "/kyc-upload")}
        >
          + Upload New
        </button>
      </div>

      {/* list */}
      <div className="documents-list">
        {loading && <p className="loading">Loading documents...</p>}

        {!loading && filteredDocs.length === 0 && (
          <p className="no-data">No documents found</p>
        )}

        {!loading &&
          filteredDocs.map((doc) => (
            <div className="doc-card" key={doc._id}>
              <div className="doc-left">
                <div className="file-icon">
                  <FileText size={20} />
                </div>
                <div>
                  <div className="file-name">{doc.file_name}</div>
                  <div className="file-meta">
                    {doc.uploaded_at
                      ? new Date(doc.uploaded_at).toLocaleString()
                      : "Unknown date"}
                  </div>
                </div>
              </div>

              <div
                className={`status-pill ${
                  (doc.status || "").toLowerCase().includes("approve")
                    ? "approved"
                    : (doc.status || "").toLowerCase().includes("reject")
                    ? "rejected"
                    : "pending"
                }`}
              >
                {doc.status}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
