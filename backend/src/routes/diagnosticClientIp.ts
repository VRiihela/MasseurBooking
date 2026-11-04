import { Router } from "express";

// TEMPORARY (task 041): measures how Railway's edge reports the client IP.
// Must be removed, with its test and its app.ts line, before Phase B ships.
// Returns only these five values from the caller's own request.
export const diagnosticClientIpRouter = Router();

diagnosticClientIpRouter.get("/__diag/client-ip", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    reqIp: req.ip ?? null,
    socketRemoteAddress: req.socket.remoteAddress ?? null,
    xForwardedFor: req.headers["x-forwarded-for"] ?? null,
    xRealIp: req.headers["x-real-ip"] ?? null,
    xRailwayEdge: req.headers["x-railway-edge"] ?? null,
  });
});
