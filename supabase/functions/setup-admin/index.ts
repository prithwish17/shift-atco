import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.79.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase admin client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Get admin credentials from environment variables
    const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || 'admin@shiftplan.com';
    const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD');
    const ADMIN_EMPLOYEE_ID = Deno.env.get('ADMIN_EMPLOYEE_ID') || 'ADMIN001';
    const ADMIN_FULL_NAME = Deno.env.get('ADMIN_FULL_NAME') || 'System Administrator';

    // Validate required environment variables
    if (!ADMIN_PASSWORD) {
      throw new Error('ADMIN_PASSWORD environment variable is required');
    }

    console.log('Starting admin account creation...');

    // Check if admin already exists
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('email', ADMIN_EMAIL)
      .single();

    if (existingProfile) {
      console.log('Admin account already exists');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Admin account already exists',
          admin_email: ADMIN_EMAIL 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    // Create the admin user in auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: ADMIN_FULL_NAME,
        employee_id: ADMIN_EMPLOYEE_ID,
      }
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      throw authError;
    }

    console.log('Auth user created successfully:', authData.user.id);

    // Create profile entry
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authData.user.id,
        full_name: ADMIN_FULL_NAME,
        employee_id: ADMIN_EMPLOYEE_ID,
        email: ADMIN_EMAIL,
        designation: 'System Administrator',
        current_shift: 'general',
      });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      throw profileError;
    }

    console.log('Profile created successfully');

    // Create admin role entry (approved)
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: authData.user.id,
        role: 'admin',
        approved: true,
        approved_at: new Date().toISOString(),
        approved_by: authData.user.id, // Self-approved for initial admin
      });

    if (roleError) {
      console.error('Error creating role:', roleError);
      throw roleError;
    }

    console.log('Admin role assigned successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Admin account created successfully',
        admin_email: ADMIN_EMAIL,
        admin_id: authData.user.id
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in setup-admin function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
