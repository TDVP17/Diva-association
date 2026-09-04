import { describe, it, expect } from "vitest";
import { detectMobileMoneyProvider, fapshiMediumFor } from "@/lib/mobile-money-provider";

describe("detectMobileMoneyProvider", () => {
  it("detects MTN for the 67x block", () => {
    expect(detectMobileMoneyProvider("670123456")).toBe("MTN");
    expect(detectMobileMoneyProvider("677123456")).toBe("MTN");
    expect(detectMobileMoneyProvider("679999999")).toBe("MTN");
  });

  it("detects Orange for the 69x block", () => {
    expect(detectMobileMoneyProvider("690123456")).toBe("ORANGE");
    expect(detectMobileMoneyProvider("699999999")).toBe("ORANGE");
  });

  it("detects MTN for the 650-654 and 680-684 sub-ranges", () => {
    expect(detectMobileMoneyProvider("650123456")).toBe("MTN");
    expect(detectMobileMoneyProvider("654123456")).toBe("MTN");
    expect(detectMobileMoneyProvider("680123456")).toBe("MTN");
    expect(detectMobileMoneyProvider("684123456")).toBe("MTN");
  });

  it("detects Orange for the 655-659 and 685-689 sub-ranges", () => {
    expect(detectMobileMoneyProvider("655123456")).toBe("ORANGE");
    expect(detectMobileMoneyProvider("659123456")).toBe("ORANGE");
    expect(detectMobileMoneyProvider("685123456")).toBe("ORANGE");
    expect(detectMobileMoneyProvider("689123456")).toBe("ORANGE");
  });

  it("returns null for a number outside any known range", () => {
    expect(detectMobileMoneyProvider("620123456")).toBeNull();
    expect(detectMobileMoneyProvider("212345678")).toBeNull();
  });
});

describe("fapshiMediumFor", () => {
  it("maps ORANGE to Fapshi's \"orange money\" medium", () => {
    expect(fapshiMediumFor("ORANGE")).toBe("orange money");
  });

  it("maps MTN to Fapshi's \"mobile money\" medium", () => {
    expect(fapshiMediumFor("MTN")).toBe("mobile money");
  });
});
