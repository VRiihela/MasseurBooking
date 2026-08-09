import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

// Unlike its siblings in this folder, this file needs no DATABASE_URL --
// a CORS preflight is handled and terminated by the cors() middleware
// before any route (and therefore any DB query) runs.
const app = createApp();

describe("CORS", () => {
  it("allows the configured frontend origin", async () => {
    const response = await request(app)
      .options("/services")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET");

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("does not allow an arbitrary origin, and never sends a wildcard", async () => {
    const response = await request(app)
      .options("/services")
      .set("Origin", "http://evil.example.com")
      .set("Access-Control-Request-Method", "GET");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).not.toBe("*");
  });
});
