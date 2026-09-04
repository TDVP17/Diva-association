import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

const findUniqueTontineSession = vi.fn();
const findUniqueMembership = vi.fn();
const findManyUser = vi.fn().mockResolvedValue([]);
const txQueryRaw = vi.fn().mockResolvedValue(undefined);
const txFindUniqueMembership = vi.fn();
const txUpsertMembership = vi.fn();
const txCreateKycVerification = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tontineSession: { findUnique: (...a: unknown[]) => findUniqueTontineSession(...a) },
    membership: { findUnique: (...a: unknown[]) => findUniqueMembership(...a) },
    user: { findMany: (...a: unknown[]) => findManyUser(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: (...a: unknown[]) => txQueryRaw(...a),
        membership: {
          findUnique: (...a: unknown[]) => txFindUniqueMembership(...a),
          upsert: (...a: unknown[]) => txUpsertMembership(...a),
        },
        kycVerification: { create: (...a: unknown[]) => txCreateKycVerification(...a) },
      }),
  },
  // Passthrough — the retry behavior itself is covered by dedicated tests
  // in tests/prisma-retry.test.ts, not re-verified at every call site.
  withTransientRetry: async (fn: () => unknown) => fn(),
}));

const saveFile = vi.fn();
vi.mock("@/lib/storage", () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }));

const scheduleInAppNotifications = vi.fn();
vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: (...a: unknown[]) => scheduleInAppNotifications(...a),
}));

import { POST } from "@/app/api/sessions/[id]/kyc/route";

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

function fakeFormRequest(
  fields: Record<string, File | undefined>,
  referrer: { name?: string; phone?: string } = {},
): Request {
  const formData = new FormData();
  for (const [key, file] of Object.entries(fields)) {
    if (file) formData.append(key, file);
  }
  // Defaults to a valid referrer so tests targeting a different validation
  // branch don't have to think about this one too — the dedicated referrer
  // tests below override these explicitly.
  formData.append("referrerName", referrer.name ?? "Marie Ngo");
  formData.append("referrerPhone", referrer.phone ?? "677123456");
  return { formData: async () => formData } as unknown as Request;
}

const VALID_FRONT = () => makeFile("front.jpg", "image/jpeg", 100 * 1024);
const VALID_BACK = () => makeFile("back.jpg", "image/jpeg", 100 * 1024);
const VALID_SELFIE = () => makeFile("selfie.jpg", "image/jpeg", 100 * 1024);

const openTontineSession = {
  id: "session-1",
  status: "DRAFT",
  startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  maxSlots: null,
  isPaused: false,
  lockedAt: null,
  memberships: [],
};

describe("POST /api/sessions/[id]/kyc", () => {
  beforeEach(() => {
    auth.mockReset();
    findUniqueTontineSession.mockReset();
    findUniqueMembership.mockReset();
    findManyUser.mockReset().mockResolvedValue([]);
    txQueryRaw.mockReset().mockResolvedValue(undefined);
    txFindUniqueMembership.mockReset();
    txUpsertMembership.mockReset();
    txCreateKycVerification.mockReset();
    saveFile.mockReset();
    scheduleInAppNotifications.mockReset();

    auth.mockResolvedValue({ user: { id: "user-1", role: "MEMBER", name: "Jane" } });
  });

  it("400s with a field-specific errorKey when a required file is missing", async () => {
    const req = fakeFormRequest({ documentImage: VALID_FRONT(), documentBackImage: VALID_BACK() });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errorKey).toBe("kycMissingDocument");
    expect(body.errorVars.field).toBe("selfieImage");
    expect(findUniqueTontineSession).not.toHaveBeenCalled();
  });

  it("400s with a field-specific errorKey for an unsupported file type", async () => {
    const req = fakeFormRequest({
      documentImage: makeFile("front.gif", "image/gif", 10 * 1024),
      documentBackImage: VALID_BACK(),
      selfieImage: VALID_SELFIE(),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errorKey).toBe("kycInvalidDocumentType");
    expect(body.errorVars.field).toBe("documentImage");
    expect(body.errorVars.type).toBe("image/gif");
  });

  it("400s with a field-specific errorKey when one file exceeds the per-file limit", async () => {
    const req = fakeFormRequest({
      documentImage: VALID_FRONT(),
      documentBackImage: makeFile("back.jpg", "image/jpeg", 2 * 1024 * 1024),
      selfieImage: VALID_SELFIE(),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errorKey).toBe("kycDocumentTooLarge");
    expect(body.errorVars.field).toBe("documentBackImage");
    expect(body.errorVars.max).toBe("1.5MB");
  });

  it("400s with kycCombinedTooLarge when every file is individually fine but the total isn't", async () => {
    const req = fakeFormRequest({
      documentImage: makeFile("front.jpg", "image/jpeg", 1.4 * 1024 * 1024),
      documentBackImage: makeFile("back.jpg", "image/jpeg", 1.4 * 1024 * 1024),
      selfieImage: makeFile("selfie.jpg", "image/jpeg", 1.4 * 1024 * 1024),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errorKey).toBe("kycCombinedTooLarge");
    expect(findUniqueTontineSession).not.toHaveBeenCalled();
  });

  it("400s when the referrer name is missing", async () => {
    const req = fakeFormRequest(
      { documentImage: VALID_FRONT(), documentBackImage: VALID_BACK(), selfieImage: VALID_SELFIE() },
      { name: "" },
    );
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errorKey).toBe("kycMissingReferrerName");
    expect(findUniqueTontineSession).not.toHaveBeenCalled();
  });

  it("400s when the referrer phone number is too short to be real", async () => {
    const req = fakeFormRequest(
      { documentImage: VALID_FRONT(), documentBackImage: VALID_BACK(), selfieImage: VALID_SELFIE() },
      { phone: "123" },
    );
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errorKey).toBe("kycInvalidReferrerPhone");
  });

  it("identifies exactly which document failed to upload to storage, and doesn't leak the raw storage error", async () => {
    findUniqueTontineSession.mockResolvedValue(openTontineSession);
    findUniqueMembership.mockResolvedValue(null);
    saveFile
      .mockResolvedValueOnce("ok") // front
      .mockRejectedValueOnce(new Error("Supabase Storage upload failed: bucket not found")); // back

    const req = fakeFormRequest({
      documentImage: VALID_FRONT(),
      documentBackImage: VALID_BACK(),
      selfieImage: VALID_SELFIE(),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.errorKey).toBe("kycUploadFailed");
    expect(body.errorVars.field).toBe("documentBackImage");
    expect(body.error).not.toMatch(/bucket not found/);
    expect(txCreateKycVerification).not.toHaveBeenCalled();
  });

  it("accepts 3 valid documents, uploads each, and creates a PENDING membership + KYC row", async () => {
    findUniqueTontineSession.mockResolvedValue(openTontineSession);
    findUniqueMembership.mockResolvedValue(null);
    saveFile.mockResolvedValue("ok");
    txFindUniqueMembership.mockResolvedValue(null);
    txUpsertMembership.mockResolvedValue({ id: "membership-1" });
    txCreateKycVerification.mockResolvedValue({});
    findManyUser.mockResolvedValue([{ id: "admin-1" }]);

    const req = fakeFormRequest({
      documentImage: VALID_FRONT(),
      documentBackImage: VALID_BACK(),
      selfieImage: VALID_SELFIE(),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "PENDING" });
    expect(saveFile).toHaveBeenCalledTimes(3);
    expect(txCreateKycVerification).toHaveBeenCalledTimes(1);
    expect(txCreateKycVerification.mock.calls[0][0]).toMatchObject({
      data: expect.objectContaining({ referrerName: "Marie Ngo", referrerPhone: "677123456" }),
    });
    expect(scheduleInAppNotifications).toHaveBeenCalledTimes(1);
  });

  it("returns a specific errorKey (not the generic fallback) when the session lookup itself fails", async () => {
    findUniqueTontineSession.mockRejectedValue(new Error("DB connection reset"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = fakeFormRequest({
      documentImage: VALID_FRONT(),
      documentBackImage: VALID_BACK(),
      selfieImage: VALID_SELFIE(),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.errorKey).toBe("kycSessionLookupFailed");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[sessions/kyc] session lookup failed"), expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("returns a specific errorKey when the membership+KYC transaction itself fails, distinct from the generic fallback", async () => {
    findUniqueTontineSession.mockResolvedValue(openTontineSession);
    findUniqueMembership.mockResolvedValue(null);
    saveFile.mockResolvedValue("ok");
    txQueryRaw.mockRejectedValue(new Error("connection terminated"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = fakeFormRequest({
      documentImage: VALID_FRONT(),
      documentBackImage: VALID_BACK(),
      selfieImage: VALID_SELFIE(),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.errorKey).toBe("kycTransactionFailed");
    consoleSpy.mockRestore();
  });

  it("still returns success when admin-notification scheduling fails — the submission itself was already saved", async () => {
    findUniqueTontineSession.mockResolvedValue(openTontineSession);
    findUniqueMembership.mockResolvedValue(null);
    saveFile.mockResolvedValue("ok");
    txFindUniqueMembership.mockResolvedValue(null);
    txUpsertMembership.mockResolvedValue({ id: "membership-1" });
    txCreateKycVerification.mockResolvedValue({});
    findManyUser.mockRejectedValue(new Error("admin lookup exploded"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = fakeFormRequest({
      documentImage: VALID_FRONT(),
      documentBackImage: VALID_BACK(),
      selfieImage: VALID_SELFIE(),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "session-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "PENDING" });
    expect(txCreateKycVerification).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[sessions/kyc] admin notification scheduling failed"),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
