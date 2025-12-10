// src/pages/DocumentUpload.jsx
import React, { useRef, useState } from "react";
import "./DocumentUpload.css";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";
import { useNavigate } from "react-router-dom";

const DocumentUpload = () => {
  const navigate = useNavigate();
  const formRef = useRef(null);

  const [userName, setUserName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [mobile, setMobile] = useState("");
  const [panNumber, setPanNumber] = useState("");

  const [aadhaarPreview, setAadhaarPreview] = useState(null);
  const [panPreview, setPanPreview] = useState(null);
  const [dlPreview, setDlPreview] = useState(null);

  const [aadhaarFile, setAadhaarFile] = useState(null);
  const [panFile, setPanFile] = useState(null);
  const [dlFile, setDlFile] = useState(null);

  const [aadhaarData, setAadhaarData] = useState(null);
  const [panData, setPanData] = useState(null);
  const [dlData, setDlData] = useState(null);

  const [loadingAadhaar, setLoadingAadhaar] = useState(false);
  const [loadingPan, setLoadingPan] = useState(false);
  const [loadingDl, setLoadingDl] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [aiResult, setAiResult] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const normalizeDobToDDMMYYYY = (raw) => {
    if (!raw) return "";
    const s = String(raw).trim();
    let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (m) return `${m[3].padStart(2, "0")}-${m[2].padStart(2, "0")}-${m[1]}`;
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}-${m[3]}`;
    return s;
  };

  const ensureDobFormat = (v) => {
    const norm = normalizeDobToDDMMYYYY(v);
    return /^\d{2}-\d{2}-\d{4}$/.test(norm) ? norm : null;
  };

  const maskAadhaarUI = (n) =>
    !n ? "-" : `${String(n).slice(0, 4)}-XXXX-${String(n).slice(-4)}`;

  const maskPanUI = (p) =>
    !p ? "-" : `${String(p).slice(0, 5)}-XX${String(p).slice(-2)}`;

  const getDeviceInfo = () =>
    JSON.stringify({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timestamp: new Date().toISOString(),
    });

  const handleFileChange = (e, setPreview, setFile) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const extractAadhaar = async () => {
    if (!aadhaarFile) return toast.error("Upload Aadhaar first!");
    setLoadingAadhaar(true);
    const fd = new FormData();
    fd.append("aadhaar", aadhaarFile);
    try {
      const r = await axios.post("http://127.0.0.1:5000/extract_aadhaar", fd);
      const ex = r.data?.extracted_data ?? r.data;
      setAadhaarData(ex);
      if (ex?.name && !userName) setUserName(ex.name);
      if (ex?.dob && !dob) setDob(normalizeDobToDDMMYYYY(ex.dob));
      if (ex?.gender && !gender) setGender(ex.gender);
      if (ex?.mobile && !mobile) setMobile(ex.mobile);
      toast.success("Aadhaar extracted");
    } catch (err) {
      console.error("Aadhaar extract error:", err);
      toast.error("Aadhaar extraction failed");
    }
    setLoadingAadhaar(false);
  };

  const extractPan = async () => {
    if (!panFile) return toast.error("Upload PAN first!");
    setLoadingPan(true);
    const fd = new FormData();
    fd.append("pan", panFile);
    try {
      const r = await axios.post("http://127.0.0.1:5000/extract_pan", fd);
      const ex = r.data?.extracted_data ?? r.data;
      setPanData(ex);
      if (ex?.name && !userName) setUserName(ex.name);
      if (ex?.dob && !dob) setDob(normalizeDobToDDMMYYYY(ex.dob));
      if (ex?.pan_number) setPanNumber(ex.pan_number);
      toast.success("PAN extracted");
    } catch (err) {
      console.error("PAN extract error:", err);
      toast.error("PAN extraction failed");
    }
    setLoadingPan(false);
  };

  const extractDl = async () => {
    if (!dlFile) return toast.error("Upload Driving License first!");
    setLoadingDl(true);
    const fd = new FormData();
    fd.append("driving_license", dlFile);
    try {
      const r = await axios.post("http://127.0.0.1:5000/extract_dl", fd);
      const ex = r.data?.extracted_data ?? r.data;
      setDlData(ex);
      if (ex?.name && !userName) setUserName(ex.name);
      if (ex?.dob && !dob) setDob(normalizeDobToDDMMYYYY(ex.dob));
      toast.success("Driving License extracted");
    } catch (err) {
      console.error("DL extract error:", err);
      toast.error("Driving License extraction failed");
    }
    setLoadingDl(false);
  };

  const verifyWithAI = async () => {
    setVerifying(true);
    setAiResult(null);

    const fd = new FormData();
    fd.append("user_name", userName.trim());
    fd.append("dob", ensureDobFormat(dob) || dob || "");
    fd.append("gender", gender.trim());
    fd.append("mobile", mobile.trim());
    fd.append("pan_number", panNumber);
    fd.append("device_info", getDeviceInfo());
    if (aadhaarFile) fd.append("aadhaar", aadhaarFile);
    if (panFile) fd.append("pan", panFile);
    if (dlFile) fd.append("driving_license", dlFile);

    try {
      const res = await axios.post("http://127.0.0.1:5000/analyze", fd);
      setAiResult(res.data);
      toast.success("AI verification completed");
    } catch (err) {
      console.error("AI verify error:", err);
      toast.error("AI verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const submitKYC = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    const fd = new FormData();
    fd.append("user_name", userName.trim());
    fd.append("dob", ensureDobFormat(dob) || dob || "");
    fd.append("gender", gender.trim());
    fd.append("mobile", mobile.trim());
    fd.append("pan_number", panNumber);
    fd.append("device_info", getDeviceInfo());
    if (aadhaarFile) fd.append("aadhaar", aadhaarFile);
    if (panFile) fd.append("pan", panFile);
    if (dlFile) fd.append("driving_license", dlFile);

    try {
      await axios.post("http://127.0.0.1:5000/submit-kyc", fd);
      toast.success("KYC submitted successfully!");
      setTimeout(() => navigate("/"), 700);
    } catch (err) {
      console.error("Submit KYC error:", err);
      toast.error("KYC submission failed");
    }
    setSubmitting(false);
  };

  const goHome = () => navigate("/");
  const goKycUpload = () =>
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  const goMyDocs = () => navigate("/documents");
  const doLogout = () => navigate("/");

  // NEW: Verification Dashboard navigation
  const goVerificationDashboard = () => navigate("/verification-dashboard");

  const riskClass =
    aiResult?.risk_level === "HIGH"
      ? "risk-high"
      : aiResult?.risk_level === "MEDIUM"
      ? "risk-medium"
      : "risk-low";

  return (
    <div className="upload-page">
      <Toaster position="top-right" />

      <nav className="upload-nav">
        <div className="logo">🟡 SecureKYC</div>
        <div className="nav-links">
          <button className="nav-link" onClick={goHome}>
            Home
          </button>
          <button className="nav-link btn-yellow" onClick={goKycUpload}>
            KYC Upload
          </button>
          <button className="nav-link" onClick={goMyDocs}>
            My Documents
          </button>
          <button className="btn-logout" onClick={doLogout}>
            Logout
          </button>
        </div>
      </nav>

      <div className="container">
        <form ref={formRef} onSubmit={submitKYC}>
          {/* ===== PERSONAL INFO ===== */}
          <div className="section-title">Personal Information</div>

          <div className="form-grid">
            <input
              type="text"
              placeholder="Full Name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
            />
            <input
              type="text"
              placeholder="DOB (dd-mm-yyyy)"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="">Select Gender</option>
              <option>Male</option>
              <option>Female</option>
              <option>Others</option>
            </select>
            <input
              type="text"
              placeholder="Mobile Number"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
          </div>

          {/* ===== AADHAAR ===== */}
          <div className="section-title">Aadhaar Card Upload</div>
          <div
            className="upload-box"
            onClick={() => document.getElementById("aadhaar").click()}
          >
            {aadhaarPreview ? (
              <>
                <p>Aadhaar Preview:</p>
                <img src={aadhaarPreview} alt="Aadhaar preview" />
              </>
            ) : (
              <p>📂 Click to upload Aadhaar</p>
            )}
            <input
              type="file"
              id="aadhaar"
              hidden
              accept=".jpg,.jpeg,.png,application/pdf"
              onChange={(e) =>
                handleFileChange(e, setAadhaarPreview, setAadhaarFile)
              }
            />
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-yellow2"
              onClick={extractAadhaar}
              disabled={loadingAadhaar}
            >
              {loadingAadhaar ? "Extracting..." : "Extract Aadhaar"}
            </button>
          </div>

          {aadhaarData && (
            <div className="extracted-data">
              <h3>Aadhaar Details</h3>
              <p>
                <strong>Name :</strong> {aadhaarData.name || "-"}
              </p>
              <p>
                <strong>DOB :</strong>{" "}
                {aadhaarData.dob
                  ? normalizeDobToDDMMYYYY(aadhaarData.dob)
                  : "-"}
              </p>
              <p>
                <strong>Gender :</strong> {aadhaarData.gender || "-"}
              </p>
              <p>
                <strong>Aadhaar No :</strong>{" "}
                {aadhaarData.aadhaar_number || "-"}
              </p>
            </div>
          )}

          {/* ===== PAN ===== */}
          <div className="section-title">PAN Card Upload</div>
          <div
            className="upload-box"
            onClick={() => document.getElementById("pan").click()}
          >
            {panPreview ? (
              <>
                <p>PAN Preview:</p>
                <img src={panPreview} alt="PAN preview" />
              </>
            ) : (
              <p>📂 Click to upload PAN</p>
            )}
            <input
              type="file"
              id="pan"
              hidden
              accept=".jpg,.jpeg,.png,application/pdf"
              onChange={(e) =>
                handleFileChange(e, setPanPreview, setPanFile)
              }
            />
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-green"
              onClick={extractPan}
              disabled={loadingPan}
            >
              {loadingPan ? "Extracting..." : "Extract PAN"}
            </button>
          </div>

          {panData && (
            <div className="extracted-data">
              <h3>PAN Details</h3>
              <p>
                <strong>Name :</strong> {panData.name || "-"}
              </p>
              <p>
                <strong>Father's Name :</strong>{" "}
                {panData.father_name || "-"}
              </p>
              <p>
                <strong>Date of Birth :</strong>{" "}
                {panData.dob ? normalizeDobToDDMMYYYY(panData.dob) : "-"}
              </p>
              <p>
                <strong>PAN No :</strong> {panData.pan_number || "-"}
              </p>
            </div>
          )}

          {/* ===== DRIVING LICENSE ===== */}
          <div className="section-title">Driving License Upload</div>
          <div
            className="upload-box"
            onClick={() => document.getElementById("dl").click()}
          >
            {dlPreview ? (
              <>
                <p>Driving License Preview:</p>
                <img src={dlPreview} alt="DL preview" />
              </>
            ) : (
              <p>🚗 Upload Driving License</p>
            )}
            <input
              type="file"
              id="dl"
              hidden
              accept=".jpg,.jpeg,.png,application/pdf"
              onChange={(e) => handleFileChange(e, setDlPreview, setDlFile)}
            />
          </div>

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-yellow2"
              onClick={extractDl}
              disabled={loadingDl}
            >
              {loadingDl ? "Extracting..." : "Extract Driving License"}
            </button>
          </div>

          {dlData && (
            <div className="extracted-data">
              <h3>Driving License Details</h3>
              <p>
                <strong>Name :</strong> {dlData.name || "-"}
              </p>
              <p>
                <strong>DL Number :</strong> {dlData.dl_number || "-"}
              </p>
              <p>
                <strong>Issue Date :</strong> {dlData.issue_date || "-"}
              </p>
              <p>
                <strong>Valid Till :</strong> {dlData.valid_till || "-"}
              </p>
            </div>
          )}

          {/* ===== AI VERIFY + SUBMIT ===== */}
          <div className="btn-row" style={{ marginTop: 30 }}>
            <button
              type="button"
              className="btn btn-yellow2"
              onClick={verifyWithAI}
              disabled={verifying}
            >
              {verifying ? "Verifying with AI..." : "Verify with AI"}
            </button>

            <button
              type="submit"
              className="btn btn-blue"
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit KYC"}
            </button>
          </div>

          {/* NEW: Verification Dashboard button BELOW the above two */}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-yellow2"
               onClick={() => navigate("/verification-dashboard")}
>
  Verification Dashboard
            </button>
          </div>

          {aiResult && (
            <div className="extracted-data" style={{ marginTop: 20 }}>
              <h3>AI Fraud Risk Assessment</h3>
              <p>
                <strong>Fraud Score:</strong>{" "}
                {aiResult.fraud_score ?? "-"} / 100
              </p>
              <p>
                <strong>Risk Level:</strong>{" "}
                <span className={riskClass}>
                  {aiResult.risk_level || "UNKNOWN"}
                </span>
              </p>
              <p>
                <strong>Decision:</strong> {aiResult.decision || "PENDING"}
              </p>
              {Array.isArray(aiResult.reasons) &&
                aiResult.reasons.length > 0 && (
                  <>
                    <strong>Reasons:</strong>
                    <ul>
                      {aiResult.reasons.map((r, idx) => (
                        <li key={idx}>{r}</li>
                      ))}
                    </ul>
                  </>
                )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default DocumentUpload;
