/**
 * The page's own state transitions — availability, halves, TSO flags, channel
 * settings, adding and removing people, clearing the board.
 *
 * Kept out of the components and out of the rules module: these are not rules,
 * they are what the page does when a control is used, including the sentence it
 * says afterwards. Turning something off has to clear whatever depended on it,
 * and the person has to be told what was cleared.
 *
 * Pure functions: each returns the next state and the line for the status bar.
 */
import {
  MERGE_SOURCE_CHANNEL,
  MERGE_WINDOW,
  TSO_CHANNEL,
  coerceChannelWindow,
  describeAvailability,
  formatRange,
  mergeTargetFor,
  findChannel,
  formatDuration,
  formatMinutes,
  isAvailableAt,
  isFixedDuty,
  isFreeDuring,
  normalizeAvailability,
  refitChannel,
  removeDbSlot as removeSlot,
  type HalfKey,
  type NightAllocationState,
  type NightPerson,
  type PersonAvailability,
} from "@/domain/night-allocation";

export interface Applied {
  state: NightAllocationState;
  note: string;
}

const halfLabel = (half: HalfKey) => (half === "1st" ? "1st Half" : half === "2nd" ? "2nd Half" : "no half");

/** Clear every dependent selection a person has when they stop being eligible. */
function clearDependencies(state: NightAllocationState, personKey: string) {
  const startedChannels = state.channels
    .filter(channel => channel.starterKey === personKey)
    .map(channel => channel.code);
  return {
    channels: state.channels.map(channel =>
      channel.starterKey === personKey ? { ...channel, starterKey: null } : channel,
    ),
    startedChannels,
  };
}

export function setAvailability(state: NightAllocationState, personKey: string, available: boolean): Applied {
  const person = state.people.find(entry => entry.key === personKey);
  if (!person) return { state, note: "" };

  if (available) {
    return {
      state: { ...state, people: state.people.map(entry => (entry.key === personKey ? { ...entry, available } : entry)) },
      note: `${person.name} is available tonight.`,
    };
  }

  const { channels, startedChannels } = clearDependencies(state, personKey);
  const mine = state.duties.filter(duty => duty.personKey === personKey);
  const dutyCount = mine.length;
  const slotCount = mine.filter(isFixedDuty).length;
  const clearedHalf = person.half ? halfLabel(person.half) : null;

  return {
    state: {
      ...state,
      channels,
      people: state.people.map(entry =>
        entry.key === personKey ? { ...entry, available: false, half: null } : entry,
      ),
    },
    note:
      `${person.name} marked not available.` +
      (clearedHalf ? ` Removed from ${clearedHalf}.` : "") +
      (startedChannels.length ? ` Pick a new starter for ${startedChannels.join(", ")}.` : "") +
      (dutyCount ? ` Reassign their ${dutyCount} ${dutyCount === 1 ? "duty" : "duties"}.` : "") +
      (slotCount
        ? ` ${slotCount === 1 ? "A DB slot needs" : `${slotCount} DB slots need`} another instructor.`
        : ""),
  };
}

/**
 * The part of the night someone is around for — only between some times, or
 * away between some — or `null` for the whole night.
 *
 * A starter who is away when their position opens can't open it, so that goes
 * the way it does when someone is marked not available. Their duties stay put:
 * the ones that now fall in time they're away show in the checks panel, and the
 * next generate plans around them.
 */
export function setPersonAvailability(
  state: NightAllocationState,
  personKey: string,
  availability: PersonAvailability | null,
): Applied {
  const person = state.people.find(entry => entry.key === personKey);
  if (!person) return { state, note: "" };

  const normalized = normalizeAvailability(availability);
  const updated: NightPerson = { ...person, availability: normalized };
  const lostStarts = state.channels
    .filter(channel => channel.starterKey === personKey && !isAvailableAt(updated, channel.openAt))
    .map(channel => channel.code);
  const clashing = person.available
    ? state.duties.filter(duty => duty.personKey === personKey && !isFreeDuring(updated, duty.startMin, duty.endMin))
    : [];

  const summary = describeAvailability(normalized);
  return {
    state: {
      ...state,
      channels: state.channels.map(channel =>
        lostStarts.includes(channel.code) && channel.starterKey === personKey ? { ...channel, starterKey: null } : channel,
      ),
      people: state.people.map(entry => (entry.key === personKey ? updated : entry)),
    },
    note:
      (normalized
        ? `${person.name}: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}.`
        : `${person.name} is around all night.`) +
      (lostStarts.length ? ` They're away when ${lostStarts.join(", ")} opens — pick a new starter.` : "") +
      (clashing.length
        ? ` ${clashing.length === 1 ? "One of their duties falls" : `${clashing.length} of their duties fall`} ` +
          `in that time — generate again, or reassign ${clashing.length === 1 ? "it" : "them"}.`
        : ""),
  };
}

/** Take a DB slot off the board — the DB panel's remove button. */
export function removeDbSlot(state: NightAllocationState, slotId: string): Applied {
  return removeSlot(state, slotId);
}

/**
 * Take every duty off the board — the board's Clear button — and nothing else.
 * The crew, halves, times, positions, starters and the merge are the night's
 * settings, and clearing those is Reset's job. DB slots stay for the reason
 * they survive a generate: they were put down on purpose, and nothing takes
 * one away as a side effect.
 */
export function clearBoard(state: NightAllocationState): Applied {
  const slots = state.duties.filter(isFixedDuty);
  const cleared = state.duties.length - slots.length;
  if (!cleared) return { state, note: "" };

  return {
    state: { ...state, duties: slots },
    note:
      `Cleared ${cleared} ${cleared === 1 ? "duty" : "duties"} from the board` +
      (slots.length ? `, leaving ${slots.length === 1 ? "the DB slot" : `the ${slots.length} DB slots`}` : "") +
      "." +
      (state.savedAt ? " The saved version is unchanged until you save." : ""),
  };
}

export function setHalf(state: NightAllocationState, personKey: string, half: HalfKey): Applied {
  const person = state.people.find(entry => entry.key === personKey);
  if (!person || !person.available || person.half === half) return { state, note: "" };

  return {
    state: { ...state, people: state.people.map(entry => (entry.key === personKey ? { ...entry, half } : entry)) },
    note: `${person.name} set to ${halfLabel(half)}.`,
  };
}

export function toggleTso(state: NightAllocationState, personKey: string): Applied {
  const person = state.people.find(entry => entry.key === personKey);
  if (!person) return { state, note: "" };

  const canTakeTso = !person.canTakeTso;
  let channels = state.channels;
  let note = `${person.name} ${canTakeTso ? "can" : "can't"} take TSO.`;

  if (!canTakeTso) {
    const tso = findChannel(state, TSO_CHANNEL);
    if (tso?.starterKey === personKey) {
      channels = state.channels.map(channel =>
        channel.code === TSO_CHANNEL ? { ...channel, starterKey: null } : channel,
      );
      note += " Pick a new starter for TSO.";
    }
    const held = state.duties.filter(duty => duty.personKey === personKey && duty.channelCode === TSO_CHANNEL).length;
    if (held) note += ` Change their ${held} TSO ${held === 1 ? "duty" : "duties"}.`;
  }

  return {
    state: {
      ...state,
      channels,
      people: state.people.map(entry => (entry.key === personKey ? { ...entry, canTakeTso } : entry)),
    },
    note,
  };
}

/**
 * Add someone the roster puts on nights but who is not marked on one of the
 * tower units. They arrive with their real identity, so their TSO
 * qualification and employee code come with them.
 */
export function addShiftPerson(
  state: NightAllocationState,
  candidate: { key: string; userId: string | null; name: string; code: string; role: string; canTakeTso: boolean },
): Applied {
  if (state.people.some(person => person.key === candidate.key)) {
    return { state, note: `${candidate.name} is already on tonight's list.` };
  }

  const person: NightPerson = {
    key: candidate.key,
    userId: candidate.userId,
    name: candidate.name,
    code: candidate.code,
    role: candidate.role,
    available: true,
    canTakeTso: candidate.canTakeTso,
    half: null,
    manual: true,
    colorIndex: state.people.reduce((max, entry) => Math.max(max, entry.colorIndex), -1) + 1,
  };

  return {
    state: { ...state, people: [...state.people, person] },
    note: `${candidate.name} added from tonight's shift.`,
  };
}

/** Someone who is not on the roster at all — typed in by hand. */
export function addPerson(state: NightAllocationState, name: string): Applied {
  const trimmed = name.trim();
  if (!trimmed) return { state, note: "" };

  const code = trimmed
    .split(/\s+/)
    .map(word => word[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();

  const person: NightPerson = {
    key: `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    userId: null,
    name: trimmed,
    code,
    role: "Employee",
    available: true,
    canTakeTso: false,
    half: null,
    manual: true,
    colorIndex: state.people.reduce((max, entry) => Math.max(max, entry.colorIndex), -1) + 1,
  };

  return {
    state: { ...state, people: [...state.people, person] },
    note: `${trimmed} added to tonight's shift.`,
  };
}

export function removePerson(state: NightAllocationState, personKey: string): Applied {
  const person = state.people.find(entry => entry.key === personKey);
  if (!person) return { state, note: "" };

  const { channels } = clearDependencies(state, personKey);
  const dutyCount = state.duties.filter(duty => duty.personKey === personKey).length;

  return {
    state: {
      ...state,
      channels,
      people: state.people.filter(entry => entry.key !== personKey),
      // Their duties stay on the board rather than vanishing: an empty stretch
      // is a problem the checks panel must show, not one the page hides.
      duties: state.duties,
    },
    note:
      `${person.name} removed from tonight's shift.` +
      (dutyCount ? ` Reassign their ${dutyCount} ${dutyCount === 1 ? "duty" : "duties"}.` : ""),
  };
}

export function setChannelInUse(state: NightAllocationState, code: string, inUse: boolean): Applied {
  const channels = state.channels.map(channel => (channel.code === code ? { ...channel, inUse } : channel));

  if (inUse) {
    return { state: { ...state, channels }, note: `${code} back in use. Pick who starts it, then generate again.` };
  }

  const dropped = state.duties.filter(duty => duty.channelCode === code).length;
  const droppedSlots = state.duties.filter(duty => duty.channelCode === code && isFixedDuty(duty)).length;
  // A position folded into this one has nothing left to fold into. Left set,
  // the merge would be an error the switch could no longer turn off.
  const unmerged = state.channels.filter(channel => channel.mergedInto === code).map(channel => channel.code);
  return {
    state: {
      ...state,
      channels: channels.map(channel =>
        channel.code === code
          ? { ...channel, starterKey: null }
          : channel.mergedInto === code
            ? { ...channel, mergedInto: null }
            : channel,
      ),
      duties: state.duties.filter(duty => duty.channelCode !== code),
    },
    note:
      `${code} not needed tonight.` +
      (dropped ? ` Removed its ${dropped} ${dropped === 1 ? "duty" : "duties"}.` : "") +
      (droppedSlots
        ? ` ${droppedSlots === 1 ? "That included its DB slot" : `That included its ${droppedSlots} DB slots`}.`
        : "") +
      (unmerged.length
        ? ` ${unmerged.join(", ")} no longer merged into it, so ${unmerged.length === 1 ? "it needs" : "they need"} ` +
          `cover of ${unmerged.length === 1 ? "its" : "their"} own ${formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])}.`
        : ""),
  };
}

/** Move one end of a channel's window and re-fit its duties to the new one. */
export function setChannelWindow(
  state: NightAllocationState,
  code: string,
  value: number,
  moved: "open" | "close",
): Applied {
  const channel = findChannel(state, code);
  if (!channel) return { state, note: "" };

  const { openAt, closeAt } = coerceChannelWindow(
    moved === "open" ? value : channel.openAt,
    moved === "close" ? value : channel.closeAt,
    moved,
  );
  const result = refitChannel(state, code, openAt, closeAt);
  return { state: result.state, note: result.note };
}

export function setChannelStarter(state: NightAllocationState, code: string, starterKey: string | null): Applied {
  const channel = findChannel(state, code);
  if (!channel) return { state, note: "" };
  const person = starterKey ? state.people.find(entry => entry.key === starterKey) : null;

  return {
    state: {
      ...state,
      channels: state.channels.map(entry => (entry.code === code ? { ...entry, starterKey } : entry)),
    },
    note: person
      ? `${person.name} starts ${code} at ${formatMinutes(channel.openAt)}.`
      : `No starter chosen for ${code}.`,
  };
}

/**
 * What the merge switch shows.
 *
 * Read from the stored setting rather than from `activeMerge`, which ignores a
 * merge that no longer holds (its SMC unticked, say). Otherwise the switch
 * would sit off and disabled while the checks panel reports the merge as a
 * problem, and nothing on the page could clear it.
 */
export function mergeToggle(state: NightAllocationState): {
  on: boolean;
  enabled: boolean;
  targetCode: string | null;
} {
  const stored = findChannel(state, MERGE_SOURCE_CHANNEL)?.mergedInto ?? null;
  const available = mergeTargetFor(state);
  return { on: !!stored, enabled: !!stored || !!available, targetCode: stored ?? available };
}

/**
 * Fold CLD into the SMC in use for the merge window, or separate them again.
 *
 * The generator can reach for this itself as a last resort; this is the manual
 * switch for a WSO who already knows the 1st Half is too thin.
 */
export function setMergeSmcCld(state: NightAllocationState, merged: boolean): Applied {
  const target = merged ? mergeTargetFor(state) : null;
  if (merged && !target) {
    return {
      state,
      note: `No SMC is in use and open across ${formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])}, so there is nothing to merge ${MERGE_SOURCE_CHANNEL} into.`,
    };
  }
  // Merging drops CLD's own duties in the window, and a DB slot is not the
  // merge's to drop — it was put there on purpose.
  const slotInWindow = state.duties.find(
    duty =>
      isFixedDuty(duty) &&
      duty.channelCode === MERGE_SOURCE_CHANNEL &&
      duty.startMin < MERGE_WINDOW[1] &&
      duty.endMin > MERGE_WINDOW[0],
  );
  if (merged && slotInWindow) {
    return {
      state,
      note:
        `${MERGE_SOURCE_CHANNEL} has a DB slot ${formatRange(slotInWindow.startMin, slotInWindow.endMin)}, so it ` +
        `can't be merged ${formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])}. Move or remove the slot first.`,
    };
  }

  const channels = state.channels.map(channel =>
    channel.code === MERGE_SOURCE_CHANNEL ? { ...channel, mergedInto: target } : channel,
  );

  if (!merged) {
    return {
      state: { ...state, channels },
      note: `${MERGE_SOURCE_CHANNEL} is a position of its own again. It needs its own cover ${formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])}.`,
    };
  }

  // Duties on the folded stretch would now conflict, so they go with it.
  const dropped = state.duties.filter(
    duty =>
      duty.channelCode === MERGE_SOURCE_CHANNEL &&
      duty.startMin < MERGE_WINDOW[1] &&
      duty.endMin > MERGE_WINDOW[0],
  ).length;

  return {
    state: {
      ...state,
      channels,
      duties: state.duties.filter(
        duty =>
          !(
            duty.channelCode === MERGE_SOURCE_CHANNEL &&
            duty.startMin < MERGE_WINDOW[1] &&
            duty.endMin > MERGE_WINDOW[0]
          ),
      ),
    },
    note:
      `${MERGE_SOURCE_CHANNEL} merged into ${target} ${formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])} — whoever holds ${target} holds both.` +
      (dropped ? ` Removed ${dropped} ${dropped === 1 ? "duty" : "duties"} from that stretch.` : ""),
  };
}

export function setDutyLengthPreference(state: NightAllocationState, minutes: number): Applied {
  return {
    state: { ...state, dutyLengthPref: minutes },
    note: minutes
      ? `Usual duty length set to ${formatDuration(minutes)}. Generate again to apply it.`
      : "Usual duty length set to Auto. Generate again to apply it.",
  };
}
