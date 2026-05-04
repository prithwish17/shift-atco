-- Fix: Add admin role for existing admin user
INSERT INTO user_roles (user_id, role, approved, approved_at, approved_by)
VALUES (
  'e3b5548e-c307-4dab-9217-b54b1be365f8',
  'admin',
  true,
  NOW(),
  'e3b5548e-c307-4dab-9217-b54b1be365f8'
)
ON CONFLICT (user_id, role) DO UPDATE
SET approved = true, approved_at = NOW();

-- Also update the profile to have proper admin details
UPDATE profiles
SET 
  full_name = 'System Administrator',
  employee_id = 'ADMIN001',
  designation = 'System Administrator'
WHERE id = 'e3b5548e-c307-4dab-9217-b54b1be365f8';