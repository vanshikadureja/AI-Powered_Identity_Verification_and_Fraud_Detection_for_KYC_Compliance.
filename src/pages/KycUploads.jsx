// src/components/KycUpload.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import "./KycUploads.css";
import "../pages/MyDocuments.css"; // navbar styles
import { Link } from "react-router-dom";

export default function KycUpload() {
  const [kycList, setKycList] = useState([]);
  const [loading, setLoading] = useState(false);

  // Mask Aadhaar & PAN
  const maskAadhaar = (n) => {
    if (!n) return "-";
    const d = String(n).replace(/\D/g, "");
    if (d.length < 8) return n;
    return `${d.slice(0, 4)}-XXXX-${d.slice(-4)}`;
  };

  const maskPan = (p) => {
    if (!p) return "-";
    const s = String(p).replace(/\s/g, "");
    if (s.length !== 10) return p;
    return `${s.slice(0, 5)}-XX${s.slice(-2)}`;
  };

  // Load all KYC uploads
  async function loadList() {
    setLoading(true);
    try {
      const res = await axios.get("http://127.0.0.1:5000/kyc-list");
      const items =
        Array.isArray(res.data)
          ? res.data
          : res.data.items || res.data.kyc || res.data.records || [];
      setKycList(items);
    } catch (e) {
      console.error(e);
      alert("Failed to load KYC list");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList();
  }, []);

  return (
    <div className="kyc-upload-page">

      {/* 🔹 NAVIGATION BAR (Copied from MyDocuments.jsx) */}
      <div className="custom-nav">
        <div className="brand-area">
          <span className="shield">🛡</span>
          <span className="brand-text">SecureKYC</span>
        </div>

        <div className="nav-links">
          <Link to="/" className="nav-link">Home</Link>
          <Link to="/kyc-upload" className="nav-link active">KYC Upload</Link>
          <Link to="/documents" className="nav-link">My Documents</Link>

          <button
            className="btn-logout"
            onClick={() => (window.location.href = "/")}
          >
            Logout
          </button>
        </div>
      </div>

      {/* 🔹 MAIN CONTENT */}
      <div className="kyc-upload">
        <h2>All KYC Uploads</h2>

        {loading && <p>Loading records…</p>}

        {!loading && kycList.length === 0 && <p>No KYC uploads found.</p>}

        {!loading && kycList.length > 0 && (
          <div className="kyc-table-wrapper">
            <table className="kyc-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>User Name</th>
                  <th>Aadhaar</th>
                  <th>PAN</th>
                  <th>Status</th>
                  <th>Fraud Score</th>
                  <th>Created At</th>
                </tr>
              </thead>

              <tbody>
                {kycList.map((item, index) => (
                  <tr key={item.id || item._id || index}>
                    <td>{index + 1}</td>
                    <td>{item.user_name || item.name || "-"}</td>
                    <td>{maskAadhaar(item.aadhaar_number)}</td>
                    <td>{maskPan(item.pan_number)}</td>
                    <td>{item.status || item.decision || "PENDING"}</td>
                    <td>
                      {item.fraud_score !== undefined
                        ? `${item.fraud_score}/100`
                        : "-"}
                    </td>
                    <td>
                      {item.created_at
                        ? new Date(item.created_at).toLocaleDateString("en-GB") +
                          " " +
                          new Date(item.created_at).toLocaleTimeString("en-US", {
                            hour12: true,
                          })
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
