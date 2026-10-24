import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export function DocumentsTab({ group }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchDocs = async () => {
      setLoading(true);
      setError("");
      try {
        // List files in the group folder
        const { data, error: listError } = await supabase.storage
          .from("documents")
          .list(group, { limit: 100 });
        if (listError) throw listError;
        setDocs(data || []);
      } catch (err) {
        setError(err.message || "Failed to fetch documents.");
      } finally {
        setLoading(false);
      }
    };
    fetchDocs();
  }, [group]);

  const getPublicUrl = (fileName) => {
    return supabase.storage.from("documents").getPublicUrl(`${group}/${fileName}`).data.publicUrl;
  };

  if (loading) return <div>Loading documents...</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!docs.length) return <div>No documents found.</div>;

  return (
    <div className="documents-tab">
      <h3>Documents for {group.charAt(0).toUpperCase() + group.slice(1)}</h3>
      <ul>
        {docs.map((doc) => (
          <li key={doc.name}>
            <a href={getPublicUrl(doc.name)} target="_blank" rel="noopener noreferrer">{doc.name}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
