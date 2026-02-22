import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.from('profiles').select('current_shift, employee_id, full_name');
  if (error) { console.error(error); return; }
  
  const counts = data.reduce((acc, p) => {
    const shift = (p.current_shift || '').toUpperCase();
    acc[shift] = (acc[shift] || 0) + 1;
    return acc;
  }, {});
  
  console.log('Profile shift distribution:', counts);
  console.log('Total profiles fetched:', data.length);
}

run();
