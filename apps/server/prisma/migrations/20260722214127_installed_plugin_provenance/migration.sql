-- CreateTable
CREATE TABLE "InstalledPlugin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "modrinthProjectId" TEXT,
    "modrinthVersionId" TEXT,
    "versionNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstalledPlugin_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InstalledPlugin_serverId_fileName_key" ON "InstalledPlugin"("serverId", "fileName");
