import { useEffect, useState } from "react";
import { Ico } from "./Ico.jsx";
import "./Landing.module.css";

export function Landing({ onSelect }) {
  const [mode, setMode] = useState("admin");
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

  const handle = async (event) => {
    event.preventDefault();
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

  return (
    <div className="landing">
      <div className="landing-box">
        <div className="brand-mark">
          <div className="landing-logo"><img src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png" alt="Campus Ghana" /></div>
        </div>
        <div className="landing-title">Campus Ghana</div>
        <div className="landing-sub">BECE preparation · WASSCE lessons<br />University course resources</div>
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
        <div className="login-portal-switch" role="group" aria-label="Choose sign-in portal">
          <button
            type="button"
            className={`login-portal-option${mode === "admin" ? " active" : ""}`}
            aria-pressed={mode === "admin"}
            onClick={() => { setMode("admin"); setErr(""); setPwd(""); }}
          >
            <Ico name="schools" size={17} />
            Staff
          </button>
          <button
            type="button"
            className={`login-portal-option${mode === "student" ? " active" : ""}`}
            aria-pressed={mode === "student"}
            onClick={() => { setMode("student"); setErr(""); setPwd(""); }}
          >
            <Ico name="profile" size={17} />
            Student
          </button>
        </div>
        <form className="login-form" onSubmit={handle} noValidate>
          {err && <div className="alert alert-danger" role="alert">{err}</div>}
          <div className="auth-input-wrap">
            <span className="auth-input-icon"><Ico name={mode === "student" ? "profile" : "email"} size={18} color="#64748b" /></span>
            <input
              className="form-input"
              type={mode === "student" ? "text" : "email"}
              placeholder={mode === "student" ? "Student ID" : "Staff email"}
              aria-label={mode === "student" ? "Student ID" : "Staff email"}
              value={mode === "student" ? studentIndex : email}
              onChange={(e) => mode === "student"
                ? setStudentIndex(e.target.value.replace(/\D/g, "").slice(0, 12))
                : setEmail(e.target.value)}
              maxLength={mode === "student" ? 12 : 254}
              inputMode={mode === "student" ? "numeric" : "email"}
              autoComplete="username"
            />
          </div>
          <div className="auth-input-wrap">
            <span className="auth-input-icon"><Ico name="lock" size={18} color="#64748b" /></span>
            <input
              className="form-input"
              type={showPwd ? "text" : "password"}
              data-has-toggle="true"
              placeholder={mode === "student" ? "Parent/guardian contact" : "Password"}
              aria-label={mode === "student" ? "Parent/guardian contact" : "Password"}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              maxLength={128}
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
          <div className="login-help-row">
            <span>{mode === "student" ? "Use your 12-digit Student ID" : "Secure staff access"}</span>
            <span>Need help? Contact your school</span>
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>
            <span>{loading ? "Please wait..." : "Sign In"}</span>
            {!loading && <span className="login-submit-arrow" aria-hidden="true">→</span>}
          </button>
        </form>
        <div className="landing-footer">LEARN <span>•</span> IMPROVE <span>•</span> ACHIEVE</div>
      </div>
    </div>
  );
}
