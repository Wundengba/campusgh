import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IoAttachOutline,
  IoChatbubblesOutline,
  IoMicOutline,
  IoPeopleOutline,
  IoSend,
  IoStopCircleOutline,
  IoCloseOutline,
  IoArrowBackOutline,
  IoAddOutline,
  IoInformationCircleOutline,
} from "react-icons/io5";
import { supabase } from "../lib/supabaseClient.js";
import "./StudyTeamsPage.css";

const EDUCATION_LEVELS = ["JHS", "SHS", "University", "Other"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_VOICE_NOTE_SECONDS = 120;
const FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const panelStyle = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: "clamp(14px, 2.5vw, 22px)",
  boxShadow: "0 12px 32px rgba(15, 23, 42, .06)",
  minWidth: 0,
  boxSizing: "border-box",
};

const normalizeEducationLevel = (className = "") => {
  const value = className.toLowerCase();
  if (/(jhs|junior|basic)/.test(value)) return "JHS";
  if (/(shs|senior)/.test(value)) return "SHS";
  if (/(university|tertiary|college|level\s*[1-9])/.test(value)) {
    return "University";
  }
  return "Other";
};

const getErrorMessage = (error) =>
  error?.message || "The request could not be completed.";

const displayNameOrFallback = (value, fallback) => {
  const displayName = String(value || "").trim();
  return displayName && !displayName.includes("@") ? displayName : fallback;
};

const formatConversationTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const mergeMessages = (current, incoming) => {
  const messagesById = new Map(
    [...current, ...incoming].map((message) => [message.id, message]),
  );
  return [...messagesById.values()]
    .sort((left, right) => new Date(left.created_at) - new Date(right.created_at))
    .slice(-200);
};

const signMessageAttachments = async (rows = []) =>
  Promise.all(
    rows.map(async (message) => {
      if (!message.attachment_path) return message;
      const { data, error } = await supabase.storage
        .from("study-team-resources")
        .createSignedUrl(message.attachment_path, 60 * 60);
      return {
        ...message,
        attachment_url: error ? "" : data?.signedUrl || "",
        attachment_error: error?.message || "",
      };
    }),
  );

function MemberAvatar({ src, name, className = "" }) {
  const initial = displayNameOrFallback(name, "Member").trim().slice(0, 1).toUpperCase();
  return (
    <span className={`study-chat-avatar ${className}`} aria-label={name || "Member"}>
      {initial}
      {src && (
        <img
          src={src}
          alt=""
          onError={(event) => event.currentTarget.remove()}
        />
      )}
    </span>
  );
}

export default function StudyTeamsPage({ user, studentData }) {
  const actorRole = String(user?.role || "").toLowerCase();
  const isStudent = actorRole === "student";
  const canCreateTeams = [
    "student",
    "admin",
    "school_admin",
    "teacher",
    "staff",
  ].includes(actorRole);
  const studentClass = String(studentData?.class || studentData?.class_name || "").trim();
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [activeTab, setActiveTab] = useState("teams");
  const [directConversations, setDirectConversations] = useState([]);
  const [teamPreviews, setTeamPreviews] = useState({});
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [availableMembers, setAvailableMembers] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [typingMembers, setTypingMembers] = useState([]);
  const [resources, setResources] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceDescription, setResourceDescription] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceFile, setResourceFile] = useState(null);
  const [voiceNoteBlob, setVoiceNoteBlob] = useState(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [inviteEmails, setInviteEmails] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    education_level: "",
    class_level: "",
    subject: "",
  });
  const realtimeChannelRef = useRef(null);
  const typingTimerRef = useRef(null);
  const messagesTeamIdRef = useRef("");
  const activeChatContextRef = useRef("");
  const messagesContainerRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceTimerRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const discardVoiceRef = useRef(false);
  const hasInitializedTeamSelectionRef = useRef(false);
  const fileInputRef = useRef(null);
  const resourceDetailsRef = useRef(null);

  useEffect(() => {
    if (!isStudent || !studentClass) return;
    setForm((current) => ({
      ...current,
      education_level: normalizeEducationLevel(studentClass),
      class_level: studentClass,
    }));
  }, [isStudent, studentClass]);

  const loadMemberships = useCallback(async () => {
    if (!supabase || !user?.authUserId) {
      setMemberships([]);
      setErrorMessage(
        !supabase
          ? "Study teams are unavailable because Supabase is not configured."
          : "Sign in again to load study teams.",
      );
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage("");
    const { data, error } = await supabase
      .from("collaborative_study_team_members")
      .select(
        "id, team_id, role_key, invitation_status, invited_at, team:collaborative_study_teams(id, name, description, education_level, class_level, subject, created_by, created_by_role)",
      )
      .eq("user_id", user.authUserId)
      .order("invited_at", { ascending: false });

    if (error) {
      setMemberships([]);
      setErrorMessage(`Study teams could not be loaded: ${error.message}`);
    } else {
      setMemberships((data || []).filter((item) => item.team));
    }
    setLoading(false);
  }, [user?.authUserId]);

  useEffect(() => {
    loadMemberships();
  }, [loadMemberships]);

  const loadDirectConversations = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc(
      "get_collaborative_study_direct_conversations",
    );
    if (error) {
      setErrorMessage(`Direct chats could not be loaded: ${error.message}`);
      return;
    }
    setDirectConversations(
      (data || []).map((conversation) => ({
        ...conversation,
        display_name: displayNameOrFallback(
          conversation.display_name,
          "Team member",
        ),
      })),
    );
  }, []);

  useEffect(() => {
    loadDirectConversations();
  }, [loadDirectConversations]);

  const activeMemberships = useMemo(
    () => memberships.filter((item) => item.invitation_status === "accepted"),
    [memberships],
  );
  useEffect(() => {
    let active = true;
    const loadTeamPreviews = async () => {
      if (!supabase || activeMemberships.length === 0) {
        setTeamPreviews({});
        return;
      }

      const results = await Promise.all(
        activeMemberships.map(async ({ team_id }) => {
          const { data, error } = await supabase
            .from("collaborative_study_team_messages")
            .select("content, attachment_type, created_at")
            .eq("team_id", team_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return { team_id, data, error };
        }),
      );
      if (!active) return;
      const failedResult = results.find((result) => result.error);
      if (failedResult) {
        setErrorMessage(
          `Team previews could not be loaded: ${failedResult.error.message}`,
        );
        return;
      }
      setTeamPreviews((current) => {
        const next = {};
        results
          .filter((result) => result.data)
          .forEach(({ team_id, data }) => {
            const preview = {
              text:
                data.attachment_type === "audio"
                  ? "Voice message"
                  : data.content,
              created_at: data.created_at,
            };
            const existing = current[team_id];
            next[team_id] =
              existing &&
              new Date(existing.created_at) > new Date(preview.created_at)
                ? existing
                : preview;
          });
        return next;
      });
    };
    loadTeamPreviews();
    return () => {
      active = false;
    };
  }, [activeMemberships]);
  const pendingInvitations = useMemo(
    () => memberships.filter((item) => item.invitation_status === "pending"),
    [memberships],
  );
  useEffect(() => {
    if (!loading && !hasInitializedTeamSelectionRef.current && activeMemberships.length > 0) {
      hasInitializedTeamSelectionRef.current = true;
      setSelectedTeamId(activeMemberships[0].team_id);
    }
  }, [activeMemberships, loading]);
  const selectedTeam = activeMemberships.find(
    (item) => item.team_id === selectedTeamId,
  )?.team;
  const selectedConversation = directConversations.find(
    (item) => item.conversation_id === selectedConversationId,
  );
  const activeChatId =
    activeTab === "teams" ? selectedTeamId : selectedConversationId;
  const activeChatTopic =
    activeTab === "teams"
      ? `study-team:${activeChatId}`
      : `study-direct:${activeChatId}`;
  activeChatContextRef.current = `${activeTab}:${activeChatId}`;
  const memberNames = useMemo(
    () =>
      new Map(
        teamMembers.map((member) => [
          member.user_id,
          displayNameOrFallback(member.display_name, "Team member"),
        ]),
      ),
    [teamMembers],
  );
  useEffect(() => {
    let active = true;
    const loadMembers = async () => {
      if (!supabase || activeMemberships.length === 0) {
        setAvailableMembers([]);
        return;
      }
      const results = await Promise.all(
        activeMemberships.map(({ team_id }) =>
          supabase.rpc("get_collaborative_study_team_members", {
            p_team_id: team_id,
          }),
        ),
      );
      const failedResult = results.find((result) => result.error);
      if (failedResult) {
        if (active) {
          setErrorMessage(
            `Team participants could not be loaded: ${failedResult.error.message}`,
          );
        }
        return;
      }
      if (!active) return;
      const memberMap = new Map();
      results.flatMap((result) => result.data || []).forEach((member) => {
        if (member.user_id !== user?.authUserId) {
          memberMap.set(member.user_id, {
            ...member,
            display_name: displayNameOrFallback(
              member.display_name,
              "Team member",
            ),
          });
        }
      });
      setAvailableMembers([...memberMap.values()]);
    };
    loadMembers();
    return () => {
      active = false;
    };
  }, [activeMemberships, user?.authUserId]);

  const currentDisplayName = displayNameOrFallback(
    memberNames.get(user?.authUserId) ||
      user?.name ||
      user?.full_name ||
      user?.display_name,
    "Team member",
  );
  const getSenderDisplayName = (message) =>
    message.sender_id === user?.authUserId
      ? currentDisplayName
      : selectedConversation?.other_user_id === message.sender_id
        ? selectedConversation.display_name
      : memberNames.get(message.sender_id) ||
        displayNameOrFallback(message.sender_name, "Team member");

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, activeChatId, activeTab]);

  useEffect(() => {
    discardVoiceRef.current = true;
    if (voiceRecorderRef.current?.state !== "inactive") {
      voiceRecorderRef.current?.stop();
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    voiceTimerRef.current = null;
    setIsRecordingVoice(false);
    setVoiceNoteBlob(null);
    recordingSecondsRef.current = 0;
    setRecordingSeconds(0);
  }, [activeTab, activeChatId]);

  useEffect(() => {
    if (!supabase || !activeChatId || !user?.authUserId) {
      setTypingMembers([]);
      return undefined;
    }

    setTypingMembers([]);
    const messagesContext = `${activeTab}:${activeChatId}`;
    if (messagesTeamIdRef.current !== messagesContext) {
      messagesTeamIdRef.current = messagesContext;
      setMessages([]);
    }
    let isActive = true;
    const isTeamChat = activeTab === "teams";
    const messageTable = isTeamChat
      ? "collaborative_study_team_messages"
      : "collaborative_study_direct_messages";
    const filterColumn = isTeamChat ? "team_id" : "conversation_id";
    const channel = supabase.channel(activeChatTopic, {
      config: { private: true, presence: { key: user.authUserId } },
    });
    realtimeChannelRef.current = channel;

    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: messageTable,
          filter: `${filterColumn}=eq.${activeChatId}`,
        },
        async ({ new: message }) => {
          const [signedMessage] = await signMessageAttachments([message]);
          if (isActive) {
            setMessages((current) => mergeMessages(current, [signedMessage]));
            if (isTeamChat) {
              setTeamPreviews((current) => ({
                ...current,
                [activeChatId]: {
                  text:
                    message.attachment_type === "audio"
                      ? "Voice message"
                      : message.content,
                  created_at: message.created_at,
                },
              }));
            }
            if (!isTeamChat) loadDirectConversations();
          }
        },
      )
      .on("presence", { event: "sync" }, () => {
        const presence = channel.presenceState();
        const activeTypers = Object.values(presence)
          .flat()
          .filter(
            (member) =>
              member.user_id !== user.authUserId &&
              member.typing &&
              Date.now() - member.typing_at < 6000,
          )
          .map((member) =>
            displayNameOrFallback(member.display_name, "A team member"),
          );
        setTypingMembers([...new Set(activeTypers)]);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track({
            user_id: user.authUserId,
            display_name: currentDisplayName,
            typing: false,
            typing_at: Date.now(),
          });
          supabase
            .from(messageTable)
            .select("id, sender_id, sender_name, content, attachment_path, attachment_type, created_at")
            .eq(filterColumn, activeChatId)
            .order("created_at", { ascending: true })
            .limit(200)
            .then(({ data, error }) => {
              if (!isActive) return;
              if (error) {
                setErrorMessage(`Live messages could not be synchronized: ${error.message}`);
              } else if (data) {
                signMessageAttachments(data).then((signedMessages) => {
                  if (isActive) {
                    setMessages((current) =>
                      mergeMessages(current, signedMessages),
                    );
                  }
                });
              }
            });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setErrorMessage(
            "Live chat updates could not connect. Confirm the latest Study Teams database migrations have been applied.",
          );
        }
      });

    return () => {
      isActive = false;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (realtimeChannelRef.current === channel) {
        realtimeChannelRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [
    activeTab,
    activeChatId,
    activeChatTopic,
    user?.authUserId,
    currentDisplayName,
    loadDirectConversations,
  ]);

  const updateTypingStatus = (typing) => {
    const channel = realtimeChannelRef.current;
    if (!channel || !user?.authUserId) return;
    channel.track({
      user_id: user.authUserId,
      display_name: currentDisplayName,
      typing,
      typing_at: Date.now(),
    });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (typing) {
      typingTimerRef.current = setTimeout(() => {
        channel.track({
          user_id: user.authUserId,
          display_name: currentDisplayName,
          typing: false,
          typing_at: Date.now(),
        });
      }, 2500);
    }
  };

  const startDirectChat = async (member) => {
    if (!supabase || !member?.user_id) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const { data: conversationId, error } = await supabase.rpc(
        "start_collaborative_study_direct_conversation",
        { p_other_user_id: member.user_id },
      );
      if (error) throw error;
      await loadDirectConversations();
      setSelectedConversationId(conversationId);
      setActiveTab("chats");
    } catch (error) {
      setErrorMessage(`Chat could not be opened: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const stopVoiceRecording = () => {
    const recorder = voiceRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    voiceTimerRef.current = null;
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    setIsRecordingVoice(false);
  };

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setErrorMessage("Voice recording is not supported by this browser.");
      return;
    }
    try {
      setErrorMessage("");
      setVoiceNoteBlob(null);
      const requestContext = activeChatContextRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (requestContext !== activeChatContextRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      discardVoiceRef.current = false;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      voiceRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (!discardVoiceRef.current) {
          const blobType = recorder.mimeType || "audio/webm";
          setVoiceNoteBlob(
            new Blob(voiceChunksRef.current, { type: blobType }),
          );
        }
        voiceChunksRef.current = [];
      };
      recorder.start();
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      setIsRecordingVoice(true);
      voiceTimerRef.current = setInterval(() => {
        const seconds = recordingSecondsRef.current + 1;
        recordingSecondsRef.current = seconds;
        setRecordingSeconds(Math.min(seconds, MAX_VOICE_NOTE_SECONDS));
        if (seconds >= MAX_VOICE_NOTE_SECONDS) stopVoiceRecording();
      }, 1000);
    } catch (error) {
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      setErrorMessage(`Microphone could not be started: ${getErrorMessage(error)}`);
    }
  };

  const discardVoiceNote = () => {
    discardVoiceRef.current = true;
    stopVoiceRecording();
    setVoiceNoteBlob(null);
    recordingSecondsRef.current = 0;
    setRecordingSeconds(0);
  };

  useEffect(
    () => () => {
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      if (voiceRecorderRef.current?.state !== "inactive") {
        voiceRecorderRef.current?.stop();
      }
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const loadSelectedTeamData = useCallback(async () => {
    if (!supabase || !selectedTeamId) {
      setMessages([]);
      setResources([]);
      setTeamMembers([]);
      return;
    }
    const requestContext = `teams:${selectedTeamId}`;

    const [messageResult, resourceResult, memberResult] = await Promise.all([
      supabase
        .from("collaborative_study_team_messages")
        .select("id, sender_id, sender_name, content, attachment_path, attachment_type, created_at")
        .eq("team_id", selectedTeamId)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("collaborative_study_team_resources")
        .select("id, shared_by_name, title, description, resource_type, resource_url, storage_path, created_at")
        .eq("team_id", selectedTeamId)
        .order("created_at", { ascending: false }),
      supabase.rpc("get_collaborative_study_team_members", {
        p_team_id: selectedTeamId,
      }),
    ]);

    const resultError =
      messageResult.error || resourceResult.error || memberResult.error;
    if (activeChatContextRef.current !== requestContext) return;
    if (resultError) {
      setErrorMessage(`Team content could not be loaded: ${resultError.message}`);
      setMessages([]);
      setResources([]);
      setTeamMembers([]);
      return;
    }

    if (activeTab === "teams") {
      const signedMessages = await signMessageAttachments(messageResult.data || []);
      if (activeChatContextRef.current !== requestContext) return;
      setMessages((current) => mergeMessages(current, signedMessages));
    }
    setTeamMembers(memberResult.data || []);
    const signedResources = await Promise.all(
      (resourceResult.data || []).map(async (resource) => {
        if (resource.resource_type !== "file") {
          return { ...resource, signed_url: resource.resource_url };
        }
        const { data, error } = await supabase.storage
          .from("study-team-resources")
          .createSignedUrl(resource.storage_path, 60 * 60);
        if (error) {
          return { ...resource, signed_url: "", signing_error: error.message };
        }
        return { ...resource, signed_url: data?.signedUrl || "" };
      }),
    );
    if (activeChatContextRef.current !== requestContext) return;
    setResources(signedResources);
  }, [selectedTeamId, activeTab]);

  useEffect(() => {
    loadSelectedTeamData();
  }, [loadSelectedTeamData]);

  useEffect(() => {
    let active = true;
    const loadDirectMessages = async () => {
      if (!supabase || activeTab !== "chats" || !selectedConversationId) return;
      const { data, error } = await supabase
        .from("collaborative_study_direct_messages")
        .select("id, sender_id, sender_name, content, attachment_path, attachment_type, created_at")
        .eq("conversation_id", selectedConversationId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (!active) return;
      if (error) {
        setErrorMessage(`Direct messages could not be loaded: ${error.message}`);
        return;
      }
      const signedMessages = await signMessageAttachments(data || []);
      if (active) setMessages((current) => mergeMessages(current, signedMessages));
    };
    loadDirectMessages();
    return () => {
      active = false;
    };
  }, [activeTab, selectedConversationId]);

  const createTeam = async (event) => {
    event.preventDefault();
    if (!supabase || !canCreateTeams) return;
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    const emails = inviteEmails
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    try {
      const { data, error } = await supabase.rpc(
        "create_collaborative_study_team",
        {
          p_name: form.name,
          p_description: form.description,
          p_education_level: form.education_level,
          p_class_level: form.class_level,
          p_subject: form.subject,
          p_invited_emails: emails,
        },
      );
      if (error) throw error;

      setSuccessMessage("Study team created and invitations sent.");
      setForm((current) => ({
        ...current,
        name: "",
        description: "",
        subject: "",
      }));
      setInviteEmails("");
      await loadMemberships();
      if (data) setSelectedTeamId(data);
    } catch (error) {
      setErrorMessage(`Study team could not be created: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const respondToInvitation = async (membershipId, response) => {
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const { error } = await supabase.rpc(
        "respond_to_collaborative_study_team_invitation",
        { p_membership_id: membershipId, p_response: response },
      );
      if (error) throw error;
      setSuccessMessage(
        response === "accepted"
          ? "Invitation accepted. You are now a team member."
          : "Invitation declined.",
      );
      await loadMemberships();
    } catch (error) {
      setErrorMessage(`Invitation could not be updated: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const content = messageText.trim();
    if ((!content && !voiceNoteBlob) || !activeChatId || !supabase) return;
    if (voiceNoteBlob && voiceNoteBlob.size > MAX_FILE_SIZE) {
      setErrorMessage("Voice notes must be 20 MB or smaller.");
      return;
    }
    setBusy(true);
    setErrorMessage("");
    let uploadedPath = "";
    try {
      if (voiceNoteBlob) {
        const extension = voiceNoteBlob.type.includes("mp4")
          ? "m4a"
          : voiceNoteBlob.type.includes("ogg")
            ? "ogg"
            : "webm";
        const directory =
          activeTab === "teams"
            ? `${selectedTeamId}/${user.authUserId}`
            : `direct/${selectedConversationId}/${user.authUserId}`;
        uploadedPath = `${directory}/${Date.now()}-voice-note.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("study-team-resources")
          .upload(uploadedPath, voiceNoteBlob, {
            contentType: (voiceNoteBlob.type || "audio/webm").split(";")[0],
            upsert: false,
          });
        if (uploadError) throw uploadError;
      }

      const { data: messageId, error } = await supabase.rpc(
        activeTab === "teams"
          ? "send_collaborative_study_team_message"
          : "send_collaborative_study_direct_message",
        activeTab === "teams"
          ? {
              p_team_id: selectedTeamId,
              p_content: content,
              p_attachment_path: uploadedPath || null,
            }
          : {
              p_conversation_id: selectedConversationId,
              p_content: content,
              p_attachment_path: uploadedPath || null,
            },
      );
      if (error) throw error;

      const table =
        activeTab === "teams"
          ? "collaborative_study_team_messages"
          : "collaborative_study_direct_messages";
      const filterColumn =
        activeTab === "teams" ? "team_id" : "conversation_id";
      const { data: message, error: messageError } = await supabase
        .from(table)
        .select("id, sender_id, sender_name, content, attachment_path, attachment_type, created_at")
        .eq("id", messageId)
        .eq(filterColumn, activeChatId)
        .single();
      if (messageError) throw messageError;
      const [signedMessage] = await signMessageAttachments([message]);
      setMessages((current) => mergeMessages(current, [signedMessage]));
      setMessageText("");
      setVoiceNoteBlob(null);
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      updateTypingStatus(false);
      if (activeTab === "chats") loadDirectConversations();
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from("study-team-resources")
          .remove([uploadedPath]);
        if (cleanupError) {
          setErrorMessage(
            `Message could not be sent: ${getErrorMessage(error)} Voice-note cleanup failed: ${cleanupError.message}`,
          );
          setBusy(false);
          return;
        }
      }
      setErrorMessage(`Message could not be sent: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const shareResource = async (event) => {
    event.preventDefault();
    if (!selectedTeam || !supabase || !resourceTitle.trim()) return;
    if (resourceFile && resourceUrl.trim()) {
      setErrorMessage("Share either a link or a file, not both.");
      return;
    }
    if (!resourceFile && !/^https?:\/\/\S+$/i.test(resourceUrl.trim())) {
      setErrorMessage("Enter a complete http or https resource link.");
      return;
    }
    if (
      resourceFile &&
      (!FILE_TYPES.has(resourceFile.type) || resourceFile.size > MAX_FILE_SIZE)
    ) {
      setErrorMessage("Choose a supported file type no larger than 20 MB.");
      return;
    }

    setBusy(true);
    setErrorMessage("");
    let uploadedPath = "";
    try {
      let resourceType = "link";
      if (resourceFile) {
        resourceType = "file";
        const safeName = resourceFile.name.replace(/[^\w.-]/g, "_");
        uploadedPath = `${selectedTeam.id}/${user.authUserId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("study-team-resources")
          .upload(uploadedPath, resourceFile, {
            contentType: resourceFile.type,
            upsert: false,
          });
        if (uploadError) throw uploadError;
      }

      const { error } = await supabase.rpc(
        "share_collaborative_study_team_resource",
        {
          p_team_id: selectedTeam.id,
          p_title: resourceTitle.trim(),
          p_description: resourceDescription.trim(),
          p_resource_type: resourceType,
          p_resource_url: resourceType === "link" ? resourceUrl.trim() : null,
          p_storage_path: resourceType === "file" ? uploadedPath : null,
        },
      );
      if (error) throw error;

      setResourceTitle("");
      setResourceDescription("");
      setResourceUrl("");
      setResourceFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadSelectedTeamData();
      setSuccessMessage("Resource shared with the team.");
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from("study-team-resources")
          .remove([uploadedPath]);
        if (cleanupError) {
          setErrorMessage(
            `Resource could not be saved: ${getErrorMessage(error)} File cleanup also failed: ${cleanupError.message}`,
          );
          setBusy(false);
          return;
        }
      }
      setErrorMessage(
        `Resource could not be shared: ${getErrorMessage(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const updateForm = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="study-teams-page">
      <div className="study-teams-toolbar">
        <header className="study-teams-heading">
          <h1>Chats</h1>
        </header>
        {canCreateTeams && (
          <details className="study-chat-create">
            <summary aria-label="Create a study team" title="Create a study team">
              <IoAddOutline aria-hidden="true" />
            </summary>
            <div className="study-chat-create-body">
              <form onSubmit={createTeam} className="study-chat-create-form">
                <div className="study-chat-create-fields">
                  <label className="form-group">
                    <span className="form-label">Team name</span>
                    <input className="form-control" required minLength={3} maxLength={100} value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
                  </label>
                  <label className="form-group">
                    <span className="form-label">Education level</span>
                    <select
                      className="form-control"
                      required
                      disabled={isStudent}
                      value={form.education_level}
                      onChange={(event) => updateForm("education_level", event.target.value)}
                    >
                      <option value="">Choose level</option>
                      {EDUCATION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </label>
                  <label className="form-group">
                    <span className="form-label">Class / year</span>
                    <input className="form-control" required minLength={1} maxLength={80} disabled={isStudent} value={form.class_level} onChange={(event) => updateForm("class_level", event.target.value)} placeholder="e.g. JHS 2 or SHS 1" />
                  </label>
                  <label className="form-group">
                    <span className="form-label">Subject</span>
                    <input className="form-control" required maxLength={100} value={form.subject} onChange={(event) => updateForm("subject", event.target.value)} placeholder="e.g. Mathematics" />
                  </label>
                </div>
                <label className="form-group">
                  <span className="form-label">Description</span>
                  <textarea className="form-control" rows={2} maxLength={1000} value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
                </label>
                <label className="form-group">
                  <span className="form-label">Invite participants by account email</span>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={inviteEmails}
                    onChange={(event) => setInviteEmails(event.target.value)}
                    placeholder="Separate email addresses with commas or spaces"
                  />
                </label>
                <button className="btn btn-blue" type="submit" disabled={busy || loading || (isStudent && !studentClass)}>
                  {busy ? "Creating..." : "Create team"}
                </button>
              </form>
            </div>
          </details>
        )}
      </div>

      {errorMessage && (
        <div role="alert" style={{ ...panelStyle, color: "#991b1b", background: "#fef2f2", borderColor: "#fecaca" }}>
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div role="status" style={{ ...panelStyle, color: "#166534", background: "#f0fdf4", borderColor: "#bbf7d0" }}>
          {successMessage}
        </div>
      )}

      {pendingInvitations.length > 0 && (
        <details className="study-chat-create study-chat-invitations">
          <summary>
            Invitations ({pendingInvitations.length})
            <span>Review team invitations</span>
          </summary>
          <div className="study-chat-create-body">
            <div style={{ display: "grid", gap: 10 }}>
              {pendingInvitations.map((membership) => (
                <div
                  key={membership.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 14,
                    flexWrap: "wrap",
                    padding: 12,
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                  }}
                >
                  <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                    <strong>{membership.team.name}</strong>
                    <div style={{ color: "#64748b", fontSize: ".88rem", marginTop: 4 }}>
                      {membership.team.education_level}   {membership.team.class_level}   {membership.team.subject}
                    </div>
                    <div style={{ color: "#64748b", fontSize: ".85rem" }}>
                      {membership.team.description}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-blue"
                      type="button"
                      disabled={busy}
                      onClick={() => respondToInvitation(membership.id, "accepted")}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-outline"
                      type="button"
                      disabled={busy}
                      onClick={() => respondToInvitation(membership.id, "declined")}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}

      <nav className="study-chat-tabs" role="tablist" aria-label="Study conversations">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "teams"}
          className={activeTab === "teams" ? "is-active" : ""}
          onClick={() => setActiveTab("teams")}
        >
          <IoPeopleOutline aria-hidden="true" />
          Teams
          {pendingInvitations.length > 0 && (
            <span aria-label={`${pendingInvitations.length} invitations`}>
              {pendingInvitations.length}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "chats"}
          className={activeTab === "chats" ? "is-active" : ""}
          onClick={() => setActiveTab("chats")}
        >
          <IoChatbubblesOutline aria-hidden="true" />
          Chats
        </button>
      </nav>

      <section
        className={`study-chat-workspace${(activeTab === "teams" && selectedTeam) || (activeTab === "chats" && selectedConversation) ? " is-chat-open" : ""}`}
        aria-label="Study conversations"
      >
        <aside className="study-chat-sidebar">
          {loading ? (
            <p className="study-chat-muted" role="status">Loading your teams...</p>
          ) : activeTab === "teams" && activeMemberships.length === 0 ? (
            <p className="study-chat-muted">Create a team or accept an invitation to get started.</p>
          ) : activeTab === "teams" ? (
            <div className="study-chat-team-list">
              {activeMemberships.map((membership) => {
                const team = membership.team;
                const active = selectedTeamId === team.id;
                return (
                  <button
                    key={team.id}
                    type="button"
                    className={`study-chat-team${active ? " is-active" : ""}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => setSelectedTeamId(team.id)}
                  >
                    <MemberAvatar name={team.name} className="is-team" />
                    <span className="study-chat-team-copy">
                      <strong>{team.name}</strong>
                      <span className="study-chat-team-preview">
                        {teamPreviews[team.id]?.text || `${team.subject}   ${team.class_level}`}
                      </span>
                    </span>
                    <time className="study-chat-list-time">
                      {formatConversationTime(teamPreviews[team.id]?.created_at)}
                    </time>
                    {active && <span className="study-chat-active-dot" aria-label="Selected team" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="study-chat-contact-list">
              {directConversations.map((conversation) => (
                <button
                  type="button"
                  key={conversation.conversation_id}
                  className={`study-chat-team${selectedConversationId === conversation.conversation_id ? " is-active" : ""}`}
                  onClick={() => setSelectedConversationId(conversation.conversation_id)}
                >
                  <MemberAvatar
                    src={conversation.avatar_url}
                    name={conversation.display_name}
                  />
                  <span className="study-chat-team-copy">
                    <strong>{conversation.display_name}</strong>
                    <span className="study-chat-team-preview">
                      {conversation.last_message || "Start a conversation"}
                    </span>
                  </span>
                  <time className="study-chat-list-time">
                    {formatConversationTime(conversation.last_message_at)}
                  </time>
                </button>
              ))}
              {availableMembers.length > 0 && (
                <>
                  <h3 className="study-chat-list-label">Team members</h3>
                  {availableMembers.map((member) => (
                    <button
                      type="button"
                      key={member.user_id}
                      className="study-chat-team"
                      disabled={busy}
                      onClick={() => startDirectChat(member)}
                    >
                      <MemberAvatar src={member.avatar_url} name={member.display_name} />
                      <span className="study-chat-team-copy">
                        <strong>{member.display_name}</strong>
                        <span>Start a private chat</span>
                      </span>
                    </button>
                  ))}
                </>
              )}
              {directConversations.length === 0 && availableMembers.length === 0 && (
                <p className="study-chat-muted">
                  Accept a team invitation to chat privately with its members.
                </p>
              )}
            </div>
          )}
        </aside>

        <section
          className="study-chat-main"
          aria-label={
            activeTab === "teams"
              ? selectedTeam
                ? `${selectedTeam.name} team chat`
                : "Team chat"
              : selectedConversation
                ? `Chat with ${selectedConversation.display_name}`
                : "Private chats"
          }
        >
          {(activeTab === "teams" && selectedTeam) ||
          (activeTab === "chats" && selectedConversation) ? (
            <>
              <header className="study-chat-header">
                <button
                  type="button"
                  className="study-chat-back-button"
                  onClick={() =>
                    activeTab === "teams"
                      ? setSelectedTeamId("")
                      : setSelectedConversationId("")
                  }
                  aria-label={`Back to ${activeTab === "teams" ? "teams" : "chats"}`}
                >
                  <IoArrowBackOutline aria-hidden="true" />
                </button>
                {activeTab === "teams" ? (
                  <MemberAvatar name={selectedTeam.name} className="is-large is-team" />
                ) : (
                  <MemberAvatar
                    src={selectedConversation.avatar_url}
                    name={selectedConversation.display_name}
                    className="is-large"
                  />
                )}
                <div className="study-chat-header-copy">
                  <h2>
                    {activeTab === "teams"
                      ? selectedTeam.name
                      : selectedConversation.display_name}
                  </h2>
                  <p>
                    {activeTab === "teams"
                      ? `${teamMembers.length} members`
                      : "Private chat"}
                  </p>
                </div>
                {activeTab === "teams" && (
                  <button
                    type="button"
                    className="study-chat-info-button"
                    onClick={() => resourceDetailsRef.current?.toggleAttribute("open")}
                    aria-label="Toggle team information and shared resources"
                    title="Team info"
                  >
                    <IoInformationCircleOutline aria-hidden="true" />
                  </button>
                )}
              </header>

              {activeTab === "teams" && (
                <details className="study-chat-details" ref={resourceDetailsRef}>
                  <summary aria-label="Close team information">Team information</summary>
                  <section className="study-chat-detail-section">
                    <div className="study-chat-team-about">
                      <strong>{selectedTeam.education_level}   {selectedTeam.class_level}   {selectedTeam.subject}</strong>
                      {selectedTeam.description && <span>{selectedTeam.description}</span>}
                    </div>
                  </section>
                  <section className="study-chat-detail-section">
                    <div className="study-chat-detail-heading">
                      <h3>Members</h3>
                      <span>{teamMembers.length}</span>
                    </div>
                    <div className="study-chat-participants">
                      {teamMembers.map((member) => (
                        <div className="study-chat-participant" key={member.id}>
                          <MemberAvatar src={member.avatar_url} name={member.display_name} />
                          <span>
                            <strong>{member.display_name}</strong>
                            <small>{member.role_key.replaceAll("_", " ")}</small>
                          </span>
                          {member.user_id !== user?.authUserId && (
                            <button
                              type="button"
                              className="study-chat-member-action"
                              onClick={() => startDirectChat(member)}
                              disabled={busy}
                            >
                              Message
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="study-chat-detail-section">
                    <div className="study-chat-detail-heading">
                      <h3>Shared resources</h3>
                      <span>{resources.length}</span>
                    </div>
                    {resources.length === 0 ? (
                      <p className="study-chat-muted">No resources shared yet.</p>
                    ) : (
                      <div className="study-chat-resources">
                        {resources.map((resource) => (
                          <article className="study-chat-resource" key={resource.id}>
                            <span className="study-chat-resource-icon">
                              {resource.resource_type === "file" ? "FILE" : "LINK"}
                            </span>
                            <span>
                              {resource.signed_url ? (
                                <a href={resource.signed_url} target="_blank" rel="noreferrer">
                                  {resource.title}
                                </a>
                              ) : (
                                <strong>{resource.title}</strong>
                              )}
                              {resource.description && <small>{resource.description}</small>}
                              {resource.signing_error && (
                                <small>Download unavailable: {resource.signing_error}</small>
                              )}
                            </span>
                          </article>
                        ))}
                      </div>
                    )}
                    <form onSubmit={shareResource} className="study-chat-share-form">
                      <strong>Share a file or link</strong>
                      <input
                        className="form-control"
                        required
                        maxLength={160}
                        value={resourceTitle}
                        onChange={(event) => setResourceTitle(event.target.value)}
                        placeholder="Resource title"
                        aria-label="Resource title"
                      />
                      <input
                        className="form-control"
                        maxLength={1000}
                        value={resourceDescription}
                        onChange={(event) => setResourceDescription(event.target.value)}
                        placeholder="Description (optional)"
                        aria-label="Resource description (optional)"
                      />
                      <input
                        className="form-control"
                        type="url"
                        value={resourceUrl}
                        onChange={(event) => {
                          setResourceUrl(event.target.value);
                          if (event.target.value) setResourceFile(null);
                        }}
                        placeholder="https:// link"
                        aria-label="Resource link"
                      />
                      <label className="study-chat-file-label">
                        Or upload a file (20 MB max)
                        <input
                          ref={fileInputRef}
                          className="form-control"
                          type="file"
                          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null;
                            setResourceFile(file);
                            if (file) {
                              setResourceTitle(file.name.replace(/\.[^.]+$/, ""));
                              setResourceUrl("");
                            }
                          }}
                        />
                      </label>
                      <button
                        className="study-chat-share-button"
                        type="submit"
                        disabled={busy || (!resourceUrl.trim() && !resourceFile)}
                      >
                        {busy ? "Sharing..." : "Share resource"}
                      </button>
                    </form>
                  </section>
                </details>
              )}

              <div ref={messagesContainerRef} className="study-chat-messages" role="log" aria-live="polite" aria-relevant="additions">
                {messages.length === 0 ? (
                  <div className="study-chat-empty">
                    <span className="study-chat-empty-icon">*</span>
                    <strong>Start the conversation</strong>
                    <p>Share a question, idea, or helpful resource with your team.</p>
                  </div>
                ) : messages.map((message) => {
                  const ownMessage = message.sender_id === user?.authUserId;
                  const senderName = getSenderDisplayName(message);
                  const senderAvatar =
                    selectedConversation?.other_user_id === message.sender_id
                      ? selectedConversation.avatar_url
                      : teamMembers.find(
                          (member) => member.user_id === message.sender_id,
                        )?.avatar_url ||
                        availableMembers.find(
                          (member) => member.user_id === message.sender_id,
                        )?.avatar_url ||
                        (ownMessage ? studentData?.photo_url : "");
                  return (
                    <article
                      key={message.id}
                      className={`study-chat-message${ownMessage ? " is-own" : ""}`}
                    >
                      <MemberAvatar src={senderAvatar} name={senderName} />
                      <div className="study-chat-message-content">
                        <div className="study-chat-message-meta">
                          <strong>{senderName}</strong>
                          <time dateTime={message.created_at}>
                            {new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </time>
                        </div>
                        <div className="study-chat-bubble">
                          {message.attachment_type === "audio" ? (
                            message.attachment_url ? (
                              <audio
                                controls
                                preload="none"
                                src={message.attachment_url}
                                aria-label={`Voice note from ${senderName}`}
                              />
                            ) : (
                              <span>
                                Voice note unavailable
                                {message.attachment_error
                                  ? `: ${message.attachment_error}`
                                  : ""}
                              </span>
                            )
                          ) : (
                            message.content
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="study-chat-typing" aria-live="polite">
                {typingMembers.length > 0
                  ? `${typingMembers.slice(0, 2).join(", ")}${typingMembers.length > 2 ? ` and ${typingMembers.length - 2} more` : ""} typing...`
                  : ""}
              </div>
              <form className="study-chat-composer-wrap" onSubmit={sendMessage}>
                <div className="study-chat-composer">
                  {activeTab === "teams" && (
                    <button
                      className="study-chat-icon-button"
                      type="button"
                      onClick={() => {
                        resourceDetailsRef.current?.setAttribute("open", "");
                        window.setTimeout(() => fileInputRef.current?.click(), 0);
                      }}
                      aria-label="Attach a file to shared resources"
                      title="Attach a file"
                    >
                      <IoAttachOutline aria-hidden="true" />
                    </button>
                  )}
                  {isRecordingVoice ? (
                    <div className="study-chat-recording" role="status">
                      <span className="study-chat-recording-dot" />
                      Recording {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:{String(recordingSeconds % 60).padStart(2, "0")}
                    </div>
                  ) : voiceNoteBlob ? (
                    <div className="study-chat-recording is-ready">
                      Voice note ready ({Math.floor(recordingSeconds)}s)
                      <button
                        type="button"
                        className="study-chat-icon-button"
                        onClick={discardVoiceNote}
                        aria-label="Discard voice note"
                        title="Discard"
                      >
                        <IoCloseOutline aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <textarea
                      rows={1}
                      maxLength={4000}
                      value={messageText}
                      onChange={(event) => {
                        setMessageText(event.target.value);
                        updateTypingStatus(Boolean(event.target.value.trim()));
                      }}
                      onBlur={() => updateTypingStatus(false)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      placeholder="Write a message"
                      aria-label="Write a message"
                    />
                  )}
                  {isRecordingVoice ? (
                    <button
                      type="button"
                      className="study-chat-icon-button is-recording"
                      onClick={stopVoiceRecording}
                      aria-label="Stop voice recording"
                      title="Stop recording"
                    >
                      <IoStopCircleOutline aria-hidden="true" />
                    </button>
                  ) : voiceNoteBlob || messageText.trim() ? (
                    <button
                      type="submit"
                      className="study-chat-send-button"
                      disabled={busy}
                      aria-label="Send message"
                      title="Send"
                    >
                      <IoSend aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="study-chat-icon-button"
                      onClick={startVoiceRecording}
                      aria-label="Record a voice note"
                      title="Record a voice note"
                    >
                      <IoMicOutline aria-hidden="true" />
                    </button>
                  )}
                </div>
              </form>
            </>
          ) : (
            <div className="study-chat-empty study-chat-no-selection">
              <strong>
                {activeTab === "teams"
                  ? "Select a team to open its group chat"
                  : "Select a chat or choose a team member"}
              </strong>
              <p>
                {activeTab === "teams"
                  ? "Your team messages, shared files, and participants will appear here."
                  : "Private chats are available with members of your teams."}
              </p>
            </div>
          )}
        </section>
      </section>

    </div>
  );
}
