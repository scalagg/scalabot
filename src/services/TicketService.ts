import { ObjectId } from 'mongodb';
import { Guild, GuildMember, TextChannel, User, ChannelType, PermissionFlagsBits, Client, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import type { GuildBasedChannel } from 'discord.js';
import { mongoService } from './MongoService';
import { TicketModel, TicketCategory, type TicketMetadata, type Ticket } from '../models/Ticket';

interface CreateTicketParams {
    userId: string;
    guildId: string;
    category: TicketCategory;
    fields: Record<string, string>;
}

export class TicketService {
    private static instance: TicketService;
    private client!: Client;

    private constructor() {}

    public static getInstance(): TicketService {
        if (!TicketService.instance) {
            TicketService.instance = new TicketService();
        }
        return TicketService.instance;
    }

    public setClient(client: Client) {
        this.client = client;
    }

    public async initialize() {
        // Initialize MongoDB connection
        await mongoService.connect();
    }

    private checkInitialized() {
        if (!this.client) {
            throw new Error('Discord client not initialized. Call setClient() first.');
        }
    }

    private async createTicketChannel(ticket: Partial<Ticket> & { ticketNumber: number; category: TicketCategory; metadata: TicketMetadata }): Promise<TextChannel> {
        this.checkInitialized();

        const guild = await this.client.guilds.fetch(ticket.guildId!);
        if (!guild) throw new Error('Guild not found');

        const member = await guild.members.fetch(ticket.userId!);
        if (!member) throw new Error('Member not found');

        // Create under "Tickets" category
        const categoryChannel = guild.channels.cache.find(
            (c: GuildBasedChannel) => c.type === ChannelType.GuildCategory && 
                c.name.toLowerCase() === 'tickets'
        );

        if (!categoryChannel) {
            throw new Error('Category channel "Tickets" not found. Please create this category in Discord.');
        }

        // Create the channel
        const channel = await guild.channels.create({
            name: `ticket-${ticket.ticketNumber}`,
            type: ChannelType.GuildText,
            parent: categoryChannel.id,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: member.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                },
                {
                    id: this.client.user!.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
                }
            ]
        });

        // Create ticket information embed
        const embed = new EmbedBuilder()
            .setColor('#36393F')
            .setTitle('SUPPORT TICKET')
            .setDescription(
                `Welcome <@${ticket.userId}> to our staff support ticket.\n` +
                'Our staff will assist you as soon as possible. It may be possible that they are busy\n' +
                'attending someone else, but for the moment we ask for your patience.\n' +
                'If you don\'t receive a reply within **5 hours**, you can tag a staff member.'
            )
            .addFields(
                { 
                    name: '📝 Ticket type',
                    value: `${ticket.category} Support`,
                    inline: false 
                },
                { 
                    name: '⏰ This ticket was made',
                    value: '0 seconds ago',
                    inline: false 
                }
            );

        // Add Minecraft info if provided
        if (ticket.metadata.minecraft) {
            embed.addFields(
                { 
                    name: '👤 IGN',
                    value: ticket.metadata.minecraft.username,
                    inline: false 
                },
                { 
                    name: '🎮 Game Mode',
                    value: ticket.metadata.minecraft.gameMode || 'Not specified',
                    inline: false 
                }
            );
        }

        // Add issue if provided
        if (ticket.metadata.issue) {
            embed.addFields({
                name: '💭 Issue',
                value: ticket.metadata.issue,
                inline: false
            });
        }

        // Add support website link
        embed.addFields({
            name: 'For more support, you can visit our website',
            value: 'https://placeholder.com/staff-support',
            inline: false
        });

        // Create ticket management buttons
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('Claim')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🎫'),
                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('Close')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId('ticket_manage_users')
                    .setLabel('Manage Users')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('👥')
            );

        // Send the initial message with embed and buttons
        await channel.send({
            embeds: [embed],
            components: [row]
        });

        return channel;
    }

    async createTicket(params: CreateTicketParams) {
        console.log('[TicketService] Creating new ticket:', params);

        this.checkInitialized();
        const { userId, guildId, category, fields } = params;

        // Convert fields to metadata
        const metadata: TicketMetadata = {};
        
        if (fields['minecraft-username']) {
            metadata.minecraft = {
                username: fields['minecraft-username'],
                gameMode: fields['game-mode']
            };
        }

        if (fields['issue']) {
            metadata.issue = fields['issue'];
        }

        // Add any additional fields to metadata
        Object.entries(fields).forEach(([key, value]) => {
            if (!['minecraft-username', 'game-mode', 'issue'].includes(key)) {
                metadata[key] = value;
            }
        });

        // Get next ticket number
        const lastTicket = await TicketModel.findOne({ guildId }).sort({ ticketNumber: -1 });
        const ticketNumber = (lastTicket?.ticketNumber || 0) + 1;

        console.log('[TicketService] Creating ticket with number:', {
            ticketNumber,
            lastTicketNumber: lastTicket?.ticketNumber
        });

        // Create temporary ticket object for channel creation
        const tempTicket = {
            userId,
            guildId,
            category,
            ticketNumber,
            metadata,
            status: 'OPEN' as const,
            additionalUsers: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Create the Discord channel first
        const channel = await this.createTicketChannel(tempTicket);
        console.log('[TicketService] Created Discord channel:', {
            channelId: channel.id,
            channelName: channel.name
        });

        // Create the ticket with channel ID
        const ticket = await TicketModel.create({
            ...tempTicket,
            channelId: channel.id
        });

        console.log('[TicketService] Created ticket in database:', {
            ticketId: ticket._id?.toString(),
            ticketNumber,
            channelId: channel.id
        });

        return ticket;
    }

    async getOpenTicketCount(guildId: string): Promise<number> {
        this.checkInitialized();
        return TicketModel.countDocuments({
            guildId,
            status: 'OPEN'
        });
    }

    async getUserOpenTickets(userId: string, guildId: string): Promise<number> {
        this.checkInitialized();
        return TicketModel.countDocuments({
            userId,
            guildId,
            status: 'OPEN'
        });
    }

    async getTicketByChannel(channelId: string): Promise<Ticket | null> {
        this.checkInitialized();
        return TicketModel.findOne({ channelId });
    }

    async claimTicket(ticketId: ObjectId, staffMemberId: string): Promise<void> {
        this.checkInitialized();
        await TicketModel.updateOne(
            { _id: ticketId },
            {
                $set: {
                    claimedBy: staffMemberId,
                    claimedAt: new Date(),
                    updatedAt: new Date()
                }
            }
        );
    }

    async unclaimTicket(ticketId: ObjectId): Promise<void> {
        this.checkInitialized();
        await TicketModel.updateOne(
            { _id: ticketId },
            {
                $unset: {
                    claimedBy: 1,
                    claimedAt: 1
                },
                $set: {
                    updatedAt: new Date()
                }
            }
        );
    }

    async closeTicket(ticketId: ObjectId, status: string): Promise<void> {
        this.checkInitialized();
        await TicketModel.updateOne(
            { _id: ticketId },
            {
                $set: {
                    status: 'CLOSED',
                    closedAt: new Date(),
                    updatedAt: new Date()
                }
            }
        );
    }

    async addUserToTicket(ticketId: ObjectId, userId: string): Promise<void> {
        this.checkInitialized();
        await TicketModel.updateOne(
            { _id: ticketId },
            {
                $addToSet: { additionalUsers: userId },
                $set: { updatedAt: new Date() }
            }
        );
    }

    async removeUserFromTicket(ticketId: ObjectId, userId: string): Promise<void> {
        this.checkInitialized();
        await TicketModel.updateOne(
            { _id: ticketId },
            {
                $pull: { additionalUsers: userId },
                $set: { updatedAt: new Date() }
            }
        );
    }
}

export const ticketService = TicketService.getInstance(); 