// src/components/Navbar.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Navbar.css"; // keep your theme CSS here

export default function Navbar() {
  const navigate = useNavigate();
  const [role, setRole] = useState(() => {
    try {
      return sessionStorage.getItem("sk_role") || null;
    } catch (e) {
      return null;
    }
  });

  // Keep role in sync with sessionStorage (in case other tabs set it)
  useEffect(() => {
    function handler(e) {
      if (e.key === "sk_role") {
        setRole(e.newValue);
      }
    }
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const doLogout = () => {
    try {
      sessionStorage.removeItem("sk_role");
    } catch (e) {
      console.warn(e);
    }
    setRole(null);
    navigate("/");
  };

  // Navigation helpers
  const go = (path) => navigate(path);

  // Build nav items depending on role
  // user: Home, KYC Upload, My Documents, Logout
  // admin: Home, KYC Requests, Fraud Alerts, Audit Trail, Logout
  // manager: Home, Admin Panel, Logout
  // auditor: Home, Audit Trail, Logout
  // default (not logged): Home, Login
  let items = [];

  if (!role) {
    items = [
      { label: "Home", onClick: () => go("/") },
      { label: "Login", onClick: () => go("/login") },
    ];
  } else if (role === "user") {
    items = [
      { label: "Home", onClick: () => go("/") },
      { label: "KYC Upload", onClick: () => go("/upload") },
      { label: "My Documents", onClick: () => go("/documents") },
      {label: "Verification Dashboard", onClick: ()=> go("/verification-dashboard")},
      // optional quick links, you requested kyc upload component too
      { label: "KYC (Alt)", onClick: () => go("/kyc-upload") },
      { label: "Logout", onClick: doLogout, danger: true },
    ];
  } else if (role === "admin") {
    items = [
      { label: "Home", onClick: () => go("/") },
      { label: "KYC Requests", onClick: () => go("/kyc-requests") },
      { label: "Fraud Alerts", onClick: () => go("/fraud") },
      { label: "Audit Trail", onClick: () => go("/audit-trail") },
      { label: "Logout", onClick: doLogout, danger: true },
    ];
  } else if (role === "manager") {
    items = [
      { label: "Home", onClick: () => go("/") },
      { label: "Admin Panel", onClick: () => go("/admin") },
      { label: "Logout", onClick: doLogout, danger: true },
    ];
  } else if (role === "auditor") {
    items = [
      { label: "Home", onClick: () => go("/") },
      { label: "Audit Trail", onClick: () => go("/audit-trail") },
      { label: "Logout", onClick: doLogout, danger: true },
    ];
  } else {
    // fallback
    items = [
      { label: "Home", onClick: () => go("/") },
      { label: "Login", onClick: () => go("/login") },
    ];
  }

  return (
    <nav className="top-navbar">
      <div className="nav-left">
        <div className="brand" onClick={() => go("/")}>
          <span className="brand-logo">🟡</span>
          <span className="brand-text">SecureKYC</span>
        </div>
      </div>

      <div className="nav-center">
        {/* render items in a single row; style via Navbar.css */}
        {items.map((it, idx) => (
          <button
            key={idx}
            className={`nav-btn ${it.danger ? "danger" : ""}`}
            onClick={it.onClick}
            type="button"
          >
            {it.label}
          </button>
        ))}
      </div>

      <div className="nav-right">
        {role ? (
          <div className="role-pill">Role: <strong>{role}</strong></div>
        ) : (
          <button className="nav-btn" onClick={() => go("/login")}>Login</button>
        )}
      </div>
    </nav>
  );
}