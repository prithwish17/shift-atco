-- Add extended profile fields for comprehensive employee details
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS station TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_joining DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_details JSONB DEFAULT '{}'::jsonb;

-- profile_details JSONB stores:
-- atc_license_number, atc_license_type, atc_license_expiry, issuing_authority
-- medical_cert_class, medical_cert_validity
-- unit_endorsements, equipment_qualifications
-- initial_training_institute, initial_training_year, last_recurrent_training_date
-- security_clearance_status
-- icao_english_proficiency_level

COMMENT ON COLUMN profiles.profile_details IS 'Extended ATC profile data: license, medical, training, security, language details';
