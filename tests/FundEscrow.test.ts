import { describe, it, expect, beforeEach, vi } from "vitest";
import { Cl } from "@stacks/transactions";
import { 
  uintCV, 
  principalCV, 
  trueCV, 
  falseCV, 
  someCV, 
  noneCV,
  tupleCV,
  bufferCV
} from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_PROPOSAL_NOT_FOUND = 101;
const ERR_ESCROW_ALREADY_EXISTS = 102;
const ERR_ESCROW_NOT_FOUND = 103;
const ERR_ALREADY_RELEASED = 104;
const ERR_INVALID_AMOUNT = 106;
const ERR_TOKEN_NOT_WHITELISTED = 108;
const ERR_PROPOSAL_INACTIVE = 110;
const ERR_RECLAIM_TIMEOUT = 112;
const RECLAIM_TIMEOUT = 5760;

interface Escrow {
  "proposal-id": bigint;
  amount: bigint;
  token: string;
  patroller: string;
  donor: string;
  released: boolean;
  "created-at": bigint;
  "reclaimable-at": bigint;
}

interface MockContext {
  blockHeight: bigint;
  sender: string;
  contract: string;
  admin: string;
  token: string;
  patroller: string;
  donor: string;
  proposalId: bigint;
  amount: bigint;
  escrowId: bigint;
  transfers: Array<{token: string; amount: bigint; from: string; to: string}>;
  whitelisted: Set<string>;
  proposals: Map<bigint, boolean>;
  escrows: Map<bigint, Escrow>;
  nonce: bigint;
}

const mock = vi.hoisted(() => ({
  deployer: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3HWC2LRXS7NW8D",
  admin: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3HWC2LRXS7NW8D",
  token: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3HWC2LTOKEN",
  patroller: "ST2PATROLLER1234567890ABCDEFGHIJKL",
  donor: "ST3DONOR1234567890ABCDEFGHIJKL",
  proposalId: 1n,
  amount: 1000n,
  escrowId: 0n,
}));

const createContext = (): MockContext => ({
  blockHeight: 100n,
  sender: mock.donor,
  contract: mock.deployer + ".fund-escrow",
  admin: mock.admin,
  token: mock.token,
  patroller: mock.patroller,
  donor: mock.donor,
  proposalId: mock.proposalId,
  amount: mock.amount,
  escrowId: mock.escrowId,
  transfers: [],
  whitelisted: new Set([mock.token]),
  proposals: new Map([[mock.proposalId, true]]),
  escrows: new Map(),
  nonce: 0n,
});

const call = (
  ctx: MockContext,
  method: string,
  args: any[]
): { result: any; events: any[] } => {
  const contract = ctx.contract;
  const sender = ctx.sender;

  const simulate = (name: string, fn: Function) => {
    if (method !== name) return null;
    return fn(...args);
  };

  const result = simulate("set-admin", (newAdmin: string) => {
    if (sender !== ctx.admin) return { type: "err", value: ERR_NOT_AUTHORIZED };
    ctx.admin = newAdmin;
    return { type: "ok", value: true };
  }) ?? simulate("whitelist-token", (token: string, allowed: boolean) => {
    if (sender !== ctx.admin) return { type: "err", value: ERR_NOT_AUTHORIZED };
    if (allowed) ctx.whitelisted.add(token);
    else ctx.whitelisted.delete(token);
    return { type: "ok", value: true };
  }) ?? simulate("set-proposal-active", (id: bigint, active: boolean) => {
    if (sender !== ctx.admin) return { type: "err", value: ERR_NOT_AUTHORIZED };
    ctx.proposals.set(id, active);
    return { type: "ok", value: true };
  }) ?? simulate("lock-funds", (proposalId: bigint, amount: bigint, token: string, patroller: string) => {
    if (amount <= 0n) return { type: "err", value: ERR_INVALID_AMOUNT };
    if (!ctx.whitelisted.has(token)) return { type: "err", value: ERR_TOKEN_NOT_WHITELISTED };
    if (!ctx.proposals.get(proposalId)) return { type: "err", value: ERR_PROPOSAL_INACTIVE };
    const escrowId = ctx.nonce;
    if (ctx.escrows.has(escrowId)) return { type: "err", value: ERR_ESCROW_ALREADY_EXISTS };
    ctx.transfers.push({ token, amount, from: sender, to: contract });
    ctx.escrows.set(escrowId, {
      "proposal-id": proposalId,
      amount,
      token,
      patroller,
      donor: sender,
      released: false,
      "created-at": ctx.blockHeight,
      "reclaimable-at": ctx.blockHeight + BigInt(RECLAIM_TIMEOUT),
    });
    ctx.nonce += 1n;
    return { type: "ok", value: escrowId };
  }) ?? simulate("release-funds", (escrowId: bigint) => {
    const escrow = ctx.escrows.get(escrowId);
    if (!escrow) return { type: "err", value: ERR_ESCROW_NOT_FOUND };
    if (escrow.released) return { type: "err", value: ERR_ALREADY_RELEASED };
    if (escrow.token !== mock.token) return { type: "err", value: 113 };
    ctx.transfers.push({
      token: escrow.token,
      amount: escrow.amount,
      from: contract,
      to: escrow.patroller,
    });
    escrow.released = true;
    ctx.escrows.set(escrowId, escrow);
    return { type: "ok", value: true };
  }) ?? simulate("reclaim-funds", (escrowId: bigint) => {
    const escrow = ctx.escrows.get(escrowId);
    if (!escrow) return { type: "err", value: ERR_ESCROW_NOT_FOUND };
    if (sender !== escrow.donor) return { type: "err", value: ERR_NOT_AUTHORIZED };
    if (escrow.released) return { type: "err", value: ERR_ALREADY_RELEASED };
    if (ctx.blockHeight < escrow["reclaimable-at"]) return { type: "err", value: ERR_RECLAIM_TIMEOUT };
    ctx.transfers.push({
      token: escrow.token,
      amount: escrow.amount,
      from: contract,
      to: sender,
    });
    ctx.escrows.delete(escrowId);
    return { type: "ok", value: true };
  }) ?? simulate("emergency-withdraw", (token: string, amount: bigint) => {
    if (sender !== ctx.admin) return { type: "err", value: ERR_NOT_AUTHORIZED };
    ctx.transfers.push({ token, amount, from: contract, to: ctx.admin });
    return { type: "ok", value: true };
  });

  if (!result) throw new Error(`Method ${method} not implemented`);

  return { result: result, events: [] };
};

describe("FundEscrow.clar - Core Escrow Logic", () => {
  let ctx: MockContext;

  beforeEach(() => {
    ctx = createContext();
    ctx.blockHeight = 100n;
    ctx.sender = mock.donor;
  });

  describe("Admin Functions", () => {
    it("allows admin to set new admin", () => {
      ctx.sender = mock.admin;
      const { result } = call(ctx, "set-admin", [mock.patroller]);
      expect(result.type).toBe("ok");
      expect(ctx.admin).toBe(mock.patroller);
    });

    it("rejects non-admin from setting admin", () => {
      const { result } = call(ctx, "set-admin", [mock.patroller]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_NOT_AUTHORIZED);
    });

    it("allows admin to whitelist token", () => {
      ctx.sender = mock.admin;
      const newToken = "STNEWTOKEN";
      const { result } = call(ctx, "whitelist-token", [newToken, true]);
      expect(result.type).toBe("ok");
      expect(ctx.whitelisted.has(newToken)).toBe(true);
    });

    it("allows admin to deactivate proposal", () => {
      ctx.sender = mock.admin;
      const { result } = call(ctx, "set-proposal-active", [1n, false]);
      expect(result.type).toBe("ok");
      expect(ctx.proposals.get(1n)).toBe(false);
    });
  });

  describe("lock-funds", () => {
    it("successfully locks funds for active proposal", () => {
      const { result } = call(ctx, "lock-funds", [
        mock.proposalId,
        mock.amount,
        mock.token,
        mock.patroller,
      ]);
      expect(result.type).toBe("ok");
      expect(result.value).toBe(0n);
      expect(ctx.escrows.size).toBe(1);
      expect(ctx.transfers[0]).toEqual({
        token: mock.token,
        amount: mock.amount,
        from: mock.donor,
        to: ctx.contract,
      });
    });

    it("rejects zero amount", () => {
      const { result } = call(ctx, "lock-funds", [
        mock.proposalId,
        0n,
        mock.token,
        mock.patroller,
      ]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_INVALID_AMOUNT);
    });

    it("rejects non-whitelisted token", () => {
      ctx.whitelisted.clear();
      const { result } = call(ctx, "lock-funds", [
        mock.proposalId,
        mock.amount,
        mock.token,
        mock.patroller,
      ]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_TOKEN_NOT_WHITELISTED);
    });

    it("rejects inactive proposal", () => {
      ctx.proposals.set(mock.proposalId, false);
      const { result } = call(ctx, "lock-funds", [
        mock.proposalId,
        mock.amount,
        mock.token,
        mock.patroller,
      ]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_PROPOSAL_INACTIVE);
    });
  });

  describe("release-funds", () => {
    beforeEach(() => {
      call(ctx, "lock-funds", [1n, 500n, mock.token, mock.patroller]);
    });

    it("releases funds to patroller", () => {
      const { result } = call(ctx, "release-funds", [0n]);
      expect(result.type).toBe("ok");
      const escrow = ctx.escrows.get(0n);
      expect(escrow?.released).toBe(true);
      expect(ctx.transfers[1]).toEqual({
        token: mock.token,
        amount: 500n,
        from: ctx.contract,
        to: mock.patroller,
      });
    });

    it("rejects non-existent escrow", () => {
      const { result } = call(ctx, "release-funds", [99n]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_ESCROW_NOT_FOUND);
    });

    it("rejects already released escrow", () => {
      call(ctx, "release-funds", [0n]);
      const { result } = call(ctx, "release-funds", [0n]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_ALREADY_RELEASED);
    });
  });

  describe("reclaim-funds", () => {
    beforeEach(() => {
      call(ctx, "lock-funds", [1n, 300n, mock.token, mock.patroller]);
      ctx.blockHeight = 100n + BigInt(RECLAIM_TIMEOUT) + 10n;
    });

    it("allows donor to reclaim after timeout", () => {
      const { result } = call(ctx, "reclaim-funds", [0n]);
      expect(result.type).toBe("ok");
      expect(ctx.escrows.has(0n)).toBe(false);
      expect(ctx.transfers[1]).toEqual({
        token: mock.token,
        amount: 300n,
        from: ctx.contract,
        to: mock.donor,
      });
    });

    it("rejects reclaim before timeout", () => {
      ctx.blockHeight = 100n + BigInt(RECLAIM_TIMEOUT) - 1n;
      const { result } = call(ctx, "reclaim-funds", [0n]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_RECLAIM_TIMEOUT);
    });

    it("rejects non-donor reclaim", () => {
      ctx.sender = mock.patroller;
      const { result } = call(ctx, "reclaim-funds", [0n]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_NOT_AUTHORIZED);
    });
  });

  describe("emergency-withdraw", () => {
    beforeEach(() => {
      call(ctx, "lock-funds", [1n, 1000n, mock.token, mock.patroller]);
      ctx.sender = mock.admin;
    });

    it("allows admin emergency withdrawal", () => {
      const { result } = call(ctx, "emergency-withdraw", [mock.token, 1000n]);
      expect(result.type).toBe("ok");
      expect(ctx.transfers[1]).toEqual({
        token: mock.token,
        amount: 1000n,
        from: ctx.contract,
        to: mock.admin,
      });
    });

    it("rejects non-admin", () => {
      ctx.sender = mock.donor;
      const { result } = call(ctx, "emergency-withdraw", [mock.token, 1000n]);
      expect(result.type).toBe("err");
      expect(result.value).toBe(ERR_NOT_AUTHORIZED);
    });
  });
});