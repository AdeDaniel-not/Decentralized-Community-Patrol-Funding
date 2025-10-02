import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_INVALID_TOKEN = 102;
const ERR_POOL_ALREADY_EXISTS = 117;
const ERR_POOL_NOT_FOUND = 118;
const ERR_INVALID_MIN_DONATION = 106;
const ERR_INVALID_MAX_DONATION = 107;
const ERR_MAX_POOLS_EXCEEDED = 110;
const ERR_INVALID_UPDATE_PARAM = 109;
const ERR_AUTHORITY_NOT_VERIFIED = 105;
const ERR_INVALID_POOL_TYPE = 111;
const ERR_INVALID_FEE_RATE = 112;
const ERR_INVALID_GRACE_PERIOD = 113;
const ERR_INVALID_LOCATION = 114;
const ERR_INVALID_CURRENCY = 115;
const ERR_INVALID_STATUS = 116;

interface Pool {
  name: string;
  minDonation: number;
  maxDonation: number;
  totalDonations: number;
  timestamp: number;
  creator: string;
  poolType: string;
  feeRate: number;
  gracePeriod: number;
  location: string;
  currency: string;
  status: boolean;
  tokenContract: string;
}

interface PoolUpdate {
  updateName: string;
  updateMinDonation: number;
  updateMaxDonation: number;
  updateTimestamp: number;
  updater: string;
}

interface Donation {
  amount: number;
  timestamp: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class DonationPoolMock {
  state: {
    nextPoolId: number;
    maxPools: number;
    creationFee: number;
    authorityContract: string | null;
    pools: Map<number, Pool>;
    poolUpdates: Map<number, PoolUpdate>;
    poolsByName: Map<string, number>;
    donations: Map<string, Donation>;
    totalDonationsPerPool: Map<number, number>;
  } = {
    nextPoolId: 0,
    maxPools: 1000,
    creationFee: 1000,
    authorityContract: null,
    pools: new Map(),
    poolUpdates: new Map(),
    poolsByName: new Map(),
    donations: new Map(),
    totalDonationsPerPool: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];
  tokenTransfers: Array<{ token: string; from: string; to: string; amount: number }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextPoolId: 0,
      maxPools: 1000,
      creationFee: 1000,
      authorityContract: null,
      pools: new Map(),
      poolUpdates: new Map(),
      poolsByName: new Map(),
      donations: new Map(),
      totalDonationsPerPool: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
    this.tokenTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  createPool(
    name: string,
    minDonation: number,
    maxDonation: number,
    poolType: string,
    feeRate: number,
    gracePeriod: number,
    location: string,
    currency: string,
    tokenContract: string
  ): Result<number> {
    if (this.state.nextPoolId >= this.state.maxPools) return { ok: false, value: ERR_MAX_POOLS_EXCEEDED };
    if (!name || name.length > 100) return { ok: false, value: ERR_INVALID_UPDATE_PARAM };
    if (minDonation <= 0) return { ok: false, value: ERR_INVALID_MIN_DONATION };
    if (maxDonation <= 0) return { ok: false, value: ERR_INVALID_MAX_DONATION };
    if (!["community", "emergency", "ongoing"].includes(poolType)) return { ok: false, value: ERR_INVALID_POOL_TYPE };
    if (feeRate > 10) return { ok: false, value: ERR_INVALID_FEE_RATE };
    if (gracePeriod > 30) return { ok: false, value: ERR_INVALID_GRACE_PERIOD };
    if (!location || location.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!["STX", "USD", "BTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (tokenContract === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_TOKEN };
    if (this.state.poolsByName.has(name)) return { ok: false, value: ERR_POOL_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextPoolId;
    const pool: Pool = {
      name,
      minDonation,
      maxDonation,
      totalDonations: 0,
      timestamp: this.blockHeight,
      creator: this.caller,
      poolType,
      feeRate,
      gracePeriod,
      location,
      currency,
      status: true,
      tokenContract,
    };
    this.state.pools.set(id, pool);
    this.state.poolsByName.set(name, id);
    this.state.totalDonationsPerPool.set(id, 0);
    this.state.nextPoolId++;
    return { ok: true, value: id };
  }

  getPool(id: number): Pool | null {
    return this.state.pools.get(id) || null;
  }

  donateToPool(poolId: number, amount: number, token: string): Result<boolean> {
    const pool = this.state.pools.get(poolId);
    if (!pool) return { ok: false, value: false };
    if (token !== pool.tokenContract) return { ok: false, value: false };
    if (!pool.status) return { ok: false, value: false };
    if (amount < pool.minDonation) return { ok: false, value: false };
    if (amount > pool.maxDonation) return { ok: false, value: false };

    const key = `${poolId}-${this.caller}`;
    const donorEntry = this.state.donations.get(key) || { amount: 0, timestamp: 0 };
    const newDonation = { amount: donorEntry.amount + amount, timestamp: this.blockHeight };
    this.state.donations.set(key, newDonation);

    const currentTotal = this.state.totalDonationsPerPool.get(poolId) || 0;
    this.state.totalDonationsPerPool.set(poolId, currentTotal + amount);

    const updatedPool = { ...pool, totalDonations: pool.totalDonations + amount };
    this.state.pools.set(poolId, updatedPool);

    this.tokenTransfers.push({ token, from: this.caller, to: "contract", amount });

    return { ok: true, value: true };
  }

  updatePool(id: number, updateName: string, updateMinDonation: number, updateMaxDonation: number): Result<boolean> {
    const pool = this.state.pools.get(id);
    if (!pool) return { ok: false, value: false };
    if (pool.creator !== this.caller) return { ok: false, value: false };
    if (!updateName || updateName.length > 100) return { ok: false, value: false };
    if (updateMinDonation <= 0) return { ok: false, value: false };
    if (updateMaxDonation <= 0) return { ok: false, value: false };
    if (this.state.poolsByName.has(updateName) && this.state.poolsByName.get(updateName) !== id) {
      return { ok: false, value: false };
    }

    const updated: Pool = {
      ...pool,
      name: updateName,
      minDonation: updateMinDonation,
      maxDonation: updateMaxDonation,
      timestamp: this.blockHeight,
    };
    this.state.pools.set(id, updated);
    this.state.poolsByName.delete(pool.name);
    this.state.poolsByName.set(updateName, id);
    this.state.poolUpdates.set(id, {
      updateName,
      updateMinDonation,
      updateMaxDonation,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getPoolCount(): Result<number> {
    return { ok: true, value: this.state.nextPoolId };
  }

  checkPoolExistence(name: string): Result<boolean> {
    return { ok: true, value: this.state.poolsByName.has(name) };
  }

  getDonation(poolId: number, donor: string): Donation | null {
    const key = `${poolId}-${donor}`;
    return this.state.donations.get(key) || null;
  }

  getTotalDonations(poolId: number): number {
    return this.state.totalDonationsPerPool.get(poolId) || 0;
  }
}

describe("DonationPool", () => {
  let contract: DonationPoolMock;

  beforeEach(() => {
    contract = new DonationPoolMock();
    contract.reset();
  });

  it("creates a pool successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createPool(
      "Alpha",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const pool = contract.getPool(0);
    expect(pool?.name).toBe("Alpha");
    expect(pool?.minDonation).toBe(50);
    expect(pool?.maxDonation).toBe(1000);
    expect(pool?.poolType).toBe("community");
    expect(pool?.feeRate).toBe(5);
    expect(pool?.gracePeriod).toBe(7);
    expect(pool?.location).toBe("VillageX");
    expect(pool?.currency).toBe("STX");
    expect(pool?.tokenContract).toBe("TOKEN1");
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate pool names", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "Alpha",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    const result = contract.createPool(
      "Alpha",
      100,
      2000,
      "emergency",
      10,
      14,
      "CityY",
      "USD",
      "TOKEN2"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_POOL_ALREADY_EXISTS);
  });

  it("rejects pool creation without authority contract", () => {
    const result = contract.createPool(
      "NoAuth",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid min donation", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createPool(
      "InvalidMin",
      0,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MIN_DONATION);
  });

  it("rejects invalid pool type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createPool(
      "InvalidType",
      50,
      1000,
      "invalid",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_POOL_TYPE);
  });

  it("updates a pool successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "OldPool",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    const result = contract.updatePool(0, "NewPool", 100, 2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const pool = contract.getPool(0);
    expect(pool?.name).toBe("NewPool");
    expect(pool?.minDonation).toBe(100);
    expect(pool?.maxDonation).toBe(2000);
    const update = contract.state.poolUpdates.get(0);
    expect(update?.updateName).toBe("NewPool");
    expect(update?.updateMinDonation).toBe(100);
    expect(update?.updateMaxDonation).toBe(2000);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent pool", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updatePool(99, "NewPool", 100, 2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-creator", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "TestPool",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    contract.caller = "ST3FAKE";
    const result = contract.updatePool(0, "NewPool", 100, 2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.creationFee).toBe(2000);
    contract.createPool(
      "TestPool",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    expect(contract.stxTransfers).toEqual([{ amount: 2000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects creation fee change without authority contract", () => {
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct pool count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "Pool1",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    contract.createPool(
      "Pool2",
      100,
      2000,
      "emergency",
      10,
      14,
      "CityY",
      "USD",
      "TOKEN2"
    );
    const result = contract.getPoolCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks pool existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "TestPool",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    const result = contract.checkPoolExistence("TestPool");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkPoolExistence("NonExistent");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("parses pool name with Clarity", () => {
    const cv = stringUtf8CV("TestPool");
    expect(cv.value).toBe("TestPool");
  });

  it("rejects pool creation with empty name", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createPool(
      "",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_UPDATE_PARAM);
  });

  it("rejects pool creation with max pools exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxPools = 1;
    contract.createPool(
      "Pool1",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    const result = contract.createPool(
      "Pool2",
      100,
      2000,
      "emergency",
      10,
      14,
      "CityY",
      "USD",
      "TOKEN2"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_POOLS_EXCEEDED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("donates to pool successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "TestPool",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    const result = contract.donateToPool(0, 100, "TOKEN1");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const donation = contract.getDonation(0, "ST1TEST");
    expect(donation?.amount).toBe(100);
    expect(donation?.timestamp).toBe(0);
    expect(contract.getTotalDonations(0)).toBe(100);
    const pool = contract.getPool(0);
    expect(pool?.totalDonations).toBe(100);
    expect(contract.tokenTransfers).toEqual([{ token: "TOKEN1", from: "ST1TEST", to: "contract", amount: 100 }]);
  });

  it("rejects donation with invalid token", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "TestPool",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    const result = contract.donateToPool(0, 100, "TOKEN2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects donation below min", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "TestPool",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    const result = contract.donateToPool(0, 40, "TOKEN1");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects donation to non-existent pool", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.donateToPool(99, 100, "TOKEN1");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("accumulates multiple donations", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createPool(
      "TestPool",
      50,
      1000,
      "community",
      5,
      7,
      "VillageX",
      "STX",
      "TOKEN1"
    );
    contract.donateToPool(0, 100, "TOKEN1");
    contract.donateToPool(0, 200, "TOKEN1");
    const donation = contract.getDonation(0, "ST1TEST");
    expect(donation?.amount).toBe(300);
    expect(contract.getTotalDonations(0)).toBe(300);
    const pool = contract.getPool(0);
    expect(pool?.totalDonations).toBe(300);
  });

  it("parses pool parameters with Clarity types", () => {
    const name = stringUtf8CV("TestPool");
    const minDonation = uintCV(50);
    const maxDonation = uintCV(1000);
    expect(name.value).toBe("TestPool");
    expect(minDonation.value).toEqual(BigInt(50));
    expect(maxDonation.value).toEqual(BigInt(1000));
  });
});