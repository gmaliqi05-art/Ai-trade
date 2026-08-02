import { supabase } from '../lib/supabase';

// SUPORTI — biletat e klientëve dhe biseda me Adminin, brenda platformës.
// Email-i zyrtar (shfaqet në UI): support@goldsniper.vip
export const SUPPORT_EMAIL = 'support@goldsniper.vip';

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  unread_by_admin: boolean;
  unread_by_user: boolean;
  created_at: string;
  last_msg_at: string;
  profiles?: { full_name: string | null; username: string | null } | null; // vetëm te Admini
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender: 'user' | 'admin';
  body: string;
  created_at: string;
}

/* ---------------- KLIENTI ---------------- */

export async function loadMyTickets(userId: string): Promise<SupportTicket[]> {
  const { data } = await supabase.from('support_tickets')
    .select('*').eq('user_id', userId).order('last_msg_at', { ascending: false });
  return (data ?? []) as SupportTicket[];
}

/** Hap biletë të re me mesazhin e parë. */
export async function createTicket(userId: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const { data: tk, error } = await supabase.from('support_tickets')
    .insert({ user_id: userId, subject: subject.trim() }).select('id').single();
  if (error || !tk) return { ok: false, error: error?.message };
  const { error: e2 } = await supabase.from('support_messages')
    .insert({ ticket_id: tk.id, sender: 'user', sender_id: userId, body: body.trim() });
  if (e2) return { ok: false, error: e2.message };
  return { ok: true };
}

export async function loadMessages(ticketId: string): Promise<SupportMessage[]> {
  const { data } = await supabase.from('support_messages')
    .select('id, ticket_id, sender, body, created_at')
    .eq('ticket_id', ticketId).order('created_at');
  return (data ?? []) as SupportMessage[];
}

/** Përgjigje e klientit në biletën e vet — rihapet dhe shënohet e palexuar për Adminin. */
export async function replyAsUser(userId: string, ticketId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('support_messages')
    .insert({ ticket_id: ticketId, sender: 'user', sender_id: userId, body: body.trim() });
  if (error) return { ok: false, error: error.message };
  await supabase.from('support_tickets')
    .update({ status: 'open', unread_by_admin: true, unread_by_user: false, last_msg_at: new Date().toISOString() })
    .eq('id', ticketId);
  return { ok: true };
}

/** Klienti e hapi biletën — hiq shenjën "e palexuar". */
export async function markReadByUser(ticketId: string): Promise<void> {
  await supabase.from('support_tickets').update({ unread_by_user: false }).eq('id', ticketId);
}

/* ---------------- ADMINI ---------------- */

export async function adminLoadTickets(): Promise<SupportTicket[]> {
  const { data } = await supabase.from('support_tickets')
    .select('*, profiles(full_name, username)')
    .order('last_msg_at', { ascending: false });
  return (data ?? []) as SupportTicket[];
}

/** Përgjigjja e Adminit: mesazh + statusi 'answered' + njoftim te zilja e klientit. */
export async function adminReply(adminId: string, ticket: SupportTicket, body: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('support_messages')
    .insert({ ticket_id: ticket.id, sender: 'admin', sender_id: adminId, body: body.trim() });
  if (error) return { ok: false, error: error.message };
  await supabase.from('support_tickets')
    .update({ status: 'answered', unread_by_user: true, unread_by_admin: false, last_msg_at: new Date().toISOString() })
    .eq('id', ticket.id);
  // Njoftim te zilja e klientit (mos e ndal rrjedhën nëse dështon).
  await supabase.from('notifications').insert({
    user_id: ticket.user_id, type: 'support',
    title: '📩 Suporti u përgjigj', body: `Bileta "${ticket.subject}" mori përgjigje — hape faqen Suport.`,
  }).then(() => {}, () => {});
  return { ok: true };
}

export async function adminSetStatus(ticketId: string, status: 'open' | 'answered' | 'closed'): Promise<void> {
  await supabase.from('support_tickets').update({ status }).eq('id', ticketId);
}

export async function adminMarkRead(ticketId: string): Promise<void> {
  await supabase.from('support_tickets').update({ unread_by_admin: false }).eq('id', ticketId);
}
