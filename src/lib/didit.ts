// Didit identity-verification client. API reference: https://docs.didit.me
// Auth: `x-api-key` header on every request.

const DIDIT_BASE_URL = process.env.DIDIT_BASE_URL ?? "https://verification.didit.me";
const DIDIT_API_KEY = process.env.DIDIT_API_KEY ?? "";
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID ?? "";

export interface CreateSessionParams {
  vendorData: string;
  callback: string;
}

export interface CreateSessionResult {
  session_id: string;
  url: string;
  status: string;
}

export type DiditDecisionStatus =
  | "Approved"
  | "Declined"
  | "In Review"
  | "In Progress"
  | "Not Started"
  | "Expired"
  | "Kyc Expired"
  | "Resubmitted"
  | "Awaiting User"
  | "Abandoned";

export interface DiditFeatureResult {
  node_id: string;
  status: string;
  score?: number;
}

export interface SessionDecisionResult {
  session_id: string;
  status: DiditDecisionStatus;
  id_verifications: DiditFeatureResult[] | null;
  face_matches: DiditFeatureResult[] | null;
}

class DiditError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "DiditError";
  }
}

function authHeaders(): Record<string, string> {
  return {
    "x-api-key": DIDIT_API_KEY,
    "Content-Type": "application/json",
  };
}

export async function createVerificationSession(
  params: CreateSessionParams,
): Promise<CreateSessionResult> {
  if (!DIDIT_API_KEY || !DIDIT_WORKFLOW_ID) {
    // Every request below still gets sent (Didit will reject it), but this
    // log makes the real cause visible immediately in server logs instead
    // of requiring a guess from Didit's generic rejection response.
    console.error(
      "[didit] DIDIT_API_KEY or DIDIT_WORKFLOW_ID is not configured in this environment — verification requests will fail",
    );
  }

  const res = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: params.vendorData,
      callback: params.callback,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new DiditError(body?.message ?? "Didit session creation failed", res.status);
  }
  return body as CreateSessionResult;
}

export async function getSessionDecision(sessionId: string): Promise<SessionDecisionResult> {
  const res = await fetch(`${DIDIT_BASE_URL}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
    method: "GET",
    headers: authHeaders(),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new DiditError(body?.message ?? "Didit decision lookup failed", res.status);
  }
  return body as SessionDecisionResult;
}

export { DiditError };
