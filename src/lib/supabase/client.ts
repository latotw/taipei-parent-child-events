import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SyncError } from "@/lib/supabase/errors";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

/**
 * 沒設定環境變數時整個同步功能會關閉，App 仍可離線使用（只是不會上傳）。
 * 這兩個值都是可公開的（anon key 受 RLS 保護），所以放 NEXT_PUBLIC_ 沒問題。
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!url || !anonKey) {
    throw new SyncError(
      "NOT_CONFIGURED",
      "尚未設定 Supabase（NEXT_PUBLIC_SUPABASE_URL / ANON_KEY），目前只在這台裝置上運作。",
    );
  }

  cached ??= createClient(url, anonKey, {
    auth: {
      // 存的是匿名登入的 JWT，不是解密金鑰；金鑰永遠不落地。
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return cached;
}
