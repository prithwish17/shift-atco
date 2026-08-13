import { Badge } from "@/components/ui/badge";
import {
  personMatchesSearch,
  type GridSection,
  type RosterGridModel,
  type RosterPerson,
} from "@/lib/rosterGrid";
import { cn } from "@/lib/utils";

/**
 * RosterGrid — the published roster as the matrix it actually is.
 *
 * Rows are units, columns are rating positions, exactly as the sheet lays them
 * out.  Two things it does that the spreadsheet cannot:
 *
 *   · the unit column and the column headers stay pinned while you scroll,
 *     where the sheet loses both;
 *   · a search highlights matches in place rather than filtering rows away —
 *     filtering a matrix destroys the adjacency that gives it meaning.
 */

interface Props {
  model: RosterGridModel;
  search?: string;
}

/** Sticky layering: header row over body, unit column over cells, corner over both. */
const STICKY_HEAD = "sticky top-0 z-20 bg-muted";
const STICKY_UNIT = "sticky left-0 z-10 bg-background";
const STICKY_CORNER = "sticky left-0 top-0 z-30 bg-muted";

function PersonCell({ person, search }: { person: RosterPerson; search?: string }) {
  const isMatch = search ? personMatchesSearch(person, search) : false;

  // Grade and rating are deliberately not rendered — the grid reads as names.
  // They stay on the model (they drive the SAR flag, search and the rating
  // checks) and are one hover away, which also explains why a search for a
  // rating highlights a cell showing only a name.
  const detail = [person.grade, person.rating].filter(Boolean).join(" · ");

  return (
    <div
      title={detail || undefined}
      className={cn(
        "rounded px-1 py-0.5",
        isMatch && "bg-amber-200 ring-1 ring-amber-500 dark:bg-amber-500/30 dark:ring-amber-400",
      )}
    >
      <p className="font-medium leading-tight">{person.name || person.raw}</p>
      <div className="flex flex-wrap gap-1">
        {person.timeWindow && (
          <span className="font-mono text-[10px] text-muted-foreground">{person.timeWindow}</span>
        )}
        {person.flags.map((flag) => (
          <Badge key={flag} variant="outline" className="h-3.5 px-1 text-[9px] font-semibold">
            {flag}
          </Badge>
        ))}
        {person.isOffTeam && (
          <Badge variant="secondary" className="h-3.5 px-1 text-[9px] font-semibold">
            {person.team}
          </Badge>
        )}
      </div>
    </div>
  );
}

function SectionTable({ section, search }: { section: GridSection; search?: string }) {
  return (
    <div>
      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {section.title}
      </p>

      {/* Only the table scrolls sideways — the page itself never does. */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th
                scope="col"
                className={cn(
                  STICKY_CORNER,
                  "min-w-[6.5rem] border-b border-r px-2 py-1.5 text-left font-semibold",
                )}
              >
                Unit
              </th>
              {section.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(STICKY_HEAD, "min-w-[9rem] border-b border-r px-2 py-1.5 text-left font-semibold last:border-r-0")}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {section.rows.map((row) => (
              <tr key={row.key} className="even:bg-muted/30">
                <th
                  scope="row"
                  className={cn(
                    STICKY_UNIT,
                    "border-b border-r px-2 py-1.5 text-left align-top font-semibold",
                    // The zebra stripe has to be repeated here: a sticky cell
                    // paints its own background and would otherwise show the
                    // page through it while scrolling.
                    "[tr:nth-child(even)>&]:bg-muted/30",
                  )}
                >
                  {row.label}
                </th>

                {row.cells.map((cell, index) => {
                  // A slot swallowed by a span from the row above emits no
                  // <td> at all — that is what makes rowSpan lay out correctly.
                  if (cell.covered) return null;

                  const spans = cell.rowSpan > 1;

                  return (
                    <td
                      key={section.columns[index].key}
                      rowSpan={cell.rowSpan}
                      className={cn(
                        "border-b border-r px-1.5 py-1 align-top last:border-r-0",
                        // A controller covering two sectors is the sheet's
                        // two-sector/three-controller shape; tint it so the
                        // span reads as deliberate rather than as a gap.
                        spans && "bg-primary/5 align-middle",
                      )}
                    >
                      {cell.people.length === 0 ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        <div className="space-y-1">
                          {cell.people.map((person) => (
                            <PersonCell key={person.key} person={person} search={search} />
                          ))}
                          {spans && (
                            <p className="text-[9px] font-medium uppercase tracking-wide text-primary/70">
                              covers {cell.covers?.join(" + ") ?? `${cell.rowSpan} sectors`}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeopleBand({
  title,
  people,
  search,
  tone,
}: {
  title: string;
  people: RosterPerson[];
  search?: string;
  tone?: string;
}) {
  if (people.length === 0) return null;

  return (
    <div className={cn("rounded-lg border px-2 py-1.5", tone)}>
      <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {people.length}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {people.map((person) => (
          <PersonCell key={person.key} person={person} search={search} />
        ))}
      </div>
    </div>
  );
}

/**
 * TRAINING and REMARKS. Rendered verbatim — these lines carry duty timelines,
 * UTC times and emoji separators that must survive exactly as written.
 */
function NoteBand({
  label,
  lines,
  search,
}: {
  label: string;
  lines: string[];
  search?: string;
}) {
  if (lines.length === 0) return null;
  const term = search?.trim().toLowerCase();

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="space-y-0.5">
        {lines.map((line, index) => (
          <li
            key={`${index}-${line}`}
            className={cn(
              "whitespace-pre-wrap break-words text-xs leading-snug",
              term && line.toLowerCase().includes(term) && "bg-amber-200 dark:bg-amber-500/30",
            )}
          >
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RosterGrid({ model, search }: Props) {
  if (model.total === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        No roster published for this shift
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <PeopleBand
        title="Supervision"
        people={model.supervision}
        search={search}
        tone="bg-muted/40"
      />

      {model.sections.map((section) => (
        <SectionTable key={section.key} section={section} search={search} />
      ))}

      {model.chips.map((bucket) => (
        <PeopleBand
          key={bucket.key}
          title={bucket.label}
          people={bucket.people}
          search={search}
          tone={
            bucket.key === "SAR"
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
              : "border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30"
          }
        />
      ))}

      {model.special.map((bucket) => (
        <PeopleBand
          key={bucket.key}
          title={bucket.label}
          people={bucket.people}
          search={search}
        />
      ))}

      {model.notes.map((bucket) => (
        <NoteBand key={bucket.key} label={bucket.label} lines={bucket.lines} search={search} />
      ))}

      {/* Never silently dropped: a position the grid does not recognise still
          has to reach the screen, or the roster is quietly wrong. */}
      <PeopleBand
        title="Not placed on the grid"
        people={model.unplaced}
        search={search}
        tone="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
      />
    </div>
  );
}
