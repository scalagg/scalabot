import { ObjectId } from 'mongodb';

export interface Giveaway {
  _id: string;
  messageId: string;
  channelId: string;
  guildId: string;
  prize: string;
  durationMs: number;
  winners: number;
  participants: string[];
  endsAt: number;
  ended: boolean;
  createdAt: Date;
  updatedAt: Date;
  winnerIds?: string[];
} 