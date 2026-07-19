-- CreateTable
CREATE TABLE "Network" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "proxyServerId" TEXT NOT NULL,
    "forwardingSecretEnc" TEXT NOT NULL,
    "dockerNetworkName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Network_proxyServerId_fkey" FOREIGN KEY ("proxyServerId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "edition" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 25565,
    "rconPort" INTEGER,
    "rconPasswordEnc" TEXT,
    "dockerContainerId" TEXT,
    "dockerConfig" TEXT,
    "networkId" TEXT,
    "networkAlias" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Server_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Server" ("createdAt", "dockerConfig", "dockerContainerId", "edition", "host", "id", "name", "port", "rconPasswordEnc", "rconPort", "type", "updatedAt") SELECT "createdAt", "dockerConfig", "dockerContainerId", "edition", "host", "id", "name", "port", "rconPasswordEnc", "rconPort", "type", "updatedAt" FROM "Server";
DROP TABLE "Server";
ALTER TABLE "new_Server" RENAME TO "Server";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Network_proxyServerId_key" ON "Network"("proxyServerId");
