import { createClient } from '@/lib/supabase/client';
import { must } from '@/lib/util';
import type { PhotoSession, SessionStatus } from '@/lib/types';

const sb = () => createClient();

export const listSessions = async (from?: string) => {
  let q = sb().from('photo_sessions').select('*').order('session_date').order('session_time');
  if (from) q = q.gte('session_date', from);
  return must(await q) as PhotoSession[];
};

export type SessionInput = { session_date: string; session_time: string; customer_name: string; customer_phone: string | null; price: number; deposit: number; notes: string | null };

export const saveSession = async (id: string | null, v: SessionInput) => {
  if (!v.customer_name.trim()) throw new Error('اكتب اسم العميل.');
  if (!v.session_date || !v.session_time) throw new Error('اختار التاريخ والوقت.');
  if (v.deposit > v.price) throw new Error('الدفعة المقدمة أكبر من السعر.');
  const { error } = id ? await sb().from('photo_sessions').update(v).eq('id', id) : await sb().from('photo_sessions').insert(v);
  if (error) throw new Error(error.code === '23505' ? 'فيه سيشن محجوزة في نفس التاريخ والوقت.' : error.message);
};

export const setSessionStatus = async (id: string, status: SessionStatus) =>
  must(await sb().from('photo_sessions').update({ status }).eq('id', id).select());
