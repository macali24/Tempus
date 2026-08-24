import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, LogOut, Mail, User } from 'lucide-react';

const DEMO_EMAIL = 'mac30ca@gmail.com';
const DEMO_PASSWORD = 'TempusMarkCalvin';
const SESSION_KEY = 'tempus-demo-user';

function savedDemoUser() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === DEMO_EMAIL ? DEMO_EMAIL : '';
  } catch {
    return '';
  }
}

function saveDemoUser(email: string) {
  try {
    if (email) window.sessionStorage.setItem(SESSION_KEY, email);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The demo still works when browser storage is disabled; it just will not
    // retain the session across a refresh.
  }
}

export function AuthBoundary({ children }: { children: ReactNode }) {
  const [user, setUser] = useState(savedDemoUser);

  const signIn = (email: string, password: string) => {
    if (email.trim() !== DEMO_EMAIL || password !== DEMO_PASSWORD) return false;
    saveDemoUser(DEMO_EMAIL);
    setUser(DEMO_EMAIL);
    return true;
  };

  const signOut = () => {
    saveDemoUser('');
    setUser('');
  };

  if (!user) return <SignIn onSignIn={signIn} />;

  return (
    <>
      <AccountControl email={user} onSignOut={signOut} />
      {children}
    </>
  );
}

function SignIn({ onSignIn }: { onSignIn: (email: string, password: string) => boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (onSignIn(email, password)) return;
    setError('That username or password does not match the demo account.');
  };

  return (
    <div className="signin-page">
      <div className="signin-glow" aria-hidden="true" />
      <main className="signin-card" aria-labelledby="signin-title">
        <div className="signin-brand" aria-label="Tempus">
          <span className="signin-brand-mark"><img src="/tempus-mark.png" alt="" /></span>
          <span>Tempus</span>
        </div>

        <header className="signin-heading">
          <span className="eyebrow">Sales Copilot</span>
          <h1 id="signin-title">Welcome back</h1>
          <p>Sign in to continue to your oncology territory workspace.</p>
        </header>

        <form className="signin-form" onSubmit={submit}>
          <label htmlFor="demo-email">Username</label>
          <div className="signin-field">
            <Mail aria-hidden="true" />
            <input
              id="demo-email"
              name="email"
              type="email"
              value={email}
              onChange={event => { setEmail(event.target.value); setError(''); }}
              placeholder="name@email.com"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              required
              autoFocus
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'signin-error' : undefined}
            />
          </div>

          <label htmlFor="demo-password">Password</label>
          <div className="signin-field">
            <LockKeyhole aria-hidden="true" />
            <input
              id="demo-password"
              name="password"
              type={passwordVisible ? 'text' : 'password'}
              value={password}
              onChange={event => { setPassword(event.target.value); setError(''); }}
              autoComplete="current-password"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'signin-error' : undefined}
            />
            <button
              className="signin-password-toggle"
              type="button"
              onClick={() => setPasswordVisible(visible => !visible)}
              aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              aria-pressed={passwordVisible}
            >
              {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>

          <div className="signin-message" aria-live="polite">
            {error && <span id="signin-error">{error}</span>}
          </div>

          <button className="signin-submit" type="submit">
            Sign in
            <ArrowRight aria-hidden="true" />
          </button>
        </form>
      </main>
    </div>
  );
}

function AccountControl({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    logoutRef.current?.focus();

    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={controlRef} className="account-control">
      <button
        ref={triggerRef}
        className="account-avatar"
        type="button"
        title={email}
        aria-label={`Open account menu for ${email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen(value => !value)}
      >
        <User aria-hidden="true" />
      </button>

      {open && (
        <div id="account-menu" className="account-menu" role="menu">
          <div className="account-menu-identity" role="presentation">
            <User aria-hidden="true" />
            <span>
              <small>Signed in as</small>
              <b>{email}</b>
            </span>
          </div>
          <button ref={logoutRef} className="account-signout" type="button" role="menuitem" onClick={onSignOut}>
            <LogOut aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      )}
    </div>
  );
}
