-- ─────────────────────────────────────────────────────────────────────────────
-- OJT engine parity check: public.v_ojt_progress vs. src/domain/ojt/progress.ts
--
-- The progress math exists twice — once in SQL (for filtering, sorting and
-- alerting) and once in TypeScript (for rendering without a round-trip). This
-- script proves they still agree.
--
-- Run against any environment that has the OJT migrations applied:
--
--     psql "$DATABASE_URL" -f sql/ojt_parity_check.sql
--
-- Everything happens inside a transaction that ROLLS BACK, and every fixture
-- row uses a 'PARITY-' emp_id prefix, so no real row is read or written.
-- A passing run prints "OJT PARITY OK (132 rows)". A failure raises and lists
-- the diverging rows.
--
-- Expected values come from the same golden fixtures as
-- src/domain/ojt/__tests__/fixtures.ts, which are pinned to the spreadsheet
-- itself. Regenerate both together.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Pin "today" so date-dependent output is reproducible. Rolled back with the
-- rest of the transaction.
CREATE OR REPLACE FUNCTION public.ojt_today()
RETURNS DATE LANGUAGE sql STABLE SET search_path = public
AS $fn$ SELECT DATE '2026-08-11' $fn$;

INSERT INTO public.employee_ojt_progress (
  emp_id, unit, employee_name,
  sheet_required_hours, sheet_required_days,
  sheet_performed_hours, sheet_performed_days,
  sheet_start_date, sheet_synced_at
)
SELECT v.emp_id, v.unit, v.employee_name,
       v.required_hours, v.required_days,
       v.performed_hours, v.performed_days,
       v.start_date::date, now()
FROM (VALUES
  ('PARITY-10023136', 'PLR', 'AAKASH KUMAR', 60, 45, 86.5, 191, '2025-12-30'),
  ('PARITY-10021938', 'ADC', 'ABHISHEK KUMAR', 75, 40, 86.25, 206, '2025-12-31'),
  ('PARITY-10021023', 'ADC', 'ABHISHEK MONDAL', 90, 45, 0, 0, '2026-07-22'),
  ('PARITY-10024032', 'ADC', 'ABHISHEK MUKHERJEE', 90, 45, 58.5, 96, '2026-05-01'),
  ('PARITY-10021723', 'ADC', 'ABHISHEK SHARMA', 90, 45, 0, 0, '2026-04-08'),
  ('PARITY-10020256', 'APP+APP(S)', 'ADITYA KUMAR SINGH', 180, 90, 223.83, 340, '2025-07-29'),
  ('PARITY-10002472', 'ACC+ACC(S)', 'AJEET KUMAR SINGH', 210, 105, 172.17, 186, '2026-01-25'),
  ('PARITY-10009714', 'ADC', 'AKASH CHOUDHURY', 90, 45, 11, 26, '2026-07-09'),
  ('PARITY-10003862', 'APP+APP(S)', 'AKASH PANJA', 180, 90, 40.67, 48, '2026-06-19'),
  ('PARITY-10023104', 'PLR', 'AKSHIT GOYAL', 60, 45, 87.08, 191, '2025-12-18'),
  ('PARITY-10021025', 'OCC', 'ALOK SRIVASTAV', 45, 25, 0, 0, '2026-05-26'),
  ('PARITY-10021111', 'ADC', 'AMIT KISHORE', 90, 45, 12.75, 26, '2026-05-13'),
  ('PARITY-10022052', 'PLR', 'ANIMESH ADHIKARI', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10023447', 'PLR', 'ANIMESH KUMAR', 60, 45, 0, 0, '2026-05-04'),
  ('PARITY-10023192', 'PLR', 'APOORV KUSHWAHA', 60, 45, 75.75, 128, '2025-12-18'),
  ('PARITY-10023158', 'PLR', 'APSHAY KUMAR', 60, 45, 63.5, 127, '2025-12-18'),
  ('PARITY-10023870', 'ADC', 'ARCHIT KUMAR', 60, 30, 52.25, 92, '2026-05-05'),
  ('PARITY-10023424', 'PLR', 'ARUN KUMAR', 60, 45, 0, 0, '2026-05-05'),
  ('PARITY-10023109', 'PLR', 'ASHISH KUMAR', 60, 45, 0, 0, '2025-12-18'),
  ('PARITY-10002979', 'OCC', 'ATUL SINGH', 45, 25, 0, 0, '2025-11-11'),
  ('PARITY-10020170', 'ACC+ACC(S)', 'AVINASH', 210, 105, 225, 300, '2025-10-09'),
  ('PARITY-10022059', 'ADC', 'AVNISH KUMAR', 90, 45, 0, 0, '2025-08-18'),
  ('PARITY-10023446', 'PLR', 'AYAN DASTIDAR', 60, 45, 2.75, 3, '2026-07-30'),
  ('PARITY-10010261', 'OCC', 'BHASKAR BISWAS', 45, 25, 22.5, 17, '2026-07-14'),
  ('PARITY-10002977', 'OCC', 'BHUPENDRA KUMAR GUPTA', 45, 25, 45, 44, '2026-01-14'),
  ('PARITY-10015621', 'ACC+ACC(S)', 'BIJAN KUMAR BHAT', 10, 5, 0, 0, '2026-06-17'),
  ('PARITY-10023669', 'PLR', 'BIKRAM MONDAL', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10023608', 'PLR', 'CHANDAN PATHAK', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10015589', 'OCC', 'CHANDRA MOHAN KUMAR PASWAN', 45, 25, 0, 0, '2026-02-24'),
  ('PARITY-10005102', 'ADC', 'DAVID TOPNO', 90, 45, 29, 52, '2026-06-10'),
  ('PARITY-10020257', 'OCC', 'DEBASHISH HANSDAH', 45, 25, 0, 0, '2026-02-24'),
  ('PARITY-10002347', 'APP+APP(S)', 'DEEPAK KUMAR', 180, 3, 183.33, 215, '2026-01-02'),
  ('PARITY-10023201', 'PLR', 'DHEERAJ KUMAR', 60, 45, 98, 191, '2025-12-18'),
  ('PARITY-10001911', 'APP+APP(S)', 'DIBAKAR MITRA', 60, 30, 78.92, 99, '2026-04-28'),
  ('PARITY-10023094', 'PLR', 'DINESH', 60, 45, 80.75, 191, '2025-12-18'),
  ('PARITY-10003915', 'ACC+ACC(S)', 'DIPTARGHA BAUL', 210, 105, 101, 105, '2026-03-28'),
  ('PARITY-10024181', 'ADC', 'DIVYA DEV', 90, 45, 22.5, 44, '2026-06-21'),
  ('PARITY-10023095', 'PLR', 'DRONESH GAUTAM', 60, 45, 92, 151, '2025-12-18'),
  ('PARITY-10002405', 'APP+APP(S)', 'DURGESH CHANDRA TRIPATHI', 180, 90, 5, 2, '2026-07-31'),
  ('PARITY-10003609', 'ACC+ACC(S)', 'GANESH SHANKAR VIDYARTHI', 210, 105, 76, 57, '2026-04-27'),
  ('PARITY-10002227', 'ACC+ACC(S)', 'GAUTAM KUMAR', 210, 105, 239.08, 266, '2025-11-11'),
  ('PARITY-10003848', 'ACC+ACC(S)', 'GOPAL JEE', 210, 105, 46.08, 35, '2026-07-01'),
  ('PARITY-10003782', 'ACC+ACC(S)', 'HAIMANTI SENGUPTA', 210, 105, 15.33, 11, '2026-04-15'),
  ('PARITY-10023514', 'PLR', 'HARSH VISHWAKARMA', 60, 45, 43.75, 50, '2026-05-04'),
  ('PARITY-10020143', 'APP+APP(S)', 'HITESH RATHORE', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10001051', 'ACC+ACC(S)', 'IBOTOMBA NINGTHOUJAM', 210, 105, 214.58, 241, '2025-12-04'),
  ('PARITY-10025441', 'ADC', 'JAI OM UPADHYAY', 90, 90, 19, 31, '2026-07-02'),
  ('PARITY-10015614', 'OCC', 'JUSTIN MINJ', 45, 25, 0, 0, '2026-03-03'),
  ('PARITY-10003899', 'ACC+ACC(S)', 'JYOTIRMOY GUHA', 210, 105, 143.33, 128, '2026-03-29'),
  ('PARITY-10017314', 'OCC', 'K IBUNGOTON SINGHA', 45, 25, 62.5, 235, '2025-08-11'),
  ('PARITY-10002046', 'ADC', 'KAUSHAL KAMAL', 90, 45, 52, 71, '2026-05-29'),
  ('PARITY-10003965', 'ACC+ACC(S)', 'KUMAR ABHIJIT', 210, 105, 235.92, 202, '2026-01-15'),
  ('PARITY-10023371', 'PLR', 'KUMAR SAURAV', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10003911', 'OCC', 'LAL BAHADUR KUMAR', 45, 25, 3.5, 4, '2026-06-22'),
  ('PARITY-10023179', 'PLR', 'MADHURIMA HALDER', 60, 45, 78, 171, '2025-12-30'),
  ('PARITY-10023347', 'PLR', 'MANIDEEPA ROY', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10024184', 'ADC', 'MANIK CHANDRA KARMAKAR', 90, 90, 52.25, 85, '2026-05-12'),
  ('PARITY-10001141', 'OCC', 'MANISH AGARWAL', 45, 25, 48.75, 232, '2025-08-18'),
  ('PARITY-10021729', 'APP+APP(S)', 'MANISH KUMAR', 180, 90, 219.42, 362, '2025-08-03'),
  ('PARITY-10023483', 'PLR', 'MANISH KUMAR', 60, 45, 0, 0, '2026-05-07'),
  ('PARITY-10002911', 'ACC+ACC(S)', 'MANOJ KUMAR YADAV', 30, 15, 0, 0, '2026-06-17'),
  ('PARITY-10023398', 'PLR', 'MAYANK KUMAR', 60, 45, 0, 0, '2026-05-04'),
  ('PARITY-10023410', 'PLR', 'MD SHAQUIB ANSARI', 60, 45, 32.25, 60, '2026-05-05'),
  ('PARITY-10020412', 'ACC+ACC(S)', 'MEENA KUMARI', 120, 60, 203.25, 293, '2025-10-09'),
  ('PARITY-10003937', 'APP+APP(S)', 'MELBIN PHILIP VARGHESE', 180, 90, 21.5, 25, '2026-07-09'),
  ('PARITY-10012533', 'PLR', 'MILAN KANTI MANDAL', 15, 7, 16.75, 39, '2026-06-11'),
  ('PARITY-10023075', 'PLR', 'MOHAMMAD SULTAN', 60, 45, 85.33, 191, '2025-12-18'),
  ('PARITY-10003900', 'OCC', 'MOHIT KUMAR', 45, 25, 17, 15, '2026-06-16'),
  ('PARITY-10003821', 'PLR', 'MOUMITA SARCAR', 60, 45, 84.5, 107, '2026-02-24'),
  ('PARITY-10003864', 'OCC', 'NAGMANI KUMAR', 45, 25, 0, 0, '2026-05-26'),
  ('PARITY-10003218', 'APP+APP(S)', 'NAVITA PRAVEEN SEHGAL', 90, 45, 142.75, 231, '2025-08-29'),
  ('PARITY-10023364', 'PLR', 'NEERAJ KUMAR MAHESH', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10002833', 'OCC', 'NISHESH SHUKLA', 45, 25, 72.5, 252, '2025-08-11'),
  ('PARITY-10002471', 'ADC', 'PRABHAT RANJAN', 90, 45, 15, 29, '2026-07-07'),
  ('PARITY-10012191', 'ACC+ACC(S)', 'PRAKASH CHANDRA MISHRA', 210, 105, 235.5, 454, '2024-12-05'),
  ('PARITY-10023395', 'PLR', 'PRAKASH KUMAR', 60, 45, 0, 0, '2026-05-04'),
  ('PARITY-10002317', 'ACC+ACC(S)', 'PRATICK DASGUPTA', 210, 105, 170.5, 205, '2026-01-12'),
  ('PARITY-10023526', 'PLR', 'PRIYA RANJAN', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10023452', 'PLR', 'PRIYABRATA PAN', 60, 45, 49, 57, '2026-05-04'),
  ('PARITY-10003838', 'ACC+ACC(S)', 'RAHUL KUMAR', 210, 105, 176.75, 201, '2026-01-13'),
  ('PARITY-10022258', 'ACC+ACC(S)', 'RAJ KUMAR', 210, 105, 276.83, 271, '2025-10-29'),
  ('PARITY-10004045', 'ACC+ACC(S)', 'RAJAT SHRIVASTAVA', 210, 105, 213.33, 203, '2026-01-08'),
  ('PARITY-10002348', 'ACC+ACC(S)', 'RATNAKAR PRATAP SINGH', 210, 105, 227.83, 254, '2025-10-27'),
  ('PARITY-10023379', 'PLR', 'RAUSHAN KUMAR', 60, 45, 0, 0, '2026-05-04'),
  ('PARITY-10003967', 'APP+APP(S)', 'RAVI BHUSHAN', 180, 90, 156.25, 209, '2026-01-05'),
  ('PARITY-10002458', 'ACC', 'RAVI KUMAR', 120, 60, 82.75, 247, '2025-06-09'),
  ('PARITY-10021365', 'ACC+ACC(S)', 'RAVI SHANKAR KUMAR', 210, 105, 190.92, 223, '2025-10-24'),
  ('PARITY-10002195', 'ACC+ACC(S)', 'RICHA SINGH', 210, 105, 50.67, 30, '2026-07-07'),
  ('PARITY-10023390', 'PLR', 'RISHABH', 60, 45, 49.75, 77, '2026-05-04'),
  ('PARITY-10023209', 'PLR', 'RITESH SINGH RATHOUR', 60, 45, 80.75, 127, '2025-12-18'),
  ('PARITY-10023639', 'PLR', 'ROSHAN PRASAD', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10003134', 'APP+APP(S)', 'RUDRA PRATAP', 90, 45, 130.83, 243, '2025-10-20'),
  ('PARITY-10003134', 'ADC', 'RUDRA PRATAP', 60, 30, 0, 0, '2026-06-29'),
  ('PARITY-10023236', 'PLR', 'RUPESH KUMAR', 60, 45, 78.5, 136, '2026-01-15'),
  ('PARITY-10023348', 'PLR', 'SAGNIK MONDAL', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10002574', 'APP+APP(S)', 'SANDEEP KUMAR GUPTA', 180, 90, 216.58, 332, '2025-07-22'),
  ('PARITY-10023093', 'PLR', 'SANJAY KUMAR', 60, 45, 92.08, 185, '2025-12-18'),
  ('PARITY-10013449', 'PLR', 'SANJEEV RANJAN PRASAD', 15, 7, 19.25, 22, '2026-07-08'),
  ('PARITY-10022080', 'ADC', 'SANJOY DEB BARMAN', 90, 45, 0, 0, '2026-04-01'),
  ('PARITY-10021133', 'ADC', 'SANMITRA BHOWMIK', 90, 45, 76.75, 111, '2026-04-16'),
  ('PARITY-10020147', 'ACC+ACC(S)', 'SANTOSH KUMAR', 210, 105, 205.33, 167, '2026-02-16'),
  ('PARITY-10021915', 'PLR', 'SAYAN GAYEN', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10023586', 'ADC', 'SHALINI SINGH', 90, 45, 3, 7, '2026-07-29'),
  ('PARITY-10023432', 'PLR', 'SHREEKRUSHNA MISHRA', 60, 45, 0, 0, '2026-05-06'),
  ('PARITY-10023435', 'PLR', 'SHRUTI KUMARI', 60, 45, 7, 21, '2026-05-07'),
  ('PARITY-10023143', 'PLR', 'SHUBHAM RAJ', 60, 45, 84, 128, '2025-12-30'),
  ('PARITY-10025385', 'ADC', 'SHUBHAM SWARAJ', 90, 90, 11, 14, '2026-07-22'),
  ('PARITY-10003863', 'ACC+ACC(S)', 'SHUVASMITA ROY', 210, 105, 24.5, 20, '2026-07-01'),
  ('PARITY-10023873', 'ADC', 'SIDDHANT BHUSHAN', 75, 40, 77.17, 124, '2026-04-03'),
  ('PARITY-10021871', 'ADC', 'SIDDHAYAK SANYAL', 90, 45, 46.67, 106, '2026-04-21'),
  ('PARITY-10024279', 'ADC', 'SOMA MONDAL', 90, 90, 96.92, 205, '2026-01-10'),
  ('PARITY-10024217', 'ADC', 'SOMNATH PATHAK', 90, 45, 63, 87, '2026-05-07'),
  ('PARITY-10003963', 'APP+APP(S)', 'SOUMIK SENAPATI', 180, 90, 50.5, 39, '2026-06-26'),
  ('PARITY-10002572', 'APP+APP(S)', 'SOUVIK DUTTA', 60, 30, 35.5, 35, '2026-07-01'),
  ('PARITY-10023216', 'PLR', 'SUBHAM PARASRAMKA', 60, 45, 89.5, 197, '2025-12-18'),
  ('PARITY-10010227', 'APP+APP(S)', 'SUBHAN DEY', 180, 180, 18.83, 84, '2026-05-07'),
  ('PARITY-10023349', 'PLR', 'SUBHOJIT PAL', 60, 45, 37, 67, '2026-05-04'),
  ('PARITY-10012601', 'OCC', 'SUJIT KUMAR ROY', 45, 25, 0, 0, '2025-08-18'),
  ('PARITY-10004010', 'ACC+ACC(S)', 'SULAGNA BHATTACHARYYA', 210, 105, 49, 38, '2026-06-26'),
  ('PARITY-10002193', 'APP+APP(S)', 'SUMIT KUMAR TIWARI', 180, 90, 189, 274, '2025-10-29'),
  ('PARITY-10021205', 'ADC', 'SYED SHARIF ALAM', 90, 45, 49, 105, '2026-04-21'),
  ('PARITY-10023538', 'PLR', 'TAHSEEN RAZA', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10023690', 'PLR', 'TANYA PRAKASH', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10018898', 'OCC', 'TEKCHAM SHYAMKUMAR SINGH', 45, 25, 40, 50, '2025-08-26'),
  ('PARITY-10023288', 'PLR', 'UDAY KESHRI', 60, 45, 86.25, 171, '2025-12-30'),
  ('PARITY-10023250', 'PLR', 'UJJWAL KUMAR', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10013564', 'OCC', 'VIJAY KUMAR GUPTA', 30, 15, 33.33, 16, '2026-07-11'),
  ('PARITY-10023567', 'PLR', 'VIKASH MISHRA', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10009953', 'ADC', 'VISHAL JAISWAL', 90, 45, 15, 52, '2026-06-12'),
  ('PARITY-10023430', 'PLR', 'VISHAL KUMAR', 60, 45, 0, 0, '2026-05-04'),
  ('PARITY-10023503', 'PLR', 'VIVEK KUWAR', 60, 30, 0, 0, '2026-07-31'),
  ('PARITY-10004078', 'ACC+ACC(S)', 'VIVEKANANDA DE', 210, 105, 125.5, 117, '2026-04-10')
) AS v(emp_id, unit, employee_name, required_hours, required_days,
       performed_hours, performed_days, start_date);

CREATE TEMP TABLE ojt_parity_expected (
  emp_id      text,
  unit        text,
  deadline    date,
  days_left   integer,
  hours_left  numeric,
  band        text,
  requires_gm boolean
) ON COMMIT DROP;

INSERT INTO ojt_parity_expected VALUES
  ('PARITY-10023136', 'PLR', '2026-04-29'::date, -104, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10021938', 'ADC', '2026-05-30'::date, -73, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10021023', 'ADC', '2027-01-21'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10024032', 'ADC', '2026-10-31'::date, 81, 31.5, 'ON_TRACK', false),
  ('PARITY-10021723', 'ADC', '2026-10-07'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10020256', 'APP+APP(S)', '2026-07-28'::date, -14, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10002472', 'ACC+ACC(S)', '2027-03-24'::date, 225, 37.83000000000001, 'ON_TRACK', false),
  ('PARITY-10009714', 'ADC', '2027-01-08'::date, 150, 79, 'WATCH', false),
  ('PARITY-10003862', 'APP+APP(S)', '2027-06-18'::date, 311, 139.32999999999998, 'WATCH', false),
  ('PARITY-10023104', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10021025', 'OCC', '2026-08-25'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10021111', 'ADC', '2026-11-12'::date, 93, 77.25, 'WATCH', false),
  ('PARITY-10022052', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023447', 'PLR', '2026-09-03'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023192', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023158', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023870', 'ADC', '2026-09-04'::date, 24, 7.75, 'ON_TRACK', false),
  ('PARITY-10023424', 'PLR', '2026-09-04'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023109', 'PLR', '2026-04-17'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10002979', 'OCC', '2026-02-10'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10020170', 'ACC+ACC(S)', '2026-12-08'::date, 119, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10022059', 'ADC', '2026-02-17'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023446', 'PLR', '2026-11-29'::date, 110, 57.25, 'WATCH', false),
  ('PARITY-10010261', 'OCC', '2026-10-13'::date, 63, 22.5, 'ON_TRACK', false),
  ('PARITY-10002977', 'OCC', '2026-04-13'::date, -120, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10015621', 'ACC+ACC(S)', '2026-07-06'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023669', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023608', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10015589', 'OCC', '2026-05-23'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10005102', 'ADC', '2026-12-09'::date, 120, 61, 'WATCH', false),
  ('PARITY-10020257', 'OCC', '2026-05-23'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10002347', 'APP+APP(S)', '2027-01-01'::date, 143, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023201', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10001911', 'APP+APP(S)', '2026-08-27'::date, 16, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023094', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10003915', 'ACC+ACC(S)', '2027-05-27'::date, 289, 109, 'ON_TRACK', false),
  ('PARITY-10024181', 'ADC', '2026-12-20'::date, 131, 67.5, 'WATCH', false),
  ('PARITY-10023095', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10002405', 'APP+APP(S)', '2027-07-30'::date, 353, 175, 'WATCH', false),
  ('PARITY-10003609', 'ACC+ACC(S)', '2027-06-26'::date, 319, 134, 'WATCH', false),
  ('PARITY-10002227', 'ACC+ACC(S)', '2027-01-10'::date, 152, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10003848', 'ACC+ACC(S)', '2027-08-31'::date, 385, 163.92000000000002, 'WATCH', false),
  ('PARITY-10003782', 'ACC+ACC(S)', '2027-06-14'::date, 307, 194.67, 'WATCH', false),
  ('PARITY-10023514', 'PLR', '2026-09-03'::date, 23, 16.25, 'WATCH', false),
  ('PARITY-10020143', 'APP+APP(S)', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10001051', 'ACC+ACC(S)', '2027-02-03'::date, 176, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10025441', 'ADC', '2027-01-01'::date, 143, 71, 'WATCH', false),
  ('PARITY-10015614', 'OCC', '2026-06-02'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10003899', 'ACC+ACC(S)', '2027-05-28'::date, 290, 66.66999999999999, 'ON_TRACK', false),
  ('PARITY-10017314', 'OCC', '2025-11-10'::date, -274, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10002046', 'ADC', '2026-11-28'::date, 109, 38, 'ON_TRACK', false),
  ('PARITY-10003965', 'ACC+ACC(S)', '2027-03-14'::date, 215, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023371', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10003911', 'OCC', '2026-09-21'::date, 41, 41.5, 'CRITICAL', false),
  ('PARITY-10023179', 'PLR', '2026-04-29'::date, -104, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023347', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10024184', 'ADC', '2026-11-11'::date, 92, 37.75, 'WATCH', false),
  ('PARITY-10001141', 'OCC', '2025-11-17'::date, -267, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10021729', 'APP+APP(S)', '2026-08-02'::date, -9, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023483', 'PLR', '2026-09-06'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10002911', 'ACC+ACC(S)', '2026-08-16'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023398', 'PLR', '2026-09-03'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023410', 'PLR', '2026-09-04'::date, 24, 27.75, 'CRITICAL', false),
  ('PARITY-10020412', 'ACC+ACC(S)', '2026-06-08'::date, -64, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10003937', 'APP+APP(S)', '2027-07-08'::date, 331, 158.5, 'WATCH', false),
  ('PARITY-10012533', 'PLR', '2026-07-10'::date, -32, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023075', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10003900', 'OCC', '2026-09-15'::date, 35, 28, 'WATCH', false),
  ('PARITY-10003821', 'PLR', '2026-06-23'::date, -49, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10003864', 'OCC', '2026-08-25'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10003218', 'APP+APP(S)', '2026-02-27'::date, -165, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023364', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10002833', 'OCC', '2025-11-10'::date, -274, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10002471', 'ADC', '2027-01-06'::date, 148, 75, 'WATCH', false),
  ('PARITY-10012191', 'ACC+ACC(S)', '2026-02-04'::date, -188, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023395', 'PLR', '2026-09-03'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10002317', 'ACC+ACC(S)', '2027-03-11'::date, 212, 39.5, 'ON_TRACK', false),
  ('PARITY-10023526', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023452', 'PLR', '2026-09-03'::date, 23, 11, 'WATCH', false),
  ('PARITY-10003838', 'ACC+ACC(S)', '2027-03-12'::date, 213, 33.25, 'ON_TRACK', false),
  ('PARITY-10022258', 'ACC+ACC(S)', '2026-12-28'::date, 139, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10004045', 'ACC+ACC(S)', '2027-03-07'::date, 208, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10002348', 'ACC+ACC(S)', '2026-12-26'::date, 137, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023379', 'PLR', '2026-09-03'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10003967', 'APP+APP(S)', '2027-01-04'::date, 146, 23.75, 'ON_TRACK', false),
  ('PARITY-10002458', 'ACC', '2026-02-08'::date, -184, 37.25, 'DEADLINE_PASSED', false),
  ('PARITY-10021365', 'ACC+ACC(S)', '2026-12-23'::date, 134, 19.080000000000013, 'ON_TRACK', false),
  ('PARITY-10002195', 'ACC+ACC(S)', '2027-09-06'::date, 391, 159.32999999999998, 'WATCH', false),
  ('PARITY-10023390', 'PLR', '2026-09-03'::date, 23, 10.25, 'WATCH', false),
  ('PARITY-10023209', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023639', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10003134', 'APP+APP(S)', '2026-04-19'::date, -114, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10003134', 'ADC', '2026-10-28'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023236', 'PLR', '2026-05-14'::date, -89, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023348', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10002574', 'APP+APP(S)', '2026-07-21'::date, -21, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023093', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10013449', 'PLR', '2026-08-07'::date, -4, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10022080', 'ADC', '2026-09-30'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10021133', 'ADC', '2026-10-15'::date, 65, 13.25, 'ON_TRACK', false),
  ('PARITY-10020147', 'ACC+ACC(S)', '2027-04-15'::date, 247, 4.6699999999999875, 'ON_TRACK', false),
  ('PARITY-10021915', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023586', 'ADC', '2027-01-28'::date, 170, 87, 'WATCH', false),
  ('PARITY-10023432', 'PLR', '2026-09-05'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023435', 'PLR', '2026-09-06'::date, 26, 53, 'CRITICAL', false),
  ('PARITY-10023143', 'PLR', '2026-04-29'::date, -104, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10025385', 'ADC', '2027-01-21'::date, 163, 79, 'WATCH', false),
  ('PARITY-10003863', 'ACC+ACC(S)', '2027-08-31'::date, 385, 185.5, 'WATCH', false),
  ('PARITY-10023873', 'ADC', '2026-09-02'::date, 22, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10021871', 'ADC', '2026-10-20'::date, 70, 43.33, 'WATCH', false),
  ('PARITY-10024279', 'ADC', '2026-07-09'::date, -33, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10024217', 'ADC', '2026-11-06'::date, 87, 27, 'ON_TRACK', false),
  ('PARITY-10003963', 'APP+APP(S)', '2027-06-25'::date, 318, 129.5, 'WATCH', false),
  ('PARITY-10002572', 'APP+APP(S)', '2026-10-31'::date, 81, 24.5, 'ON_TRACK', false),
  ('PARITY-10023216', 'PLR', '2026-04-17'::date, -116, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10010227', 'APP+APP(S)', '2027-05-06'::date, 268, 161.17000000000002, 'WATCH', false),
  ('PARITY-10023349', 'PLR', '2026-09-03'::date, 23, 23, 'WATCH', false),
  ('PARITY-10012601', 'OCC', '2025-11-17'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10004010', 'ACC+ACC(S)', '2027-08-25'::date, 379, 161, 'WATCH', false),
  ('PARITY-10002193', 'APP+APP(S)', '2026-10-28'::date, 78, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10021205', 'ADC', '2026-10-20'::date, 70, 41, 'WATCH', false),
  ('PARITY-10023538', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023690', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10018898', 'OCC', '2025-11-25'::date, -259, 5, 'DEADLINE_PASSED', false),
  ('PARITY-10023288', 'PLR', '2026-04-29'::date, -104, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023250', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10013564', 'OCC', '2026-09-10'::date, 30, 0, 'HOURS_COMPLETE', false),
  ('PARITY-10023567', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10009953', 'ADC', '2026-12-11'::date, 122, 75, 'WATCH', false),
  ('PARITY-10023430', 'PLR', '2026-09-03'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10023503', 'PLR', '2026-11-29'::date, NULL, NULL, 'NOT_STARTED', false),
  ('PARITY-10004078', 'ACC+ACC(S)', '2027-06-09'::date, 302, 84.5, 'ON_TRACK', false);

DO $check$
DECLARE
  v_total     integer;
  v_diff      integer;
  v_first     text;
BEGIN
  SELECT count(*) INTO v_total FROM ojt_parity_expected;

  CREATE TEMP TABLE ojt_parity_diff ON COMMIT DROP AS
  SELECT
    e.emp_id,
    e.unit,
    e.deadline    AS expected_deadline,   v.deadline    AS actual_deadline,
    e.days_left   AS expected_days_left,  v.days_left   AS actual_days_left,
    e.hours_left  AS expected_hours_left, v.hours_left  AS actual_hours_left,
    e.band        AS expected_band,       v.band        AS actual_band,
    e.requires_gm AS expected_gm,         v.requires_gm_extension AS actual_gm
  FROM ojt_parity_expected e
  JOIN public.v_ojt_progress v
    ON v.emp_id = e.emp_id AND v.unit = e.unit
  WHERE e.deadline    IS DISTINCT FROM v.deadline
     OR e.days_left   IS DISTINCT FROM v.days_left
     OR round(e.hours_left, 2) IS DISTINCT FROM round(v.hours_left, 2)
     OR e.band        IS DISTINCT FROM v.band
     OR e.requires_gm IS DISTINCT FROM v.requires_gm_extension;

  SELECT count(*) INTO v_diff FROM ojt_parity_diff;

  IF v_diff > 0 THEN
    SELECT string_agg(
             format('%s/%s: deadline %s vs %s, days_left %s vs %s, hours_left %s vs %s, band %s vs %s',
                    emp_id, unit,
                    expected_deadline, actual_deadline,
                    expected_days_left, actual_days_left,
                    expected_hours_left, actual_hours_left,
                    expected_band, actual_band),
             E'\n')
    INTO v_first
    FROM (SELECT * FROM ojt_parity_diff LIMIT 10) d;

    RAISE EXCEPTION E'OJT PARITY FAILED: % of % rows diverge.\n%', v_diff, v_total, v_first;
  END IF;

  RAISE NOTICE 'OJT PARITY OK (% rows)', v_total;
END
$check$;

ROLLBACK;
