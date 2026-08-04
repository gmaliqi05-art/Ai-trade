// PARTNERITETET ME BROKERËT — shtresa e të dhënave për konsolën e Super Adminit.
//
// Çdo shkrim kalon përmes RPC-ve 'admin_broker_*', të cilat janë SECURITY DEFINER me portë admini.
// Rrjedhimisht kushtet e kontratës, normat e rebate-it dhe kontaktet nuk preken dot nga klienti,
// dhe as nuk lexohen prej tij: tabela ka RLS vetëm-admin, ndërsa përdoruesve u shërben pamja
// 'broker_partners_public' me vetëm ato fusha që u duhen.

import { supabase } from '../lib/supabase';

/** Një pyetje e listës së kontrollit para nënshkrimit, me vendin e përgjigjes. */
export interface ChecklistItem { id: string; q: string; a: string; done: boolean }

export type BrokerProgram = 'none' | 'ib' | 'cpa' | 'hybrid';
export type BrokerStatus = 'draft' | 'applied' | 'approved' | 'active' | 'paused' | 'rejected';

export interface BrokerPartner {
  id: string;
  // Identiteti
  name: string; slug: string; website: string; logo_url: string;
  sort_order: number; enabled: boolean; is_primary: boolean;
  // Marrëveshja
  program: BrokerProgram; status: BrokerStatus;
  applied_at: string | null; approved_at: string | null;
  ib_code: string; ib_link: string; ib_portal_url: string;
  contact_name: string; contact_email: string; contact_phone: string; contract_url: string;
  // Kushtet ekonomike
  currency: string;
  rebate_per_lot: number; rebate_gold_per_lot: number;
  cpa_amount: number; cpa_min_deposit: number; cpa_min_lots: number;
  sub_ib_enabled: boolean; sub_ib_share_pct: number;
  payout_frequency: string; payout_min: number; payout_method: string;
  // Rregullat
  entity: string; regulator: string;
  allowed_countries: string; restricted_countries: string;
  min_deposit: number; account_types: string; server_names: string; marketing_rules: string;
  // Transparenca
  disclosure_enabled: boolean; disclosure_text: string;
  checklist: ChecklistItem[];
  notes: string;
  created_at: string; updated_at: string;
}

/** Një rresht i pamjes "kush është te cili broker". */
export interface BrokerUserRow {
  user_id: string; email: string | null; full_name: string | null; registered_at: string | null;
  mt_login: string | null; mt_server: string | null; mt_broker: string | null; mt_mode: string | null;
  broker_id: string | null; broker_name: string | null;
  ref_status: string | null; ref_confirmed_at: string | null;
  lots: number; trades: number; net: number;
}

export async function loadBrokers(): Promise<BrokerPartner[]> {
  const { data, error } = await supabase.rpc('admin_brokers_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as BrokerPartner[]).map((b) => ({
    ...b,
    checklist: Array.isArray(b.checklist) ? b.checklist : [],
  }));
}

/** Ruan vetëm fushat e dërguara — ato që mungojnë mbeten siç ishin te baza. */
export async function saveBroker(patch: Partial<BrokerPartner> & { id?: string }): Promise<string> {
  const { data, error } = await supabase.rpc('admin_broker_save', { p: patch });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deleteBroker(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_broker_delete', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function loadBrokerUsers(days = 90): Promise<BrokerUserRow[]> {
  const { data, error } = await supabase.rpc('admin_broker_users', { p_days: days });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BrokerUserRow[]).map((r) => ({
    ...r, lots: Number(r.lots) || 0, trades: Number(r.trades) || 0, net: Number(r.net) || 0,
  }));
}

export async function setReferral(
  userId: string, brokerId: string, status: string, login?: string, note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_broker_referral_set', {
    p_user: userId, p_broker: brokerId, p_status: status,
    p_login: login ?? null, p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Teksti i parazgjedhur i transparencës — pikënisje, jo detyrim; pronari e ndryshon si të dojë. */
export const DEFAULT_DISCLOSURE =
  'GoldSniperFX është partner (Introducing Broker) i këtij brokeri dhe merr komision nga brokeri ' +
  'për volumin e tregtuar. Kjo nuk e rrit koston tënde të tregtimit dhe nuk ndikon te sinjalet: ' +
  'nivelet e hyrjes, SL-ja dhe TP-ja janë të njëjta për të gjithë. Nuk je i detyruar ta përdorësh ' +
  'këtë broker — platforma punon me çdo llogari MT4/MT5.';
