/**
 * SupervisorSuggestions
 * ---------------------------------------------------------------------------
 * Retired: this page previously called the external roster-automation API
 * (which required separately-hosted services). It now renders the in-app
 * Availability Finder, which runs the rule engine entirely in the browser on
 * live Supabase data — no external service required.
 *
 * The /supervisor/suggestions route is kept for backwards compatibility.
 */
export { default } from "./AvailabilityFinder";
