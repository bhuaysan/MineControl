import { test } from "node:test";
import assert from "node:assert/strict";
import { clearAttempts, isRateLimited, registerFailedAttempt } from "./rateLimit.js";

// MAX_ATTEMPTS in rateLimit.ts — hier dupliziert, da nicht exportiert.
const MAX_ATTEMPTS = 5;

test("isRateLimited: unbekannter Key ist nie gesperrt", () => {
  assert.equal(isRateLimited("unbekannt:test-key-1"), false);
});

test("registerFailedAttempt: sperrt erst ab MAX_ATTEMPTS", () => {
  const key = "test-key-2";
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    registerFailedAttempt(key);
    assert.equal(isRateLimited(key), false, `nach ${i + 1} Fehlversuchen noch nicht gesperrt`);
  }
  registerFailedAttempt(key);
  assert.equal(isRateLimited(key), true, `nach ${MAX_ATTEMPTS} Fehlversuchen gesperrt`);
});

test("clearAttempts: hebt eine Sperre auf und setzt den Zähler zurück", () => {
  const key = "test-key-3";
  for (let i = 0; i < MAX_ATTEMPTS; i++) registerFailedAttempt(key);
  assert.equal(isRateLimited(key), true);

  clearAttempts(key);
  assert.equal(isRateLimited(key), false);

  // Zähler wirklich zurückgesetzt, nicht nur die Sperre aufgehoben — braucht
  // wieder MAX_ATTEMPTS neue Fehlversuche.
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    registerFailedAttempt(key);
    assert.equal(isRateLimited(key), false);
  }
  registerFailedAttempt(key);
  assert.equal(isRateLimited(key), true);
});

test("registerFailedAttempt: Keys sind voneinander unabhängig", () => {
  const attacked = "test-key-4:victim";
  const other = "test-key-4:bystander";
  for (let i = 0; i < MAX_ATTEMPTS; i++) registerFailedAttempt(attacked);
  assert.equal(isRateLimited(attacked), true);
  assert.equal(isRateLimited(other), false);
});
