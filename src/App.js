// src/App.js
import React from "react";
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";

import Navbar from "./Navbar";

// PAGES — adjust these import paths if your filenames differ
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import DocumentUpload from "./pages/DocumentUpload";
import KycUploads from "./pages/KycUploads";
import MyDocuments from "./pages/MyDocuments";
import KycRequests from "./pages/KycRequests";
import FraudAlerts from "./pages/FraudAlerts";
import AuditTrail from "./pages/AuditTrail";
import VerificationDashboard from "./pages/VerificationDashboard";


// Layout component to hide navbar on login (and any other paths you want)
function Layout({ children }) {
  const loc = useLocation();
  // hide navbar on login page; extend array if you want other hidden routes
  const hideNav = ["/home","/login","/upload","/kyc-upload","/documents","/kyc-requests","/fraud","/audit-trail", "/verification-dashboard"];

  return (
    <>
      {!hideNav.includes(loc.pathname) && <Navbar />}
      <main>{children}</main>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          {/* Home */}
          <Route path="/home" element={<HomePage />} />

          {/* Login */}
          <Route path="/login" element={<LoginPage />} />

          {/* User flows */}
          <Route path="/verification-dashboard" element={<VerificationDashboard />} />
          <Route path="/upload" element={<DocumentUpload />} />
          <Route path="/kyc-upload" element={<KycUploads />} />
          <Route path="/documents" element={<MyDocuments />} />

          {/* Admin / Ops */}
          <Route path="/kyc-requests" element={<KycRequests />} />
          <Route path="/fraud" element={<FraudAlerts />} />
          <Route path="/audit-trail" element={<AuditTrail />} />

          {/* Fallback */}
          <Route path="*" element={HomePage ? <HomePage /> : <HomePage />} />
        </Routes>
      </Layout>
    </Router>
  );
}
