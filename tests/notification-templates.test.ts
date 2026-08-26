import { describe, it, expect } from "vitest";
import { translate } from "@/lib/i18n/translations";

describe("notification message personalization", () => {
  it("never sends a generic 'Hello member' — the name is always interpolated", () => {
    const msg = translate("en", "contributionReminderMessage", { name: "Sarah", cotisation: "September Monthly Tontine" });
    expect(msg).toContain("Sarah");
    expect(msg).not.toContain("{name}");
    expect(msg).toContain("September Monthly Tontine");
  });

  it("fine reminder includes the member's name and the fine amount", () => {
    const msg = translate("en", "fineReminderMessage", { name: "Sarah", amount: "15,000 F" });
    expect(msg).toContain("Sarah");
    expect(msg).toContain("15,000 F");
  });

  it("food-turn message is personalized per member", () => {
    const sarah = translate("en", "foodTurnMessage", { name: "Sarah" });
    const john = translate("en", "foodTurnMessage", { name: "John" });
    expect(sarah).toContain("Sarah");
    expect(john).toContain("John");
    expect(sarah).not.toBe(john);
  });

  it("supports French templates with the same variables", () => {
    const msg = translate("fr", "contributionReminderMessage", { name: "Marie", cotisation: "Tontine de septembre" });
    expect(msg).toContain("Marie");
    expect(msg).toContain("Tontine de septembre");
  });
});
