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

  const inputStyle = {
    backgroundColor: 'var(--vv-bg-surface)',
    border: '1px solid var(--vv-border)',
    borderRadius: 'var(--vv-radius-md)',
    color: 'var(--vv-text)',
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--vv-bg-app)' }}
    >
      <div className="w-full max-w-sm">
        {/* Brand lockup — the full vinvault.us logo + wordmark */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/brand/vinvault-logo.svg"
            alt="VINVAULT"
            className="h-16 w-auto"
          />
          <p
            className="mt-4 text-[10px] uppercase"
            style={{
              color: 'var(--vv-text-subtle)',
              letterSpacing: 'var(--vv-tracking-label)',
            }}
          >
            Internal CRM · Sign in
          </p>
        </div>

        {/* Card */}
        <div
          className="p-6"
          style={{
            backgroundColor: 'var(--vv-bg-surface)',
            border: '1px solid var(--vv-border)',
            borderRadius: 'var(--vv-radius-lg)',
            boxShadow: 'var(--vv-shadow-card)',
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="block mb-1.5 text-[10px] uppercase font-semibold"
                style={{
                  color: 'var(--vv-text-subtle)',
                  letterSpacing: 'var(--vv-tracking-label)',
                }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@vinvault.us"
                className="w-full px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)]"
                style={inputStyle}
              />
            </div>

            <div>
              <label
                className="block mb-1.5 text-[10px] uppercase font-semibold"
                style={{
                  color: 'var(--vv-text-subtle)',
                  letterSpacing: 'var(--vv-tracking-label)',
                }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full pl-3 pr-10 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)]"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                  style={{ color: 'var(--vv-text-subtle)' }}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88"/></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                className="px-3 py-2 flex items-start gap-2 text-[12px]"
                style={{
                  backgroundColor: '#FEE2E2',
                  color: 'var(--vv-status-danger)',
                  border: '1px solid #FECACA',
                  borderRadius: 'var(--vv-radius-md)',
                }}
              >
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                <p>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 text-[13px] font-medium disabled:opacity-50 transition-colors"
              style={{
                backgroundColor: 'var(--vv-bg-dark)',
                color: '#ffffff',
                borderRadius: 'var(--vv-radius-md)',
              }}
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-full animate-spin"
                    style={{
                      border: '2px solid rgba(255,255,255,0.30)',
                      borderTopColor: '#ffffff',
                    }}
                  />
                  Signing in
                </span>
              ) : 'Sign in'}
            </button>
          </form>
        </div>

        <p
          className="text-center mt-6 text-[10px] uppercase"
          style={{
            color: 'var(--vv-text-subtle)',
            letterSpacing: 'var(--vv-tracking-label)',
          }}
        >
          Curated · Collector-grade · Confidential
        </p>
      </div>
    </div>
  );
}
