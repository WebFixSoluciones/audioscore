/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the CommonJS loader used by Vercel. */
const assert = require("node:assert/strict");
const { getAuth } = require("firebase-admin/auth");
const { getAppCheck } = require("firebase-admin/app-check");
const jwks = require("jwks-rsa");
assert.equal(typeof getAuth, "function");
assert.equal(typeof getAppCheck, "function");
assert.equal(typeof jwks.JwksClient, "function");
console.log("Firebase Auth y App Check cargan sin require(ESM).");
