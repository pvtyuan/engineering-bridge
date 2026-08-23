export const COMPLETION_RECEIPT_OPEN = "<engineering_bridge_receipt>";
export const COMPLETION_RECEIPT_CLOSE = "</engineering_bridge_receipt>";

export type CompletionReceiptOutcome = "success" | "blocked";
export type CompletionReceiptStatus = "valid" | "missing" | "invalid";

export interface CompletionReceiptValidation {
  readonly name: string;
  readonly status: string;
}

export interface DevelopmentCompletionReceipt {
  readonly protocol_version: 1;
  readonly task_id: string;
  readonly work_branch: string;
  readonly outcome: CompletionReceiptOutcome;
  readonly summary: string;
  readonly head_commit?: string | undefined;
  readonly pr_url?: string | undefined;
  readonly report_path?: string | undefined;
  readonly validations: readonly CompletionReceiptValidation[];
  readonly blockers: readonly string[];
}

export interface CompletionReceiptIdentity {
  readonly taskId: string;
  readonly workBranch: string;
}

export type CompletionReceiptParseResult =
  | { readonly status: "valid"; readonly receipt: DevelopmentCompletionReceipt }
  | { readonly status: "missing" }
  | { readonly status: "invalid" };

type ReceiptObject = Record<string, unknown>;

function object(value: unknown): value is ReceiptObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return nonEmptyString(value) ? value : null;
}

/**
 * Validate and normalize a decoded receipt payload against the trusted task
 * identity. Unknown fields are deliberately not copied into the exposed
 * receipt.
 */
export function validateCompletionReceipt(
  value: unknown,
  identity: CompletionReceiptIdentity
): DevelopmentCompletionReceipt | undefined {
  if (!object(value) || value.protocol_version !== 1) return undefined;
  if (value.task_id !== identity.taskId || value.work_branch !== identity.workBranch) return undefined;
  if (value.outcome !== "success" && value.outcome !== "blocked") return undefined;
  if (!nonEmptyString(value.summary)) return undefined;
  if (!Array.isArray(value.validations) || !Array.isArray(value.blockers)) return undefined;

  const validations: CompletionReceiptValidation[] = [];
  for (const entry of value.validations) {
    if (!object(entry) || !nonEmptyString(entry.name) || !nonEmptyString(entry.status)) return undefined;
    validations.push({ name: entry.name, status: entry.status });
  }

  const blockers: string[] = [];
  for (const blocker of value.blockers) {
    if (typeof blocker !== "string") return undefined;
    blockers.push(blocker);
  }

  const headCommit = optionalString(value.head_commit);
  const prUrl = optionalString(value.pr_url);
  const reportPath = optionalString(value.report_path);
  if (headCommit === null || prUrl === null || reportPath === null) return undefined;

  return {
    protocol_version: 1,
    task_id: identity.taskId,
    work_branch: identity.workBranch,
    outcome: value.outcome,
    summary: value.summary,
    ...(headCommit === undefined ? {} : { head_commit: headCommit }),
    ...(prUrl === undefined ? {} : { pr_url: prUrl }),
    ...(reportPath === undefined ? {} : { report_path: reportPath }),
    validations,
    blockers
  };
}

/**
 * Parse the latest completion receipt block in a Codex final message.
 * Receipt failures are represented as data and never thrown to the task
 * runtime.
 */
export function parseCompletionReceipt(
  output: string,
  identity: CompletionReceiptIdentity
): CompletionReceiptParseResult {
  const opening = output.lastIndexOf(COMPLETION_RECEIPT_OPEN);
  const closing = output.lastIndexOf(COMPLETION_RECEIPT_CLOSE);
  if (opening < 0 && closing < 0) return { status: "missing" };
  if (opening < 0 || closing < opening + COMPLETION_RECEIPT_OPEN.length) return { status: "invalid" };

  const encoded = output.slice(opening + COMPLETION_RECEIPT_OPEN.length, closing).trim();
  if (encoded.length === 0) return { status: "invalid" };

  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded) as unknown;
  } catch {
    return { status: "invalid" };
  }

  const receipt = validateCompletionReceipt(decoded, identity);
  return receipt === undefined ? { status: "invalid" } : { status: "valid", receipt };
}

export const parseDevelopmentCompletionReceipt = parseCompletionReceipt;
