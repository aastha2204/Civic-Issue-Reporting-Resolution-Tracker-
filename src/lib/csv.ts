/**
 * src/lib/csv.ts
 * Civic Issue Tracker - Safe RFC 4180 CSV Export Utility
 *
 * Security Features:
 * 1. Spreadsheet Formula Injection Protection:
 *    Applies strictly to values of type string. If a string starts with
 *    '=', '+', '-', '@', '\t', or '\r', it is prefixed with a single quote (').
 *    Numbers (e.g., negative hours_remaining like -3.2, counts, lat/lng) remain
 *    plain numeric values without quote prefixes.
 * 2. RFC 4180 Escaping:
 *    Any cell containing quotes, commas, newlines, or a leading single-quote is
 *    enclosed in double quotes, with internal quotes doubled ("").
 * 3. UTF-8 Byte Order Mark (BOM):
 *    Prepends '\uFEFF' to guarantee Microsoft Excel renders Unicode characters
 *    (e.g., Hindi text, emojis, accented names) correctly.
 */

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T, index: number) => string | number | boolean | null | undefined;
}

/**
 * Sanitizes a single cell value for CSV serialization with formula injection defense.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  // Plain numbers: output directly without quote prefixing
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  let str = String(value);

  // Formula injection defense: ONLY applies to values of type string
  // If a string starts with =, +, -, @, tab, or carriage return, prefix with single quote
  const dangerousPrefixRegex = /^[=+\-@\t\r]/;
  const isDangerousString = typeof value === "string" && dangerousPrefixRegex.test(str);

  if (isDangerousString) {
    str = `'${str}`;
  }

  // RFC 4180 escaping: wrap in quotes if contains comma, quote, newline, or if formula-prefixed
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r") ||
    isDangerousString
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Converts a typed array of rows into an RFC 4180 compliant CSV string with UTF-8 BOM.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const headerLine = columns
    .map((col) => escapeCsvCell(col.header))
    .join(",");

  const rowLines = rows.map((row, index) =>
    columns
      .map((col) => escapeCsvCell(col.accessor(row, index)))
      .join(",")
  );

  // UTF-8 BOM (\uFEFF) ensures Excel opens UTF-8 encoded files correctly
  const BOM = "\uFEFF";
  return BOM + [headerLine, ...rowLines].join("\r\n");
}

/**
 * Browser-only helper to trigger direct download of a generated CSV file.
 */
export function downloadCsv(filename: string, csvContent: string): void {
  if (typeof window === "undefined") return;

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
