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
    .setName('tempban')
    .setDescription('Temporarily ban a user from the server')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to temporarily ban')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('duration')
            .setDescription('Duration of the ban (e.g., 1d, 12h, 30m, 60s)')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the temporary ban')
            .setRequired(true)
            .setMaxLength(1000)
    )
    .addStringOption(option =>
        option
            .setName('evidence')
            .setDescription('Evidence for the temporary ban (optional)')
            .setRequired(false)
            .setMaxLength(1000)
    )
    .addBooleanOption(option =>
        option
            .setName('appealable')
            .setDescription('Whether this ban can be appealed')
            .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

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

    // Check if user has permission to ban
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command.',
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser('user');
    const duration = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason', true);
    const evidence = interaction.options.getString('evidence') || undefined;
    const appealable = interaction.options.getBoolean('appealable') ?? true;

    if (!targetUser) {
        await interaction.reply({
            content: '❌ Please provide a valid user.',
            ephemeral: true
        });
        return;
    }

    // Parse duration
    const durationMs = moderationService.parseDuration(duration);
    if (!durationMs) {
        await interaction.reply({
            content: '❌ Invalid duration format. Use: 1d, 12h, 30m, 60s (days, hours, minutes, seconds)',
            ephemeral: true
        });
        return;
    }

    // Check if duration is too long (more than 1 year)
    if (durationMs > 365 * 24 * 60 * 60 * 1000) {
        await interaction.reply({
            content: '❌ Duration cannot be longer than 1 year. Use /ban for permanent bans.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the bot itself
    if (targetUser.id === interaction.client.user.id) {
        await interaction.reply({
            content: '❌ I cannot ban myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot ban yourself.',
            ephemeral: true
        });
        return;
    }

    try {
        // Defer reply to prevent timeout
        await interaction.deferReply();

        // Get target member
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        
        // Check if target can be banned
        if (targetMember && !targetMember.bannable) {
            await interaction.editReply({
                content: '❌ I cannot ban this user. They may have higher permissions than me.'
            });
            return;
        }

        // Check if target has higher role than moderator
        if (targetMember && interaction.member instanceof GuildMember) {
            const targetHighestRole = serverUtils.getHighestRole(targetMember);
            const moderatorHighestRole = serverUtils.getHighestRole(interaction.member);
            
            if (targetHighestRole && moderatorHighestRole) {
                const targetLevel = serverUtils.getRoleLevel(targetHighestRole);
                const moderatorLevel = serverUtils.getRoleLevel(moderatorHighestRole);
                
                if (targetLevel >= moderatorLevel) {
                    await interaction.editReply({
                        content: '❌ You cannot ban someone with a higher or equal role to yours.'
                    });
                    return;
                }
            }
        }

        // Create moderation action in database
        const moderationAction = await moderationService.createModerationAction({
            guildId: interaction.guildId!,
            userId: targetUser.id,
            moderatorId: interaction.user.id,
            action: 'tempban',
            reason,
            duration: durationMs,
            evidence,
            appealable
        });

        await moderationService.sendModerationDM(
            moderationAction,
            targetUser,
            interaction.member as GuildMember,
            moderationService.formatDuration(durationMs)
        );

        // Ban the user
        await interaction.guild.members.ban(targetUser, {
            reason: `${reason} | Duration: ${moderationService.formatDuration(durationMs)} | Punishment ID: ${moderationAction.punishmentId} | Moderator: ${interaction.user.tag}`,
            deleteMessageSeconds: 86400 // Delete messages from the last day (24 hours in seconds)
        });

        // Send log to moderation channel
        await moderationService.sendModerationLog(
            moderationAction,
            targetUser,
            interaction.member as GuildMember,
            { 
                duration: moderationService.formatDuration(durationMs),
                evidence 
            }
        );

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle('⏰ User Temporarily Banned')
            .setDescription(`**${targetUser.tag}** has been temporarily banned from the server.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '⏰ Duration', value: moderationService.formatDuration(durationMs), inline: true },
                { name: '📝 Reason', value: reason, inline: false },
                { name: '🆔 Punishment ID', value: moderationAction.punishmentId, inline: true },
                { name: '📋 Appealable', value: appealable ? 'Yes' : 'No', inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (evidence) {
            embed.addFields({ name: '📋 Evidence', value: evidence, inline: false });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[TempBan] Error temporarily banning user:', error);
        await interaction.editReply({
            content: '❌ An error occurred while temporarily banning the user. Please try again.'
        });
    }
} 