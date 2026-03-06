import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseServiceRoleKey } from "./config.js";

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

export async function checkIntegrity() {
    const { data, error } = await supabase.from("profiles").select("id").limit(1);
    if (error) {
        if (
            error.code === "42P01" ||
            (error.message && error.message.includes("relation") && error.message.includes("does not exist"))
        ) {
            console.warn("Table profiles does not exist. Migrations might be missing.");
            return false;
        }
        throw new Error(`Integrity check failed: ${error.message} (code: ${error.code})`);
    }
    return true;
}
