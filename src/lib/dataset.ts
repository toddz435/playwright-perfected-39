// Data-Driven Testing data model + a parser for pasted/uploaded spreadsheet data. Pure +
// client-safe. A dataset's columns become the per-row variable names; each row is a
// {columnName: value} map that drives one test run.
import { locatorLabel } from "@/lib/locator";

export type DatasetData = { columns: string[]; rows: Record<string, string>[] };

// Column names become {{variable}} names, so normalize to the interpolation-safe charset
// ([\w.-]); spaces/punctuation → "_". Empty → col1, col2, … Keeps names usable as {{col}}.
export function normalizeColumn(name: string, index: number): string {
  const cleaned = name
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || `col${index + 1}`;
}

// De-dups a list of column names by appending _2, _3, … to repeats, looping the suffix until
// truly unique (so an auto-suffix can't collide with another literal name). Preserves order
// and the first occurrence of each base name. Used by the parameterize-from-recording wizard.
export function uniquifyColumns(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((base) => {
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}_${n++}`;
    used.add(name);
    return name;
  });
}

// A loose shape for a recorded browser step — just the fields the wizard reads. The canonical
// step type isn't centralized, so keep this structural and tolerant.
type StepLike = {
  action?: string;
  locator?: unknown;
  target?: string;
  value?: string;
};

// Suggests a {{column}} name for a recorded step's value, derived from the field it targets
// (role name / label / placeholder / testid), falling back to the action ("url" for navigations)
// or a positional col<n>. Names are normalized to the interpolation-safe charset.
export function suggestColumnForStep(step: StepLike, index: number): string {
  const loc = step?.locator as any;
  let hint = "";
  if (loc && typeof loc === "object") {
    if (loc.by === "role" && loc.name) hint = String(loc.name);
    else if (loc.value && ["label", "placeholder", "testid", "text"].includes(loc.by))
      hint = String(loc.value);
    else hint = locatorLabel(loc); // css/xpath → the raw selector, normalized below
  }
  if (!hint && (step?.action === "goto" || step?.action === "expect_url_contains")) hint = "url";
  return normalizeColumn(hint, index);
}

// Normalizes a REST/JSON payload into the same {columns, rows} shape as a spreadsheet. Locates
// the array of record objects across the common shapes — a bare array (Supabase REST), Airtable's
// `{records:[{fields:{…}}]}`, or a `{data|rows|results|items|values:[…]}` wrapper — then unions the
// keys (first-seen order) into normalized, unique column names. Cell values that are objects/arrays
// are JSON-stringified; null/undefined → "". Pure + client-safe.
export function jsonToRows(data: unknown): DatasetData {
  let arr: any[] | null = null;
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === "object") {
    const o = data as any;
    if (Array.isArray(o.records))
      // Airtable: unwrap each record's `fields` (fall back to the record itself if absent).
      arr = o.records.map((r: any) => (r && typeof r === "object" && r.fields ? r.fields : r));
    else
      for (const k of ["data", "rows", "results", "items", "values"])
        if (Array.isArray(o[k])) {
          arr = o[k];
          break;
        }
  }
  if (!arr) return { columns: [], rows: [] };

  const isRecord = (r: unknown): r is Record<string, unknown> =>
    !!r && typeof r === "object" && !Array.isArray(r);
  const records = arr.filter(isRecord);
  if (!records.length) return { columns: [], rows: [] };

  // Union of keys across all records, in first-seen order.
  const rawCols: string[] = [];
  const seen = new Set<string>();
  for (const r of records)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k);
        rawCols.push(k);
      }
  const columns = uniquifyColumns(rawCols.map((c, i) => normalizeColumn(c, i)));

  const cell = (v: unknown): string =>
    v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  const rows = records.map((r) => {
    const row: Record<string, string> = {};
    rawCols.forEach((raw, i) => {
      row[columns[i]] = cell(r[raw]);
    });
    return row;
  });
  return { columns, rows };
}

// Splits delimited text into records, honoring RFC4180 quotes ("a,b", escaped "").
function parseRecords(text: string, delim: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  records.push(row);
  return records;
}

// Parses pasted/uploaded CSV or TSV. The first row is the header (column names). Tab-delimited
// (Excel/Sheets paste) is auto-detected; otherwise comma. Fully-blank rows are dropped.
export function parseDelimited(text: string): DatasetData {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return { columns: [], rows: [] };
  const firstNl = t.indexOf("\n");
  const firstLine = firstNl === -1 ? t : t.slice(0, firstNl);
  const delim = firstLine.includes("\t") ? "\t" : ",";

  const records = parseRecords(t, delim);
  if (!records.length) return { columns: [], rows: [] };

  // Header → unique, normalized column names (the suffix loops until truly unique so an
  // auto-suffix (a_2) can't collide with a literal header that's also "a_2").
  const columns = uniquifyColumns(records[0].map((c, i) => normalizeColumn(c, i)));

  const rows: Record<string, string>[] = [];
  for (const rec of records.slice(1)) {
    const row: Record<string, string> = {};
    columns.forEach((c, i) => {
      row[c] = (rec[i] ?? "").trim();
    });
    if (Object.values(row).some((v) => v !== "")) rows.push(row); // skip fully-blank rows
  }
  return { columns, rows };
}
