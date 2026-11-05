# هيكل المشروع بعد إعادة التنظيم

## `src/app` — المسارات (App Router)
| المجلد | المحتوى | من يدخل |
|---|---|---|
| `/admin` | الإعدادات، المنيو، المخزون، **بنود العقد الافتراضية** (`/admin/contract`)، الحسابات والصلاحيات (`/admin/users`) | أدمن فقط |
| `/hall` | جدول الحجوزات وتفاصيل الحجز، **طباعة العقد** (`/hall/contract/[id]`) | أدمن + مسؤول القاعة |
| `/hall/pricing` | أسعار القاعة والخدمات | أدمن فقط |
| `/accounting` | الخزنة، فلوس بره، الموردين والمشتريات، الأصول، التقارير، المصروفات، الموظفين، الشركاء، الأرباح | أدمن + محاسب فقط |
| `/cashier` `/waiter` `/branch` `/sessions` | الكاشير / الكابتن / مسؤول الكافيه / السيشن | حسب الدور |

## `src/components` — المكونات المشتركة
| المجلد | المحتوى |
|---|---|
| `layout/` | `AppShell` (الهيدر + شريط الأقسام)، `Providers` (التنبيهات `useNotify`)، `ClientOnly`، `AdminBack`، `BranchSwitcher`… |
| `ui/` | `kit.tsx` (Modal, Spinner, Empty, ErrorNote…) + مكونات الدخول والثيم |
| `tables/` | `Crud` (جداول ونماذج CRUD)، `ReportTable` (تقرير + CSV + طباعة)، `PeriodPicker` |
| `print/` | `Print.tsx` (طباعة الرول الحراري)، `ReceiptView`، **`PrintDocument`** (ورقة A4)، **`printPage()`** (طباعة صفحة تقرير) |
| `cafe/` | `OrderTaker`، `StockWithdrawals`، `BranchReport` |
| `hall/` | `BookingEditor` |

## `src/lib` — الاتصال بقاعدة البيانات والمساعدات
| المجلد | المحتوى |
|---|---|
| `supabase/` | `client.ts` / `server.ts` |
| `services/` | كل دوال البيانات: `hall`, `finance`, `accounting`, `inventory`, `orders`, `sessions`, `nursery`, `catalog`, `shift`, `receipt`, `accountingExport` |
| `offline/` | `db` (Dexie) و`sync` و`outbox` — العمل بدون إنترنت |
| `helpers/` | `format` (تنسيق التاريخ والمبالغ)، `util` (أخطاء عربية…)، `utils` (cn)، `sound` |
| `auth/` | **`access.ts`** (قواعد الصلاحيات — مصدر واحد)، `permissions.ts` |
| `types.ts` | الأنواع المشتركة |

## `src/styles`
- `print.css` — **كل** قواعد الطباعة (رول حراري + A4).
- `contract.css` — تخطيط عقد القاعة فقط.

## نظام الطباعة
- **A4 (عقود وتقارير):** `@page { size: A4; margin: 10mm }` + الصفحة تتطبع بخلفية بيضاء ونص أسود حتى لو التطبيق في Dark Mode. الهيدر والقوائم والأزرار بتختفي (`.no-print` / `nav` / `button`). تتفعّل عن طريق `<PrintDocument>` أو `printPage()` (كلاس `doc-print` على `<html>`).
- **الرول الحراري (إيصالات):** زي ما كان — المحتوى بيتطبع من `#print-root` ومقاس الرول بيتحط وقت الطباعة فقط وبيتشال بعدها.
- **سبب الصفحة الفاضية قبل كده:** قاعدة الطباعة العامة كانت بتخفي `#app-root` كله، وصفحة العقد والتقارير جواه.

## الصلاحيات (`lib/auth/access.ts`)
- القواعد بتتقرأ من الـ middleware (حماية السيرفر) ومن شريط التنقل (إخفاء الروابط) — عدّل في مكان واحد.
- `/accounting/*` للأدمن والمحاسب فقط (مفيش صلاحية إضافية تفتحها).
- مسؤول القاعة: الحجوزات + طباعة العقد فقط. `/hall/pricing` و`/branch` للأدمن.
- **تنبيه:** الـ middleware يحمي الشاشات، لكن سياسات قاعدة البيانات (`is_finance()`) لسه بتسمح لأي حساب مُسند له صلاحية `accounting` في جدول `user_permissions`. لو فيه حسابات قديمة كده، امسح الصلاحية من جدول `user_permissions`.
