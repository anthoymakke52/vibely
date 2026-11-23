
import React, { useEffect, useRef, useState } from 'react';
import { supabase, supabaseReady } from './supabase';
import {
  Send, LogOut, Users, MessageCircle, ImagePlus,
  Search, ArrowLeft, UserRound
} from 'lucide-react';

const LOUNGE = '00000000-0000-0000-0000-000000000001';

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
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const [activeConversationId, setActiveConversationId] = useState(LOUNGE);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [loadingChat, setLoadingChat] = useState(false);

  const bottom = useRef(null);

  const currentUsername =
    session?.user?.user_metadata?.username ||
    session?.user?.email?.split('@')[0] ||
    'User';

  // Authentication
  useEffect(() => {
    if (!supabaseReady) return;

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setNotice(error.message);
      setSession(data?.session || null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Load all public user profiles
  useEffect(() => {
    if (!session) return;

    async function loadProfiles() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username')
        .order('username');

      if (error) {
        setNotice(error.message);
        return;
      }

      setProfiles(data || []);
    }

    loadProfiles();

    const profileChannel = supabase
      .channel('vibely-profile-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles'
        },
        loadProfiles
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [session]);

  // Load messages for the selected conversation
  useEffect(() => {
    if (!session || !activeConversationId) return;

    let alive = true;

    async function loadMessages() {
      setMessages([]);

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

      setMessages(data || []);
    }

    loadMessages();

    const channel = supabase
      .channel(`chat-${activeConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConversationId}`
        },
        payload => {
          const newMessage = payload.new;

          setMessages(previous =>
            previous.some(m => m.id === newMessage.id)
              ? previous
              : [...previous, newMessage]
          );
        }
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [session, activeConversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Login and signup
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

  // Open a private conversation with another user
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
  }

  function openGroupChat() {
    setSelectedPerson(null);
    setActiveConversationId(LOUNGE);
  }

  // Send a text message
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
  }

  // Upload an image or audio file
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
    (person.username || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">v</div>
          <span>vibely</span>
          <small>BETA</small>
        </div>

        <div className="profile-mini">
          <div className="avatar">
            {currentUsername[0].toUpperCase()}
          </div>
          <div>
            <b>{currentUsername}</b>
            <small>Available</small>
          </div>
          <button title="Sign out" onClick={() => supabase.auth.signOut()}>
            <LogOut size={17} />
          </button>
        </div>

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
          {visiblePeople.map(person => (
            <button
              key={person.id}
              className={`person-item ${
                selectedPerson?.id === person.id ? 'active' : ''
              }`}
              onClick={() => openPrivateChat(person)}
              disabled={loadingChat}
            >
              <div className="avatar small">
                {(person.username || 'U')[0].toUpperCase()}
              </div>
              <span>{person.username || 'Vibely member'}</span>
              <MessageCircle size={15} />
            </button>
          ))}

          {visiblePeople.length === 0 && (
            <p className="muted people-empty">
              No other users found yet.
            </p>
          )}
        </div>

        <div className="side-bottom">
          <small>Vibely · Find your vibe.</small>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div className="channel-icon">
            {selectedPerson ? <UserRound /> : <Users />}
          </div>

          <div>
            <h2>
              {selectedPerson
                ? selectedPerson.username
                : 'Public lounge'}
            </h2>
            <p>
              {selectedPerson
                ? 'Private conversation'
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
              <div className="avatar">
                {(selectedPerson.username || 'U')[0].toUpperCase()}
              </div>
              <h3>{selectedPerson.username}</h3>
              <p>Your private conversation</p>
            </div>
          )}

          {messages.map(message => {
            const isMine = message.sender_id === session.user.id;

            const senderName = isMine
              ? currentUsername
              : (
                  profiles.find(p => p.id === message.sender_id)?.username ||
                  message.sender_name ||
                  'Vibely member'
                );

            return (
              <article
                className={`message ${isMine ? 'mine' : ''}`}
                key={message.id}
              >
                <div className="avatar small">
                  {senderName[0].toUpperCase()}
                </div>

                <div className="bubble-wrap">
                  <div className="message-meta">
                    <b>{senderName}</b>
                    <time>
                      {new Date(message.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </time>
                  </div>

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
                </div>
              </article>
            );
          })}

          {messages.length === 0 && selectedPerson && (
            <p className="muted empty-chat">
              No messages yet. Say hello!
            </p>
          )}

          <div ref={bottom} />
        </div>

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
            onChange={e => setDraft(e.target.value)}
            placeholder={
              selectedPerson
                ? `Message ${selectedPerson.username}...`
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
    </main>
  );
}
