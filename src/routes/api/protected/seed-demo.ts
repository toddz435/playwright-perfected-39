import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://the-internet.herokuapp.com";

const DEMO_TESTS = [
  {
    name: "Login — valid credentials",
    description: "Logs into the secure area with the documented user.",
    type: "browser",
    spec: {
      name: "Login — valid credentials",
      steps: [
        { action: "goto", target: `${BASE}/login` },
        { action: "fill", target: "input#username", value: "tomsmith" },
        { action: "fill", target: "input#password", value: "SuperSecretPassword!" },
        { action: "click", target: "button[type=submit]" },
        { action: "expect_text", target: "#flash", value: "You logged into a secure area!" },
        { action: "expect_url_contains", target: "/secure" },
      ],
    },
  },
  {
    name: "Dynamic loading — wait for element",
    description: "Triggers async loading and asserts the hidden element appears.",
    type: "browser",
    spec: {
      name: "Dynamic loading",
      steps: [
        { action: "goto", target: `${BASE}/dynamic_loading/1` },
        { action: "click", target: "#start button" },
        { action: "expect_visible", target: "#finish h4" },
        { action: "expect_text", target: "#finish h4", value: "Hello World!" },
      ],
    },
  },
  {
    name: "Dynamic controls — checkbox + input",
    description: "Removes a checkbox and enables an input via async controls.",
    type: "browser",
    spec: {
      name: "Dynamic controls",
      steps: [
        { action: "goto", target: `${BASE}/dynamic_controls` },
        { action: "click", target: "#checkbox-example button" },
        { action: "expect_text", target: "#message", value: "It's gone!" },
        { action: "click", target: "#input-example button" },
        { action: "fill", target: "#input-example input", value: "Testrify" },
        { action: "expect_value", target: "#input-example input", value: "Testrify" },
      ],
    },
  },
  {
    name: "Add/Remove elements",
    description: "Adds three elements then removes one.",
    type: "browser",
    spec: {
      name: "Add/Remove elements",
      steps: [
        { action: "goto", target: `${BASE}/add_remove_elements/` },
        { action: "click", target: "button[onclick='addElement()']" },
        { action: "click", target: "button[onclick='addElement()']" },
        { action: "click", target: "button[onclick='addElement()']" },
        { action: "expect_count", target: ".added-manually", value: "3" },
        { action: "click", target: ".added-manually" },
        { action: "expect_count", target: ".added-manually", value: "2" },
      ],
    },
  },
  {
    name: "Auto-heal demo — broken selector",
    description: "The password field selector is deliberately broken. Run it to watch the engine auto-heal the locator and continue the rest of the script to a pass.",
    type: "browser",
    spec: {
      name: "Auto-heal demo",
      steps: [
        { action: "goto", target: `${BASE}/login` },
        { action: "fill", target: "input#username", value: "tomsmith" },
        { action: "fill", target: "input#this-selector-is-intentionally-broken", value: "SuperSecretPassword!" },
        { action: "click", target: "button[type=submit]" },
        { action: "expect_text", target: "#flash", value: "You logged into a secure area!" },
        { action: "expect_url_contains", target: "/secure" },
      ],
    },
  },
  {
    name: "API — ReqRes list users",
    description: "Hits the public ReqRes API and checks status + JSON shape.",
    type: "api",
    spec: {
      name: "ReqRes — list users",
      requests: [
        {
          name: "GET /api/users?page=2",
          method: "GET",
          url: "https://reqres.in/api/users?page=2",
          headers: { "x-api-key": "reqres-free-v1" },
          assertions: [
            { kind: "status_eq", expected: 200 },
            { kind: "time_lt_ms", expected: 3000 },
            { kind: "json_path_eq", expected: "page::2" },
            { kind: "body_contains", expected: "first_name" },
          ],
        },
      ],
    },
  },
];

export const Route = createFileRoute("/api/protected/seed-demo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: project, error: pErr } = await sb.from("projects").insert({
            owner_id: userId,
            name: "Demo — The Internet",
            base_url: BASE,
            description: "Prebuilt tests against the-internet.herokuapp.com and ReqRes for instant playground.",
          }).select().single();
          if (pErr || !project) return json({ error: pErr?.message || "Could not create project" }, { status: 500 });

          const rows = DEMO_TESTS.map((t) => ({
            project_id: project.id,
            owner_id: userId,
            name: t.name,
            description: t.description,
            type: t.type,
            spec: t.spec,
          }));
          const { error: tErr } = await sb.from("tests").insert(rows);
          if (tErr) return json({ error: tErr.message }, { status: 500 });

          return json({ project, count: rows.length });
        } catch (e: any) {
          if (e instanceof Response) return e;
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
