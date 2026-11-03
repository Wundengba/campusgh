import { useEffect, useMemo, useRef, useState } from "react";
import { GHANA_DISTRICTS } from "../data/ghanaDistricts.js";
import { Ico } from "./Ico.jsx";
import "./StudentSignup.css";

const STUDENT_CLASSES = [
  "JHS 1",
  "JHS 2",
  "JHS 3",
  "SHS 1",
  "SHS 2",
  "SHS 3",
  "University Level 100",
  "University Level 200",
  "University Level 300",
  "University Level 400",
  "University Level 500",
  "University Level 600",
];

const getToday = () => {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
};

const resizePhoto = async (file) => {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your photo could not be processed.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("Your photo could not be processed.");
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Your photo could not be read."));
          return;
        }
        resolve(reader.result);
      };
      reader.onerror = () => reject(new Error("Your photo could not be read."));
      reader.readAsDataURL(blob);
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

export function StudentSignup({ onCreateAccount, onBackToLogin }) {
  const [form, setForm] = useState({
    fullName: "",
    gender: "",
    displayName: "",
    dateOfBirth: "",
    institution: "",
    studentClass: "",
    email: "",
    phone: "",
    region: "",
    district: "",
    password: "",
    confirmPassword: "",
  });
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdStudentId, setCreatedStudentId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const errorDialogRef = useRef(null);

  const districts = useMemo(
    () => GHANA_DISTRICTS.find((item) => item.name === form.region)?.districts || [],
    [form.region],
  );

  useEffect(() => {
    if (!photo) {
      setPhotoPreview("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(photo);
    setPhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [photo]);

  useEffect(() => {
    const dialog = errorDialogRef.current;
    if (!error || !dialog || dialog.open) return undefined;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [error]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setError("");
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "region" ? { district: "" } : {}),
    }));
  };

  const handlePhotoChange = (event) => {
    const nextPhoto = event.target.files?.[0] || null;
    if (nextPhoto && nextPhoto.size > 10 * 1024 * 1024) {
      setPhoto(null);
      setError("Choose a photo smaller than 10 MB.");
      event.target.value = "";
      return;
    }
    setPhoto(nextPhoto);
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (form.password.length < 10) {
      setError("Choose a password with at least 10 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!/^(?:0\d{9}|\+?233\d{9})$/.test(form.phone.replace(/[\s()-]/g, ""))) {
      setError("Enter a valid Ghanaian phone number.");
      return;
    }
    if (!photo) {
      setError("Choose a display photo to continue.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const photoDataUrl = await resizePhoto(photo);
      const result = await onCreateAccount({
        ...form,
        email: form.email.trim().toLowerCase(),
        fullName: form.fullName.trim(),
        displayName: form.displayName.trim(),
        institution: form.institution.trim(),
        photoDataUrl,
      });
      if (!result?.ok) {
        setError(result?.error || "Your account could not be created.");
        return;
      }
      setCreatedStudentId(result.studentId);
    } catch (signupError) {
      setError(signupError instanceof Error
        ? signupError.message
        : "Your account could not be created. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (createdStudentId) {
    return (
      <section className="signup-success" aria-live="polite">
        <div className="signup-success-icon" aria-hidden="true">✓</div>
        <h2>Your student account is ready</h2>
        <p>Save your Student ID. You will need it and your password to sign in.</p>
        <div className="signup-student-id">
          <span>Student ID</span>
          <strong>{createdStudentId}</strong>
        </div>
        <button
          className="btn-primary"
          type="button"
          onClick={() => onBackToLogin(createdStudentId)}
        >
          Continue to Sign In
        </button>
      </section>
    );
  }

  return (
    <>
    <form className="signup-form" onSubmit={handleSubmit} noValidate>
      <div className="signup-intro">
        <h2>Create your student account</h2>
        <p>Set up your profile to access learning materials for your class.</p>
      </div>

      <div className="signup-grid">
        <label className="signup-field">
          <span>Full name</span>
          <input name="fullName" value={form.fullName} onChange={updateField} autoComplete="name" maxLength={120} required />
        </label>
        <label className="signup-field">
          <span>Gender</span>
          <select name="gender" value={form.gender} onChange={updateField} required>
            <option value="">Select gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </label>
        <label className="signup-field">
          <span>Display name</span>
          <input name="displayName" value={form.displayName} onChange={updateField} autoComplete="nickname" maxLength={32} required />
        </label>
        <label className="signup-field">
          <span>Date of birth</span>
          <input name="dateOfBirth" type="date" max={getToday()} value={form.dateOfBirth} onChange={updateField} required />
        </label>
        <label className="signup-field">
          <span>Institution or school</span>
          <input name="institution" value={form.institution} onChange={updateField} autoComplete="organization" maxLength={180} required />
        </label>
        <label className="signup-field">
          <span>Level or class</span>
          <select name="studentClass" value={form.studentClass} onChange={updateField} required>
            <option value="">Select level or class</option>
            {STUDENT_CLASSES.map((studentClass) => (
              <option key={studentClass} value={studentClass}>{studentClass}</option>
            ))}
          </select>
        </label>
        <label className="signup-field">
          <span>Email address</span>
          <input name="email" type="email" value={form.email} onChange={updateField} autoComplete="email" maxLength={254} required />
        </label>
        <label className="signup-field">
          <span>Phone number</span>
          <input name="phone" type="tel" value={form.phone} onChange={updateField} autoComplete="tel" maxLength={20} placeholder="e.g. 024 123 4567" required />
        </label>
        <label className="signup-field">
          <span>Region</span>
          <select name="region" value={form.region} onChange={updateField} required>
            <option value="">Select region</option>
            {GHANA_DISTRICTS.map((region) => (
              <option key={region.name} value={region.name}>{region.name}</option>
            ))}
          </select>
        </label>
        <label className="signup-field">
          <span>Metropolitan, municipal or district assembly</span>
          <select name="district" value={form.district} onChange={updateField} disabled={!form.region} required>
            <option value="">{form.region ? "Select district" : "Choose a region first"}</option>
            {[...districts].sort((a, b) => a.localeCompare(b)).map((district) => (
              <option key={district} value={district}>{district}</option>
            ))}
          </select>
        </label>
        <div className="signup-field">
          <label htmlFor="signup-password">Password</label>
          <div className="signup-password-wrap">
            <input id="signup-password" name="password" type={showPassword ? "text" : "password"} value={form.password} onChange={updateField} autoComplete="new-password" minLength={10} maxLength={128} required />
            <button
              className="signup-password-toggle"
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              <Ico name={showPassword ? "eyeOff" : "eye"} size={18} />
            </button>
          </div>
        </div>
        <div className="signup-field">
          <label htmlFor="signup-confirm-password">Confirm password</label>
          <div className="signup-password-wrap">
            <input id="signup-confirm-password" name="confirmPassword" type={showConfirmPassword ? "text" : "password"} value={form.confirmPassword} onChange={updateField} autoComplete="new-password" maxLength={128} required />
            <button
              className="signup-password-toggle"
              type="button"
              onClick={() => setShowConfirmPassword((visible) => !visible)}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              title={showConfirmPassword ? "Hide password" : "Show password"}
            >
              <Ico name={showConfirmPassword ? "eyeOff" : "eye"} size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="signup-photo-row">
        {photoPreview
          ? <img className="signup-photo-preview" src={photoPreview} alt="Selected display photo preview" />
          : <div className="signup-photo-placeholder" aria-hidden="true">Photo</div>}
        <label className="signup-field signup-photo-field">
          <span>Display photo</span>
          <input type="file" accept="image/*" onChange={handlePhotoChange} required />
          <small>Choose a clear photo. It will be resized before upload.</small>
        </label>
      </div>

      <button className="btn-primary signup-submit" type="submit" disabled={loading}>
        {loading ? "Creating your account..." : "Create Account"}
      </button>
      <button className="signup-back" type="button" onClick={() => onBackToLogin("")} disabled={loading}>
        Back to sign in
      </button>
    </form>
    <dialog
      ref={errorDialogRef}
      className="signup-error-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="signup-error-title"
      onCancel={(event) => {
        event.preventDefault();
        setError("");
      }}
    >
      <h2 id="signup-error-title">Unable to create account</h2>
      <p>{error}</p>
      <button className="btn-primary" type="button" onClick={() => setError("")}>
        OK
      </button>
    </dialog>
    </>
  );
}
