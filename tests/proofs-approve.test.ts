import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/lib/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
}));

const findManyContribution = vi.fn();
const updateContribution = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contribution: {
      findMany: (...a: unknown[]) => findManyContribution(...a),
      update: (...a: unknown[]) => updateContribution(...a),
    },
  },
}));

const settleContributionsBatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/settle-contribution", () => ({
  settleContributionsBatch: (...a: unknown[]) => settleContributionsBatch(...a),
}));

const logAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({
  logAudit: (...a: unknown[]) => logAudit(...a),
}));

import { POST } from "@/app/api/admin/contributions/proofs/approve/route";

function makeReq(body: unknown) {
  return new Request("https://www.divaasso.com/api/admin/contributions/proofs/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/contributions/proofs/approve — batch settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  });

  it("collects all approved contributions and invokes settleContributionsBatch once so the member gets 1 consolidated email", async () => {
    const slotRow = (id: string, beneficiaryName: string) => ({
      id,
      status: "PENDING",
      membershipSlotId: `slot-${id}`,
      proofImageUrl: `proofs/${id}.png`,
      proofImageUrls: [`proofs/${id}.png`],
      paidByUserId: "member-1",
      amountPaid: 2500,
      feePaid: 100,
      finePaid: 0,
      membershipSlot: {
        id: `slot-${id}`,
        beneficiaryName,
        membership: {
          userId: "member-1",
          tontineSessionId: "session-1",
          user: { id: "member-1", name: "Femme Batcham Bertoua", email: "femme@example.com", preferredLang: "fr" },
          tontineSession: { id: "session-1", title: "Chaque dimanche", type: "HEBDO_SUNDAY", amount: 2500, fee: 100 },
        },
      },
      paidByUser: null,
    });

    const rows = [slotRow("c1", "Joël1"), slotRow("c2", "Joël2"), slotRow("c3", "Joël3")];
    findManyContribution.mockResolvedValue(rows);
    updateContribution
      .mockResolvedValueOnce(rows[0])
      .mockResolvedValueOnce(rows[1])
      .mockResolvedValueOnce(rows[2]);

    const res = await POST(makeReq({ contributionIds: ["c1", "c2", "c3"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, settledCount: 3 });

    expect(settleContributionsBatch).toHaveBeenCalledTimes(1);
    expect(settleContributionsBatch).toHaveBeenCalledWith(
      rows,
      expect.objectContaining({
        origin: "https://www.divaasso.com",
      }),
    );
  });

  it("rejects approving contributions without an uploaded proof image", async () => {
    findManyContribution.mockResolvedValue([
      {
        id: "c1",
        status: "UNPAID",
        proofImageUrl: null,
        proofImageUrls: [],
        membershipSlot: {
          beneficiaryName: "Joël1",
          membership: { tontineSession: { id: "session-1", amount: 2500, fee: 100 } },
        },
      },
    ]);

    const res = await POST(makeReq({ contributionIds: ["c1"] }));
    expect(res.status).toBe(400);
    expect(settleContributionsBatch).not.toHaveBeenCalled();
  });
});

