'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import Blossom from '@/components/Blossom';
import { DarkGradientBg } from '@/components/ui/elegant-dark-pattern';
import { SignInCard } from '@/components/ui/modern-stunning-sign-in';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { createClient } from '@/lib/supabase/client';
import { setMeta } from '@/lib/db';
import s from './login.module.css';

const HOME = { admin: '/admin', cashier: '/cashier', waiter: '/waiter', accountant: '/accounting', hall_manager: '/hall' } as const;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error') === 'disabled' ? 'الحساب ده متعطل. كلّم المدير.' : null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const sb = createClient();
    const { data, error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (err || !data.user) { setBusy(false); return setError(navigator.onLine ? 'الإيميل أو كلمة السر غلط.' : 'مفيش إنترنت. سجّل دخول أول مرة وإنت متصل.'); }
    const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
    if (!profile || !profile.is_active) { await sb.auth.signOut(); setBusy(false); return setError('الحساب ده ملوش صلاحية دخول. كلّم المدير.'); }
    await setMeta('profile', profile);
    router.replace(HOME[profile.role as keyof typeof HOME]);
    router.refresh();
  }

  return (
    <SignInCard
      logo={<Blossom size={44} />}
      eyebrow="تسجيل دخول الفريق"
      title="سبرينج" titleAccent="بلازا"
      email={email} password={password} onEmailChange={setEmail} onPasswordChange={setPassword}
      onSubmit={onSubmit} busy={busy} error={error}
      footer="نسيت كلمة السر؟ كلّم المدير يغيّرها لك."
    />
  );
}

export default function LoginPage() {
  return (
    <DarkGradientBg>
      <div className={s.stage}>
        <div className={s.brandTag}><Blossom size={28} /> سبرينج بلازا كافيه</div>
        <ThemeToggle variant="glass" className={s.toggle} />
        <Suspense><LoginForm /></Suspense>
        <ul className={s.badges} aria-label="مميزات النظام">
          <li className={s.badge}><WifiOff size={16} /> يشتغل بدون إنترنت</li>
          <li className={s.badge}><RefreshCw size={16} /> مزامنة تلقائية</li>
          <li className={s.badge}><ShieldCheck size={16} /> صلاحيات لكل حساب</li>
        </ul>
      </div>
    </DarkGradientBg>
  );
}
