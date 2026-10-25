import { useEffect, useState } from "react";
import { Ico } from "./Ico.jsx";
import "./Landing.module.css";

export function Landing({ onSelect }) {
  const [mode, setMode] = useState(null);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [studentIndex, setStudentIndex] = useState("");
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
    if (mode === "student") {
      if (!/^\d{12}$/.test(studentIndex)) {
        setErr("Enter your 12-digit student ID.");
        return;
      }
      if (!pwd) {
        setErr("Enter your password.");
        return;
      }
    } else if (!email || !pwd) {
      setErr("Please fill in both fields.");
      return;
    }
    setErr("");
    setLoading(true);
    try {
      if (mode === "student") {
        const result = await onSelect(mode, { index: studentIndex }, pwd);
        if (!result?.ok) setErr(result?.error || "Student sign in failed.");
        return;
      }

      const payloadUser = {
        name: "Admin User",
        role: mode,
        email,
      };
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
          <div className="landing-sub">{mode === "admin" ? "Admin Portal" : "Student Portal"}</div>
          <div className="login-form">
            <button className="login-back" onClick={() => { setMode(null); setErr(""); setPwd(""); }}><Ico name="back" size={16} color="#1a56db" /> Back</button>
            {err && <div className="alert alert-danger">{err}</div>}
            {mode === "student" ? (
              <div className="auth-input-wrap">
                <span className="auth-input-icon"><Ico name="profile" size={18} color="#64748b" /></span>
                <input
                  className="form-input"
                  placeholder="Student ID"
                  value={studentIndex}
                  onChange={(e) => setStudentIndex(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  maxLength={12}
                  inputMode="numeric"
                  autoComplete="username"
                />
              </div>
            ) : (
            <div className="auth-input-wrap">
              <span className="auth-input-icon"><Ico name="email" size={18} color="#64748b" /></span>
              <input
                className="form-input"
                placeholder="Staff email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                inputMode="email"
              />
            </div>
            )}
            <div className="auth-input-wrap">
              <span className="auth-input-icon"><Ico name="lock" size={18} color="#64748b" /></span>
              <input
                className="form-input"
                type={showPwd ? "text" : "password"}
                data-has-toggle="true"
                placeholder={mode === "student" ? "Parent/guardian contact" : "Password"}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                maxLength={128}
                inputMode="text"
                autoComplete="current-password"
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
            <button className="btn-primary" onClick={handle} disabled={loading}><Ico name="signin" size={18} color="#fff" />{loading ? "Please wait..." : "Sign In"}</button>
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
            <div className="portal-btn-sub">Student account</div>
          </button>
        </div>
      </div>
    </div>
  );
}
