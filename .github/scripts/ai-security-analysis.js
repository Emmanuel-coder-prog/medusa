const fs = require("fs");
const path = require("path");

const { OpenAI } = require("openai");

const SECURITY_REPORTS_DIR = path.resolve(process.cwd(), "security-reports");
const MAX_FINDINGS_PER_TOOL = 10;
const ALLOWED_RISKS = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "PASS"]);
const AI_REPORT_MARKER = "<!-- ai-security-analysis -->";
const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

function log(message, ...args) {
  console.log(`[ai-security-analysis] ${message}`, ...args);
}

function warn(message, ...args) {
  console.warn(`[ai-security-analysis] ${message}`, ...args);
}

function readJsonFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    warn(`${label} not found at ${filePath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    warn(`Failed to parse ${label} at ${filePath}: ${error.message}`);
    return null;
  }
}

function readGithubEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath || !fs.existsSync(eventPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8"));
  } catch (error) {
    warn(`Failed to read GitHub event payload: ${error.message}`);
    return {};
  }
}

function getRepositoryContext() {
  const repository = process.env.GITHUB_REPOSITORY || "unknown/unknown";
  const [owner = "unknown", repo = "unknown"] = repository.split("/");
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const eventPayload = readGithubEventPayload();

  let commitSha = process.env.GITHUB_SHA || "unknown";
  let pullRequestNumbers = [];

  if (eventName === "pull_request") {
    commitSha = eventPayload?.pull_request?.head?.sha || commitSha;
    if (eventPayload?.pull_request?.number) {
      pullRequestNumbers = [Number(eventPayload.pull_request.number)];
    }
  } else if (eventName === "workflow_run") {
    commitSha = eventPayload?.workflow_run?.head_sha || commitSha;
    const pullRequests = Array.isArray(
      eventPayload?.workflow_run?.pull_requests,
    )
      ? eventPayload.workflow_run.pull_requests
      : [];
    pullRequestNumbers = pullRequests
      .map((pullRequest) => Number(pullRequest?.number))
      .filter((pullRequestNumber) => Number.isFinite(pullRequestNumber));
  } else if (eventName === "push") {
    commitSha = eventPayload?.after || commitSha;
  }

  return {
    repository,
    owner,
    repo,
    commitSha,
    eventName,
    pullRequestNumbers: [...new Set(pullRequestNumbers)],
  };
}

function normalizeMarkdownText(value) {
  return String(value || "")
    .trim()
    .replace(/\r\n/g, "\n");
}

function escapeMarkdownTableCell(value) {
  return normalizeMarkdownText(value)
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>");
}

function formatMarkdownList(items, emptyMessage) {
  if (!items.length) {
    return `- ${emptyMessage}`;
  }

  return items.map((item) => `- ${normalizeMarkdownText(item)}`).join("\n");
}

function getDeploymentRecommendation(analysis) {
  return analysis.blockDeployment
    ? "Block deployment"
    : "Proceed with deployment after standard review";
}

function buildReportMarkdown(analysis, context) {
  return [
    "# AI Security Analysis",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Overall risk level | **${analysis.overallRisk}** |`,
    `| Deployment recommendation | ${getDeploymentRecommendation(analysis)} |`,
    `| Summary | ${escapeMarkdownTableCell(analysis.summary)} |`,
    `| Repository | ${escapeMarkdownTableCell(context.repository)} |`,
    `| Commit SHA | \`${escapeMarkdownTableCell(context.commitSha)}\` |`,
    "",
    "## Summary",
    normalizeMarkdownText(analysis.summary),
    "",
    "## Top findings",
    formatMarkdownList(
      analysis.topFindings,
      "No top findings were highlighted by the model.",
    ),
    "",
    "## Remediation recommendations",
    normalizeMarkdownText(analysis.recommendation),
  ].join("\n");
}

function buildFailureReportMarkdown(error, context) {
  return [
    "# AI Security Analysis",
    "",
    "The AI analysis failed before a report could be generated.",
    "",
    "## Error",
    "```",
    normalizeMarkdownText(error?.message || "Unknown error"),
    "```",
    "",
    "## Repository",
    context.repository,
    "",
    "## Commit SHA",
    `\`${context.commitSha}\``,
  ].join("\n");
}

function writeJobSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  if (!summaryPath) {
    warn("GITHUB_STEP_SUMMARY is missing; skipping job summary output.");
    return;
  }

  try {
    fs.appendFileSync(summaryPath, `${markdown.trimEnd()}\n`);
    log(`Wrote AI security analysis to ${summaryPath}.`);
  } catch (error) {
    warn(`Failed to write job summary: ${error.message}`);
  }
}

function buildGitHubApiUrl(pathname) {
  return new URL(pathname, GITHUB_API_BASE_URL).toString();
}

async function githubApiRequest(method, pathname, token, body) {
  const response = await fetch(buildGitHubApiUrl(pathname), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}): ${responseText}`,
    );
  }

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

async function upsertPullRequestComment(context, markdown) {
  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubToken) {
    warn("GITHUB_TOKEN is missing; skipping PR comment.");
    return;
  }

  if (!context.pullRequestNumbers.length) {
    return;
  }

  const commentBody = `${AI_REPORT_MARKER}\n\n${markdown}`;

  for (const pullRequestNumber of context.pullRequestNumbers) {
    const comments = await githubApiRequest(
      "GET",
      `/repos/${context.owner}/${context.repo}/issues/${pullRequestNumber}/comments?per_page=100`,
      githubToken,
    );

    const existingComment = Array.isArray(comments)
      ? comments.find(
          (comment) =>
            typeof comment?.body === "string" &&
            comment.body.includes(AI_REPORT_MARKER),
        )
      : null;

    if (existingComment) {
      await githubApiRequest(
        "PATCH",
        `/repos/${context.owner}/${context.repo}/issues/comments/${existingComment.id}`,
        githubToken,
        { body: commentBody },
      );
      log(`Updated AI Security Analysis PR comment on #${pullRequestNumber}.`);
      continue;
    }

    await githubApiRequest(
      "POST",
      `/repos/${context.owner}/${context.repo}/issues/${pullRequestNumber}/comments`,
      githubToken,
      { body: commentBody },
    );
    log(`Created AI Security Analysis PR comment on #${pullRequestNumber}.`);
  }
}

function walkDirectory(directoryPath, visitor) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      walkDirectory(fullPath, visitor);
      continue;
    }

    visitor(fullPath, entry.name);
  }
}

function findFiles(directoryPath, predicate) {
  const matches = [];

  walkDirectory(directoryPath, (fullPath, fileName) => {
    if (predicate(fullPath, fileName)) {
      matches.push(fullPath);
    }
  });

  return matches;
}

function normalizeSeverity(value, fallback = "LOW") {
  const severity = String(value || fallback).toUpperCase();

  if (severity === "ERROR" || severity === "HIGH") return "HIGH";
  if (
    severity === "WARNING" ||
    severity === "MEDIUM" ||
    severity === "MODERATE"
  )
    return "MEDIUM";
  if (
    severity === "NOTE" ||
    severity === "INFO" ||
    severity === "INFORMATIONAL"
  )
    return "LOW";
  if (severity === "CRITICAL") return "CRITICAL";
  if (severity === "LOW") return "LOW";

  return fallback;
}

function severityRank(severity) {
  switch (normalizeSeverity(severity)) {
    case "CRITICAL":
      return 5;
    case "HIGH":
      return 4;
    case "MEDIUM":
      return 3;
    case "LOW":
      return 2;
    default:
      return 1;
  }
}

function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const severityDelta =
      severityRank(right.severity) - severityRank(left.severity);

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return String(left.title || "").localeCompare(String(right.title || ""));
  });
}

function extractTrivyFindings(report) {
  const findings = [];

  const results = Array.isArray(report?.Results) ? report.Results : [];
  for (const result of results) {
    const vulnerabilities = Array.isArray(result?.Vulnerabilities)
      ? result.Vulnerabilities
      : [];

    for (const vulnerability of vulnerabilities) {
      findings.push({
        vulnerabilityId: vulnerability?.VulnerabilityID || "Unknown",
        severity: normalizeSeverity(vulnerability?.Severity, "LOW"),
        package: vulnerability?.PkgName || result?.Target || "Unknown",
        installedVersion: vulnerability?.InstalledVersion || "Unknown",
        fixedVersion: vulnerability?.FixedVersion || "Unknown",
        description: vulnerability?.Description || "No description provided.",
      });
    }
  }

  return sortFindings(findings).slice(0, MAX_FINDINGS_PER_TOOL);
}

function extractSarifToolName(report) {
  const runs = Array.isArray(report?.runs) ? report.runs : [];

  for (const run of runs) {
    const toolName =
      run?.tool?.driver?.name || run?.tool?.driver?.fullName || "";
    if (toolName) {
      return String(toolName).toLowerCase();
    }
  }

  return "";
}

function extractSemgrepFindings(report) {
  const toolName = extractSarifToolName(report);

  if (toolName && !toolName.includes("semgrep")) {
    warn(`Skipping SARIF report because it is not Semgrep output: ${toolName}`);
    return [];
  }

  const findings = [];
  const runs = Array.isArray(report?.runs) ? report.runs : [];

  for (const run of runs) {
    const sarifResults = Array.isArray(run?.results) ? run.results : [];

    for (const result of sarifResults) {
      const location = result?.locations?.[0]?.physicalLocation || {};
      const region = location?.region || {};

      findings.push({
        ruleId: result?.ruleId || result?.rule?.id || "Unknown",
        severity: normalizeSeverity(
          result?.properties?.severity || result?.level || "LOW",
          "LOW",
        ),
        file: location?.artifactLocation?.uri || "Unknown",
        line: region?.startLine || region?.endLine || "Unknown",
        message: result?.message?.text || "No message provided.",
      });
    }
  }

  return sortFindings(findings).slice(0, MAX_FINDINGS_PER_TOOL);
}

function collectFindings() {
  const trivyReportPath = findFiles(
    SECURITY_REPORTS_DIR,
    (fullPath, fileName) => fileName === "trivy-results.json",
  )[0];
  const semgrepReportPath =
    findFiles(
      SECURITY_REPORTS_DIR,
      (fullPath, fileName) => fileName === "semgrep-results.sarif",
    )[0] ||
    findFiles(
      SECURITY_REPORTS_DIR,
      (fullPath, fileName) => fileName === "results.sarif",
    )[0];

  const trivyReport = trivyReportPath
    ? readJsonFile(trivyReportPath, "Trivy report")
    : null;
  const semgrepReport = semgrepReportPath
    ? readJsonFile(semgrepReportPath, "Semgrep SARIF report")
    : null;

  const trivyFindings = trivyReport ? extractTrivyFindings(trivyReport) : [];
  const semgrepFindings = semgrepReport
    ? extractSemgrepFindings(semgrepReport)
    : [];

  log(
    `Loaded ${trivyFindings.length} Trivy findings and ${semgrepFindings.length} Semgrep findings.`,
  );

  return { trivyFindings, semgrepFindings };
}

function summarizeFindings(trivyFindings, semgrepFindings) {
  const counts = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };

  for (const finding of [...trivyFindings, ...semgrepFindings]) {
    const severity = normalizeSeverity(finding.severity, "LOW");
    if (counts[severity] !== undefined) {
      counts[severity] += 1;
    }
  }

  return counts;
}

function computeFallbackAnalysis(trivyFindings, semgrepFindings) {
  const counts = summarizeFindings(trivyFindings, semgrepFindings);
  const combinedFindings = [
    ...trivyFindings.map((finding) => ({
      title: `${finding.vulnerabilityId} in ${finding.package}`,
      severity: finding.severity,
      detail: `${finding.package} ${finding.installedVersion} -> ${finding.fixedVersion}`,
    })),
    ...semgrepFindings.map((finding) => ({
      title: `${finding.ruleId} in ${finding.file}`,
      severity: finding.severity,
      detail: `Line ${finding.line}: ${finding.message}`,
    })),
  ];

  const orderedFindings = sortFindings(combinedFindings).slice(0, 5);
  const highestSeverity =
    orderedFindings[0]?.severity ||
    (counts.CRITICAL
      ? "CRITICAL"
      : counts.HIGH
        ? "HIGH"
        : counts.MEDIUM
          ? "MEDIUM"
          : counts.LOW
            ? "LOW"
            : "PASS");

  return {
    overallRisk: ALLOWED_RISKS.has(highestSeverity) ? highestSeverity : "PASS",
    blockDeployment: false,
    summary: orderedFindings.length
      ? `Fallback analysis reviewed ${trivyFindings.length} Trivy findings and ${semgrepFindings.length} Semgrep findings. Highest observed severity: ${highestSeverity}.`
      : "No security findings were available for analysis.",
    topFindings: orderedFindings.map(
      (finding) => `${finding.title} - ${finding.detail}`,
    ),
    recommendation: orderedFindings.length
      ? "Review the highest severity findings before merging or deploying."
      : "No action required. Security artifact analysis completed successfully.",
  };
}

async function analyzeWithOpenAI(trivyFindings, semgrepFindings) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const client = new OpenAI({ apiKey });
  const systemPrompt = [
    "You are a security review assistant.",
    "Return ONLY valid JSON with this exact schema:",
    '{"overallRisk":"CRITICAL|HIGH|MEDIUM|LOW|PASS","blockDeployment":true,"summary":"","topFindings":[],"recommendation":""}',
    "Do not include markdown, code fences, or any extra keys.",
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      repository: process.env.GITHUB_REPOSITORY || "unknown",
      commitSha: process.env.GITHUB_SHA || "unknown",
      trivyFindings,
      semgrepFindings,
    },
    null,
    2,
  );

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI returned an empty response.");
    }

    const parsed = JSON.parse(content);
    return sanitizeAnalysis(parsed, trivyFindings, semgrepFindings);
  } catch (error) {
    throw new Error(`OpenAI analysis failed: ${error.message}`);
  }
}

function sanitizeAnalysis(analysis, trivyFindings, semgrepFindings) {
  const fallback = computeFallbackAnalysis(trivyFindings, semgrepFindings);
  const overallRisk = ALLOWED_RISKS.has(
    String(analysis?.overallRisk || "").toUpperCase(),
  )
    ? String(analysis.overallRisk).toUpperCase()
    : fallback.overallRisk;

  const topFindings = Array.isArray(analysis?.topFindings)
    ? analysis.topFindings
        .filter(
          (finding) => typeof finding === "string" && finding.trim().length > 0,
        )
        .slice(0, 10)
    : fallback.topFindings;

  const summary =
    typeof analysis?.summary === "string" && analysis.summary.trim().length > 0
      ? analysis.summary.trim()
      : fallback.summary;

  const recommendation =
    typeof analysis?.recommendation === "string" &&
    analysis.recommendation.trim().length > 0
      ? analysis.recommendation.trim()
      : fallback.recommendation;

  const blockDeployment = Boolean(analysis?.blockDeployment);

  return {
    overallRisk,
    blockDeployment,
    summary,
    topFindings,
    recommendation,
  };
}

async function main() {
  log(`Reading security reports from ${SECURITY_REPORTS_DIR}`);

  const context = getRepositoryContext();
  const { trivyFindings, semgrepFindings } = collectFindings();
  try {
    const analysis = await analyzeWithOpenAI(trivyFindings, semgrepFindings);

    if (analysis.blockDeployment === true) {
      warn(
        "AI recommends blocking deployment, but deployment is not automatically blocked.",
      );
    }

    log(`Final risk level: ${analysis.overallRisk}`);
    log(`Summary: ${analysis.summary}`);

    const reportMarkdown = buildReportMarkdown(analysis, context);
    writeJobSummary(reportMarkdown);

    if (context.pullRequestNumbers.length) {
      try {
        await upsertPullRequestComment(context, reportMarkdown);
      } catch (error) {
        warn(`PR comment failed: ${error.message}`);
      }
    }
  } catch (error) {
    const failureMarkdown = buildFailureReportMarkdown(error, context);
    writeJobSummary(failureMarkdown);
    throw error;
  }
}

main().catch((error) => {
  warn(`Unexpected error in AI security analysis: ${error.message}`);
  process.exitCode = 1;
});
