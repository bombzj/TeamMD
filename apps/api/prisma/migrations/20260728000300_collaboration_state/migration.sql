-- CreateTable
CREATE TABLE `CollaborationTicket` (
    `id` VARCHAR(30) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `documentId` VARCHAR(30) NOT NULL,
    `sessionId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CollaborationTicket_tokenHash_key`(`tokenHash`),
    INDEX `CollaborationTicket_documentId_expiresAt_idx`(`documentId`, `expiresAt`),
    INDEX `CollaborationTicket_sessionId_consumedAt_idx`(`sessionId`, `consumedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationState` (
    `documentId` VARCHAR(30) NOT NULL,
    `generation` INTEGER NOT NULL DEFAULT 1,
    `yjsState` LONGBLOB NOT NULL,
    `checkpointRevisionId` VARCHAR(30) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CollaborationState_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`documentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CollaborationTicket` ADD CONSTRAINT `CollaborationTicket_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CollaborationTicket` ADD CONSTRAINT `CollaborationTicket_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CollaborationTicket` ADD CONSTRAINT `CollaborationTicket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CollaborationState` ADD CONSTRAINT `CollaborationState_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;