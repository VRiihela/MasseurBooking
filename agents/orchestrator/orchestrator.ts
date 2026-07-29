import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ── Types ────────────────────────────────────────────────────────────────────

// Project profiles matching 00_master.md
export type ProjectProfile =
  | "React Frontend"
  | "Node/TypeScript Backend"
  | "Python CLI"
  | "Custom";

export interface TaskSpec {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  // Matches 00_master.md "Project context" section
  profile?: ProjectProfile;
  repo?: string;
  tech?: string;
  keyConstraints?: string;
  // Optional inputs from 00_master.md "Inputs" section
  relevantFilePaths?: string[];
  securityConsiderations?: string;
  // Legacy field — kept for backwards compat with existing spec files
  projectContext?: string;
}

export interface AgentResult {
  agentRole: AgentRole;
  output: string;
  passed: boolean;
  timestamp: string;
  durationMs: number;
}

export interface RunLogEntry {
  runId: string;
  taskTitle: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "blocked";
  agents: AgentResult[];
  commitHash?: string;
  blockedAt?: AgentRole;
  blockedReason?: string;
  implementerRetries?: number;
}

export type AgentRole =
  | "architect"
  | "implementer"
  | "reviewer"
  | "tester"
  | "security"
  | "release";

// ── Agent prompt loader ───────────────────────────────────────────────────────
// Loads prompts from /agents/*.md files if present, otherwise falls back to
// built-in defaults. This keeps /agents/ as the single source of truth.

const AGENT_FILE_NAMES: Record<AgentRole, string> = {
  architect: "01_architect.md",
  implementer: "02_implementer.md",
  reviewer: "03_reviewer.md",
  tester: "04_tester.md",
  security: "05_security.md",
  release: "06_release.md",
};

// Fallback prompts — used when no .md file is found for that role.
// These mirror the structure defined in your /agents/ markdown files.
const FALLBACK_PROMPTS: Record<AgentRole, string> = {
  architect: `# 01 – Architect Agent
Role: define a safe, minimal, testable implementation plan.

You must produce:
1) Scope & assumptions
2) File impact list (exact paths)
3) Implementation plan (5–12 bullets)
4) Validation strategy (server-side)
5) Test strategy (what to test + why)
6) CIA impact (Confidentiality/Integrity/Availability: None/Low/Med/High + 1 sentence each)
7) Dependency decision: New dependency needed? If yes: justify and propose smallest reputable option

Constraints:
- Prefer minimal changes
- Avoid adding dependencies unless clearly beneficial
- Call out any security-sensitive areas (auth, data processing, external exposure)

Begin your output with: [ARCHITECT OUTPUT]
End your response with: ARCHITECT_PASS or ARCHITECT_BLOCK: <reason>`,

  implementer: `# 02 – Implementer Agent
Role: produce production-quality code changes based on the architect's plan.

You must produce:
1) Code changes (file-by-file, exact paths)
2) Any new dependencies with justification
3) Environment variables or config changes needed
4) Notes for the reviewer

Follow secure coding practices:
- Validate and sanitise all inputs server-side
- No hardcoded secrets
- Handle errors explicitly with typed responses
- No unnecessary 'any' in TypeScript

Begin your output with: [IMPLEMENTER OUTPUT]
End your response with: IMPLEMENTER_PASS or IMPLEMENTER_BLOCK: <reason>`,

  reviewer: `# 03 – Reviewer Agent
Role: review the implementation against the architecture plan and project conventions.

Review for:
1) Correctness — does it solve the task and meet acceptance criteria?
2) Code quality — structure, naming, maintainability
3) Error handling — edge cases, failure modes covered?
4) Type safety — no unnecessary 'any', proper TypeScript usage
5) Deviations — where does implementation differ from architecture plan?
6) Required changes — specific, actionable fixes (only flag real issues)

Be direct. Don't pad. Flag real issues only.

Begin your output with: [REVIEWER OUTPUT]
End your response with: REVIEWER_PASS or REVIEWER_BLOCK: <reason>`,

  tester: `# 04 – Tester Agent
Role: write tests that verify the implementation and cover edge cases.

You must produce:
1) Unit tests for individual functions/modules
2) Integration tests for component interactions
3) Negative tests for failure paths and invalid input
4) Edge cases — boundary conditions, empty states, missing fields
5) Coverage estimate — rough % of critical paths covered

Write actual runnable test code (Jest/Vitest).
Tests must include negative paths per the Definition of Done.

Begin your output with: [TESTER OUTPUT]
End your response with: TESTER_PASS or TESTER_BLOCK: <reason>`,

  security: `# 05 – Security Agent
Role: perform an OWASP-lite security review and dependency/supply-chain check.

You must assess:
1) OWASP Top 10 relevance — which apply to this feature?
2) Input validation — all inputs validated server-side?
3) Auth & authz — any authentication/authorisation concerns?
4) Data exposure — errors leak stack traces? Sensitive data exposed?
5) Dependency risk — new packages added? Are they reputable and maintained?
6) Supply chain — no suspicious transitive dependencies?
7) CIA triad — Confidentiality/Integrity/Availability impact (None/Low/Med/High + reason)
8) Findings — list as: [CRITICAL/HIGH/MEDIUM/LOW] description
9) Mitigations — specific fix for each finding

CRITICAL or HIGH findings MUST block release.
npm audit must have no unresolved HIGH/CRITICAL.
Secrets must not be committed.

Begin your output with: [SECURITY OUTPUT]
End your response with: SECURITY_PASS or SECURITY_BLOCK: <reason>`,

  release: `# 06 – Release Agent
Role: verify Definition of Done and produce a PR-ready release summary.

Check every item in the Definition of Done:

FUNCTIONAL:
- [ ] Acceptance criteria met
- [ ] Edge cases considered (invalid input, missing fields, empty states)
- [ ] No breaking changes without migration notes

CODE QUALITY:
- [ ] TypeScript: no unnecessary 'any'
- [ ] Lint & formatting pass
- [ ] No dead code / debug logs

TESTS:
- [ ] New behaviour has tests (unit/integration)
- [ ] Negative tests included for failure paths
- [ ] Tests pass locally and in CI

SECURITY (SSDLC):
- [ ] Input validation implemented server-side
- [ ] Auth/authz checked where relevant
- [ ] Errors do not leak sensitive data
- [ ] Secrets not committed

DEPENDENCY & SUPPLY CHAIN:
- [ ] No new dependency without justification
- [ ] npm audit has no unresolved HIGH/CRITICAL
- [ ] PR dependency review passes

DOCUMENTATION:
- [ ] README/docs updated if behaviour changes
- [ ] PR includes: what changed, how to test, risk notes

Then produce:
- Release notes (what was built, suitable for PR description)
- Risk register entry if any risks remain
- Rollback plan

Begin your output with: [RELEASE OUTPUT]
End your response with: RELEASE_PASS or RELEASE_BLOCK: <reason>`,
};

function loadAgentPrompt(role: AgentRole, agentsDir: string): string {
  const filePath = path.join(agentsDir, AGENT_FILE_NAMES[role]);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    // Append the pass/block instruction if not already present
    const passToken = `${role.toUpperCase()}_PASS`;
    if (!content.includes(passToken)) {
      return (
        content +
        `\n\nEnd your response with: ${role.toUpperCase()}_PASS or ${role.toUpperCase()}_BLOCK: <reason>`
      );
    }
    return content;
  }
  // Fall back to built-in prompt
  return FALLBACK_PROMPTS[role];
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export class AgenticOrchestrator {
  private client: Anthropic;
  private runLogPath: string;
  private agentsDir: string;
  private dodPath: string;
  private model = "claude-sonnet-4-20250514";

  constructor(
    runLogPath = "./run_log.json",
    agentsDir = "../agents",        // points to your /agents folder
    dodPath = "../definition_of_done.md"
  ) {
    this.client = new Anthropic();
    this.runLogPath = runLogPath;
    this.agentsDir = agentsDir;
    this.dodPath = dodPath;
  }

  async runPipeline(spec: TaskSpec, fromStage?: AgentRole): Promise<RunLogEntry> {
    const runId = `run_${Date.now()}`;
    const allStages: AgentRole[] = [
      "architect",
      "implementer",
      "reviewer",
      "tester",
      "security",
      "release",
    ];

    const fromIdx = fromStage ? allStages.indexOf(fromStage) : 0;

    const entry: RunLogEntry = {
      runId,
      taskTitle: spec.title,
      startedAt: new Date().toISOString(),
      status: "running",
      agents: [],
      implementerRetries: 0,
    };

    this.saveRunLog(entry);
    console.log(`\n🚀 Starting pipeline: ${spec.title}`);
    console.log(`   Run ID: ${runId}`);
    if (fromStage) console.log(`   Starting from: ${fromStage.toUpperCase()}`);
    console.log();

    let accumulatedContext = this.buildInitialContext(spec);

    // Log skipped stages and add a note to the context
    if (fromIdx > 0) {
      const skippedStages = allStages.slice(0, fromIdx);
      for (const role of skippedStages) {
        console.log(`⏭️  Skipping ${role.toUpperCase()} (--from-stage ${fromStage})`);
        entry.agents.push({
          agentRole: role,
          output: "Skipped via --from-stage flag",
          passed: true,
          timestamp: new Date().toISOString(),
          durationMs: 0,
        });
      }
      accumulatedContext += `\n\n${"=".repeat(60)}\nNote: Stages [${skippedStages.join(", ")}] were skipped via --from-stage. Proceed from ${fromStage} stage.\n${"=".repeat(60)}`;
    }

    // Helper — runs a stage, logs output, appends to context, handles block
    const runStage = async (role: AgentRole): Promise<{ passed: boolean; result: AgentResult }> => {
      console.log(`\n──────────────────────────────────────`);
      console.log(`🤖 Agent: ${role.toUpperCase()}`);
      console.log(`──────────────────────────────────────`);

      const result = await this.runAgent(role, accumulatedContext);
      entry.agents.push(result);

      console.log(`\n${result.passed ? "✅" : "🚫"} ${role.toUpperCase()} ${result.passed ? "PASS" : "BLOCK"}`);
      console.log(`   Duration: ${result.durationMs}ms`);
      const preview = result.output.slice(0, 300).replace(/\n/g, " ");
      console.log(`   Preview: ${preview}...`);

      if (!result.passed) {
        entry.status = "blocked";
        entry.blockedAt = role;
        entry.blockedReason = this.extractBlockReason(result.output, role);
        entry.completedAt = new Date().toISOString();
        this.saveRunLog(entry);
        console.log(`\n🚫 Pipeline blocked at ${role}: ${entry.blockedReason}`);
      } else {
        accumulatedContext += `\n\n${"=".repeat(60)}\n${role.toUpperCase()} AGENT OUTPUT:\n${"=".repeat(60)}\n${result.output}`;
      }

      return { passed: result.passed, result };
    };

    // ── Architect ──────────────────────────────────────────────────────────────
    if (fromIdx <= allStages.indexOf("architect")) {
      const { passed } = await runStage("architect");
      if (!passed) return entry;
    }

    // ── Implementer → Reviewer (with retry loop) ───────────────────────────────
    const skipImplementer = fromIdx > allStages.indexOf("implementer");
    const skipReviewer = fromIdx > allStages.indexOf("reviewer");

    if (!skipReviewer) {
      if (skipImplementer) {
        // Resume from reviewer only — no retry possible without implementer
        const { passed } = await runStage("reviewer");
        if (!passed) return entry;
      } else {
        // Full retry loop: implementer → reviewer, up to 3 total attempts
        const MAX_ATTEMPTS = 3;
        let reviewerPassed = false;
        let lastReviewerOutput = "";

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (attempt > 1) {
            console.log(`\n🔄 Reviewer blocked — retrying implementer (attempt ${attempt}/3)`);
          }

          // Build implementer context — inject reviewer block reason on retries
          const implContext = attempt === 1
            ? accumulatedContext
            : accumulatedContext +
              `\n\nREVIEWER BLOCK — attempt ${attempt}/3. Fix the following issues and rewrite only the affected code:\n\n${lastReviewerOutput}`;

          console.log(`\n──────────────────────────────────────`);
          console.log(`🤖 Agent: IMPLEMENTER${attempt > 1 ? ` (retry ${attempt}/3)` : ""}`);
          console.log(`──────────────────────────────────────`);

          const implResult = await this.runAgent("implementer", implContext);
          entry.agents.push(implResult);

          console.log(`\n${implResult.passed ? "✅" : "🚫"} IMPLEMENTER ${implResult.passed ? "PASS" : "BLOCK"}`);
          console.log(`   Duration: ${implResult.durationMs}ms`);
          console.log(`   Preview: ${implResult.output.slice(0, 300).replace(/\n/g, " ")}...`);

          if (!implResult.passed) {
            entry.status = "blocked";
            entry.blockedAt = "implementer";
            entry.blockedReason = this.extractBlockReason(implResult.output, "implementer");
            entry.completedAt = new Date().toISOString();
            this.saveRunLog(entry);
            console.log(`\n🚫 Pipeline blocked at implementer: ${entry.blockedReason}`);
            return entry;
          }

          // Reviewer sees everything up to now + this implementer output
          const reviewerContext =
            accumulatedContext +
            `\n\n${"=".repeat(60)}\nIMPLEMENTER AGENT OUTPUT:\n${"=".repeat(60)}\n${implResult.output}`;

          console.log(`\n──────────────────────────────────────`);
          console.log(`🤖 Agent: REVIEWER`);
          console.log(`──────────────────────────────────────`);

          const reviewerResult = await this.runAgent("reviewer", reviewerContext);
          entry.agents.push(reviewerResult);
          lastReviewerOutput = reviewerResult.output;

          if (attempt > 1) {
            entry.implementerRetries = (entry.implementerRetries ?? 0) + 1;
          }

          console.log(`\n${reviewerResult.passed ? "✅" : "🚫"} REVIEWER ${reviewerResult.passed ? "PASS" : "BLOCK"}`);
          console.log(`   Duration: ${reviewerResult.durationMs}ms`);
          console.log(`   Preview: ${reviewerResult.output.slice(0, 300).replace(/\n/g, " ")}...`);

          if (reviewerResult.passed) {
            // Commit both outputs to the shared context and move on
            accumulatedContext +=
              `\n\n${"=".repeat(60)}\nIMPLEMENTER AGENT OUTPUT:\n${"=".repeat(60)}\n${implResult.output}` +
              `\n\n${"=".repeat(60)}\nREVIEWER AGENT OUTPUT:\n${"=".repeat(60)}\n${reviewerResult.output}`;
            reviewerPassed = true;
            break;
          }

          if (attempt === MAX_ATTEMPTS) {
            entry.status = "blocked";
            entry.blockedAt = "reviewer";
            entry.blockedReason = this.extractBlockReason(reviewerResult.output, "reviewer");
            entry.completedAt = new Date().toISOString();
            this.saveRunLog(entry);
            console.log(`\n🚫 Pipeline blocked at reviewer after ${MAX_ATTEMPTS} attempts: ${entry.blockedReason}`);
            return entry;
          }
        }

        if (!reviewerPassed) return entry;
      }
    }

    // ── Tester → Security → Release ────────────────────────────────────────────
    for (const role of ["tester", "security", "release"] as AgentRole[]) {
      if (fromIdx <= allStages.indexOf(role)) {
        const { passed } = await runStage(role);
        if (!passed) return entry;
      }
    }

    entry.status = "completed";
    entry.completedAt = new Date().toISOString();
    this.saveRunLog(entry);

    console.log(`\n\n🎉 Pipeline completed successfully!`);
    console.log(`   Total agents: ${entry.agents.length}`);
    if (entry.implementerRetries) console.log(`   Implementer retries: ${entry.implementerRetries}`);
    console.log(`   Total time: ${this.getTotalDuration(entry)}ms\n`);

    return entry;
  }

  private async runAgent(
    role: AgentRole,
    context: string
  ): Promise<AgentResult> {
    const start = Date.now();
    const prompt = loadAgentPrompt(role, this.agentsDir);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: prompt,
        messages: [{ role: "user", content: context }],
      });

      const output =
        response.content[0].type === "text" ? response.content[0].text : "";

      const passed = this.didPass(output, role);

      return {
        agentRole: role,
        output,
        passed,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        agentRole: role,
        output: `ERROR: ${errorMsg}`,
        passed: false,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    }
  }

  private buildInitialContext(spec: TaskSpec): string {
    // Load DoD if available — Release agent gets it as explicit context
    let dodContent = "";
    if (fs.existsSync(this.dodPath)) {
      dodContent = fs.readFileSync(this.dodPath, "utf-8");
    }

    // Mirrors the structure of 00_master.md exactly
    const lines: string[] = [
      `# Agentic DevSecOps Task Run`,
      ``,
      `## Project Profile`,
      `Profile: ${spec.profile ?? "Node/TypeScript Backend"}`,
      ``,
      `## Project Context`,
      `Repo: ${spec.repo ?? "(not specified)"}`,
      `Tech: ${spec.tech ?? spec.projectContext ?? "(not specified)"}`,
      `Key constraints: ${spec.keyConstraints ?? "TypeScript strict"}`,
      ``,
      `## Task`,
      spec.description,
      ``,
      `## Acceptance Criteria`,
      ...spec.acceptanceCriteria.map((c) => `- ${c}`),
    ];

    if (spec.relevantFilePaths?.length) {
      lines.push(``, `## Relevant File Paths`);
      spec.relevantFilePaths.forEach((f) => lines.push(`- ${f}`));
    }

    if (spec.securityConsiderations) {
      lines.push(``, `## Security Concerns`, spec.securityConsiderations);
    }

    if (dodContent) {
      lines.push(
        ``,
        `## Definition of Done`,
        `(All agents must respect the following DoD. Release agent must verify each item.)`,
        ``,
        dodContent
      );
    }

    lines.push(
      ``,
      `## Workflow`,
      `Run stages in order: ARCHITECT → IMPLEMENTER → REVIEWER → TESTER → SECURITY → RELEASE`,
      `Use headings: [ARCHITECT OUTPUT], [IMPLEMENTER OUTPUT], etc.`,
      `Be concrete: propose exact files and changes.`,
      `If adding dependencies: justify + note audit requirement.`,
      `Never trust external input; validate server-side.`
    );

    return lines.join("\n");
  }

  private didPass(output: string, role: AgentRole): boolean {
    const passToken = `${role.toUpperCase()}_PASS`;
    const blockToken = `${role.toUpperCase()}_BLOCK`;
    if (output.includes(passToken)) return true;
    if (output.includes(blockToken)) return false;
    // Default to pass if neither token found (agent forgot to add it)
    return true;
  }

  private extractBlockReason(output: string, role: AgentRole): string {
    const blockToken = `${role.toUpperCase()}_BLOCK:`;
    const idx = output.indexOf(blockToken);
    if (idx === -1) return "Agent blocked without reason";
    return output.slice(idx + blockToken.length).trim().split("\n")[0];
  }

  private getTotalDuration(entry: RunLogEntry): number {
    return entry.agents.reduce((sum, a) => sum + a.durationMs, 0);
  }

  private saveRunLog(entry: RunLogEntry): void {
    let log: RunLogEntry[] = [];
    if (fs.existsSync(this.runLogPath)) {
      try {
        log = JSON.parse(fs.readFileSync(this.runLogPath, "utf-8"));
      } catch {
        log = [];
      }
    }

    const existingIdx = log.findIndex((e) => e.runId === entry.runId);
    if (existingIdx >= 0) {
      log[existingIdx] = entry;
    } else {
      log.push(entry);
    }

    fs.mkdirSync(path.dirname(path.resolve(this.runLogPath)), {
      recursive: true,
    });
    fs.writeFileSync(this.runLogPath, JSON.stringify(log, null, 2));
  }

  // Print a human-readable summary of a completed run
  printSummary(entry: RunLogEntry): void {
    console.log("\n" + "═".repeat(60));
    console.log("PIPELINE SUMMARY");
    console.log("═".repeat(60));
    console.log(`Task:    ${entry.taskTitle}`);
    console.log(`Run ID:  ${entry.runId}`);
    console.log(`Status:  ${entry.status.toUpperCase()}`);
    console.log(`Started: ${entry.startedAt}`);
    if (entry.completedAt) console.log(`Ended:   ${entry.completedAt}`);
    console.log("\nAgent Results:");
    for (const agent of entry.agents) {
      const icon = agent.passed ? "✅" : "🚫";
      console.log(
        `  ${icon} ${agent.agentRole.padEnd(12)} ${agent.durationMs}ms`
      );
    }
    if (entry.blockedAt) {
      console.log(`\n🚫 Blocked at: ${entry.blockedAt}`);
      console.log(`   Reason: ${entry.blockedReason}`);
    }
    console.log("═".repeat(60) + "\n");
  }
}

// ── Interactive CLI ───────────────────────────────────────────────────────────

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function collectTaskSpec(): Promise<TaskSpec> {
  console.log("\n🔧 AGENTIC DEVSECOPS ORCHESTRATOR");
  console.log("─".repeat(40));
  console.log("Enter your task details:\n");

  const title = await promptUser("Task title: ");

  console.log("Project profile:");
  console.log("  1) React Frontend");
  console.log("  2) Node/TypeScript Backend");
  console.log("  3) Python CLI");
  console.log("  4) Custom");
  const profileChoice = await promptUser("Choose profile (1-4, default 2): ");
  const profileMap: Record<string, ProjectProfile> = {
    "1": "React Frontend",
    "2": "Node/TypeScript Backend",
    "3": "Python CLI",
    "4": "Custom",
  };
  const profile = profileMap[profileChoice] ?? "Node/TypeScript Backend";

  const repo = await promptUser("Repo name or link (optional): ");
  const tech = await promptUser("Tech stack (optional, e.g. Express, Prisma, Zod): ");
  const keyConstraints = await promptUser(
    "Key constraints (optional, e.g. TypeScript strict, ESM, JWT): "
  );
  const description = await promptUser("Task description: ");

  console.log(
    "Acceptance criteria (one per line, empty line to finish):"
  );
  const criteria: string[] = [];
  while (true) {
    const criterion = await promptUser(`  Criterion ${criteria.length + 1}: `);
    if (!criterion) break;
    criteria.push(criterion);
  }

  const security = await promptUser(
    "Security concerns (optional): "
  );

  return {
    title,
    profile,
    repo: repo || undefined,
    tech: tech || undefined,
    keyConstraints: keyConstraints || undefined,
    description,
    acceptanceCriteria: criteria,
    securityConsiderations: security || undefined,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const VALID_STAGES: AgentRole[] = [
    "architect", "implementer", "reviewer", "tester", "security", "release",
  ];

  // Parse --from-stage flag and remove it from argv before reading specFile
  const rawArgs = process.argv.slice(2);
  const flagIdx = rawArgs.indexOf("--from-stage");
  let fromStage: AgentRole | undefined;

  if (flagIdx !== -1) {
    const value = rawArgs[flagIdx + 1];
    if (!value || !VALID_STAGES.includes(value as AgentRole)) {
      console.error(
        `❌ Invalid --from-stage value: "${value ?? ""}". Valid values: ${VALID_STAGES.join(", ")}`
      );
      process.exit(1);
    }
    fromStage = value as AgentRole;
    rawArgs.splice(flagIdx, 2);
  }

  const specFile = rawArgs[0];
  let spec: TaskSpec;

  if (specFile) {
    try {
      spec = JSON.parse(fs.readFileSync(specFile, "utf-8")) as TaskSpec;
      console.log(`\n📄 Loaded spec from: ${specFile}`);
    } catch {
      console.error(`❌ Could not read spec file: ${specFile}`);
      process.exit(1);
    }
  } else {
    spec = await collectTaskSpec();
  }

  // agentsDir and dodPath resolve relative to this file's location.
  // Adjust if your /agents folder is somewhere else.
  const agentsDir = path.resolve(__dirname, "../../agents");
  const dodPath = path.resolve(__dirname, "../../definition_of_done.md");

  const orchestrator = new AgenticOrchestrator(
    "./run_log.json",
    agentsDir,
    dodPath
  );
  const result = await orchestrator.runPipeline(spec, fromStage);
  orchestrator.printSummary(result);

  const reportPath = `./reports/${result.runId}.md`;
  fs.mkdirSync("./reports", { recursive: true });
  fs.writeFileSync(reportPath, buildMarkdownReport(result, spec, specFile));
  console.log(`📝 Full report saved to: ${reportPath}`);
}

function buildMarkdownReport(entry: RunLogEntry, spec: TaskSpec, taskFilePath?: string): string {
  const lines: string[] = [
    `# Pipeline Report: ${entry.taskTitle}`,
    ``,
    `**Run ID:** ${entry.runId}  `,
    `**Status:** ${entry.status.toUpperCase()}  `,
    `**Started:** ${entry.startedAt}  `,
    `**Completed:** ${entry.completedAt ?? "N/A"}  `,
    ``,
    `## Task Spec`,
    ...(taskFilePath ? [`**File:** ${path.basename(taskFilePath)}`, ``] : []),
    "```json",
    JSON.stringify(spec, null, 2),
    "```",
    ``,
  ];

  for (const agent of entry.agents) {
    lines.push(`## ${agent.agentRole.toUpperCase()} Agent`);
    lines.push(``);
    lines.push(
      `**Status:** ${agent.passed ? "✅ PASS" : "🚫 BLOCK"}  `
    );
    lines.push(`**Duration:** ${agent.durationMs}ms  `);
    lines.push(`**Timestamp:** ${agent.timestamp}  `);
    lines.push(``);
    lines.push("```");
    lines.push(agent.output);
    lines.push("```");
    lines.push(``);
  }

  if (entry.blockedAt) {
    lines.push(`## ⛔ Pipeline Blocked`);
    lines.push(``);
    lines.push(`Blocked at **${entry.blockedAt}** agent.  `);
    lines.push(`Reason: ${entry.blockedReason}`);
  }

  return lines.join("\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
