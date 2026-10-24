import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export function AdminDocumentUpload({ onUpload }) {
  const [file, setFile] = useState(null);
  const [group, setGroup] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setSuccess("");
    setError("");
  };

  const handleGroupChange = (e) => {
    setGroup(e.target.value);
  };

  const handleUpload = async () => {
    if (!file || !group) {
      setError("Please select a file and group.");
      return;
    }
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      // Upload file to Supabase Storage (bucket: 'documents')
      const { data, error: uploadError } = await supabase.storage
        .from("documents")
        .upload(`${group}/${file.name}`, file);
      if (uploadError) throw uploadError;
      setSuccess("Document uploaded successfully.");
      setFile(null);
      setGroup("");
      if (onUpload) onUpload();
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-upload">
      <h3>Upload Document</h3>
      <input type="file" onChange={handleFileChange} />
      <select value={group} onChange={handleGroupChange}>
        <option value="">Select group</option>
        <option value="admins">Admins</option>
        <option value="students">Students</option>
        <option value="all">All</option>
      </select>
      <button onClick={handleUpload} disabled={uploading}>
        {uploading ? "Uploading..." : "Upload"}
      </button>
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
    </div>
  );
}
