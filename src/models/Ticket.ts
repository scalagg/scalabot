import { Schema, model } from 'mongoose';
import { ObjectId } from 'mongodb';

export enum TicketCategory {
    STAFF_APPLICATION = 'STAFF_APPLICATION',
    MEDIA_APPLICATION = 'MEDIA_APPLICATION',
    PUNISHMENT_APPEAL = 'PUNISHMENT_APPEAL',
    BUG_REPORT = 'BUG_REPORT',
    TEBEX_SUPPORT = 'TEBEX_SUPPORT',
    HEAD_STAFF_SUPPORT = 'HEAD_STAFF_SUPPORT',
    GENERAL_SUPPORT = 'GENERAL_SUPPORT',
    OTHER = 'OTHER'
}

// Helper functions for category management
export function getCategoryDisplayName(category: TicketCategory): string {
    const displayNames: Record<TicketCategory, string> = {
        [TicketCategory.STAFF_APPLICATION]: 'Staff Application',
        [TicketCategory.MEDIA_APPLICATION]: 'Media Application',
        [TicketCategory.PUNISHMENT_APPEAL]: 'Punishment Appeal',
        [TicketCategory.BUG_REPORT]: 'Bug Report',
        [TicketCategory.TEBEX_SUPPORT]: 'Tebex Support',
        [TicketCategory.HEAD_STAFF_SUPPORT]: 'Head Staff Support',
        [TicketCategory.GENERAL_SUPPORT]: 'General Support',
        [TicketCategory.OTHER]: 'Other'
    };
    return displayNames[category];
}

export function getCategoryChannelPrefix(category: TicketCategory): string {
    const prefixes: Record<TicketCategory, string> = {
        [TicketCategory.STAFF_APPLICATION]: 'staff-app',
        [TicketCategory.MEDIA_APPLICATION]: 'media-app',
        [TicketCategory.PUNISHMENT_APPEAL]: 'appeal',
        [TicketCategory.BUG_REPORT]: 'bug',
        [TicketCategory.TEBEX_SUPPORT]: 'tebex',
        [TicketCategory.HEAD_STAFF_SUPPORT]: 'head-staff',
        [TicketCategory.GENERAL_SUPPORT]: 'general',
        [TicketCategory.OTHER]: 'other'
    };
    return prefixes[category];
}

export function getCategoryDiscordCategory(category: TicketCategory): string {
    const categories: Record<TicketCategory, string> = {
        [TicketCategory.STAFF_APPLICATION]: 'Staff Applications',
        [TicketCategory.MEDIA_APPLICATION]: 'Media Applications',
        [TicketCategory.PUNISHMENT_APPEAL]: 'Punishment Appeals',
        [TicketCategory.BUG_REPORT]: 'Bug Reports',
        [TicketCategory.TEBEX_SUPPORT]: 'Tebex Support',
        [TicketCategory.HEAD_STAFF_SUPPORT]: 'Head Staff Support',
        [TicketCategory.GENERAL_SUPPORT]: 'General Support',
        [TicketCategory.OTHER]: 'Other Support'
    };
    return categories[category];
}

export function getCategoryColor(category: TicketCategory): string {
    const colors: Record<TicketCategory, string> = {
        [TicketCategory.STAFF_APPLICATION]: '#FF6B6B',      // Red
        [TicketCategory.MEDIA_APPLICATION]: '#4ECDC4',      // Teal
        [TicketCategory.PUNISHMENT_APPEAL]: '#FEE75C',      // Yellow
        [TicketCategory.BUG_REPORT]: '#E74C3C',            // Red
        [TicketCategory.TEBEX_SUPPORT]: '#57F287',         // Green
        [TicketCategory.HEAD_STAFF_SUPPORT]: '#9B59B6',    // Purple
        [TicketCategory.GENERAL_SUPPORT]: '#5865F2',       // Blue
        [TicketCategory.OTHER]: '#95A5A6'                  // Gray
    };
    return colors[category];
}

export function getCategoryRequiredRoles(category: TicketCategory): string[] {
    const roles: Record<TicketCategory, string[]> = {
        [TicketCategory.STAFF_APPLICATION]: ['manager'], // Manager roles
        [TicketCategory.MEDIA_APPLICATION]: ['admin'],   // Admin roles
        [TicketCategory.PUNISHMENT_APPEAL]: ['staff'],   // Staff roles
        [TicketCategory.BUG_REPORT]: ['admin'],         // Admin roles
        [TicketCategory.TEBEX_SUPPORT]: ['manager', 'tebex'], // Manager roles + specific role ID
        [TicketCategory.HEAD_STAFF_SUPPORT]: ['admin'], // Admin roles
        [TicketCategory.GENERAL_SUPPORT]: ['trainee', 'staff'], // Trainee and Staff roles
        [TicketCategory.OTHER]: ['trainee', 'staff']    // Trainee and Staff roles
    };
    return roles[category];
}

export function getCategorySpecificRoleId(category: TicketCategory): string | null {
    if (category === TicketCategory.TEBEX_SUPPORT) {
        return '1310317635346628668';
    }
    return null;
}

export interface TicketMetadata {
    minecraft?: {
        username: string;
        gameMode?: string;
    };
    issue?: string;
    applicationType?: string;
    appealReason?: string;
    bugDescription?: string;
    tebexOrderId?: string;
    mediaType?: string;
    experience?: string;
    age?: string;
    timezone?: string;
    availability?: string;
    [key: string]: any;
}

export interface Ticket {
    _id?: ObjectId;
    channelId: string;
    userId: string;
    guildId: string;
    ticketNumber: number;
    category: TicketCategory;
    status: 'OPEN' | 'CLOSED' | 'RATING';
    claimedBy?: string;
    claimedAt?: Date;
    closedBy?: string;
    closedAt?: Date;
    rating?: {
        stars: number;
        feedback: string;
        givenAt: Date;
    };
    transcript?: string;
    createdAt: Date;
    updatedAt: Date;
    additionalUsers: string[];
    assignedStaff: string[]; // Array of staff member IDs assigned to this ticket
    transferHistory: {
        fromCategory: TicketCategory;
        toCategory: TicketCategory;
        transferredBy: string;
        transferredAt: Date;
        reason?: string;
    }[];
    metadata: TicketMetadata;
}

const ticketSchema = new Schema<Ticket>({
    channelId: { type: String, required: true },
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    ticketNumber: { type: Number, required: true },
    category: { type: String, enum: Object.values(TicketCategory), required: true },
    status: { type: String, enum: ['OPEN', 'CLOSED', 'RATING'], default: 'OPEN' },
    claimedBy: String,
    claimedAt: Date,
    closedBy: String,
    closedAt: Date,
    rating: {
        stars: { type: Number, min: 1, max: 5 },
        feedback: String,
        givenAt: Date
    },
    transcript: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date,
    additionalUsers: [String],
    assignedStaff: { type: [String], default: [] }, // Array of staff member IDs
    transferHistory: [{
        fromCategory: { type: String, enum: Object.values(TicketCategory), required: true },
        toCategory: { type: String, enum: Object.values(TicketCategory), required: true },
        transferredBy: { type: String, required: true },
        transferredAt: { type: Date, default: Date.now },
        reason: String
    }],
    metadata: { type: Schema.Types.Mixed, required: true }
});

// Add compound unique index for guildId + ticketNumber to prevent duplicates
ticketSchema.index({ guildId: 1, ticketNumber: 1 }, { unique: true });

export const TicketModel = model<Ticket>('Ticket', ticketSchema); 