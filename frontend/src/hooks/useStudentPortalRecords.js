import { useCallback, useContext, useEffect, useState } from "react";
import { SettingsContext } from "../context/SettingsContext.js";
import { supabase } from "../lib/supabaseClient.js";

export function useStudentPortalRecords(recordType) {
  const { session } = useContext(SettingsContext);
  const studentId = session?.user?.id;
  const isStudent = session?.user?.role === "student";
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRecords = useCallback(async () => {
    if (!supabase || !studentId || !isStudent) {
      setRecords([]);
      setError("Sign in with a linked student account to access saved records.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase
      .from("student_portal_records")
      .select("record_key, payload, created_at, updated_at")
      .eq("student_id", studentId)
      .eq("record_type", recordType)
      .order("created_at", { ascending: false });

    if (loadError) {
      setRecords([]);
      setError(`Could not load saved ${recordType.replaceAll("_", " ")}: ${loadError.message}`);
    } else {
      setRecords(
        (data || []).map((row) => ({
          ...(row.payload || {}),
          id: row.record_key,
          record_key: row.record_key,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })),
      );
    }
    setLoading(false);
  }, [isStudent, recordType, studentId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const saveRecord = useCallback(async (payload, recordKey) => {
    if (!supabase || !studentId || !isStudent) {
      setError("Sign in with a linked student account before saving.");
      return null;
    }

    const key = recordKey || globalThis.crypto?.randomUUID?.();
    if (!key) {
      setError("This browser cannot create a secure record ID. Please update your browser.");
      return null;
    }

    const { data, error: saveError } = await supabase
      .from("student_portal_records")
      .upsert(
        {
          student_id: studentId,
          record_type: recordType,
          record_key: key,
          payload,
        },
        { onConflict: "student_id,record_type,record_key" },
      )
      .select("record_key, payload, created_at, updated_at")
      .single();

    if (saveError) {
      setError(`Could not save ${recordType.replaceAll("_", " ")}: ${saveError.message}`);
      return null;
    }

    const savedRecord = {
      ...(data.payload || {}),
      id: data.record_key,
      record_key: data.record_key,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
    setRecords((current) => [
      savedRecord,
      ...current.filter((record) => record.record_key !== key),
    ]);
    setError("");
    return savedRecord;
  }, [isStudent, recordType, studentId]);

  const deleteRecord = useCallback(async (recordKey) => {
    if (!supabase || !studentId || !isStudent) {
      setError("Sign in with a linked student account before deleting.");
      return false;
    }

    const { error: deleteError } = await supabase
      .from("student_portal_records")
      .delete()
      .eq("student_id", studentId)
      .eq("record_type", recordType)
      .eq("record_key", recordKey);
    if (deleteError) {
      setError(`Could not delete saved record: ${deleteError.message}`);
      return false;
    }

    setRecords((current) => current.filter((record) => record.record_key !== recordKey));
    setError("");
    return true;
  }, [isStudent, recordType, studentId]);

  return {
    records,
    loading,
    error,
    studentId,
    saveRecord,
    deleteRecord,
    reload: loadRecords,
  };
}
