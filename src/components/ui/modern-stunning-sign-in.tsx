'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import s from './modern-stunning-sign-in.module.css';

export interface SignInCardProps {
  logo?: ReactNode;
  eyebrow?: string;
  title: string;
  titleAccent?: string;
  email: string;
  password: string;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  busy?: boolean;
  error?: string | null;
  submitLabel?: string;
  footer?: ReactNode;
  className?: string;
}

/**
 * Glass sign-in card (shadcn location: components/ui/modern-stunning-sign-in.tsx).
 * Presentational only: the page owns the auth logic. The demo's Google button, CDN images and fake user counter were dropped
 * (the system has no Google login and must work offline).
 */
export function SignInCard({ logo, eyebrow, title, titleAccent, email, password, onEmailChange, onPasswordChange, onSubmit, busy, error, submitLabel = 'دخول', footer, className }: SignInCardProps) {
  const [show, setShow] = useState(false);
  return (
    <section className={cn(s.card, className)}>
      {logo && <div className={s.logo}>{logo}</div>}
      {eyebrow && <p className={s.eyebrow}>{eyebrow}</p>}
      <h1 className={s.title}>{title}{titleAccent && <> <span className={s.accent}>{titleAccent}</span></>}</h1>

      <form className={s.form} onSubmit={onSubmit} autoComplete="on" noValidate={false}>
        <div className={s.fields}>
          <div>
            <label className={s.label} htmlFor="email">البريد الإلكتروني</label>
            <input id="email" dir="ltr" className={s.input} type="email" autoComplete="username" placeholder="name@example.com" required value={email} onChange={(e) => onEmailChange(e.target.value)} />
          </div>
          <div>
            <label className={s.label} htmlFor="password">كلمة السر</label>
            <div className={s.inputWrap}>
              <input id="password" dir="ltr" className={cn(s.input, s.inputPad)} type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" required value={password} onChange={(e) => onPasswordChange(e.target.value)} />
              <button type="button" className={s.eye} onClick={() => setShow((v) => !v)} aria-label={show ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'} aria-pressed={show}>
                {show ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>
          {error && <p role="alert" className={s.error}>{error}</p>}
        </div>
        <hr className={s.rule} />
        <button type="submit" className={s.submit} disabled={busy}>
          {busy && <Loader2 className="animate-spin" size={20} />} {submitLabel}
        </button>
      </form>
      {footer && <p className={s.footer}>{footer}</p>}
    </section>
  );
}

export default SignInCard;
