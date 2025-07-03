import { 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ColorResolvable
} from 'discord.js';

const STAFF_ROLES = [
    'Learner',
    'Trial Mod',
    'Mod',
    'Mod+',
    'Senior Mod',
    'Admin',
    'Senior Admin',
    'System Admin',
    'Platform Admin',
    'Co-Owner',
    'Owner'
];

const ADMIN_ROLES = [
    'Admin',
    'Senior Admin',
    'System Admin',
    'Platform Admin',
    'Co-Owner',
    'Owner'
];

const MANAGER_ROLES = [
    'Platform Admin',
    'System Admin',
    'Co-Owner',
    'Owner'
];

export const data = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Setup the ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    const embed = new EmbedBuilder()
        .setColor('#2B2D31' as ColorResolvable)
        .setTitle('📝 STAFF SUPPORT')
        .setDescription('We will work to solve all your problems.\n\nCreate a ticket to contact with our staff members.\nIf your request does not receive a response quickly, please be patient.\nRemember that you can also create a ticket on our website.')
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_general')
                .setLabel('General Support')
                .setEmoji('🌐')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_staff')
                .setLabel('High Staff Support')
                .setEmoji('👑')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_buycraft')
                .setLabel('Buycraft Support')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_punishments')
                .setLabel('Punishments Support')
                .setEmoji('⚖️')
                .setStyle(ButtonStyle.Secondary),
        );

    await interaction.channel?.send({
        embeds: [embed],
        components: [row]
    });

    await interaction.reply({
        content: '✅ Ticket system setup complete!',
        ephemeral: true
    });
} 