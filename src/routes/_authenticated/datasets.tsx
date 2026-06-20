import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Database,
  Plus,
  Trash2,
  Loader2,
  Save,
  X,
  ClipboardPaste,
  Link2,
  RefreshCw,
  KeyRound,
} from "lucide-react";
import { parseDelimited, normalizeColumn } from "@/lib/dataset";
import { apiCall } from "@/lib/api-client";

// Source providers selectable in the "Connect a source" panel. `sheet_url` is a public CSV link
// (no token); the others are authenticated REST/JSON. Labels/placeholders/help drive the UI.
type Provider = "sheet_url" | "airtable" | "supabase";
const PROVIDERS: {
  id: Provider;
  label: string;
  urlLabel: string;
  urlPlaceholder: string;
  needsToken: boolean;
  tokenLabel?: string;
  help: string;
}[] = [
  {
    id: "sheet_url",
    label: "Public CSV URL",
    urlLabel: "Published CSV URL",
    urlPlaceholder: "https://docs.google.com/…/pub?output=csv",
    needsToken: false,
    help: "Google Sheets: File → Share → Publish to web → CSV. Any public CSV/TSV link works.",
  },
  {
    id: "airtable",
    label: "Airtable",
    urlLabel: "Airtable API URL",
    urlPlaceholder: "https://api.airtable.com/v0/appXXXX/Table%20Name",
    needsToken: true,
    tokenLabel: "Personal access token",
    help: "Token: airtable.com/create/tokens (scope data.records:read). URL: api.airtable.com/v0/{baseId}/{tableName}.",
  },
  {
    id: "supabase",
    label: "Supabase",
    urlLabel: "Supabase REST URL",
    urlPlaceholder: "https://xxxx.supabase.co/rest/v1/your_table?select=*",
    needsToken: true,
    tokenLabel: "API key (anon or service)",
    help: "Key: Project → Settings → API. URL: https://{ref}.supabase.co/rest/v1/{table}?select=*.",
  },
];
const isSourced = (s: string | undefined) =>
  s === "sheet_url" || s === "airtable" || s === "supabase";

export const Route = createFileRoute("/_authenticated/datasets")({
  head: () => ({ meta: [{ title: "Datasets — Testrify" }] }),
  component: Datasets,
});

type Dataset = {
  id?: string;
  name: string;
  source: string;
  source_url?: string | null;
  columns: string[];
  rows: Record<string, string>[];
};

const blank = (): Dataset => ({ name: "", source: "spreadsheet", columns: [], rows: [] });

// Column header with a LOCAL draft so typing is free; the rename only commits on blur (avoids
// renaming-per-keystroke, which would churn the grid and lose focus).
function ColumnHeader({
  name,
  onRename,
  onRemove,
}: {
  name: string;
  onRename: (oldName: string, val: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]); // resync if the committed name changes (or a rename was rejected)
  return (
    <div className="flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(name, draft)}
        className="bg-input/50 h-7 text-xs w-32"
      />
      <button onClick={onRemove} title="Remove column" className="text-destructive hover:opacity-70">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// `datasets` isn't in the generated Supabase types yet (Lovable regenerates them after the
// migration applies), so query it through a loosely-typed handle until then.
const db = supabase as any;

function Datasets() {
  const [list, setList] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [editing, setEditing] = useState<Dataset | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcProvider, setSrcProvider] = useState<Provider>("sheet_url");
  const [srcUrl, setSrcUrl] = useState("");
  const [srcToken, setSrcToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    // Select only what the client needs. NOT source_token (the encrypted REST credential is
    // write-only) and NOT source_url (so the page still loads if the Slice-2 migration that adds
    // those columns hasn't been applied yet — "sourced?" is derived from the `source` column).
    const { data, error } = await db
      .from("datasets")
      .select("id,name,source,columns,rows,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      // Only the "table doesn't exist" error means the migration isn't applied; anything else
      // (transient/network/auth) is a real error, not a missing schema.
      const missingTable =
        (error as any).code === "42P01" || /does not exist|relation/i.test(error.message || "");
      if (missingTable) setNotSetUp(true);
      else toast.error(error.message || "Failed to load datasets");
      setLoading(false);
      return;
    }
    setNotSetUp(false);
    setList((data || []) as Dataset[]);
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, []);

  // --- grid edits (operate on the `editing` draft) ---
  const patch = (p: Partial<Dataset>) => setEditing((e) => (e ? { ...e, ...p } : e));
  const setCell = (i: number, col: string, val: string) =>
    setEditing((e) =>
      e ? { ...e, rows: e.rows.map((r, idx) => (idx === i ? { ...r, [col]: val } : r)) } : e,
    );
  const addRow = () =>
    setEditing((e) =>
      e ? { ...e, rows: [...e.rows, Object.fromEntries(e.columns.map((c) => [c, ""]))] } : e,
    );
  const removeRow = (i: number) =>
    setEditing((e) => (e ? { ...e, rows: e.rows.filter((_, idx) => idx !== i) } : e));
  const addColumn = () =>
    setEditing((e) => {
      if (!e) return e;
      const name = normalizeColumn(`col`, e.columns.length);
      const col = e.columns.includes(name) ? `${name}_${e.columns.length + 1}` : name;
      return { ...e, columns: [...e.columns, col], rows: e.rows.map((r) => ({ ...r, [col]: "" })) };
    });
  const removeColumn = (col: string) =>
    setEditing((e) =>
      e
        ? {
            ...e,
            columns: e.columns.filter((c) => c !== col),
            rows: e.rows.map(({ [col]: _drop, ...rest }) => rest),
          }
        : e,
    );
  // Called on blur (not per keystroke) with the finished draft. Validates against current state.
  const renameColumn = (oldName: string, raw: string) => {
    if (!editing) return;
    const idx = editing.columns.indexOf(oldName);
    if (idx < 0) return;
    const name = normalizeColumn(raw, idx);
    if (name === oldName) return; // unchanged
    if (editing.columns.includes(name)) {
      toast.error(`A column named "${name}" already exists.`);
      return; // ColumnHeader resets its draft to the kept name
    }
    setEditing((e) =>
      e
        ? {
            ...e,
            columns: e.columns.map((c) => (c === oldName ? name : c)),
            rows: e.rows.map(({ [oldName]: v, ...rest }) => ({ ...rest, [name]: v ?? "" })),
          }
        : e,
    );
  };

  const applyPaste = () => {
    const parsed = parseDelimited(paste);
    if (!parsed.columns.length) return toast.error("Couldn't find any columns in that paste.");
    patch({ columns: parsed.columns, rows: parsed.rows });
    setPaste("");
    setPasteOpen(false);
    toast.success(`Parsed ${parsed.columns.length} columns × ${parsed.rows.length} rows`);
  };

  // Connect the dataset to an external source (public CSV URL, or Airtable/Supabase REST): the
  // server fetches it, encrypts any token, and SAVES the dataset — returning the fresh columns/rows.
  const connectSource = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return toast.error("Give the dataset a name first.");
    if (!srcUrl.trim()) return toast.error("Enter the source URL.");
    // A blank token is only allowed when re-connecting the SAME provider's existing dataset (keep
    // the stored token). For a new dataset, or after switching providers, demand a fresh token.
    const p = PROVIDERS.find((x) => x.id === srcProvider)!;
    if (p.needsToken && !srcToken.trim() && !(editing.id && editing.source === srcProvider))
      return toast.error(`Enter the ${p.tokenLabel} for this source.`);
    setConnecting(true);
    try {
      const r = await apiCall<{
        id: string;
        source: string;
        columns: string[];
        rows: Record<string, string>[];
      }>("/api/protected/connect-dataset-source", {
        datasetId: editing.id,
        name,
        provider: srcProvider,
        url: srcUrl.trim(),
        token: srcToken,
      });
      patch({
        id: r.id,
        source: r.source,
        source_url: srcUrl.trim(),
        columns: r.columns,
        rows: r.rows,
      });
      setSrcToken("");
      setSrcOpen(false);
      toast.success(`Connected — pulled ${r.columns.length} columns × ${r.rows.length} rows`);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
    setConnecting(false);
  };

  // Re-pull a source-backed dataset's rows from its stored source (token decrypted server-side).
  const refreshSource = async () => {
    if (!editing?.id) return;
    setRefreshing(true);
    try {
      const r = await apiCall<{ columns: string[]; rows: Record<string, string>[]; rowCount: number }>(
        "/api/protected/refresh-dataset",
        { datasetId: editing.id },
      );
      patch({ columns: r.columns, rows: r.rows });
      toast.success(`Refreshed — ${r.rowCount} rows`);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
    setRefreshing(false);
  };

  const save = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return toast.error("Give the dataset a name.");
    if (!editing.columns.length) return toast.error("Add at least one column.");
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return toast.error("Your session expired — please sign in again.");
    }
    const payload = {
      name,
      source: editing.source,
      columns: editing.columns,
      rows: editing.rows,
      owner_id: user?.id,
    };
    const res = editing.id
      ? await db.from("datasets").update(payload).eq("id", editing.id)
      : await db.from("datasets").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success("Dataset saved");
    setEditing(null);
    refresh();
  };

  const remove = async (d: Dataset) => {
    if (!d.id || !confirm(`Delete dataset "${d.name}"?`)) return;
    const { error } = await db.from("datasets").delete().eq("id", d.id);
    if (error) return toast.error(error.message);
    toast.success("Dataset deleted");
    if (editing?.id === d.id) setEditing(null);
    refresh();
  };

  if (loading)
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (notSetUp)
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 mb-4">
          <Database className="h-7 w-7 text-primary-glow" /> Datasets
        </h1>
        <div className="glass rounded-xl p-6 text-sm">
          The <code>datasets</code> table isn't set up yet. Apply the migration{" "}
          <code>supabase/migrations/20260619000000_datasets.sql</code> (via Lovable or the Supabase
          SQL editor), then reload this page.
        </div>
      </div>
    );

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Database className="h-7 w-7 text-primary-glow" /> Datasets
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Tabular data that drives a test once per row. Each column is a <code>{"{{variable}}"}</code>.
          </p>
        </div>
        {!editing && (
          <Button className="bg-gradient-primary border-0" onClick={() => setEditing(blank())}>
            <Plus className="h-4 w-4 mr-1" /> New dataset
          </Button>
        )}
      </div>

      {/* Editor */}
      {editing && (
        <section className="glass rounded-2xl p-6 shadow-card space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={editing.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Dataset name"
              className="bg-input/50 max-w-xs"
            />
            <Button size="sm" variant="outline" onClick={() => setPasteOpen((o) => !o)}>
              <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste CSV / spreadsheet
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSrcOpen((o) => !o)}>
              <Link2 className="h-3.5 w-3.5 mr-1" /> Connect a source
            </Button>
            {editing.id && isSourced(editing.source) && (
              <Button
                size="sm"
                variant="outline"
                disabled={refreshing}
                onClick={refreshSource}
                title="Re-pull the rows from this dataset's connected source."
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                Refresh from source
              </Button>
            )}
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={save} className="bg-gradient-primary border-0">
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save
            </Button>
          </div>

          {pasteOpen && (
            <div className="space-y-2">
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder="Paste rows from Excel / Google Sheets, or CSV. First row = column names."
                className="w-full h-28 bg-input/50 border border-border rounded-md p-2 text-xs font-mono"
              />
              <Button size="sm" variant="outline" onClick={applyPaste}>
                Parse → grid
              </Button>
            </div>
          )}

          {srcOpen &&
            (() => {
              const p = PROVIDERS.find((x) => x.id === srcProvider)!;
              return (
                <div className="space-y-2 rounded-lg border border-border bg-surface/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={srcProvider}
                      onChange={(e) => setSrcProvider(e.target.value as Provider)}
                      className="bg-input/50 border border-border rounded-md px-2 py-1.5 text-xs"
                      title="Source type"
                    >
                      {PROVIDERS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={srcUrl}
                      onChange={(e) => setSrcUrl(e.target.value)}
                      placeholder={p.urlPlaceholder}
                      className="bg-input/50 flex-1 min-w-[260px] font-mono text-xs"
                      aria-label={p.urlLabel}
                    />
                  </div>
                  {p.needsToken && (
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Input
                        type="password"
                        value={srcToken}
                        onChange={(e) => setSrcToken(e.target.value)}
                        placeholder={
                          editing.id ? "Leave blank to keep the saved token" : p.tokenLabel
                        }
                        className="bg-input/50 flex-1 min-w-[260px] font-mono text-xs"
                        aria-label={p.tokenLabel}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={connecting}
                      onClick={connectSource}
                    >
                      {connecting ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5 mr-1" />
                      )}
                      Connect &amp; save
                    </Button>
                    <p className="text-xs text-muted-foreground flex-1">
                      {p.help} The fetch runs server-side; only public addresses are allowed.
                      {p.needsToken ? " Your token is encrypted at rest." : ""}
                    </p>
                  </div>
                </div>
              );
            })()}

          {/* Grid */}
          {editing.columns.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No columns yet — paste a spreadsheet above, or add a column.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs font-mono border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="w-8" />
                    {editing.columns.map((c, ci) => (
                      <th key={ci} className="p-1">
                        <ColumnHeader
                          name={c}
                          onRename={renameColumn}
                          onRemove={() => removeColumn(c)}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {editing.rows.map((row, i) => (
                    <tr key={i}>
                      <td className="pr-1 text-right text-muted-foreground align-middle">
                        <button
                          onClick={() => removeRow(i)}
                          title="Remove row"
                          className="text-destructive hover:opacity-70"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                      {editing.columns.map((c, ci) => (
                        <td key={ci} className="p-0.5">
                          <Input
                            value={row[c] ?? ""}
                            onChange={(e) => setCell(i, c, e.target.value)}
                            className="bg-input/50 h-7 text-xs w-32"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addRow} disabled={!editing.columns.length}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add row
            </Button>
            <Button size="sm" variant="outline" onClick={addColumn}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add column
            </Button>
          </div>
        </section>
      )}

      {/* List */}
      {!editing && (
        <div className="grid gap-3">
          {list.length === 0 && (
            <div className="text-sm text-muted-foreground glass rounded-xl p-6">
              No datasets yet. Create one to drive a test from a spreadsheet.
            </div>
          )}
          {list.map((d) => (
            <div
              key={d.id}
              className="glass rounded-xl p-4 shadow-card flex items-center gap-4 cursor-pointer hover:bg-surface/40"
              onClick={() => setEditing({ ...d, rows: d.rows || [], columns: d.columns || [] })}
            >
              <Database className="h-5 w-5 text-primary-glow shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{d.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(d.columns || []).length} columns · {(d.rows || []).length} rows · {d.source}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(d);
                }}
                title="Delete dataset"
                className="text-destructive hover:opacity-70"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
