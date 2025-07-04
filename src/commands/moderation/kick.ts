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
    .setName('kick')
    .setDescription('Kick a user from the server')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to kick')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the kick')
            .setRequired(true)
            .setMaxLength(1000)
    )
    .addStringOption(option =>
        option
            .setName('evidence')
            .setDescription('Evidence for the kick (optional)')
            .setRequired(false)
            .setMaxLength(1000)
    )
    .addBooleanOption(option =>
        option
            .setName('appealable')
            .setDescription('Whether this kick can be appealed')
            .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

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

    // Check if user has permission to kick
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
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
            content: '❌ I cannot kick myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot kick yourself.',
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

        // Check if target can be kicked
        if (!targetMember.kickable) {
            await interaction.editReply({
                content: '❌ I cannot kick this user. They may have higher permissions than me.'
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
                        content: '❌ You cannot kick someone with a higher or equal role to yours.'
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
            action: 'kick',
            reason,
            evidence,
            appealable
        });

        // Send DM to user BEFORE kicking them
        await moderationService.sendModerationDM(
            moderationAction,
            targetUser,
            interaction.member as GuildMember
        );

        // Kick the user
        await targetMember.kick(`${reason} | Punishment ID: ${moderationAction.punishmentId} | Moderator: ${interaction.user.tag}`);

        // Send log to moderation channel
        await moderationService.sendModerationLog(
            moderationAction,
            targetUser,
            interaction.member as GuildMember,
            { evidence }
        );

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('error'))
            .setTitle('👢 User Kicked')
            .setDescription(`**${targetUser.tag}** has been kicked from the server.`)
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
        console.error('[Kick] Error kicking user:', error);
        await interaction.editReply({
            content: '❌ An error occurred while kicking the user. Please try again.'
        });
    }
} 