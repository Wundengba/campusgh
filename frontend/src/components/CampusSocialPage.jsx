import { useEffect, useMemo, useRef, useState } from "react";
import {
  IoAdd,
  IoArrowBack,
  IoBookmark,
  IoBookmarkOutline,
  IoChatbubbleEllipses,
  IoChatbubbleOutline,
  IoEyeOutline,
  IoExpandOutline,
  IoFlagOutline,
  IoHeart,
  IoHeartOutline,
  IoHome,
  IoPaperPlaneOutline,
  IoPersonCircle,
  IoPlay,
  IoTrendingUp,
  IoRepeat,
  IoSearch,
  IoTrashOutline,
} from "react-icons/io5";
import { supabase } from "../lib/supabaseClient.js";
import { Ico } from "./Ico.jsx";
import { StudentVerifiedBadge } from "./StudentVerifiedBadge.jsx";
import "./CampusSocialPage.css";

const REACTION_LABELS = {
  like: "Like",
  love: "Love",
  celebrate: "Celebrate",
  support: "Support",
};
const MEDIA_BUCKET = "campus-social-media";
const SOCIAL_NAV_ITEMS = [
  ["feed", "My Feed", IoHome],
  ["trending", "Trending", IoTrendingUp],
  ["videos", "Videos", IoPlay],
  ["discover", "Discover", IoSearch],
  ["library", "Library", IoBookmarkOutline],
  ["create", "Create", IoAdd],
  ["communities", "Communities", IoChatbubbleEllipses],
  ["profile", "My profile", IoPersonCircle],
];
const POPULAR_TOPICS = [
  { label: "Study Tips", terms: ["study", "exam", "revision", "assignment", "homework"] },
  { label: "WASSCE", terms: ["wassce", "bece", "waec", "shs"] },
  { label: "Campus Life", terms: ["campus", "hall", "lecture", "student", "university"] },
  { label: "Technology", terms: ["tech", "python", "react", "coding", "app", "ai"] },
  { label: "Events", terms: ["event", "meetup", "club", "workshop", "conference"] },
];

const getPostTopic = (post) => {
  const content = `${post.body || ""} ${post.community?.name || ""}`.toLowerCase();
  return POPULAR_TOPICS.find((topic) =>
    topic.terms.some((term) => content.includes(term)),
  )?.label || "Campus Life";
};

const initialsFor = (value) =>
  String(value || "ST")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-GH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const getErrorMessage = (error) =>
  error?.message || "Something went wrong. Please try again.";

function NameTags({ tags = [] }) {
  if (!tags.length) return null;
  return (
    <span className="campus-social-name-tags">
      {tags.map((tag) => <span key={tag}>{tag}</span>)}
    </span>
  );
}

function Avatar({ name, src, size = "medium" }) {
  return (
    <div className={`campus-social-avatar campus-social-avatar-${size}`}>
      {src ? <img src={src} alt="" /> : <span>{initialsFor(name)}</span>}
    </div>
  );
}

function mergeSocialAuthors(...groups) {
  const authorsById = new Map();
  groups.flat().forEach((author) => {
    if (!author?.user_id) return;
    const previous = authorsById.get(author.user_id);
    authorsById.set(author.user_id, {
      ...previous,
      ...author,
      is_verified: author.is_verified === true || previous?.is_verified === true,
    });
  });
  return [...authorsById.values()];
}

export default function CampusSocialPage({
  user,
  studentData,
  onOpenStudentProfile,
  onMessageStudent,
  socialNotificationToOpen,
  memberToOpen,
  onMemberProfileOpened,
}) {
  const [account, setAccount] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeView, setActiveView] = useState("feed");
  const [feedScope, setFeedScope] = useState("for-you");
  const [feedPageSize, setFeedPageSize] = useState(10);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [posts, setPosts] = useState([]);
  const [postViewCounts, setPostViewCounts] = useState({});
  const [postViewCountsReady, setPostViewCountsReady] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentReactions, setCommentReactions] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [reposts, setReposts] = useState([]);
  const [people, setPeople] = useState([]);
  const [commentAuthorProfiles, setCommentAuthorProfiles] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [communityRequests, setCommunityRequests] = useState([]);
  const [schools, setSchools] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [follows, setFollows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [feedInitialized, setFeedInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [postText, setPostText] = useState("");
  const [postFile, setPostFile] = useState(null);
  const [selectedCommunityId, setSelectedCommunityId] = useState("");
  const [commentDrafts, setCommentDrafts] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyingToComment, setReplyingToComment] = useState(null);
  const [expandedReplyThreads, setExpandedReplyThreads] = useState({});
  const [openComments, setOpenComments] = useState({});
  const [reportTarget, setReportTarget] = useState(null);
  const [viewedMemberProfile, setViewedMemberProfile] = useState(null);
  const [memberProfileTab, setMemberProfileTab] = useState("activity");
  const [memberProfilePosts, setMemberProfilePosts] = useState([]);
  const [memberProfilePostCount, setMemberProfilePostCount] = useState(null);
  const [memberProfilePostsLoading, setMemberProfilePostsLoading] = useState(false);
  const [memberProfilePostsError, setMemberProfilePostsError] = useState("");
  const [memberProfileStats, setMemberProfileStats] = useState({
    followerCount: null,
    followingCount: null,
    mutualUserIds: [],
    loading: false,
    error: "",
    mutualError: "",
  });
  const [reportCategory, setReportCategory] = useState("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [pendingNotificationPostId, setPendingNotificationPostId] = useState("");
  const [bookmarkedPostIds, setBookmarkedPostIds] = useState(() => new Set());
  const [sharedPostIds, setSharedPostIds] = useState(() => new Set());
  const [reactorPost, setReactorPost] = useState(null);
  const [fullPost, setFullPost] = useState(null);
  const [mediaViewer, setMediaViewer] = useState(null);
  const [reactors, setReactors] = useState([]);
  const [loadingReactors, setLoadingReactors] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showCommunityForm, setShowCommunityForm] = useState(false);
  const [communityForm, setCommunityForm] = useState({
    name: "",
    description: "",
    kind: "community",
    visibility: "public",
  });
  const postObserverRef = useRef(null);
  const fullPostOpenerRef = useRef(null);
  const postElementsRef = useRef(new Map());
  const postRefCallbacksRef = useRef(new Map());
  const viewedPostIdsRef = useRef(new Set());

  const observePost = (postId) => {
    if (!postRefCallbacksRef.current.has(postId)) {
      postRefCallbacksRef.current.set(postId, (element) => {
        if (element) {
          postElementsRef.current.set(postId, element);
          postObserverRef.current?.observe(element);
        } else {
          const previousElement = postElementsRef.current.get(postId);
          if (previousElement) postObserverRef.current?.unobserve(previousElement);
          postElementsRef.current.delete(postId);
        }
      });
    }
    return postRefCallbacksRef.current.get(postId);
  };

  useEffect(() => {
    if (!supabase || !account?.id) return undefined;
    setPostViewCounts({});
    setPostViewCountsReady(false);
    if (typeof IntersectionObserver === "undefined") {
      setNotice("Post view tracking is unavailable in this browser.");
      return undefined;
    }

    viewedPostIdsRef.current.clear();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.1) return;
        const postId = entry.target.dataset.postId;
        if (!postId || viewedPostIdsRef.current.has(postId)) return;
        viewedPostIdsRef.current.add(postId);
        observer.unobserve(entry.target);
        supabase.rpc("record_campus_social_post_view", { p_post_id: postId })
          .then(({ data, error }) => {
            if (error) {
              setNotice("Post views require database migration 049_campus_social_post_views.sql.");
              return;
            }
            setPostViewCounts((current) => ({ ...current, [postId]: Number(data) || 0 }));
          })
          .catch((error) => {
            setNotice(`Post view could not be recorded: ${getErrorMessage(error)}`);
          });
      });
    }, { threshold: 0.1 });

    postObserverRef.current = observer;
    postElementsRef.current.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      postObserverRef.current = null;
      viewedPostIdsRef.current.clear();
    };
  }, [account?.id]);

  useEffect(() => {
    if (!mediaViewer) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMediaViewer(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mediaViewer]);

  useEffect(() => {
    if (!fullPost) {
      fullPostOpenerRef.current?.focus();
      fullPostOpenerRef.current = null;
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !mediaViewer) setFullPost(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [fullPost, mediaViewer]);

  useEffect(() => {
    setFeedPageSize(10);
  }, [activeView, feedScope, selectedTopic]);

  useEffect(() => {
    let active = true;

    async function loadCurrentProfile() {
      if (!supabase) {
        setLoadError("Social features need a Supabase connection.");
        setLoading(false);
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError || !authData?.session?.user) {
        if (active) {
          setLoadError("Sign in to open Campus Social.");
          setLoading(false);
        }
        return;
      }

      const authUser = authData.session.user;
      if (active) setAccount(authUser);
      const { data: existingProfile, error: profileError } = await supabase
        .from("campus_social_profiles")
        .select("user_id, display_name, username, name_tags, display_name_changed_at, username_changed_at, bio, institution, education_level, avatar_url, discoverable")
        .eq("user_id", authUser.id)
        .maybeSingle();

      if (profileError) {
        if (active) {
          setLoadError(getErrorMessage(profileError));
          setLoading(false);
        }
        return;
      }

      let nextProfile = existingProfile;
      if (!nextProfile) {
        const studentName = studentData?.display_name || studentData?.full_name;
        const displayName = studentName || user?.name || authUser.user_metadata?.full_name || "Student";
        const { data: createdProfile, error: createError } = await supabase
          .from("campus_social_profiles")
          .insert({
            user_id: authUser.id,
            display_name: String(displayName).slice(0, 80),
            institution: String(studentData?.institution || studentData?.school_name || "").slice(0, 160),
            education_level: String(studentData?.class || studentData?.class_name || "").slice(0, 80),
            avatar_url: studentData?.photo_url || null,
          })
          .select("user_id, display_name, username, name_tags, display_name_changed_at, username_changed_at, bio, institution, education_level, avatar_url, discoverable")
          .single();

        if (createError) {
          if (active) {
            setLoadError(getErrorMessage(createError));
            setLoading(false);
          }
          return;
        }
        nextProfile = createdProfile;
      } else if (studentData?.photo_url && existingProfile.avatar_url !== studentData.photo_url) {
        const { data: updatedProfile, error: updateError } = await supabase
          .from("campus_social_profiles")
          .update({ avatar_url: studentData.photo_url })
          .eq("user_id", authUser.id)
          .select("user_id, display_name, username, name_tags, display_name_changed_at, username_changed_at, bio, institution, education_level, avatar_url, discoverable")
          .single();
        if (!updateError && updatedProfile) nextProfile = updatedProfile;
        else nextProfile = { ...existingProfile, avatar_url: studentData.photo_url };
      }

      if (active) {
        setAccount(authUser);
        setProfile(nextProfile);
      }
    }

    loadCurrentProfile();
    return () => {
      active = false;
    };
  }, [studentData?.id, studentData?.full_name, studentData?.photo_url, user?.name]);

  useEffect(() => {
    if (!supabase || !account?.id || discoveryLoading) return undefined;
    let active = true;

    async function loadSocialData() {
      setLoadError("");
      setPostViewCountsReady(false);
      try {
        const postSelect = "id, author_id, body, media_path, media_type, community_id, created_at";
        const followedUserIds = follows.map((follow) => follow.followed_user_id).filter(Boolean);
        const loadBookmarks = async () => {
          const rows = [];
          for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabase.from("campus_social_bookmarks")
              .select("post_id")
              .eq("user_id", account.id)
              .order("created_at", { ascending: false })
              .range(offset, offset + 499);
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < 500) return rows;
          }
        };
        const [postResult, followedPostResult, bookmarkRows] = await Promise.all([
          supabase.from("campus_social_posts")
            .select(postSelect)
            .order("created_at", { ascending: false }).limit(30),
          followedUserIds.length
            ? supabase.from("campus_social_posts")
                .select(postSelect)
                .in("author_id", followedUserIds)
                .order("created_at", { ascending: false }).limit(30)
            : Promise.resolve({ data: [], error: null }),
          loadBookmarks(),
        ]);
        if (postResult.error) throw postResult.error;
        if (followedPostResult.error) throw followedPostResult.error;

        const globalRows = postResult.data || [];
        const bookmarkIds = bookmarkRows.map((bookmark) => bookmark.post_id);
        const savedRows = [];
        for (let offset = 0; offset < bookmarkIds.length; offset += 200) {
          const { data, error } = await supabase.from("campus_social_posts")
              .select(postSelect)
              .in("id", bookmarkIds.slice(offset, offset + 200));
          if (error) throw error;
          savedRows.push(...(data || []));
        }
        const savedPostIds = new Set(bookmarkIds);
        const globalPostIds = new Set(globalRows.map((post) => post.id));
        const feedRows = [...new Map(
          [...globalRows, ...(followedPostResult.data || []), ...savedRows].map((post) => [post.id, post]),
        ).values()]
          .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
          .map((post) => ({
            ...post,
            following_only: !globalPostIds.has(post.id) && !savedPostIds.has(post.id),
            bookmarked_only: !globalPostIds.has(post.id)
              && !(followedPostResult.data || []).some((followedPost) => followedPost.id === post.id)
              && savedPostIds.has(post.id),
          }));
        if (active) {
          setPosts(feedRows.map((post) => ({ ...post, author: null, media_url: "" })));
          setBookmarkedPostIds(new Set(bookmarkIds));
          setLoading(false);
        }

        const postIds = feedRows.map((post) => post.id);
        const authorIds = [...new Set(feedRows.map((post) => post.author_id))];
        const mediaPaths = feedRows.map((post) => post.media_path).filter(Boolean);
        const [commentResult, reactionResult, repostResult, authorResult, mediaResult, viewCountResult] = postIds.length
          ? await Promise.all([
              supabase.from("campus_social_comments")
                .select("id, post_id, parent_comment_id, author_id, body, created_at")
                .in("post_id", postIds).order("created_at", { ascending: true }),
              supabase.from("campus_social_reactions")
                .select("post_id, user_id, reaction_type").in("post_id", postIds),
              supabase.from("campus_social_reposts")
                .select("id, post_id, user_id, created_at").in("post_id", postIds),
              authorIds.length
                ? supabase.rpc("get_campus_social_post_authors", { p_user_ids: authorIds })
                : Promise.resolve({ data: [], error: null }),
              mediaPaths.length
                ? supabase.storage.from(MEDIA_BUCKET).createSignedUrls(mediaPaths, 3600)
                : Promise.resolve({ data: [], error: null }),
              supabase.rpc("get_campus_social_post_view_counts", { p_post_ids: postIds }),
            ])
          : [
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
            ];

        const childResults = [commentResult, reactionResult, repostResult];
        const failedChild = childResults.find((result) => result.error);
        if (failedChild) throw failedChild.error;
        if (authorResult.error) throw authorResult.error;
        const commentIds = (commentResult.data || []).map((comment) => comment.id);
        const commentReactionResult = commentIds.length
          ? await supabase.from("campus_social_comment_reactions")
              .select("comment_id, user_id, reaction_type").in("comment_id", commentIds)
          : { data: [], error: null };
        if (commentReactionResult.error) throw commentReactionResult.error;

        const authorMap = new Map((authorResult.data || []).map((item) => [item.user_id, item]));
        if (authorIds.length && (authorResult.data || []).some((item) =>
          !Object.prototype.hasOwnProperty.call(item, "is_verified"),
        )) {
          if (active) setNotice("Verified author badges need database migration 046.");
        }
        if (profile) {
          authorMap.set(profile.user_id, {
            ...profile,
            ...authorMap.get(profile.user_id),
            is_verified:
              String(studentData?.status || "").toLowerCase() === "confirmed" ||
              authorMap.get(profile.user_id)?.is_verified === true,
          });
        }
        const commentAuthorIds = [...new Set(
          (commentResult.data || []).map((comment) => comment.author_id).filter(Boolean),
        )].filter((userId) => !authorMap.has(userId));
        const commentAuthorResult = commentAuthorIds.length
          ? await supabase.rpc("get_campus_social_post_authors", {
              p_user_ids: commentAuthorIds,
            })
          : { data: [], error: null };
        if (commentAuthorResult.error) throw commentAuthorResult.error;
        if (commentAuthorIds.length && (commentAuthorResult.data || []).some((author) =>
          !Object.prototype.hasOwnProperty.call(author, "is_verified"),
        )) {
          if (active) setNotice("Verified author badges need database migration 046.");
        }
        (commentAuthorResult.data || []).forEach((author) => {
          authorMap.set(author.user_id, author);
        });
        if (viewCountResult.error) {
          if (active) {
            setPostViewCounts({});
            setPostViewCountsReady(false);
            setNotice("Post views require database migration 049_campus_social_post_views.sql.");
          }
        } else if (active) {
          setPostViewCounts((current) => (viewCountResult.data || []).reduce(
            (counts, item) => ({
              ...counts,
              [item.post_id]: Math.max(
                counts[item.post_id] || 0,
                Number(item.view_count) || 0,
              ),
            }),
            current,
          ));
          setPostViewCountsReady(true);
        }
        const mediaUrlMap = new Map((mediaResult.data || []).map((item) => [item.path, item.signedUrl]));
        const signedPosts = feedRows.map((post) => ({
          ...post,
          author: authorMap.get(post.author_id),
          media_url: post.media_path ? mediaUrlMap.get(post.media_path) || "" : "",
        }));

        if (active) {
          setPosts(signedPosts);
          setComments(commentResult.data || []);
          setCommentAuthorProfiles((current) =>
            mergeSocialAuthors(current, [...authorMap.values()]),
          );
          setCommentReactions(commentReactionResult.data || []);
          setReactions(reactionResult.data || []);
          setReposts(repostResult.data || []);
        }
      } catch (error) {
        if (active) setLoadError(getErrorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSocialData();
    return () => {
      active = false;
    };
  }, [account?.id, discoveryLoading, follows]);

  useEffect(() => {
    if (!supabase || !account?.id) return undefined;
    let active = true;

    async function loadDiscoveryData() {
      try {
        const [followResult, communityResult, membershipResult, peopleResult, schoolResult, requestResult] = await Promise.all([
          supabase.from("campus_social_follows")
            .select("follower_id, followed_user_id, followed_community_id, followed_school_id")
            .eq("follower_id", account.id),
          supabase.from("campus_social_communities")
            .select("id, name, description, kind, visibility, created_by, created_at")
            .order("created_at", { ascending: false }).limit(80),
          supabase.from("campus_social_community_members")
            .select("community_id, user_id, role, status")
            .eq("user_id", account.id),
          supabase.from("campus_social_profiles")
            .select("user_id, display_name, username, name_tags, bio, institution, education_level, avatar_url")
            .eq("discoverable", true).order("display_name").limit(80),
          supabase.from("registered_schools")
            .select("id, name, region, category")
            .eq("active", true).order("name").limit(80),
          supabase.rpc("get_campus_social_community_requests"),
        ]);

        const failedResult = [followResult, communityResult, membershipResult, peopleResult]
          .find((result) => result.error);
        if (failedResult) throw failedResult.error;
        if (!active) return;
        const discoverableProfiles = peopleResult.data || [];
        const discoverableUserIds = discoverableProfiles.map((person) => person.user_id).filter(Boolean);
        let verifiedProfileById = new Map();
        if (discoverableUserIds.length) {
          const { data: authorRows, error: authorError } = await supabase.rpc(
            "get_campus_social_post_authors",
            { p_user_ids: discoverableUserIds },
          );
          if (authorError) {
            setNotice("Verified profile badges need database migration 046.");
          } else {
            verifiedProfileById = new Map((authorRows || []).map((author) => [author.user_id, author]));
            if ((authorRows || []).some((author) =>
              !Object.prototype.hasOwnProperty.call(author, "is_verified"),
            )) {
              setNotice("Verified profile badges need database migration 046.");
            }
            setCommentAuthorProfiles((current) => mergeSocialAuthors(current, authorRows || []));
          }
        }
        if (!active) return;
        if (active) {
          setFollows(followResult.data || []);
          setCommunities(communityResult.data || []);
          setMemberships(membershipResult.data || []);
          setPeople(discoverableProfiles.map((person) => ({
            ...person,
            is_verified: verifiedProfileById.get(person.user_id)?.is_verified === true,
          })));
          setSchools(schoolResult.error ? [] : schoolResult.data || []);
          setCommunityRequests(requestResult.error ? [] : requestResult.data || []);
        }
      } catch (error) {
        if (active) setNotice(getErrorMessage(error));
      } finally {
        if (active) setDiscoveryLoading(false);
      }
    }

    loadDiscoveryData();
    return () => {
      active = false;
    };
  }, [account?.id]);

  const followingIds = useMemo(
    () => new Set(follows.map((follow) => follow.followed_user_id).filter(Boolean)),
    [follows],
  );

  useEffect(() => {
    const memberId = viewedMemberProfile?.user_id;
    if (activeView !== "member-profile" || !account?.id || !memberId || discoveryLoading) return undefined;
    let active = true;
    setMemberProfileStats({
      followerCount: null,
      followingCount: null,
      mutualUserIds: [],
      loading: true,
      error: "",
      mutualError: "",
    });

    const loadMemberProfileStats = async () => {
      try {
        const [followersResult, followingResult, mutualFollowingResult] = await Promise.all([
          supabase.from("campus_social_follows")
            .select("follower_id", { count: "exact", head: true })
            .eq("followed_user_id", memberId),
          supabase.from("campus_social_follows")
            .select("followed_user_id", { count: "exact", head: true })
            .eq("follower_id", memberId),
          supabase.from("campus_social_follows")
            .select("followed_user_id")
            .eq("follower_id", memberId)
            .limit(500),
        ]);
        if (!active) return;

        const followingErrors = [followersResult, followingResult]
          .filter((result) => result.error)
          .map((result) => result.error.message);
        const mutualError = mutualFollowingResult.error
          ? `Mutual friends could not be loaded: ${mutualFollowingResult.error.message}`
          : "";
        setMemberProfileStats({
          followerCount: followersResult.error ? null : followersResult.count ?? 0,
          followingCount: followingResult.error ? null : followingResult.count ?? 0,
          mutualUserIds: (mutualFollowingResult.data || [])
            .map((follow) => follow.followed_user_id)
            .filter(Boolean),
          loading: false,
          error: followingErrors.length
            ? `Profile counts could not be loaded: ${followingErrors.join("; ")}`
            : "",
          mutualError,
        });
      } catch (error) {
        if (!active) return;
        const message = getErrorMessage(error);
        setMemberProfileStats({
          followerCount: null,
          followingCount: null,
          mutualUserIds: [],
          loading: false,
          error: `Profile statistics could not be loaded: ${message}`,
          mutualError: `Mutual friends could not be loaded: ${message}`,
        });
      }
    };

    loadMemberProfileStats();
    return () => {
      active = false;
    };
  }, [account?.id, activeView, discoveryLoading, viewedMemberProfile?.user_id]);

  useEffect(() => {
    const memberProfile = viewedMemberProfile;
    const memberId = memberProfile?.user_id;
    if (activeView !== "member-profile" || !account?.id || !memberId) return undefined;
    let active = true;
    setMemberProfilePosts([]);
    setMemberProfilePostCount(null);
    setMemberProfilePostsError("");
    setMemberProfilePostsLoading(true);

    const loadMemberProfilePosts = async () => {
      try {
        const postResult = await supabase.from("campus_social_posts")
          .select("id, author_id, body, media_path, media_type, community_id, created_at", { count: "exact" })
          .eq("author_id", memberId)
          .order("created_at", { ascending: false })
          .limit(30);
        if (postResult.error) throw postResult.error;

        const rows = postResult.data || [];
        const postIds = rows.map((post) => post.id);
        const mediaPaths = rows.map((post) => post.media_path).filter(Boolean);
        const [commentResult, reactionResult, repostResult, mediaResult] = postIds.length
          ? await Promise.all([
              supabase.from("campus_social_comments")
                .select("id, post_id, parent_comment_id, author_id, body, created_at")
                .in("post_id", postIds).order("created_at", { ascending: true }),
              supabase.from("campus_social_reactions")
                .select("post_id, user_id, reaction_type").in("post_id", postIds),
              supabase.from("campus_social_reposts")
                .select("id, post_id, user_id, created_at").in("post_id", postIds),
              mediaPaths.length
                ? supabase.storage.from(MEDIA_BUCKET).createSignedUrls(mediaPaths, 3600)
                : Promise.resolve({ data: [], error: null }),
            ])
          : [
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
            ];

        const commentIds = (commentResult.data || []).map((comment) => comment.id);
        const commentReactionResult = commentIds.length
          ? await supabase.from("campus_social_comment_reactions")
              .select("comment_id, user_id, reaction_type").in("comment_id", commentIds)
          : { data: [], error: null };
        const commentAuthorIds = [...new Set(
          (commentResult.data || []).map((comment) => comment.author_id).filter(Boolean),
        )];
        const commentAuthorResult = commentAuthorIds.length
          ? await supabase.rpc("get_campus_social_post_authors", {
              p_user_ids: commentAuthorIds,
            })
          : { data: [], error: null };
        if (!active) return;
        if (commentAuthorIds.length && (commentAuthorResult.data || []).some((author) =>
          !Object.prototype.hasOwnProperty.call(author, "is_verified"),
        )) {
          setNotice("Verified author badges need database migration 046.");
        }

        const detailErrors = [
          commentResult.error,
          reactionResult.error,
          repostResult.error,
          mediaResult.error,
          commentReactionResult.error,
          commentAuthorResult.error,
        ].filter(Boolean).map((error) => error.message);
        const postIdSet = new Set(postIds);
        const commentIdSet = new Set(commentIds);
        const mediaUrlMap = new Map((mediaResult.data || []).map((item) => [item.path, item.signedUrl]));

        setMemberProfilePosts(rows.map((post) => ({
          ...post,
          author: memberProfile,
          media_url: post.media_path ? mediaUrlMap.get(post.media_path) || "" : "",
        })));
        setMemberProfilePostCount(Number.isInteger(postResult.count) ? postResult.count : null);
        if (!commentResult.error) {
          setComments((current) => [
            ...current.filter((comment) => !postIdSet.has(comment.post_id)),
            ...(commentResult.data || []),
          ]);
        }
        if (!reactionResult.error) {
          setReactions((current) => [
            ...current.filter((reaction) => !postIdSet.has(reaction.post_id)),
            ...(reactionResult.data || []),
          ]);
        }
        if (!repostResult.error) {
          setReposts((current) => [
            ...current.filter((repost) => !postIdSet.has(repost.post_id)),
            ...(repostResult.data || []),
          ]);
        }
        if (!commentReactionResult.error) {
          setCommentReactions((current) => [
            ...current.filter((reaction) => !commentIdSet.has(reaction.comment_id)),
            ...(commentReactionResult.data || []),
          ]);
        }
        if (!commentAuthorResult.error) {
          setCommentAuthorProfiles((current) =>
            mergeSocialAuthors(current, commentAuthorResult.data || []),
          );
        }
        if (detailErrors.length) {
          setMemberProfilePostsError(`Some profile activity details could not be loaded: ${detailErrors.join("; ")}`);
        }
      } catch (error) {
        if (active) setMemberProfilePostsError(`Profile posts could not be loaded: ${getErrorMessage(error)}`);
      } finally {
        if (active) setMemberProfilePostsLoading(false);
      }
    };

    loadMemberProfilePosts();
    return () => {
      active = false;
    };
  }, [
    account?.id,
    activeView,
    viewedMemberProfile?.avatar_url,
    viewedMemberProfile?.display_name,
    viewedMemberProfile?.education_level,
    viewedMemberProfile?.institution,
    viewedMemberProfile?.is_verified,
    viewedMemberProfile?.name_tags,
    viewedMemberProfile?.user_id,
    viewedMemberProfile?.username,
  ]);

  const openMemberProfile = (member) => {
    if (!member?.user_id) return;
    if (member.user_id === account?.id) {
      onOpenStudentProfile();
      return;
    }
    const discoverableProfile = people.find((person) => person.user_id === member.user_id);
    setViewedMemberProfile({
      ...discoverableProfile,
      ...member,
      isFollowable: Boolean(discoverableProfile),
    });
    setMemberProfileTab("activity");
    setActiveView("member-profile");
    setComposerOpen(false);
  };
  const followedCommunityIds = useMemo(
    () => new Set(follows.map((follow) => follow.followed_community_id).filter(Boolean)),
    [follows],
  );
  const followedSchoolIds = useMemo(
    () => new Set(follows.map((follow) => String(follow.followed_school_id)).filter(Boolean)),
    [follows],
  );
  const memberByCommunity = useMemo(
    () => new Map(memberships.map((member) => [member.community_id, member])),
    [memberships],
  );
  const communityById = useMemo(
    () => new Map(communities.map((community) => [community.id, community])),
    [communities],
  );
  const socialAuthorById = useMemo(() => {
    const authors = mergeSocialAuthors(
      people,
      commentAuthorProfiles,
      profile ? [{
        ...profile,
        is_verified: String(studentData?.status || "").toLowerCase() === "confirmed"
          || profile.is_verified === true,
      }] : [],
      viewedMemberProfile ? [viewedMemberProfile] : [],
    );
    return new Map(authors.map((author) => [author.user_id, author]));
  }, [people, commentAuthorProfiles, profile, studentData?.status, viewedMemberProfile]);
  const visiblePeople = useMemo(() => {
    const query = search.trim().toLowerCase();
    return people.filter((person) => person.user_id !== account?.id && (
    !query || [person.display_name, person.username, ...(person.name_tags || []), person.institution, person.education_level, person.bio]
        .some((value) => String(value || "").toLowerCase().includes(query))
    ));
  }, [people, search, account?.id]);
  const visibleCommunities = useMemo(() => {
    const query = search.trim().toLowerCase();
    return communities.filter((community) => (
      !query || [community.name, community.description, community.kind]
        .some((value) => String(value || "").toLowerCase().includes(query))
    ));
  }, [communities, search]);
  const visibleSchools = useMemo(() => {
    const query = search.trim().toLowerCase();
    return schools.filter((school) => (
      !query || [school.name, school.region, school.category]
        .some((value) => String(value || "").toLowerCase().includes(query))
    ));
  }, [schools, search]);
  const trendingPosts = useMemo(() => [...posts].sort((left, right) => {
    const score = (post) =>
      reactions.filter((item) => item.post_id === post.id).length * 2
      + comments.filter((item) => item.post_id === post.id).length * 3
      + reposts.filter((item) => item.post_id === post.id).length * 4;
    return score(right) - score(left) || new Date(right.created_at) - new Date(left.created_at);
  }).filter((post) => !post.following_only && !post.bookmarked_only
    && Date.now() - new Date(post.created_at).getTime() <= 7 * 24 * 60 * 60 * 1000), [posts, reactions, comments, reposts]);
  const repostFeedItems = reposts
    .filter((repost) => repost.user_id === account?.id || followingIds.has(repost.user_id))
    .map((repost) => {
      const post = posts.find((item) => item.id === repost.post_id);
      if (!post) return null;
      const sharedBy = repost.user_id === account?.id
        ? { ...profile, user_id: account.id }
        : people.find((person) => person.user_id === repost.user_id);
      return {
        ...post,
        feed_item_key: `repost-${repost.id}`,
        repost_id: repost.id,
        is_repost: true,
        shared_by: sharedBy,
        shared_at: repost.created_at,
      };
    })
    .filter(Boolean);
  const feedPosts = activeView === "trending" ? trendingPosts : feedScope === "following"
    ? [
        ...posts.filter((post) => !post.bookmarked_only && (followingIds.has(post.author_id) || (post.community_id && followedCommunityIds.has(post.community_id)))),
        ...repostFeedItems,
      ].sort((left, right) => new Date(right.shared_at || right.created_at) - new Date(left.shared_at || left.created_at))
    : [
        ...posts.filter((post) => !post.following_only && !post.bookmarked_only),
        ...repostFeedItems,
      ].sort((left, right) => new Date(right.shared_at || right.created_at) - new Date(left.shared_at || left.created_at));
  const libraryPosts = posts
    .filter((post) => bookmarkedPostIds.has(post.id))
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  const visibleFeedPosts = activeView === "videos"
    ? posts.filter((post) => !post.bookmarked_only && post.media_type === "video")
    : activeView === "library"
      ? libraryPosts
      : feedPosts;
  const topicFilteredPosts = selectedTopic && activeView !== "library"
    ? visibleFeedPosts.filter((post) => getPostTopic(post) === selectedTopic)
    : visibleFeedPosts;
  const displayedPosts = topicFilteredPosts;
  const visiblePosts = displayedPosts.slice(0, feedPageSize);

  const runAction = async (action, successMessage = "") => {
    if (!supabase || !account?.id) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createPost = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = postText.trim();
    if (!supabase || !account?.id || (!body && !postFile)) return;
    if (body.length > 3000) {
      setNotice("Posts must be 3,000 characters or fewer.");
      return;
    }
    if (postFile && postFile.size > 50 * 1024 * 1024) {
      setNotice("Media files must be 50 MB or smaller.");
      return;
    }

    setBusy(true);
    setNotice("");
    let mediaPath = null;
    try {
      let mediaType = null;
      if (postFile) {
        const safeName = postFile.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100);
        mediaPath = `${account.id}/${crypto.randomUUID()}-${safeName}`;
        mediaType = postFile.type.startsWith("video/") ? "video" : "image";
        const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(mediaPath, postFile, {
          contentType: postFile.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
      }

      const { data: createdPost, error } = await supabase.from("campus_social_posts").insert({
        author_id: account.id,
        body,
        media_path: mediaPath,
        media_type: mediaType,
        community_id: selectedCommunityId || null,
      }).select("id, author_id, body, media_path, media_type, community_id, created_at").single();
      if (error) throw error;
      const { data: signedMedia } = mediaPath
        ? await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(mediaPath, 3600)
        : { data: null };
      setPosts((current) => [{
        ...createdPost,
        author: profile,
        media_url: signedMedia?.signedUrl || "",
      }, ...current]);
      setPostText("");
      setPostFile(null);
      setSelectedCommunityId("");
      setComposerOpen(false);
      form.reset();
      setNotice("Your update is live.");
    } catch (error) {
      if (mediaPath) await supabase.storage.from(MEDIA_BUCKET).remove([mediaPath]);
      setNotice(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async (targetType, targetId) => {
    const targetKey = targetType === "student" ? "followed_user_id"
      : targetType === "club" ? "followed_community_id" : "followed_school_id";
    const existing = follows.find((follow) => String(follow[targetKey]) === String(targetId));
    await runAction(async () => {
      if (existing) {
        const { error } = await supabase.from("campus_social_follows")
          .delete().eq("follower_id", account.id).eq(targetKey, targetId);
        if (error) throw error;
        setFollows((current) => current.filter((follow) => String(follow[targetKey]) !== String(targetId)));
        return;
      }
      const payload = { follower_id: account.id, followed_user_id: null, followed_community_id: null, followed_school_id: null };
      payload[targetKey] = targetId;
      const { data, error } = await supabase.from("campus_social_follows").insert(payload)
        .select("follower_id, followed_user_id, followed_community_id, followed_school_id")
        .single();
      if (error) throw error;
      setFollows((current) => [...current, data]);
    }, existing ? "Removed from your network." : "Added to your network.", false);
  };

  const toggleReaction = (postId, reactionType) => {
    const existing = reactions.find((item) => item.post_id === postId && item.user_id === account?.id);
    return runAction(async () => {
      if (existing?.reaction_type === reactionType) {
        const { error } = await supabase.from("campus_social_reactions")
          .delete().eq("post_id", postId).eq("user_id", account.id);
        if (error) throw error;
        setReactions((current) => current.filter((item) => !(item.post_id === postId && item.user_id === account.id)));
        return;
      }
      const { data, error } = await supabase.from("campus_social_reactions").upsert({
        post_id: postId,
        user_id: account.id,
        reaction_type: reactionType,
      }, { onConflict: "post_id,user_id" }).select("post_id, user_id, reaction_type").single();
      if (error) throw error;
      setReactions((current) => [
        ...current.filter((item) => !(item.post_id === postId && item.user_id === account.id)),
        data,
      ]);
    }, "", false);
  };

  const addComment = (event, postId, parentCommentId = null) => {
    event.preventDefault();
    const draftKey = parentCommentId || postId;
    const body = String(parentCommentId ? replyDrafts[draftKey] : commentDrafts[draftKey] || "").trim();
    if (!body) return;
    return runAction(async () => {
      const { data, error } = await supabase.from("campus_social_comments").insert({
        post_id: postId,
        parent_comment_id: parentCommentId,
        author_id: account.id,
        body: body.slice(0, 1000),
      }).select("id, post_id, parent_comment_id, author_id, body, created_at").single();
      if (error) throw error;
      setComments((current) => [...current, data]);
      if (parentCommentId) {
        setReplyDrafts((current) => ({ ...current, [draftKey]: "" }));
        setExpandedReplyThreads((current) => ({ ...current, [parentCommentId]: true }));
        setReplyingToComment(null);
      } else {
        setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      }
    }, "Comment added.", false);
  };

  const toggleCommentReaction = (commentId, reactionType = "like") => {
    const existing = commentReactions.find((item) =>
      item.comment_id === commentId && item.user_id === account?.id,
    );
    return runAction(async () => {
      if (existing?.reaction_type === reactionType) {
        const { error } = await supabase.from("campus_social_comment_reactions")
          .delete().eq("comment_id", commentId).eq("user_id", account.id);
        if (error) throw error;
        setCommentReactions((current) => current.filter((item) =>
          !(item.comment_id === commentId && item.user_id === account.id),
        ));
        return;
      }
      const { data, error } = await supabase.from("campus_social_comment_reactions")
        .upsert({ comment_id: commentId, user_id: account.id, reaction_type: reactionType }, {
          onConflict: "comment_id,user_id",
        })
        .select("comment_id, user_id, reaction_type")
        .single();
      if (error) throw error;
      setCommentReactions((current) => [
        ...current.filter((item) => !(item.comment_id === commentId && item.user_id === account.id)),
        data,
      ]);
    }, "", false);
  };

  const toggleRepost = (postId) => runAction(async () => {
    const existing = reposts.find((item) => item.post_id === postId && item.user_id === account.id);
    if (existing) {
      const { error } = await supabase.from("campus_social_reposts")
        .delete().eq("id", existing.id).eq("user_id", account.id);
      if (error) throw error;
      setReposts((current) => current.filter((item) => item.id !== existing.id));
      return;
    }

    const { data, error } = await supabase.from("campus_social_reposts")
      .insert({ post_id: postId, user_id: account.id })
      .select("id, post_id, user_id, created_at")
      .single();
    if (error) throw error;
    setReposts((current) => [...current, data]);
  }, reposts.some((item) => item.post_id === postId && item.user_id === account?.id)
    ? "Reshare removed."
    : "Shared with your followers.", false);

  const deleteComment = (comment) => runAction(async () => {
    const { error } = await supabase.from("campus_social_comments")
      .delete()
      .eq("id", comment.id)
      .eq("author_id", account.id);
    if (error) throw error;

    const removedIds = new Set([comment.id]);
    let foundChild = true;
    while (foundChild) {
      foundChild = false;
      comments.forEach((item) => {
        if (item.parent_comment_id && removedIds.has(item.parent_comment_id) && !removedIds.has(item.id)) {
          removedIds.add(item.id);
          foundChild = true;
        }
      });
    }
    setComments((current) => current.filter((item) => !removedIds.has(item.id)));
    setCommentReactions((current) => current.filter((item) => !removedIds.has(item.comment_id)));
  }, "Comment deleted.", false);

  const submitPostReport = (event) => {
    event.preventDefault();
    if (!reportTarget) return;
    return runAction(async () => {
      const { error } = await supabase.rpc(
        reportTarget.type === "comment"
          ? "submit_campus_social_comment_report"
          : "submit_campus_social_post_report",
        {
        ...(reportTarget.type === "comment"
          ? { p_comment_id: reportTarget.id }
          : { p_post_id: reportTarget.id }),
        p_category: reportCategory,
        p_details: reportDetails.trim(),
        },
      );
      if (error) throw error;
      setReportTarget(null);
      setReportDetails("");
      setReportCategory("spam");
    }, "Report sent to the moderation team. The content owner will not see who reported it.", false);
  };

  const createCommunity = (event) => {
    event.preventDefault();
    const name = communityForm.name.trim();
    if (!name) return;
    return runAction(async () => {
      const { data: communityId, error } = await supabase.rpc("create_campus_social_community", {
        p_name: name,
        p_description: communityForm.description.trim(),
        p_kind: communityForm.kind,
        p_visibility: communityForm.visibility,
      });
      if (error) throw error;
      const community = {
        id: communityId,
        name,
        description: communityForm.description.trim(),
        kind: communityForm.kind,
        visibility: communityForm.visibility,
        created_by: account.id,
        created_at: new Date().toISOString(),
      };
      setCommunities((current) => [community, ...current]);
      setMemberships((current) => [...current, {
        community_id: communityId,
        user_id: account.id,
        role: "owner",
        status: "accepted",
      }]);
      setCommunityForm({ name: "", description: "", kind: "community", visibility: "public" });
      setShowCommunityForm(false);
    }, "Community created.", false);
  };

  const joinCommunity = (community) => runAction(async () => {
    const { data, error } = await supabase.rpc("join_campus_social_community", {
      p_community_id: community.id,
    });
    if (error) throw error;
    const status = data === "pending" ? "pending" : "accepted";
    setMemberships((current) => [
      ...current.filter((member) => member.community_id !== community.id),
      { community_id: community.id, user_id: account.id, role: "member", status },
    ]);
  }, "", false);

  const leaveCommunity = (communityId) => runAction(async () => {
    const { error } = await supabase.from("campus_social_community_members")
      .delete().eq("community_id", communityId).eq("user_id", account.id);
    if (error) throw error;
    setMemberships((current) => current.filter((member) => member.community_id !== communityId));
  }, "Membership updated.", false);

  const reviewCommunityRequest = (communityId, userId, approve) => runAction(async () => {
    const { error } = await supabase.rpc("review_campus_social_community_request", {
      p_community_id: communityId,
      p_user_id: userId,
      p_approve: approve,
    });
    if (error) throw error;
    setCommunityRequests((current) => current.filter((request) => !(request.community_id === communityId && request.user_id === userId)));
    if (approve) {
      setMemberships((current) => [
        ...current.filter((member) => !(member.community_id === communityId && member.user_id === userId)),
        { community_id: communityId, user_id: userId, role: "member", status: "accepted" },
      ]);
    }
  }, approve ? "Student added to the community." : "Request declined.", false);

  const loadReactors = async (post) => {
    setReactorPost(post);
    setReactors([]);
    setLoadingReactors(true);
    const { data, error } = await supabase.rpc("get_campus_social_post_reactors", {
      p_post_id: post.id,
    });
    if (error) setNotice(getErrorMessage(error));
    else setReactors(data || []);
    setLoadingReactors(false);
  };

  const toggleBookmark = (post) => {
    const isBookmarked = bookmarkedPostIds.has(post.id);
    return runAction(async () => {
      const request = isBookmarked
        ? supabase.from("campus_social_bookmarks").delete()
            .eq("post_id", post.id).eq("user_id", account.id)
        : supabase.from("campus_social_bookmarks").insert({
            post_id: post.id,
            user_id: account.id,
          });
      const { error } = await request;
      if (error) throw error;
      setBookmarkedPostIds((current) => {
        const next = new Set(current);
        if (isBookmarked) next.delete(post.id);
        else next.add(post.id);
        return next;
      });
    }, isBookmarked ? "Bookmark removed." : "Post bookmarked.", false);
  };

  const sharePost = async (post) => {
    const shareData = {
      title: "Campus Ghana",
      text: post.body?.trim() || "See this post on Campus Ghana.",
      url: window.location.href,
    };

    try {
      if (typeof navigator.share === "function") {
        await navigator.share(shareData);
        setSharedPostIds((current) => new Set(current).add(post.id));
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareData.url);
        setSharedPostIds((current) => new Set(current).add(post.id));
        setNotice("Link copied to clipboard.");
      } else {
        setNotice("Sharing is not supported in this browser.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setNotice(getErrorMessage(error));
    }
  };

  const deletePost = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    return runAction(async () => {
      if (target.delete_kind === "repost") {
        const { error } = await supabase.from("campus_social_reposts")
          .delete().eq("id", target.repost_id).eq("user_id", account.id);
        if (error) throw error;
        setReposts((current) => current.filter((repost) => repost.id !== target.repost_id));
        if (fullPost?.repost_id === target.repost_id) setFullPost(null);
        setDeleteTarget(null);
        return;
      }
      const { error } = await supabase.from("campus_social_posts")
        .delete().eq("id", target.id).eq("author_id", account.id || profile?.user_id);
      if (error) throw error;
      if (fullPost?.id === target.id) setFullPost(null);
      setPosts((current) => current.filter((post) => post.id !== target.id));
      setMemberProfilePosts((current) => current.filter((post) => post.id !== target.id));
      setComments((current) => current.filter((item) => item.post_id !== target.id));
      setReactions((current) => current.filter((item) => item.post_id !== target.id));
      setReposts((current) => current.filter((item) => item.post_id !== target.id));
      setBookmarkedPostIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      if (target.media_path) {
        const { error: mediaError } = await supabase.storage.from(MEDIA_BUCKET).remove([target.media_path]);
        if (mediaError) console.error("Could not remove deleted social post media:", mediaError);
      }
      setDeleteTarget(null);
    }, "Post deleted.", false);
  };

  useEffect(() => {
    if (!socialNotificationToOpen?.requestKey || !socialNotificationToOpen.post_id) return;
    const notification = socialNotificationToOpen;
    setPendingNotificationPostId(notification.post_id);
    if (notification.event_type === "comment" || notification.comment_id) {
      setOpenComments((current) => ({ ...current, [notification.post_id]: true }));
    }
    if (notification.parent_comment_id) {
      setExpandedReplyThreads((current) => ({
        ...current,
        [notification.parent_comment_id]: true,
      }));
    }
    setActiveView("feed");
    setFeedScope("for-you");
    setComposerOpen(false);
  }, [socialNotificationToOpen]);

  useEffect(() => {
    if (activeView !== "feed" || !pendingNotificationPostId) return;
    const target = document.getElementById(`campus-social-post-${pendingNotificationPostId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingNotificationPostId("");
    }
  }, [activeView, pendingNotificationPostId, posts]);

  const postCount = (postId, rows) => rows.filter((item) => item.post_id === postId).length;

  useEffect(() => {
    if (!memberToOpen?.user_id) return;
    setViewedMemberProfile({ ...memberToOpen, isFollowable: true });
    setMemberProfileTab("activity");
    setActiveView("member-profile");
    setComposerOpen(false);
    onMemberProfileOpened?.();
  }, [memberToOpen]);

  const followButton = (type, id, label = "Connect") => {
    const key = type === "student" ? "followed_user_id" : type === "club" ? "followed_community_id" : "followed_school_id";
    const active = follows.some((follow) => String(follow[key]) === String(id));
    return (
      <button className={`campus-social-follow${active ? " is-following" : ""}`} type="button" onClick={() => toggleFollow(type, id)} disabled={busy}>
        {active ? (label === "Follow" ? "Following" : type === "student" ? "Connected" : label === "Connect" ? "Connected" : "Following") : label}
      </button>
    );
  };

  const openFullPost = (post, opener) => {
    if (opener) fullPostOpenerRef.current = opener;
    setFullPost(post);
    setOpenComments((current) => ({ ...current, [post.id]: true }));
  };

  const renderPost = (post, fullMode = false) => {
    const ownReaction = reactions.find((item) => item.post_id === post.id && item.user_id === account?.id);
    const hasReposted = reposts.some((item) => item.post_id === post.id && item.user_id === account?.id);
    const postComments = comments.filter((item) => item.post_id === post.id);
    const rootComments = postComments.filter((item) => !item.parent_comment_id);
    const postReactions = reactions.filter((item) => item.post_id === post.id);
    const commentAuthors = new Map(
      [...people, ...commentAuthorProfiles].map((person) => [person.user_id, person]),
    );
    const isOwnPost = !post.is_repost && [account?.id, profile?.user_id, user?.authUserId]
      .some((userId) => userId && String(userId) === String(post.author_id));
    const isOwnRepost = post.is_repost && post.shared_by?.user_id === account?.id;
    const renderComment = (comment, depth = 0) => {
      const resolvedAuthor = commentAuthors.get(comment.author_id);
      const isOwnComment = comment.author_id === account?.id;
      const author = isOwnComment
        ? {
            ...resolvedAuthor,
            ...profile,
            is_verified:
              String(studentData?.status || "").toLowerCase() === "confirmed" ||
              resolvedAuthor?.is_verified === true ||
              profile?.is_verified === true,
          }
        : resolvedAuthor;
      const commentReplies = postComments.filter((item) => item.parent_comment_id === comment.id);
      const repliesExpanded = expandedReplyThreads[comment.id] === true;
      const ownCommentReaction = commentReactions.find((item) =>
        item.comment_id === comment.id && item.user_id === account?.id,
      );
      const commentReactionCount = commentReactions.filter((item) => item.comment_id === comment.id).length;
      const commentDisplayName =
        author?.display_name ||
        (comment.author_id === account?.id ? profile?.display_name || user?.name : "") ||
        "Campus student";
      const repliesId = `campus-social-replies-${post.feed_item_key || post.id}-${comment.id}${fullMode ? "-full" : ""}`;
      return (
        <div className="campus-social-comment-thread" key={comment.id} style={{ "--comment-depth": Math.min(depth, 5) }}>
          <div className="campus-social-comment">
            <Avatar name={commentDisplayName} src={author?.avatar_url} size="small" />
            <strong className="campus-social-name-with-badge">
              {author?.user_id && comment.author_id !== account?.id ? (
                <button
                  type="button"
                  className="campus-social-profile-link"
                  onClick={() => openMemberProfile(author)}
                >
                  {commentDisplayName}
                </button>
              ) : commentDisplayName}
              {author?.is_verified && <StudentVerifiedBadge />}
            </strong>
            <span>{comment.body}</span>
            <div className="campus-social-comment-actions">
              <button
                type="button"
                className={ownCommentReaction ? "is-active" : ""}
                onClick={() => toggleCommentReaction(comment.id, ownCommentReaction?.reaction_type || "like")}
                disabled={busy}
              >
                {ownCommentReaction ? "Liked" : "Like"}{commentReactionCount ? ` · ${commentReactionCount}` : ""}
              </button>
              <button type="button" onClick={() => setReplyingToComment((current) => current === comment.id ? null : comment.id)}>
                Reply{commentReplies.length ? ` · ${commentReplies.length}` : ""}
              </button>
              {comment.author_id === account?.id ? (
                <button type="button" onClick={() => deleteComment(comment)} disabled={busy}>Delete</button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setReportTarget({ ...comment, type: "comment", post_id: post.id });
                    setReportCategory("spam");
                    setReportDetails("");
                  }}
                  disabled={busy}
                >
                  Report
                </button>
              )}
            </div>
            {commentReplies.length > 0 && (
              <button
                className="campus-social-comment-replies-toggle"
                type="button"
                aria-expanded={repliesExpanded}
                aria-controls={repliesId}
                onClick={() => setExpandedReplyThreads((current) => ({
                  ...current,
                  [comment.id]: !current[comment.id],
                }))}
              >
                <span aria-hidden="true">{repliesExpanded ? "−" : "+"}</span>
                {repliesExpanded
                  ? "Hide replies"
                  : `View ${commentReplies.length} ${commentReplies.length === 1 ? "reply" : "replies"}`}
              </button>
            )}
            {replyingToComment === comment.id && (
              <form className="campus-social-comment-form campus-social-reply-form" onSubmit={(event) => addComment(event, post.id, comment.id)}>
                <input
                  aria-label={`Reply to ${author?.display_name || "comment"}`}
                  maxLength={1000}
                  value={replyDrafts[comment.id] || ""}
                  onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))}
                  placeholder="Write a reply"
                />
                <button type="submit" disabled={busy || !String(replyDrafts[comment.id] || "").trim()}>Reply</button>
              </form>
            )}
          </div>
          {commentReplies.length > 0 && (
            <div className="campus-social-comment-replies" id={repliesId} hidden={!repliesExpanded}>
              {commentReplies.map((reply) => renderComment(reply, depth + 1))}
            </div>
          )}
        </div>
      );
    };
    return (
      <article
        className={`campus-social-post${fullMode ? " is-full-mode" : ""}`}
        id={`campus-social-post${fullMode ? "-full" : ""}-${post.id}`}
        data-post-id={post.id}
        ref={fullMode ? undefined : observePost(post.id)}
        key={post.feed_item_key || post.id}
      >
        {post.is_repost && (
          <div className="campus-social-repost-label">
            <IoRepeat size={15} />
            <span>
              <strong className="campus-social-name-with-badge">
                {post.shared_by?.display_name || (post.author_id === account?.id ? "You" : "Someone you follow")}
                {(post.shared_by?.is_verified || post.shared_by?.user_id === account?.id
                  && String(studentData?.status || "").toLowerCase() === "confirmed")
                  && <StudentVerifiedBadge />}
              </strong>{" "}
              shared this
            </span>
          </div>
        )}
        <header className="campus-social-post-head">
          <button
            type="button"
            className="campus-social-profile-avatar-link"
            aria-label={`View ${post.author?.display_name || "Campus student"} profile`}
            onClick={() => openMemberProfile(post.author)}
          >
            <Avatar name={post.author?.display_name || "Campus student"} src={post.author?.avatar_url} />
          </button>
          <div className="campus-social-post-author">
            <strong className="campus-social-name-with-badge">
              <button
                type="button"
                className="campus-social-profile-link"
                onClick={() => openMemberProfile(post.author)}
              >
                {post.author?.display_name || "Campus student"}
              </button>
              {post.author?.is_verified && <StudentVerifiedBadge />}
            </strong>
            {post.author?.name_tags?.length > 0 && (
              <span className="campus-social-post-handle">
                <NameTags tags={post.author.name_tags} />
              </span>
            )}
            {activeView === "feed" ? (
              <time dateTime={post.shared_at || post.created_at}>{formatDate(post.shared_at || post.created_at)}</time>
            ) : <span>{formatDate(post.created_at)}</span>}
          </div>
          <div className="campus-social-post-controls">
            {!fullMode && (
              <button
                className="campus-social-post-control campus-social-post-open-full"
                type="button"
                aria-label="Open full post"
                title="Open full post"
                onClick={(event) => {
                  openFullPost(post, event.currentTarget);
                }}
              >
                <IoExpandOutline size={18} />
              </button>
            )}
            {!isOwnPost && !isOwnRepost && (
              <>
                {post.author_id !== account?.id && !followingIds.has(post.author_id)
                  && people.some((person) => person.user_id === post.author_id)
                  && followButton("student", post.author_id)}
                <button
                  className="campus-social-post-control campus-social-post-control-report"
                  type="button"
                  aria-label="Report post"
                  title="Report post"
                  onClick={() => {
                    setReportTarget({ ...post, type: "post" });
                    setReportCategory("spam");
                    setReportDetails("");
                  }}
                  disabled={busy}
                >
                  <IoFlagOutline size={18} />
                </button>
              </>
            )}
            {(isOwnPost || isOwnRepost) && (
              <button
                className="campus-social-post-control campus-social-post-control-delete"
                type="button"
                aria-label={isOwnRepost ? "Remove reshare" : "Delete post"}
                title={isOwnRepost ? "Remove reshare" : "Delete post"}
                onClick={() => setDeleteTarget(isOwnRepost ? { ...post, delete_kind: "repost" } : post)}
                disabled={busy}
              >
                <IoTrashOutline size={19} />
              </button>
            )}
          </div>
        </header>
        {post.body && (fullMode ? (
          <p className="campus-social-post-body">{post.body}</p>
        ) : (
          <button
            className="campus-social-post-body campus-social-post-body-trigger"
            type="button"
            aria-label={`Open full post by ${post.author?.display_name || "Campus student"}`}
            title="Open full post"
            onClick={(event) => openFullPost(post, event.currentTarget)}
          >
            {post.body}
          </button>
        ))}
        {post.media_url && post.media_type === "image" && (
          <button
            className="campus-social-media-trigger"
            type="button"
            aria-label={fullMode ? "View photo fullscreen" : "Open full post with photo"}
            onClick={(event) => fullMode
              ? setMediaViewer({ url: post.media_url, type: "image", alt: "Shared by a student" })
              : openFullPost(post, event.currentTarget)}
          >
            <img className="campus-social-post-media" src={post.media_url} alt="Shared by a student" />
          </button>
        )}
        {post.media_url && post.media_type === "video" && (
          <button
            className="campus-social-media-trigger campus-social-video-trigger"
            type="button"
            aria-label={fullMode ? "Play video fullscreen" : "Open full post with video"}
            onClick={(event) => fullMode
              ? setMediaViewer({ url: post.media_url, type: "video", alt: "Video shared by a student" })
              : openFullPost(post, event.currentTarget)}
          >
            <video
              className="campus-social-post-media campus-social-video-preview"
              src={post.media_url}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (Number.isFinite(video.duration) && video.duration > 0) {
                  video.currentTime = Math.min(1, video.duration * 0.1);
                }
              }}
            />
            <span className="campus-social-video-play" aria-hidden="true">▶</span>
          </button>
        )}
        <div className={`campus-social-post-stats${isOwnPost ? " is-own-post" : ""}`}>
          <span
            className="campus-social-post-views"
            aria-label={
              postViewCountsReady
                ? (postViewCounts[post.id] ?? 0) >= 50
                  ? `${postViewCounts[post.id]} views`
                  : "New"
                : "View count unavailable"
            }
            title="Counts unique signed-in viewers; the author's own view is excluded"
          >
            <IoEyeOutline size={15} aria-hidden="true" />
            {postViewCountsReady
              ? (postViewCounts[post.id] ?? 0) >= 50
                ? `${postViewCounts[post.id]} views`
                : "New"
              : "Views unavailable"}
          </span>
          <button type="button" className="campus-social-count-link" onClick={() => isOwnPost && loadReactors(post)} disabled={!isOwnPost || postReactions.length === 0} title={isOwnPost ? "See who reacted" : "Reaction count"}>
            {postReactions.length} {postReactions.length === 1 ? "reaction" : "reactions"}
          </button>
        </div>
        <div className="campus-social-post-actions">
          <button type="button" className={ownReaction ? "is-active" : ""} aria-label={ownReaction ? "Unlike post" : "Like post"} aria-pressed={Boolean(ownReaction)} onClick={() => toggleReaction(post.id, ownReaction?.reaction_type || "like")} disabled={busy}>
            {ownReaction ? <IoHeart size={21} /> : <IoHeartOutline size={21} />}
            <span>{postReactions.length ? postReactions.length : "Like"}</span>
          </button>
          <button type="button" className={openComments[post.id] ? "is-active" : ""} aria-label="Show comments" aria-expanded={Boolean(openComments[post.id])} onClick={() => setOpenComments((current) => ({ ...current, [post.id]: !current[post.id] }))}>
            <IoChatbubbleOutline size={21} />
            <span>{postComments.length ? postComments.length : "Comment"}</span>
          </button>
          <button type="button" className={sharedPostIds.has(post.id) ? "is-active" : ""} aria-label="Share post" title="Share post" onClick={() => sharePost(post)}>
            <IoPaperPlaneOutline size={21} />
            <span>Share</span>
          </button>
          <button type="button" className={hasReposted ? "is-active" : ""} aria-label={hasReposted ? "Remove reshare" : "Reshare"} aria-pressed={hasReposted} onClick={() => toggleRepost(post.id)} disabled={busy}>
            <IoRepeat size={21} />
            <span>{postCount(post.id, reposts) || "Reshare"}</span>
          </button>
          <button
            type="button"
            className={bookmarkedPostIds.has(post.id) ? "is-active" : ""}
            aria-label={bookmarkedPostIds.has(post.id) ? "Remove bookmark" : "Bookmark post"}
            aria-pressed={bookmarkedPostIds.has(post.id)}
            title={bookmarkedPostIds.has(post.id) ? "Remove bookmark" : "Bookmark"}
            onClick={() => toggleBookmark(post)}
            disabled={busy}
          >
            {bookmarkedPostIds.has(post.id) ? <IoBookmark size={21} /> : <IoBookmarkOutline size={21} />}
            <span>{bookmarkedPostIds.has(post.id) ? "Saved" : "Save"}</span>
          </button>
        </div>
        {openComments[post.id] && (
          <section className="campus-social-comments" aria-label="Post discussion">
            <header className="campus-social-comments-heading">
              <span>Campus discussion</span>
              <span>{postComments.length} {postComments.length === 1 ? "comment" : "comments"}</span>
            </header>
            <div className="campus-social-comment-list" role="region" aria-label="Comments" tabIndex={0}>
              {rootComments.length ? rootComments.map((comment) => renderComment(comment)) : (
                <p className="campus-social-comments-empty">Start the conversation with a thoughtful comment.</p>
              )}
            </div>
            <form className="campus-social-comment-form" onSubmit={(event) => addComment(event, post.id)}>
              <input aria-label="Write a comment" maxLength={1000} value={commentDrafts[post.id] || ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} placeholder="Add to the discussion" />
              <button type="submit" disabled={busy || !String(commentDrafts[post.id] || "").trim()}>Send</button>
            </form>
          </section>
        )}
      </article>
    );
  };

  const memberProfileActivity = viewedMemberProfile
    ? [
        ...memberProfilePosts,
        ...reposts.filter((repost) => repost.user_id === viewedMemberProfile.user_id)
          .map((repost) => {
            const post = posts.find((item) => item.id === repost.post_id);
            return post ? {
              ...post,
              feed_item_key: `repost-${repost.id}`,
              repost_id: repost.id,
              is_repost: true,
              shared_by: viewedMemberProfile,
              shared_at: repost.created_at,
            } : null;
          })
          .filter(Boolean),
      ].sort((left, right) => new Date(right.shared_at || right.created_at) - new Date(left.shared_at || left.created_at))
    : [];
  const memberProfileMedia = memberProfilePosts.filter((post) => post.media_path);
  const memberProfileVisiblePosts = memberProfileTab === "activity"
    ? memberProfileActivity
    : memberProfileTab === "media"
      ? memberProfileMedia
      : memberProfileTab === "posts"
        ? memberProfilePosts
        : [];
  const memberFollowedIds = useMemo(
    () => new Set(memberProfileStats.mutualUserIds),
    [memberProfileStats.mutualUserIds],
  );
  const memberProfileConnections = people.filter((person) =>
    person.user_id !== account?.id
    && person.user_id !== viewedMemberProfile?.user_id
    && followingIds.has(person.user_id)
    && memberFollowedIds.has(person.user_id),
  ).slice(0, 5);
  const migrationRequired = /Could not find (?:the )?(?:table|function) .*campus_social_.*schema cache|Could not find .*column.*campus_social_.*schema cache|relation .*campus_social_.* does not exist|column campus_social_.* does not exist/i.test(loadError);

  if (!supabase || loadError === "Sign in to open Campus Social.") {
    return <div className="campus-social-state"><h2>Campus Social</h2><p>{loadError || "Social features need a Supabase connection."}</p></div>;
  }

  return (
    <div className={`campus-social-page${["feed", "trending"].includes(activeView) ? " campus-social-home-screen" : ""}${["feed", "trending"].includes(activeView) ? " campus-social-has-feed-tabs" : ""}`}>
      <header className={`campus-social-header${["feed", "trending"].includes(activeView) ? " campus-social-header-with-tabs" : ""}`}>
        {activeView === "member-profile" ? (
          <div className="campus-social-member-profile-toolbar">
            <button type="button" aria-label="Back to feed" onClick={() => setActiveView("feed")}>
              <IoArrowBack size={19} />
            </button>
            <strong className="campus-social-name-with-badge">
              {viewedMemberProfile?.username
                ? `@${viewedMemberProfile.username}`
                : viewedMemberProfile?.display_name || "Student profile"}
              {viewedMemberProfile?.is_verified && <StudentVerifiedBadge />}
            </strong>
            <span aria-hidden="true" />
          </div>
        ) : (
          <>
            <div className="campus-social-brand-lockup" aria-label="Campus Ghana">
              <strong>Campus Ghana</strong>
            </div>
            {["feed", "trending"].includes(activeView) ? (
              <nav className="campus-social-top-tabs campus-social-feed-tabs" aria-label="Social feeds">
                <button aria-current={activeView === "feed" && feedScope === "for-you" ? "page" : undefined} className={activeView === "feed" && feedScope === "for-you" ? "is-active" : ""} type="button" onClick={() => { setActiveView("feed"); setFeedScope("for-you"); setComposerOpen(false); }}>My Feed</button>
                <button aria-current={activeView === "feed" && feedScope === "following" ? "page" : undefined} className={activeView === "feed" && feedScope === "following" ? "is-active" : ""} type="button" onClick={() => { setActiveView("feed"); setFeedScope("following"); setComposerOpen(false); }}>Following</button>
                <button aria-current={activeView === "trending" ? "page" : undefined} className={activeView === "trending" ? "is-active" : ""} type="button" onClick={() => { setActiveView("trending"); setComposerOpen(false); }}>Trend</button>
              </nav>
            ) : (
              <div className="campus-social-page-heading">
                <h1>{activeView === "discover" ? "Search" : activeView === "communities" ? "Communities" : activeView === "videos" ? "Videos" : activeView === "library" ? "Library" : "Notifications"}</h1>
              </div>
            )}
          </>
        )}
        {["feed", "trending"].includes(activeView) && (
          <div className="campus-social-header-actions">
            <button
              className="campus-social-profile-shortcut"
              type="button"
              aria-label="Open profile"
              onClick={onOpenStudentProfile}
            >
              <IoPersonCircle size={20} />
              <span>Profile</span>
            </button>
            <button
              className="campus-social-add-post"
              type="button"
              onClick={() => { setActiveView("feed"); setComposerOpen(true); }}
            >
              <IoAdd size={19} />
              <span>Add post</span>
            </button>
          </div>
        )}
      </header>

      {notice && <div className="campus-social-notice" role="status">{notice}</div>}
      {migrationRequired ? (
        <section className="campus-social-setup-card" role="alert">
          <span className="campus-social-kicker">DATABASE SETUP</span>
          <h2>One setup step remains</h2>
          <p>{/get_campus_social_post_authors/i.test(loadError)
            ? "Apply backend/supabase/migrations/046_verified_campus_social_authors.sql and 047_campus_social_interactions_and_identity.sql to the connected Supabase project, then reload Campus Social."
            : /campus_social_bookmarks/i.test(loadError)
              ? "Apply backend/supabase/migrations/048_campus_social_bookmarks.sql after migration 047, then reload Campus Social."
              : "Apply backend/supabase/migrations/041_campus_social_platform.sql, 042_campus_social_activity.sql, and 047_campus_social_interactions_and_identity.sql to the connected Supabase project, then reload Campus Social."}</p>
        </section>
      ) : loadError ? (
        <div className="campus-social-error" role="alert">{loadError}</div>
      ) : null}

      {!migrationRequired && ["feed", "trending"].includes(activeView) && (
        <section className="campus-social-topics" aria-label="Popular topics">
          <div className="campus-social-topics-heading">
            <h2>Popular This Week</h2>
            <button type="button" onClick={() => setSelectedTopic("")}>View all</button>
          </div>
          <div className="campus-social-topic-list">
            {POPULAR_TOPICS.slice(0, 4).map((topic) => (
              <button
                className={selectedTopic === topic.label ? "is-active" : ""}
                type="button"
                key={topic.label}
                aria-pressed={selectedTopic === topic.label}
                onClick={() => setSelectedTopic((current) => current === topic.label ? "" : topic.label)}
              >
                #{topic.label.replace(/\s+/g, "")}
              </button>
            ))}
          </div>
        </section>
      )}

      {!migrationRequired && <div className="campus-social-layout">
        <aside className="campus-social-rail" aria-label="Campus Social views">
          <div className="campus-social-brand"><strong>Campus Connect</strong></div>
          <nav className="campus-social-nav">
            {SOCIAL_NAV_ITEMS.map(([view, label, Icon]) => (
              <button
                className={[
                  activeView === view || (view === "feed" && activeView === "trending") || (view === "profile" && activeView === "member-profile") ? "is-active" : "",
                  view === "create" ? "campus-social-rail-create" : "",
                ].filter(Boolean).join(" ")}
                key={view}
                type="button"
                onClick={() => {
                  if (view === "profile") {
                    onOpenStudentProfile();
                    return;
                  }
                  if (view === "create") {
                    setActiveView("feed");
                    setComposerOpen(true);
                    return;
                  }
                  setActiveView(view);
                  setSearch("");
                  setComposerOpen(false);
                }}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="campus-social-rail-note">
            <span>YOUR CAMPUS, CONNECTED</span>
            <p>Share ideas, meet classmates, and learn from your campus community.</p>
          </div>
        </aside>

        <main className={`campus-social-main campus-social-main-${activeView}`}>
          {activeView === "member-profile" && viewedMemberProfile && (
            <section className="campus-social-member-profile" aria-label={`${viewedMemberProfile.display_name || "Student"} profile`}>
              <div className="campus-social-member-profile-card">
                <div className="campus-social-member-profile-summary">
                  <Avatar name={viewedMemberProfile.display_name} src={viewedMemberProfile.avatar_url} size="large" />
                  <div className="campus-social-member-profile-stats" aria-label="Profile statistics">
                    <div>
                      <strong>{memberProfilePostCount === null ? (memberProfilePostsLoading ? "…" : "—") : memberProfilePostCount}</strong>
                      <span>Posts</span>
                    </div>
                    <div>
                      <strong>{memberProfileStats.followerCount === null ? (memberProfileStats.loading ? "…" : "—") : memberProfileStats.followerCount}</strong>
                      <span>Followers</span>
                    </div>
                    <div>
                      <strong>{memberProfileStats.followingCount === null ? (memberProfileStats.loading ? "…" : "—") : memberProfileStats.followingCount}</strong>
                      <span>Following</span>
                    </div>
                  </div>
                </div>
                <div className="campus-social-member-profile-identity">
                  <h2>
                    <span className="campus-social-name-with-badge">
                      {viewedMemberProfile.display_name || "Campus student"}
                      {viewedMemberProfile.is_verified && <StudentVerifiedBadge />}
                    </span>
                    <NameTags tags={viewedMemberProfile.name_tags || []} />
                  </h2>
                  {viewedMemberProfile.username && <p className="campus-social-member-profile-handle">@{viewedMemberProfile.username}</p>}
                  {viewedMemberProfile.bio && <p>{viewedMemberProfile.bio}</p>}
                  <p>{viewedMemberProfile.institution || viewedMemberProfile.education_level || "Campus Ghana member"}</p>
                </div>
                {(memberProfileStats.error || memberProfilePostsError) && (
                  <p className="campus-social-member-profile-error" role="status">
                    {[memberProfileStats.error, memberProfilePostsError].filter(Boolean).join(" ")}
                  </p>
                )}
                <div className="campus-social-member-profile-actions">
                  {viewedMemberProfile.isFollowable && (
                    followButton("student", viewedMemberProfile.user_id, "Follow")
                  )}
                  <button
                    className="campus-social-member-profile-message"
                    type="button"
                    disabled={!onMessageStudent}
                    onClick={() => onMessageStudent?.(viewedMemberProfile)}
                  >
                    <IoChatbubbleEllipses size={17} />
                    Message
                  </button>
                </div>
              </div>
              <nav className="campus-social-member-profile-tabs" role="tablist" aria-label="Profile sections">
                {["activity", "posts", "tagged", "media"].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={memberProfileTab === tab}
                    className={memberProfileTab === tab ? "is-active" : ""}
                    onClick={() => setMemberProfileTab(tab)}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </nav>
              <section className="campus-social-member-network" aria-label="Mutual friends">
                  <div className="campus-social-member-network-heading">
                    <h2>Mutual friends</h2>
                    <span>People you both follow</span>
                  </div>
                  {memberProfileStats.mutualError ? (
                    <p className="campus-social-member-network-message" role="status">{memberProfileStats.mutualError}</p>
                  ) : memberProfileStats.loading ? (
                    <p className="campus-social-member-network-message" role="status">Loading mutual friends...</p>
                  ) : memberProfileConnections.length ? (
                    <div className="campus-social-member-network-list">
                      {memberProfileConnections.map((person) => (
                        <div className="campus-social-member-network-person" key={person.user_id}>
                          <button type="button" className="campus-social-member-network-profile" onClick={() => openMemberProfile(person)}>
                            <Avatar name={person.display_name} src={person.avatar_url} />
                            <span>
                              <strong className="campus-social-name-with-badge">
                                {person.display_name || "Campus student"}
                                {(person.is_verified || socialAuthorById.get(person.user_id)?.is_verified)
                                  && <StudentVerifiedBadge />}
                              </strong>
                              <small>@{person.username || "student"}</small>
                            </span>
                          </button>
                          {followButton("student", person.user_id, "Follow")}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="campus-social-member-network-message">No mutual friends yet.</p>
                  )}
                </section>
              <section className="campus-social-member-profile-content" role="tabpanel" aria-label={`${memberProfileTab} posts`}>
                <div className="campus-social-member-profile-content-heading">
                  <div>
                    <span>STUDENT ACTIVITY</span>
                    <h2>{memberProfileTab === "activity" ? "Recent activity" : `${memberProfileTab.charAt(0).toUpperCase()}${memberProfileTab.slice(1)}`}</h2>
                    <p>{memberProfileTab === "tagged" ? "Tagged posts are not available yet." : `Recent public ${memberProfileTab} shared by ${viewedMemberProfile.display_name || "this student"}.`}</p>
                  </div>
                </div>
                {memberProfilePostsLoading && memberProfileVisiblePosts.length === 0 ? (
                  <div className="campus-social-member-profile-empty" role="status">
                    <p>Loading profile activity...</p>
                  </div>
                ) : memberProfileVisiblePosts.length > 0 ? (
                  <div className="campus-social-post-list">
                    {memberProfileVisiblePosts.map((post) => renderPost(post))}
                  </div>
                ) : (
                  <div className="campus-social-member-profile-empty">
                    <h3>{memberProfileTab === "tagged" ? "No tagged posts" : memberProfileTab === "media" ? "No media yet" : "No recent posts"}</h3>
                    <p>{memberProfileTab === "tagged"
                      ? "Tagged posts will appear here when the feature is available."
                      : memberProfileTab === "media"
                        ? "Photos and videos shared publicly by this student will appear here."
                        : memberProfilePostsError
                          ? "Profile activity could not be displayed."
                          : "This profile has no public updates to show yet."}</p>
                  </div>
                )}
              </section>
            </section>
          )}

          {(activeView === "feed" || activeView === "trending" || activeView === "videos" || activeView === "library") && (
            <>
              {activeView === "library" && (
                <div className="campus-social-feed-heading">
                  <div><h2>Library</h2><p>Your collection of posts saved for later.</p></div>
                </div>
              )}
              {activeView === "feed" && composerOpen && (
                <form className="campus-social-composer" onSubmit={createPost}>
                  <div className="campus-social-composer-heading">
                    <strong>Share an update</strong>
                    <button type="button" aria-label="Close composer" onClick={() => setComposerOpen(false)}>Cancel</button>
                  </div>
                  <div className="campus-social-composer-row">
                    <Avatar name={profile?.display_name} src={profile?.avatar_url} />
                    <textarea aria-label="Share an update" maxLength={3000} value={postText} onChange={(event) => setPostText(event.target.value)} placeholder="What is happening on your campus?" />
                  </div>
                  {postFile && <div className="campus-social-file-name">{postFile.name}<button type="button" onClick={() => setPostFile(null)}>Remove</button></div>}
                  <div className="campus-social-composer-footer">
                    <label className="campus-social-upload">
                      <Ico name="docs" size={16} />Photo or video
                      <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(event) => setPostFile(event.target.files?.[0] || null)} />
                    </label>
                    <select className="campus-social-post-audience" aria-label="Post audience" value={selectedCommunityId} onChange={(event) => setSelectedCommunityId(event.target.value)}>
                      <option value="">Everyone</option>
                      {memberships.filter((member) => member.status === "accepted").map((member) => {
                        const community = communityById.get(member.community_id);
                        return community ? <option value={community.id} key={community.id}>Group: {community.name}</option> : null;
                      })}
                    </select>
                    <span>{postText.length}/3000</span>
                    <button className="campus-social-primary" type="submit" disabled={busy || (!postText.trim() && !postFile)}>Share update</button>
                  </div>
                </form>
              )}
              {loading ? <div className="campus-social-empty">Loading campus updates...</div> : visiblePosts.length ? (
                <>
                  <div className="campus-social-post-list">{visiblePosts.map((post) => renderPost(post))}</div>
                  {visiblePosts.length < displayedPosts.length && (
                    <div style={{ display: "flex", justifyContent: "center", padding: 14 }}>
                      <button className="campus-social-primary" style={{ minWidth: 180 }} type="button" onClick={() => setFeedPageSize((current) => current + 10)}>
                        Show more posts
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="campus-social-empty">
                  <h3>{activeView === "library" ? "Your Library is empty" : selectedTopic ? `No ${selectedTopic.toLowerCase()} posts yet` : activeView === "videos" ? "No videos yet" : feedScope === "following" ? "Your following feed is quiet" : "Start the conversation"}</h3>
                  <p>{activeView === "library" ? "Bookmark posts from your feed to keep them here." : selectedTopic ? "Try another topic or view all campus updates." : activeView === "videos" ? "Videos shared by your campus community will appear here." : feedScope === "following" ? "Connect with students, clubs, or institutions to see their updates here." : "Share a question, a campus update, or a recent win."}</p>
                </div>
              )}
            </>
          )}

          {activeView === "discover" && (
            <>
              <div className="campus-social-feed-heading">
                <div><h2>Discover your campus network</h2><p>Find students, clubs, and institutions to follow.</p></div>
              </div>
              <label className="campus-social-search">
                <Ico name="search" size={17} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, schools, interests" />
              </label>
              <section className="campus-social-discover-section">
                <h3>Students <span>{visiblePeople.length}</span></h3>
                <div className="campus-social-discover-grid">
                  {visiblePeople.map((person) => (
                    <article className="campus-social-person" key={person.user_id}>
                      <button
                        type="button"
                        className="campus-social-person-profile-link"
                        onClick={() => openMemberProfile(person)}
                        aria-label={`View ${person.display_name}'s profile`}
                      >
                        <Avatar name={person.display_name} src={person.avatar_url} size="large" />
                      </button>
                      <strong className="campus-social-name-with-badge">
                        <button type="button" className="campus-social-profile-link" onClick={() => openMemberProfile(person)}>
                          {person.display_name}
                        </button>
                        {person.is_verified && <StudentVerifiedBadge />}
                        <NameTags tags={person.name_tags || []} />
                      </strong>
                      {person.username && <span>@{person.username}</span>}
                      <span>{person.institution || person.education_level || "Student"}</span>
                      {person.bio && <p>{person.bio}</p>}
                      {followButton("student", person.user_id)}
                    </article>
                  ))}
                  {!discoveryLoading && visiblePeople.length === 0 && <p className="campus-social-muted">No discoverable students match your search yet.</p>}
                </div>
              </section>
              <section className="campus-social-discover-section">
                <h3>Clubs <span>{visibleCommunities.filter((item) => item.kind === "club").length}</span></h3>
                <div className="campus-social-discover-grid">
                  {visibleCommunities.filter((item) => item.kind === "club" && item.visibility === "public").map((club) => (
                    <article className="campus-social-person campus-social-club" key={club.id}>
                      <div className="campus-social-avatar campus-social-avatar-large">CL</div>
                      <strong>{club.name}</strong><span>Campus club</span>
                      {club.description && <p>{club.description}</p>}
                      {followButton("club", club.id)}
                    </article>
                  ))}
                </div>
              </section>
              <section className="campus-social-discover-section">
                <h3>Institutions <span>{visibleSchools.length}</span></h3>
                <div className="campus-social-discover-grid">
                  {visibleSchools.map((school) => (
                    <article className="campus-social-person campus-social-institution" key={school.id}>
                      <div className="campus-social-avatar campus-social-avatar-large">IN</div>
                      <strong>{school.name}</strong><span>{[school.region, school.category].filter(Boolean).join(" / ") || "Institution"}</span>
                      {followButton("institution", school.id)}
                    </article>
                  ))}
                  {!discoveryLoading && visibleSchools.length === 0 && <p className="campus-social-muted">No institutions match your search.</p>}
                </div>
              </section>
            </>
          )}

          {activeView === "communities" && (
            <>
              <div className="campus-social-feed-heading">
                <div><h2>Communities and groups</h2><p>Join conversations around your interests and campus life.</p></div>
                <button className="campus-social-primary" type="button" onClick={() => setShowCommunityForm(true)}>Create a community</button>
              </div>
              <label className="campus-social-search">
                <Ico name="search" size={17} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a community or club" />
              </label>
              <div className="campus-social-community-list">
                {visibleCommunities.map((community) => {
                  const membership = memberByCommunity.get(community.id);
                  const isOwner = community.created_by === account?.id;
                  return (
                    <article className="campus-social-community" key={community.id}>
                      <div className="campus-social-community-mark">{community.kind === "club" ? "CL" : "CO"}</div>
                      <div className="campus-social-community-copy">
                        <div className="campus-social-community-meta">
                          <span>{community.kind === "club" ? "Club" : "Community"}</span>
                          <span>{community.visibility === "private" ? "Private" : "Public"}</span>
                        </div>
                        <h3>{community.name}</h3>
                        <p>{community.description || "A place for students to connect and share."}</p>
                      </div>
                      <div className="campus-social-community-actions">
                        {membership?.status === "accepted" || isOwner ? (
                          <button type="button" className="campus-social-follow is-following" onClick={() => !isOwner && leaveCommunity(community.id)} disabled={busy || isOwner}>Joined</button>
                        ) : membership?.status === "pending" ? (
                          <button type="button" className="campus-social-follow is-following" onClick={() => leaveCommunity(community.id)} disabled={busy}>Requested</button>
                        ) : (
                          <button type="button" className="campus-social-follow" onClick={() => joinCommunity(community)} disabled={busy}>{community.visibility === "private" ? "Request to join" : "Join"}</button>
                        )}
                        {(community.visibility === "public" || membership?.status === "accepted" || isOwner) && followButton("club", community.id, "Follow")}
                        {isOwner && communityRequests.filter((request) => request.community_id === community.id).length > 0 && (
                          <details className="campus-social-request-list">
                            <summary>Requests ({communityRequests.filter((request) => request.community_id === community.id).length})</summary>
                            {communityRequests.filter((request) => request.community_id === community.id).map((request) => (
                              <div className="campus-social-request" key={request.user_id}>
                                <span className="campus-social-name-with-badge">
                                  {request.display_name || "Student"}
                                  {socialAuthorById.get(request.user_id)?.is_verified
                                    && <StudentVerifiedBadge />}
                                </span>
                                <button type="button" onClick={() => reviewCommunityRequest(community.id, request.user_id, true)} disabled={busy}>Approve</button>
                                <button type="button" onClick={() => reviewCommunityRequest(community.id, request.user_id, false)} disabled={busy}>Decline</button>
                              </div>
                            ))}
                          </details>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!discoveryLoading && visibleCommunities.length === 0 && <div className="campus-social-empty"><h3>No communities found</h3><p>Create one and invite students to join the conversation.</p></div>}
              </div>
            </>
          )}

        </main>

        <aside className="campus-social-aside">
          <section className="campus-social-aside-block">
            <div className="campus-social-aside-heading"><h2>Your network</h2><span>{followingIds.size}</span></div>
            {people.filter((person) => followingIds.has(person.user_id)).slice(0, 5).map((person) => (
              <button
                className="campus-social-following-person"
                key={person.user_id}
                type="button"
                onClick={() => openMemberProfile(person)}
              >
                <Avatar name={person.display_name} src={person.avatar_url} size="small" />
                <span className="campus-social-following-person-name">
                  <strong className="campus-social-name-with-badge">
                    {person.display_name}
                    {person.is_verified && <StudentVerifiedBadge />}
                  </strong>
                  <NameTags tags={person.name_tags || []} />
                </span>
              </button>
            ))}
            {followingIds.size === 0 && <p className="campus-social-muted">Connect with students to keep up with their campus updates.</p>}
            <button className="campus-social-aside-link" type="button" onClick={() => { setActiveView("discover"); setSearch(""); }}>Discover students</button>
          </section>
          <section className="campus-social-aside-block campus-social-campus-card">
            <span className="campus-social-campus-eyebrow">CAMPUS COMMUNITY</span>
            <h2>More than a feed.</h2>
            <p>A place to share ideas, celebrate progress, and discover what students are doing across Ghana.</p>
            <div className="campus-social-campus-stats">
              <span><strong>{people.length}</strong> students</span>
              <span><strong>{communities.length}</strong> groups</span>
            </div>
          </section>
        </aside>
      </div>}

      {!migrationRequired && (
        <>
          <nav className="campus-social-bottom-nav" aria-label="Social navigation">
            {SOCIAL_NAV_ITEMS.map(([view, label, Icon]) => (
              <button
                className={[
                  activeView === view || (view === "feed" && activeView === "trending") || (view === "profile" && activeView === "member-profile") ? "is-active" : "",
                  view === "create" ? "campus-social-bottom-create" : "",
                ].filter(Boolean).join(" ")}
                key={view}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => {
                  if (view === "create") {
                    setActiveView("feed");
                    setComposerOpen(true);
                    return;
                  }
                  if (view === "profile") {
                    onOpenStudentProfile();
                    return;
                  }
                  setActiveView(view);
                  setSearch("");
                  setComposerOpen(false);
                }}
              >
                <Icon size={view === "create" ? 25 : 22} />
                <span style={{ display: "block", fontSize: ".58rem", lineHeight: 1 }}>{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {mediaViewer && (
        <div className="campus-social-media-viewer" role="presentation" onClick={() => setMediaViewer(null)}>
          <section className="campus-social-media-viewer-content" role="dialog" aria-modal="true"
            aria-label={mediaViewer.type === "video" ? "Fullscreen video" : "Fullscreen photo"}
            onClick={(event) => event.stopPropagation()}>
            <button className="campus-social-media-viewer-close" type="button" aria-label="Close fullscreen media" onClick={() => setMediaViewer(null)}>×</button>
            {mediaViewer.type === "video"
              ? <video src={mediaViewer.url} controls autoPlay playsInline aria-label={mediaViewer.alt} />
              : <img src={mediaViewer.url} alt={mediaViewer.alt} />}
          </section>
        </div>
      )}

      {fullPost && (
        <div className="campus-social-full-post-backdrop" role="presentation" onClick={() => setFullPost(null)}>
          <section
            className="campus-social-full-post-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="campus-social-full-post-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="campus-social-full-post-header">
              <div>
                <span className="campus-social-kicker">CAMPUS DISCUSSION</span>
                <h2 id="campus-social-full-post-title">Full post</h2>
              </div>
              <button
                type="button"
                aria-label="Close full post"
                autoFocus
                onClick={() => setFullPost(null)}
              >
                ×
              </button>
            </header>
            <div className="campus-social-full-post-content">
              {renderPost(fullPost, true)}
            </div>
          </section>
        </div>
      )}

      {reactorPost && (
        <div className="campus-social-modal-backdrop" role="presentation" onClick={() => setReactorPost(null)}>
          <section className="campus-social-modal campus-social-roster-modal" role="dialog" aria-modal="true" aria-labelledby="campus-social-reactors-title" onClick={(event) => event.stopPropagation()}>
            <div className="campus-social-modal-head">
              <div><span className="campus-social-kicker">POST ACTIVITY</span><h2 id="campus-social-reactors-title">Reactions</h2></div>
              <button type="button" aria-label="Close reactions" onClick={() => setReactorPost(null)}>X</button>
            </div>
            {loadingReactors ? <p>Loading reactions...</p> : reactors.length ? (
              <div className="campus-social-reactor-list">
                {reactors.map((reactor) => (
                <button
                  className="campus-social-reactor"
                  key={reactor.user_id}
                  type="button"
                  onClick={() => openMemberProfile(reactor)}
                >
                  <Avatar name={reactor.display_name} src={reactor.avatar_url} />
                  <strong className="campus-social-name-with-badge">
                    {reactor.display_name}
                    {(reactor.is_verified || socialAuthorById.get(reactor.user_id)?.is_verified)
                      && <StudentVerifiedBadge />}
                  </strong>
                  <span>{REACTION_LABELS[reactor.reaction_type] || "Reacted"}</span>
                </button>
              ))}
              </div>
            ) : <p>No reactions yet.</p>}
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="campus-social-modal-backdrop" role="presentation" onClick={() => setDeleteTarget(null)}>
          <section className="campus-social-modal" role="alertdialog" aria-modal="true" aria-labelledby="campus-social-delete-title" onClick={(event) => event.stopPropagation()}>
            <div className="campus-social-modal-head">
              <div><span className="campus-social-kicker">{deleteTarget.delete_kind === "repost" ? "REMOVE RESHARE" : "REMOVE UPDATE"}</span><h2 id="campus-social-delete-title">{deleteTarget.delete_kind === "repost" ? "Remove this reshare?" : "Delete this post?"}</h2></div>
              <button type="button" aria-label="Close delete confirmation" onClick={() => setDeleteTarget(null)}>X</button>
            </div>
            <p>{deleteTarget.delete_kind === "repost" ? "This will remove the post from your reshares without affecting the original post." : "This will permanently remove the post, its media, and its reactions and comments."}</p>
            <div className="campus-social-modal-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="campus-social-danger" type="button" onClick={deletePost} disabled={busy}>{deleteTarget.delete_kind === "repost" ? "Remove reshare" : "Delete post"}</button>
            </div>
          </section>
        </div>
      )}

      {reportTarget && (
        <div className="campus-social-modal-backdrop" role="presentation" onClick={() => !busy && setReportTarget(null)}>
          <form
            className="campus-social-modal campus-social-report-modal"
            onSubmit={submitPostReport}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="campus-social-report-title"
          >
            <div className="campus-social-modal-head">
              <div><span className="campus-social-kicker">COMMUNITY SAFETY</span><h2 id="campus-social-report-title">Report this {reportTarget.type === "comment" ? "comment" : "post"}</h2></div>
              <button type="button" aria-label="Close report dialog" onClick={() => setReportTarget(null)} disabled={busy}>X</button>
            </div>
            <p>Your report is private. The content owner will not be told who submitted it.</p>
            <label>
              Reason
              <select value={reportCategory} onChange={(event) => setReportCategory(event.target.value)} disabled={busy}>
                <option value="spam">Spam or misleading content</option>
                <option value="harassment">Harassment or bullying</option>
                <option value="inappropriate">Inappropriate content</option>
                <option value="misinformation">False or harmful information</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <label>
              Additional details (optional)
              <textarea maxLength={1000} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Tell the moderation team what they should review." disabled={busy} />
            </label>
            <div className="campus-social-modal-actions">
              <button type="button" onClick={() => setReportTarget(null)} disabled={busy}>Cancel</button>
              <button className="campus-social-primary" type="submit" disabled={busy}>{busy ? "Sending..." : "Submit report"}</button>
            </div>
          </form>
        </div>
      )}

      {showCommunityForm && (
        <div className="campus-social-modal-backdrop" role="presentation" onClick={() => setShowCommunityForm(false)}>
          <form className="campus-social-modal" onSubmit={createCommunity} onClick={(event) => event.stopPropagation()}>
            <div className="campus-social-modal-head"><div><span className="campus-social-kicker">START A SPACE</span><h2>Create a community</h2></div><button type="button" aria-label="Close dialog" onClick={() => setShowCommunityForm(false)}>X</button></div>
            <label>Name<input required maxLength={80} value={communityForm.name} onChange={(event) => setCommunityForm((current) => ({ ...current, name: event.target.value }))} placeholder="Community name" /></label>
            <label>Description<textarea maxLength={600} value={communityForm.description} onChange={(event) => setCommunityForm((current) => ({ ...current, description: event.target.value }))} placeholder="What brings the group together?" /></label>
            <div className="campus-social-modal-row">
              <label>Space type<select value={communityForm.kind} onChange={(event) => setCommunityForm((current) => ({ ...current, kind: event.target.value }))}><option value="community">Community</option><option value="club">Club</option></select></label>
              <label>Access<select value={communityForm.visibility} onChange={(event) => setCommunityForm((current) => ({ ...current, visibility: event.target.value }))}><option value="public">Public</option><option value="private">Private</option></select></label>
            </div>
            <div className="campus-social-modal-actions"><button type="button" onClick={() => setShowCommunityForm(false)}>Cancel</button><button className="campus-social-primary" type="submit" disabled={busy}>Create community</button></div>
          </form>
        </div>
      )}
    </div>
  );
}