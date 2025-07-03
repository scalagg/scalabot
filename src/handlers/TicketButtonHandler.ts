import {
    ButtonInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    TextChannel,
    ChannelType
} from 'discord.js';
import type { OverwriteResolvable, PermissionOverwriteOptions } from 'discord.js';
import { ticketService } from '../services/TicketService';
import { TicketCategory } from '../models/Ticket';

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
        const category = interaction.customId.split('_')[1];
        const modal = new ModalBuilder()
            .setCustomId(`ticket-${category}`)
            .setTitle(`${category.charAt(0).toUpperCase() + category.slice(1)} Support Ticket`);

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
            case TicketCategory.BUYCRAFT:
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('transaction-id')
                        .setLabel('Transaction ID')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Enter your transaction ID')
                        .setRequired(true)
                );
                break;
            case TicketCategory.PUNISHMENTS:
                fields.push(
                    new TextInputBuilder()
                        .setCustomId('punishment-type')
                        .setLabel('Punishment Type')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Ban, Mute, or Warning?')
                        .setRequired(true)
                );
                break;
        }

        // Add fields to modal
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
        .setColor('#2B2D31')
        .setTitle(`Ticket #${ticketNumber}`)
        .setDescription('Thank you for creating a ticket. Please wait for a staff member to assist you.')
        .addFields(
            { name: 'Category', value: category, inline: true },
            { name: 'Created by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Minecraft Username', value: metadata.minecraft.username, inline: true },
            { name: 'Game Mode', value: metadata.minecraft.gameMode, inline: true },
            { name: 'Issue', value: metadata.issue }
        )
        .setTimestamp();

    // Create ticket buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_claim')
                .setLabel('Claim')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('Close')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket_manage_users')
                .setLabel('Manage Users')
                .setEmoji('🔧')
                .setStyle(ButtonStyle.Secondary)
        );

    const message = await channel.send({
        content: `<@${interaction.user.id}> Welcome to your ticket!`,
        embeds: [embed],
        components: [buttons]
    });

    // Create ticket in database
    await ticketService.createTicket({
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        category: category as any,
        fields: {
            'minecraft-username': metadata.minecraft.username,
            'game-mode': metadata.minecraft.gameMode,
            'issue': metadata.issue
        }
    });

    await interaction.reply({
        content: `✅ Your ticket has been created in ${channel}`,
        ephemeral: true
    });
}

function getStaffPermissions(interaction: ButtonInteraction): OverwriteResolvable[] {
    const staffRoles = [
        'Learner',
        'Trial Mod',
        'Mod',
        'Mod+',
        'Senior Mod',
        'Admin',
        'Senior Admin',
        'System Admin',
        'Platform Admin',
        'Co-Owner',
        'Owner'
    ];

    return staffRoles.map(roleName => {
        const role = interaction.guild?.roles.cache.find(r => r.name === roleName);
        if (role) {
            return {
                id: role.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            } as OverwriteResolvable;
        }
        return null;
    }).filter(Boolean) as OverwriteResolvable[];
}

async function getNextTicketNumber(guildId: string): Promise<number> {
    const tickets = await ticketService.getOpenTicketCount(guildId);
    return tickets + 1;
} 