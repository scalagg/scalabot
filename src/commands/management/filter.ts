import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { filterService } from '../../services/FilterService';

export const data = new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Manage the word filter system')
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Show filter system status')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('enable')
            .setDescription('Enable the word filter')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('disable')
            .setDescription('Disable the word filter')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('add-word')
            .setDescription('Add a word to the banned list')
            .addStringOption(option =>
                option
                    .setName('word')
                    .setDescription('Word to add to banned list')
                    .setRequired(true)
                    .setMaxLength(50)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove-word')
            .setDescription('Remove a word from the banned list')
            .addStringOption(option =>
                option
                    .setName('word')
                    .setDescription('Word to remove from banned list')
                    .setRequired(true)
                    .setMaxLength(50)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('list-words')
            .setDescription('List all banned words')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('test')
            .setDescription('Test a message against the filter')
            .addStringOption(option =>
                option
                    .setName('message')
                    .setDescription('Message to test')
                    .setRequired(true)
                    .setMaxLength(1000)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('whitelist-channel')
            .setDescription('Add current channel to whitelist')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('unwhitelist-channel')
            .setDescription('Remove current channel from whitelist')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('whitelist-user')
            .setDescription('Add a user to whitelist')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('User to whitelist')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('unwhitelist-user')
            .setDescription('Remove a user from whitelist')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('User to remove from whitelist')
                    .setRequired(true)
            )
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
            await enableFilter(interaction);
        } else if (subcommand === 'disable') {
            await disableFilter(interaction);
        } else if (subcommand === 'add-word') {
            await addWord(interaction);
        } else if (subcommand === 'remove-word') {
            await removeWord(interaction);
        } else if (subcommand === 'list-words') {
            await listWords(interaction);
        } else if (subcommand === 'test') {
            await testMessage(interaction);
        } else if (subcommand === 'whitelist-channel') {
            await whitelistChannel(interaction);
        } else if (subcommand === 'unwhitelist-channel') {
            await unwhitelistChannel(interaction);
        } else if (subcommand === 'whitelist-user') {
            await whitelistUser(interaction);
        } else if (subcommand === 'unwhitelist-user') {
            await unwhitelistUser(interaction);
        }

    } catch (error) {
        console.error('[Filter] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function showStatus(interaction: ChatInputCommandInteraction) {
    const config = filterService.getConfig();
    const bannedWords = filterService.getBannedWords();
    const whitelistedChannels = filterService.getWhitelistedChannels();
    const whitelistedUsers = filterService.getWhitelistedUsers();

    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🛡️ Word Filter Status')
        .addFields(
            { 
                name: '🟢 Status', 
                value: config.enabled ? 'Enabled' : 'Disabled', 
                inline: true 
            },
            { 
                name: '📊 Banned Words', 
                value: bannedWords.length.toString(), 
                inline: true 
            },
            { 
                name: '🛡️ Action', 
                value: config.action, 
                inline: true 
            },
            { 
                name: '📝 Whitelisted Channels', 
                value: whitelistedChannels.length > 0 
                    ? whitelistedChannels.map(id => `<#${id}>`).join(', ')
                    : 'None', 
                inline: false 
            },
            { 
                name: '👥 Whitelisted Users', 
                value: whitelistedUsers.length > 0 
                    ? whitelistedUsers.map(id => `<@${id}>`).join(', ')
                    : 'None', 
                inline: false 
            },
            { 
                name: '👑 Whitelisted Roles', 
                value: config.whitelistedRoles.join(', '), 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function enableFilter(interaction: ChatInputCommandInteraction) {
    filterService.setEnabled(true);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Filter Enabled')
        .setDescription('The word filter system is now active and will block inappropriate content.')
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function disableFilter(interaction: ChatInputCommandInteraction) {
    filterService.setEnabled(false);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('warning'))
        .setTitle('⚠️ Filter Disabled')
        .setDescription('The word filter system is now inactive.')
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function addWord(interaction: ChatInputCommandInteraction) {
    const word = interaction.options.getString('word', true);
    
    filterService.addBannedWord(word);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Word Added')
        .setDescription(`Added \`${word}\` to the banned words list.`)
        .addFields(
            { name: '📊 Total Banned Words', value: filterService.getBannedWords().length.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function removeWord(interaction: ChatInputCommandInteraction) {
    const word = interaction.options.getString('word', true);
    
    filterService.removeBannedWord(word);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Word Removed')
        .setDescription(`Removed \`${word}\` from the banned words list.`)
        .addFields(
            { name: '📊 Total Banned Words', value: filterService.getBannedWords().length.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function listWords(interaction: ChatInputCommandInteraction) {
    const bannedWords = filterService.getBannedWords();
    
    if (bannedWords.length === 0) {
        await interaction.editReply({
            content: '📝 No banned words configured.'
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('📝 Banned Words List')
        .setDescription(`Total: ${bannedWords.length} words`)
        .addFields({
            name: '🚫 Banned Words',
            value: bannedWords.map(word => `\`${word}\``).join(', '),
            inline: false
        })
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function testMessage(interaction: ChatInputCommandInteraction) {
    const testMessage = interaction.options.getString('message', true);
    
    // Simulate the filter check
    const violations: string[] = [];
    const normalizedContent = testMessage.toLowerCase();
    const bannedWords = filterService.getBannedWords();

    for (const word of bannedWords) {
        const normalizedWord = word.toLowerCase();
        
        // Check for exact word match (with word boundaries)
        const wordRegex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (wordRegex.test(normalizedContent)) {
            violations.push(word);
        }
        
        // Also check for word as part of larger word
        if (normalizedContent.includes(normalizedWord)) {
            violations.push(word);
        }
    }

    const embed = new EmbedBuilder()
        .setColor(violations.length > 0 ? serverUtils.getColor('error') : serverUtils.getColor('success'))
        .setTitle('🧪 Filter Test Result')
        .addFields(
            { 
                name: '📝 Test Message', 
                value: `"${testMessage}"`, 
                inline: false 
            },
            { 
                name: '🔍 Result', 
                value: violations.length > 0 ? '❌ Would be blocked' : '✅ Would be allowed', 
                inline: true 
            },
            { 
                name: '🚫 Violations', 
                value: violations.length > 0 ? violations.map(v => `\`${v}\``).join(', ') : 'None', 
                inline: true 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function whitelistChannel(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel) {
        await interaction.editReply({
            content: '❌ This command can only be used in a text channel.'
        });
        return;
    }

    filterService.addWhitelistedChannel(interaction.channel.id);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Channel Whitelisted')
        .setDescription(`<#${interaction.channel.id}> is now whitelisted from the word filter.`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function unwhitelistChannel(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel) {
        await interaction.editReply({
            content: '❌ This command can only be used in a text channel.'
        });
        return;
    }

    filterService.removeWhitelistedChannel(interaction.channel.id);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Channel Unwhitelisted')
        .setDescription(`<#${interaction.channel.id}> is no longer whitelisted from the word filter.`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function whitelistUser(interaction: ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    
    filterService.addWhitelistedUser(user.id);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ User Whitelisted')
        .setDescription(`${user.tag} is now whitelisted from the word filter.`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function unwhitelistUser(interaction: ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    
    filterService.removeWhitelistedUser(user.id);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ User Unwhitelisted')
        .setDescription(`${user.tag} is no longer whitelisted from the word filter.`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
} 