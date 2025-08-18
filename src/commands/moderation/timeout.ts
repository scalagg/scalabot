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
    .setName('mute')
    .setDescription('Mute a user (timeout or permanent)')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to mute')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the mute')
            .setRequired(true)
            .setMaxLength(1000)
    )
    .addStringOption(option =>
        option
            .setName('duration')
            .setDescription('Duration (1d, 12h, 30m, 60s, or "perm" for permanent)')
            .setRequired(false)
    )
    .addStringOption(option =>
        option
            .setName('evidence')
            .setDescription('Evidence for the timeout (optional)')
            .setRequired(false)
            .setMaxLength(1000)
    )
    .addBooleanOption(option =>
        option
            .setName('appealable')
            .setDescription('Whether this timeout can be appealed')
            .setRequired(false)
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

    // Check if user has permission to timeout (requires admin role)
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. This action requires admin privileges.',
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser('user');
    const duration = interaction.options.getString('duration');
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

    if (!reason) {
        await interaction.reply({
            content: '❌ Please provide a reason.',
            ephemeral: true
        });
        return;
    }

    // Parse duration if provided
    let durationMs: number | undefined;
    let isPermanent = false;
    
    if (duration) {
        // Check if duration is "perm" for permanent mute
        if (duration.toLowerCase() === 'perm' || duration.toLowerCase() === 'permanent') {
            isPermanent = true;
        } else {
            const parsedDuration = moderationService.parseDuration(duration);
            if (!parsedDuration) {
                await interaction.reply({
                    content: '❌ Invalid duration format. Use: 1d, 12h, 30m, 60s, or "perm" for permanent',
                    ephemeral: true
                });
                return;
            }
            durationMs = parsedDuration;

            // Check if duration is too short (minimum 10 seconds)
            if (durationMs < 10 * 1000) {
                await interaction.reply({
                    content: '❌ Duration must be at least 10 seconds.',
                    ephemeral: true
                });
                return;
            }

            // Check if duration exceeds Discord's limits (28 days) - use muted role instead
            if (durationMs > 28 * 24 * 60 * 60 * 1000) {
                isPermanent = true;
                durationMs = undefined; // Will be handled as permanent mute
            }
        }
    } else {
        // No duration provided = permanent
        isPermanent = true;
    }

    // Check if target is the bot itself
    if (targetUser.id === interaction.client.user.id) {
        await interaction.reply({
            content: '❌ I cannot timeout myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot timeout yourself.',
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

        // Check if target can be timed out
        if (!targetMember.moderatable) {
            await interaction.editReply({
                content: '❌ I cannot timeout this user. They may have higher permissions than me.'
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
                        content: '❌ You cannot timeout someone with a higher or equal role to yours.'
                    });
                    return;
                }
            }
        }

        // Handle permanent timeout (muted role) vs temporary timeout (Discord timeout)
        if (isPermanent) {
            let mutedRole = interaction.guild.roles.cache.find(role => 
                role.name.toLowerCase() === 'muted'
            );

            if (!mutedRole) {
                // Create muted role if it doesn't exist
                mutedRole = await interaction.guild.roles.create({
                    name: 'Muted',
                    color: '#808080',
                    reason: 'Muted role for permanent timeouts',
                    permissions: []
                });

                // Set permissions for all channels
                interaction.guild.channels.cache.forEach(async (channel) => {
                    if (channel.isTextBased() && 'permissionOverwrites' in channel) {
                        await channel.permissionOverwrites.create(mutedRole!, {
                            SendMessages: false,
                            AddReactions: false,
                            CreatePublicThreads: false,
                            CreatePrivateThreads: false,
                            SendMessagesInThreads: false
                        });
                    }
                });
            }

            // Check if user already has muted role
            if (targetMember.roles.cache.has(mutedRole.id)) {
                await interaction.editReply({
                    content: '❌ This user is already permanently muted.'
                });
                return;
            }

            // Create moderation action in database (as mute for permanent)
            const moderationAction = await moderationService.createModerationAction({
                guildId: interaction.guildId!,
                userId: targetUser.id,
                moderatorId: interaction.user.id,
                action: 'mute',
                reason,
                duration: undefined, // Permanent
                evidence,
                appealable
            });

            // Add muted role to user
            await targetMember.roles.add(mutedRole, `${reason} | Punishment ID: ${moderationAction.punishmentId} | Moderator: ${interaction.user.tag}`);

            // Send DM to user
            await moderationService.sendModerationDM(
                moderationAction,
                targetUser,
                interaction.member as GuildMember,
                undefined // Permanent
            );

            // Send log to moderation channel
            await moderationService.sendModerationLog(
                moderationAction,
                targetUser,
                interaction.member as GuildMember,
                { 
                    duration: 'Permanent',
                    evidence 
                }
            );

        } else {
            // Handle temporary timeout using Discord's timeout system
            // Check if user is already timed out
            if (targetMember.communicationDisabledUntil && targetMember.communicationDisabledUntil.getTime() > Date.now()) {
                await interaction.editReply({
                    content: '❌ This user is already timed out.'
                });
                return;
            }

            // Create moderation action in database
            const moderationAction = await moderationService.createModerationAction({
                guildId: interaction.guildId!,
                userId: targetUser.id,
                moderatorId: interaction.user.id,
                action: 'timeout',
                reason,
                duration: durationMs!,
                evidence,
                appealable
            });

            // Timeout the user
            await targetMember.timeout(durationMs!, `${reason} | Punishment ID: ${moderationAction.punishmentId} | Moderator: ${interaction.user.tag}`);

            // Send DM to user
            await moderationService.sendModerationDM(
                moderationAction,
                targetUser,
                interaction.member as GuildMember,
                moderationService.formatDuration(durationMs!)
            );

            // Send log to moderation channel
            await moderationService.sendModerationLog(
                moderationAction,
                targetUser,
                interaction.member as GuildMember,
                { 
                    duration: moderationService.formatDuration(durationMs!),
                    evidence 
                }
            );
        }

        // Create success embed based on action type
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle(isPermanent ? '🔇 User Permanently Muted' : '⏰ User Timed Out')
            .setDescription(`**${targetUser.tag}** has been ${isPermanent ? 'permanently muted' : 'timed out'}.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '⏰ Duration', value: isPermanent ? 'Permanent' : moderationService.formatDuration(durationMs!), inline: true },
                { name: '📝 Reason', value: reason, inline: false },
                { name: '🆔 Punishment ID', value: isPermanent ? 'Permanent Mute' : 'Timeout', inline: true },
                { name: '📋 Appealable', value: appealable ? 'Yes' : 'No', inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (evidence) {
            embed.addFields({ name: '📋 Evidence', value: evidence, inline: false });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Timeout] Error timing out user:', error);
        await interaction.editReply({
            content: '❌ An error occurred while timing out the user. Please try again.'
        });
    }
} 