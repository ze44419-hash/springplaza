/** Unwrap a Supabase response, turning database errors into readable Arabic messages. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(arabicError(res.error.message));
  return res.data as T;
}

/** Maps database / network error text to Arabic. Unknown messages are returned unchanged. */
export function arabicError(msg: string): string {
  const m = msg ?? '';
  if (/foreign key/i.test(m)) return 'العنصر ده مستخدم في حاجة تانية (أوردرات قديمة أو وصفات). عطّله بدل ما تحذفه.';
  if (/duplicate key|unique/i.test(m)) return 'في عنصر بنفس الاسم موجود قبل كده.';
  if (/failed to fetch|network|load failed/i.test(m)) return 'مفيش اتصال بالإنترنت. شاشة المدير محتاجة إنترنت.';
  if (/open a shift/i.test(m)) return 'افتح شيفت الأول قبل استلام أي مدفوعات.';
  if (/waiters can only cancel/i.test(m)) return 'الكابتن يقدر يلغي أوردراته الجديدة بس.';
  if (/not authorized|row-level security|42501/i.test(m)) return 'مش مصرّح لك تعمل الإجراء ده.';
  if (/admin only/i.test(m)) return 'الإجراء ده للمدير فقط.';
  if (/order has no items/i.test(m)) return 'الأوردر فاضي.';
  if (/product unavailable/i.test(m)) return 'في صنف في الأوردر مش متاح أو اتحذف.';
  if (/order is cancelled/i.test(m)) return 'الأوردر ده ملغي.';
  if (/order not found/i.test(m)) return 'الأوردر مش موجود.';
  if (/shift not found/i.test(m)) return 'الشيفت مش موجود.';
  if (/ingredient not found/i.test(m)) return 'الخامة مش موجودة.';
  if (/insufficient stock/i.test(m)) return 'الرصيد في المخزن مش كفاية للكمية دي.';
  if (/invalid quantity/i.test(m)) return 'اكتب كمية صحيحة.';
  if (/return exceeds remaining/i.test(m)) return 'الكمية الراجعة أكبر من الباقي مع الباريستا.';
  if (/withdrawal has no items/i.test(m)) return 'ضيف خامة واحدة على الأقل للسحب.';
  if (/withdrawal (item )?not found/i.test(m)) return 'السحب مش موجود.';
  if (/warehouse not found/i.test(m)) return 'المخزن مش موجود أو متعطّل.';
  if (/same warehouse/i.test(m)) return 'اختار مخزنين مختلفين.';
  if (/cannot reopen/i.test(m)) return 'مينفعش تفتح أوردر مدفوع تاني. عدّل بياناته أو الغيه.';
  if (/table required/i.test(m)) return 'اختار الطاولة للأوردر الصالة.';
  if (/rejected/i.test(m)) return 'الأوردر اترفض من السيرفر.';
  // ----- القاعة والمحاسبة -----
  if (/date already booked/i.test(m)) return 'اليوم ده محجوز بالفعل. اختار تاريخ تاني.';
  if (/event date required/i.test(m)) return 'اختار تاريخ المناسبة.';
  if (/customer name required/i.test(m)) return 'اكتب اسم العميل.';
  if (/hall rate (required|not found)/i.test(m)) return 'اختار سعر إيجار صحيح (ممكن يكون اتعطّل).';
  if (/service unavailable/i.test(m)) return 'في طبق أو خدمة في الحجز اتعطّلت أو اتحذفت.';
  if (/paid exceeds total/i.test(m)) return 'المدفوع أكبر من إجمالي الحجز.';
  if (/booking is closed/i.test(m)) return 'الحجز ده منتهي أو ملغي ومينفعش يتعدّل.';
  if (/booking not found/i.test(m)) return 'الحجز مش موجود.';
  if (/invalid booking transition/i.test(m)) return 'مينفعش تنقل الحجز للحالة دي من حالته الحالية.';
  if (/finance only/i.test(m)) return 'الإجراء ده للمحاسب أو المدير فقط.';
  if (/invalid period/i.test(m)) return 'اختار فترة صحيحة.';
  if (/period too long/i.test(m)) return 'الفترة أطول من سنة. قسّمها لفترات أصغر.';
  if (/no active partners/i.test(m)) return 'مفيش شركاء نشطين. ضيف الشركاء الأول.';
  if (/partner shares must total 100/i.test(m)) return 'مجموع نسب الشركاء النشطين لازم يساوي 100% بالظبط.';
  if (/net profit is not positive/i.test(m)) return 'مفيش صافي ربح موجب في الفترة دي علشان يتوزّع.';
  if (/overlaps an existing distribution/i.test(m)) return 'الفترة دي بتتقاطع مع توزيع أرباح معتمد قبل كده.';
  return m;
}
export const friendly = arabicError;

/** Shrink an image client-side (max 640 px, WebP) before uploading — keeps the POS grid fast and offline caches small. */
export async function shrinkImage(file: File, max = 640): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('تعذّر معالجة الصورة'))), 'image/webp', 0.82));
}

export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
