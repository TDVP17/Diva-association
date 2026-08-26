import { describe, it, expect } from "vitest";
import { isAdminRole } from "@/lib/constants";

describe("isAdminRole", () => {
  it("treats ADMIN as an admin", () => {
    expect(isAdminRole("ADMIN")).toBe(true);
  });

  it("treats PRESIDENT as an admin — full admin access plus global finance", () => {
    expect(isAdminRole("PRESIDENT")).toBe(true);
  });

  it("does not treat MEMBER as an admin", () => {
    expect(isAdminRole("MEMBER")).toBe(false);
  });

  it("handles null/undefined safely", () => {
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});
