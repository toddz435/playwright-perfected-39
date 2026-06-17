// Pure formatter that turns data-testid advisories into a Markdown checklist a developer
// can paste straight into a GitHub issue/PR. (Full auto-PR into the app's own repo needs
// source access + DOM→source mapping; this export is the actionable first step.)

export type AdvisoryLike = {
  action?: string;
  currentLocator: string;
  reason: string;
  suggestedTestId: string;
  suggestedLocator: string;
  domPath: string;
  elementHtml: string;
};

export function advisoriesToMarkdown(testName: string, advisories: AdvisoryLike[]): string {
  if (!advisories.length) {
    return `# ${testName} — locator advice\n\nNo brittle locators found — every element already has a stable handle. 🎉\n`;
  }
  const lines = [
    `# ${testName} — add \`data-testid\`s`,
    "",
    `Testrify found **${advisories.length}** element(s) with no stable handle. Adding a \`data-testid\` to each makes its locator immune to layout/markup churn:`,
    "",
  ];
  for (const a of advisories) {
    lines.push(
      `- [ ] Add \`data-testid="${a.suggestedTestId}"\` → tests can then use \`${a.suggestedLocator}\``,
    );
    lines.push(`  - where: \`${a.domPath}\``);
    lines.push(`  - currently matched by: \`${a.currentLocator}\` — ${a.reason}`);
    lines.push(`  - element: \`${a.elementHtml}\``);
  }
  lines.push("");
  return lines.join("\n");
}
