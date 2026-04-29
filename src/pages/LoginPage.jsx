import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { extractApiError } from '../api';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try { await login(email, password); }
    catch (err) { setError(extractApiError(err, 'Sign in failed. Please try again.')); }
    finally { setSubmitting(false); }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0c0c0d',
      padding: 16,
      color: '#fafafa',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #fff 0%, #c0c0c0 100%)',
            display: 'grid', placeItems: 'center',
            color: '#0a0a0b',
            fontWeight: 700, fontSize: 24,
            fontFamily: 'var(--font-display)',
            margin: '0 auto 16px',
          }}>V</div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 32, fontWeight: 400,
            letterSpacing: '-0.02em',
            color: '#fff',
          }}>VINVAULT</h1>
          <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7a7e', marginTop: 4 }}>
            Internal CRM
          </p>
        </div>

        <div style={{
          background: '#131315',
          border: '1px solid #232327',
          borderRadius: 14,
          padding: 24,
        }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9a9a9e', marginBottom: 6, fontWeight: 500 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: '#1c1c1f',
                  border: '1px solid #2e2e33',
                  borderRadius: 8,
                  color: '#fafafa',
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9a9a9e', marginBottom: 6, fontWeight: 500 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter password"
                  style={{
                    width: '100%',
                    padding: '9px 40px 9px 12px',
                    background: '#1c1c1f',
                    border: '1px solid #2e2e33',
                    borderRadius: 8,
                    color: '#fafafa',
                    fontSize: 13,
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', inset: 0, left: 'auto',
                    width: 36,
                    background: 'transparent', border: 'none',
                    color: '#9a9a9e', cursor: 'pointer',
                    display: 'grid', placeItems: 'center',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    {showPassword ? (
                      <><path d="M3 3l18 18"/><path d="M10.6 5.1A11 11 0 0112 5c5 0 9 5 10 7-.6 1.2-1.7 2.7-3.1 4M6.6 6.6C4.7 8 3.3 9.8 2 12c1 2 5 7 10 7 1.5 0 2.9-.4 4.1-1.1"/><path d="M9.9 9.9a3 3 0 104.2 4.2"/></>
                    ) : (
                      <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>
                    )}
                  </svg>
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: '#2c1212',
                border: '1px solid #5a1f1f',
                borderRadius: 8,
                padding: '9px 12px',
                color: '#f87171',
                fontSize: 12,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: '#fafafa',
                color: '#0a0a0b',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
