-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(30) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `normalizedEmail` VARCHAR(320) NOT NULL,
    `passwordHash` VARCHAR(512) NOT NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `sessionEpoch` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `disabledAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_normalizedEmail_key`(`normalizedEmail`),
    INDEX `User_disabledAt_idx`(`disabledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `csrfTokenHash` CHAR(64) NOT NULL,
    `sessionEpoch` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `userAgentSummary` VARCHAR(255) NULL,
    `ipPrefixHash` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_userId_revokedAt_expiresAt_idx`(`userId`, `revokedAt`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NULL,
    `action` VARCHAR(80) NOT NULL,
    `result` VARCHAR(40) NOT NULL,
    `requestId` VARCHAR(100) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditEvent_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditEvent_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;