/**
 * Night Channel Allocation — the shared, framework-free rule set.
 *
 * The browser, the serverless API and the unit tests all import from here, so
 * a client-side check and a server-side validation can never disagree about
 * what a legal night looks like. Nothing in this folder may import React,
 * Supabase, or anything else with a runtime of its own.
 *
 * Documentation: docs/night-channel-allocation.md
 */
export * from "./constants.js";
export * from "./types.js";
export * from "./time.js";
export * from "./rules.js";
export * from "./solver.js";
export * from "./editing.js";
export * from "./availability.js";
export * from "./db-slots.js";
export * from "./roster-text.js";
export { makeDutyId } from "./ids.js";
