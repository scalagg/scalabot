import {
    ButtonInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    TextChannel,
    ChannelType,
    ActionRowBuilder
} from 'discord.js';
import type { OverwriteResolvable, PermissionOverwriteOptions } from 'discord.js';
import { ticketService } from '../services/TicketService';
import { TicketCategory } from '../models/Ticket';
import { CounterModel } from '../models/Counter';
import { serverUtils } from '../utils/ServerUtils';

export async function handleTicketButton(interaction: ButtonInteraction) {
    try {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ This command can only be used in a server.',
                ephemeral: true
            });
            return;
        }

        // Create the modal based on the category
        // Button ID format: ticket_staff_application -> category: staff_application
        const category = interaction.customId.replace('ticket_', '');
        
        // Import category helper functions
        const { getCategoryDisplayName } = await import('../models/Ticket');
        
        const modal = new ModalBuilder()
            .setCustomId(`ticket-${category}`)
            .setTitle(`${getCategoryDisplayName(category.toUpperCase() as any)} Ticket`);

        // Add the appropriate fields based on category
        const fields: TextInputBuilder[] = [];

        // Minecraft username field (required for all categories)
        fields.push(
            new TextInputBuilder()
                .setCustomId('minecraft-username')
                .setLabel('Minecraft Username')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter your Minecraft username')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(16)
        );

        // Game mode field (optional)
        fields.push(
            new TextInputBuilder()
                .setCustomId('game-mode')
                .setLabel('Game Mode')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Which game mode? (e.g. Survival, Creative)')
                .setRequired(false)
        );

        // Issue description (required for all categories)
        fields.push(
            new TextInputBuilder()
                .setCustomId('issue')
                .setLabel('Issue Description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Please describe your issue in detail')
                .setRequired(true)
                .setMinLength(10)
                .setMaxLength(1000)
        );

        // Add category-specific fields
        switch (category.toUpperCase() as TicketCategory) {
            case 'STAFF_APPLICATION':
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('application-type')
                        .setLabel('Application Type')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Moderator, Admin, etc.')
                        .setRequired(true)
                );
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('experience')
                        .setLabel('Previous Experience')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Describe your previous moderation experience')
                        .setRequired(true)
                        .setMinLength(10)
                        .setMaxLength(1000)
                );
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('age')
                        .setLabel('Age')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Your age')
                        .setRequired(true)
                );
                break;
            case 'MEDIA_APPLICATION':
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('media-type')
                        .setLabel('Media Type')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Graphics, Video, etc.')
                        .setRequired(true)
                );
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('experience')
                        .setLabel('Experience')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Describe your media creation experience')
                        .setRequired(true)
                        .setMinLength(10)
                        .setMaxLength(1000)
                );
                break;
            case 'PUNISHMENT_APPEAL':
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('appeal-reason')
                        .setLabel('Appeal Reason')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Please explain why you are appealing')
                        .setRequired(true)
                        .setMinLength(10)
                        .setMaxLength(1000)
                );
                break;
            case 'BUG_REPORT':
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('bug-description')
                        .setLabel('Bug Description')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Please describe the bug in detail')
                        .setRequired(true)
                        .setMinLength(10)
                        .setMaxLength(1000)
                );
                break;
            case 'TEBEX_SUPPORT':
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('tebex-order-id')
                        .setLabel('Order ID')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Enter your Tebex order ID')
                        .setRequired(true)
                );
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

        // Add fields to modal using Components v2
        modal.addComponents(
            fields.map(field => 
                new ActionRowBuilder<TextInputBuilder>().addComponents(field)
            )
        );

        // Show the modal
        await interaction.showModal(modal);

    } catch (error) {
        console.error('[TicketButton] Error handling button interaction:', error);
        await interaction.reply({
            content: '❌ An error occurred while creating the ticket form. Please try again.',
            ephemeral: true
        });
    }
}

function getModalTitle(buttonId: string): string {
    switch (buttonId) {
        case 'ticket_general':
            return 'General Support';
        case 'ticket_staff':
            return 'High Staff Support';
        case 'ticket_buycraft':
            return 'Buycraft Support';
        case 'ticket_punishments':
            return 'Punishments Support';
        default:
            return 'Support Ticket';
    }
}

export async function createTicketChannel(
    interaction: ButtonInteraction,
    category: string,
    metadata: {
        minecraft: {
            username: string;
            gameMode: string;
        };
        issue: string;
    }
) {
    if (!interaction.guild) return;

    const ticketNumber = await getNextTicketNumber(interaction.guild.id);
    const channelName = `ticket-${ticketNumber}`;

    // Find the tickets category
    const ticketsCategory = interaction.guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'tickets'
    );

    if (!ticketsCategory) {
        console.error('[TicketButton] Tickets category not found');
        await interaction.reply({
            content: '❌ Could not create ticket: "Tickets" category not found. Please ask an admin to create it.',
            ephemeral: true
        });
        return;
    }

    // Get staff permissions
    const staffPerms = getStaffPermissions(interaction).filter(Boolean) as OverwriteResolvable[];

    // Create ticket channel
    const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        topic: `Ticket for ${interaction.user.tag} | ${metadata.minecraft.username}`,
        parent: ticketsCategory.id,
        permissionOverwrites: [
            {
                id: interaction.guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            },
            ...staffPerms
        ]
    });

    // Create ticket embed
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('primary'))
        .setTitle(`Ticket #${ticketNumber}`)
        .setDescription('Thank you for creating a ticket. Please wait for a staff member to assist you.')
        .addFields(
            { name: 'Category', value: category, inline: true },
            { name: 'Created by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Minecraft Username', value: metadata.minecraft.username, inline: true },
            { name: 'Game Mode', value: metadata.minecraft.gameMode, inline: true },
            { name: 'Issue', value: metadata.issue }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    // Create management buttons using Components v2
    const managementRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_claim')
                .setLabel('Claim Ticket')
                .setEmoji('📌')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('Close Ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket_manage_users')
                .setLabel('Manage Users')
                .setEmoji('👥')
                .setStyle(ButtonStyle.Secondary)
        );

    // Create ping message for staff and user
    const staffRoles = serverUtils.getRoles().staff;
    const staffPings = staffRoles
        .map(roleName => {
            const role = interaction.guild!.roles.cache.find(r => r.name === roleName);
            return role ? `<@&${role.id}>` : null;
        })
        .filter(Boolean)
        .join(' ');

    const pingMessage = `🎫 **New Ticket Created!**\n\n👤 **User:** <@${interaction.user.id}>\n👥 **Staff Team:** ${staffPings}\n\nPlease respond to this ticket as soon as possible.`;

    await channel.send({
        content: pingMessage,
        embeds: [embed],
        components: [managementRow]
    });

    await interaction.reply({
        content: `✅ Ticket created! Check <#${channel.id}>`,
        ephemeral: true
    });
}

function getStaffPermissions(interaction: ButtonInteraction): OverwriteResolvable[] {
    const staffRoles = serverUtils.getRoles().staff;
    const permissions: OverwriteResolvable[] = [];

    // Add permissions for each staff role
    for (const roleName of staffRoles) {
        const role = interaction.guild!.roles.cache.find(r => r.name === roleName);
        if (role) {
            permissions.push({
                id: role.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageMessages
                ]
            });
        }
    }

    return permissions;
}

async function getNextTicketNumber(guildId: string): Promise<number> {
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

    return counter.sequence;
} 