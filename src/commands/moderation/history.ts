import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    ActionRowBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { moderationService } from '../../services/ModerationService';
import { serverUtils } from '../../utils/ServerUtils';
import { mongoService } from '../../services/MongoService';
import { getMinecraftUsername } from '../../utils/minecraftUtils';
import { config } from '../../config/config';
import type { Document } from 'mongodb';

interface BaseDiscordProfile {
    _id: string;
    claimedInitialLinkAward: boolean;
    completedInitialSave: boolean | null;
    discordId: string | null;
    identifier: string;
    lastCachedDiscordUsername: string | null;
    notifiedOfSuccessfulLink: boolean;
}

type DiscordProfile = BaseDiscordProfile & Document;

interface Punishment {
    uuid: string;
    addedAt: number;
    addedBy: string | null;
    addedReason: string;
    category: string;
    duration: number;
    expireDate: string;
    removedAt: number | null;
    removedBy: string | null;
    removedReason: string | null;
    target: string;
    targetCurrentIp: string;
}

export const data = new SlashCommandBuilder()
    .setName('history')
    .setDescription('View a user\'s moderation history')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to check history for')
            .setRequired(true)
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
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

    // Check if user has permission to view history
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command.',
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser('user');

    if (!targetUser) {
        await interaction.reply({
            content: '❌ Please provide a valid user.',
            ephemeral: true
        });
        return;
    }

    try {
        // Defer reply to prevent timeout
        await interaction.deferReply({ ephemeral: true });

        // Create the select menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`history_${targetUser.id}`)
            .setPlaceholder('Select punishment history type')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Discord Punishments')
                    .setDescription('View Discord moderation actions')
                    .setValue('discord')
                    .setEmoji('🛡️'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('In-Game Punishments')
                    .setDescription('View Minecraft server punishments')
                    .setValue('ingame')
                    .setEmoji('⛏️')
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('📋 Punishment History')
            .setDescription(`Select which type of punishment history you'd like to view for **${targetUser.tag}**`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
        console.error('[History] Error creating history menu:', error);
        await interaction.editReply({
            content: '❌ An error occurred while creating the history menu. Please try again.'
        });
    }
}

export async function handleHistorySelect(interaction: any) {
    const [_, userId] = interaction.customId.split('_');
    const historyType = interaction.values[0];

    try {
        await interaction.deferUpdate();

        if (historyType === 'discord') {
            await showDiscordHistory(interaction, userId);
        } else if (historyType === 'ingame') {
            await showInGameHistory(interaction, userId);
        }

    } catch (error) {
        console.error('[History] Error handling history selection:', error);
        await interaction.followUp({
            content: '❌ An error occurred while fetching the history. Please try again.',
            ephemeral: true
        });
    }
}

async function showDiscordHistory(interaction: any, userId: string) {
    // Get user's Discord moderation history
    const userHistory = await moderationService.getUserHistory(userId, interaction.guildId);

    if (userHistory.length === 0) {
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🛡️ Discord Punishment History')
            .setDescription(`**<@${userId}>** has no Discord moderation history.`)
            .addFields(
                { name: '👤 User', value: `<@${userId}>`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed], components: [] });
        return;
    }

    // Group actions by type
    const actionCounts = {
        ban: 0,
        tempban: 0,
        unban: 0,
        timeout: 0,
        mute: 0,
        unmute: 0,
        warn: 0,
        kick: 0
    };

    userHistory.forEach(action => {
        actionCounts[action.action]++;
    });

    // Get active actions
    const activeActions = await moderationService.getActiveActions(userId, interaction.guildId);

    // Create embed
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🛡️ Discord Punishment History')
        .setDescription(`**<@${userId}>**'s Discord moderation history`)
        .addFields(
            { name: '👤 User', value: `<@${userId}>`, inline: true },
            { name: '📊 Total Actions', value: userHistory.length.toString(), inline: true },
            { name: '🟢 Active Actions', value: activeActions.length.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    // Add action counts
    const actionSummary = Object.entries(actionCounts)
        .filter(([_, count]) => count > 0)
        .map(([action, count]) => `${action.charAt(0).toUpperCase() + action.slice(1)}: ${count}`)
        .join(', ');

    if (actionSummary) {
        embed.addFields({ name: '📈 Action Summary', value: actionSummary, inline: false });
    }

    // Add recent actions (last 5)
    const recentActions = userHistory.slice(0, 5);
    if (recentActions.length > 0) {
        const recentActionsText = recentActions.map(action => {
            const date = new Date(action.createdAt).toLocaleDateString();
            const status = action.active ? '🟢' : '🔴';
            return `${status} **${action.action.toUpperCase()}** - ${date} (${action.punishmentId})`;
        }).join('\n');

        embed.addFields({ name: '🕒 Recent Actions', value: recentActionsText, inline: false });
    }

    // Add active actions if any
    if (activeActions.length > 0) {
        const activeActionsText = activeActions.map(action => {
            const date = new Date(action.createdAt).toLocaleDateString();
            const expiry = action.expiresAt ? ` - Expires: ${new Date(action.expiresAt).toLocaleDateString()}` : '';
            return `🟢 **${action.action.toUpperCase()}** - ${date} (${action.punishmentId})${expiry}`;
        }).join('\n');

        embed.addFields({ name: '🟢 Active Actions', value: activeActionsText, inline: false });
    }

    await interaction.editReply({ embeds: [embed], components: [] });
}

async function showInGameHistory(interaction: any, userId: string) {
    try {
        // Get user's Discord profile to find their Minecraft UUID
        await mongoService.connect();
        const profiles = mongoService.getCollection<DiscordProfile>('DiscordProfile');
        const profile = await profiles.findOne({ discordId: userId });

        if (!profile) {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('⛏️ In-Game Punishment History')
                .setDescription(`**<@${userId}>** has not linked their Minecraft account.`)
                .addFields(
                    { name: '👤 User', value: `<@${userId}>`, inline: true },
                    { name: '🔗 Status', value: 'Account not linked', inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await interaction.editReply({ embeds: [embed], components: [] });
            return;
        }

        // Get Minecraft username
        let minecraftUsername = 'Unknown';
        try {
            minecraftUsername = await getMinecraftUsername(profile.identifier);
        } catch (error) {
            console.error('[History] Error fetching Minecraft username:', error);
        }

        // Fetch all punishments from the API
        const response = await fetch(`${config.apiBaseUrl}/punishment/profile/${profile.identifier}`, {
            headers: {
                'Authorization': config.apiKey
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch punishment data');
        }

        const allPunishments = await response.json() as Punishment[];
        
        // Sort punishments by date (newest first)
        allPunishments.sort((a, b) => b.addedAt - a.addedAt);

        // Separate active and inactive punishments
        const now = Date.now();
        const activePunishments = allPunishments.filter(p => {
            if (p.removedAt && p.removedAt !== -1) return false;
            return p.addedAt + p.duration > now;
        });

        const inactivePunishments = allPunishments.filter(p => {
            if (p.removedAt && p.removedAt !== -1) return true;
            return p.addedAt + p.duration <= now;
        });

        // Create main embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('⛏️ In-Game Punishment History')
            .setDescription(`**${minecraftUsername}**'s complete Minecraft punishment history`)
            .addFields(
                { name: '👤 User', value: `<@${userId}>`, inline: true },
                { name: '⛏️ Minecraft', value: minecraftUsername, inline: true },
                { name: '🆔 UUID', value: profile.identifier, inline: true },
                { name: '📊 Total Punishments', value: allPunishments.length.toString(), inline: true },
                { name: '🟢 Active', value: activePunishments.length.toString(), inline: true },
                { name: '🔴 Inactive', value: inactivePunishments.length.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Add punishment type summary
        const typeCounts = {
            BAN: 0,
            MUTE: 0,
            BLACKLIST: 0
        };

        allPunishments.forEach(p => {
            typeCounts[p.category as keyof typeof typeCounts]++;
        });

        const typeSummary = Object.entries(typeCounts)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${type}: ${count}`)
            .join(' | ');

        if (typeSummary) {
            embed.addFields({ name: '📈 Punishment Types', value: typeSummary, inline: false });
        }

        // Create components for navigation
        const components = [];

        // Add active punishments if any
        if (activePunishments.length > 0) {
            const activeEmbed = createPunishmentListEmbed(
                activePunishments,
                '🟢 Active Punishments',
                minecraftUsername,
                'active'
            );
            embed.addFields({ name: '🟢 Active Punishments', value: formatPunishmentSummary(activePunishments), inline: false });
        }

        // Add recent inactive punishments (last 3)
        const recentInactive = inactivePunishments.slice(0, 3);
        if (recentInactive.length > 0) {
            embed.addFields({ name: '🔴 Recent Inactive Punishments', value: formatPunishmentSummary(recentInactive), inline: false });
        }

        // Add navigation buttons if there are many punishments
        if (allPunishments.length > 5) {
            const buttons = [];
            
            if (activePunishments.length > 0) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`history_active_${userId}`)
                        .setLabel(`Active (${activePunishments.length})`)
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🟢')
                );
            }

            if (inactivePunishments.length > 0) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`history_inactive_${userId}`)
                        .setLabel(`Inactive (${inactivePunishments.length})`)
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔴')
                );
            }

            if (buttons.length > 0) {
                const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
                components.push(buttonRow);
            }
        }

        await interaction.editReply({ embeds: [embed], components });

    } catch (error) {
        console.error('[History] Error fetching in-game history:', error);
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('error'))
            .setTitle('⛏️ In-Game Punishment History')
            .setDescription('❌ An error occurred while fetching in-game punishment data.')
            .addFields(
                { name: '👤 User', value: `<@${userId}>`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed], components: [] });
    }
}

function formatPunishmentSummary(punishments: Punishment[]): string {
    if (punishments.length === 0) return 'None';
    
    // Limit to first 5 punishments to avoid length issues
    const limitedPunishments = punishments.slice(0, 5);
    
    const summary = limitedPunishments.map(p => {
        const date = new Date(p.addedAt).toLocaleDateString();
        const status = p.removedAt && p.removedAt !== -1 ? '🔴' : '🟢';
        const duration = p.duration > 31536000000 ? 'Permanent' : `${Math.floor(p.duration / (1000 * 60 * 60 * 24))}d`;
        // Truncate reason if too long
        const reason = p.addedReason.length > 25 ? p.addedReason.substring(0, 25) + '...' : p.addedReason;
        const punisher = p.addedBy ? p.addedBy : 'System';
        return `${status} **${p.category}** - ${date} (${duration}) - ${reason} - ${punisher}`;
    }).join('\n');
    
    const remainingCount = punishments.length - limitedPunishments.length;
    return remainingCount > 0 
        ? `${summary}\n... and ${remainingCount} more punishments`
        : summary;
}

function createPunishmentListEmbed(
    punishments: Punishment[], 
    title: string, 
    username: string, 
    type: 'active' | 'inactive'
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(type === 'active' ? serverUtils.getColor('error') : serverUtils.getColor('warning'))
        .setTitle(title)
        .setDescription(`**${username}**'s ${type} punishments`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    // Group punishments by type
    const grouped = punishments.reduce((acc, p) => {
        if (!acc[p.category]) acc[p.category] = [];
        acc[p.category].push(p);
        return acc;
    }, {} as Record<string, Punishment[]>);

    Object.entries(grouped).forEach(([category, categoryPunishments]) => {
        // Limit to first 10 punishments per category to avoid field length limits
        const limitedPunishments = categoryPunishments.slice(0, 10);
        
        const categoryText = limitedPunishments.map(p => {
            const date = new Date(p.addedAt).toLocaleDateString();
            const duration = p.duration > 31536000000 ? 'Permanent' : `${Math.floor(p.duration / (1000 * 60 * 60 * 24))}d`;
            const removed = p.removedAt && p.removedAt !== -1 ? ` (Removed: ${new Date(p.removedAt).toLocaleDateString()})` : '';
            // Truncate reason if too long to avoid field length issues
            const reason = p.addedReason.length > 40 ? p.addedReason.substring(0, 40) + '...' : p.addedReason;
            const punisher = p.addedBy ? `by ${p.addedBy}` : 'by System';
            return `• ${date} - ${duration} - ${reason} - ${punisher} (ID: ${p.uuid})${removed}`;
        }).join('\n');

        // Add remaining count if there are more punishments
        const remainingCount = categoryPunishments.length - limitedPunishments.length;
        const finalText = remainingCount > 0 
            ? `${categoryText}\n... and ${remainingCount} more punishments`
            : categoryText;

        // Ensure the field value doesn't exceed Discord's 1024 character limit
        const safeText = finalText.length > 1024 
            ? finalText.substring(0, 1021) + '...'
            : finalText;

        embed.addFields({
            name: `${getCategoryEmoji(category)} ${category} (${categoryPunishments.length})`,
            value: safeText,
            inline: false
        });
    });

    return embed;
}

function getCategoryEmoji(category: string): string {
    switch (category) {
        case 'BAN': return '🔨';
        case 'MUTE': return '🔇';
        case 'BLACKLIST': return '🚫';
        default: return '⚠️';
    }
}

// Handle button interactions for detailed views
export async function handleHistoryButton(interaction: any) {
    const [_, type, userId] = interaction.customId.split('_');
    
    try {
        await interaction.deferUpdate();

        // Get user's Discord profile
        await mongoService.connect();
        const profiles = mongoService.getCollection<DiscordProfile>('DiscordProfile');
        const profile = await profiles.findOne({ discordId: userId });

        if (!profile) {
            await interaction.followUp({
                content: '❌ User profile not found.',
                ephemeral: true
            });
            return;
        }

        // Get Minecraft username
        let minecraftUsername = 'Unknown';
        try {
            minecraftUsername = await getMinecraftUsername(profile.identifier);
        } catch (error) {
            console.error('[History] Error fetching Minecraft username:', error);
        }

        // Fetch all punishments
        const response = await fetch(`${config.apiBaseUrl}/punishment/profile/${profile.identifier}`, {
            headers: {
                'Authorization': config.apiKey
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch punishment data');
        }

        const allPunishments = await response.json() as Punishment[];
        allPunishments.sort((a, b) => b.addedAt - a.addedAt);

        // Filter based on type
        const now = Date.now();
        let filteredPunishments: Punishment[];
        let title: string;

        if (type === 'active') {
            filteredPunishments = allPunishments.filter(p => {
                if (p.removedAt && p.removedAt !== -1) return false;
                return p.addedAt + p.duration > now;
            });
            title = '🟢 Active Punishments';
        } else {
            filteredPunishments = allPunishments.filter(p => {
                if (p.removedAt && p.removedAt !== -1) return true;
                return p.addedAt + p.duration <= now;
            });
            title = '🔴 Inactive Punishments';
        }

        const embed = createPunishmentListEmbed(filteredPunishments, title, minecraftUsername, type as 'active' | 'inactive');

        // Add back button
        const backButton = new ButtonBuilder()
            .setCustomId(`history_back_${userId}`)
            .setLabel('Back to Overview')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⬅️');

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);

        await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
        console.error('[History] Error handling button interaction:', error);
        await interaction.followUp({
            content: '❌ An error occurred while fetching the data.',
            ephemeral: true
        });
    }
}

// Handle back button
export async function handleHistoryBack(interaction: any) {
    const [_, __, userId] = interaction.customId.split('_');
    
    try {
        await interaction.deferUpdate();
        
        // Recreate the original select menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`history_${userId}`)
            .setPlaceholder('Select punishment history type')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Discord Punishments')
                    .setDescription('View Discord moderation actions')
                    .setValue('discord')
                    .setEmoji('🛡️'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('In-Game Punishments')
                    .setDescription('View Minecraft server punishments')
                    .setValue('ingame')
                    .setEmoji('⛏️')
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('📋 Punishment History')
            .setDescription(`Select which type of punishment history you'd like to view for **<@${userId}>**`)
            .addFields(
                { name: '👤 User', value: `<@${userId}>`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
        console.error('[History] Error handling back button:', error);
        await interaction.followUp({
            content: '❌ An error occurred while going back.',
            ephemeral: true
        });
    }
} 