import { 
    SlashCommandBuilder, 
    CommandInteraction, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { loggingService } from '../../services/LoggingService';
import { serverUtils } from '../../utils/ServerUtils';
import { config } from '../../config/config';

export const data = new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Manage the logging system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('View the current logging configuration')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('toggle')
            .setDescription('Toggle logging features on/off')
            .addStringOption(option =>
                option
                    .setName('feature')
                    .setDescription('The logging feature to toggle')
                    .setRequired(true)
                    .addChoices(
                        { name: 'All Logging', value: 'all' },
                        { name: 'Message Edits', value: 'messageEdits' },
                        { name: 'Message Deletes', value: 'messageDeletes' },
                        { name: 'Member Joins', value: 'memberJoins' },
                        { name: 'Member Leaves', value: 'memberLeaves' },
                        { name: 'Role Updates', value: 'roleUpdates' },
                        { name: 'Channel Updates', value: 'channelUpdates' },
                        { name: 'Server Updates', value: 'serverUpdates' },
                        { name: 'Member Updates', value: 'memberUpdates' },
                        { name: 'Ban Events', value: 'banEvents' }
                    )
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('test')
            .setDescription('Test the logging system by sending a test log')
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.guild) {
        return await interaction.reply({ 
            content: '❌ This command can only be used in a server!', 
            ephemeral: true 
        });
    }

    const subcommand = interaction.options.getSubcommand();
    const config = loggingService.getConfig();

    switch (subcommand) {
        case 'status':
            await showStatus(interaction, config);
            break;
        case 'toggle':
            await toggleFeature(interaction, config);
            break;
        case 'test':
            await testLogging(interaction);
            break;
    }
}

async function showStatus(interaction: CommandInteraction, config: any) {
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('📊 Logging System Status')
        .setDescription('Current configuration of the logging system')
        .addFields(
            { 
                name: '🔄 Overall Status', 
                value: config.enabled ? '✅ Enabled' : '❌ Disabled', 
                inline: false 
            },
            { 
                name: '✏️ Message Edits', 
                value: config.messageEdits ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            },
            { 
                name: '🗑️ Message Deletes', 
                value: config.messageDeletes ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            },
            { 
                name: '👋 Member Joins', 
                value: config.memberJoins ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            },
            { 
                name: '👋 Member Leaves', 
                value: config.memberLeaves ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            },
            { 
                name: '🎭 Role Updates', 
                value: config.roleUpdates ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            },
            { 
                name: '📝 Channel Updates', 
                value: config.channelUpdates ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            },
            { 
                name: '🏠 Server Updates', 
                value: config.serverUpdates ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            },
            { 
                name: '👤 Member Updates', 
                value: config.memberUpdates ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            },
            { 
                name: '🔨 Ban Events', 
                value: config.banEvents ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function toggleFeature(interaction: CommandInteraction, config: any) {
    const feature = interaction.options.getString('feature', true);
    const newConfig: any = {};

    if (feature === 'all') {
        const newState = !config.enabled;
        newConfig.enabled = newState;
        newConfig.messageEdits = newState;
        newConfig.messageDeletes = newState;
        newConfig.memberJoins = newState;
        newConfig.memberLeaves = newState;
        newConfig.roleUpdates = newState;
        newConfig.channelUpdates = newState;
        newConfig.serverUpdates = newState;
        newConfig.memberUpdates = newState;
        newConfig.banEvents = newState;
    } else {
        newConfig[feature] = !config[feature];
    }

    loggingService.setConfig(newConfig);

    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('⚙️ Logging Configuration Updated')
        .setDescription(`Successfully updated logging configuration`)
        .addFields(
            { 
                name: '🔧 Feature', 
                value: feature === 'all' ? 'All Logging Features' : getFeatureDisplayName(feature), 
                inline: true 
            },
            { 
                name: '📊 New Status', 
                value: newConfig[feature] || newConfig.enabled ? '✅ Enabled' : '❌ Disabled', 
                inline: true 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function testLogging(interaction: CommandInteraction) {
    try {
        const logChannel = await getLogChannel(interaction.guild!);
        if (!logChannel) {
            return await interaction.reply({ 
                content: '❌ No logging channel found! Please create a channel with "logs" in the name or configure a punishment logs channel.', 
                ephemeral: true 
            });
        }

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('🧪 Logging Test')
            .setDescription('This is a test message from the logging system')
            .addFields(
                { name: '👤 Tested by', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Channel', value: `${logChannel.name} (<#${logChannel.id}>)`, inline: true },
                { name: '⏰ Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await logChannel.send({ embeds: [embed] });

        await interaction.reply({ 
            content: `✅ Test log sent successfully to ${logChannel}!`, 
            ephemeral: true 
        });
    } catch (error) {
        console.error('[Logging Command] Error testing logging:', error);
        await interaction.reply({ 
            content: '❌ Failed to send test log. Check console for details.', 
            ephemeral: true 
        });
    }
}

function getFeatureDisplayName(feature: string): string {
    const names: { [key: string]: string } = {
        messageEdits: 'Message Edits',
        messageDeletes: 'Message Deletes',
        memberJoins: 'Member Joins',
        memberLeaves: 'Member Leaves',
        roleUpdates: 'Role Updates',
        channelUpdates: 'Channel Updates',
        serverUpdates: 'Server Updates',
        memberUpdates: 'Member Updates',
        banEvents: 'Ban Events'
    };
    return names[feature] || feature;
}

async function getLogChannel(guild: any): Promise<any> {
    try {
        // Try to find a logs channel
        const logsChannel = guild.channels.cache.find(
            (channel: any) => channel.name.toLowerCase().includes('logs') && 
                      channel.type === 0 // TextChannel
        );

        if (logsChannel) {
            return logsChannel;
        }

        // Fallback to punishment logs channel
        const punishmentChannel = await guild.client.channels.fetch(config.punishmentLogsChannelId);
        if (punishmentChannel) {
            return punishmentChannel;
        }

        return null;
    } catch (error) {
        console.error('[Logging Command] Error getting log channel:', error);
        return null;
    }
} 