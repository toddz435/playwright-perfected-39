-- Polish: let the user choose the Jira issue type to file (some projects have no "Bug" type).
-- Defaults to 'Bug' so existing configs keep working.
alter table public.jira_config
  add column if not exists issue_type text not null default 'Bug';
