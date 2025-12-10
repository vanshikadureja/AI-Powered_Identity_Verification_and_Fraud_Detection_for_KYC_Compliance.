// src/components/KycDashboard.jsx
import React, { useEffect, useState } from "react";
import { getKycData, approve, rejectKyc } from "../api";

function StatusBadge({ status }) {
  const color = status === "Approved" ? "#2ecc71" : status === "Rejected" ? "#e74c3c" : "#f1c40f";
  return <span style={{background:color, color:"#000", padding:"6px 10px", borderRadius:8}}>{status}</span>;
}

export default function KycDashboard() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getKycData();
      setRecords(res.records || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ load(); const i = setInterval(load, 5000); return ()=>clearInterval(i); }, []);

  async function onApprove(id) {
    await approve(id);
    setRecords(prev => prev.map(r => r._id === id ? {...r, status:"Approved"} : r));
  }

  async function onReject(id) {
    await rejectKyc(id);
    setRecords(prev => prev.map(r => r._id === id ? {...r, status:"Rejected"} : r));
  }

  return (
    <div className="kyc-dashboard">
      <h2>Admin KYC Dashboard</h2>
      {loading ? <p>Loading...</p> : (
        <>
          {records.length === 0 ? <p>No records</p> : (
            <div className="card-grid">
              {records.map(r => (
                <div key={r._id} className="card">
                  <div style={{display:"flex", justifyContent:"space-between"}}>
                    <h3>{r.user_name}</h3>
                    <StatusBadge status={r.status} />
                  </div>

                  <p><strong>Aadhaar:</strong> {r.aadhaar_masked}</p>
                  <p><strong>PAN:</strong> {r.pan_masked}</p>

                  <div style={{marginTop:8}}>
                    <button onClick={()=>setSelected(r)}>View</button>
                    <button onClick={()=>onApprove(r._id)} style={{marginLeft:8}}>Approve</button>
                    <button onClick={()=>onReject(r._id)} style={{marginLeft:8}}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <div className="modal">
          <div className="modal-inner">
            <h3>KYC Details — {selected.user_name}</h3>
            <p><strong>Status:</strong> <StatusBadge status={selected.status} /></p>

            <h4>OCR — Aadhaar</h4>
            <pre style={{maxHeight:180, overflow:"auto"}}>{JSON.stringify(selected.aadhaar_ocr, null, 2)}</pre>

            <h4>OCR — PAN</h4>
            <pre style={{maxHeight:180, overflow:"auto"}}>{JSON.stringify(selected.pan_ocr, null, 2)}</pre>

            <h4>Verification</h4>
            <p><strong>Similarity score:</strong> {selected.verification_result?.similarity_score ?? "N/A"}</p>
            <p><strong>Similarity status:</strong> {selected.verification_result?.similarity_status ?? "N/A"}</p>

            <h4>Fraud result</h4>
            <pre>{JSON.stringify(selected.fraud_result || {}, null, 2)}</pre>

            <div style={{marginTop:12}}>
              <button onClick={()=>setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}