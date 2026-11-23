import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { UserAccount } from '../types/study';
import {
  authenticateWithGoogle,
  continueAsGuest,
  loginWithEmail,
  registerWithEmail,
} from '../services/apiClient';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserAccount | null;
  googleClientId: string;
  initialMode?: 'signin' | 'register';
  onAuthSuccess: (user: UserAccount, migratedPlansCount: number) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  googleClientId,
  initialMode = 'signin',
  onAuthSuccess,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  const [mode, setMode] = useState<'signin' | 'register'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMessage(null);
      setShowPassword(false);
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      if (isOpen) {
        onClose();
      }
    };

    dialog.addEventListener('close', handleClose);

    // Fallback light-dismiss when native closedby="any" is unsupported
    let cleanupFallback: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pointerStartedOnBackdrop = false;
      const isBackdropEvent = (event: PointerEvent) => {
        if (event.target !== dialog) return false;
        const rect = dialog.getBoundingClientRect();
        return !(
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
      };
      const handlePointerDown = (event: PointerEvent) => {
        pointerStartedOnBackdrop = isBackdropEvent(event);
      };
      const handlePointerUp = (event: PointerEvent) => {
        if (pointerStartedOnBackdrop && isBackdropEvent(event)) {
          dialog.close();
        }
        pointerStartedOnBackdrop = false;
      };
      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('pointerup', handlePointerUp);
      cleanupFallback = () => {
        dialog.removeEventListener('pointerdown', handlePointerDown);
        dialog.removeEventListener('pointerup', handlePointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      if (cleanupFallback) cleanupFallback();
    };
  }, [isOpen, onClose]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const { user, migratedPlansCount } = await loginWithEmail({
        email: email.trim(),
        password,
      });
      setPassword('');
      onAuthSuccess(user, migratedPlansCount);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to sign in with those credentials.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { user, migratedPlansCount } = await registerWithEmail({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
      });
      setPassword('');
      onAuthSuccess(user, migratedPlansCount);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to create your account.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleContinue = async () => {
    setErrorMessage(null);
    if (!googleClientId) {
      setErrorMessage(
        'Google OAuth Client ID is not configured on this server. Sign in with email or continue as guest.'
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const { user, migratedPlansCount } = await authenticateWithGoogle(googleClientId);
      onAuthSuccess(user, migratedPlansCount);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Google sign-in did not complete.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGuestContinue = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const guestUser = await continueAsGuest();
      onAuthSuccess(guestUser, 0);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not start Guest Mode.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
      className="m-auto w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 shadow-2xl open:flex open:flex-col max-h-[92vh]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <img
            src="/study/logo.png"
            alt="Practice Buddy"
            className="h-8 w-8 rounded-lg object-contain"
          />
          <div>
            <h2 id={titleId} className="text-base font-bold text-slate-900 dark:text-white">
              {currentUser && !currentUser.isGuest ? 'Switch Account' : 'Sign In or Save Your Account'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sync spaced study plans securely across devices
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close account modal"
          className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="overflow-y-auto p-6 space-y-5">
        {currentUser?.isGuest && (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Any study plans created in <strong>Guest Mode</strong> will automatically migrate to your account when you sign in or register.
            </span>
          </div>
        )}

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setErrorMessage(null);
            }}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
              mode === 'signin'
                ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <LogIn className="h-3.5 w-3.5" />
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMessage(null);
            }}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
              mode === 'register'
                ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Create Account
          </button>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {mode === 'signin' ? (
          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <div>
              <label
                htmlFor="auth-signin-email"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Email Address
              </label>
              <input
                id="auth-signin-email"
                name="email"
                type="email"
                autoComplete="username"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="auth-signin-password"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-signin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-3.5 pr-10 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-2.5 top-2.5 rounded p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-60 transition"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing In...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Sign In
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleEmailRegister} className="space-y-4">
            <div>
              <label
                htmlFor="auth-register-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Display Name
              </label>
              <input
                id="auth-register-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex Rivera"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="auth-register-email"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Email Address
              </label>
              <input
                id="auth-register-email"
                name="email"
                type="email"
                autoComplete="username"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="auth-register-password"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Password (min. 8 characters)
              </label>
              <div className="relative">
                <input
                  id="auth-register-password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-3.5 pr-10 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-2.5 top-2.5 rounded p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-60 transition"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Create Account
                </>
              )}
            </button>
          </form>
        )}

        <div className="relative flex items-center py-1">
          <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
          <span className="mx-3 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            or
          </span>
          <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
        </div>

        {/* Google & Guest Options */}
        <div className="space-y-2.5">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleGoogleContinue}
            className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 transition"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            Continue with Google
          </button>

          {(!currentUser || !currentUser.isGuest) && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleGuestContinue}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 transition"
            >
              Continue as Guest
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
};

