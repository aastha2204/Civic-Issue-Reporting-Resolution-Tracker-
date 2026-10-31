import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rvtsrlkdgjsxdgqfntqp.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_xdstcjK5KWmJ6C1PrJCe1A_el0VdxMq';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;
