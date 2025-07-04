import { Schema, model } from 'mongoose';
import { ObjectId } from 'mongodb';

export enum TicketCategory {
    GENERAL = 'GENERAL',
    STAFF = 'STAFF',
    BUYCRAFT = 'BUYCRAFT',
    PUNISHMENTS = 'PUNISHMENTS'
}

export interface TicketMetadata {
    minecraft?: {
        username: string;
        gameMode?: string;
    };
    issue?: string;
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
    metadata: { type: Schema.Types.Mixed, required: true }
});

export const TicketModel = model<Ticket>('Ticket', ticketSchema); 