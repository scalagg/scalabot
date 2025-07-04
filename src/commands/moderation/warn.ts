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
    .setName('warn')
    .setDescription('Warn a user (logs warning without Discord action)')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to warn')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the warning')
            .setRequired(true)
            .setMaxLength(1000)
    )
    .addStringOption(option =>
        option
            .setName('evidence')
            .setDescription('Evidence for the warning (optional)')
            .setRequired(false)
            .setMaxLength(1000)
    )
    .addBooleanOption(option =>
        option
            .setName('appealable')
            .setDescription('Whether this warning can be appealed')
            .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
        await interaction.reply({
            content: '❌ This command can only be used in a server.',
            ephemeral: true
        });
        return;
    }

    // Set server type based on guild ID
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId));

    // Check if user has permission to warn
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command.',
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser('user');
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

    // Check if target is the bot itself
    if (targetUser.id === interaction.client.user.id) {
        await interaction.reply({
            content: '❌ I cannot warn myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot warn yourself.',
            ephemeral: true
        });
        return;
    }

    try {
        // Defer reply to prevent timeout
        await interaction.deferReply();

        // Get target member
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        
        if (!targetMember) {
            await interaction.editReply({
                content: '❌ User is not a member of this server.'
            });
            return;
        }

        // Check if target has higher role than moderator
        if (interaction.member instanceof GuildMember) {
            const targetHighestRole = serverUtils.getHighestRole(targetMember);
            const moderatorHighestRole = serverUtils.getHighestRole(interaction.member);
            
            if (targetHighestRole && moderatorHighestRole) {
                const targetLevel = serverUtils.getRoleLevel(targetHighestRole);
                const moderatorLevel = serverUtils.getRoleLevel(moderatorHighestRole);
                
                if (targetLevel >= moderatorLevel) {
                    await interaction.editReply({
                        content: '❌ You cannot warn someone with a higher or equal role to yours.'
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
            action: 'warn',
            reason,
            evidence,
            appealable
        });

        // Send DM to user
        await moderationService.sendModerationDM(
            moderationAction,
            targetUser,
            interaction.member as GuildMember
        );

        // Send log to moderation channel
        await moderationService.sendModerationLog(
            moderationAction,
            targetUser,
            interaction.member as GuildMember,
            { evidence }
        );

        // Get user's warning history
        const userHistory = await moderationService.getUserHistory(targetUser.id, interaction.guildId!);
        const warningCount = userHistory.filter(action => action.action === 'warn').length;

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle('⚠️ User Warned')
            .setDescription(`**${targetUser.tag}** has been warned.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📊 Total Warnings', value: warningCount.toString(), inline: true },
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
        console.error('[Warn] Error warning user:', error);
        await interaction.editReply({
            content: '❌ An error occurred while warning the user. Please try again.'
        });
    }
} 