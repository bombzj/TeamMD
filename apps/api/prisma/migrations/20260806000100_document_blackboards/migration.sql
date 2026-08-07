ALTER TABLE `CollaborationState`
    MODIFY COLUMN `stateFormat` ENUM('LEGACY_TEXT_V1', 'MILKDOWN_XML_V1', 'MILKDOWN_BLACKBOARDS_V1') NOT NULL DEFAULT 'LEGACY_TEXT_V1';

ALTER TABLE `CollaborationTicket`
    MODIFY COLUMN `stateFormat` ENUM('LEGACY_TEXT_V1', 'MILKDOWN_XML_V1', 'MILKDOWN_BLACKBOARDS_V1') NOT NULL DEFAULT 'LEGACY_TEXT_V1';

CREATE TABLE `DocumentRevisionBlackboard` (
    `revisionId` VARCHAR(30) NOT NULL,
    `blackboardId` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `backgroundMarkdown` LONGTEXT NOT NULL,
    `backgroundByteSize` INTEGER NOT NULL,
    `backgroundHash` CHAR(64) NOT NULL,
    `drawingPayload` LONGTEXT NOT NULL,
    `drawingByteSize` INTEGER NOT NULL,
    `drawingHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DocumentRevisionBlackboard_revisionId_sortOrder_idx`(`revisionId`, `sortOrder`),
    PRIMARY KEY (`revisionId`, `blackboardId`),
    CONSTRAINT `DocumentRevisionBlackboard_revisionId_fkey`
      FOREIGN KEY (`revisionId`) REFERENCES `DocumentRevision`(`id`)
      ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
