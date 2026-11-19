import { describe, it, expect, vi, beforeEach } from "vitest";
import { awardStarsForCompletedSession, MIN_STARS_FOR_LOAN } from "@/lib/stars";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tontineSession: {
      findUnique: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleInAppNotifications: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/email/resend", () => ({
  sendEmailSafe: vi.fn().mockResolvedValue(undefined),
}));

describe("Stars Awarding System & Loan Eligibility Rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strictly enforces MIN_STARS_FOR_LOAN = 4", () => {
    expect(MIN_STARS_FOR_LOAN).toBe(4);
  });

  it("does NOT award stars if the tontine session is private", async () => {
    vi.mocked(prisma.tontineSession.findUnique).mockResolvedValueOnce({
      id: "sess-private",
      title: "Private Tontine",
      isPrivate: true,
      memberships: [
        {
          id: "m-1",
          status: "APPROVED",
          user: { id: "u-1", name: "User 1", stars: 2 },
          slots: [
            {
              fines: [],
              contributions: [{ id: "c-1" }],
            },
          ],
        },
      ],
    } as any);

    const result = await awardStarsForCompletedSession("sess-private");
    expect(result.updatedCount).toBe(0);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("does NOT award stars if the member had even 1 fine during the session", async () => {
    vi.mocked(prisma.tontineSession.findUnique).mockResolvedValueOnce({
      id: "sess-public",
      title: "Public Tontine",
      isPrivate: false,
      memberships: [
        {
          id: "m-1",
          status: "APPROVED",
          user: { id: "u-1", name: "User 1", stars: 2 },
          slots: [
            {
              fines: [{ id: "fine-1" }], // had a fine!
              contributions: [{ id: "c-1" }],
            },
          ],
        },
      ],
    } as any);

    const result = await awardStarsForCompletedSession("sess-public");
    expect(result.updatedCount).toBe(0);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("awards +1 star when member finishes public session with 0 fines", async () => {
    vi.mocked(prisma.tontineSession.findUnique).mockResolvedValueOnce({
      id: "sess-public",
      title: "Public Tontine",
      isPrivate: false,
      memberships: [
        {
          id: "m-1",
          status: "APPROVED",
          user: { id: "u-1", name: "User 1", stars: 3, email: "user1@example.com", preferredLang: "fr" },
          slots: [
            {
              fines: [], // 0 fines!
              contributions: [{ id: "c-1" }],
            },
          ],
        },
      ],
    } as any);

    const result = await awardStarsForCompletedSession("sess-public");
    expect(result.updatedCount).toBe(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: { stars: 4 },
    });
  });

  it("caps stars at 5 max", async () => {
    vi.mocked(prisma.tontineSession.findUnique).mockResolvedValueOnce({
      id: "sess-public",
      title: "Public Tontine",
      isPrivate: false,
      memberships: [
        {
          id: "m-1",
          status: "APPROVED",
          user: { id: "u-1", name: "User 1", stars: 5 },
          slots: [
            {
              fines: [],
              contributions: [{ id: "c-1" }],
            },
          ],
        },
      ],
    } as any);

    const result = await awardStarsForCompletedSession("sess-public");
    expect(result.updatedCount).toBe(0);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
