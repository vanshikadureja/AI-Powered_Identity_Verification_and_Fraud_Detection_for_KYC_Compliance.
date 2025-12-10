// src/pages/LoginPage.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";
import "@fortawesome/fontawesome-free/css/all.min.css";

const Login = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");

  const handleLogin = (e) => {
    e.preventDefault();

    if (!email || !password || !role) {
      alert("Please fill all fields and choose a role");
      return;
    }

    // Simple role-based routing (replace with real auth later)
    const r = role.toLowerCase();
    if (r === "admin") {
      navigate("/kyc-requests");
      return;
    }
    if (r === "user") {
      navigate("/upload");
      return;
    }

    // fallback for other roles
    navigate("/");
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <i className="fas fa-shield-alt lock-icon" aria-hidden="true"></i>
          <h2>SecureKYC</h2>
        </div>

        <p className="enterprise-text">Enterprise Identity Verification</p>

        <p className="welcome-text">
          👋 Welcome Back
          <br />
          Sign in to your secure account
        </p>

        <form onSubmit={handleLogin} className="login-form">
          <label className="sr-only" htmlFor="email">Email</label>
          <div className="input-group">
            <i className="fas fa-envelope" aria-hidden="true"></i>
            <input
              id="email"
              type="email"
              placeholder="Email Address"
              aria-label="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <label className="sr-only" htmlFor="password">Password</label>
          <div className="input-group">
            <i className="fas fa-key" aria-hidden="true"></i>
            <input
              id="password"
              type="password"
              placeholder="Password"
              aria-label="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <label className="sr-only" htmlFor="role">Role</label>
          <div className="input-group">
            <i className="fas fa-user-shield" aria-hidden="true"></i>
            <select
              id="role"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label="select role"
            >
              <option value="" disabled>
                Select role
              </option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="auditor">Auditor</option>
            </select>
          </div>

          <div className="options">
            <label className="remember">
              <input type="checkbox" aria-label="remember me" />
              <span> Remember Me</span>
            </label>
            <a className="forgot" href="#">
              Forgot Password?
            </a>
          </div>

          <button
            type="submit"
            className="login-btn"
            aria-pressed="false"
          >
            Login {role ? `as ${role}` : ""}
          </button>
        </form>

        <div className="footer-text">
          <p>
            Don’t have an account? <a href="#">Create Account</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;