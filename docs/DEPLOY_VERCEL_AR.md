# الرفع على Vercel

## قبل الرفع (مرة واحدة)
1. في Supabase شغّل ملفات `supabase/migrations` بالترتيب (لو لسه).
2. Authentication → URL Configuration: ضيف رابط Vercel في **Site URL** و **Redirect URLs**.

## الطريقة 1: GitHub (الأسهل)
1. `git init && git add . && git commit -m "init"` ثم ارفع على repo في GitHub.
2. vercel.com → Add New → Project → اختار الـ repo (الـ Framework هيتعرف Next.js تلقائيًا).
3. Environment Variables: ضيف `NEXT_PUBLIC_SUPABASE_URL` و `NEXT_PUBLIC_SUPABASE_ANON_KEY` و `SUPABASE_SERVICE_ROLE_KEY` (+ باقي متغيرات `.env.example` لو عايز).
4. Deploy. أي push على `main` = نشر تلقائي.

## الطريقة 2: Vercel CLI
```bash
npm i -g vercel
vercel login
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel --prod
```

## فحص محلي قبل الرفع
```bash
npm ci && npm run typecheck && npm run lint && npm run build
```

## ملاحظات
- لو أنشأت المتغيرات بعد أول Deploy لازم تعمل **Redeploy**.
- اختار Region للـ Functions قريب من Supabase (Settings → Functions → Region) لتقليل التأخير.
- `maxDuration` لدوال الـ API = 30 ثانية (مناسب لخطة Hobby).
