-- CreateTable
CREATE TABLE `DocumentPublicLink` (
    `documentId` VARCHAR(30) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DocumentPublicLink_tokenHash_key`(`tokenHash`),
    INDEX `DocumentPublicLink_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`documentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DocumentPublicLink` ADD CONSTRAINT `DocumentPublicLink_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;