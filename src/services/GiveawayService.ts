import { Giveaway } from '../models/Giveaway';
import { mongoService } from './MongoService';
import { Collection, ObjectId, Document } from 'mongodb';
import { Client, TextChannel, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { serverUtils } from '../utils/ServerUtils';

export class GiveawayService {
    private static instance: GiveawayService;
    private client!: Client;
    private checkInterval: NodeJS.Timeout | null = null;

    private constructor() {}

    private getCollection(): Collection<Giveaway & Document> {
        return mongoService.getCollection<Giveaway & Document>('Giveaways');
    }

    public static getInstance(): GiveawayService {
        if (!GiveawayService.instance) {
            GiveawayService.instance = new GiveawayService();
        }
        return GiveawayService.instance;
    }

    public setClient(client: Client) {
        this.client = client;
        this.startAutoEndCheck();
    }

    public async createGiveaway(giveaway: Partial<Giveaway>): Promise<Giveaway> {
        const now = new Date();
        const doc: Giveaway = {
            ...giveaway,
            participants: [],
            ended: false,
            createdAt: now,
            updatedAt: now,
        } as Giveaway;
        
        console.log('[GiveawayService] Creating giveaway:', {
            messageId: doc.messageId,
            prize: doc.prize,
            guildId: doc.guildId
        });
        
        const collection = this.getCollection();
        const result = await collection.insertOne(doc);
        const createdGiveaway = { ...doc, _id: result.insertedId.toString() };
        
        console.log('[GiveawayService] Giveaway created successfully:', {
            messageId: createdGiveaway.messageId,
            _id: createdGiveaway._id
        });
        
        return createdGiveaway;
    }

    public async getGiveawayById(messageId: string): Promise<Giveaway | null> {
        console.log('[GiveawayService] Looking for giveaway with messageId:', messageId);
        const collection = this.getCollection();
        const giveaway = await collection.findOne({ messageId });
        console.log('[GiveawayService] Found giveaway:', giveaway ? 'Yes' : 'No');
        return giveaway;
    }

    public async addParticipant(messageId: string, userId: string): Promise<boolean> {
        const collection = this.getCollection();
        const res = await collection.updateOne(
            { messageId, ended: false, participants: { $ne: userId } },
            { $push: { participants: userId }, $set: { updatedAt: new Date() } }
        );
        return res.modifiedCount > 0;
    }

    public async removeParticipant(messageId: string, userId: string): Promise<boolean> {
        const collection = this.getCollection();
        const res = await collection.updateOne(
            { messageId, ended: false },
            { $pull: { participants: userId }, $set: { updatedAt: new Date() } }
        );
        return res.modifiedCount > 0;
    }

    public async endGiveaway(messageId: string): Promise<Giveaway | null> {
        const giveaway = await this.getGiveawayById(messageId);
        if (!giveaway || giveaway.ended) return null;
        
        // Pick winners
        const entries = [...giveaway.participants];
        const winners: string[] = [];
        
        for (let i = 0; i < Math.min(giveaway.winners, entries.length); i++) {
            const idx = Math.floor(Math.random() * entries.length);
            winners.push(entries.splice(idx, 1)[0]);
        }
        
        const collection = this.getCollection();
        await collection.updateOne(
            { messageId },
            { $set: { ended: true, winnerIds: winners, updatedAt: new Date() } }
        );
        
        return this.getGiveawayById(messageId);
    }

    public async rerollGiveaway(messageId: string): Promise<Giveaway | null> {
        const giveaway = await this.getGiveawayById(messageId);
        if (!giveaway || !giveaway.ended) return null;
        
        const entries = [...giveaway.participants];
        const winners: string[] = [];
        
        for (let i = 0; i < Math.min(giveaway.winners, entries.length); i++) {
            const idx = Math.floor(Math.random() * entries.length);
            winners.push(entries.splice(idx, 1)[0]);
        }
        
        const collection = this.getCollection();
        await collection.updateOne(
            { messageId },
            { $set: { winnerIds: winners, updatedAt: new Date() } }
        );
        
        return this.getGiveawayById(messageId);
    }

    public async updateGiveaway(messageId: string, update: Partial<Giveaway>): Promise<void> {
        const collection = this.getCollection();
        await collection.updateOne(
            { messageId },
            { $set: { ...update, updatedAt: new Date() } }
        );
    }

    public async getActiveGiveaways(): Promise<Giveaway[]> {
        const collection = this.getCollection();
        return collection.find({ ended: false }).toArray();
    }

    public async getGiveawaysByGuild(guildId: string): Promise<Giveaway[]> {
        const collection = this.getCollection();
        return collection.find({ guildId }).sort({ createdAt: -1 }).toArray();
    }

    public async getActiveGiveawaysByGuild(guildId: string): Promise<Giveaway[]> {
        const collection = this.getCollection();
        return collection.find({ guildId, ended: false }).toArray();
    }

    public async deleteGiveaway(messageId: string): Promise<boolean> {
        const collection = this.getCollection();
        const res = await collection.deleteOne({ messageId });
        return res.deletedCount > 0;
    }

    public async isParticipating(messageId: string, userId: string): Promise<boolean> {
        const giveaway = await this.getGiveawayById(messageId);
        return giveaway ? giveaway.participants.includes(userId) : false;
    }

    public async getParticipantCount(messageId: string): Promise<number> {
        const giveaway = await this.getGiveawayById(messageId);
        return giveaway ? giveaway.participants.length : 0;
    }

    public async getTimeRemaining(messageId: string): Promise<number> {
        const giveaway = await this.getGiveawayById(messageId);
        if (!giveaway || giveaway.ended) return 0;
        return Math.max(0, giveaway.endsAt - Date.now());
    }

    public formatDuration(durationMs: number): string {
        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days} day${days !== 1 ? 's' : ''}`;
        } else if (hours > 0) {
            return `${hours} hour${hours !== 1 ? 's' : ''}`;
        } else if (minutes > 0) {
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else {
            return `${seconds} second${seconds !== 1 ? 's' : ''}`;
        }
    }

    public parseDuration(duration: string): number | null {
        const match = duration.match(/^(\d+)(s|m|h|d)$/i);
        if (!match) return null;

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        switch (unit) {
            case 's': return value * 1000; // seconds
            case 'm': return value * 60 * 1000; // minutes
            case 'h': return value * 60 * 60 * 1000; // hours
            case 'd': return value * 24 * 60 * 60 * 1000; // days
            default: return null;
        }
    }

    public createGiveawayEmbed(giveaway: Giveaway, isEnded: boolean = false): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setColor(isEnded ? serverUtils.getColor('success') : serverUtils.getColor('primary'))
            .setTitle(isEnded ? '🎉 GIVEAWAY ENDED' : '🎉 GIVEAWAY')
            .setDescription(giveaway.prize)
            .addFields(
                { 
                    name: '👥 Participants', 
                    value: giveaway.participants.length.toString(), 
                    inline: true 
                },
                { 
                    name: '🏆 Winners', 
                    value: giveaway.winners.toString(), 
                    inline: true 
                }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (!isEnded) {
            const timeRemaining = Math.max(0, giveaway.endsAt - Date.now());
            if (timeRemaining > 0) {
                embed.addFields({
                    name: '⏰ Time Remaining',
                    value: `<t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
                    inline: true
                });
            } else {
                embed.addFields({
                    name: '⏰ Time Remaining',
                    value: 'Ending...',
                    inline: true
                });
            }
        } else if (giveaway.winnerIds && giveaway.winnerIds.length > 0) {
            const winnerMentions = giveaway.winnerIds.map(id => `<@${id}>`).join(', ');
            embed.addFields({
                name: '🎊 Winners',
                value: winnerMentions,
                inline: false
            });
        } else {
            embed.addFields({
                name: '🎊 Winners',
                value: 'No participants',
                inline: false
            });
        }

        return embed;
    }

    public createGiveawayButtons(giveaway: Giveaway): ActionRowBuilder<ButtonBuilder> {
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`giveaway_join_${giveaway.messageId}`)
                    .setLabel('🎉 Join Giveaway')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎉'),
                new ButtonBuilder()
                    .setCustomId(`giveaway_chances_${giveaway.messageId}`)
                    .setLabel('🎲 My Chances')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎲')
            );

        return row;
    }

    private startAutoEndCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }

        this.checkInterval = setInterval(async () => {
            try {
                const now = Date.now();
                const collection = this.getCollection();
                const expiredGiveaways = await collection.find({
                    ended: false,
                    endsAt: { $lte: now }
                }).toArray();

                for (const giveaway of expiredGiveaways) {
                    await this.autoEndGiveaway(giveaway);
                }
            } catch (error) {
                console.error('[GiveawayService] Error in auto-end check:', error);
            }
        }, 10000); // Check every 10 seconds
    }

    private async autoEndGiveaway(giveaway: Giveaway) {
        try {
            console.log(`[GiveawayService] Auto-ending giveaway: ${giveaway.messageId}`);
            
            // End the giveaway
            const endedGiveaway = await this.endGiveaway(giveaway.messageId);
            if (!endedGiveaway) return;

            // Update the message
            const channel = await this.client.channels.fetch(giveaway.channelId) as TextChannel;
            if (!channel) {
                console.error(`[GiveawayService] Channel not found: ${giveaway.channelId}`);
                return;
            }

            const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
            if (!message) {
                console.error(`[GiveawayService] Message not found: ${giveaway.messageId}`);
                return;
            }

            const embed = this.createGiveawayEmbed(endedGiveaway, true);
            await message.edit({ embeds: [embed], components: [] });

            // Send winner announcement
            if (endedGiveaway.winnerIds && endedGiveaway.winnerIds.length > 0) {
                const winnerMentions = endedGiveaway.winnerIds.map(id => `<@${id}>`).join(', ');
                const announcementEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('success'))
                    .setTitle('🎉 Giveaway Ended!')
                    .setDescription(`Congratulations ${winnerMentions}! You won: **${giveaway.prize}**`)
                    .addFields({
                        name: '🎫 How to Claim Your Prize',
                        value: 'Please create a ticket to claim your prize. Include the giveaway message ID in your ticket.',
                        inline: false
                    })
                    .addFields({
                        name: '📝 Giveaway ID',
                        value: giveaway.messageId,
                        inline: true
                    })
                    .addFields({
                        name: '⏰ Claim Deadline',
                        value: 'Please claim within 8 hours or the prize may be forfeited.',
                        inline: true
                    })
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await channel.send({ 
                    content: `${winnerMentions} - You won! Please create a ticket to claim your prize!`,
                    embeds: [announcementEmbed] 
                });
            } else {
                const noWinnerEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('warning'))
                    .setTitle('🎉 Giveaway Ended')
                    .setDescription(`No one participated in the giveaway for: **${giveaway.prize}**`)
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await channel.send({ embeds: [noWinnerEmbed] });
            }

        } catch (error) {
            console.error(`[GiveawayService] Error auto-ending giveaway ${giveaway.messageId}:`, error);
        }
    }

    public stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
}

export const giveawayService = GiveawayService.getInstance(); 