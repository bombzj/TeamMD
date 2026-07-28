-- CreateTable
CREATE TABLE `Folder` (
    `id` VARCHAR(30) NOT NULL,
    `ownerId` VARCHAR(30) NOT NULL,
    `parentId` VARCHAR(30) NULL,
    `name` VARCHAR(255) NOT NULL,
    `normalizedName` VARCHAR(255) NOT NULL,
    `parentKey` VARCHAR(30) NOT NULL,
    `activeNameKey` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `trashedAt` DATETIME(3) NULL,

    INDEX `Folder_ownerId_parentId_trashedAt_idx`(`ownerId`, `parentId`, `trashedAt`),
    UNIQUE INDEX `Folder_ownerId_parentKey_activeNameKey_key`(`ownerId`, `parentKey`, `activeNameKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(30) NOT NULL,
    `ownerId` VARCHAR(30) NOT NULL,
    `folderId` VARCHAR(30) NULL,
    `name` VARCHAR(255) NOT NULL,
    `normalizedName` VARCHAR(255) NOT NULL,
    `parentKey` VARCHAR(30) NOT NULL,
    `activeNameKey` VARCHAR(255) NULL,
    `currentRevisionId` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `trashedAt` DATETIME(3) NULL,

    INDEX `Document_ownerId_folderId_trashedAt_idx`(`ownerId`, `folderId`, `trashedAt`),
    INDEX `Document_currentRevisionId_idx`(`currentRevisionId`),
    UNIQUE INDEX `Document_ownerId_parentKey_activeNameKey_key`(`ownerId`, `parentKey`, `activeNameKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentRevision` (
    `id` VARCHAR(30) NOT NULL,
    `documentId` VARCHAR(30) NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `authorId` VARCHAR(30) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `byteSize` INTEGER NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `saveMessage` VARCHAR(500) NULL,
    `restoredFromRevisionId` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DocumentRevision_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `DocumentRevision_restoredFromRevisionId_idx`(`restoredFromRevisionId`),
    UNIQUE INDEX `DocumentRevision_documentId_ordinal_key`(`documentId`, `ordinal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Folder` ADD CONSTRAINT `Folder_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Folder` ADD CONSTRAINT `Folder_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Folder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `Folder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentRevision` ADD CONSTRAINT `DocumentRevision_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentRevision` ADD CONSTRAINT `DocumentRevision_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentRevision` ADD CONSTRAINT `DocumentRevision_restoredFromRevisionId_fkey` FOREIGN KEY (`restoredFromRevisionId`) REFERENCES `DocumentRevision`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;