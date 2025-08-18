import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { autoCooldownService } from '../../services/AutoCooldownService';

export const data = new SlashCommandBuilder()
    .setName('autocooldown')
    .setDescription('Manage auto chat cooldown system')
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Check auto cooldown status')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('enable')
            .setDescription('Manually enable chat cooldown')
            .addStringOption(option =>
                option
                    .setName('reason')
                    .setDescription('Reason for enabling cooldown')
                    .setRequired(true)
                    .setMaxLength(200)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('disable')
            .setDescription('Manually disable chat cooldown')
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

    // Check if user has admin permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Admin role required.',
            ephemeral: true
        });
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
        await interaction.deferReply({ ephemeral: true });

        if (subcommand === 'status') {
            await showStatus(interaction);
        } else if (subcommand === 'enable') {
            await enableCooldown(interaction);
        } else if (subcommand === 'disable') {
            await disableCooldown(interaction);
        }

    } catch (error) {
        console.error('[AutoCooldown] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function showStatus(interaction: ChatInputCommandInteraction) {
    const status = autoCooldownService.getStatus(interaction.guildId!);
    
    const embed = new EmbedBuilder()
        .setColor(status.isActive ? serverUtils.getColor('warning') : serverUtils.getColor('info'))
        .setTitle('🛡️ Auto Cooldown Status')
        .addFields(
            { 
                name: '🟢 Status', 
                value: status.isActive ? 'Active' : 'Inactive', 
                inline: true 
            },
            { 
                name: '📊 Recent Messages', 
                value: status.recentMessages.toString(), 
                inline: true 
            },
            { 
                name: '🎯 Spam Threshold', 
                value: '8 messages in 10 seconds', 
                inline: true 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    if (status.isActive) {
        const enabledAt = status.enabledAt ? new Date(status.enabledAt) : new Date();
        const duration = status.duration || 5 * 60 * 1000; // 5 minutes
        const timeRemaining = Math.max(0, (enabledAt.getTime() + duration) - Date.now());
        
        embed.addFields(
            { 
                name: '⏰ Enabled At', 
                value: `<t:${Math.floor(enabledAt.getTime() / 1000)}:F>`, 
                inline: true 
            },
            { 
                name: '⏰ Time Remaining', 
                value: timeRemaining > 0 ? `<t:${Math.floor((enabledAt.getTime() + duration) / 1000)}:R>` : 'Expired', 
                inline: true 
            },
            { 
                name: '📝 Reason', 
                value: status.reason || 'Auto-enabled due to spam', 
                inline: false 
            }
        );
    } else {
        embed.addFields(
            { 
                name: '🛡️ Protection', 
                value: 'Chat cooldown will automatically activate if 8+ messages are sent within 10 seconds', 
                inline: false 
            },
            { 
                name: '⏰ Cooldown Duration', 
                value: '5 minutes (auto-disables after 10 minutes)', 
                inline: false 
            }
        );
    }

    await interaction.editReply({ embeds: [embed] });
}

async function enableCooldown(interaction: ChatInputCommandInteraction) {
    const reason = interaction.options.getString('reason', true);
    const status = autoCooldownService.getStatus(interaction.guildId!);

    if (status.isActive) {
        await interaction.editReply({
            content: '❌ A cooldown is already active. Use `/autocooldown disable` to disable it first.'
        });
        return;
    }

    try {
        await autoCooldownService.enableCooldownManually(interaction.guild!, reason);
        
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('✅ Cooldown Enabled')
            .setDescription('Chat cooldown has been manually enabled.')
            .addFields(
                { name: '📝 Reason', value: reason, inline: true },
                { name: '⏰ Duration', value: '5 minutes', inline: true },
                { name: '🛡️ Action', value: '5-second slowmode enabled on all channels', inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('[AutoCooldown] Error enabling cooldown:', error);
        await interaction.editReply({
            content: '❌ Failed to enable cooldown. Please try again.'
        });
    }
}

async function disableCooldown(interaction: ChatInputCommandInteraction) {
    const status = autoCooldownService.getStatus(interaction.guildId!);

    if (!status.isActive) {
        await interaction.editReply({
            content: '❌ No cooldown is currently active.'
        });
        return;
    }

    try {
        await autoCooldownService.disableCooldownManually(interaction.guild!);
        
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('✅ Cooldown Disabled')
            .setDescription('Chat cooldown has been manually disabled.')
            .addFields(
                { name: '🛡️ Status', value: 'Chat restored to normal', inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('[AutoCooldown] Error disabling cooldown:', error);
        await interaction.editReply({
            content: '❌ Failed to disable cooldown. Please try again.'
        });
    }
} 