// src/pages/HomePage.jsx
import React, { useEffect } from "react";
import "./HomePage.css";
import { useNavigate } from "react-router-dom";

const HomePage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.style.scrollBehavior = "smooth";
  }, []);

  // redirect to LOGIN PAGE
  const goToLogin = () => navigate("/login");

  return (
    <div className="home-wrapper">

      {/* ===== HERO SECTION ===== */}
      <header className="hero-section">
        <div className="container">
          <div className="trusted-by">
            TRUSTED BY 500+ FINANCIAL INSTITUTIONS
          </div>

          <h1>
            Enterprise-Grade{" "}
            <span className="highlight">Identity Verification</span>
          </h1>

          <p className="intro-text">
            Secure, compliant, and intelligent KYC verification platform designed
            for financial institutions, banks, credit unions, and financial
            services with enterprise-grade security and compliance.
          </p>

          {/* CTA BUTTONS */}
          <div className="cta-buttons">
            {/* 🔹 NOW GOES TO LOGIN PAGE */}
            <button className="btn-primary" onClick={goToLogin}>
              Start Verification
            </button>

            <a href="#contact" className="btn-secondary">
              View Demo
            </a>
          </div>
        </div>
      </header>

      {/* ===== WHY US ===== */}
      <section id="why-us" className="why-choose-us">
        <div className="container">
          <h2>Why Financial Institutions Choose Us</h2>

          <div className="features-container">
            <div className="feature-card" tabIndex="0">
              <span className="icon">🔒</span>
              <h3>Bank-Grade Security</h3>
              <p>Enterprise-level encryption & compliance (PCI DSS, ISO 27001).</p>
            </div>

            <div className="feature-card" tabIndex="0">
              <span className="icon">⚡</span>
              <h3>Instant Verification</h3>
              <p>Advanced OCR technology with fast & accurate verification.</p>
            </div>

            <div className="feature-card" tabIndex="0">
              <span className="icon">⚖️</span>
              <h3>Regulatory Compliance</h3>
              <p>Fully compliant with KYC, AML, and GDPR regulations.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CONTACT CTA ===== */}
      <section id="contact" className="kyc-process-cta">
        <div className="container">
          <h2>Ready to Secure Your KYC Process?</h2>
          <p>
            Join hundreds of financial institutions that trust our platform for
            secure, compliant identity verification.
          </p>

          <div className="cta-buttons">
            {/* 🔹 ALSO GOES TO LOGIN PAGE */}
            <button className="btn-primary" onClick={goToLogin}>
              Get Started Now →
            </button>

            <a href="#top" className="btn-secondary">
              Contact Sales
            </a>
          </div>
        </div>
      </section>

    </div>
  );
};

export default HomePage;