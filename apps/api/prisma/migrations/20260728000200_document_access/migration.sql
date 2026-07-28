-- CreateTable
CREATE TABLE `DocumentAccess` (
    `documentId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `role` ENUM('EDITOR', 'VIEWER') NOT NULL,
    `grantedById` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DocumentAccess_userId_role_updatedAt_idx`(`userId`, `role`, `updatedAt`),
    INDEX `DocumentAccess_grantedById_idx`(`grantedById`),
    PRIMARY KEY (`documentId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DocumentAccess` ADD CONSTRAINT `DocumentAccess_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAccess` ADD CONSTRAINT `DocumentAccess_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAccess` ADD CONSTRAINT `DocumentAccess_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;