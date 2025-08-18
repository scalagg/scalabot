import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { ticketService } from '../../services/TicketService';
import { serverUtils } from '../../utils/ServerUtils';
import { TicketCategory } from '../../models/Ticket';

export const data = new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('Transfer a ticket to a different category or assign staff members')
    .addStringOption(option =>
        option
            .setName('action')
            .setDescription('What type of transfer to perform')
            .setRequired(true)
            .addChoices(
                { name: 'Transfer to different category', value: 'category' },
                { name: 'Assign staff members', value: 'assign' },
                { name: 'View current assignments', value: 'view' }
            )
    )
    .addUserOption(option =>
        option
            .setName('staff1')
            .setDescription('First staff member to assign (optional)')
            .setRequired(false)
    )
    .addUserOption(option =>
        option
            .setName('staff2')
            .setDescription('Second staff member to assign (optional)')
            .setRequired(false)
    )
    .addUserOption(option =>
        option
            .setName('staff3')
            .setDescription('Third staff member to assign (optional)')
            .setRequired(false)
    )
    .addUserOption(option =>
        option
            .setName('staff4')
            .setDescription('Fourth staff member to assign (optional)')
            .setRequired(false)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
        await interaction.reply({
            content: '❌ This command can only be used in a server.',
            ephemeral: true
        });
        return;
    }

    // Set server type based on guild ID
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

    // Check if user has staff permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Staff role required.',
            ephemeral: true
        });
        return;
    }

    // Check if this is a ticket channel
    if (!interaction.channel?.name.startsWith('ticket-')) {
        await interaction.reply({
            content: '❌ This command can only be used in ticket channels.',
            ephemeral: true
        });
        return;
    }

    const action = interaction.options.getString('action', true);

    try {
        // Get the ticket for this channel
        const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({
                content: '❌ No ticket found for this channel.',
                ephemeral: true
            });
            return;
        }

        switch (action) {
            case 'category':
                await handleCategoryTransfer(interaction, ticket);
                break;
            case 'assign':
                await handleStaffAssignment(interaction, ticket);
                break;
            case 'view':
                await handleViewAssignments(interaction, ticket);
                break;
        }

    } catch (error) {
        console.error('[TicketTransfer] Error:', error);
        await interaction.reply({
            content: '❌ An error occurred while processing the transfer.',
            ephemeral: true
        });
    }
}

async function handleCategoryTransfer(interaction: ChatInputCommandInteraction, ticket: any) {
    // Create category selection menu
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('transfer_category_select')
        .setPlaceholder('Select new category for this ticket')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Staff Application')
                .setDescription('Transfer to staff application category')
                .setValue('staff_application')
                .setEmoji('👑'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Media Application')
                .setDescription('Transfer to media application category')
                .setValue('media_application')
                .setEmoji('📸'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Punishment Appeal')
                .setDescription('Transfer to punishment appeal category')
                .setValue('punishment_appeal')
                .setEmoji('⚖️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Bug Report')
                .setDescription('Transfer to bug report category')
                .setValue('bug_report')
                .setEmoji('🐛'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Tebex Support')
                .setDescription('Transfer to Tebex support category')
                .setValue('tebex_support')
                .setEmoji('🛒'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Head Staff Support')
                .setDescription('Transfer to head staff support category')
                .setValue('head_staff_support')
                .setEmoji('👨‍💼'),
            new StringSelectMenuOptionBuilder()
                .setLabel('General Support')
                .setDescription('Transfer to general support category')
                .setValue('general_support')
                .setEmoji('🌐'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Other')
                .setDescription('Transfer to other category')
                .setValue('other')
                .setEmoji('❓')
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🔄 Transfer Ticket Category')
        .setDescription(`Current category: **${ticket.category}**\n\nSelect the new category for this ticket.`)
        .addFields(
            { name: '📝 Ticket', value: `#${ticket.ticketNumber}`, inline: true },
            { name: '👤 Creator', value: `<@${ticket.userId}>`, inline: true }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
    });
}

async function handleStaffAssignment(interaction: ChatInputCommandInteraction, ticket: any) {
    const staff1 = interaction.options.getUser('staff1');
    const staff2 = interaction.options.getUser('staff2');
    const staff3 = interaction.options.getUser('staff3');
    const staff4 = interaction.options.getUser('staff4');

    const staffMembers = [staff1, staff2, staff3, staff4].filter(Boolean);

    if (staffMembers.length === 0) {
        await interaction.reply({
            content: '❌ Please specify at least one staff member to assign.',
            ephemeral: true
        });
        return;
    }

    // Validate that all specified users are staff members
    const invalidStaff = [];
    for (const staffMember of staffMembers) {
        if (staffMember) {
            const member = await interaction.guild!.members.fetch(staffMember.id);
            if (!serverUtils.hasStaffRole(member)) {
                invalidStaff.push(staffMember.tag);
            }
        }
    }

    if (invalidStaff.length > 0) {
        await interaction.reply({
            content: `❌ The following users are not staff members: ${invalidStaff.join(', ')}`,
            ephemeral: true
        });
        return;
    }

    try {
        // Assign staff members to the ticket
        await ticketService.assignStaffToTicket(ticket._id, staffMembers.map(s => s!.id));

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('✅ Staff Assignment Complete')
            .setDescription(`Successfully assigned ${staffMembers.length} staff member(s) to this ticket.`)
            .addFields(
                { name: '📝 Ticket', value: `#${ticket.ticketNumber}`, inline: true },
                { name: '👥 Assigned Staff', value: staffMembers.map(s => `<@${s!.id}>`).join(', '), inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });

        // Send notification to assigned staff
        const notificationEmbed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('🎯 Ticket Assignment')
            .setDescription(`You have been assigned to ticket #${ticket.ticketNumber}`)
            .addFields(
                { name: '📝 Category', value: ticket.category, inline: true },
                { name: '👤 Creator', value: `<@${ticket.userId}>`, inline: true },
                { name: '🛡️ Assigned By', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        for (const staffMember of staffMembers) {
            try {
                await staffMember!.send({ embeds: [notificationEmbed] });
            } catch (error) {
                console.log(`Could not send DM to ${staffMember!.tag}:`, error);
            }
        }

    } catch (error) {
        console.error('[TicketTransfer] Error assigning staff:', error);
        await interaction.reply({
            content: '❌ An error occurred while assigning staff members.',
            ephemeral: true
        });
    }
}

async function handleViewAssignments(interaction: ChatInputCommandInteraction, ticket: any) {
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('📋 Ticket Assignment Status')
        .setDescription(`Current assignments for ticket #${ticket.ticketNumber}`)
        .addFields(
            { name: '📝 Category', value: ticket.category, inline: true },
            { name: '👤 Creator', value: `<@${ticket.userId}>`, inline: true },
            { name: '🕒 Created', value: new Date(ticket.createdAt).toLocaleDateString(), inline: true }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    // Add claimed by information
    if (ticket.claimedBy) {
        embed.addFields({ name: '🔒 Claimed By', value: `<@${ticket.claimedBy}>`, inline: true });
    } else {
        embed.addFields({ name: '🔓 Status', value: 'Unclaimed', inline: true });
    }

    // Add assigned staff information
    if (ticket.assignedStaff && ticket.assignedStaff.length > 0) {
        const assignedStaffList = ticket.assignedStaff.map((staffId: string) => `<@${staffId}>`).join(', ');
        embed.addFields({ name: '👥 Assigned Staff', value: assignedStaffList, inline: false });
    } else {
        embed.addFields({ name: '👥 Assigned Staff', value: 'No staff assigned', inline: false });
    }

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}

