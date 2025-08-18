import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { moderationService } from '../../services/ModerationService';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to unban')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the unban')
            .setRequired(true)
            .setMaxLength(1000)
    )
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

    // Check if user has permission to unban (requires admin role)
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. This action requires admin privileges.',
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason', true);

    if (!targetUser) {
        await interaction.reply({
            content: '❌ Please provide a valid user.',
            ephemeral: true
        });
        return;
    }

    try {
        // Defer reply to prevent timeout
        await interaction.deferReply();

        // Check if user is actually banned
        const bans = await interaction.guild.bans.fetch();
        const ban = bans.get(targetUser.id);
        
        if (!ban) {
            await interaction.editReply({
                content: '❌ This user is not banned from the server.'
            });
            return;
        }

        // Get active ban actions for this user
        const activeBans = await moderationService.getActiveActions(targetUser.id, interaction.guildId!);
        const banActions = activeBans.filter(action => action.action === 'ban' || action.action === 'tempban');

        // Create unban moderation action
        const unbanAction = await moderationService.createModerationAction({
            guildId: interaction.guildId!,
            userId: targetUser.id,
            moderatorId: interaction.user.id,
            action: 'unban',
            reason,
            appealable: false
        });

        // Unban the user
        await interaction.guild.members.unban(targetUser, reason);

        // Send DM to user to notify them they've been unbanned
        try {
            await moderationService.sendModerationDM(
                unbanAction,
                targetUser,
                interaction.member as GuildMember
            );
        } catch (error) {
            console.log('[Unban] Could not send DM to user:', error);
            // Continue execution even if DM fails
        }

        // Deactivate any active ban actions
        for (const banAction of banActions) {
            await moderationService.deactivateAction(banAction.punishmentId, interaction.user.id, reason);
        }

        // Send log to moderation channel
        await moderationService.sendModerationLog(
            unbanAction,
            targetUser,
            interaction.member as GuildMember
        );

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('✅ User Unbanned Successfully')
            .setDescription(`**${targetUser.tag}** has been unbanned from the server.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Reason', value: reason, inline: false },
                { name: '🆔 Action ID', value: unbanAction.punishmentId, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (banActions.length > 0) {
            embed.addFields({ 
                name: '🔗 Deactivated Bans', 
                value: banActions.map(action => action.punishmentId).join(', '), 
                inline: false 
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Unban] Error unbanning user:', error);
        await interaction.editReply({
            content: '❌ An error occurred while unbanning the user. Please try again.'
        });
    }
} 