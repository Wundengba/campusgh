import { useEffect, useMemo, useState } from "react";
import { IoArrowBack, IoNotificationsOutline } from "react-icons/io5";
import { supabase } from "../lib/supabaseClient.js";
import { StudentVerifiedBadge } from "./StudentVerifiedBadge.jsx";
import "./StudentNotificationsPage.css";

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

const initialsFor = (name = "") => {
  const initials = String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "");
  return initials.join("").toUpperCase() || "CG";
};

const getSocialAction = (notification) => {
  if (notification.event_type === "report_finalized") return "sent a moderation update";
  if (notification.event_type === "comment") {
    return notification.parent_comment_id ? "replied to your comment" : "commented on your post";
  }
  if (notification.event_type === "repost") return "reshared your post";
  const reaction = notification.reaction_type
    ? notification.reaction_type.charAt(0).toUpperCase() + notification.reaction_type.slice(1)
    : "a reaction";
  return notification.comment_id
    ? `reacted with ${reaction} to your comment`
    : `reacted with ${reaction} to your post`;
};

function Avatar({ name, src }) {
  return (
    <span className="student-notifications-avatar">
      {src ? <img src={src} alt="" /> : initialsFor(name)}
    </span>
  );
}

export default function StudentNotificationsPage({
  studentNotifications = [],
  studentNotificationsError = "",
  socialNotifications = [],
  socialNotificationsError = "",
  campusAnnouncements = [],
  selectionNotice,
  onBack,
  onMarkStudentNotificationRead,
  onOpenSocialNotification,
  onMarkAllRead,
}) {
  const [socialAuthors, setSocialAuthors] = useState([]);
  const [authorError, setAuthorError] = useState("");
  const actorIds = useMemo(
    () => [...new Set(socialNotifications.map((item) => item.actor_id).filter(Boolean))],
    [socialNotifications],
  );
  const actorIdKey = actorIds.join(",");

  useEffect(() => {
    if (!supabase || !actorIds.length) {
      setSocialAuthors([]);
      setAuthorError("");
      return undefined;
    }

    let active = true;
    const loadAuthors = async () => {
      const { data, error } = await supabase.rpc("get_campus_social_post_authors", {
        p_user_ids: actorIds,
      });
      if (!active) return;
      if (error) {
        setAuthorError("Verified activity names need database migration 046.");
        return;
      }
      if ((data || []).some((author) =>
        !Object.prototype.hasOwnProperty.call(author, "is_verified"),
      )) {
        setAuthorError("Verified activity names need database migration 046.");
      } else {
        setAuthorError("");
      }
      setSocialAuthors(data || []);
    };

    void loadAuthors();
    return () => {
      active = false;
    };
  }, [actorIdKey, actorIds]);

  const authorById = useMemo(
    () => new Map(socialAuthors.map((author) => [author.user_id, author])),
    [socialAuthors],
  );
  const notifications = useMemo(() => [
    ...socialNotifications.map((notification) => ({
      ...notification,
      source: "social",
      timestamp: new Date(notification.created_at).getTime() || 0,
    })),
    ...studentNotifications.map((notification) => ({
      ...notification,
      source: "student",
      timestamp: new Date(notification.created_at).getTime() || 0,
    })),
  ].sort((left, right) => right.timestamp - left.timestamp), [socialNotifications, studentNotifications]);
  const unreadCount = notifications.filter((notification) => !notification.is_read).length;
  const errors = [studentNotificationsError, socialNotificationsError, authorError].filter(Boolean);

  return (
    <section className="student-notifications-page" aria-labelledby="student-notifications-title">
      <header className="student-notifications-header">
        <button
          className="student-notifications-back"
          type="button"
          aria-label="Back"
          title="Back"
          onClick={onBack}
        >
          <IoArrowBack size={19} aria-hidden="true" />
        </button>
        <div className="student-notifications-heading">
          <span>YOUR CAMPUS ACTIVITY</span>
          <h1 id="student-notifications-title">Notifications</h1>
          <p>Social activity, account updates, and campus announcements in one place.</p>
        </div>
        <div className="student-notifications-controls">
          <span className="student-notifications-unread-count">{unreadCount} unread</span>
          <button type="button" onClick={onMarkAllRead} disabled={!unreadCount}>
            Mark all as read
          </button>
        </div>
      </header>

      {errors.map((error) => (
        <p className="student-notifications-error" key={error} role="status">{error}</p>
      ))}

      {notifications.length ? (
        <div className="student-notifications-list" aria-label="Recent notifications">
          {notifications.map((notification) => {
            if (notification.source === "social") {
              const actor = authorById.get(notification.actor_id);
              return (
                <button
                  type="button"
                  className={`student-notification-card${notification.is_read ? " is-read" : ""}`}
                  key={`social-${notification.id}`}
                  onClick={() => onOpenSocialNotification(notification)}
                >
                  <Avatar name={actor?.display_name || notification.actor_name} src={actor?.avatar_url} />
                  <span className="student-notification-copy">
                    <span className="student-notification-message">
                      <strong>
                        {actor?.display_name || notification.actor_name || "A student"}
                        {actor?.is_verified && <StudentVerifiedBadge />}
                      </strong>
                      <span>{getSocialAction(notification)}</span>
                    </span>
                    {notification.comment_preview && (
                      <span className="student-notification-preview">{notification.comment_preview}</span>
                    )}
                    {notification.post_preview && (
                      <span className="student-notification-context">On post: {notification.post_preview}</span>
                    )}
                    <time>{formatDate(notification.created_at)}</time>
                  </span>
                  {!notification.is_read && <span className="student-notification-dot" aria-label="Unread" />}
                </button>
              );
            }

            return (
              <button
                type="button"
                className={`student-notification-card${notification.is_read ? " is-read" : ""}`}
                key={`student-${notification.id}`}
                onClick={() => onMarkStudentNotificationRead(notification)}
              >
                <span className="student-notifications-avatar student-notifications-system-avatar">
                  <IoNotificationsOutline size={20} aria-hidden="true" />
                </span>
                <span className="student-notification-copy">
                  <span className="student-notification-message">
                    <strong>{notification.title}</strong>
                  </span>
                  <span className="student-notification-preview">{notification.message}</span>
                  <time>{formatDate(notification.created_at)}</time>
                </span>
                {!notification.is_read && <span className="student-notification-dot" aria-label="Unread" />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="student-notifications-empty">
          <span><IoNotificationsOutline size={26} aria-hidden="true" /></span>
          <h2>{errors.length ? "Notifications unavailable" : "You’re all caught up"}</h2>
          <p>{errors.length
            ? "We couldn’t load some activity. Check the message above or try again later."
            : "New social activity and account updates will appear here."}</p>
        </div>
      )}

      {(selectionNotice || campusAnnouncements.length > 0) && (
        <section className="student-campus-announcements" aria-label="Campus announcements">
          <div className="student-campus-announcements-heading">
            <div>
              <span>FROM CAMPUS GHANA</span>
              <h2>Campus announcements</h2>
            </div>
          </div>
          {selectionNotice && (
            <article className="student-campus-announcement is-approved">
              <strong>Selection approved</strong>
              <p>Your selected schools have been approved by the admin and placement processing can continue.</p>
              {selectionNotice.approvedAtLabel && <time>Approved: {selectionNotice.approvedAtLabel}</time>}
            </article>
          )}
          {campusAnnouncements.map((announcement) => (
            <article className="student-campus-announcement" key={announcement.id}>
              <strong>{announcement.title}</strong>
              <p>{announcement.body}</p>
              {announcement.date && <time>{announcement.date}</time>}
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
