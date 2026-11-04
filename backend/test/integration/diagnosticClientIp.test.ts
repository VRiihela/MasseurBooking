import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

// TEMPORARY (task 041): removed together with the route.
describe("GET /__diag/client-ip", () => {
  const app = createApp();

  it("returns exactly the five allowed values and is not cacheable", async () => {
    const response = await request(app)
      .get("/__diag/client-ip")
      .set("X-Forwarded-For", "198.51.100.1")
      .set("X-Real-IP", "198.51.100.2")
      .set("X-Railway-Edge", "test-edge");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      reqIp: expect.any(String),
      socketRemoteAddress: expect.any(String),
      xForwardedFor: "198.51.100.1",
      xRealIp: "198.51.100.2",
      xRailwayEdge: "test-edge",
    });
  });

  it("does not reflect cookies, authorization or the request body", async () => {
    const response = await request(app)
      .get("/__diag/client-ip")
      .set("Cookie", "session=cookie-secret")
      .set("Authorization", "Bearer auth-secret")
      .send({ note: "body-secret" });

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/secret/);
    expect(Object.keys(response.body).sort()).toEqual([
      "reqIp",
      "socketRemoteAddress",
      "xForwardedFor",
      "xRailwayEdge",
      "xRealIp",
    ]);
  });

  it("returns null for optional headers that are absent", async () => {
    const response = await request(app).get("/__diag/client-ip");

    expect(response.body.xForwardedFor).toBeNull();
    expect(response.body.xRealIp).toBeNull();
    expect(response.body.xRailwayEdge).toBeNull();
  });
});
