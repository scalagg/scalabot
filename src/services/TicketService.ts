import { ObjectId, WithId, Document } from 'mongodb';
import { Guild, GuildMember, TextChannel, User, ChannelType, PermissionFlagsBits, Client, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import type { GuildBasedChannel } from 'discord.js';
import { mongoService } from './MongoService';
import { TicketModel, TicketCategory, type TicketMetadata, type Ticket } from '../models/Ticket';
import { CounterModel } from '../models/Counter';
import { serverUtils } from '../utils/ServerUtils';
import { sentryService } from './SentryService';

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

    private async getNextTicketNumber(guildId: string): Promise<number> {
        this.checkInitialized();
        
        // Use MongoDB's findOneAndUpdate for atomic increment
        const counter = await CounterModel.findOneAndUpdate(
            { _id: `ticket_${guildId}` },
            { $inc: { sequence: 1 } },
            { 
                new: true, 
                upsert: true,
                setDefaultsOnInsert: true
            }
        );

        console.log(`[TicketService] Generated ticket number ${counter.sequence} for guild ${guildId}`);
        return counter.sequence;
    }

    private async createTicketChannel(ticket: Partial<Ticket> & { ticketNumber: number; category: TicketCategory; metadata: TicketMetadata }): Promise<TextChannel> {
        this.checkInitialized();

        const guild = await this.client.guilds.fetch(ticket.guildId!);
        if (!guild) throw new Error('Guild not found');

        const member = await guild.members.fetch(ticket.userId!);
        if (!member) throw new Error('Member not found');

        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

        // Import category helper functions
        const { 
            getCategoryChannelPrefix, 
            getCategoryDisplayName, 
            getCategoryColor, 
            getCategoryDiscordCategory,
            getCategoryRequiredRoles,
            getCategorySpecificRoleId
        } = await import('../models/Ticket');

        // Find the appropriate Discord category for this ticket type
        const discordCategoryName = getCategoryDiscordCategory(ticket.category);
        const categoryChannel = guild.channels.cache.find(
            (c: GuildBasedChannel) => c.type === ChannelType.GuildCategory && 
                c.name.toLowerCase() === discordCategoryName.toLowerCase()
        );

        if (!categoryChannel) {
            throw new Error(`Category channel "${discordCategoryName}" not found. Please create this category in Discord.`);
        }

        // Get required roles for this ticket category
        const requiredRoleTypes = getCategoryRequiredRoles(ticket.category);
        const staffRoleIds: string[] = [];
        
        // Add roles based on required role types
        for (const roleType of requiredRoleTypes) {
            if (roleType === 'tebex') {
                // Add specific Tebex role ID
                const tebexRoleId = getCategorySpecificRoleId(ticket.category);
                if (tebexRoleId) {
                    staffRoleIds.push(tebexRoleId);
                }
            } else {
                // Get roles from serverUtils based on type
                let roleNames: string[] = [];
                switch (roleType) {
                    case 'manager':
                        roleNames = serverUtils.getRoles().manager;
                        break;
                    case 'admin':
                        roleNames = serverUtils.getRoles().admin;
                        break;
                    case 'staff':
                        roleNames = serverUtils.getRoles().staff;
                        break;
                    case 'trainee':
                        roleNames = serverUtils.getRoles().trainee;
                        break;
                }
                
                // Find role IDs
                for (const roleName of roleNames) {
                    const role = guild.roles.cache.find(r => r.name === roleName);
                    if (role) {
                        staffRoleIds.push(role.id);
                    }
                }
            }
        }

        // Create permission overwrites for all staff roles
        const permissionOverwrites = [
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
            },
            ...staffRoleIds.map(roleId => ({
                id: roleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }))
        ];

        // Create the channel with category-based naming
        const categoryPrefix = getCategoryChannelPrefix(ticket.category);
        const channelName = `${categoryPrefix}-${ticket.ticketNumber}`;
        
        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: categoryChannel.id,
            permissionOverwrites
        });

        // Create ticket information embed
        const embed = new EmbedBuilder()
            .setColor(getCategoryColor(ticket.category) as any)
            .setTitle(`${getCategoryDisplayName(ticket.category)} - Ticket #${ticket.ticketNumber}`)
            .setDescription(
                `Welcome <@${ticket.userId}> to our ${getCategoryDisplayName(ticket.category).toLowerCase()}.\n` +
                'Our staff will assist you as soon as possible. It may be possible that they are busy\n' +
                'attending someone else, but for the moment we ask for your patience.\n' +
                'If you don\'t receive a reply within **5 hours**, you can tag a staff member.'
            )
            .addFields(
                { 
                    name: '📝 Ticket Category',
                    value: getCategoryDisplayName(ticket.category),
                    inline: true 
                },
                { 
                    name: '🎫 Ticket Number',
                    value: `#${ticket.ticketNumber}`,
                    inline: true 
                },
                { 
                    name: '⏰ Created',
                    value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                    inline: true 
                }
            );

        // Add Minecraft info if provided
        if (ticket.metadata.minecraft) {
            embed.addFields(
                { 
                    name: '👤 IGN',
                    value: ticket.metadata.minecraft.username,
                    inline: true 
                },
                { 
                    name: '🎮 Game Mode',
                    value: ticket.metadata.minecraft.gameMode || 'Not specified',
                    inline: true 
                }
            );
        }

        // Add category-specific information
        switch (ticket.category) {
            case 'STAFF_APPLICATION':
                if (ticket.metadata.applicationType) {
                    embed.addFields({
                        name: '📝 Application Type',
                        value: ticket.metadata.applicationType,
                        inline: true
                    });
                }
                if (ticket.metadata.experience) {
                    embed.addFields({
                        name: '💼 Experience',
                        value: ticket.metadata.experience,
                        inline: false
                    });
                }
                if (ticket.metadata.age) {
                    embed.addFields({
                        name: '🎂 Age',
                        value: ticket.metadata.age,
                        inline: true
                    });
                }
                if (ticket.metadata.timezone) {
                    embed.addFields({
                        name: '🌍 Timezone',
                        value: ticket.metadata.timezone,
                        inline: true
                    });
                }
                if (ticket.metadata.availability) {
                    embed.addFields({
                        name: '⏰ Availability',
                        value: ticket.metadata.availability,
                        inline: false
                    });
                }
                break;
            case 'MEDIA_APPLICATION':
                if (ticket.metadata.mediaType) {
                    embed.addFields({
                        name: '📸 Media Type',
                        value: ticket.metadata.mediaType,
                        inline: true
                    });
                }
                if (ticket.metadata.experience) {
                    embed.addFields({
                        name: '💼 Experience',
                        value: ticket.metadata.experience,
                        inline: false
                    });
                }
                break;
            case 'PUNISHMENT_APPEAL':
                if (ticket.metadata.appealReason) {
                    embed.addFields({
                        name: '📝 Appeal Reason',
                        value: ticket.metadata.appealReason,
                        inline: false
                    });
                }
                break;
            case 'BUG_REPORT':
                if (ticket.metadata.bugDescription) {
                    embed.addFields({
                        name: '🐛 Bug Description',
                        value: ticket.metadata.bugDescription,
                        inline: false
                    });
                }
                break;
            case 'TEBEX_SUPPORT':
                if (ticket.metadata.tebexOrderId) {
                    embed.addFields({
                        name: '🛒 Order ID',
                        value: ticket.metadata.tebexOrderId,
                        inline: true
                    });
                }
                break;
            case 'HEAD_STAFF_SUPPORT':
                // Head staff support specific fields can be added here
                break;
            case 'GENERAL_SUPPORT':
                // General support specific fields can be added here
                break;
            case 'OTHER':
                // Other specific fields can be added here
                break;
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
        const info = serverUtils.getInfo();
        embed.addFields({
            name: 'For more support, you can visit our website',
            value: info.website,
            inline: false
        })
        .setFooter(serverUtils.getFooter());

        // Create ticket management buttons
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('Claim')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
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

        const pingMessage = `🎫 **New Ticket Created!**\n\n👤 **User:** <@${ticket.userId}>\n👥 **Staff Team:** @everyone\n\nPlease respond to this ticket as soon as possible.`;

        // Send the initial message with ping, embed and buttons
        await channel.send({
            content: pingMessage,
            embeds: [embed],
            components: [row]
        });

        return channel;
    }

    async createTicket(params: CreateTicketParams): Promise<Ticket> {
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

        // Add category-specific fields to metadata
        if (fields['application-type']) {
            metadata.applicationType = fields['application-type'];
        }
        if (fields['appeal-reason']) {
            metadata.appealReason = fields['appeal-reason'];
        }
        if (fields['bug-description']) {
            metadata.bugDescription = fields['bug-description'];
        }
        if (fields['tebex-order-id']) {
            metadata.tebexOrderId = fields['tebex-order-id'];
        }
        if (fields['media-type']) {
            metadata.mediaType = fields['media-type'];
        }
        if (fields['experience']) {
            metadata.experience = fields['experience'];
        }
        if (fields['age']) {
            metadata.age = fields['age'];
        }
        if (fields['timezone']) {
            metadata.timezone = fields['timezone'];
        }
        if (fields['availability']) {
            metadata.availability = fields['availability'];
        }

        // Add any additional fields to metadata
        Object.entries(fields).forEach(([key, value]) => {
            if (!['minecraft-username', 'game-mode', 'issue', 'application-type', 'appeal-reason', 'bug-description', 'tebex-order-id', 'media-type', 'experience', 'age', 'timezone', 'availability'].includes(key)) {
                metadata[key] = value;
            }
        });

        // Get next ticket number atomically
        const ticketNumber = await this.getNextTicketNumber(guildId);

        console.log('[TicketService] Creating ticket with number:', {
            ticketNumber,
            guildId
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
        let ticket;
        try {
            ticket = await TicketModel.create({
                ...tempTicket,
                channelId: channel.id
            });
        } catch (error: any) {
            // Handle duplicate key error (shouldn't happen with atomic counter, but just in case)
            if (error.code === 11000 && error.keyPattern?.ticketNumber) {
                console.error('[TicketService] Duplicate ticket number detected, retrying...');
                // Delete the channel we just created
                await channel.delete();
                // Retry with a new ticket number
                return this.createTicket(params);
            }
            throw error;
        }

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

    async getUserTickets(userId: string, guildId: string, statuses: string[]): Promise<Ticket[]> {
        this.checkInitialized();
        return TicketModel.find({
            userId,
            guildId,
            status: { $in: statuses }
        });
    }

    async getTicketByChannel(channelId: string): Promise<Ticket | null> {
        this.checkInitialized();
        return TicketModel.findOne({ channelId });
    }

    async claimTicket(ticketId: ObjectId, staffMemberId: string): Promise<void> {
        // Get the ticket first to get the channel ID
        const ticket = await TicketModel.findById(ticketId);
        if (!ticket) {
            throw new Error('Ticket not found');
        }

        // Update ticket in database
        await TicketModel.updateOne(
            { _id: ticketId },
            { 
                $set: { 
                    claimedBy: staffMemberId,
                    claimedAt: new Date()
                } 
            }
        );

        // Get the channel
        const channel = await this.client.channels.fetch(ticket.channelId) as TextChannel;
        if (!channel) {
            throw new Error('Channel not found');
        }

        // Get the guild
        const guild = channel.guild;
        
        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

        // Import category helper functions
        const { getCategoryRequiredRoles, getCategorySpecificRoleId } = await import('../models/Ticket');

        // Get required roles for this ticket category
        const requiredRoleTypes = getCategoryRequiredRoles(ticket.category);
        const allRequiredRoles: string[] = [];
        
        // Add roles based on required role types
        for (const roleType of requiredRoleTypes) {
            if (roleType === 'tebex') {
                // Add specific Tebex role ID
                const tebexRoleId = getCategorySpecificRoleId(ticket.category);
                if (tebexRoleId) {
                    allRequiredRoles.push(tebexRoleId);
                }
            } else {
                // Get roles from serverUtils based on type
                let roleNames: string[] = [];
                switch (roleType) {
                    case 'manager':
                        roleNames = serverUtils.getRoles().manager;
                        break;
                    case 'admin':
                        roleNames = serverUtils.getRoles().admin;
                        break;
                    case 'staff':
                        roleNames = serverUtils.getRoles().staff;
                        break;
                    case 'trainee':
                        roleNames = serverUtils.getRoles().trainee;
                        break;
                }
                
                // Find role IDs
                for (const roleName of roleNames) {
                    const role = guild.roles.cache.find(r => r.name === roleName);
                    if (role) {
                        allRequiredRoles.push(role.id);
                    }
                }
            }
        }

        // Update permissions for all required roles
        for (const roleId of allRequiredRoles) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                // Check if this role is an admin role (can always write)
                const adminRoles = serverUtils.getRoles().admin;
                const isAdminRole = adminRoles.some(adminRoleName => {
                    const adminRole = guild.roles.cache.find(r => r.name === adminRoleName);
                    return adminRole && adminRole.id === roleId;
                });
                
                if (isAdminRole) {
                    await channel.permissionOverwrites.edit(role, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                } else {
                    // For other roles, remove write permissions
                    await channel.permissionOverwrites.edit(role, {
                        ViewChannel: true,
                        SendMessages: false
                    });
                }
            }
        }

        // Add write permission for the claiming staff member
        const staffMember = await guild.members.fetch(staffMemberId);
        await channel.permissionOverwrites.edit(staffMember, {
            ViewChannel: true,
            SendMessages: true
        });
    }

    async unclaimTicket(ticketId: ObjectId): Promise<void> {
        // Get the ticket first to get the channel ID
        const ticket = await TicketModel.findById(ticketId);
        if (!ticket) {
            throw new Error('Ticket not found');
        }

        // Update ticket in database
        await TicketModel.updateOne(
            { _id: ticketId },
            { 
                $unset: { 
                    claimedBy: "",
                    claimedAt: ""
                } 
            }
        );

        // Get the channel
        const channel = await this.client.channels.fetch(ticket.channelId) as TextChannel;
        if (!channel) {
            throw new Error('Channel not found');
        }

        // Get the guild
        const guild = channel.guild;
        
        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

        // Import category helper functions
        const { getCategoryRequiredRoles, getCategorySpecificRoleId } = await import('../models/Ticket');

        // Get required roles for this ticket category
        const requiredRoleTypes = getCategoryRequiredRoles(ticket.category);
        const allRequiredRoles: string[] = [];
        
        // Add roles based on required role types
        for (const roleType of requiredRoleTypes) {
            if (roleType === 'tebex') {
                // Add specific Tebex role ID
                const tebexRoleId = getCategorySpecificRoleId(ticket.category);
                if (tebexRoleId) {
                    allRequiredRoles.push(tebexRoleId);
                }
            } else {
                // Get roles from serverUtils based on type
                let roleNames: string[] = [];
                switch (roleType) {
                    case 'manager':
                        roleNames = serverUtils.getRoles().manager;
                        break;
                    case 'admin':
                        roleNames = serverUtils.getRoles().admin;
                        break;
                    case 'staff':
                        roleNames = serverUtils.getRoles().staff;
                        break;
                    case 'trainee':
                        roleNames = serverUtils.getRoles().trainee;
                        break;
                }
                
                // Find role IDs
                for (const roleName of roleNames) {
                    const role = guild.roles.cache.find(r => r.name === roleName);
                    if (role) {
                        allRequiredRoles.push(role.id);
                    }
                }
            }
        }

        // Restore write permissions for all required roles
        for (const roleId of allRequiredRoles) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                await channel.permissionOverwrites.edit(role, {
                    ViewChannel: true,
                    SendMessages: true
                });
            }
        }

        // If there was a claimer, remove their specific permission overwrite
        if (ticket.claimedBy) {
            const staffMember = await guild.members.fetch(ticket.claimedBy);
            await channel.permissionOverwrites.delete(staffMember);
        }
    }

    async closeTicket(ticketId: ObjectId, status: string, rating?: number, feedback?: string): Promise<void> {
        this.checkInitialized();
        await TicketModel.updateOne(
            { _id: ticketId },
            {
                $set: {
                    status: 'CLOSED',
                    closedAt: new Date(),
                    updatedAt: new Date(),
                    ...(rating !== undefined ? {
                        rating: {
                            stars: rating,
                            feedback: feedback || undefined,
                            givenAt: new Date()
                        }
                    } : {})
                }
            }
        );
    }

    async addUserToTicket(ticketId: ObjectId, userId: string): Promise<void> {
        const ticket = await TicketModel.findById(ticketId);
        if (!ticket) {
            throw new Error('Ticket not found');
        }

        // Check if user is already in the ticket
        if (userId === ticket.userId || userId === ticket.claimedBy || ticket.additionalUsers.includes(userId)) {
            throw new Error('User is already in the ticket');
        }

        // Add user to ticket
        await TicketModel.updateOne(
            { _id: ticketId },
            { 
                $addToSet: { additionalUsers: userId }
            }
        );

        // Get the channel
        const channel = await this.client.channels.fetch(ticket.channelId) as TextChannel;
        if (!channel) {
            throw new Error('Channel not found');
        }

        // Add channel permissions for the user
        await channel.permissionOverwrites.edit(userId, {
            ViewChannel: true,
            SendMessages: true
        });
    }

    async removeUserFromTicket(ticketId: ObjectId, userId: string): Promise<void> {
        const ticket = await TicketModel.findById(ticketId);
        if (!ticket) {
            throw new Error('Ticket not found');
        }

        // Check if user can be removed
        if (userId === ticket.userId || userId === ticket.claimedBy) {
            throw new Error('Cannot remove ticket creator or claiming staff');
        }

        if (!ticket.additionalUsers.includes(userId)) {
            throw new Error('User is not in the ticket');
        }

        // Remove user from ticket
        await TicketModel.updateOne(
            { _id: ticketId },
            { 
                $pull: { additionalUsers: userId }
            }
        );

        // Get the channel
        const channel = await this.client.channels.fetch(ticket.channelId) as TextChannel;
        if (!channel) {
            throw new Error('Channel not found');
        }

        // Remove channel permissions for the user
        await channel.permissionOverwrites.delete(userId);
    }

    async getAvailableUsersForTicket(guildId: string, ticket: Ticket): Promise<GuildMember[]> {
        const guild = await this.client.guilds.fetch(guildId);
        const members = await guild.members.fetch();
        
        // Filter out users who are already in the ticket
        return members.filter(member => 
            member.id !== ticket.userId && 
            member.id !== ticket.claimedBy && 
            !ticket.additionalUsers.includes(member.id)
        ).toJSON();
    }

    async resetTicketCounter(guildId: string, newValue: number = 0): Promise<void> {
        this.checkInitialized();
        await CounterModel.findOneAndUpdate(
            { _id: `ticket_${guildId}` },
            { $set: { sequence: newValue } },
            { upsert: true }
        );
        console.log(`[TicketService] Reset ticket counter for guild ${guildId} to ${newValue}`);
    }

    async getCurrentTicketNumber(guildId: string): Promise<number> {
        this.checkInitialized();
        const counter = await CounterModel.findOne({ _id: `ticket_${guildId}` });
        return counter?.sequence || 0;
    }
}

export const ticketService = TicketService.getInstance(); 