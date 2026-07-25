import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "@prisma/client";
import { parseDockerCfg } from "./service.js";

/**
 * Regressionstests für parseDockerCfg. Kernbug (behoben): die Funktion las nur
 * edition/version/memoryMb/motd/onlineMode aus `dockerConfig`. Da
 * `reprovisionServer` den Container ausschließlich daraus neu erzeugt (nötig,
 * weil itzg online-mode aus dem Env schreibt), gingen beim Anhängen/Lösen eines
 * Subservers alle übrigen Anlage-Parameter verloren: ein Modpack-Server startete
 * als nackte Loader-Installation neu, und ohne DIFFICULTY/MODE im Env schreibt
 * itzg beim Boot seine eigenen Defaults (easy/survival) in server.properties.
 *
 * Wird beim Anlegen ein neues Wizard-Feld in `dockerConfig` aufgenommen
 * (servers/routes.ts), muss es hier mit auftauchen — sonst überlebt es das
 * Reprovisionieren nicht.
 */

/** Minimaler Server-Datensatz; nur die von parseDockerCfg gelesenen Felder zählen. */
function serverWith(dockerConfig: string | null, edition = "FABRIC"): Server {
  return { id: "s1", edition, dockerConfig } as Server;
}

test("parseDockerCfg: übernimmt ALLE beim Anlegen gespeicherten Wizard-Parameter", () => {
  const cfg = parseDockerCfg(
    serverWith(
      JSON.stringify({
        edition: "FABRIC",
        version: "1.21.1",
        memoryMb: 4096,
        seed: "12345",
        difficulty: "hard",
        gamemode: "creative",
        motd: "Mein Server",
        onlineMode: true,
        modrinthModpack: "cobblemon",
      }),
    ),
  );

  assert.deepEqual(cfg, {
    edition: "FABRIC",
    version: "1.21.1",
    memoryMb: 4096,
    motd: "Mein Server",
    onlineMode: true,
    seed: "12345",
    difficulty: "hard",
    gamemode: "creative",
    modrinthModpack: "cobblemon",
    curseforgeModpack: undefined,
  });
});

test("parseDockerCfg: erhält einen CurseForge-Modpack-Verweis", () => {
  const cfg = parseDockerCfg(
    serverWith(JSON.stringify({ edition: "FORGE", curseforgeModpack: "all-the-mods-10" }), "FORGE"),
  );
  assert.equal(cfg.curseforgeModpack, "all-the-mods-10");
  assert.equal(cfg.modrinthModpack, undefined);
});

test("parseDockerCfg: fällt bei fehlendem/ungültigem JSON auf sichere Defaults zurück", () => {
  for (const raw of [null, "", "{kein json"]) {
    const cfg = parseDockerCfg(serverWith(raw, "PAPER"));
    // Edition aus der Server-Zeile, Rest neutrale Defaults — insbesondere
    // onlineMode=true (nicht versehentlich einen offenen Server erzeugen).
    assert.equal(cfg.edition, "PAPER", `edition für ${JSON.stringify(raw)}`);
    assert.equal(cfg.version, "LATEST");
    assert.equal(cfg.memoryMb, 2048);
    assert.equal(cfg.onlineMode, true);
    assert.equal(cfg.difficulty, undefined);
    assert.equal(cfg.gamemode, undefined);
    assert.equal(cfg.modrinthModpack, undefined);
  }
});

test("parseDockerCfg: onlineMode=false bleibt false (Subserver hinter einem Proxy)", () => {
  const cfg = parseDockerCfg(serverWith(JSON.stringify({ onlineMode: false })));
  assert.equal(cfg.onlineMode, false);
});
