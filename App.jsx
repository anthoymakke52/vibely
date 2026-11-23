
import React, { useEffect, useRef, useState } from 'react';
import { supabase, supabaseReady } from './supabase';
import {
  Send, LogOut, Users, MessageCircle, ImagePlus,
  Search, ArrowLeft, UserRound, Settings, Camera,
  X, Check, Palette, Sun, Moon, Pencil, Trash2,
  Smile, Bell, BellRing, Menu, Circle
} from 'lucide-react';

const LOUNGE = '00000000-0000-0000-0000-000000000001';

const ACCENTS = {
  purple: '#9b7bff',
  blue: '#438cff',
  green: '#28c994',
  pink: '#f06da8',
  red: '#f06464'
};

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢'];

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@vibely.invalid`;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState('login');

  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [myProfile, setMyProfile] = useState(null);

  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const [activeConversationId, setActiveConversationId] = useState(LOUNGE);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [loadingChat, setLoadingChat] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [accent, setAccent] = useState('purple');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [displayName, setDisplayName] = useState('');

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState('');
  const [reactions, setReactions] = useState({});
  const [readReceipts, setReadReceipts] = useState({});
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );

  const bottom = useRef(null);
  const avatarInput = useRef(null);
  const typingTimeout = useRef(null);
  const typingChannel = useRef(null);

  const currentUsername =
    session?.user?.user_metadata?.username ||
    session?.user?.email?.split('@')[0] ||
    'User';

  const currentDisplayName =
    myProfile?.display_name || currentUsername;

  const currentAvatar = myProfile?.avatar_url || '';

  // Authentication
  useEffect(() => {
    if (!supabaseReady) return;

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setNotice(error.message);
      setSession(data?.session || null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => setSession(currentSession)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Load profiles and profile settings
  useEffect(() => {
    if (!session) return;

    let alive = true;

    async function loadProfiles() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, theme, accent_color, last_seen')
        .order('username');

      if (!alive) return;

      if (error) {
        setNotice(error.message);
        return;
      }

      const list = data || [];
      setProfiles(list);

      const mine = list.find(p => p.id === session.user.id);

      if (mine) {
        setMyProfile(mine);
        setTheme(mine.theme || 'dark');
        setAccent(mine.accent_color || 'purple');
        setDisplayName(mine.display_name || mine.username || '');
      }
    }

    loadProfiles();

    const profileChannel = supabase
      .channel('vibely-profile-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        loadProfiles
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(profileChannel);
    };
  }, [session]);

  // Online / Offline presence
  useEffect(() => {
    if (!session) return;

    const presenceChannel = supabase.channel('vibely-online-users', {
      config: { presence: { key: session.user.id } }
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        setOnlineUsers(Object.keys(state));
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: session.user.id,
            username: currentUsername,
            online_at: new Date().toISOString()
          });
        }
      });

    return () => {
      supabase.removeChannel(presenceChannel);
    };
  }, [session, currentUsername]);

  // Update last seen
  useEffect(() => {
    if (!session) return;

    const updateLastSeen = () => {
      if (document.visibilityState === 'visible') {
        supabase
          .from('profiles')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', session.user.id);
      }
    };

    updateLastSeen();
    document.addEventListener('visibilitychange', updateLastSeen);

    return () => {
      document.removeEventListener('visibilitychange', updateLastSeen);
    };
  }, [session]);

  // Load messages
  useEffect(() => {
    if (!session || !activeConversationId) return;

    let alive = true;

    async function loadMessages() {
      setMessages([]);
      setReactions({});
      setReadReceipts({});

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', activeConversationId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (!alive) return;

      if (error) {
        setNotice(error.message);
        return;
      }

      const loadedMessages = data || [];
      setMessages(loadedMessages);

      const ids = loadedMessages.map(message => message.id);
      if (!ids.length) return;

      const [{ data: reactionData }, { data: readData }] = await Promise.all([
        supabase
          .from('message_reactions')
          .select('*')
          .in('message_id', ids),
        supabase
          .from('message_reads')
          .select('*')
          .in('message_id', ids)
      ]);

      if (!alive) return;

      const reactionMap = {};
      (reactionData || []).forEach(item => {
        if (!reactionMap[item.message_id]) reactionMap[item.message_id] = [];
        reactionMap[item.message_id].push(item);
      });
      setReactions(reactionMap);

      const readMap = {};
      (readData || []).forEach(item => {
        if (!readMap[item.message_id]) readMap[item.message_id] = [];
        readMap[item.message_id].push(item);
      });
      setReadReceipts(readMap);

      // Mark incoming messages as read
      const unread = loadedMessages.filter(
        message => message.sender_id !== session.user.id &&
          !(readMap[message.id] || []).some(
            receipt => receipt.user_id === session.user.id
          )
      );

      if (unread.length) {
        await supabase
          .from('message_reads')
          .upsert(
            unread.map(message => ({
              message_id: message.id,
              user_id: session.user.id
            })),
            { onConflict: 'message_id,user_id', ignoreDuplicates: true }
          );
      }
    }

    loadMessages();

    const channel = supabase
      .channel(`chat-${activeConversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConversationId}`
        },
        async payload => {
          if (payload.eventType === 'INSERT') {
            const newMessage = payload.new;

            setMessages(previous =>
              previous.some(m => m.id === newMessage.id)
                ? previous
                : [...previous, newMessage]
            );

            if (newMessage.sender_id !== session.user.id) {
              await supabase
                .from('message_reads')
                .upsert(
                  {
                    message_id: newMessage.id,
                    user_id: session.user.id
                  },
                  { onConflict: 'message_id,user_id', ignoreDuplicates: true }
                );

              if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted' &&
                document.hidden
              ) {
                new Notification('New message on Vibely', {
                  body: newMessage.content || 'You received a new attachment.'
                });
              }
            }
          }

          if (payload.eventType === 'UPDATE') {
            setMessages(previous =>
              previous.map(message =>
                message.id === payload.new.id ? payload.new : message
              )
            );
          }

          if (payload.eventType === 'DELETE') {
            setMessages(previous =>
              previous.filter(message => message.id !== payload.old.id)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions'
        },
        () => refreshMessageDetails()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reads'
        },
        () => refreshMessageDetails()
      )
      .subscribe();

    async function refreshMessageDetails() {
      const { data: currentMessages } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', activeConversationId)
        .limit(100);

      const ids = (currentMessages || []).map(item => item.id);
      if (!ids.length || !alive) return;

      const [{ data: reactionData }, { data: readData }] = await Promise.all([
        supabase.from('message_reactions').select('*').in('message_id', ids),
        supabase.from('message_reads').select('*').in('message_id', ids)
      ]);

      if (!alive) return;

      const reactionMap = {};
      (reactionData || []).forEach(item => {
        if (!reactionMap[item.message_id]) reactionMap[item.message_id] = [];
        reactionMap[item.message_id].push(item);
      });

      const readMap = {};
      (readData || []).forEach(item => {
        if (!readMap[item.message_id]) readMap[item.message_id] = [];
        readMap[item.message_id].push(item);
      });

      setReactions(reactionMap);
      setReadReceipts(readMap);
    }

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [session, activeConversationId]);

  // Typing indicator channel
  useEffect(() => {
    if (!session || !activeConversationId) return;

    setTypingUser('');

    const channel = supabase.channel(
      `typing-${activeConversationId}`,
      { config: { broadcast: { self: false } } }
    );

    typingChannel.current = channel;

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.user_id === session.user.id) return;

        setTypingUser(payload?.is_typing ? payload.username : '');
      })
      .subscribe();

    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingChannel.current = null;
      supabase.removeChannel(channel);
    };
  }, [session, activeConversationId]);

  function handleDraftChange(value) {
    setDraft(value);

    if (!typingChannel.current || !session) return;

    typingChannel.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        user_id: session.user.id,
        username: currentDisplayName,
        is_typing: true
      }
    });

    if (typingTimeout.current) clearTimeout(typingTimeout.current);

    typingTimeout.current = setTimeout(() => {
      typingChannel.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          user_id: session.user.id,
          username: currentDisplayName,
          is_typing: false
        }
      });
    }, 1200);
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save profile name, theme and accent color
  async function updateProfile(updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', session.user.id)
      .select()
      .single();

    if (error) {
      setNotice(error.message);
      return false;
    }

    if (data) {
      setMyProfile(data);
      setProfiles(previous =>
        previous.map(profile => profile.id === data.id ? data : profile)
      );

      if (data.theme) setTheme(data.theme);
      if (data.accent_color) setAccent(data.accent_color);
      if (data.display_name !== undefined) {
        setDisplayName(data.display_name || '');
      }
    }

    return true;
  }

  async function saveDisplayName() {
    const cleanName = displayName.trim();

    if (!cleanName) {
      setNotice('Please enter a display name.');
      return;
    }

    const success = await updateProfile({ display_name: cleanName });
    if (success) setNotice('Your profile name has been updated.');
  }

  async function updateCustomization(field, value) {
    if (field === 'theme') setTheme(value);
    if (field === 'accent_color') setAccent(value);

    await updateProfile({ [field]: value });
  }

  // Upload profile avatar
  async function uploadAvatar(file) {
    if (!file || !session) return;

    if (!file.type.startsWith('image/')) {
      setNotice('Please choose an image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setNotice('Avatar image must be smaller than 5 MB.');
      return;
    }

    setAvatarBusy(true);
    setNotice('');

    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${session.user.id}/avatar.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('vibely-avatars')
      .upload(path, file, {
        upsert: true,
        contentType: file.type
      });

    if (uploadError) {
      setNotice(uploadError.message);
      setAvatarBusy(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from('vibely-avatars')
      .getPublicUrl(path);

    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const success = await updateProfile({ avatar_url: avatarUrl });

    if (success) setNotice('Your avatar has been updated!');
    setAvatarBusy(false);
  }

  // Browser notifications
  async function enableNotifications() {
    if (!('Notification' in window)) {
      setNotice('This browser does not support notifications.');
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === 'granted') {
      setNotice('Browser notifications are enabled.');
    } else {
      setNotice('Notification permission was not granted.');
    }
  }

  // Authentication
  async function authenticate(e) {
    e.preventDefault();
    setBusy(true);
    setNotice('');

    const cleanUsername = username.trim().toLowerCase();

    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      setNotice('Username must be 3–20 characters. Use letters, numbers, and underscores.');
      setBusy(false);
      return;
    }

    if (password.length < 6) {
      setNotice('Password must be at least 6 characters.');
      setBusy(false);
      return;
    }

    try {
      const email = usernameToEmail(cleanUsername);

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: cleanUsername,
              display_name: name.trim() || cleanUsername
            }
          }
        });

        if (error) throw error;

        if (!data.session) {
          setNotice('Account created. Please check your Supabase confirmation settings.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;
      }
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Open private chat
  async function openPrivateChat(person) {
    if (!session || !person || person.id === session.user.id) return;

    setLoadingChat(true);
    setNotice('');

    const { data, error } = await supabase.rpc(
      'open_private_chat',
      { target_user: person.id }
    );

    setLoadingChat(false);

    if (error) {
      setNotice(error.message);
      return;
    }

    if (!data) {
      setNotice('Could not open this private chat.');
      return;
    }

    setSelectedPerson(person);
    setActiveConversationId(data);
    setMobileSidebarOpen(false);
  }

  function openGroupChat() {
    setSelectedPerson(null);
    setActiveConversationId(LOUNGE);
    setMobileSidebarOpen(false);
  }

  // Send message
  async function sendMessage(e) {
    e.preventDefault();

    const content = draft.trim();
    if (!content || !session) return;

    setDraft('');
    setNotice('');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: activeConversationId,
        sender_id: session.user.id,
        sender_name: currentUsername,
        content
      })
      .select()
      .single();

    if (error) {
      setDraft(content);
      setNotice(error.message);
      return;
    }

    if (data) {
      setMessages(previous =>
        previous.some(m => m.id === data.id)
          ? previous
          : [...previous, data]
      );
    }

    typingChannel.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        user_id: session.user.id,
        username: currentDisplayName,
        is_typing: false
      }
    });
  }

  // Upload chat image or audio
  async function uploadFile(file) {
    if (!file || !session) return;

    if (file.size > 10 * 1024 * 1024) {
      setNotice('Please choose a file smaller than 10 MB.');
      return;
    }

    setNotice('');

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${session.user.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(path, file);

    if (uploadError) {
      setNotice(uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage
      .from('chat-media')
      .getPublicUrl(path);

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: activeConversationId,
        sender_id: session.user.id,
        sender_name: currentUsername,
        media_url: urlData.publicUrl,
        media_type: file.type.startsWith('image/') ? 'image' : 'audio'
      })
      .select()
      .single();

    if (error) {
      setNotice(error.message);
    } else if (data) {
      setMessages(previous =>
        previous.some(m => m.id === data.id)
          ? previous
          : [...previous, data]
      );
    }
  }

  // Edit own message
  async function editMessage(message) {
    const updatedContent = window.prompt(
      'Edit your message:',
      message.content || ''
    );

    if (updatedContent === null) return;

    const cleanContent = updatedContent.trim();

    if (!cleanContent) {
      setNotice('Message cannot be empty.');
      return;
    }

    const { error } = await supabase
      .from('messages')
      .update({
        content: cleanContent,
        edited_at: new Date().toISOString()
      })
      .eq('id', message.id)
      .eq('sender_id', session.user.id);

    if (error) setNotice(error.message);
  }

  // Soft-delete own message
  async function deleteMessage(message) {
    const confirmed = window.confirm('Delete this message?');
    if (!confirmed) return;

    const { error } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', message.id)
      .eq('sender_id', session.user.id);

    if (error) setNotice(error.message);
  }

  // Toggle reaction
  async function toggleReaction(messageId, reaction) {
    const existing = (reactions[messageId] || []).find(
      item =>
        item.user_id === session.user.id &&
        item.reaction === reaction
    );

    if (existing) {
      const { error } = await supabase
        .from('message_reactions')
        .delete()
        .eq('id', existing.id);

      if (error) setNotice(error.message);
    } else {
      const { error } = await supabase
        .from('message_reactions')
        .insert({
          message_id: messageId,
          user_id: session.user.id,
          reaction
        });

      if (error) setNotice(error.message);
    }
  }

  // Avatar display helper
  function Avatar({ profile, label, size = 'small' }) {
    const avatarUrl = profile?.avatar_url;

    if (avatarUrl) {
      return (
        <img
          className={`avatar ${size}`}
          src={avatarUrl}
          alt={`${label || 'User'} avatar`}
        />
      );
    }

    return (
      <div
        className={`avatar ${size}`}
        style={{
          background: `linear-gradient(135deg, ${ACCENTS[accent]}, #5141a8)`
        }}
      >
        {(label || 'U')[0].toUpperCase()}
      </div>
    );
  }

  if (!supabaseReady) {
    return (
      <main className="auth-wrap">
        <section className="auth-card">
          <h1>Vibely setup needed</h1>
          <p>Check your Supabase project settings.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-wrap">
        <section className="auth-card">
          <div className="brand-mark">v</div>
          <p className="eyebrow">YOUR PEOPLE, YOUR SPACE</p>
          <h1>Welcome to <span>Vibely</span></h1>
          <p className="muted">A little closer, wherever you are.</p>

          <form onSubmit={authenticate}>
            {mode === 'signup' && (
              <label>
                Display name
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                />
              </label>
            )}

            <label>
              Username
              <input
                required
                minLength="3"
                maxLength="20"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                required
                minLength="6"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </label>

            <button className="primary full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="switch">
            {mode === 'login' ? 'New to Vibely?' : 'Already have an account?'}
            {' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setNotice('');
              }}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>

          {notice && <p className="notice">{notice}</p>}
        </section>
      </main>
    );
  }

  const visiblePeople = profiles.filter(person =>
    person.id !== session.user.id &&
    (
      (person.username || '').toLowerCase().includes(search.toLowerCase()) ||
      (person.display_name || '').toLowerCase().includes(search.toLowerCase())
    )
  );

  return (
    <main
      className="app-shell"
      data-theme={theme}
      style={{ '--vibely-accent': ACCENTS[accent] || ACCENTS.purple }}
    >
      <style>{`
        .app-shell[data-theme="light"] {
          background: #edf1fa !important;
          color: #202438 !important;
        }
        .app-shell[data-theme="light"] .sidebar,
        .app-shell[data-theme="light"] .chat-panel {
          background: rgba(255,255,255,.94) !important;
          color: #202438 !important;
          border-color: #dce2ef !important;
        }
        .app-shell[data-theme="light"] .chat-header,
        .app-shell[data-theme="light"] .composer {
          background: rgba(255,255,255,.96) !important;
          border-color: #dce2ef !important;
        }
        .app-shell[data-theme="light"] .message-input,
        .app-shell[data-theme="light"] .people-search input {
          color: #202438 !important;
        }
        .app-shell[data-theme="light"] .bubble {
          background: #e8ebf5 !important;
          color: #202438 !important;
        }
        .app-shell[data-theme="light"] .message.mine .bubble {
          background: var(--vibely-accent) !important;
          color: white !important;
        }
        .app-shell[data-theme="light"] .side-label,
        .app-shell[data-theme="light"] .muted,
        .app-shell[data-theme="light"] .chat-header p {
          color: #737b91 !important;
        }
        .app-shell button.primary,
        .app-shell .send-btn,
        .app-shell .nav-item.active {
          background: var(--vibely-accent) !important;
        }
        .avatar {
          object-fit: cover;
          flex-shrink: 0;
        }
        .settings-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 11px 13px;
          margin: 10px 0;
          border: 1px solid rgba(150,150,180,.2);
          border-radius: 12px;
          background: rgba(150,150,180,.08);
          color: inherit;
          cursor: pointer;
          font: inherit;
        }
        .settings-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          background: rgba(5,8,18,.7);
          backdrop-filter: blur(9px);
        }
        .settings-card {
          width: min(430px, 100%);
          max-height: 90vh;
          overflow-y: auto;
          padding: 24px;
          border: 1px solid rgba(150,150,180,.25);
          border-radius: 22px;
          background: ${theme === 'light' ? '#fff' : '#191b2b'};
          color: ${theme === 'light' ? '#202438' : '#fff'};
          box-shadow: 0 25px 80px rgba(0,0,0,.35);
        }
        .settings-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 22px;
        }
        .settings-top h2 { margin: 0; font-size: 21px; }
        .settings-close {
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .settings-section { margin: 22px 0; }
        .settings-section h3 {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0 0 12px;
          font-size: 14px;
        }
        .avatar-preview {
          display: flex;
          align-items: center;
          gap: 15px;
        }
        .avatar-preview .avatar {
          width: 68px;
          height: 68px;
          border-radius: 50%;
          font-size: 25px;
        }
        .upload-avatar {
          padding: 10px 14px;
          border: 0;
          border-radius: 10px;
          background: var(--vibely-accent);
          color: white;
          cursor: pointer;
          font: inherit;
        }
        .settings-options {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
        }
        .theme-option {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 10px 13px;
          border: 1px solid rgba(150,150,180,.3);
          border-radius: 11px;
          background: rgba(150,150,180,.08);
          color: inherit;
          cursor: pointer;
          font: inherit;
        }
        .theme-option.selected {
          border: 2px solid var(--vibely-accent);
          background: rgba(150,150,180,.15);
        }
        .color-dot {
          width: 21px;
          height: 21px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,.5);
        }
        .settings-note {
          margin-top: 16px;
          font-size: 12px;
          opacity: .65;
        }
        .profile-name-input {
          width: 100%;
          padding: 11px 12px;
          margin: 5px 0 9px;
          border: 1px solid rgba(150,150,180,.3);
          border-radius: 10px;
          background: rgba(150,150,180,.08);
          color: inherit;
          font: inherit;
        }
        .online-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          margin-right: 6px;
          border-radius: 50%;
          background: #28c994;
        }
        .offline-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          margin-right: 6px;
          border-radius: 50%;
          background: #9297a8;
        }
        .message-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 7px;
          opacity: .85;
        }
        .message-actions button,
        .reaction-button {
          padding: 4px 7px;
          border: 1px solid rgba(150,150,180,.2);
          border-radius: 8px;
          background: rgba(150,150,180,.08);
          color: inherit;
          cursor: pointer;
          font-size: 12px;
        }
        .reaction-list {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 7px;
        }
        .reaction-button.selected {
          border-color: var(--vibely-accent);
          background: rgba(155,123,255,.2);
        }
        .typing-indicator {
          padding: 8px 16px;
          color: #9297a8;
          font-size: 12px;
        }
        .edited-label {
          margin-left: 5px;
          font-size: 10px;
          opacity: .65;
        }
        .read-label {
          margin-top: 5px;
          text-align: right;
          font-size: 10px;
          opacity: .7;
        }
        .mobile-menu-button {
          display: none;
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
          padding: 7px;
        }
        .notification-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 10px;
          margin-top: 9px;
          border: 1px solid rgba(150,150,180,.2);
          border-radius: 11px;
          background: rgba(150,150,180,.08);
          color: inherit;
          cursor: pointer;
          font: inherit;
        }
        @media (max-width: 700px) {
          .mobile-menu-button { display: inline-flex; }
          .app-shell { position: relative; overflow: hidden; }
          .app-shell .sidebar {
            position: absolute !important;
            z-index: 50;
            inset: 0 auto 0 0;
            width: min(300px, 85vw) !important;
            transform: translateX(-110%);
            transition: transform .25s ease;
            box-shadow: 15px 0 40px rgba(0,0,0,.25);
          }
          .app-shell.mobile-sidebar-open .sidebar {
            transform: translateX(0);
          }
          .app-shell .chat-panel {
            width: 100% !important;
            min-width: 0 !important;
          }
          .app-shell .chat-header {
            gap: 8px;
          }
          .app-shell .messages {
            padding-left: 12px;
            padding-right: 12px;
          }
          .app-shell .composer {
            gap: 7px;
            padding: 10px;
          }
          .app-shell .message-input {
            min-width: 0;
          }
          .app-shell .message {
            max-width: 100%;
          }
          .app-shell .settings-card {
            padding: 18px;
          }
        }
      `}</style>

      <div
        className={`app-shell-content ${mobileSidebarOpen ? 'mobile-sidebar-open' : ''}`}
      >
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">v</div>
            <span>vibely</span>
            <small>BETA</small>
          </div>

          <div className="profile-mini">
            <Avatar profile={myProfile} label={currentDisplayName} />
            <div>
              <b>{currentDisplayName}</b>
              <small><span className="online-dot" />Online</small>
            </div>
            <button title="Sign out" onClick={() => supabase.auth.signOut()}>
              <LogOut size={17} />
            </button>
          </div>

          <button
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={17} />
            Profile & Appearance
          </button>

          <button
            className="notification-button"
            onClick={enableNotifications}
          >
            {notificationPermission === 'granted'
              ? <BellRing size={17} />
              : <Bell size={17} />}
            {notificationPermission === 'granted'
              ? 'Notifications enabled'
              : 'Enable notifications'}
          </button>

          <div className="side-label">MESSAGES</div>

          <button
            className={`nav-item ${!selectedPerson ? 'active' : ''}`}
            onClick={openGroupChat}
          >
            <Users size={18} />
            Public lounge
          </button>

          <div className="side-label">PRIVATE CHAT</div>

          <div className="people-search">
            <Search size={16} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find people..."
            />
          </div>

          <div className="people-list">
            {visiblePeople.map(person => {
              const isOnline = onlineUsers.includes(person.id);

              return (
                <button
                  key={person.id}
                  className={`person-item ${
                    selectedPerson?.id === person.id ? 'active' : ''
                  }`}
                  onClick={() => openPrivateChat(person)}
                  disabled={loadingChat}
                >
                  <Avatar
                    profile={person}
                    label={person.display_name || person.username || 'U'}
                  />
                  <span>
                    {person.display_name || person.username || 'Vibely member'}
                    <small style={{ display: 'block', opacity: .65 }}>
                      {isOnline ? 'Online' : 'Offline'}
                    </small>
                  </span>
                  {isOnline
                    ? <Circle size={9} fill="#28c994" color="#28c994" />
                    : <MessageCircle size={15} />}
                </button>
              );
            })}

            {visiblePeople.length === 0 && (
              <p className="muted people-empty">No other users found yet.</p>
            )}
          </div>

          <div className="side-bottom">
            <small>Vibely · Find your vibe.</small>
          </div>
        </aside>

        <section className="chat-panel">
          <header className="chat-header">
            <button
              className="mobile-menu-button"
              onClick={() => setMobileSidebarOpen(value => !value)}
              aria-label="Open menu"
            >
              <Menu size={21} />
            </button>

            <div className="channel-icon">
              {selectedPerson ? <UserRound /> : <Users />}
            </div>

            <div>
              <h2>
                {selectedPerson
                  ? (selectedPerson.display_name || selectedPerson.username)
                  : 'Public lounge'}
              </h2>
              <p>
                {selectedPerson
                  ? onlineUsers.includes(selectedPerson.id)
                    ? 'Online'
                    : 'Offline'
                  : 'Chat with everyone'}
              </p>
            </div>

            {selectedPerson && (
              <button className="back-button" onClick={openGroupChat}>
                <ArrowLeft size={18} />
                Group
              </button>
            )}
          </header>

          <div className="messages">
            {!selectedPerson && (
              <div className="welcome">
                <div className="welcome-icon">✦</div>
                <h2>Welcome to the lounge</h2>
                <p>
                  This is your shared space. Start a conversation and make someone's day.
                </p>
              </div>
            )}

            {selectedPerson && (
              <div className="private-heading">
                <Avatar
                  profile={selectedPerson}
                  label={selectedPerson.display_name || selectedPerson.username}
                />
                <h3>{selectedPerson.display_name || selectedPerson.username}</h3>
                <p>
                  {onlineUsers.includes(selectedPerson.id) ? 'Online' : 'Offline'}
                </p>
                <p>Your private conversation</p>
              </div>
            )}

            {messages.map(message => {
              const isMine = message.sender_id === session.user.id;
              const isDeleted = Boolean(message.deleted_at);

              const senderProfile = profiles.find(
                profile => profile.id === message.sender_id
              );

              const senderName = isMine
                ? currentDisplayName
                : (
                    senderProfile?.display_name ||
                    senderProfile?.username ||
                    message.sender_name ||
                    'Vibely member'
                  );

              const messageReactions = reactions[message.id] || [];
              const messageReads = readReceipts[message.id] || [];

              const seenByOthers = messageReads.some(
                receipt => receipt.user_id !== session.user.id
              );

              return (
                <article
                  className={`message ${isMine ? 'mine' : ''}`}
                  key={message.id}
                >
                  <Avatar
                    profile={isMine ? myProfile : senderProfile}
                    label={senderName}
                  />

                  <div className="bubble-wrap">
                    <div className="message-meta">
                      <b>{senderName}</b>
                      <time>
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </time>
                      {message.edited_at && !isDeleted && (
                        <span className="edited-label">Edited</span>
                      )}
                    </div>

                    {isDeleted ? (
                      <div className="bubble deleted-message">
                        This message was deleted.
                      </div>
                    ) : (
                      <>
                        {message.content && (
                          <div className="bubble">{message.content}</div>
                        )}

                        {message.media_type === 'image' && (
                          <img
                            className="shared-image"
                            src={message.media_url}
                            alt="Shared image"
                          />
                        )}

                        {message.media_type === 'audio' && (
                          <audio controls src={message.media_url} />
                        )}

                        <div className="message-actions">
                          <div className="reaction-list">
                            {REACTIONS.map(emoji => {
                              const count = messageReactions.filter(
                                item => item.reaction === emoji
                              ).length;

                              const selected = messageReactions.some(
                                item =>
                                  item.user_id === session.user.id &&
                                  item.reaction === emoji
                              );

                              if (!count && !selected) return null;

                              return (
                                <button
                                  key={emoji}
                                  className={`reaction-button ${selected ? 'selected' : ''}`}
                                  onClick={() => toggleReaction(message.id, emoji)}
                                >
                                  {emoji} {count}
                                </button>
                              );
                            })}
                          </div>

                          <div className="reaction-picker">
                            <button
                              type="button"
                              title="React"
                              onClick={() => toggleReaction(message.id, '👍')}
                            >
                              <Smile size={14} />
                            </button>
                          </div>

                          {isMine && (
                            <>
                              {message.content && (
                                <button
                                  type="button"
                                  title="Edit message"
                                  onClick={() => editMessage(message)}
                                >
                                  <Pencil size={13} /> Edit
                                </button>
                              )}
                              <button
                                type="button"
                                title="Delete message"
                                onClick={() => deleteMessage(message)}
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            </>
                          )}
                        </div>

                        {isMine && seenByOthers && (
                          <div className="read-label">Seen</div>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}

            {messages.length === 0 && selectedPerson && (
              <p className="muted empty-chat">No messages yet. Say hello!</p>
            )}

            <div ref={bottom} />
          </div>

          {typingUser && (
            <div className="typing-indicator">
              {typingUser} is typing...
            </div>
          )}

          <form className="composer" onSubmit={sendMessage}>
            <label className="attach" title="Share image or audio">
              <ImagePlus />
              <input
                type="file"
                accept="image/*,audio/*"
                onChange={e => {
                  uploadFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>

            <input
              className="message-input"
              value={draft}
              onChange={e => handleDraftChange(e.target.value)}
              placeholder={
                selectedPerson
                  ? `Message ${selectedPerson.display_name || selectedPerson.username}...`
                  : 'Write a message...'
              }
            />

            <button
              type="submit"
              className="send-btn"
              disabled={!draft.trim()}
            >
              <Send size={18} />
            </button>
          </form>

          {notice && (
            <div className="toast" onClick={() => setNotice('')}>
              {notice} <b>×</b>
            </div>
          )}

          <footer className="chat-footer">
            Be kind. Keep it friendly.
            <span>Powered by Vibely</span>
          </footer>
        </section>
      </div>

      {settingsOpen && (
        <div
          className="settings-overlay"
          onClick={e => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <section className="settings-card">
            <div className="settings-top">
              <h2>Profile & Appearance</h2>
              <button
                className="settings-close"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={21} />
              </button>
            </div>

            <div className="settings-section">
              <h3><UserRound size={17} /> Edit Profile</h3>
              <label>
                Display name
                <input
                  className="profile-name-input"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  maxLength={40}
                  placeholder="Your display name"
                />
              </label>
              <button className="upload-avatar" onClick={saveDisplayName}>
                <Check size={15} style={{ verticalAlign: 'middle' }} />
                {' '}Save Profile
              </button>
            </div>

            <div className="settings-section">
              <h3><UserRound size={17} /> Your Avatar</h3>

              <div className="avatar-preview">
                <Avatar
                  profile={myProfile}
                  label={currentDisplayName}
                  size="large"
                />

                <div>
                  <b>{currentDisplayName}</b>
                  <p className="muted" style={{ margin: '5px 0 9px' }}>
                    Choose your profile picture
                  </p>

                  <button
                    className="upload-avatar"
                    onClick={() => avatarInput.current?.click()}
                    disabled={avatarBusy}
                  >
                    <Camera size={15} style={{ verticalAlign: 'middle' }} />
                    {' '}
                    {avatarBusy ? 'Uploading...' : 'Upload Photo'}
                  </button>

                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={e => {
                      uploadAvatar(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h3><Palette size={17} /> Choose Theme</h3>

              <div className="settings-options">
                <button
                  className={`theme-option ${theme === 'dark' ? 'selected' : ''}`}
                  onClick={() => updateCustomization('theme', 'dark')}
                >
                  <Moon size={17} /> Dark
                  {theme === 'dark' && <Check size={15} />}
                </button>

                <button
                  className={`theme-option ${theme === 'light' ? 'selected' : ''}`}
                  onClick={() => updateCustomization('theme', 'light')}
                >
                  <Sun size={17} /> Light
                  {theme === 'light' && <Check size={15} />}
                </button>
              </div>
            </div>

            <div className="settings-section">
              <h3><Palette size={17} /> Accent Color</h3>

              <div className="settings-options">
                {Object.entries(ACCENTS).map(([key, color]) => (
                  <button
                    key={key}
                    className={`theme-option ${accent === key ? 'selected' : ''}`}
                    onClick={() => updateCustomization('accent_color', key)}
                    title={key}
                  >
                    <span
                      className="color-dot"
                      style={{ background: color }}
                    />
                    {key[0].toUpperCase() + key.slice(1)}
                    {accent === key && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <h3><Bell size={17} /> Notifications</h3>
              <button
                className="notification-button"
                onClick={enableNotifications}
              >
                {notificationPermission === 'granted'
                  ? 'Notifications are enabled'
                  : 'Allow browser notifications'}
              </button>
            </div>

            <p className="settings-note">
              Your profile and appearance preferences are saved to your Vibely account.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
