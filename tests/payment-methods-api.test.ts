import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

const findMany = vi.fn();
const count = vi.fn();
const create = vi.fn();
const deleteMany = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    savedPaymentMethod: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
      create: (...a: unknown[]) => create(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

import { GET, POST } from "@/app/api/profile/payment-methods/route";
import { DELETE } from "@/app/api/profile/payment-methods/[id]/route";
import { POST as setDefault } from "@/app/api/profile/payment-methods/[id]/set-default/route";

function fakeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

describe("GET /api/profile/payment-methods", () => {
  beforeEach(() => {
    auth.mockReset();
    findMany.mockReset();
  });

  it("401s when unauthenticated", async () => {
    auth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the caller's own userId", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    findMany.mockResolvedValue([]);
    await GET();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }));
  });
});

describe("POST /api/profile/payment-methods", () => {
  beforeEach(() => {
    auth.mockReset();
    count.mockReset();
    create.mockReset();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("401s when unauthenticated", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(fakeRequest({ phone: "677123456" }));
    expect(res.status).toBe(401);
  });

  it("400s an invalid phone number before touching the database", async () => {
    const res = await POST(fakeRequest({ phone: "123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorKey).toBe("invalidMobileMoneyPhone");
    expect(count).not.toHaveBeenCalled();
  });

  it("400s a number outside any known Orange/MTN range, never guessing a provider", async () => {
    const res = await POST(fakeRequest({ phone: "620123456" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorKey).toBe("unrecognizedMobileMoneyProvider");
    expect(create).not.toHaveBeenCalled();
  });

  it("409s once the caller already has 4 saved methods", async () => {
    count.mockResolvedValue(4);
    const res = await POST(fakeRequest({ phone: "677123456" }));
    expect(res.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("detects and stores the provider server-side — never trusts a client-supplied one", async () => {
    count.mockResolvedValue(0);
    create.mockResolvedValue({ id: "spm-1", provider: "MTN", label: null, phone: "677123456", isDefault: true });
    // A malicious/buggy client sending its own "provider" field must be ignored.
    const res = await POST(fakeRequest({ phone: "677123456", provider: "ORANGE" }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: "MTN", phone: "677123456" }) }),
    );
  });

  it("makes the very first saved method the default automatically", async () => {
    count.mockResolvedValue(0);
    create.mockResolvedValue({});
    await POST(fakeRequest({ phone: "677123456" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }));
  });

  it("does not default a second saved method", async () => {
    count.mockResolvedValue(1);
    create.mockResolvedValue({});
    await POST(fakeRequest({ phone: "690123456" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDefault: false }) }));
  });

  it("409s a duplicate number (unique constraint) with a friendly message, not a raw DB error", async () => {
    count.mockResolvedValue(0);
    create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const res = await POST(fakeRequest({ phone: "677123456" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.errorKey).toBe("savedPaymentMethodDuplicate");
  });
});

describe("DELETE /api/profile/payment-methods/[id]", () => {
  beforeEach(() => {
    auth.mockReset();
    deleteMany.mockReset();
    findMany.mockReset();
    update.mockReset();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("401s when unauthenticated", async () => {
    auth.mockResolvedValue(null);
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: "spm-1" }) });
    expect(res.status).toBe(401);
  });

  it("scopes the delete to both the id AND the caller's own userId", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([]);
    await DELETE({} as Request, { params: Promise.resolve({ id: "spm-1" }) });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "spm-1", userId: "user-1" } });
  });

  it("404s when the method doesn't exist or belongs to someone else", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: "not-mine" }) });
    expect(res.status).toBe(404);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("promotes the oldest remaining method to default if the deleted one was the default", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([
      { id: "spm-2", isDefault: false },
      { id: "spm-3", isDefault: false },
    ]);
    update.mockResolvedValue({});
    await DELETE({} as Request, { params: Promise.resolve({ id: "spm-1" }) });
    expect(update).toHaveBeenCalledWith({ where: { id: "spm-2" }, data: { isDefault: true } });
  });

  it("does not touch isDefault if a default already remains", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([{ id: "spm-2", isDefault: true }]);
    await DELETE({} as Request, { params: Promise.resolve({ id: "spm-1" }) });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("POST /api/profile/payment-methods/[id]/set-default", () => {
  beforeEach(() => {
    auth.mockReset();
    findUnique.mockReset();
    transaction.mockReset();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("401s when unauthenticated", async () => {
    auth.mockResolvedValue(null);
    const res = await setDefault({} as Request, { params: Promise.resolve({ id: "spm-1" }) });
    expect(res.status).toBe(401);
  });

  it("404s when the method belongs to a different user", async () => {
    findUnique.mockResolvedValue({ id: "spm-1", userId: "someone-else" });
    const res = await setDefault({} as Request, { params: Promise.resolve({ id: "spm-1" }) });
    expect(res.status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("unsets every other default before setting the new one, atomically", async () => {
    findUnique.mockResolvedValue({ id: "spm-1", userId: "user-1" });
    transaction.mockResolvedValue([{}, {}]);
    const res = await setDefault({} as Request, { params: Promise.resolve({ id: "spm-1" }) });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
  });
});
