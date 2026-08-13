import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { assertTestDatabase } from "../helpers/fixtures.js";

function fakePool(connectionString: string): Pool {
  return { options: { connectionString } } as unknown as Pool;
}

describe("assertTestDatabase", () => {
  it("does not throw when the resolved database name contains 'test'", () => {
    expect(() =>
      assertTestDatabase(fakePool("postgres://postgres:postgres@localhost:5433/masseur_booking_test")),
    ).not.toThrow();
  });

  it("throws, naming the offending database, when the name has no 'test'", () => {
    expect(() =>
      assertTestDatabase(fakePool("postgres://postgres:postgres@localhost:5433/masseur_booking")),
    ).toThrow(/masseur_booking/);
  });

  it("throws when connectionString is missing entirely", () => {
    expect(() => assertTestDatabase({ options: {} } as unknown as Pool)).toThrow();
  });
});
