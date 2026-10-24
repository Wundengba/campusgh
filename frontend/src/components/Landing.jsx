import { useEffect, useState } from "react";
import { Ico } from "./Ico.jsx";
import "./Landing.module.css";

export function Landing({ onSelect, hasSupabase }) {
  const [mode, setMode] = useState(null);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false);
  const [installingApp, setInstallingApp] = useState(false);

  const isStandalone = typeof window !== "undefined"
    && ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator?.standalone === true);
  const isIosDevice = typeof window !== "undefined"
    && /iphone|ipad|ipod/i.test(window.navigator?.userAgent || "");

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  const canShowInstallButton = !isStandalone && (!!installPromptEvent || isIosDevice);

  const handleInstallApp = async () => {
    if (installPromptEvent) {
      setInstallingApp(true);
      try {
        await installPromptEvent.prompt();
        await installPromptEvent.userChoice;
        setInstallPromptEvent(null);
      } finally {
        setInstallingApp(false);
      }
      return;
    }

    if (isIosDevice) {
      setShowIosInstallHelp((current) => !current);
    }
  };

  const handle = async () => {
    if (!email || !pwd) {
      setErr("Please fill in both fields.");
      return;
    }
    if (mode === "student") {
      if (!/^\d{10}$/.test(email) && !/^\d{12}$/.test(email)) {
        setErr(
          "Enter a 10-digit parent contact or the 12-digit generated student ID.",
        );
        return;
      }
      if (!/^\d{10}$/.test(pwd)) {
        setErr("Parent contact must be exactly 10 digits.");
        return;
      }
    }
    if (mode === "parent") {
      if (!email.includes("@")) {
        setErr("Please enter a valid email address.");
        return;
      }
      if (pwd.length < 6) {
        setErr("Password must be at least 6 characters.");
        return;
      }
    }
    setErr("");
    setLoading(true);
    try {
      const payloadUser = { name: mode === "admin" ? "Admin User" : mode === "parent" ? "Parent User" : "Student User", role: mode, email };
      const result = await onSelect(mode, payloadUser, pwd);
      if (!result?.ok) {
        const rawErr = String(result?.error || "");
        const authErr = rawErr.toLowerCase().includes("invalid login credentials")
          ? "Invalid email or password. Create an account first if you are new."
          : (result?.error || "Sign in failed.");
        setErr(authErr);
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (mode) {
    return (
      <div className="landing">
        <div className="landing-box">
          <button className="brand-btn" onClick={() => window.location.reload()} title="Reload app">
            <div className="landing-logo"><img src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png" alt="Campus Ghana" /></div>
          </button>
          <div className="landing-title">Sign In</div>
          <div className="landing-sub">{mode === "admin" ? "Admin Portal" : mode === "parent" ? "Parent Portal" : "Student Portal"}</div>
          <div className="login-form">
            <button className="login-back" onClick={() => { setMode(null); setErr(""); }}><Ico name="back" size={16} color="#1a56db" /> Back</button>
            {err && <div className="alert alert-danger">{err}</div>}
            <div className="auth-input-wrap">
              <span className="auth-input-icon"><Ico name="email" size={18} color="#64748b" /></span>
              <input
                className="form-input"
                placeholder={
                  mode === "admin"
                    ? "admin@campus.edu"
                    : mode === "parent"
                    ? "parent@email.com"
                    : "Student ID or guardian phone"
                }
                value={email}
                onChange={(e) => {
                  const value = e.target.value;
                  if (mode === "student") {
                    setEmail(value.replace(/\D/g, "").slice(0, 12));
                  } else {
                    setEmail(value);
                  }
                }}
                maxLength={mode === "student" ? 12 : 254}
                inputMode={mode === "student" ? "numeric" : mode === "parent" ? "email" : "email"}
              />
            </div>
            <div className="auth-input-wrap">
              <span className="auth-input-icon"><Ico name="lock" size={18} color="#64748b" /></span>
              <input
                className="form-input"
                type={showPwd ? "text" : "password"}
                data-has-toggle="true"
                placeholder={mode === "admin" ? "Password" : mode === "parent" ? "Password" : "Parent contact"}
                value={pwd}
                onChange={(e) => {
                  const value = e.target.value;
                  if (mode === "student") {
                    setPwd(value.replace(/\D/g, "").slice(0, 10));
                  } else {
                    setPwd(value);
                  }
                }}
                maxLength={mode === "student" ? 10 : 128}
                inputMode={mode === "student" ? "numeric" : "text"}
              />
              <button
                type="button"
                className="auth-pwd-toggle"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? "Hide password" : "Show password"}
                title={showPwd ? "Hide password" : "Show password"}
              >
                <Ico name={showPwd ? "eyeOff" : "eye"} size={18} color="#64748b" />
              </button>
            </div>
            <button className="btn-primary" onClick={handle} disabled={loading}><Ico name="signin" size={18} color="#fff" />{loading ? "Signing In..." : "Sign In"}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="landing">
      <div className="landing-box">
        <button className="brand-btn" onClick={() => window.location.reload()} title="Reload app">
          <div className="landing-logo"><img src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png" alt="Campus Ghana" /></div>
        </button>
        <div className="landing-title">Campus Ghana</div>
        <div className="landing-sub">School Management & BECE Mock Placement System</div>
        {canShowInstallButton && (
          <div className="landing-install-wrap">
            <button className="landing-install-btn" onClick={handleInstallApp} disabled={installingApp}>
              <span className="landing-install-icon"><Ico name="download" size={18} color="#fff" /></span>
              <span>
                <strong>{installingApp ? "Preparing install..." : "Download App"}</strong>
                <small>{installPromptEvent ? "Install Campus Ghana on this device" : "Add Campus Ghana to your home screen"}</small>
              </span>
            </button>
            {showIosInstallHelp && !installPromptEvent && (
              <div className="landing-install-help">
                On iPhone or iPad, tap the browser share button and choose <strong>Add to Home Screen</strong> to install the app.
              </div>
            )}
          </div>
        )}
        <div className="portal-grid">
          <button className="portal-btn" onClick={() => setMode("admin")}>
            <div className="portal-btn-icon"><Ico name="schools" size={24} color="#1a56db" /></div>
            <div className="portal-btn-label">Admin</div>
            <div className="portal-btn-sub">Staff & management</div>
          </button>
          <button className="portal-btn" onClick={() => setMode("student")}>
            <div className="portal-btn-icon"><Ico name="profile" size={24} color="#7c3aed" /></div>
            <div className="portal-btn-label">Student</div>
            <div className="portal-btn-sub">Students & parents</div>
          </button>
          <button className="portal-btn" onClick={() => setMode("parent")}>
            <div className="portal-btn-icon"><Ico name="family" size={24} color="#059669" /></div>
            <div className="portal-btn-label">Parent</div>
            <div className="portal-btn-sub">Monitor your children</div>
          </button>
        </div>
      </div>
    </div>
  );
}
