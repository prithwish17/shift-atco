/**
 * What the share sheet may offer for the night on screen, and what it says
 * about it. Pure, so the rules are testable apart from the sheet.
 *
 * Email is held to more than the rest. Its body is rendered on the server from
 * the saved night while its attachments are drawn here from the board on
 * screen, so it is offered only when those are the same thing: saved, with no
 * changes since.
 */
import { isPlanned, type NightAllocationState } from "@/domain/night-allocation";

export interface ShareGate {
  /** Why nothing can be shared yet, or null. */
  blocked: string | null;
  /** A caution shown above the share actions, or null. */
  notice: string | null;
  /** Why email is unavailable while the rest is not, or null. */
  emailBlocked: string | null;
}

export function shareGate(
  state: NightAllocationState,
  { dirty, errorCount }: { dirty: boolean; errorCount: number },
): ShareGate {
  // DB slots entered ahead of the plan are not a roster yet.
  if (!isPlanned(state)) {
    return {
      blocked: "Nothing is allocated yet. Generate a plan or add duties before sharing.",
      notice: null,
      emailBlocked: null,
    };
  }
  if (errorCount) {
    return {
      blocked:
        `${errorCount} ${errorCount === 1 ? "problem" : "problems"} still to fix in Checks. Sharing a roster ` +
        "with an uncovered position would send the shift the wrong plan.",
      notice: null,
      emailBlocked: null,
    };
  }
  if (state.version === 0) {
    return {
      blocked: null,
      notice:
        "This night hasn't been saved yet, so you'd be sharing your own unsaved copy. Save first if the shift " +
        "should see the same thing.",
      emailBlocked: "Save the night first. Email sends the saved roster.",
    };
  }
  if (dirty) {
    return {
      blocked: null,
      notice:
        "You have unsaved changes, so you'd be sharing your own copy rather than the saved one. Save first if " +
        "the shift should see the same thing.",
      emailBlocked: "Save your changes first. Email sends the saved roster, and its attachments must match it.",
    };
  }
  return { blocked: null, notice: null, emailBlocked: null };
}
