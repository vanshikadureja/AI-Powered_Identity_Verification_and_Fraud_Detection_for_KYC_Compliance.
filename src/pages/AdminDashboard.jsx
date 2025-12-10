import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, XCircle, CheckCircle, Eye } from "lucide-react";    // FIXED PATH
import "./AdminDashboard.css";                // FIXED PATH

const API = "http://127.0.0.1:5000";

const AdminDashboard = () => {
  const [kycData, setKycData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  // ---------------- FETCH KYC ----------------
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API}/get_kyc_data`);
        const data = await res.json();
        setKycData(data.records || []);
      } catch (error) {
        toast.error("Failed to load data ❌");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ---------------- APPROVE ----------------
  const approve = async (_id) => {
    try {
      await fetch(`${API}/approve/${_id}`, { method: "POST" });
      toast.success("Approved ✔");

      setKycData(prev =>
        prev.map(d => (d._id === _id ? { ...d, status: "Approved" } : d))
      );
    } catch {
      toast.error("Approval failed");
    }
  };

  // ---------------- REJECT ----------------
  const reject = async (_id) => {
    try {
      await fetch(`${API}/reject/${_id}`, { method: "POST" });
      toast.error("Rejected ✖");

      setKycData(prev =>
        prev.map(d => (d._id === _id ? { ...d, status: "Rejected" } : d))
      );
    } catch {
      toast.error("Rejection failed");
    }
  };

  // ------------------- MODAL -------------------
  const DetailModal = ({ user, onClose }) => {
    if (!user) return null;

    return (
      <div className="modal-overlay">
        <div className="modal-box">
          <div className="modal-header">
            <h2>KYC Details — {user.user_name}</h2>
            <button onClick={onClose}><XCircle size={30} /></button>
          </div>

          <div className="modal-content">
            <p><strong>User:</strong> {user.user_name}</p>
            <p><strong>Aadhaar:</strong> {user.aadhaar_masked}</p>
            <p><strong>PAN:</strong> {user.pan_masked}</p>

            <p><strong>Similarity Score:</strong> {user.similarity_score}</p>
            <p><strong>Status:</strong> {user.similarity_status}</p>

            <div className="ocr-box">
              <h3>Aadhaar OCR</h3>
              <pre>{JSON.stringify(user.aadhaar_ocr, null, 2)}</pre>
            </div>

            <div className="ocr-box">
              <h3>PAN OCR</h3>
              <pre>{JSON.stringify(user.pan_ocr, null, 2)}</pre>
            </div>

            <div className="ocr-box">
              <h3>Fraud Engine Output</h3>
              <pre>{JSON.stringify(user.fraud_result, null, 2)}</pre>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------------- LOADING ----------------
  if (loading) {
    return (
      <div className="loading-screen">
        <Loader2 className="spinner" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  // ---------------- MAIN ----------------
  return (
    <div className="admin-bg">
      <Navbar />

      <h1 className="dashboard-title">🛡 SecureKYC Admin Dashboard</h1>

      {kycData.length === 0 ? (
        <p className="no-records">No Records Found</p>
      ) : (
        <div className="cards-grid">
          {kycData.map((user) => (
            <div key={user._id} className="user-card">
              <h2>{user.user_name}</h2>

              <p>Aadhaar: {user.aadhaar_masked}</p>
              <p>PAN: {user.pan_masked}</p>

              <div className={`status-badge ${user.status}`}>
                {user.status}
              </div>

              <div className="card-actions">
                <button className="btn view" onClick={() => setSelected(user)}>
                  <Eye size={18} /> View
                </button>

                <button className="btn approve" onClick={() => approve(user._id)}>
                  <CheckCircle size={18} /> Approve
                </button>

                <button className="btn reject" onClick={() => reject(user._id)}>
                  <XCircle size={18} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && <DetailModal user={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};

export default AdminDashboard;