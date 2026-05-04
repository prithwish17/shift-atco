import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from("employee_training_records")
    .update({ trainee_status: "training_ongoing" })
    .eq("trainee_status", "training_continue");

  if (error) {
    console.error("Error updating:", error);
  } else {
    console.log("Successfully updated training records.");
  }
}

main();
