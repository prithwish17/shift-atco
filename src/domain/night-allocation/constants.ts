/**
 * Night Channel Allocation — fixed quantities of the night.
 *
 * Every time in this module is "minutes from 13:30", never a clock string and
 * never a timestamp. 0 is 13:30 on the night's own date, 720 is 01:30 the next
 * morning. Clock times are produced only at the edges, by `time.ts`.
 *
 * This file, and every other file in this folder, must stay free of framework
 * imports: the browser, the serverless API and the unit tests all load it.
 */

/** Clock minute the night window opens at (13:30). */
export const NIGHT_START_MIN = 13 * 60 + 30;

/** Length of the night window: 13:30 → 01:30 next day. */
export const NIGHT_SPAN_MIN = 720;

/** Every boundary in the module sits on this grid. */
export const SLOT_MIN = 15;

/** A duty may not be shorter than this. */
export const MIN_DUTY_MIN = 30;

/** A duty may not be longer than this, on every position but the exceptions. */
export const MAX_DUTY_MIN = 120;

/**
 * The duty lengths the office prefers: 1h, 1h 30m and 2h.
 *
 * A preference, not a rule. The generator reaches for these first, keeps every
 * duty to at least `PREFERRED_MIN_DUTY_MIN` wherever the night allows, and
 * uses 30 or 45 minutes only when nothing longer gives a continuous plan.
 * `MIN_DUTY_MIN` is still the hard floor.
 */
export const PREFERRED_DUTY_LENGTHS: readonly number[] = [60, 90, 120];

/** Shortest duty the generator uses when it has any choice. */
export const PREFERRED_MIN_DUTY_MIN = 60;


/** A person needs at least this much rest between two duties. */
export const MIN_BREAK_MIN = 30;

/** 1st Half: 17:30–21:30, as offsets from 13:30. */
export const FIRST_HALF: readonly [number, number] = [240, 480];

/** 2nd Half: 21:30–01:30, as offsets from 13:30. Continuous across midnight. */
export const SECOND_HALF: readonly [number, number] = [480, 720];

/** Midnight, as an offset — the board marks it. */
export const MIDNIGHT_MIN = 630;

/**
 * The positions covered at night, in board order. Data-driven on purpose: a
 * position can be added or renamed here and in the `channel_code` check
 * constraint without touching the solver, the board or the API.
 *
 * AIMS is deliberately not a channel.
 */
export const DEFAULT_CHANNEL_CODES = ["TWR", "SMC-S", "SMC-N", "CLD", "TSO"] as const;

export type ChannelCode = (typeof DEFAULT_CHANNEL_CODES)[number];

/**
 * The one channel that needs a qualification. Kept as a constant rather than
 * spread through the rules so a second restricted position is a one-line change
 * to `RESTRICTED_CHANNELS`.
 */
export const TSO_CHANNEL = "TSO";

/** Channels only people flagged `canTakeTso` may hold. */
export const RESTRICTED_CHANNELS: readonly string[] = [TSO_CHANNEL];
/**
 * Positions with no maximum duty length.
 *
 * TSO is not a control position in the way the others are, so the two-hour cap
 * does not apply to it: one person may hold it for as long as the night needs,
 * up to the whole window. The 30-minute minimum, the 30-minute break between a
 * person's duties and every other rule still apply.
 */
export const UNCAPPED_DUTY_CHANNELS: readonly string[] = [TSO_CHANNEL];


/** Channel preferred by 2nd Half people, per the office's working preference. */
export const SECOND_HALF_PREFERRED_CHANNEL = "CLD";

/**
 * The one position a 1st Half person may hold inside the 2nd Half.
 *
 * The halves are otherwise exclusive. TSO is the exception, and only as a last
 * resort: the generator plans the night without the crossover first and reaches
 * for it only when there is no continuous plan otherwise. A crossover that is
 * present is always reported as a suggestion, so nobody has to guess whether it
 * was deliberate.
 */
export const CROSS_HALF_CHANNEL = TSO_CHANNEL;

/**
 * Merging CLD into SMC.
 *
 * On a thin 1st Half the two are worked as one position for part of the
 * evening: one person, one duty, exactly as the shift roster already writes
 * combined units like `UKN+UKW`. CLD is not separately covered during the
 * window — it is folded into SMC — so there are no duplicate duties and no
 * slivers when the SMC handover does not land on the boundary.
 *
 * The window ends at 21:30, where the 2nd Half arrives and the positions split
 * again.
 */
export const MERGE_WINDOW: readonly [number, number] = [330, 480];

/** The position that folds away during the merge. */
export const MERGE_SOURCE_CHANNEL = "CLD";

/**
 * The positions it may fold into, in preference order. The roster spells the
 * single night SMC differently between team tabs, and on a night running both
 * SMC-S and SMC-N the southern one takes CLD.
 */
export const MERGE_TARGET_CHANNELS: readonly string[] = ["SMC", "SMC-S", "SMC-N"];

/**
 * Most attachment bytes one roster email may carry.
 *
 * Attachments travel base64-encoded in the request body, which adds a third,
 * and Vercel refuses a body over 4.5 MB before the function ever runs — with a
 * bare 413 the page could only report as a generic failure. 3 MB encodes to
 * about 4 MB, leaving room for the rest of the request.
 */
export const MAX_EMAIL_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/** `duty_length_pref` values offered in the UI. 0 means "fitted to staffing". */
export const DUTY_LENGTH_CHOICES = [0, 30, 45, 60, 75, 90, 105, 120] as const;

/** What "Auto" aims for before staffing is taken into account. */
export const DEFAULT_TARGET_DUTY_MIN = 90;
