import type { Document } from 'mongodb';

export interface RoleMenuRole {
    name: string;
    emoji: string;
    description: string;
    color?: string;
    position: number;
    enabled: boolean;
}

export interface RoleMenu {
    _id?: string;
    guildId: string;
    channelId: string;
    messageId: string;
    title: string;
    description: string;
    roles: RoleMenuRole[];
    maxSelections: number;
    allowMultiple: boolean;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    embedMarkdown?: string; // Custom markdown for rich embed description
}

export type RoleMenuDocument = RoleMenu & Document; 