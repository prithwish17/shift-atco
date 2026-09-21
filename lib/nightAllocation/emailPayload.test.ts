import { describe, expect, it } from "vitest";
import { attachmentKind, parseRecipients, vetAttachments, vetRecipients } from "./emailPayload.js";

const base64 = (bytes: number[] | string) =>
  (typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes)).toString("base64");

const PDF = base64("%PDF-1.3\n%roster\n");
const PNG = base64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HTML = base64("<html><body>Your password has expired</body></html>");

describe("recipients", () => {
  it("normalises, de-duplicates and drops what isn't an address", () => {
    expect(parseRecipients([" Crew@Atcora.in ", "crew@atcora.in", "not-an-address", 42, null])).toEqual([
      "crew@atcora.in",
    ]);
    expect(parseRecipients("crew@atcora.in")).toEqual([]);
  });

  it("lets through only addresses that belong to an account", () => {
    const known = new Set(["crew@atcora.in", "wso@atcora.in"]);
    expect(vetRecipients(["crew@atcora.in", "stranger@example.com"], known)).toEqual({
      allowed: ["crew@atcora.in"],
      rejected: ["stranger@example.com"],
    });
  });
});

describe("attachments", () => {
  it("recognises the page's PDF and PNG by their contents", () => {
    expect(attachmentKind(PDF)).toBe("pdf");
    expect(attachmentKind(PNG)).toBe("png");
  });

  it("recognises nothing else, whatever it is called", () => {
    expect(attachmentKind(HTML)).toBeNull();
    expect(attachmentKind("not base64!")).toBeNull();
    expect(attachmentKind("")).toBeNull();
  });

  it("names accepted files itself instead of trusting the browser", () => {
    const { attachments, error } = vetAttachments(
      [
        { filename: "invoice.html", content: PDF },
        { filename: "../../etc/passwd", content: PNG },
      ],
      "2026-09-17",
    );
    expect(error).toBeNull();
    expect(attachments.map(file => file.filename)).toEqual([
      "night-allocation-2026-09-17.pdf",
      "night-allocation-2026-09-17.png",
    ]);
  });

  it("refuses anything that isn't the roster PDF or board image", () => {
    expect(vetAttachments([{ filename: "roster.pdf", content: HTML }], "2026-09-17")).toEqual({
      attachments: [],
      error: "Only the roster PDF and the board image can be attached.",
    });
  });

  it("refuses two of the same kind", () => {
    expect(vetAttachments([{ content: PDF }, { content: PDF }], "2026-09-17").error).toMatch(/once each/);
  });

  it("treats a missing or empty list as no attachments", () => {
    expect(vetAttachments(undefined, "2026-09-17")).toEqual({ attachments: [], error: null });
    expect(vetAttachments([{ content: "" }], "2026-09-17")).toEqual({ attachments: [], error: null });
  });
});
