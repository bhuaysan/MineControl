import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES, ROLE_RANK, hasRole } from "./roles.js";

test("hasRole: gleiche Rolle reicht immer", () => {
  for (const role of ROLES) {
    assert.equal(hasRole(role, role), true);
  }
});

test("hasRole: höhere Rolle erfüllt niedrigere Anforderung", () => {
  assert.equal(hasRole("ADMIN", "VIEWER"), true);
  assert.equal(hasRole("ADMIN", "MODERATOR"), true);
  assert.equal(hasRole("MODERATOR", "VIEWER"), true);
});

test("hasRole: niedrigere Rolle erfüllt höhere Anforderung nicht", () => {
  assert.equal(hasRole("VIEWER", "MODERATOR"), false);
  assert.equal(hasRole("VIEWER", "ADMIN"), false);
  assert.equal(hasRole("MODERATOR", "ADMIN"), false);
});

test("ROLE_RANK: aufsteigende Rangfolge ohne Lücken/Duplikate", () => {
  const ranks = ROLES.map((r) => ROLE_RANK[r]);
  const sorted = [...ranks].sort((a, b) => a - b);
  assert.deepEqual(ranks, sorted, "ROLES muss bereits nach Rang aufsteigend sortiert sein");
  assert.deepEqual(new Set(ranks).size, ranks.length, "Ränge müssen eindeutig sein");
});

test("hasRole: vollständige Matrix aller Rollenpaare", () => {
  for (const role of ROLES) {
    for (const required of ROLES) {
      assert.equal(
        hasRole(role, required),
        ROLE_RANK[role] >= ROLE_RANK[required],
        `hasRole(${role}, ${required})`,
      );
    }
  }
});
