import crypto from "crypto";
import type { Prisma, WalletTransactionType } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";

export type PrismaTx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export class InsufficientWalletBalanceError extends Error {
  constructor(
    public readonly available: number,
    public readonly required: number,
  ) {
    super(
      `Solde portefeuille insuffisant : disponible ${available.toLocaleString("fr-FR")} FCFA, requis ${required.toLocaleString("fr-FR")} FCFA.`,
    );
    this.name = "InsufficientWalletBalanceError";
  }
}

export interface WalletLedgerInput {
  userId: string;
  amount: number;
  type: WalletTransactionType;
  description: string;
  fee?: number;
  reference?: string;
  fapshiTxRef?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface WalletLedgerResult {
  transactionId: string;
  balanceBefore: number;
  balanceAfter: number;
  reference: string;
}

function makeReference(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Atomically credits a user's DIVA Wallet inside an existing Prisma transaction,
 * recording exact balanceBefore and balanceAfter for an immutable audit trail.
 */
export async function creditWalletTx(
  tx: PrismaTx,
  input: WalletLedgerInput,
): Promise<WalletLedgerResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Le montant à créditer doit être strictement positif.");
  }

  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { walletBalance: true },
  });
  if (!user) throw new Error("Utilisateur introuvable.");

  const balanceBefore = Number(user.walletBalance || 0);
  const balanceAfter = Math.round((balanceBefore + input.amount) * 100) / 100;
  const reference = input.reference || makeReference("WCR");

  await tx.user.update({
    where: { id: input.userId },
    data: { walletBalance: balanceAfter },
  });

  const wtx = await tx.walletTransaction.create({
    data: {
      userId: input.userId,
      amount: input.amount,
      fee: input.fee ?? 0,
      balanceBefore,
      balanceAfter,
      reference,
      status: "COMPLETED",
      type: input.type,
      description: input.description,
      fapshiTxRef: input.fapshiTxRef ?? null,
      metadata: input.metadata,
    },
  });

  return {
    transactionId: wtx.id,
    balanceBefore,
    balanceAfter,
    reference,
  };
}

/**
 * Atomically debits a user's DIVA Wallet inside an existing Prisma transaction.
 * Enforces the non-negative balance invariant (balance >= 0) with atomic conditional update.
 */
export async function debitWalletTx(
  tx: PrismaTx,
  input: WalletLedgerInput,
): Promise<WalletLedgerResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Le montant à débiter doit être strictement positif.");
  }

  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { walletBalance: true },
  });
  if (!user) throw new Error("Utilisateur introuvable.");

  const balanceBefore = Number(user.walletBalance || 0);
  if (balanceBefore < input.amount) {
    throw new InsufficientWalletBalanceError(balanceBefore, input.amount);
  }

  // Atomic conditional decrement to guarantee balance never goes negative under concurrency
  const updated = await tx.user.updateMany({
    where: {
      id: input.userId,
      walletBalance: { gte: input.amount },
    },
    data: {
      walletBalance: { decrement: input.amount },
    },
  });

  if (updated.count === 0) {
    throw new InsufficientWalletBalanceError(balanceBefore, input.amount);
  }

  const refreshed = await tx.user.findUnique({
    where: { id: input.userId },
    select: { walletBalance: true },
  });
  const balanceAfter = Number(refreshed?.walletBalance ?? Math.max(0, balanceBefore - input.amount));
  const reference = input.reference || makeReference("WDB");

  const wtx = await tx.walletTransaction.create({
    data: {
      userId: input.userId,
      amount: input.amount,
      fee: input.fee ?? 0,
      balanceBefore,
      balanceAfter,
      reference,
      status: "COMPLETED",
      type: input.type,
      description: input.description,
      fapshiTxRef: input.fapshiTxRef ?? null,
      metadata: input.metadata,
    },
  });

  return {
    transactionId: wtx.id,
    balanceBefore,
    balanceAfter,
    reference,
  };
}
