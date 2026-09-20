/**
 * The roster as an HTML email body. Same content as the PDF and the plain-text
 * part — one table of the night's channels, one by-person summary — built from
 * the shared roster helpers so all three formats agree.
 *
 * Deliberately table-based with inline styles: that is what survives the mail
 * clients the office actually reads on.
 */
import {
  buildRosterSummary,
  channelTableRows,
  personTableRows,
  type NightAllocationState,
} from "../../src/domain/night-allocation/index.js";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string,
  );

function table(headers: string[], rows: string[][]): string {
  const head = headers
    .map(
      header =>
        `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #1e293b;font-size:13px;">${escapeHtml(header)}</th>`,
    )
    .join("");
  const body = rows
    .map(
      row =>
        `<tr>${row
          .map(
            cell =>
              `<td style="padding:5px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${escapeHtml(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin:8px 0 20px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderRosterHtml(
  state: NightAllocationState,
  note?: string,
  teams?: string[] | null,
): string {
  const summary = buildRosterSummary(state, null, teams);
  const halves = `
    <p style="margin:0 0 4px;font-size:14px;"><strong>1st Half (17:30–21:30):</strong> ${escapeHtml(
      summary.firstHalf.join(", ") || "nobody",
    )}</p>
    <p style="margin:0 0 16px;font-size:14px;"><strong>2nd Half (21:30–01:30):</strong> ${escapeHtml(
      summary.secondHalf.join(", ") || "nobody",
    )}</p>`;

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;padding:24px;border:1px solid #e2e8f0;border-radius:8px;">
    <h1 style="margin:0 0 2px;font-size:20px;">Night channel allocation</h1>
    <p style="margin:0 0 4px;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(summary.subtitle)}</p>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;">${escapeHtml(summary.dateLabel)} &middot; 13:30 to 01:30 next day</p>
    ${note ? `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(note)}</p>` : ""}
    ${halves}
    <h2 style="margin:0;font-size:16px;">By channel</h2>
    ${table(["Position", "Time", "Who", "Length"], channelTableRows(state))}
    <h2 style="margin:0;font-size:16px;">By person</h2>
    ${table(["Name", "Half", "Duties", "Total"], personTableRows(state))}
    <p style="margin:16px 0 0;color:#64748b;font-size:12px;">Prepared by Atcora</p>
  </div>
</body></html>`;
}
