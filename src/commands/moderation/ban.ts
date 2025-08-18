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
    .setName('ban')
    .setDescription('Ban a user from the server')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to ban')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the ban')
            .setRequired(true)
            .setMaxLength(1000)
    )
    .addStringOption(option =>
        option
            .setName('evidence')
            .setDescription('Evidence for the ban (optional)')
            .setRequired(false)
            .setMaxLength(1000)
    )
    .addBooleanOption(option =>
        option
            .setName('appealable')
            .setDescription('Whether this ban can be appealed')
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

    // Check if user has permission to ban (requires admin role)
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. This action requires admin privileges.',
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
            action: 'ban',
            reason,
            evidence,
            appealable
        });

        // Send DM to user BEFORE banning them
        await moderationService.sendModerationDM(
            moderationAction,
            targetUser,
            interaction.member as GuildMember
        );

        // Ban the user
        await interaction.guild.members.ban(targetUser, {
            reason: `${reason} | Punishment ID: ${moderationAction.punishmentId} | Moderator: ${interaction.user.tag}`
        });

        // Send log to moderation channel
        await moderationService.sendModerationLog(
            moderationAction,
            targetUser,
            interaction.member as GuildMember,
            { evidence }
        );

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🔨 User Banned Successfully')
            .setDescription(`**${targetUser.tag}** has been banned from the server.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
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
        console.error('[Ban] Error banning user:', error);
        await interaction.editReply({
            content: '❌ An error occurred while banning the user. Please try again.'
        });
    }
} 