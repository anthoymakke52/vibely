
import React, { useEffect, useRef, useState } from 'react';
import { supabase, supabaseReady } from './supabase';
import {
  Send, LogOut, Users, MessageCircle, ImagePlus,
  Video, Smile, Search
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
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(1);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);

  const bottom = useRef(null);
  const videoRef = useRef(null);

  const currentUsername =
    session?.user?.user_metadata?.username ||
    session?.user?.email?.split('@')[0] ||
    'User';

  useEffect(() => {
    if (!supabaseReady) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, s) => setSession(s)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;

    loadMessages();

    const channel = supabase.channel('vibely-lounge')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${LOUNGE}`
        },
        payload => {
          setMessages(prev =>
            prev.some(m => m.id === payload.new.id)
              ? prev
              : [...prev, payload.new]
          );
        }
      )
      .on('presence', { event: 'sync' }, () => {
        setOnline(Object.keys(channel.presenceState()).length);
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user: session.user.id,
            online_at: new Date().toISOString()
          });
        }
      });

    return () => supabase.removeChannel(channel);
  }, [session]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadMessages() {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', LOUNGE)
      .order('created_at')
      .limit(100);

    if (error) setNotice(error.message);
    else setMessages(data || []);
  }

  async function authenticate(e) {
    e.preventDefault();
    setBusy(true);
    setNotice('');

    const cleanUsername = username.trim().toLowerCase();

    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      setNotice('Username must be 3–20 characters. Use only letters, numbers, and underscores.');
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

        if (data.session) {
          setNotice('Your Vibely account has been created!');
        } else {
          setNotice('Account created. Please check your Supabase email confirmation settings.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;
      }
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(e) {
    e.preventDefault();

    if (!draft.trim() || !session) return;

    const content = draft.trim();
    setDraft('');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: LOUNGE,
        sender_id: session.user.id,
        sender_name: currentUsername,
        content
      })
      .select()
      .single();

    if (error) {
      setNotice(error.message);
      setDraft(content);
    } else if (data) {
      setMessages(prev =>
        prev.some(m => m.id === data.id) ? prev : [...prev, data]
      );
    }
  }

  async function uploadFile(file) {
    if (!file || !session) return;

    if (file.size > 10 * 1024 * 1024) {
      setNotice('Please choose a file smaller than 10 MB.');
      return;
    }

    const path = `${session.user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(path, file);

    if (uploadError) {
      setNotice(uploadError.message);
      return;
    }

    const { data } = supabase.storage
      .from('chat-media')
      .getPublicUrl(path);

    const { error } = await supabase.from('messages').insert({
      conversation_id: LOUNGE,
      sender_id: session.user.id,
      sender_name: currentUsername,
      media_url: data.publicUrl,
      media_type: file.type.startsWith('image/') ? 'image' : 'audio'
    });

    if (error) setNotice(error.message);

    const fileInput = document.querySelector('.attach input');
    if (fileInput) fileInput.value = '';
  }

  async function toggleCamera() {
    if (cameraOn) {
      videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setCameraOn(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraOn(true);
      setNotice('Camera preview is local only. Video calling is not configured yet.');
    } catch {
      setNotice('Camera or microphone permission was not granted.');
    }
  }

  if (!supabaseReady) return <SetupScreen />;

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
                type="text"
                required
                minLength="3"
                maxLength="20"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
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
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>

            <button className="primary full" disabled={busy}>
              {busy
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </form>

          <p className="switch">
            {mode === 'login' ? 'New to Vibely?' : 'Already have an account?'}
            {' '}
            <button onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setNotice('');
            }}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>

          {notice && <p className="notice">{notice}</p>}
        </section>
      </main>
    );
  }

  const displayName = currentUsername;

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
            {displayName[0].toUpperCase()}
          </div>
          <div>
            <b>{displayName}</b>
            <small>Available</small>
          </div>
          <button title="Sign out" onClick={() => supabase.auth.signOut()}>
            <LogOut size={17} />
          </button>
        </div>

        <div className="side-label">MESSAGES</div>
        <div className="nav-item active">
          <MessageCircle size={18} />
          Public lounge
          <span className="live-dot" />
        </div>

        <div className="side-label">YOUR SPACE</div>
        <div className="nav-item">
          <Users size={18} />
          Groups
          <span className="soon">Soon</span>
        </div>

        <div className="nav-item">
          <Video size={18} />
          Video calls
          <span className="soon">Preview</span>
        </div>

        <div className="side-bottom">
          <div className="online">
            <span className="live-dot" />
            {online} online now
          </div>
          <small>Vibely · Find your vibe.</small>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div className="channel-icon"><Users /></div>
          <div>
            <h2>Public lounge</h2>
            <p>
              <span className="live-dot" />
              {online} people online · Say hello to everyone
            </p>
          </div>
          <div className="header-actions">
            <button title="Search"><Search /></button>
            <button title="Video preview" onClick={toggleCamera}>
              <Video />
            </button>
          </div>
        </header>

        {cameraOn && (
          <div className="camera-preview">
            <video ref={videoRef} muted playsInline />
            <span>Local camera preview · Not a live call</span>
          </div>
        )}

        <div className="messages">
          <div className="welcome">
            <div className="welcome-icon">✦</div>
            <h2>Welcome to the lounge</h2>
            <p>
              This is your shared space. Start a conversation and make someone’s day.
            </p>
          </div>

          {messages.map(m => {
            const messageUsername =
              m.sender_name ||
              (m.sender_id === session.user.id ? currentUsername : 'Vibely member');

            return (
              <article
                className={`message ${m.sender_id === session.user.id ? 'mine' : ''}`}
                key={m.id}
              >
                <div className="avatar small">
                  {messageUsername[0].toUpperCase()}
                </div>

                <div className="bubble-wrap">
                  <div className="message-meta">
                    <b>{messageUsername}</b>
                    <time>
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </time>
                  </div>

                  {m.content && <div className="bubble">{m.content}</div>}

                  {m.media_type === 'image' && (
                    <img
                      className="shared-image"
                      src={m.media_url}
                      alt="Shared attachment"
                    />
                  )}

                  {m.media_type === 'audio' && (
                    <audio controls src={m.media_url} />
                  )}
                </div>
              </article>
            );
          })}

          <div ref={bottom} />
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <label className="attach" title="Share image or audio">
            <ImagePlus />
            <input
              type="file"
              accept="image/*,audio/*"
              onChange={e => uploadFile(e.target.files?.[0])}
            />
          </label>

          <input
            className="message-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Write a message…"
          />

          <button type="button" className="icon-btn" title="Emoji">
            <Smile />
          </button>

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

function SetupScreen() {
  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <div className="brand-mark">v</div>
        <p className="eyebrow">ONE LAST SETUP STEP</p>
        <h1>Connect <span>Vibely</span></h1>
        <p className="muted">
          Add your Supabase project details to start chatting.
        </p>
        <div className="setup-steps">
          <p><b>1.</b> Copy <code>.env.example</code> and rename the copy to <code>.env</code>.</p>
          <p><b>2.</b> Add your Supabase Project URL and Publishable Key.</p>
          <p><b>3.</b> Save the file and restart the dev server.</p>
        </div>
        <p className="muted tiny">
          Never put a Supabase Secret key in this file.
        </p>
      </section>
    </main>
  );
}
