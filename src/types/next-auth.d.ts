import type { DefaultSession } from "next-auth";
import type { AccountStatus, Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      accountStatus: AccountStatus;
      sponsorCode: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    accountStatus: AccountStatus;
    sponsorCode: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    accountStatus: AccountStatus;
    sponsorCode: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    accountStatus: AccountStatus;
    sponsorCode: string | null;
  }
}
