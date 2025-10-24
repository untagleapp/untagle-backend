import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables');
}

// Admin client with service role key - use only on backend
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Helper to verify JWT token from frontend
export async function verifyToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }
    return { userId: data.user.id };
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

// Helper to truncate coordinates to 4 decimal places
export function truncateCoordinate(coord: number): number {
  return Math.trunc(coord * 10000) / 10000;
}
