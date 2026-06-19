// Data-Driven Testing data model + a parser for pasted/uploaded spreadsheet data. Pure +
// client-safe. A dataset's columns become the per-row variable names; each row is a
// {columnName: value} map that drives one test run.
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

  // Header → unique, normalized column names. Loop the suffix until truly unique so an
  // auto-suffix (a_2) can't collide with a literal header that's also "a_2".
  const used = new Set<string>();
  const columns = records[0].map((c, i) => {
    const base = normalizeColumn(c, i);
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}_${n++}`;
    used.add(name);
    return name;
  });

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
